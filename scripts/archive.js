// A static archive for reading: a ZIP with one index.html, the markdown files of wiki/ and the texts for the reader (reader/*.js).
// The archive has no original files from raw/ (PDF, EPUB, DOCX), no Claude, and nothing is written back to the library.
// Works without the server:   npm run archive   -> outputs/archive/library-archive-YYYY-MM-DD-HHMM.zip
// From the interface: "Settings" -> "Make an archive" (the routes are POST /api/archive, GET and DELETE /api/archive/<name>).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { ROOT, WIKI, OUTPUTS, walk, ingestState, extractLinks } from './lib.js';
import { snapshot, pagesList, pageDetail, contentStats, graphData, logEntries } from './pages-data.js';
import { readCollections } from './collections.js';
import { readUnits, extractedFile } from './reader-data.js';
import { messagesFor, locales, contentLang, pickLang } from './i18n.js';
import { aiConfig } from './providers.js';
import { pageUnits } from './vocab.js';
import { NM, VENDOR } from './vendor.js';

const VIEWER = path.join(ROOT, 'scripts', 'viewer');
const ARCHIVE_DIR = path.join(OUTPUTS, 'archive');
const ARCHIVE_NAME = /^library-archive-[\d-]+\.zip$/;

// Everything that index.html loads from the server is embedded. An unknown address is an error, not a silent gap.
const SCRIPT_FILES = { '/theme.js': path.join(VIEWER, 'theme.js'), '/i18n.js': path.join(VIEWER, 'i18n.js'), '/app.js': path.join(VIEWER, 'app.js'), '/scan-tools.js': path.join(VIEWER, 'scan-tools.js') };
const FONTS = { '/fonts/inter/index.css': path.join(NM, '@fontsource-variable/inter'), '/fonts/literata/index.css': path.join(NM, '@fontsource-variable/literata') };

// The fonts: only Cyrillic and Latin (the languages of the library), otherwise the ZIP grows for no reason
function fontCss(dir) {
  const css = fs.readFileSync(path.join(dir, 'index.css'), 'utf8');
  return css.split(/(?=\/\* )/).filter((block) => /^\/\* [\w-]+-(latin|cyrillic)/.test(block))
    .map((block) => block.replace(/url\(\.\/files\/([^)]+)\)/g, (_, file) => {
      const b64 = fs.readFileSync(path.join(dir, 'files', file)).toString('base64');
      return `url(data:font/woff2;base64,${b64})`;
    })).join('\n');
}

// Embedded JS: </script> inside the text must not close the tag
const inlineJs = (code) => code.replace(/<\/script/gi, '<\\/script');
// The data in JSON: < is escaped, so that no closing tag can appear in it
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function localeScript(lang) {
  // From the provider only the name and the labels get in (for "{ai}" in the texts), without the settings of the model
  const { name, labels } = aiConfig();
  return `window.__I18N = ${jsonForScript({ lang, locales: locales(), messages: messagesFor(lang), pageUnits: pageUnits().slice(3, -1), contentLang: contentLang(), ai: { name, labels } })};`;
}

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The text for the reader of one book: the pages (or the whole if there are no markers) and the chapters. null if there is no extracted text. */
function readerFor(p, ingest, pages) {
  const rawFile = ingest.resolve(p.data.raw_path);
  const ex = rawFile && extractedFile(rawFile);
  if (!ex) return null;
  const u = readUnits(ex);
  const chapters = pages.filter((x) => x.data.type === 'chapter' && extractLinks(String(x.data.book || ''))[0] === p.slug)
    .map((x) => { const [a, b] = String(x.data.pages || '').split(/[-–]/).map(Number); return { slug: x.slug, title: x.data.title || x.slug, a, b: b || a }; });
  return {
    book: { slug: p.slug, title: p.data.title || p.slug, apa: p.data.apa || null, rawUrl: null },
    unit: u.unit, order: u.order, units: Object.fromEntries(u.units), whole: u.whole,
    offset: Number(p.data.page_offset) || 0, chapters,
  };
}

/**
 * Which pages can be read in the archive. readerOf: page -> key of the text (the book or the chapter with its own file).
 * readers: [key, text] for every saved file reader/<key>.js.
 */
function readersOf(ctx) {
  const bySlug = new Map(ctx.pages.map((p) => [p.slug, p]));
  const ingest = ingestState(ctx.pages);
  const texts = new Map(); const readerOf = {};
  for (const p of ctx.pages) {
    if (p.data.type !== 'source' && p.data.type !== 'chapter') continue;
    // A chapter without its own raw file is read from its book (as in /api/reader)
    const key = p.data.type === 'chapter' && !p.data.raw_path ? bySlug.get(extractLinks(String(p.data.book || ''))[0]) : p;
    if (!key?.data?.raw_path) continue;
    if (!texts.has(key.slug)) texts.set(key.slug, readerFor(key, ingest, ctx.pages));
    if (texts.get(key.slug)) readerOf[p.slug] = key.slug;
  }
  return { readerOf, readers: [...texts].filter(([, t]) => t) };
}

