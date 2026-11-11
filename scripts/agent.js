// Обработка с бутон: пуска Claude Code във фонов режим (`claude -p`) със скиловете на библиотеката,
// следи какво прави и го показва в интерфейса. Използва абонамента, с който си влязъл в Claude Code.
//
// Предпазни мерки:
//  - Claude може да чете всичко в папката, да пише САМО в wiki/ и да пуска само скриптовете на библиотеката.
//    Всичко друго се отказва автоматично (режим dontAsk).
//  - Преди всяка обработка се прави git точка; „Върни“ възстановява wiki/ отпреди нея.
//  - Един файл наведнъж; при изчерпан лимит опашката спира и чака.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, WIKI, OUTPUTS, EXTRACTED, RAW, rel, walk, wikiPages, ingestState, normRaw, extractLinks } from './lib.js';
import { $t, currentLang } from './i18n.js';
import { P, lazy } from './vocab.js';
import { aiConfig, aiPublic, readiness, claudeEnv } from './providers.js';
import { runPipeline, TIER_OF } from './pipeline.js';
import { errorText, msToPacificMidnight } from './llm.js';
import { repairLog, readLog } from './log-guard.js';

const SETTINGS_FILE = path.join(ROOT, 'library.config.json');
const HISTORY_FILE = path.join(OUTPUTS, '.agent-history.json');
const IS_WIN = process.platform === 'win32';

// Read е ограничен до проекта с правило. Grep и Glob трябва да са разрешени по име, иначе в режим dontAsk изчезват,
// затова и трите минават през куката guard-read.js, която важи и за подагента.
const READ_TOOLS = ['Read(./**)', 'Glob', 'Grep'];
const DENIED_TOOLS = ['WebFetch', 'WebSearch', 'Read(./.git/**)', 'Read(./.library-git/**)', 'Read(./.library-auth.json)', 'Read(./.library-secrets.json)', 'Read(./library.config.json)', 'Read(.env)', 'Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.gnupg/**)'];
// Claude Code с модел на друг доставчик: --effort е само за моделите на Anthropic
const effortFor = (effort) => (aiConfig().preset.vendor === 'Anthropic' ? effort : null);
const spawnOpts = (extra) => ({ cwd: ROOT, windowsHide: true, env: claudeEnv(), ...extra });
const ALLOWED_TOOLS = [
  'Read(./**)', 'Glob', 'Grep', 'TodoWrite',
  'Agent(chapter-reader)', // четецът на глави в икономичен режим (само чете)
  'Edit(wiki/**)', // покрива и Write: Claude Code проверява писането по Edit правилата
  'Edit(outputs/**)', // отчетите от синтеза и проверките
  'Bash(npm run pending)', 'Bash(npm run status)',
  'Bash(npm run extract)', 'Bash(npm run extract *)',
  'Bash(npm run lint)', 'Bash(npm run lint:quick)',
  'Bash(npm run fix-paths)', 'Bash(npm run new *)',
];

const systemNote = () => [
  P('You work automatically, started by a button in the interface of the library. There is no human to answer questions.'),
  P('Do not ask questions and do not wait for confirmation. You determine the emphasis of each source from the source itself, as described in CLAUDE.md.'),
  P('You write only in wiki/. Attempts at other actions will be refused; do not repeat them.'),
  P('At the end give a short report in English in 3 to 6 lines: the emphasis of the source, new and updated pages, contradictions.'),
].join(' ');

// Режими: кой модел чете и кой редактира. Скъпото е четенето на стотици страници; преценката е върху бележките.
export const MODES = lazy(() => ({
  economy: {
    label: $t('Economy'), model: 'sonnet', effort: 'medium',
    note: P('“Economy” mode: for books do NOT read the chapters yourself. For every chapter call the subagent chapter-reader (one chapter per call, with the path to the .extracted file and the range of the chapter by the markers) and work from its notes. Read only the table of contents and the introduction yourself, to determine the chapters and the emphasis. Articles and short texts you read yourself.'),
  },
  balanced: { label: $t('Balanced'), model: 'sonnet', effort: 'medium', note: '' },
  best: { label: $t('Best'), model: 'opus', effort: null, note: '' },
}));
const modeOf = (k) => MODES[k] || MODES.economy;
// Език на индексиране: преводите на понятия понякога са лоши, затова оригиналните термини могат да се пазят и търсят
export const LANG_NOTES = lazy(() => ({
  bg: '',
  both: P('Indexing language: the pages are in English, but also index the source in its ORIGINAL language. If the source is not in English: (1) in the source page add `lang: <language code>` and `original_title: <title as in the source>`; (2) for every concept and person add to `aliases` the term or the name EXACTLY as in the source, without translating from memory; (3) `tags` may include up to 3 keywords of the original (lowercase, with hyphens); (4) at first use of a concept write the term in English and the original in parentheses; (5) if the term has no established English translation, do not invent one: keep the original as the main name and add a short explanation in English. This way search finds both the translated and the original spelling.'),
  original: P('Processing language: if the source is not in English, write the source page, the chapters and the key ideas in the LANGUAGE OF THE SOURCE (this replaces the rule about the language of the pages in CLAUDE.md only for these pages). The section headings stay as in the template. In the source page add `lang: <language code>` and `original_title`. For concepts and people that already exist in English, add `aliases` with the original term; name new concepts with the original term and add a short explanation in English in the first sentence. Citations are in the language of the source.'),
}));
export const MODEL_IDS = ['haiku', 'sonnet', 'opus'];

