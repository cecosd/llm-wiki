// Стартер на приложението: пуска сървъра СКРИТО (без прозорец с порт), отваря библиотеката в собствен прозорец
// на приложението (Edge, Chrome, Chromium или Brave в режим --app) и спира сървъра, когато прозорецът се затвори.
//
//   npm run app                    обикновено пускане (двойно щракване върху прекия път прави същото)
//   npm run app -- --safe          пуска в защитен режим (запомня се)
//   npm run app -- --normal        пуска в обикновен режим (запомня се)
//   npm run app -- --no-window     само сървърът, без прозорец (спира се с Ctrl+C)
//   npm run app -- --check         какво би се случило (браузър, порт, режим, защита), без да пуска нищо
//
// Файлът върви ИЗВЪН изолацията, затова ползва само вградените модули на Node (виж modes.js).
// Сървърът иска промяна на режима, на името на сайта или спиране с файл в outputs/.launcher/ (виж handleRequest):
// така работи и в клетката на bubblewrap, и под `node --permission`, където няма друг канал.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, REQUEST_DIR, readLaunch, saveLaunch, serverCommand, chooseBackend, checkHostName, hostsFilePath, readHostsName, isWSL, MODES, DEFAULT_PORT } from './modes.js';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const RESTART_CODE = 75;
const args = new Set(process.argv.slice(2));

// ---------- Помощни ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 12);
const stateRoot = IS_WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'llm-wiki')
  : IS_MAC ? path.join(os.homedir(), 'Library', 'Application Support', 'llm-wiki')
    : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'llm-wiki');
const STATE = path.join(stateRoot, hash);
const LOCK = path.join(STATE, 'launcher.json');
const LOG = path.join(ROOT, 'outputs', 'server.log');

function log(text) {
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${text}\n`); } catch { /* няма къде */ }
}

/** Диалог с грешка, когато няма прозорец на конзола (скритото пускане). */
function notify(text) {
  log('ERROR ' + text);
  try {
    if (IS_WIN) spawnSync('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show(${JSON.stringify(text).replace(/"/g, "'")}, 'Biblioteka')`], { windowsHide: true });
    else if (IS_MAC) spawnSync('osascript', ['-e', `display dialog ${JSON.stringify(text)} buttons {"OK"} with title "Biblioteka"`]);
    else for (const [bin, a] of [['zenity', ['--error', '--text', text]], ['kdialog', ['--error', text]], ['notify-send', ['Biblioteka', text]]]) if (spawnSync(bin, a, { stdio: 'ignore' }).status === 0) return;
  } catch { /* остава в лога */ }
  console.error(text);
}

const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
  s.listen(port, '127.0.0.1');
});
/** Всеки HTTP отговор значи, че сървърът работи (с парола /api/stats връща 401). */
const alive = (port) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port, path: '/api/stats', headers: { 'x-library': '1' }, timeout: 1500 }, (r) => { r.resume(); resolve(true); });
  req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
});
const presence = (port) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port, path: '/api/app/presence', timeout: 1500 }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => { try { resolve(JSON.parse(b).clients); } catch { resolve(null); } });
  });
  req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
});
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

async function pickPort(wanted) {
  for (let p = wanted; p < wanted + 20; p++) if (await portFree(p)) return p;
  return null;
}

// ---------- Прозорец на приложението ----------
const first = (list) => list.find((f) => f && fs.existsSync(f)) || null;
const whichBin = (name) => { const r = spawnSync(IS_WIN ? 'where' : 'which', [name], { encoding: 'utf8', windowsHide: true }); return r.status === 0 ? (r.stdout || '').split(/\r?\n/)[0].trim() || null : null; };

/** Браузър на основата на Chromium, който може да отвори адрес като прозорец на приложение. */
function findBrowser() {
  if (process.env.LIB_BROWSER && fs.existsSync(process.env.LIB_BROWSER)) return process.env.LIB_BROWSER;
  if (IS_WIN) {
    const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    const rel = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'Chromium\\Application\\chrome.exe'];
    return first(rel.flatMap((r) => pf.map((p) => path.join(p, r))));
  }
  if (IS_MAC) {
    return first(['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Chromium.app/Contents/MacOS/Chromium']);
  }
  if (isWSL()) return null; // прозорец на Windows от WSL: ползва се браузърът по подразбиране
  for (const n of ['microsoft-edge', 'microsoft-edge-stable', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser']) {
    const f = whichBin(n); if (f) return f;
  }
  return null;
}

