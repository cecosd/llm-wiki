// Файлове и библиотека: подреждане, извличане на текст, проверки, премахване. Всичко е във временно копие.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { T, makeSandbox, seedLibrary, PROJECT } from './helpers.js';

const require = createRequire(path.join(PROJECT, 'package.json'));
let box;
before(() => { box = makeSandbox(); });
after(() => box?.remove());

/** Минимален истински PDF с една страница и текст */
function tinyPdf(text) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { out += `${String(o).padStart(10, '0')} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function tinyDocx(text) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  zip.addFile('_rels/.rels', Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`));
  return zip.toBuffer();
}

const extracted = (rel) => box.read(path.join('raw/.extracted', rel.replace(/^raw\//, '') + '.md'));
const findExtracted = (needle) => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.includes(needle)) out.push(p); } };
  walk(path.join(box.root, 'raw/.extracted'));
  return out[0] ? fs.readFileSync(out[0], 'utf8') : null;
};

test(T('library', 'The inbox sorts files into folders by type and records them', 'Входящата кутия подрежда файловете по вид и ги записва'), async () => {
  box.write('raw/inbox/note.txt', 'Plain text about thermodynamics.\n');
  box.write('raw/inbox/table.csv', 'city,people\nSofia,1200000\n');
  box.write('raw/inbox/clip.html', '<html><body><h1>Clipped page</h1><p>Web text about rivers.</p></body></html>');
  fs.writeFileSync(path.join(box.root, 'raw/inbox/paper.pdf'), tinyPdf('Hello from a tiny PDF about bridges'));
  fs.writeFileSync(path.join(box.root, 'raw/inbox/doc.docx'), tinyDocx('Word text about contracts'));
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Data').addRow(['metal', 'density']);
  await wb.xlsx.writeFile(path.join(box.root, 'raw/inbox/sheet.xlsx'));

  const r = box.script('inbox.js');
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['raw/articles/note.txt', 'raw/data/table.csv', 'raw/web/clip.html', 'raw/papers/paper.pdf', 'raw/articles/doc.docx', 'raw/data/sheet.xlsx']) assert.ok(box.exists(f), f);
  const manifest = JSON.parse(box.read('raw/manifest.json'));
  assert.ok(JSON.stringify(manifest).includes('note.txt'));
});

test(T('library', 'The same file uploaded twice is detected as a duplicate', 'Един и същ файл, качен два пъти, се разпознава като дубликат'), () => {
  box.write('raw/inbox/note-copy.txt', 'Plain text about thermodynamics.\n');
  assert.equal(box.script('inbox.js').status, 0);
  assert.ok(box.exists('raw/inbox/note-copy.txt'), 'stays in the inbox');
  assert.equal(box.exists('raw/articles/note-copy.txt'), false);
  fs.rmSync(path.join(box.root, 'raw/inbox/note-copy.txt'));
});

test(T('library', 'Text is extracted from TXT, CSV, HTML, PDF, DOCX and XLSX', 'Извлича се текст от TXT, CSV, HTML, PDF, DOCX и XLSX'), () => {
  const r = box.script('extract.js');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(findExtracted('note') || '', /thermodynamics/);
  assert.match(findExtracted('table') || '', /Sofia/);
  assert.match(findExtracted('clip') || '', /rivers/);
  assert.match(findExtracted('paper') || '', /bridges/);
  assert.match(findExtracted('doc') || '', /contracts/);
  assert.match(findExtracted('sheet') || '', /density/);
});

test(T('library', 'PDF text keeps the page markers that citations depend on', 'Текстът от PDF пази маркерите за страници, от които зависят цитатите'), () => {
  assert.match(findExtracted('paper') || '', /<!-- стр\. 1 -->/);
});

test(T('library', 'Original files are never changed', 'Оригиналните файлове не се променят'), () => {
  assert.equal(box.read('raw/articles/note.txt'), 'Plain text about thermodynamics.\n');
  const before = fs.readFileSync(path.join(box.root, 'raw/papers/paper.pdf'));
  box.script('extract.js', '--force');
  assert.ok(before.equals(fs.readFileSync(path.join(box.root, 'raw/papers/paper.pdf'))));
});

test(T('library', 'Pending files are listed for processing', 'Необработените файлове се показват за обработка'), () => {
  const r = box.script('status.js', '--pending');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /raw\/articles\/note\.txt/);
});

test(T('library', 'A file with a source page no longer counts as pending', 'Файл със source страница вече не се брои за необработен'), () => {
  seedLibrary(box);
  const r = box.script('status.js', '--pending');
  assert.doesNotMatch(r.stdout, /sample-2020-note/);
});

test(T('library', 'The link check finds broken links', 'Проверката за връзки намира счупените'), () => {
  assert.equal(box.script('lint.js', '--quick').status, 0);
  box.write('wiki/concepts/broken.md', '---\ntitle: Broken\ntype: concept\n---\n\nSee [[no-such-page]].\n');
  const r = box.script('lint.js', '--quick');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no-such-page/);
  fs.rmSync(path.join(box.root, 'wiki/concepts/broken.md'));
});

test(T('library', 'A new page is created from a template', 'Нова страница се създава от шаблон'), () => {
  const r = box.script('new.js', 'concept', 'gravity', 'Gravity');
  assert.equal(r.status, 0, r.stderr);
  assert.match(box.read('wiki/concepts/gravity.md'), /type: concept/);
  assert.notEqual(box.script('new.js', 'concept', 'Bad Slug').status, 0);
});

test(T('library', 'Index, log and overview can be rebuilt after a loss', 'Индексът, дневникът и обзорът се възстановяват след загуба'), () => {
  fs.rmSync(path.join(box.root, 'wiki/index.md'));
  const r = box.script('index.js');
  assert.equal(r.status, 0, r.stderr);
  assert.match(box.read('wiki/index.md'), /entropy/);
});

test(T('library', 'Removing a source only previews until it is confirmed', 'Премахването на източник е само преглед до потвърждение'), () => {
  const r = box.script('remove.js', 'sample-2020-note');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(box.exists('wiki/sources/sample-2020-note.md'));
  assert.ok(box.exists('raw/articles/sample-2020-note.txt'));
});

test(T('library', 'The language pack switches the rules and templates', 'Езиковият пакет сменя правилата и шаблоните'), () => {
  const r = box.script('content.js', 'bg');
  assert.equal(r.status, 0, r.stderr);
  assert.match(box.read('CLAUDE.md'), /Лична библиотека/);
  const e = box.script('content.js', 'en');
  assert.equal(e.status, 0, e.stderr);
  assert.doesNotMatch(box.read('CLAUDE.md'), /Лична библиотека/);
});
