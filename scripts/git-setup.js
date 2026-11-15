// Makes the program folder a git clone of its repository, so that "Settings -> Updates" can install new versions.
// The installers run this once (node scripts/git-setup.js); the updater runs it too when the folder came from a ZIP.
//
// Built-in Node modules only: in the safe mode the launcher runs this file OUTSIDE the isolation (see sandbox.js),
// and a package imported here would run with all of the user's rights.
//
// It never commits and never touches the library (raw/, wiki/, drafts/, outputs/ are ignored by .gitignore).
// For a folder that is not a repository yet it runs: git init, git remote add origin, git fetch, git reset (mixed),
// so the working files stay exactly as they are and only the index learns what the repository looks like.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Runs git without a terminal and never asks for a password. Resolves { ok, out, err } (never rejects). */
export function runGit(root, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, {
        cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' },
      });
    } catch (e) { return resolve({ ok: false, out: '', err: e.message, missing: true }); }
    let out = '', err = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { out = (out + d).slice(-200000); });
    child.stderr.setEncoding('utf8').on('data', (d) => { err = (err + d).slice(-8000); });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, out, err: e.message, missing: e.code === 'ENOENT' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out: out.trim(), err: err.trim() }); });
  });
}

/** "owner/repo" from the repository field of package.json (null when it is not a GitHub address) */
export function repoOfRoot(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '';
    const m = String(url).match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch { return null; }
}

/**
 * Makes sure root is a git repository whose "origin" is the project repository.
 * Returns { ok, created, fetched, error } where error is a short code: no-git, no-repo-url, init, remote.
 * "fetched: false" means there was no network (or the repository is not reachable): the folder is still a
 * repository, and the updater simply fetches later.
 */
export async function ensureRepo(root, { git = runGit, url = null } = {}) {
  const version = await git(root, ['--version']);
  if (!version.ok) return { ok: false, error: 'no-git' };
  const repo = repoOfRoot(root);
  const remoteUrl = url || (repo ? `https://github.com/${repo}.git` : null);
  const isRepo = fs.existsSync(path.join(root, '.git'));
  if (isRepo) {
    const have = await git(root, ['remote', 'get-url', 'origin']);
    if (have.ok) return { ok: true, created: false, fetched: false };
    if (!remoteUrl) return { ok: false, error: 'no-repo-url' };
    const add = await git(root, ['remote', 'add', 'origin', remoteUrl]);
    return add.ok ? { ok: true, created: false, fetched: false } : { ok: false, error: 'remote', detail: add.err };
  }
  if (!remoteUrl) return { ok: false, error: 'no-repo-url' };
  const init = await git(root, ['init', '-q', '-b', 'main']);
  if (!init.ok) return { ok: false, error: 'init', detail: init.err };
  const add = await git(root, ['remote', 'add', 'origin', remoteUrl]);
  if (!add.ok) return { ok: false, error: 'remote', detail: add.err };
  // The first fetch is shallow: the folder only needs to know where the repository is now.
  const fetch = await git(root, ['fetch', '-q', '--depth', '1', 'origin', 'main'], { timeoutMs: 90000 });
  if (fetch.ok) {
    // A mixed reset keeps every working file as it is; the index just learns the repository. Differences then show as changes.
    await git(root, ['reset', '-q', 'origin/main']);
    await git(root, ['branch', '-q', '--set-upstream-to=origin/main', 'main']);
  }
  return { ok: true, created: true, fetched: fetch.ok };
}

// Command line: node scripts/git-setup.js (the installers call it; the exit code is always 0 because git is optional)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const r = await ensureRepo(root);
  if (r.ok) console.log(r.created ? (r.fetched ? 'git: repository created and linked to the project' : 'git: repository created (no network yet: updates will link it later)') : 'git: repository already set up');
  else console.log(`git: not set up (${r.error})`);
}
