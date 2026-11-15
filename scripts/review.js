// A review of a finished text against the library: the wiki-review skill, run from "Write with the wiki".
//
// What it does (see .claude/skills/wiki-review/SKILL.md):
//  - checks every citation page by page in the original (raw/.extracted, the markers <!-- стр. N -->),
//    turning the printed page into a PDF page through the page_offset of the book;
//  - fixes APA 7 (chapters in collections, "et al.", translations, secondary citations, books without printed pages);
//  - supports claims without a source, adds counterweights and missing parts ([FILL IN: ...] for what
//    only the author knows) and makes the sentences sound natural.
// Two modes: fix (the fixed text + a report) and report (only a report, the text is not touched).
//
// The agent (Claude Code) reads the skill and the files itself. Without tools the server puts into the request the text of the skill,
// the map of the citations and the cited pages of the originals, as much as the context allows.
// In both cases the server itself adds an "Automatic check": the number of words, the length of the sentences and the match
// between the citations and the bibliography. Nothing is saved in the draft: the result goes into the editor and waits for "Save".
// The report is kept in drafts/.reviews/<id>/<time>.md.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, extractedPathOf } from './lib.js';
import { PATH_LEVELS } from './agent.js';
import { askAI } from './ai.js';
import { clipTokens } from './llm.js';
import { readUnits } from './reader-data.js';
import { $t, contentLang } from './i18n.js';
import { P, Pall, lazy } from './vocab.js';
import { DRAFTS, makeCiter, genreOf, genreName, bibHeads } from './write.js';

const SKILL_REL = '.claude/skills/wiki-review/SKILL.md';
const MAX_CHARS = 150000; // about 25 000 words: the whole fixed text must come back in one answer
const REVIEWS = path.join(DRAFTS, '.reviews');
const noDash = (s) => String(s ?? '').replace(/\s+[—–]\s+|—/g, ', ');
const words = (s) => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;
const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const YEAR = String.raw`(?:1[5-9]|20)\d{2}`;

/**
 * The skill: file is the path for the agent (the installed copy in .claude/, if there is one), text is the text for a model without
 * tools: the pack of the content language, otherwise the installed copy, otherwise the English pack.
 */
export function skillText() {
  const pack = (code) => path.join(ROOT, 'content', code, 'skills', 'wiki-review', 'SKILL.md');
  const installed = path.join(ROOT, SKILL_REL);
  let text = '';
  for (const f of [pack(contentLang()), installed, pack('en')]) {
    try { text = fs.readFileSync(f, 'utf8').replace(/^---[\s\S]*?\n---\s*/, '').trim(); break; } catch { /* the next one */ }
  }
  return { file: fs.existsSync(installed) ? SKILL_REL : null, text };
}

// ---------- The bibliography: at every level of heading (# or ##), because finished articles do not come only from the editor ----------
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BIB_ANY = () => new RegExp(`^(#{1,3})[ \\t]*(?:${bibHeads().map(esc).join('|')})[ \\t]*:?[ \\t]*$`, 'im');
/** The main part, the entries of the bibliography (one per paragraph), the line with its heading and everything after it */
export function splitAny(text) {
  const s = String(text ?? ''), m = s.match(BIB_ANY());
  if (!m) return { main: s.replace(/\s+$/, ''), entries: [], line: null, tail: '' };
  const rest = s.slice(m.index + m[0].length), next = rest.search(new RegExp(`^#{1,${m[1].length}}\\s`, 'm'));
  const bib = next < 0 ? rest : rest.slice(0, next);
  return { main: s.slice(0, m.index).replace(/\s+$/, ''), entries: bib.trim().split(/\n[ \t]*\n/).map((x) => x.trim()).filter(Boolean), line: m[0].trim(), tail: next < 0 ? '' : rest.slice(next).trim() };
}
const letters = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');
/** Puts the text together; the new entries come in and the whole bibliography is sorted alphabetically (Cyrillic first for bg) */
function joinAny({ main, entries, line, tail }, add, genre) {
  const extra = add.filter((e) => !entries.includes(e));
  const all = extra.length ? [...entries, ...extra].sort((a, b) => letters(a).localeCompare(letters(b), contentLang())) : entries;
  const head = line || (all.length ? `## ${genre === 'story' ? P('Based on') : P('Bibliography')}` : null);
  return `${main}${head ? `\n\n${head}\n\n${all.join('\n\n')}` : ''}${tail ? `\n\n${tail}` : ''}\n`;
}

