// Пояснения и подобрения от страницата: въпрос към Claude, промяна на избран откъс, подобряване на страницата с отговор.
//
// Принцип: Claude само ЧЕТЕ (страницата и оригиналния текст на източника) и връща предложение. Промяна по файловете прави
// самият сървър, и то само след твоето потвърждение, с git точка преди и след (бутонът „Върни“ я отменя).
// Така Claude не може да пипне нищо друго, а всяка промяна се вижда като „било, става“.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import { WIKI, rel, today, extractedPathOf, wikiPages, extractLinks } from './lib.js';
import { askClaude, PATH_LEVELS } from './agent.js';
import { $t } from './i18n.js';
import { V, any, anyP, P, pageUnits, lazy } from './vocab.js';

const SPECIAL = new Set(['index', 'log', 'overview']);
const CITE_RE = new RegExp(String.raw`\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\],?\s*${pageUnits()}\s*(\d+)`, 'g');
const NOTES_RE = new RegExp(`^##\\s*${any('notes')}\\s*$`, 'm');

const noDash = (s) => String(s ?? '').replace(/\s+[—–]\s+|—/g, ', ');
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

// ---------- Къде в Markdown е избраният текст ----------
const plainLite = (s, titles) => String(s)
  .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || titles.get(a.trim().split('/').pop()) || a)
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '');
const norm = (s, titles) => plainLite(s, titles).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Намира абзаците (блоковете), които съдържат избрания текст, и връща обхвата им в Markdown. */
export function locateRange(body, selection, titles = new Map()) {
  const blocks = []; const re = /\n[ \t]*\n/g; let last = 0, m;
  while ((m = re.exec(body))) { blocks.push({ start: last, end: m.index }); last = m.index + m[0].length; }
  blocks.push({ start: last, end: body.length });
  const nb = blocks.map((b) => norm(body.slice(b.start, b.end), titles));
  const ns = norm(selection, titles);
  if (ns.length < 6) return null;
  let i = nb.findIndex((x) => x.includes(ns));
  if (i >= 0) return { ...blocks[i], blocks: 1 };
  for (const n of [40, 25]) {
    const head = ns.slice(0, n), tail = ns.slice(-n);
    const a = nb.findIndex((x) => x.includes(head));
    let b = -1; for (let k = nb.length - 1; k >= 0; k--) if (nb[k].includes(tail)) { b = k; break; }
    if (a >= 0 && b >= a && b - a <= 6) return { start: blocks[a].start, end: blocks[b].end, blocks: b - a + 1 };
  }
  return null;
}

// ---------- Върху какво да се опре Claude ----------
const extractedFor = (rawPath) => {
  const f = extractedPathOf(rawPath); // null, ако raw_path сочи извън raw/.extracted/
  return f && fs.existsSync(f) ? rel(f) : null;
};

/** Оригиналните текстове (в raw/.extracted/) и диапазоните, от които е написана страницата. */
export function groundingOf(page, pages) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const out = [], seen = new Set();
  const add = (book, pagesRange, label) => {
    const file = extractedFor(book?.data?.raw_path);
    if (!file) return;
    const key = file + '|' + pagesRange; if (seen.has(key)) return; seen.add(key);
    out.push({ file, pages: pagesRange || null, label });
  };
  const t = page.data.type;
  if (t === 'chapter') {
    const book = bySlug.get(extractLinks(String(page.data.book || ''))[0]);
    add(book, page.data.pages ? String(page.data.pages) : null, P('the book “{0}”, chapter {1}', [book?.data?.title || '', page.data.chapter ?? '']));
  } else if (t === 'source') {
    add(page, null, P('the source itself “{0}”', [page.data.title || page.slug]));
  } else {
    let m; CITE_RE.lastIndex = 0;
    while ((m = CITE_RE.exec(page.content)) && out.length < 4) {
      const src = bySlug.get(m[1].trim().split('/').pop());
      if (!src) continue;
      if (src.data.type === 'chapter') add(bySlug.get(extractLinks(String(src.data.book || ''))[0]), String(src.data.pages || ''), `„${src.data.title || src.slug}“`);
      else if (src.data.type === 'source') add(src, null, `„${src.data.title || src.slug}“`);
    }
  }
  return out;
}

const groundingText = (g) => (g.length
  ? g.map((x) => `- ${x.label}: ${x.file}${x.pages ? P(' (PDF pages {0})', [x.pages]) : ''}`).join('\n')
  : P('- (no original text is available: rely only on the pages in wiki/ and say clearly that you did not check it against the source)'));

