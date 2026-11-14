// Писане с wiki: готов текст върху страниците на библиотеката.
//
// Видове текст (GENRES): научна статия, есе, научно-популярна статия, обзор на литературата и художествен текст.
// Три начина за съставяне:
//  - Бърза чернова: без Claude, подрежда и пренарежда текста на страниците в структура на статия (само научна статия).
//  - Claude (лек, среден, мощен): пише свързан текст, като чете страниците и оригиналите.
//  - Празен документ: човекът пише сам и иска помощ по абзаци (пренаписване, вмъкване) или дописване.
// Креативността (1 до 5) сменя стила и тълкуването, не фактите: те и цитатите са винаги само от библиотеката.
// При модел без инструменти тя е и температурата на заявката; Claude Code няма такава настройка и я получава като указание.
// Цитатите от wiki ([[глава]], с. N) се превръщат автоматично в APA 7 в текста, а библиографията
// се събира САМО от реално цитираните източници (по полето apa на source страниците). Така Claude не може да добави
// литература, която я няма в библиотеката. Художественият текст няма цитати в самия текст: източниците му са в „По мотиви от“.
//
// Готовите текстове се пазят като .md файлове в drafts/ (извън wiki/, за да не се бъркат с него),
// с предишните версии в drafts/.history/ при всеки запис.
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

// ---------- Видове текст и креативност ----------
export const GENRES = ['article', 'essay', 'popular', 'review', 'story'];
export const genreOf = (g) => (GENRES.includes(g) ? g : 'article');
/** Креативност по подразбиране за всеки вид: обзорът е най-строг, разказът най-свободен */
export const CREATIVITY_DEFAULT = { article: 2, essay: 3, popular: 3, review: 1, story: 4 };
export function creativityOf(c, genre) {
  const n = Math.round(Number(c));
  return n >= 1 && n <= 5 ? n : CREATIVITY_DEFAULT[genreOf(genre)];
}
const TEMPERATURE = [0.2, 0.4, 0.7, 0.9, 1];
export const temperatureOf = (c) => TEMPERATURE[c - 1] ?? 0.4;
const citesInText = (genre) => genre !== 'story';
/** Името на вида текст на езика на съдържанието („научна статия“ и т.н.), за заявките в review.js */
export const genreName = (g) => GENRE[genreOf(g)].name;
const bibTitle = (genre) => (citesInText(genre) ? P('Bibliography') : P('Based on'));
// Заглавието на библиографията на всеки език и при всеки вид; моделите понякога пишат и „References“
const BIB_HEADS = () => `(?:${anyP('Bibliography')}|${anyP('Based on')}|${anyP('References')})`;
const BIB_LINE = () => new RegExp(`^##[ \\t]*${BIB_HEADS()}[ \\t]*:?[ \\t]*$`, 'im');
/** Същите заглавия като текст: редакторът по тях знае кои абзаци са библиографията (тях ги попълва сървърът) */
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

/** Правилата за опора в библиотеката и за цитиране, според вида текст (part: дописване или абзац, без „заключение“) */
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
/** Отговорът на модела без обвивката ``` и без дълги тирета */
const cleanAnswer = (s) => noDash(s).trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '');

/**
 * Цитатите в новия текст: при научните видове стават APA 7 в текста, а библиографията, ако моделът я е написал,
 * се маха (прави я сървърът). При художествен текст цитатите се записват, но се махат от текста, а списъкът
 * „По мотиви от“ на модела се маха след това.
 */
function finishText(md, citer, genre) {
  return citesInText(genre) ? citer.convert(cutBib(md)) : cutBib(citer.convert(md, { inline: false }));
}

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

  // inline: false (художествен текст): източниците се записват за списъка накрая, но в текста не остават цитати
  function convert(text, { inline = true } = {}) {
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
      return parts.length && inline ? `${sp}(${parts.join('; ')})` : '';
    });
    // 2) в текста: [[x]], с. N → Автор (1974, с. N); [[x]] → Автор (1974) или заглавие
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

