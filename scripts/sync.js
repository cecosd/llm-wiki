// Резервни копия и синхронизация с други папки (друг диск, споделена папка, Drive/Dropbox/pCloud, мрежов диск).
// Цел е обикновена папка. Три вида:
//   backup: копие за disaster recovery: винаги записва нашето в целта; старите версии и изтритите файлове отиват в _deleted/
//   sync:   обща папка с други хора: ако в целта има чужди промени, пита (вземи / презапиши / остави)
//   pull:   само вземане от копие на колега (сливане), нищо не се записва в чуждата папка
// Сравнението е на три: нашето, това в целта и снимката на целта от последния път (outputs/.sync/<id>.json).
// Изтриванията на другите не се вземат. Нашите изтривания не трият в целта (освен при backup, където отиват в _deleted/).
// Само вградени модули на Node: тази логика се ползва и от стартера в бъдеще.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib.js';
import { $t } from './i18n.js';

const CONFIG = path.join(ROOT, 'library.config.json');
const STATE_DIR = path.join(ROOT, 'outputs', '.sync');
export const DATA_ITEMS = ['raw', 'wiki', 'drafts', 'outputs', '.library-git'];
export const CODE_ITEMS = ['scripts', 'content', 'locales', 'docs', 'tests', '.claude', 'package.json', 'package-lock.json', 'CLAUDE.md', 'README.md', 'README.bg.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'PROJECT-HISTORY.md', 'install.sh', 'install.ps1', 'install.cmd', '.gitignore', '.npmrc'];
const MACHINE = ['library.config.json'];
/** Лично за всеки човек: в обща папка не се качва, за да не се презаписва чуждото (настройки, колекции, история за „Върни“) */
const PERSONAL = ['outputs', '.library-git'];
const SECRETS = ['.library-secrets.json', '.library-auth.json'];
const PULL = ['raw/', 'wiki/', 'drafts/'];
const PUSH_ONLY_FILES = new Set(['wiki/index.md', 'wiki/overview.md']);
const LOG = 'wiki/log.md';
const MANIFEST = 'raw/manifest.json';
const SKIP_DIRS = new Set(['node_modules', '.git', '.trash', '_deleted', '.ocr-data']);
const SKIP_PREFIX = ['outputs/archive/', 'outputs/.sync/'];
const MODES = ['backup', 'sync', 'pull'];
const TEXT = /\.(md|txt)$/i;

const posix = (p) => p.split(path.sep).join('/');
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);

// ---------- Настройки (library.config.json, ключ "sync") ----------
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } }
function writeConfig(c) { fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2) + '\n'); }

export function listTargets() { const t = readConfig().sync?.targets; return Array.isArray(t) ? t : []; }
const findTarget = (idOrName) => listTargets().find((t) => t.id === idOrName || t.name === idOrName);

