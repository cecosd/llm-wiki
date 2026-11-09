// Премахване на източник (книга, статия...) заедно с главите му и цитатите към него.
//   npm run remove                       → списък на източниците, чийто оригинал липсва
//   npm run remove -- <slug>             → преглед на промените (нищо не се пипа)
//   npm run remove -- <slug> --apply     → прилага (архивира страниците в outputs/removed/)
// Нищо не се губи безвъзвратно: страниците на източника се архивират, а интерфейсът прави и git запис.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OUTPUTS, WIKI, rel, today, wikiPages, extractLinks, ingestState, normRaw, extractedPathOf, loadManifest, saveManifest } from './lib.js';
import { $t } from './i18n.js';
import { any, P } from './vocab.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FM = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Намира източника и главите му. */
function findTargets(pages, slug) {
  const source = pages.find((p) => p.slug === slug && p.data.type === 'source');
  if (!source) return null;
  const chapters = pages.filter((p) => p.data.type === 'chapter'
    && (extractLinks(String(p.data.book || '')).includes(slug) || new RegExp(`^${esc(slug)}-ch\\d+$`).test(p.slug)));
  return { source, chapters };
}

/** Връзка към премахнат слъг: [[x]], [[x|етикет]], [[x#раздел]] */
const linkRe = (slugs) => new RegExp(`\\[\\[\\s*(?:[^\\]|#]*/)?(?:${[...slugs].map(esc).join('|')})\\s*(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, 'g');

/** Пренаписва текста на една страница; връща {text, changes, sourcesLeft} */
function rewrite(page, removed, titles, rawPath) {
  const re = linkRe(removed);
  const hasLink = (s) => { re.lastIndex = 0; return re.test(s); };
  const src = fs.readFileSync(page.file, 'utf8');
  const fmMatch = src.match(FM);
  let fm = fmMatch ? fmMatch[0] : '';
  let body = fmMatch ? src.slice(fm.length) : src;
  let changes = 0;

  // frontmatter: редове от списъци (sources, related) и вградени масиви
  const rawKeyOf = (s) => normRaw(s).toLowerCase();
  fm = fm.split('\n').filter((line) => {
    const m = line.match(/^\s*-\s*(.+?)\s*$/);
    if (!m) return true;
    const v = m[1].replace(/^["']|["']$/g, '');
    if (hasLink(v) || (rawPath && rawKeyOf(v) === rawKeyOf(rawPath))) { changes++; return false; }
    return true;
  }).join('\n');
  fm = fm.replace(/^(\s*(?:related|sources)\s*:\s*)\[(.*)\]\s*$/gm, (all, k, inner) => {
    const items = inner.split(',').map((x) => x.trim()).filter(Boolean);
    const keep = items.filter((v) => !(hasLink(v) || (rawPath && rawKeyOf(v.replace(/^["']|["']$/g, '')) === rawKeyOf(rawPath))));
    if (keep.length !== items.length) changes++;
    return `${k}[${keep.join(', ')}]`;
  });

  // тяло: цитати в скоби, после редове-връзки, после останалите връзки като обикновен текст
  body = body.replace(/\s*\(([^()\n]*)\)/g, (all, inner) => {
    if (!hasLink(inner)) return all;
    const keep = inner.split(';').map((x) => x.trim()).filter((seg) => seg && !hasLink(seg));
    changes++;
    return keep.length ? ` (${keep.join('; ')})` : '';
  });
  body = body.split('\n').filter((line) => {
    const m = line.match(/^\s*[-*+]\s*(\[\[[^\]]*\]\])/);
    if (m && hasLink(m[1])) { changes++; return false; }
    return true;
  }).join('\n');
  body = body.replace(re, (all, label) => { changes++; return label || titles.get(all.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0].trim().split('/').pop()) || P('removed source'); });
  body = body.replace(/ {2,}/g, ' ').replace(/ +([,.;:])/g, '$1');

  // колко източника остават
  const m = fm.match(/^sources\s*:\s*\r?\n((?:\s+-.*\r?\n?)*)/m);
  const inline = fm.match(/^sources\s*:\s*\[(.*)\]/m);
  const left = m ? m[1].split('\n').filter((l) => /^\s*-\s*\S/.test(l)).length : inline ? inline[1].split(',').filter((x) => x.trim()).length : 0;
  return { text: fm + body, changes, sourcesLeft: left };
}

/** Какво ще се промени (нищо не се записва). */
export function planRemoval(slug) {
  const pages = wikiPages();
  const t = findTargets(pages, slug);
  if (!t) return { ok: false, error: $t('There is no source with the slug “{0}”.', [slug]) };
  const { source, chapters } = t;
  const removed = new Set([source.slug, ...chapters.map((c) => c.slug)]);
  const titles = new Map([source, ...chapters].map((p) => [p.slug, String(p.data.title || p.slug)]));
  const rawPath = source.data.raw_path ? normRaw(source.data.raw_path) : null;
  const notes = (source.content.match(new RegExp(`##\\s*${any('notes')}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`))?.[1] || '').trim();

  const touched = [];
  const orphaned = [];
  for (const p of pages) {
    if (removed.has(p.slug)) continue;
    const r = rewrite(p, removed, titles, rawPath);
    if (r.changes) {
      touched.push({ rel: p.rel, slug: p.slug, type: p.data.type, title: String(p.data.title || p.slug), changes: r.changes });
      if (!['index', 'log', 'overview'].includes(p.slug) && ['concept', 'entity', 'topic', 'comparison', 'question'].includes(p.data.type) && r.sourcesLeft === 0) orphaned.push(p.slug);
    }
  }
  const missing = !!rawPath && !ingestState(pages).resolve(rawPath);
  return {
    ok: true, slug, title: titles.get(slug), rawPath, originalMissing: missing,
    pages: [source, ...chapters].map((p) => ({ rel: p.rel, slug: p.slug, type: p.data.type })),
    touched, orphaned, hasNotes: notes.length > 0 && !/^\(.*\)$|^_.*_$/.test(notes), notesPreview: notes.slice(0, 300),
    extracted: extractedPathOf(rawPath) ? rel(extractedPathOf(rawPath)) : null, // null при път извън raw/.extracted/
  };
}

