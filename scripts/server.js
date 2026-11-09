// Локален интерфейс на библиотеката: npm run serve → http://localhost:4321
// Работи изцяло офлайн: Vue, Tailwind, marked и шрифтовете се зареждат от node_modules.
// Пише само в raw/inbox/ (качване); wiki/ се пише от Claude Code.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureStarter, ROOT, RAW, WIKI, OUTPUTS, rawFiles, rel, wikiPages, extractLinks, walk, sha256, loadManifest, ingestState, normRaw } from './lib.js';
import { createAgent, legacySources, askClaude, PATH_LEVELS } from './agent.js';
import { buildLocal, writeWithClaude, continueWithClaude,saveDraft, listDrafts, readDraft, updateDraft, trashDraft, LENGTHS } from './write.js';
import { askAboutPage, planConspect, proposeChange, applyProposal, saveAnswer, proposeReplace, locateForEdit, applyManualEdit, applyParagraphDelete, applyLink, renamePage } from './improve.js';
import { fold, findDupes, planMerge, applyMerge, ignorePair, normalizeAuthors } from './merge.js';
import { planMergeBook, applyMergeBook } from './merge-sources.js';
import { planRemoval, applyRemoval } from './remove.js';
import { rebuildAll } from './index.js';
import { importPaper } from './discover.js';
import { estimate } from './estimate.js';
import { checkSetup, testClaude, accountTerms } from './setup.js';
import { versionInfo, checkCode, checkPackages, latestResults, runTests, testsBusy } from './updates.js';
import { authEnabled, isLocked, verifyPassword, setPassword, clearPassword, validPassword, hasSession, startSession, endSession, MIN_PASSWORD } from './auth.js';
import { areaMap, areaKey, listAreas, setArea, renameArea, proposeClassification, applyAssignments, scopeFilter } from './areas.js';
import { $t, pickLang, runWithLang, locales, messagesFor, hasLocale, contentLang } from './i18n.js';
import { packs, installPack } from './content-pack.js';
import { P, lazy, pageUnits } from './vocab.js';
import { SPECIAL, snapshot, summary, plain, excerpt, AREAS, pagesList, pageDetail, searchHits, contentStats, graphData } from './pages-data.js';
import { NM, VENDOR } from './vendor.js';
import { writeArchive, listArchives, isArchiveName, archiveFile, deleteArchive } from './archive.js';
import { readUnits } from './reader-data.js';

const PORT = Number(process.env.PORT) || 4321;
const INBOX = path.join(RAW, 'inbox');
const MAX_UPLOAD = 2 * 1024 ** 3; // 2 GB
const app = express();

// --- Защита: само localhost (срещу DNS rebinding) и заявки от самата страница ---
// Домейнът, под който библиотеката се отваря локално (записан в hosts файла на Windows). Сменя се с WIKI_HOST.
const WIKI_HOST = String(process.env.WIKI_HOST || 'my.wiki').toLowerCase();
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`, WIKI_HOST, `${WIKI_HOST}:${PORT}`]);
app.use((req, res, next) => runWithLang(pickLang(req), next)); // езикът на заявката важи за всички $t() под нея
app.disable('x-powered-by');
// Втора защита след пречистването на HTML: вграден код и чужди адреси не работят.
// 'unsafe-eval' е нужен на шаблоните на Vue, а 'unsafe-inline' за стилове на Tailwind; вграден скрипт остава забранен.
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
/** Заявка от друг сайт. Самостоятелно отваряне на адрес (връзка от друго място) е позволено, но не и вграждане и fetch. */
function fromElsewhere(req) {
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return true; } catch { return true; } // и 'null' от изолирани страници
  }
  const site = req.headers['sec-fetch-site'];
  if (!site || site === 'same-origin' || site === 'none') return false;
  return !(req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate');
}
app.use((req, res, next) => {
  res.set({ 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin' });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  if (!ALLOWED_HOSTS.has(req.headers.host)) return res.status(403).send($t('Localhost only'));
  if (fromElsewhere(req)) return res.status(403).send($t('Forbidden'));
  const isLogin = req.method === 'POST' && req.path === '/login'; // формата за вход няма как да прати заглавка; проверен е Origin
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-library'] !== '1' && !isLogin) return res.status(403).send($t('Forbidden'));
  next();
});

// --- Парола за интерфейса (по избор) ---
function loginPage(req, res, failed) {
  const e = failed ? `<p style="color:#b4532a;margin:0 0 12px">${isLocked() ? $t('Too many attempts. Try again in a minute.') : $t('Wrong password.')}</p>` : '';
  res.status(failed ? 401 : 200).type('html').send(`<!doctype html><html lang="${pickLang(req)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${$t('Sign in')}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ec;color:#26231e;font:16px system-ui,sans-serif}form{width:min(340px,calc(100vw - 32px));padding:24px;background:#fffdf9;border:1px solid #e4dfd3;border-radius:16px;box-sizing:border-box}h1{font-size:20px;margin:0 0 16px}input,button{width:100%;box-sizing:border-box;padding:10px 12px;font:inherit;border-radius:10px}input{border:1px solid #cfc8b8;margin-bottom:12px}button{border:0;background:#2f6f62;color:#fff;cursor:pointer}@media (prefers-color-scheme:dark){body{background:#1c1b18;color:#ece7dc}form{background:#262420;border-color:#3a372f}input{background:#1c1b18;color:inherit;border-color:#4a463c}}</style></head><body><form method="post" action="/login"><h1>${$t('Sign in')}</h1>${e}<input type="password" name="password" autocomplete="current-password" aria-label="${$t('Password')}" placeholder="${$t('Password')}" autofocus required><button type="submit">${$t('Sign in')}</button></form></body></html>`);
}
app.get('/login', (req, res) => (authEnabled() && !hasSession(req) ? loginPage(req, res, false) : res.redirect('/')));
app.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
  if (!authEnabled()) return res.redirect('/');
  if (!(await verifyPassword(req.body?.password))) return loginPage(req, res, true);
  startSession(res);
  res.redirect(303, '/');
});
app.use((req, res, next) => {
  if (!authEnabled() || hasSession(req)) return next();
  if (req.method === 'GET' && !req.path.startsWith('/api/') && req.accepts('html') && req.path === '/') return res.redirect('/login');
  res.status(401).json({ ok: false, error: $t('Sign in first.') });
});
app.post('/api/auth/password', express.json({ limit: '8kb' }), async (req, res) => {
  const { current, password } = req.body || {};
  if (authEnabled() && !(await verifyPassword(current))) return res.json({ ok: false, error: isLocked() ? $t('Too many attempts. Try again in a minute.') : $t('Wrong password.') });
  if (password === null) { clearPassword(); return res.json({ ok: true, auth: false }); }
  if (!validPassword(password)) return res.json({ ok: false, error: $t('The password must have at least {0} characters.', [MIN_PASSWORD]) });
  await setPassword(password);
  startSession(res);
  res.json({ ok: true, auth: true });
});
app.post('/api/auth/logout', (req, res) => { endSession(req, res); res.json({ ok: true }); });

// --- API ---
app.get('/api/pages', (_req, res) => res.json(pagesList()));

app.get('/api/page/:slug', (req, res) => {
  const d = pageDetail(req.params.slug);
  if (!d) return res.status(404).json({ error: $t('There is no such page') });
  res.json(d);
});

// ---------- Четец: текстът на една страница от книгата ----------
// readUnits е в reader-data.js (ползва се и от архива)

