// Архивът: текстът за четеца (с. N) и списъкът на направените архиви с изтриване. Всичко е във временно копие.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { T, makeSandbox, seedLibrary, startServer, api } from './helpers.js';

let box, srv;
before(async () => {
  box = makeSandbox();
  seedLibrary(box);
  // Извлеченият текст на източника със страници (както го прави npm run extract)
  box.write('raw/.extracted/articles/sample-2020-note.txt.md', '<!-- стр. 1 -->\nПървата страница за проверка.\n<!-- стр. 2 -->\nВтората страница за проверка.\n');
  srv = await startServer(box);
});
after(async () => { await srv?.stop(); box?.remove(); });

test(T('library', 'The reader text of a source with extracted pages goes into the archive, next to index.html', 'Текстът за четеца на източник с извлечени страници влиза в архива до index.html'), () => {
  const r = box.script('archive.js');
  assert.equal(r.status, 0, r.stderr);
  const dir = path.join(box.root, 'outputs', 'archive');
  const zip = new AdmZip(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.zip'))));
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes('reader/sample-2020-note.js'), 'the reader file is in the archive');
  assert.ok(zip.readAsText('reader/sample-2020-note.js').includes('Първата страница за проверка'), 'the page text is in the reader file');
  assert.equal(names.filter((n) => n.startsWith('raw/')).length, 0, 'the original files are still not in the archive');
  const html = zip.readAsText('index.html');
  const data = JSON.parse(html.match(/<script type="application\/json" id="lib-static">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
  assert.equal(data.readerOf['sample-2020-note'], 'sample-2020-note', 'the page knows which reader text to load');
});

test(T('library', 'The archives are listed and one can be deleted', 'Направените архиви се виждат в списък и един от тях може да се изтрие'), async () => {
  const made = await api(srv.port, 'POST', '/api/archive');
  assert.equal(made.json.ok, true, JSON.stringify(made.json));
  const list = await api(srv.port, 'GET', '/api/archives');
  assert.ok(list.json.some((a) => a.name === made.json.name), 'the new archive is listed');
  const del = await api(srv.port, 'DELETE', '/api/archive/' + made.json.name);
  assert.equal(del.status, 200);
  const after2 = await api(srv.port, 'GET', '/api/archives');
  assert.ok(!after2.json.some((a) => a.name === made.json.name), 'the deleted archive is gone from the list');
  const again = await api(srv.port, 'DELETE', '/api/archive/' + made.json.name);
  assert.equal(again.status, 404, 'deleting a missing archive says so');
  const bad = await api(srv.port, 'DELETE', '/api/archive/..%2Fserver.js');
  assert.equal(bad.status, 404, 'only archive file names can be deleted');
});
