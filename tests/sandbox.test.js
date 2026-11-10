// Изолацията (scripts/sandbox.js): пробит пакет не бива да вижда нищо извън папката на проекта.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { T, makeSandbox, PROJECT, freePort, rawRequest, api, waitFor } from './helpers.js';

const sandbox = await import(pathToFileURL(path.join(PROJECT, 'scripts', 'sandbox.js')).href);
const ipc = await import(pathToFileURL(path.join(PROJECT, 'scripts', 'sandbox-ipc.js')).href);
const IS_WIN = process.platform === 'win32';

test(T('security', 'The isolation launcher loads no packages from node_modules', 'Стартерът на изолацията не зарежда пакети от node_modules'), () => {
  // Стартерът работи извън клетката: ако зареди пакет, пробитият пакет би се изпълнил с всичките ти права.
  const allowed = new Set(['./sandbox-ipc.js', './content-pack.js', './npm-update.js']);
  for (const file of ['sandbox.js', 'sandbox-ipc.js', 'sandbox-probe.js', 'content-pack.js', 'npm-update.js']) {
    const code = fs.readFileSync(path.join(PROJECT, 'scripts', file), 'utf8');
    const specs = [...code.matchAll(/(?:^|\s)import\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*(?:new URL\(\s*)?['"]([^'"]+)['"]/gm)].map((m) => m[1] || m[2]);
    assert.ok(specs.length, file);
    for (const s of specs) assert.ok(s.startsWith('node:') || allowed.has(s), `${file} imports ${s}`);
  }
});

test(T('security', 'Requests from inside the isolation: only listed actions, links are not followed', 'Заявки отвътре на изолацията: само изброени действия, връзките не се следват'), async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-ipc-test-'));
  const stop = ipc.serveRequests(dir, { echo: async (d) => ({ ok: true, got: d.x }) });
  const victim = path.join(os.tmpdir(), `ipc-victim-${process.pid}-${Date.now()}.txt`);
  try {
    assert.deepEqual(await ipc.askOutside('echo', { x: 1 }, { dir, timeoutMs: 5000 }), { ok: true, got: 1 });
    assert.equal((await ipc.askOutside('run-shell', { cmd: 'id' }, { dir, timeoutMs: 5000 }))?.ok, false, 'unknown action');
    assert.equal(await ipc.askOutside('echo', {}, { dir: undefined }), null, 'no launcher: no answer');
    const big = 'a'.repeat(16);
    fs.writeFileSync(path.join(dir, `req-${big}.json`), JSON.stringify({ kind: 'echo', data: { x: 'y'.repeat(5000) } }));
    await waitFor(() => fs.existsSync(path.join(dir, `res-${big}.json`)), 5000);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, `res-${big}.json`), 'utf8')).ok, false, 'an oversized request is refused');
    if (!IS_WIN) {
      // Клетката оставя връзка на мястото на отговора: стартерът не бива да пише през нея
      fs.writeFileSync(victim, 'keep');
      const id = 'b'.repeat(16);
      fs.symlinkSync(victim, path.join(dir, `res-${id}.json.tmp`));
      fs.writeFileSync(path.join(dir, `req-${id}.json`), JSON.stringify({ kind: 'echo', data: { x: 2 } }));
      await waitFor(() => fs.existsSync(path.join(dir, `res-${id}.json`)), 5000);
      assert.equal(fs.readFileSync(victim, 'utf8'), 'keep', 'the reply was written through a link');
      // Заявка, която е връзка към друг файл, не се чете
      const id2 = 'c'.repeat(16), other = victim + '.json';
      fs.writeFileSync(other, JSON.stringify({ kind: 'echo', data: { x: 3 } }));
      fs.symlinkSync(other, path.join(dir, `req-${id2}.json`));
      await waitFor(() => fs.existsSync(path.join(dir, `res-${id2}.json`)), 5000);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, `res-${id2}.json`), 'utf8')).ok, false);
      fs.rmSync(other, { force: true });
    }
  } finally { stop(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(victim, { force: true }); }
});

