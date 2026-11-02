// Механичен lint на wiki. Смисловата проверка (противоречия, остарели твърдения) прави агентът.
// npm run lint        → пълен отчет в outputs/lint-mech-YYYY-MM-DD.md
// npm run lint:quick  → само счупени връзки, в конзолата; exit 1 ако има
import fs from 'node:fs';
import path from 'node:path';
import { OUTPUTS, ROOT, rel, rawFiles, today, wikiPages, extractLinks, ingestState, normRaw } from './lib.js';
import { $t } from './i18n.js';

const quick = process.argv.includes('--quick');
const pages = wikiPages();
const state = ingestState(pages);
const bySlug = new Map();
const dupSlugs = [];
for (const p of pages) {
  if (bySlug.has(p.slug)) dupSlugs.push(`${p.slug}: ${bySlug.get(p.slug).rel}, ${p.rel}`);
  bySlug.set(p.slug, p);
}

const incoming = new Map(pages.map((p) => [p.slug, new Set()]));
const broken = []; // [от, към]
const missingCount = new Map();
for (const p of pages) {
  const links = [...extractLinks(p.content), ...((p.data.related || []).flatMap((r) => extractLinks(String(r))))];
  for (const l of new Set(links)) {
    if (bySlug.has(l)) { if (l !== p.slug) incoming.get(l).add(p.slug); }
    else { broken.push([p.rel, l]); missingCount.set(l, (missingCount.get(l) || 0) + 1); }
  }
}

const PLACEHOLDER = /^(\.\.\.|source-slug|slug|понятие(-\d)?|друг-източник)$/;
const label = (l) => (PLACEHOLDER.test(l) ? `[[${l}]] ${$t('(unfilled template)')}` : `[[${l}]]`);

if (quick) {
  if (!broken.length) { console.log($t('✔ No broken links.')); process.exit(0); }
  console.log($t('✖ Broken links:'));
  broken.forEach(([f, l]) => console.log(`  ${f} → ${label(l)}`));
  process.exit(1);
}

const SPECIAL = new Set(['index', 'log', 'overview']);
const REQUIRED = ['title', 'type', 'created', 'updated'];
const TYPES = new Set(['source', 'chapter', 'concept', 'entity', 'topic', 'comparison', 'question']);

const orphans = pages.filter((p) => !SPECIAL.has(p.slug) && incoming.get(p.slug).size === 0);
const indexPage = bySlug.get('index');
const inIndex = new Set(indexPage ? extractLinks(indexPage.content) : []);
// Главите не влизат в индекса: до тях се стига през книгата
const notInIndex = pages.filter((p) => !SPECIAL.has(p.slug) && p.data.type !== 'chapter' && !inIndex.has(p.slug));

const fmProblems = [];
for (const p of pages) {
  if (p.fmError) { fmProblems.push($t('{0}: invalid YAML ({1})', [p.rel, p.fmError.split('\n')[0]])); continue; }
  const miss = REQUIRED.filter((k) => !p.data[k]);
  if (miss.length) fmProblems.push($t('{0}: missing {1}', [p.rel, miss.join(', ')]));
  if (p.data.type && !TYPES.has(p.data.type)) fmProblems.push($t('{0}: unknown type "{1}"', [p.rel, p.data.type]));
  if (p.data.type === 'source') {
    // Книга, обединена от отделно качени файлове: раw_path-ът е на всяка глава, не на книгата
    const chapterHasRaw = p.data.format === 'book'
      && pages.some((c) => c.data.type === 'chapter' && extractLinks(String(c.data.book || '')).includes(p.slug) && c.data.raw_path);
    if (!p.data.raw_path && !chapterHasRaw) fmProblems.push($t('{0}: source without raw_path', [p.rel]));
    if (!p.data.apa) fmProblems.push($t('{0}: missing APA record', [p.rel]));
  }
  if ((p.data.type === 'source' || p.data.type === 'chapter') && p.data.raw_path) {
    if (!state.resolve(p.data.raw_path)) fmProblems.push($t('{0}: raw_path does not exist ({1})', [p.rel, p.data.raw_path]));
    else if (String(p.data.raw_path) !== normRaw(rel(state.resolve(p.data.raw_path)))) fmProblems.push($t('{0}: raw_path is not in canonical form (npm run fix-paths)', [p.rel]));
  }
  if (p.data.type === 'chapter') {
    const book = extractLinks(String(p.data.book || ''))[0];
    if (!book) fmProblems.push($t('{0}: chapter without book', [p.rel]));
    else if (!bySlug.has(book)) fmProblems.push($t('{0}: book points to a book that does not exist [[{1}]]', [p.rel, book]));
  }
  if (/—/.test(p.content)) fmProblems.push($t('{0}: contains an em dash (—)', [p.rel]));
  if (!/^[a-z0-9-]+$/.test(p.slug)) fmProblems.push($t('{0}: the name is not kebab-case Latin', [p.rel]));
}

const pendingRaw = state.pending.map((f) => normRaw(rel(f)));

const lowConf = pages.filter((p) => p.data.confidence === 'low' && !SPECIAL.has(p.slug))
  .sort((a, b) => String(a.data.updated).localeCompare(String(b.data.updated)));

const singleSource = pages.filter((p) => ['concept', 'topic'].includes(p.data.type))
  .filter((p) => new Set(extractLinks(p.content).filter((l) => bySlug.get(l)?.data.type === 'source')).size === 1);

const section = (title, items, empty = $t('none')) =>
  `## ${title} (${items.length})\n\n${items.length ? items.map((i) => `- ${i}`).join('\n') : empty}\n`;

const report = [
  `# ${$t('Mechanical lint')}: ${today()}\n`,
  $t('Pages: {0} · raw files: {1} · unprocessed: {2}', [pages.length, rawFiles().length, pendingRaw.length]) + '\n',
  section($t('Broken links'), broken.map(([f, l]) => `\`${f}\` → ${label(l)}`)),
  section($t('Missing pages (mentioned but not created), by frequency'),
    [...missingCount].filter(([l]) => !PLACEHOLDER.test(l)).sort((a, b) => b[1] - a[1]).map(([l, n]) => $t('[[{0}]]: {1} times', [l, n]))),
  section($t('Orphans (no incoming links)'), orphans.map((p) => `\`${p.rel}\``)),
  section($t('Not in index.md'), notInIndex.map((p) => `\`${p.rel}\` (${p.data.type || '?'})`)),
  section($t('Frontmatter and style problems'), fmProblems),
  section($t('Duplicate names'), dupSlugs),
  section($t('Low confidence (oldest first)'), lowConf.map((p) => $t('`{0}` updated {1}', [p.rel, p.data.updated]))),
  section($t('Concepts and topics with only one source'), singleSource.map((p) => `\`${p.rel}\``)),
  section($t('Unprocessed raw files'), pendingRaw.map((r) => `\`${r}\``)),
  '\n---\n' + $t('Next comes the semantic check by the agent: contradictions, outdated claims, gaps.') + '\n',
].join('\n');

fs.mkdirSync(OUTPUTS, { recursive: true });
const out = path.join(OUTPUTS, `lint-mech-${today()}.md`);
fs.writeFileSync(out, report);
console.log(report);
console.log($t('Saved: {0}', [rel(out)]));
