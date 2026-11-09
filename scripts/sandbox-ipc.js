// Заявки от сървъра в изолацията към стартера извън нея (scripts/sandbox.js), през обща временна папка.
// Нужни са за малкото действия, които пишат в защитените файлове (смяната на езика на съдържанието: CLAUDE.md, .claude/).
// Стартерът НЕ вярва на клетката: изпълнява само изрично изброени действия, проверява размера и вида на файла
// и не следва символни връзки, когато пише отговора. Само вградени модули на Node.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REQ_RE = /^req-([a-f0-9]{16})\.json$/;
const MAX_REQUEST = 4096;

/** Вътре в клетката: праща заявка и чака отговора. null, ако няма стартер или не отговори навреме. */
export async function askOutside(kind, data, { dir = process.env.LIB_SANDBOX_IPC, timeoutMs = 20000 } = {}) {
  if (!dir) return null;
  const id = crypto.randomBytes(8).toString('hex');
  const req = path.join(dir, `req-${id}.json`), res = path.join(dir, `res-${id}.json`);
  fs.writeFileSync(req + '.tmp', JSON.stringify({ kind, data }));
  fs.renameSync(req + '.tmp', req); // стартерът вижда само готова заявка
  for (const end = Date.now() + timeoutMs; Date.now() < end;) {
    await new Promise((r) => setTimeout(r, 100));
    let text;
    try { text = fs.readFileSync(res, 'utf8'); } catch { continue; } // още няма отговор
    fs.rmSync(res, { force: true });
    try { return JSON.parse(text); } catch { return null; }
  }
  fs.rmSync(req, { force: true });
  return null;
}

/** Записва отговора, без да следва връзка, която клетката може да е оставила на това място. */
function writeReply(dir, id, out) {
  const tmp = path.join(dir, `res-${id}.json.tmp`);
  fs.rmSync(tmp, { force: true }); // ако е връзка, маха се самата връзка
  const fd = fs.openSync(tmp, 'wx', 0o600); // O_CREAT | O_EXCL: не следва връзки
  try { fs.writeSync(fd, JSON.stringify(out)); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, path.join(dir, `res-${id}.json`)); // rename заменя самото име, не следва връзка
}

/** Извън клетката: обслужва заявките в dir с handlers[kind](data). Връща функция за спиране. */
export function serveRequests(dir, handlers) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const names = fs.readdirSync(dir).filter((n) => REQ_RE.test(n)).slice(0, 10);
      for (const name of names) {
        const id = name.match(REQ_RE)[1], file = path.join(dir, name);
        let out = { ok: false, error: 'refused' };
        try {
          const st = fs.lstatSync(file);
          if (st.isFile() && st.size <= MAX_REQUEST) {
            const { kind, data } = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (typeof kind === 'string' && Object.hasOwn(handlers, kind)) out = await handlers[kind](data && typeof data === 'object' ? data : {});
          }
        } catch (e) { out = { ok: false, error: String(e?.message || e).slice(0, 300) }; }
        fs.rmSync(file, { force: true });
        try { writeReply(dir, id, out); } catch { /* клетката е махнала папката */ }
      }
    } catch { /* папката я няма */ } finally { busy = false; }
  };
  const timer = setInterval(tick, 300);
  let watcher = null;
  try { watcher = fs.watch(dir, () => { tick(); }); } catch { /* стига и проверката на всеки 300 ms */ }
  return () => { clearInterval(timer); watcher?.close(); };
}
