// Isolation (a "cage") on Linux and WSL: runs the library server in bubblewrap, so that Node, all packages from
// node_modules and Claude Code see only the project folder. It protects against a compromised package, which would otherwise read everything
// with your rights (~/.ssh, the Claude sign-in, the other projects, through /mnt/c and the files in Windows).
//
//   npm run serve:safe                      the server in the cage (without bubblewrap it refuses to start)
//   npm run sandbox:check                   what is visible from inside (nothing is sent to Claude)
//   node scripts/sandbox.js -- <command>    another command in the cage, for example: node scripts/sandbox.js -- npm run extract
//
// Visible:        the project; the code (scripts/, node_modules/, .claude/, CLAUDE.md, package.json...) read-only,
//                  and writing only in the data (WRITABLE below); the system programs and /etc read-only;
//                  Node and Claude Code read-only; the Claude sign-in file; a private copy of the Claude Code state.
// Not visible:    the rest of the home folder (~/.ssh, the other projects, ~/.claude.json, the history of the other conversations
//                  with Claude), /mnt/c and the other Windows disks, the WSL sockets through which Windows
//                  programs are run, the environment variables.
// Left open:      the network. Claude and "Add an article" need it.
//
// Why the code is read-only: otherwise a compromised package would replace a file that is later run OUTSIDE the cage
// (scripts/, .wiki-launch, .claude/, .git/hooks, .npmrc, node_modules/).
// Why not `node --permission`: according to the Node documentation it does not protect from malicious code, and the application must run
// claude and git, which go outside of it.
//
// This file uses ONLY the built-in Node modules: this way no package is run outside the cage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serveRequests } from './sandbox-ipc.js';
import { updatePackages, restoreLock, RESTART_CODE } from './npm-update.js';
import { updateCode } from './code-update.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Where the server in the cage sees the shared folder for requests to the launcher (sandbox-ipc.js) */
const IPC_INSIDE = '/run/llm-wiki';

/** Only here can be written from inside (the data of the library). Everything else in the project is read-only. */
export const WRITABLE_DIRS = ['raw', 'wiki', 'drafts', 'outputs', '.library-git', '.ocr-data'];
export const WRITABLE_FILES = ['library.config.json', '.library-auth.json', '.library-secrets.json'];
/** In .library-git the settings and hooks stay read-only: git runs them. */
const LOCKED = ['.library-git/config', '.library-git/hooks'];
/** The variables that pass into the cage. Everything else is dropped: keys, the SSH agent, the WSL sockets (WSL_INTEROP). */
export const PASS_ENV = ['PORT', 'WIKI_HOST', 'LIB_LAUNCHER', 'LIB_MODE', 'LIB_ISOLATION', 'LIB_LANG', 'LANG', 'LC_ALL', 'LC_MESSAGES', 'TERM', 'NO_COLOR', 'FORCE_COLOR',
  'LIBRARY_MAILTO', 'LIBRARY_OCR', 'LIBRARY_RETRY_MS', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN',
  // the keys of the other providers (providers.js), if set in the environment instead of in .library-secrets.json
  'LIB_AI_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY'];
const SYSTEM_DIRS = ['/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32'];

