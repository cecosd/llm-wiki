// Texts in the language of the content: the prompts to Claude, the headings and phrases that the scripts
// write into the wiki (index, log, articles). The key is the English text; the translation is in
// content/<code>/prompts.json (new language: copy content/en/prompts.json and translate the values).
// Without a translation the English key is used. The content language is contentLang() (see i18n.js).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.js';
import { contentLang } from './i18n.js';

const CONTENT = path.join(ROOT, 'content');
const cache = new Map(); // code -> { mtime, messages }

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

/** Text in the content language by English key; `{0}`, `{1}` are replaced from args. */
export function P(key, args) {
  const m = pack(contentLang());
  return fmt(m[key] ?? key, args);
}

/** The translations of a key in ALL languages (for regular expressions that must recognise a library in any language). */
export function Pall(key) {
  const out = new Set([key]);
  try { for (const d of fs.readdirSync(CONTENT)) { const v = pack(d)[key]; if (v) out.add(v); } } catch { /* there is no content/ */ }
  return [...out];
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** An expression for a regular expression that matches the key in every language. */
export const anyP = (key) => `(?:${Pall(key).map(esc).join('|')})`;

// The names of the sections and parts of the pages (keys: English texts)
const NAMES = {
  notes: 'My notes', chapters: 'Chapters', contradictions: 'Contradictions', answer: 'Answer', question: 'Question',
  relies: 'What it relies on', sources: 'Sources', related: 'Related', chapterAbbr: 'Ch.', leftForHuman: '(Left for the human.)',
  bookNote: 'Note',
};
export const V = () => Object.fromEntries(Object.entries(NAMES).map(([k, en]) => [k, P(en)]));
/** A regular expression for the name of a section in every language: any('notes'). */
export const any = (k) => anyP(NAMES[k]);

/** The abbreviations of page and section in all languages, for regular expressions: `(?:p\.|pp\.|с\.|…)`. */
export const pageUnits = () => `(?:${[...new Set([...Pall('p.'), ...Pall('pp.'), ...Pall('sect.'), 'с.', 'стр.', 'разд.'])].map(esc).join('|')})`;

/**
 * An object or array that is computed again on every access: for constants with translatable text, so that they follow
 * the language changed while the server is running.
 */
export const lazy = (fn) => new Proxy({}, {
  get: (_, k) => Reflect.get(Object(fn()), k),
  has: (_, k) => k in Object(fn()),
  ownKeys: () => Reflect.ownKeys(Object(fn())),
  getOwnPropertyDescriptor: (_, k) => { const d = Object.getOwnPropertyDescriptor(Object(fn()), k); return d && { ...d, configurable: true }; },
});
