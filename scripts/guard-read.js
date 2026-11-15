// Hook (PreToolUse) for Claude Code: Read, Grep and Glob work only in the project folder.
// It is needed because permission rules are not enough: Read(./**) limits Read, but Grep and Glob must be allowed
// by name to exist in dontAsk mode, and then they can read outside the project too (checked with the real Claude).
// Exit 2 stops the tool; when in any doubt the hook refuses. It is run by agent.js through --settings.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Inside the project but not for reading: the history with personal pages, the settings, the interface password and the API keys.
const PRIVATE = /(^|\/)(\.git|\.library-git)(\/|$)|(^|\/)(\.library-auth\.json|\.library-secrets\.json(\.tmp)?|library\.config\.json|\.env(\.[^/]*)?)$/;

const refuse = (why) => { process.stderr.write(`Blocked by the library: ${why}\n`); process.exit(2); };

/** Returns a reason to refuse or null. Compares by the text of the path, so that raw/ folders linked elsewhere work too. */
export function reasonToBlock(input, root = ROOT) {
  const tool = input?.tool_name;
  const args = input?.tool_input || {};
  const base = input?.cwd ? path.resolve(input.cwd) : root;
  const target = tool === 'Read' ? args.file_path : args.path;
  if (tool === 'Read' && !target) return 'no file path';
  const full = path.resolve(base, String(target || '.'));
  const inside = path.relative(root, full).split(path.sep).join('/');
  if (inside === '..' || inside.startsWith('../') || path.isAbsolute(inside)) return 'only files inside the project folder can be read';
  if (PRIVATE.test(inside)) return 'this file is private';
  // The pattern can also point outside: Glob("../*") or Grep with glob: "/etc/*".
  const pattern = tool === 'Glob' ? args.pattern : tool === 'Grep' ? args.glob : '';
  const p = String(pattern || '').replace(/\\/g, '/');
  if (p.startsWith('/') || p.startsWith('~') || /^[a-z]:/i.test(p) || p.split('/').includes('..')) return 'the pattern points outside the project folder';
  if (/(^|[/{,])(\.git|\.library-git|\.library-auth|\.library-secrets)/.test(p)) return 'this file is private';
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
