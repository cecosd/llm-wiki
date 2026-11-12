// Страната на сървъра за стартера (scripts/app.js): какъв е режимът, какви защити има тази система, и заявките за
// смяна на режима, име на сайта и спиране. Заявките се предават с файл в outputs/.launcher/, защото сървърът върви
// в клетка или под `node --permission` и няма друг канал към стартера, който е извън тях.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './lib.js';
import { REQUEST_DIR, chooseBackend, checkHostName, readHostsName, hostsFilePath, isWSL, readLaunch } from './modes.js';

const RESULT = path.join(REQUEST_DIR, 'result.json');
const REQUEST = path.join(REQUEST_DIR, 'request.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Пуснат ли е от стартера (тогава заявките имат кой да ги изпълни). */
export const underLauncher = () => process.env.LIB_LAUNCHER === '1';
/** Нов при всяко пускане на сървъра: страницата по него разбира, че сървърът е тръгнал отново. */
export const BOOT = crypto.randomBytes(6).toString('hex');

/** Какво вижда страницата за режима и адреса. */
export function appInfo() {
  const launch = readLaunch();
  const backend = chooseBackend();
  const mode = process.env.LIB_MODE === 'safe' ? 'safe' : 'normal';
  let hosts = null;
  try { hosts = readHostsName(hostsFilePath()); } catch { /* в клетката hosts на Windows не се вижда */ }
  const port = Number(process.env.PORT) || launch.port;
  return {
    launcher: underLauncher(),
    mode,
    wanted: launch.mode, // какво е запазено за следващото пускане
    isolation: process.env.LIB_SANDBOX === '1' ? 'bubblewrap' : (process.env.LIB_ISOLATION || 'none'),
    canSafe: backend.id !== 'none',
    backend: backend.id,
    strongPossible: backend.strong,
    canInstallBwrap: backend.canHaveBwrap && !backend.strong,
    platform: process.platform,
    wsl: isWSL(),
    host: process.env.WIKI_HOST || '',
    hostsEntry: hosts,
    port,
    url: process.env.WIKI_HOST ? `http://${process.env.WIKI_HOST}:${port}/` : `http://localhost:${port}/`,
    hostsFile: hostsFilePath(),
  };
}

/** Праща заявка към стартера и чака отговор. */
async function ask(payload, { wait = 8000 } = {}) {
  if (!underLauncher()) return { ok: false, error: 'no-launcher' };
  const id = crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(REQUEST_DIR, { recursive: true });
  try { fs.rmSync(RESULT, { force: true }); } catch { /* няма */ }
  fs.writeFileSync(REQUEST, JSON.stringify({ ...payload, id }));
  const end = Date.now() + wait;
  while (Date.now() < end) {
    await sleep(250);
    try {
      const r = JSON.parse(fs.readFileSync(RESULT, 'utf8'));
      if (r.id === id) return r;
    } catch { /* още няма */ }
  }
  return { ok: false, error: 'timeout' };
}

export const requestMode = (mode) => (mode === 'safe' || mode === 'normal' ? ask({ type: 'mode', mode }) : { ok: false, error: 'mode' });
export const requestQuit = () => ask({ type: 'quit' }, { wait: 3000 });

/** Име на сайта: запис в hosts с права на администратор (потребителят потвърждава в системния прозорец). */
export function requestHost(name, force = false) {
  if (name) {
    const c = checkHostName(name);
    if (!c.ok) return { ok: false, error: 'name' };
    if (c.warn && !force) return { ok: false, error: 'real-domain', name: c.name };
    name = c.name;
  }
  return ask({ type: 'host', name: name || null, force: !!force }, { wait: 130000 });
}

/** Командата за ръчно записване в hosts (когато няма стартер). */
export function hostsCommand(name) {
  const c = checkHostName(name);
  if (!c.ok) return null;
  const js = path.join(ROOT, 'scripts', 'hosts.js');
  return process.platform === 'win32'
    ? `node "${js}" set ${c.name}   (${'PowerShell/CMD as administrator'})`
    : `sudo node "${js}" set ${c.name}`;
}
