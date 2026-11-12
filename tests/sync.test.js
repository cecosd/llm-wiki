// Резервни копия и синхронизация: цели, чужди промени в обща папка, сливане по абзаци, възстановяване.
// "Иван" е втора папка, в която тестът пише директно. Нищо не излиза извън временните папки.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { T, makeSandbox, seedLibrary, startServer, api } from './helpers.js';

let box, srv, tmp;
const P = (...a) => path.join(tmp, ...a);
const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const get = (f) => fs.readFileSync(f, 'utf8');
const make = async (name, mode, extra = {}) => {
  const dir = P(name);
  const r = await api(srv.port, 'POST', '/api/sync/targets', { name, path: dir, mode, ...extra });
  assert.ok(r.json.ok, JSON.stringify(r.json));
  return r.json.target;
};
const run = async (t, body) => (await api(srv.port, 'POST', `/api/sync/${t.id}/run`, body)).json;
const plan = async (t) => (await api(srv.port, 'POST', `/api/sync/${t.id}/plan`)).json;

const ENT = (body) => `---\ntitle: Entropy\ntype: concept\ntags: [sample]\nsources:\n  - raw/articles/sample-2020-note.txt\nrelated: []\ncreated: 2026-01-01\nupdated: 2026-01-01\nconfidence: high\n---\n\n${body}`;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-sync-'));
  box = makeSandbox();
  seedLibrary(box);
  box.write('wiki/concepts/entropy.md', ENT('# Entropy\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n'));
  box.write('.library-secrets.json', '{"key":"secret"}');
  srv = await startServer(box);
});
after(async () => { await srv?.stop(); box?.remove(); fs.rmSync(tmp, { recursive: true, force: true }); });

test(T('library', 'A target inside the library or a file is refused', 'Цел вътре в библиотеката или файл се отказва'), async () => {
  const inside = await api(srv.port, 'POST', '/api/sync/targets', { name: 'x', path: path.join(box.root, 'wiki', 'copy'), mode: 'backup' });
  assert.equal(inside.json.ok, false);
  put(P('afile'), 'x');
  const file = await api(srv.port, 'POST', '/api/sync/targets', { name: 'y', path: P('afile'), mode: 'backup' });
  assert.equal(file.json.ok, false);
});

test(T('library', 'A backup copies the library without node_modules or secrets, and later only the changes', 'Резервното копие взема библиотеката без node_modules и ключове, а после само промените'), async () => {
  const t = await make('disk-d', 'backup', { code: true });
  const r1 = await run(t, { strategy: 'push' });
  assert.ok(r1.ok, JSON.stringify(r1));
  assert.ok(fs.existsSync(P('disk-d', 'wiki/concepts/entropy.md')));
  assert.ok(fs.existsSync(P('disk-d', 'raw/articles/sample-2020-note.txt')));
  assert.ok(fs.existsSync(P('disk-d', 'scripts/sync.js')), 'code is included when asked');
  assert.ok(fs.existsSync(P('disk-d', '_machine/library.config.json')));
  assert.ok(!fs.existsSync(P('disk-d', 'node_modules')));
  assert.ok(!fs.existsSync(P('disk-d', '_machine/.library-secrets.json')), 'secrets stay out unless asked');
  assert.ok(!fs.existsSync(P('disk-d', 'outputs/.sync')));
  const r2 = await run(t, { strategy: 'push' });
  assert.equal(r2.pushed, 0, 'nothing changed');
  box.write('wiki/concepts/entropy.md', ENT('# Entropy\n\nFirst paragraph.\n\nSecond paragraph, mine.\n\nThird paragraph.\n'));
  const r3 = await run(t, { strategy: 'push' });
  assert.equal(r3.pushed, 1);
  const old = fs.readdirSync(P('disk-d', '_deleted'));
  assert.equal(old.length, 1, 'the old version is kept');
  assert.match(get(path.join(P('disk-d', '_deleted'), old[0], 'wiki/concepts/entropy.md')), /Second paragraph\./);
});

