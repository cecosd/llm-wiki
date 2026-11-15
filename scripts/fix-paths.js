// Brings raw_path in all source pages to the canonical form on disk.
// Touches only the raw_path line in the frontmatter, nothing else. npm run fix-paths [-- --dry]
import fs from 'node:fs';
import { ingestState } from './lib.js';
import { $t } from './i18n.js';

const dry = process.argv.includes('--dry');
const { nonCanonical } = ingestState();
if (!nonCanonical.length) { console.log($t('✔ All raw_path values are in canonical form.')); process.exit(0); }

for (const { page, written, canonical } of nonCanonical) {
  const src = fs.readFileSync(page.file, 'utf8');
  const out = src.replace(/^(raw_path:[ \t]*).*$/m, `$1${canonical}`);
  if (!dry) fs.writeFileSync(page.file, out);
  console.log(`${dry ? '·' : '✔'} ${page.rel}: "${written}" → "${canonical}"`);
}
