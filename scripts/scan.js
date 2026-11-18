// Photos of pages: the pages, already cut out and straightened in the browser (viewer/scan-tools.js), become one PDF
// in raw/books/, raw/papers/ or raw/articles/, so that the book is one source with page numbers like any other PDF.
// The text is read by OCR page by page; the pages where OCR is weak are read again by a model that sees images.
//
// Everything about one batch is kept in raw/.scans/<id>/ (hidden: the walk of raw/ skips it, so it is never a source of its own):
//   orig-001.jpg ...   the photos as they were uploaded (never changed)
//   page-001.jpg ...   the cut and straightened pages (they are in the PDF)
//   model-001.jpg ...  a smaller copy for the model (only for the weak pages)
//   scan.json          title, kind, the PDF, the corners of every page
//   ocr.json           the OCR text of every page with its confidence
//   model.json         the text that the model read for a page (it has priority over OCR and survives a new extraction)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RAW, ROOT, EXTRACTED, rel, sha256, loadManifest, saveManifest, today, slugify } from './lib.js';
import { ocrImages } from './ocr.js';
import { $t } from './i18n.js';
import { P } from './vocab.js';

export const SCANS = path.join(RAW, '.scans');
export const KINDS = { book: 'books', paper: 'papers', document: 'articles' };
export const MAX_PAGES = 1000;
const MAX_PART = 80 * 1024 * 1024; // one photo
const ID_RE = /^\d{8}-[a-f0-9]{8}$/;
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.gif'];
// Below this OCR is considered weak: few words or a low mean confidence (tesseract, 0..100)
export const WEAK_CONF = 65;
export const WEAK_WORDS = 3;
export const isWeak = (p) => !p || p.words < WEAK_WORDS || p.conf < WEAK_CONF;

const pad = (n) => String(n).padStart(3, '0');
const dirOf = (id) => {
  if (!ID_RE.test(String(id))) throw Object.assign(new Error($t('Unknown batch of photos.')), { status: 404 });
  return path.join(SCANS, id);
};
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2) + '\n'); fs.renameSync(f + '.tmp', f); };

