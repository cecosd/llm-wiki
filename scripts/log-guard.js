// The log wiki/log.md is append-only: the entries that were in it before a task must not disappear.
// The agent compares the log before and after every task. If an old entry is missing, it restores everything from "before"
// and adds the new entries from "after". Editing the text of an old entry (the same heading) is not undone.
import fs from 'node:fs';

/** The count of every heading ("## ..."). A heading can repeat, so it is counted. */
export function entryCounts(text) {
  const counts = new Map();
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) counts.set(line, (counts.get(line) || 0) + 1);
  }
  return counts;
}

/** The blocks of the log: each starts with "## ". The first block is the header part (no entry). */
export function splitEntries(text) {
  return String(text).replace(/\r\n/g, '\n').split(/^(?=## )/m);
}

/**
 * What must remain in the log after a task. before: the text before the task (null if there was no file),
 * after: the text after it. Returns { text, lost, added }; lost is the number of old entries that disappeared.
 */
export function repairLog(before, after) {
  if (before == null) return { text: after, lost: 0, added: 0 };
  const current = after == null ? '' : after;
  const need = entryCounts(before);
  const have = entryCounts(current);
  let lost = 0;
  for (const [title, n] of need) lost += Math.max(0, n - (have.get(title) || 0));
  if (!lost) return { text: current, lost: 0, added: 0 };
  // The new entries are those that in "after" exceed their count in "before" (in order of appearance)
  const seen = new Map();
  const added = [];
  for (const block of splitEntries(current)) {
    if (!block.startsWith('## ')) continue;
    const title = block.split('\n')[0];
    const used = seen.get(title) || 0;
    seen.set(title, used + 1);
    if (used >= (need.get(title) || 0)) added.push(block.trimEnd());
  }
  const text = [before.replace(/\s+$/, ''), ...added].join('\n\n') + '\n';
  return { text, lost, added: added.length };
}

/** Reads the log (or null if there is none). Used in the agent before and after every task. */
export function readLog(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}
