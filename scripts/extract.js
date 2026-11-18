// Extracts text from the raw files into raw/.extracted/<path>.md, so that the agent can read them.
// Skips files whose text version is newer than the original.
// Usage: npm run extract [-- --force] [-- --ocr] [-- raw/books/x.pdf]
//   --ocr  for PDFs with almost no text (scanned): OCR with ocrmypdf if installed, otherwise with the built-in one (tesseract.js).
//          The original is not touched; the OCR copy is temporary and serves only for the text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { EXTRACTED, ROOT, rel, rawFiles } from './lib.js';
import { ocrPdf, builtinOcrAvailable } from './ocr.js';
import { scanForRaw, ocrScan, ocrBusy } from './scan.js';
import { $t } from './i18n.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const ocr = args.includes('--ocr');
const hasOcrmypdf = () => process.env.LIBRARY_OCR !== 'builtin' && spawnSync('ocrmypdf', ['--version'], { stdio: 'ignore' }).status === 0;

/** OCR of a scanned PDF into a temporary file; first with Bulgarian, then with English only */
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

let lastPages = 0; // the number of pages of the last PDF (for detecting scanned books)
async function pdf(file) {
  if (PDFTOTEXT) {
    // -layout keeps the columns; \f separates the pages -> we mark them
    const txt = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 1 << 30 }).toString();
    lastPages = txt.split('\f').length - 1 || 1;
    return txt.split('\f').map((p, i) => (p.trim() ? `\n\n<!-- стр. ${i + 1} -->\n\n${p.trim()}` : '')).join('');
  }
  // A fallback without poppler: unpdf (a current pdf.js)
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

// The old Word format (.doc, Word 97-2003): word-extractor reads the binary OLE file, without LibreOffice
async function doc(file) {
  const WordExtractor = (await import('word-extractor')).default;
  const extracted = await new WordExtractor().extract(file);
  return extracted.getBody().replace(/\r\n?/g, '\n');
}

// A cell value from exceljs -> text (formulas, dates, rich text, hyperlinks)
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v !== 'object') return String(v);
  if ('result' in v) return cellText(v.result);          // formula
  if ('richText' in v) return v.richText.map((r) => r.text).join('');
  if ('text' in v) return String(v.text);                // hyperlink
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
    const LIMIT = 200; // for large tables the agent sees the beginning + a summary
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
  '.doc': doc,
  '.xlsx': table, '.xlsm': table, '.csv': table, '.tsv': table,
  // .xls and .ods: save them as .xlsx (LibreOffice/Excel) and run extract again
  '.epub': epub,
  '.html': (f) => html(fs.readFileSync(f, 'utf8')), '.htm': (f) => html(fs.readFileSync(f, 'utf8')),
  '.md': (f) => fs.readFileSync(f, 'utf8'), '.markdown': (f) => fs.readFileSync(f, 'utf8'),
  '.txt': (f) => fs.readFileSync(f, 'utf8'),
  '.json': (f) => '```json\n' + fs.readFileSync(f, 'utf8').slice(0, 200_000) + '\n```',
};

// Only files inside raw/ (without .extracted). Claude can run `npm run extract <path>`, so a path outside raw/
// would copy a foreign file into the library, where Claude can read it. The text of the path is compared, as in
// guard-read.js: subfolders of raw/ may be links to another disk, and Claude cannot create links.
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
  // A PDF made from photos of pages: OCR of the page images (the PDF has no text layer), and what a model
  // has already read for a weak page stays (scan.js)
  const scan = ext === '.pdf' ? scanForRaw(rel(file)) : null;
  if (scan) {
    if (ocrBusy(scan.id)) { console.log($t('… {0}: OCR is already running', [rel(file)])); skipped++; continue; }
    try {
      let last = 0;
      const r = await ocrScan(scan, (d, t) => { if (d - last >= 10 || d === t) { last = d; console.log($t('   OCR page {0} of {1}', [d, t])); } });
      console.log($t('✔ {0} ({1} words)', [rel(file), r.words.toLocaleString('bg-BG')]));
      if (r.weak.length) console.log($t('⚠ {0}: OCR is weak on pages {1}; a model can read them again from “Photos of pages”.', [rel(file), r.weak.join(', ')]));
      done++;
    } catch (e) { failed.push(`${rel(file)}: ${e.message}`); }
    continue;
  }
  try {
    const text = (await handler(file)) ?? '';
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const words = text.split(/\s+/).filter(Boolean).length;
    const scanned = ext === '.pdf' && (words < 30 || words / Math.max(1, lastPages) < 15); // under 15 words per page = scanned
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