/** A new batch. Batches older than a day that were never finished (no scan.json) are removed. */
export function newScan() {
  fs.mkdirSync(SCANS, { recursive: true });
  for (const e of fs.readdirSync(SCANS, { withFileTypes: true })) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    const d = path.join(SCANS, e.name);
    try { if (!fs.existsSync(path.join(d, 'scan.json')) && Date.now() - fs.statSync(d).mtimeMs > 864e5) fs.rmSync(d, { recursive: true, force: true }); } catch { /* the next time */ }
  }
  const id = `${today().replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
  fs.mkdirSync(path.join(SCANS, id));
  return id;
}

/**
 * Saves one uploaded part (the request body is the file). kind 'page' = the processed page (JPEG only),
 * kind 'orig' = the original photo. Resolves to { ok, file } or rejects with { status, message }.
 */
export function savePart(id, kind, n, req, filename = '') {
  return new Promise((resolve, reject) => {
    const fail = (status, message) => reject(Object.assign(new Error(message), { status }));
    let dir;
    try { dir = dirOf(id); } catch (e) { return fail(404, e.message); }
    if (!fs.existsSync(dir) || fs.existsSync(path.join(dir, 'scan.json'))) return fail(409, $t('This batch of photos is already finished.'));
    const num = Number(n);
    if (!Number.isInteger(num) || num < 1 || num > MAX_PAGES) return fail(400, $t('Invalid page number.'));
    let ext = '.jpg';
    if (kind === 'orig') { ext = path.extname(String(filename)).toLowerCase(); if (!IMG_EXT.includes(ext)) ext = '.img'; }
    else if (kind !== 'page') return fail(400, $t('Invalid page number.'));
    // a new copy of the same page replaces the old one (e.g. after a new crop)
    for (const f of fs.readdirSync(dir)) if (f.startsWith(`${kind}-${pad(num)}.`)) fs.rmSync(path.join(dir, f), { force: true });
    const target = path.join(dir, `${kind}-${pad(num)}${ext}`), tmp = target + '.part';
    const out = fs.createWriteStream(tmp);
    let bytes = 0, aborted = false;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_PART && !aborted) { aborted = true; out.destroy(); fs.rmSync(tmp, { force: true }); req.destroy(); fail(413, $t('The photo is over 80 MB.')); }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (aborted) return;
      if (kind === 'page') {
        const head = Buffer.alloc(3); const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 3, 0); fs.closeSync(fd);
        if (head[0] !== 0xff || head[1] !== 0xd8) { fs.rmSync(tmp, { force: true }); return fail(400, $t('The page must be a JPEG image.')); }
      }
      fs.renameSync(tmp, target);
      resolve({ ok: true, file: path.basename(target), bytes });
    });
    out.on('error', (e) => { if (!aborted) { fs.rmSync(tmp, { force: true }); fail(500, e.message); } });
  });
}

/** A HEIC/HEIF photo (iPhone): the file type box says "ftyp" with a HEIF brand */
export function isHeic(buf) {
  if (!buf || buf.length < 12 || buf.toString('latin1', 4, 8) !== 'ftyp') return false;
  return /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avci)$/.test(buf.toString('latin1', 8, 12));
}

/**
 * HEIC -> JPEG, because Chrome and Edge cannot open the photos of an iPhone. Decoded with libheif (heic-decode,
 * WebAssembly, no external programs), encoded with @napi-rs/canvas. The rotation stored in the photo is applied by libheif.
 * Only the main picture of the file is taken. maxSide limits the size (a 48 MP photo would be 190 MB of pixels).
 */
export async function heicToJpeg(buf, { maxSide = 4000, quality = 92 } = {}) {
  if (!isHeic(buf)) throw Object.assign(new Error($t('This is not a HEIC photo.')), { status: 400 });
  const decode = (await import('heic-decode')).default;
  const { width, height, data } = await decode({ buffer: buf });
  const { createCanvas } = await import('@napi-rs/canvas');
  const full = createCanvas(width, height);
  const ctx = full.getContext('2d');
  const id = ctx.createImageData(width, height);
  id.data.set(data);
  ctx.putImageData(id, 0, 0);
  const k = Math.min(1, maxSide / Math.max(width, height));
  if (k === 1) return full.toBuffer('image/jpeg', quality);
  const small = createCanvas(Math.round(width * k), Math.round(height * k));
  small.getContext('2d').drawImage(full, 0, 0, small.width, small.height);
  return small.toBuffer('image/jpeg', quality);
}

/** Width, height and colour components of a JPEG (from the SOF segment) */
export function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), components: buf[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * One PDF from JPEG pages, without dependencies: every page is one image (DCTDecode) over the whole page.
 * The page size assumes 200 dpi, so that an A4 photo of 2400 px gives about the size of A4.
 */
export function buildPdf(jpegs, { dpi = 200, title = '' } = {}) {
  const objs = []; // [number] = Buffer of the object body
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null), pages = add(null);
  const kids = [];
  for (const jpg of jpegs) {
    const info = jpegInfo(jpg);
    if (!info) throw new Error($t('The page must be a JPEG image.'));
    const cs = info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    const w = Math.round((info.width * 72) / dpi * 100) / 100, h = Math.round((info.height * 72) / dpi * 100) / 100;
    const img = add(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${info.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''} /Length ${jpg.length} >>\nstream\n`, 'latin1'),
      jpg, Buffer.from('\nendstream', 'latin1'),
    ]));
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    const content = add(Buffer.from(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`, 'latin1'));
    kids.push(add(Buffer.from(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`, 'latin1')));
  }
  objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pages} 0 R >>`, 'latin1');
  objs[pages - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, 'latin1');
  // the title in UTF-16BE, so that Cyrillic is shown correctly by the readers
  const titleHex = title ? 'FEFF' + Buffer.from(String(title), 'utf16le').swap16().toString('hex').toUpperCase() : '';
  const infoObj = add(Buffer.from(`<< /Producer (LLM Wiki)${titleHex ? ` /Title <${titleHex}>` : ''} >>`, 'latin1'));
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(offset);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(b); offset += b.length;
  });
  const xref = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)].join('\n');
  parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

const pagesOf = (dir) => fs.readdirSync(dir).filter((f) => /^page-\d{3}\.jpg$/.test(f)).sort();

/**
 * Finishes a batch: checks that the pages are 1..N without gaps, builds the PDF in the folder for the kind,
 * records it in manifest.json and writes scan.json. Returns { ok, pdf (raw path), pages }.
 */
export function finishScan(id, { title, kind, layout } = {}) {
  const dir = dirOf(id);
  if (!fs.existsSync(dir)) throw Object.assign(new Error($t('Unknown batch of photos.')), { status: 404 });
  if (fs.existsSync(path.join(dir, 'scan.json'))) throw Object.assign(new Error($t('This batch of photos is already finished.')), { status: 409 });
  const name = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!name) throw Object.assign(new Error($t('Write a title.')), { status: 400 });
  const folder = KINDS[kind];
  if (!folder) throw Object.assign(new Error($t('Choose what the photos are.')), { status: 400 });
  const files = pagesOf(dir);
  if (!files.length) throw Object.assign(new Error($t('There are no pages.')), { status: 400 });
  if (files.some((f, i) => f !== `page-${pad(i + 1)}.jpg`)) throw Object.assign(new Error($t('Some pages did not upload. Try again.')), { status: 400 });
  const pdf = buildPdf(files.map((f) => fs.readFileSync(path.join(dir, f))), { title: name });
  const base = slugify(name) || 'scan';
  const targetDir = path.join(RAW, folder);
  fs.mkdirSync(targetDir, { recursive: true });
  let target = path.join(targetDir, `${base}.pdf`);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(targetDir, `${base}-${i}.pdf`);
  fs.writeFileSync(target, pdf);
  const rawPath = rel(target);
  const manifest = loadManifest();
  manifest.files[rawPath] = { sha256: sha256(target), folder, added: today(), bytes: pdf.length, original_name: $t('{0} photos of pages', [files.length]), scan: id };
  saveManifest(manifest);
  const pages = Array.isArray(layout) ? layout.slice(0, files.length).map((p) => ({
    corners: Array.isArray(p?.corners) ? p.corners.slice(0, 4).map((c) => ({ x: +Number(c?.x).toFixed(4) || 0, y: +Number(c?.y).toFixed(4) || 0 })) : null,
    angle: Number(p?.angle) || 0, color: !!p?.color, name: String(p?.name || '').slice(0, 200),
  })) : [];
  writeJson(path.join(dir, 'scan.json'), { id, title: name, kind, pdf: rawPath, created: new Date().toISOString(), pages: files.length, layout: pages });
  return { ok: true, pdf: rawPath, pages: files.length };
}

/** The record of a batch by id (or null) */
export function scanRecord(id) {
  try { return readJson(path.join(dirOf(id), 'scan.json'), null); } catch { return null; }
}

/** The batch whose PDF is this raw path (for extract.js), or null */
export function scanForRaw(rawPath) {
  if (!fs.existsSync(SCANS)) return null;
  const want = String(rawPath).replace(/\\/g, '/');
  for (const e of fs.readdirSync(SCANS)) {
    if (!ID_RE.test(e)) continue;
    const r = readJson(path.join(SCANS, e, 'scan.json'), null);
    if (r && r.pdf === want) return r;
  }
  return null;
}

const extractedOf = (rawPath) => path.join(EXTRACTED, path.relative(RAW, path.join(ROOT, rawPath)) + '.md');

/** The text of every page: what the model read has priority over OCR */
export function pageTexts(id) {
  const dir = dirOf(id);
  const ocr = readJson(path.join(dir, 'ocr.json'), []), model = readJson(path.join(dir, 'model.json'), {});
  return ocr.map((p, i) => ({ n: i + 1, text: model[i + 1] ?? p?.text ?? '', conf: p?.conf ?? 0, words: p?.words ?? 0, by: model[i + 1] != null ? 'model' : 'ocr' }));
}

/** Writes raw/.extracted/<pdf>.md from the pages, with the markers <!-- стр. N --> */
export function writeExtracted(rec) {
  const pages = pageTexts(rec.id);
  const byModel = pages.filter((p) => p.by === 'model').length;
  const body = pages.map((p) => (p.text.trim() ? `\n\n<!-- стр. ${p.n} -->\n\n${p.text.trim()}` : '')).join('');
  const words = pages.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);
  const engine = byModel ? `вграден + модел за ${byModel} стр.` : 'вграден';
  const out = extractedOf(rec.pdf);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `<!-- извлечено с OCR (${engine}) от ${rec.pdf} | думи: ${words} | ${new Date().toISOString()} -->\n\n${body}`);
  return { words, file: rel(out) };
}

/** The pages where OCR is weak and no model has read them yet */
export function weakPages(id) {
  return pageTexts(id).filter((p) => p.by === 'ocr' && isWeak(p)).map((p) => p.n);
}

/** OCR of all pages of a batch, then the extracted text. onProgress(done, total). */
export async function ocrScan(rec, onProgress = () => {}) {
  const dir = dirOf(rec.id);
  const files = pagesOf(dir).map((f) => path.join(dir, f));
  const lock = path.join(dir, 'ocr.lock');
  fs.writeFileSync(lock, String(process.pid));
  let res;
  try { res = await ocrImages(files, onProgress); } finally { fs.rmSync(lock, { force: true }); }
  writeJson(path.join(dir, 'ocr.json'), res);
  const w = writeExtracted(rec);
  return { ...w, pages: files.length, weak: weakPages(rec.id) };
}

/** OCR of this batch is running now (in the server or in another extraction); an old lock (over 2 hours) does not count */
export function ocrBusy(id) {
  try { return Date.now() - fs.statSync(path.join(dirOf(id), 'ocr.lock')).mtimeMs < 2 * 3600e3; } catch { return false; }
}

/** A PDF from photos whose text is not read yet: it must not go to processing before the OCR ends */
export function scanNotReady(rawPath) {
  const rec = scanForRaw(rawPath);
  return !!rec && (ocrBusy(rec.id) || !fs.existsSync(path.join(SCANS, rec.id, 'ocr.json')));
}

/** A smaller copy of a page for the model (the long side 1568 px is what Claude reads without shrinking) */
async function modelCopy(dir, n) {
  const target = path.join(dir, `model-${pad(n)}.jpg`);
  if (fs.existsSync(target)) return target;
  const src = path.join(dir, `page-${pad(n)}.jpg`);
  try {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const img = await loadImage(fs.readFileSync(src));
    const k = Math.min(1, 1568 / Math.max(img.width, img.height));
    const c = createCanvas(Math.round(img.width * k), Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    fs.writeFileSync(target, c.toBuffer('image/jpeg', 85));
  } catch { fs.copyFileSync(src, target); } // without canvas: the page itself
  return target;
}

const readPrompt = () => [
  P('Transcribe all the text on this photo of a page exactly as it is written, in its original language.'),
  P('Keep the paragraphs and the order of reading; mark headings with #. Do not translate, do not summarize, do not correct and do not add anything.'),
  P('If a word cannot be read, write [unreadable]. If there is no text on the page, write only [no text].'),
  P('Answer only with the text of the page, without comments.'),
].join('\n');

/** Cleans the answer of the model: no code fences and no introduction like "Here is the text:" */
export function cleanTranscript(s) {
  let t = String(s || '').trim();
  t = t.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').trim();
  return t;
}

/**
 * Reads the weak pages with a model that sees images. With Claude Code the model opens the image itself (Read);
 * without tools the image goes with the request. Every page that is read is saved at once (model.json), so an
 * interruption does not lose the paid work. Returns { ok, done, failed, cost, error }.
 */
export async function readWeakWithModel(id, { pages, signal, onProgress = () => {} } = {}) {
  const rec = scanRecord(id);
  if (!rec) return { ok: false, error: $t('Unknown batch of photos.') };
  const dir = dirOf(id);
  const list = (Array.isArray(pages) && pages.length ? pages.map(Number) : weakPages(id)).filter((n) => Number.isInteger(n) && n >= 1 && n <= rec.pages);
  const { aiConfig, readiness } = await import('./providers.js');
  const cfg = aiConfig();
  if (cfg.engine === 'manual') return { ok: false, error: $t('In the copy and paste mode a model cannot read photos. Choose another way of work in Settings → Model, or leave the OCR text.') };
  if (cfg.engine !== 'agent' && !cfg.vision) return { ok: false, kind: 'no-vision', error: $t('The chosen model does not read images. Turn on “Reads images” in Settings → Model for a model that can.') };
  if (cfg.engine !== 'agent' && !readiness(cfg).ok) return { ok: false, error: $t('The model is not ready. See Settings → Model.') };
  const model = readJson(path.join(dir, 'model.json'), {});
  let done = 0, cost = 0, costKnown = true;
  const failed = [];
  let lastError = '';
  for (let i = 0; i < list.length; i++) {
    if (signal?.aborted) break;
    const n = list[i];
    const img = await modelCopy(dir, n);
    let r;
    if (cfg.engine === 'agent') {
      const { askClaude, PATH_LEVELS } = await import('./agent.js');
      const L = PATH_LEVELS.medium;
      r = await askClaude({ prompt: `${P('Open the image file {0} with the Read tool. It is a photo of page {1} of “{2}”.', [rel(img), n, rec.title])}\n\n${readPrompt()}`, model: L.model, effort: null, maxTurns: 4, timeoutMs: 240000, signal });
    } else {
      const { complete, errorText } = await import('./llm.js');
      const c = await complete({ tier: 'medium', system: '', prompt: readPrompt(), images: [{ mime: 'image/jpeg', data: fs.readFileSync(img).toString('base64') }], maxTokens: 4000, signal, label: $t('Page {0}', [n]), cfg });
      r = c.ok ? { ok: true, text: c.text, cost: c.costUsd } : { ok: false, error: errorText(c, cfg) };
    }
    if (r.ok) {
      const text = cleanTranscript(r.text);
      model[n] = /^\[(no text|няма текст)\]$/i.test(text) ? '' : text;
      writeJson(path.join(dir, 'model.json'), model);
      done++;
      if (typeof r.cost === 'number') cost += r.cost; else costKnown = false;
    } else {
      failed.push(n); lastError = r.error || '';
      if (['limit', 'auth', 'no-claude', 'cancelled', 'not-ready'].includes(r.kind)) break; // the next pages would fail too
    }
    onProgress(i + 1, list.length);
  }
  if (done) writeExtracted(rec);
  return { ok: done > 0 || !list.length, done, failed, cost: costKnown ? cost : null, error: failed.length ? lastError : '', weak: weakPages(id) };
}

/** A short public view of a batch for the interface */
export function scanView(id) {
  const rec = scanRecord(id);
  if (!rec) return null;
  const pages = pageTexts(id);
  return {
    id, title: rec.title, kind: rec.kind, pdf: rec.pdf, pages: rec.pages,
    ocr: pages.length > 0, words: pages.reduce((n, p) => n + (p.by === 'model' ? p.text.split(/\s+/).filter(Boolean).length : p.words), 0),
    weak: pages.filter((p) => p.by === 'ocr' && isWeak(p)).map((p) => p.n), byModel: pages.filter((p) => p.by === 'model').map((p) => p.n),
  };
}

