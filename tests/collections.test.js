// Колекциите на човека (умни и ръчни списъци, ред на видовете в менюто) и дневникът (най-новите първи).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { T, makeSandbox, startServer, api, seedLibrary } from './helpers.js';

let box, srv;
before(async () => {
  box = makeSandbox();
  seedLibrary(box);
  // Дневник, в който записите не са по ред (както след възстановяване с npm run index)
  box.write('wiki/log.md', `---
title: Log
type: topic
---

# Log

> A note before the first entry is not an entry.

## 2026-11-02 ingest: Second source
- New: [[sample-2020-note]]

## 2026-10-28 ingest: First source
- New: [[entropy]]

## 2026-11-10 refactor: Manual edit of “Entropy”
- One passage was changed by hand.

## 2026-11-10 upgrade: Upgraded “Sample note”
- Updated: [[sample-2020-note]]
`);
  srv = await startServer(box);
});
after(async () => { await srv?.stop(); box?.remove(); });

test(T('library', 'The log lists the newest entries first, without the header of the file', 'Дневникът показва най-новите записи първи, без заглавната част на файла'), async () => {
  const r = await api(srv.port, 'GET', '/api/log');
  assert.equal(r.status, 200);
  const e = r.json.entries;
  assert.equal(e.length, 4, 'the note before the first entry is not an entry');
  assert.deepEqual(e.map((x) => x.date), ['2026-11-10', '2026-11-10', '2026-11-02', '2026-10-28']);
  assert.equal(e[0].kind, 'upgrade', 'within one day the later entry in the file comes first');
  assert.equal(e[1].title, 'Manual edit of “Entropy”');
  assert.match(e[2].body, /\[\[sample-2020-note\]\]/);
  // the latest activity on the home page uses the same order
  const s = await api(srv.port, 'GET', '/api/stats');
  assert.equal(s.json.log[0].kind, 'upgrade');
});

test(T('library', 'Collections: smart and hand-made lists are saved outside wiki/', 'Колекции: умните и ръчните списъци се пазят извън wiki/'), async () => {
  const empty = await api(srv.port, 'GET', '/api/collections');
  assert.deepEqual(empty.json, { version: 1, menu: { order: [], hidden: [] }, items: [] });

  const noName = await api(srv.port, 'POST', '/api/collections', { kind: 'smart', name: '   ' });
  assert.equal(noName.json.ok, false);

  const smart = await api(srv.port, 'POST', '/api/collections', { kind: 'smart', name: 'Physics sources', filter: { types: ['source', 'Bad Type!'], areas: ['Physics'], yearFrom: '2000', yearTo: 'x', author: 'Sample' } });
  assert.equal(smart.json.ok, true);
  const f = smart.json.item.filter;
  assert.deepEqual(f.types, ['source'], 'an invalid kind is dropped');
  assert.equal(f.yearFrom, 2000);
  assert.equal(f.yearTo, null);

  const list = await api(srv.port, 'POST', '/api/collections', { kind: 'list', name: 'For my thesis', slugs: ['entropy', '../etc/passwd', 'entropy'] });
  assert.deepEqual(list.json.item.slugs, ['entropy'], 'paths and repeats are not accepted as pages');
  const id = list.json.item.id;

  await api(srv.port, 'POST', `/api/collections/${id}/pages`, { add: 'sample-2020-note' });
  let r = await api(srv.port, 'POST', `/api/collections/${id}/pages`, { move: { slug: 'sample-2020-note', dir: -1 } });
  assert.deepEqual(r.json.item.slugs, ['sample-2020-note', 'entropy']);
  r = await api(srv.port, 'POST', `/api/collections/${id}/pages`, { remove: 'entropy' });
  assert.deepEqual(r.json.item.slugs, ['sample-2020-note']);

  const toSmart = await api(srv.port, 'POST', `/api/collections/${smart.json.item.id}/pages`, { add: 'entropy' });
  assert.equal(toSmart.json.ok, false, 'pages are not added to a smart collection');

  const menu = await api(srv.port, 'POST', '/api/collections/menu', { order: ['concept', 'source'], hidden: ['question'], items: [id, smart.json.item.id] });
  assert.deepEqual(menu.json.collections.menu, { order: ['concept', 'source'], hidden: ['question'] });
  assert.deepEqual(menu.json.collections.items.map((x) => x.name), ['For my thesis', 'Physics sources']);

  assert.ok(box.exists('outputs/collections.json'), 'the file is in outputs/');
  assert.ok(!box.exists('wiki/collections.json'));
  const pages = await api(srv.port, 'GET', '/api/pages');
  assert.equal(pages.json.find((p) => p.slug === 'sample-2020-note').status, 'read', 'the reading status is available for the filter');

  const del = await api(srv.port, 'DELETE', `/api/collections/${id}`);
  assert.equal(del.json.ok, true);
  assert.equal(del.json.collections.items.length, 1);
  const missing = await api(srv.port, 'DELETE', `/api/collections/${id}`);
  assert.equal(missing.json.ok, false);
});

test(T('security', 'Collections cannot be changed without the header of the page', 'Колекциите не се променят без заглавката на страницата'), async () => {
  const { rawRequest } = await import('./helpers.js');
  const r = await rawRequest(srv.port, { method: 'POST', url: '/api/collections', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'list', name: 'x' }) });
  assert.notEqual(r.status, 200);
});