/** Област на източника: една на източник; ползва вече съществуващите имена, за да не се разпадат на варианти */
function areaNote(kind) {
  if (kind !== 'ingest' && kind !== 'upgrade') return '';
  let names = [];
  try { names = [...new Set(wikiPages().filter((p) => p.data.type === 'source' && String(p.data.area || '').trim()).map((p) => String(p.data.area).trim()))].sort((a, b) => a.localeCompare(b, 'bg')); } catch {}
  return P('Areas: every source is in EXACTLY one area of knowledge; write it in the field `area` of the source page (1 to 3 words, in the language of the pages, a broad field such as Biology, Physics, Mathematics, not a narrow topic). ')
    + P('Existing areas: {0}. Use an existing one EXACTLY as written when it fits; create a new one only if none fits. ', [names.length ? names.join(', ') : P('none yet')])
    + (kind === 'upgrade' ? P('When upgrading, set `area` only if the source page does not have that field yet. ') : '')
    + P('Chapters, concepts and people do NOT get an `area` field: their area is determined by the books that cite them. A concept that already exists is extended in the same page, even if the new source is from another area.');
}

/** Кой модел чете главите и кой пише: избор на човека (settings.reader/writer), иначе от режима */
export function effectiveModels(settings, kind) {
  const mode = modeOf(settings.mode);
  if (kind === 'synthesis' && settings.synthesisBest) return { writer: 'opus', reader: 'opus', delegate: false, mode: 'best' };
  const writer = MODEL_IDS.includes(settings.writer) ? settings.writer : mode.model;
  const reader = MODEL_IDS.includes(settings.reader) ? settings.reader : (settings.mode === 'economy' ? 'haiku' : writer);
  return { writer, reader, delegate: kind !== 'synthesis' && reader !== writer, mode: settings.mode in MODES ? settings.mode : 'economy' };
}

/** Описание на подагента chapter-reader с избрания модел (замества файла в .claude/agents само когато моделът е различен) */
function readerAgentsJson(model) {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.claude', 'agents', 'chapter-reader.md'), 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!m) return null;
    const description = (m[1].match(/^description:\s*(.+)$/m) || [])[1] || $t('Reads one chapter');
    return JSON.stringify({ 'chapter-reader': { description, prompt: m[2].trim(), tools: ['Read', 'Grep', 'Glob'], model, ...(model === 'opus' ? {} : { effort: 'low' }) } });
  } catch {
    // няма файл на подагента: дефинираме го тук, за да работи избраният модел
    return JSON.stringify({ 'chapter-reader': { description: P('Reads ONE chapter of the extracted text of a book and returns structured notes in English. Does not write files.'), prompt: P('Read only the given range (by the markers <!-- стр. N -->) and return in English: in brief, key ideas with p. N, concepts, a quote of up to 2 sentences, claims to cross-check. Do not invent pages. No em dash.'), tools: ['Read', 'Grep', 'Glob'], model }, });
  }
}

// ---------- Помощни ----------
const now = () => new Date().toISOString();
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };

