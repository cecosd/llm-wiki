// Обновяване на пакетите от „Настройки → Обновления“, само в рамките на версиите в package.json (npm update).
// Основните версии (напр. 1.x → 2.x) не се инсталират оттук: те може да искат друг Node или да чупят кода.
//
// Файлът ползва САМО вградените модули на Node: в изолацията го пуска стартерът ОТВЪН (sandbox.js), а пакет,
// внесен оттук, би се изпълнил с всичките ти права. Нищо от заявката не се приема наготово: имената трябва да са
// преки зависимости от package.json (отвътре той е само за четене), а версиите ги избира npm по диапазоните в него.
// Инсталационните скриптове на пакетите не се пускат (--ignore-scripts, както и в .npmrc).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SAFE_ARGS = ['--ignore-scripts', '--no-audit', '--no-fund'];
/** Код на изход, с който сървърът казва на стартера „пусни ме отново“ (след обновяване на пакетите) */
export const RESTART_CODE = 75;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Преките зависимости (dependencies и devDependencies) от package.json */
export function directDeps(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  return new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
}

/** Само имена на преки зависимости, без повторения. Празен списък значи „всички“. null при непознато име. */
export function cleanNames(root, names) {
  if (names == null) return [];
  if (!Array.isArray(names) || names.length > 200) return null;
  const deps = directDeps(root), out = [];
  for (const n of names) {
    if (typeof n !== 'string' || !NAME_RE.test(n) || !deps.has(n)) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Инсталираните версии на преките зависимости (от node_modules, не от package-lock.json) */
export function installedVersions(root) {
  const out = {};
  for (const n of directDeps(root)) {
    try { out[n] = readJson(path.join(root, 'node_modules', n, 'package.json')).version || null; } catch { out[n] = null; }
  }
  return out;
}

/** Пуска npm без ръчен вход. Връща { ok, log } или { ok: false, error } с последните редове от изхода. */
export function runNpm(root, args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(IS_WIN ? 'npm.cmd' : 'npm', args, { cwd: root, shell: IS_WIN, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ ok: false, error: e.message }); }
    let out = '';
    const keep = (d) => { out = (out + d).slice(-4000); };
    child.stdout.setEncoding('utf8').on('data', keep);
    child.stderr.setEncoding('utf8').on('data', keep);
    const timer = setTimeout(() => { try { child.kill(); } catch { /* вече е спрял */ } }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const tail = out.trim().split('\n').slice(-3).join(' ').slice(0, 400);
      resolve(code === 0 ? { ok: true, log: tail } : { ok: false, error: tail || `npm exited with ${code}` });
    });
  });
}

let busy = false;

/**
 * Обновява избраните пакети (или всички при празен списък) до най-новата версия, която package.json позволява.
 * Връща { ok, changed: [{ name, from, to }], lockChanged, backup }. backup е предишният package-lock.json:
 * пази се САМО в паметта на процеса, който обновява (в изолацията: стартерът), и никога не се връща към клетката.
 * Ако npm спре по средата, предишните версии се връщат веднага.
 */
export async function updatePackages(root, names, { npm = runNpm } = {}) {
  const list = cleanNames(root, names);
  if (!list) return { ok: false, error: 'unknown-package' };
  if (busy) return { ok: false, error: 'busy' };
  busy = true;
  try {
    const lockFile = path.join(root, 'package-lock.json');
    const backup = fs.existsSync(lockFile) ? fs.readFileSync(lockFile, 'utf8') : null;
    const before = installedVersions(root);
    const r = await npm(root, ['update', ...list, ...SAFE_ARGS]);
    const lockNow = fs.existsSync(lockFile) ? fs.readFileSync(lockFile, 'utf8') : null;
    const lockChanged = lockNow !== backup;
    if (!r.ok) {
      if (lockChanged && backup != null) await restoreLock(root, backup, { npm });
      return { ok: false, error: r.error || 'npm', changed: [], lockChanged: false };
    }
    const after = installedVersions(root);
    const changed = Object.keys(after).filter((n) => before[n] !== after[n]).map((n) => ({ name: n, from: before[n], to: after[n] }));
    return { ok: true, changed, lockChanged, backup };
  } finally { busy = false; }
}

/** Връща предишните версии: записва стария package-lock.json и инсталира точно него (npm ci). */
export async function restoreLock(root, backup, { npm = runNpm } = {}) {
  if (typeof backup !== 'string' || !backup) return { ok: false, error: 'no-backup' };
  fs.writeFileSync(path.join(root, 'package-lock.json'), backup);
  return npm(root, ['ci', ...SAFE_ARGS]);
}
