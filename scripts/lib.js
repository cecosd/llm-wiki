// Shared helper functions for the scripts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RAW = path.join(ROOT, 'raw');
export const WIKI = path.join(ROOT, 'wiki');
export const OUTPUTS = path.join(ROOT, 'outputs');
export const EXTRACTED = path.join(RAW, '.extracted');
export const MANIFEST = path.join(RAW, 'manifest.json');

export const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/** Recursive walk; skips hidden files and folders. */
export function walk(dir, { includeHidden = false } = {}) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!includeHidden && e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, { includeHidden }));
    else out.push(full);
  }
  return out;
}

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return { files: {} };
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

export function saveManifest(m) {
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
}

/** All raw files (without inbox and .extracted). */
export function rawFiles() {
  return walk(RAW).filter((f) => {
    const r = rel(f);
    return !r.startsWith('raw/inbox/') && !r.endsWith('.gitkeep') && r !== 'raw/manifest.json';
  });
}

/** All wiki pages with parsed frontmatter. */
export function wikiPages() {
  return walk(WIKI)
    .filter((f) => f.endsWith('.md') && !rel(f).startsWith('wiki/_templates/'))
    .map((f) => {
      const src = fs.readFileSync(f, 'utf8');
      let data = {}, content = src, fmError = null;
      try { ({ data, content } = matter(src)); } catch (e) { fmError = e.message; }
      // YAML turns 2026-10-28 into a Date; turn it back into text
      for (const [k, v] of Object.entries(data)) if (v instanceof Date) data[k] = v.toISOString().slice(0, 10);
      return { file: f, rel: rel(f), slug: path.basename(f, '.md'), data, content, fmError };
    });
}

/** Extracts [[wikilinks]] (outside code blocks). */
export function extractLinks(content) {
  const clean = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  const links = [];
  for (const m of clean.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    links.push(m[1].trim().split('/').pop());
  }
  return links;
}

// ---------- Recognising processed files ----------
// The path from raw_path and the path on disk are compared after normalising, because the same
// letter can be stored differently (for example "й" in NFC and NFD), and Claude may write
// ./raw/..., raw\books\... or an absolute path. Without this a processed file looks unprocessed.

/** Canonical form: NFC, forward slashes, starting at raw/ */
export function normRaw(p) {
  const s = String(p ?? '').normalize('NFC').replace(/\\/g, '/').trim().replace(/^["']|["']$/g, '');
  const m = s.match(/(?:^|\/)(raw\/.+)$/);
  return m ? m[1] : s.replace(/^\.\//, '');
}
/** Comparison key (case-insensitive, as on macOS and Windows) */
export const rawKey = (p) => normRaw(p).toLowerCase();

/**
 * The file with the extracted text for the raw_path of a page, or null. raw_path is written by Claude and can be forged
 * by a document (raw/../../other-file), so the path is accepted only when it stays inside raw/.extracted/.
 */
export function extractedPathOf(rawPath) {
  if (!rawPath) return null;
  const f = path.resolve(EXTRACTED, path.relative('raw', normRaw(rawPath)) + '.md');
  const r = path.relative(EXTRACTED, f);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? f : null;
}

/** Map: key -> source page. A chapter with raw_path (a book merged from separately uploaded files) also counts as processed. */
export function sourceIndex(pages) {
  const m = new Map();
  for (const p of pages) if ((p.data.type === 'source' || p.data.type === 'chapter') && p.data.raw_path) m.set(rawKey(p.data.raw_path), p);
  return m;
}

/** Splits the raw files into processed and pending; also finds source pages without a file */
export function ingestState(pages = wikiPages(), files = rawFiles()) {
  const sources = sourceIndex(pages);
  const onDisk = new Map(files.map((f) => [rawKey(rel(f)), f]));
  const pending = files.filter((f) => !sources.has(rawKey(rel(f))));
  const done = files.filter((f) => sources.has(rawKey(rel(f))));
  const broken = [...sources].filter(([k]) => !onDisk.has(k)).map(([, p]) => p);
  const nonCanonical = [...sources].filter(([k, p]) => onDisk.has(k) && String(p.data.raw_path) !== normRaw(rel(onDisk.get(k))))
    .map(([k, p]) => ({ page: p, written: String(p.data.raw_path), canonical: normRaw(rel(onDisk.get(k))) }));
  const resolve = (rawPath) => onDisk.get(rawKey(rawPath)) || null;
  return { pending, done, broken, nonCanonical, resolve };
}

export const slugify = (s) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** Starting wiki/index.md, log.md and overview.md: created only when missing (never overwrite yours). */
export function ensureStarter() {
  const dir = path.join(ROOT, 'scripts', 'starter');
  if (!fs.existsSync(dir)) return;
  fs.mkdirSync(WIKI, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    const dst = path.join(WIKI, f);
    if (!fs.existsSync(dst)) fs.copyFileSync(path.join(dir, f), dst);
  }
}
