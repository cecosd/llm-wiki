// Updating the packages from "Settings -> Updates", only within the versions in package.json (npm update).
// Major versions (for example 1.x -> 2.x) are not installed from here: they may need another Node or break the code.
//
// This file uses ONLY the built-in Node modules: in the isolation the launcher runs it OUTSIDE (sandbox.js), and a package
// imported here would run with all your rights. Nothing from the request is taken as given: the names must be
// direct dependencies of package.json (from inside it is read-only), and npm chooses the versions by the ranges in it.
// The install scripts of the packages are not run (--ignore-scripts, as in .npmrc).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SAFE_ARGS = ['--ignore-scripts', '--no-audit', '--no-fund'];
/** The exit code with which the server tells the launcher "start me again" (after the packages were updated) */
export const RESTART_CODE = 75;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** The direct dependencies (dependencies and devDependencies) of package.json */
export function directDeps(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  return new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
}

/** Only names of direct dependencies, without repeats. An empty list means "all". null for an unknown name. */
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

/** The installed versions of the direct dependencies (from node_modules, not from package-lock.json) */
export function installedVersions(root) {
  const out = {};
  for (const n of directDeps(root)) {
    try { out[n] = readJson(path.join(root, 'node_modules', n, 'package.json')).version || null; } catch { out[n] = null; }
  }
  return out;
}

/** Runs npm without a manual sign-in. Returns { ok, log } or { ok: false, error } with the last lines of the output. */
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
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already stopped */ } }, timeoutMs);
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
 * Updates the chosen packages (or all, with an empty list) to the newest version that package.json allows.
 * Returns { ok, changed: [{ name, from, to }], lockChanged, backup }. backup is the previous package-lock.json:
 * it is kept ONLY in the memory of the process that updates (in the isolation: the launcher), and never goes back to the cage.
 * If npm stops halfway, the previous versions are put back at once.
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

/** Puts the previous versions back: writes the old package-lock.json and installs exactly it (npm ci). */
export async function restoreLock(root, backup, { npm = runNpm } = {}) {
  if (typeof backup !== 'string' || !backup) return { ok: false, error: 'no-backup' };
  fs.writeFileSync(path.join(root, 'package-lock.json'), backup);
  return npm(root, ['ci', ...SAFE_ARGS]);
}
