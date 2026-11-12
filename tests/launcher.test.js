// Стартерът (scripts/app.js), режимите (modes.js), името на сайта (hosts) и защитата с права на Node.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { T, makeSandbox, freePort } from './helpers.js';
import {
  checkHostName, withHostsBlock, hostsName, permissionArgs, serverCommand, chooseBackend, readLaunch, saveLaunch,
  HOSTS_BEGIN, HOSTS_END, WRITABLE_DIRS,
} from '../scripts/modes.js';

const IS_WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test(T('launcher', 'A site name must be a plain host name, and names of real websites need a confirmation', 'Името на сайта е обикновено име, а името на истински сайт иска потвърждение'), () => {
  assert.deepEqual(checkHostName('biblioteka.test'), { ok: true, name: 'biblioteka.test', warn: null, bare: false });
  assert.equal(checkHostName('  HTTP://Wiki.Localhost/path ').name, 'wiki.localhost');
  assert.equal(checkHostName('biblioteka').bare, true, 'a name without a dot is allowed but marked');
  assert.equal(checkHostName('google.com').warn, 'real-domain');
  for (const bad of ['', 'localhost', '12.34', 'bad name', 'a_b.test', '-a.test', 'a..test', 'x'.repeat(70) + '.test', 'a.b.c.d.e.test', '127.0.0.1', 'a.test; rm -rf']) {
    assert.equal(checkHostName(bad).ok, false, `"${bad}" must be refused`);
  }
});

test(T('launcher', 'The hosts file gets one block that is replaced or removed, and the rest stays as it was', 'Във файла hosts има един блок, който се заменя или маха, а останалото си остава'), () => {
  const base = '# my hosts\r\n127.0.0.1 localhost\r\n::1 localhost\r\n';
  const one = withHostsBlock(base, 'biblioteka.test');
  assert.match(one, new RegExp(`${HOSTS_BEGIN}\\r\\n127\\.0\\.0\\.1 biblioteka\\.test\\r\\n::1 biblioteka\\.test\\r\\n${HOSTS_END}`));
  assert.ok(one.startsWith(base.trimEnd()), 'the earlier lines are untouched');
  assert.equal(hostsName(one), 'biblioteka.test');
  const two = withHostsBlock(one, 'other.test');
  assert.equal((two.match(new RegExp(HOSTS_BEGIN, 'g')) || []).length, 1, 'renaming does not add a second block');
  assert.equal(hostsName(two), 'other.test');
  assert.equal(withHostsBlock(two, null), base, 'removing brings back the original text');
  assert.equal(withHostsBlock('127.0.0.1 localhost\n', 'a.test').includes('\r'), false, 'Linux line endings are kept');
});

test(T('launcher', 'Basic protection lets the server read the project and write only to the library data', 'Основната защита позволява на сървъра да чете проекта и да пише само в данните на библиотеката'), () => {
  const root = path.resolve('/x/lib');
  const args = permissionArgs(root, { flags: new Set(['--allow-net']), tmp: path.resolve('/x/tmp'), extraRead: [] });
  assert.ok(args.includes('--permission'));
  assert.ok(args.includes(`--allow-fs-read=${root}`));
  const writes = args.filter((a) => a.startsWith('--allow-fs-write=')).map((a) => a.slice(17));
  assert.ok(!writes.includes(root), 'the project folder itself is not writable');
  for (const d of WRITABLE_DIRS) assert.ok(writes.includes(path.join(root, d)), `${d} is writable`);
  assert.ok(!writes.some((w) => w.endsWith('scripts') || w.endsWith('node_modules') || w.endsWith('.claude')), 'the code is read-only');
  assert.ok(args.includes('--allow-child-process') && args.includes('--allow-net'));
  assert.ok(!permissionArgs(root, { flags: new Set(), tmp: '/t' }).includes('--allow-net'), 'older Node has no net permission to give');
});

