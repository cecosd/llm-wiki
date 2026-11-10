// Данните за страниците: едни и същи за локалния сървър (server.js) и за статичния архив (archive.js).
// Нищо тук не чете raw/ освен когато е поискано изрично (archive: false), и нищо не пише.
import fs from 'node:fs';
import path from 'node:path';
import { WIKI, rel, wikiPages, extractLinks, ingestState } from './lib.js';
import { areaMap } from './areas.js';
import { fold } from './merge.js';
import { $t } from './i18n.js';

export const SPECIAL = new Set(['index', 'log', 'overview']);
const NAV = new Set(['index', 'log']); // технически страници: не се броят като „сочат насам“
export let TITLES = new Map();
export let AREAS = new Map(); // slug → { area, how }

export function snapshot() {
  const pages = wikiPages();
  TITLES = new Map(pages.map((p) => [p.slug, String(p.data.title || p.slug)]));
  AREAS = areaMap(pages);
  const backlinks = new Map(pages.map((p) => [p.slug, []]));
  const edges = [];
  for (const p of pages) {
    for (const l of new Set(extractLinks(p.content))) {
      if (!TITLES.has(l) || l === p.slug || NAV.has(p.slug)) continue;
      backlinks.get(l).push(p.slug);
      edges.push([p.slug, l]);
    }
  }
  return { pages, backlinks, edges };
}

/** Редът, в който страниците са вписани в wiki/index.md: slug → пореден номер на първото срещане */
export function indexOrder() {
  const order = new Map();
  try {
    const text = fs.readFileSync(path.join(WIKI, 'index.md'), 'utf8');
    for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
      const s = m[1].trim().split('/').pop();
      if (!order.has(s)) order.set(s, order.size);
    }
  } catch { /* няма index.md */ }
  return order;
}

