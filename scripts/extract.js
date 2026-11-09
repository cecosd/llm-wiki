// Извлича текст от raw файловете в raw/.extracted/<път>.md, за да може агентът да ги чете.
// Пропуска файлове, чиято текстова версия е по-нова от оригинала.
// Употреба: npm run extract [-- --force] [-- --ocr] [-- raw/books/x.pdf]
//   --ocr  за PDF почти без текст (сканирани): OCR с ocrmypdf, ако е инсталиран, иначе с вградения (tesseract.js).
//          Оригиналът не се пипа; OCR копието е временно и служи само за текста.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { EXTRACTED, ROOT, rel, rawFiles } from './lib.js';
import { ocrPdf, builtinOcrAvailable } from './ocr.js';
import { $t } from './i18n.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const ocr = args.includes('--ocr');
const hasOcrmypdf = () => process.env.LIBRARY_OCR !== 'builtin' && spawnSync('ocrmypdf', ['--version'], { stdio: 'ignore' }).status === 0;

/** OCR на сканиран PDF във временен файл; първо с български, после само с английски */
function ocrCopy(file) {
  const tmp = path.join(os.tmpdir(), `library-ocr-${process.pid}-${Date.now()}.pdf`);
  for (const lang of ['bul+eng', 'eng']) {
    const r = spawnSync('ocrmypdf', ['--skip-text', '--quiet', '-l', lang, file, tmp], { stdio: 'pipe' });
    if (r.status === 0 && fs.existsSync(tmp)) return tmp;
  }
  return null;
}
const only = args.filter((a) => !a.startsWith('--'));

function hasPdftotext() {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const PDFTOTEXT = hasPdftotext();

let lastPages = 0; // брой страници на последния PDF (за откриване на сканирани книги)
async function pdf(file) {
  if (PDFTOTEXT) {
    // -layout пази колоните; \f разделя страниците → маркираме ги
    const txt = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 1 << 30 }).toString();
    lastPages = txt.split('\f').length - 1 || 1;
    return txt.split('\f').map((p, i) => (p.trim() ? `\n\n<!-- стр. ${i + 1} -->\n\n${p.trim()}` : '')).join('');
  }
  // Резервен вариант без poppler: unpdf (актуален pdf.js)
  const { getDocumentProxy, extractText } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
  const { text } = await extractText(doc, { mergePages: false });
  lastPages = text.length;
  return text.map((p, i) => (p.trim() ? `\n\n<!-- стр. ${i + 1} -->\n\n${p.trim()}` : '')).join('');
}

async function docx(file) {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.convertToMarkdown({ path: file });
  return value;
}

// Стойност на клетка от exceljs → текст (формули, дати, rich text, хипервръзки)
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v !== 'object') return String(v);
  if ('result' in v) return cellText(v.result);          // формула
  if ('richText' in v) return v.richText.map((r) => r.text).join('');
  if ('text' in v) return String(v.text);                // хипервръзка
  if ('error' in v) return String(v.error);
  return '';
}

async function readSheets(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv' || ext === '.tsv') {
    const Papa = (await import('papaparse')).default;
    const { data } = Papa.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''), { skipEmptyLines: true, delimiter: ext === '.tsv' ? '\t' : '' });
    return [{ name: path.basename(file), rows: data }];
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      rows.push(Array.from({ length: ws.columnCount }, (_, i) => cellText(row.getCell(i + 1).value)));
    });
    return { name: ws.name, rows };
  });
}