/** All the answers that the interface calls when reading, precomputed by the same functions as the server. */
export function archiveApi() {
  const ctx = snapshot();
  const created = new Date();
  const { readerOf, readers } = readersOf(ctx);
  const api = {
    '/api/pages': pagesList(ctx),
    '/api/stats': { ...contentStats(), raw: 0, pending: [], inbox: [], depth: { total: 0, current: 0, legacy: [] } },
    '/api/graph': graphData(),
    '/api/log': { entries: logEntries() }, // the log, newest first
    '/api/collections': readCollections(), // the person's collections (read-only in the archive)
  };
  for (const p of ctx.pages) api['/api/page/' + p.slug] = pageDetail(p.slug, { archive: true, ctx, readerOf });
  return { api, readerOf, readers, meta: { created: localDate(created), pages: ctx.pages.length, readers: readers.length } };
}

/** index.html: the same interface, embedded in one page, with the data in lib-static */
export function archiveHtml(lang, data) {
  let html = fs.readFileSync(path.join(VIEWER, 'index.html'), 'utf8');
  const shim = fs.readFileSync(path.join(VIEWER, 'archive.js'), 'utf8');
  html = html.replace(/<link rel="stylesheet" href="(\/fonts\/[^"]+)">/g, (_, href) => {
    const dir = FONTS[href];
    if (!dir) throw new Error('Непознат шрифт за архива: ' + href);
    return `<style>\n${fontCss(dir)}\n</style>`;
  });
  html = html.replace(/<script src="(\/[^"]+)"><\/script>/g, (_, src) => {
    if (src === '/locale.js') return `<script>${inlineJs(localeScript(lang))}</script>`;
    if (src === '/app.js') {
      // The data (JSON, so that it is read fast) and the replacement of the server must be ready before app.js
      return `<script type="application/json" id="lib-static">${jsonForScript(data)}</script>\n<script>${inlineJs(shim)}</script>\n<script>${inlineJs(fs.readFileSync(SCRIPT_FILES[src], 'utf8'))}</script>`;
    }
    if (src.startsWith('/vendor/')) {
      const file = VENDOR[src.slice('/vendor/'.length)];
      if (!file) throw new Error('Непозната библиотека за архива: ' + src);
      return `<script>${inlineJs(fs.readFileSync(path.join(NM, file), 'utf8'))}</script>`;
    }
    if (SCRIPT_FILES[src]) return `<script>${inlineJs(fs.readFileSync(SCRIPT_FILES[src], 'utf8'))}</script>`;
    throw new Error('Непознат скрипт за архива: ' + src);
  });
  return html;
}

/** Creates the ZIP file. Returns its name, path and size. */
export function writeArchive({ lang = pickLang({ headers: {} }) } = {}) {
  const { api, readerOf, readers, meta } = archiveApi();
  const html = archiveHtml(lang, { meta, api, readerOf });
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from(html, 'utf8'));
  let mdCount = 0;
  for (const file of walk(WIKI).sort()) {
    if (!file.endsWith('.md')) continue;
    const r = path.relative(WIKI, file).split(path.sep);
    if (r[0] === '_templates') continue; // the templates are not content of the library
    zip.addFile('wiki/' + r.join('/'), fs.readFileSync(file));
    mdCount++;
  }
  // The texts for the reader: one JS file per book (loaded on opening, because file:// does not allow fetch)
  for (const [key, text] of readers) {
    zip.addFile(`reader/${key}.js`, Buffer.from(`(window.LIB_READER_DATA = window.LIB_READER_DATA || {})[${JSON.stringify(key)}] = ${JSON.stringify(text)};\n`, 'utf8'));
  }
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const now = new Date();
  const stamp = `${localDate(now)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const name = `library-archive-${stamp}.zip`;
  const file = path.join(ARCHIVE_DIR, name);
  zip.writeZip(file);
  return { name, file, bytes: fs.statSync(file).size, pages: meta.pages, markdown: mdCount, readers: readers.length };
}

// ---------- List and deletion of the archives made ----------
export const isArchiveName = (name) => ARCHIVE_NAME.test(String(name));
export const archiveFile = (name) => path.join(ARCHIVE_DIR, name);

/** The archives, newest first */
export function listArchives() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs.readdirSync(ARCHIVE_DIR).filter(isArchiveName).map((name) => {
    const st = fs.statSync(archiveFile(name));
    return { name, bytes: st.size, created: st.mtime.toISOString() };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

/** Deletes one archive. Returns false if the name is not an archive or the file is missing. */
export function deleteArchive(name) {
  if (!isArchiveName(name) || !fs.existsSync(archiveFile(name))) return false;
  fs.rmSync(archiveFile(name));
  return true;
}

// Run directly: npm run archive
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = writeArchive();
  console.log(`Архивът е записан: ${r.file}`);
  console.log(`Страници: ${r.pages}, markdown файлове: ${r.markdown}, текстове за четеца: ${r.readers}, размер: ${(r.bytes / 1048576).toFixed(1)} MB`);
}
