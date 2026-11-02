// Обединява няколко отделно обработени source страници (напр. качени като отделни глави на една книга)
// в стандартния book+chapters модел: нова source страница (книгата) + по една chapter страница на всеки избран източник.
//   npm run merge-sources -- "Заглавие на книгата" <slug1> <slug2> [...]            → преглед (нищо не се пипа)
//   npm run merge-sources -- "Заглавие на книгата" <slug1> <slug2> [...] --apply
// Редът на слъговете е редът на главите. Нищо не се губи: страниците на оригиналните източници
// отиват в архив (outputs/merged/), а raw_path на всеки от тях остава в съответната глава
// (изключение от общото правило "само книгата има raw_path": тук всяка глава идва от отделен суров файл).
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';
import { ROOT, OUTPUTS, WIKI, rel, today, wikiPages, extractLinks, slugify } from './lib.js';
import { buildIndex } from './index.js';
import { $t } from './i18n.js';
import { V, P } from './vocab.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pad2 = (n) => String(n).padStart(2, '0');

function relink(text, drop, keep) {
  const re = new RegExp(`\\[\\[\\s*(?:[^\\]|#]*/)?${esc(drop)}\\s*(#[^\\]|]*)?(\\|[^\\]]*)?\\]\\]`, 'g');
  let n = 0;
  const out = text.replace(re, (_, h, l) => { n++; return `[[${keep}${h || ''}${l || ''}]]`; });
  return { text: out, n };
}

const list = (x) => [].concat(x || []).map(String).filter(Boolean);
const dedupe = (arr) => [...new Map(arr.map((v) => [v.toLowerCase(), v])).values()];

/** Какво ще се направи (нищо не се записва). */
export function planMergeBook(title, orderedSlugs, pages = wikiPages()) {
  title = String(title || '').trim();
  orderedSlugs = [...new Set((orderedSlugs || []).map(String).filter(Boolean))];
  if (!title) return { ok: false, error: $t('A book title is required.') };
  if (orderedSlugs.length < 2) return { ok: false, error: $t('Choose at least two sources.') };

  const originals = [];
  for (const slug of orderedSlugs) {
    const p = pages.find((x) => x.slug === slug);
    if (!p) return { ok: false, error: $t('I cannot find the page “{0}”.', [slug]) };
    if (p.data.type !== 'source') return { ok: false, error: $t('“{0}” is not a source (source).', [p.data.title || slug]) };
    if (pages.some((c) => c.data.type === 'chapter' && extractLinks(String(c.data.book || '')).includes(slug)))
      return { ok: false, error: $t('“{0}” already has its own chapters; it cannot become a chapter of another book.', [p.data.title || slug]) };
    originals.push(p);
  }

  const bookSlug = slugify(title);
  if (!bookSlug) return { ok: false, error: $t('The title does not give a valid file name.') };
  if (pages.some((p) => p.slug === bookSlug)) return { ok: false, error: $t('A page “{0}” already exists. Choose another title.', [bookSlug]) };
  const chapterSlugs = originals.map((_, i) => `${bookSlug}-ch${pad2(i + 1)}`);
  const clash = chapterSlugs.find((s) => pages.some((p) => p.slug === s));
  if (clash) return { ok: false, error: $t('A page “{0}” already exists.', [clash]) };

  return {
    ok: true, bookSlug, title,
    chapters: originals.map((p, i) => ({
      oldSlug: p.slug, newSlug: chapterSlugs[i], title: String(p.data.title || p.slug),
      rawPath: p.data.raw_path || null,
    })),
  };
}

