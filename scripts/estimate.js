// Оценка на токените и цената ПРЕДИ действие с Claude. Нищо не се праща към Claude оттук.
//
// Откъде са числата:
//  - Цени (USD за милион токена): официалната страница на Anthropic за цените
//    (https://platform.claude.com/docs/en/about-claude/pricing, проверена на 31.10.2026). Редактират се в library.config.json ("prices").
//  - Токени: приближение по брой знаци (кирилицата е около 2,2 знака на токен, латиницата около 3,8). Грешката е типично ±30%.
//  - Claude Code не праща само твоя текст: добавя собствен системен промпт и описания на инструментите, чете файлове
//    на няколко стъпки и всеки път изпраща наново досегашния контекст (най-често от кеша, който е 10 пъти по-евтин).
//    Затова оценката е ДИАПАЗОН (0,6 до 1,8 пъти средната), а не точна сума.
//  - При вход с абонамент (claude login) не плащаш по токен: сумата е „еквивалент по API цени“ и показва колко тежко е действието за лимита.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, EXTRACTED, RAW, wikiPages, ingestState, normRaw, rel } from './lib.js';
import { effectiveModels, PATH_LEVELS, legacySources } from './agent.js';
import { costInputs, groundingOf } from './improve.js';
import { classifyPrompt } from './areas.js';
import { LENGTHS } from './write.js';
import { $t } from './i18n.js';

export const PRICE_DATE = '2026-10-31';
const DEFAULT_PRICES = {
  haiku:  { in: 0.10, out: 0.50, cache: 0.01, bigIn: 0.50, bigOut: 2.50, bigCache: 0.05 },
  sonnet: { in: 2, out: 10, cache: 0.10 },
  opus:   { in: 4, out: 20, cache: 0.20 },
};
function prices() {
  try { return { ...DEFAULT_PRICES, ...(JSON.parse(fs.readFileSync(path.join(ROOT, 'library.config.json'), 'utf8')).prices || {}) }; } catch { return DEFAULT_PRICES; }
}

const BASE_OVERHEAD = 14000; // системният промпт и описанията на инструментите на Claude Code (груба стойност)

export function tokensOf(text) {
  const s = String(text || ''); let cyr = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0x400 && c <= 0x4ff) cyr++; }
  return Math.ceil(cyr / 2.2 + (s.length - cyr) / 3.8);
}
const readTokens = (file) => { try { return tokensOf(fs.readFileSync(file, 'utf8')); } catch { return 0; } };
const claudeMdTokens = () => readTokens(path.join(ROOT, 'CLAUDE.md'));
const wikiTokens = () => wikiPages().reduce((n, p) => n + tokensOf(p.content), 0);

function rate(model, ctx) {
  const P = prices()[model] || prices().sonnet;
  const big = model === 'haiku' && ctx > 100000;
  return { in: big ? P.bigIn : P.in, out: big ? P.bigOut : P.out, cache: big ? P.bigCache : P.cache };
}

/**
 * Едно пускане на `claude -p`: начален контекст (системен + CLAUDE.md + промпт) + прочетеното. На всяка стъпка
 * контекстът се чете наново от кеша; новото се записва в кеша по 1,25 пъти цената на входа.
 */
export function runCost({ model, promptTokens = 0, reads = 0, out = 0, turns = 6 }) {
  const ctx0 = BASE_OVERHEAD + claudeMdTokens() + promptTokens;
  const fresh = ctx0 + reads;
  const cached = Math.max(0, turns - 1) * (ctx0 + reads / 2);
  const r = rate(model, fresh);
  const usd = (fresh * 1.25 * r.in + cached * r.cache + out * r.out) / 1e6;
  return { model, input: Math.round(fresh + cached), fresh: Math.round(fresh), cached: Math.round(cached), output: Math.round(out), usd, turns };
}