app.get('/api/reader', (req, res) => {
  const { pages } = snapshot();
  const bySlug = new Map(pages.map((x) => [x.slug, x]));
  let p = bySlug.get(String(req.query.src || ''));
  if (!p) return res.status(404).json({ error: $t('There is no such source') });
  if (p.data.type === 'chapter' && !p.data.raw_path) p = bySlug.get(extractLinks(String(p.data.book || ''))[0]) || p;
  const rawFile = p.data.raw_path ? ingestState(pages).resolve(p.data.raw_path) : null;
  if (!rawFile) return res.status(404).json({ error: $t('The original file is missing') });
  const ex = path.join(RAW, '.extracted', path.relative(RAW, rawFile) + '.md');
  if (!fs.existsSync(ex)) return res.status(404).json({ error: $t('The text has not been extracted yet (npm run extract)') });
  const u = readUnits(ex);
  const rawUrl = '/' + rel(rawFile).split('/').map(encodeURIComponent).join('/');
  const book = { slug: p.slug, title: p.data.title || p.slug, apa: p.data.apa || null, rawUrl };
  if (!u.order.length) return res.json({ book, unit: null, text: u.whole });
  const want = Number(req.query.page) || u.order[0];
  const page = u.units.has(want) ? want : u.order.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best), u.order[0]);
  const offset = Number(p.data.page_offset) || 0;
  // В коя глава попада страницата
  const chapter = pages.filter((x) => x.data.type === 'chapter' && extractLinks(String(x.data.book || ''))[0] === p.slug)
    .map((x) => { const [a, b] = String(x.data.pages || '').split(/[-–]/).map(Number); return { slug: x.slug, title: x.data.title || x.slug, a, b: b || a }; })
    .find((c) => c.a && page >= c.a && page <= c.b) || null;
  res.json({
    book, unit: u.unit, page, first: u.order[0], last: u.order[u.order.length - 1],
    text: u.units.get(page), printed: offset ? page - offset : null, chapter,
    pdfUrl: /\.pdf$/i.test(rawFile) && u.unit === 'стр.' ? `${rawUrl}#page=${page}` : null,
  });
});

app.get('/api/search', (req, res) => res.json(searchHits(req.query.q)));

// ---------- Пътека за учене: въпрос → подредени стъпки (без Claude, не харчи от лимита) ----------
const STOP = new Set(['как', 'какво', 'какви', 'каква', 'какъв', 'защо', 'кога', 'къде', 'или', 'при', 'към', 'между', 'който', 'която', 'които', 'има', 'дали', 'като', 'най', 'със', 'във', 'ако', 'тези', 'този', 'тази', 'това', 'още', 'само', 'може', 'мога', 'искам', 'разбера', 'научa', 'уча', 'how', 'what', 'which', 'who', 'why', 'when', 'where', 'the', 'and', 'for', 'with', 'about', 'between', 'does', 'are', 'was', 'can', 'want', 'understand', 'learn', 'tell']);
const stem = (w) => (w.length > 6 ? w.slice(0, w.length - 2) : w.length > 4 ? w.slice(0, w.length - 1) : w);
// Етапите на пътеката: функция, за да следват езика на заявката. Името не е „stages“, защото обработчиците ползват локален масив с това име
const pathStages = () => [
  { id: 'frame', label: $t('Framework'), hint: $t('The big picture of the topic first.'), types: ['topic'], max: 3 },
  { id: 'concepts', label: $t('Concepts and people'), hint: $t('The main ideas and who developed them.'), types: ['concept', 'entity'], max: 7 },
  { id: 'compare', label: $t('Comparisons'), hint: $t('Where the authors differ.'), types: ['comparison'], max: 3 },
  { id: 'texts', label: $t('In the texts themselves'), hint: $t('The chapters and pages where the claims stand.'), types: ['chapter', 'source'], max: 8 },
  { id: 'asked', label: $t('Answers already saved'), hint: $t('Questions you have asked the library.'), types: ['question'], max: 2 },
];
const CITE_RE = new RegExp(String.raw`\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\],?\s*${pageUnits()}\s*(\d+)`, 'g');