test(T('security', 'Outside the isolation only real language packs and only protected files are installed', 'Отвън на изолацията се инсталират само истински езикови пакети и само защитените файлове'), async () => {
  const box = makeSandbox();
  try {
    const { outsideHandlers } = await import(pathToFileURL(path.join(box.root, 'scripts', 'sandbox.js')).href);
    const change = outsideHandlers(box.root)['content-lang'];
    for (const code of ['xx', '../..', '', 42, null]) assert.equal((await change({ code })).ok, false, String(code));
    const templateBefore = box.read('wiki/_templates/source.md'), configBefore = box.read('library.config.json');
    const r = await change({ code: 'en' });
    assert.equal(r.ok, true);
    assert.equal(box.read('CLAUDE.md'), box.read('content/en/CLAUDE.md'), 'CLAUDE.md is installed outside');
    assert.equal(box.read('wiki/_templates/source.md'), templateBefore, 'what the server can write itself is left to it');
    assert.equal(box.read('library.config.json'), configBefore, 'the settings are left to the server');
  } finally { box.remove(); }
});

/** Монтиранията от аргументите на bubblewrap: [{ kind, src, dst }] */
function mountsOf(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (/^--(ro-)?bind(-try)?$/.test(args[i])) { out.push({ kind: args[i], src: args[i + 1], dst: args[i + 2] }); i += 2; }
  }
  return out;
}

test(T('security', 'The isolation mounts only the project, read-only code and the Claude sign-in', 'Изолацията монтира само проекта, кода само за четене и входа в Claude'), () => {
  const home = '/home/u', root = '/home/u/projects/lib', node = '/home/u/.nvm/versions/node/v26.0.0';
  const env = sandbox.sandboxEnv({
    home, user: 'u', nodeDir: node, claudeBin: '/home/u/.local/share/claude/versions/2',
    from: { PATH: '/x', PORT: '4321', LANG: 'bg_BG.UTF-8', WSL_INTEROP: '/run/WSL/1_interop', WSL_DISTRO_NAME: 'Ubuntu', SSH_AUTH_SOCK: '/tmp/a', GITHUB_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 's', DISPLAY: ':0' },
  });
  for (const k of ['WSL_INTEROP', 'WSL_DISTRO_NAME', 'SSH_AUTH_SOCK', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'DISPLAY']) assert.ok(!(k in env), k);
  assert.equal(env.PORT, '4321');
  assert.equal(env.HOME, home);
  assert.ok(!env.PATH.split(':').includes('/x'), 'the outside PATH is not used');

  const claude = { bin: '/home/u/.local/share/claude/versions/2', mount: '/home/u/.local/share/claude/versions/2' };
  const args = sandbox.bwrapArgs({
    root, home, nodeDir: node, claude, state: '/home/u/.local/state/llm-wiki-sandbox/abc',
    systemLinks: { '/bin': 'usr/bin', '/lib': 'usr/lib' }, systemDirs: [], etcTargets: ['/mnt/wsl/resolv.conf'],
    writable: sandbox.WRITABLE_DIRS.concat(sandbox.WRITABLE_FILES).map((d) => [path.posix.join(root, d), path.posix.join(root, d)]),
    credentials: `${home}/.claude/.credentials.json`, settings: `${home}/.claude/settings.json`, env,
  });
  for (const f of ['--unshare-all', '--share-net', '--die-with-parent', '--new-session', '--clearenv']) assert.ok(args.includes(f), f);
  const m = mountsOf(args);
  const has = (kind, dst) => m.some((x) => x.kind === kind && x.dst === dst);

  // Проектът е само за четене; запис има само в данните и в личното състояние на Claude Code
  assert.ok(has('--ro-bind', root), 'the project is read-only');
  const data = new Set(sandbox.WRITABLE_DIRS.concat(sandbox.WRITABLE_FILES).map((d) => path.posix.join(root, d)));
  for (const x of m.filter((y) => y.kind === '--bind')) assert.ok(data.has(x.dst) || x.dst === `${home}/.claude` || x.dst.startsWith(`${home}/.claude/`) || x.dst === `${home}/.claude.json`, `writable: ${x.dst}`);
  for (const code of ['scripts', 'node_modules', '.claude', 'CLAUDE.md', 'package.json', '.git', '.wiki-launch', '.npmrc']) assert.ok(!data.has(path.posix.join(root, code)), `code is writable: ${code}`);
  assert.ok(has('--ro-bind-try', `${root}/.library-git/config`) && has('--ro-bind-try', `${root}/.library-git/hooks`), 'git settings and hooks of the restore history are locked');

  // Home е празна; нищо лично и нищо от Windows не се монтира
  const emptyHome = args.findIndex((a, i) => a === '--tmpfs' && args[i + 1] === home);
  assert.ok(emptyHome >= 0, 'home is an empty folder');
  assert.ok(emptyHome < args.indexOf(root), 'the empty home comes before the project (otherwise it would hide it)');
  for (const x of m) {
    assert.ok(x.src !== home && x.src !== `${home}/.claude` && !x.src.startsWith(`${home}/.ssh`), `personal folder: ${x.src}`);
    assert.ok(x.src === '/mnt/wsl/resolv.conf' || !x.src.startsWith('/mnt'), `Windows or other drive: ${x.src}`);
    assert.ok(!x.src.startsWith('/run'), `WSL sockets: ${x.src}`);
  }
  assert.ok(args.join(' ').includes('--tmpfs /run'), '/run (WSL interop sockets) is hidden');
  // Claude Code: общ е само файлът за вход; настройките (могат да съдържат куки) са само за четене
  assert.ok(has('--bind', `${home}/.claude/.credentials.json`));
  assert.ok(has('--ro-bind', `${home}/.claude/settings.json`));
  assert.ok(has('--ro-bind', node) && has('--ro-bind', claude.mount), 'Node and Claude Code are read-only');
});