function openDefault(url) {
  const run = (cmd, a) => spawn(cmd, a, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  if (IS_WIN) run('cmd', ['/c', 'start', '', url]);
  else if (IS_MAC) run('open', [url]);
  else if (isWSL()) run('cmd.exe', ['/c', 'start', '', url]);
  else run('xdg-open', [url]);
}

/** Отваря прозорец на приложението. Връща процеса (ако браузърът ще остане, докато прозорецът е отворен) или null. */
function openWindow(url, browser) {
  if (!browser) { openDefault(url); return null; }
  const profile = path.join(STATE, 'browser');
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(browser, [`--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1360,900', '--disable-features=Translate'], { stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  return child;
}

// ---------- Hosts с повишени права ----------
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Записва (или маха при name = null) името в hosts. Показва на потребителя стандартния въпрос за администратор. */
function elevatedHosts(name) {
  const hostsJs = path.join(ROOT, 'scripts', 'hosts.js');
  const action = name ? ['set', name] : ['remove'];
  if (IS_WIN || isWSL()) {
    // Един PowerShell код за Windows и за WSL: променя само блока на библиотеката в hosts на Windows.
    const script = `
$f = Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts'
$b = '# llm-wiki begin'; $e = '# llm-wiki end'
$keep = @(); $skip = $false
foreach ($l in (Get-Content -LiteralPath $f)) { if ($l.Trim() -eq $b) { $skip = $true; continue }; if ($skip) { if ($l.Trim() -eq $e) { $skip = $false }; continue }; $keep += $l }
while ($keep.Count -gt 0 -and $keep[-1].Trim() -eq '') { $keep = $keep[0..($keep.Count - 2)] }
${name ? `$keep += @('', $b, '127.0.0.1 ${name}', '::1 ${name}', $e)` : ''}
Copy-Item -LiteralPath $f -Destination ($f + '.llm-wiki.bak') -Force
Set-Content -LiteralPath $f -Value $keep -Encoding ASCII
ipconfig /flushdns | Out-Null`;
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    const ps = IS_WIN ? 'powershell' : 'powershell.exe';
    const outer = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${enc}'`;
    return spawnSync(ps, ['-NoProfile', '-Command', outer], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  }
  if (IS_MAC) {
    const cmd = [process.execPath, hostsJs, ...action].map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
    return spawnSync('osascript', ['-e', `do shell script ${JSON.stringify(cmd)} with administrator privileges`], { encoding: 'utf8', timeout: 120000 });
  }
  const pk = whichBin('pkexec');
  if (pk) return spawnSync(pk, [process.execPath, hostsJs, ...action], { encoding: 'utf8', timeout: 120000 });
  return spawnSync('sudo', ['-n', process.execPath, hostsJs, ...action], { encoding: 'utf8', timeout: 20000 });
}

// ---------- Основен ход ----------
const ctl = { server: null, window: null, stopping: false, restarting: false, port: DEFAULT_PORT, backend: chooseBackend(), usePresence: false };

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    else child.kill('SIGTERM');
  } catch { /* вече го няма */ }
}

function startServer() {
  const cfg = readLaunch();
  const { cmd, args: a, isolation } = serverCommand(cfg.mode, { backend: ctl.backend });
  if (cfg.mode === 'safe' && isolation === 'none') log('Защитният режим не е възможен тук; сървърът тръгва без защита.');
  const env = { ...process.env, PORT: String(ctl.port), LIB_LAUNCHER: '1', LIB_SUPERVISED: '1', LIB_MODE: cfg.mode, LIB_ISOLATION: isolation };
  if (cfg.host) env.WIKI_HOST = cfg.host; else delete env.WIKI_HOST;
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const fd = fs.openSync(LOG, 'a');
  log(`Стартирам сървъра: режим ${cfg.mode}, защита ${isolation}, порт ${ctl.port}${cfg.host ? ', име ' + cfg.host : ''}`);
  const child = spawn(cmd, a, { cwd: ROOT, env, stdio: ['ignore', fd, fd], windowsHide: true });
  fs.closeSync(fd);
  child.on('error', (e) => log('Сървърът не тръгна: ' + e.message));
  child.on('exit', (code) => {
    log(`Сървърът спря с код ${code}`);
    if (ctl.stopping) return;
    if (code === RESTART_CODE || ctl.restarting) { ctl.restarting = false; ctl.server = startServer(); return; }
    notify(`The library server stopped (code ${code}). Details: ${LOG}`);
    shutdown(1);
  });
  return child;
}

function restartServer() {
  ctl.restarting = true;
  killTree(ctl.server);
}

async function waitReady(port, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await alive(port)) return true; await sleep(300); }
  return false;
}

let down = false;
function shutdown(code = 0) {
  if (down) return; down = true; ctl.stopping = true;
  killTree(ctl.server);
  if (ctl.window && ctl.window.exitCode === null) { try { ctl.window.kill(); } catch { /* затворен */ } }
  try { fs.rmSync(LOCK, { force: true }); } catch { /* няма */ }
  setTimeout(() => process.exit(code), 400);
}

// ---------- Заявки от сървъра ----------
function answer(id, result) {
  try { fs.writeFileSync(path.join(REQUEST_DIR, 'result.json'), JSON.stringify({ id, ...result })); } catch { /* няма къде */ }
}

