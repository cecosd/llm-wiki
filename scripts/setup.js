// Setup screen: checks what the application needs to work and says how to fix each step.
// The checks are free (they do not call the model). The only paid one is "Test the connection" (testClaude), and it is optional.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, RAW, WIKI } from './lib.js';
import { $t, contentLang } from './i18n.js';
import { findClaude, askClaude } from './agent.js';
import { aiConfig, aiChosen, readiness, TIERS } from './providers.js';
import { complete, errorText } from './llm.js';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const run = (cmd, args, shell = false) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000, windowsHide: true, shell });

function claudeVersion(bin) {
  const r = bin.shell ? run(`"${bin.cmd}"`, ['--version'], true) : run(bin.cmd, ['--version']);
  return r.status === 0 ? (r.stdout || '').trim().split('\n')[0] : null;
}

/** `claude auth status` returns JSON without spending tokens. Returns { known, loggedIn, method, email, plan }. */
function claudeAuth(bin) {
  const r = bin.shell ? run(`"${bin.cmd}"`, ['auth', 'status'], true) : run(bin.cmd, ['auth', 'status']);
  try {
    const j = JSON.parse(r.stdout || '');
    return { known: true, loggedIn: !!j.loggedIn, method: j.authMethod || null, email: j.email || null, plan: j.subscriptionType || null };
  } catch {
    // An older version without `auth status`: we cannot know without a paid request
    return { known: false, loggedIn: false };
  }
}

/**
 * Under which terms the data is processed: a consumer plan (training depends on an account setting)
 * or a commercial one (Team, Enterprise, API: no training by default). The setting itself cannot be read from outside.
 */