const bwrap = process.platform === 'linux' ? sandbox.findBwrap() : null;
test(T('security', 'Inside the isolation the program sees only the project folder (real check)', 'В изолацията програмата вижда само папката на проекта (истинска проверка)'), {
  skip: bwrap ? false : 'bubblewrap is not installed or this is not Linux/WSL (sudo apt install bubblewrap). :: bubblewrap не е инсталиран или това не е Linux/WSL (sudo apt install bubblewrap).',
}, () => {
  const box = makeSandbox();
  try {
    const r = spawnSync(process.execPath, [path.join(box.root, 'scripts', 'sandbox.js'), '--check', '--json'], { cwd: box.root, env: box.env, encoding: 'utf8', timeout: 180000 });
    const j = JSON.parse(r.stdout || '{}');
    assert.ok(j.results, `the isolation did not start: ${j.stderr || r.stderr}`);
    for (const x of j.results.filter((y) => y.kind === 'security')) assert.ok(x.ok, `${x.id}: ${x.detail}`);
    assert.ok(j.results.find((x) => x.id === 'data-writable')?.ok, 'the library data can be written');
  } finally { box.remove(); }
});

test(T('security', 'Inside the isolation the language menu still changes the content language', 'В изолацията менюто за език пак сменя езика на съдържанието'), {
  skip: bwrap ? false : 'bubblewrap is not installed or this is not Linux/WSL (sudo apt install bubblewrap). :: bubblewrap не е инсталиран или това не е Linux/WSL (sudo apt install bubblewrap).',
}, async () => {
  const box = makeSandbox();
  box.write('library.config.json', JSON.stringify({ contentLang: 'bg', confirmCost: true, autoIngest: false, setupDone: true }));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(box.root, 'scripts', 'sandbox.js')], { cwd: box.root, env: { ...box.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  try {
    await waitFor(async () => { try { return (await rawRequest(port, { url: '/api/stats' })).status === 200; } catch { return false; } }, 30000).catch(() => { throw new Error(`the server did not start in the isolation: ${log.slice(-800)}`); });
    await waitFor(() => /Isolation: on/.test(log), 5000).catch(() => assert.fail(`the server does not say it runs in the isolation: ${log.slice(-400)}`));
    const r = await api(port, 'POST', '/api/lang', { code: 'en' });
    assert.equal(r.json?.ok, true, JSON.stringify(r.json));
    assert.equal(r.json.content, 'en');
    assert.equal(box.read('CLAUDE.md'), box.read('content/en/CLAUDE.md'), 'CLAUDE.md (installed by the launcher outside)');
    assert.equal(box.read('wiki/_templates/source.md'), box.read('content/en/templates/source.md'), 'templates (installed by the server inside)');
    assert.equal(JSON.parse(box.read('library.config.json')).contentLang, 'en');
  } finally {
    if (child.exitCode === null && child.signalCode === null) await new Promise((r) => { child.once('close', r); child.kill('SIGTERM'); });
    box.remove();
  }
});