test(T('launcher', 'The launcher picks the command for each mode and the protection the system can give', 'Стартерът избира командата за всеки режим и защитата, която системата може да даде'), () => {
  assert.equal(chooseBackend({ platform: 'win32', nodeVersion: '24.1.0' }).id, 'permission');
  assert.equal(chooseBackend({ platform: 'darwin', nodeVersion: '24.1.0' }).id, 'permission');
  assert.equal(chooseBackend({ platform: 'linux', bwrap: '/usr/bin/bwrap', nodeVersion: '24.1.0' }).strong, true);
  assert.equal(chooseBackend({ platform: 'linux', bwrap: null, nodeVersion: '24.1.0' }).canHaveBwrap, true, 'Linux is told it could install bubblewrap');
  assert.equal(chooseBackend({ platform: 'linux', bwrap: '/usr/bin/bwrap', force: 'permission', nodeVersion: '24.0.0' }).strong, false, 'LIB_BACKEND forces the Node permission model');
  const permission = { id: 'permission' };
  const n = serverCommand('normal', { root: '/r', backend: permission, node: 'node' });
  assert.deepEqual(n.args, [path.join('/r', 'scripts', 'server.js')]);
  assert.equal(n.isolation, 'none');
  const s = serverCommand('safe', { root: '/r', backend: permission, node: 'node' });
  assert.equal(s.isolation, 'permission');
  assert.ok(s.args.includes('--permission') && s.args.at(-1).endsWith('server.js'));
  assert.equal(serverCommand('safe', { root: '/r', backend: { id: 'bubblewrap' }, node: 'node' }).args[0].endsWith('sandbox.js'), true);
  assert.equal(serverCommand('safe', { root: '/r', backend: { id: 'none' }, node: 'node' }).isolation, 'none', 'without any protection safe falls back to normal start');
});

test(T('launcher', 'The launcher file keeps only valid values', 'Файлът на стартера пази само валидни стойности'), () => {
  const box = makeSandbox();
  try {
    const f = path.join(box.root, '.launch.json');
    assert.deepEqual(readLaunch(f), { mode: 'normal', host: '', port: 4321 });
    box.write('.launch.json', JSON.stringify({ mode: 'danger', host: 'bad name', port: 80 }));
    assert.deepEqual(readLaunch(f), { mode: 'normal', host: '', port: 4321 });
    assert.equal(saveLaunch({ mode: 'safe', host: 'a.test' }, f).mode, 'safe');
    assert.deepEqual(readLaunch(f), { mode: 'safe', host: 'a.test', port: 4321 });
  } finally { box.remove(); }
});

test(T('launcher', 'Under node --permission the code cannot read or write outside the library, and its Node helpers get the same limits', 'Под node --permission кодът не чете и не пише извън библиотеката, а помощните му Node процеси имат същите ограничения'), () => {
  const box = makeSandbox();
  try {
    // The test folder lives in the temp folder, which is writable by design: give the sandbox its own temp folder
    const args = permissionArgs(box.root, { tmp: path.join(box.root, 'home') });
    const run =(code) => spawnSync(process.execPath, [...args, '-e', code], { cwd: box.root, encoding: 'utf8' });
    const outside = IS_WIN ? 'C:\\\\Windows\\\\win.ini' : '/etc/passwd';
    assert.match(run(`try{require('fs').readFileSync('${outside}');console.log('READ')}catch(e){console.log(e.code)}`).stdout, /ERR_ACCESS_DENIED/);
    assert.match(run(`try{require('fs').writeFileSync('scripts/x.tmp','1');console.log('WROTE')}catch(e){console.log(e.code)}`).stdout, /ERR_ACCESS_DENIED/);
    assert.match(run(`require('fs').writeFileSync('wiki/ok.tmp','1');console.log('WROTE')`).stdout, /WROTE/, 'the library data stays writable');
    const child = `const c=require('child_process');console.log(c.spawnSync(process.execPath,['-e',"try{require('fs').readFileSync('${outside}');console.log('CHILD-READ')}catch(e){console.log('child-'+e.code)}"],{encoding:'utf8'}).stdout)`;
    assert.match(run(child).stdout, /child-ERR_ACCESS_DENIED/, 'a Node child inherits the limits');
  } finally { box.remove(); }
});

// --- The launcher end to end: hidden server, mode switch through the interface, quit ---
let box, launcher, port;
const api = async (method, url, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'x-library': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const waitFor = async (fn, ms = 40000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* още не */ } await sleep(300); } return null; };

