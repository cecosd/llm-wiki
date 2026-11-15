// Requests from the server inside the isolation to the launcher outside it (scripts/sandbox.js), through a shared temporary folder.
// They are needed for the few actions that write to protected files (changing the content language: CLAUDE.md, .claude/).
// The launcher does NOT trust the cage: it runs only explicitly listed actions, checks the size and kind of the file
// and does not follow symbolic links when it writes the answer. Built-in Node modules only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REQ_RE = /^req-([a-f0-9]{16})\.json$/;
const MAX_REQUEST = 4096;

/** Inside the cage: sends a request and waits for the answer. null if there is no launcher or it does not answer in time. */
export async function askOutside(kind, data, { dir = process.env.LIB_SANDBOX_IPC, timeoutMs = 20000 } = {}) {
  if (!dir) return null;
  const id = crypto.randomBytes(8).toString('hex');
  const req = path.join(dir, `req-${id}.json`), res = path.join(dir, `res-${id}.json`);
  fs.writeFileSync(req + '.tmp', JSON.stringify({ kind, data }));
  fs.renameSync(req + '.tmp', req); // the launcher sees only a finished request
  for (const end = Date.now() + timeoutMs; Date.now() < end;) {
    await new Promise((r) => setTimeout(r, 100));
    let text;
    try { text = fs.readFileSync(res, 'utf8'); } catch { continue; } // no answer yet
    fs.rmSync(res, { force: true });
    try { return JSON.parse(text); } catch { return null; }
  }
  fs.rmSync(req, { force: true });
  return null;
}

/** Writes the answer without following a link that the cage may have left in this place. */
function writeReply(dir, id, out) {
  const tmp = path.join(dir, `res-${id}.json.tmp`);
  fs.rmSync(tmp, { force: true }); // if it is a link, the link itself is removed
  const fd = fs.openSync(tmp, 'wx', 0o600); // O_CREAT | O_EXCL: does not follow links
  try { fs.writeSync(fd, JSON.stringify(out)); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, path.join(dir, `res-${id}.json`)); // rename replaces the name itself, it does not follow a link
}

/** Outside the cage: serves the requests in dir with handlers[kind](data). Returns a function to stop. */
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
        try { writeReply(dir, id, out); } catch { /* the cage removed the folder */ }
      }
    } catch { /* the folder is gone */ } finally { busy = false; }
  };
  const timer = setInterval(tick, 300);
  let watcher = null;
  try { watcher = fs.watch(dir, () => { tick(); }); } catch { /* the check every 300 ms is enough */ }
  return () => { clearInterval(timer); watcher?.close(); };
}