/** Windows и UNC адреси от WSL: D:\Копия става /mnt/d/Копия. */
export function normTargetPath(p) {
  let s = String(p || '').trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  if (process.platform === 'linux') {
    const m = s.match(/^([A-Za-z]):[\\/](.*)$/);
    if (m) s = `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
    else if (/^\\\\/.test(s)) return '';
  }
  return path.resolve(s);
}

/** Проверка на папката за целта: не е в проекта, пише се в нея, има ли място. */
export function checkTarget(input, { create = true } = {}) {
  const p = normTargetPath(input);
  if (!p) return { ok: false, error: $t('Write the full path of a folder. Network paths in WSL must be mounted first.') };
  if (!path.isAbsolute(p) || path.parse(p).root === p) return { ok: false, error: $t('Choose a folder, not the root of a disk.') };
  const r = path.relative(ROOT, p);
  if (!r || (!r.startsWith('..') && !path.isAbsolute(r))) return { ok: false, error: $t('The folder cannot be inside the library.') };
  const back = path.relative(p, ROOT);
  if (!back.startsWith('..') && !path.isAbsolute(back)) return { ok: false, error: $t('The folder cannot contain the library.') };
  // Виртуален диск (pCloud Drive и подобни) или немонтиран диск в WSL: /mnt/<буква> липсва или не се пише
  const drive = p.match(/^\/mnt\/([a-z])(?:\/|$)/);
  if (drive && !fs.existsSync(`/mnt/${drive[1]}`)) return { ok: false, error: $t('The drive {0}: is not mounted in WSL. A virtual drive (for example pCloud Drive) is not visible there. Use a normal folder, such as pCloud Sync or a folder on C: or E:.', [drive[1].toUpperCase()]) };
  try {
    if (!fs.existsSync(p)) { if (!create) return { ok: true, path: p, exists: false, empty: true }; fs.mkdirSync(p, { recursive: true }); }
    if (!fs.statSync(p).isDirectory()) return { ok: false, error: $t('This is a file, not a folder.') };
    const t = path.join(p, `.llm-wiki-write-test-${process.pid}`);
    fs.writeFileSync(t, 'x'); fs.unlinkSync(t);
  } catch (e) {
    const wsl = drive && ['EACCES', 'EPERM', 'EROFS'].includes(e.code);
    return { ok: false, error: wsl ? $t('WSL cannot write to this drive ({0}). Virtual drives such as pCloud Drive are not normal disks. Use a normal folder, such as pCloud Sync or a folder on C: or E:, and let the cloud program upload it.', [e.code]) : $t('The folder cannot be written: {0}', [e.code || e.message]) };
  }
  let free = null; try { const s = fs.statfsSync(p); free = Number(s.bavail) * Number(s.bsize); } catch { /* не всяка файлова система казва */ }
  const meta = readMeta(p);
  return { ok: true, path: p, exists: true, empty: fs.readdirSync(p).length === 0, free, meta };
}

export function saveTarget(input = {}) {
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, error: $t('Give the copy a name.') };
  const c = checkTarget(input.path);
  if (!c.ok) return c;
  const cfg = readConfig();
  const targets = Array.isArray(cfg.sync?.targets) ? cfg.sync.targets : [];
  if (targets.some((t) => t.id !== input.id && path.resolve(t.path) === c.path)) return { ok: false, error: $t('This folder is already a target.') };
  const mode = MODES.includes(input.mode) ? input.mode : 'backup';
  const keepDays = Math.min(3650, Math.max(1, Number(input.keepDays) || 30));
  const item = { id: input.id || `t${crypto.randomBytes(4).toString('hex')}`, name, path: c.path, mode, code: !!input.code && mode !== 'pull', secrets: !!input.secrets && mode === 'backup', keepDays };
  const i = targets.findIndex((t) => t.id === item.id);
  if (i >= 0) targets[i] = item; else targets.push(item);
  writeConfig({ ...cfg, sync: { ...(cfg.sync || {}), targets } });
  return { ok: true, target: item, check: c };
}

export function deleteTarget(id) {
  const cfg = readConfig();
  const targets = (cfg.sync?.targets || []).filter((t) => t.id !== id);
  if (targets.length === (cfg.sync?.targets || []).length) return false;
  writeConfig({ ...cfg, sync: { ...(cfg.sync || {}), targets } });
  try { fs.rmSync(path.join(STATE_DIR, `${id}.json`), { force: true }); } catch { /* няма снимка */ }
  return true;
}

// ---------- Снимка на целта и мета данни ----------
function readBase(id) { try { return JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${id}.json`), 'utf8')); } catch { return { files: {}, declined: {}, last: null }; } }
function writeBase(id, b) { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(path.join(STATE_DIR, `${id}.json`), JSON.stringify(b)); }
function readMeta(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, '.llm-wiki-sync.json'), 'utf8')); } catch { return null; } }

// ---------- Сканиране и хешове ----------
const cache = { loaded: false, map: {}, dirty: false };
function loadCache() {
  if (cache.loaded) return;
  cache.loaded = true;
  try { cache.map = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'hashes.json'), 'utf8')); } catch { cache.map = {}; }
}
function saveCache() {
  if (!cache.dirty) return;
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(path.join(STATE_DIR, 'hashes.json'), JSON.stringify(cache.map)); cache.dirty = false; } catch { /* кешът не е задължителен */ }
}
function fileHash(abs, st) {
  loadCache();
  const c = cache.map[abs];
  if (c && c[0] === st.size && c[1] === Math.floor(st.mtimeMs)) return c[2];
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(abs, 'r'); const buf = Buffer.allocUnsafe(1 << 20);
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  const sum = h.digest('hex');
  cache.map[abs] = [st.size, Math.floor(st.mtimeMs), sum]; cache.dirty = true;
  return sum;
}