before(async () => {
  box = makeSandbox();
  port = await freePort();
  box.write('.launch.json', JSON.stringify({ mode: 'normal', host: '', port }));
  const env = { ...box.env, LIB_BACKEND: 'permission', LOCALAPPDATA: path.join(box.root, 'home'), XDG_STATE_HOME: path.join(box.root, 'home') };
  launcher = spawn(process.execPath, [path.join(box.root, 'scripts', 'app.js'), '--no-window'], { cwd: box.root, env, stdio: 'ignore', windowsHide: true });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/api/app/presence`)).ok);
});
after(async () => {
  if (launcher && launcher.exitCode === null) { try { launcher.kill(); } catch { /* вече го няма */ } }
  await sleep(500);
  box?.remove();
});

test(T('launcher', 'The launcher starts the server hidden and the page can see how it was started', 'Стартерът пуска сървъра скрито, а страницата вижда как е пуснат'), async () => {
  const r = await api('GET', '/api/app');
  assert.equal(r.status, 200);
  assert.equal(r.json.launcher, true);
  assert.equal(r.json.mode, 'normal');
  assert.equal(r.json.isolation, 'none');
  assert.equal(r.json.canSafe, true);
  assert.ok(fs.existsSync(path.join(box.root, 'outputs', 'server.log')), 'the server writes its log to a file, not to a window');
});

test(T('launcher', 'Safe mode can be switched on and off from the interface, and the server restarts', 'Защитният режим се включва и изключва от интерфейса, а сървърът се рестартира'), async () => {
  const boot1 = (await api('GET', '/api/app/presence')).json.boot;
  assert.equal((await api('POST', '/api/app/mode', { mode: 'safe' })).json.ok, true);
  const safe = await waitFor(async () => { const p = (await api('GET', '/api/app/presence')).json; return p.boot !== boot1 ? await api('GET', '/api/app') : null; });
  assert.ok(safe, 'the server came back');
  assert.equal(safe.json.mode, 'safe');
  assert.equal(safe.json.isolation, 'permission');
  assert.equal(readLaunch(path.join(box.root, '.launch.json')).mode, 'safe', 'the choice is remembered for the next start');
  // In safe mode the rest of the interface still works
  assert.equal((await api('GET', '/api/setup')).status, 200);
  assert.equal((await api('GET', '/api/agent')).status, 200);

  const boot2 = (await api('GET', '/api/app/presence')).json.boot;
  assert.equal((await api('POST', '/api/app/mode', { mode: 'normal' })).json.ok, true);
  const back = await waitFor(async () => { const p = (await api('GET', '/api/app/presence')).json; return p.boot !== boot2 ? await api('GET', '/api/app') : null; });
  assert.equal(back.json.mode, 'normal');
});

test(T('launcher', 'A bad mode or site name is refused and nothing is written to the hosts file', 'Невалиден режим или име на сайта се отказва и нищо не се пише във файла hosts'), async () => {
  assert.equal((await api('POST', '/api/app/mode', { mode: 'root' })).json.ok, false);
  assert.equal((await api('POST', '/api/app/host', { name: 'bad name!' })).json.error, 'name');
  const real = (await api('POST', '/api/app/host', { name: 'google.com' })).json;
  assert.equal(real.error, 'real-domain', 'a real-looking domain needs a confirmation first');
  assert.equal(readLaunch(path.join(box.root, '.launch.json')).host, '', 'no name was saved');
});

test(T('launcher', 'Quitting from the interface stops the server and the launcher', 'Спирането от интерфейса спира сървъра и стартера'), async () => {
  assert.equal((await api('POST', '/api/app/quit')).json.ok, true);
  const gone = await waitFor(async () => { try { await fetch(`http://127.0.0.1:${port}/api/app/presence`, { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; } }, 15000);
  assert.ok(gone, 'the server stopped');
  assert.ok(await waitFor(() => launcher.exitCode !== null, 10000), 'the launcher exited');
});

test(T('launcher', 'Without the launcher the server says so and shows the command to run by hand', 'Без стартер сървърът го казва и показва командата за ръчно изпълнение'), async () => {
  // A server started on its own (npm run serve) must say that the launcher is missing instead of pretending
  const p = await freePort();
  const env = { ...box.env, PORT: String(p) };
  delete env.LIB_LAUNCHER;
  const srv = spawn(process.execPath, [path.join(box.root, 'scripts', 'server.js')], { cwd: box.root, env, stdio: 'ignore', windowsHide: true });
  try {
    assert.ok(await waitFor(async () => (await fetch(`http://127.0.0.1:${p}/api/app/presence`)).ok));
    const call = (m, u, b) => fetch(`http://127.0.0.1:${p}${u}`, { method: m, headers: { 'x-library': '1', 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
    assert.equal((await call('GET', '/api/app')).launcher, false);
    assert.equal((await call('POST', '/api/app/mode', { mode: 'safe' })).error, 'no-launcher');
    const h = await call('POST', '/api/app/host', { name: 'biblioteka.test' });
    assert.equal(h.error, 'no-launcher');
    assert.match(h.command, /hosts\.js" set biblioteka\.test/, 'it shows the command to run by hand');
    // A name that is not saved in hosts is refused (DNS rebinding): fetch cannot set Host, so use http
    const status = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: p, path: '/api/app/presence', headers: { host: 'biblioteka.test:' + p } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0)); req.end();
    });
    assert.equal(status, 403, 'a name that was not set up is refused');
  } finally { srv.kill(); }
});