// Подрежда страниците по близост до въпроса (по думи; заглавията и псевдонимите се сравняват и по звучене)
// Обхват на пътека или статия: избрани области и/или теми (фокус); без избор влизат всички страници
const listParam = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
const scopeOf = (src) => ({ areas: listParam(src?.areas ?? src?.a), focus: listParam(src?.focus ?? src?.f) });
const scopeKey = (sc) => (sc.areas.length || sc.focus.length ? `${sc.areas.map(areaKey).sort().join(',')}~${sc.focus.slice().sort().join(',')}` : '');
function scopeNote(sc, pages) {
  if (!sc.areas.length && !sc.focus.length) return '';
  const t = new Map(pages.map((p) => [p.slug, String(p.data.title || p.slug)]));
  return P('SCOPE (mandatory): ') + [sc.areas.length ? P('only pages from the areas: {0}', [sc.areas.join(', ')]) : '', sc.focus.length ? P('only the topics: {0} and the pages related to them', [sc.focus.map((s) => t.get(s) || s).join(', ')]) : ''].filter(Boolean).join('; ') + P('. Do not include or cite pages outside this scope, even if they sound close.');
}
function rank(q, sc = { areas: [], focus: [] }) {
  const terms = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))];
  const ctx = snapshot();
  if (!terms.length) return { terms, scored: [], ctx };
  const { pages, backlinks } = ctx;
  const scored = [], inScope = scopeFilter(pages, sc);
  for (const p of pages) {
    if (SPECIAL.has(p.slug) || (inScope && !inScope(p))) continue;
    const aliases = [].concat(p.data.aliases || []).join(' ');
    const title = (String(p.data.title || p.slug) + ' ' + aliases).toLowerCase();
    const soundTitle = fold(title);
    const tags = [].concat(p.data.tags || []).join(' ').toLowerCase();
    const text = plain(p.content.replace(/^\s*#\s+.*\n/, ''));
    const body = text.toLowerCase();
    let score = 0, hit = 0, first = -1;
    for (const t of terms) {
      const ft = fold(t);
      const inTitle = title.includes(t) || (ft.length >= 4 && soundTitle.includes(ft)), inTags = tags.includes(t);
      const idx = body.indexOf(t);
      const cnt = idx === -1 ? 0 : Math.min(10, body.split(t).length - 1);
      if (inTitle || inTags || cnt) hit++;
      score += (inTitle ? 8 : 0) + (inTags ? 3 : 0) + cnt;
      if (idx !== -1 && (first === -1 || idx < first)) first = idx;
    }
    if (!hit) continue;
    score *= 1 + hit / terms.length; // страници, които хващат повече от думите на въпроса, излизат напред
    score += Math.log(1 + (backlinks.get(p.slug)?.length || 0));
    const start = Math.max(0, first - 60);
    const snippet = first === -1 ? excerpt(p.content) : (start ? '…' : '') + text.slice(start, first + 200) + '…';
    scored.push({ p, score, hit, snippet });
  }
  scored.sort((a, b) => b.score - a.score);
  return { terms, scored, ctx };
}

/** Превръща страница в стъпка от пътеката (с книгата, страниците и точните цитати за четеца) */
function stepFactory({ pages, backlinks }) {
  const bySlug = new Map(pages.map((x) => [x.slug, x]));
  return (p, snippet, score = 0) => {
    const t = p.data.type;
    const base = summary(p, backlinks);
    const step = { slug: p.slug, title: base.title, type: t, excerpt: snippet, score: Math.round(score), confidence: base.confidence, cites: [] };
    if (t === 'chapter') {
      const book = bySlug.get(extractLinks(String(p.data.book || ''))[0]);
      step.book = book ? { slug: book.slug, title: book.data.title || book.slug } : null;
      step.chapter = base.chapter; step.pages = base.pages;
      if (p.data.raw_path) { step.readerSrc = p.slug; step.firstPage = Number(String(base.pages || '').split(/[-–]/)[0]) || null; }
      else if (book?.data?.raw_path) { step.readerSrc = book.slug; step.firstPage = Number(String(base.pages || '').split(/[-–]/)[0]) || null; }
    } else if (t === 'source' && p.data.raw_path) {
      step.readerSrc = p.slug; step.authors = base.authors; step.year = base.year;
    } else if (['concept', 'entity', 'topic', 'comparison'].includes(t)) {
      // Точните страници, на които тази страница се опира: [[глава]], с. N
      const seen = new Set(); let m; CITE_RE.lastIndex = 0;
      while ((m = CITE_RE.exec(p.content)) && step.cites.length < 4) {
        const slug = m[1].trim().split('/').pop(), src = bySlug.get(slug);
        if (!src || !['chapter', 'source'].includes(src.data.type)) continue;
        const key = slug + ':' + m[2]; if (seen.has(key)) continue; seen.add(key);
        const readerSrc = src.data.raw_path ? src.slug
          : (src.data.type === 'chapter' ? bySlug.get(extractLinks(String(src.data.book || ''))[0])?.slug : src.slug);
        const hasRaw = src.data.raw_path || bySlug.get(readerSrc)?.data?.raw_path;
        if (!readerSrc || !hasRaw) continue;
        step.cites.push({ slug, title: src.data.title || slug, page: Number(m[2]), readerSrc });
      }
    }
    return step;
  };
}

const sourceCount = (steps) => new Set(steps.filter((s) => s.type === 'chapter' || s.type === 'source').map((s) => s.book?.slug || s.slug)).size;

// Бърза пътека: без Claude, не харчи от лимита
app.get('/api/path', (req, res) => {
  const q = String(req.query.q || '').trim();
  const { terms, scored, ctx } = rank(q, scopeOf(req.query));
  if (!terms.length) return res.json({ q, steps: [], stages: [], note: $t('Write the question with at least one meaningful word.') });
  const mk = stepFactory(ctx);
  const stepOf = (s) => mk(s.p, s.snippet, s.score);
  const steps = [], stages = [];
  for (const st of pathStages()) {
    let items = scored.filter((s) => st.types.includes(s.p.data.type));
    if (st.id === 'texts') {
      // най-много 3 глави от една книга; книга без глави влиза като цяла
      const perBook = new Map(); const out = [];
      const chapterBooks = new Set(items.filter((s) => s.p.data.type === 'chapter').map((s) => extractLinks(String(s.p.data.book || ''))[0]));
      for (const s of items) {
        if (s.p.data.type === 'source' && chapterBooks.has(s.p.slug)) continue;
        const b = s.p.data.type === 'chapter' ? extractLinks(String(s.p.data.book || ''))[0] : s.p.slug;
        const n = perBook.get(b) || 0; if (n >= 3) continue;
        perBook.set(b, n + 1); out.push(s);
      }
      items = out;
    }
    const chosen = items.slice(0, st.max).map(stepOf);
    if (!chosen.length) continue;
    stages.push({ id: st.id, label: st.label, hint: st.hint, count: chosen.length });
    chosen.forEach((c) => { c.stage = st.id; steps.push(c); });
  }
  const sourcesN = sourceCount(steps);
  let note = null;
  if (!steps.length) note = $t('The library says nothing on this question. Try other words or save it as a candidate for reading.');
  else if (sourcesN < 2) note = $t('The library relies on few sources on this question. There is room for more reading here.');
  res.json({ q, terms, steps, stages, note, sources: sourcesN, mode: 'local' });
});

// ---------- Пътека, подредена от Claude (избор: лек, среден, мощен) ----------
// Claude само чете (Read, Glob, Grep) и връща JSON с етапи; сървърът проверява, че всяка страница съществува,
// и сглобява стъпките със същите данни за четеца и цитатите като бързата пътека. Резултатът се пази в outputs/.
const PATHS_FILE = path.join(OUTPUTS, '.claude-paths.json');
const readPaths = () => { try { return JSON.parse(fs.readFileSync(PATHS_FILE, 'utf8')); } catch { return {}; } };
const pathKey = (q, level, sc) => `${level}|${q.trim().toLowerCase()}${sc && scopeKey(sc) ? '|~' + scopeKey(sc) : ''}`;
const clip = (s, n) => String(s ?? '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n);
const DEPTH = lazy(() => ({
  light: P('Work quickly: rely on index.md and the hints, open at most a few pages only for checking. Up to 8 steps.'),
  medium: P('Open and read the most important pages (the main concepts and the comparisons) to judge the order and to see what else is cited. Up to 12 steps.'),
  strong: P('Work thoroughly: read the key pages, follow the links and the citations to the chapters, search with Grep for the words and synonyms from the question and the other spellings of the names, check for contradictions between the sources and mark them in look. Up to 14 steps.'),
}));

function claudePathPrompt(q, level, hints) {
  return [
    P('You are a learning mentor. The human wants to learn something from THEIR OWN library (the wiki/ folder in the current directory). Compose a learning path for their question.'),
    '',
    P('QUESTION: {0}', [q]),
    '',
    P('HOW TO WORK'),
    P('- Start with wiki/index.md. The pages are in wiki/concepts, entities, topics, comparisons, questions, sources and sources/chapters. The identifier (slug) of a page is the file name without .md.'),
    `- ${DEPTH[level]}`,
    P('- Include ONLY pages that really exist. Do not invent slugs, pages, citations and page numbers.'),
    P('- Names of people and concepts may be written in different ways (Tchaikovsky, Chaikovsky, Čajkovskij). Treat them as the same and include the pages that describe them.'),
    P('- Order from the general to the particular: first the framework and the basic concepts that the others depend on; then the finer concepts; then where the authors differ (comparisons); finally the chapters and primary sources where the claims stand. Do not put a step whose understanding depends on a later step.'),
    P('- 6 to 14 steps in total, in 3 to 5 stages. Fewer but exact pages, not filler. Put chapters (type chapter) and primary sources only where they really answer the question.'),
    P('- If the library does not cover part of the question, say so in gaps and what should be read.'),
    '',
    P('FOR EACH STEP'),
    P('- why: one sentence on why it is in this place (what it adds and what it assumes from before).'),
    P('- look: a question or task for the human to keep in mind while reading (what to notice, what to compare with).'),
    '',
    P('HINTS from a rough word-based searcher (they may be incomplete or wrong, check them):'),
    hints || P('(none)'),
    '',
    P('FORMAT OF THE ANSWER: only one JSON object, with no text before or after it and no ```:'),
    P('{"goal":"1-2 sentences on what the human will understand at the end","stages":[{"label":"short name of the stage","hint":"one phrase on what is achieved","steps":[{"slug":"...","why":"...","look":"..."}]}],"gaps":"or an empty string"}'),
    P('Write in English. Do not use an em dash (—).'),
  ].join('\n');
}

function parsePlan(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(t.slice(a, b + 1));
    if (!Array.isArray(o.stages) && Array.isArray(o.steps)) o.stages = [{ label: $t('Path'), hint: '', steps: o.steps }];
    return Array.isArray(o.stages) ? o : null;
  } catch { return null; }
}

function buildClaudePath(plan, q, level, ctx) {
  const mk = stepFactory(ctx), bySlug = new Map(ctx.pages.map((p) => [p.slug, p]));
  const steps = [], stages = [], used = new Set();
  plan.stages.forEach((st, i) => {
    const id = 'c' + i; let n = 0;
    for (const s of [].concat(st.steps || [])) {
      const slug = String(s?.slug || '').trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].split('/').pop().replace(/\.md$/, '');
      const p = bySlug.get(slug);
      if (!p || SPECIAL.has(slug) || used.has(slug)) continue;
      used.add(slug);
      const step = mk(p, excerpt(p.content));
      step.stage = id; step.why = clip(s.why, 320); step.look = clip(s.look, 320);
      steps.push(step); n++;
    }
    if (n) stages.push({ id, label: clip(st.label, 60) || $t('Stage {0}', [i + 1]), hint: clip(st.hint, 180), count: n });
  });
  const sources = sourceCount(steps);
  let note = clip(plan.gaps, 600) || null;
  if (!note && steps.length && sources < 2) note = $t('The library relies on few sources on this question. There is room for more reading here.');
  return { q, mode: level, level, goal: clip(plan.goal, 500), steps, stages, note, sources };
}