function walkInto(out, root, relPath) {
  const abs = path.join(root, relPath);
  let st; try { st = fs.lstatSync(abs); } catch { return; }
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(abs))) return;
    for (const n of fs.readdirSync(abs)) walkInto(out, root, relPath + '/' + n);
    return;
  }
  const r = relPath;
  if (!st.isFile() || /Zone\.Identifier$|\.DS_Store$|Thumbs\.db$|\.lock$|\.tmp-sync-/.test(r) || SKIP_PREFIX.some((p) => r.startsWith(p))) return;
  out.set(r, { abs, size: st.size, mtimeMs: st.mtimeMs });
}

/** rel → { abs, size, mtimeMs, sha }. */
export function scan(root, { code = false, personal = true } = {}) {
  const out = new Map();
  for (const it of [...DATA_ITEMS, ...(code ? CODE_ITEMS : [])]) if (personal || !PERSONAL.includes(it)) walkInto(out, root, it);
  for (const [r, f] of out) f.sha = fileHash(f.abs, f);
  saveCache();
  return out;
}

const cat = (r) => (CODE_ITEMS.some((c) => r === c || r.startsWith(c + '/')) ? 'code' : r.startsWith('raw/.extracted/') ? 'extracted' : r.startsWith('raw/') ? 'raw' : r.startsWith('wiki/') ? 'wiki' : r.startsWith('drafts/') ? 'drafts' : r.startsWith('outputs/') ? 'outputs' : 'history');
const pullable = (r) => PULL.some((p) => r.startsWith(p)) && !PUSH_ONLY_FILES.has(r) && r !== LOG && r !== MANIFEST;

// ---------- Дневник и manifest: сливане без загуба ----------
const blocks = (t) => String(t || '').split(/^(?=## )/m).map((b) => b.trimEnd()).filter(Boolean);
function mergeLog(mine, theirs) {
  const have = new Set(blocks(mine));
  const extra = blocks(theirs).filter((b) => b.startsWith('## ') && !have.has(b));
  return { text: extra.length ? mine.trimEnd() + '\n\n' + extra.join('\n\n') + '\n' : mine, added: extra.length };
}
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
function mergeManifest(aFile, bFile, keys) { // добавя към aFile записите от bFile (само нови; keys ограничава)
  let a = { files: {} }, b = { files: {} };
  try { a = JSON.parse(readText(aFile)) || a; } catch { /* празен */ }
  try { b = JSON.parse(readText(bFile)) || b; } catch { /* празен */ }
  a.files = a.files || {};
  let n = 0;
  for (const [k, v] of Object.entries(b.files || {})) if (!a.files[k] && (!keys || keys.has(k))) { a.files[k] = v; n++; }
  if (n) { fs.mkdirSync(path.dirname(aFile), { recursive: true }); fs.writeFileSync(aFile, JSON.stringify(a, null, 2) + '\n'); }
  return n;
}

// ---------- Разлика по абзаци ----------
const paras = (t) => String(t).replace(/\r\n/g, '\n').trimEnd().split(/\n[ \t]*\n/);
const joinParas = (a) => a.join('\n\n') + '\n';

/** Сегменти: { same: [абзаци] } или { mine: [...], theirs: [...] }. */
export function paraDiff(mine, theirs) {
  const a = paras(mine), b = paras(theirs);
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const am = a.slice(s, a.length - e), bm = b.slice(s, b.length - e);
  const segs = [];
  if (s) segs.push({ same: a.slice(0, s) });
  if (am.length * bm.length > 4_000_000) segs.push({ mine: am, theirs: bm });
  else {
    const n = am.length, m = bm.length, w = m + 1, L = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * w + j] = am[i] === bm[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0, j = 0, cur = null;
    const flush = () => { if (cur) { segs.push(cur); cur = null; } };
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) { if (!cur || !cur.same) { flush(); cur = { same: [] }; } cur.same.push(am[i]); i++; j++; }
      else {
        if (!cur || cur.same) { flush(); cur = { mine: [], theirs: [] }; }
        if (j < m && (i >= n || L[i * w + j + 1] >= L[(i + 1) * w + j])) cur.theirs.push(bm[j++]); else cur.mine.push(am[i++]);
      }
    }
    flush();
  }
  if (e) segs.push({ same: a.slice(a.length - e) });
  return segs;
}
/** choices: по един избор ('m' моето, 't' тяхното, 'b' и двете) за всяка разлика по ред. */
export function applyChoices(segs, choices) {
  let k = 0; const out = [];
  for (const g of segs) {
    if (g.same) { out.push(...g.same); continue; }
    const c = choices[k++] || 'm';
    if (c !== 't') out.push(...g.mine);
    if (c !== 'm') out.push(...g.theirs);
  }
  return joinParas(out);
}

