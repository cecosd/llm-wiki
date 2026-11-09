// Конвейер: обработка без инструменти. Ползва се, когато моделът не е Claude Code (виж providers.js).
//
// Тук сървърът прави това, което агентът прави сам с инструментите си: чете извлечения текст на части, подава
// всяка част на модела като обикновен текст, получава кратък JSON или Markdown, проверява го и сам пише страниците
// по шаблоните в wiki/_templates. Затова работи и с малък локален модел и с ръчно копиране в чат: всяка стъпка е
// малка, а връзките, страниците, frontmatter, индексът и дневникът се правят от кода, не от модела.
//
// Правилата са същите като в CLAUDE.md: източникът определя акцента; книгите имат страници по глави; цитатите сочат
// към главата и към PDF страницата от маркера <!-- стр. N -->; понятията се добавят, не се презаписват; нищо не се
// измисля (непознатите [[връзки]] стават обикновен текст). Всяка задача минава през git точка на agent.js, затова
// „Върни“ работи, а при грешка половинчатите страници се връщат.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import matter from 'gray-matter';
import { ROOT, WIKI, RAW, EXTRACTED, OUTPUTS, rel, today, wikiPages, extractLinks, ingestState, normRaw, ensureStarter } from './lib.js';
import { $t, contentLang } from './i18n.js';
import { P, V, pageUnits } from './vocab.js';
import { complete, parseJsonLoose, approxTokens, clipTokens } from './llm.js';
import { readUnits } from './reader-data.js';
import { buildIndex, buildOverview } from './index.js';
import { CYR } from './merge.js';

export const TIER_OF = { haiku: 'light', sonnet: 'medium', opus: 'strong' };

/** Грешка от модела или от стъпка: kind като в llm.js (auth, limit, model, offline, format, cancelled…) */
export class AiError extends Error {
  constructor(r) { super(String(r?.error || r?.kind || 'error')); this.kind = r?.kind || 'error'; this.detail = String(r?.detail || ''); this.status = r?.status || null; this.minutes = r?.minutes || null; }
}

// ---------- Помощни ----------
const noDash = (s) => String(s ?? '').replace(/\s+[—–]\s+|—/g, ', ');
const clean = (s, n = 4000) => noDash(String(s ?? '').replace(/\r/g, '').trim()).slice(0, n).trim();
const oneLine = (s, n = 300) => clean(s, n * 2).replace(/\s+/g, ' ').trim().slice(0, n);
const arr = (x) => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]);
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const translit = (s) => [...String(s || '').toLowerCase()].map((c) => (c in CYR ? CYR[c] : c)).join('').normalize('NFKD').replace(/[̀-ͯ]/g, '');
/** Латинско kebab-case име на файл */
export const latin = (s, n = 60) => translit(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '');
/** Ключ за сравнение на заглавия (на латиница, само букви и цифри) */
const normT = (s) => translit(s).replace(/[^a-z0-9]+/g, '');

function checkAbort(ctx) { if (ctx.signal?.aborted) throw new AiError({ kind: 'cancelled' }); }

// ---------- Шаблоните (заглавията на разделите на езика на съдържанието) ----------
const FALLBACK = {
  source: ['In brief', 'Emphasis of the source', 'Key ideas', 'Chapters', 'Concepts it introduces or uses', 'Links with other sources', 'My notes'],
  chapter: ['In brief', 'Key ideas', 'Concepts it introduces or develops', 'Quote', 'Links'],
  concept: ['Definition', 'In detail', 'Examples', 'Related concepts', 'Contradictions', 'Sources'],
  entity: ['Who / what it is', 'Main contribution', 'Works and sources in the library', 'Related concepts'],
  topic: ['Overview', 'Main concepts', 'Key people', 'Sources', 'Open questions and gaps'],
  comparison: ['What we compare and why', 'Conclusions', 'Sources'],
};
function tplHeadings(type, dir = path.join(WIKI, '_templates')) {
  try { return fs.readFileSync(path.join(dir, `${type}.md`), 'utf8').split('\n').filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim()); } catch { return []; }
}
/** Заглавията на разделите на шаблон по ред */
const H = (type) => { const h = tplHeadings(type); return FALLBACK[type].map((f, i) => h[i] || P(f)); };
/** Същото заглавие на всички езици (библиотека, започната на един език, се дописва и на друг) */
function Hany(type, i) {
  const out = new Set([H(type)[i], FALLBACK[type][i]]);
  try { for (const d of fs.readdirSync(path.join(ROOT, 'content'))) { const h = tplHeadings(type, path.join(ROOT, 'content', d, 'templates')); if (h[i]) out.add(h[i]); } } catch { /* без пакети */ }
  return [...out];
}
function chapterTitle(n, title) {
  let pat = `${P('Ch.')} {{n}} {{title}}`;
  try { const t = fs.readFileSync(path.join(WIKI, '_templates', 'chapter.md'), 'utf8').match(/^# (.+)$/m)?.[1]; if (t && t.includes('{{n}}')) pat = t; } catch {}
  return pat.replace('{{n}}', n).replace('{{title}}', title).trim();
}

// ---------- Раздели в Markdown ----------
function findSection(body, names) {
  const re = new RegExp(`^##[ \\t]+(?:${names.map(esc).join('|')})[ \\t]*$`, 'mi');
  const m = re.exec(body);
  if (!m) return null;
  const contentStart = m.index + m[0].length;
  const next = body.slice(contentStart).search(/^##?[ \t]/m);
  return { start: m.index, contentStart, end: next < 0 ? body.length : contentStart + next };
}
/** Добавя текст в края на раздела; без раздел го създава (преди раздела before, ако го има, иначе накрая). */
function appendToSection(body, names, text, { create, before, list = false } = {}) {
  const s = findSection(body, names);
  if (s) {
    const head = body.slice(0, s.end).replace(/\s*$/, '');
    const isList = list && /^\s*[-*]\s/m.test(body.slice(s.contentStart, s.end).trim().split('\n').pop() || '');
    return `${head}${isList ? '\n' : '\n\n'}${text.trim()}\n\n${body.slice(s.end).replace(/^\s*/, '')}`.replace(/\s*$/, '\n');
  }
  const block = `## ${create || names[0]}\n\n${text.trim()}\n`;
  const b = before ? findSection(body, before) : null;
  if (b) return `${body.slice(0, b.start).replace(/\s*$/, '')}\n\n${block}\n${body.slice(b.start)}`;
  return `${body.replace(/\s*$/, '')}\n\n${block}`;
}
function replaceSection(body, names, text, { create, before } = {}) {
  const s = findSection(body, names);
  if (!s) return appendToSection(body, names, text, { create, before });
  return `${body.slice(0, s.contentStart)}\n\n${text.trim()}\n\n${body.slice(s.end).replace(/^\s*/, '')}`.replace(/\s*$/, '\n');
}
function addLink(body, names, slug, line, opts) {
  const s = findSection(body, names);
  if (s && extractLinks(body.slice(s.contentStart, s.end)).includes(slug)) return body;
  return appendToSection(body, names, line, { ...opts, list: true });
}

// ---------- Страници ----------
function readPage(file) {
  const m = matter(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(m.data)) if (v instanceof Date) m.data[k] = v.toISOString().slice(0, 10);
  return { data: m.data, body: m.content };
}
function writePage(ctx, file, data, body) {
  const r = rel(file);
  const existed = fs.existsSync(file);
  for (const k of Object.keys(data)) if (data[k] === undefined || data[k] === null || (Array.isArray(data[k]) && !data[k].length && !['tags', 'sources', 'related'].includes(k))) delete data[k];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(`\n${String(body).trim()}\n`, data));
  ctx.written.add(file);
  if (!existed && !ctx.job.before?.has(r)) ctx.job.created.add(r);
  else if (!ctx.job.created.has(r)) ctx.job.updated.add(r);
}
const DIRS = { source: 'sources', chapter: 'sources/chapters', concept: 'concepts', entity: 'entities', topic: 'topics', comparison: 'comparisons' };
function freeSlug(base, taken) {
  let s = base || 'page', i = 2;
  while (taken.has(s)) s = `${base}-${i++}`;
  taken.add(s);
  return s;
}
const linkOf = (s) => `[[${s}]]`;

/** Непознатите [[връзки]] стават обикновен текст: моделът не може да създаде връзка към страница, която я няма. */
function fixLinks(text, known) {
  let fixed = 0;
  const out = String(text).replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, a, b) => {
    if (known.has(a.trim().split('/').pop())) return m;
    fixed++; return b || a.trim();
  });
  return { text: out, fixed };
}

