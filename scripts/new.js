// Нова страница от шаблон: npm run new -- concept my-concept "Моето понятие"
import fs from 'node:fs';
import path from 'node:path';
import { WIKI, rel, today } from './lib.js';
import { $t } from './i18n.js';

const DIRS = { source: 'sources', chapter: 'sources/chapters', concept: 'concepts', entity: 'entities', topic: 'topics', comparison: 'comparisons', question: 'questions' };
const [type, slug, ...titleParts] = process.argv.slice(2);

if (!DIRS[type] || !slug) {
  console.log($t('Usage: npm run new -- <{0}> <slug> ["Title"]', [Object.keys(DIRS).join('|')]));
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) { console.error($t('slug must be kebab-case Latin, e.g. my-concept')); process.exit(1); }

const dest = path.join(WIKI, DIRS[type], `${slug}.md`);
if (fs.existsSync(dest)) { console.error($t('Already exists: {0}', [rel(dest)])); process.exit(1); }

const title = titleParts.join(' ') || slug;
const tpl = fs.readFileSync(path.join(WIKI, '_templates', `${type}.md`), 'utf8');
fs.writeFileSync(dest, tpl.replaceAll('{{title}}', title).replaceAll('{{date}}', today()).replaceAll('{{file}}', ''));
console.log(`✔ ${rel(dest)}`);
