// Content language: npm run content -- <code>   (for example bg or en)
// Installs the language pack from content/<code>/ (CLAUDE.md, skills, agent, templates, starter pages, prompts)
// and writes `contentLang` into library.config.json. The pages already in wiki/ are not touched.
// New language: copy content/en/ as content/<code>/ and translate the files (including prompts.json).
import { $t } from './i18n.js';
import { packs, installPack } from './content-pack.js';

const code = process.argv[2];
if (!code || code === '--list') {
  console.log($t('Content language packs: {0}', [packs().join(', ') || '-']));
  console.log($t('Usage: npm run content -- <code>'));
  process.exit(code ? 0 : 1);
}
if (!packs().includes(code)) { console.error($t('No such pack: content/{0}/', [code])); process.exit(1); }
const r = installPack(code);
if (r.backedUp) console.log($t('CLAUDE.md differs from every pack: a copy was saved as CLAUDE.md.bak'));
console.log($t('✔ Content language: {0} ({1} files installed).', [code, r.files]));
