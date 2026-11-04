// Проверка за обновления срещу локален фалшив GitHub: без истински интернет.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { T, makeSandbox, startServer, api } from './helpers.js';
import { compareVersions, repoOf, parseOutdated, parseAudit } from '../scripts/updates.js';

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
});
