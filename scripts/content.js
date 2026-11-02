// Език на съдържанието: npm run content -- <код>   (например bg или en)
// Инсталира езиковия пакет от content/<код>/ (CLAUDE.md, скилове, агент, шаблони, начални страници, промптове)
// и записва `contentLang` в library.config.json. Страниците, които вече са в wiki/, не се пипат.
// Нов език: копирай content/en/ като content/<код>/ и преведи файловете (включително prompts.json).
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