/** Прилага обединяването. Връща същия отчет плюс архива и пренасочените връзки. */
export function applyMergeBook(title, orderedSlugs) {
  const pages = wikiPages();
  const plan = planMergeBook(title, orderedSlugs, pages);
  if (!plan.ok) return plan;

  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const originals = plan.chapters.map((c) => bySlug.get(c.oldSlug));
  const bookSlug = plan.bookSlug;
  const mapping = plan.chapters.map((c) => [c.oldSlug, c.newSlug]);
  const oldSlugs = new Set(mapping.map(([o]) => o));
  const internal = new Set([bookSlug, ...oldSlugs, ...plan.chapters.map((c) => c.newSlug)]);
  const notInternal = (link) => !extractLinks(link).some((l) => internal.has(l));

  // 1. архив на оригиналните страници
  const archive = path.join(OUTPUTS, 'merged', `${bookSlug}-${today()}`);
  fs.mkdirSync(archive, { recursive: true });
  for (const p of originals) fs.copyFileSync(p.file, path.join(archive, path.basename(p.file)));

  // 2. нови страници на главите
  const chaptersDir = path.join(WIKI, 'sources', 'chapters');
  fs.mkdirSync(chaptersDir, { recursive: true });
  const collectedTags = [], collectedAuthors = [], collectedSources = [], collectedRelated = [], areas = [];
  let earliestCreated = today(), firstApa = '', firstStatus = '', firstYear = null;

  originals.forEach((p, i) => {
    const d = p.data, n = i + 1, newSlug = plan.chapters[i].newSlug;
    const chapTitle = `${V().chapterAbbr} ${n} ${String(d.title || p.slug)}`;
    const chapterData = {
      title: chapTitle, type: 'chapter', book: `[[${bookSlug}]]`, chapter: n, pages: String(d.pages || ''),
    };
    if (d.raw_path) chapterData.raw_path = d.raw_path;
    if (d.page_offset) chapterData.page_offset = d.page_offset;
    if (d.lang) chapterData.lang = d.lang;
    if (d.original_title) chapterData.original_title = d.original_title;
    chapterData.tags = list(d.tags);
    chapterData.sources = list(d.sources).length ? list(d.sources) : (d.raw_path ? [d.raw_path] : []);
    chapterData.related = list(d.related).filter(notInternal);
    chapterData.created = d.created || today();
    chapterData.updated = today();
    chapterData.confidence = d.confidence || 'medium';

    let body = p.content.replace(/^\s*#\s+.*\n/, `# ${chapTitle}\n`);
    if (!/^\s*#\s/.test(body)) body = `# ${chapTitle}\n\n${body.trimStart()}`;
    fs.writeFileSync(path.join(chaptersDir, `${newSlug}.md`), matter.stringify(body.trimEnd() + '\n', chapterData));

    collectedTags.push(...chapterData.tags);
    collectedAuthors.push(...list(d.authors));
    collectedSources.push(...chapterData.sources);
    collectedRelated.push(...chapterData.related);
    if (d.area) areas.push(String(d.area));
    if (d.created && String(d.created) < earliestCreated) earliestCreated = String(d.created);
    if (!firstApa && d.apa) firstApa = String(d.apa);
    if (!firstStatus && d.status) firstStatus = String(d.status);
    if (!firstYear && d.year) firstYear = d.year;
  });

  // 3. страницата на книгата
  const areaCounts = new Map();
  for (const a of areas) areaCounts.set(a, (areaCounts.get(a) || 0) + 1);
  const topArea = [...areaCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const bookData = {
    title, type: 'source', format: 'book',
    authors: dedupe(collectedAuthors), year: firstYear || '', apa: firstApa || '',
    status: firstStatus || 'to-read', emphasis: '', page_offset: 0, depth: 2,
    tags: dedupe(collectedTags), sources: dedupe(collectedSources),
    related: dedupe(collectedRelated).filter(notInternal),
    created: earliestCreated, updated: today(), confidence: 'low',
  };
  if (topArea) bookData.area = topArea;
  const bookBody = [
    `# ${title}`, '',
    `## ${V().chapters}`, ...plan.chapters.map((c) => `- [[${c.newSlug}]]`), '',
    `## ${V().bookNote}`,
    P('This book was assembled from {0} separately uploaded files (one chapter per file). Review the APA record, the authors, the year and the emphasis before relying on them.', [originals.length]), '',
    `## ${V().notes}`, V().leftForHuman, '',
  ].join('\n');
  fs.writeFileSync(path.join(WIKI, 'sources', `${bookSlug}.md`), matter.stringify(bookBody, bookData));

  // 4. пренасочване на връзките във всички останали страници (вкл. новите, в случай на кръстосани цитати)
  const touched = [];
  for (const p of wikiPages()) {
    if (internal.has(p.slug)) continue;
    let text = fs.readFileSync(p.file, 'utf8'), n = 0;
    for (const [oldSlug, newSlug] of mapping) { const r = relink(text, oldSlug, newSlug); text = r.text; n += r.n; }
    if (n) { fs.writeFileSync(p.file, text); touched.push({ slug: p.slug, rel: p.rel, links: n }); }
  }

  // 5. изтриване на оригиналните страници
  for (const p of originals) fs.rmSync(p.file, { force: true });

  // 6. преизграждане на index.md (старите източници излизат, книгата влиза автоматично)
  const idx = buildIndex();
  fs.writeFileSync(idx.file, idx.text);

  // 7. запис в дневника
  fs.appendFileSync(path.join(WIKI, 'log.md'),
    `\n## ${today()} refactor: ${P('Merged {0} sources into a book', [originals.length])} “${title}”\n`
    + `- ${P('New')}: [[${bookSlug}]] ${P('with chapters')} ${plan.chapters.map((c) => `[[${c.newSlug}]]`).join(', ')}\n`
    + `- ${P('Separate sources removed')}: ${[...oldSlugs].join(', ')} (${P('archive')}: \`${rel(archive)}\`)\n`
    + `- ${P('Links redirected in')} ${touched.length} ${touched.length === 1 ? P('page') : P('pages')}\n`
    + `- ${P('Note: review the APA record, the authors and the year of the new book.')}\n`);

  return { ...plan, archive: rel(archive), touched };
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  if (args.length < 3) {
    console.log($t('Usage: npm run merge-sources -- "Book title" <slug1> <slug2> [...] [--apply]'));
    process.exit(args.length ? 1 : 0);
  }
  const [title, ...slugs] = args;
  const r = apply ? applyMergeBook(title, slugs) : planMergeBook(title, slugs);
  if (!r.ok) { console.error('✖ ' + r.error); process.exit(1); }
  console.log(`${apply ? $t('Created') : $t('Will be created')}: “${r.title}” (${r.bookSlug})`);
  r.chapters.forEach((c, i) => console.log($t('  Ch. {0}: {1} → {2}', [i + 1, c.oldSlug, c.newSlug])));
  if (apply) console.log($t('\nArchive: {0}. Redirected links: {1}.', [r.archive, r.touched.length]));
  else console.log($t('\nNothing was changed. To apply, add --apply.'));
}
