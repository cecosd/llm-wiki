// Settings page: a new version of the code on GitHub, outdated packages, vulnerabilities and the test results.
// Checks: the page asks quietly once when the program starts (the person can turn that off in Settings -> Updates);
// everything else (packages, tests) runs only when a button is pressed.
// Nothing is installed by itself: a new version or new packages are installed only with a button, and packages only within package.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, OUTPUTS } from './lib.js';
import { $t, contentLang } from './i18n.js';
import { askOutside } from './sandbox-ipc.js';
import { updatePackages, RESTART_CODE } from './npm-update.js';
import { updateCode } from './code-update.js';

export { RESTART_CODE };

const IS_WIN = process.platform === 'win32';
// For the tests only (a local fake GitHub). It comes from the environment, never from a request, so it does not open SSRF.
const TEST_BASE = process.env.LIBRARY_GITHUB_BASE || '';
const RAW_BASE = TEST_BASE || 'https://raw.githubusercontent.com';
const API_BASE = TEST_BASE ? `${TEST_BASE}/api` : 'https://api.github.com';
const UA = 'llm-wiki-update-check';

const readPkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** owner/repo from the repository field in package.json. Whoever made a fork changes it there. */
export function repoOf(pkg = readPkg()) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '';
  const m = String(url).match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** -1 if a is older than b; 0 if equal; 1 if a is newer. Compares only the numbers major.minor.patch. */
export function compareVersions(a, b) {
  const nums = (v) => String(v).replace(/^v/, '').split(/[-+]/)[0].split('.').map((n) => Number(n) || 0);
  const [x, y] = [nums(a), nums(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  }
  return 0;
}

export function versionInfo() {
  const pkg = readPkg();
  const repo = repoOf(pkg);
  return { name: pkg.name, version: pkg.version, repo, url: repo ? `https://github.com/${repo}` : null, node: process.versions.node };
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return JSON.parse(await r.text());
}

async function getText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.text();
}