app.use('/api/path/claude', express.json({ limit: '8kb' }));
app.get('/api/path/list', (_req, res) => {
  const bySlug = new Set(snapshot().pages.map((p) => p.slug));
  res.json(Object.entries(readPaths()).map(([k, v]) => {
    const i = k.indexOf('|');
    const q = (v.plan?.q || k.slice(i + 1));
    return { level: k.slice(0, i), q: v.q || q, areas: v.areas || [], focus: v.focus || [], at: v.at, steps: (v.plan?.stages || []).reduce((n, st) => n + [].concat(st.steps || []).filter((x) => bySlug.has(String(x?.slug || '').replace(/^\[\[|\]\]$/g, '').split('/').pop())).length, 0) };
  }).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12));
});
app.get('/api/path/saved', (req, res) => {
  const q = String(req.query.q || '').trim(), level = String(req.query.level || '');
  if (!PATH_LEVELS[level]) return res.json(null);
  const all = readPaths(), hit = all[pathKey(q, level, scopeOf(req.query))];
  if (hit) return res.json({ ...buildClaudePath(hit.plan, q, level, snapshot()), cached: true, savedAt: hit.at });
  // Няма пътека за този обхват, но може да има за същия въпрос и ниво с друг обхват (темите не се помнят
  // след презареждане). Връщаме ги, за да се отворят безплатно, вместо да се съставят наново.
  const base = pathKey(q, level);
  const others = Object.entries(all).filter(([k]) => k === base || k.startsWith(base + '|~'))
    .map(([, v]) => ({ areas: v.areas || [], focus: v.focus || [], at: v.at }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json(others.length ? { others } : null);
});
app.delete('/api/path/saved', express.json({ limit: '8kb' }), (req, res) => {
  const q = String(req.body?.q || '').trim(), level = String(req.body?.level || '');
  const cache = readPaths(), key = pathKey(q, level, scopeOf(req.body));
  if (!PATH_LEVELS[level] || !cache[key]) return res.json({ ok: false, error: $t('This path no longer exists.') });
  delete cache[key];
  try { fs.writeFileSync(PATHS_FILE, JSON.stringify(cache)); } catch (e) { return res.json({ ok: false, error: e.message }); }
  res.json({ ok: true });
});
app.post('/api/path/claude', async (req, res) => {
  const q = String(req.body?.q || '').trim(), level = String(req.body?.level || '');
  if (!PATH_LEVELS[level]) return res.status(400).json({ error: $t('Unknown level.') });
  if (q.length < 3) return res.status(400).json({ error: $t('Write the question.') });
  const sc = scopeOf(req.body), ctx = snapshot(), cache = readPaths(), key = pathKey(q, level, sc);
  if (!req.body?.fresh && cache[key]) return res.json({ ...buildClaudePath(cache[key].plan, q, level, ctx), cached: true, savedAt: cache[key].at });

  const hints = [scopeNote(sc, ctx.pages), rank(q, sc).scored.slice(0, 30).map((s) => `${s.p.slug} | ${s.p.data.type} | ${String(s.p.data.title || s.p.slug)}`).join('\n')].filter(Boolean).join('\n\n');
  const L = PATH_LEVELS[level], ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); }); // затвори ли страницата, спираме Claude
  const r = await askClaude({ prompt: claudePathPrompt(q, level, hints), model: L.model, effort: L.effort, maxTurns: L.maxTurns, timeoutMs: L.timeoutMs, signal: ac.signal });
  if (res.writableEnded || res.destroyed) return;
  if (!r.ok) return res.status(r.kind === 'cancelled' ? 499 : 502).json({ error: r.error, kind: r.kind, detail: r.detail });
  const plan = parsePlan(r.text);
  const built = plan && buildClaudePath(plan, q, level, snapshot());
  if (!built || built.steps.length < 2) return res.status(502).json({ error: $t('Claude did not return a usable path. Try again or with a more powerful level.'), kind: 'format', detail: String(r.text).slice(0, 600) });
  const at = new Date().toISOString();
  const keep = Object.entries({ ...cache, [key]: { at, q, plan, areas: sc.areas, focus: sc.focus } }).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 80);
  try { fs.mkdirSync(OUTPUTS, { recursive: true }); fs.writeFileSync(PATHS_FILE, JSON.stringify(Object.fromEntries(keep))); } catch {}
  res.json({ ...built, cached: false, savedAt: at });
});

// ---------- Пояснения и подобрения от страницата ----------
// Claude само чете и предлага; промяната се прави от сървъра след потвърждение, с точка за „Върни“.
app.use(['/api/ask', '/api/improve', '/api/conspect'], express.json({ limit: '256kb' }));
const levelOf = (v) => (PATH_LEVELS[v] ? v : 'medium');
const clipText = (v, n) => String(v ?? '').slice(0, n);
function fail(res, r) { res.status(r.kind === 'cancelled' ? 499 : r.kind === 'locate' || r.kind === 'empty' || r.kind === 'notes' ? 422 : 502).json({ error: r.error, kind: r.kind, detail: r.detail }); }

