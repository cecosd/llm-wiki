// Статичният архив за четене: един index.html и markdown файловете, без raw/ и без записи. Всичко е във временно копие.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { T, makeSandbox, seedLibrary, startServer, api } from './helpers.js';

let box, srv, zipFile;
before(async () => {
  box = makeSandbox();
  seedLibrary(box);
  box.write('raw/articles/original-only.txt', 'Оригиналният текст не трябва да попадне в архива.\n');
  box.write('wiki/_templates/source.md', '# Шаблон\n');
  const r = box.script('archive.js');
  assert.equal(r.status, 0, r.stderr);
  const dir = path.join(box.root, 'outputs', 'archive');
  zipFile = path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.zip')));
  srv = await startServer(box);
});
after(async () => { await srv?.stop(); box?.remove(); });

test(T('library', 'The archive holds the markdown pages and one index.html, and no original files', 'Архивът съдържа markdown страниците и един index.html, без оригиналните файлове'), () => {
  const names = new AdmZip(zipFile).getEntries().map((e) => e.entryName);
  assert.ok(names.includes('index.html'));
  assert.ok(names.includes('wiki/sources/sample-2020-note.md'));
  assert.equal(names.filter((n) => n.startsWith('raw')).length, 0, 'raw/ must not be in the archive');
  assert.equal(names.filter((n) => n.startsWith('wiki/_templates')).length, 0, 'templates are not library content');
  assert.equal(names.filter((n) => n.startsWith('wiki/') && !n.endsWith('.md')).length, 0);
});

test(T('library', 'The archive page works offline: scripts and fonts are inside the file', 'Архивната страница работи офлайн: скриптовете и шрифтовете са вътре във файла'), () => {
  const html = new AdmZip(zipFile).readAsText('index.html');
  assert.equal([...html.matchAll(/<script src="/g)].length, 0, 'no external scripts');
  assert.equal([...html.matchAll(/<link rel="stylesheet"/g)].length, 0, 'no external stylesheets');
  assert.ok(html.includes('id="lib-static"'), 'the page data is embedded');
  assert.ok(html.includes('Sample note'), 'the pages are embedded with their titles');
  assert.equal((html.match(/<script/g) || []).length, (html.match(/<\/script>/g) || []).length, 'embedded text cannot close a script tag');
});

test(T('library', 'The archive is made from the running server and can be downloaded', 'Архивът се прави от работещия сървър и може да се свали'), async () => {
  const made = await api(srv.port, 'POST', '/api/archive');
  assert.equal(made.json.ok, true, JSON.stringify(made.json));
  assert.match(made.json.name, /^library-archive-[\d-]+\.zip$/);
  const got = await api(srv.port, 'GET', '/api/archive/' + made.json.name);
  assert.equal(got.status, 200);
  const bad = await api(srv.port, 'GET', '/api/archive/..%2Fserver.js');
  assert.equal(bad.status, 404, 'only archive file names are served');
});
