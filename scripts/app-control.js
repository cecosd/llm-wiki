// The server side for the launcher (scripts/app.js): what the mode is, which protections this system has, and the requests for
// changing the mode, the site name and stopping. Requests are passed with a file in outputs/.launcher/, because the server runs
// in a cage or under `node --permission` and has no other channel to the launcher, which is outside them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './lib.js';
import { REQUEST_DIR, chooseBackend, checkHostName, readHostsName, hostsFilePath, isWSL, readLaunch } from './modes.js';

const RESULT = path.join(REQUEST_DIR, 'result.json');
const REQUEST = path.join(REQUEST_DIR, 'request.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Was it started by the launcher (then there is someone to carry out the requests). */
export const underLauncher = () => process.env.LIB_LAUNCHER === '1';
/** New at every start of the server: the page uses it to understand that the server started again. */
export const BOOT = crypto.randomBytes(6).toString('hex');

/** What the page sees about the mode and the address. */
export function appInfo() {
  const launch = readLaunch();
  const backend = chooseBackend();
  const mode = process.env.LIB_MODE === 'safe' ? 'safe' : 'normal';
  let hosts = null;
  try { hosts = readHostsName(hostsFilePath()); } catch { /* the Windows hosts file is not visible in the cage */ }
  const port = Number(process.env.PORT) || launch.port;
  return {
    launcher: underLauncher(),
    mode,
    wanted: launch.mode, // what is saved for the next start
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

/** Sends a request to the launcher and waits for the answer. */
async function ask(payload, { wait = 8000 } = {}) {
  if (!underLauncher()) return { ok: false, error: 'no-launcher' };
  const id = crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(REQUEST_DIR, { recursive: true });
  try { fs.rmSync(RESULT, { force: true }); } catch { /* none */ }
  fs.writeFileSync(REQUEST, JSON.stringify({ ...payload, id }));
  const end = Date.now() + wait;
  while (Date.now() < end) {
    await sleep(250);
    try {
      const r = JSON.parse(fs.readFileSync(RESULT, 'utf8'));
      if (r.id === id) return r;
    } catch { /* not yet */ }
  }
  return { ok: false, error: 'timeout' };
}

export const requestMode = (mode) => (mode === 'safe' || mode === 'normal' ? ask({ type: 'mode', mode }) : { ok: false, error: 'mode' });
export const requestQuit = () => ask({ type: 'quit' }, { wait: 3000 });

/** Site name: a record in hosts with administrator rights (the user confirms in the system window). */
export function requestHost(name, force = false) {
  if (name) {
    const c = checkHostName(name);
    if (!c.ok) return { ok: false, error: 'name' };
    if (c.warn && !force) return { ok: false, error: 'real-domain', name: c.name };
    name = c.name;
  }
  return ask({ type: 'host', name: name || null, force: !!force }, { wait: 130000 });
}

/** The command for writing to hosts by hand (when there is no launcher). */
export function hostsCommand(name) {
  const c = checkHostName(name);
  if (!c.ok) return null;
  const js = path.join(ROOT, 'scripts', 'hosts.js');
  return process.platform === 'win32'
    ? `node "${js}" set ${c.name}   (${'PowerShell/CMD as administrator'})`
    : `sudo node "${js}" set ${c.name}`;
}
