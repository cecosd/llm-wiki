// New in 2.2: installing a new version from the app, release notes with breaking changes, a retired model,
// quick drafts for every kind of text, and the levels of use. No internet: git works on local repositories,
// the "provider" is a fake server on 127.0.0.1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { T, makeSandbox, startServer, api } from './helpers.js';

let box, mod;
const imp = (rel) => import(pathToFileURL(path.join(box.root, rel)).href);
before(async () => { box = makeSandbox(); mod = { upd: await imp('scripts/updates.js'), code: await imp('scripts/code-update.js'), setup: await imp('scripts/git-setup.js'), llm: await imp('scripts/llm.js'), write: await imp('scripts/write.js') }; });
after(() => box?.remove());

// ---------- Release notes ----------
const CHANGELOG = `# Changelog

## [Unreleased]
- not a release yet

## [2.2.0] - 2026-11-20
### Added
- **Quick drafts** for every kind of text
### Breaking changes
- The \`/api/old\` route is gone
  and the old name is not accepted

## [2.1.0] - 2026-11-14
### Fixed
- A small thing
`;

test(T('updates', 'The changelog is read into versions, groups and breaking changes', 'Дневникът на промените се чете на версии, групи и несъвместими промени'), () => {
  const e = mod.upd.parseChangelog(CHANGELOG);
  assert.deepEqual(e.map((x) => x.version), ['2.2.0', '2.1.0'], 'Unreleased is skipped');
  assert.equal(e[0].date, '2026-11-20');
  assert.equal(e[0].groups[0].items[0], 'Quick drafts for every kind of text', 'markdown marks are removed');
  assert.deepEqual(e[0].breaking, ['The /api/old route is gone and the old name is not accepted'], 'a wrapped line joins its item');
  assert.equal(e[1].breaking.length, 0);
  assert.deepEqual(mod.upd.notesBetween(e, '2.1.0', '2.2.0').map((x) => x.version), ['2.2.0'], 'only what is newer than the installed version');
});

