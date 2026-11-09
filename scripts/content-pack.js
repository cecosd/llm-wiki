// Инсталиране на езиков пакет на съдържанието (виж content.js за командата и server.js за смяната от интерфейса).
// Език на съдържанието: npm run content -- <код>   (например bg или en)
// Инсталира езиковия пакет от content/<код>/ на мястото, където го чете Claude Code:
//   CLAUDE.md, .claude/skills/*/SKILL.md, .claude/agents/*.md, wiki/_templates/*, scripts/starter/*
// и записва `contentLang` в library.config.json (така промптовете знаят на какъв език да пише Claude).
// Страниците, които вече са в wiki/, не се пипат. Нов език: копирай content/en/ като content/<код>/ и го преведи.
// Ползва САМО вградените модули на Node (без lib.js): така стартерът на изолацията (sandbox.js) го вика извън
// клетката, без да зарежда нито един пакет.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const CLAUDE = path.join(ROOT, 'CLAUDE.md');
const CONFIG = path.join(ROOT, 'library.config.json');
export const packs = () => fs.existsSync(CONTENT) ? fs.readdirSync(CONTENT).filter((d) => fs.statSync(path.join(CONTENT, d)).isDirectory()) : [];

/** [откъде, накъде] за всеки файл на пакета */
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

/** Може ли да се пише тук: самият файл, ако го има, иначе най-близката съществуваща папка над него. */
export function canWrite(p) {
  let cur = p;
  while (!fs.existsSync(cur)) { const up = path.dirname(cur); if (up === cur) return false; cur = up; }
  try { fs.accessSync(cur, fs.constants.W_OK); return true; } catch { return false; }
}

/**
 * Инсталира пакета content/<код>/ и записва contentLang. Връща { ok, files, backedUp }, { ok: false } при непознат
 * пакет или { ok: false, readOnly: true }, ако някое място е само за четене (тогава нищо не е пипнато).
 * В изолацията CLAUDE.md, .claude/ и scripts/ са само за четене, за да не може пробит пакет да ги подмени. Тогава
 * стартерът отвън (sandbox.js) копира тях (only, config: false), а сървърът вътре останалото (only: canWrite).
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
    if (!same) { fs.copyFileSync(CLAUDE, CLAUDE + '.bak'); backedUp = true; } // редактиран на ръка: пазим копие
  }
  let files = 0;
  for (const [from, to] of steps) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to); files++;
  }
  if (config) {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { /* още няма настройки */ }
    cfg.contentLang = code;
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  }
  return { ok: true, files, backedUp };
}