app.post('/api/ask', async (req, res) => {
  const b = req.body || {}, question = clipText(b.question, 2000).trim();
  if (question.length < 3) return res.status(400).json({ error: $t('Write the question.') });
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const r = await askAboutPage({ slug: String(b.slug || ''), question, selection: clipText(b.selection, 2000).trim(), level: levelOf(b.level), signal: ac.signal });
  if (res.writableEnded || res.destroyed) return;
  r.ok ? res.json({ answer: r.answer }) : fail(res, r);
});
app.post('/api/conspect', async (req, res) => {
  const b = req.body || {};
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const r = await planConspect({ slug: String(b.slug || ''), level: levelOf(b.level), signal: ac.signal });
  if (res.writableEnded || res.destroyed) return;
  r.ok ? res.json({ answer: r.answer }) : fail(res, r);
});
app.post('/api/ask/save', (req, res) => {
  const b = req.body || {};
  if (agent.isBusy()) return res.json({ ok: false, error: $t('Wait for the processing to finish.') });
  const before = agent.checkpoint('Before saving an answer');
  const r = saveAnswer({ slug: String(b.slug || ''), question: clipText(b.question, 2000), answer: clipText(b.answer, 20000) });
  if (!r.ok) return res.json(r);
  const after = agent.checkpoint(`Saved answer: ${r.title.slice(0, 60)}`);
  agent.record({ kind: 'improve', target: r.slug, label: $t('Saved question: {0}', [r.title.slice(0, 60)]), report: $t('The answer was saved as a “Question” page and can be found by search and paths.'), commitBefore: before, commitAfter: after, mode: null });
  res.json(r);
});
app.post('/api/improve', async (req, res) => {
  const b = req.body || {}, mode = b.mode === 'selection' ? 'selection' : 'answer';
  const args = { slug: String(b.slug || ''), mode, level: levelOf(b.level), question: clipText(b.question, 2000).trim(), answer: clipText(b.answer, 20000).trim(), selection: clipText(b.selection, 4000).trim(), instruction: clipText(b.instruction, 2000).trim() };
  if (mode === 'selection' && (!args.selection || args.instruction.length < 3)) return res.status(400).json({ error: $t('Select text and write how it should change.') });
  if (mode === 'answer' && (!args.answer || !args.question)) return res.status(400).json({ error: $t('The question or the answer is missing.') });
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const r = await proposeChange({ ...args, signal: ac.signal });
  if (res.writableEnded || res.destroyed) return;
  r.ok ? res.json(r.proposal) : fail(res, r);
});
app.post('/api/improve/replace', (req, res) => {
  const r = proposeReplace({ slug: String(req.body?.slug || ''), answer: clipText(req.body?.answer, 60000), selection: clipText(req.body?.selection, 4000).trim() });
  r.ok ? res.json(r.proposal) : fail(res, r);
});
app.post('/api/improve/apply', (req, res) => {
  if (agent.isBusy()) return res.json({ ok: false, error: $t('Wait for the processing to finish.') });
  const before = agent.checkpoint('Before improving a page');
  const r = applyProposal(String(req.body?.id || ''));
  if (!r.ok) return res.json(r);
  const after = agent.checkpoint(`Improved page: ${r.title}`);
  const rec = { kind: 'improve', target: r.slug, label: $t('Improved: {0}', [r.title]), report: r.bits.join('; ') + '.', commitBefore: before, commitAfter: after, mode: null };
  agent.record(rec);
  res.json({ ...r, undoId: agent.snapshot().history[0]?.id || null });
});

// Ръчна редакция и преименуване (без Claude). Връзките [[…]] не се променят; всяка промяна има точка за „Върни“.
app.use('/api/page', express.json({ limit: '256kb' }));
function manual(res, label, run) {
  if (agent.isBusy()) return res.json({ ok: false, error: $t('Wait for the processing to finish.') });
  const before = agent.checkpoint(`Before: ${label}`);
  const r = run();
  if (!r.ok) return res.json(r);
  const after = agent.checkpoint(`${label[0].toUpperCase()}${label.slice(1)}: ${r.title}`);
  agent.record({ kind: 'improve', target: r.slug, label: `${label[0].toUpperCase()}${label.slice(1)}: ${r.title}`, report: r.bits.join('; ') + '.', commitBefore: before, commitAfter: after, mode: null });
  res.json({ ...r, undoId: agent.snapshot().history[0]?.id || null });
}
app.post('/api/page/locate', (req, res) => res.json(locateForEdit(String(req.body?.slug || ''), clipText(req.body?.selection, 4000))));
app.post('/api/page/edit', (req, res) => {
  const b = req.body || {};
  manual(res, $t('manual edit'), () => applyManualEdit({ slug: String(b.slug || ''), before: clipText(b.before, 40000), after: clipText(b.after, 40000), hash: String(b.hash || '') }));
});
app.post('/api/page/delete-paragraph', (req, res) => {
  const b = req.body || {};
  manual(res, $t('paragraph removal'), () => applyParagraphDelete({ slug: String(b.slug || ''), before: clipText(b.before, 40000), hash: String(b.hash || '') }));
});
app.post('/api/page/link', (req, res) => {
  const b = req.body || {};
  manual(res, $t('adding a link'), () => applyLink({ slug: String(b.slug || ''), selection: clipText(b.selection, 4000), target: String(b.target || '') }));
});
app.post('/api/page/rename', (req, res) => {
  const b = req.body || {};
  manual(res, $t('renaming'), () => renamePage({ slug: String(b.slug || ''), title: clipText(b.title, 400) }));
});

// ---------- Области на знанието ----------
app.use('/api/areas', express.json({ limit: '64kb' }));
app.get('/api/areas', (_req, res) => {
  const { pages } = snapshot();
  const info = listAreas(pages);
  const map = areaMap(pages);
  res.json({ ...info, sources: pages.filter((p) => p.data.type === 'source').map((p) => ({ slug: p.slug, title: String(p.data.title || p.slug), area: map.get(p.slug)?.area || null, authors: p.data.authors || null, year: p.data.year || null })).sort((a, b) => a.title.localeCompare(b.title, 'bg')) });
});
app.post('/api/areas/rename', (req, res) => manual(res, $t('area renaming'), () => renameArea(String(req.body?.from || ''), String(req.body?.to || ''))));
app.post('/api/areas/set', (req, res) => manual(res, $t('area change'), () => setArea(String(req.body?.slug || ''), String(req.body?.area ?? ''))));
app.post('/api/areas/apply', (req, res) => manual(res, $t('area detection'), () => applyAssignments(Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [])));
app.post('/api/areas/classify', async (req, res) => {
  const L = PATH_LEVELS[req.body?.level] || PATH_LEVELS.light, ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const r = await proposeClassification((prompt) => askClaude({ prompt, model: L.model, effort: L.effort, maxTurns: 4, timeoutMs: L.timeoutMs, signal: ac.signal }));
  if (res.writableEnded || res.destroyed) return;
  r.ok ? res.json(r) : fail(res, r);
});
// Предложени теми в избраните области (без Claude): понятия, теми и сравнения, близки до въпроса
app.get('/api/topics', (req, res) => {
  const q = String(req.query.q || '').trim(), sc = { areas: scopeOf(req.query).areas, focus: [] };
  const { terms, scored, ctx } = rank(q, sc);
  const ok = (p) => ['concept', 'topic', 'comparison'].includes(p.data.type);
  const inScope = scopeFilter(ctx.pages, sc);
  let list = terms.length ? scored.filter((s) => ok(s.p)).map((s) => s.p)
    : ctx.pages.filter((p) => !SPECIAL.has(p.slug) && ok(p) && (!inScope || inScope(p))).sort((a, b) => (ctx.backlinks.get(b.slug)?.length || 0) - (ctx.backlinks.get(a.slug)?.length || 0));
  res.json(list.slice(0, 14).map((p) => ({ slug: p.slug, title: String(p.data.title || p.slug), type: p.data.type, area: AREAS.get(p.slug)?.area || null, backlinks: ctx.backlinks.get(p.slug)?.length || 0 })));
});

