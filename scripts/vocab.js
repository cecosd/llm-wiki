// Текстове на езика на съдържанието: промптовете към Claude, заглавията и фразите, които скриптовете
// записват в wiki-то (индекс, дневник, статии). Ключът е английският текст; преводът е в
// content/<код>/prompts.json (нов език: копирай content/en/prompts.json и преведи стойностите).
// Без превод се ползва английският ключ. Езикът на съдържанието е contentLang() (виж i18n.js).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.js';
import { contentLang } from './i18n.js';

const CONTENT = path.join(ROOT, 'content');
const cache = new Map(); // код → { mtime, messages }

function pack(code) {
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(code)) return {};
  const file = path.join(CONTENT, code, 'prompts.json');
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = cache.get(code);
    if (hit && hit.mtime === mtime) return hit.messages;
    const messages = JSON.parse(fs.readFileSync(file, 'utf8')).messages || {};
    cache.set(code, { mtime, messages });
    return messages;
  } catch { return {}; }
}
const fmt = (s, args) => (args && args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] ?? m)) : s);

/** Текст на езика на съдържанието по английски ключ; `{0}`, `{1}` се заместват от args. */
export function P(key, args) {
  const m = pack(contentLang());
  return fmt(m[key] ?? key, args);
}

/** Преводите на ключа на ВСИЧКИ езици (за регулярни изрази, които трябва да разпознават библиотека на всеки език). */
export function Pall(key) {
  const out = new Set([key]);
  try { for (const d of fs.readdirSync(CONTENT)) { const v = pack(d)[key]; if (v) out.add(v); } } catch { /* няма content/ */ }
  return [...out];
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Израз за регулярен израз, който хваща ключа на всеки език. */
export const anyP = (key) => `(?:${Pall(key).map(esc).join('|')})`;

// Имената на разделите и частите на страниците (ключове: английски текстове)
const NAMES = {
  notes: 'My notes', chapters: 'Chapters', contradictions: 'Contradictions', answer: 'Answer', question: 'Question',
  relies: 'What it relies on', sources: 'Sources', related: 'Related', chapterAbbr: 'Ch.', leftForHuman: '(Left for the human.)',
  bookNote: 'Note',
};
export const V = () => Object.fromEntries(Object.entries(NAMES).map(([k, en]) => [k, P(en)]));
/** Регулярен израз за името на раздела на всеки език: any('notes'). */
export const any = (k) => anyP(NAMES[k]);

/** Съкращенията на страница и раздел във всички езици, за регулярни изрази: `(?:p\.|pp\.|с\.|…)`. */
export const pageUnits = () => `(?:${[...new Set([...Pall('p.'), ...Pall('pp.'), ...Pall('sect.'), 'с.', 'стр.', 'разд.'])].map(esc).join('|')})`;

/**
 * Обект или масив, който се смята наново при всеки достъп: за константи с преводим текст, за да следват
 * езика, сменен докато сървърът работи.
 */
export const lazy = (fn) => new Proxy({}, {
  get: (_, k) => Reflect.get(Object(fn()), k),
  has: (_, k) => k in Object(fn()),
  ownKeys: () => Reflect.ownKeys(Object(fn())),
  getOwnPropertyDescriptor: (_, k) => { const d = Object.getOwnPropertyDescriptor(Object(fn()), k); return d && { ...d, configurable: true }; },
});
