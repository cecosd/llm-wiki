// Проверка на преводите: npm run i18n:check
//  - ключовете, ползвани в кода (функцията $t), трябва да са в locales/en.json;
//  - всеки друг език се сравнява с en.json (липсващи и излишни ключове, различни {0} {1}).
// Липсващ превод не е грешка: интерфейсът показва английския ключ. Код на изход 1 само ако en.json е непълен.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.js';
import { LOCALES_DIR } from './i18n.js';

const unescape = (raw) => raw.replace(/\\(.)/gs, (_, c) => ({ n: '\n', t: '\t' }[c] ?? c));
const placeholders = (s) => [...new Set(String(s).match(/\{\d+\}/g) || [])].sort().join(',');

const files = [];
for (const dir of ['scripts', 'scripts/viewer']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) if (/\.(js|html)$/.test(f)) files.push(path.join(ROOT, dir, f));
}
const used = new Set();
for (const f of files) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/\$t\('((?:[^'\\]|\\.)*)'/g)) used.add(unescape(m[1]));
}

const locales = new Map();
for (const f of fs.readdirSync(LOCALES_DIR).filter((x) => x.endsWith('.json'))) {
  try { locales.set(f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, f), 'utf8'))); }
  catch (e) { console.error(`✖ ${f}: ${e.message}`); process.exit(1); }
}
const en = locales.get('en')?.messages;
if (!en) { console.error('✖ locales/en.json is missing'); process.exit(1); }

let bad = false;
const notInEn = [...used].filter((k) => !(k in en));
if (notInEn.length) { bad = true; console.error(`✖ en.json lacks ${notInEn.length} key(s) used in the code:`); notInEn.forEach((k) => console.error('   ' + JSON.stringify(k))); }
const unusedEn = Object.keys(en).filter((k) => !used.has(k));
if (unusedEn.length) console.log(`ℹ en.json has ${unusedEn.length} key(s) not found in the code (kept: they may be built dynamically).`);

for (const [code, data] of locales) {
  if (code === 'en') continue;
  const msg = data.messages || {};
  const missing = Object.keys(en).filter((k) => !(k in msg));
  const extra = Object.keys(msg).filter((k) => !(k in en));
  const ph = Object.keys(msg).filter((k) => k in en && placeholders(k) !== placeholders(msg[k]));
  console.log(`${code} (${data._meta?.name || '?'}): ${Object.keys(en).length - missing.length}/${Object.keys(en).length} translated`);
  if (missing.length) console.log(`   missing: ${missing.length}${missing.length <= 10 ? '\n   ' + missing.map((k) => JSON.stringify(k)).join('\n   ') : ' (first 10: ' + missing.slice(0, 10).map((k) => JSON.stringify(k)).join(', ') + ')'}`);
  if (extra.length) console.log(`   extra keys not in en.json: ${extra.length}`);
  if (ph.length) console.log(`   placeholder mismatch ({0}, {1}) in: ${ph.slice(0, 10).map((k) => JSON.stringify(k)).join(', ')}`);
}
process.exit(bad ? 1 : 0);
