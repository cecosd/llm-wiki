// npm run docs: копира в docs/ файловете, нужни на страницата за продукта, за да работи и в GitHub Pages (там няма node_modules).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.js';

const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'docs', 'vendor');
fs.mkdirSync(OUT, { recursive: true });

fs.copyFileSync(path.join(NM, 'vue/dist/vue.global.prod.js'), path.join(OUT, 'vue.js'));
fs.copyFileSync(path.join(NM, '@tailwindcss/browser/dist/index.global.js'), path.join(OUT, 'tailwind.js'));

const FONTS = [
  ['@fontsource-variable/inter/files/inter-cyrillic-wght-normal.woff2', 'inter-cyrillic.woff2'],
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'inter-latin.woff2'],
  ['@fontsource-variable/literata/files/literata-cyrillic-wght-normal.woff2', 'literata-cyrillic.woff2'],
  ['@fontsource-variable/literata/files/literata-latin-wght-normal.woff2', 'literata-latin.woff2'],
];
for (const [from, to] of FONTS) fs.copyFileSync(path.join(NM, from), path.join(OUT, to));

fs.writeFileSync(path.join(ROOT, 'docs', '.nojekyll'), ''); // GitHub Pages да връща файловете такива, каквито са
console.log(`✔ docs/vendor: ${fs.readdirSync(OUT).length} files`);