// ---------- Модел ----------
const LANG_NOTE = {
  bg: () => '',
  both: () => P('If the source is not in English, keep the original spelling of every term and name in the field "original", exactly as in the source.'),
  original: () => P('If the source is not in English, write the summaries, ideas and notes in the language of the source.'),
};
function systemPrompt(ctx) {
  return [
    P('You are the careful editor of a personal knowledge library. You get parts of texts and return exactly what is asked, in the requested form.'),
    P('Write in English, clearly and simply. Do not use an em dash (—). At the first use of a term, give the original term in parentheses.'),
    P('Do not invent facts, page numbers, authors or years. If you do not know, leave the field empty or write null.'),
    P('Paraphrase; quote verbatim at most 1 to 2 sentences.'),
    (LANG_NOTE[ctx.settings?.lang] || LANG_NOTE.bg)(),
  ].filter(Boolean).join(' ');
}
/** Колко токена текст влизат в една заявка, като остане място за отговора */
const budgetFor = (ctx, out) => Math.max(1200, Math.floor(ctx.cfg.context * 0.85) - out - approxTokens(systemPrompt(ctx)) - 900);

async function ask(ctx, { tier, prompt, json = true, maxTokens = 1500, label, images = null }) {
  checkAbort(ctx);
  ctx.usage.calls++;
  const r = await complete({ tier, system: systemPrompt(ctx), prompt, images, json, maxTokens, signal: ctx.signal, label, step: ctx.usage.calls, cfg: ctx.cfg });
  if (r.usage) { ctx.usage.in += r.usage.in || 0; ctx.usage.out += r.usage.out || 0; }
  if (r.ok) { if (typeof r.costUsd === 'number') ctx.usage.cost += r.costUsd; else ctx.usage.costKnown = false; }
  if (!r.ok) throw new AiError(r);
  return r.text;
}
const FORMAT_LINE = () => P('Return ONLY one JSON object, without text before or after it and without ```, in this form:');
async function askJson(ctx, opts, ok = (j) => j && typeof j === 'object' && !Array.isArray(j)) {
  const text = await ask(ctx, opts);
  let j = parseJsonLoose(text);
  if (ok(j)) return j;
  ctx.step({ icon: 'alert', text: $t('The answer was not valid JSON: asking for a corrected one'), warn: true });
  const fixed = await ask(ctx, {
    ...opts, label: `${opts.label || ''} (JSON)`,
    prompt: [P('Your previous answer could not be read as JSON. Return the same content as ONE valid JSON object, with no text before or after it and no ```.'), P('Expected form:'), opts.schema || '', P('Your previous answer:'), '<<<', clipTokens(text, 3000), '>>>'].join('\n'),
  });
  j = parseJsonLoose(fixed);
  if (ok(j)) return j;
  throw new AiError({ kind: 'format', detail: String(text).slice(0, 500) });
}

// ---------- Текстът на източника ----------
const marker = (unit, n) => (unit === 'разд.' ? `<!-- раздел ${n} -->` : `<!-- стр. ${n} -->`);
function joinPages(src, list) { return list.map((p) => (p.n != null ? `${marker(src.unit, p.n)}\n${p.text}` : p.text)).join('\n\n'); }
const unitAbbr = (src) => (src?.unit === 'разд.' ? P('sect.') : P('p.'));

function loadText(file) {
  const ex = path.join(EXTRACTED, path.relative(RAW, file) + '.md');
  if (!fs.existsSync(ex)) spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'extract.js'), rel(file)], { cwd: ROOT, encoding: 'utf8', timeout: 30 * 60e3, maxBuffer: 1 << 26 });
  if (!fs.existsSync(ex)) return null;
  const u = readUnits(ex);
  if (u.order.length) return { file: ex, unit: u.unit, pages: u.order.map((n) => ({ n, text: u.units.get(n) || '' })) };
  const whole = fs.readFileSync(ex, 'utf8').replace(/^<!--[^\n]*-->\s*/, '');
  return whole.trim() ? { file: ex, unit: null, pages: [{ n: null, text: whole }] } : null;
}