const sum = (parts) => {
  const usd = parts.reduce((n, p) => n + p.usd, 0);
  return {
    parts,
    input: parts.reduce((n, p) => n + p.input, 0), cached: parts.reduce((n, p) => n + p.cached, 0), output: parts.reduce((n, p) => n + p.output, 0),
    usd: { low: usd * 0.6, mid: usd, high: usd * 1.8 },
    models: [...new Set(parts.map((p) => p.model))],
  };
};

const DEPTH_FRAC = { light: 0.02, medium: 0.07, strong: 0.2 };
const DEPTH_TURNS = { light: 4, medium: 8, strong: 16 };

/** Колко е струвало досега: средно на задача от историята на обработките (ако има записан разход) */
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
      // главите чете по-евтиният модел (отделно извикване за всяка), основният работи върху бележките му
      for (let i = 0; i < chapters; i++) mine.push(runCost({ model: eff.reader, promptTokens: 400, reads: tok / chapters, out: 900, turns: 3 }));
      mine.push(runCost({ model: eff.writer, promptTokens: 800, reads: chapters * 900 + 6000, out: outW, turns }));
    } else {
      mine.push(runCost({ model: eff.writer, promptTokens: 800, reads: tok, out: outW, turns }));
    }
    parts.push(...mine);
    items.push({ name: path.basename(raw), tokens: tok, usd: mine.reduce((n, p) => n + p.usd, 0), book: isBook, found: exists });
  }
  return { parts, items, eff };
}

export function estimate(kind, body = {}, { settings } = {}) {
  const b = body || {};
  let parts = [], extra = {}, title = '', warn = [];

  if (kind === 'ask' || kind === 'improve') {
    const L = PATH_LEVELS[b.level] || PATH_LEVELS.medium;
    const ci = costInputs({ slug: b.slug, question: b.question, selection: b.selection, answer: b.answer, instruction: b.instruction, withBody: kind === 'improve' });
    if (!ci) return { ok: false, error: $t('There is no such page.') };
    title = kind === 'ask' ? $t('Question to Claude') : $t('Suggestion for a change');
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
    const words = kind === 'write' ? (LENGTHS[b.length] || LENGTHS.medium).words : 0;
    title = kind === 'path' ? $t('Learning path') : $t('Writing with Claude');
    parts = [runCost({ model: L.model, promptTokens: 1500 + tokensOf(b.topic || b.q), reads, out: kind === 'write' ? words * 2.4 + 700 : 3000, turns: kind === 'write' ? L.maxTurns / 2 : DEPTH_TURNS[L.depth] })];
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
  } else if (kind === 'areas') {
    const L = PATH_LEVELS[b.level] || PATH_LEVELS.light;
    const cp = classifyPrompt();
    if (!cp.count) return { ok: false, error: $t('All sources already have an area.') };
    title = $t('Areas of {0} {1}', [cp.count, cp.count === 1 ? $t('source') : $t('sources')]);
    parts = [runCost({ model: L.model, promptTokens: tokensOf(cp.text) + 300, reads: 0, out: 45 * cp.count + 250, turns: 2 })];
    if (cp.total > cp.count) warn.push($t('There are {0} sources without an area: this time the first {1} are processed, then you can run it again.', [cp.total, cp.count]));
  } else if (kind === 'synthesis') {
    const eff = effectiveModels(settings, 'synthesis');
    const reads = wikiTokens() * 0.6;
    parts = [runCost({ model: eff.writer, promptTokens: 1000, reads, out: 9000, turns: Math.min(80, 20 + Math.round(reads / 8000)) })];
    title = $t('Library synthesis'); extra.past = pastAverage('synthesis');
  } else return { ok: false, error: $t('Unknown action.') };

  if (parts.some((p) => p.model === 'haiku' && p.fresh > 100000)) warn.push($t('Above 100,000 tokens Haiku is charged at a higher price: the estimate includes it.'));
  const total = sum(parts);
  return { ok: true, kind, title, ...total, ...extra, warnings: warn, priceDate: PRICE_DATE, overhead: BASE_OVERHEAD + claudeMdTokens() };
}