async function table(file) {
  const out = [];
  for (const { name, rows } of await readSheets(file)) {
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    out.push(`## Лист: ${name}\n\nРедове: ${nonEmpty.length}, колони: ${Math.max(0, ...nonEmpty.map((r) => r.length))}\n`);
    const LIMIT = 200; // за големи таблици агентът вижда началото + обобщение
    const shown = nonEmpty.slice(0, LIMIT);
    if (shown.length) {
      const width = Math.max(...shown.map((r) => r.length));
      const fmt = (r) => '| ' + Array.from({ length: width }, (_, i) => String(r[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |';
      out.push(fmt(shown[0]), '|' + ' --- |'.repeat(width), ...shown.slice(1).map(fmt));
      if (nonEmpty.length > LIMIT) out.push(`\n… още ${nonEmpty.length - LIMIT} реда (виж оригинала).`);
    }
    out.push('');
  }
  return out.join('\n');
}

function html(src) {
  return src
    .replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n\n' + '#'.repeat(+n) + ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim();
}

async function epub(file) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(file);
  const entries = zip.getEntries();
  const container = zip.readAsText('META-INF/container.xml');
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  const opf = opfPath ? zip.readAsText(opfPath) : '';
  const base = opfPath ? path.posix.dirname(opfPath) : '';
  const manifest = Object.fromEntries([...opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => manifest[m[1]]).filter(Boolean);
  const order = spine.length ? spine.map((h) => path.posix.join(base, decodeURIComponent(h))) : entries.map((e) => e.entryName).filter((n) => /\.x?html?$/i.test(n));
  return order.map((n, i) => `\n\n<!-- раздел ${i + 1}: ${n} -->\n\n` + html(zip.readAsText(n) || '')).join('');
}

const HANDLERS = {
  '.pdf': pdf,
  '.docx': docx,
  '.xlsx': table, '.xlsm': table, '.csv': table, '.tsv': table,
  // .xls и .ods: запази ги като .xlsx (LibreOffice/Excel) и пусни extract отново
  '.epub': epub,
  '.html': (f) => html(fs.readFileSync(f, 'utf8')), '.htm': (f) => html(fs.readFileSync(f, 'utf8')),
  '.md': (f) => fs.readFileSync(f, 'utf8'), '.markdown': (f) => fs.readFileSync(f, 'utf8'),
  '.txt': (f) => fs.readFileSync(f, 'utf8'),
  '.json': (f) => '```json\n' + fs.readFileSync(f, 'utf8').slice(0, 200_000) + '\n```',
};

// Само файлове вътре в raw/ (без .extracted). Claude може да пуска `npm run extract <път>`, затова път извън raw/
// би копирал чужд файл в библиотеката, където Claude може да го прочете. Сравнява се текстът на пътя, както в
// guard-read.js: подпапки на raw/ може да са връзки към друг диск, а Claude не може да създава връзки.
const RAW_DIR = path.join(ROOT, 'raw');
function insideRaw(p) {
  const full = path.resolve(ROOT, p);
  const r = path.relative(RAW_DIR, full);
  if (!r || r === '..' || r.startsWith('..' + path.sep) || path.isAbsolute(r) || r.split(path.sep)[0] === '.extracted') return null;
  return full;
}
const refused = [];
const files = only.length
  ? only.map((p) => { const f = insideRaw(path.resolve(ROOT, p)); if (!f) refused.push(p); return f; }).filter(Boolean)
  : rawFiles();
if (refused.length) {
  console.error($t('✖ Only files inside raw/ can be extracted. Refused:\n  {0}', [refused.join('\n  ')]));
  process.exitCode = 1;
}
let done = 0, skipped = 0, unsupported = [], empty = [], failed = [];

for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  const handler = HANDLERS[ext];
  if (!handler) { unsupported.push(rel(file)); continue; }
  const out = path.join(EXTRACTED, path.relative(path.join(ROOT, 'raw'), file) + '.md');
  if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(file).mtimeMs) { skipped++; continue; }
  try {
    const text = (await handler(file)) ?? '';
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const words = text.split(/\s+/).filter(Boolean).length;
    const scanned = ext === '.pdf' && (words < 30 || words / Math.max(1, lastPages) < 15); // под 15 думи на страница = сканиран
    const header = `<!-- извлечено от ${rel(file)} | думи: ${words} | ${new Date().toISOString()} -->\n\n`;
    fs.writeFileSync(out, header + text);
    if (scanned && ocr) {
      let otext = '', engine = '';
      if (hasOcrmypdf()) {
        console.log($t('… OCR (ocrmypdf) of {0}, may take a few minutes', [rel(file)]));
        const tmp = ocrCopy(file);
        otext = tmp ? await pdf(tmp) : '';
        if (tmp) fs.rmSync(tmp, { force: true });
        engine = 'ocrmypdf';
      }
      if (otext.split(/\s+/).filter(Boolean).length < 30 && builtinOcrAvailable()) {
        console.log($t('… OCR (built in) of {0}, may take a few minutes', [rel(file)]));
        let last = 0;
        otext = await ocrPdf(file, (d, t) => { if (d - last >= 10 || d === t) { last = d; console.log($t('   OCR page {0} of {1}', [d, t])); } });
        engine = 'вграден';
      }
      const owords = otext.split(/\s+/).filter(Boolean).length;
      if (owords >= 30 && owords > words) {
        fs.writeFileSync(out, `<!-- извлечено с OCR (${engine}) от ${rel(file)} | думи: ${owords} | ${new Date().toISOString()} -->\n\n${otext}`);
        console.log($t('✔ {0} after OCR ({1} words)', [rel(file), owords.toLocaleString('bg-BG')]));
      } else { empty.push(rel(file)); console.log($t('⚠ {0}: OCR found no text', [rel(file)])); }
    } else if (scanned) empty.push(rel(file));
    console.log($t('✔ {0} ({1} words)', [rel(file), words.toLocaleString('bg-BG')]));
    done++;
  } catch (e) {
    failed.push(`${rel(file)}: ${e.message}`);
  }
}

console.log($t('\nExtracted: {0}, unchanged: {1}.', [done, skipped]));
if (empty.length) console.log($t('\n⚠ Almost no text (probably scanned, OCR needed: npm run extract -- --force --ocr <file>):\n  {0}', [empty.join('\n  ')]));
if (unsupported.length) console.log($t('\nℹ Not extracted (the agent reads them directly or they are images):\n  {0}', [unsupported.join('\n  ')]));
if (failed.length) { console.log($t('\n✖ Errors:\n  {0}', [failed.join('\n  ')])); process.exitCode = 1; }
