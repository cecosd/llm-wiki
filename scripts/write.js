// Write with the wiki: a finished text built on the pages of the library.
//
// Kinds of text (GENRES): a scientific article, an essay, a popular science article, a literature review and a literary text.
// Three ways of composing:
//  - Quick draft: without Claude, arranges the text of the pages into the structure of the chosen kind of text (an essay: introduction, thesis, antithesis, conclusion).
//  - Claude (light, medium, powerful): writes a coherent text by reading the pages and the originals.
//  - Blank document: the person writes alone and asks for help with paragraphs (rewriting, inserting) or continuing.
// Creativity (1 to 5) changes the style and the interpretation, not the facts: they and the citations always come only from the library.
// With a model without tools it is also the temperature of the request; Claude Code has no such setting and receives it as an instruction.
// The citations from the wiki ([[chapter]], p. N) are turned automatically into APA 7 in the text, and the bibliography
// is gathered ONLY from the sources that are really cited (by the apa field of the source pages). This way Claude cannot add
// literature that is not in the library. A literary text has no citations in the text itself: its sources are in "Based on".
//
// The finished texts are kept as .md files in drafts/ (outside wiki/, so that they are not mixed with it),
// with the previous versions in drafts/.history/ at every save.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { ROOT, today, extractLinks } from './lib.js';
import { PATH_LEVELS } from './agent.js';
import { askAI } from './ai.js';
import { clipTokens, approxTokens } from './llm.js';
import { CYR } from './merge.js';
import { $t, contentLang } from './i18n.js';
import { any, anyP, Pall, P, pageUnits, lazy } from './vocab.js';

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

// ---------- Kinds of text and creativity ----------
export const GENRES = ['article', 'essay', 'popular', 'review', 'story'];
export const genreOf = (g) => (GENRES.includes(g) ? g : 'article');
/** Default creativity for each kind: the review is the strictest, the story the freest */
export const CREATIVITY_DEFAULT = { article: 2, essay: 3, popular: 3, review: 1, story: 4 };
export function creativityOf(c, genre) {
  const n = Math.round(Number(c));
  return n >= 1 && n <= 5 ? n : CREATIVITY_DEFAULT[genreOf(genre)];
}
const TEMPERATURE = [0.2, 0.4, 0.7, 0.9, 1];
export const temperatureOf = (c) => TEMPERATURE[c - 1] ?? 0.4;
const citesInText = (genre) => genre !== 'story';
/** The name of the kind of text in the content language ("a scientific article" and so on), for the requests in review.js */
export const genreName = (g) => GENRE[genreOf(g)].name;
const bibTitle = (genre) => (citesInText(genre) ? P('Bibliography') : P('Based on'));
// The title of the bibliography in every language and for every kind; models sometimes write "References" too
const BIB_HEADS = () => `(?:${anyP('Bibliography')}|${anyP('Based on')}|${anyP('References')})`;
const BIB_LINE = () => new RegExp(`^##[ \\t]*${BIB_HEADS()}[ \\t]*:?[ \\t]*$`, 'im');
/** The same titles as text: the editor uses them to know which paragraphs are the bibliography (the server fills them in) */
export const bibHeads = () => [...new Set([...Pall('Bibliography'), ...Pall('Based on'), ...Pall('References')])];
const cutBib = (s) => { const m = s.match(BIB_LINE()); return (m ? s.slice(0, m.index) : s).trim(); };

const GENRE = lazy(() => ({
  article: {
    name: P('a scientific article'),
    role: P('You are writing a scientific article in English based on the author\'s materials (the wiki/ folder in the current directory). This is your working environment, not the topic of the article.'),
    strict: true,
    structure: [
      P('# A scientific, informative title'),
      P('## {0} (150 to 250 words)', [P('Abstract')]),
      P('**{0}:** 5 to 7, separated by semicolons', [P('Keywords')]),
      P('## {0} (problem, significance, aim and research questions)', [P('Introduction')]),
      P('## {0} (concepts and authors)', [P('Theoretical framework')]),
      P('## {0} (comparisons, differences between the authors, contradictions)', [P('Analysis')]),
      P('## {0} (what follows from the analysis; limitations)', [P('Discussion')]),
      `## ${P('Conclusion')}`,
    ],
    style: P('LANGUAGE: impersonal scientific style; clear paragraphs; no em dash (—) and no dash for a pause; do not begin all sentences the same way.'),
  },
  essay: {
    name: P('an essay'),
    role: P('You are writing an essay in English based on the author\'s materials (the wiki/ folder in the current directory). This is your working environment, not the topic of the essay.'),
    structure: [
      P('# A title that names the idea of the essay'),
      P('An opening that poses the question or the problem and shows why it matters.'),
      P('A body that develops one line of thought step by step: claims, examples from the texts, counterarguments and answers to them. Use ## headings only if the text is long (at most 4).'),
      P('An ending that returns to the opening question and states a clear position.'),
    ],
    style: P('LANGUAGE: a personal, reflective style; the first person is allowed; a clear thesis; vivid but precise sentences; no em dash (—); do not begin all sentences the same way.'),
  },
  popular: {
    name: P('a popular science article'),
    role: P('You are writing a popular science article in English based on the author\'s materials (the wiki/ folder in the current directory). This is your working environment, not the topic of the article.'),
    structure: [
      P('# A clear, inviting title'),
      P('A lead of 2 to 3 sentences that draws the reader in with a question, a scene or a surprising fact from the texts.'),
      P('## Sections with clear headings: explain every term in simple words at its first use, with examples and comparisons from everyday life.'),
      P('## A short final section: what follows from all this for the reader.'),
    ],
    extra: [P('- Cite the key claims (at least one citation per section); there is no need to cite every sentence.')],
    style: P('LANGUAGE: for a wide audience; simple, lively language; short paragraphs; no jargon without an explanation; no em dash (—).'),
  },
  review: {
    name: P('a literature review'),
    role: P('You are writing a literature review in English based on the author\'s materials (the wiki/ folder in the current directory). This is your working environment, not the topic of the review.'),
    strict: true,
    structure: [
      P('# A title of the form “Topic: a review of the literature”'),
      P('## {0} (the question and the scope of the review)', [P('Introduction')]),
      P('## {0} (which texts were reviewed and how they were grouped)', [P('Method')]),
      P('## Thematic sections: one ## per theme or line of thought; in each, who claims what, where the authors agree and where they differ.'),
      P('## {0}: a Markdown table with the columns author, main claim, citation', [P('Summary of the positions')]),
      P('## {0} (what is missing in the texts and what is worth reading next)', [P('Gaps and directions')]),
      `## ${P('Conclusion')}`,
    ],
    style: P('LANGUAGE: impersonal scientific style; balanced and fair to every author; every claim is attributed to its author; no em dash (—).'),
  },
  story: {
    name: P('a literary text (a short story)'),
    role: P('You are writing a literary text (a short story) in English inspired by the author\'s materials (the wiki/ folder in the current directory). This is your working environment, not the topic of the story.'),
    structure: [
      P('# A title'),
      P('Then the story itself in paragraphs, with dialogue where it fits. A change of scene is a line with only * * *. No section headings and no explanation of the ideas after the story.'),
    ],
    style: P('LANGUAGE: literary prose; show through scenes, actions and dialogue rather than explain; concrete details; dialogue in quotation marks; no em dash (—).'),
  },
}));

