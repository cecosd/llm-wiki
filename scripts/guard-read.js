// Кука (PreToolUse) за Claude Code: Read, Grep и Glob работят само в папката на проекта.
// Нужна е, защото правилата за права не стигат: Read(./**) ограничава Read, но Grep и Glob трябва да са разрешени
// по име, за да съществуват в режим dontAsk, а тогава могат да четат и извън проекта (проверено с истинския Claude).
// Изход 2 спира инструмента; при всяко съмнение куката отказва. Пуска се от agent.js чрез --settings.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// В проекта, но не за четене: история с лични страници, настройки и паролата на интерфейса.
const PRIVATE = /(^|\/)(\.git|\.library-git)(\/|$)|(^|\/)(\.library-auth\.json|library\.config\.json|\.env(\.[^/]*)?)$/;

const refuse = (why) => { process.stderr.write(`Blocked by the library: ${why}\n`); process.exit(2); };

/** Връща причина за отказ или null. Сравнява по текста на пътя, за да работят и raw/ папки, свързани с другаде. */
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
  // Шаблонът също може да сочи навън: Glob("../*") или Grep с glob: "/etc/*".
  const pattern = tool === 'Glob' ? args.pattern : tool === 'Grep' ? args.glob : '';
  const p = String(pattern || '').replace(/\\/g, '/');
  if (p.startsWith('/') || p.startsWith('~') || /^[a-z]:/i.test(p) || p.split('/').includes('..')) return 'the pattern points outside the project folder';
  if (/(^|[/{,])(\.git|\.library-git|\.library-auth)/.test(p)) return 'this file is private';
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
