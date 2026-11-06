// Четецът: текстът на книгите по страници (извлеченият текст в raw/.extracted). Ползва се от сървъра и от архива.
import fs from 'node:fs';
import path from 'node:path';
import { RAW } from './lib.js';

const unitCache = new Map(); // файл → { mtime, units: Map(n → текст), unit, order }

/** Разделя извлечения текст по маркерите <!-- стр. N --> или <!-- раздел N -->. */
export function readUnits(file) {
  const mtime = fs.statSync(file).mtimeMs;
  const hit = unitCache.get(file);
  if (hit && hit.mtime === mtime) return hit;
  const text = fs.readFileSync(file, 'utf8');
  const re = /<!--\s*(стр\.|раздел)\s+(\d+)[^>]*-->/g;
  const units = new Map(); let m, last = null, unit = null;
  while ((m = re.exec(text))) {
    if (last) units.set(last.n, text.slice(last.end, m.index).trim());
    unit = m[1] === 'стр.' ? 'стр.' : 'разд.';
    last = { n: Number(m[2]), end: re.lastIndex };
  }
  if (last) units.set(last.n, text.slice(last.end).trim());
  const entry = { mtime, units, unit, order: [...units.keys()].sort((a, b) => a - b), whole: units.size ? null : text.replace(/^<!--.*?-->\s*/, '').slice(0, 60000) };
  unitCache.set(file, entry);
  if (unitCache.size > 12) unitCache.delete(unitCache.keys().next().value);
  return entry;
}

/** Файлът с извлечения текст на суров файл (raw/.extracted/<път>.md), или null, ако го няма */
export function extractedFile(rawFile) {
  const ex = path.join(RAW, '.extracted', path.relative(RAW, rawFile) + '.md');
  return fs.existsSync(ex) ? ex : null;
}
