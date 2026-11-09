// Области на знанието (физика, история, математика…): всеки източник е в ТОЧНО една област.
//
// Правила:
//  - Източникът носи полето `area` (свободен текст, 1 до 3 думи). Областите няма готов списък: появяват се от източниците.
//  - Главата наследява областта на книгата си.
//  - Понятие, личност, тема, сравнение, въпрос: област е тази, от която има най-много цитати (връзки към източници
//    и глави). Понятие, което се ползва в няколко области, си остава една страница, в областта с повече цитати.
//    Изричен `area` в такава страница го замества (това прави „Премести“ в интерфейса).
//  - Преименуването в съществуваща област ги обединява.
// Този модул не вика Claude: класифицирането получава функция `ask` отвън.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { WIKI, today, wikiPages, extractLinks } from './lib.js';
import { $t } from './i18n.js';
import { P } from './vocab.js';

const SPECIAL = new Set(['index', 'log', 'overview']);
export const normArea = (s) => String(s ?? '').replace(/\s*[—–]\s*/g, '-').replace(/[,;|~]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
export const areaKey = (s) => normArea(s).toLowerCase();

/** slug → { area, how: 'own' | 'book' | 'cited' | 'linked' } за всички страници, които имат област */
export function areaMap(pages) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const spell = new Map(); // ключ → първо видяно изписване, за да не се разпадне „физика“ и „Физика“
  const canon = (s) => { const k = areaKey(s); if (!k) return null; if (!spell.has(k)) spell.set(k, normArea(s)); return spell.get(k); };
  const out = new Map();
  for (const p of pages) if (p.data.type === 'source' && canon(p.data.area)) out.set(p.slug, { area: canon(p.data.area), how: 'own' });
  for (const p of pages) {
    if (p.data.type !== 'chapter') continue;
    const book = extractLinks(String(p.data.book || ''))[0];
    const a = out.get(book)?.area || canon(p.data.area);
    if (a) out.set(p.slug, { area: a, how: out.get(book) ? 'book' : 'own' });
  }
  for (const p of pages) if (!out.has(p.slug) && !SPECIAL.has(p.slug) && canon(p.data.area)) out.set(p.slug, { area: canon(p.data.area), how: 'own' });
  // останалите: по цитатите към източници и глави
  const tally = (p, from) => {
    const t = new Map();
    for (const l of extractLinks(p.content)) {
      if (l === p.slug) continue;
      const a = from(l); if (!a) continue;
      t.set(a, (t.get(a) || 0) + 1);
    }
    const best = [...t.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'bg'))[0];
    return best ? best[0] : null;
  };
  const rest = pages.filter((p) => !out.has(p.slug) && !SPECIAL.has(p.slug));
  for (const p of rest) {
    const a = tally(p, (l) => { const q = bySlug.get(l); return q && ['source', 'chapter'].includes(q.data.type) ? out.get(l)?.area : null; });
    if (a) out.set(p.slug, { area: a, how: 'cited' });
  }
  // тема или сравнение без цитати: по областите на страниците, към които сочи
  for (const p of rest) if (!out.has(p.slug)) { const a = tally(p, (l) => out.get(l)?.area); if (a) out.set(p.slug, { area: a, how: 'linked' }); }
  return out;
}

/** Области с броя страници; източниците без област */
export function listAreas(pages = wikiPages()) {
  const map = areaMap(pages);
  const by = new Map();
  for (const p of pages) {
    const a = map.get(p.slug)?.area; if (!a || SPECIAL.has(p.slug)) continue;
    const e = by.get(a) || { name: a, sources: 0, pages: 0, chapters: 0 };
    e.pages++; if (p.data.type === 'source') e.sources++; if (p.data.type === 'chapter') e.chapters++;
    by.set(a, e);
  }
  const unassigned = pages.filter((p) => p.data.type === 'source' && !map.get(p.slug)).map((p) => ({ slug: p.slug, title: String(p.data.title || p.slug), format: p.data.format || null }));
  const otherNone = pages.filter((p) => !SPECIAL.has(p.slug) && p.data.type !== 'source' && p.data.type !== 'chapter' && !map.get(p.slug)).length;
  return { areas: [...by.values()].sort((a, b) => b.sources - a.sources || a.name.localeCompare(b.name, 'bg')), unassigned, otherNone };
}

