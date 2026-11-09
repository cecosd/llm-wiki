// Статичен архив за четене: ZIP с един index.html, markdown файловете на wiki/ и текстовете за четеца (reader/*.js).
// В архива няма оригиналните файлове от raw/ (PDF, EPUB, DOCX), няма Claude и нищо не се пише обратно в библиотеката.
// Работи без сървъра:   npm run archive   → outputs/archive/library-archive-ГГГГ-ММ-ДД-ЧЧММ.zip
// От интерфейса: „Настройки“ → „Направи архив“ (маршрутите са POST /api/archive, GET и DELETE /api/archive/<име>).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { ROOT, WIKI, OUTPUTS, walk, ingestState, extractLinks } from './lib.js';
import { snapshot, pagesList, pageDetail, contentStats, graphData } from './pages-data.js';
import { readUnits, extractedFile } from './reader-data.js';
import { messagesFor, locales, contentLang, pickLang } from './i18n.js';
import { aiConfig } from './providers.js';
import { pageUnits } from './vocab.js';
import { NM, VENDOR } from './vendor.js';

const VIEWER = path.join(ROOT, 'scripts', 'viewer');
const ARCHIVE_DIR = path.join(OUTPUTS, 'archive');
const ARCHIVE_NAME = /^library-archive-[\d-]+\.zip$/;

// Всичко, което index.html зарежда от сървъра, се вгражда. Непознат адрес е грешка, а не тиха празнина.
const SCRIPT_FILES = { '/theme.js': path.join(VIEWER, 'theme.js'), '/i18n.js': path.join(VIEWER, 'i18n.js'), '/app.js': path.join(VIEWER, 'app.js') };
const FONTS = { '/fonts/inter/index.css': path.join(NM, '@fontsource-variable/inter'), '/fonts/literata/index.css': path.join(NM, '@fontsource-variable/literata') };

// Шрифтовете: само кирилица и латиница (езиците на библиотеката), иначе ZIP-ът расте без нужда
function fontCss(dir) {
  const css = fs.readFileSync(path.join(dir, 'index.css'), 'utf8');
  return css.split(/(?=\/\* )/).filter((block) => /^\/\* [\w-]+-(latin|cyrillic)/.test(block))
    .map((block) => block.replace(/url\(\.\/files\/([^)]+)\)/g, (_, file) => {
      const b64 = fs.readFileSync(path.join(dir, 'files', file)).toString('base64');
      return `url(data:font/woff2;base64,${b64})`;
    })).join('\n');
}

// Вграден JS: </script> в текста не бива да затваря тага
const inlineJs = (code) => code.replace(/<\/script/gi, '<\\/script');
// Данните в JSON: < се пише като <, за да няма затварящ таг в тях
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function localeScript(lang) {
  // От доставчика влизат само името и надписите (за „{ai}“ в текстовете), без настройки на модела
  const { name, labels } = aiConfig();
  return `window.__I18N = ${jsonForScript({ lang, locales: locales(), messages: messagesFor(lang), pageUnits: pageUnits().slice(3, -1), contentLang: contentLang(), ai: { name, labels } })};`;
}

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Текстът за четеца на една книга: страниците (или цялото, ако няма маркери) и главите. null, ако няма извлечен текст. */
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
 * Кои страници могат да се четат в архива. readerOf: страница → ключ на текста (книгата или главата със собствен файл).
 * readers: [ключ, текст] за всеки записан файл reader/<ключ>.js.
 */
function readersOf(ctx) {
  const bySlug = new Map(ctx.pages.map((p) => [p.slug, p]));
  const ingest = ingestState(ctx.pages);
  const texts = new Map(); const readerOf = {};
  for (const p of ctx.pages) {
    if (p.data.type !== 'source' && p.data.type !== 'chapter') continue;
    // Глава без собствен суров файл се чете от книгата си (както в /api/reader)
    const key = p.data.type === 'chapter' && !p.data.raw_path ? bySlug.get(extractLinks(String(p.data.book || ''))[0]) : p;
    if (!key?.data?.raw_path) continue;
    if (!texts.has(key.slug)) texts.set(key.slug, readerFor(key, ingest, ctx.pages));
    if (texts.get(key.slug)) readerOf[p.slug] = key.slug;
  }
  return { readerOf, readers: [...texts].filter(([, t]) => t) };
}

/** Всички отговори, които интерфейсът вика при четене, предварително изчислени от същите функции като сървъра. */
export function archiveApi() {
  const ctx = snapshot();
  const created = new Date();
  const { readerOf, readers } = readersOf(ctx);
  const api = {
    '/api/pages': pagesList(ctx),
    '/api/stats': { ...contentStats(), raw: 0, pending: [], inbox: [], depth: { total: 0, current: 0, legacy: [] } },
    '/api/graph': graphData(),
  };
  for (const p of ctx.pages) api['/api/page/' + p.slug] = pageDetail(p.slug, { archive: true, ctx, readerOf });
  return { api, readerOf, readers, meta: { created: localDate(created), pages: ctx.pages.length, readers: readers.length } };
}

/** index.html: същият интерфейс, вграден в една страница, с данните в lib-static */
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
      // Данните (JSON, за да се четат бързо) и подменянето на сървъра трябва да са готови преди app.js
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

/** Създава ZIP файла. Връща името, пътя и размера му. */
export function writeArchive({ lang = pickLang({ headers: {} }) } = {}) {
  const { api, readerOf, readers, meta } = archiveApi();
  const html = archiveHtml(lang, { meta, api, readerOf });
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from(html, 'utf8'));
  let mdCount = 0;
  for (const file of walk(WIKI).sort()) {
    if (!file.endsWith('.md')) continue;
    const r = path.relative(WIKI, file).split(path.sep);
    if (r[0] === '_templates') continue; // шаблоните не са съдържание на библиотеката
    zip.addFile('wiki/' + r.join('/'), fs.readFileSync(file));
    mdCount++;
  }
  // Текстовете за четеца: един JS файл за книга (зарежда се при отваряне, защото file:// не позволява fetch)
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

// ---------- Списък и изтриване на направените архиви ----------
export const isArchiveName = (name) => ARCHIVE_NAME.test(String(name));
export const archiveFile = (name) => path.join(ARCHIVE_DIR, name);

/** Архивите, най-новите първи */
export function listArchives() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs.readdirSync(ARCHIVE_DIR).filter(isArchiveName).map((name) => {
    const st = fs.statSync(archiveFile(name));
    return { name, bytes: st.size, created: st.mtime.toISOString() };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

/** Изтрива един архив. Връща false, ако името не е на архив или файлът го няма. */
export function deleteArchive(name) {
  if (!isArchiveName(name) || !fs.existsSync(archiveFile(name))) return false;
  fs.rmSync(archiveFile(name));
  return true;
}

// Пуска се директно: npm run archive
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = writeArchive();
  console.log(`Архивът е записан: ${r.file}`);
  console.log(`Страници: ${r.pages}, markdown файлове: ${r.markdown}, текстове за четеца: ${r.readers}, размер: ${(r.bytes / 1048576).toFixed(1)} MB`);
}