// ---------- Citations and bibliography (without a model) ----------
const NAME = String.raw`[\p{Lu}][\p{L}'’-]+`;
const ETAL = String.raw`(?:и\s+др\.|et\s+al\.)`;
const SECONDARY = /,?\s*(?:цит\.\s*по|as\s+cited\s+in|cited\s+in)\s+/i;
const NARRATIVE = new RegExp(String.raw`(${NAME}(?:\s+${NAME})?(?:\s+(?:и|and|&)\s+${NAME})?(?:\s+${ETAL})?)\s*$`, 'u');
/** The first word of the name of the first author, without diacritics: the key by which a citation and an entry are linked */
const keyOf = (who) => fold(String(who).replace(new RegExp(`\\s+${ETAL}\\s*$`), '').split(/\s+(?:и|and|&)\s+|,/)[0].trim().split(/\s+/)[0] || '');

function piecesOf(part) {
  const out = [];
  const [first, ...rest] = part.split(SECONDARY);
  const all = rest.length ? [{ s: first, secondary: true }, ...rest.map((s) => ({ s, secondary: false }))] : [{ s: first, secondary: false }];
  for (const { s, secondary } of all) {
    const m = s.match(new RegExp(String.raw`^\s*(.*?)[,\s]*(${YEAR})(?:\/(${YEAR}))?[a-zа-я]?(?![\d])(.*)$`, 'su'));
    if (!m) continue;
    const pages = (m[4].match(/(?:с|стр|p|pp)\.\s*([\d\s,–-]+)/u)?.[1] || '').split(',').map((x) => Number(x.trim().split(/[-–]/)[0])).filter((n) => n > 0).slice(0, 4);
    const chapter = Number(m[4].match(/(?:гл|ch)\.\s*(\d+)/u)?.[1]) || null;
    out.push({ who: m[1].trim(), years: [m[2], m[3]].filter(Boolean), pages, chapter, secondary });
  }
  return out;
}

/** All the citations in the main text: in parentheses and in the sentence (Author (year, p. N)). */
export function citationsOf(md) {
  const { main } = splitAny(String(md || ''));
  const found = [];
  const re = /\(([^()\n]*?\d{4}[^()\n]*?)\)/g;
  let m;
  while ((m = re.exec(main))) {
    for (const part of m[1].split(';')) {
      for (const c of piecesOf(part)) {
        let who = c.who;
        if (!who) who = main.slice(Math.max(0, m.index - 90), m.index).match(NARRATIVE)?.[1] || '';
        if (!who || !/\p{L}/u.test(who) || who.length > 90) continue;
        found.push({ ...c, who, key: keyOf(who) });
      }
    }
  }
  return found.filter((c) => c.key);
}