// Markdown → четим текст: [[slug|етикет]] става заглавие, махат се символите на форматирането
export function plain(md) {
  return md
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || TITLES.get(a.trim().split('/').pop()) || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?[\s:-]+\|[\s|:-]*$/gm, ' ')
    .replace(/\|/g, ' · ')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function excerpt(content) {
  const para = content.replace(/^#.*$/gm, '').replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('>') && !s.startsWith('|') && !s.startsWith('-'));
  return plain(para || '').slice(0, 180);
}

export function summary(p, backlinks) {
  return {
    slug: p.slug, path: p.rel, title: p.data.title || p.slug, type: p.data.type || 'other',
    tags: [].concat(p.data.tags || []).map(String), updated: p.data.updated || null,
    confidence: p.data.confidence || null, format: p.data.format || null, kind: p.data.kind || null,
    authors: p.data.authors || null, year: p.data.year || null, status: p.data.status || null,
    book: p.data.type === 'chapter' ? extractLinks(String(p.data.book || ''))[0] || null : null,
    chapter: p.data.chapter ?? null, pages: p.data.pages ? String(p.data.pages) : null,
    emphasis: p.data.emphasis || null,
    area: AREAS.get(p.slug)?.area || null, areaHow: AREAS.get(p.slug)?.how || null,
    aliases: [].concat(p.data.aliases || []).map(String),
    backlinks: backlinks.get(p.slug)?.length || 0, excerpt: excerpt(p.content), special: SPECIAL.has(p.slug),
  };
}

/**
 * Всички записи от wiki/log.md, най-новите първи. Файлът расте отдолу (новото се добавя в края), а частта преди
 * първия „## “ (frontmatter и бележки) не е запис. Подреждат се по дата, а в един ден по реда във файла (по-късното
 * първо), така че запис, вмъкнат на друго място (напр. възстановен от npm run index), застава при своя ден.
 */
export function logEntries() {
  const f = path.join(WIKI, 'log.md');
  if (!fs.existsSync(f)) return [];
  const blocks = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split(/^## /m).slice(1);
  return blocks.map((b, n) => {
    const [head, ...rest] = b.split('\n');
    const body = rest.join('\n').trim();
    const m = head.match(/^(\d{4}-\d{2}-\d{2})\s+([\w-]+):\s*(.*)$/);
    return m ? { n, date: m[1], kind: m[2], title: m[3].trim(), body } : { n, date: '', kind: '', title: head.trim(), body };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.n - a.n);
}

export function lastLogEntries(n = 6) {
  return logEntries().slice(0, n);
}

/** Всички страници, в обобщен вид (за списъците) */
export function pagesList(ctx = snapshot()) {
  const { pages, backlinks } = ctx;
  return pages.map((p) => summary(p, backlinks));
}

/**
 * Една страница с всичко, което ѝ трябва: глави, навигация, обратни и изходящи връзки.
 * archive: true → без пътища към raw/ (архивът не ги съдържа).
 * ctx: готов снимък от snapshot() (архивът обхожда много страници и не чете wiki/ наново за всяка).
 * Връща null, ако страницата не съществува.
 */
export function pageDetail(slug, { archive = false, ctx = null, readerOf = null } = {}) {
  const { pages, backlinks } = ctx || snapshot();
  const p = pages.find((x) => x.slug === slug);
  if (!p) return null;
  const bySlug = new Map(pages.map((x) => [x.slug, x]));
  const outgoing = [...new Set(extractLinks(p.content))].filter((l) => bySlug.has(l) && l !== p.slug)
    .map((l) => summary(bySlug.get(l), backlinks));
  // Drill down: главите на книгата / съседните глави
  const chaptersOf = (bookSlug) => pages.filter((x) => x.data.type === 'chapter' && extractLinks(String(x.data.book || ''))[0] === bookSlug)
    .sort((a, b) => (Number(a.data.chapter) || 0) - (Number(b.data.chapter) || 0) || a.slug.localeCompare(b.slug))
    .map((x) => summary(x, backlinks));
  let chapters = null, nav = null;
  if (p.data.type === 'source') chapters = chaptersOf(p.slug);
  if (p.data.type === 'chapter') {
    const bookSlug = extractLinks(String(p.data.book || ''))[0];
    const sib = chaptersOf(bookSlug);
    const i = sib.findIndex((x) => x.slug === p.slug);
    nav = { book: bySlug.has(bookSlug) ? summary(bySlug.get(bookSlug), backlinks) : null, prev: sib[i - 1] || null, next: sib[i + 1] || null, count: sib.length };
  }
  const bookPage = p.data.type === 'chapter' ? (p.data.raw_path ? p : bySlug.get(extractLinks(String(p.data.book || ''))[0])) : p;
  // Предишна/следваща в колекцията, в реда на вписване в wiki/index.md (непосочените отиват накрая, по заглавие)
  let seq = null;
  if (!SPECIAL.has(p.slug) && p.data.type !== 'chapter') {
    const order = indexOrder();
    const same = pages.filter((x) => !SPECIAL.has(x.slug) && (x.data.type || 'other') === (p.data.type || 'other'))
      .sort((a, b) => (order.get(a.slug) ?? 1e9) - (order.get(b.slug) ?? 1e9) || String(a.data.title || a.slug).localeCompare(String(b.data.title || b.slug), 'bg'));
    const i = same.findIndex((x) => x.slug === p.slug);
    if (i >= 0 && same.length > 1) seq = { prev: same[i - 1] ? summary(same[i - 1], backlinks) : null, next: same[i + 1] ? summary(same[i + 1], backlinks) : null, pos: i + 1, total: same.length, type: p.data.type || 'other' };
  }
  const rawUrl = () => (p.data.raw_path ? (() => { const f = ingestState(pages).resolve(p.data.raw_path); return f ? '/' + rel(f).split('/').map(encodeURIComponent).join('/') : null; })() : null);
  return {
    ...summary(p, backlinks),
    chapters, nav, seq,
    // В архива четецът е само за текстовете, които са записани в архива (readerOf); на живо – книгата със суров файл
    readerSrc: archive ? (readerOf?.[p.slug] || null) : (bookPage?.data?.raw_path ? bookPage.slug : null),
    originalMissing: !archive && !!(bookPage?.data?.raw_path && !ingestState(pages).resolve(bookPage.data.raw_path)),
    data: JSON.parse(JSON.stringify(p.data)),
    content: p.content,
    backlinks: backlinks.get(p.slug).map((s) => {
      const b = summary(bySlug.get(s), backlinks);
      if (b.book && bySlug.has(b.book)) b.bookTitle = bySlug.get(b.book).data.title || b.book;
      return b;
    }),
    outgoing,
    rawUrl: archive ? null : rawUrl(),
  };
}

/** Търсене в заглавията, псевдонимите и текста на страниците (до 40 съвпадения) */
export function searchHits(q) {
  q = String(q || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const { pages, backlinks } = snapshot();
  const hits = [];
  for (const p of pages) {
    const title = (String(p.data.title || p.slug) + ' ' + [].concat(p.data.aliases || []).join(' ')).toLowerCase();
    const text = plain(p.content.replace(/^\s*#\s+.*\n/, ''));
    const body = text.toLowerCase();
    const fq = fold(q); // „Чайковский“ намира и „Чайковски“, и „Tchaikovsky“
    const inTitle = title.includes(q) || (fq.length >= 4 && fold(title).includes(fq));
    const idx = body.indexOf(q);
    if (!inTitle && idx === -1) continue;
    const count = body.split(q).length - 1;
    const start = Math.max(0, idx - 50);
    const snippet = idx === -1 ? excerpt(p.content)
      : (start ? '…' : '') + text.slice(start, idx + q.length + 90) + '…';
    hits.push({ ...summary(p, backlinks), score: (inTitle ? 100 : 0) + count, snippet });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 40);
}

/** Броячи и списъци за началната страница (без суровите файлове и обработката) */
export function contentStats() {
  const { pages, backlinks } = snapshot();
  const byType = {};
  const tags = {};
  for (const p of pages) {
    if (SPECIAL.has(p.slug)) continue;
    byType[p.data.type || 'other'] = (byType[p.data.type || 'other'] || 0) + 1;
    for (const t of [].concat(p.data.tags || [])) tags[t] = (tags[t] || 0) + 1;
  }
  const content = pages.filter((p) => !SPECIAL.has(p.slug));
  return {
    pages: content.length, byType,
    tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 30),
    recent: content.filter((p) => p.data.type !== 'chapter').sort((a, b) => String(b.data.updated || '').localeCompare(String(a.data.updated || ''))).slice(0, 8).map((p) => summary(p, backlinks)),
    lowConfidence: content.filter((p) => p.data.confidence === 'low').slice(0, 8).map((p) => summary(p, backlinks)),
    log: lastLogEntries(),
  };
}

/** Карта на връзките: възли и ребра без служебните страници */
export function graphData() {
  const { pages, backlinks, edges } = snapshot();
  return {
    nodes: pages.filter((p) => !SPECIAL.has(p.slug)).map((p) => ({ id: p.slug, title: p.data.title || p.slug, type: p.data.type || 'other', degree: backlinks.get(p.slug).length })),
    edges: edges.filter(([a, b]) => !SPECIAL.has(a) && !SPECIAL.has(b)),
  };
}
