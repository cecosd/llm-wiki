// The reader: the text of the books by pages (the extracted text in raw/.extracted). Used by the server and by the archive.
import fs from 'node:fs';
import path from 'node:path';
import { RAW } from './lib.js';

const unitCache = new Map(); // file -> { mtime, units: Map(n -> text), unit, order }

/** Splits the extracted text by the markers <!-- стр. N --> or <!-- раздел N -->. */
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

/** The file with the extracted text of a raw file (raw/.extracted/<path>.md), or null if there is none */
export function extractedFile(rawFile) {
  const ex = path.join(RAW, '.extracted', path.relative(RAW, rawFile) + '.md');
  return fs.existsSync(ex) ? ex : null;
}
