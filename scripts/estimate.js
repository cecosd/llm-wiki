// Estimate of the tokens and the cost BEFORE an action with Claude. Nothing is sent to Claude from here.
//
// Where the numbers come from:
//  - Prices (USD per million tokens): the official Anthropic pricing page
//    (https://platform.claude.com/docs/en/about-claude/pricing, checked on 31.10.2026). They can be edited in library.config.json ("prices").
//  - Tokens: an approximation by the number of characters (Cyrillic is about 2.2 characters per token, Latin about 3.8). The error is typically +/-30%.
//  - Claude Code does not send only your text: it adds its own system prompt and descriptions of the tools, reads files
//    in several steps and every time sends the context so far again (most often from the cache, which is 10 times cheaper).
//    So the estimate is a RANGE (0.6 to 1.8 times the average), not an exact sum.
//  - With a subscription sign-in (claude login) you do not pay per token: the sum is an "equivalent at API prices" and shows how heavy the action is for the limit.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, EXTRACTED, RAW, wikiPages, ingestState, normRaw, rel, extractLinks } from './lib.js';
import { effectiveModels, PATH_LEVELS, legacySources } from './agent.js';
import { costInputs, groundingOf } from './improve.js';
import { classifyPrompt } from './areas.js';
import { LENGTHS } from './write.js';
import { $t } from './i18n.js';
import { aiConfig } from './providers.js';
import { TIER_OF } from './pipeline.js';
import { textBudget } from './ai.js';
import { weakPages } from './scan.js';

export const PRICE_DATE = '2026-10-31';
const DEFAULT_PRICES = {
  haiku:  { in: 0.10, out: 0.50, cache: 0.01, bigIn: 0.50, bigOut: 2.50, bigCache: 0.05 },
  sonnet: { in: 2, out: 10, cache: 0.10 },
  opus:   { in: 4, out: 20, cache: 0.20 },
};
function prices() {
  try { return { ...DEFAULT_PRICES, ...(JSON.parse(fs.readFileSync(path.join(ROOT, 'library.config.json'), 'utf8')).prices || {}) }; } catch { return DEFAULT_PRICES; }
}

const BASE_OVERHEAD = 14000; // the system prompt and the tool descriptions of Claude Code (a rough value)

export function tokensOf(text) {
  const s = String(text || ''); let cyr = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0x400 && c <= 0x4ff) cyr++; }
  return Math.ceil(cyr / 2.2 + (s.length - cyr) / 3.8);
}
const readTokens = (file) => { try { return tokensOf(fs.readFileSync(file, 'utf8')); } catch { return 0; } };
// Writing: by the length of the text or, for continuing and a paragraph, by the requested number of words
const writeWords = (b) => (Number(b.words) > 0 ? Math.min(3000, Number(b.words)) : (LENGTHS[b.length] || LENGTHS.medium).words);
// Review with the wiki: the whole text goes into the request (and comes out again when fixing), and for every cited work
// the source page and the cited pages of the original are read. sources = how many different works the text cites.
const reviewSize = (b) => {
  const words = Math.min(30000, Math.max(100, Number(b.words) || 1500));
  return { words, text: Math.round(words * 2.4), works: Math.min(80, Math.max(1, Number(b.sources) || Math.round(words / 250))), report: b.mode === 'report' };
};
// Photos of pages: an image of 1568 px costs about (width x height) / 750 tokens, at most about 1600 (Anthropic, n.d.,
// "Vision"); a full page of text is about 700 tokens out (Cyrillic, about 350 words).
const IMAGE_TOKENS = 1600, PAGE_OUT = 900;
const scanPagesOf = (b) => {
  if (Array.isArray(b.pages) && b.pages.length) return Math.min(1000, b.pages.length);
  try { return b.id ? weakPages(String(b.id)).length : 0; } catch { return 0; }
};
const claudeMdTokens = () => readTokens(path.join(ROOT, 'CLAUDE.md'));
const wikiTokens = () => wikiPages().reduce((n, p) => n + tokensOf(p.content), 0);

// The average context per step once the window of Claude Code (200K) is full: it grows, gets compacted and grows again
const SYNTH_CONTEXT = 150000;
/**
 * What the synthesis reads, by the skill wiki-synthesis: index.md, overview.md, the topics and the comparisons, then only
 * the concepts (with the tag, if one is given) that at least two different books cite, and the chapters those concepts cite.
 * The selection of concepts is the same as in synthesisJob (pipeline.js).
 */