test(T('library', 'A file deleted here is moved to _deleted in a backup copy', 'Файл, изтрит при нас, отива в _deleted на резервното копие'), async () => {
  const t = await make('disk-e', 'backup');
  await run(t, { strategy: 'push' });
  box.write('wiki/concepts/temp.md', ENT('# Temp\n\nx\n'));
  await run(t, { strategy: 'push' });
  assert.ok(fs.existsSync(P('disk-e', 'wiki/concepts/temp.md')));
  fs.rmSync(path.join(box.root, 'wiki/concepts/temp.md'));
  const r = await run(t, { strategy: 'push' });
  assert.ok(r.moved >= 1);
  assert.ok(!fs.existsSync(P('disk-e', 'wiki/concepts/temp.md')));
});

test(T('library', 'A shared folder tells about changes by others and does not overwrite them', 'Обща папка казва за чужди промени и не ги презаписва'), async () => {
  const t = await make('shared', 'sync');
  assert.ok((await run(t, { strategy: 'push' })).ok);
  const them = P('shared');
  put(path.join(them, 'wiki/concepts/ivan-idea.md'), ENT('# Ivan idea\n\nNew by Ivan.\n'));
  put(path.join(them, 'raw/articles/ivan-paper.txt'), 'Ivan paper text.\n');
  put(path.join(them, 'wiki/log.md'), get(path.join(box.root, 'wiki/log.md')) + '\n## 2026-11-12 ingest: Ivan paper\n- New: [[ivan-idea]]\n');
  put(path.join(them, 'wiki/concepts/entropy.md'), ENT('# Entropy\n\nFirst paragraph.\n\nSecond paragraph, by Ivan.\n\nThird paragraph.\n\nFourth by Ivan.\n'));
  fs.rmSync(path.join(them, 'wiki/sources/sample-2020-note.md')); // Иван е изтрил: не ни интересува
  const p = await plan(t);
  assert.ok(p.needsAnswer);
  assert.deepEqual(p.incoming.map((x) => x.rel).sort(), ['raw/articles/ivan-paper.txt', 'wiki/concepts/entropy.md', 'wiki/concepts/ivan-idea.md', 'wiki/log.md']);
  assert.ok(!p.incoming.some((x) => x.rel.includes('sample-2020')), 'their deletion is not offered');
  const mine = path.join(box.root, 'wiki/concepts/entropy.md');
  const base = get(mine);
  // push-only: чуждото остава
  const r = await run(t, { strategy: 'push' });
  assert.ok(r.ok);
  assert.ok(get(path.join(them, 'wiki/concepts/entropy.md')).includes('by Ivan'), 'their change is still there');
  assert.equal(get(mine), base, 'ours is untouched');
  assert.ok(!box.exists('wiki/concepts/ivan-idea.md'));
});

test(T('library', 'Reviewing a shared folder takes chosen files and merges a conflict by paragraph', 'Прегледът на обща папка взема избрани файлове и слива конфликт по абзаци'), async () => {
  const t = (await api(srv.port, 'GET', '/api/sync')).json.targets.find((x) => x.name === 'shared');
  const them = P('shared');
  // и двамата сме променили entropy.md: ние втория абзац, Иван втория и добавил четвърти
  box.write('wiki/concepts/entropy.md', ENT('# Entropy\n\nFirst paragraph.\n\nSecond paragraph, by me.\n\nThird paragraph.\n'));
  let p = await plan(t);
  const c = p.conflicts.find((x) => x.rel === 'wiki/concepts/entropy.md');
  assert.ok(c && c.text, JSON.stringify(p.counts));
  const d = (await api(srv.port, 'POST', `/api/sync/${t.id}/diff`, { rel: c.rel })).json;
  assert.ok(d.segments.filter((s) => s.mine).length >= 2, 'two separate differences');
  const sec = d.segments.filter((s) => s.mine); // 0: втори абзац (и двамата), 1: четвърти (само той)
  const choices = sec.map((_, i) => (i === 0 ? 'm' : 't'));
  const r = await run(t, { strategy: 'review', decisions: {
    'wiki/concepts/ivan-idea.md': 'theirs', 'raw/articles/ivan-paper.txt': 'theirs', 'wiki/log.md': 'theirs', [c.rel]: { choices },
  } });
  assert.ok(r.ok, JSON.stringify(r));
  const merged = box.read('wiki/concepts/entropy.md');
  assert.match(merged, /by me/); assert.doesNotMatch(merged, /Second paragraph, by Ivan/); assert.match(merged, /Fourth by Ivan/);
  assert.ok(box.exists('wiki/concepts/ivan-idea.md'));
  assert.ok(box.exists('raw/articles/ivan-paper.txt'));
  assert.match(box.read('wiki/log.md'), /Ivan paper/);
  assert.ok(box.read('wiki/log.md').includes('Took changes from'), 'the change is written in the log');
  assert.match(box.read('wiki/index.md'), /ivan-idea/i, 'the index knows the new page');
  assert.ok(r.undoBackup && fs.existsSync(path.join(box.root, r.undoBackup, 'wiki/concepts/entropy.md')), 'our version is saved');
  assert.match(get(path.join(them, 'wiki/concepts/entropy.md')), /by me/, 'the shared folder got the merged text');
  p = await plan(t);
  assert.equal(p.counts.incoming + p.counts.conflicts, 0, 'now they are in agreement');
});