// ---------- Писане с wiki: научна статия от страниците на библиотеката ----------
// Бърза чернова (без Claude) или текст от Claude (лек, среден, мощен). Готовият текст се записва в drafts/<id>.md.
app.use(['/api/write', '/api/drafts'], express.json({ limit: '4mb' }));
app.post('/api/write', async (req, res) => {
  const b = req.body || {}, topic = clipText(b.topic, 400).trim().replace(/\s+/g, ' ');
  const level = b.level === 'local' || PATH_LEVELS[b.level] ? b.level : 'local';
  const length = LENGTHS[b.length] ? b.length : 'medium';
  if (topic.length < 4) return res.status(400).json({ error: $t('Write the topic.') });
  const sc = scopeOf(b), { scored, ctx } = rank(topic, sc);
  let r;
  if (level === 'local') {
    r = buildLocal(topic, { pages: ctx.pages, scored });
    if (!r) return fail(res, { kind: 'empty', error: $t('The library says nothing on this topic. Try other words or process sources about it first.') });
  } else {
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });
    const hints = [scopeNote(sc, ctx.pages), scored.slice(0, 30).map((s) => `${s.p.slug} | ${s.p.data.type} | ${String(s.p.data.title || s.p.slug)}`).join('\n')].filter(Boolean).join('\n\n');
    r = await writeWithClaude({ topic, level, length, voice: clipText(b.voice, 1500).trim(), hints, pages: ctx.pages, signal: ac.signal });
    if (res.writableEnded || res.destroyed) return;
    if (!r.ok) return fail(res, r);
  }
  res.json({ ...saveDraft({ markdown: r.markdown, topic, level, length, cited: r.cited, warnings: r.warnings }), level });
});
// Дописване на записана статия с Claude: връща новия текст за преглед, записът е отделен (PUT)
app.post('/api/drafts/:id/continue', async (req, res) => {
  const b = req.body || {}, d = readDraft(req.params.id);
  if (!d) return res.status(404).json({ error: $t('There is no such text') });
  if (!PATH_LEVELS[b.level]) return res.status(400).json({ error: $t('Choose a Claude level.') });
  const body = clipText(b.body, 200000) || d.body, instruction = clipText(b.instruction, 1000).trim();
  const n = Math.min(1500, Math.max(200, Number(b.words) || 600));
  const sc = scopeOf(b), { scored, ctx } = rank(instruction || d.topic || d.title, sc);
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const hints = [scopeNote(sc, ctx.pages), scored.slice(0, 30).map((s) => `${s.p.slug} | ${s.p.data.type} | ${String(s.p.data.title || s.p.slug)}`).join('\n')].filter(Boolean).join('\n\n');
  const r = await continueWithClaude({ body, title: d.title, instruction, level: b.level, words: n, hints, pages: ctx.pages, signal: ac.signal });
  if (res.writableEnded || res.destroyed) return;
  r.ok ? res.json(r) : fail(res, r);
});
app.get('/api/drafts', (req, res) => res.json(listDrafts(String(req.query.q || ''))));
app.get('/api/drafts/:id', (req, res) => { const d = readDraft(req.params.id); d ? res.json(d) : res.status(404).json({ error: $t('There is no such text') }); });
app.put('/api/drafts/:id', (req, res) => res.json(updateDraft(req.params.id, req.body?.body)));
app.delete('/api/drafts/:id', (req, res) => res.json(trashDraft(req.params.id)));

// ---------- Дубликати по изписване и обединяване ----------
app.use(['/api/merge', '/api/dupes', '/api/authors'], express.json({ limit: '32kb' }));
app.get('/api/dupes', (_req, res) => res.json(findDupes()));
app.post('/api/dupes/ignore', (req, res) => { ignorePair(String(req.body?.a || ''), String(req.body?.b || '')); res.json({ ok: true }); });
app.get('/api/merge/preview', (req, res) => res.json(planMerge(String(req.query.keep || ''), String(req.query.drop || ''))));
app.post('/api/merge', (req, res) => {
  const keep = String(req.body?.keep || ''), drop = String(req.body?.drop || '');
  if (agent.isBusy()) return res.json({ ok: false, error: $t('Wait for the processing to finish.') });
  const before = agent.checkpoint(`Before merging: ${drop} into ${keep}`);
  const r = applyMerge(keep, drop);
  if (!r.ok) return res.json(r);
  const after = agent.checkpoint(`Merged: ${r.drop.title} and ${r.keep.title}`);
  agent.record({ kind: 'merge', target: keep, label: $t('Merged: {0} and {1}', [r.drop.title, r.keep.title]), report: $t('Links in {0} pages point to “{1}”. Archive: {2}.', [r.touched.length, r.keep.title, r.archive]), commitBefore: before, commitAfter: after, mode: null });
  res.json(r);
});
// ---------- Обединяване на отделно качени източници в книга с глави ----------
app.use(['/api/merge-sources'], express.json({ limit: '32kb' }));
app.post('/api/merge-sources/preview', (req, res) => {
  const title = String(req.body?.title || ''), slugs = [].concat(req.body?.slugs || []).map(String);
  res.json(planMergeBook(title, slugs));
});
app.post('/api/merge-sources', (req, res) => {
  const title = String(req.body?.title || ''), slugs = [].concat(req.body?.slugs || []).map(String);
  if (agent.isBusy()) return res.json({ ok: false, error: $t('Wait for the processing to finish.') });
  const before = agent.checkpoint(`Before merging into a book: ${title}`);
  const r = applyMergeBook(title, slugs);
  if (!r.ok) return res.json(r);
  const after = agent.checkpoint(`Book from merged sources: ${r.title}`);
  agent.record({ kind: 'merge', target: r.bookSlug, label: $t('Book: {0}', [r.title]), report: $t('Merged {0} sources into chapters. Archive: {1}.', [slugs.length, r.archive]), commitBefore: before, commitAfter: after, mode: null });
  res.json(r);
});
app.post('/api/authors/normalize', (req, res) => {
  const canonical = String(req.body?.canonical || '').trim(), names = [].concat(req.body?.names || []).map(String);
  if (!canonical || !names.length) return res.json({ ok: false, error: $t('The spelling is missing.') });
  if (agent.isBusy()) return res.json({ ok: false, error: $t('Wait for the processing to finish.') });
  const before = agent.checkpoint(`Before unifying an author spelling: ${canonical}`);
  const r = normalizeAuthors(canonical, names);
  const after = agent.checkpoint(`Unified author spelling: ${canonical}`);
  agent.record({ kind: 'merge', target: canonical, label: $t('Author: {0}', [canonical]), report: $t('Updated sources: {0}.', [r.files]), commitBefore: before, commitAfter: after, mode: null });
  res.json(r);
});

app.get('/api/stats', (_req, res) => {
  const { pages } = snapshot();
  const raw = rawFiles();
  const pending = ingestState(pages, raw).pending.map((f) => ({ path: normRaw(rel(f)), name: path.basename(f).normalize('NFC'), folder: rel(f).split('/')[1], bytes: fs.statSync(f).size }));
  // Дубликати: първо по размер (бързо), после по SHA-256 спрямо manifest.json
  const known = Object.entries(loadManifest().files);
  const inbox = walk(INBOX).filter((f) => !f.endsWith('.gitkeep') && !f.endsWith('.part')).map((f) => {
    const bytes = fs.statSync(f).size;
    const same = known.filter(([, e]) => e.bytes === bytes);
    let duplicateOf = null;
    if (same.length) { const h = sha256(f); duplicateOf = same.find(([, e]) => e.sha256 === h)?.[0] || null; }
    return { name: path.basename(f), bytes, duplicateOf };
  });
  res.json({
    raw: raw.length, pending, inbox, ...contentStats(),
    depth: (({ total, current, legacy }) => ({ total, current, legacy: legacy.slice(0, 60) }))(legacySources(pages)),
  });
});

app.get('/api/graph', (_req, res) => res.json(graphData()));