async function handleRequest(req) {
  const id = String(req.id || '');
  // Малко изчакване, за да стигне отговорът до страницата, преди сървърът да бъде спрян
  if (req.type === 'quit') { answer(id, { ok: true }); setTimeout(() => shutdown(0), 1500); return; }
  if (req.type === 'mode') {
    if (!MODES.includes(req.mode)) return answer(id, { ok: false, error: 'mode' });
    if (req.mode === 'safe' && ctl.backend.id === 'none') return answer(id, { ok: false, error: 'unavailable' });
    saveLaunch({ mode: req.mode });
    log('Режимът се сменя на ' + req.mode);
    answer(id, { ok: true });
    setTimeout(restartServer, 800); // първо отговорът стига до страницата
    return;
  }
  if (req.type === 'host') {
    const name = req.name == null || req.name === '' ? null : req.name;
    const c = name ? checkHostName(name) : { ok: true, name: null };
    if (!c.ok) return answer(id, { ok: false, error: 'name' });
    if (c.warn && !req.force) return answer(id, { ok: false, error: 'real-domain', name: c.name });
    log('Името на сайта се сменя на ' + (c.name || '(няма)'));
    const r = elevatedHosts(c.name);
    const now = readHostsName(hostsFilePath());
    if ((now || null) !== (c.name || null)) {
      return answer(id, { ok: false, error: 'denied', detail: String(r.stderr || r.error?.message || '').slice(0, 300) });
    }
    saveLaunch({ host: c.name || '' });
    answer(id, { ok: true, name: c.name, url: c.name ? `http://${c.name}:${ctl.port}/` : `http://localhost:${ctl.port}/` });
    setTimeout(restartServer, 800); // първо отговорът стига до страницата
    return;
  }
  answer(id, { ok: false, error: 'unknown' });
}

function watchRequests() {
  const file = path.join(REQUEST_DIR, 'request.json');
  let busy = false;
  setInterval(async () => {
    if (busy || !fs.existsSync(file)) return;
    busy = true;
    try {
      const text = fs.readFileSync(file, 'utf8'); fs.rmSync(file, { force: true });
      await handleRequest(JSON.parse(text));
    } catch (e) { log('Заявка с грешка: ' + e.message); } finally { busy = false; }
  }, 600).unref();
}

// ---------- Започване ----------
async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24) { notify(`Node.js 24 or newer is required (this is ${process.version}). Run the installer again.`); process.exit(1); }
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) { notify('The libraries are not installed. Run the installer (install.cmd or install.sh) first.'); process.exit(1); }

  if (args.has('--safe')) saveLaunch({ mode: 'safe' });
  if (args.has('--normal')) saveLaunch({ mode: 'normal' });
  const cfg = readLaunch();
  const browser = args.has('--no-window') ? null : findBrowser();

  if (args.has('--check')) {
    console.log(JSON.stringify({ node: process.version, root: ROOT, mode: cfg.mode, host: cfg.host, port: cfg.port, backend: ctl.backend.id, strong: ctl.backend.strong, browser, wsl: isWSL(), hostsFile: hostsFilePath() }, null, 2));
    return;
  }

  fs.mkdirSync(STATE, { recursive: true });
  fs.mkdirSync(REQUEST_DIR, { recursive: true });

  // Вече пусната библиотека: само отваря прозорец към нея
  try {
    const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    if (pidAlive(lock.pid) && await alive(lock.port)) {
      log('Вече работи; отварям прозорец.');
      if (!args.has('--no-window')) openWindow(urlFor(lock.port, lock.host), browser);
      return;
    }
  } catch { /* няма активен стартер */ }

  const port = await pickPort(cfg.port);
  if (!port) { notify(`No free port from ${cfg.port} to ${cfg.port + 19}. Close the program that uses them, or set another port in .launch.json.`); process.exit(1); }
  ctl.port = port;
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, port, host: cfg.host, started: new Date().toISOString() }));

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(0));
  ctl.server = startServer();
  watchRequests();

  if (!await waitReady(port)) { notify(`The library did not start in time. Details: ${LOG}`); return shutdown(1); }
  if (args.has('--no-window')) { console.log(`Library: ${urlFor(port, readLaunch().host)} (Ctrl+C stops it)`); return; }

  const url = urlFor(port, readLaunch().host);
  const opened = Date.now();
  ctl.window = openWindow(url, browser);
  // Прозорецът върви, докато е отворен; ако браузърът предаде работата на друг процес и излезе веднага, се следи присъствието
  if (ctl.window) ctl.window.on('exit', () => { if (Date.now() - opened > 4000) shutdown(0); else ctl.usePresence = true; });
  else ctl.usePresence = true;

  // Присъствие: страницата държи отворена връзка към сървъра. Без никаква 30 секунди, след като е имало, сървърът се спира.
  let seen = false; let empty = 0;
  setInterval(async () => {
    if (!ctl.usePresence || ctl.restarting) return;
    const n = await presence(ctl.port);
    if (n === null) return;
    if (n > 0) { seen = true; empty = 0; } else { empty += 3; if ((seen && empty >= 30) || (!seen && empty >= 90)) shutdown(0); }
  }, 3000).unref();
}

const urlFor = (port, host) => `http://${host || 'localhost'}:${port}/`;

main().catch((e) => { notify(String(e?.stack || e)); process.exit(1); });