const DEPTH = lazy(() => ({
  light: P('Quick: read the page and the most important place of the original.'),
  medium: P('Read the page and the corresponding range of the original to check the claims.'),
  strong: P('Thorough: read the page, the whole corresponding range of the original, the related pages, and check for contradictions with the other sources.'),
}));
const READ_RULES = lazy(() => [
  P('- The files of the original texts have markers <!-- стр. N -->. Find the range with Grep (-n) and read only it (Read with offset and limit), not the whole file.'),
  P('- Cite like this: ([[slug-of-chapter-or-source]], p. N), where N is the number from the marker <!-- стр. N -->. Do not invent pages, citations or slugs; if you are not sure, write “p. ?”.'),
  P('- Do not copy long passages: paraphrase; a direct quote of at most 1 to 2 sentences, in quotation marks, with a page.'),
  P('- Write in English, clearly and simply, without an em dash (—). Original terms go in parentheses at first use.'),
]);

// ---------- Въпрос към Claude ----------
export async function askAboutPage({ slug, question, selection, level, signal }) {
  const pages = wikiPages(), page = pages.find((p) => p.slug === slug);
  if (!page) return { ok: false, kind: 'error', error: $t('There is no such page.') };
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  const prompt = [
    P('You are a reading assistant. The human is reading the page “{0}” ({1}) of their personal library and wants an explanation.', [page.data.title || slug, page.rel]),
    selection ? P('\nSELECTED PASSAGE (the question is about it):\n«{0}»', [selection.slice(0, 2000)]) : '',
    P('\nQUESTION: {0}', [question]),
    P('\nHOW TO WORK'),
    P('- Read {0}. {1}', [page.rel, DEPTH[level] || DEPTH.medium]),
    P('- The original text the page was written from:'),
    groundingText(groundingOf(page, pages)),
    P('- If the page is unclear, inaccurate or incomplete, say so directly and explain what the source actually says. Distinguish “according to the source” from “my explanation”.'),
    ...READ_RULES,
    P('- Answer to the point, in about 250 words. Exception: if you are asked to retell, rewrite or improve a text, return the WHOLE new text (without shortening), ready to replace the original, in the same Markdown format and with the same [[links]]. Only Markdown, no introduction and no JSON.'),
  ].filter(Boolean).join('\n');
  const r = await askClaude({ prompt, model: L.model, effort: L.effort, maxTurns: L.maxTurns, timeoutMs: L.timeoutMs, signal });
  return r.ok ? { ok: true, answer: noDash(r.text).trim() } : r;
}

// ---------- План-конспект по оригинала ----------
const CONSPECT_DEPTH = lazy(() => ({
  light: P('Read the whole given range of the original (not only an excerpt of it).'),
  medium: P('Read the whole given range of the original completely and in order.'),
  strong: P('Read the whole given range of the original completely and carefully; if in doubt, check again with Grep.'),
}));

export async function planConspect({ slug, level, signal }) {
  const pages = wikiPages(), page = pages.find((p) => p.slug === slug);
  if (!page) return { ok: false, kind: 'error', error: $t('There is no such page.') };
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  const grounding = groundingOf(page, pages);
  const prompt = [
    P('Prepare an outline of “{0}” ({1}) from the ORIGINAL text of the source, not from the wiki page that is already written.', [page.data.title || slug, page.rel]),
    P('\nORIGINAL TEXT:'),
    groundingText(grounding),
    `\n${CONSPECT_DEPTH[level] || CONSPECT_DEPTH.medium}`,
    P('\nHOW TO WRITE'),
    P('- A connected, meaningful text (not a list of bullet points) that follows the order and logic of the original: its main theses, arguments and examples.'),
    P('- Write only what the source says. Nowhere, in no paragraph, add your own opinion, evaluation or comment.'),
    P('- Clear, simple English following good writing practice: short sentences, logical transitions between paragraphs, no repetition.'),
    P('- When translating terms from the original: an accurate, established translation, no invented or non-standard words in English. If there is no established translation, keep the original term in parentheses at first use, then use it again.'),
    P('- The files of the original texts have markers <!-- стр. N -->. Find the range with Grep (-n) and read only it (Read with offset and limit), not the whole file.'),
    P('- Do not copy long passages: paraphrase; a direct quote of at most 1 to 2 sentences, in quotation marks, with a page.'),
    P('- Do not invent facts, figures or citations that are not in the text.'),
    P('- Where a term, a person, a topic, a book chapter or a comparison has its own page in wiki/, link it at its first mention: [[slug|the word as it stands in the outline]]. Read wiki/index.md first and use only the slugs listed there; a chapter is a page in wiki/sources/chapters/ (check with Glob). Do not invent slugs: if there is no such page, write the word without a link.'),
    P('- Link each ordinary term or name only once, at its first mention, and only where the link fits the sentence. A citation such as ([[slug]], p. N) keeps its link every time it appears. A link adds no statement: the text still says only what the source says.'),
    P('- No em dash (—).'),
    P('\nReturn only the finished Markdown of the outline (subheadings with ## where naturally needed), without an introduction before it, without JSON and without repeating the title “{0}” at the beginning.', [page.data.title || slug]),
  ].filter(Boolean).join('\n');
  const r = await askClaude({ prompt, model: L.model, effort: L.effort, maxTurns: L.maxTurns, timeoutMs: L.timeoutMs, signal });
  if (!r.ok) return r;
  // Връзка само към съществуваща страница (без индекса, дневника и обзора; собствените цитати остават).
  const known = new Set(pages.filter((p) => !SPECIAL.has(p.slug)).map((p) => p.slug));
  return { ok: true, answer: fixLinks(noDash(r.text).trim(), known).text };
}