let termsCache = null; // { key, at, value }: `claude --version` and `claude auth status` are slow and block the server while they run
export function accountTerms() {
  const cfg = aiConfig();
  const key = cfg.engine + '|' + cfg.preset.id + '|' + cfg.provider;
  if (cfg.engine !== 'manual' && !cfg.local && cfg.preset.id === 'claude-code') {
    const ttl = termsCache?.value.terms === 'unknown' ? 30_000 : 10 * 60_000; // an unknown answer is asked again soon (the person may sign in)
    if (termsCache && termsCache.key === key && Date.now() - termsCache.at < ttl) return termsCache.value;
    const value = computeTerms(cfg);
    termsCache = { key, at: Date.now(), value };
    return value;
  }
  return computeTerms(cfg);
}
function computeTerms(cfg) {
  // Another provider: the terms are theirs. A local model and manual mode send nothing by themselves.
  if (cfg.engine === 'manual') return { terms: 'manual', plan: null, provider: cfg.provider };
  if (cfg.local) return { terms: 'local', plan: null, provider: cfg.provider };
  if (cfg.preset.id !== 'claude-code') return { terms: cfg.free ? 'free-tier' : 'commercial', plan: cfg.free ? 'free' : 'api', provider: cfg.provider, vendor: cfg.preset.vendor || cfg.name };
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
  add({ id: 'node', title: $t('Node.js 24 or newer'), ok: major >= 24, detail: $t('Installed: {0}', ['v' + process.versions.node]),
    fix: $t('Install the current version from nodejs.org, then start the library again.') });

  // 2. Dependencies
  const deps = fs.existsSync(path.join(ROOT, 'node_modules', 'express'));
  add({ id: 'deps', title: $t('Libraries are installed'), ok: deps, detail: deps ? $t('The folder node_modules is in place.') : $t('The folder node_modules is missing.'),
    fix: $t('Run this once in the project folder:'), cmd: 'npm install' });

  // 3. The model: the provider is chosen in "Settings -> Model"
  const cfg = aiConfig(), ready = readiness(cfg), chosen = aiChosen();
  // Until the person picks a model, nothing about any particular provider is shown as required
  if (!chosen) {
    steps.push({ id: 'ai', required: false, title: $t('Choose an AI model'), ok: false, href: '#/settings/model', test: false,
      detail: $t('No model has been chosen yet.'),
      fix: $t('Open Settings → Model and pick one: an account with a key, a free tier, a model on this computer, or copy and paste. Each choice says what it needs.') });
  } else steps.push({
    id: 'ai', required: cfg.engine !== 'agent' || cfg.preset.id !== 'claude-code', title: $t('The model: {0}', [cfg.name]),
    ok: ready.ok, href: '#/settings', test: ready.ok && cfg.engine !== 'manual',
    detail: [$t(cfg.preset.label), cfg.engine === 'agent' ? $t('agent with tools') : cfg.engine === 'manual' ? $t('copy and paste') : $t('without tools'),
      cfg.engine !== 'manual' && cfg.models.medium && cfg.preset.id !== 'claude-code' ? cfg.models.medium : null,
      !ready.ok ? { url: $t('the address is missing'), key: $t('the key is missing'), model: $t('the model is missing') }[ready.missing] : null].filter(Boolean).join(' · '),
    fix: $t('Choose the model, the address and the key in Settings → Model.'),
  });

  if (chosen && cfg.engine === 'agent') {
    // 4. Claude Code (the agent with tools; it also works with models of other providers)
    const bin = findClaude();
    const ver = bin ? claudeVersion(bin) : null;
    add({ id: 'claude', title: $t('Claude Code is installed'), ok: !!ver, detail: ver ? ver : $t('The command claude was not found.'),
      fix: $t('Install Claude Code (it reads and writes the pages for you), then reload this page.'),
      cmd: IS_WIN ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash',
      link: 'https://docs.claude.com/en/docs/claude-code/setup' });

    // 5. Sign-in (only for a subscription: with a key or another provider Claude Code uses the key from the settings)
    if (cfg.preset.id === 'claude-code') {
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
    }
  }

  // 5. git (restore points and updates)
  const git = run('git', ['--version']);
  add({ id: 'git', title: $t('git, for restore points and updates'), required: false, ok: git.status === 0, detail: git.status === 0 ? (git.stdout || '').trim() : $t('git was not found.'),
    fix: $t('Without git everything works, but the “Undo” button after {ai}’s changes will not be available.'), link: 'https://git-scm.com/downloads',
    cmd: IS_WIN ? 'winget install --id Git.Git -e' : IS_MAC ? 'brew install git' : 'sudo apt install git' });

  // 6. OCR (optional)
  const ocr = process.env.LIBRARY_OCR !== 'builtin' && run('ocrmypdf', ['--version']).status === 0;
  add({ id: 'ocr', title: $t('OCR for scanned PDFs'), required: false, ok: ocr, cmd: IS_WIN ? null : IS_MAC ? 'brew install ocrmypdf' : 'sudo apt install ocrmypdf',
    detail: ocr ? $t('ocrmypdf is installed (best quality).') : $t('The built-in OCR will be used. It is slower and less exact than ocrmypdf.'),
    fix: $t('Optional: install ocrmypdf for better recognition of scanned books.'), link: 'https://ocrmypdf.readthedocs.io/en/latest/installation.html' });

  // 7. Language
  const code = contentLang();
  add({ id: 'lang', title: $t('Language of the library'), required: false, ok: true, detail: $t('Now: {0}. Change it from the language menu in the sidebar.', [code]) });

  // 8. First file
  const files = ['inbox', 'books', 'papers', 'articles', 'web', 'data', 'notes', 'images', 'other'].reduce((n, d) => n + count(path.join(RAW, d)), 0);
  const pages = count(path.join(WIKI, 'sources'));
  add({ id: 'first', title: $t('Your first source'), required: false, ok: files + pages > 0,
    detail: files + pages > 0 ? $t('{0} files, {1} source pages.', [files, pages]) : $t('The library is empty.'),
    fix: $t('Drop a PDF, EPUB or text file on the home page, or use “Add an article” with a DOI or an address.'), href: '#/find' });

  const blocking = steps.filter((s) => s.required && !s.ok && !s.unknown).length;
  return { steps, ready: blocking === 0, blocking };
}

/** A short paid check: sends one word to the lightest model. It starts only when a button is pressed. */
export async function testAI() {
  const cfg = aiConfig();
  if (cfg.engine === 'manual') return { ok: true, manual: true };
  if (cfg.engine === 'agent') {
    const r = await askClaude({ prompt: 'Reply with the single word: ok', model: 'haiku', maxTurns: 1, timeoutMs: 90000 });
    return r.ok ? { ok: true, model: cfg.models.light } : { ok: false, kind: r.kind, error: r.error, detail: r.detail };
  }
  if (!readiness(cfg).ok) return { ok: false, kind: 'not-ready', error: errorText({ kind: 'not-ready' }, cfg) };
  // Every different model of the three levels: otherwise a speech model on the "powerful" level shows up only during processing in "Best" mode
  const done = []; let answer = '';
  for (const tier of TIERS) {
    const model = cfg.models[tier];
    if (!model || done.includes(model)) continue;
    const r = await complete({ tier, prompt: 'Reply with the single word: ok', maxTokens: 300, timeoutMs: 120000, cfg });
    if (!r.ok) return { ok: false, kind: r.kind, model, error: errorText({ ...r, model }, cfg), detail: String(r.error || '').slice(0, 300) };
    done.push(model); answer = answer || String(r.text).trim().slice(0, 80);
  }
  return { ok: true, model: done.join(', '), answer };
}
export const testClaude = testAI; // the old name
