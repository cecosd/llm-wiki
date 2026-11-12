// Изолация („клетка“) в Linux и WSL: пуска сървъра на библиотеката в bubblewrap, така че Node, всички пакети от
// node_modules и Claude Code виждат само папката на проекта. Пази от пробит пакет, който иначе би чел всичко
// с твоите права (~/.ssh, входа в Claude, другите проекти, през /mnt/c и файловете в Windows).
//
//   npm run serve:safe                      сървърът в клетката (без bubblewrap отказва да тръгне)
//   npm run sandbox:check                   какво се вижда отвътре (не се праща нищо към Claude)
//   node scripts/sandbox.js -- <команда>    друга команда в клетката, напр.: node scripts/sandbox.js -- npm run extract
//
// Вижда се:        проектът; кодът (scripts/, node_modules/, .claude/, CLAUDE.md, package.json...) само за четене,
//                  а запис има само в данните (WRITABLE по-долу); системните програми и /etc само за четене;
//                  Node и Claude Code само за четене; файлът за вход в Claude; лично копие на състоянието на Claude Code.
// Не се вижда:     останалата home папка (~/.ssh, другите проекти, ~/.claude.json, историята на другите разговори
//                  с Claude), /mnt/c и другите дискове на Windows, сокетите на WSL, през които се пускат Windows
//                  програми, променливите на средата.
// Остава отворено: мрежата. Нужна е на Claude и на „Добави статия“.
//
// Защо кодът е само за четене: иначе пробит пакет би подменил файл, който после се изпълнява ИЗВЪН клетката
// (scripts/, .wiki-launch, .claude/, .git/hooks, .npmrc, node_modules/).
// Защо не `node --permission`: по документацията на Node не пази от злонамерен код, а и приложението трябва да пуска
// claude и git, които излизат извън него.
//
// Файлът ползва САМО вградените модули на Node: така нито един пакет не се изпълнява извън клетката.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serveRequests } from './sandbox-ipc.js';
import { updatePackages, restoreLock, RESTART_CODE } from './npm-update.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Където сървърът в клетката вижда общата папка за заявки към стартера (sandbox-ipc.js) */
const IPC_INSIDE = '/run/llm-wiki';

/** Само тук може да се пише отвътре (данните на библиотеката). Всичко друго в проекта е само за четене. */
export const WRITABLE_DIRS = ['raw', 'wiki', 'drafts', 'outputs', '.library-git', '.ocr-data'];
export const WRITABLE_FILES = ['library.config.json', '.library-auth.json', '.library-secrets.json'];
/** В .library-git настройките и куките остават само за четене: git ги изпълнява. */
const LOCKED = ['.library-git/config', '.library-git/hooks'];
/** Променливите, които минават в клетката. Всичко друго се маха: ключове, SSH агент, сокетите на WSL (WSL_INTEROP). */
export const PASS_ENV = ['PORT', 'WIKI_HOST', 'LIB_LAUNCHER', 'LIB_MODE', 'LIB_ISOLATION', 'LIB_LANG', 'LANG', 'LC_ALL', 'LC_MESSAGES', 'TERM', 'NO_COLOR', 'FORCE_COLOR',
  'LIBRARY_MAILTO', 'LIBRARY_OCR', 'LIBRARY_RETRY_MS', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN',
  // ключовете на другите доставчици (providers.js), ако са зададени в средата вместо в .library-secrets.json
  'LIB_AI_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY'];
const SYSTEM_DIRS = ['/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32'];