test(T('library', 'A change that is declined is not asked again, and overwrite keeps the old version', 'Отказана промяна не се пита втори път, а презаписването пази старата версия'), async () => {
  const t = (await api(srv.port, 'GET', '/api/sync')).json.targets.find((x) => x.name === 'shared');
  const them = P('shared');
  put(path.join(them, 'wiki/concepts/second-idea.md'), ENT('# Second\n\nv1\n'));
  let p = await plan(t);
  assert.equal(p.incoming.length, 1);
  await run(t, { strategy: 'review', decisions: { 'wiki/concepts/second-idea.md': 'mine' } });
  p = await plan(t);
  assert.equal(p.incoming.length, 0);
  assert.equal(p.declined.length, 1);
  put(path.join(them, 'wiki/concepts/second-idea.md'), ENT('# Second\n\nv2\n')); // нова версия: пита пак
  p = await plan(t);
  assert.equal(p.incoming.length, 1);
  // и ние сме го променили, после презаписваме
  box.write('wiki/concepts/entropy.md', ENT('# Entropy\n\nOnly mine now.\n'));
  put(path.join(them, 'wiki/concepts/entropy.md'), ENT('# Entropy\n\nIvan again.\n'));
  const r = await run(t, { strategy: 'overwrite' });
  assert.ok(r.ok);
  assert.match(get(path.join(them, 'wiki/concepts/entropy.md')), /Only mine now/);
  const kept = fs.readdirSync(path.join(them, '_deleted')).flatMap((b) => { const f = path.join(them, '_deleted', b, 'wiki/concepts/entropy.md'); return fs.existsSync(f) ? [get(f)] : []; });
  assert.ok(kept.some((x) => x.includes('Ivan again')), 'their version is kept in _deleted');
});

test(T('library', 'Restore brings the library back into an empty copy of the app', 'Възстановяването връща библиотеката в празно копие на приложението'), () => {
  const fresh = makeSandbox();
  try {
    const dry = fresh.script('sync.js', 'restore', P('disk-d'));
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(!fresh.exists('wiki/concepts/entropy.md'), 'a dry run changes nothing');
    const r = fresh.script('sync.js', 'restore', P('disk-d'), '--apply');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fresh.exists('wiki/concepts/entropy.md'));
    assert.ok(fresh.exists('raw/articles/sample-2020-note.txt'));
    assert.match(fresh.read('wiki/concepts/entropy.md'), /Second paragraph, mine/);
  } finally { fresh.remove(); }
});

test(T('library', 'Changing the processing mode does not bring back an old list of copies', 'Смяната на режима на обработка не връща стар списък с копия'), async () => {
  const box2 = makeSandbox();
  let s2;
  try {
    const first = { id: 'told', name: 'Old', path: P('old-copy'), mode: 'backup', code: false, secrets: false, keepDays: 30 };
    fs.writeFileSync(path.join(box2.root, 'library.config.json'), JSON.stringify({ contentLang: 'en', setupDone: true, sync: { targets: [first] } }));
    s2 = await startServer(box2);
    const add = await api(s2.port, 'POST', '/api/sync/targets', { name: 'New', path: P('new-copy'), mode: 'backup' });
    assert.ok(add.json.ok);
    assert.equal((await api(s2.port, 'GET', '/api/sync')).json.targets.length, 2);
    await api(s2.port, 'POST', '/api/agent/settings', { mode: 'balanced' });
    assert.equal((await api(s2.port, 'GET', '/api/sync')).json.targets.length, 2, 'the copy added after the start is still there');
  } finally { await s2?.stop(); box2.remove(); }
});