// A fake GitHub that also serves CHANGELOG.md
let fake, base, remoteVersion = '2.2.0', changelog = CHANGELOG, hits = 0;
before(async () => {
  fake = http.createServer((req, res) => {
    hits++;
    if (req.url.endsWith('/HEAD/CHANGELOG.md')) { if (!changelog) { res.statusCode = 404; return res.end('no'); } res.setHeader('content-type', 'text/plain'); return res.end(changelog); }
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/HEAD/package.json')) return res.end(JSON.stringify({ version: remoteVersion }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${fake.address().port}`;
});
after(async () => { await new Promise((r) => fake.close(r)); });

test(T('updates', 'A check returns what changed and flags breaking changes and major versions', 'Проверката връща какво е променено и отбелязва несъвместими промени и основни версии'), async () => {
  const srv = await startServer(box, { LIBRARY_GITHUB_BASE: base });
  try {
    const cur = JSON.parse(box.read('package.json')).version; // the installed version, whatever it is
    // the "newer" version is always one minor above the installed one, so the test does not break at every release
    const [maj, min] = cur.split('.').map(Number), next = `${maj}.${min + 1}.0`;
    remoteVersion = next; changelog = CHANGELOG.replace('[2.2.0]', `[${next}]`).replace('[2.1.0]', `[${cur}]`);
    const r = (await api(srv.port, 'POST', '/api/updates/code')).json;
    assert.equal(r.status, 'behind');
    assert.equal(r.notes[0].version, next);
    assert.equal(r.breaking.length, 1);
    assert.equal(r.breaks, true);
    // no changelog: the check still works, but it cannot promise anything
    changelog = ''; remoteVersion = '99.0.0';
    const q = (await api(srv.port, 'GET', '/api/updates/quick?force=1')).json;
    assert.equal(q.ok, true); assert.deepEqual(q.notes, []); assert.equal(q.major, true); assert.equal(q.breaks, true, 'a new major version always asks for attention');
    // the quiet check is cached: the second one does not ask again
    const before = hits;
    await api(srv.port, 'GET', '/api/updates/quick');
    assert.equal(hits, before);
  } finally { await srv.stop(); }
});

test(T('updates', 'Only the install button installs a new version of the program', 'Нова версия на програмата се инсталира само с бутона'), () => {
  const server = box.read('scripts/server.js');
  assert.equal((server.match(/installCodeUpdate\(/g) || []).length, 1);
  assert.match(server, /app\.post\('\/api\/updates\/code\/install'/);
  assert.doesNotMatch(box.read('scripts/updates.js'), /'pull'|'merge'|'fetch'/, 'git work lives in code-update.js');
  assert.match(box.read('scripts/sandbox.js'), /'code-update': async/, 'in the safe mode the launcher does it from outside');
});

// ---------- Installing a new version (real git, local repositories) ----------
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
function repos() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-git-'));
  const origin = path.join(dir, 'origin.git'), work = path.join(dir, 'work'), other = path.join(dir, 'other');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'clone', '-q', origin, other);
  const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put(other, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0', repository: { url: 'https://github.com/o/r.git' } }));
  put(other, 'package-lock.json', '{"v":1}');
  put(other, 'scripts/a.js', 'one');
  git(other, 'add', '-A'); git(other, 'commit', '-q', '-m', 'first'); git(other, 'push', '-q', 'origin', 'main');
  git(dir, 'clone', '-q', origin, work);
  const release = (version, files = {}, subject = `release ${version}`) => {
    git(other, 'pull', '-q', '--ff-only');
    put(other, 'package.json', JSON.stringify({ name: 'x', version, repository: { url: 'https://github.com/o/r.git' } }));
    for (const [k, v] of Object.entries(files)) put(other, k, v);
    git(other, 'add', '-A'); git(other, 'commit', '-q', '-m', subject); git(other, 'push', '-q', 'origin', 'main');
  };
  return { dir, origin, work, other, put, release, read: (rel) => fs.readFileSync(path.join(work, rel), 'utf8'), remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const npmOk = (log) => async (root, args) => { log.push(args.join(' ')); return { ok: true }; };

test(T('updates', 'A new version is fast-forwarded in, and packages are installed only when the lock file changed', 'Нова версия се прилага без разклонение, а пакетите се инсталират само ако ключовият файл се е променил'), async () => {
  const r = repos();
  try {
    r.release('1.1.0', { 'scripts/a.js': 'two' }, 'Change a');
    const log = [];
    const a = await mod.code.updateCode(r.work, { npm: npmOk(log) });
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(a.from, '1.0.0'); assert.equal(a.to, '1.1.0');
    assert.equal(r.read('scripts/a.js'), 'two');
    assert.deepEqual(a.commits, ['Change a']);
    assert.equal(a.packages, false); assert.deepEqual(log, [], 'no npm run without a lock change');
    // already current
    assert.equal((await mod.code.updateCode(r.work, { npm: npmOk(log) })).upToDate, true);
    // the lock file changes: npm ci, with install scripts off
    r.release('1.2.0', { 'package-lock.json': '{"v":2}' });
    const b = await mod.code.updateCode(r.work, { npm: npmOk(log) });
    assert.equal(b.ok, true); assert.equal(b.packages, true);
    assert.equal(log.length, 1); assert.match(log[0], /^ci .*--ignore-scripts/);
  } finally { r.remove(); }
});

test(T('updates', 'Edited program files are never overwritten without a copy and a yes', 'Променени файлове на програмата не се презаписват без копие и съгласие'), async () => {
  const r = repos();
  try {
    r.release('1.1.0', { 'scripts/a.js': 'two' });
    fs.writeFileSync(path.join(r.work, 'scripts/a.js'), 'my edit');
    const a = await mod.code.updateCode(r.work, { npm: npmOk([]) });
    assert.equal(a.ok, false); assert.equal(a.error, 'dirty'); assert.deepEqual(a.files, ['scripts/a.js']);
    assert.equal(r.read('scripts/a.js'), 'my edit', 'nothing was touched');
    const b = await mod.code.updateCode(r.work, { force: true, npm: npmOk([]) });
    assert.equal(b.ok, true);
    assert.equal(r.read('scripts/a.js'), 'two');
    assert.equal(fs.readFileSync(path.join(r.work, b.backup, 'scripts/a.js'), 'utf8'), 'my edit', 'the edit is kept in outputs/update-backup');
  } finally { r.remove(); }
});

test(T('updates', 'A copy with its own commits is not merged, and a failed npm puts the old version back', 'Копие със собствени промени не се слива, а неуспешен npm връща старата версия'), async () => {
  const r = repos();
  try {
    r.put(r.work, 'scripts/mine.js', 'mine'); git(r.work, 'add', '-A'); git(r.work, 'commit', '-q', '-m', 'mine');
    r.release('1.1.0', { 'scripts/a.js': 'two' });
    const a = await mod.code.updateCode(r.work, { npm: npmOk([]) });
    assert.equal(a.ok, false); assert.equal(a.error, 'diverged');
    git(r.work, 'reset', '-q', '--hard', 'origin/main~0'); // back to a clean clone for the next part
    git(r.work, 'fetch', '-q'); git(r.work, 'reset', '-q', '--hard', 'HEAD~0');
  } finally { r.remove(); }
  const s = repos();
  try {
    s.release('1.1.0', { 'package-lock.json': '{"v":2}', 'scripts/a.js': 'two' });
    let calls = 0;
    const failing = async () => ({ ok: ++calls > 1 ? true : false, error: 'registry down' }); // the first ci fails, the rollback ci works
    const a = await mod.code.updateCode(s.work, { npm: failing });
    assert.equal(a.ok, false); assert.equal(a.error, 'npm');
    assert.equal(s.read('scripts/a.js'), 'one', 'the code of the old version is back');
    assert.equal(JSON.parse(s.read('package.json')).version, '1.0.0');
  } finally { s.remove(); }
});

test(T('updates', 'A folder from a ZIP becomes a git clone without losing any file', 'Папка от ZIP става git клонинг без да се загуби файл'), async () => {
  const r = repos();
  try {
    const zip = path.join(r.dir, 'zip');
    fs.mkdirSync(path.join(zip, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(zip, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', repository: { url: 'https://github.com/o/r.git' } }));
    fs.writeFileSync(path.join(zip, 'scripts/a.js'), 'my edit');
    fs.mkdirSync(path.join(zip, 'raw'), { recursive: true }); fs.writeFileSync(path.join(zip, 'raw/book.txt'), 'library');
    const a = await mod.setup.ensureRepo(zip, { url: r.origin });
    assert.equal(a.ok, true); assert.equal(a.created, true);
    assert.equal(fs.readFileSync(path.join(zip, 'scripts/a.js'), 'utf8'), 'my edit', 'working files are untouched');
    assert.equal(fs.readFileSync(path.join(zip, 'raw/book.txt'), 'utf8'), 'library');
    assert.match(git(zip, 'status', '--porcelain').stdout, /scripts\/a\.js/, 'the edit shows as a change');
    assert.equal(git(zip, 'remote', 'get-url', 'origin').stdout.trim(), r.origin);
    assert.equal((await mod.setup.ensureRepo(zip, { url: r.origin })).created, false, 'running it again changes nothing');
  } finally { r.remove(); }
});

// ---------- A model that the provider no longer offers ----------
test(T('ai', 'A retired model is noticed from the provider list, without spending tokens', 'Спрян модел се забелязва от списъка на доставчика, без да се харчат токени'), async () => {
  let models = ['model-a', 'model-b'];
  const srv = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.url.endsWith('/models') ? { data: models.map((id) => ({ id })) } : {})); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = (m) => ({ provider: 'custom-test', engine: 'api', protocol: 'openai', preset: { protocol: 'openai', id: 'custom-test' }, baseUrl: `http://127.0.0.1:${srv.address().port}`, models: m, local: true });
    assert.deepEqual(await mod.llm.modelHealth(cfg({ light: 'model-a', medium: 'model-b', strong: 'model-b' })), { ok: true });
    const h = await mod.llm.modelHealth(cfg({ light: 'model-a', medium: 'model-gone', strong: 'model-gone' }));
    assert.equal(h.ok, false); assert.deepEqual(h.missing, [{ tier: 'medium', model: 'model-gone' }], 'one entry per model');
    assert.deepEqual(h.available, ['model-a', 'model-b']);
    models = []; // a list that cannot be read is not proof
    assert.equal((await mod.llm.modelHealth(cfg({ light: 'x', medium: 'x', strong: 'x' }))).ok, true);
    // the Claude subscription uses names of families: nothing to check
    assert.equal((await mod.llm.modelHealth({ engine: 'agent', protocol: 'claude-code', preset: { protocol: 'claude-code' }, baseUrl: '', models: {} })).auto, true);
    assert.equal((await mod.llm.modelHealth({ engine: 'manual', preset: {}, models: {} })).skipped, true);
  } finally { await new Promise((r) => srv.close(r)); }
});

// ---------- Quick drafts for every kind of text ----------
const page = (slug, type, title, content, extra = {}) => ({ slug, content, data: { title, type, ...extra } });
const LIB = [
  page('smith-2020-book', 'source', 'Smith (2020) Book', 'Summary.', { authors: ['Smith, J.'], year: 2020, apa: 'Smith, J. (2020). *Book*. Press.' }),
  page('smith-2020-book-ch01', 'chapter', 'Chapter 1', 'Chapter.', { book: '[[smith-2020-book]]' }),
  page('sleep', 'concept', 'Sleep', 'Sleep restores the body ([[smith-2020-book-ch01]], p. 12).\n\n## Contradictions\n\nJones doubts this ([[smith-2020-book-ch01]], p. 30).'),
  page('memory', 'concept', 'Memory', 'Memory depends on sleep ([[smith-2020-book-ch01]], p. 20).'),
  page('jones-ann', 'entity', 'Ann Jones', 'Ann Jones studies sleep ([[smith-2020-book-ch01]], p. 5).', { kind: 'person' }),
  page('sleep-vs-rest', 'comparison', 'Sleep versus rest', 'The two are compared ([[smith-2020-book-ch01]], p. 31).'),
  page('sleep-hub', 'topic', 'Sleep topic', 'Sleep is studied in many ways ([[smith-2020-book-ch01]], p. 3).'),
];
const scored = LIB.map((p, i) => ({ p, score: 10 - i }));
const heads = (md) => [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

test(T('ai', 'The quick draft arranges an essay as introduction, thesis, antithesis and conclusion', 'Бързата чернова подрежда есе като увод, теза, антитеза и заключение'), () => {
  const r = mod.write.buildLocal('Sleep and memory', { pages: LIB, scored }, 'essay');
  assert.deepEqual(heads(r.markdown).slice(0, 4), ['Introduction', 'Thesis', 'Antithesis', 'Conclusion']);
  assert.doesNotMatch(r.markdown, /\[\[/, 'citations became APA');
  assert.match(r.markdown, /Smith, 2020, p\. 12/);
  assert.match(r.markdown, /Jones doubts/, 'the antithesis comes from a contradiction in the library');
  assert.match(r.markdown, /Bibliography[\s\S]*Smith, J\. \(2020\)/);
  assert.doesNotMatch(r.markdown, /—/);
});

test(T('ai', 'Every kind of text has a quick draft; the story is an outline without citations', 'Всеки вид текст има бърза чернова; разказът е план без цитати'), () => {
  for (const g of mod.write.GENRES) {
    const r = mod.write.buildLocal('Sleep and memory', { pages: LIB, scored }, g);
    assert.ok(r && r.markdown.length > 200, g);
    assert.doesNotMatch(r.markdown, /\[\[|—/, g);
  }
  const story = mod.write.buildLocal('Sleep and memory', { pages: LIB, scored }, 'story');
  assert.doesNotMatch(story.markdown, /\(Smith, 2020/, 'no citations inside a story');
  assert.match(story.markdown, /\[Fill in:/);
  assert.match(story.markdown, /Based on[\s\S]*Smith, J\. \(2020\)/, 'the sources still appear at the end');
  const review = mod.write.buildLocal('Sleep and memory', { pages: LIB, scored }, 'review');
  assert.match(review.markdown, /\|---\|---\|---\|/, 'the review has a table of positions');
  assert.equal(mod.write.buildLocal('Nothing here', { pages: LIB, scored: [] }, 'essay'), null, 'no library material: no draft');
});

test(T('app', 'The server no longer refuses a quick draft for other kinds of text', 'Сървърът вече не отказва бърза чернова за други видове текст'), () => {
  assert.doesNotMatch(box.read('scripts/server.js'), /quick draft can only arrange/);
  assert.match(box.read('scripts/server.js'), /buildLocal\(topic, \{ pages: ctx\.pages, scored \}, genre\)/);
});

// ---------- Levels of use: a hidden menu item must never be the only way to something ----------
test(T('app', 'The levels of use only hide menu items; addresses and the Keeper level keep everything', 'Нивата на ползване само скриват точки от менюто; адресите и Пазителят запазват всичко'), () => {
  const app = box.read('scripts/viewer/app.js'), html = box.read('scripts/viewer/index.html');
  assert.match(app, /id: 'bookworm'[\s\S]*id: 'librarian'[\s\S]*id: 'keeper'/);
  assert.match(app, /parseRoute/, 'routes are not filtered by level');
  assert.doesNotMatch(app.slice(app.indexOf('function parseRoute')).slice(0, 2500), /atLeast/, 'an address always opens its page');
  for (const id of ['model', 'backup', 'updates']) assert.match(app, new RegExp(`id: '${id}', icon: '[a-z]+', min: 'bookworm'`), `${id} stays visible at the lowest level`);
  assert.match(html, /v-for="s in sections"/);
});