// ---------- Файлови операции ----------
function copyAtomic(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const tmp = `${to}.tmp-sync-${process.pid}`;
  fs.copyFileSync(from, tmp);
  const st = fs.statSync(from);
  try { fs.utimesSync(tmp, st.atime, st.mtime); } catch { /* някои дискове не позволяват */ }
  fs.renameSync(tmp, to);
}
function writeAtomic(to, text) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const tmp = `${to}.tmp-sync-${process.pid}`;
  fs.writeFileSync(tmp, text); fs.renameSync(tmp, to);
}
function moveAway(root, r, bucket) { // старата версия отива в _deleted/<време>/
  const from = path.join(root, r), to = path.join(root, '_deleted', bucket, r);
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); } catch { fs.copyFileSync(from, to); fs.unlinkSync(from); }
  return true;
}
function pruneDeleted(root, keepDays) {
  const dir = path.join(root, '_deleted'); let n = 0;
  if (!fs.existsSync(dir)) return 0;
  const limit = Date.now() - keepDays * 86400000;
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d);
    try { if (fs.statSync(f).mtimeMs < limit) { fs.rmSync(f, { recursive: true, force: true }); n++; } } catch { /* продължава */ }
  }
  return n;
}

// ---------- План ----------
const progress = { busy: false, target: '', phase: '', done: 0, total: 0, error: '' };
export const syncStatus = () => ({ ...progress });
let report = null, lastReport = 0;
/** Сървърът пуска копирането в отделна нишка и получава напредъка оттук. */
export const onProgress = (fn) => { report = fn; };
const tick = (force = false) => { if (report && (force || Date.now() - lastReport > 150)) { lastReport = Date.now(); report({ ...progress }); } };

// Само резервното копие носи и личното (настройки, история, код). Общата папка е за raw, wiki и drafts.
function view(t) { return { code: !!t.code && t.mode === 'backup', personal: t.mode === 'backup' }; }