/** Имената на областите на източниците, за указанието при обработка */
export function areaNames(pages = wikiPages()) {
  return [...new Set(pages.filter((p) => p.data.type === 'source' && normArea(p.data.area)).map((p) => normArea(p.data.area)))].sort((a, b) => a.localeCompare(b, 'bg'));
}

function writeData(page, mutate) {
  const m = matter(fs.readFileSync(page.file, 'utf8'));
  const d = m.data;
  for (const [k, v] of Object.entries(d)) if (v instanceof Date) d[k] = v.toISOString().slice(0, 10);
  mutate(d); d.updated = today();
  fs.writeFileSync(page.file, matter.stringify(m.content, d));
}
const logFile = () => path.join(WIKI, 'log.md');
const logRefactor = (title, lines) => fs.appendFileSync(logFile(), `\n## ${today()} refactor: ${title}\n${lines.map((l) => `- ${l}`).join('\n')}\n`);

/** Сменя областта на страница ('' = маха). Глава следва книгата си. */
export function setArea(slug, area) {
  const pages = wikiPages(), page = pages.find((p) => p.slug === slug);
  if (!page || SPECIAL.has(slug)) return { ok: false, error: $t('This page has no area.') };
  if (page.data.type === 'chapter') return { ok: false, error: $t('A chapter follows the area of its book. Change the area of the book.') };
  const a = normArea(area);
  const had = areaMap(pages).get(slug)?.area || null;
  // ако вече има такава област с друго изписване, ползваме нейното
  const known = areaNames(pages).find((n) => areaKey(n) === areaKey(a));
  writeData(page, (d) => { if (a) d.area = known || a; else delete d.area; });
  const title = String(page.data.title || slug);
  logRefactor(`${P('Area of')} “${title}”`, [`${had || P('no area')} → ${known || a || P('no area')}`]);
  return { ok: true, slug, title, bits: [$t('area: {0} → {1}', [had || $t('none'), known || a || $t('none')])] };
}

/** Преименува област; ако новото име вече съществува, областите се обединяват. */
export function renameArea(from, to) {
  const pages = wikiPages();
  const f = areaKey(from), t = normArea(to);
  if (!f) return { ok: false, error: $t('There is no area to rename.') };
  if (!t) return { ok: false, error: $t('The new name cannot be empty.') };
  const hit = pages.filter((p) => areaKey(p.data.area) === f);
  if (!hit.length) return { ok: false, error: $t('This area is not recorded in any page.') };
  const existing = areaNames(pages).find((n) => areaKey(n) === areaKey(t) && areaKey(n) !== f);
  const target = existing || t;
  if (areaKey(target) === f && normArea(hit[0].data.area) === target) return { ok: false, error: $t('No change.') };
  for (const p of hit) writeData(p, (d) => { d.area = target; });
  const merged = !!existing;
  logRefactor(merged ? `${P('Areas merged')}: “${normArea(from)}” → “${target}”` : `${P('Area renamed')}: “${normArea(from)}” → “${target}”`, [`${hit.length} ${P('pages')}`]);
  return { ok: true, slug: 'areas', title: target, bits: [$t('{0} area “{1}” → “{2}” ({3} pages)', [merged ? $t('merged') : $t('renamed'), normArea(from), target, hit.length])] };
}

