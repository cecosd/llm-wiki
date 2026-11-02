// Инсталиране на езиков пакет на съдържанието (виж content.js за командата и server.js за смяната от интерфейса).
// Език на съдържанието: npm run content -- <код>   (например bg или en)
// Инсталира езиковия пакет от content/<код>/ на мястото, където го чете Claude Code:
//   CLAUDE.md, .claude/skills/*/SKILL.md, .claude/agents/*.md, wiki/_templates/*, scripts/starter/*
// и записва `contentLang` в library.config.json (така промптовете знаят на какъв език да пише Claude).
// Страниците, които вече са в wiki/, не се пипат. Нов език: копирай content/en/ като content/<код>/ и го преведи.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.js';

const CONTENT = path.join(ROOT, 'content');
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


/** Инсталира пакета content/<код>/ и записва contentLang. Връща { ok, files, backedUp } или { ok: false }. */
export function installPack(code) {
  if (!packs().includes(code)) return { ok: false };
  let backedUp = false;
  const claude = path.join(ROOT, 'CLAUDE.md');
  if (fs.existsSync(claude)) {
    const cur = fs.readFileSync(claude, 'utf8');
    const same = packs().some((p) => { const f = path.join(CONTENT, p, 'CLAUDE.md'); return fs.existsSync(f) && fs.readFileSync(f, 'utf8') === cur; });
    if (!same) { fs.copyFileSync(claude, claude + '.bak'); backedUp = true; } // редактиран на ръка: пазим копие
  }
  let files = 0;
  for (const [from, to] of plan(code)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to); files++;
  }
  const cfgFile = path.join(ROOT, 'library.config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { /* още няма настройки */ }
  cfg.contentLang = code;
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
  return { ok: true, files, backedUp };
}