export function synthesisPlan(tag) {
  const pages = wikiPages();
  const by = new Map(pages.map((p) => [p.slug, p]));
  const bookOf = (s) => {
    const p = by.get(s); if (!p) return null;
    if (p.data.type === 'source') return s;
    if (p.data.type === 'chapter') return extractLinks(String(p.data.book || ''))[0] || null;
    return null;
  };
  const t = tag && tag !== '*' ? String(tag) : null;
  const inTag = (p) => !t || [].concat(p.data.tags || []).map(String).includes(t);
  const fixed = pages.filter((p) => p.slug === 'index' || p.slug === 'overview' || p.data.type === 'topic' || p.data.type === 'comparison');
  const multi = pages.filter((p) => p.data.type === 'concept' && inTag(p))
    .map((p) => ({ p, links: extractLinks(p.content) }))
    .filter((x) => new Set(x.links.map(bookOf).filter(Boolean)).size >= 2);
  const chapterSlugs = new Set(multi.flatMap((x) => x.links.filter((s) => by.get(s)?.data?.type === 'chapter')));
  const tok = (list) => list.reduce((n, p) => n + tokensOf(p.content), 0);
  return {
    tag: t, concepts: multi.length, chapters: chapterSlugs.size, fixed: fixed.length,
    fixedTokens: tok(fixed), conceptTokens: tok(multi.map((x) => x.p)), chapterTokens: tok([...chapterSlugs].map((s) => by.get(s))),
  };
}
const synthNothing = (plan) => (plan.tag
  ? $t('No concept with the tag “{0}” is cited by two or more sources: there will be no comparisons, only hubs, the overview and the gaps.', [plan.tag])
  : $t('No concept is cited by two or more sources yet: there will be no comparisons, only hubs, the overview and the gaps.'));

function rate(model, ctx) {
  const cfg = aiConfig();
  if (cfg.local || cfg.engine === 'manual') return { in: 0, out: 0, cache: 0 };
  if (cfg.preset.vendor !== 'Anthropic') {
    // another provider: the prices are those the person entered for the level; without them the sum is unknown
    const p = cfg.prices[TIER_OF[model] || 'medium'];
    return p ? { in: p.in, out: p.out, cache: p.in * 0.1 } : null;
  }
  const P = prices()[model] || prices().sonnet;
  const big = model === 'haiku' && ctx > 100000;
  return { in: big ? P.bigIn : P.in, out: big ? P.bigOut : P.out, cache: big ? P.bigCache : P.cache };
}
/** The name of the model for display: with another provider the model of the level instead of haiku/sonnet/opus */
const shownModel = (model) => { const cfg = aiConfig(); return cfg.preset.vendor === 'Anthropic' ? model : (cfg.models[TIER_OF[model]] || model); };

/**
 * One run of `claude -p`: initial context (system + CLAUDE.md + prompt) + what was read. At every step the
 * context is read again from the cache; the new part is written to the cache at 1.25 times the input price.
 */
export function runCost({ model, promptTokens = 0, reads = 0, out = 0, turns = 6, cap = Infinity }) {
  const ctx0 = BASE_OVERHEAD + claudeMdTokens() + promptTokens;
  const fresh = ctx0 + reads;
  // cap: the context cannot grow past the window of the model; Claude Code compacts it, so a long run re-reads at most about that much per step
  const cached = Math.max(0, turns - 1) * Math.min(ctx0 + reads / 2, cap);
  const r = rate(model, fresh);
  const usd = r ? (fresh * 1.25 * r.in + cached * r.cache + out * r.out) / 1e6 : null;
  return { model: shownModel(model), input: Math.round(fresh + cached), fresh: Math.round(fresh), cached: Math.round(cached), output: Math.round(out), usd, turns };
}

const sum = (parts, spread = [0.6, 1.8]) => {
  const known = parts.every((p) => typeof p.usd === 'number');
  const usd = parts.reduce((n, p) => n + (p.usd || 0), 0);
  return {
    parts,
    input: parts.reduce((n, p) => n + p.input, 0), cached: parts.reduce((n, p) => n + p.cached, 0), output: parts.reduce((n, p) => n + p.output, 0),
    usd: known ? { low: usd * spread[0], mid: usd, high: usd * spread[1] } : null,
    models: [...new Set(parts.map((p) => p.model).filter(Boolean))],
    calls: parts.reduce((n, p) => n + (p.calls || 0), 0),
  };
};