/** The rules for relying on the library and for citing, by the kind of text (part: continuing or a paragraph, without a "conclusion") */
function groundRules(genre, part = false) {
  if (!citesInText(genre)) return [
    P('- The ideas, the facts and the real people in the story come ONLY from the library. The plot, the characters, the dialogue and the images are invented by you.'),
    P('- The story makes the central ideas of the topic felt through events and characters, without lecturing.'),
    P('- Real people from the library act and speak in line with what the library says about them; do not attribute invented views to them.'),
    P('- Do NOT put citations or page numbers inside the story.'),
    P('- At the very end write a line ## {0} and under it the [[slug]] of every source or chapter whose ideas the text uses, one per line. The list is turned automatically into references.', [P('Based on')]),
    P('- NEVER mention in the text a “wiki”, a “knowledge base” or folders and files.'),
  ];
  return [
    part ? P('- Write ONLY what is based on the library. Do not invent claims, authors, years or pages.')
      : P('- Write ONLY what is based on the library. Do not invent claims, authors, years or pages. If something is missing, say so as a limitation in the conclusion.'),
    P('- After every substantial claim put a citation in the wiki format: ([[slug-of-chapter-or-source]], p. N), where N is the PDF page recorded in the pages of the library. If you do not know it, write only ([[slug]]), without a page. Do NOT write author names and years in parentheses: citations are converted automatically to APA 7.'),
    P('- Cite only pages from wiki/sources/ and wiki/sources/chapters/ (sources and chapters). The concept and person pages are for orientation, not for citing.'),
    ...(GENRE[genre].extra || []),
    P('- Paraphrase; a direct quote of at most 1 to 2 sentences, in quotation marks, with a page.'),
    P('- NEVER mention in the text of the article a “library”, a “wiki”, a “knowledge base”, a “personal collection” or folders and files. When you need to say where the claims come from, write that a survey of the available texts on the topic was made (e.g. “The survey of the available texts on the topic shows…”). Phrase the limitations as limitations of the texts reviewed.'),
  ];
}

const CREATIVE = lazy(() => [
  P('CREATIVITY 1 of 5 (strict): plain, precise language without images or metaphors; stay as close as possible to what the texts say, without your own interpretation.'),
  P('CREATIVITY 2 of 5 (restrained): clear, precise language with a little colour; connect the ideas only where the texts connect them; mark any interpretation as such.'),
  P('CREATIVITY 3 of 5 (balanced): lively language with some images and examples; your own interpretation and connections between the ideas are welcome when they follow from the texts.'),
  P('CREATIVITY 4 of 5 (free): expressive language with metaphors and images; bold interpretations, an unusual angle and unexpected connections between the authors, as long as they rest on the texts.'),
  P('CREATIVITY 5 of 5 (bold): an original, daring text with a strong voice, rich images and play with form; far-reaching interpretations and hypotheses are allowed when they are presented as your own reading.'),
]);
function creativeNote(c, genre) {
  return `${CREATIVE[c - 1]} ${citesInText(genre)
    ? P('Creativity changes only the style and the interpretation: the facts, the claims of the authors and the citations come ONLY from the library at every level.')
    : P('In a literary text this level also sets how freely the plot, the characters and the form are invented; the ideas and the facts still come only from the library.')}`;
}
const voiceNote = (voice) => (voice ? P('\nHOW THE AUTHOR SOUNDS (their sample sentences: follow the tone, the rhythm and the length of the sentences; do not copy them):\n"""\n{0}\n"""', [String(voice).slice(0, 1500)]) : null);
const WRITER_SYSTEM = () => [
  P('You are a careful writer who works from the material of a personal knowledge library. The ideas, the facts and the citations come only from the material in the request; invent only what the request allows.'),
  P('Write in English, clearly and simply, without an em dash (—).'),
].join(' ');
/** The answer of the model without the ``` wrapper and without long dashes */
const cleanAnswer = (s) => noDash(s).trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '');

/**
 * The citations in the new text: in the scientific kinds they become APA 7 in the text, and the bibliography, if the model wrote it,
 * is removed (the server makes it). In a literary text the citations are recorded but removed from the text, and the list
 * "Based on" of the model is removed afterwards.
 */
function finishText(md, citer, genre) {
  return citesInText(genre) ? citer.convert(cutBib(md)) : cutBib(citer.convert(md, { inline: false }));
}

