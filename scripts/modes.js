// Режими на работа (обикновен и защитен) и име на локалния сайт. Ползва се от стартера (scripts/app.js), който върви
// ИЗВЪН изолацията, затова файлът ползва САМО вградените модули на Node: пакет тук би се изпълнил без защита.
//
// Защитен режим има в две форми (избира се сам според системата):
//   bubblewrap   Linux и WSL с bwrap: сървърът и пакетите му виждат само папката на проекта (scripts/sandbox.js).
//   permission   Windows, macOS и Linux без bwrap: `node --permission` ограничава файловете, до които стига Node.
//                Това е предпазен колан, не клетка: програмите, които Node пуска (git, claude, pdftotext), не са ограничени.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODES = ['normal', 'safe'];
/** Папка за заявки от сървъра към стартера (стартерът я гледа). Само в outputs/: там сървърът може да пише и в клетката. */
export const REQUEST_DIR = path.join(ROOT, 'outputs', '.launcher');
export const LAUNCH_FILE = path.join(ROOT, '.launch.json');
export const DEFAULT_PORT = 4321;

const IS_WIN = process.platform === 'win32';

export const isWSL = () => process.platform === 'linux' && (!!process.env.WSL_DISTRO_NAME || /microsoft/i.test(os.release()));

function which(name) {
  const r = spawnSync(IS_WIN ? 'where' : 'which', [name], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? (r.stdout || '').split(/\r?\n/)[0].trim() || null : null;
}

/** Каква защита е възможна на тази система. */
export function chooseBackend({ platform = process.platform, wsl = isWSL(), force = process.env.LIB_BACKEND, bwrap = platform === 'linux' && force !== 'permission' ? which('bwrap') : null, nodeVersion = process.versions.node } = {}) {
  // LIB_BACKEND=permission избира защита с права на Node дори когато има bubblewrap (за тест или по желание)
  const major = Number(String(nodeVersion).split('.')[0]) || 0;
  if (platform === 'linux' && bwrap && force !== 'permission') return { id: 'bubblewrap', strong: true, bwrap };
  if (major >= 23) return { id: 'permission', strong: false, bwrap: null, canHaveBwrap: platform === 'linux' };
  return { id: 'none', strong: false, bwrap: null, canHaveBwrap: platform === 'linux' };
}

/** Папките и файловете с данни, в които сървърът пише в защитен режим (както в sandbox.js). */
export const WRITABLE_DIRS = ['raw', 'wiki', 'drafts', 'outputs', '.library-git', '.ocr-data'];
export const WRITABLE_FILES = ['library.config.json', '.library-auth.json', '.library-secrets.json'];

/**
 * Аргументи за `node --permission`. Четене: проектът и временната папка. Запис: само данните и временната папка.
 * `--allow-child-process` е нужен: извличането на текст, git за „Върни“ и Claude Code са отделни процеси.
 * `--allow-net` има от Node 25; по-старите не ограничават мрежата.
 */
export function permissionArgs(root = ROOT, { flags = process.allowedNodeEnvironmentFlags, tmp = os.tmpdir(), extraRead = [] } = {}) {
  const has = (f) => flags?.has?.(f);
  const args = ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${tmp}`, `--allow-fs-write=${tmp}`];
  for (const p of extraRead) args.push(`--allow-fs-read=${p}`);
  // node_modules може да е връзка към друга папка (общ кеш на пакети): Node проверява истинския път
  try { const real = fs.realpathSync(path.join(root, 'node_modules')); if (path.relative(root, real).startsWith('..')) args.push(`--allow-fs-read=${real}`); } catch { /* няма node_modules */ }
  for (const d of WRITABLE_DIRS) args.push(`--allow-fs-write=${path.join(root, d)}`);
  for (const f of WRITABLE_FILES) args.push(`--allow-fs-write=${path.join(root, f)}`);
  args.push('--allow-child-process', '--allow-worker');
  if (has('--allow-net')) args.push('--allow-net');
  return args;
}

/** Командата, с която стартерът пуска сървъра в даден режим. */
export function serverCommand(mode, { root = ROOT, backend = chooseBackend(), node = process.execPath } = {}) {
  if (mode === 'safe' && backend.id === 'bubblewrap') return { cmd: node, args: [path.join(root, 'scripts', 'sandbox.js')], isolation: 'bubblewrap' };
  if (mode === 'safe' && backend.id === 'permission') return { cmd: node, args: [...permissionArgs(root, { extraRead: [hostsFilePath(), path.join(os.homedir(), '.local', 'bin')] }), path.join(root, 'scripts', 'server.js')], isolation: 'permission' };
  return { cmd: node, args: [path.join(root, 'scripts', 'server.js')], isolation: 'none' };
}

// ---------- Име на локалния сайт ----------

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_RE = new RegExp(`^${LABEL}(?:\\.${LABEL}){0,3}$`);
/** Окончания, които не водят към истински сайт: за тях не е нужно предупреждение. */
export const SAFE_SUFFIXES = ['localhost', 'test', 'local', 'lan', 'internal', 'home.arpa', 'wiki', 'library'];
const RESERVED = new Set(['localhost', 'broadcasthost', 'ip6-localhost', 'ip6-loopback']);

/**
 * Проверява име за локалния сайт. Връща { ok, name, warn, error }.
 * `warn: 'real-domain'` значи, че името изглежда като истински сайт: след записа в hosts той не се отваря от този компютър.
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
  if (isWSL()) return '/mnt/c/Windows/System32/drivers/etc/hosts'; // името е за Windows; Linux в WSL има свой /etc/hosts
  return '/etc/hosts';
}

/** Текстът на hosts със записа на библиотеката (name) или без него (name = null). Пази всичко останало и вида на редовете. */
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

/** Кое име е записано в hosts (от блока на библиотеката) или null. */
export function hostsName(text) {
  const m = new RegExp(`${HOSTS_BEGIN}\\s*\\r?\\n\\s*127\\.0\\.0\\.1\\s+(\\S+)`).exec(text || '');
  return m ? m[1] : null;
}

export function readHostsName(file = hostsFilePath()) {
  try { return hostsName(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Записва името (или го маха при name = null). Иска права на администратор. */
export function writeHosts(name, file = hostsFilePath()) {
  const before = fs.readFileSync(file, 'utf8');
  const after = withHostsBlock(before, name);
  if (after === before) return { changed: false };
  fs.writeFileSync(file + '.llm-wiki.bak', before);
  fs.writeFileSync(file, after);
  return { changed: true };
}

// ---------- Файлът на стартера ----------

export function readLaunch(file = LAUNCH_FILE) {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* още няма */ }
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
