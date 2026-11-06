// Библиотеките на интерфейса от node_modules: сървърът ги отдава като /vendor/<име>, архивът ги вгражда в index.html.
import path from 'node:path';
import { ROOT } from './lib.js';

export const NM = path.join(ROOT, 'node_modules');
export const VENDOR = {
  'vue.js': 'vue/dist/vue.global.prod.js',
  'marked.js': 'marked/lib/marked.umd.js',
  'tailwind.js': '@tailwindcss/browser/dist/index.global.js',
};