// ---------- Citations: wiki -> APA 7 ----------
export function makeCiter(pages) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const cited = new Map(), missing = new Set();
  const bookOf = (p) => (p.data.type === 'chapter' ? bySlug.get(extractLinks(String(p.data.book || ''))[0]) : p);
  const surname = (a) => {
    const t = String(a).trim();
    if (t.includes(',')) return t.split(',')[0].trim();
    const w = t.split(/\s+/);
    return w.length <= 2 ? w[w.length - 1] : t; // an organisation: the whole name
  };
  const authorsOf = (s) => [].concat(s.data.authors || []).map(String).filter(Boolean);
  const label = (src) => {
    const au = authorsOf(src).map(surname), n = au.length;
    const who = n === 0 ? String(src.data.title || src.slug) : n === 1 ? au[0] : n === 2 ? `${au[0]} ${P('and')} ${au[1]}` : `${au[0]} ${P('et al.')}`;
    return { who, year: src.data.year ? String(src.data.year) : P('n.d.') };
  };
  // The PDF page from the wiki -> the printed one that APA wants (through the page_offset of the book)
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

  // inline: false (a literary text): the sources are recorded for the list at the end, but no citations stay in the text
  function convert(text, { inline = true } = {}) {
    // 1) in parentheses: ([[x]], p. 5; [[y]], p. 7) -> (Author, 1974, p. 5; Author2, 1980, p. 7)
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
      return parts.length && inline ? `${sp}(${parts.join('; ')})` : '';
    });
    // 2) in the text: [[x]], p. N -> Author (1974, p. N); [[x]] -> Author (1974) or the title
    text = text.replace(LINK, (m, slug, lab, unit, a, b) => {
      const { p, src } = srcOf(slug);
      if (src && inline) { const { who, year } = label(src); return `${who} (${year}${a ? ', ' + pg(src, unit, a, b) : ''})`; }
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

// ---------- Quick draft: without Claude ----------
const stripSections = (body) => body
  .replace(/^\s*#\s+.*\n/, '')
  .replace(new RegExp(`^##\\s*(${any('notes')}|${any('related')}[^\\n]*|${any('chapters')}|${any('contradictions')}|${any('relies')}|${any('sources')})\\s*\\n[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`, 'gm'), '');

/** The first paragraphs of the page, up to max characters (at a sentence boundary) */
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
// the first sentence without the citations and without the abbreviation "p."
const firstSentence = (s) => {
  const t = String(s).replace(/\([^()]*\[\[[^()]*\)/g, '').replace(/\[\[[^\]]*\]\]/g, '').replace(/\s+/g, ' ').replace(/ +([,.;:])/g, '$1').trim();
  return (t.match(/^.*?[.!?](?=\s+[А-ЯA-Z„"]|$)/)?.[0] || t).slice(0, 240);
};
const answerOf = (p) => p.content.match(new RegExp(`^##\\s*${any('answer')}\\s*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm'))?.[1]?.trim() || p.content;
const listOf = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} ${P('and')} ${a[a.length - 1]}`);
const cap = (s) => s.charAt(0).toLocaleUpperCase(contentLang()) + s.slice(1);
const plural = (n, a, b) => (n === 1 ? a : b);

export function titleOf(topic) { return cap(String(topic).trim().replace(/[?!.…\s]+$/, '')); }

/** Arranges library pages into the structure of the chosen kind of text. Returns null when the library says nothing on the topic. */
export function buildLocal(topic, { pages, scored }, genre = 'article') {
  const pick = (types, n) => scored.filter((s) => types.includes(s.p.data.type)).slice(0, n).map((s) => s.p);
  const topics = pick(['topic'], 2), concepts = pick(['concept'], 6), people = pick(['entity'], 3), comps = pick(['comparison'], 3);
  const asked = pick(['question'], 2), texts = pick(['chapter', 'source'], 6);
  if (!topics.length && !concepts.length && !people.length && !comps.length && !texts.length) return null;
  if (genre !== 'article') return buildOther(genre, topic, { pages, scored, topics, concepts, people, comps, asked, texts });
  const citer = makeCiter(pages), warnings = [];
  const sec = [];
  const add = (h, body) => { if (String(body).trim()) sec.push(`## ${h}\n\n${String(body).trim()}`); };

  // Introduction
  const [q1, q2] = [P('“'), P('”')];
  const names = concepts.slice(0, 4).map((c) => `${q1}${plainTitle(c)}${q2}`);
  const plan = names.length
    ? P('The article presents {0} in turn{1}; every claim rests on cited texts.', [listOf(names), comps.length ? P(', then compares the positions of the authors') : ''])
    : P('Every claim in the article rests on cited texts.');
  // the introduction uses the hub of the topic; if there is none, it does not repeat the text of the next section
  add(P('Introduction'), topics[0] ? `${lead(topics[0], 800)}\n\n${plan}` : P('The topic “{0}” is examined through a survey of the available texts on it. {1}', [titleOf(topic), plan]));

  // Theoretical framework
  const theory = [];
  for (const c of concepts) theory.push(`### ${plainTitle(c)}\n\n${lead(c, 900)}`);
  if (people.length) theory.push(`### ${P('Authors and schools')}\n\n` + people.map((e) => `**${plainTitle(e)}.** ${lead(e, 450)}`).join('\n\n'));
  if (!theory.length && topics[1]) theory.push(lead(topics[1], 900));
  add(P('Theoretical framework'), theory.join('\n\n'));

  // Analysis: comparisons and contradictions
  const analysis = [];
  for (const c of comps) analysis.push(`### ${plainTitle(c)}\n\n${lead(c, 1100)}`);
  const contra = [...concepts, ...topics, ...comps].map((p) => ({ p, t: contradictions(p) })).filter((x) => x.t).slice(0, 3);
  if (contra.length) analysis.push(`### ${P('Differences and contradictions')}\n\n` + contra.map((x) => `${P('On')} ${q1}${plainTitle(x.p)}${q2}: ${x.t.replace(/^[-*+]\s*/gm, '').replace(/\n+/g, ' ').slice(0, 700)}`).join('\n\n'));
  if (!analysis.length) warnings.push($t('The library has no comparisons on the topic, so the “Analysis” section is short. The “Synthesis” button on the home page creates them.'));
  add(P('Analysis'), analysis.join('\n\n') || P('[This is where the positions of the authors are compared: there are not enough comparisons on the topic yet.]'));

  // Discussion: the answers that are already recorded
  if (asked.length) add(P('Discussion'), asked.map((q) => `**${plainTitle(q)}** ${lead(q, 700, answerOf(q))}`).join('\n\n'));

  // Conclusion
  const kp = concepts.slice(0, 5).map((c) => `- **${plainTitle(c)}:** ${firstSentence(lead(c, 400))}`);
  add(P('Conclusion'), (kp.length ? `${P('The main lines that emerge:')}\n\n${kp.join('\n')}\n\n` : '') + P('The conclusions are limited by the texts reviewed. They are a starting point for reading and further checking, not a full survey of the literature.'));

  // The citations are converted; then it is known what the article stands on
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

/**
 * Quick drafts for the other kinds of text. Each one is a skeleton built only from library pages, with the same
 * cited claims as the article draft; whatever the library cannot supply is left as a "[Fill in: ...]" mark for the author.
 */
function buildOther(genre, topic, { pages, scored, topics, concepts, people, comps, asked, texts }) {
  const citer = makeCiter(pages), warnings = [];
  const [q1, q2] = [P("“"), P("”")];
  const fill = (what) => P("[Fill in: {0}]", [what]);
  const sec = (h, body) => (String(body).trim() ? `## ${h}\n\n${String(body).trim()}` : "");
  const sub = (p, max = 900) => `### ${plainTitle(p)}\n\n${lead(p, max)}`;
  const hub = topics[0] || concepts[0] || texts[0];
  const contra = [...concepts, ...topics, ...comps].map((p) => ({ p, t: contradictions(p) })).filter((x) => x.t).slice(0, 3);
  const contraText = contra.map((x) => `${P("On")} ${q1}${plainTitle(x.p)}${q2}: ${x.t.replace(/^[-*+]\s*/gm, "").replace(/\n+/g, " ").slice(0, 700)}`).join("\n\n");
  const parts = [];

  if (genre === "essay") {
    // Introduction, thesis, antithesis, conclusion: the shortest classical shape of an essay
    parts.push(sec(P("Introduction"), `${hub ? lead(hub, 700) : ""}\n\n${P("The question of this essay: what can be claimed about {0}, and what can be said against it?", [`${q1}${titleOf(topic)}${q2}`])}`));
    parts.push(sec(P("Thesis"), concepts.length ? concepts.slice(0, 2).map((c) => lead(c, 700)).join("\n\n") : (comps[0] ? lead(comps[0], 800) : fill(P("state your thesis in one or two sentences")))));
    const anti = [contraText, ...comps.slice(0, 2).map((c) => lead(c, 700))].filter(Boolean).join("\n\n");
    if (!anti) warnings.push($t("The library has no contradictions or comparisons on the topic, so the antithesis is left for you to write."));
    parts.push(sec(P("Antithesis"), anti || fill(P("the strongest objection to the thesis, with its source"))));
    const kp = concepts.slice(0, 3).map((c) => `- **${plainTitle(c)}:** ${firstSentence(lead(c, 400))}`);
    parts.push(sec(P("Conclusion"), `${kp.length ? `${P("Where the two positions meet:")}\n\n${kp.join("\n")}\n\n` : ""}${fill(P("your own position after weighing the thesis and the antithesis"))}`));
  } else if (genre === "popular") {
    parts.push(hub ? `${lead(hub, 600)}` : fill(P("an opening question or scene that draws the reader in")));
    for (const c of concepts.slice(0, 5)) parts.push(`## ${plainTitle(c)}\n\n${lead(c, 700)}`);
    if (people.length) parts.push(sec(P("Who stands behind the ideas"), people.map((e) => `**${plainTitle(e)}.** ${lead(e, 350)}`).join("\n\n")));
    parts.push(sec(P("What this means for you"), fill(P("one practical consequence for the reader, in plain words"))));
  } else if (genre === "review") {
    parts.push(sec(P("Introduction"), `${hub ? lead(hub, 700) : ""}\n\n${P("This review asks what the available texts say about {0}.", [`${q1}${titleOf(topic)}${q2}`])}`));
    const n = new Set(texts.map((t) => t.slug)).size;
    parts.push(sec(P("Method"), P("The review covers {0} texts from the library that are closest to the topic. They are grouped by theme below.", [n])));
    for (const c of concepts.slice(0, 5)) parts.push(`## ${plainTitle(c)}\n\n${lead(c, 900)}`);
    for (const c of comps.slice(0, 2)) parts.push(`## ${plainTitle(c)}\n\n${lead(c, 900)}`);
    if (contraText) parts.push(sec(P("Differences and contradictions"), contraText));
    const rows = texts.filter((t) => t.data.type === "source").slice(0, 8).map((t) => `| ${[].concat(t.data.authors || []).map(String).join("; ") || plainTitle(t)} | ${firstSentence(t.data.emphasis || lead(t, 300)).replace(/\|/g, "/")} | [[${t.slug}]] |`);
    if (rows.length) parts.push(sec(P("Summary of the positions"), `| ${P("Author")} | ${P("Main claim")} | ${P("Citation")} |\n|---|---|---|\n${rows.join("\n")}`));
    parts.push(sec(P("Gaps and directions"), fill(P("what the reviewed texts do not cover and what is worth reading next"))));
    parts.push(sec(P("Conclusion"), fill(P("the overall picture that the texts give"))));
  } else {
    // story: an outline of ideas to write the story from; nothing is cited in the text
    // one prose sentence per page, keeping its citation so that the sources still reach "Based on"
    const idea = (p) => {
      const para = stripSections(p.content).replace(SEE, '').split(/\n[ \t]*\n/).map((x) => x.trim()).find((x) => x && !/^(#|\||>|```|[-*+]\s)/.test(x) && !/\n\s*[-*+]\s/.test(x)) || '';
      return (para.replace(/\s+/g, ' ').match(/^.*?[.!?](?=\s+[А-ЯA-Z„"]|$)/)?.[0] || para).slice(0, 300);
    };
    const ideas = concepts.slice(0, 3).map(idea).filter(Boolean);
    const cast = people.slice(0, 3).map((e) => idea(e) && `**${plainTitle(e)}:** ${idea(e)}`).filter(Boolean);
    const line = (h, hint, idea) => `## ${h}\n\n${idea ? `${idea}\n\n` : ""}${fill(hint)}`;
    parts.push(line(P("Setting"), P("where and when the story takes place, with two concrete details"), hub ? idea(hub) : ""));
    parts.push(line(P("Characters"), P("who they are, what each of them wants"), cast.join("\n\n")));
    parts.push(line(P("Conflict"), P("what stands between the character and what they want"), ideas[0] || ""));
    parts.push(line(P("Turning point"), P("the scene where something changes"), ideas[1] || ""));
    parts.push(line(P("Ending"), P("how the story closes, what the character understands"), ideas[2] || ""));
    warnings.push($t("The quick draft for a story is only an outline of ideas from the library. Write the scenes yourself, or choose a {ai} level to have them written."));
  }

  const body = parts.filter(Boolean).join("\n\n");
  const text = noDash(citer.convert(body, { inline: genre !== "story" }));
  if (genre !== "story" && citer.cited.size < 2) warnings.push($t("The text relies on few sources. Add more books and articles on the topic and run the Synthesis."));
  if (citer.missing.size) warnings.push($t("Citations to non-existent pages were skipped: {0}.", [[...citer.missing].join(", ")]));
  const md = [`# ${titleOf(topic)}`, text, bibSection(citer, genre)].join("\n\n");
  return { markdown: md, cited: citer.citedList(), warnings };
}

function bibSection(citer, genre = 'article') {
  const b = citer.bibliography();
  return `## ${bibTitle(genre)}\n\n${b.length ? b.join('\n\n') : P('[No sources cited.]')}`;
}

/**
 * Splits the text into the main part, the bibliography (or "Based on") and everything after it.
 * The entries of the bibliography are the paragraphs under the heading up to the next ## heading.
 */
export function splitBib(text) {
  const m = String(text).match(BIB_LINE());
  if (!m) return { main: String(text).replace(/\s+$/, ''), entries: [], head: null, tail: '' };
  const rest = text.slice(m.index + m[0].length), next = rest.search(/^##\s/m);
  const bib = next < 0 ? rest : rest.slice(0, next);
  const entries = bib.trim().split(/\n[ \t]*\n/).map((s) => s.trim()).filter((s) => s && !Pall('[No sources cited.]').includes(s));
  return { main: text.slice(0, m.index).replace(/\s+$/, ''), entries, head: m[0].replace(/^##[ \t]*/, '').trim(), tail: next < 0 ? '' : rest.slice(next).trim() };
}
const letters = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');
/** Puts the text together again: the old entries stay, the newly cited ones are added. Without citations an empty section is not added. */
export function joinBib({ main, entries, head, tail }, citer, genre) {
  const all = [...new Set([...entries, ...citer.bibliography()])].sort((a, b) => letters(a).localeCompare(letters(b), contentLang()));
  const bib = all.length || head ? `\n\n## ${head || bibTitle(genre)}\n\n${all.length ? all.join('\n\n') : P('[No sources cited.]')}` : '';
  return `${main}${bib}${tail ? `\n\n${tail}` : ''}\n`;
}

// ---------- Claude ----------
const DEPTH = lazy(() => ({
  light: P('Work quickly: rely on index.md and the most important pages; open only what is necessary.'),
  medium: P('Read the main concepts, the comparisons and the chapters where the claims stand before you write.'),
  strong: P('Work thoroughly: read all relevant pages, follow the citations to the chapters, check the key claims in the original text (raw/.extracted/, markers <!-- стр. N -->) and describe the contradictions between the authors.'),
}));

/**
 * For a model without tools: the pages closest to the topic (by the search), each with [[slug]] above it.
 * The sources and chapters come first, because only they are cited by the article; the concepts give the frame.
 */
const PAGES_PER_LEVEL = { light: 6, medium: 12, strong: 20 };
function materialOf(ranked, budget, level) {
  const list = [...(ranked || [])];
  const order = (p) => (SRC_TYPES.has(p.data.type) ? 0 : ['concept', 'comparison', 'topic'].includes(p.data.type) ? 1 : 2);
  const chosen = list.sort((a, b) => order(a) - order(b)).slice(0, PAGES_PER_LEVEL[level] || 12);
  if (!chosen.length) return P('(no pages found for this topic)');
  const share = Math.max(300, Math.floor(budget / chosen.length));
  return chosen.map((p) => `### [[${p.slug}]] (${p.data.type}) ${p.data.title || p.slug}${p.data.apa ? `\n${P('Reference')}: ${p.data.apa}` : ''}\n${clipTokens(p.content, share)}`).join('\n\n');
}

const STRICT_STRUCTURE = () => P('STRUCTURE (Markdown, exactly these sections):');
const workLines = (text, level, what) => (text
  ? [P('- Use ONLY the pages of the library in MATERIAL below. The identifier (slug) of each page is in [[…]] above it.')]
  : [what === 'new'
    ? P('- Start with wiki/index.md and choose the pages on the topic (concepts, entities, topics, comparisons, questions, sources, sources/chapters). The identifier (slug) of a page is the file name without .md.')
    : P('- Start with wiki/index.md and read the pages needed for the new text. The identifier (slug) of a page is the file name without .md.'),
  `- ${DEPTH[(PATH_LEVELS[level] || PATH_LEVELS.medium).depth]}`]);
const materialLines = (material, hints) => (material != null
  ? [P('MATERIAL (pages of the library):'), material]
  : [P('HINTS from a rough word-based searcher (they may be incomplete, check them):'), hints || P('(none)')]);

function claudePrompt({ topic, genre, creativity, level, length, voice, hints, material }) {
  const G = GENRE[genre], L = LENGTHS[length] || LENGTHS.medium, text = material != null;
  return [
    G.role,
    '',
    P('TOPIC: {0}', [topic]),
    P('LENGTH: about {0} words (without the bibliography).', [L.words]),
    voiceNote(voice),
    '',
    P('HOW TO WORK'),
    ...workLines(text, level, 'new'),
    ...groundRules(genre),
    '',
    creativeNote(creativity, genre),
    '',
    G.strict ? STRICT_STRUCTURE() : P('STRUCTURE (Markdown):'),
    ...G.structure,
    citesInText(genre) ? P('The bibliography is NOT written: it is added automatically from the citations.') : null,
    '',
    G.style,
    '',
    ...materialLines(material, hints),
    '',
    P('Return only the Markdown of the text, with no explanations before or after it.'),
  ].filter((x) => x != null).join('\n');
}

export async function writeWithClaude({ topic, genre, creativity, level, length, voice, hints, ranked, pages, signal }) {
  genre = genreOf(genre); creativity = creativityOf(creativity, genre);
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  const out = Math.min(16000, Math.round((LENGTHS[length] || LENGTHS.medium).words * 2.6) + 800);
  const args = { topic, genre, creativity, level, length, voice };
  const r = await askAI({
    level, agentPrompt: claudePrompt({ ...args, hints }), maxTokens: out, label: $t('Writing with {ai}'),
    textPrompt: (budget) => claudePrompt({ ...args, material: materialOf(ranked, budget - 1500, level) }),
    temperature: temperatureOf(creativity), system: WRITER_SYSTEM(),
    maxTurns: L.maxTurns + 12, timeoutMs: Math.round(L.timeoutMs * 1.6), signal,
  });
  if (!r.ok) return r;
  const md = cleanAnswer(r.text);
  if (!/^#\s/m.test(md) || words(md) < 120) return { ok: false, kind: 'format', error: $t('{ai} did not return a text. Try again or with a more powerful level.'), detail: md.slice(0, 400) };
  const citer = makeCiter(pages), warnings = [];
  const body = finishText(md, citer, genre);
  if (!citesInText(genre)) { if (!citer.cited.size) warnings.push($t('The story does not name the sources it draws on. Check whether the library covers the topic.')); }
  else if (citer.cited.size < 2) warnings.push($t('The article cites few sources. Check whether the library covers the topic, or try a more powerful level.'));
  if (citer.missing.size) warnings.push($t('{ai} cited non-existent pages ({0}): the citations were removed.', [[...citer.missing].join(', ')]));
  if (citesInText(genre) && /library|wiki|knowledge base|collection|библиотек|база знания|колекци/i.test(body)) warnings.push($t('The text mentions the library or the wiki. Check and rewrite those sentences.'));
  const target = (LENGTHS[length] || LENGTHS.medium).words, n = words(body);
  if (n < target * 0.6) warnings.push($t('The text is shorter than requested ({0} of about {1} words).', [n, target]));
  return { ok: true, markdown: `${body}\n\n${bibSection(citer, genre)}`, cited: citer.citedList(), warnings, genre, creativity };
}

// ---------- Continuing and paragraph work in a saved text ----------
const workRole = (genre) => [
  P('You are working on a text in English based on the author\'s materials (the wiki/ folder in the current directory). This is your working environment, not the topic of the text.'),
  P('KIND OF TEXT: {0}.', [GENRE[genre].name]),
];
/** The common part of the instructions for continuing and for a paragraph: grounding, citations, creativity, style */
const workRules = ({ genre, creativity, level, text }) => [
  P('HOW TO WORK'),
  ...workLines(text, level, 'part'),
  P('- Follow the tone, the terminology and the way of citing of the text so far. Do not repeat or contradict what is said; if something connects with it, build on it.'),
  P('- Keep the citations that are already in the text exactly as they are.'),
  ...groundRules(genre, true),
  '',
  creativeNote(creativity, genre),
  '',
  GENRE[genre].style,
];

function continuePrompt({ title, body, instruction, words: n, genre, creativity, level, voice, hints, material }) {
  const text = material != null;
  return [
    ...workRole(genre),
    '',
    P('THE TEXT SO FAR “{0}” (do not return it, only continue it):', [title]),
    '<<<', body.slice(0, 60000), '>>>',
    '',
    P('TASK: write a NEW text that is added to the end of the text. {0}', [instruction ? P('What the author wants: {0}', [instruction]) : P('The author gave no direction: add the most valuable thing that is missing (missed concepts, authors, comparisons), without repeating what is written.')]),
    P('LENGTH: about {0} words.', [n]),
    voiceNote(voice),
    '',
    ...workRules({ genre, creativity, level, text }),
    P('- Do not include the title of the text, an abstract, a conclusion or a bibliography.'),
    citesInText(genre) ? P('- If you write new sections, start them with ## (subsections with ###); if you only continue a thought, return plain paragraphs without a heading.') : null,
    '',
    ...materialLines(material, hints),
    '',
    P('Return only the Markdown of the new text, with no explanations before or after it.'),
  ].filter((x) => x != null).join('\n');
}

/**
 * Continues the text with Claude. Writes nothing: returns the new body (for review and saving by the person).
 * In a scientific article the new text goes before "Conclusion" (if there is one), otherwise before the bibliography, otherwise at the end.
 * The bibliography is extended with the newly cited sources, and the entries already written are kept.
 */
export async function continueWithClaude({ body, title, instruction, genre, creativity, level, voice, words: n = 600, hints, ranked, pages, signal }) {
  genre = genreOf(genre); creativity = creativityOf(creativity, genre);
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  const text = String(body ?? '');
  if (!text.trim()) return { ok: false, kind: 'empty', error: $t('The article is empty.') };
  const ins = String(instruction || '').trim();
  const args = { title, instruction: ins, words: n, genre, creativity, level, voice };
  const r = await askAI({
    level, agentPrompt: continuePrompt({ ...args, body: text, hints }), maxTokens: Math.round(n * 2.6) + 600, label: $t('Continue with {ai}'),
    // without tools: the text (cut if long) plus the pages on the topic, within the context
    textPrompt: (budget) => continuePrompt({ ...args, body: clipTokens(text, Math.floor(budget * 0.4)), material: materialOf(ranked, Math.floor(budget * 0.55), level) }),
    temperature: temperatureOf(creativity), system: WRITER_SYSTEM(),
    maxTurns: L.maxTurns + 12, timeoutMs: Math.round(L.timeoutMs * 1.4), signal,
  });
  if (!r.ok) return r;
  let add = cleanAnswer(r.text).replace(/^#\s+.*\n+/, '');
  const citer = makeCiter(pages), warnings = [];
  add = finishText(add, citer, genre);
  if (words(add) < 40) return { ok: false, kind: 'format', error: $t('{ai} did not return a usable new text. Try again, with another direction or with a more powerful level.'), detail: add.slice(0, 400) };
  if (citer.missing.size) warnings.push($t('{ai} cited non-existent pages ({0}): the citations were removed.', [[...citer.missing].join(', ')]));
  if (citesInText(genre) && /library|wiki|knowledge base|collection|библиотек|база знания|колекци/i.test(add)) warnings.push($t('The new text mentions the library or the wiki. Check and rewrite those sentences.'));

  const parts = splitBib(text);
  const concl = parts.main.match(new RegExp(`^##[ \\t]*${anyP('Conclusion')}[ \\t]*$`, 'im'));
  parts.main = concl ? `${parts.main.slice(0, concl.index).replace(/\s+$/, '')}\n\n${add}\n\n${parts.main.slice(concl.index)}` : `${parts.main}\n\n${add}`;
  return {
    ok: true, markdown: joinBib(parts, citer, genre), added: words(add),
    placed: concl ? P('before the Conclusion') : P('at the end of the text'), cited: citer.citedList(), warnings,
  };
}

// ---------- One paragraph: rewriting or a new paragraph at the chosen place ----------
const MARK = lazy(() => ({
  start: `⟦${P('START OF THE PASSAGE TO REWRITE')}⟧`, end: `⟦${P('END OF THE PASSAGE')}⟧`, here: `⟦${P('INSERT THE NEW TEXT HERE')}⟧`,
}));
const tailOf = (s, tokens) => { const t = String(s); let n = t.length; while (n > 0 && approxTokens(t.slice(t.length - n)) > tokens) n = Math.floor(n * 0.8); return t.slice(t.length - n); };

function blockPrompt({ title, before, target, after, action, instruction, words: n, genre, creativity, level, voice, hints, material }) {
  const text = material != null, rewrite = action === 'rewrite';
  const place = rewrite ? `${MARK.start}\n${target}\n${MARK.end}` : MARK.here;
  return [
    ...workRole(genre),
    '',
    P('THE TEXT “{0}” (the place you work on is marked with ⟦ ⟧; do not return the rest of the text):', [title]),
    '<<<', `${before}\n\n${place}\n\n${after}`.trim(), '>>>',
    '',
    rewrite
      ? P('TASK: rewrite the marked passage. {0}', [instruction ? P('What the author wants: {0}', [instruction]) : P('The author gave no direction: make it clearer and better connected with the text around it, keeping its meaning and its citations.')])
      : P('TASK: write a NEW passage for the marked place. It must connect naturally with the text before and after it. {0}', [instruction ? P('What the author wants: {0}', [instruction]) : P('The author gave no direction: add what is most needed at this place, without repeating what is written.')]),
    rewrite ? P('LENGTH: about as long as the passage, unless the author asks for something else.') : P('LENGTH: about {0} words.', [n]),
    voiceNote(voice),
    '',
    ...workRules({ genre, creativity, level, text }),
    P('- Return only the new passage: one or more paragraphs, without the title, without a bibliography and without the ⟦ ⟧ markers. A ### subheading only if the author asks for one.'),
    '',
    ...materialLines(material, hints),
    '',
    P('Return only the Markdown of the new passage, with no explanations before or after it.'),
  ].filter((x) => x != null).join('\n');
}

/**
 * Rewrites the paragraph in [start, end) or writes a new paragraph after end (action: rewrite | insert). Writes nothing:
 * returns the new body and where the new text is, for review and saving by the person. The bibliography is extended as when continuing.
 */
export async function blockWithClaude({ body, start, end, action, title, instruction, genre, creativity, level, voice, words: n = 150, hints, ranked, pages, signal }) {
  genre = genreOf(genre); creativity = creativityOf(creativity, genre);
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  const text = String(body ?? ''), rewrite = action === 'rewrite';
  if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end <= text.length)) return { ok: false, kind: 'locate', error: $t('The place in the text was not found. Reload the text and try again.') };
  const bib = text.match(BIB_LINE());
  if (bib && end > bib.index) return { ok: false, kind: 'locate', error: $t('The bibliography is filled in automatically from the citations: edit it by hand.') };
  const target = rewrite ? text.slice(start, end) : '';
  if (rewrite && !target.trim()) return { ok: false, kind: 'empty', error: $t('The passage is empty.') };
  const main = bib ? text.slice(0, bib.index) : text;
  const before = main.slice(0, rewrite ? start : end), after = main.slice(end);
  const ins = String(instruction || '').trim(), size = rewrite ? Math.max(60, words(target)) : n;
  const args = { title, target, action, instruction: ins, words: size, genre, creativity, level, voice };
  const r = await askAI({
    level, maxTokens: Math.round(size * 2.6) + 600, label: rewrite ? $t('Rewrite with {ai}') : $t('New paragraph with {ai}'),
    agentPrompt: blockPrompt({ ...args, before: tailOf(before, 15000), after: clipTokens(after, 5000), hints }),
    textPrompt: (budget) => blockPrompt({ ...args, before: tailOf(before, Math.floor(budget * 0.3)), after: clipTokens(after, Math.floor(budget * 0.1)), material: materialOf(ranked, Math.floor(budget * 0.55), level) }),
    temperature: temperatureOf(creativity), system: WRITER_SYSTEM(),
    maxTurns: L.maxTurns + 6, timeoutMs: L.timeoutMs, signal,
  });
  if (!r.ok) return r;
  let add = cleanAnswer(r.text).replace(/⟦[^⟧\n]*⟧/g, '').replace(/^#\s+.*\n+/, '');
  const citer = makeCiter(pages), warnings = [];
  add = finishText(add, citer, genre).replace(/\n{3,}/g, '\n\n').trim();
  if (words(add) < 5) return { ok: false, kind: 'format', error: $t('{ai} did not return a usable new text. Try again, with another direction or with a more powerful level.'), detail: add.slice(0, 400) };
  if (citer.missing.size) warnings.push($t('{ai} cited non-existent pages ({0}): the citations were removed.', [[...citer.missing].join(', ')]));
  if (citesInText(genre) && /library|wiki|knowledge base|collection|библиотек|база знания|колекци/i.test(add)) warnings.push($t('The new text mentions the library or the wiki. Check and rewrite those sentences.'));

  // The new text in its place; the positions before the bibliography do not move when it is extended
  const sep = end === 0 ? '' : '\n\n'; // at the very beginning of the text (a document without a title) there is no empty line in front
  const next = rewrite ? text.slice(0, start) + add + text.slice(end) : `${text.slice(0, end)}${sep}${add}${end === 0 && text.trim() ? '\n\n' : ''}${text.slice(end)}`;
  const at = rewrite ? start : end + sep.length;
  return { ok: true, markdown: joinBib(splitBib(next), citer, genre), start: at, end: at + add.length, added: words(add), cited: citer.citedList(), warnings };
}

// ---------- Files in drafts/ ----------
const latin = (s) => [...String(s).toLowerCase()].map((c) => (c in CYR ? CYR[c] : c)).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'tekst';
const okId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id));
const fileOf = (id) => path.join(DRAFTS, id + '.md');

// The scope (areas and topics) with which the text was written: kept in the text, so that it can be seen and changed at the next help
const strList = (v, max, len) => [...new Set([].concat(v || []).map((x) => String(x).trim().slice(0, len)).filter(Boolean))].slice(0, max);
const cleanScope = (sc) => ({ areas: strList(sc?.areas, 30, 80), focus: strList(sc?.focus, 60, 120).filter((s) => /^[\p{L}\p{N}._/-]+$/u.test(s)) });
const okSlug = (s) => /^[\p{L}\p{N}._-]{1,160}$/u.test(s);

export function saveDraft({ markdown, topic, level, length, genre, creativity, scope, voice, cited = [], warnings = [] }) {
  fs.mkdirSync(DRAFTS, { recursive: true });
  const title = (markdown.match(/^#\s+(.+)$/m)?.[1] || titleOf(topic)).trim();
  const base = `${today()}-${latin(title)}`;
  let id = base; for (let i = 2; fs.existsSync(fileOf(id)); i++) id = `${base}-${i}`;
  const sc = cleanScope(scope), g = genreOf(genre);
  const data = {
    title, topic: String(topic || '').trim(), type: 'draft', mode: level, genre: g,
    ...(level !== 'local' ? { creativity: creativityOf(creativity, g) } : {}),
    ...(level !== 'local' && level !== 'blank' && length ? { length } : {}),
    ...(sc.areas.length || sc.focus.length ? { scope: sc } : {}),
    ...(voice ? { voice: String(voice).slice(0, 1500) } : {}),
    created: today(), updated: today(), words: words(markdown), cites: cited.map((c) => c.slug),
  };
  fs.writeFileSync(fileOf(id), matter.stringify(markdown.trim() + '\n', data));
  return { id, title, words: data.words, path: `drafts/${id}.md`, cited, warnings };
}

/** A blank document: only a title. The person writes alone and asks for help with paragraphs. */
export function createBlank({ title, genre, scope }) {
  const t = titleOf(String(title || '').replace(/\s+/g, ' ').slice(0, 200)) || P('Untitled text');
  return saveDraft({ markdown: `# ${t}\n`, topic: '', level: 'blank', genre, scope });
}

const dateStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || ''));
function readFile(id) {
  const f = fileOf(id);
  if (!okId(id) || !fs.existsSync(f)) return null;
  const m = matter(fs.readFileSync(f, 'utf8'));
  const d = m.data, genre = genreOf(d.genre);
  return {
    id, path: `drafts/${id}.md`, title: String(d.title || id), topic: String(d.topic || ''), mode: String(d.mode || ''), length: d.length || null,
    genre, creativity: creativityOf(d.creativity, genre), scope: cleanScope(d.scope), voice: typeof d.voice === 'string' ? d.voice : '',
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

/**
 * Saving an edited text. The previous version goes to drafts/.history/<id>/.
 * meta (optional): kind, creativity, scope and cited sources, changed in the editor.
 */
export function updateDraft(id, body, meta = null) {
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
  // A copy: gray-matter keeps the parse in a cache by the text of the file and returns the same object. A change in place would reach
  // every other file with the same text (for example two blank documents with the same title on the same day).
  const data = { ...matter(fs.readFileSync(fileOf(id), 'utf8')).data };
  data.title = (text.match(/^#\s+(.+)$/m)?.[1] || data.title || id).trim();
  data.updated = today(); data.words = words(text);
  if (meta && typeof meta === 'object') {
    if (GENRES.includes(meta.genre)) data.genre = meta.genre;
    if (meta.creativity != null) data.creativity = creativityOf(meta.creativity, data.genre);
    if (meta.scope) { const sc = cleanScope(meta.scope); if (sc.areas.length || sc.focus.length) data.scope = sc; else delete data.scope; }
    if (Array.isArray(meta.cites)) data.cites = strList(meta.cites, 300, 160).filter(okSlug);
  }
  for (const [k, v] of Object.entries(data)) if (v instanceof Date) data[k] = v.toISOString().slice(0, 10);
  fs.writeFileSync(fileOf(id), matter.stringify(text.replace(/\s+$/, '') + '\n', data));
  return { ok: true, title: data.title, words: data.words, updated: data.updated };
}

/** "Delete" = a move to drafts/.trash/, so that nothing is lost for good. */
export function trashDraft(id) {
  if (!readFile(id)) return { ok: false, error: $t('There is no such text.') };
  fs.mkdirSync(TRASH, { recursive: true });
  fs.renameSync(fileOf(id), path.join(TRASH, `${id}-${Date.now()}.md`));
  return { ok: true };
}