// ---------- Without tools (pipeline.js and ai.js): the requests are known in advance, so the estimate is narrower ----------
const ANTHROPIC_TIER = { light: 'haiku', medium: 'sonnet', strong: 'opus' };
function callCost(tier, input, output, calls = 1) {
  const cfg = aiConfig();
  let p = null;
  if (cfg.local || cfg.engine === 'manual') p = { in: 0, out: 0 };
  else if (cfg.prices[tier]) p = cfg.prices[tier];
  else if (cfg.preset.vendor === 'Anthropic') p = prices()[ANTHROPIC_TIER[tier]];
  const model = cfg.engine === 'manual' ? cfg.name : (cfg.models[tier] || tier);
  return { model, input: Math.round(input), fresh: Math.round(input), cached: 0, output: Math.round(output), usd: p ? (input * p.in + output * p.out) / 1e6 : null, calls };
}
function pipelineIngest(files, settings, kind) {
  const cfg = aiConfig();
  const eff = effectiveModels(settings, kind);
  const reader = cfg.engine === 'manual' ? 'medium' : TIER_OF[eff.reader] || 'light';
  const writer = cfg.engine === 'manual' ? 'medium' : TIER_OF[eff.writer] || 'medium';
  const rb = Math.max(1200, Math.floor(cfg.context * 0.85) - 1800 - 1100);
  const batch = cfg.engine === 'manual' ? 12 : Math.max(1, Math.min(cfg.context >= 100000 ? 12 : 6, Math.floor((cfg.context * 0.35) / 650))); // like batchSize in pipeline.js
  const parts = [], items = [];
  for (const raw of files) {
    const ex = path.join(EXTRACTED, path.relative(RAW, path.join(ROOT, raw)) + '.md');
    const exists = fs.existsSync(ex);
    const tok = exists ? readTokens(ex) : Math.round((fs.existsSync(path.join(ROOT, raw)) ? fs.statSync(path.join(ROOT, raw)).size : 0) / 6);
    const isBook = /(^|\/)books\//.test(raw) || tok > 60000;
    const chapters = isBook ? Math.max(4, Math.round(tok / 9000)) : 0;
    const notes = Math.max(1, isBook ? Math.max(chapters, Math.ceil(tok / rb)) : Math.ceil(tok / rb));
    const K = isBook ? 12 : 6, batches = Math.ceil(K / batch) * 2;
    const mine = kind === 'chapters'
      ? [callCost(writer, Math.min(7000, tok) + 900, 1500), callCost(reader, tok + notes * 800, notes * 900, notes)]
      : [
        callCost(writer, Math.min(7000, tok) + 900, isBook ? 1500 : 700),
        callCost(reader, tok + notes * 800, notes * 900, notes),
        callCost(writer, Math.min(rb, notes * 500 + 3500) + 900, 1500),
        callCost(writer, batches * 1500 + K * 350, K * 420, batches),
      ];
    parts.push(...mine);
    const usd = mine.every((p) => typeof p.usd === 'number') ? mine.reduce((n, p) => n + p.usd, 0) : null;
    items.push({ name: path.basename(raw), tokens: tok, usd, book: isBook, found: exists, calls: mine.reduce((n, p) => n + p.calls, 0) });
  }
  return { parts, items, reader: cfg.models[reader], writer: cfg.models[writer] };
}

