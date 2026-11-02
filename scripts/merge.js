// Дубликати по изписване (Чайковски / Чайковский / Tchaikovsky) и обединяване на страници.
//   npm run dupes                          → списък на възможните дубликати и на разминаващите се автори
//   npm run dupes -- <запази> <махни>      → преглед на обединяването (нищо не се пипа)
//   npm run dupes -- <запази> <махни> --apply
// Нищо не се губи: махнатата страница се архивира в outputs/merged/, съдържанието ѝ се прибавя в оставащата,
// а всички връзки към нея започват да сочат към оставащата. Старото име остава като псевдоним (aliases).
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';
import { ROOT, OUTPUTS, WIKI, rel, today, wikiPages, extractLinks } from './lib.js';
import { $t } from './i18n.js';
import { P } from './vocab.js';

const IGNORE_FILE = path.join(OUTPUTS, '.dupes-ignore.json');
const MERGEABLE = new Set(['entity', 'concept', 'topic']);
const SPECIAL = new Set(['index', 'log', 'overview']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- Сравнение по звучене ----------
export const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: '', ю: 'iu', я: 'ia' };

/** Свежда имената до груб звуков ключ: Чайковски, Чайковский и Tchaikovsky дават един и същ ключ. */
export function fold(s) {
  let t = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = [...t].map((c) => (c in CYR ? CYR[c] : c)).join('');
  t = t.replace(/[^a-z]/g, '')
    .replace(/kh|ch|x/g, 'h').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/[cq]/g, 'k')
    .replace(/[wv]/g, 'v').replace(/[yj]/g, 'i').replace(/(.)\1+/g, '$1');
  return t;
}

function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const near = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return a.length >= 4;
  const n = Math.min(a.length, b.length);
  return n >= 6 && lev(a, b) <= (n >= 12 ? 2 : 1);
};

/** Фамилията и собственото име от „Пьотр Чайковски“, „Tchaikovsky, P.“ или „Tchaikovsky“. */
function nameParts(s) {
  const t = String(s).replace(/\(.*?\)/g, ' ').trim();
  if (t.includes(',')) { const [a, ...b] = t.split(','); return { sur: fold(a), given: fold(b.join(' ')) }; }
  const w = t.split(/\s+/).filter(Boolean);
  if (w.length === 1) return { sur: fold(w[0]), given: '' };
  return { sur: fold(w[w.length - 1]), given: fold(w[0]) };
}

/** Всички изписвания на страницата: заглавие, думите в скоби, aliases */
function variants(p) {
  const title = String(p.data.title || p.slug);
  const out = new Set([title, title.replace(/\(.*?\)/g, '').trim()]);
  for (const m of title.matchAll(/\(([^)]+)\)/g)) out.add(m[1].trim());
  for (const a of [].concat(p.data.aliases || [])) out.add(String(a));
  return [...out].filter(Boolean);
}

function sameName(p, q, person) {
  for (const x of variants(p)) for (const y of variants(q)) {
    if (person) {
      const a = nameParts(x), b = nameParts(y);
      if (!near(a.sur, b.sur)) continue;
      if (a.given && b.given && a.given[0] !== b.given[0]) continue; // различни собствени имена
      return `${x} ≈ ${y}`;
    }
    const a = fold(x), b = fold(y);
    if (a.length >= 5 && near(a, b)) return `${x} ≈ ${y}`;
  }
  return null;
}

