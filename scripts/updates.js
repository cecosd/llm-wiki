// Страница „Настройки“: нова версия на кода в GitHub, остарели пакети, уязвимости и резултати от тестовете.
// Нищо не излиза от компютъра, докато човекът не натисне бутон: проверките тръгват само при POST заявка.
// Нищо не се инсталира автоматично: пакетите се обновяват само с бутона „Обнови“ и само в рамките на package.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, OUTPUTS } from './lib.js';
import { $t } from './i18n.js';
import { askOutside } from './sandbox-ipc.js';
import { updatePackages, RESTART_CODE } from './npm-update.js';

export { RESTART_CODE };

const IS_WIN = process.platform === 'win32';
// Само за тестовете (локален фалшив GitHub). Идва от средата, никога от заявка, затова не отваря SSRF.
const TEST_BASE = process.env.LIBRARY_GITHUB_BASE || '';
const RAW_BASE = TEST_BASE || 'https://raw.githubusercontent.com';
const API_BASE = TEST_BASE ? `${TEST_BASE}/api` : 'https://api.github.com';
const UA = 'llm-wiki-update-check';

const readPkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** owner/repo от полето repository в package.json. Който е направил fork, сменя го там. */
export function repoOf(pkg = readPkg()) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '';
  const m = String(url).match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** -1, ако a е по-стара от b; 0 при еднакви; 1, ако a е по-нова. Сравнява само числата major.minor.patch. */
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

/** Сравнява локалната версия с package.json в основния клон на GitHub. Праща само обикновени GET заявки. */
export async function checkCode() {
  const info = versionInfo();
  if (!info.repo) return { ok: false, ...info, error: $t('The repository is not set in package.json (field repository).') };
  let remote;
  try {
    remote = await getJson(`${RAW_BASE}/${info.repo}/HEAD/package.json`);
  } catch (e) {
    return { ok: false, ...info, error: $t('GitHub could not be reached: {0}', [e.message]) };
  }
  // Последният commit е само допълнителна информация: GitHub ограничава анонимните заявки и отказът не е грешка.
  let commit = null;
  try {
    const c = await getJson(`${API_BASE}/repos/${info.repo}/commits/HEAD`);
    commit = { sha: String(c.sha || '').slice(0, 7), date: c.commit?.committer?.date || null, message: String(c.commit?.message || '').split('\n')[0], url: c.html_url || null };
  } catch { /* без него проверката пак е вярна */ }
  const cmp = compareVersions(info.version, remote.version);
  return { ok: true, ...info, remote: remote.version, status: cmp < 0 ? 'behind' : cmp > 0 ? 'ahead' : 'same', commit };
}

/** Пуска npm без ръчен вход. npm outdated и npm audit излизат с код 1, когато намерят нещо: това не е грешка. */
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
    const one = Array.isArray(v) ? v[0] : v; // при работни пространства npm връща масив
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

/** Какво е остаряло и какви известни уязвимости има. Заявките отиват към регистъра на npm. */
export async function checkPackages() {
  const [o, a] = await Promise.all([npmJson(['outdated', '--json']), npmJson(['audit', '--json'])]);
  return {
    outdated: o.ok ? { ok: true, items: parseOutdated(o.data) } : { ok: false, error: o.error },
    audit: a.ok && a.data?.metadata ? { ok: true, ...parseAudit(a.data) } : { ok: false, error: a.error || $t('npm returned no answer.') },
  };
}

/**
 * Кой ще пусне сървъра отново след обновяване: стартерът на изолацията (sandbox.js) или wsl-start.sh (LIB_SUPERVISED).
 * При `npm run serve` от терминала няма кой: тогава човекът спира и пуска библиотеката сам.
 */
export const supervised = () => !!process.env.LIB_SANDBOX_IPC || process.env.LIB_SUPERVISED === '1';

const UPDATE_ERRORS = {
  'unknown-package': () => $t('Only the packages listed in package.json can be updated from here.'),
  busy: () => $t('An update is already running.'),
};

/**
 * Обновява пакетите до безопасните версии (npm update). В изолацията node_modules е само за четене, затова
 * обновяването го прави стартерът отвън (sandbox.js, действие „npm-update“). restart: сървърът трябва да се пусне отново,
 * за да зареди новите версии; извикващият излиза с RESTART_CODE, след като е отговорил на страницата.
 */
export async function applyUpdates(names) {
  let r;
  if (process.env.LIB_SANDBOX_IPC) {
    r = await askOutside('npm-update', { names }, { timeoutMs: 11 * 60 * 1000 });
    if (!r) return { ok: false, error: $t('The launcher outside the isolation did not answer. Stop the library and run in the project folder: npm update') };
  } else {
    const { backup, ...rest } = await updatePackages(ROOT, names); // извън изолацията няма кой да върне старите версии сам
    r = rest;
  }
  if (!r.ok) return { ok: false, error: UPDATE_ERRORS[r.error]?.() || $t('npm could not update the packages: {0}', [String(r.error || '').slice(0, 300)]) };
  const changed = Array.isArray(r.changed) ? r.changed : [];
  const restart = (changed.length > 0 || !!r.lockChanged) && supervised();
  return { ok: true, changed, lockChanged: !!r.lockChanged, restart, supervised: supervised(), isolated: !!process.env.LIB_SANDBOX_IPC };
}

// ---------- Резултати от тестовете ----------
const RESULTS_LOCAL = path.join(OUTPUTS, 'test-results.json'); // от последното пускане на този компютър
const RESULTS_SHIPPED = path.join(ROOT, 'docs', 'test-results.json'); // идва с изданието

export function latestResults() {
  for (const [file, origin] of [[RESULTS_LOCAL, 'local'], [RESULTS_SHIPPED, 'release']]) {
    try { return { origin, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* следващият */ }
  }
  return null;
}

let testsRunning = false;
export const testsBusy = () => testsRunning;

/** Пуска тестовете в отделен процес. Те работят във временно копие: не пипат библиотеката и не викат истинския Claude. */
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
    child.on('close', () => end(null)); // код 1 значи „има неуспешен тест“, а той се вижда в резултатите
  });
}
