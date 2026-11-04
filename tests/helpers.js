// Обща подготовка: всеки файл с тестове работи във временно копие на приложението.
// Истинската библиотека (raw/, wiki/, drafts/) не се копира и не се пипа. Claude е фалшив (CLAUDE_BIN).
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COPY = ['scripts', 'content', 'locales', 'docs', 'tests', 'package.json', 'CLAUDE.md', '.claude', 'wiki/_templates'];
const IS_WIN = process.platform === 'win32';

/** Име на тест, което run-tests.js разбира: група, английски и български текст */
export const T = (group, en, bg) => `${group}|${en}|${bg}`;

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

export function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-test-'));
  for (const item of COPY) {
    const from = path.join(PROJECT, item);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(root, item), { recursive: true, filter: (f) => !f.includes('Zone.Identifier') });
  }
  fs.symlinkSync(path.join(PROJECT, 'node_modules'), path.join(root, 'node_modules'), IS_WIN ? 'junction' : 'dir');
  for (const d of ['raw/inbox', 'wiki/sources/chapters', 'wiki/concepts', 'wiki/entities', 'wiki/topics', 'wiki/comparisons', 'wiki/questions', 'outputs', 'home']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'library.config.json'), JSON.stringify({ contentLang: 'en', confirmCost: true, autoIngest: false, setupDone: true }));

  const bin = path.join(root, 'tests', 'fake-claude.js');
  fs.chmodSync(bin, 0o755);
  let claudeBin = bin;
  if (IS_WIN) { claudeBin = path.join(root, 'fake-claude.cmd'); fs.writeFileSync(claudeBin, `@node "${bin}" %*\r\n`); }

  const claudeLog = path.join(root, 'claude-calls.jsonl');
  const env = {
    ...process.env, HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'),
    CLAUDE_BIN: claudeBin, FAKE_CLAUDE_LOG: claudeLog, LIB_LANG: 'en', LANG: 'en', LIBRARY_OCR: 'builtin',
    NODE_TEST_CONTEXT: undefined,
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.NODE_TEST_CONTEXT;

  return {
    root, env, claudeLog,
    claudeCalls() { try { return fs.readFileSync(claudeLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } },
    script(file, ...args) {
      return spawnSync(process.execPath, [path.join(root, 'scripts', file), ...args], { cwd: root, env, encoding: 'utf8', timeout: 120000 });
    },
    write(rel, text) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; },
    exists(rel) { return fs.existsSync(path.join(root, rel)); },
    read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); },
    remove() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

/** Заявка без нормализиране на адреса и с произволна заглавка Host (fetch не позволява това). */
export function rawRequest(port, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Заявка така, както я прави самата страница (със заглавка x-library) */
export async function api(port, method, url, body) {
  const r = await rawRequest(port, {
    method, url,
    headers: { 'x-library': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  let json = null;
  try { json = JSON.parse(r.body); } catch { /* не е JSON */ }
  return { ...r, json };
}

/** Пуска истинския сървър на приложението във временното копие */
export async function startServer(box, extraEnv = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(box.root, 'scripts', 'server.js')], {
    cwd: box.root, env: { ...box.env, PORT: String(port), ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The server stopped: ${log.slice(-500)}`);
    try { await rawRequest(port, { url: '/api/stats' }); break; }
    catch (e) {
      if (Date.now() > deadline) { child.kill(); throw new Error(`The server did not start: ${e.message} ${log.slice(-500)}`); }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return {
    port, child, log: () => log,
    stop() { return new Promise((r) => { child.once('close', r); child.kill(); }); },
  };
}

export async function waitFor(check, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error('Timed out while waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Примерен източник с понятие: минимална библиотека за тестовете */
export function seedLibrary(box) {
  box.write('raw/articles/sample-2020-note.txt', 'A short sample text about entropy.\n');
  box.write('wiki/sources/sample-2020-note.md', `---
title: Sample note
type: source
tags: [sample]
sources:
  - raw/articles/sample-2020-note.txt
related:
  - "[[entropy]]"
created: 2026-01-01
updated: 2026-01-01
confidence: high
raw_path: raw/articles/sample-2020-note.txt
format: article
authors: ["Sample, A."]
year: 2020
apa: "Sample, A. (2020). *Sample note*."
status: read
emphasis: "A short note on entropy."
depth: 2
area: Physics
---

# Sample note

A short note about [[entropy]].
`);
  box.write('wiki/concepts/entropy.md', `---
title: Entropy
type: concept
tags: [sample]
sources:
  - raw/articles/sample-2020-note.txt
related:
  - "[[sample-2020-note]]"
created: 2026-01-01
updated: 2026-01-01
confidence: high
---

# Entropy

A measure of disorder ([[sample-2020-note]]).
`);
  box.write('wiki/index.md', '# Index\n\n## Concepts\n\n- [[entropy]]: a measure of disorder\n\n## Sources\n\n- [[sample-2020-note]]: a sample note\n');
  box.write('wiki/log.md', '# Log\n');
  box.write('wiki/overview.md', '# Overview\n');
}