/** Какво ще се случи със синхронизацията, без да се пипа нищо. */
export function plan(idOrTarget) {
  const t = typeof idOrTarget === 'string' ? findTarget(idOrTarget) : idOrTarget;
  if (!t) return { ok: false, error: $t('There is no such copy.') };
  const c = checkTarget(t.path, { create: t.mode !== 'pull' });
  if (!c.ok) return c;
  const local = scan(ROOT, view(t)), remote = scan(c.path, view(t));
  const base = readBase(t.id);
  const out = { ok: true, target: t, push: [], incoming: [], conflicts: [], declined: [], same: 0, keptDeleted: 0, theirDeletes: 0, mirror: [], logNew: 0, bytes: 0 };
  const all = new Set([...local.keys(), ...remote.keys()]);
  for (const r of [...all].sort()) {
    const L = local.get(r), R = remote.get(r), B = base.files[r];
    if (r === MANIFEST || (L && R && L.sha === R.sha)) { if (L && R) out.same++; continue; }
    if (r === LOG) {
      if (R && L) { if (mergeLog(readText(L.abs), readText(R.abs)).added) { out.logNew = mergeLog(readText(L.abs), readText(R.abs)).added; out.incoming.push({ rel: r, kind: 'log', cat: 'wiki', count: out.logNew }); } if (mergeLog(readText(R.abs), readText(L.abs)).added && t.mode !== 'pull') out.push.push(r); }
      else if (L && !R && t.mode !== 'pull') out.push.push(r);
      else if (R && !L) out.incoming.push({ rel: r, kind: 'new', cat: 'wiki', size: R.size });
      continue;
    }
    const pull = pullable(r) && t.mode !== 'backup';
    if (!R) { // нашето, няма го в целта
      if (t.mode !== 'pull') { out.push.push(r); out.bytes += L.size; }
      continue;
    }
    if (!L) { // има го само в целта
      if (B && B === R.sha) { out.keptDeleted++; if (t.mode === 'backup') out.mirror.push(r); continue; } // ние сме го трили
      if (!pull) { if (t.mode === 'backup' && B) out.mirror.push(r); continue; }
      if (base.declined[r] === R.sha) { out.declined.push(r); continue; }
      out.incoming.push({ rel: r, kind: 'new', cat: cat(r), size: R.size });
      continue;
    }
    // различно съдържание
    if (!pull || t.mode === 'backup') { if (t.mode !== 'pull') { out.push.push(r); out.bytes += L.size; } continue; }
    const mineChanged = B !== L.sha, theirsChanged = B !== R.sha;
    if (!theirsChanged) { if (t.mode !== 'pull') { out.push.push(r); out.bytes += L.size; } }
    else if (!mineChanged) {
      if (base.declined[r] === R.sha) out.declined.push(r);
      else out.incoming.push({ rel: r, kind: 'changed', cat: cat(r), size: R.size, text: TEXT.test(r) });
    } else if (base.declined[r] === R.sha && t.mode === 'pull') out.declined.push(r);
    else out.conflicts.push({ rel: r, cat: cat(r), text: TEXT.test(r), mine: { size: L.size, mtime: L.mtimeMs }, theirs: { size: R.size, mtime: R.mtimeMs } });
  }
  // Какво точно ще се изпрати: по видове, и списък (до 400 реда) за прозореца
  out.pushSummary = {};
  out.pushInfo = out.push.map((r) => ({ rel: r, kind: remote.has(r) ? 'changed' : 'new', cat: cat(r), size: local.get(r)?.size || 0 }));
  for (const f of out.pushInfo) { const g = (out.pushSummary[f.cat] ||= { n: 0, bytes: 0, new: 0, changed: 0 }); g.n++; g.bytes += f.size; g[f.kind]++; }
  out.pushInfo = out.pushInfo.slice(0, 400);
  out.mirrorMore = Math.max(0, out.mirror.length - 100); out.mirror = out.mirror.slice(0, 100);
  out.needsAnswer = t.mode !== 'backup' && (out.incoming.length > 0 || out.conflicts.length > 0);
  out.counts = { push: out.push.length, incoming: out.incoming.length, conflicts: out.conflicts.length, declined: out.declined.length, same: out.same };
  out.last = base.last;
  return out;
}

/** Разлика по абзаци за един файл, за прозореца за преглед. */
export function diffFile(id, r) {
  const t = findTarget(id);
  if (!t) return { ok: false, error: $t('There is no such copy.') };
  const rr = String(r || '');
  if (!/^[\w.\-/ ()а-яА-Я]+$/u.test(rr) || rr.includes('..')) return { ok: false, error: $t('Not a valid file.') };
  const lf = path.join(ROOT, rr), rf = path.join(normTargetPath(t.path), rr);
  const info = (f) => { try { const s = fs.statSync(f); return { size: s.size, mtime: s.mtimeMs }; } catch { return null; } };
  const res = { ok: true, rel: rr, mine: info(lf), theirs: info(rf), text: TEXT.test(rr) };
  if (res.text && res.mine && res.theirs) res.segments = paraDiff(readText(lf), readText(rf));
  else if (res.text && res.theirs) res.preview = readText(rf).slice(0, 4000);
  return res;
}

