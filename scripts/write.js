// Писане с wiki: готов текст на научна статия върху страниците на библиотеката.
//
// Два начина за съставяне:
//  - Бърза чернова: без Claude, подрежда и пренарежда текста на страниците в структура на статия.
//  - Claude (лек, среден, мощен): пише свързан текст, като чете страниците и оригиналите.
// И при двата цитатите от wiki ([[глава]], с. N) се превръщат автоматично в APA 7 в текста, а библиографията
// се събира САМО от реално цитираните източници (по полето apa на source страниците). Така Claude не може да добави
// литература, която я няма в библиотеката.
//
// Готовите текстове се пазят като .md файлове в drafts/ (извън wiki/, за да не се бъркат с него),
// с предишните версии в drafts/.history/ при всеки запис.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { ROOT, today, extractLinks } from './lib.js';
import { askClaude, PATH_LEVELS } from './agent.js';
import { CYR } from './merge.js';
import { $t, contentLang } from './i18n.js';
import { any, anyP, Pall, P, pageUnits, lazy } from './vocab.js';

const HDR = (en) => anyP(en);

export const DRAFTS = path.join(ROOT, 'drafts');
const HISTORY = path.join(DRAFTS, '.history');
const TRASH = path.join(DRAFTS, '.trash');
const SRC_TYPES = new Set(['source', 'chapter']);
const noDash = (s) => String(s ?? '').replace(/\s+[—–]\s+|—/g, ', ');
const words = (s) => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;

export const LENGTHS = {
  short: { label: 'Кратка', words: 800 },
  medium: { label: 'Средна', words: 1500 },
  long: { label: 'Дълга', words: 3000 },
};

