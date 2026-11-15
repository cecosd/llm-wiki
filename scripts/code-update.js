// Installs a new version of the program from its repository (the "Install" button in Settings -> Updates and in the
// "new version" window). The library itself (raw/, wiki/, drafts/, outputs/) is never touched: .gitignore keeps it
// out of the repository, and nothing here runs a command that deletes untracked files.
//
// Built-in Node modules only (plus the two helpers next to it, which follow the same rule): in the safe mode the
// launcher runs this OUTSIDE the isolation, because inside it the code folder is read-only.
//
// Steps: make sure the folder is a clone, fetch, refuse when code files were edited (unless the user agrees to replace
// them; a copy goes to outputs/update-backup/), fast-forward only, reinstall packages when the lock file changed
// (and roll back when that fails), then install the language pack of the library again.
import fs from 'node:fs';
import path from 'node:path';
import { runGit, ensureRepo } from './git-setup.js';
import { runNpm } from './npm-update.js';

const SAFE_ARGS = ['--ignore-scripts', '--no-audit', '--no-fund'];
let busy = false;

/** The remote branch to update to: where origin/HEAD points, otherwise origin/main */
async function targetRef(root, git) {
  const r = await git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (r.ok && /^origin\/[\w./-]+$/.test(r.out)) return r.out;
  return 'origin/main';
}

/** Tracked files with local changes (files hidden with skip-worktree are not listed: that is the owner's own setup) */
async function dirtyFiles(root, git) {
  const r = await git(root, ['status', '--porcelain', '--untracked-files=no']);
  return r.ok ? r.out.split('\n').map((l) => l.replace(/^\s*\S{1,2}\s+/, '').trim()).filter(Boolean) : [];
}

function backupFiles(root, files) {
  const dir = path.join(root, 'outputs', 'update-backup', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const f of files) {
    const from = path.resolve(root, f);
    if (!from.startsWith(path.resolve(root) + path.sep)) continue;
    try { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(from, path.join(dir, f)); } catch { /* a deleted file has nothing to copy */ }
  }
  return path.relative(root, dir);
}

const versionOf = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || null; } catch { return null; } };

/**
 * Updates the program to the newest version of the repository.
 * Returns { ok, from, to, files, commits, packages, backup } or { ok: false, error, ... }.
 * Error codes: busy, no-git, no-repo, fetch, dirty (with files), diverged, merge, npm (the old version is back).
 * `lang` is the content language to install again afterwards; `force` replaces edited code files (after a copy).
 */
export async function updateCode(root, { force = false, lang = null, git = runGit, npm = runNpm } = {}) {
  if (busy) return { ok: false, error: 'busy' };
  busy = true;
  try {
    const setup = await ensureRepo(root, { git });
    if (!setup.ok) return { ok: false, error: setup.error === 'no-git' ? 'no-git' : 'no-repo', detail: setup.detail };
    const fetched = await git(root, ['fetch', '-q', 'origin'], { timeoutMs: 120000 });
    if (!fetched.ok) return { ok: false, error: 'fetch', detail: fetched.err.slice(-300) };
    const target = await targetRef(root, git);
    const head = await git(root, ['rev-parse', 'HEAD']);
    const goal = await git(root, ['rev-parse', target]);
    if (!goal.ok) return { ok: false, error: 'fetch', detail: goal.err.slice(-300) };
    const before = head.ok ? head.out : null, from = versionOf(root);
    if (before === goal.out) return { ok: true, from, to: from, files: 0, commits: [], packages: false, upToDate: true };

    let backup = null;
    const dirty = await dirtyFiles(root, git);
    if (dirty.length) {
      if (!force) return { ok: false, error: 'dirty', files: dirty.slice(0, 30) };
      backup = backupFiles(root, dirty);
    }

    // Which files change, for the report and for deciding whether the packages must be installed again
    const diff = before ? await git(root, ['diff', '--name-only', before, goal.out]) : { ok: true, out: '' };
    const names = diff.ok ? diff.out.split('\n').filter(Boolean) : [];
    const log = before ? await git(root, ['log', '--format=%s', '-n', '30', `${before}..${goal.out}`]) : { ok: true, out: '' };

    if (dirty.length) {
      const reset = await git(root, ['reset', '--hard', goal.out]);
      if (!reset.ok) return { ok: false, error: 'merge', detail: reset.err.slice(-300) };
    } else {
      const merged = await git(root, ['merge', '--ff-only', '-q', goal.out]);
      if (!merged.ok) {
        const diverged = /not possible to fast-forward|diverg/i.test(merged.err);
        return { ok: false, error: diverged ? 'diverged' : 'merge', detail: merged.err.slice(-300) };
      }
    }

    // every release changes the version in package.json; only a change of the lock file means other packages
    const packages = names.includes('package-lock.json');
    if (packages) {
      const r = await npm(root, ['ci', ...SAFE_ARGS]);
      if (!r.ok) {
        // Put the old code and the old packages back, so the program still starts
        if (before) { await git(root, ['reset', '--hard', before]); await npm(root, ['ci', ...SAFE_ARGS]); }
        return { ok: false, error: 'npm', detail: String(r.error || '').slice(-300) };
      }
    }

    // The repository carries the English language pack; the library may use another one
    if (lang && lang !== 'en') {
      try { (await import(new URL('./content-pack.js', import.meta.url).href)).installPack(lang, { config: false }); } catch { /* the pack stays English */ }
    }
    return { ok: true, from, to: versionOf(root), files: names.length, commits: log.ok ? log.out.split('\n').filter(Boolean) : [], packages, backup };
  } finally { busy = false; }
}