// Точките за връщане („Върни“) са в отделно git хранилище (.library-git), за да не се бъркат с git на кода и да работят,
// дори wiki/ да е в .gitignore на проекта.
const HISTORY_GIT = path.join(ROOT, '.library-git');
function git(args) {
  const r = spawnSync('git', ['-c', 'user.name=Library', '-c', 'user.email=library@localhost', '-c', 'core.quotepath=false', `--git-dir=${HISTORY_GIT}`, `--work-tree=${ROOT}`, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// Настройките на куката са в лична временна папка (само за този потребител), а не в outputs/: там Claude може да пише
// и, ако Claude Code препрочете настройките по време на работа, подведен Claude би могъл да махне куката.
let guardDir = null;
function privateGuardDir() {
  if (guardDir && fs.existsSync(guardDir)) return guardDir;
  guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-guard-')); // 0700, ново име всеки път
  process.once('exit', () => { try { fs.rmSync(guardDir, { recursive: true, force: true }); } catch {} });
  return guardDir;
}

/**
 * Аргументите за сигурност на всяко пускане на Claude. Настройките се записват наново всеки път, извън папките,
 * в които Claude има право да пише (wiki/ и outputs/).
 */
export function guardArgs() {
  const file = path.join(privateGuardDir(), 'claude-guard.json');
  const slash = (p) => p.split(path.sep).join('/');
  const hook = (script) => `"${slash(process.execPath)}" "${slash(path.join(ROOT, 'scripts', script))}"`;
  // guard-write.js не позволява Write върху wiki/log.md (дневникът се допълва с Edit)
  writeJSON(file, { hooks: { PreToolUse: [
    { matcher: 'Read|Grep|Glob', hooks: [{ type: 'command', command: hook('guard-read.js') }] },
    { matcher: 'Write', hooks: [{ type: 'command', command: hook('guard-write.js') }] },
  ] } });
  return ['--settings', file, '--disallowedTools', DENIED_TOOLS.join(',')];
}

/** Намира изпълнимия файл на claude (на Windows: claude.exe или claude.cmd от npm) */
export function findClaude() {
  if (process.env.CLAUDE_BIN) return { cmd: process.env.CLAUDE_BIN, shell: /\.(cmd|bat)$/i.test(process.env.CLAUDE_BIN) };
  const which = spawnSync(IS_WIN ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  const found = (which.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!found.length) {
    // Обичайното място от официалния инсталатор, ако PATH още не е обновен
    const guess = path.join(process.env.HOME || process.env.USERPROFILE || '', '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude');
    return fs.existsSync(guess) ? { cmd: guess, shell: false } : null;
  }
  const exe = found.find((f) => /\.exe$/i.test(f)) || found[0];
  return { cmd: exe, shell: IS_WIN && /\.(cmd|bat)$/i.test(exe) };
}

const winQuote = (a) => (/[\s"&|<>^()%!,]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

// ---------- Описание на действията на Claude на човешки език ----------
function pageTitle(file) {
  try {
    const m = fs.readFileSync(file, 'utf8').match(/^title:\s*["']?(.+?)["']?\s*$/m);
    return m ? m[1] : path.basename(file, '.md');
  } catch { return path.basename(file, '.md'); }
}

function describe(name, input, job) {
  const p = input?.file_path || input?.path || '';
  const r = p ? normRaw(path.isAbsolute(p) ? path.relative(ROOT, p) : p) : '';
  const wikiRel = p ? (path.isAbsolute(p) ? path.relative(ROOT, p) : p).split(path.sep).join('/') : '';
  switch (name) {
    case 'Read':
      if (/\.extracted\//.test(wikiRel)) {
        const off = input.offset ? $t(' (from line {0})', [input.offset]) : '';
        return { icon: 'book', text: $t('Reads “{0}”{1}', [path.basename(wikiRel).replace(/\.md$/, ''), off]) };
      }
      if (wikiRel.startsWith('wiki/')) return { icon: 'file', text: $t('Browses {0}', [pageTitle(path.join(ROOT, wikiRel))]) };
      return { icon: 'file', text: $t('Reads {0}', [r || wikiRel]) };
    case 'Write': case 'Edit': case 'MultiEdit': {
      if (!wikiRel.startsWith('wiki/')) return { icon: 'alert', text: $t('Attempt to write outside wiki/: {0}', [wikiRel]) };
      const isNew = name === 'Write' && !job.before.has(wikiRel);
      (isNew ? job.created : job.updated).add(wikiRel);
      if (isNew) job.updated.delete(wikiRel);
      const title = input?.content?.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] || pageTitle(path.join(ROOT, wikiRel));
      return { icon: isNew ? 'sparkle' : 'pen', text: isNew ? $t('Creates “{0}”', [title]) : $t('Updates “{0}”', [title]), page: path.basename(wikiRel, '.md') };
    }
    case 'Bash': {
      const c = String(input?.command || '');
      if (/npm run pending/.test(c)) return { icon: 'list', text: $t('Checks which files are new') };
      if (/npm run extract/.test(c)) return { icon: 'file', text: $t('Extracts the text') };
      if (/npm run lint/.test(c)) return { icon: 'check', text: $t('Checks the links') };
      if (/npm run fix-paths/.test(c)) return { icon: 'check', text: $t('Aligns the paths') };
      return { icon: 'list', text: $t('Runs {0}', [c.slice(0, 60)]) };
    }
    case 'Glob': case 'Grep': return { icon: 'search', text: $t('Searches the library{0}', [input?.pattern ? `: ${String(input.pattern).slice(0, 40)}` : '']) };
    case 'TodoWrite': return { icon: 'list', text: $t('Plans the steps') };
    case 'Skill': return { icon: 'sparkle', text: $t('Loads the instructions {0}', [input?.skill || '']).trim() };
    case 'Agent': case 'Task': {
      const d = String(input?.description || input?.prompt || '').replace(/\s+/g, ' ').slice(0, 70);
      return { icon: 'book', text: $t('The chapter reader is reading{0}', [d ? ': ' + d : $t(' chapter')]) };
    }
    default: return { icon: 'sparkle', text: name };
  }
}

const RETRY_MS = Number(process.env.LIBRARY_RETRY_MS) || 30 * 60 * 1000; // повторен опит след лимит// Сканиран ли е източникът: под 15 думи средно на страница (или под 30 думи общо) текстът е твърде беден
const MIN_WORDS_PER_PAGE = 15, MIN_WORDS = 30;
function pdfPageCount(file) {
  try { return (fs.readFileSync(file).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length; } catch { return 0; }
}

/** Източниците, обработени по стария стандарт, подредени по важност (колко страници сочат към тях или главите им) */
export function legacySources(pages = wikiPages()) {
  const chapterBook = new Map(pages.filter((p) => p.data.type === 'chapter').map((p) => [p.slug, extractLinks(String(p.data.book || ''))[0]]));
  const score = new Map();
  for (const p of pages) {
    if (['index', 'log'].includes(p.slug)) continue;
    const hit = new Set();
    for (const l of extractLinks(p.content)) {
      const book = chapterBook.get(l) || l;
      if (book !== p.slug && chapterBook.get(p.slug) !== book) hit.add(book);
    }
    for (const b of hit) score.set(b, (score.get(b) || 0) + 1);
  }
  const sources = pages.filter((p) => p.data.type === 'source' && p.data.raw_path);
  return {
    total: sources.length,
    current: sources.filter((p) => Number(p.data.depth) >= 2).length,
    legacy: sources.filter((p) => !(Number(p.data.depth) >= 2))
      .map((p) => ({ slug: p.slug, title: String(p.data.title || p.slug), format: p.data.format || null, raw: String(p.data.raw_path), score: score.get(p.slug) || 0 }))
      .sort((a, b) => (b.format === 'book') - (a.format === 'book') || b.score - a.score || a.title.localeCompare(b.title, 'bg')),
  };
}

const LIMIT_RE = /usage limit|rate.?limit|limit reached|лимит|5-hour|weekly limit|reset/i;
const AUTH_RE = /log ?in|logged in|authenticat|invalid api key|oauth|credential|\/login/i;

// ---------- Кратки въпроси към Claude (само четене): пътеки за учене ----------
// Три нива, както при обработката: по-лекият модел е по-евтин за лимита, по-мощният чете повече и подрежда по-грижливо.
export const PATH_LEVELS = lazy(() => ({
  light:  { label: $t('Light'),    model: 'haiku',  effort: null,     maxTurns: 10, timeoutMs: 150000, depth: 'light' },
  medium: { label: $t('Medium'), model: 'sonnet', effort: 'medium', maxTurns: 24, timeoutMs: 300000, depth: 'medium' },
  strong: { label: $t('Powerful'),  model: 'opus',   effort: null,     maxTurns: 40, timeoutMs: 480000, depth: 'strong' },
}));

/**
 * Пуска `claude -p` само с право да чете (Read, Glob, Grep). Подава въпроса през stdin, така че дългият текст
 * не минава през командния ред. Връща { ok, text } или { ok:false, kind, error }. signal прекъсва заявката.
 */
export function askClaude({ prompt, model, effort, maxTurns = 20, timeoutMs = 300000, signal }) {
  return new Promise((resolve) => {
    const bin = findClaude();
    if (!bin) return resolve({ ok: false, kind: 'no-claude', error: $t('Claude Code was not found. Install it and sign in to your account.') });
    const eff = effortFor(effort);
    const args = ['-p', '--output-format', 'json', '--model', model, ...(eff ? ['--effort', eff] : []),
      '--max-turns', String(maxTurns), '--permission-mode', 'dontAsk', '--allowedTools', READ_TOOLS.join(','), ...guardArgs()];
    const opts = spawnOpts({ stdio: ['pipe', 'pipe', 'pipe'] });
    const child = bin.shell ? spawn([winQuote(bin.cmd), ...args.map(winQuote)].join(' '), { ...opts, shell: true }) : spawn(bin.cmd, args, opts);
    let out = '', err = '', done = false;
    const end = (r) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); resolve(r); };
    const kill = () => { try { child.kill(); } catch {} if (IS_WIN) { try { spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']); } catch {} } };
    const onAbort = () => { kill(); end({ ok: false, kind: 'cancelled', error: $t('Stopped.') }); };
    const timer = setTimeout(() => { kill(); end({ ok: false, kind: 'timeout', error: $t('{ai} did not respond in {0} min. Try a lighter model or a shorter question.', [Math.round(timeoutMs / 60000)]) }); }, timeoutMs);
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort); }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    child.on('error', (e) => end({ ok: false, kind: 'spawn', error: $t('I could not start Claude Code: {0}', [e.message]) }));
    child.on('close', () => {
      let res = null; try { res = JSON.parse(out.trim().split('\n').filter(Boolean).pop() || ''); } catch {}
      const text = String(res?.result ?? err ?? '');
      if (res && !res.is_error && typeof res.result === 'string' && res.result.trim()) return end({ ok: true, text: res.result, cost: res.total_cost_usd ?? null });
      if (LIMIT_RE.test(text + err)) return end({ ok: false, kind: 'limit', error: errorText({ kind: 'limit' }) });
      if (AUTH_RE.test(text + err)) return end({ ok: false, kind: 'auth', error: aiConfig().preset.id === 'claude-code' ? $t('Claude Code is not signed in. Run `claude` once in a terminal and sign in.') : errorText({ kind: 'auth' }) });
      if (res?.subtype === 'error_max_turns') return end({ ok: false, kind: 'turns', error: $t('{ai} could not finish within the allowed steps. Try a more powerful level.') });
      end({ ok: false, kind: 'error', error: $t('{ai} returned no answer.'), detail: (text || err).slice(-1500) });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

// ---------- Агентът ----------
export function createAgent({ broadcast }) {
  const state = {
    queue: [],          // { id, kind, target, label }
    current: null,      // работещата задача
    history: readJSON(HISTORY_FILE, []),
    paused: null,       // { reason, at }
    // „ai“ (доставчикът) се чете и пише от providers.js, затова не се пази тук (иначе стара версия би го презаписала)
    settings: (({ ai, ...rest }) => ({ autoIngest: true, autoResume: true, mode: 'economy', synthesisBest: true, lang: 'both', confirmCost: true, ...rest }))(readJSON(SETTINGS_FILE, {})),
    batch: { total: 0, done: 0 }, // за „файл 2 от 5“
  };
  let child = null, seq = Date.now(), pushTimer = null, retryTimer = null;

  const claude = () => findClaude();
  const gitInfo = () => {
    if (!git(['--version']).ok) return { available: false };
    return { available: true, repo: git(['rev-parse', '--is-inside-work-tree']).ok };
  };

  function snapshot() {
    const c = state.current;
    const ai = aiPublic();
    return {
      claude: ai.engine === 'agent' ? !!claude() : true, ai, git: gitInfo(), settings: state.settings, paused: state.paused,
      queue: state.queue.map(({ id, kind, target, label }) => ({ id, kind, target, label })),
      current: c && {
        id: c.id, kind: c.kind, target: c.target, label: c.label, startedAt: c.startedAt,
        steps: c.steps.slice(-40), created: [...c.created], updated: [...c.updated], total: c.total, index: c.index,
      },
      history: state.history.slice(0, 15),
      needsOcr: needsOcr(),
      canUndo: state.history[0]?.status === 'done' && !state.history[0]?.undone && !!state.history[0]?.commitBefore,
    };
  }
  function push() { clearTimeout(pushTimer); pushTimer = setTimeout(() => broadcast({ type: 'agent', state: snapshot() }), 150); }
  const saveHistory = () => writeJSON(HISTORY_FILE, state.history.slice(0, 50));

  function ensureRepo() {
    const g = gitInfo();
    if (!g.available) return false;
    if (!g.repo) {
      git(['init']);
      git(['add', '-A', '-f', '--', 'wiki']);
      git(['commit', '-m', 'Library start', '--allow-empty']);
    }
    return true;
  }
  /** Записва текущото състояние на wiki/ (само ако има промени) и връща идентификатора му */
  function checkpoint(message) {
    if (!ensureRepo()) return null;
    git(['add', '-A', '-f', '--', 'wiki']);
    if (!git(['diff', '--cached', '--quiet']).ok) git(['commit', '-m', message, '--no-verify']);
    return git(['rev-parse', 'HEAD']).out || null;
  }
  /** Връща wiki/ към даден запис. Новите файлове на задачата (още извън git) се трият само ако тя ги е създала. */
  function restoreWiki(commit, createdByJob = []) {
    const ok = git(['restore', `--source=${commit}`, '--staged', '--worktree', '--', 'wiki']).ok;
    for (const f of createdByJob) {
      if (!f.startsWith('wiki/') || git(['cat-file', '-e', `${commit}:${f}`]).ok) continue;
      try { fs.rmSync(path.join(ROOT, f), { force: true }); } catch {}
    }
    return ok;
  }

  // --- опашка ---
  function enqueue(kind, target, label, opts) {
    const busy = (state.current && state.current.target === target) || state.queue.some((q) => q.target === target);
    if (busy) return false;
    if (!state.current && !state.queue.length) state.batch = { total: 0, done: 0 };
    state.batch.total++;
    state.queue.push({ id: String(++seq), kind, target, label, ...(opts && Object.keys(opts).length ? { opts } : {}) });
    return true;
  }

  /** opts: настройки само за тези файлове (режим, език), напр. избрани при добавяне на статия */
  function enqueuePending(paths, opts) {
    const pending = paths?.length ? paths : ingestState().pending.map((f) => normRaw(rel(f)));
    let n = 0;
    for (const p of pending) if (enqueue('ingest', p, path.basename(p), opts)) n++;
    push(); next();
    return n;
  }

  // Сканирани източници: последният опит за надграждане е спрял на проверката на текста
  function needsOcr() {
    const seen = new Set(), out = [];
    for (const h of state.history) {
      if (seen.has(h.target)) continue;
      seen.add(h.target);
      if (h.status === 'needs-ocr') out.push({ slug: h.target, title: h.label.replace(/^[^:]*: /, ''), at: h.finishedAt });
    }
    return out;
  }

  function enqueueUpgrades(slugs) {
    const { legacy } = legacySources();
    const list = slugs?.length ? legacy.filter((l) => slugs.includes(l.slug)) : legacy;
    let n = 0;
    for (const l of list) if (enqueue('upgrade', l.slug, $t('Upgrade: {0}', [l.title]))) n++;
    push(); next();
    return n;
  }

  function enqueueSynthesis(tag) {
    const ok = enqueue('synthesis', tag || '*', tag ? $t('Synthesis: #{0}', [tag]) : $t('Library synthesis'));
    push(); next();
    return ok;
  }

  function enqueueChapters(slug, title) {
    const ok = enqueue('chapters', slug, $t('Chapters: {0}', [title || slug]));
    push(); next();
    return ok;
  }

  function next() {
    if (state.current || state.paused || !state.queue.length) return;
    const cfg = aiConfig();
    const c = cfg.engine === 'agent' ? claude() : null;
    if (cfg.engine === 'agent' && !c) { state.paused = { reason: 'no-claude', at: now() }; push(); return; }
    if (!readiness(cfg).ok) { state.paused = { reason: 'no-ai', at: now() }; push(); return; }
    const job = {
      ...state.queue.shift(), steps: [], created: new Set(), updated: new Set(), startedAt: now(),
      before: new Set(walk(WIKI).map((f) => rel(f))),
      logBefore: readLog(path.join(WIKI, 'log.md')), // дневникът преди задачата: проверява се в finish()
      index: state.batch.done + 1, total: Math.max(state.batch.total, state.batch.done + 1),
    };
    state.current = job;
    job.commitBefore = checkpoint(`Before processing: ${job.label}`);
    const intro = { chapters: $t('Starting to split into chapters'), upgrade: $t('Starting the upgrade'), synthesis: $t('Starting the synthesis across sources') }[job.kind] || $t('Starting to process “{0}”', [job.label]);
    step(job, { icon: 'sparkle', text: intro });
    if (job.kind === 'upgrade' && !preflight(job)) return;
    job.provider = cfg.provider;
    if (cfg.engine === 'agent') run(job, c); else runWithoutTools(job, cfg);
  }

  /** Обработка без инструменти (pipeline.js): сървърът подава текста на части и пише страниците сам */
  function runWithoutTools(job, cfg) {
    const st = { ...state.settings, ...(job.opts || {}) };
    const eff = effectiveModels(st, job.kind);
    const tiers = { reader: TIER_OF[eff.reader] || 'light', writer: TIER_OF[eff.writer] || 'medium' };
    if (cfg.engine === 'manual') { tiers.reader = 'medium'; tiers.writer = 'medium'; }
    job.mode = eff.mode;
    job.abort = new AbortController();
    job.usage = { in: 0, out: 0, cost: 0, calls: 0, costKnown: true };
    step(job, { icon: 'sparkle', text: cfg.engine === 'manual'
      ? $t('Without tools: every step is a request that you copy into the chat of {0}', [cfg.name])
      : $t('Without tools: {0} · writing: {1} · reading: {2}', [cfg.name, cfg.models[tiers.writer], cfg.models[tiers.reader]]) });
    runPipeline(job.kind, job.target, { job, signal: job.abort.signal, step: (s) => step(job, s), settings: st, tiers, cfg, usage: job.usage })
      .then((r) => finish(job, { status: 'done', message: r.report }))
      .catch((e) => {
        if (job.cancelled || e.kind === 'cancelled') return finish(job, { status: 'cancelled', message: $t('Stopped by you.') });
        if (e.kind === 'limit') return finish(job, { status: 'limited', message: errorText(e, cfg) + ' ' + $t('The queue is waiting.'), detail: e.message });
        // Дневен лимит: опашката чака колкото казва доставчикът (Groq), иначе до полунощ тихоокеанско време (Google)
        if (e.kind === 'daily') return finish(job, { status: 'limited', message: errorText(e, cfg) + ' ' + $t('The queue is waiting.'), detail: e.message, retryMs: e.retryAfter ? e.retryAfter * 1000 + 60000 : msToPacificMidnight() + 120000 });
        if (!e.kind) return finish(job, { status: 'error', message: $t('The processing stopped with an error.'), detail: String(e.stack || e).slice(0, 2000) });
        finish(job, { status: 'error', message: errorText(e, cfg), detail: String(e.detail || e.message || '').slice(0, 2000) });
      });
  }

  /** Преди надграждане: извлича текста наново (с OCR при нужда) и проверява, че има какво да се чете. Не харчи от лимита. */
  function preflight(job) {
    const page = wikiPages().find((p) => p.slug === job.target);
    const raw = page && ingestState().resolve(page.data.raw_path);
    if (!raw) { finish(job, { status: 'error', message: $t('The original file is missing from raw/.') }); return false; }
    step(job, { icon: 'file', text: $t('Extracting the text again (more accurate, with page numbers)') });
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'extract.js'), '--force', '--ocr', rel(raw)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    const ex = path.join(EXTRACTED, path.relative(RAW, raw) + '.md');
    let words = 0;
    try { words = Number((fs.readFileSync(ex, 'utf8').slice(0, 300).match(/думи: (\d+)/) || [])[1]) || 0; } catch {}
    if (r.status !== 0 && !words) { finish(job, { status: 'error', message: $t('Extracting the text failed.'), detail: (r.stdout || '') + (r.stderr || '') }); return false; }
    const pages = /\.pdf$/i.test(raw) ? pdfPageCount(raw) : 0;
    if (words < MIN_WORDS || (pages && words / pages < MIN_WORDS_PER_PAGE)) {
      finish(job, { status: 'needs-ocr', message: $t('There is almost no text ({0} words{1}): it is probably scanned and OCR could not extract text. Check “npm install” and try again, or add a version with text.', [words, pages ? $t(' on {0} pages', [pages]) : '']) });
      return false;
    }
    step(job, { icon: 'check', text: $t('The text is ready: {0} words', [words.toLocaleString(currentLang())]) });
    return true;
  }

  function step(job, s) { job.steps.push({ at: now(), ...s }); push(); }

  function run(job, bin) {
    const prompt = {
      chapters: `/wiki-chapters ${job.target}`,
      upgrade: `/wiki-upgrade ${job.target}`,
      synthesis: job.target === '*' ? '/wiki-synthesis' : `/wiki-synthesis ${job.target}`,
    }[job.kind] || `/wiki-ingest ${job.target}`;
    // Модел за задачата: синтезът по избор на най-силния, иначе изборът на човека, иначе режимът
    const st = { ...state.settings, ...(job.opts || {}) };
    const eff = effectiveModels(st, job.kind);
    const mode = modeOf(eff.mode);
    job.mode = eff.mode;
    const model = eff.writer;
    const effort = effortFor(job.kind === 'synthesis' && st.synthesisBest ? null : (model === 'opus' ? null : mode.effort || (model === 'sonnet' ? 'medium' : null)));
    const delegateNote = eff.delegate ? modeOf('economy').note.replace(P('“Economy” mode:'), P('Reading chapters:')) : P('You read the chapters yourself, without a subagent.');
    const note = [systemNote(), job.kind !== 'synthesis' && delegateNote, job.kind !== 'synthesis' && LANG_NOTES[st.lang], areaNote(job.kind)].filter(Boolean).join(' ');
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
      '--model', model, ...(effort ? ['--effort', effort] : []),
      '--permission-mode', 'dontAsk', '--allowedTools', ALLOWED_TOOLS.join(','), ...guardArgs(),
      '--append-system-prompt', note];
    if (eff.delegate && eff.reader !== 'haiku') { const aj = readerAgentsJson(eff.reader); if (aj) args.push('--agents', aj); }
    const cfg = aiConfig(), shown = (m) => (cfg.preset.vendor === 'Anthropic' ? m : cfg.models[TIER_OF[m]] || m);
    step(job, { icon: 'sparkle', text: $t('Writing: {0}{1}', [shown(model), eff.delegate ? $t(' · reading chapters: {0}', [shown(eff.reader)]) : $t(' · the same model reads the chapters')]) });
    child = bin.shell
      ? spawn([winQuote(bin.cmd), ...args.map(winQuote)].join(' '), spawnOpts({ shell: true, stdio: ['ignore', 'pipe', 'pipe'] }))
      : spawn(bin.cmd, args, spawnOpts({ stdio: ['ignore', 'pipe', 'pipe'] }));

    let buf = '', stderr = '', result = null;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        handle(job, ev, (r) => (result = r));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    child.on('error', (e) => finish(job, { status: 'error', message: $t('I could not start Claude Code: {0}', [e.message]) }));
    child.on('close', (code) => {
      if (job.finished) return;
      if (job.cancelled) return finish(job, { status: 'cancelled', message: $t('Stopped by you.') });
      const text = String(result?.result || stderr || '');
      if (result && !result.is_error && code === 0) return finish(job, { status: 'done', message: text.trim() });
      if (LIMIT_RE.test(text)) return finish(job, { status: 'limited', message: cfg.subscription ? $t('The subscription limit has been reached. The queue is waiting.') : errorText({ kind: 'limit' }, cfg) + ' ' + $t('The queue is waiting.'), detail: text });
      if (AUTH_RE.test(text)) return finish(job, { status: 'error', message: cfg.preset.id === 'claude-code' ? $t('Claude Code is not signed in. Run `claude` once in a terminal and sign in, then try again.') : errorText({ kind: 'auth' }, cfg), detail: text });
      return finish(job, { status: 'error', message: $t('The processing stopped with an error.'), detail: text.slice(-2000) });
    });
  }

  function handle(job, ev, setResult) {
    if (ev.type === 'system' && ev.subtype === 'init') { job.sessionId = ev.session_id; return; }
    if (ev.type === 'system' && ev.subtype === 'api_retry') {
      if (ev.error === 'rate_limit') step(job, { icon: 'clock', text: $t('Limit reached, {ai} is waiting…'), warn: true });
      return;
    }
    if (ev.type === 'system' && /denied/.test(ev.subtype || '')) { step(job, { icon: 'alert', text: $t('Action outside what is allowed was refused'), warn: true }); return; }
    if (ev.type === 'assistant' && ev.message?.content && !ev.parent_tool_use_id) {
      for (const b of ev.message.content) {
        if (b.type === 'tool_use') step(job, describe(b.name, b.input, job));
        else if (b.type === 'text' && b.text?.trim()) job.lastText = b.text.trim();
      }
      return;
    }
    if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      for (const b of ev.message.content) {
        if (b.type === 'tool_result' && b.is_error && /denied|permission|разреш/i.test(JSON.stringify(b.content || ''))) {
          step(job, { icon: 'alert', text: $t('The action was refused (outside permissions)'), warn: true });
        }
      }
      return;
    }
    if (ev.type === 'result') { job.usage = { costUsd: ev.total_cost_usd ?? null, in: ev.usage?.input_tokens ?? null, out: ev.usage?.output_tokens ?? null, cacheRead: ev.usage?.cache_read_input_tokens ?? null, cacheWrite: ev.usage?.cache_creation_input_tokens ?? null }; setResult(ev); }
  }

  /** Възстановява стари записи в дневника, ако задачата са изчезнали (вж. log-guard.js). Връща { lost } или null. */
  function restoreLogEntries(job) {
    if (job.logBefore == null) return null;
    const file = path.join(WIKI, 'log.md');
    const r = repairLog(job.logBefore, readLog(file));
    if (!r.lost) return null;
    fs.writeFileSync(file, r.text);
    return { lost: r.lost };
  }

  function finish(job, { status, message, detail, retryMs }) {
    if (job.finished) return;
    job.finished = true;
    child = null;
    let report = status === 'done' ? (message || job.lastText || '') : message;
    // Дневникът е само за добавяне: ако задачата е изтрила стари записи, връщаме ги, преди да се направи точката
    const logFix = restoreLogEntries(job);
    if (logFix) report += ' ' + $t('The log had lost {0} entries during the job; they were restored.', [logFix.lost]);
    let commitAfter = null;
    if (job.commitBefore && status === 'done') commitAfter = checkpoint(`Processed: ${job.label}`);
    else if (job.commitBefore && (job.created.size || job.updated.size)) {
      // Неуспешна или спряна обработка: без половинчати страници. Файлът остава „чака“ и ще се обработи наново.
      if (restoreWiki(job.commitBefore, [...job.created])) report += $t(' The half-finished changes in the wiki were rolled back.');
      job.created.clear(); job.updated.clear();
    }
    const titled = (set) => [...set].filter((f) => fs.existsSync(path.join(ROOT, f))).map((f) => ({ slug: path.basename(f, '.md'), title: pageTitle(path.join(ROOT, f)) }));
    const entry = {
      id: job.id, kind: job.kind, target: job.target, label: job.label, status, report, detail: detail || null,
      startedAt: job.startedAt, finishedAt: now(), created: titled(job.created), updated: titled(job.updated),
      commitBefore: job.commitBefore, commitAfter, steps: job.steps.length, sessionId: job.sessionId || null, mode: job.mode || null,
      provider: job.provider || null,
      costUsd: job.usage ? (job.usage.costUsd ?? (job.usage.costKnown ? job.usage.cost : null)) : null,
      tokens: job.usage ? { in: job.usage.in, out: job.usage.out, cacheRead: job.usage.cacheRead ?? null, cacheWrite: job.usage.cacheWrite ?? null, ...(job.usage.calls ? { calls: job.usage.calls } : {}) } : null,
    };
    state.history.unshift(entry); saveHistory();
    state.current = null;
    if (status === 'limited') {
      state.queue.unshift({ id: String(++seq), kind: job.kind, target: job.target, label: job.label });
      state.paused = { reason: 'limit', at: now() };
      scheduleRetry(retryMs);
    }
    else state.batch.done++;
    if (status === 'cancelled') state.queue = [];
    push();
    next();
  }

  // --- действия от интерфейса ---
  function cancel() {
    state.queue = [];
    clearTimeout(retryTimer); retryTimer = null;
    if (state.paused?.reason === 'limit') state.paused = null;
    if (state.current?.abort) {
      state.current.cancelled = true;
      step(state.current, { icon: 'alert', text: $t('Stopping…') });
      state.current.abort.abort();
    } else if (child && state.current) {
      state.current.cancelled = true;
      step(state.current, { icon: 'alert', text: $t('Stopping…') });
      try { child.kill(IS_WIN ? undefined : 'SIGINT'); } catch {}
      const c = child; setTimeout(() => { try { if (c && c.exitCode === null) c.kill('SIGTERM'); } catch {} }, 8000);
    }
    if (state.paused?.reason === 'no-ai' || state.paused?.reason === 'no-claude') state.paused = null;
    push();
  }

  function scheduleRetry(ms = RETRY_MS) {
    clearTimeout(retryTimer); retryTimer = null;
    if (!state.settings.autoResume || state.paused?.reason !== 'limit') return;
    state.paused.retryAt = new Date(Date.now() + ms).toISOString();
    retryTimer = setTimeout(() => { if (state.paused?.reason === 'limit') resume(); }, ms);
  }

  function resume() { clearTimeout(retryTimer); retryTimer = null; state.paused = null; push(); next(); }

  function undo(id) {
    const last = state.history[0];
    if (!last || last.id !== id) return { ok: false, error: $t('Only the last processing can be undone.') };
    if (state.current) return { ok: false, error: $t('Wait for the current processing to finish.') };
    if (!last.commitBefore) return { ok: false, error: $t('There is no restore point (git is not available).') };
    if (git(['rev-parse', 'HEAD']).out !== last.commitAfter) return { ok: false, error: $t('There are other changes in wiki/ since the processing. Undo them with git by hand.') };
    if (!restoreWiki(last.commitBefore)) return { ok: false, error: $t('git could not restore wiki/.') };
    checkpoint(`Undone processing: ${last.label}`);
    last.undone = true; saveHistory(); push();
    return { ok: true };
  }

  function setSettings(s) {
    const { ai, ...rest } = s || {};
    state.settings = { ...state.settings, ...rest };
    delete state.settings.ai;
    // Слива се с файла: другите модули също пишат в него (contentLang, ai, prices)
    writeJSON(SETTINGS_FILE, { ...readJSON(SETTINGS_FILE, {}), ...state.settings });
    if ('autoResume' in s) scheduleRetry();
    push();
    return state.settings;
  }

  /** Действие извън опашката (напр. премахване на източник): записва се в историята, за да може „Върни“. */
  function record(entry) {
    state.history.unshift({ id: String(Date.now()), status: 'done', startedAt: now(), finishedAt: now(), created: [], updated: [], steps: 0, ...entry });
    saveHistory(); push();
  }
  const isBusy = () => !!state.current || state.queue.length > 0;

  return { checkpoint, record, isBusy, snapshot, enqueuePending, enqueueChapters, enqueueUpgrades, enqueueSynthesis, cancel, resume, undo, setSettings, get settings() { return state.settings; } };
}