// ---------- Статичен архив за четене: ZIP с index.html и markdown файловете на wiki/ (без raw/) ----------
app.post('/api/archive', (req, res) => {
  try { res.json({ ok: true, ...writeArchive({ lang: pickLang(req) }) }); }
  catch (e) { res.status(500).json({ ok: false, error: $t('The archive could not be made.') + ' ' + e.message }); }
});
app.get('/api/archives', (_req, res) => res.json(listArchives()));
app.get('/api/archive/:name', (req, res) => {
  if (!isArchiveName(req.params.name) || !fs.existsSync(archiveFile(req.params.name))) return res.status(404).end();
  res.download(archiveFile(req.params.name), req.params.name);
});
app.delete('/api/archive/:name', (req, res) => {
  if (!deleteArchive(req.params.name)) return res.status(404).json({ ok: false, error: $t('There is no such archive') });
  res.json({ ok: true });
});

// Качване на файл в raw/inbox (тялото на заявката е самият файл)
app.put('/api/upload', (req, res) => {
  let name;
  try { name = decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { name = ''; }
  name = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim();
  if (!name || name.startsWith('.')) return res.status(400).json({ error: $t('Invalid file name') });
  fs.mkdirSync(INBOX, { recursive: true });
  let target = path.join(INBOX, name);
  const { name: base, ext } = path.parse(name);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(INBOX, `${base}-${i}${ext}`);
  const tmp = target + '.part';
  const out = fs.createWriteStream(tmp);
  let bytes = 0, aborted = false;
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD && !aborted) { aborted = true; out.destroy(); fs.rmSync(tmp, { force: true }); res.status(413).json({ error: $t('The file is over 2 GB') }); req.destroy(); }
  });
  req.pipe(out);
  out.on('finish', () => {
    if (aborted) return;
    fs.renameSync(tmp, target);
    res.json({ ok: true, name: path.basename(target), bytes });
  });
  out.on('error', (e) => { if (!aborted) { fs.rmSync(tmp, { force: true }); res.status(500).json({ error: e.message }); } });
});

// ---------- Живи събития към страницата ----------
const clients = new Set();
const broadcast = (obj) => { const msg = `data: ${JSON.stringify(obj)}\n\n`; clients.forEach((c) => c.write(msg)); };

// ---------- Обработка с Claude Code ----------
ensureStarter();
const agent = createAgent({ broadcast });
app.use('/api/agent', express.json({ limit: '64kb' }));
// Смяна на езика: интерфейсът следва бисквитката, а езикът на съдържанието (CLAUDE.md, скилове, шаблони, промптове)
// се сменя тук, за да са на един език. Без пакет за този език се ползва английският.
app.use('/api/lang', express.json({ limit: '1kb' }));
app.post('/api/lang', (req, res) => {
  const code = String(req.body?.code || '');
  if (!hasLocale(code)) return res.status(400).json({ error: $t('Unknown language.') });
  // Докато Claude работи, езикът не се сменя (CLAUDE.md и шаблоните се четат при всяко задание): отказваме с причина
  if (agent.isBusy()) return res.json({ ok: false, error: $t('Wait for the processing to finish.') });
  const pack = packs().includes(code) ? code : 'en';
  res.json({ ok: true, content: installPack(pack).ok ? pack : null });
});
app.use('/api/estimate', express.json({ limit: '64kb' }));
// Оценка на токени и цена преди действие с Claude (нищо не се праща към Claude)
/** Настройки само за едно действие: режим (с него се чистят изборите на модел) и език на индексиране */
function cleanOpts(o) {
  const out = {};
  if (['economy', 'balanced', 'best'].includes(o?.mode)) Object.assign(out, { mode: o.mode, reader: '', writer: '' });
  if (['bg', 'both', 'original'].includes(o?.lang)) out.lang = o.lang;
  return out;
}
app.post('/api/estimate', (req, res) => {
  try { res.json(estimate(String(req.body?.kind || ''), req.body || {}, { settings: { ...agent.settings, ...cleanOpts(req.body?.opts) } })); }
  catch (e) { res.json({ ok: false, error: e.message || $t('The estimate failed.') }); }
});
app.get('/api/agent', (_req, res) => res.json(agent.snapshot()));
app.post('/api/agent/ingest', (req, res) => res.json({ queued: agent.enqueuePending(Array.isArray(req.body?.paths) ? req.body.paths.map(String) : undefined, cleanOpts(req.body?.opts)) }));
app.post('/api/agent/chapters', (req, res) => {
  const slug = String(req.body?.slug || '');
  const p = wikiPages().find((x) => x.slug === slug && x.data.type === 'source');
  if (!p) return res.status(404).json({ error: $t('There is no such book') });
  res.json({ queued: agent.enqueueChapters(slug, p.data.title) });
});
app.post('/api/agent/upgrade', (req, res) => res.json({ queued: agent.enqueueUpgrades(Array.isArray(req.body?.slugs) ? req.body.slugs.map(String) : null) }));
app.post('/api/agent/synthesis', (req, res) => res.json({ queued: agent.enqueueSynthesis(req.body?.tag ? String(req.body.tag) : null) }));
app.post('/api/agent/cancel', (_req, res) => { agent.cancel(); res.json({ ok: true }); });
app.post('/api/agent/resume', (_req, res) => { agent.resume(); res.json({ ok: true }); });
app.post('/api/agent/undo', (req, res) => res.json(agent.undo(String(req.body?.id || ''))));
app.post('/api/index/rebuild', (_req, res) => {
  if (agent.isBusy()) return res.json({ ok: false, error: $t('Wait for the processing to finish.') });
  const before = agent.checkpoint('Before rebuilding the index, log and overview');
  const r = rebuildAll();
  const after = agent.checkpoint('Index, log and overview rebuilt');
  agent.record({ kind: 'index', target: 'index', label: $t('Index, log and overview rebuilt'), report: $t('Index: {0} pages. Restored log entries: {1}. Old versions are in outputs/.', [r.counts.index, r.restoredLog]), commitBefore: before, commitAfter: after, mode: null });
  res.json({ ok: true, count: r.counts.index, restoredLog: r.restoredLog, backups: r.backups });
});
app.use('/api/remove', express.json({ limit: '16kb' }));
app.get('/api/remove/preview', (req, res) => res.json(planRemoval(String(req.query.slug || ''))));
app.post('/api/remove', (req, res) => {
  const slug = String(req.body?.slug || '');
  if (agent.isBusy()) return res.json({ ok: false, error: $t('Wait for the processing to finish.') });
  const before = agent.checkpoint(`Before removal: ${slug}`);
  const r = applyRemoval(slug);
  if (!r.ok) return res.json(r);
  const after = agent.checkpoint(`Removed source: ${r.title}`);
  agent.record({ kind: 'remove', target: slug, label: $t('Removed: {0}', [r.title]), report: $t('Removed {0} pages, cleaned citations in {1}. Archive: {2}.', [r.pages.length, r.touched.length, r.archive]), commitBefore: before, commitAfter: after, mode: null });
  res.json(r);
});
app.get('/api/setup', (_req, res) => res.json(checkSetup()));
app.post('/api/setup/test', async (_req, res) => res.json(await testClaude()));

// Страница „Настройки“. GET не излиза от компютъра; POST маршрутите се пускат само с бутон.
app.get('/api/settings', (_req, res) => res.json({ ...versionInfo(), contentLang: contentLang(), account: accountTerms(), tests: latestResults(), testsRunning: testsBusy(), auth: authEnabled() }));
app.post('/api/updates/code', async (_req, res) => res.json(await checkCode()));
app.post('/api/updates/packages', async (_req, res) => res.json(await checkPackages()));
app.post('/api/tests/run', async (_req, res) => res.json(await runTests()));

