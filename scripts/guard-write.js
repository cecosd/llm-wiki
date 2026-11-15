// Hook (PreToolUse) for Claude Code: the log wiki/log.md is appended with Edit, not overwritten with Write.
// Overwriting with Write has deleted the whole log (11 November 2026: 377 entries became 1).
// Exit 2 stops the tool. It is run by agent.js through --settings and from .claude/settings.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = 'wiki/log.md';

const refuse = (why) => { process.stderr.write(`Blocked by the library: ${why}\n`); process.exit(2); };

/** A reason to refuse or null. Compares by the text of the path (letter case does not matter on Windows). */
export function reasonToBlock(input, root = ROOT) {
  if (input?.tool_name !== 'Write') return null;
  const target = input?.tool_input?.file_path;
  if (!target) return null;
  const base = input?.cwd ? path.resolve(input.cwd) : root;
  const full = path.resolve(base, String(target));
  const inside = path.relative(root, full).split(path.sep).join('/');
  if (inside.toLowerCase() === LOG) {
    return 'wiki/log.md is append-only: add the new entry at the end with Edit, never rewrite the whole file with Write';
  }
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { text += d; });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(text); } catch { refuse('the request could not be read'); }
    const why = reasonToBlock(input);
    if (why) refuse(why);
    process.exit(0);
  });
}
