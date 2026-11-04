// Малък клиент за Chrome DevTools Protocol, без зависимости. Нужен е, защото приложението държи отворена
// връзка (/api/events) и затова --dump-dom не приключва. Изисква глобален WebSocket (Node 22 или по-нов).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function findChrome() {
  if (typeof WebSocket === 'undefined') return null;
  return [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find((p) => p && fs.existsSync(p)) || null;
}

export async function openBrowser(bin) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-chrome-')); // винаги отделен профил
  const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--window-size=1280,1000', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let err = '';
    const t = setTimeout(() => reject(new Error(`Chrome did not start: ${err.slice(-300)}`)), 20000);
    child.stderr.on('data', (d) => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('No connection to Chrome')); });
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { const { resolve, reject } = waiting.get(m.id); waiting.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);

  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)).result?.value;
  return {
    goto: (url) => send('Page.navigate', { url }, sessionId),
    evaluate,
    /** Чака текстът да се появи на страницата. Връща false, ако не се появи навреме. */
    async waitForText(text, ms = 15000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await evaluate(`document.body && document.body.innerText.includes(${JSON.stringify(text)})`)) return true;
        await new Promise((r) => setTimeout(r, 150));
      }
      return false;
    },
    async screenshot(file, width = 1280, height = 1000) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await new Promise((r) => setTimeout(r, 400));
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
    async close() {
      try { await send('Browser.close'); } catch { /* вече е затворен */ }
      ws.close();
      await new Promise((r) => { if (child.exitCode !== null) r(); else { child.once('close', r); setTimeout(() => { child.kill('SIGKILL'); r(); }, 3000); } });
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