// ---------- Преводи без i18n.js (той зарежда пакети, а тук не бива) ----------
const CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
let MSG = null;
function messages() {
  const env = process.env.LIB_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  const base = env.split(/[._@]/)[0].replace('_', '-');
  for (const code of [base, base.split('-')[0].toLowerCase()]) {
    if (!CODE_RE.test(code)) continue;
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${code}.json`), 'utf8')).messages || {}; } catch { /* няма такъв език */ }
  }
  return {};
}
const $t = (key, args) => { MSG ??= messages(); return String(MSG[key] ?? key).replace(/\{(\d+)\}/g, (m, i) => (args?.[i] ?? m)); };

// ---------- Откриване ----------
const under = (p, dir) => { const r = path.relative(dir, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

function which(name, extra = []) {
  for (const dir of [...String(process.env.PATH || '').split(':'), ...extra]) {
    if (!dir) continue;
    const f = path.join(dir, name);
    try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch { /* нататък */ }
  }
  return null;
}
export const findBwrap = () => which('bwrap');

/** Истинският файл на claude (след връзките); при инсталация през npm се монтира папката на пакета. */
function findClaude(home) {
  const bin = process.env.CLAUDE_BIN || which('claude', [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local')]);
  if (!bin) return null;
  try {
    const real = fs.realpathSync(bin);
    return { bin: real, mount: /\.[cm]?js$/.test(real) ? path.dirname(real) : real };
  } catch { return null; }
}

/** Системни връзки в /etc, които сочат извън /etc и /usr (в WSL /etc/resolv.conf сочи към /mnt/wsl/resolv.conf). */
function etcTargets() {
  const out = [];
  for (const f of ['/etc/resolv.conf', '/etc/hosts']) {
    try {
      if (!fs.lstatSync(f).isSymbolicLink()) continue;
      const real = fs.realpathSync(f);
      if (!under(real, '/etc') && !under(real, '/usr')) out.push(real);
    } catch { /* няма го */ }
  }
  return out;
}

/** Личното състояние на Claude Code в клетката: извън проекта и отделно за всеки проект. */
export const stateDirOf = (root, home) => path.join(home, '.local', 'state', 'llm-wiki-sandbox', crypto.createHash('sha256').update(root).digest('hex').slice(0, 12));

/** Папките и файловете за запис трябва да съществуват, за да се монтират. Нищо не се презаписва. */
function prepareProject(root) {
  for (const d of WRITABLE_DIRS) fs.mkdirSync(path.join(root, d), { recursive: true });
  const touch = (f, text) => { if (!fs.existsSync(f)) fs.writeFileSync(f, text, { mode: 0o600 }); };
  touch(path.join(root, 'library.config.json'), '{}\n');
  touch(path.join(root, '.library-auth.json'), ''); // празен файл = без парола (auth.js)
  touch(path.join(root, '.library-secrets.json'), ''); // празен файл = без ключове (providers.js)
}

/** Отделно ~/.claude и ~/.claude.json за клетката. Вторият е само с данните за акаунта, не с другите ти проекти. */
function prepareState(state, home) {
  fs.mkdirSync(path.join(state, 'claude'), { recursive: true, mode: 0o700 });
  const cfg = path.join(state, 'claude.json');
  if (fs.existsSync(cfg)) return;
  let real = {};
  try { real = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')); } catch { /* още не е влизано */ }
  const keep = {};
  for (const k of ['userID', 'oauthAccount', 'hasCompletedOnboarding', 'lastOnboardingVersion', 'firstStartTime']) if (k in real) keep[k] = real[k];
  fs.writeFileSync(cfg, JSON.stringify({ ...keep, autoUpdates: false }, null, 2) + '\n', { mode: 0o600 });
}

/** [източник, цел] за запис. Ако папка с данни е връзка към друго място, монтира се истинската ѝ цел. */
function writableMounts(root) {
  const out = [];
  const add = (p) => {
    if (!fs.existsSync(p)) return;
    const real = fs.realpathSync(p);
    out.push([real, real === p ? p : real]);
  };
  for (const d of WRITABLE_DIRS) add(path.join(root, d));
  for (const f of WRITABLE_FILES) add(path.join(root, f));
  // raw/books и т.н. може да са връзки към друг диск: целите им също трябва да се виждат
  try {
    for (const e of fs.readdirSync(path.join(root, 'raw'), { withFileTypes: true })) {
      const p = path.join(root, 'raw', e.name);
      if (e.isSymbolicLink()) { const real = fs.realpathSync(p); if (!under(real, root)) out.push([real, real]); }
    }
  } catch { /* няма raw/ */ }
  return out;
}

/** Код извън проекта, към който той сочи (node_modules като връзка, напр. в тестовете): само за четене. */
function readonlyLinks(root) {
  const p = path.join(root, 'node_modules');
  try {
    if (!fs.lstatSync(p).isSymbolicLink()) return [];
    const real = fs.realpathSync(p);
    return under(real, root) ? [] : [real];
  } catch { return []; }
}

/**
 * Действията, които стартерът изпълнява отвън по молба на сървъра. Нищо от заявката не се приема наготово.
 * Смяна на езика на съдържанието: само съществуващ пакет от content/ (отвътре е само за четене) и само файловете,
 * които клетката не може да пише (CLAUDE.md, .claude/, scripts/starter/). Останалото прави сървърът вътре.
 * Обновяване на пакетите: само преки зависимости от package.json и само версиите, които той позволява (npm-update.js).
 * Предишният package-lock.json остава в state.backup, в паметта на стартера: в outputs/ клетката би могла да го подмени
 * с файл, който сочи към чужди пакети, а стартерът после би го инсталирал отвън.
 */
export function outsideHandlers(root = ROOT, state = {}, opts = {}) { // opts.npm: само за тестовете (фалшив npm)
  const insideWritable = (to) => [...WRITABLE_DIRS, ...WRITABLE_FILES].some((d) => under(to, path.join(root, d)));
  return {
    'content-lang': async ({ code }) => {
      const { installPack, packs } = await import(new URL('./content-pack.js', import.meta.url).href);
      if (typeof code !== 'string' || !packs().includes(code)) return { ok: false, error: 'unknown pack' };
      return installPack(code, { only: (to) => !insideWritable(to), config: false });
    },
    'npm-update': async ({ names }) => {
      const r = await updatePackages(root, names, opts.npm ? { npm: opts.npm } : {});
      const { backup, ...reply } = r;
      if (r.ok && r.lockChanged) state.backup = backup;
      return reply;
    },
  };
}

/** Променливите в клетката: само изброените, плюс пътищата, които знаем, че са нужни. */
export function sandboxEnv({ home, user, nodeDir, claudeBin, from = process.env, extra = {} }) {
  const env = {
    HOME: home, USER: user, LOGNAME: user, TMPDIR: '/tmp', LIB_SANDBOX: '1', DISABLE_AUTOUPDATER: '1',
    PATH: [nodeDir && !under(nodeDir, '/usr') ? path.join(nodeDir, 'bin') : null, '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin'].filter(Boolean).join(':'),
  };
  if (claudeBin) env.CLAUDE_BIN = claudeBin;
  for (const k of PASS_ENV) if (from[k]) env[k] = from[k];
  return { ...env, ...extra };
}

/** Аргументите на bubblewrap. Чиста функция: по нея се пишат тестовете. Редът има значение (по-късното покрива). */
export function bwrapArgs(o) {
  const a = ['--unshare-all', '--share-net', '--die-with-parent', '--new-session', '--clearenv'];
  // Системата: само за четене
  a.push('--ro-bind', '/usr', '/usr');
  for (const d of SYSTEM_DIRS) {
    const link = o.systemLinks?.[d];
    if (link) a.push('--symlink', link, d);
    else if (o.systemDirs?.includes(d)) a.push('--ro-bind', d, d);
  }
  a.push('--ro-bind', '/etc', '/etc');
  for (const f of o.etcTargets || []) a.push('--ro-bind-try', f, f);
  a.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run', '--dir', '/var', '--tmpfs', '/var/tmp');
  // Празна home папка; в нея се монтира само нужното. Обикновено проектът е в home и идва след нея; ако home е
  // вътре в проекта (така е в тестовете), тя идва след проекта, иначе проектът би я покрил.
  const homeFirst = !under(o.home, o.root);
  const mountHome = () => {
    a.push('--tmpfs', o.home);
    if (o.nodeDir && !under(o.nodeDir, '/usr')) a.push('--ro-bind', o.nodeDir, o.nodeDir);
    if (o.claude && !(o.nodeDir && under(o.claude.mount, o.nodeDir))) a.push('--ro-bind', o.claude.mount, o.claude.mount);
    for (const p of o.readonly || []) a.push('--ro-bind', p, p);
  };
  if (homeFirst) mountHome();
  // Проектът: кодът само за четене, данните за запис
  a.push('--ro-bind', o.root, o.root);
  for (const [src, dst] of o.writable || []) a.push('--bind', src, dst);
  for (const rel of LOCKED) a.push('--ro-bind-try', path.join(o.root, rel), path.join(o.root, rel));
  if (!homeFirst) mountHome();
  // Claude Code: лично състояние; общ е само файлът за вход, а настройките (може да имат куки) са само за четене
  a.push('--bind', path.join(o.state, 'claude'), path.join(o.home, '.claude'));
  a.push('--bind', path.join(o.state, 'claude.json'), path.join(o.home, '.claude.json'));
  if (o.credentials) a.push('--bind', o.credentials, path.join(o.home, '.claude', '.credentials.json'));
  if (o.settings) a.push('--ro-bind', o.settings, path.join(o.home, '.claude', 'settings.json'));
  for (const [k, v] of Object.entries(o.env || {})) a.push('--setenv', k, String(v));
  for (const m of o.extra || []) a.push(...m);
  a.push('--chdir', o.root);
  return a;
}

/** Всичко за пускане от този компютър: открива пътищата и подготвя папките. */
export function plan({ root = ROOT, extraEnv = {}, extra = [] } = {}) {
  const home = os.homedir();
  const user = os.userInfo().username;
  const nodeDir = path.resolve(path.dirname(process.execPath), '..');
  const claude = findClaude(home);
  const state = stateDirOf(root, home);
  prepareProject(root);
  prepareState(state, home);
  const systemLinks = {}, systemDirs = [];
  for (const d of SYSTEM_DIRS) {
    try { const st = fs.lstatSync(d); if (st.isSymbolicLink()) systemLinks[d] = fs.readlinkSync(d); else systemDirs.push(d); } catch { /* няма я */ }
  }
  const file = (p) => (fs.existsSync(p) ? p : null);
  return {
    root, home, state, claude,
    args: bwrapArgs({
      root, home, nodeDir, claude, state, systemLinks, systemDirs, etcTargets: etcTargets(), writable: writableMounts(root), readonly: readonlyLinks(root),
      credentials: file(path.join(home, '.claude', '.credentials.json')), settings: file(path.join(home, '.claude', 'settings.json')),
      env: sandboxEnv({ home, user, nodeDir, claudeBin: claude?.bin, extra: extraEnv }), extra,
    }),
  };
}

// ---------- Проверка отвътре (npm run sandbox:check) ----------
const LABELS = {
  secrets: () => $t('Your personal files outside the project are hidden (~/.ssh, ~/.claude.json, other Claude conversations)'),
  siblings: () => $t('Your other projects next to this one are hidden'),
  'windows-drives': () => $t('The Windows drives (/mnt/c) are hidden'),
  env: () => $t('Environment variables (keys, WSL sockets) are removed'),
  'code-readonly': () => $t('The code (scripts/, node_modules/, .claude/) cannot be changed'),
  'claude-settings': () => $t('Your Claude Code settings cannot be changed'),
  'windows-exe': () => $t('Windows programs cannot be started'),
  'data-writable': () => $t('The library data (raw/, wiki/, outputs/) can be written'),
  claude: () => $t('Claude Code starts'),
  'claude-auth': () => $t('Claude Code is signed in'),
  network: () => $t('The network works ({ai} and “Add an article” need it)'),
};

/** Файловете, които не бива да се виждат отвътре. Сравнява се по inode, защото личното копие вътре е друг файл. */
function secretsOf(home) {
  const list = ['.ssh', '.gnupg', '.aws', '.config', '.bashrc', '.bash_history', '.gitconfig', '.npmrc', '.claude.json',
    '.claude/history.jsonl', '.claude/projects', '.claude/file-history', '.claude/shell-snapshots', '.claude/backups'].map((r) => path.join(home, r));
  return [...list, '/mnt/c', '/run/WSL'].flatMap((p) => { try { const s = fs.statSync(p); return [{ path: p, dev: s.dev, ino: s.ino }]; } catch { return []; } });
}

/** Малка Windows програма, копирана временно: ако тръгне отвътре, клетката не спира WSL interop. */
function windowsProbe() {
  const exe = '/mnt/c/Windows/System32/whoami.exe';
  if (!fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') || !fs.existsSync(exe)) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-probe-'));
  const copy = path.join(dir, 'probe.exe');
  fs.copyFileSync(exe, copy);
  fs.chmodSync(copy, 0o755);
  return { dir, copy, inside: '/run/llm-wiki-probe.exe' }; // в /run, не до проекта (иначе изглежда като съседен файл)
}

export function runCheck({ bwrap, root = ROOT, json = false } = {}) {
  const home = os.homedir();
  const win = windowsProbe();
  const probe = {
    root, secrets: secretsOf(home), exe: win?.inside || null,
    settings: fs.existsSync(path.join(home, '.claude', 'settings.json')) ? path.join(home, '.claude', 'settings.json') : null,
  };
  probe.allowedEnv = [...Object.keys(sandboxEnv({ home, user: 'x', nodeDir: '/x', claudeBin: '/x', from: process.env })), 'LIB_SANDBOX_PROBE', 'PWD', 'SHLVL', '_'];
  const p = plan({ root, extraEnv: { LIB_SANDBOX_PROBE: JSON.stringify(probe) }, extra: win ? [['--ro-bind', win.copy, win.inside]] : [] });
  const r = spawnSync(bwrap, [...p.args, '--', process.execPath, path.join(root, 'scripts', 'sandbox-probe.js')], { encoding: 'utf8', timeout: 120000 });
  if (win) fs.rmSync(win.dir, { recursive: true, force: true });
  let results = null;
  try { results = JSON.parse(r.stdout); } catch { /* клетката не тръгна */ }
  if (json) { process.stdout.write(JSON.stringify({ ok: !!results, status: r.status, stderr: String(r.stderr || '').slice(-2000), results })); return results ? 0 : 1; }
  if (!results) { console.error($t('The isolation could not start:') + '\n' + String(r.stderr || r.error?.message || '').trim()); return 1; }
  let bad = 0, weak = 0;
  console.log('\n' + $t('Isolation check (what the program sees from inside):'));
  for (const x of results) {
    const label = LABELS[x.id] ? LABELS[x.id]() : x.id;
    console.log(`  ${x.ok ? '✔' : x.kind === 'security' ? '✖' : '!'} ${label}${!x.ok && x.detail ? `: ${x.detail}` : ''}`);
    if (!x.ok) x.kind === 'security' ? bad++ : weak++;
  }
  console.log('\n' + (bad ? $t('✖ The isolation is NOT safe. Do not use it until this is fixed.') : weak ? $t('The isolation is safe, but something the library needs does not work inside it (see “!” above).') : $t('✔ The isolation works.')));
  return bad ? 1 : 0;
}

// ---------- Пускане ----------
function main(argv) {
  if (process.platform !== 'linux') { console.error($t('Isolation works only on Linux and in WSL. On this system start with: npm run serve')); return Promise.resolve(1); }
  const bwrap = findBwrap();
  if (!bwrap) { console.error($t('bubblewrap is not installed, so the library cannot be isolated. Install it once with:\n  sudo apt install bubblewrap\nand start again.')); return Promise.resolve(1); }
  if (argv.includes('--check')) return Promise.resolve(runCheck({ bwrap, json: argv.includes('--json') }));
  const sep = argv.indexOf('--');
  const cmd = sep >= 0 ? argv.slice(sep + 1) : [process.execPath, path.join(ROOT, 'scripts', 'server.js')];
  if (!cmd.length) { console.error('node scripts/sandbox.js [--check] [-- <command>]'); return Promise.resolve(1); }
  // Обща папка за заявки към стартера (само за този потребител, 0700); вътре се вижда като /run/llm-wiki
  const ipc = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-ipc-'));
  const p = plan({ extraEnv: { LIB_SANDBOX_IPC: IPC_INSIDE }, extra: [['--bind', ipc, IPC_INSIDE]] });
  if (!p.claude) console.warn($t('Claude Code was not found: the library will open, but processing will not work.'));
  const state = { backup: null };
  const stopIpc = serveRequests(ipc, outsideHandlers(ROOT, state));
  let child = null, startedAt = 0, afterUpdate = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { child?.kill(sig); } catch { /* вече е спрял */ } });
  return new Promise((resolve) => {
    const done = (code) => { stopIpc(); fs.rmSync(ipc, { recursive: true, force: true }); resolve(code); };
    const start = () => {
      startedAt = Date.now();
      child = spawn(bwrap, [...p.args, '--', ...cmd], { stdio: 'inherit' });
      child.on('error', (e) => { console.error(e.message); done(1); });
      child.on('exit', async (code, sig) => {
        // Сървърът поиска рестарт (след обновени пакети): пуска се отново със същата клетка
        if (code === RESTART_CODE) { console.log('\n  ' + $t('Restarting the library with the updated packages…')); afterUpdate = !!state.backup; return start(); }
        // Новите версии не тръгват: връщат се предишните и библиотеката се пуска отново
        if (code && afterUpdate && state.backup && Date.now() - startedAt < 30000) {
          console.error('\n  ' + $t('The library did not start after the update. Restoring the previous versions of the packages…'));
          const r = await restoreLock(ROOT, state.backup);
          state.backup = null; afterUpdate = false;
          if (r.ok) return start();
          console.error('  ' + $t('The previous versions could not be restored: {0}', [r.error || '']));
        }
        done(code ?? (sig ? 1 : 0));
      });
    };
    start();
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