// ---------- Автоматично определяне с Claude ----------
const SRC_LIMIT = 70;
export function unassignedSources(pages = wikiPages()) {
  const map = areaMap(pages);
  return pages.filter((p) => p.data.type === 'source' && !map.get(p.slug));
}
/** Текстът, който се праща към Claude (и по който се оценява цената) */
export function classifyPrompt(pages = wikiPages()) {
  const list = unassignedSources(pages).slice(0, SRC_LIMIT);
  const known = areaNames(pages);
  const rows = list.map((p) => {
    const authors = [].concat(p.data.authors || []).slice(0, 2).join(', ');
    const tags = [].concat(p.data.tags || []).slice(0, 5).join(', ');
    return `${p.slug} | ${String(p.data.title || p.slug).slice(0, 120)} | ${authors} | ${p.data.year || ''} | ${tags} | ${String(p.data.emphasis || '').slice(0, 160)}`;
  });
  return { count: list.length, total: unassignedSources(pages).length, text: [
    P('Determine the scientific area of each of the listed sources of the human\'s personal library. One area per source.'),
    '',
    P('RULES'),
    P('- An area is a broad field of knowledge (e.g. Biology, Physics, Mathematics, Chemistry, History, Computer science), not a narrow topic.'),
    P('- Existing areas: {0}. Use them EXACTLY as written when they fit. Create a new area only if none fits.', [known.length ? known.join(', ') : P('(none yet)')]),
    P('- The names are in English, 1 to 3 words, with a capital first letter, no em dash.'),
    P('- Rely only on the data below. Do not open files.'),
    '',
    P('SOURCES (slug | title | authors | year | tags | emphasis):'),
    ...rows,
    '',
    P('FORMAT: only one JSON object, with no text before or after it and no ```:'),
    '{"assignments":[{"slug":"...","area":"..."}]}',
  ].join('\n') };
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

/** ask(prompt) → { ok, text }. Връща предложение за преглед; нищо не се записва. */
export async function proposeClassification(ask) {
  const pages = wikiPages();
  const { count, total, text } = classifyPrompt(pages);
  if (!count) return { ok: false, kind: 'empty', error: $t('All sources already have an area.') };
  const r = await ask(text);
  if (!r.ok) return r;
  const j = parseJson(r.text);
  if (!j || !Array.isArray(j.assignments)) return { ok: false, kind: 'format', error: $t('{ai} returned an answer in an unexpected form. Try again or with a more powerful level.'), detail: String(r.text).slice(0, 500) };
  const bySlug = new Map(unassignedSources(pages).map((p) => [p.slug, p]));
  const known = areaNames(pages);
  const items = [];
  for (const a of j.assignments) {
    const slug = String(a?.slug || '').trim(), p = bySlug.get(slug), area = normArea(a?.area);
    if (!p || !area || items.some((x) => x.slug === slug)) continue;
    const existing = known.find((n) => areaKey(n) === areaKey(area));
    items.push({ slug, title: String(p.data.title || slug), area: existing || area, isNew: !existing });
  }
  if (!items.length) return { ok: false, kind: 'format', error: $t('{ai} did not determine an area for any source.') };
  return { ok: true, items, remaining: Math.max(0, total - count), known };
}

export function applyAssignments(list) {
  const pages = wikiPages(), by = new Map(pages.map((p) => [p.slug, p]));
  let n = 0; const names = new Set();
  const known = areaNames(pages);
  for (const a of [].concat(list || [])) {
    const p = by.get(String(a?.slug || '')), area = normArea(a?.area);
    if (!p || p.data.type !== 'source' || !area) continue;
    const name = known.find((k) => areaKey(k) === areaKey(area)) || area;
    writeData(p, (d) => { d.area = name; }); names.add(name); n++;
    if (!known.some((k) => areaKey(k) === areaKey(name))) known.push(name);
  }
  if (!n) return { ok: false, error: $t('There is nothing to save.') };
  logRefactor(P('Areas assigned to sources'), [`${n} ${P('sources in')}: ${[...names].join(', ')}`]);
  return { ok: true, slug: 'areas', title: `${n} ${n === 1 ? $t('source') : $t('sources')}`, bits: [$t('area of {0} {1} ({2})', [n, n === 1 ? $t('source') : $t('sources'), [...names].join(', ')])] };
}

/** Страниците, които влизат в обхвата: избрани области и/или избрани теми (фокус) */
export function scopeFilter(pages, { areas = [], focus = [] } = {}) {
  const A = new Set(areas.map(areaKey).filter(Boolean)), F = new Set(focus);
  if (!A.size && !F.size) return null;
  const map = areaMap(pages);
  let keep = null;
  if (F.size) {
    keep = new Set(F);
    const bySlug = new Map(pages.map((p) => [p.slug, p]));
    for (const s of F) for (const l of extractLinks(bySlug.get(s)?.content || '')) keep.add(l);
    for (const p of pages) if (extractLinks(p.content).some((l) => F.has(l))) keep.add(p.slug);
  }
  return (p) => (!A.size || A.has(areaKey(map.get(p.slug)?.area))) && (!keep || keep.has(p.slug));
}
