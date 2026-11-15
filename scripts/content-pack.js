// Installing a content language pack (see content.js for the command and server.js for switching from the interface).
// Content language: npm run content -- <code>   (for example bg or en)
// Installs the language pack from content/<code>/ where Claude Code reads it:
//   CLAUDE.md, .claude/skills/*/SKILL.md, .claude/agents/*.md, wiki/_templates/*, scripts/starter/*
// and writes `contentLang` into library.config.json (so the prompts know which language Claude writes in).
// The pages already in wiki/ are not touched. New language: copy content/en/ as content/<code>/ and translate it.
// Uses ONLY the built-in Node modules (no lib.js): this way the isolation launcher (sandbox.js) calls it outside
// the cage without loading a single package.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const CLAUDE = path.join(ROOT, 'CLAUDE.md');
const CONFIG = path.join(ROOT, 'library.config.json');
export const packs = () => fs.existsSync(CONTENT) ? fs.readdirSync(CONTENT).filter((d) => fs.statSync(path.join(CONTENT, d)).isDirectory()) : [];

/** [from, to] for every file of the pack */
function plan(code) {
  const dir = path.join(CONTENT, code);
  const out = [];
  const add = (from, to) => { if (fs.existsSync(from)) out.push([from, path.join(ROOT, to)]); };
  add(path.join(dir, 'CLAUDE.md'), 'CLAUDE.md');
  const list = (sub) => (fs.existsSync(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub)) : []);
  for (const s of list('skills')) add(path.join(dir, 'skills', s, 'SKILL.md'), path.join('.claude', 'skills', s, 'SKILL.md'));
  for (const f of list('agents')) add(path.join(dir, 'agents', f), path.join('.claude', 'agents', f));
  for (const f of list('templates')) add(path.join(dir, 'templates', f), path.join('wiki', '_templates', f));
  for (const f of list('starter')) add(path.join(dir, 'starter', f), path.join('scripts', 'starter', f));
  return out;
}

/** Can it be written here: the file itself if it exists, otherwise the nearest existing folder above it. */
export function canWrite(p) {
  let cur = p;
  while (!fs.existsSync(cur)) { const up = path.dirname(cur); if (up === cur) return false; cur = up; }
  try { fs.accessSync(cur, fs.constants.W_OK); return true; } catch { return false; }
}

/**
 * Installs the pack content/<code>/ and writes contentLang. Returns { ok, files, backedUp }, { ok: false } for an unknown
 * pack, or { ok: false, readOnly: true } if some place is read-only (then nothing is touched).
 * In the isolation CLAUDE.md, .claude/ and scripts/ are read-only, so that a compromised package cannot replace them. Then
 * the launcher outside (sandbox.js) copies those (only, config: false), and the server inside the rest (only: canWrite).
 */
export function installPack(code, { only = () => true, config = true } = {}) {
  if (!packs().includes(code)) return { ok: false };
  const steps = plan(code).filter(([, to]) => only(to));
  const backup = only(CLAUDE) && fs.existsSync(CLAUDE);
  const targets = [...steps.map(([, to]) => to), ...(backup ? [CLAUDE + '.bak'] : []), ...(config ? [CONFIG] : [])];
  if (targets.some((t) => !canWrite(t))) return { ok: false, readOnly: true };
  let backedUp = false;
  if (backup) {
    const cur = fs.readFileSync(CLAUDE, 'utf8');
    const same = packs().some((p) => { const f = path.join(CONTENT, p, 'CLAUDE.md'); return fs.existsSync(f) && fs.readFileSync(f, 'utf8') === cur; });
    if (!same) { fs.copyFileSync(CLAUDE, CLAUDE + '.bak'); backedUp = true; } // edited by hand: keep a copy
  }
  let files = 0;
  for (const [from, to] of steps) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to); files++;
  }
  if (config) {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { /* there are no settings yet */ }
    cfg.contentLang = code;
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  }
  return { ok: true, files, backedUp };
}