function pipelineEstimate(kind, b, settings) {
  const cfg = aiConfig();
  let parts = [], extra = {}, title = '', warn = [];
  const lvl = PATH_LEVELS[b.level] ? b.level : (kind === 'areas' ? 'light' : 'medium');
  const budget = textBudget(lvl, 2500, cfg);
  if (kind === 'ask' || kind === 'improve') {
    const ci = costInputs({ slug: b.slug, question: b.question, selection: b.selection, answer: b.answer, instruction: b.instruction, withBody: kind === 'improve' });
    if (!ci) return { ok: false, error: $t('There is no such page.') };
    title = kind === 'ask' ? $t('Question to {ai}') : $t('Suggestion for a change');
    const pages = wikiPages(), p = pages.find((x) => x.slug === b.slug);
    const reads = p ? groundingOf(p, pages).reduce((n, g) => n + readTokens(path.join(ROOT, g.file)), 0) : 0;
    parts = [callCost(lvl, Math.min(budget, tokensOf(ci.page) + reads) + tokensOf(ci.text) + 700, kind === 'ask' ? 900 : 2500)];
  } else if (kind === 'conspect') {
    const pages = wikiPages(), p = pages.find((x) => x.slug === b.slug);
    if (!p) return { ok: false, error: $t('There is no such page.') };
    title = $t('Outline of the original');
    const g = groundingOf(p, pages);
    const reads = g.length ? g.reduce((n, x) => n + readTokens(path.join(ROOT, x.file)), 0) : tokensOf(p.content);
    if (!g.length) warn.push($t('There is no original text available for this page: the outline will be based on the text in wiki/.'));
    if (reads > budget) warn.push($t('The original is longer than the context of the model: only its beginning (about {0} tokens) fits in the request.', [budget]));
    parts = [callCost(lvl, Math.min(budget, reads) + 900, Math.min(5000, 1800 + Math.min(budget, reads) * 0.12))];
  } else if (kind === 'path' || kind === 'write') {
    if (!PATH_LEVELS[b.level]) return { ok: false, error: $t('Unknown level.') };
    const words = kind === 'write' ? writeWords(b) : 0;
    title = kind === 'path' ? $t('Learning path') : $t('Writing with {ai}');
    parts = [callCost(lvl, Math.min(budget, wikiTokens()) + 1600 + tokensOf(b.topic || b.q), kind === 'write' ? words * 2.4 + 700 : 2500)];
  } else if (kind === 'review') {
    if (!PATH_LEVELS[b.level]) return { ok: false, error: $t('Unknown level.') };
    const s = reviewSize(b);
    title = $t('Review with {ai}');
    parts = [callCost(lvl, Math.min(budget, s.text + 4000 + s.works * 1200) + 2500, s.report ? 3500 : s.text + 3500)];
    if (s.text > budget * 0.45) warn.push($t('The text is longer than the context of the model allows: only its beginning fits in the request.'));
  } else if (['ingest', 'upgrade', 'chapters'].includes(kind)) {
    let files = [];
    if (kind === 'ingest') {
      files = Array.isArray(b.paths) && b.paths.length ? b.paths.map(String) : ingestState().pending.map((f) => normRaw(rel(f)));
      title = files.length === 1 ? $t('Processing a file') : $t('Processing {0} files', [files.length]);
    } else if (kind === 'upgrade') {
      const { legacy } = legacySources();
      const list = Array.isArray(b.slugs) && b.slugs.length ? legacy.filter((l) => b.slugs.includes(l.slug)) : legacy;
      files = list.map((l) => l.raw); title = $t('Upgrading {0} sources', [list.length]);
    } else {
      const p = wikiPages().find((x) => x.slug === b.slug);
      files = p?.data?.raw_path ? [String(p.data.raw_path)] : []; title = $t('Chapters of a book');
    }
    if (!files.length) return { ok: false, error: $t('There is nothing to process.') };
    const r = pipelineIngest(files, settings, kind);
    parts = r.parts; extra.items = r.items.slice(0, 12); extra.itemsMore = Math.max(0, r.items.length - 12);
    extra.delegate = cfg.engine !== 'manual' && r.reader !== r.writer; extra.reader = r.reader; extra.writer = r.writer;
    if (r.items.some((i) => !i.found)) warn.push($t('Some of the files have no extracted text yet: the estimate is based on file size.'));
    extra.past = pastAverage(kind);
  } else if (kind === 'scan-pages') {
    const n = scanPagesOf(b);
    if (!n) return { ok: false, error: $t('There is nothing to process.') };
    if (cfg.engine === 'manual') return { ok: false, error: $t('In the copy and paste mode a model cannot read photos. Choose another way of work in Settings → Model, or leave the OCR text.') };
    title = $t('Reading {0} photos of pages', [n]);
    parts = [callCost('medium', n * (IMAGE_TOKENS + 250), n * PAGE_OUT, n)];
    if (!cfg.vision) warn.push($t('The chosen model does not read images. Turn on “Reads images” in Settings → Model for a model that can.'));
  } else if (kind === 'areas') {
    const cp = classifyPrompt();
    if (!cp.count) return { ok: false, error: $t('All sources already have an area.') };
    title = $t('Areas of {0} {1}', [cp.count, cp.count === 1 ? $t('source') : $t('sources')]);
    parts = [callCost(lvl, tokensOf(cp.text) + 300, 45 * cp.count + 250)];
  } else if (kind === 'synthesis') {
    const M = cfg.engine === 'manual' ? 2 : 4;
    const plan = synthesisPlan(b.tag);
    if (!plan.concepts) warn.push(synthNothing(plan));
    title = plan.tag ? $t('Synthesis: #{0}', [plan.tag]) : $t('Library synthesis'); extra.past = pastAverage('synthesis');
    parts = [callCost('strong', M * (Math.min(budget, 6000) + 1500) + 2 * Math.min(budget, 8000), M * 1800 + 3500, M + 2)];
  } else return { ok: false, error: $t('Unknown action.') };
  // The free Groq gives a certain number of tokens per day for each model (Groq, n.d.-c). A task that needs
  // more stops at the daily limit and then starts the source over, so this is said in advance.
  if (cfg.tpd && cfg.engine !== 'manual') {
    const per = {};
    for (const p of parts) per[p.model] = (per[p.model] || 0) + p.input + p.output;
    const [m, n] = Object.entries(per).sort((a, b) => b[1] - a[1])[0] || [];
    if (n > cfg.tpd * 0.9) warn.push($t('About {0} thousand tokens go to the model “{1}”, and the free plan of {2} gives {3} thousand tokens per day for each model. The job stops at the daily limit and then starts the source again from the beginning, so it may never finish: use the free plan for articles and short texts, or a paid key.', [Math.round(n / 1000), m, cfg.name, Math.round(cfg.tpd / 1000)]));
  }
  const total = sum(parts, [0.8, 1.4]);
  const priced = cfg.local || cfg.engine === 'manual' || cfg.preset.vendor === 'Anthropic' || Object.values(cfg.prices).some(Boolean);
  if (!total.usd && !priced) warn.push($t('The prices of this model are not set, so only the tokens are shown. Enter them in Settings → Model.'));
  if (cfg.free && !cfg.local && cfg.engine !== 'manual') warn.push($t('With a free key the limits per minute and per day apply; the queue waits and continues by itself.'));
  return { ok: true, kind, title, ...total, ...extra, warnings: warn, priceDate: PRICE_DATE, overhead: 0, engine: cfg.engine, provider: cfg.provider, free: cfg.free || cfg.local || cfg.engine === 'manual', local: cfg.local, manual: cfg.engine === 'manual' };
}

