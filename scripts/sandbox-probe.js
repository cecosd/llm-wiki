// Пуска се ВЪТРЕ в клетката от `npm run sandbox:check` (scripts/sandbox.js): проверява какво се вижда отвътре
// и връща резултата като JSON. Само вградени модули. Нищо не се праща към Claude (`claude auth status` е безплатно).
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { spawnSync } from 'node:child_process';

const P = JSON.parse(process.env.LIB_SANDBOX_PROBE || '{}');
const out = [];
const add = (id, ok, detail = '', kind = 'security') => out.push({ id, ok: !!ok, detail: String(detail || '').trim().slice(0, 300), kind });
const sameFile = (s) => { try { const st = fs.statSync(s.path); return st.dev === s.dev && st.ino === s.ino; } catch { return false; } };
const canWrite = (f) => { try { fs.writeFileSync(f, 'x', { flag: 'wx' }); fs.rmSync(f); return true; } catch { return false; } };

// Сигурност
const seen = (P.secrets || []).filter(sameFile);
add('secrets', !seen.length, seen.map((s) => s.path).join(', '));
let siblings = [];
try { siblings = fs.readdirSync(path.dirname(P.root)).filter((n) => n !== path.basename(P.root)); } catch { /* няма какво да се види */ }
add('siblings', !siblings.length, siblings.slice(0, 8).join(', '));
add('windows-drives', !fs.existsSync('/mnt/c'), '/mnt/c');
const extraEnv = Object.keys(process.env).filter((k) => !(P.allowedEnv || []).includes(k));
add('env', !extraEnv.length, extraEnv.join(', '));
const probe = '.sandbox-probe-' + process.pid;
const codeWritable = ['', 'scripts', '.claude', 'node_modules', 'content'].map((d) => path.join(P.root, d, probe)).filter(canWrite);
add('code-readonly', !codeWritable.length, codeWritable.join(', '));
if (P.settings) {
  let w = false;
  try { fs.appendFileSync(P.settings, ''); w = true; } catch { /* само за четене: така трябва */ }
  add('claude-settings', !w, P.settings);
}
if (P.exe) {
  const r = spawnSync(P.exe, [], { encoding: 'utf8', timeout: 15000 });
  const ran = r.status === 0 && String(r.stdout || '').trim().length > 0;
  add('windows-exe', !ran, ran ? String(r.stdout).trim() : '');
}

// Нужното за работа
const dataOk = ['raw', 'wiki', 'outputs', 'drafts'].every((d) => canWrite(path.join(P.root, d, probe)));
add('data-writable', dataOk, '', 'function');
const claude = process.env.CLAUDE_BIN;
if (claude) {
  const v = spawnSync(claude, ['--version'], { encoding: 'utf8', timeout: 60000 });
  add('claude', v.status === 0, v.status === 0 ? '' : (v.stderr || v.error?.message || `exit ${v.status}`), 'function');
  const a = spawnSync(claude, ['auth', 'status'], { encoding: 'utf8', timeout: 60000 });
  add('claude-auth', /"loggedIn"\s*:\s*true/.test(a.stdout || ''), a.stderr || a.error?.message || '', 'function');
} else add('claude', false, 'claude', 'function');
try { await dns.lookup('api.anthropic.com'); add('network', true, '', 'function'); } catch (e) { add('network', false, e.code || e.message, 'function'); }

process.stdout.write(JSON.stringify(out));
