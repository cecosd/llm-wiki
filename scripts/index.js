// Преизгражда wiki/index.md, log.md и overview.md от страниците в wiki/. Не чете книгите и не харчи от лимита.
//   npm run index                    → и трите файла (старите копия отиват в outputs/backup-*)
//   npm run index -- --only log      → само index, log или overview
//   npm run index -- --dry           → показва какво ще се промени, без да записва
// Описанията от стария индекс се запазват; за страници без описание се взема от самата страница.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureStarter, WIKI, OUTPUTS, today, wikiPages, extractLinks, rel } from './lib.js';
import { $t } from './i18n.js';
import { P } from './vocab.js';

const FORMAT_GROUPS = [
  ['book', P('Books')], ['paper', P('Papers')], ['article', P('Articles')], ['web', P('Web pages')],
  ['dataset', P('Tables and data')], ['note', P('Notes')], ['image', P('Images')],
];
const SECTIONS = [['topic', P('Topics')], ['concept', P('Concepts')], ['entity', P('People and organizations')]];

const plain = (s) => s
  .replace(/\s*\((?:[^()]*\[\[[^()]*|[^()]*(?:с|стр|разд|pp?|sect)\.\s*[\d?][^()]*)\)/g, '') // цитати в скоби
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();

/** Едноредово описание: първото смислено изречение от страницата */
function describe(p) {
  const d = p.data;
  if (d.description) return plain(String(d.description)).slice(0, 160);
  if (d.type === 'source') {
    const who = Array.isArray(d.authors) ? d.authors.join(', ') : d.authors || '';
    const head = [who, d.year ? `(${d.year})` : ''].filter(Boolean).join(' ');
    if (d.emphasis) return `${head ? head + ': ' : ''}${plain(String(d.emphasis))}`.slice(0, 180);
    if (head) return head;
  }
  const body = p.content.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  for (const raw of body) {
    const line = raw.trim();
    if (!line || /^(#|>|\||[-*+]\s|```|---|!\[)/.test(line)) continue;
    const text = plain(line);
    if (text.length < 12) continue;
    const m = text.match(/^(.{20,160}?[.!?])(\s|$)/);
    return (m ? m[1] : text.slice(0, 140)).trim();
  }
  return '';
}

/** Описанията от стария индекс: slug → текст */
function oldDescriptions(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*[-*]\s*\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]\s*[:\-–]\s*(.+)$/);
    if (m) map.set(m[1].trim().split('/').pop(), m[2].trim());
  }
  return map;
}

export function buildIndex() {
  ensureStarter();
  const pages = wikiPages();
  const file = path.join(WIKI, 'index.md');
  const old = oldDescriptions(file);
  const skip = new Set(['index', 'log', 'overview']);
  const items = pages.filter((p) => !skip.has(p.slug) && p.data.type && p.data.type !== 'chapter');
  const line = (p) => {
    const desc = old.get(p.slug) || describe(p);
    return `- [[${p.slug}]]${desc ? ': ' + desc : ''}`;
  };
  const sorted = (list) => [...list].sort((a, b) => String(a.data.title || a.slug).localeCompare(String(b.data.title || b.slug), 'bg'));
  const out = [];
  const created = pages.find((p) => p.slug === 'index')?.data.created || today();
  out.push('---', `title: ${P('Index')}`, 'type: topic', 'tags: [index]', 'sources: []', 'related: []', `created: ${created}`, `updated: ${today()}`, 'confidence: high', '---', '',
    `# ${P('Index')}`, '', P('Catalog of the whole library. The agent reads it first and updates it on every operation.'), '',
    `## ${P('Overview')}`);
  if (pages.some((p) => p.slug === 'overview')) out.push(`- [[overview]]: ${old.get('overview') || P('overall map of the library')}`);
  for (const [type, title] of SECTIONS) {
    out.push('', `## ${title}`);
    sorted(items.filter((p) => p.data.type === type)).forEach((p) => out.push(line(p)));
  }
  out.push('', `## ${P('Sources')}`);
  const sources = items.filter((p) => p.data.type === 'source');
  const known = new Set(FORMAT_GROUPS.map(([f]) => f));
  for (const [fmt, title] of [...FORMAT_GROUPS, ['*', P('Other')]]) {
    const group = sources.filter((p) => (fmt === '*' ? !known.has(p.data.format) : p.data.format === fmt));
    if (!group.length) continue;
    out.push('', `### ${title}`);
    sorted(group).forEach((p) => out.push(line(p)));
  }
  out.push('', `## ${P('Comparisons')}`);
  sorted(items.filter((p) => p.data.type === 'comparison')).forEach((p) => out.push(line(p)));
  out.push('', `## ${P('Questions')}`);
  sorted(items.filter((p) => p.data.type === 'question')).forEach((p) => out.push(line(p)));
  return { text: out.join('\n') + '\n', count: items.length, file };
}

export function rebuildIndex({ dry = false } = {}) {
  const r = buildIndex();
  if (dry) return { ...r, backup: null };
  let backup = null;
  if (fs.existsSync(r.file) && fs.statSync(r.file).size > 0) {
    fs.mkdirSync(OUTPUTS, { recursive: true });
    backup = path.join(OUTPUTS, `index-backup-${today()}-${Date.now()}.md`);
    fs.copyFileSync(r.file, backup);
  }
  fs.writeFileSync(r.file, r.text);
  return { ...r, backup: backup ? rel(backup) : null };
}


// ---------- Дневник (log.md) ----------
const ENTRY = /^## (\d{4}-\d{2}-\d{2}) ([a-z]+): (.*)$/;
const isStarter = (text, name) => {
  const f = path.join(path.dirname(fileURLToPath(import.meta.url)), 'starter', name);
  return !text.trim() || (fs.existsSync(f) && text.trim() === fs.readFileSync(f, 'utf8').trim());
};
const backupFile = (file) => {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return null;
  fs.mkdirSync(OUTPUTS, { recursive: true });
  const b = path.join(OUTPUTS, `backup-${path.basename(file, '.md')}-${today()}-${Date.now()}.md`);
  fs.copyFileSync(file, b);
  return rel(b);
};

/** Запазва съществуващите записи и добавя възстановени за източници, които не се споменават в лога. */
export function buildLog() {
  ensureStarter();
  const pages = wikiPages();
  const file = path.join(WIKI, 'log.md');
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const blocks = old.split(/^(?=## )/m);
  const head = blocks[0] && !blocks[0].startsWith('## ') ? blocks.shift() : fs.readFileSync(path.join(WIKI, 'log.md'), 'utf8').split(/^(?=## )/m)[0];
  const entries = blocks.map((b, i) => ({ text: b.trimEnd(), date: b.split('\n')[0].match(ENTRY)?.[1] || '', i }));
  const mentioned = (p) => entries.some((e) => e.text.includes(`[[${p.slug}]]`) || e.text.includes(String(p.data.title || '#')));
  let restored = 0;
  const add = (date, type, title, lines) => { entries.push({ text: `## ${date} ${type}: ${title}\n${lines.join('\n')}`, date, i: entries.length }); restored++; };
  for (const p of pages.filter((x) => x.data.type === 'source')) {
    const chapters = pages.filter((c) => c.data.type === 'chapter' && c.slug.startsWith(p.slug + '-ch'));
    const who = Array.isArray(p.data.authors) ? p.data.authors.join(', ') : p.data.authors || '';
    const title = `${who ? who + ' ' : ''}${p.data.year ? `(${p.data.year}) ` : ''}${p.data.title || p.slug}`.trim();
    if (!mentioned(p)) {
      add(String(p.data.created || today()), 'ingest', title, [
        `- ${P('New')}: [[${p.slug}]]${chapters.length ? `, ${chapters.length} ${P('chapters')}` : ''}`,
        `- ${P('Note: entry restored from the pages (the log had been lost)')}`]);
    }
    if (p.data.upgraded && !entries.some((e) => /^## \S+ upgrade:/.test(e.text) && e.text.includes(`[[${p.slug}]]`))) {
      add(String(p.data.upgraded), 'upgrade', title, [`- ${P('Updated')}: [[${p.slug}]]`, `- ${P('Note: entry restored from the pages')}`]);
    }
  }
  const dated = entries.filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date) || a.i - b.i);
  const undated = entries.filter((e) => !e.date);
  const text = [head.trimEnd(), ...undated.map((e) => e.text), ...dated.map((e) => e.text)].join('\n\n') + '\n';
  return { file, text, count: dated.length + undated.length, restored };
}

// ---------- Обзор (overview.md) ----------
const AUTO = ['<!-- auto-overview:start -->', '<!-- auto-overview:end -->'];

/** Автоматичен блок с числа и водещи страници; текстът извън блока (твоят или на Claude) не се пипа. */
export function buildOverview() {
  ensureStarter();
  const pages = wikiPages();
  const file = path.join(WIKI, 'overview.md');
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const by = (t) => pages.filter((p) => p.data.type === t);
  const title = (p) => String(p.data.title || p.slug);
  const incoming = new Map(pages.map((p) => [p.slug, 0]));
  for (const p of pages) for (const l of new Set(extractLinks(p.content))) if (l !== p.slug && incoming.has(l)) incoming.set(l, incoming.get(l) + 1);
  const top = (list, n) => [...list].sort((a, b) => incoming.get(b.slug) - incoming.get(a.slug) || title(a).localeCompare(title(b), 'bg')).slice(0, n);
  const sources = by('source');
  const block = [AUTO[0], `## ${P('The library at a glance')}`, '',
    `${P('Sources')}: ${sources.length} · ${P('Concepts')}: ${by('concept').length} · ${P('People and organizations')}: ${by('entity').length} · ${P('Topics')}: ${by('topic').filter((p) => !['index', 'log', 'overview'].includes(p.slug)).length} · ${P('Comparisons')}: ${by('comparison').length}`,
    ''];
  const topics = by('topic').filter((p) => !['index', 'log', 'overview'].includes(p.slug));
  if (topics.length) block.push(`### ${P('Topics')}`, ...topics.map((p) => `- [[${p.slug}]]: ${describe(p)}`), '');
  const concepts = top(by('concept'), 12).filter((p) => incoming.get(p.slug) > 0);
  if (concepts.length) block.push(`### ${P('Most connected concepts')}`, ...concepts.map((p) => `- [[${p.slug}]] (${incoming.get(p.slug)} ${P('links')})`), '');
  if (sources.length) block.push(`### ${P('Sources')}`, ...[...sources].sort((a, b) => String(a.data.year || 0).localeCompare(String(b.data.year || 0))).map((p) => `- [[${p.slug}]]`), '');
  block.push(P('_This block is built automatically by `npm run index`. For a narrative of how the topics connect, run “Synthesis across books”._'), AUTO[1]);
  const autoText = block.join('\n');
  let text;
  if (old.includes(AUTO[0]) && old.includes(AUTO[1])) {
    text = old.replace(new RegExp(`${AUTO[0]}[\\s\\S]*?${AUTO[1]}`), () => autoText);
  } else if (isStarter(old, 'overview.md')) {
    text = ['---', `title: ${P('Overview')}`, 'type: topic', 'tags: [overview]', 'sources: []', 'related: []', `created: ${today()}`, `updated: ${today()}`, 'confidence: medium', '---', '', `# ${P('Library overview')}`, '', autoText, ''].join('\n');
  } else {
    text = old.trimEnd() + '\n\n' + autoText + '\n'; // има собствен текст: добавяме блока отдолу
  }
  return { file, text, count: sources.length };
}

/** Прилага избраните: ['index','log','overview']. Старите версии се копират в outputs/. */
export function rebuildAll({ only = ['index', 'log', 'overview'], dry = false } = {}) {
  const out = { backups: [], counts: {}, restoredLog: 0 };
  const jobs = { index: buildIndex, log: buildLog, overview: buildOverview };
  for (const k of only) {
    const r = jobs[k]();
    out.counts[k] = r.count;
    if (k === 'log') out.restoredLog = r.restored;
    if (dry) { out[k] = r.text; continue; }
    const b = backupFile(r.file);
    if (b) out.backups.push(b);
    fs.writeFileSync(r.file, r.text);
  }
  if (!dry && only.includes('index')) {
    const logFile = path.join(WIKI, 'log.md');
    fs.appendFileSync(logFile, `\n## ${today()} refactor: ${P('Rebuilt')} ${only.join(', ')}\n- ${P('Sources')}: ${out.counts.index ?? '?'} ${P('pages in the index')}${out.restoredLog ? `, ${P('restored log entries')}: ${out.restoredLog}` : ''}\n`);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const oi = args.indexOf('--only');
  const only = oi >= 0 ? [args[oi + 1]].filter((x) => ['index', 'log', 'overview'].includes(x)) : ['index', 'log', 'overview'];
  if (!only.length) { console.error($t('✖ --only accepts index, log or overview')); process.exit(1); }
  const r = rebuildAll({ only, dry });
  if (dry) { only.forEach((k) => console.log(`===== ${k}.md =====\n${r[k]}`)); console.log($t('(dry run: nothing was written)')); }
  else {
    console.log($t('✔ Rebuilt: {0}.', [only.map((k) => k + '.md').join(', ')]));
    if (r.restoredLog) console.log($t('  Log: {0} restored entries added.', [r.restoredLog]));
    if (r.backups.length) console.log($t('  Old versions: {0}', [r.backups.join(', ')]));
  }
}
