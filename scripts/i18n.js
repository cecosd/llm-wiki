// Преводи (i18n): интерфейсът и съобщенията на сървъра.
// Ключът е английският текст; locales/<код>.json го превежда. Липсващ превод показва самия ключ,
// така че нов език може да е непълен. Нов език: копирай locales/en.json като locales/<код>.json,
// промени "_meta" и преведи стойностите (виж README, раздел „Езици“).
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ROOT } from './lib.js';

export const LOCALES_DIR = path.join(ROOT, 'locales');
const FALLBACK = 'en';
const CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const als = new AsyncLocalStorage();
const cache = new Map(); // код → { mtime, data }

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

/** Наличните езици: [{ code, name }], по азбучен ред на кода. */
export function locales() {
  let files = [];
  try { files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')); } catch { /* няма папка locales */ }
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

/** Език на заявката: бисквитката `lang`, после Accept-Language, после LIB_LANG или езикът на системата, после английски. */
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

/** Език за конзолните скриптове и за работа без заявка. */
export function systemLang() {
  const env = process.env.LIB_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  const base = env.split(/[._@]/)[0].replace('_', '-');
  if (base && hasLocale(base)) return base;
  const short = base.split('-')[0].toLowerCase();
  return short && hasLocale(short) ? short : FALLBACK;
}

/** Изпълнява fn с избран език: всяко t() вътре (и в асинхронните му продължения) превежда на него. */
export const runWithLang = (lang, fn) => als.run(lang, fn);
export const currentLang = () => als.getStore() || systemLang();

const fmt = (s, args) => (args && args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] ?? m)) : s);

/** Превод по английски ключ; `{0}`, `{1}` се заместват от args. */
export function t(key, args) {
  return fmt(messagesFor(currentLang())[key] ?? key, args);
}

export const $t = t; // короткото име е същото като в интерфейса (в модулите `t` често е локална променлива)

/**
 * Език на съдържанието на wiki-то (страниците, които пише Claude). Различен е от езика на интерфейса.
 * Задава се с `npm run content -- <bg|en>` (записва `contentLang` в library.config.json);
 * без запис се познава по CLAUDE.md (кирилица в началото = bg, иначе en).
 */
export function contentLang() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'library.config.json'), 'utf8')).contentLang;
    if (c && CODE_RE.test(c)) return c;
  } catch { /* няма настройка */ }
  try {
    return /[\u0400-\u04FF]/.test(fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').slice(0, 300)) ? 'bg' : 'en';
  } catch { return 'en'; }
}
