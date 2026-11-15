// Translations (i18n): the interface and the messages of the server.
// The key is the English text; locales/<code>.json translates it. A missing translation shows the key itself,
// so a new language can be incomplete. New language: copy locales/en.json as locales/<code>.json,
// change "_meta" and translate the values (see README, section "Languages").
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ROOT } from './lib.js';
import { aiName } from './providers.js';

export const LOCALES_DIR = path.join(ROOT, 'locales');
const FALLBACK = 'en';
const CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const als = new AsyncLocalStorage();
const cache = new Map(); // code -> { mtime, data }

function load(code) {
  if (!CODE_RE.test(code)) return null;
  const file = path.join(LOCALES_DIR, `${code}.json`);
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = cache.get(code);
    if (hit && hit.mtime === mtime) return hit.data;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const data = { code, name: String(raw._meta?.name || code), messages: raw.messages && typeof raw.messages === 'object' ? raw.messages : {} };
    cache.set(code, { mtime, data });
    return data;
  } catch { return null; }
}

/** The available languages: [{ code, name }], in alphabetical order of the code. */
export function locales() {
  let files = [];
  try { files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')); } catch { /* there is no locales folder */ }
  return files.map((f) => load(f.slice(0, -5))).filter(Boolean).map(({ code, name }) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
}

export const messagesFor = (code) => load(code)?.messages || {};
export const hasLocale = (code) => !!load(code);

function fromCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) { try { return decodeURIComponent(v.join('=')); } catch { return ''; } }
  }
  return '';
}

/** Language of a request: the `lang` cookie, then Accept-Language, then LIB_LANG or the system language, then English. */
export function pickLang(req) {
  const c = fromCookie(req.headers.cookie, 'lang');
  if (c && hasLocale(c)) return c;
  for (const part of String(req.headers['accept-language'] || '').split(',')) {
    const tag = part.split(';')[0].trim();
    if (!tag) continue;
    if (hasLocale(tag)) return tag;
    const base = tag.split('-')[0].toLowerCase();
    if (hasLocale(base)) return base;
  }
  return systemLang();
}

/** Language for console scripts and for work without a request. */
export function systemLang() {
  const env = process.env.LIB_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  const base = env.split(/[._@]/)[0].replace('_', '-');
  if (base && hasLocale(base)) return base;
  const short = base.split('-')[0].toLowerCase();
  return short && hasLocale(short) ? short : FALLBACK;
}

/** Runs fn with a chosen language: every t() inside (and in its async continuations) translates into it. */
export const runWithLang = (lang, fn) => als.run(lang, fn);
export const currentLang = () => als.getStore() || systemLang();

const fmt = (s, args) => (args && args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] ?? m)) : s);

/** Translation by English key; `{0}`, `{1}` are replaced from args, and `{ai}` by the name of the chosen model (providers.js). */
export function t(key, args) {
  const s = fmt(messagesFor(currentLang())[key] ?? key, args);
  return s.includes('{ai}') ? s.replace(/\{ai\}/g, aiName()) : s;
}

export const $t = t; // the short name is the same as in the interface (in modules `t` is often a local variable)

/**
 * Language of the wiki content (the pages Claude writes). It differs from the interface language.
 * Set with `npm run content -- <bg|en>` (writes `contentLang` into library.config.json);
 * without a setting it is guessed from CLAUDE.md (Cyrillic at the start = bg, otherwise en).
 */
export function contentLang() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'library.config.json'), 'utf8')).contentLang;
    if (c && CODE_RE.test(c)) return c;
  } catch { /* no setting */ }
  try {
    return /[\u0400-\u04FF]/.test(fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').slice(0, 300)) ? 'bg' : 'en';
  } catch { return 'en'; }
}