function splitText(text, maxTok) {
  const out = []; let cur = '';
  for (const para of String(text).split(/\n\s*\n/)) {
    if (cur && approxTokens(cur + para) > maxTok) { out.push(cur); cur = ''; }
    if (approxTokens(para) > maxTok) { for (let s = para; s; ) { const piece = clipTokens(s, maxTok); out.push(piece); s = s.slice(piece.length); } continue; }
    cur += (cur ? '\n\n' : '') + para;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
/** Разделя страниците на групи до maxTok токена (страница не се разделя, освен ако сама е твърде дълга) */
function windows(pages, maxTok) {
  const out = []; let cur = [], tok = 0;
  for (const p of pages) {
    const t = approxTokens(p.text) + 10;
    if (t > maxTok) {
      if (cur.length) { out.push(cur); cur = []; tok = 0; }
      for (const piece of splitText(p.text, maxTok)) out.push([{ n: p.n, text: piece }]);
      continue;
    }
    if (cur.length && tok + t > maxTok) { out.push(cur); cur = []; tok = 0; }
    cur.push(p); tok += t;
  }
  if (cur.length) out.push(cur);
  return out;
}

const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
function formatOf(rawPath, src) {
  const folder = rawPath.split('/')[1];
  const ext = path.extname(rawPath).toLowerCase();
  if (IMG[ext]) return 'image';
  if (ext === '.epub' || ext === '.mobi' || folder === 'books') return 'book';
  if (ext === '.pdf' && (src?.pages?.length || 0) > 80) return 'book';
  return { papers: 'paper', articles: 'article', web: 'web', data: 'dataset', notes: 'note', images: 'image' }[folder] || 'article';
}

/** Разликата между PDF и печатен номер: числото, което стои само на първия или последния ред на повечето страници */
export function guessOffset(pages) {
  const diffs = new Map(); let seen = 0;
  for (const p of pages) {
    if (p.n == null) continue;
    const lines = p.text.split('\n').map((s) => s.trim()).filter(Boolean);
    for (const c of [lines[0], lines[1], lines[lines.length - 1], lines[lines.length - 2]]) {
      const m = c && c.match(/^(?:[-–—]\s*)?(\d{1,4})(?:\s*[-–—])?$/);
      if (!m) continue;
      const d = p.n - Number(m[1]);
      if (d >= -2 && d < 300) { diffs.set(d, (diffs.get(d) || 0) + 1); seen++; }
      break;
    }
  }
  let best = null, cnt = 0;
  for (const [d, c] of diffs) if (c > cnt) { best = d; cnt = c; }
  return cnt >= 3 && cnt >= seen * 0.4 ? best : null;
}

/** Къде започва всяка глава: по заглавието в началото на страница (без страниците със съдържанието) или по печатния номер + отместването */
export function chapterRanges(list, src, offset) {
  const pages = src.pages.filter((p) => p.n != null);
  if (!pages.length || !list?.length) return [];
  const last = pages[pages.length - 1].n;
  const titles = list.map((c) => normT(c.title).slice(0, 28));
  const toc = new Set(pages.slice(0, 40).filter((p) => { const t = normT(p.text); return titles.filter((x) => x.length >= 5 && t.includes(x)).length >= 3; }).map((p) => p.n));
  const heads = pages.map((p) => ({ n: p.n, head: normT(p.text.slice(0, 700)) }));
  const out = []; let prev = pages[0].n - 1;
  list.forEach((c, i) => {
    const t = titles[i];
    const printed = Number(c.printed_page);
    const guess = Number.isFinite(printed) && printed > 0 && offset != null ? printed + offset : null;
    let at = null;
    if (t.length >= 4) {
      const cands = heads.filter((h) => h.n > prev && !toc.has(h.n) && h.head.includes(t));
      if (guess != null) at = cands.find((h) => Math.abs(h.n - guess) <= 3)?.n ?? null;
      if (at == null) at = cands[0]?.n ?? null;
    }
    if (at == null && guess != null && guess > prev && guess <= last) at = guess;
    if (at == null) return;
    out.push({ title: oneLine(c.title, 160), a: at }); prev = at;
  });
  out.forEach((c, i) => { c.b = i + 1 < out.length ? out[i + 1].a - 1 : last; });
  return out.filter((c) => c.b >= c.a);
}

// ---------- Стъпки с модела ----------
const authorsYear = (m) => [arr(m.authors).slice(0, 3).join(', '), m.year].filter(Boolean).join(', ');

async function readMeta(ctx, { rawPath, src, format, known, images }) {
  const head = src ? clipTokens(joinPages(src, src.pages.slice(0, 16)), Math.min(budgetFor(ctx, 1200), 7000)) : '';
  const isBook = format === 'book';
  const schema = isBook
    ? '{"title":"","authors":["Surname, I."],"year":2020,"apa":"","language":"en","original_title":"","chapters":[{"title":"","printed_page":11}],"tags":[""]}'
    : '{"title":"","authors":["Surname, I."],"year":2020,"apa":"","language":"en","original_title":"","tags":[""]}';
  const prompt = [
    P('TASK: determine the bibliographic data of the source from its beginning.'),
    P('FILE: {0}', [rawPath]),
    known ? P('Already known (keep it unless it is clearly wrong): {0}', [JSON.stringify(known)]) : '',
    P('- authors in the form "Surname, I."; year as a number or null; apa: the full reference in APA 7 style (titles of books in *italics*).'),
    P('- language: the code of the language of the source (en, bg, de…). original_title: the title as written in the source.'),
    isBook ? P('- chapters: from the table of contents, in order, with the printed page number from the table of contents (or null). Only real chapters (and the introduction or conclusion if they have substantial content), not their subsections.') : '',
    P('- tags: at most 5, lowercase, words joined with hyphens.'),
    FORMAT_LINE(), schema,
    '', images ? P('The source is the attached image.') : P('BEGINNING OF THE TEXT:'), images ? '' : '<<<', head, images ? '' : '>>>',
  ].filter((x) => x !== '').join('\n');
  const j = await askJson(ctx, { tier: ctx.tiers.writer, prompt, schema, maxTokens: isBook ? 2500 : 1200, label: $t('Bibliographic data'), images });
  const year = Number(j.year);
  return {
    title: oneLine(j.title, 200), authors: arr(j.authors).map((a) => oneLine(a, 80)).filter(Boolean).slice(0, 12),
    year: Number.isInteger(year) && year > 0 && year < 3000 ? year : null, apa: oneLine(j.apa, 600),
    language: /^[a-z]{2,3}$/i.test(String(j.language || '')) ? String(j.language).toLowerCase() : null, original_title: oneLine(j.original_title, 200),
    chapters: arr(j.chapters).map((c) => ({ title: oneLine(c?.title ?? c, 160), printed_page: c?.printed_page })).filter((c) => c.title).slice(0, 60),
    tags: tagsOf(j.tags, 5),
  };
}
const tagsOf = (x, n) => uniq(arr(x).map((t) => latinTag(t)).filter((t) => t.length >= 2)).slice(0, n);
const latinTag = (t) => String(t || '').toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const TYPES = ['concept', 'person', 'organization', 'work', 'place', 'tool'];
const normType = (t) => { const s = String(t || '').toLowerCase(); return TYPES.find((x) => s.startsWith(x.slice(0, 4))) || 'concept'; };

const NOTES_SCHEMA = '{"title":"","summary":"","ideas":[{"text":"","page":12}],"concepts":[{"name":"","original":"","type":"concept","note":"","page":12}],"quote":{"text":"","page":12},"claims":[{"text":"","page":12}]}';
function normNotes(j, range) {
  const pg = (v) => { const n = Number(v); return Number.isInteger(n) && range && range.a != null && n >= range.a && n <= range.b ? n : null; };
  return {
    title: oneLine(j.title, 160), summary: clean(j.summary, 1500),
    ideas: arr(j.ideas).map((x) => ({ text: oneLine(x?.text ?? x, 400), page: pg(x?.page) })).filter((x) => x.text).slice(0, 10),
    concepts: arr(j.concepts).map((x) => ({ name: oneLine(x?.name ?? x, 80), original: oneLine(x?.original, 80), type: normType(x?.type), note: oneLine(x?.note, 300), page: pg(x?.page) }))
      .filter((x) => x.name.length > 1).slice(0, 10),
    quote: j.quote && String(j.quote.text || '').trim() ? { text: oneLine(j.quote.text, 400), page: pg(j.quote.page) } : null,
    claims: arr(j.claims).map((x) => ({ text: oneLine(x?.text ?? x, 300), page: pg(x?.page) })).filter((x) => x.text).slice(0, 4),
  };
}
function mergeNotes(list) {
  if (list.length === 1) return list[0];
  return {
    title: list.find((n) => n.title)?.title || '',
    summary: list.map((n) => n.summary).filter(Boolean).join(' ').slice(0, 2000),
    ideas: list.flatMap((n) => n.ideas).slice(0, 10),
    concepts: list.flatMap((n) => n.concepts).slice(0, 12),
    quote: list.find((n) => n.quote)?.quote || null,
    claims: list.flatMap((n) => n.claims).slice(0, 4),
  };
}

async function notesFor(ctx, { meta, unit, src, label, images }) {
  const max = budgetFor(ctx, 1800);
  const groups = images ? [[]] : windows(unit.pages, max);
  const notes = [];
  for (let i = 0; i < groups.length; i++) {
    checkAbort(ctx);
    const g = groups[i];
    const range = g.length && g[0].n != null ? { a: g[0].n, b: g[g.length - 1].n } : null;
    if (groups.length > 1) ctx.step({ icon: 'book', text: $t('Reads {0}, part {1} of {2}', [label, i + 1, groups.length]) });
    const prompt = [
      P('TASK: read this part of the source and return notes.'),
      P('SOURCE: “{0}” ({1}). PART: {2}.', [meta.title || '?', authorsYear(meta) || '?', label]),
      images ? '' : src.unit ? P('The text has page markers <!-- стр. N --> (in EPUB <!-- раздел N -->). In "page" write the number N of the marker before the place, never the printed page number in the text. If you are not sure, write null.') : P('The text has no page markers: write null in "page".'),
      P('- summary: 2 to 4 sentences on what this part does in the argument of the whole.'),
      P('- ideas: 4 to 8 key ideas, one sentence each.'),
      P('- concepts: at most 8 concepts, theories, methods or people that are developed here substantially (not every mention). type: concept, person, organization, work, place or tool. note: one sentence on how exactly it is used here. original: the term as written in the source.'),
      P('- quote: at most 1 to 2 sentences verbatim, or an empty text.'),
      P('- claims: up to 3 strong or disputed claims of the author that may clash with other authors.'),
      ctx.format === 'dataset' ? P('This is a table: in summary describe the columns, the coverage, the units, what the data shows and which questions it can answer. Do not copy the data.') : '',
      FORMAT_LINE(), NOTES_SCHEMA,
      '', images ? P('The source is the attached image: read the text in it and describe what it shows.') : P('TEXT:'), images ? '' : '<<<', images ? '' : joinPages(src, g), images ? '' : '>>>',
    ].filter((x) => x !== '').join('\n');
    const j = await askJson(ctx, { tier: ctx.tiers.reader, prompt, schema: NOTES_SCHEMA, maxTokens: 1800, label: groups.length > 1 ? `${label} (${i + 1}/${groups.length})` : label, images });
    notes.push(normNotes(j, range));
  }
  return mergeNotes(notes);
}

const cite = (slug, page, src) => `([[${slug}]], ${unitAbbr(src)} ${page ?? '?'})`;

// ---------- Понятия и личности ----------
function lookupPages(pages) {
  const m = new Map();
  for (const p of pages) {
    if (p.data.type !== 'concept' && p.data.type !== 'entity') continue;
    for (const s of [p.data.title, ...arr(p.data.aliases), p.slug.replace(/-/g, ' ')]) {
      const k = normT(s);
      if (k.length >= 3 && !m.has(k)) m.set(k, p);
    }
  }
  return m;
}
function candidatesOf(units, sourceSlug) {
  const m = new Map();
  for (const u of units) for (const c of u.notes.concepts) {
    const k = normT(c.name); if (k.length < 2) continue;
    const e = m.get(k) || { key: k, name: c.name, original: c.original, type: c.type, hits: 0, units: new Set(), notes: [] };
    e.hits++; e.units.add(u.slug || sourceSlug);
    if (e.notes.length < 5 && c.note) e.notes.push({ text: c.note, page: c.page, slug: u.slug || sourceSlug });
    if (!e.original && c.original) e.original = c.original;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.units.size - a.units.size || b.hits - a.hits);
}
const notesBlock = (c, src) => c.notes.map((n) => `- ${n.text} ${cite(n.slug, n.page, src)}`).join('\n');

const NEW_SCHEMA = '{"pages":[{"name":"","title":"","kind":"concept","definition":"","detail":"","aliases":[""],"tags":[""]}]}';
const UPD_SCHEMA = '{"updates":[{"slug":"","add":"","contradiction":"","aliases":[""]}]}';
const batchSize = (ctx) => (ctx.cfg.engine === 'manual' ? 12 : Math.max(1, Math.min(6, Math.floor((ctx.cfg.context * 0.35) / 650))));

async function newPagesFor(ctx, list, src, meta) {
  const out = [];
  for (let i = 0; i < list.length; i += batchSize(ctx)) {
    const part = list.slice(i, i + batchSize(ctx));
    ctx.step({ icon: 'sparkle', text: $t('Writes new pages: {0}', [part.map((c) => c.name).join(', ')]) });
    const prompt = [
      P('TASK: write new pages of the library for the concepts and people below, ONLY from the notes given (do not add knowledge from elsewhere). The notes are from “{0}” ({1}).', [meta.title, authorsYear(meta)]),
      P('- title: the established name in English (for a person: first name and surname).'),
      P('- kind: concept for concepts, theories and methods; person, organization, work, place or tool for the others.'),
      P('- definition: 1 to 3 sentences, with a citation copied exactly as it stands next to the note.'),
      P('- detail: one paragraph (3 to 6 sentences) on how the source develops it, with citations copied as given.'),
      P('- aliases: other spellings and the original term, if any. tags: at most 3, lowercase with hyphens.'),
      FORMAT_LINE(), NEW_SCHEMA, '',
      ...part.map((c) => `### ${c.name}${c.original && c.original !== c.name ? ` (${c.original})` : ''}: ${c.type}\n${notesBlock(c, src)}`),
    ].join('\n');
    const j = await askJson(ctx, { tier: ctx.tiers.writer, prompt, schema: NEW_SCHEMA, maxTokens: Math.min(8000, 500 * part.length + 400), label: $t('New pages') }, (x) => x && Array.isArray(x.pages));
    for (const c of part) {
      const k = c.key;
      const got = j.pages.find((p) => normT(p?.name) === k) || j.pages.find((p) => normT(p?.title) === k) || j.pages[part.indexOf(c)];
      if (got && String(got.definition || got.detail || '').trim()) out.push({ cand: c, page: got });
    }
  }
  return out;
}
async function updatesFor(ctx, list, src) {
  const out = [];
  for (let i = 0; i < list.length; i += batchSize(ctx)) {
    const part = list.slice(i, i + batchSize(ctx));
    ctx.step({ icon: 'pen', text: $t('Adds the new knowledge to: {0}', [part.map((x) => String(x.page.data.title || x.page.slug)).join(', ')]) });
    const prompt = [
      P('TASK: the library already has pages for the items below. From the NEW notes add only what is new.'),
      P('- add: 1 to 3 sentences with ONLY the new knowledge from the notes, not repeating the current text, with citations copied exactly as they stand next to the notes. Empty if there is nothing new.'),
      P('- contradiction: if the notes contradict the current text, describe both positions with their citations; otherwise empty.'),
      P('- aliases: new spellings from the notes that the page does not have yet.'),
      FORMAT_LINE(), UPD_SCHEMA, '',
      ...part.map((x) => `### slug: ${x.page.slug} “${x.page.data.title || x.page.slug}”\n${P('CURRENT TEXT (beginning):')}\n<<<\n${clipTokens(x.page.content, 450)}\n>>>\n${P('NEW NOTES:')}\n${notesBlock(x.cand, src)}`),
    ].join('\n');
    const j = await askJson(ctx, { tier: ctx.tiers.writer, prompt, schema: UPD_SCHEMA, maxTokens: Math.min(6000, 350 * part.length + 300), label: $t('Updates of pages') }, (x) => x && Array.isArray(x.updates));
    for (const x of part) {
      const got = j.updates.find((u) => String(u?.slug || '').replace(/^\[\[|\]\]$/g, '') === x.page.slug) || j.updates[part.indexOf(x)];
      if (got) out.push({ ...x, upd: got });
    }
  }
  return out;
}

// ---------- Общо: един източник (нов или надграждане) ----------
async function processSource(ctx, { rawPath: wanted, existing = null }) {
  ensureStarter();
  const st = ingestState();
  const file = st.resolve(wanted);
  if (!file) throw new AiError({ kind: 'missing' });
  const rawPath = normRaw(rel(file));
  const ext = path.extname(file).toLowerCase();
  ctx.step({ icon: 'file', text: $t('Reads “{0}”', [path.basename(rawPath)]) });
  let src = loadText(file), images = null;
  if (!src) {
    if (IMG[ext] && ctx.cfg.vision && fs.statSync(file).size < 5 * 1024 * 1024) images = [{ mime: IMG[ext], data: fs.readFileSync(file).toString('base64') }];
    else throw new AiError({ kind: IMG[ext] ? 'no-vision' : 'no-text' });
  }
  const format = String(existing?.data?.format || '') || formatOf(rawPath, src);
  ctx.format = format;
  const pages = wikiPages();
  const taken = new Set(pages.map((p) => p.slug));

  // 1. Библиографски данни
  const known = existing ? { title: existing.data.title, authors: existing.data.authors, year: existing.data.year, apa: existing.data.apa } : null;
  ctx.step({ icon: 'search', text: $t('Determines the title, authors and chapters') });
  const meta = await readMeta(ctx, { rawPath, src, format, known, images });
  if (existing) { meta.title = String(existing.data.title || meta.title); if (existing.data.authors) meta.authors = arr(existing.data.authors); if (existing.data.year) meta.year = existing.data.year; if (existing.data.apa) meta.apa = existing.data.apa; }
  if (!meta.title) meta.title = path.basename(rawPath, ext);
  const first = String(meta.authors[0] || '').split(/[,\s]/)[0];
  const word = (meta.title.split(/\s+/).find((w) => normT(w).length >= 4) || meta.title.split(/\s+/)[0] || '');
  const slug = existing?.slug || freeSlug(latin([first, meta.year, word].filter(Boolean).join(' ')) || latin(path.basename(rawPath, ext)), taken);

  // 2. Глави (само книги с маркери за страници)
  const offset = src ? guessOffset(src.pages) : null;
  let chapters = [];
  const oldChapters = pages.filter((p) => p.data.type === 'chapter' && extractLinks(String(p.data.book || ''))[0] === slug)
    .map((p) => { const [a, b] = String(p.data.pages || '').split(/[-–]/).map(Number); return { slug: p.slug, n: Number(p.data.chapter) || 0, title: String(p.data.title || p.slug), a, b: b || a, exists: true }; })
    .filter((c) => c.a).sort((x, y) => x.n - y.n);
  if (format === 'book' && src?.unit) {
    if (oldChapters.length) chapters = oldChapters;
    else {
      let ranges = chapterRanges(meta.chapters, src, offset);
      if (ranges.length < 2) {
        // Без разпознаваемо съдържание: части по брой страници, всяка колкото събира една заявка
        ranges = windows(src.pages, Math.min(budgetFor(ctx, 1800), 12000)).map((w, i) => ({ title: P('Part {0}', [i + 1]), a: w[0].n, b: w[w.length - 1].n }));
      }
      chapters = ranges.map((r, i) => ({ n: i + 1, slug: `${slug}-ch${pad(i + 1)}`, title: r.title, a: r.a, b: r.b }));
    }
    for (const c of chapters) c.pages = src.pages.filter((p) => p.n >= c.a && p.n <= c.b);
    ctx.step({ icon: 'list', text: $t('{0} chapters: pages {1}', [chapters.length, chapters.map((c) => `${c.a}-${c.b}`).join(', ')]) });
  }

  // 3. Бележки по глави (или по части на по-кратък текст)
  const units = chapters.length ? chapters
    : [{ n: 1, slug: null, title: '', a: src?.pages[0]?.n ?? null, b: src?.pages[src.pages.length - 1]?.n ?? null, pages: src ? src.pages : [] }];
  for (const u of units) {
    const label = u.slug ? chapterTitle(u.n, u.title) : meta.title;
    ctx.step({ icon: 'book', text: $t('Reads {0}{1}', [label, u.a != null ? ` (${unitAbbr(src)} ${u.a}-${u.b})` : '']) });
    u.notes = await notesFor(ctx, { meta, unit: u, src, label, images });
    if (u.slug && !u.exists && u.notes.title && /^(?:part|част)\b/i.test(u.title)) u.title = u.notes.title;
  }

  // 4. Страницата на източника: акцент, обобщение, ключови идеи (от бележките, не от целия текст)
  const chapterOf = (n) => (n == null ? null : chapters.find((c) => n >= c.a && n <= c.b)?.slug || null);
  const digest = units.map((u) => [
    u.slug ? `## ${chapterTitle(u.n, u.title)} (${unitAbbr(src)} ${u.a}-${u.b})` : '',
    u.notes.summary,
    ...u.notes.ideas.map((x) => `- ${x.text} (${unitAbbr(src)} ${x.page ?? '?'})`),
  ].filter(Boolean).join('\n')).join('\n\n');
  const areas = uniq(pages.filter((p) => p.data.type === 'source' && p.data.area).map((p) => String(p.data.area).trim()));
  const SRC_SCHEMA = '{"in_brief":"","emphasis":"","emphasis_reasoning":"","key_ideas":[{"text":"","page":12,"concept":""}],"area":"","tags":[""],"confidence":"medium"}';
  const intro = src ? clipTokens(joinPages(src, src.pages.slice(0, 6)), Math.min(3500, Math.floor(budgetFor(ctx, 2200) / 3))) : '';
  ctx.step({ icon: 'sparkle', text: $t('Determines the emphasis of the source') });
  const sp = await askJson(ctx, {
    tier: ctx.tiers.writer, schema: SRC_SCHEMA, maxTokens: 2200, label: $t('Source page'),
    prompt: [
      P('TASK: from the notes on the whole source, write the data for its page in the library.'),
      P('SOURCE: “{0}” ({1}), format {2}.', [meta.title, authorsYear(meta) || '?', format]),
      P('- in_brief: 3 to 5 sentences: what the source is about and what its main argument is.'),
      P('- emphasis: ONE sentence: where the source itself puts the weight. Determine it from the source (the stated purpose of the author, the most developed chapters, the central concept the text keeps returning to), not from general knowledge.'),
      P('- emphasis_reasoning: 2 to 4 sentences: how you can tell.'),
      P('- key_ideas: 5 to 10 key ideas of the whole source, each with the page from the notes and the name of the concept it belongs to (or empty).'),
      P('- area: ONE broad area of knowledge, 1 to 3 words (e.g. Biology, Physics, Psychology). Existing areas: {0}. Use an existing one EXACTLY as written when it fits.', [areas.join(', ') || P('none yet')]),
      P('- tags: at most 5, lowercase with hyphens. confidence: high, medium or low (how sure you are of the notes).'),
      FORMAT_LINE(), SRC_SCHEMA,
      '', P('NOTES BY PARTS:'), '<<<', clipTokens(digest, budgetFor(ctx, 2200) - approxTokens(intro) - 600), '>>>',
      intro ? `\n${P('THE BEGINNING OF THE TEXT (introduction, for the stated purpose):')}\n<<<\n${intro}\n>>>` : '',
    ].join('\n'),
  });
  const emphasis = oneLine(sp.emphasis, 400);

  // 5. Понятия и личности: съществуващите се допълват, новите се създават
  const cands = candidatesOf(units, slug);
  const realPage = (v) => { const n = Number(v); return Number.isInteger(n) && src?.pages.some((p) => p.n === n) ? n : null; };
  const keyIdeas = arr(sp.key_ideas).map((x) => ({ text: oneLine(x?.text ?? x, 400), page: realPage(x?.page), concept: oneLine(x?.concept, 80) })).filter((x) => x.text).slice(0, 10);
  for (const ki of keyIdeas) { const c = cands.find((x) => x.key === normT(ki.concept)); if (c) c.hits += 2; }
  cands.sort((a, b) => b.units.size - a.units.size || b.hits - a.hits);
  const lookup = lookupPages(pages);
  const K = format === 'book' ? 12 : 6;
  const chosen = cands.filter((c) => c.units.size > 1 || c.hits > 1 || cands.length <= K).slice(0, K);
  const existingOnes = [], newOnes = [];
  for (const c of chosen) {
    const hit = lookup.get(c.key) || (c.original ? lookup.get(normT(c.original)) : null);
    if (hit) { if (!existingOnes.some((x) => x.page.slug === hit.slug)) existingOnes.push({ cand: c, page: hit }); } else newOnes.push(c);
  }
  const slugOfCand = new Map();
  for (const x of existingOnes) slugOfCand.set(x.cand.key, x.page.slug);

  // 5а. Нови страници
  const created = [];
  if (newOnes.length) {
    for (const { cand, page } of await newPagesFor(ctx, newOnes, src, meta)) {
      const kind = normType(page.kind || cand.type);
      const type = kind === 'concept' ? 'concept' : 'entity';
      const title = oneLine(page.title, 120) || cand.name;
      let base = latin(title);
      if (kind === 'person') { const w = title.split(/\s+/); if (w.length >= 2) base = latin([w[w.length - 1], ...w.slice(0, -1)].join(' ')); }
      const again = lookup.get(normT(title));
      if (again) { existingOnes.push({ cand, page: again }); slugOfCand.set(cand.key, again.slug); continue; }
      const s = freeSlug(base || latin(cand.name), taken);
      slugOfCand.set(cand.key, s);
      created.push({ slug: s, type, kind, title, page, cand });
    }
  }
  const linkFor = (name) => slugOfCand.get(normT(name)) || null;

  // 5б. Допълване на съществуващите
  const updated = [], contradictions = [];
  const keep = existingOnes.filter((x) => !(existing && x.page.content.includes(`[[${slug}`)));
  if (keep.length) {
    for (const x of await updatesFor(ctx, keep, src)) {
      const add = clean(x.upd.add, 1500), contra = clean(x.upd.contradiction, 1500);
      const aliases = arr(x.upd.aliases).map((a) => oneLine(a, 80)).filter(Boolean);
      const p = readPage(x.page.file);
      const isEntity = p.data.type === 'entity';
      let body = p.body;
      const detail = isEntity ? Hany('entity', 1) : Hany('concept', 1);
      const sources = isEntity ? Hany('entity', 2) : Hany('concept', 5);
      if (add) body = appendToSection(body, detail, add, { create: H(isEntity ? 'entity' : 'concept')[1], before: sources });
      if (contra) { body = appendToSection(body, Hany('concept', 4), contra, { create: V().contradictions, before: sources }); contradictions.push(x.page.slug); }
      body = addLink(body, sources, slug, `- ${linkOf(slug)}`, { create: H(isEntity ? 'entity' : 'concept')[isEntity ? 2 : 5] });
      const d = p.data;
      d.sources = uniq([...arr(d.sources), rawPath]);
      d.related = uniq([...arr(d.related), linkOf(slug)]);
      const have = new Set([String(d.title || '').toLowerCase(), ...arr(d.aliases).map((a) => String(a).toLowerCase())]);
      const extra = uniq([...aliases, x.cand.original].filter((a) => a && !have.has(a.toLowerCase())));
      if (extra.length) d.aliases = [...arr(d.aliases), ...extra].slice(0, 20);
      d.updated = today();
      writePage(ctx, x.page.file, d, body);
      updated.push(x.page.slug);
    }
  }

  // 5в. Запис на новите страници (след като всички имена са известни, за да се свържат помежду си)
  const coSlugs = uniq([...created.map((c) => c.slug), ...existingOnes.map((x) => x.page.slug)]);
  for (const c of created) {
    const related = coSlugs.filter((s) => s !== c.slug).slice(0, 5);
    const def = clean(c.page.definition, 1500), det = clean(c.page.detail, 3000);
    const aliases = uniq([...arr(c.page.aliases).map((a) => oneLine(a, 80)), c.cand.original, c.cand.name].filter((a) => a && a.toLowerCase() !== c.title.toLowerCase())).slice(0, 8);
    const data = {
      title: c.title, type: c.type, ...(c.type === 'entity' ? { kind: c.kind } : {}), aliases,
      tags: tagsOf(c.page.tags, 3), sources: [rawPath], related: [linkOf(slug), ...related.map(linkOf)],
      created: today(), updated: today(), confidence: 'medium',
    };
    let body;
    if (c.type === 'concept') {
      const h = H('concept');
      body = [`# ${c.title}`, `## ${h[0]}`, def || det, ...(det && def ? [`## ${h[1]}`, det] : []),
        ...(related.length ? [`## ${h[3]}`, related.map((s) => `- ${linkOf(s)}`).join('\n')] : []), `## ${h[5]}`, `- ${linkOf(slug)}`].join('\n\n');
    } else {
      const h = H('entity');
      body = [`# ${c.title}`, `## ${h[0]}`, def || det, ...(det && def ? [`## ${h[1]}`, det] : []), `## ${h[2]}`, `- ${linkOf(slug)}`,
        ...(related.length ? [`## ${h[3]}`, related.map((s) => `- ${linkOf(s)}`).join('\n')] : [])].join('\n\n');
    }
    writePage(ctx, path.join(WIKI, DIRS[c.type], `${c.slug}.md`), data, body);
  }

  // 6. Страниците на главите
  const hc = H('chapter');
  for (const c of chapters) {
    if (c.exists) continue;
    const n = c.notes;
    const conc = uniq(n.concepts.map((x) => linkFor(x.name))).slice(0, 8);
    const prev = chapters.find((x) => x.n === c.n - 1), next = chapters.find((x) => x.n === c.n + 1);
    const body = [
      `# ${chapterTitle(c.n, c.title)}`,
      `## ${hc[0]}`, n.summary || '…',
      `## ${hc[1]}`, n.ideas.map((x) => `- ${x.text} (${unitAbbr(src)} ${x.page ?? '?'})`).join('\n') || '…',
      ...(conc.length ? [`## ${hc[2]}`, conc.map((s) => { const k = n.concepts.find((x) => linkFor(x.name) === s); return `- ${linkOf(s)}${k?.note ? `: ${k.note}` : ''}`; }).join('\n')] : []),
      ...(n.quote ? [`## ${hc[3]}`, `> ${n.quote.text} (${unitAbbr(src)} ${n.quote.page ?? '?'})`] : []),
      `## ${hc[4]}`, [prev && `- ${linkOf(prev.slug)}`, next && `- ${linkOf(next.slug)}`, `- ${linkOf(slug)}`].filter(Boolean).join('\n'),
    ].join('\n\n');
    writePage(ctx, path.join(WIKI, DIRS.chapter, `${c.slug}.md`), {
      title: chapterTitle(c.n, c.title), type: 'chapter', book: linkOf(slug), chapter: c.n, pages: `${c.a}-${c.b}`,
      tags: [], sources: [], related: conc.map(linkOf), created: today(), updated: today(), confidence: 'medium',
    }, body);
  }

  // 7. Страницата на източника
  const hs = H('source');
  const others = new Map(); // друг източник → общи понятия
  const byRaw = new Map(pages.filter((p) => p.data.type === 'source' && p.data.raw_path).map((p) => [normRaw(p.data.raw_path), p.slug]));
  for (const x of existingOnes) for (const r of arr(x.page.data.sources)) {
    const o = byRaw.get(normRaw(r));
    if (o && o !== slug) others.set(o, uniq([...(others.get(o) || []), x.page.slug]));
  }
  const conceptsOfSource = uniq([...keyIdeas.map((k) => linkFor(k.concept)), ...coSlugs]).slice(0, 15);
  const ideaLine = (x) => { const target = chapterOf(x.page) || slug; const c = linkFor(x.concept); return `- ${x.text} ${cite(target, x.page, src)}${c ? ` → ${linkOf(c)}` : ''}`; };
  const notesOld = existing ? findSection(existing.content, Hany('source', 6)) : null;
  const myNotes = notesOld ? existing.content.slice(notesOld.contentStart, notesOld.end).trim() : V().leftForHuman;
  const srcBody = [
    `# ${meta.title}`,
    `## ${hs[0]}`, clean(sp.in_brief, 2500) || units.map((u) => u.notes.summary).filter(Boolean).join(' ').slice(0, 1200),
    `## ${hs[1]}`, [emphasis, clean(sp.emphasis_reasoning, 1500)].filter(Boolean).join(' '),
    `## ${hs[2]}`, (keyIdeas.length ? keyIdeas : units.flatMap((u) => u.notes.ideas.slice(0, 2))).map(ideaLine).join('\n'),
    ...(chapters.length ? [`## ${hs[3]}`, chapters.map((c) => `- ${linkOf(c.slug)}`).join('\n')] : []),
    ...(conceptsOfSource.length ? [`## ${hs[4]}`, conceptsOfSource.map((s) => `- ${linkOf(s)}`).join('\n')] : []),
    ...(others.size ? [`## ${hs[5]}`, [...others].slice(0, 8).map(([o, cs]) => `- ${linkOf(o)}: ${P('shared concepts')} ${cs.map(linkOf).join(', ')}`).join('\n')] : []),
    `## ${hs[6]}`, myNotes,
  ].join('\n\n');
  const lang = meta.language && meta.language !== contentLang() ? meta.language : null;
  const old = existing?.data || {};
  const data = {
    ...old,
    title: meta.title, type: 'source', format, raw_path: rawPath,
    authors: meta.authors.length ? meta.authors : arr(old.authors), year: meta.year ?? old.year ?? null, apa: meta.apa || old.apa || '',
    status: old.status || 'read', emphasis, ...(format === 'book' ? { page_offset: offset ?? old.page_offset ?? 0 } : {}),
    depth: 2, ...(existing ? { upgraded: today() } : {}),
    area: old.area || oneLine(sp.area, 40).replace(/[,;|~]/g, ' ').trim() || undefined,
    ...(lang && ctx.settings?.lang !== 'bg' ? { lang, original_title: meta.original_title || undefined } : {}),
    tags: uniq([...arr(old.tags), ...meta.tags, ...tagsOf(sp.tags, 5)]).slice(0, 8),
    sources: uniq([...arr(old.sources), rawPath]), related: uniq([...arr(old.related), ...conceptsOfSource.slice(0, 10).map(linkOf)]),
    created: old.created || today(), updated: today(),
    confidence: ['high', 'medium', 'low'].includes(sp.confidence) ? sp.confidence : 'medium',
  };
  writePage(ctx, existing?.file || path.join(WIKI, DIRS.source, `${slug}.md`), data, srcBody);

  // 8. Цитатите към книгата сочат към главите
  if (chapters.length) redirectCitations(ctx, slug, chapters);

  finishWrite(ctx);
  const who = [arr(data.authors).slice(0, 2).join(', '), data.year ? `(${data.year})` : ''].filter(Boolean).join(' ');
  appendLog(existing ? 'upgrade' : 'ingest', `${who ? who + ' ' : ''}${meta.title}`, [
    P('New: {0}', [[slug, ...chapters.filter((c) => !c.exists).map((c) => c.slug), ...created.map((c) => c.slug)].filter((s) => ctx.job.created.has(pathOfSlug(s))).map(linkOf).join(', ') || '–']),
    P('Updated: {0}', [updated.map(linkOf).join(', ') || '–']),
    P('Contradictions: {0}', [contradictions.length ? contradictions.map(linkOf).join(', ') : P('none')]),
    P('Note: {0}', [P('processed without tools by {0} ({1})', [ctx.cfg.name, ctx.cfg.engine === 'manual' ? P('copied by hand') : ctx.cfg.models[ctx.tiers.writer]])]),
  ]);
  return {
    report: [
      emphasis ? $t('Emphasis: {0}', [emphasis]) : '',
      $t('{0} new pages ({1} chapters), {2} updated.', [ctx.job.created.size, chapters.filter((c) => !c.exists).length, updated.length]),
      contradictions.length ? $t('Contradictions: {0}.', [contradictions.join(', ')]) : '',
    ].filter(Boolean).join('\n'),
  };
}
const pathOfSlug = (s) => {
  for (const d of Object.values(DIRS)) { const f = path.join(WIKI, d, `${s}.md`); if (fs.existsSync(f)) return rel(f); }
  return '';
};

/** ([[книга]], с. N) → ([[книга-chNN]], с. N), когато страницата попада в глава */
function redirectCitations(ctx, bookSlug, chapters) {
  const re = new RegExp(String.raw`\[\[${esc(bookSlug)}(\|[^\]]*)?\]\](,\s*${pageUnits()}\s*)(\d+)`, 'g');
  for (const p of wikiPages()) {
    if (p.slug === bookSlug || ['index', 'log'].includes(p.slug)) continue;
    const src = fs.readFileSync(p.file, 'utf8');
    const out = src.replace(re, (m, alias, mid, n) => { const c = chapters.find((x) => +n >= x.a && +n <= x.b); return c ? `[[${c.slug}${alias || ''}]]${mid}${n}` : m; });
    if (out !== src) {
      fs.writeFileSync(p.file, out);
      ctx.written.add(p.file);
      if (!ctx.job.created.has(p.rel)) ctx.job.updated.add(p.rel);
    }
  }
}

/** Край на всяка задача: непознатите връзки стават текст, после индексът и обзорът се смятат наново. */
function finishWrite(ctx) {
  const known = new Set(wikiPages().map((p) => p.slug));
  let fixed = 0;
  for (const f of ctx.written) {
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    const fm = src.match(/^---[\s\S]*?\n---/)?.[0] || ''; // frontmatter (related) се оставя: lint го проверява отделно
    const body = fixLinks(src.slice(fm.length), known);
    if (body.fixed) { fs.writeFileSync(f, fm + body.text); fixed += body.fixed; }
  }
  if (fixed) ctx.step({ icon: 'check', text: $t('{0} links to pages that do not exist became plain text', [fixed]), warn: true });
  ctx.step({ icon: 'check', text: $t('Updates the index and the overview') });
  try { const ix = buildIndex(); fs.writeFileSync(ix.file, ix.text); } catch { /* индексът може да се направи наново с npm run index */ }
  try { const ov = buildOverview(); fs.writeFileSync(ov.file, ov.text); } catch {}
}

function appendLog(kind, title, lines) {
  const f = path.join(WIKI, 'log.md');
  fs.appendFileSync(f, `\n## ${today()} ${kind}: ${title}\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}

// ---------- Глави за вече обработена книга ----------
async function chaptersJob(ctx, slug) {
  const pages = wikiPages();
  const page = pages.find((p) => p.slug === slug && p.data.type === 'source');
  if (!page?.data?.raw_path) throw new AiError({ kind: 'missing' });
  const file = ingestState(pages).resolve(page.data.raw_path);
  if (!file) throw new AiError({ kind: 'missing' });
  const src = loadText(file);
  if (!src?.unit) throw new AiError({ kind: 'no-pages' });
  ctx.format = 'book';
  ctx.step({ icon: 'search', text: $t('Determines the chapters from the table of contents') });
  const meta = await readMeta(ctx, { rawPath: normRaw(rel(file)), src, format: 'book', known: { title: page.data.title, authors: page.data.authors, year: page.data.year } });
  meta.title = String(page.data.title || meta.title);
  const offset = guessOffset(src.pages) ?? (Number(page.data.page_offset) || null);
  let ranges = chapterRanges(meta.chapters, src, offset);
  if (ranges.length < 2) ranges = windows(src.pages, Math.min(budgetFor(ctx, 1800), 12000)).map((w, i) => ({ title: P('Part {0}', [i + 1]), a: w[0].n, b: w[w.length - 1].n }));
  const chapters = ranges.map((r, i) => ({ n: i + 1, slug: `${slug}-ch${pad(i + 1)}`, title: r.title, a: r.a, b: r.b, pages: src.pages.filter((p) => p.n >= r.a && p.n <= r.b) }));
  const hc = H('chapter');
  const titles = new Map(pages.map((p) => [normT(p.data.title), p.slug]));
  for (const c of chapters) {
    const f = path.join(WIKI, DIRS.chapter, `${c.slug}.md`);
    if (fs.existsSync(f)) continue;
    const label = chapterTitle(c.n, c.title);
    ctx.step({ icon: 'book', text: $t('Reads {0}{1}', [label, ` (${unitAbbr(src)} ${c.a}-${c.b})`]) });
    const n = await notesFor(ctx, { meta, unit: c, src, label });
    const conc = uniq(n.concepts.map((x) => titles.get(normT(x.name)))).slice(0, 8);
    const prev = chapters.find((x) => x.n === c.n - 1), next = chapters.find((x) => x.n === c.n + 1);
    writePage(ctx, f, { title: label, type: 'chapter', book: linkOf(slug), chapter: c.n, pages: `${c.a}-${c.b}`, tags: [], sources: [], related: conc.map(linkOf), created: today(), updated: today(), confidence: 'medium' }, [
      `# ${label}`, `## ${hc[0]}`, n.summary || '…',
      `## ${hc[1]}`, n.ideas.map((x) => `- ${x.text} (${unitAbbr(src)} ${x.page ?? '?'})`).join('\n') || '…',
      ...(conc.length ? [`## ${hc[2]}`, conc.map((s) => `- ${linkOf(s)}`).join('\n')] : []),
      ...(n.quote ? [`## ${hc[3]}`, `> ${n.quote.text} (${unitAbbr(src)} ${n.quote.page ?? '?'})`] : []),
      `## ${hc[4]}`, [prev && `- ${linkOf(prev.slug)}`, next && `- ${linkOf(next.slug)}`, `- ${linkOf(slug)}`].filter(Boolean).join('\n'),
    ].join('\n\n'));
  }
  const p = readPage(page.file);
  const hs = H('source');
  const body = replaceSection(p.body, Hany('source', 3), chapters.map((c) => `- ${linkOf(c.slug)}`).join('\n'), { create: hs[3], before: Hany('source', 4) });
  writePage(ctx, page.file, { ...p.data, page_offset: offset ?? p.data.page_offset ?? 0, updated: today() }, body);
  redirectCitations(ctx, slug, chapters);
  finishWrite(ctx);
  appendLog('ingest', P('Chapters: {0}', [p.data.title || slug]), [P('New: {0}', [chapters.map((c) => linkOf(c.slug)).join(', ')]), P('Updated: {0}', [linkOf(slug)])]);
  return { report: $t('{0} chapters of “{1}”.', [chapters.length, p.data.title || slug]) };
}