const DEPTH_FRAC = { light: 0.02, medium: 0.07, strong: 0.2 };
const DEPTH_TURNS = { light: 4, medium: 8, strong: 16 };

/** How much it has cost so far: the average per task from the history of processing (if a cost was recorded) */
function pastAverage(kind) {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', '.agent-history.json'), 'utf8'));
    const xs = h.filter((e) => e.kind === kind && e.status === 'done' && typeof e.costUsd === 'number').slice(0, 10).map((e) => e.costUsd);
    return xs.length ? { n: xs.length, avg: xs.reduce((a, b) => a + b, 0) / xs.length } : null;
  } catch { return null; }
}

function ingestParts(files, settings, kind) {
  const eff = effectiveModels(settings, kind);
  const parts = [], items = [];
  for (const raw of files) {
    const ex = path.join(EXTRACTED, path.relative(RAW, path.join(ROOT, raw)) + '.md');
    const exists = fs.existsSync(ex);
    const tok = exists ? readTokens(ex) : Math.round((fs.existsSync(path.join(ROOT, raw)) ? fs.statSync(path.join(ROOT, raw)).size : 0) / 6);
    const isBook = /(^|\/)books\//.test(raw) || tok > 60000;
    const chapters = isBook ? Math.max(4, Math.round(tok / 9000)) : 0;
    const turns = Math.min(90, 12 + Math.round(tok / 6000));
    const outW = Math.min(60000, (isBook ? 8000 : 5000) + (isBook ? 0.05 : 0.04) * tok + chapters * 1200);
    const mine = [];
    if (eff.delegate && isBook) {
      // the chapters are read by the cheaper model (a separate call for each), the main one works on its notes
      for (let i = 0; i < chapters; i++) mine.push(runCost({ model: eff.reader, promptTokens: 400, reads: tok / chapters, out: 900, turns: 3 }));
      mine.push(runCost({ model: eff.writer, promptTokens: 800, reads: chapters * 900 + 6000, out: outW, turns }));
    } else {
      mine.push(runCost({ model: eff.writer, promptTokens: 800, reads: tok, out: outW, turns }));
    }
    parts.push(...mine);
    items.push({ name: path.basename(raw), tokens: tok, usd: mine.every((p) => typeof p.usd === 'number') ? mine.reduce((n, p) => n + p.usd, 0) : null, book: isBook, found: exists });
  }
  return { parts, items, eff };
}