const plain = (s) => String(s).replace(/`/g, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();

/**
 * Parses CHANGELOG.md (the "Keep a Changelog" layout) into entries, in file order (newest first):
 * ## [2.2.0] - 2026-11-20, then ### groups (Added, Changed, Fixed, Breaking changes) with "- item" lines.
 * `breaking` lists the items of every group whose title contains "breaking". Headings such as [Unreleased] are skipped.
 */
export function parseChangelog(md) {
  const entries = [];
  let cur = null, group = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    const h2 = line.match(/^##\s+\[?v?(\d+\.\d+\.\d+)\]?(?:\s*[-–(]\s*([^)]*)\)?)?\s*$/);
    if (h2) { cur = { version: h2[1], date: (h2[2] || '').trim(), groups: [], breaking: [] }; entries.push(cur); group = null; continue; }
    if (/^##\s/.test(line)) { cur = null; group = null; continue; }
    if (!cur) continue;
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) { group = { title: plain(h3[1]), items: [] }; cur.groups.push(group); continue; }
    const item = line.match(/^\s{0,3}[-*]\s+(.*)$/);
    if (item && group) { group.items.push(plain(item[1])); continue; }
    if (group?.items.length && /^\s{2,}\S/.test(line)) group.items[group.items.length - 1] += ' ' + plain(line);
  }
  for (const e of entries) e.breaking = e.groups.filter((g) => /breaking/i.test(g.title)).flatMap((g) => g.items);
  return entries;
}

/** The entries newer than `from` and up to `to`, newest first */
export const notesBetween = (entries, from, to) => entries
  .filter((e) => compareVersions(e.version, from) > 0 && compareVersions(e.version, to) <= 0)
  .sort((a, b) => compareVersions(b.version, a.version));

/** Compares the local version with package.json in the main branch on GitHub. Sends only plain GET requests. */
export async function checkCode() {
  const info = versionInfo();
  if (!info.repo) return { ok: false, ...info, error: $t('The repository is not set in package.json (field repository).') };
  let remote;
  try {
    remote = await getJson(`${RAW_BASE}/${info.repo}/HEAD/package.json`);
  } catch (e) {
    return { ok: false, ...info, error: $t('GitHub could not be reached: {0}', [e.message]) };
  }
  // The last commit is only extra information: GitHub limits anonymous requests and a refusal is not an error.
  let commit = null;
  try {
    const c = await getJson(`${API_BASE}/repos/${info.repo}/commits/HEAD`);
    commit = { sha: String(c.sha || '').slice(0, 7), date: c.commit?.committer?.date || null, message: String(c.commit?.message || '').split('\n')[0], url: c.html_url || null };
  } catch { /* the check is still correct without it */ }
  const cmp = compareVersions(info.version, remote.version);
  // What changed: the entries of CHANGELOG.md between the two versions. Without a changelog the check is still valid.
  let notes = [];
  if (cmp < 0) {
    try { notes = notesBetween(parseChangelog(await getText(`${RAW_BASE}/${info.repo}/HEAD/CHANGELOG.md`)), info.version, remote.version); } catch { /* no notes */ }
  }
  const major = Number(String(remote.version).split('.')[0]) > Number(String(info.version).split('.')[0]);
  const breaking = notes.flatMap((n) => n.breaking.map((text) => ({ version: n.version, text })));
  return {
    ok: true, ...info, remote: remote.version, status: cmp < 0 ? 'behind' : cmp > 0 ? 'ahead' : 'same', commit,
    notes, breaking, major, breaks: major || breaking.length > 0, checkedAt: Date.now(),
  };
}

// The quiet check at start-up: one answer is reused for a few hours, so opening the window again does not ask GitHub again.
const QUICK_TTL = 6 * 60 * 60 * 1000;
let quickCache = null;
export async function quickCheck({ force = false } = {}) {
  if (!force && quickCache && Date.now() - quickCache.checkedAt < QUICK_TTL) return quickCache;
  const r = await checkCode();
  if (r.ok) quickCache = r;
  return r;
}

const CODE_UPDATE_ERRORS = {
  busy: () => $t('An update is already running.'),
  'no-git': () => $t('git is not installed, so the program cannot update itself. Install git (see Setup), or download the new version from the project page.'),
  'no-repo': () => $t('This folder is not linked to the project repository. Download the new version from the project page.'),
  fetch: (r) => $t('The new version could not be downloaded: {0}', [String(r.detail || '').slice(0, 200)]),
  dirty: () => $t('Some program files were changed on this computer. Review them below: the update can replace them (a copy is kept).'),
  diverged: () => $t('This copy has changes of its own that the new version does not include, so it cannot be updated automatically.'),
  merge: (r) => $t('The new version could not be applied: {0}', [String(r.detail || '').slice(0, 200)]),
  npm: (r) => $t('The new packages could not be installed, so the old version was put back: {0}', [String(r.detail || '').slice(0, 200)]),
};

/**
 * Installs the newest version of the program. In the safe mode the code folder is read-only, so the launcher outside
 * the isolation does it (sandbox.js, action "code-update"). When it worked, the caller exits with RESTART_CODE after
 * answering the page (restart: true), so that the new code is loaded.
 */
export async function installCodeUpdate({ force = false } = {}) {
  let r;
  const lang = contentLang();
  if (process.env.LIB_SANDBOX_IPC) {
    r = await askOutside('code-update', { force, lang }, { timeoutMs: 16 * 60 * 1000 });
    if (!r) return { ok: false, error: 'launcher', message: $t('The launcher outside the isolation did not answer. Stop the library and run in the project folder: git pull') };
  } else r = await updateCode(ROOT, { force, lang });
  if (!r.ok) return { ...r, message: CODE_UPDATE_ERRORS[r.error]?.(r) || $t('The update did not work: {0}', [String(r.error || '').slice(0, 200)]) };
  quickCache = null;
  return { ...r, restart: !r.upToDate && supervised(), supervised: supervised(), isolated: !!process.env.LIB_SANDBOX_IPC };
}

/** Runs npm without a manual sign-in. npm outdated and npm audit exit with code 1 when they find something: this is not an error. */
function npmJson(args, timeoutMs = 90000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(IS_WIN ? 'npm.cmd' : 'npm', args, { cwd: ROOT, shell: IS_WIN, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ ok: false, error: e.message }); }
    let out = '', err = '', done = false;
    const end = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill(); } catch {} end({ ok: false, error: $t('npm did not answer in time.') }); }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.on('error', (e) => end({ ok: false, error: e.message }));
    child.on('close', () => {
      try { end({ ok: true, data: JSON.parse(out || '{}') }); }
      catch { end({ ok: false, error: (err || out).trim().split('\n').slice(-2).join(' ').slice(0, 300) || $t('npm returned no answer.') }); }
    });
  });
}

export function parseOutdated(data) {
  return Object.entries(data || {}).map(([name, v]) => {
    const one = Array.isArray(v) ? v[0] : v; // with workspaces npm returns an array
    return { name, current: one.current || null, wanted: one.wanted || null, latest: one.latest || null,
      major: !!one.current && !!one.latest && String(one.current).split('.')[0] !== String(one.latest).split('.')[0] };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function parseAudit(data) {
  const counts = data?.metadata?.vulnerabilities || {};
  const items = Object.values(data?.vulnerabilities || {}).map((v) => ({ name: v.name, severity: v.severity, direct: !!v.isDirect, range: v.range || '' }));
  const rank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  items.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.name.localeCompare(b.name));
  return { total: counts.total || 0, critical: counts.critical || 0, high: counts.high || 0, moderate: counts.moderate || 0, low: counts.low || 0, items };
}

/** What is outdated and which known vulnerabilities there are. The requests go to the npm registry. */
export async function checkPackages() {
  const [o, a] = await Promise.all([npmJson(['outdated', '--json']), npmJson(['audit', '--json'])]);
  return {
    outdated: o.ok ? { ok: true, items: parseOutdated(o.data) } : { ok: false, error: o.error },
    audit: a.ok && a.data?.metadata ? { ok: true, ...parseAudit(a.data) } : { ok: false, error: a.error || $t('npm returned no answer.') },
  };
}

/**
 * Who will start the server again after an update: the launcher of the isolation (sandbox.js) or wsl-start.sh (LIB_SUPERVISED).
 * With `npm run serve` from a terminal there is nobody: then the person stops and starts the library themselves.
 */
export const supervised = () => !!process.env.LIB_SANDBOX_IPC || process.env.LIB_SUPERVISED === '1';

const UPDATE_ERRORS = {
  'unknown-package': () => $t('Only the packages listed in package.json can be updated from here.'),
  busy: () => $t('An update is already running.'),
};

/**
 * Updates the packages to the safe versions (npm update). In the isolation node_modules is read-only, so
 * the launcher outside does the update (sandbox.js, action "npm-update"). restart: the server must start again
 * to load the new versions; the caller exits with RESTART_CODE after it has answered the page.
 */
export async function applyUpdates(names) {
  let r;
  if (process.env.LIB_SANDBOX_IPC) {
    r = await askOutside('npm-update', { names }, { timeoutMs: 11 * 60 * 1000 });
    if (!r) return { ok: false, error: $t('The launcher outside the isolation did not answer. Stop the library and run in the project folder: npm update') };
  } else {
    const { backup, ...rest } = await updatePackages(ROOT, names); // outside the isolation there is nobody to put the old versions back by themselves
    r = rest;
  }
  if (!r.ok) return { ok: false, error: UPDATE_ERRORS[r.error]?.() || $t('npm could not update the packages: {0}', [String(r.error || '').slice(0, 300)]) };
  const changed = Array.isArray(r.changed) ? r.changed : [];
  const restart = (changed.length > 0 || !!r.lockChanged) && supervised();
  return { ok: true, changed, lockChanged: !!r.lockChanged, restart, supervised: supervised(), isolated: !!process.env.LIB_SANDBOX_IPC };
}

// ---------- Test results ----------
const RESULTS_LOCAL = path.join(OUTPUTS, 'test-results.json'); // from the last run on this computer
const RESULTS_SHIPPED = path.join(ROOT, 'docs', 'test-results.json'); // comes with the release

export function latestResults() {
  for (const [file, origin] of [[RESULTS_LOCAL, 'local'], [RESULTS_SHIPPED, 'release']]) {
    try { return { origin, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* the next one */ }
  }
  return null;
}

let testsRunning = false;
export const testsBusy = () => testsRunning;

/** Runs the tests in a separate process. They work in a temporary copy: they do not touch the library and do not call the real Claude. */
export function runTests() {
  if (testsRunning) return Promise.resolve({ ok: false, error: $t('The tests are already running.') });
  testsRunning = true;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'run-tests.js')], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 10 * 60 * 1000);
    const end = (error) => {
      clearTimeout(timer);
      testsRunning = false;
      const results = latestResults();
      resolve(error ? { ok: false, error, results } : { ok: true, results });
    };
    child.on('error', (e) => end(e.message));
    child.on('close', () => end(null)); // code 1 means "a test failed", and it is visible in the results
  });
}