// ---------- Изпълнение ----------
/**
 * strategy: 'push' (само нашето; чуждото се оставя), 'overwrite' (презаписва и чуждите промени в целта; старото отива в _deleted),
 *           'review' (decisions: { rel: 'theirs' | 'mine' | { choices: ['m','t','b',...] } }; без решение = пропуска)
 */
export function run(id, { strategy = 'push', decisions = {} } = {}) {
  const t = findTarget(id);
  if (!t) return { ok: false, error: $t('There is no such copy.') };
  if (progress.busy) return { ok: false, error: $t('Another copy is running. Wait for it to finish.') };
  progress.busy = true; progress.target = t.name; progress.phase = 'plan'; progress.done = 0; progress.total = 0; progress.error = ''; tick(true);
  const lock = path.join(normTargetPath(t.path), '.llm-wiki-sync.lock');
  try {
    const p = plan(t);
    if (!p.ok) return p;
    const root = p.target.path;
    try { const age = Date.now() - fs.statSync(lock).mtimeMs; if (age < 600000) return { ok: false, error: $t('Someone else is copying to this folder right now. Try again in a few minutes.') }; } catch { /* няма заключване */ }
    fs.writeFileSync(lock, `${os.hostname()} ${new Date().toISOString()}\n`);
    const bucket = stamp(), mergedDir = path.join(ROOT, 'outputs', 'merged', `sync-${bucket}`);
    const base = readBase(t.id);
    const res = { ok: true, pushed: 0, pulled: 0, merged: 0, skipped: 0, moved: 0, bytes: 0, log: 0, warnings: [] };
    const backupMine = (r) => { const f = path.join(ROOT, r); if (fs.existsSync(f)) { const to = path.join(mergedDir, r); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(f, to); } };
    const touched = new Set(); const pulledRaw = new Set();
    const lf = (r) => path.join(ROOT, r), rf = (r) => path.join(root, r);

    // 1. Вземане (само при преглед)
    const toPush = new Set(p.push);
    progress.phase = 'pull'; tick(true);
    if (strategy === 'review' && t.mode !== 'backup') {
      const items = [...p.incoming, ...p.conflicts];
      progress.total = items.length;
      for (const it of items) {
        const r = it.rel, d = decisions[r];
        progress.done++; tick();
        const R = fs.existsSync(rf(r)) ? scan1(rf(r)) : null;
        if (it.kind === 'log') { // записите се добавят, без да се губи нищо
          if (d !== 'mine' && d) { const m = mergeLog(readText(lf(r)), readText(rf(r))); if (m.added) { writeAtomic(lf(r), m.text); res.log += m.added; touched.add(r); } toPush.add(r); }
          else res.skipped++;
          continue;
        }
        if (!d) { res.skipped++; continue; }
        if (d === 'theirs') { backupMine(r); copyAtomic(rf(r), lf(r)); res.pulled++; touched.add(r); if (cat(r) === 'raw') pulledRaw.add(r); }
        else if (d === 'mine') {
          if (it.kind === 'changed' || it.kind === 'new') { base.declined[r] = R?.sha; res.skipped++; } // чуждата версия не се пита втори път
          else toPush.add(r); // конфликт: остава нашето и презаписва тяхното (старото отива в _deleted)
        } else if (d?.choices && TEXT.test(r) && fs.existsSync(lf(r))) {
          backupMine(r);
          const text = applyChoices(paraDiff(readText(lf(r)), readText(rf(r))), d.choices);
          writeAtomic(lf(r), text); res.merged++; touched.add(r); toPush.add(r);
        }
      }
      if (pulledRaw.size) mergeManifest(path.join(ROOT, MANIFEST), path.join(root, MANIFEST), pulledRaw);
    } else if (strategy === 'overwrite') {
      for (const it of [...p.incoming.filter((x) => x.kind === 'changed' || x.kind === 'log'), ...p.conflicts]) toPush.add(it.rel);
    }
    if (t.mode === 'pull') toPush.clear();

    // 2. Записване в целта
    progress.phase = 'push'; progress.total = toPush.size; progress.done = 0; tick(true);
    for (const r of [...toPush].sort()) {
      progress.done++; tick();
      if (r === MANIFEST) continue;
      if (r === LOG) {
        const m = mergeLog(readText(rf(r)), readText(lf(r)));
        if (fs.existsSync(rf(r))) moveCopy(root, r, bucket); // старият дневник се пази
        writeAtomic(rf(r), fs.existsSync(rf(r)) ? m.text.trimEnd() + '\n' : readText(lf(r)));
        res.pushed++; continue;
      }
      try {
        if (fs.existsSync(rf(r))) { if (moveAway(root, r, bucket)) res.moved++; }
        copyAtomic(lf(r), rf(r)); res.pushed++; res.bytes += fs.statSync(lf(r)).size;
      } catch (e) { res.warnings.push(`${r}: ${e.code || e.message}`); }
    }
    if (t.mode !== 'pull') { // manifest: обединение; машинните файлове: еднопосочно и само в резервно копие
      mergeManifest(rf(MANIFEST), lf(MANIFEST), null);
      const machine = t.mode === 'backup' ? [...MACHINE, ...(t.secrets ? SECRETS : [])] : [];
      for (const f of machine) if (fs.existsSync(lf(f))) { try { copyAtomic(lf(f), path.join(root, '_machine', f)); } catch (e) { res.warnings.push(`${f}: ${e.code || e.message}`); } }
      if (t.mode === 'backup') for (const r of p.mirror) if (moveAway(root, r, bucket)) res.moved++; // изтритите при нас отиват в _deleted
      pruneDeleted(root, t.keepDays || 30);
    }

    // 3. Нова снимка: за какво сме съгласни с целта сега
    progress.phase = 'finish';
    const after = scan(root, view(t)), mine = scan(ROOT, view(t));
    for (const [r, f] of after) { const m = mine.get(r); if (m && m.sha === f.sha) base.files[r] = f.sha; }
    for (const r of Object.keys(base.files)) if (!after.has(r) && !mine.has(r)) delete base.files[r];
    base.last = { at: new Date().toISOString(), strategy, pushed: res.pushed, pulled: res.pulled + res.merged, skipped: res.skipped, ok: res.warnings.length === 0, by: os.hostname() };
    writeBase(t.id, base);
    if (t.mode !== 'pull') fs.writeFileSync(path.join(root, '.llm-wiki-sync.json'), JSON.stringify({ app: 'llm-wiki', at: base.last.at, by: os.hostname(), files: after.size, mode: t.mode }, null, 2) + '\n');
    res.touched = [...touched];
    res.undoBackup = res.pulled + res.merged ? posix(path.relative(ROOT, mergedDir)) : null;
    return res;
  } catch (e) {
    progress.error = e.message;
    return { ok: false, error: $t('The copy stopped: {0}', [e.code || e.message]) };
  } finally {
    try { fs.rmSync(lock, { force: true }); } catch { /* няма */ }
    progress.busy = false; progress.phase = ''; tick(true);
  }
}
function scan1(abs) { const st = fs.statSync(abs); return { sha: fileHash(abs, st), size: st.size }; }
function moveCopy(root, r, bucket) {
  const to = path.join(root, '_deleted', bucket, r); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(root, r), to);
}