function bibSection(citer, genre = 'article') {
  const b = citer.bibliography();
  return `## ${bibTitle(genre)}\n\n${b.length ? b.join('\n\n') : P('[No sources cited.]')}`;
}

/**
 * Разделя текста на основна част, библиография (или „По мотиви от“) и всичко след нея.
 * Записите в библиографията са абзаците под заглавието до следващото ## заглавие.
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
/** Сглобява текста отново: старите записи остават, новоцитираните се добавят. Без цитати не се добавя празен раздел. */
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
 * За модел без инструменти: най-близките до темата страници (по търсачката), всяка с [[slug]] над нея.
 * Източниците и главите идват първи, защото само тях статията цитира; понятията дават рамката.
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

// ---------- Дописване и работа по абзаци в записан текст ----------
const workRole = (genre) => [
  P('You are working on a text in English based on the author\'s materials (the wiki/ folder in the current directory). This is your working environment, not the topic of the text.'),
  P('KIND OF TEXT: {0}.', [GENRE[genre].name]),
];
/** Общата част на указанията за дописване и за абзац: опора, цитати, креативност, стил */
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
 * Дописва текста с Claude. Не записва нищо: връща новото тяло (за преглед и запис от човека).
 * В научна статия новият текст влиза преди „Заключение“ (ако има), иначе преди библиографията, иначе накрая.
 * Библиографията се допълва с новоцитираните източници, като вече написаните записи се пазят.
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
    // без инструменти: текстът (отрязан, ако е дълъг) плюс страниците по темата, в рамките на контекста
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

// ---------- Един абзац: пренаписване или нов абзац на избрано място ----------
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
 * Пренаписва абзаца в [start, end) или пише нов абзац след end (action: rewrite | insert). Не записва нищо:
 * връща новото тяло и къде е новият текст, за преглед и запис от човека. Библиографията се допълва както при дописване.
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

  // Новият текст на мястото си; позициите преди библиографията не се местят при допълването ѝ
  const sep = end === 0 ? '' : '\n\n'; // в самото начало на текста (документ без заглавие) няма празен ред отпред
  const next = rewrite ? text.slice(0, start) + add + text.slice(end) : `${text.slice(0, end)}${sep}${add}${end === 0 && text.trim() ? '\n\n' : ''}${text.slice(end)}`;
  const at = rewrite ? start : end + sep.length;
  return { ok: true, markdown: joinBib(splitBib(next), citer, genre), start: at, end: at + add.length, added: words(add), cited: citer.citedList(), warnings };
}

// ---------- Файлове в drafts/ ----------
const latin = (s) => [...String(s).toLowerCase()].map((c) => (c in CYR ? CYR[c] : c)).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'tekst';
const okId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id));
const fileOf = (id) => path.join(DRAFTS, id + '.md');

// Обхватът (области и теми), с който е писан текстът: пази се в текста, за да се вижда и сменя при следваща помощ
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

/** Празен документ: само заглавие. Човекът пише сам и иска помощ по абзаци. */
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
 * Запис на редактиран текст. Предишната версия отива в drafts/.history/<id>/.
 * meta (по желание): вид, креативност, обхват и цитирани източници, сменени в редактора.
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
  // Копие: gray-matter пази разбора в кеш по текста на файла и връща същия обект. Промяна на място би стигнала
  // до всеки друг файл със същия текст (напр. два празни документа със същото заглавие от един ден).
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

/** „Изтриване“ = преместване в drafts/.trash/, за да не се губи нищо безвъзвратно. */
export function trashDraft(id) {
  if (!readFile(id)) return { ok: false, error: $t('There is no such text.') };
  fs.mkdirSync(TRASH, { recursive: true });
  fs.renameSync(fileOf(id), path.join(TRASH, `${id}-${Date.now()}.md`));
  return { ok: true };
}