export function estimate(kind, body = {}, { settings } = {}) {
  const b = body || {};
  const cfg = aiConfig();
  if (cfg.engine !== 'agent') return pipelineEstimate(kind, b, settings || {});
  let parts = [], extra = {}, title = '', warn = [];

  if (kind === 'ask' || kind === 'improve') {
    const L = PATH_LEVELS[b.level] || PATH_LEVELS.medium;
    const ci = costInputs({ slug: b.slug, question: b.question, selection: b.selection, answer: b.answer, instruction: b.instruction, withBody: kind === 'improve' });
    if (!ci) return { ok: false, error: $t('There is no such page.') };
    title = kind === 'ask' ? $t('Question to {ai}') : $t('Suggestion for a change');
    const depth = L.depth;
    parts = [runCost({ model: L.model, promptTokens: tokensOf(ci.text) + 500, reads: tokensOf(ci.page) + 20000 * DEPTH_FRAC[depth], out: kind === 'ask' ? (/преразкаж|пренапиш|подобри|редактирай|по-добър вариант|rewrite|rephrase/i.test(String(b.question || '')) ? 3000 : 700) : (b.mode === 'selection' ? 1200 : 2500), turns: DEPTH_TURNS[depth] })];
  } else if (kind === 'conspect') {
    const L = PATH_LEVELS[b.level] || PATH_LEVELS.medium;
    const pages = wikiPages(), p = pages.find((x) => x.slug === b.slug);
    if (!p) return { ok: false, error: $t('There is no such page.') };
    title = $t('Outline of the original');
    const grounding = groundingOf(p, pages);
    const reads = grounding.length ? grounding.reduce((n, g) => n + readTokens(path.join(ROOT, g.file)), 0) : tokensOf(p.content);
    if (!grounding.length) warn.push($t('There is no original text available for this page: the outline will be based on the text in wiki/.'));
    parts = [runCost({ model: L.model, promptTokens: 700, reads, out: Math.min(12000, 1800 + reads * 0.12), turns: DEPTH_TURNS[L.depth] })];
  } else if (kind === 'path' || kind === 'write') {
    const L = PATH_LEVELS[b.level];
    if (!L) return { ok: false, error: $t('Unknown level.') };
    const reads = wikiTokens() * DEPTH_FRAC[L.depth];
    const words = kind === 'write' ? writeWords(b) : 0;
    title = kind === 'path' ? $t('Learning path') : $t('Writing with {ai}');
    parts = [runCost({ model: L.model, promptTokens: 1500 + tokensOf(b.topic || b.q), reads, out: kind === 'write' ? words * 2.4 + 700 : 3000, turns: kind === 'write' ? L.maxTurns / 2 : DEPTH_TURNS[L.depth] })];
    extra.reads = Math.round(reads);
  } else if (kind === 'review') {
    const L = PATH_LEVELS[b.level];
    if (!L) return { ok: false, error: $t('Unknown level.') };
    const s = reviewSize(b), per = { light: 2500, medium: 6000, strong: 12000 }[L.depth] || 6000;
    const reads = s.works * per + 3000; // the skill, index.md, the source pages and the cited pages of the originals
    title = $t('Review with {ai}');
    parts = [runCost({ model: L.model, promptTokens: s.text + 2500, reads, out: s.report ? 3500 : s.text + 3500, turns: Math.min(L.maxTurns * 2 + 20, 10 + s.works * 2) })];
    extra.reads = Math.round(reads);
  } else if (kind === 'ingest' || kind === 'upgrade' || kind === 'chapters') {
    let files = [];
    if (kind === 'ingest') {
      const pend = Array.isArray(b.paths) && b.paths.length ? b.paths.map(String) : ingestState().pending.map((f) => normRaw(rel(f)));
      files = pend;
      title = pend.length === 1 ? $t('Processing a file') : $t('Processing {0} files', [pend.length]);
    } else if (kind === 'upgrade') {
      const { legacy } = legacySources();
      const list = Array.isArray(b.slugs) && b.slugs.length ? legacy.filter((l) => b.slugs.includes(l.slug)) : legacy;
      files = list.map((l) => l.raw); title = $t('Upgrading {0} sources', [list.length]);
    } else {
      const p = wikiPages().find((x) => x.slug === b.slug);
      files = p?.data?.raw_path ? [String(p.data.raw_path)] : []; title = $t('Chapters of a book');
    }
    if (!files.length) return { ok: false, error: $t('There is nothing to process.') };
    const r = ingestParts(files, settings, kind);
    parts = r.parts; extra.items = r.items.slice(0, 12); extra.itemsMore = Math.max(0, r.items.length - 12); extra.delegate = r.eff.delegate; extra.reader = r.eff.reader; extra.writer = r.eff.writer;
    if (r.items.some((i) => !i.found)) warn.push($t('Some of the files have no extracted text yet: the estimate is based on file size.'));
    extra.past = pastAverage(kind);
  } else if (kind === 'scan-pages') {
    const n = scanPagesOf(b);
    if (!n) return { ok: false, error: $t('There is nothing to process.') };
    title = $t('Reading {0} photos of pages', [n]);
    // one short run of Claude Code per page: the prompt, the image (Read) and the text of the page
    for (let i = 0; i < n; i++) parts.push(runCost({ model: PATH_LEVELS.medium.model, promptTokens: 250, reads: IMAGE_TOKENS, out: PAGE_OUT, turns: 2 }));
  } else if (kind === 'areas') {
    const L = PATH_LEVELS[b.level] || PATH_LEVELS.light;
    const cp = classifyPrompt();
    if (!cp.count) return { ok: false, error: $t('All sources already have an area.') };
    title = $t('Areas of {0} {1}', [cp.count, cp.count === 1 ? $t('source') : $t('sources')]);
    parts = [runCost({ model: L.model, promptTokens: tokensOf(cp.text) + 300, reads: 0, out: 45 * cp.count + 250, turns: 2 })];
    if (cp.total > cp.count) warn.push($t('There are {0} sources without an area: this time the first {1} are processed, then you can run it again.', [cp.total, cp.count]));
  } else if (kind === 'synthesis') {
    const eff = effectiveModels(settings, 'synthesis');
    const plan = synthesisPlan(b.tag);
    if (!plan.concepts) warn.push(synthNothing(plan));
    const reads = plan.fixedTokens + plan.conceptTokens + plan.chapterTokens;
    const files = plan.fixed + plan.concepts + plan.chapters;
    // steps: reading (about 4 files per step), writing (comparisons and hubs, at most about 40), index, log and lint
    const turns = Math.min(150, 15 + Math.ceil(files / 4) + Math.min(40, Math.ceil(plan.concepts / 3)));
    const out = 5000 + 700 * Math.min(40, plan.concepts);
    parts = [runCost({ model: eff.writer, promptTokens: 1000, reads, out, turns, cap: SYNTH_CONTEXT })];
    title = plan.tag ? $t('Synthesis: #{0}', [plan.tag]) : $t('Library synthesis'); extra.past = pastAverage('synthesis');
    extra.note = $t('It reads {0} concepts cited by two or more sources, {1} of their chapters, and {2} pages of index, overview, topics and comparisons.', [plan.concepts, plan.chapters, plan.fixed]);
  } else return { ok: false, error: $t('Unknown action.') };

  if (cfg.preset.vendor === 'Anthropic' && parts.some((p) => p.model === 'haiku' && p.fresh > 100000)) warn.push($t('Above 100,000 tokens Haiku is charged at a higher price: the estimate includes it.'));
  const total = sum(parts);
  if (!total.usd) warn.push($t('The prices of this model are not set, so only the tokens are shown. Enter them in Settings → Model.'));
  if (cfg.preset.vendor !== 'Anthropic') { extra.reader = shownModel(extra.reader || ''); extra.writer = shownModel(extra.writer || ''); }
  return { ok: true, kind, title, ...total, ...extra, warnings: warn, priceDate: PRICE_DATE, overhead: BASE_OVERHEAD + claudeMdTokens(), engine: 'agent', provider: cfg.provider, subscription: cfg.subscription, free: cfg.local, local: cfg.local, claude: cfg.preset.vendor === 'Anthropic' };
}