/** Сравнява нашето с целта: какво липсва и какво е различно. */
export function verify(id) {
  const t = findTarget(id);
  if (!t) return { ok: false, error: $t('There is no such copy.') };
  const c = checkTarget(t.path, { create: false });
  if (!c.ok) return c;
  const l = scan(ROOT, view(t)), r = scan(c.path, view(t));
  const missing = [], different = [];
  for (const [k, f] of l) { if (k === MANIFEST || k === LOG) continue; const x = r.get(k); if (!x) missing.push(k); else if (x.sha !== f.sha) different.push(k); }
  return { ok: true, files: l.size, missing: missing.slice(0, 200), different: different.slice(0, 200), missingCount: missing.length, differentCount: different.length };
}

/** Информация за списъка в настройките. */
export function targetsView() {
  return listTargets().map((t) => {
    const b = readBase(t.id); const c = checkTarget(t.path, { create: false });
    return { ...t, last: b.last, declined: Object.keys(b.declined || {}).length, online: c.ok, free: c.free ?? null, error: c.ok ? '' : c.error };
  });
}
export function forgetDeclined(id) { const b = readBase(id); b.declined = {}; writeBase(id, b); return true; }

// ---------- Възстановяване (нова машина, изгорял диск) ----------
/** Копира от папка с копие в проекта. Без apply само показва. Файл, който се различава, се пише само с force (нашият отива в outputs/merged/). */
export function restore(srcInput, { apply = false, force = false } = {}) {
  const c = checkTarget(srcInput, { create: false });
  if (!c.ok) return c;
  if (!c.exists) return { ok: false, error: $t('There is no such folder.') };
  const src = scan(c.path, { code: true }), mine = scan(ROOT, { code: true });
  const res = { ok: true, apply, copy: [], differ: [], same: 0, machine: [], bytes: 0 };
  for (const [r, f] of src) {
    const m = mine.get(r);
    if (!m) { res.copy.push(r); res.bytes += f.size; } else if (m.sha !== f.sha) res.differ.push(r); else res.same++;
  }
  for (const f of [...MACHINE, ...SECRETS]) {
    const s = path.join(c.path, '_machine', f);
    if (fs.existsSync(s) && (force || !fs.existsSync(path.join(ROOT, f)))) res.machine.push(f);
  }
  if (apply) {
    const dir = path.join(ROOT, 'outputs', 'merged', `restore-${stamp()}`);
    const todo = [...res.copy, ...(force ? res.differ : [])];
    for (const r of todo) {
      const to = path.join(ROOT, r);
      if (fs.existsSync(to)) { const bk = path.join(dir, r); fs.mkdirSync(path.dirname(bk), { recursive: true }); fs.copyFileSync(to, bk); }
      copyAtomic(src.get(r).abs, to);
    }
    for (const f of res.machine) copyAtomic(path.join(c.path, '_machine', f), path.join(ROOT, f));
    res.restored = todo.length;
  }
  return res;
}

