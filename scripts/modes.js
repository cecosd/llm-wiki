// Working modes (normal and safe) and the name of the local site. Used by the launcher (scripts/app.js), which runs
// OUTSIDE the isolation, so this file uses ONLY the built-in Node modules: a package here would run without protection.
//
// Safe mode comes in two forms (chosen automatically by the system):
//   bubblewrap   Linux and WSL with bwrap: the server and its packages see only the project folder (scripts/sandbox.js).
//   permission   Windows, macOS and Linux without bwrap: `node --permission` limits the files that Node can reach.
//                This is a seat belt, not a cage: the programs that Node runs (git, claude, pdftotext) are not limited.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODES = ['normal', 'safe'];
/** The folder for requests from the server to the launcher (the launcher watches it). Only in outputs/: the server can write there, in the cage too. */
export const REQUEST_DIR = path.join(ROOT, 'outputs', '.launcher');
export const LAUNCH_FILE = path.join(ROOT, '.launch.json');
export const DEFAULT_PORT = 4321;

const IS_WIN = process.platform === 'win32';

export const isWSL = () => process.platform === 'linux' && (!!process.env.WSL_DISTRO_NAME || /microsoft/i.test(os.release()));

function which(name) {
  const r = spawnSync(IS_WIN ? 'where' : 'which', [name], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? (r.stdout || '').split(/\r?\n/)[0].trim() || null : null;
}

/** Which protection is possible on this system. */
export function chooseBackend({ platform = process.platform, wsl = isWSL(), force = process.env.LIB_BACKEND, bwrap = platform === 'linux' && force !== 'permission' ? which('bwrap') : null, nodeVersion = process.versions.node } = {}) {
  // LIB_BACKEND=permission chooses the Node permission protection even when bubblewrap is there (for a test or by choice)
  const major = Number(String(nodeVersion).split('.')[0]) || 0;
  if (platform === 'linux' && bwrap && force !== 'permission') return { id: 'bubblewrap', strong: true, bwrap };
  if (major >= 23) return { id: 'permission', strong: false, bwrap: null, canHaveBwrap: platform === 'linux' };
  return { id: 'none', strong: false, bwrap: null, canHaveBwrap: platform === 'linux' };
}

/** The folders and data files that the server writes to in safe mode (as in sandbox.js). */
export const WRITABLE_DIRS = ['raw', 'wiki', 'drafts', 'outputs', '.library-git', '.ocr-data'];
export const WRITABLE_FILES = ['library.config.json', '.library-auth.json', '.library-secrets.json'];

/**
 * Arguments for `node --permission`. Read: the project and the temporary folder. Write: only the data and the temporary folder.
 * `--allow-child-process` is needed: text extraction, git for "Undo" and Claude Code are separate processes.
 * `--allow-net` exists since Node 25; the older ones do not limit the network.
 */
export function permissionArgs(root = ROOT, { flags = process.allowedNodeEnvironmentFlags, tmp = os.tmpdir(), extraRead = [] } = {}) {
  const has = (f) => flags?.has?.(f);
  const args = ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${tmp}`, `--allow-fs-write=${tmp}`];
  for (const p of extraRead) args.push(`--allow-fs-read=${p}`);
  // node_modules can be a link to another folder (a shared package cache): Node checks the real path
  try { const real = fs.realpathSync(path.join(root, 'node_modules')); if (path.relative(root, real).startsWith('..')) args.push(`--allow-fs-read=${real}`); } catch { /* there is no node_modules */ }
  for (const d of WRITABLE_DIRS) args.push(`--allow-fs-write=${path.join(root, d)}`);
  for (const f of WRITABLE_FILES) args.push(`--allow-fs-write=${path.join(root, f)}`);
  args.push('--allow-child-process', '--allow-worker');
  if (has('--allow-net')) args.push('--allow-net');
  return args;
}

/** The command with which the launcher starts the server in a given mode. */
export function serverCommand(mode, { root = ROOT, backend = chooseBackend(), node = process.execPath } = {}) {
  if (mode === 'safe' && backend.id === 'bubblewrap') return { cmd: node, args: [path.join(root, 'scripts', 'sandbox.js')], isolation: 'bubblewrap' };
  if (mode === 'safe' && backend.id === 'permission') return { cmd: node, args: [...permissionArgs(root, { extraRead: [hostsFilePath(), path.join(os.homedir(), '.local', 'bin')] }), path.join(root, 'scripts', 'server.js')], isolation: 'permission' };
  return { cmd: node, args: [path.join(root, 'scripts', 'server.js')], isolation: 'none' };
}

// ---------- The name of the local site ----------

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_RE = new RegExp(`^${LABEL}(?:\\.${LABEL}){0,3}$`);
/** Endings that do not lead to a real site: no warning is needed for them. */
export const SAFE_SUFFIXES = ['localhost', 'test', 'local', 'lan', 'internal', 'home.arpa', 'wiki', 'library'];
const RESERVED = new Set(['localhost', 'broadcasthost', 'ip6-localhost', 'ip6-loopback']);

/**
 * Checks a name for the local site. Returns { ok, name, warn, error }.
 * `warn: 'real-domain'` means the name looks like a real site: after the hosts entry it will not open from this computer.
 */
export function checkHostName(input) {
  const name = String(input ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!name) return { ok: false, error: 'empty' };
  if (name.length > 100 || !HOST_RE.test(name)) return { ok: false, error: 'format' };
  if (RESERVED.has(name) || /^\d+(\.\d+)*$/.test(name)) return { ok: false, error: 'reserved' };
  const safe = SAFE_SUFFIXES.some((s) => name === s || name.endsWith('.' + s));
  return { ok: true, name, warn: safe || !name.includes('.') ? null : 'real-domain', bare: !name.includes('.') };
}

export const HOSTS_BEGIN = '# llm-wiki begin';
export const HOSTS_END = '# llm-wiki end';

export function hostsFilePath(platform = process.platform) {
  if (platform === 'win32') return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
  if (isWSL()) return '/mnt/c/Windows/System32/drivers/etc/hosts'; // the name is for Windows; Linux in WSL has its own /etc/hosts
  return '/etc/hosts';
}

/** The hosts text with the entry of the library (name) or without it (name = null). Keeps everything else and the kind of the lines. */
export function withHostsBlock(text, name) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === HOSTS_BEGIN) { skipping = true; continue; }
    if (skipping) { if (line.trim() === HOSTS_END) skipping = false; continue; }
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  if (name) out.push('', HOSTS_BEGIN, `127.0.0.1 ${name}`, `::1 ${name}`, HOSTS_END);
  return out.join(eol) + eol;
}

/** Which name is written in hosts (from the block of the library) or null. */
export function hostsName(text) {
  const m = new RegExp(`${HOSTS_BEGIN}\\s*\\r?\\n\\s*127\\.0\\.0\\.1\\s+(\\S+)`).exec(text || '');
  return m ? m[1] : null;
}

export function readHostsName(file = hostsFilePath()) {
  try { return hostsName(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Writes the name (or removes it when name = null). Needs administrator rights. */
export function writeHosts(name, file = hostsFilePath()) {
  const before = fs.readFileSync(file, 'utf8');
  const after = withHostsBlock(before, name);
  if (after === before) return { changed: false };
  fs.writeFileSync(file + '.llm-wiki.bak', before);
  fs.writeFileSync(file, after);
  return { changed: true };
}

// ---------- The launcher file ----------

export function readLaunch(file = LAUNCH_FILE) {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* not yet */ }
  const port = Number(j.port);
  return {
    mode: MODES.includes(j.mode) ? j.mode : 'normal',
    host: checkHostName(j.host).ok ? String(j.host).toLowerCase() : '',
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT,
  };
}

export function saveLaunch(patch, file = LAUNCH_FILE) {
  const next = { ...readLaunch(file), ...patch };
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}