// ---------- Цитати: wiki → APA 7 ----------
export function makeCiter(pages) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const cited = new Map(), missing = new Set();
  const bookOf = (p) => (p.data.type === 'chapter' ? bySlug.get(extractLinks(String(p.data.book || ''))[0]) : p);
  const surname = (a) => {
    const t = String(a).trim();
    if (t.includes(',')) return t.split(',')[0].trim();
    const w = t.split(/\s+/);
    return w.length <= 2 ? w[w.length - 1] : t; // организация: цялото име
  };
  const authorsOf = (s) => [].concat(s.data.authors || []).map(String).filter(Boolean);
  const label = (src) => {
    const au = authorsOf(src).map(surname), n = au.length;
    const who = n === 0 ? String(src.data.title || src.slug) : n === 1 ? au[0] : n === 2 ? `${au[0]} ${P('and')} ${au[1]}` : `${au[0]} ${P('et al.')}`;
    return { who, year: src.data.year ? String(src.data.year) : P('n.d.') };
  };
  // PDF страницата от wiki → печатната, която иска APA (чрез page_offset на книгата)
  const pg = (src, unit, a, b) => {
    if (new RegExp('^' + anyP('sect.').replace(/^\(\?:/, '(?:')).test(unit) || /^(разд|sect)/.test(unit)) return `${P('sect.')} ${a}${b ? '–' + b : ''}`;
    const off = Number(src.data.page_offset) || 0, f = (n) => (off && Number(n) - off > 0 ? Number(n) - off : Number(n));
    return `${P('p.')} ${f(a)}${b ? '–' + f(b) : ''}`;
  };
  const LINK = new RegExp(String.raw`\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\](?:\s*,?\s*(${pageUnits()})\s*(\d+)(?:\s*[-–]\s*(\d+))?)?`, 'g');
  const srcOf = (slug) => {
    const s = slug.trim().split('/').pop(), p = bySlug.get(s);
    if (!p) { missing.add(s); return { p: null, src: null }; }
    const src = SRC_TYPES.has(p.data.type) ? bookOf(p) : null;
    if (src) cited.set(src.slug, src);
    return { p, src };
  };

  function convert(text) {
    // 1) в скоби: ([[x]], с. 5; [[y]], с. 7) → (Автор, 1974, с. 5; Автор2, 1980, с. 7)
    text = text.replace(/(\s?)\(([^()\n]*\[\[[^()\n]*)\)/g, (_, sp, inner) => {
      const parts = inner.split(';').map((part) => {
        let any = false, bad = false;
        const out = part.replace(LINK, (m, slug, _l, unit, a, b) => {
          const { src } = srcOf(slug);
          if (!src) { bad = true; return ''; }
          any = true;
          const { who, year } = label(src);
          return `${who}, ${year}${a ? ', ' + pg(src, unit, a, b) : ''}`;
        }).trim();
        return any ? out : (bad || /\[\[/.test(part) ? null : part.trim());
      }).filter(Boolean);
      return parts.length ? `${sp}(${parts.join('; ')})` : '';
    });
    // 2) в текста: [[x]], с. N → Автор (1974, с. N); [[x]] → Автор (1974) или заглавие
    text = text.replace(LINK, (m, slug, lab, unit, a, b) => {
      const { p, src } = srcOf(slug);
      if (src) { const { who, year } = label(src); return `${who} (${year}${a ? ', ' + pg(src, unit, a, b) : ''})`; }
      return lab || (p ? String(p.data.title || p.slug) : slug.trim().split('/').pop());
    });
    return text.replace(new RegExp(String.raw`,\s*${pageUnits()}\s*\?`, 'g'), '').replace(/ {2,}/g, ' ').replace(/ +([,.;:])/g, '$1');
  }

  function bibliography() {
    const rows = [...cited.values()].map((s) => {
      const au = authorsOf(s);
      const key = (au[0] || String(s.data.title || s.slug)).toLowerCase() + String(s.data.year || '');
      let apa = String(s.data.apa || '').trim();
      if (!apa) apa = `${au.length > 1 ? `${au.slice(0, -1).join(', ')} ${P('and')} ${au[au.length - 1]}` : au[0] || String(s.data.title || s.slug)} (${s.data.year || P('n.d.')}). *${s.data.title || s.slug}*.`;
      return { key, apa };
    }).sort((a, b) => a.key.localeCompare(b.key, contentLang()));
    return rows.map((r) => r.apa);
  }
  const citedList = () => [...cited.values()].map((s) => ({ slug: s.slug, ...label(s) }));
  return { convert, bibliography, cited, missing, label, citedList };
}

// ---------- Бърза чернова: без Claude ----------
const stripSections = (body) => body
  .replace(/^\s*#\s+.*\n/, '')
  .replace(new RegExp(`^##\\s*(${any('notes')}|${any('related')}[^\\n]*|${any('chapters')}|${any('contradictions')}|${any('relies')}|${any('sources')})\\s*\\n[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`, 'gm'), '');

/** Първите абзаци на страницата, до max знака (по граница на изречение) */
const SEE = /\s*(?:Вижте|Виж|Вж\.?)\s[^.\n]*\.(?=\s|$)/g;
function lead(p, max = 900, content = p.content) {
  const paras = stripSections(content).replace(SEE, '').split(/\n[ \t]*\n/).map((s) => s.trim()).filter(Boolean);
  let list = paras.filter((s) => !/^(#|\||>|```)/.test(s) && !/^[-*+]\s/.test(s));
  if (!list.length) list = paras.filter((s) => /^[-*+]\s/.test(s)).slice(0, 1);
  let out = '';
  for (const s of list) {
    if (out && out.length + s.length > max) break;
    out += (out ? '\n\n' : '') + s;
    if (out.length >= max) break;
  }
  if (out.length > max * 1.4) { const cut = out.slice(0, max); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); out = i > max * 0.5 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, '') + '…'; }
  return out;
}
const contradictions = (p) => (p.content.match(new RegExp(`^##\\s*${any('contradictions')}\\s*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm'))?.[1] || '').trim();
const plainTitle = (p) => String(p.data.title || p.slug).replace(new RegExp(String.raw`^${anyP('Ch.')}\s*\d+\.?\s*`), '');
// първото изречение без цитатите и без съкращението „с.“
const firstSentence = (s) => {
  const t = String(s).replace(/\([^()]*\[\[[^()]*\)/g, '').replace(/\[\[[^\]]*\]\]/g, '').replace(/\s+/g, ' ').replace(/ +([,.;:])/g, '$1').trim();
  return (t.match(/^.*?[.!?](?=\s+[А-ЯA-Z„"]|$)/)?.[0] || t).slice(0, 240);
};
const answerOf = (p) => p.content.match(new RegExp(`^##\\s*${any('answer')}\\s*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm'))?.[1]?.trim() || p.content;
const listOf = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} ${P('and')} ${a[a.length - 1]}`);
const cap = (s) => s.charAt(0).toLocaleUpperCase(contentLang()) + s.slice(1);
const plural = (n, a, b) => (n === 1 ? a : b);

export function titleOf(topic) { return cap(String(topic).trim().replace(/[?!.…\s]+$/, '')); }

/** Подрежда страниците в структура на научна статия. Връща null, ако библиотеката нищо не казва по темата. */
export function buildLocal(topic, { pages, scored }) {
  const pick = (types, n) => scored.filter((s) => types.includes(s.p.data.type)).slice(0, n).map((s) => s.p);
  const topics = pick(['topic'], 2), concepts = pick(['concept'], 6), people = pick(['entity'], 3), comps = pick(['comparison'], 3);
  const asked = pick(['question'], 2), texts = pick(['chapter', 'source'], 6);
  if (!topics.length && !concepts.length && !people.length && !comps.length && !texts.length) return null;
  const citer = makeCiter(pages), warnings = [];
  const sec = [];
  const add = (h, body) => { if (String(body).trim()) sec.push(`## ${h}\n\n${String(body).trim()}`); };

  // Увод
  const [q1, q2] = [P('“'), P('”')];
  const names = concepts.slice(0, 4).map((c) => `${q1}${plainTitle(c)}${q2}`);
  const plan = names.length
    ? P('The article presents {0} in turn{1}; every claim rests on cited texts.', [listOf(names), comps.length ? P(', then compares the positions of the authors') : ''])
    : P('Every claim in the article rests on cited texts.');
  // уводът ползва хъба на темата; ако няма такъв, не повтаря текста от следващия раздел
  add(P('Introduction'), topics[0] ? `${lead(topics[0], 800)}\n\n${plan}` : P('The topic “{0}” is examined through a survey of the available texts on it. {1}', [titleOf(topic), plan]));

  // Теоретична рамка
  const theory = [];
  for (const c of concepts) theory.push(`### ${plainTitle(c)}\n\n${lead(c, 900)}`);
  if (people.length) theory.push(`### ${P('Authors and schools')}\n\n` + people.map((e) => `**${plainTitle(e)}.** ${lead(e, 450)}`).join('\n\n'));
  if (!theory.length && topics[1]) theory.push(lead(topics[1], 900));
  add(P('Theoretical framework'), theory.join('\n\n'));

  // Анализ: сравнения и противоречия
  const analysis = [];
  for (const c of comps) analysis.push(`### ${plainTitle(c)}\n\n${lead(c, 1100)}`);
  const contra = [...concepts, ...topics, ...comps].map((p) => ({ p, t: contradictions(p) })).filter((x) => x.t).slice(0, 3);
  if (contra.length) analysis.push(`### ${P('Differences and contradictions')}\n\n` + contra.map((x) => `${P('On')} ${q1}${plainTitle(x.p)}${q2}: ${x.t.replace(/^[-*+]\s*/gm, '').replace(/\n+/g, ' ').slice(0, 700)}`).join('\n\n'));
  if (!analysis.length) warnings.push($t('The library has no comparisons on the topic, so the “Analysis” section is short. The “Synthesis” button on the home page creates them.'));
  add(P('Analysis'), analysis.join('\n\n') || P('[This is where the positions of the authors are compared: there are not enough comparisons on the topic yet.]'));

  // Дискусия: отговорите, които вече са записани
  if (asked.length) add(P('Discussion'), asked.map((q) => `**${plainTitle(q)}** ${lead(q, 700, answerOf(q))}`).join('\n\n'));

  // Заключение
  const kp = concepts.slice(0, 5).map((c) => `- **${plainTitle(c)}:** ${firstSentence(lead(c, 400))}`);
  add(P('Conclusion'), (kp.length ? `${P('The main lines that emerge:')}\n\n${kp.join('\n')}\n\n` : '') + P('The conclusions are limited by the texts reviewed. They are a starting point for reading and further checking, not a full survey of the literature.'));

  // Цитатите се преобразуват; после се знае върху какво е стъпила статията
  let text = noDash(citer.convert(sec.join('\n\n')));
  if (citer.cited.size < 2) warnings.push($t('The text relies on few sources. Add more books and articles on the topic and run the Synthesis.'));
  if (citer.missing.size) warnings.push($t('Citations to non-existent pages were skipped: {0}.', [[...citer.missing].join(', ')]));
  if (!/(?:с|p|pp)\. \d/.test(text)) warnings.push($t('There are almost no page numbers. Run “Upgrade” on the sources so they get exact pages.'));

  const cl = citer.citedList();
  const who = cl.slice(0, 3).map((c) => `${c.who} (${c.year})`).join('; ');
  const nSrc = `${cl.length} ${cl.length === 1 ? P('source') : P('sources')}`;
  const whoTxt = who ? ` (${who}${cl.length > 3 ? ' ' + P('et al.') : ''})` : '';
  const conceptList = listOf(concepts.slice(0, 5).map((c) => plainTitle(c).toLowerCase()));
  const abstract = noDash(P('The article examines the topic “{0}” on the basis of {1}{2}. ', [titleOf(topic), nSrc, whoTxt])
    + (concepts.length ? P(concepts.length === 1 ? 'The concept examined is {0}. ' : 'The concepts examined are {0}. ', [conceptList]) : '')
    + (comps.length ? P("It includes comparisons of the authors' positions ({0}). ", [comps.length]) : '')
    + P('The survey covers the available texts on the topic.'));
  const kw = [...new Set([...concepts.map((c) => plainTitle(c).replace(/\s*\(.*?\)/g, '')), ...scored.slice(0, 12).flatMap((s) => [].concat(s.p.data.tags || []).map(String))].map((k) => k.replace(/-/g, ' ').trim().toLowerCase()).filter(Boolean))].slice(0, 7);

  const md = [`# ${titleOf(topic)}`, `## ${P('Abstract')}\n\n${abstract}\n\n**${P('Keywords')}:** ${kw.join('; ')}`, text, bibSection(citer)].join('\n\n');
  return { markdown: md, cited: cl, warnings };
}

function bibSection(citer) {
  const b = citer.bibliography();
  return b.length ? `## ${P('Bibliography')}\n\n${b.join('\n\n')}` : `## ${P('Bibliography')}\n\n${P('[No sources cited.]')}`;
}

// ---------- Claude ----------
const DEPTH = lazy(() => ({
  light: P('Work quickly: rely on index.md and the most important pages; open only what is necessary.'),
  medium: P('Read the main concepts, the comparisons and the chapters where the claims stand before you write.'),
  strong: P('Work thoroughly: read all relevant pages, follow the citations to the chapters, check the key claims in the original text (raw/.extracted/, markers <!-- стр. N -->) and describe the contradictions between the authors.'),
}));

function claudePrompt({ topic, length, voice, hints }) {
  const L = LENGTHS[length] || LENGTHS.medium;
  return [
    P('You are writing a scientific article in English based on the author\'s materials (the wiki/ folder in the current directory). This is your working environment, not the topic of the article.'),
    '',
    P('TOPIC: {0}', [topic]),
    P('LENGTH: about {0} words (without the bibliography).', [L.words]),
    voice ? P('\nHOW THE AUTHOR SOUNDS (their sample sentences: follow the tone, the rhythm and the length of the sentences; do not copy them):\n"""\n{0}\n"""', [voice.slice(0, 1500)]) : '',
    '',
    P('HOW TO WORK'),
    P('- Start with wiki/index.md and choose the pages on the topic (concepts, entities, topics, comparisons, questions, sources, sources/chapters). The identifier (slug) of a page is the file name without .md.'),
    `- ${DEPTH[L.depth] || ''}`.replace('undefined', ''),
    P('- Write ONLY what is based on the library. Do not invent claims, authors, years or pages. If something is missing, say so as a limitation in the conclusion.'),
    P('- After every substantial claim put a citation in the wiki format: ([[slug-of-chapter-or-source]], p. N), where N is the PDF page recorded in the pages of the library. If you do not know it, write only ([[slug]]), without a page. Do NOT write author names and years in parentheses: citations are converted automatically to APA 7.'),
    P('- Cite only pages from wiki/sources/ and wiki/sources/chapters/ (sources and chapters). The concept and person pages are for orientation, not for citing.'),
    P('- Paraphrase; a direct quote of at most 1 to 2 sentences, in quotation marks, with a page.'),
    P('- NEVER mention in the text of the article a “library”, a “wiki”, a “knowledge base”, a “personal collection” or folders and files. When you need to say where the claims come from, write that a survey of the available texts on the topic was made (e.g. “The survey of the available texts on the topic shows…”). Phrase the limitations as limitations of the texts reviewed.'),
    '',
    P('STRUCTURE (Markdown, exactly these sections):'),
    P('# A scientific, informative title'),
    P('## {0} (150 to 250 words)', [P('Abstract')]),
    P('**{0}:** 5 to 7, separated by semicolons', [P('Keywords')]),
    P('## {0} (problem, significance, aim and research questions)', [P('Introduction')]),
    P('## {0} (concepts and authors)', [P('Theoretical framework')]),
    P('## {0} (comparisons, differences between the authors, contradictions)', [P('Analysis')]),
    P('## {0} (what follows from the analysis; limitations)', [P('Discussion')]),
    `## ${P('Conclusion')}`,
    P('The bibliography is NOT written: it is added automatically from the citations.'),
    '',
    P('LANGUAGE: impersonal scientific style; clear paragraphs; no em dash (—) and no dash for a pause; do not begin all sentences the same way.'),
    '',
    P('HINTS from a rough word-based searcher (they may be incomplete, check them):'),
    hints || P('(none)'),
    '',
    P('Return only the Markdown of the article, with no explanations before or after it.'),
  ].filter((x) => x !== '').join('\n');
}

export async function writeWithClaude({ topic, level, length, voice, hints, pages, signal }) {
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  const r = await askClaude({
    prompt: claudePrompt({ topic, length, voice, hints }), model: L.model, effort: L.effort,
    maxTurns: L.maxTurns + 12, timeoutMs: Math.round(L.timeoutMs * 1.6), signal,
  });
  if (!r.ok) return r;
  let md = noDash(r.text).trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '');
  if (!/^#\s/m.test(md) || words(md) < 120) return { ok: false, kind: 'format', error: $t('Claude did not return an article. Try again or with a more powerful level.'), detail: md.slice(0, 400) };
  md = md.replace(new RegExp(`^##\\s*${HDR('bibliography')}[\\s\\S]*$`, 'im'), '').trim(); // библиографията я прави сървърът
  const citer = makeCiter(pages), warnings = [];
  const body = citer.convert(md);
  if (citer.cited.size < 2) warnings.push($t('The article cites few sources. Check whether the library covers the topic, or try a more powerful level.'));
  if (citer.missing.size) warnings.push($t('Claude cited non-existent pages ({0}): the citations were removed.', [[...citer.missing].join(', ')]));
  if (/library|wiki|knowledge base|collection|библиотек|база знания|колекци/i.test(body)) warnings.push($t('The text mentions the library or the wiki. Check and rewrite those sentences.'));
  const target = (LENGTHS[length] || LENGTHS.medium).words, n = words(body);
  if (n < target * 0.6) warnings.push($t('The text is shorter than requested ({0} of about {1} words).', [n, target]));
  return { ok: true, markdown: `${body}\n\n${bibSection(citer)}`, cited: citer.citedList(), warnings };
}

// ---------- Дописване на вече написана статия ----------
const BIB_RE = new RegExp(`^##\\s*${HDR('bibliography')}\\s*$`, 'm');

function continuePrompt({ title, body, instruction, words: n, hints }) {
  return [
    P('You are continuing a scientific article in English based on the author\'s materials (the wiki/ folder in the current directory). This is your working environment, not the topic of the article.'),
    '',
    P('THE ARTICLE SO FAR “{0}” (do not return it, only continue it):', [title]),
    '<<<', body.slice(0, 60000), '>>>',
    '',
    P('TASK: write a NEW text that is added to the article. {0}', [instruction ? P('What the author wants: {0}', [instruction]) : P('The author gave no direction: add the most valuable thing that is missing (missed concepts, authors, comparisons), without repeating what is written.')]),
    P('LENGTH: about {0} words.', [n]),
    '',
    P('HOW TO WORK'),
    P('- Start with wiki/index.md and read the pages needed for the new text. The identifier (slug) of a page is the file name without .md.'),
    P('- Follow the tone, the terminology and the way of citing of the text so far. Do not repeat or contradict what is said; if something connects with it, build on it.'),
    P('- Write ONLY what is based on the library. Do not invent claims, authors, years or pages.'),
    P('- After every substantial claim put a citation in the wiki format: ([[slug-of-chapter-or-source]], p. N), where N is the PDF page. If you do not know it, write only ([[slug]]). Do NOT write author names and years in parentheses: citations are converted automatically to APA 7.'),
    P('- Cite only pages from wiki/sources/ and wiki/sources/chapters/.'),
    P('- Paraphrase; a direct quote of at most 1 to 2 sentences, in quotation marks, with a page.'),
    P('- NEVER mention in the text a “library”, a “wiki”, a “knowledge base”, a “personal collection” or folders and files.'),
    P('- Impersonal scientific style; no em dash (—). Do not include the title of the article, an abstract, a conclusion or a bibliography.'),
    P('- If you write new sections, start them with ## (subsections with ###); if you only continue a thought, return plain paragraphs without a heading.'),
    '',
    P('HINTS from a rough word-based searcher (they may be incomplete, check them):'),
    hints || P('(none)'),
    '',
    P('Return only the Markdown of the new text, with no explanations before or after it.'),
  ].join('\n');
}

/**
 * Дописва статията с Claude. Не записва нищо: връща новото тяло (за преглед и запис от човека).
 * Новият текст влиза преди „Заключение“ (ако има), иначе преди „Библиография“, иначе накрая.
 * Библиографията се допълва с новоцитираните източници, като вече написаните записи се пазят.
 */
export async function continueWithClaude({ body, title, instruction, level, words: n = 600, hints, pages, signal }) {
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  const text = String(body ?? '');
  if (!text.trim()) return { ok: false, kind: 'empty', error: $t('The article is empty.') };
  const r = await askClaude({
    prompt: continuePrompt({ title, body: text, instruction: String(instruction || '').trim(), words: n, hints }), model: L.model, effort: L.effort,
    maxTurns: L.maxTurns + 12, timeoutMs: Math.round(L.timeoutMs * 1.4), signal,
  });
  if (!r.ok) return r;
  let add = noDash(r.text).trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '');
  add = add.replace(/^#\s+.*\n+/, '').replace(new RegExp(`^##\\s*${HDR('bibliography')}[\\s\\S]*$`, 'im'), '').trim();
  if (words(add) < 40) return { ok: false, kind: 'format', error: $t('Claude did not return a usable new text. Try again, with another direction or with a more powerful level.'), detail: add.slice(0, 400) };

  const citer = makeCiter(pages), warnings = [];
  add = citer.convert(add);
  if (citer.missing.size) warnings.push($t('Claude cited non-existent pages ({0}): the citations were removed.', [[...citer.missing].join(', ')]));
  if (/library|wiki|knowledge base|collection|библиотек|база знания|колекци/i.test(add)) warnings.push($t('The new text mentions the library or the wiki. Check and rewrite those sentences.'));

  // разделяне на статията на основен текст и библиография
  const bib = text.match(BIB_RE);
  const main = (bib ? text.slice(0, bib.index) : text).replace(/\s+$/, '');
  const oldBib = bib ? text.slice(bib.index + bib[0].length).trim().split(/\n[ \t]*\n/).map((s) => s.trim()).filter((s) => s && !Pall('[No sources cited.]').includes(s.trim())) : [];
  const concl = main.match(new RegExp(`^##\\s*${HDR('conclusion')}\\s*$`, 'm'));
  const newMain = concl ? `${main.slice(0, concl.index).replace(/\s+$/, '')}\n\n${add}\n\n${main.slice(concl.index)}` : `${main}\n\n${add}`;

  const entries = [...new Set([...oldBib, ...citer.bibliography()])].sort((a, b) => a.replace(/[^\p{L}\p{N}]/gu, '').localeCompare(b.replace(/[^\p{L}\p{N}]/gu, ''), contentLang()));
  const bibMd = entries.length ? `## ${P('Bibliography')}\n\n${entries.join('\n\n')}` : `## ${P('Bibliography')}\n\n${P('[No sources cited.]')}`;
  return { ok: true, markdown: `${newMain.replace(/\s+$/, '')}\n\n${bibMd}\n`, added: words(add), placed: concl ? P('before the Conclusion') : P('at the end of the text'), cited: citer.citedList(), warnings };
}

// ---------- Файлове в drafts/ ----------
const latin = (s) => [...String(s).toLowerCase()].map((c) => (c in CYR ? CYR[c] : c)).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'tekst';
const okId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id));
const fileOf = (id) => path.join(DRAFTS, id + '.md');

export function saveDraft({ markdown, topic, level, length, cited, warnings }) {
  fs.mkdirSync(DRAFTS, { recursive: true });
  const title = (markdown.match(/^#\s+(.+)$/m)?.[1] || titleOf(topic)).trim();
  const base = `${today()}-${latin(title)}`;
  let id = base; for (let i = 2; fs.existsSync(fileOf(id)); i++) id = `${base}-${i}`;
  const data = {
    title, topic: String(topic).trim(), type: 'draft', mode: level, ...(level !== 'local' ? { length } : {}),
    created: today(), updated: today(), words: words(markdown), cites: cited.map((c) => c.slug),
  };
  fs.writeFileSync(fileOf(id), matter.stringify(markdown.trim() + '\n', data));
  return { id, title, words: data.words, path: `drafts/${id}.md`, cited, warnings };
}

const dateStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || ''));
function readFile(id) {
  const f = fileOf(id);
  if (!okId(id) || !fs.existsSync(f)) return null;
  const m = matter(fs.readFileSync(f, 'utf8'));
  const d = m.data;
  return {
    id, path: `drafts/${id}.md`, title: String(d.title || id), topic: String(d.topic || ''), mode: String(d.mode || ''), length: d.length || null,
    created: dateStr(d.created), updated: dateStr(d.updated), words: Number(d.words) || words(m.content), cites: [].concat(d.cites || []).map(String), body: m.content,
  };
}
export const readDraft = readFile;

export function listDrafts(q = '') {
  if (!fs.existsSync(DRAFTS)) return [];
  const needle = String(q).trim().toLowerCase();
  return fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.md')).map((f) => readFile(f.slice(0, -3))).filter(Boolean)
    .filter((d) => !needle || (d.title + ' ' + d.topic + ' ' + d.body).toLowerCase().includes(needle))
    .map(({ body, ...d }) => ({ ...d, excerpt: body.replace(/^#.*$/gm, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) }))
    .sort((a, b) => (b.updated + b.id).localeCompare(a.updated + a.id));
}

/** Запис на редактиран текст. Предишната версия отива в drafts/.history/<id>/. */
export function updateDraft(id, body) {
  const cur = readFile(id);
  if (!cur) return { ok: false, error: $t('There is no such text.') };
  const text = String(body ?? '');
  if (!text.trim()) return { ok: false, error: $t('The text is empty.') };
  const dir = path.join(HISTORY, id);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(fileOf(id), path.join(dir, stamp + '.md'));
  const old = fs.readdirSync(dir).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 15))) fs.rmSync(path.join(dir, f), { force: true });
  const m = matter(fs.readFileSync(fileOf(id), 'utf8'));
  m.data.title = (text.match(/^#\s+(.+)$/m)?.[1] || m.data.title || id).trim();
  m.data.updated = today(); m.data.words = words(text);
  for (const [k, v] of Object.entries(m.data)) if (v instanceof Date) m.data[k] = v.toISOString().slice(0, 10);
  fs.writeFileSync(fileOf(id), matter.stringify(text.replace(/\s+$/, '') + '\n', m.data));
  return { ok: true, title: m.data.title, words: m.data.words, updated: m.data.updated };
}

/** „Изтриване“ = преместване в drafts/.trash/, за да не се губи нищо безвъзвратно. */
export function trashDraft(id) {
  if (!readFile(id)) return { ok: false, error: $t('There is no such text.') };
  fs.mkdirSync(TRASH, { recursive: true });
  fs.renameSync(fileOf(id), path.join(TRASH, `${id}-${Date.now()}.md`));
  return { ok: true };
}