// ---------- Предложение за промяна ----------
const proposals = new Map();

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

/** Неизвестните [[връзки]] стават обикновен текст: Claude не може да създаде връзка към страница, която я няма. */
function fixLinks(text, known) {
  let fixed = 0;
  const out = String(text).replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, a, b) => {
    if (known.has(a.trim().split('/').pop())) return m;
    fixed++; return b || a.trim();
  });
  return { text: out, fixed };
}

export async function proposeChange({ slug, mode, question, answer, selection, instruction, level, signal }) {
  const pages = wikiPages(), page = pages.find((p) => p.slug === slug);
  if (!page || SPECIAL.has(slug)) return { ok: false, kind: 'error', error: $t('This page cannot be changed from here.') };
  const known = new Set(pages.map((p) => p.slug));
  const titles = new Map(pages.map((p) => [p.slug, String(p.data.title || p.slug)]));
  const body = page.content;
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  const grounding = groundingText(groundingOf(page, pages));

  let range = null, target = '';
  if (mode === 'selection') {
    range = locateRange(body, selection, titles);
    if (!range) return { ok: false, kind: 'locate', error: $t('I could not find the selected passage in the page text. Select less text within one paragraph and try again.') };
    target = body.slice(range.start, range.end);
  }

  const common = [
    P('You are editing a page of the human\'s personal library (Markdown in wiki/). The page is “{0}” ({1}, type {2}).', [page.data.title || slug, page.rel, page.data.type]),
    '',
    P('ORIGINAL TEXT you must rely on when checking and correcting:'),
    grounding,
    '',
    P('RULES'),
    `- ${DEPTH[level] || DEPTH.medium}`,
    ...READ_RULES,
    P('- Include [[links]] only to pages that really exist in wiki/ (check with Glob). Do not touch the section “## My notes”.'),
    P('- Keep the style and structure of the page; change only what is necessary.'),
  ];

  let prompt;
  if (mode === 'selection') {
    prompt = [...common, '',
      P('TASK: change ONLY the passage below according to the instruction. Return the new version of the whole passage, in the same Markdown format.'),
      P('INSTRUCTION: {0}', [instruction]),
      '',
      P('PASSAGE (exact Markdown from the page):'), '<<<', target, '>>>', '',
      P('FORMAT: only one JSON object, with no text before or after it and no ```:'),
      P('{"summary":"one sentence on what you changed and why","replacement":"the new Markdown of the whole passage"}'),
    ].join('\n');
  } else {
    prompt = [...common, '',
      P('TASK: the human asked a question about this page and got an answer. Improve the page so that the next reader gets this explanation directly, and so that the page is easier to find.'),
      P('QUESTION: {0}', [question]),
      P('ANSWER (already checked or accepted by the human):'), '<<<', answer, '>>>', '',
      P('CURRENT CONTENT OF THE PAGE (copy “find” EXACTLY from here):'), '<<<', body.slice(0, 40000), '>>>', '',
      P('HOW TO IMPROVE'),
      P('- Rework the unclear or inaccurate places with edits: each is {"find":"exact continuous text from the page that occurs only once","replace":"the new text"}. Prefer several small, precise changes to rewriting everything.'),
      P('- If a whole meaning is missing, add it in "append": {"heading":"section heading","text":"Markdown"} (otherwise null).'),
      P('- For findability: "aliases" (other spellings of names and concepts that occur in the answer), "tags" (at most 3, lowercase, with hyphens), "related" (slugs of existing pages it logically points to), "index_line" (a one-line description for the index, up to 140 characters, or "" if the current one is fine).'),
      P('- Nothing of the content that is not refuted is lost.'),
      '',
      P('FORMAT: only one JSON object, with no text before or after it and no ```:'),
      P('{"summary":"what you improve and why, 1-2 sentences","edits":[{"find":"","replace":""}],"append":null,"aliases":[],"tags":[],"related":[],"index_line":""}'),
    ].join('\n');
  }

  const r = await askClaude({ prompt, model: L.model, effort: L.effort, maxTurns: L.maxTurns, timeoutMs: L.timeoutMs, signal });
  if (!r.ok) return r;
  const j = parseJson(r.text);
  if (!j) return { ok: false, kind: 'format', error: $t('Claude returned an answer in an unexpected form. Try again or with a more powerful level.'), detail: String(r.text).slice(0, 500) };

  const notesAt = body.search(NOTES_RE);
  const inNotes = (idx) => notesAt >= 0 && idx >= notesAt;
  const edits = []; let skipped = 0, linkFixes = 0;
  const addEdit = (before, after) => {
    const fx = fixLinks(noDash(after), known); linkFixes += fx.fixed;
    if (fx.text.trim() === before.trim()) return;
    edits.push({ before, after: fx.text });
  };

  if (mode === 'selection') {
    const rep = String(j.replacement ?? '');
    if (!rep.trim() || rep.length > target.length * 6 + 2000) return { ok: false, kind: 'format', error: $t('Claude did not return a usable new text. Try another instruction.') };
    if (inNotes(range.start)) return { ok: false, kind: 'notes', error: $t('The “My notes” section is yours alone and is not changed by Claude.') };
    addEdit(target, rep);
  } else {
    for (const e of [].concat(j.edits || [])) {
      const find = String(e?.find ?? ''), idx = find ? body.indexOf(find) : -1;
      if (!find.trim() || idx < 0 || body.indexOf(find, idx + 1) >= 0 || inNotes(idx)) { skipped++; continue; }
      addEdit(find, String(e.replace ?? ''));
    }
  }

  let append = null;
  if (mode !== 'selection' && j.append?.text && String(j.append.text).trim()) {
    const fx = fixLinks(noDash(j.append.text), known); linkFixes += fx.fixed;
    append = { heading: noDash(j.append.heading || P('Explanation')).replace(/^#+\s*/, '').slice(0, 100), text: fx.text.trim() };
  }

  const slugOk = (s) => known.has(s) && s !== slug && !SPECIAL.has(s);
  const list = (x) => [].concat(x || []).map((v) => String(v).trim()).filter(Boolean);
  const meta = mode === 'selection' ? { aliases: [], tags: [], related: [], indexLine: '' } : {
    aliases: list(j.aliases).slice(0, 6).map(noDash),
    tags: list(j.tags).slice(0, 3).map((t) => t.toLowerCase().replace(/\s+/g, '-')),
    related: list(j.related).map((s) => s.replace(/^\[\[|\]\]$/g, '').split('/').pop()).filter(slugOk).slice(0, 6),
    indexLine: noDash(String(j.index_line || '')).replace(/\s+/g, ' ').trim().slice(0, 160),
  };
  // само това, което още го няма
  const have = (k) => new Set(list(page.data[k]).map((v) => v.toLowerCase()));
  meta.aliases = meta.aliases.filter((a) => !have('aliases').has(a.toLowerCase()) && a.toLowerCase() !== String(page.data.title || '').toLowerCase());
  meta.tags = meta.tags.filter((t) => !have('tags').has(t));
  meta.related = meta.related.filter((s) => !list(page.data.related).some((v) => extractLinks(v).includes(s)));

  if (!edits.length && !append && !meta.aliases.length && !meta.tags.length && !meta.related.length && !meta.indexLine) {
    return { ok: false, kind: 'empty', error: $t('Claude did not suggest a change that can be applied.') + (skipped ? ' ' + $t('({0} of the suggested changes did not match the text.)', [skipped]) : '') };
  }
  const id = crypto.randomUUID();
  proposals.set(id, { slug, hash: sha(fs.readFileSync(page.file, 'utf8')), edits, append, meta, summary: noDash(j.summary || ''), question: mode === 'selection' ? instruction : question, mode, at: Date.now() });
  for (const [k, v] of proposals) if (proposals.size > 20 && v.at < Date.now() - 36e5) proposals.delete(k);
  return { ok: true, proposal: { id, slug, mode, summary: noDash(j.summary || ''), edits, append, meta, skipped, linkFixes } };
}

// ---------- Прилагане (след потвърждение) ----------
export function applyProposal(id) {
  const p = proposals.get(id);
  if (!p) return { ok: false, error: $t('The suggestion has expired. Ask for it again.') };
  const page = wikiPages().find((x) => x.slug === p.slug);
  if (!page) return { ok: false, error: $t('The page no longer exists.') };
  const src = fs.readFileSync(page.file, 'utf8');
  if (sha(src) !== p.hash) return { ok: false, error: $t('The page was changed in the meantime. Ask for the suggestion again.') };

  const m = matter(src);
  let body = m.content;
  for (const e of p.edits) {
    const idx = body.indexOf(e.before);
    if (idx < 0 || body.indexOf(e.before, idx + 1) >= 0) return { ok: false, error: $t('The text to change no longer matches. Ask for the suggestion again.') };
    body = body.slice(0, idx) + e.after + body.slice(idx + e.before.length);
  }
  if (p.append) {
    const block = `## ${p.append.heading}\n\n${p.append.text}\n`;
    const at = body.search(NOTES_RE);
    body = at >= 0 ? body.slice(0, at).replace(/\s*$/, '\n\n') + block + '\n' + body.slice(at) : body.replace(/\s*$/, '\n\n') + block;
  }
  const d = m.data;
  for (const [k, v] of Object.entries(d)) if (v instanceof Date) d[k] = v.toISOString().slice(0, 10);
  const list = (x) => [].concat(x || []).map(String);
  if (p.meta.aliases.length) d.aliases = [...list(d.aliases), ...p.meta.aliases];
  if (p.meta.tags.length) d.tags = [...list(d.tags), ...p.meta.tags];
  if (p.meta.related.length) d.related = [...list(d.related), ...p.meta.related.map((s) => `[[${s}]]`)];
  d.updated = today();
  fs.writeFileSync(page.file, matter.stringify(body, d));

  // индекс: едноредовото описание
  let indexed = false;
  const idxFile = path.join(WIKI, 'index.md');
  if (p.meta.indexLine && fs.existsSync(idxFile)) {
    const t = fs.readFileSync(idxFile, 'utf8');
    const re = new RegExp(`^(\\s*[-*+]\\s*\\[\\[${p.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\|[^\\]]*)?\\]\\])[^\\n]*$`, 'm');
    if (re.test(t)) { fs.writeFileSync(idxFile, t.replace(re, (_, a) => `${a}: ${p.meta.indexLine}`)); indexed = true; }
  }

  const title = String(page.data.title || page.slug);
  const bits = [
    p.edits.length ? $t('{0} {1} in the text', [p.edits.length, p.edits.length === 1 ? $t('fix') : $t('fixes')]) : null,
    p.append ? $t('new section “{0}”', [p.append.heading]) : null,
    p.meta.aliases.length ? $t('aliases: {0}', [p.meta.aliases.join(', ')]) : null,
    p.meta.tags.length ? $t('tags: {0}', [p.meta.tags.join(', ')]) : null,
    p.meta.related.length ? $t('links: {0}', [p.meta.related.map((s) => `[[${s}]]`).join(', ')]) : null,
    indexed ? $t('description in the index') : null,
  ].filter(Boolean);
  fs.appendFileSync(path.join(WIKI, 'log.md'),
    `\n## ${today()} refactor: ${P('Page improved')} “${title}”\n- ${p.mode === 'selection' ? P('By your instruction for a selected passage') : p.mode === 'replace' ? P('Replacement with a rewrite by Claude') : P('After a question')}: ${String(p.question || '').replace(/\s+/g, ' ').slice(0, 200)}\n- ${P('Changes')}: ${bits.join('; ')}\n`);
  proposals.delete(id);
  return { ok: true, slug: p.slug, title, bits };
}

// ---------- Запис на отговора като страница „Въпрос“ (за търсене и пътеки) ----------
export function saveAnswer({ slug, question, answer }) {
  const pages = wikiPages(), page = pages.find((p) => p.slug === slug);
  if (!page) return { ok: false, error: $t('There is no such page.') };
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  if (!q || !String(answer || '').trim()) return { ok: false, error: $t('The question or the answer is missing.') };
  const known = new Set(pages.map((p) => p.slug));
  const qslug = `q-${today().replace(/-/g, '')}-${sha(q).slice(0, 6)}`;
  const file = path.join(WIKI, 'questions', qslug + '.md');
  if (fs.existsSync(file)) return { ok: false, error: $t('This question is already saved.') };
  const fx = fixLinks(noDash(answer), known);
  const data = {
    title: q.slice(0, 160), type: 'question', tags: [].concat(page.data.tags || []).map(String).slice(0, 3),
    sources: [].concat(page.data.sources || []).map(String), related: [`[[${slug}]]`],
    created: today(), updated: today(), confidence: 'medium',
  };
  const body = `# ${q}\n\n## ${V().question}\n\n${q}\n\n## ${V().answer}\n\n${fx.text.trim()}\n\n## ${V().relies}\n\n- [[${slug}]]\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(body, data));

  // в индекса, раздел „Въпроси“ (без сираци)
  const idxFile = path.join(WIKI, 'index.md');
  if (fs.existsSync(idxFile)) {
    let t = fs.readFileSync(idxFile, 'utf8');
    const line = `- [[${qslug}]]: ${q.slice(0, 120)}`;
    const h = t.match(new RegExp(String.raw`^##\s*${anyP('Questions')}\s*$`, 'm'));
    if (h) {
      const at = h.index + h[0].length;
      const next = t.slice(at).search(/^##\s/m);
      const end = next < 0 ? t.length : at + next;
      t = t.slice(0, end).replace(/\s*$/, '\n') + line + '\n' + (next < 0 ? '' : '\n' + t.slice(end));
    } else t = t.replace(/\s*$/, '\n') + P('\n## Questions\n\n{0}\n', [line]);
    fs.writeFileSync(idxFile, t);
  }
  fs.appendFileSync(path.join(WIKI, 'log.md'), P('\n## {0} query: {1}\n- Saved answer: [[{2}]] (from the page [[{3}]])\n', [today(), q.slice(0, 120), qslug, slug]));
  return { ok: true, slug: qslug, title: q };
}

/** Какво би получил Claude при въпрос/промяна: за оценка на токените, без да се праща нищо. */
export function costInputs({ slug, question, selection, answer, instruction, withBody }) {
  const pages = wikiPages(), page = pages.find((p) => p.slug === slug);
  if (!page) return null;
  const text = [groundingText(groundingOf(page, pages)), question, String(selection || '').slice(0, 2000), answer, instruction, withBody ? page.content.slice(0, 40000) : ''].filter(Boolean).join('\n');
  return { text, page: page.content, title: String(page.data.title || slug) };
}

// ---------- Ръчна редакция (без Claude) ----------
// Текстът се променя на ръка, а връзките между страниците остават както са: промяна, която добавя, маха
// или сменя [[връзка]], не се приема. Преименуването сменя само заглавието (frontmatter и първия # ред),
// а името на файла (slug) остава, затова нито една връзка не се чупи.

const linkCounts = (text) => {
  const m = new Map();
  for (const l of String(text).matchAll(/\[\[([^\]]+)\]\]/g)) m.set(l[0], (m.get(l[0]) || 0) + 1);
  return m;
};
function sameLinks(a, b) {
  const x = linkCounts(a), y = linkCounts(b), diff = [];
  for (const k of new Set([...x.keys(), ...y.keys()])) if ((x.get(k) || 0) !== (y.get(k) || 0)) diff.push(k);
  return diff;
}

/** Връща точния Markdown на абзаца (абзаците), в който е избраният текст, за да се редактира на ръка. */
export function locateForEdit(slug, selection) {
  const pages = wikiPages(), page = pages.find((p) => p.slug === slug);
  if (!page || SPECIAL.has(slug)) return { ok: false, error: $t('This page is not edited from here.') };
  const titles = new Map(pages.map((p) => [p.slug, String(p.data.title || p.slug)]));
  const body = matter(fs.readFileSync(page.file, 'utf8')).content;
  const range = locateRange(body, String(selection || ''), titles);
  if (!range) return { ok: false, error: $t('I could not find the selected passage in the page text. Select less text within one paragraph and try again.') };
  const markdown = body.slice(range.start, range.end);
  if (body.indexOf(markdown) !== range.start && body.indexOf(markdown, range.start + 1) >= 0) return { ok: false, error: $t('This passage occurs in several places. Select a longer text.') };
  return { ok: true, markdown, hash: sha(body) };
}

/** Заменя откъса с ръчно написания текст. Връзките [[…]] трябва да останат същите. */
export function applyManualEdit({ slug, before, after, hash }) {
  const page = wikiPages().find((p) => p.slug === slug);
  if (!page || SPECIAL.has(slug)) return { ok: false, error: $t('This page is not edited from here.') };
  const src = fs.readFileSync(page.file, 'utf8');
  const m = matter(src);
  let body = m.content;
  if (hash && sha(body) !== hash) return { ok: false, error: $t('The page was changed in the meantime. Close the editor and select the passage again.') };
  const a = String(before ?? ''), b = String(after ?? '').replace(/\r\n/g, '\n');
  if (!a.trim()) return { ok: false, error: $t('There is no passage to change.') };
  if (!b.trim()) return { ok: false, error: $t('The text cannot be left empty. If you want to remove the paragraph, leave at least one word.') };
  if (b === a) return { ok: false, error: $t('No change.') };
  const diff = sameLinks(a, b);
  if (diff.length) return { ok: false, kind: 'links', error: $t('Links between pages do not change in a manual edit. Restore: {0}{1}', [diff.slice(0, 4).join(', '), diff.length > 4 ? '…' : '']), links: diff };
  const idx = body.indexOf(a);
  if (idx < 0 || body.indexOf(a, idx + 1) >= 0) return { ok: false, error: $t('The passage no longer matches the text unambiguously. Select it again.') };
  body = body.slice(0, idx) + b + body.slice(idx + a.length);
  const d = m.data;
  for (const [k, v] of Object.entries(d)) if (v instanceof Date) d[k] = v.toISOString().slice(0, 10);
  d.updated = today();
  fs.writeFileSync(page.file, matter.stringify(body, d));
  const title = String(page.data.title || page.slug);
  fs.appendFileSync(path.join(WIKI, 'log.md'), `\n## ${today()} refactor: ${P('Manual edit of')} “${title}”\n- ${P('One passage was changed by hand; the links are unchanged.')}\n`);
  return { ok: true, slug, title, bits: [$t('manually edited passage')] };
}

/**
 * Маха абзаца (абзаците) от страницата. Връзките [[…]] в него си отиват заедно с текста: обратните връзки
 * на другите страници се смятат от текстовете, затова няма какво друго да се поправя.
 * Заглавия (# …) не се махат оттук, за да не изчезне цял раздел.
 */
export function applyParagraphDelete({ slug, before, hash }) {
  const page = wikiPages().find((p) => p.slug === slug);
  if (!page || SPECIAL.has(slug)) return { ok: false, error: $t('This page is not edited from here.') };
  const m = matter(fs.readFileSync(page.file, 'utf8'));
  let body = m.content;
  if (hash && sha(body) !== hash) return { ok: false, error: $t('The page was changed in the meantime. Select the paragraph again.') };
  const a = String(before ?? '');
  if (!a.trim()) return { ok: false, error: $t('There is no paragraph to remove.') };
  if (/^[ \t]*#{1,6}\s/m.test(a)) return { ok: false, error: $t('The selected passage contains a section heading. Select only the paragraph text.') };
  const idx = body.indexOf(a);
  if (idx < 0 || body.indexOf(a, idx + 1) >= 0) return { ok: false, error: $t('The paragraph no longer matches the text unambiguously. Select it again.') };
  const rest = body.slice(idx + a.length).replace(/^[ \t]*\n(?:[ \t]*\n)*/, '');
  const head = body.slice(0, idx);
  body = rest ? head + rest : head.replace(/\s*$/, '\n');
  const links = [...new Set(extractLinks(a))];
  const d = m.data;
  for (const [k, v] of Object.entries(d)) if (v instanceof Date) d[k] = v.toISOString().slice(0, 10);
  d.updated = today();
  fs.writeFileSync(page.file, matter.stringify(body, d));
  const title = String(page.data.title || page.slug);
  fs.appendFileSync(path.join(WIKI, 'log.md'), `\n## ${today()} refactor: ${P('Paragraph removed from')} “${title}”\n- ${P('One paragraph was removed by hand')}${links.length ? `; ${P('the links in it are gone too')}: ${links.map((l) => `[[${l}]]`).join(', ')}` : ''}.\n`);
  return { ok: true, slug, title, links, bits: [$t('paragraph removed') + (links.length ? ` (${links.length} ${links.length === 1 ? $t('link') : $t('links')})` : '')] };
}

// ---------- Връзка от избрания текст към страница от библиотеката ----------
// Избраният текст се търси в Markdown-а така, както е на екрана (интервалите са без значение). Връзката
// се вмъква около него: [[цел]] ако текстът е същото като заглавието, иначе [[цел|текст]].
// Отказва се там, където връзката би счупила текста: заглавие, вече съществуваща връзка, URL, код, няколко места.
const findOnScreen = (body, selection) => {
  const words = String(selection).trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return words.length ? [...body.matchAll(new RegExp(words.join('\\s+'), 'g'))] : [];
};

export function applyLink({ slug, selection, target }) {
  const pages = wikiPages();
  const page = pages.find((p) => p.slug === slug);
  if (!page || SPECIAL.has(slug)) return { ok: false, error: $t('This page is not edited from here.') };
  const to = pages.find((p) => p.slug === target);
  if (!to || SPECIAL.has(target)) return { ok: false, error: $t('There is no such page.') };
  if (target === slug) return { ok: false, error: $t('A page cannot link to itself.') };
  const sel = String(selection || '').trim();
  if (sel.length < 2) return { ok: false, error: $t('Select the text that should become the link.') };

  const m = matter(fs.readFileSync(page.file, 'utf8'));
  let body = m.content;
  const found = findOnScreen(body, sel);
  if (!found.length) return { ok: false, error: $t('I could not find the selected text as it is written in the page. Select text without bold or italic in its middle.') };
  if (found.length > 1) return { ok: false, error: $t('This passage occurs in several places. Select a longer text.') };
  const at = found[0].index, text = found[0][0];

  if (/\n\s*\n/.test(text)) return { ok: false, error: $t('Select text within one paragraph.') };
  if (/[\[\]|]/.test(text)) return { ok: false, error: $t('The text cannot contain brackets or the | sign.') };
  const lineStart = body.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = body.indexOf('\n', at);
  const line = body.slice(lineStart, lineEnd < 0 ? body.length : lineEnd);
  const before = body.slice(lineStart, at);
  if (/^\s*#{1,6}\s/.test(line)) return { ok: false, error: $t('Headings are not linked from here. Select the text of a paragraph.') };
  if (before.lastIndexOf('[') > before.lastIndexOf(']') || before.lastIndexOf('](') > before.lastIndexOf(')')) return { ok: false, error: $t('The selected text is already part of a link.') };
  if ((before.match(/`/g) || []).length % 2 === 1) return { ok: false, error: $t('The selected text is in code and cannot become a link.') };

  const title = String(to.data.title || to.slug);
  const label = text === title ? '' : `|${text}`;
  body = body.slice(0, at) + `[[${target}${label}]]` + body.slice(at + text.length);
  const d = m.data;
  for (const [k, v] of Object.entries(d)) if (v instanceof Date) d[k] = v.toISOString().slice(0, 10);
  d.updated = today();
  fs.writeFileSync(page.file, matter.stringify(body, d));
  const ptitle = String(page.data.title || slug);
  fs.appendFileSync(path.join(WIKI, 'log.md'), `\n## ${today()} refactor: ${P('Link added in')} “${ptitle}”\n- ${P('the text “{0}” now links to [[{1}]]', [text, target])}\n`);
  return { ok: true, slug, title: ptitle, bits: [$t('link to “{0}”', [title])] };
}

/** Сменя заглавието (не и slug-а, затова връзките остават). */
export function renamePage({ slug, title }) {
  const page = wikiPages().find((p) => p.slug === slug);
  if (!page || SPECIAL.has(slug)) return { ok: false, error: $t('This page is not renamed from here.') };
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 1) return { ok: false, error: $t('The title cannot be empty.') };
  if (t.length > 200) return { ok: false, error: $t('The title is too long (up to 200 characters).') };
  const old = String(page.data.title || page.slug);
  if (t === old) return { ok: false, error: $t('No change.') };
  const m = matter(fs.readFileSync(page.file, 'utf8'));
  const d = m.data;
  for (const [k, v] of Object.entries(d)) if (v instanceof Date) d[k] = v.toISOString().slice(0, 10);
  d.title = t; d.updated = today();
  // първият ред „# Старо заглавие“ следва заглавието
  let body = m.content;
  const h1 = body.match(/^(\s*)#\s+(.+?)\s*$/m);
  if (h1 && h1[2].trim() === old.trim() && body.slice(0, h1.index).trim() === '') body = body.slice(0, h1.index) + h1[1] + '# ' + t + body.slice(h1.index + h1[0].length);
  fs.writeFileSync(page.file, matter.stringify(body, d));
  fs.appendFileSync(path.join(WIKI, 'log.md'), `\n## ${today()} refactor: ${P('Page renamed')} “${old}” → “${t}”\n- ${P('Only the title; the file name ({0}) and the links are unchanged.', [slug])}\n`);
  return { ok: true, slug, title: t, old, bits: [$t('title: “{0}” → “{1}”', [old, t])] };
}

// ---------- Заместване на текста с готов отговор (без нов Claude) ----------
// Човекът поиска от Claude преразказ или по-добър вариант и сега иска да го приложи директно. Строим предложение по
// същия път като при „Подобри“ (преглед „било, става“, потвърждение, „Върни“), но без второ извикване на Claude.
// Разделите „Мои бележки“ и „Глави“ се пазят, а загубените връзки се показват като предупреждение.
const KEEP_RE = new RegExp(`^##\\s*(${any('notes')}|${any('chapters')})\\s*$`);

export function proposeReplace({ slug, answer, selection }) {
  const pages = wikiPages(), page = pages.find((p) => p.slug === slug);
  if (!page || SPECIAL.has(slug)) return { ok: false, kind: 'error', error: $t('This page cannot be changed from here.') };
  const known = new Set(pages.map((p) => p.slug));
  const titles = new Map(pages.map((p) => [p.slug, String(p.data.title || p.slug)]));
  const body = page.content;
  const text = noDash(String(answer ?? '')).replace(/\r\n/g, '\n').trim();
  if (text.length < 20) return { ok: false, kind: 'empty', error: $t('There is not enough text to replace it with.') };
  const linkSet = (t) => new Set(extractLinks(t));

  let before, after, whole = false;
  const sel = String(selection || '').trim();
  if (sel) {
    const range = locateRange(body, sel, titles);
    if (!range) return { ok: false, kind: 'locate', error: $t('I could not find the selected passage in the page text. Remove the selection and replace the whole page, or select less text within one paragraph.') };
    if (NOTES_RE.test(body.slice(range.start)) && body.search(NOTES_RE) <= range.start) return { ok: false, kind: 'notes', error: $t('The “My notes” section is yours alone and is not changed by Claude.') };
    before = body.slice(range.start, range.end);
    after = text;
  } else {
    whole = true;
    before = body;
    const parts = body.split(/(?=^##\s)/m);
    const keep = parts.filter((s) => KEEP_RE.test(s.split('\n')[0].trim()));
    const h1 = body.match(/^\s*(#\s+.+)$/m);
    let head = text;
    if (!/^#\s/.test(text) && h1 && body.slice(0, h1.index).trim() === '') head = `${h1[1].trim()}\n\n${text}`;
    const tail = keep.filter((s) => !new RegExp('^' + s.split('\n')[0].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm').test(text));
    after = [head, ...tail.map((s) => s.trim())].join('\n\n') + '\n';
  }
  const fx = fixLinks(after, known);
  after = fx.text;
  if (after.trim() === before.trim()) return { ok: false, kind: 'empty', error: $t('The answer is the same as the current text.') };

  // връзки, които са били в заменения текст и ги няма в новия
  const keptNow = linkSet(whole ? after : after), lost = [...linkSet(before)].filter((l) => !keptNow.has(l) && known.has(l) && l !== slug);

  const id = crypto.randomUUID();
  const summary = whole ? $t('The whole content of the page is replaced with this text. The sections “My notes” and “Chapters” are kept.') : $t('The selected passage is replaced with this text.');
  const meta = { aliases: [], tags: [], related: [], indexLine: '' };
  proposals.set(id, { slug, hash: sha(fs.readFileSync(page.file, 'utf8')), edits: [{ before, after }], append: null, meta, summary, question: whole ? $t('Replacing the text with a rewrite') : $t('Replacing a selected passage with a rewrite'), mode: 'replace', at: Date.now() });
  return { ok: true, proposal: { id, slug, mode: 'replace', summary, edits: [{ before, after }], append: null, meta, skipped: 0, linkFixes: fx.fixed, lostLinks: lost.slice(0, 12), lostCount: lost.length } };
}
