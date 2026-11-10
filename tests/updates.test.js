// Проверка за обновления срещу локален фалшив GitHub: без истински интернет.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { T, makeSandbox, startServer, api } from './helpers.js';
import { compareVersions, repoOf, parseOutdated, parseAudit } from '../scripts/updates.js';
import * as npmUpdate from '../scripts/npm-update.js';
import * as sandbox from '../scripts/sandbox.js';

let box, fake, base, remoteVersion = '99.0.0', hits = 0;
before(async () => {
  box = makeSandbox();
  fake = http.createServer((req, res) => {
    hits++;
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/HEAD/package.json')) return res.end(JSON.stringify({ version: remoteVersion }));
    if (req.url.includes('/commits/HEAD')) return res.end(JSON.stringify({ sha: 'abcdef1234', html_url: 'https://example.invalid/c', commit: { message: 'New release\n\nbody', committer: { date: '2026-11-01T00:00:00Z' } } }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${fake.address().port}`;
});
after(async () => { await new Promise((r) => fake.close(r)); box?.remove(); });

test(T('updates', 'Versions are compared correctly', 'Версиите се сравняват правилно'), () => {
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('v2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('1.2.0-beta', '1.2.0'), 0);
});

test(T('updates', 'The repository address is read from package.json', 'Адресът на репото се чете от package.json'), () => {
  assert.equal(repoOf({ repository: { url: 'git+https://github.com/owner/some.repo.git' } }), 'owner/some.repo');
  assert.equal(repoOf({ repository: 'git@github.com:owner/repo.git' }), 'owner/repo');
  assert.equal(repoOf({}), null);
});

test(T('updates', 'Nothing contacts GitHub until the button is pressed', 'Нищо не се свързва с GitHub преди натискане на бутона'), async () => {
  const srv = await startServer(box, { LIBRARY_GITHUB_BASE: base });
  try {
    await api(srv.port, 'GET', '/api/settings');
    await api(srv.port, 'GET', '/api/pages');
    assert.equal(hits, 0);
  } finally { await srv.stop(); }
});

test(T('updates', 'A newer version on GitHub is detected', 'Нова версия в GitHub се открива'), async () => {
  const srv = await startServer(box, { LIBRARY_GITHUB_BASE: base });
  try {
    const { json } = await api(srv.port, 'POST', '/api/updates/code');
    assert.equal(json.ok, true);
    assert.equal(json.status, 'behind');
    assert.equal(json.remote, '99.0.0');
    assert.equal(json.commit.message, 'New release');
  } finally { await srv.stop(); }
});

test(T('updates', 'The same version is reported as up to date', 'Същата версия се показва като актуална'), async () => {
  remoteVersion = JSON.parse(box.read('package.json')).version;
  const srv = await startServer(box, { LIBRARY_GITHUB_BASE: base });
  try { assert.equal((await api(srv.port, 'POST', '/api/updates/code')).json.status, 'same'); }
  finally { await srv.stop(); }
});

test(T('updates', 'Without a connection a clear message appears and nothing breaks', 'Без връзка се показва ясно съобщение и нищо не се чупи'), async () => {
  const srv = await startServer(box, { LIBRARY_GITHUB_BASE: 'http://127.0.0.1:9' });
  try {
    const { json } = await api(srv.port, 'POST', '/api/updates/code');
    assert.equal(json.ok, false);
    assert.ok(json.error);
    assert.equal((await api(srv.port, 'GET', '/api/stats')).status, 200);
  } finally { await srv.stop(); }
});

test(T('updates', 'Reports from npm are read correctly', 'Отчетите на npm се разчитат правилно'), () => {
  const o = parseOutdated({ unpdf: { current: '1.9.1', wanted: '1.9.1', latest: '2.1.0' }, marked: { current: '18.1.2', wanted: '18.1.3', latest: '18.1.3' } });
  assert.deepEqual(o.map((x) => [x.name, x.major]), [['marked', false], ['unpdf', true]]);
  const a = parseAudit({ metadata: { vulnerabilities: { total: 2, high: 1, low: 1 } }, vulnerabilities: { x: { name: 'x', severity: 'low' }, y: { name: 'y', severity: 'high', isDirect: true } } });
  assert.equal(a.total, 2);
  assert.equal(a.items[0].name, 'y');
});

test(T('updates', 'The application does not install anything by itself', 'Приложението не инсталира нищо само'), () => {
  const code = box.read('scripts/updates.js');
  assert.doesNotMatch(code, /'install'|'update'|git pull|'pull'/);
  // npm update се пуска само от бутона (POST /api/updates/apply) и само без инсталационните скриптове
  const server = box.read('scripts/server.js');
  assert.equal((server.match(/applyUpdates\(/g) || []).length, 1);
  assert.match(server, /app\.post\('\/api\/updates\/apply'/);
  const npmCode = box.read('scripts/npm-update.js');
  assert.match(npmCode, /'--ignore-scripts'/);
  assert.doesNotMatch(npmCode, /'install'|@latest/);
});

// ---------- Обновяване до безопасните версии (npm update) с фалшив npm: без мрежа и без истинския node_modules ----------
function fakeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-npm-'));
  const w = (rel, v) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); };
  w('package.json', { name: 'x', dependencies: { alpha: '^1.0.0', '@scope/beta': '^2.0.0' }, devDependencies: { gamma: '^3.0.0' } });
  w('package-lock.json', '{"lock":"old"}');
  w('node_modules/alpha/package.json', { version: '1.0.0' });
  w('node_modules/@scope/beta/package.json', { version: '2.0.0' });
  w('node_modules/gamma/package.json', { version: '3.0.0' });
  return { root, w, read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'), remove: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test(T('updates', 'Only packages from package.json can be updated, by their exact names', 'Обновяват се само пакети от package.json, по точните им имена'), () => {
  const p = fakeProject();
  try {
    assert.deepEqual(npmUpdate.cleanNames(p.root, ['alpha', 'alpha', '@scope/beta', 'gamma']), ['alpha', '@scope/beta', 'gamma']);
    assert.deepEqual(npmUpdate.cleanNames(p.root, []), [], 'an empty list means all');
    assert.deepEqual(npmUpdate.cleanNames(p.root, null), []);
    for (const bad of [['evil'], ['alpha; rm -rf ~'], ['--global'], ['alpha@99'], 'alpha', [{}]]) assert.equal(npmUpdate.cleanNames(p.root, bad), null, JSON.stringify(bad));
  } finally { p.remove(); }
});

test(T('updates', 'The update runs npm update without install scripts and reports what changed', 'Обновяването пуска npm update без инсталационни скриптове и казва какво се е сменило'), async () => {
  const p = fakeProject(), calls = [];
  try {
    const npm = async (_root, args) => { calls.push(args); p.w('node_modules/alpha/package.json', { version: '1.4.2' }); p.w('package-lock.json', '{"lock":"new"}'); return { ok: true }; };
    const r = await npmUpdate.updatePackages(p.root, ['alpha'], { npm });
    assert.deepEqual(calls[0].slice(0, 2), ['update', 'alpha']);
    assert.ok(calls[0].includes('--ignore-scripts'));
    assert.deepEqual(r.changed, [{ name: 'alpha', from: '1.0.0', to: '1.4.2' }]);
    assert.equal(r.lockChanged, true);
    assert.equal(r.backup, '{"lock":"old"}', 'the previous lock is kept for a rollback');
    const refused = await npmUpdate.updatePackages(p.root, ['evil'], { npm });
    assert.equal(refused.error, 'unknown-package');
    assert.equal(calls.length, 1, 'npm is not started for an unknown name');
  } finally { p.remove(); }
});

test(T('updates', 'If npm fails halfway, the previous versions come back', 'Ако npm спре по средата, предишните версии се връщат'), async () => {
  const p = fakeProject(), calls = [];
  try {
    const npm = async (_root, args) => { calls.push(args[0]); if (args[0] === 'update') { p.w('package-lock.json', '{"lock":"broken"}'); return { ok: false, error: 'ETARGET' }; } return { ok: true }; };
    const r = await npmUpdate.updatePackages(p.root, [], { npm });
    assert.equal(r.ok, false);
    assert.deepEqual(calls, ['update', 'ci']);
    assert.equal(p.read('package-lock.json'), '{"lock":"old"}');
  } finally { p.remove(); }
});

test(T('security', 'The launcher keeps the old package list to itself; the isolation never gets it', 'Стартерът пази стария списък на пакетите у себе си; клетката не го получава'), async () => {
  const p = fakeProject(), state = {};
  try {
    const npm = async () => { p.w('package-lock.json', '{"lock":"new"}'); return { ok: true }; };
    const h = sandbox.outsideHandlers(p.root, state, { npm });
    const reply = await h['npm-update']({ names: ['gamma'] });
    assert.equal(reply.ok, true);
    assert.equal('backup' in reply, false, 'the reply to the isolation has no lock file');
    assert.equal(state.backup, '{"lock":"old"}');
    const bad = await h['npm-update']({ names: ['../../x'] });
    assert.equal(bad.ok, false);
  } finally { p.remove(); }
});

test(T('updates', 'The update button refuses a package that is not in package.json', 'Бутонът за обновяване отказва пакет, който не е в package.json'), async () => {
  const srv = await startServer(box, { LIBRARY_GITHUB_BASE: base });
  try {
    // само неправилно име: с правилно npm би тръгнал срещу node_modules на проекта, който тестовото копие споделя
    const { json } = await api(srv.port, 'POST', '/api/updates/apply', { names: ['surely-not-a-dependency'] });
    assert.equal(json.ok, false);
    assert.match(json.error, /package\.json/);
    assert.equal((await api(srv.port, 'GET', '/api/stats')).status, 200, 'the server keeps running');
  } finally { await srv.stop(); }
});