/** Прилага премахването. Връща същия отчет плюс къде е архивът. */
export function applyRemoval(slug) {
  const plan = planRemoval(slug);
  if (!plan.ok) return plan;
  const pages = wikiPages();
  const { source, chapters } = findTargets(pages, slug);
  const removed = new Set([source.slug, ...chapters.map((c) => c.slug)]);
  const titles = new Map([source, ...chapters].map((p) => [p.slug, String(p.data.title || p.slug)]));
  const rawPath = plan.rawPath;

  // 1. Архив на страниците на източника (с „Мои бележки“)
  const archive = path.join(OUTPUTS, 'removed', `${slug}-${today()}`);
  fs.mkdirSync(archive, { recursive: true });
  for (const p of [source, ...chapters]) fs.copyFileSync(p.file, path.join(archive, path.basename(p.file)));

  // 2. Пренаписване на страниците, които ги цитират
  for (const p of pages) {
    if (removed.has(p.slug)) continue;
    const r = rewrite(p, removed, titles, rawPath);
    if (r.changes) fs.writeFileSync(p.file, r.text);
  }
  // 3. Изтриване на страниците на източника, текстовата версия и записа в manifest
  for (const p of [source, ...chapters]) fs.rmSync(p.file, { force: true });
  const extracted = extractedPathOf(rawPath); // проверено наново точно преди изтриването
  if (extracted) fs.rmSync(extracted, { force: true });
  try {
    const m = loadManifest();
    const key = Object.keys(m.files || {}).find((k) => normRaw(k).toLowerCase() === (rawPath || '').toLowerCase());
    if (key) { delete m.files[key]; saveManifest(m); }
  } catch { /* manifest-ът не е задължителен */ }

  // 4. Запис в лога
  const logFile = path.join(WIKI, 'log.md');
  const entry = `\n## ${today()} refactor: ${P('Source removed')} “${plan.title}”\n`
    + `- ${P('Pages removed')}: ${plan.pages.length} (${P('archive')}: \`${rel(archive)}\`)\n`
    + `- ${P('Pages updated')}: ${plan.touched.length}\n`
    + (plan.orphaned.length ? `- ${P('Left without a source')}: ${plan.orphaned.map((s) => `[[${s}]]`).join(', ')}\n` : '');
  fs.appendFileSync(logFile, entry);
  return { ...plan, archive: rel(archive) };
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  if (!slug) {
    const broken = ingestState().broken;
    console.log(broken.length ? $t('Sources without an original in raw/:') : $t('No sources with a missing original.'));
    broken.forEach((p) => console.log(`  ${p.slug}   (${p.data.raw_path})`));
    if (broken.length) console.log($t('\nPreview: npm run remove -- <slug>   Apply: npm run remove -- <slug> --apply'));
    process.exit(0);
  }
  const apply = args.includes('--apply');
  const r = apply ? applyRemoval(slug) : planRemoval(slug);
  if (!r.ok) { console.error('✖ ' + r.error); process.exit(1); }
  console.log(`${apply ? $t('Removed') : $t('Will be removed')}: ${r.title}`);
  console.log($t('  Source pages ({0}): {1}', [r.pages.length, r.pages.map((p) => p.slug).join(', ')]));
  console.log($t('  Pages with citations that are cleaned ({0}):', [r.touched.length]));
  r.touched.forEach((t) => console.log(`    - ${t.rel} (${t.changes})`));
  if (r.orphaned.length) console.log($t('  ⚠ Left without a source: {0}', [r.orphaned.join(', ')]));
  if (r.hasNotes) console.log($t('  ⚠ There are “My notes”; they are kept in the archive.'));
  if (apply) console.log($t('\nArchive: {0}. Restore with git if you made a mistake: git log -- wiki', [r.archive]));
  else console.log($t('\nNothing was changed. To apply, add --apply.'));
}
