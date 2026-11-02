// Показва кои raw файлове още нямат source страница.
//   npm run status            обобщение
//   npm run pending           само чакащите, по един път на ред (за /wiki-ingest)
import fs from 'node:fs';
import path from 'node:path';
import { EXTRACTED, ROOT, rel, rawFiles, wikiPages, walk, ingestState, normRaw } from './lib.js';
import { $t } from './i18n.js';

const pages = wikiPages();
const raw = rawFiles();
const { pending, done, broken, nonCanonical } = ingestState(pages, raw);

if (process.argv.includes('--pending')) {
  // Каноничните пътища: точно тях Claude записва в raw_path
  pending.forEach((f) => console.log(normRaw(rel(f))));
  process.exit(0);
}

const inbox = walk(path.join(ROOT, 'raw/inbox')).filter((f) => !f.endsWith('.gitkeep'));
const byType = pages.reduce((a, p) => ((a[p.data.type || '?'] = (a[p.data.type || '?'] || 0) + 1), a), {});

console.log($t('Library'));
console.log($t('  raw files:         {0}', [raw.length]));
console.log($t('  processed:         {0}', [done.length]));
console.log($t('  pending:           {0}', [pending.length]));
console.log($t('  in inbox:          {0}{1}', [inbox.length, inbox.length ? '  → npm run inbox' : '']));
console.log($t('  wiki pages:        {0}  ({1})', [pages.length, Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(', ')]));

if (pending.length) {
  console.log($t('\nPending (only these are read by /wiki-ingest):'));
  for (const f of pending) {
    const ex = path.join(EXTRACTED, path.relative(path.join(ROOT, 'raw'), f) + '.md');
    console.log(`  - ${normRaw(rel(f))}  [${fs.existsSync(ex) ? $t('text ready') : $t('no text')}]`);
  }
}

if (nonCanonical.length) {
  console.log($t('\nℹ Recognized, but raw_path is written differently (fix with npm run fix-paths):'));
  nonCanonical.forEach((n) => console.log(`  - ${n.page.rel}: "${n.written}" → "${n.canonical}"`));
}

if (broken.length) {
  console.log($t('\n⚠ Source pages point to raw files that do not exist:'));
  broken.forEach((p) => console.log(`  - ${p.rel}: ${p.data.raw_path}`));
}