// ---------- Командният ред ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const flag = (n) => rest.includes(n) || arg === n;
  const out = (o) => console.log(JSON.stringify(o, null, 2));
  const fail = (m) => { console.error(m); process.exit(1); };
  if (cmd === 'list') out(targetsView());
  else if (cmd === 'plan' && arg) { const p = plan(arg); if (!p.ok) fail(p.error); console.log(`${p.target.name}: ${p.counts.push} to send, ${p.counts.incoming} from others, ${p.counts.conflicts} in conflict, ${p.counts.same} the same`); }
  else if (cmd === 'run' && arg) {
    const p = plan(arg); if (!p.ok) fail(p.error);
    const s = flag('--overwrite') ? 'overwrite' : 'push';
    if (p.needsAnswer && !flag('--overwrite') && !flag('--push-only')) fail(`In ${p.target.name} there are ${p.counts.incoming} changes from others and ${p.counts.conflicts} conflicts. Review them in the app, or use --push-only (leave theirs) or --overwrite.`);
    const r = run(arg, { strategy: s }); if (!r.ok) fail(r.error);
    console.log(`Sent ${r.pushed} files, old versions moved: ${r.moved}${r.warnings.length ? ', warnings: ' + r.warnings.length : ''}`);
  } else if (cmd === 'restore' && arg) {
    const r = restore(arg, { apply: flag('--apply'), force: flag('--force') }); if (!r.ok) fail(r.error);
    console.log(`${r.apply ? 'Restored' : 'Would restore'} ${r.apply ? r.restored : r.copy.length} files; ${r.differ.length} differ${r.differ.length && !flag('--force') ? ' (use --force; yours go to outputs/merged/)' : ''}; same: ${r.same}`);
    if (!r.apply) console.log('Add --apply to copy.');
  } else console.log('Usage: node scripts/sync.js list | plan <name> | run <name> [--push-only|--overwrite] | restore <folder> [--apply] [--force]');
}
