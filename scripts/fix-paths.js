// Привежда raw_path във всички source страници към каноничния вид на диска.
// Пипа само реда raw_path във frontmatter, нищо друго. npm run fix-paths [-- --dry]
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
