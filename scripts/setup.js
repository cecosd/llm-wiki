// Инсталационен екран: проверява какво трябва, за да работи приложението, и казва как да се оправи всяка стъпка.
// Проверките са безплатни (не викат модела). Единствената платена е „Опитай връзката“ (testClaude), и тя е по желание.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, RAW, WIKI } from './lib.js';
import { $t, contentLang } from './i18n.js';
import { findClaude, askClaude } from './agent.js';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const run = (cmd, args, shell = false) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000, windowsHide: true, shell });

function claudeVersion(bin) {
  const r = bin.shell ? run(`"${bin.cmd}"`, ['--version'], true) : run(bin.cmd, ['--version']);
  return r.status === 0 ? (r.stdout || '').trim().split('\n')[0] : null;
}

/** `claude auth status` връща JSON без да харчи токени. Връща { known, loggedIn, method, email, plan }. */
function claudeAuth(bin) {
  const r = bin.shell ? run(`"${bin.cmd}"`, ['auth', 'status'], true) : run(bin.cmd, ['auth', 'status']);
  try {
    const j = JSON.parse(r.stdout || '');
    return { known: true, loggedIn: !!j.loggedIn, method: j.authMethod || null, email: j.email || null, plan: j.subscriptionType || null };
  } catch {
    // По-стара версия без `auth status`: не можем да знаем без платена заявка
    return { known: false, loggedIn: false };
  }
}

/**
 * По какви условия се обработват данните: потребителски план (обучението зависи от настройка на акаунта)
 * или търговски (Team, Enterprise, API: без обучение по подразбиране). Самата настройка не може да се прочете отвън.
 */
export function accountTerms() {
  const bin = findClaude();
  if (!bin || !claudeVersion(bin)) return { terms: 'unknown', plan: null };
  const a = claudeAuth(bin);
  if (!a.known || !a.loggedIn) return { terms: 'unknown', plan: null };
  const plan = String(a.plan || '').toLowerCase();
  if (['free', 'pro', 'max', 'ultra'].includes(plan)) return { terms: 'consumer', plan };
  if (['team', 'enterprise'].includes(plan)) return { terms: 'commercial', plan };
  if (/api|key|console/i.test(String(a.method || ''))) return { terms: 'commercial', plan: 'api' };
  return { terms: 'unknown', plan: plan || null };
}

const count = (dir) => { try { return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length; } catch { return 0; } };

export function checkSetup() {
  const steps = [];
  const add = (s) => steps.push({ required: true, ...s });

  // 1. Node.js
  const major = Number(process.versions.node.split('.')[0]);
  add({ id: 'node', title: $t('Node.js 20 or newer'), ok: major >= 20, detail: $t('Installed: {0}', ['v' + process.versions.node]),
    fix: $t('Install the current version from nodejs.org, then start the library again.') });

  // 2. Зависимости
  const deps = fs.existsSync(path.join(ROOT, 'node_modules', 'express'));
  add({ id: 'deps', title: $t('Libraries are installed'), ok: deps, detail: deps ? $t('The folder node_modules is in place.') : $t('The folder node_modules is missing.'),
    fix: $t('Run this once in the project folder:'), cmd: 'npm install' });

  // 3. Claude Code
  const bin = findClaude();
  const ver = bin ? claudeVersion(bin) : null;
  add({ id: 'claude', title: $t('Claude Code is installed'), ok: !!ver, detail: ver ? ver : $t('The command claude was not found.'),
    fix: $t('Install Claude Code (it reads and writes the pages for you), then reload this page.'),
    cmd: IS_WIN ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash',
    link: 'https://docs.claude.com/en/docs/claude-code/setup' });

  // 4. Вход в акаунта
  let auth = { known: false, loggedIn: false };
  if (ver) auth = claudeAuth(bin);
  steps.push({
    id: 'login', required: true, title: $t('You are signed in to your Claude account'),
    ok: auth.loggedIn, unknown: !!ver && !auth.known,
    detail: !ver ? $t('Install Claude Code first.')
      : auth.loggedIn ? [auth.email, auth.plan && ($t('plan') + ' ' + auth.plan)].filter(Boolean).join(' · ') || $t('Signed in.')
      : auth.known ? $t('Not signed in.') : $t('This version of Claude Code cannot say whether you are signed in. Use “Test the connection”.'),
    fix: $t('Run claude in a terminal and sign in with a Claude subscription (Pro or Max) or an Anthropic API key. You only do this once.'),
    cmd: 'claude', test: !!ver,
  });

  // 5. git (точки за връщане)
  const git = run('git', ['--version']);
  add({ id: 'git', title: $t('git, for restore points'), required: false, ok: git.status === 0, detail: git.status === 0 ? (git.stdout || '').trim() : $t('git was not found.'),
    fix: $t('Without git everything works, but the “Undo” button after Claude’s changes will not be available.'), link: 'https://git-scm.com/downloads',
    cmd: IS_WIN ? 'winget install --id Git.Git -e' : IS_MAC ? 'brew install git' : 'sudo apt install git' });

  // 6. OCR (по желание)
  const ocr = process.env.LIBRARY_OCR !== 'builtin' && run('ocrmypdf', ['--version']).status === 0;
  add({ id: 'ocr', title: $t('OCR for scanned PDFs'), required: false, ok: ocr, cmd: IS_WIN ? null : IS_MAC ? 'brew install ocrmypdf' : 'sudo apt install ocrmypdf',
    detail: ocr ? $t('ocrmypdf is installed (best quality).') : $t('The built-in OCR will be used. It is slower and less exact than ocrmypdf.'),
    fix: $t('Optional: install ocrmypdf for better recognition of scanned books.'), link: 'https://ocrmypdf.readthedocs.io/en/latest/installation.html' });

  // 7. Език
  const code = contentLang();
  add({ id: 'lang', title: $t('Language of the library'), required: false, ok: true, detail: $t('Now: {0}. Change it from the language menu in the sidebar.', [code]) });

  // 8. Първи файл
  const files = ['inbox', 'books', 'papers', 'articles', 'web', 'data', 'notes', 'images', 'other'].reduce((n, d) => n + count(path.join(RAW, d)), 0);
  const pages = count(path.join(WIKI, 'sources'));
  add({ id: 'first', title: $t('Your first source'), required: false, ok: files + pages > 0,
    detail: files + pages > 0 ? $t('{0} files, {1} source pages.', [files, pages]) : $t('The library is empty.'),
    fix: $t('Drop a PDF, EPUB or text file on the home page, or use “Add an article” with a DOI or an address.'), href: '#/find' });

  const blocking = steps.filter((s) => s.required && !s.ok && !s.unknown).length;
  return { steps, ready: blocking === 0, blocking };
}

/** Кратка платена проверка: праща една дума на най-лекия модел. Стартира се само по натискане на бутон. */
export async function testClaude() {
  const r = await askClaude({ prompt: 'Reply with the single word: ok', model: 'haiku', maxTurns: 1, timeoutMs: 60000 });
  return r.ok ? { ok: true } : { ok: false, kind: r.kind, error: r.error };
}