const entryYears = (e) => [...new Set([...String(e).matchAll(new RegExp(String.raw`\((${YEAR})[a-zа-я]?[),]|(?:published|публикувана)\s+(${YEAR})`, 'giu'))].map((x) => x[1] || x[2]))];
const entryKey = (e) => fold(String(e).replace(/^[\s*_]+/, '').match(/^[\p{L}'’-]+/u)?.[0] || '');

/** The match between the citations and the bibliography: citations without an entry and entries without a citation */
export function citationCheck(md) {
  const cites = citationsOf(md).filter((c) => !c.secondary);
  const entries = splitAny(String(md || '')).entries;
  const E = entries.map((e) => ({ e, key: entryKey(e), years: entryYears(e) }));
  const hit = (c, x) => x.key === c.key && c.years.some((y) => x.years.includes(y));
  const missing = new Map();
  for (const c of cites) if (!E.some((x) => hit(c, x))) missing.set(`${c.key}|${c.years.join('/')}`, `${c.who}, ${c.years.join('/')}`);
  const uncited = E.filter((x) => !cites.some((c) => hit(c, x))).map((x) => x.e.slice(0, 120));
  return { cites: cites.length, entries: entries.length, missing: [...missing.values()], uncited };
}

/** The length of the sentences in the main text (without the headings, the citations in parentheses and the bibliography) */
export function textStats(md) {
  const { main } = splitAny(String(md || ''));
  const prose = main.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').replace(/\([^()]*\)/g, '');
  // the end of a sentence: . ! ? ... (and after them a closing quote, parenthesis); a new paragraph; a new line of a list
  const sentences = prose.split(/(?<=[.!?…][“”"»)\]]*)\s+(?=[„"«\[\p{Lu}\d*])|\n\s*\n|\n(?=[ \t]*(?:[-*+]|\d+\.)\s)/u).map((s) => words(s)).filter((n) => n > 2);
  const n = sentences.length, sum = sentences.reduce((a, b) => a + b, 0);
  return { words: words(main), sentences: n, avg: n ? Math.round((sum / n) * 10) / 10 : 0, long: sentences.filter((x) => x > 35).length, max: n ? Math.max(...sentences) : 0 };
}

// ---------- The citation map: which source of the library, which file, which page ----------
const surnameOf = (a) => fold(String(a).split(',')[0].trim().split(/\s+/)[0] || '');
const yearsOf = (d) => [String(d.year || ''), ...entryYears(d.apa || '')];
// With duplicates (copies "-copy", "-original", a blank "-instrument") the page with a file and the shortest name comes first
const better = (a, b) => (/-copy$/.test(a.slug) - /-copy$/.test(b.slug)) || (!a.data.raw_path - !b.data.raw_path) || (a.slug.length - b.slug.length);
/**
 * The page in the library for one citation: the source page by author and year; otherwise a chapter in a collection whose
 * title carries the name of the author ("Leaving well alone (Paterson)") and whose book is from the same year.
 * Returns { page, file } (file is the page with raw_path and page_offset: the book, or the chapter if it has its own file).
 */
function sourceFor(c, pages, bySlug) {
  const all = pages.filter((p) => p.data.type === 'source' && c.years.some((y) => yearsOf(p.data).includes(y))
    && [entryKey(p.data.apa || ''), surnameOf([].concat(p.data.authors || [])[0] || '')].includes(c.key)).sort(better);
  // Another work of the same author from the same year (not a copy of the same page) is shown as a possibility
  const others = all.slice(1).filter((p) => !p.slug.startsWith(all[0].slug) && !all[0].slug.startsWith(p.slug)).slice(0, 3);
  if (all[0]) return { page: all[0], file: all[0], others };
  const wordRe = new RegExp(`(^|[^\\p{L}])${esc(c.key)}([^\\p{L}]|$)`, 'u');
  for (const ch of pages.filter((p) => p.data.type === 'chapter' && wordRe.test(fold(p.data.title || ''))).sort(better)) {
    const book = bySlug.get(String(ch.data.book || '').replace(/^\[\[|\]\]$/g, '').split('|')[0]);
    if (book && c.years.some((y) => yearsOf(book.data).includes(y))) return { page: ch, file: ch.data.raw_path ? ch : book, others: [] };
  }
  return null;
}
const offsetOf = (p) => (p && /^-?\d+$/.test(String(p.data.page_offset ?? '').trim()) ? Number(p.data.page_offset) : null);

/** The map for the model and the passages of the originals (for a model without tools) */
export function citeMap(md, pages) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const seen = new Map();
  for (const c of citationsOf(md)) {
    const k = `${c.key}|${c.years.join('/')}`;
    const cur = seen.get(k) || { ...c, pages: [], chapters: new Set(), src: sourceFor(c, pages, bySlug) };
    for (const n of c.pages) if (!cur.pages.includes(n)) cur.pages.push(n);
    if (c.chapter) cur.chapters.add(c.chapter);
    seen.set(k, cur);
  }
  const lines = [], excerpts = [];
  for (const c of seen.values()) {
    const where = [c.pages.length ? `${P('p.')} ${c.pages.join(', ')}` : '', c.chapters.size ? `${P('ch.')} ${[...c.chapters].join(', ')}` : ''].filter(Boolean).join('; ');
    const head = `${c.who}, ${c.years.join('/')}${where ? `, ${where}` : ''}${c.secondary ? ` (${P('secondary citation')})` : ''}`;
    if (!c.src) { lines.push(`- ${head} → ${P('no source page found in the library')}`); continue; }
    const raw = String(c.src.file.data.raw_path || ''), off = offsetOf(c.src.file);
    const book = c.src.file !== c.src.page ? ` ([[${c.src.file.slug}]])` : '';
    const alt = c.src.others.length ? ` · ${P('or another work of the same year: {0}', [c.src.others.map((p) => `[[${p.slug}]]`).join(', ')])}` : '';
    lines.push(`- ${head} → [[${c.src.page.slug}]]${book} · ${raw ? `raw/.extracted/${raw.replace(/^raw\//, '')}.md` : P('no raw file')} · page_offset: ${off ?? '?'}${alt}`);
    const file = raw && extractedPathOf(raw);
    if (!file || !fs.existsSync(file)) continue;
    let units = null; try { units = readUnits(file); } catch { continue; }
    for (const n of c.pages.slice(0, 3)) {
      const pdf = n + (off ?? 0), t = units.units.get(pdf);
      if (!t) continue;
      excerpts.push({ head: `${c.who}, ${c.years.join('/')}, ${P('p.')} ${n} → PDF ${pdf}${off == null ? ` (${P('offset unknown: the PDF page with the same number is shown')})` : ''}`, text: t });
    }
  }
  return { text: lines.join('\n'), excerpts, count: seen.size };
}

// ---------- The request ----------
const MARK = lazy(() => ({ report: `⟦${P('REVIEW REPORT')}⟧` }));
const ANY_MARK = () => new RegExp(String.raw`^[ \t]*⟦(?:${Pall('REVIEW REPORT').map(esc).join('|')})⟧[ \t]*$`, 'm');
const SYSTEM = () => [
  P('You are a careful editor and fact-checker who works from the material of a personal knowledge library. You check every claim against the material in the request and never invent citations, pages or facts.'),
  P('Write in English, clearly and simply, without an em dash (—).'),
].join(' ');

function reviewPrompt({ title, body, instruction, genre, mode, skill, map, material, tools }) {
  const report = mode === 'report';
  return [
    tools ? P('You are reviewing a finished text in English against the author\'s library (the wiki/ folder and the extracted originals in raw/.extracted/ in the current directory). This is your working environment, not the topic of the text.')
      : P('You are reviewing a finished text in English against the author\'s library. Everything you have from the library is in the MATERIAL below.'),
    P('KIND OF TEXT: {0}.', [genreName(genre)]),
    '',
    ...(tools && skill.file
      ? [P('THE PROCEDURE: first read {0} and follow its steps. The format of the answer below takes precedence over the “Report” section of the procedure.', [skill.file])]
      : [P('THE PROCEDURE (follow its steps; the format of the answer below takes precedence over its “Report” section):'), '"""', skill.text || P('Check every citation against the originals, fix the APA 7 references, support unsupported claims from the library and make the sentences read naturally.'), '"""']),
    tools ? null : P('You cannot open files. Where the procedure says to open a file, use the MATERIAL. What you cannot check there goes under “Not verified”.'),
    '',
    P('WHAT THE AUTHOR WANTS: {0}', [instruction || P('a full review by the procedure.')]),
    '',
    P('THE TEXT “{0}”:', [title]),
    '<<<', body, '>>>',
    '',
    P('CITATION MAP (computed automatically from the text; it may be incomplete or wrong, so check it):'),
    map || P('(no citations found)'),
    ...(material ? ['', P('MATERIAL (the cited pages of the originals and pages of the library):'), material] : []),
    '',
    P('FORMAT OF THE ANSWER'),
    ...(report
      ? [P('- Do NOT change the text. Return only the report in Markdown.')]
      : [P('- First return the WHOLE corrected text in Markdown, from the title to the end of the bibliography, with no explanations before it.'),
        P('- Then a line with only {0}', [MARK.report]),
        P('- Then the report in Markdown.'),
        P('- For a NEW citation to a source from the library you may write the wiki format ([[slug]], p. N) with the PDF page: it is converted automatically to APA with the printed page and added to the bibliography. Correct the existing citations directly in APA.')]),
    P('- The report starts with a line “Written for: …” and has the sections: Errors fixed, Added, For the author to fill in, Not verified, Assessment. Every fix names the source and the page it was checked against.'),
    P('- No em dash (—) anywhere.'),
  ].filter((x) => x != null).join('\n');
}

/** The material without tools: first the cited pages of the originals, then the pages of the library */
function materialOf(map, ranked, budget) {
  const out = [];
  let left = budget;
  const share = Math.max(250, Math.floor((budget * 0.65) / Math.max(1, map.excerpts.length)));
  for (const x of map.excerpts) {
    if (left < 300) break;
    const t = clipTokens(x.text, share); out.push(`### ${x.head}\n${t}`); left -= share + 40;
  }
  const list = (ranked || []).filter((p) => ['source', 'chapter', 'concept', 'comparison'].includes(p.data.type)).slice(0, 12);
  const per = Math.max(250, Math.floor(left / Math.max(1, list.length)));
  for (const p of list) {
    if (left < 300) break;
    out.push(`### [[${p.slug}]] (${p.data.type}) ${p.data.title || p.slug}${p.data.apa ? `\n${P('Reference')}: ${p.data.apa}` : ''}\n${clipTokens(p.content, per)}`); left -= per + 40;
  }
  return out.join('\n\n');
}

const fmtN = (n) => String(n).replace('.', contentLang() === 'en' ? '.' : ',');
/** "Automatic check": the numbers that the server computes itself, added at the end of the report */
function autoSection(before, after, check, dashes) {
  const L = [`## ${P('Automatic check')}`, ''];
  L.push(after ? `- ${P('Words: {0} → {1}', [before.words, after.words])}` : `- ${P('Words: {0}', [before.words])}`);
  L.push(after
    ? `- ${P('Sentences: on average {0} → {1} words; over 35 words: {2} → {3}; the longest: {4} → {5}', [fmtN(before.avg), fmtN(after.avg), before.long, after.long, before.max, after.max])}`
    : `- ${P('Sentences: on average {0} words; over 35 words: {1}; the longest: {2}', [fmtN(before.avg), before.long, before.max])}`);
  L.push(`- ${P('Citations in the text: {0}; entries in the bibliography: {1}', [check.cites, check.entries])}`);
  if (check.missing.length) L.push(`- ${P('Citations without an entry in the bibliography: {0}', [check.missing.join('; ')])}`);
  if (check.uncited.length) L.push(`- ${P('Entries that are not cited in the text: {0}', [check.uncited.map((e) => e.replace(/\s+/g, ' ').slice(0, 70) + '…').join(' | ')])}`);
  if (!check.missing.length && !check.uncited.length && check.cites) L.push(`- ${P('Every citation has an entry and every entry is cited.')}`);
  if (dashes) L.push(`- ${P('Em dashes replaced: {0}', [dashes])}`);
  L.push('', P('(The check matches the citations and the entries by the first author and the year; a name spelled differently in the text and in the bibliography may show up here by mistake.)'));
  return L.join('\n');
}

/**
 * A review with the model. mode: fix (a fixed text + a report) or report (only a report).
 * Does not save the draft: returns the new body (with fix) and the report, for review and saving by the person.
 */
export async function reviewWithAI({ body, title, instruction, genre, mode = 'fix', level, ranked, pages, signal }) {
  genre = genreOf(genre); mode = mode === 'report' ? 'report' : 'fix';
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  const text = String(body ?? '');
  if (words(text) < 30) return { ok: false, kind: 'empty', error: $t('The text is too short to review.') };
  if (text.length > MAX_CHARS) return { ok: false, kind: 'too-big', error: $t('The text is too long to review at once (over {0} characters). Review it in parts.', [MAX_CHARS]) };
  const skill = skillText(), map = citeMap(text, pages), ins = String(instruction || '').trim();
  const before = textStats(text), n = before.words + words(splitAny(text).entries.join(' '));
  const out = mode === 'report' ? 4000 : Math.min(32000, Math.round(n * 2.8) + 3500);
  const args = { title, instruction: ins, genre, mode, skill };
  const r = await askAI({
    level, label: $t('Review with {ai}'), maxTokens: out, system: SYSTEM(), temperature: 0.2,
    agentPrompt: reviewPrompt({ ...args, body: text, map: map.text, tools: true }),
    textPrompt: (budget) => {
      const t = clipTokens(text, Math.floor(budget * 0.45));
      return reviewPrompt({ ...args, body: t, map: map.text, tools: false, material: materialOf(map, ranked, Math.max(800, Math.floor(budget * 0.5) - 1200)) });
    },
    maxTurns: L.maxTurns * 2 + 20, timeoutMs: Math.round(L.timeoutMs * 2.5), signal,
  });
  if (!r.ok) return r;
  const raw = String(r.text).trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '');
  const dashes = (raw.match(/—/g) || []).length;
  const warnings = [];
  let markdown = null, report = raw;
  if (mode === 'fix') {
    const mk = raw.match(ANY_MARK());
    const textPart = mk ? raw.slice(0, mk.index) : raw, reportPart = mk ? raw.slice(mk.index + mk[0].length) : '';
    let fixed = noDash(textPart).trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '');
    if (!mk) warnings.push($t('{ai} did not separate the report from the text: check the end of the text.'));
    if (words(fixed) < before.words * 0.6) return { ok: false, kind: 'format', error: $t('{ai} returned a much shorter text than the original, so it was not put in. Try again or with a more powerful level.'), detail: fixed.slice(0, 400) };
    if (/^#\s/m.test(text) && !/^#\s/m.test(fixed)) fixed = `${text.match(/^#\s.*$/m)[0]}\n\n${fixed}`;
    // New citations in the wiki form ([[slug]], p. N) become APA with a printed page; the new sources go into the bibliography
    const citer = makeCiter(pages), parts = splitAny(fixed);
    parts.main = genre === 'story' ? citer.convert(parts.main, { inline: false }) : citer.convert(parts.main);
    const have = new Set(parts.entries.map((e) => `${entryKey(e)}|${entryYears(e).join('/')}`));
    const add = citer.bibliography().filter((e) => !have.has(`${entryKey(e)}|${entryYears(e).join('/')}`));
    if (citer.missing.size) warnings.push($t('{ai} cited non-existent pages ({0}): the citations were removed.', [[...citer.missing].join(', ')]));
    markdown = joinAny(parts, add, genre);
    report = noDash(reportPart).trim() || P('(no report)');
    report += `\n\n${autoSection(before, textStats(markdown), citationCheck(markdown), dashes)}`;
    return { ok: true, mode, markdown, report, cited: citer.citedList(), warnings, stats: { before, after: textStats(markdown) } };
  }
  // Report only: if the model nevertheless returned a text too, only the part after the marker stays
  const mk = raw.match(ANY_MARK());
  if (mk) report = raw.slice(mk.index + mk[0].length);
  report = `${noDash(report).trim() || P('(no report)')}\n\n${autoSection(before, null, citationCheck(text), 0)}`;
  return { ok: true, mode, markdown: null, report, cited: [], warnings, stats: { before } };
}

/** The report is kept next to the draft: drafts/.reviews/<id>/<time>.md */
export function saveReport(id, report) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id)) || !report) return null;
  const dir = path.join(REVIEWS, id);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, stamp + '.md'), String(report).trim() + '\n');
  const old = fs.readdirSync(dir).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 20))) fs.rmSync(path.join(dir, f), { force: true });
  return `drafts/.reviews/${id}/${stamp}.md`;
}

/** A measure for the cost estimate: how many cited works there are in the text */
export const citedWorks = (md) => new Set(citationsOf(md).map((c) => `${c.key}|${c.years.join('/')}`)).size;