const ignored = () => { try { return new Set(JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf8'))); } catch { return new Set(); } };
const pairKey = (a, b) => [a, b].sort().join('|');
export function ignorePair(a, b) {
  const s = ignored(); s.add(pairKey(a, b));
  fs.mkdirSync(OUTPUTS, { recursive: true });
  fs.writeFileSync(IGNORE_FILE, JSON.stringify([...s], null, 2) + '\n');
}

function backlinkCounts(pages) {
  const n = new Map(pages.map((p) => [p.slug, 0]));
  for (const p of pages) {
    if (SPECIAL.has(p.slug)) continue;
    for (const l of new Set(extractLinks(p.content))) if (n.has(l) && l !== p.slug) n.set(l, n.get(l) + 1);
  }
  return n;
}

const brief = (p, bl) => ({
  slug: p.slug, title: String(p.data.title || p.slug), type: p.data.type, kind: p.data.kind || null,
  aliases: [].concat(p.data.aliases || []).map(String), backlinks: bl.get(p.slug) || 0,
  sources: [].concat(p.data.sources || []).length,
});

/** Възможни дубликати сред понятия, личности и теми + автори, изписани по различен начин в източниците. */
export function findDupes(pages = wikiPages()) {
  const bl = backlinkCounts(pages), skip = ignored(), pairs = [];
  const pool = pages.filter((p) => MERGEABLE.has(p.data.type) && !SPECIAL.has(p.slug));
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const p = pool[i], q = pool[j];
    if (p.data.type !== q.data.type || skip.has(pairKey(p.slug, q.slug))) continue;
    const person = p.data.type === 'entity' && (p.data.kind || 'person') === 'person' && (q.data.kind || 'person') === 'person';
    const why = sameName(p, q, person);
    if (why) pairs.push({ a: brief(p, bl), b: brief(q, bl), why });
  }

  // автори: групиране по звучене на фамилията
  const strings = new Map(); // низ → източници
  for (const p of pages.filter((x) => x.data.type === 'source')) {
    for (const a of [].concat(p.data.authors || []).map((x) => String(x).trim()).filter(Boolean)) {
      if (!strings.has(a)) strings.set(a, []);
      strings.get(a).push({ slug: p.slug, title: String(p.data.title || p.slug) });
    }
  }
  const items = [...strings.keys()].map((s) => ({ s, ...nameParts(s) })).filter((x) => x.sur);
  const group = items.map((_, i) => i);
  const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (!near(a.sur, b.sur)) continue;
    if (a.given && b.given && a.given[0] !== b.given[0]) continue;
    group[find(i)] = find(j);
  }
  const clusters = new Map();
  items.forEach((x, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(x.s); });
  const authors = [...clusters.values()].filter((c) => c.length > 1).map((c) => ({
    variants: c.map((s) => ({ name: s, sources: strings.get(s) })).sort((x, y) => y.sources.length - x.sources.length),
  }));
  return { pairs, authors };
}

// ---------- Обединяване ----------
const FM = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** [[drop]], [[drop|етикет]], [[път/drop#раздел]] → към keep */
function relink(text, drop, keep) {
  const re = new RegExp(`\\[\\[\\s*(?:[^\\]|#]*/)?${esc(drop)}\\s*(#[^\\]|]*)?(\\|[^\\]]*)?\\]\\]`, 'g');
  let n = 0;
  const out = text.replace(re, (_, h, l) => { n++; return `[[${keep}${h || ''}${l || ''}]]`; });
  return { text: out, n };
}

/** Махни повторените елементи на списъците във frontmatter (след пренасочването могат да се удвоят) */
function dedupeFrontmatter(fm, selfSlug) {
  const seen = new Map(); let key = null;
  const selfRe = new RegExp(`\\[\\[\\s*(?:[^\\]|#]*/)?${esc(selfSlug)}\\s*(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`);
  return fm.split('\n').filter((line) => {
    const k = line.match(/^([A-Za-z_][\w-]*):/); if (k) { key = k[1]; seen.set(key, new Set()); return true; }
    const it = line.match(/^\s*-\s*(.+?)\s*$/);
    if (!it || !key) return true;
    if (key === 'related' && selfRe.test(it[1])) return false;
    const v = it[1].replace(/^["']|["']$/g, '').toLowerCase();
    if (seen.get(key).has(v)) return false;
    seen.get(key).add(v); return true;
  }).join('\n');
}

export function planMerge(keepSlug, dropSlug, pages = wikiPages()) {
  const keep = pages.find((p) => p.slug === keepSlug), drop = pages.find((p) => p.slug === dropSlug);
  if (!keep || !drop) return { ok: false, error: $t('I cannot find one of the two pages.') };
  if (keep.slug === drop.slug) return { ok: false, error: $t('Choose two different pages.') };
  if (keep.data.type !== drop.data.type || !MERGEABLE.has(keep.data.type)) return { ok: false, error: $t('Only two concepts, two people/organizations or two topics can be merged.') };
  const touched = [];
  for (const p of pages) {
    if (p.slug === drop.slug) continue;
    const { n } = relink(fs.readFileSync(p.file, 'utf8'), drop.slug, keep.slug);
    if (n) touched.push({ slug: p.slug, rel: p.rel, links: n });
  }
  return {
    ok: true, keep: { slug: keep.slug, title: String(keep.data.title || keep.slug) }, drop: { slug: drop.slug, title: String(drop.data.title || drop.slug) },
    touched, newAliases: [...new Set([String(drop.data.title || drop.slug), ...[].concat(drop.data.aliases || []).map(String)])]
      .filter((a) => a.toLowerCase() !== String(keep.data.title || '').toLowerCase()),
  };
}

export function applyMerge(keepSlug, dropSlug) {
  const pages = wikiPages();
  const plan = planMerge(keepSlug, dropSlug, pages);
  if (!plan.ok) return plan;
  const keep = pages.find((p) => p.slug === keepSlug), drop = pages.find((p) => p.slug === dropSlug);

  // 1. архив
  const archive = path.join(OUTPUTS, 'merged', `${drop.slug}-${today()}`);
  fs.mkdirSync(archive, { recursive: true });
  fs.copyFileSync(drop.file, path.join(archive, path.basename(drop.file)));

  // 2. пренасочване на връзките във всички страници
  const dropLine = new RegExp(`^\\s*[-*+]\\s*\\[\\[\\s*(?:[^\\]|#]*/)?${esc(drop.slug)}\\s*(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\].*\\n?`, 'gm');
  for (const p of pages) {
    if (p.slug === drop.slug) continue;
    let text = fs.readFileSync(p.file, 'utf8'), changed = false;
    if (p.slug === 'index' && dropLine.test(text)) { dropLine.lastIndex = 0; text = text.replace(dropLine, ''); changed = true; }
    dropLine.lastIndex = 0;
    const r = relink(text, drop.slug, keep.slug);
    if (r.n) { text = r.text; changed = true; }
    if (p.slug === keep.slug) {
      // 3. съдържание и метаданни на оставащата страница
      const m = matter(text);
      const d = m.data;
      for (const [k, v] of Object.entries(d)) if (v instanceof Date) d[k] = v.toISOString().slice(0, 10);
      const list = (x) => [].concat(x || []).map(String);
      const keepTitle = String(d.title || keep.slug).toLowerCase();
      d.aliases = [...new Set([...list(d.aliases), ...plan.newAliases])].filter((a) => a.toLowerCase() !== keepTitle);
      for (const k of ['tags', 'sources', 'related']) {
        if (drop.data[k] || d[k]) d[k] = [...new Map([...list(d[k]), ...list(drop.data[k])].map((v) => [v.toLowerCase(), v])).values()];
      }
      d.related = list(d.related).filter((v) => !extractLinks(v).includes(keep.slug) && !extractLinks(v).includes(drop.slug));
      if (!d.related.length) delete d.related;
      d.updated = today();
      const dropBody = drop.content.replace(/^\s*#\s+.*\n/, '').trim();
      const body = m.content.replace(/\s+$/, '') + (dropBody ? `\n\n## ${P('Merged from')} “${drop.data.title || drop.slug}”\n\n${relink(dropBody, drop.slug, keep.slug).text}\n` : '\n');
      text = matter.stringify(body, d);
      changed = true;
    } else if (changed) {
      const fm = text.match(FM);
      if (fm) text = dedupeFrontmatter(fm[0].replace(/\r?\n$/, ''), p.slug) + '\n' + text.slice(fm[0].length);
    }
    if (changed) fs.writeFileSync(p.file, text);
  }

  // 4. махане на дубликата и запис в лога
  fs.rmSync(drop.file, { force: true });
  fs.appendFileSync(path.join(WIKI, 'log.md'),
    `\n## ${today()} refactor: ${P('Merged')} “${plan.drop.title}” ${P('and')} “${plan.keep.title}”\n`
    + `- ${P('Kept')}: [[${keep.slug}]]; ${P('removed')}: ${drop.slug} (${P('archive')}: \`${rel(archive)}\`)\n`
    + `- ${P('Links redirected in {0} pages; the old name was added as an alias', [plan.touched.length])}\n`);
  return { ...plan, archive: rel(archive) };
}

// ---------- Единно изписване на автор ----------
export function normalizeAuthors(canonical, names) {
  const from = names.filter((n) => n && n !== canonical);
  let files = 0;
  for (const p of wikiPages().filter((x) => x.data.type === 'source')) {
    const text = fs.readFileSync(p.file, 'utf8'), fm = text.match(FM);
    if (!fm) continue;
    let inAuthors = false;
    const lines = fm[0].split('\n').map((line) => {
      if (/^authors\s*:/.test(line)) { inAuthors = !/\S/.test(line.replace(/^authors\s*:/, '')) ? true : false; return swap(line); }
      if (/^[A-Za-z_][\w-]*\s*:/.test(line)) { inAuthors = false; return /^apa\s*:/.test(line) ? swap(line) : line; }
      return inAuthors ? swap(line) : line;
    });
    function swap(l) { let o = l; for (const f of from) o = o.split(f).join(canonical); return o; }
    const out = lines.join('\n');
    if (out !== fm[0]) { fs.writeFileSync(p.file, out + text.slice(fm[0].length)); files++; }
  }
  if (files) fs.appendFileSync(path.join(WIKI, 'log.md'), `\n## ${today()} refactor: ${P('Unified author spelling')} “${canonical}”\n- ${P('Variants replaced')}: ${from.join('; ')}\n- ${P('Sources updated')}: ${files}\n`);
  return { ok: true, files };
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (args.length < 2) {
    const { pairs, authors } = findDupes();
    console.log(pairs.length ? $t('Possible duplicates ({0}):', [pairs.length]) : $t('No possible duplicates among the pages.'));
    pairs.forEach((p) => console.log(`  ${p.a.slug}  ~  ${p.b.slug}   (${p.why})`));
    if (authors.length) { console.log($t('\nAuthors written in different ways:')); authors.forEach((g) => console.log('  ' + g.variants.map((v) => `${v.name} (${v.sources.length})`).join('  |  '))); }
    if (pairs.length) console.log($t('\nMerge: npm run dupes -- <keep> <drop> [--apply]'));
    process.exit(0);
  }
  const apply = process.argv.includes('--apply');
  const r = apply ? applyMerge(args[0], args[1]) : planMerge(args[0], args[1]);
  if (!r.ok) { console.error('✖ ' + r.error); process.exit(1); }
  console.log(`${apply ? $t('Merged') : $t('Will be merged')}: “${r.drop.title}” → “${r.keep.title}”`);
  console.log($t('  Pages with links that are redirected ({0}): {1}', [r.touched.length, r.touched.map((t) => t.slug).join(', ')]));
  console.log($t('  Aliases: {0}', [r.newAliases.join(', ') || '-']));
  console.log(apply ? '\n' + $t('Archive: {0}', [r.archive]) : '\n' + $t('Nothing was changed. To apply, add --apply.'));
}