// ---------- Синтез между източниците (чете само страниците в wiki/) ----------
async function synthesisJob(ctx, tag) {
  const pages = wikiPages();
  const by = new Map(pages.map((p) => [p.slug, p]));
  const bookOf = (s) => { const p = by.get(s); if (!p) return null; if (p.data.type === 'source') return s; if (p.data.type === 'chapter') return extractLinks(String(p.data.book || ''))[0] || null; return null; };
  const inTag = (p) => !tag || tag === '*' || arr(p.data.tags).includes(tag);
  const concepts = pages.filter((p) => p.data.type === 'concept' && inTag(p));
  const multi = concepts.map((p) => ({ p, books: uniq(extractLinks(p.content).map(bookOf)) })).filter((x) => x.books.length >= 2).sort((a, b) => b.books.length - a.books.length);
  const comparisons = pages.filter((p) => p.data.type === 'comparison');
  const covered = (s) => comparisons.some((c) => extractLinks(c.content).includes(s));
  const taken = new Set(pages.map((p) => p.slug));
  const made = [];
  const describe = (p) => oneLine(String(p.data.emphasis || '') || p.content.replace(/^#.*$/gm, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1'), 200);
  const hcmp = H('comparison');

  // 1. Сравнения за понятията, които поне два източника описват
  const M = ctx.cfg.engine === 'manual' ? 2 : 4;
  for (const x of multi.filter((y) => !covered(y.p.slug)).slice(0, M)) {
    checkAbort(ctx);
    ctx.step({ icon: 'sparkle', text: $t('Compares the sources on “{0}”', [x.p.data.title || x.p.slug]) });
    const material = x.books.map((b) => { const s = by.get(b); return `### [[${b}]] “${s?.data?.title || b}” (${authorsYear(s?.data || {})})\n${oneLine(s?.data?.emphasis, 300)}\n${clipTokens(findSectionText(s, Hany('source', 0)), 350)}`; }).join('\n\n');
    const md = await ask(ctx, {
      tier: ctx.tiers.writer, json: false, maxTokens: 2200, label: $t('Comparison'),
      prompt: [
        P('TASK: compare how the sources describe the concept “{0}”. Use ONLY the material below.', [x.p.data.title || x.p.slug]),
        P('Write Markdown: the first line is “# ” and a short title of the comparison; then “## {0}” with 2 to 4 sentences; then a table with the dimensions in the rows and the sources in the columns (| … | [[slug-a]] | [[slug-b]] |); then “## {1}” with 3 to 6 sentences, including the contradictions, if any.', [hcmp[0], hcmp[1]]),
        P('Cite as ([[slug]], p. N) only with the slugs and the pages from the material. Do not invent pages. Return only the Markdown.'),
        '', P('CONCEPT PAGE:'), '<<<', clipTokens(x.p.content, Math.floor(budgetFor(ctx, 2200) / 2)), '>>>', '', P('SOURCES:'), material,
      ].join('\n'),
    });
    let text = clean(md, 12000).replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '');
    const title = oneLine((text.match(/^#\s+(.+)$/m) || [])[1], 140) || P('{0}: comparison of the sources', [x.p.data.title || x.p.slug]);
    text = text.replace(/^#\s+.+\n*/m, '').trim();
    if (text.length < 80) continue;
    const s = freeSlug(`${x.p.slug}-comparison`, taken);
    writePage(ctx, path.join(WIKI, DIRS.comparison, `${s}.md`), {
      title, type: 'comparison', tags: arr(x.p.data.tags).slice(0, 3), sources: uniq(x.books.map((b) => by.get(b)?.data?.raw_path).filter(Boolean)),
      related: [linkOf(x.p.slug), ...x.books.map(linkOf)], created: today(), updated: today(), confidence: 'medium',
    }, [`# ${title}`, text, `## ${hcmp[2]}`, [linkOf(x.p.slug), ...x.books.map(linkOf)].map((l) => `- ${l}`).join('\n')].join('\n\n'));
    made.push(s);
  }

  // 2. Тематични хъбове за понятията без хъб
  const topics = pages.filter((p) => p.data.type === 'topic' && !['index', 'log', 'overview'].includes(p.slug));
  const inHub = new Set(topics.flatMap((t) => extractLinks(t.content)));
  const free = concepts.filter((p) => !inHub.has(p.slug)).slice(0, 80);
  if (free.length >= 4) {
    checkAbort(ctx);
    ctx.step({ icon: 'list', text: $t('Groups {0} concepts into topics', [free.length]) });
    const TOP_SCHEMA = '{"topics":[{"title":"","overview":"","members":["slug"],"gaps":""}]}';
    const j = await askJson(ctx, {
      tier: ctx.tiers.writer, schema: TOP_SCHEMA, maxTokens: 2000, label: $t('Topics'),
      prompt: [
        P('TASK: group the concepts below into 2 to 4 topics of the library. Every topic has at least 3 members; a concept may stay without a topic.'),
        P('- title: a short name of the topic. overview: 2 to 3 sentences on what it covers. members: slugs ONLY from the list. gaps: what is missing for the topic (one sentence) or empty.'),
        FORMAT_LINE(), TOP_SCHEMA, '',
        P('CONCEPTS (slug | title | tags | description):'),
        clipTokens(free.map((p) => `${p.slug} | ${p.data.title || p.slug} | ${arr(p.data.tags).join(', ')} | ${describe(p)}`).join('\n'), budgetFor(ctx, 2000)),
      ].join('\n'),
    }, (x) => x && Array.isArray(x.topics));
    const ht = H('topic');
    for (const t of j.topics.slice(0, 4)) {
      const members = uniq(arr(t.members).map((m) => String(m).replace(/^\[\[|\]\]$/g, '').trim()).filter((m) => by.get(m)?.data?.type === 'concept'));
      const title = oneLine(t.title, 100);
      if (members.length < 3 || !title) continue;
      const people = uniq(members.flatMap((m) => extractLinks(by.get(m).content)).filter((l) => by.get(l)?.data?.type === 'entity')).slice(0, 8);
      const books = uniq(members.flatMap((m) => extractLinks(by.get(m).content).map(bookOf))).slice(0, 10);
      const s = freeSlug(latin(title), taken);
      writePage(ctx, path.join(WIKI, DIRS.topic, `${s}.md`), {
        title, type: 'topic', tags: uniq(members.flatMap((m) => arr(by.get(m).data.tags))).slice(0, 4), sources: [],
        related: members.slice(0, 10).map(linkOf), created: today(), updated: today(), confidence: 'medium',
      }, [`# ${title}`, `## ${ht[0]}`, clean(t.overview, 1500),
        `## ${ht[1]}`, members.map((m) => `- ${linkOf(m)}: ${describe(by.get(m))}`).join('\n'),
        ...(people.length ? [`## ${ht[2]}`, people.map((m) => `- ${linkOf(m)}`).join('\n')] : []),
        ...(books.length ? [`## ${ht[3]}`, books.map((m) => `- ${linkOf(m)}`).join('\n')] : []),
        ...(clean(t.gaps, 600) ? [`## ${ht[4]}`, clean(t.gaps, 600)] : []),
      ].join('\n\n'));
      made.push(s);
    }
  }

  // 3. Обзор: основните линии в библиотеката (между маркери, автоматичният блок не се пипа)
  checkAbort(ctx);
  const now = wikiPages();
  const listing = [
    ...now.filter((p) => p.data.type === 'topic' && !['index', 'log', 'overview'].includes(p.slug)).map((p) => `${p.slug} | topic | ${p.data.title}`),
    ...now.filter((p) => p.data.type === 'source').slice(0, 40).map((p) => `${p.slug} | source | ${p.data.title} | ${oneLine(p.data.emphasis, 160)}`),
    ...multi.slice(0, 20).map((x) => `${x.p.slug} | concept | ${x.p.data.title}`),
  ].join('\n');
  ctx.step({ icon: 'sparkle', text: $t('Writes the main lines of the library') });
  const ov = await ask(ctx, {
    tier: ctx.tiers.writer, json: false, maxTokens: 1500, label: $t('Overview'),
    prompt: [P('TASK: in 2 to 4 paragraphs describe the main lines of the library and how the topics, sources and concepts below connect. Link with [[slug]] only to the slugs from the list. Return only the paragraphs in Markdown, without a heading.'), '', clipTokens(listing, budgetFor(ctx, 1500))].join('\n'),
  });
  const ovFile = path.join(WIKI, 'overview.md');
  if (fs.existsSync(ovFile)) {
    const S = ['<!-- synthesis:start -->', '<!-- synthesis:end -->'];
    const block = `${S[0]}\n## ${P('Main lines of the library')}\n\n${clean(ov, 6000)}\n${S[1]}`;
    let t = fs.readFileSync(ovFile, 'utf8');
    if (t.includes(S[0]) && t.includes(S[1])) t = t.replace(new RegExp(`${esc(S[0])}[\\s\\S]*?${esc(S[1])}`), () => block);
    else if (t.includes('<!-- auto-overview:start -->')) t = t.replace('<!-- auto-overview:start -->', `${block}\n\n<!-- auto-overview:start -->`);
    else t = `${t.trimEnd()}\n\n${block}\n`;
    fs.writeFileSync(ovFile, t); ctx.written.add(ovFile); ctx.job.updated.add(rel(ovFile));
  }

  // 4. Празнини: само от страниците, без модела
  const single = concepts.filter((p) => uniq(extractLinks(p.content).map(bookOf)).length <= 1);
  const low = now.filter((p) => p.data.confidence === 'low' && !['index', 'log', 'overview'].includes(p.slug));
  fs.mkdirSync(OUTPUTS, { recursive: true });
  const report = path.join(OUTPUTS, `synthesis-${today()}.md`);
  fs.writeFileSync(report, [`# ${P('Synthesis')} ${today()}`, '', `## ${P('New pages')}`, ...made.map((s) => `- ${linkOf(s)}`), '',
    `## ${P('Concepts with a single source')}`, ...single.slice(0, 60).map((p) => `- ${linkOf(p.slug)}`), '',
    `## ${P('Pages with low confidence')}`, ...low.slice(0, 60).map((p) => `- ${linkOf(p.slug)}`), ''].join('\n'));
  finishWrite(ctx);
  appendLog('synthesis', tag && tag !== '*' ? `#${tag}` : P('the whole library'), [P('New: {0}', [made.map(linkOf).join(', ') || '–']), P('Note: {0}', [rel(report)])]);
  return { report: $t('{0} comparisons and topics; gaps in {1}.', [made.length, rel(report)]) };
}
function findSectionText(page, names) {
  if (!page) return '';
  const s = findSection(page.content, names);
  return s ? page.content.slice(s.contentStart, s.end).trim() : page.content.slice(0, 1500);
}

/**
 * Изпълнява задача от опашката без инструменти. ctx: { job, signal, step, settings, tiers: { reader, writer } }.
 * Връща { report }. Грешките са AiError (kind: limit, auth, model, offline, format, cancelled, missing, no-text…).
 */
export async function runPipeline(kind, target, ctx) {
  ctx.written = new Set();
  ctx.usage = ctx.usage || { in: 0, out: 0, cost: 0, calls: 0, costKnown: true };
  if (kind === 'chapters') return chaptersJob(ctx, target);
  if (kind === 'synthesis') return synthesisJob(ctx, target);
  if (kind === 'upgrade') {
    const page = wikiPages().find((p) => p.slug === target);
    if (!page?.data?.raw_path) throw new AiError({ kind: 'missing' });
    return processSource(ctx, { rawPath: String(page.data.raw_path), existing: page });
  }
  return processSource(ctx, { rawPath: target });
}