// ---------- Translations without i18n.js (it loads packages, and here it must not) ----------
const CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
let MSG = null;
function messages() {
  const env = process.env.LIB_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  const base = env.split(/[._@]/)[0].replace('_', '-');
  for (const code of [base, base.split('-')[0].toLowerCase()]) {
    if (!CODE_RE.test(code)) continue;
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${code}.json`), 'utf8')).messages || {}; } catch { /* there is no such language */ }
  }
  return {};
}
const $t = (key, args) => { MSG ??= messages(); return String(MSG[key] ?? key).replace(/\{(\d+)\}/g, (m, i) => (args?.[i] ?? m)); };

// ---------- Discovery ----------
const under = (p, dir) => { const r = path.relative(dir, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

function which(name, extra = []) {
  for (const dir of [...String(process.env.PATH || '').split(':'), ...extra]) {
    if (!dir) continue;
    const f = path.join(dir, name);
    try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch { /* further on */ }
  }
  return null;
}
export const findBwrap = () => which('bwrap');

/** The real file of claude (after the links); with an npm installation the folder of the package is mounted. */
function findClaude(home) {
  const bin = process.env.CLAUDE_BIN || which('claude', [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local')]);
  if (!bin) return null;
  try {
    const real = fs.realpathSync(bin);
    return { bin: real, mount: /\.[cm]?js$/.test(real) ? path.dirname(real) : real };
  } catch { return null; }
}

/** System links in /etc that point outside /etc and /usr (in WSL /etc/resolv.conf points to /mnt/wsl/resolv.conf). */
function etcTargets() {
  const out = [];
  for (const f of ['/etc/resolv.conf', '/etc/hosts']) {
    try {
      if (!fs.lstatSync(f).isSymbolicLink()) continue;
      const real = fs.realpathSync(f);
      if (!under(real, '/etc') && !under(real, '/usr')) out.push(real);
    } catch { /* it is not there */ }
  }
  return out;
}

/** The private state of Claude Code in the cage: outside the project and separate for each project. */
export const stateDirOf = (root, home) => path.join(home, '.local', 'state', 'llm-wiki-sandbox', crypto.createHash('sha256').update(root).digest('hex').slice(0, 12));

/** The folders and files for writing must exist so that they can be mounted. Nothing is overwritten. */
function prepareProject(root) {
  for (const d of WRITABLE_DIRS) fs.mkdirSync(path.join(root, d), { recursive: true });
  const touch = (f, text) => { if (!fs.existsSync(f)) fs.writeFileSync(f, text, { mode: 0o600 }); };
  touch(path.join(root, 'library.config.json'), '{}\n');
  touch(path.join(root, '.library-auth.json'), ''); // an empty file = no password (auth.js)
  touch(path.join(root, '.library-secrets.json'), ''); // an empty file = no keys (providers.js)
}

/** A separate ~/.claude and ~/.claude.json for the cage. The second has only the account data, not your other projects. */
function prepareState(state, home) {
  fs.mkdirSync(path.join(state, 'claude'), { recursive: true, mode: 0o700 });
  const cfg = path.join(state, 'claude.json');
  if (fs.existsSync(cfg)) return;
  let real = {};
  try { real = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')); } catch { /* not signed in yet */ }
  const keep = {};
  for (const k of ['userID', 'oauthAccount', 'hasCompletedOnboarding', 'lastOnboardingVersion', 'firstStartTime']) if (k in real) keep[k] = real[k];
  fs.writeFileSync(cfg, JSON.stringify({ ...keep, autoUpdates: false }, null, 2) + '\n', { mode: 0o600 });
}

/** [source, target] for writing. If a data folder is a link to another place, its real target is mounted. */
function writableMounts(root) {
  const out = [];
  const add = (p) => {
    if (!fs.existsSync(p)) return;
    const real = fs.realpathSync(p);
    out.push([real, real === p ? p : real]);
  };
  for (const d of WRITABLE_DIRS) add(path.join(root, d));
  for (const f of WRITABLE_FILES) add(path.join(root, f));
  // raw/books and so on can be links to another disk: their targets must be visible too
  try {
    for (const e of fs.readdirSync(path.join(root, 'raw'), { withFileTypes: true })) {
      const p = path.join(root, 'raw', e.name);
      if (e.isSymbolicLink()) { const real = fs.realpathSync(p); if (!under(real, root)) out.push([real, real]); }
    }
  } catch { /* there is no raw/ */ }
  return out;
}

/** Code outside the project that it points to (node_modules as a link, for example in the tests): read-only. */
function readonlyLinks(root) {
  const p = path.join(root, 'node_modules');
  try {
    if (!fs.lstatSync(p).isSymbolicLink()) return [];
    const real = fs.realpathSync(p);
    return under(real, root) ? [] : [real];
  } catch { return []; }
}

/**
 * The actions that the launcher carries out outside at the request of the server. Nothing from the request is taken as given.
 * Changing the content language: only an existing pack from content/ (from inside it is read-only) and only the files
 * that the cage cannot write (CLAUDE.md, .claude/, scripts/starter/). The server does the rest inside.
 * Updating the packages: only direct dependencies of package.json and only the versions that it allows (npm-update.js).
 * The previous package-lock.json stays in state.backup, in the memory of the launcher: in outputs/ the cage could replace it
 * with a file that points to foreign packages, and the launcher would then install it outside.
 */
export function outsideHandlers(root = ROOT, state = {}, opts = {}) { // opts.npm: for the tests only (a fake npm)
  const insideWritable = (to) => [...WRITABLE_DIRS, ...WRITABLE_FILES].some((d) => under(to, path.join(root, d)));
  return {
    'content-lang': async ({ code }) => {
      const { installPack, packs } = await import(new URL('./content-pack.js', import.meta.url).href);
      if (typeof code !== 'string' || !packs().includes(code)) return { ok: false, error: 'unknown pack' };
      return installPack(code, { only: (to) => !insideWritable(to), config: false });
    },
    // A new version of the program: the code folder is read-only inside the cage, so the launcher updates it from outside.
    // Only two flags and an existing language pack are taken from the request; the repository is the one in package.json.
    'code-update': async ({ force, lang }) => {
      const { packs } = await import(new URL('./content-pack.js', import.meta.url).href);
      return updateCode(root, { force: force === true, lang: typeof lang === 'string' && packs().includes(lang) ? lang : null, ...(opts.code || {}) });
    },
    'npm-update': async ({ names }) => {
      const r = await updatePackages(root, names, opts.npm ? { npm: opts.npm } : {});
      const { backup, ...reply } = r;
      if (r.ok && r.lockChanged) state.backup = backup;
      return reply;
    },
  };
}

/** The variables in the cage: only the listed ones, plus the paths we know are needed. */
export function sandboxEnv({ home, user, nodeDir, claudeBin, from = process.env, extra = {} }) {
  const env = {
    HOME: home, USER: user, LOGNAME: user, TMPDIR: '/tmp', LIB_SANDBOX: '1', DISABLE_AUTOUPDATER: '1',
    PATH: [nodeDir && !under(nodeDir, '/usr') ? path.join(nodeDir, 'bin') : null, '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin'].filter(Boolean).join(':'),
  };
  if (claudeBin) env.CLAUDE_BIN = claudeBin;
  for (const k of PASS_ENV) if (from[k]) env[k] = from[k];
  return { ...env, ...extra };
}

/** The arguments of bubblewrap. A pure function: the tests are written against it. The order matters (the later one covers). */
export function bwrapArgs(o) {
  const a = ['--unshare-all', '--share-net', '--die-with-parent', '--new-session', '--clearenv'];
  // The system: read-only
  a.push('--ro-bind', '/usr', '/usr');
  for (const d of SYSTEM_DIRS) {
    const link = o.systemLinks?.[d];
    if (link) a.push('--symlink', link, d);
    else if (o.systemDirs?.includes(d)) a.push('--ro-bind', d, d);
  }
  a.push('--ro-bind', '/etc', '/etc');
  for (const f of o.etcTargets || []) a.push('--ro-bind-try', f, f);
  a.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run', '--dir', '/var', '--tmpfs', '/var/tmp');
  // An empty home folder; only what is needed is mounted into it. Usually the project is in home and comes after it; if home is
  // inside the project (as in the tests), it comes after the project, otherwise the project would cover it.
  const homeFirst = !under(o.home, o.root);
  const mountHome = () => {
    a.push('--tmpfs', o.home);
    if (o.nodeDir && !under(o.nodeDir, '/usr')) a.push('--ro-bind', o.nodeDir, o.nodeDir);
    if (o.claude && !(o.nodeDir && under(o.claude.mount, o.nodeDir))) a.push('--ro-bind', o.claude.mount, o.claude.mount);
    for (const p of o.readonly || []) a.push('--ro-bind', p, p);
  };
  if (homeFirst) mountHome();
  // The project: the code read-only, the data for writing
  a.push('--ro-bind', o.root, o.root);
  for (const [src, dst] of o.writable || []) a.push('--bind', src, dst);
  for (const rel of LOCKED) a.push('--ro-bind-try', path.join(o.root, rel), path.join(o.root, rel));
  if (!homeFirst) mountHome();
  // Claude Code: a private state; only the sign-in file is shared, and the settings (they may have hooks) are read-only
  a.push('--bind', path.join(o.state, 'claude'), path.join(o.home, '.claude'));
  a.push('--bind', path.join(o.state, 'claude.json'), path.join(o.home, '.claude.json'));
  if (o.credentials) a.push('--bind', o.credentials, path.join(o.home, '.claude', '.credentials.json'));
  if (o.settings) a.push('--ro-bind', o.settings, path.join(o.home, '.claude', 'settings.json'));
  for (const [k, v] of Object.entries(o.env || {})) a.push('--setenv', k, String(v));
  for (const m of o.extra || []) a.push(...m);
  a.push('--chdir', o.root);
  return a;
}

/** Everything for starting from this computer: finds the paths and prepares the folders. */
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
    try { const st = fs.lstatSync(d); if (st.isSymbolicLink()) systemLinks[d] = fs.readlinkSync(d); else systemDirs.push(d); } catch { /* it is not there */ }
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

// ---------- A check from inside (npm run sandbox:check) ----------
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

/** The files that must not be visible from inside. Compared by inode, because the private copy inside is another file. */
function secretsOf(home) {
  const list = ['.ssh', '.gnupg', '.aws', '.config', '.bashrc', '.bash_history', '.gitconfig', '.npmrc', '.claude.json',
    '.claude/history.jsonl', '.claude/projects', '.claude/file-history', '.claude/shell-snapshots', '.claude/backups'].map((r) => path.join(home, r));
  return [...list, '/mnt/c', '/run/WSL'].flatMap((p) => { try { const s = fs.statSync(p); return [{ path: p, dev: s.dev, ino: s.ino }]; } catch { return []; } });
}

/** A small Windows program, copied temporarily: if it starts from inside, the cage does not stop WSL interop. */
function windowsProbe() {
  const exe = '/mnt/c/Windows/System32/whoami.exe';
  if (!fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') || !fs.existsSync(exe)) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-probe-'));
  const copy = path.join(dir, 'probe.exe');
  fs.copyFileSync(exe, copy);
  fs.chmodSync(copy, 0o755);
  return { dir, copy, inside: '/run/llm-wiki-probe.exe' }; // in /run, not next to the project (otherwise it looks like a neighbouring file)
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
  try { results = JSON.parse(r.stdout); } catch { /* the cage did not start */ }
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

// ---------- Starting ----------
function main(argv) {
  if (process.platform !== 'linux') { console.error($t('Isolation works only on Linux and in WSL. On this system start with: npm run serve')); return Promise.resolve(1); }
  const bwrap = findBwrap();
  if (!bwrap) { console.error($t('bubblewrap is not installed, so the library cannot be isolated. Install it once with:\n  sudo apt install bubblewrap\nand start again.')); return Promise.resolve(1); }
  if (argv.includes('--check')) return Promise.resolve(runCheck({ bwrap, json: argv.includes('--json') }));
  const sep = argv.indexOf('--');
  const cmd = sep >= 0 ? argv.slice(sep + 1) : [process.execPath, path.join(ROOT, 'scripts', 'server.js')];
  if (!cmd.length) { console.error('node scripts/sandbox.js [--check] [-- <command>]'); return Promise.resolve(1); }
  // A shared folder for requests to the launcher (only for this user, 0700); inside it is seen as /run/llm-wiki
  const ipc = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-ipc-'));
  const p = plan({ extraEnv: { LIB_SANDBOX_IPC: IPC_INSIDE }, extra: [['--bind', ipc, IPC_INSIDE]] });
  if (!p.claude) console.warn($t('Claude Code was not found: the library will open, but processing will not work.'));
  const state = { backup: null };
  const stopIpc = serveRequests(ipc, outsideHandlers(ROOT, state));
  let child = null, startedAt = 0, afterUpdate = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { child?.kill(sig); } catch { /* already stopped */ } });
  return new Promise((resolve) => {
    const done = (code) => { stopIpc(); fs.rmSync(ipc, { recursive: true, force: true }); resolve(code); };
    const start = () => {
      startedAt = Date.now();
      child = spawn(bwrap, [...p.args, '--', ...cmd], { stdio: 'inherit' });
      child.on('error', (e) => { console.error(e.message); done(1); });
      child.on('exit', async (code, sig) => {
        // The server asked for a restart (after packages were updated): it is started again with the same cage
        if (code === RESTART_CODE) { console.log('\n  ' + $t('Restarting the library with the updated packages…')); afterUpdate = !!state.backup; return start(); }
        // The new versions do not start: the previous ones are put back and the library is started again
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