app.post('/api/agent/settings', (req, res) => {
  const s = {};
  for (const k of ['autoIngest', 'autoResume', 'synthesisBest', 'confirmCost', 'setupDone']) if (k in (req.body || {})) s[k] = !!req.body[k];
  if (['economy', 'balanced', 'best'].includes(req.body?.mode)) s.mode = req.body.mode;
  if (['bg', 'both', 'original'].includes(req.body?.lang)) s.lang = req.body.lang;
  for (const k of ['reader', 'writer']) if (k in (req.body || {}) && ['', 'haiku', 'sonnet', 'opus'].includes(req.body[k])) s[k] = req.body[k];
  res.json(agent.setSettings(s));
});

// Сортиране на inbox + извличане на текст (същото като npm run inbox && npm run extract)
let busy = false;
function runScript(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', file)], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}
/** Подрежда inbox, извлича текста и (по избор на човека) пуска обработката. Един процес наведнъж. */
async function processInbox({ auto = true } = {}) {
  const a = await runScript('inbox.js');
  const b = await runScript('extract.js');
  const ok = a.code === 0 && b.code === 0;
  // при включено потвърждаване обработката не тръгва сама: човекът първо вижда оценката
  const queued = ok && auto && agent.settings.autoIngest && !agent.settings.confirmCost ? agent.enqueuePending() : 0;
  return { ok, queued, needsConfirm: ok && auto && agent.settings.autoIngest && !!agent.settings.confirmCost && ingestState().pending.length > 0, log: `${a.out}\n${b.out}`.trim() };
}
app.post('/api/inbox', async (_req, res) => {
  if (busy) return res.status(409).json({ error: $t('Already running') });
  busy = true;
  try { res.json(await processInbox()); } finally { busy = false; }
});

// Добавяне на статия по DOI или адрес. Обработката с Claude НЕ тръгва тук: страницата пита за режим и език,
// после пуска обработката само за новите файлове (paths) с избраните настройки.
app.use('/api/web', express.json({ limit: '16kb' }));
app.post('/api/web/import', async (req, res) => {
  if (busy) return res.status(409).json({ error: $t('Already running. Wait a moment.') });
  busy = true;
  try {
    const input = String(req.body?.input || '').trim();
    if (!input) return res.status(400).json({ error: $t('Paste a DOI or an address.') });
    const had = new Set(ingestState().pending.map((f) => normRaw(rel(f))));
    const r = await importPaper(input);
    if (!r.ok) return res.json(r);
    const p = await processInbox({ auto: false });
    const paths = ingestState().pending.map((f) => normRaw(rel(f))).filter((x) => !had.has(x));
    res.json({ ...r, processed: p.ok, paths, needsConfirm: p.ok && paths.length > 0 });
  } catch (e) { res.json({ ok: false, error: e.message || $t('Adding failed.') }); }
  finally { busy = false; }
});

// Изтриване на файл, който още не е обработен: от входящата кутия или от чакащите за обработка.
// Файлът се мести в raw/.trash/ (скрита папка, извън обработката), не се трие безвъзвратно.
app.use('/api/raw', express.json({ limit: '8kb' }));
app.post('/api/raw/discard', (req, res) => {
  const kind = req.body?.kind === 'pending' ? 'pending' : 'inbox';
  let file = null;
  if (kind === 'inbox') {
    const name = path.basename(String(req.body?.name || ''));
    const f = name && path.join(INBOX, name);
    if (f && !name.startsWith('.') && fs.existsSync(f) && fs.statSync(f).isFile()) file = f;
  } else {
    const want = normRaw(String(req.body?.path || ''));
    file = ingestState().pending.find((f) => normRaw(rel(f)) === want) || null; // само необработени
  }
  if (!file) return res.json({ ok: false, error: $t('The file is gone or already processed.') });
  const snap = agent.snapshot();
  const key = normRaw(rel(file));
  if (snap.current?.target === key || snap.queue?.some((q) => q.target === key)) return res.json({ ok: false, error: $t('The file is in the processing queue. Remove it from there first.') });
  const trash = path.join(RAW, '.trash');
  fs.mkdirSync(trash, { recursive: true });
  const to = path.join(trash, `${Date.now()}-${path.basename(file)}`);
  fs.renameSync(file, to);
  // следи: запис в manifest и извлеченият текст
  try {
    const m = loadManifest();
    for (const k of Object.keys(m.files || {})) if (normRaw(k) === key) delete m.files[k];
    fs.writeFileSync(path.join(RAW, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  } catch {}
  try { fs.rmSync(path.join(RAW, '.extracted', path.relative(RAW, file) + '.md'), { force: true }); } catch {}
  res.json({ ok: true, name: path.basename(file), trash: rel(to) });
});

// Живо обновяване: изпраща събитие, когато Claude промени нещо в wiki/ или raw/
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});
let debounce;
for (const dir of [WIKI, RAW]) {
  try {
    fs.watch(dir, { recursive: true }, (_e, f) => {
      if (f && (/\.part$/.test(f) || f.includes('.extracted'))) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => broadcast({ type: 'files', t: Date.now(), dir: path.basename(dir) }), 400);
    });
  } catch { /* без recursive watch страницата пак работи, просто без живо обновяване */ }
}

// Оригинални файлове (само в raw/, без .extracted)
app.get('/raw/*splat', (req, res) => {
  const target = path.resolve(RAW, ...[].concat(req.params.splat));
  if (!target.startsWith(RAW + path.sep) || target.includes(`${path.sep}.extracted${path.sep}`) || !fs.existsSync(target)) return res.status(404).send($t('There is no such file'));
  // Качен HTML или SVG не бива да се изпълнява като част от приложението: отваря се изолиран, без достъп до него.
  // PDF и обикновените изображения не носят код към страницата, а вграденият четец на браузъра не работи с тази защита.
  if (/\.(pdf|png|jpe?g|gif|webp|bmp|ico|tiff?)$/i.test(target)) res.removeHeader('Content-Security-Policy');
  else res.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");
  res.sendFile(target);
});

// Библиотеки от node_modules, за да работи без интернет
// Преводите на интерфейса: window.__I18N = { lang, locales, messages } (езикът е от бисквитката `lang` или от браузъра)
app.get('/locale.js', (req, res) => {
  const lang = pickLang(req);
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Cookie, Accept-Language' });
  res.send(`window.__I18N = ${JSON.stringify({ lang, locales: locales(), messages: messagesFor(lang), pageUnits: pageUnits().slice(3, -1), contentLang: contentLang() }).replace(/</g, '\\u003c')};`);
});
app.get('/vendor/:file', (req, res) => {
  const f = VENDOR[req.params.file];
  if (!f) return res.status(404).end();
  res.sendFile(path.join(NM, f));
});
app.use('/fonts/inter', express.static(path.join(NM, '@fontsource-variable/inter')));
app.use('/fonts/literata', express.static(path.join(NM, '@fontsource-variable/literata')));

app.use('/product', express.static(path.join(ROOT, 'docs'))); // страницата за продукта; същата се публикува и в GitHub Pages
app.use(express.static(path.join(ROOT, 'scripts', 'viewer')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  📚 ${$t('The library is open at http://localhost:{0} (and at http://{1}, if it is set in hosts)', [PORT, WIKI_HOST])}\n     ${$t('Ctrl+C to stop')}\n`);
});
