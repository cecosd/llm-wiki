// Сигурност: проверява се истинският сървър, пуснат във временно копие.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { T, makeSandbox, startServer, rawRequest, api, seedLibrary, PROJECT } from './helpers.js';

let box, srv;
before(async () => { box = makeSandbox(); seedLibrary(box); srv = await startServer(box); });
after(async () => { await srv?.stop(); box?.remove(); });

test(T('security', 'The server listens only on this computer (127.0.0.1)', 'Сървърът слуша само на този компютър (127.0.0.1)'), async () => {
  const code = box.read('scripts/server.js');
  assert.match(code, /app\.listen\(PORT, '127\.0\.0\.1'/);
  // Ако компютърът има и друг мрежов адрес, през него сървърът не бива да отговаря.
  const external = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal);
  if (!external) return;
  await assert.rejects(fetch(`http://${external.address}:${srv.port}/api/stats`, { signal: AbortSignal.timeout(3000) }));
});

test(T('security', 'Requests with a foreign Host header are refused (DNS rebinding)', 'Заявки с чужда заглавка Host се отказват (DNS rebinding)'), async () => {
  const r = await rawRequest(srv.port, { url: '/api/pages', headers: { host: 'evil.example' } });
  assert.equal(r.status, 403);
});

test(T('security', 'Other websites cannot send commands (no x-library header, refused)', 'Други сайтове не могат да пращат команди (без заглавка x-library има отказ)'), async () => {
  for (const url of ['/api/inbox', '/api/agent/ingest', '/api/remove', '/api/tests/run', '/api/updates/code']) {
    const r = await rawRequest(srv.port, { method: 'POST', url, headers: { origin: 'https://evil.example' } });
    assert.equal(r.status, 403, url);
  }
});

test(T('security', 'Other websites cannot read the answers (no CORS permission)', 'Други сайтове не могат да четат отговорите (няма CORS разрешение)'), async () => {
  const r = await rawRequest(srv.port, { url: '/api/pages', headers: { origin: 'https://evil.example' } });
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});

test(T('security', 'Files outside raw/ cannot be read through the file address', 'Файлове извън raw/ не могат да се четат през адреса за файлове'), async () => {
  for (const url of ['/raw/..%2f..%2fpackage.json', '/raw/%2e%2e/%2e%2e/package.json', '/raw/..%5c..%5cpackage.json', '/raw/../library.config.json']) {
    const r = await rawRequest(srv.port, { url });
    assert.ok(!r.body.includes('"contentLang"') && !r.body.includes('"dependencies"'), url);
  }
  box.write('raw/.extracted/articles/x.md', 'secret');
  assert.equal((await rawRequest(srv.port, { url: '/raw/.extracted/articles/x.md' })).status, 404);
});

test(T('security', 'Only named libraries are served from node_modules', 'От node_modules се връщат само изрично изброени библиотеки'), async () => {
  assert.equal((await rawRequest(srv.port, { url: '/vendor/vue.js' })).status, 200);
  assert.equal((await rawRequest(srv.port, { url: '/vendor/express%2fpackage.json' })).status, 404);
  assert.equal((await rawRequest(srv.port, { url: '/vendor/..%2f..%2fpackage.json' })).status, 404);
});

test(T('security', 'An uploaded file cannot escape the inbox through its name', 'Качен файл не може да излезе от входящата кутия чрез името си'), async () => {
  const up = (name) => rawRequest(srv.port, { method: 'PUT', url: '/api/upload', headers: { 'x-library': '1', 'x-filename': encodeURIComponent(name) }, body: 'data' });
  const r = await up('../../evil.txt');
  assert.equal(r.status, 200);
  assert.equal(box.exists('evil.txt'), false);
  assert.equal(box.exists('raw/evil.txt'), false);
  assert.equal(box.exists('raw/inbox/evil.txt'), true);
  assert.equal((await up('.htaccess')).status, 400);
});

test(T('security', '“Add an article” refuses addresses inside your network', '„Добави статия“ отказва адреси във вашата мрежа'), async () => {
  const bad = ['https://localhost/x.pdf', 'https://127.0.0.1/x.pdf', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.1/x', 'https://192.168.1.1/x', 'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://router.local/x'];
  for (const input of bad) {
    const r = await api(srv.port, 'POST', '/api/web/import', { input });
    assert.equal(r.json?.ok, false, input);
    // Важно е защо е отказът: неуспешна връзка също дава ok:false, но не доказва, че защитата работи.
    assert.match(String(r.json?.error), /local network/, input);
  }
});

test(T('security', '“Add an article” accepts only https', '„Добави статия“ приема само https'), async () => {
  for (const input of ['http://example.com/x.pdf', 'file:///etc/passwd', 'ftp://example.com/x']) {
    const r = await api(srv.port, 'POST', '/api/web/import', { input });
    assert.notEqual(r.json?.ok, true, input);
  }
});

test(T('security', 'Claude has no general shell or network tool during processing', 'Claude няма обща обвивка и мрежов инструмент по време на обработка'), async () => {
  const code = box.read('scripts/agent.js');
  const list = code.match(/const ALLOWED_TOOLS = \[([\s\S]*?)\];/)[1];
  const tools = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(tools.length > 0);
  assert.ok(!tools.includes('Bash'), 'plain Bash');
  assert.ok(!tools.some((t) => /^(WebFetch|WebSearch|Write)$/.test(t)), 'network or free writing');
  for (const b of tools.filter((t) => t.startsWith('Bash('))) assert.match(b, /^Bash\(npm run (pending|status|extract|lint|lint:quick|fix-paths|new)( \*)?\)$/, b);
  for (const e of tools.filter((t) => t.startsWith('Edit('))) assert.match(e, /^Edit\((wiki|outputs)\/\*\*\)$/, e);
});

test(T('security', 'Personal library folders are excluded from the public repository', 'Личните папки на библиотеката са извън публичното репо'), () => {
  const ignore = fs.readFileSync(path.join(PROJECT, '.gitignore'), 'utf8');
  for (const rule of ['/raw/*', '/wiki/sources/*', '/wiki/concepts/*', '/drafts/', '/outputs/*', '/library.config.json', '/CLAUDE.local.md', '/.library-git/']) {
    assert.ok(ignore.includes(rule), rule);
  }
});

// --- Известни ограничения. Те са истински проверки: щом кодът се поправи, минават и отчетът го показва сам. ---

test(T('security', 'Content from a document cannot run code in the browser', 'Съдържание от документ не може да изпълни код в браузъра'), {
  todo: 'Page text is rendered from Markdown without a sanitizer and without a Content-Security-Policy, so HTML hidden in a source could reach the page. Open documents only from sources you trust. :: Текстът на страниците се показва от Markdown без пречистване и без Content-Security-Policy, затова HTML, скрит в източник, може да стигне до страницата. Отваряйте само документи от източници, на които имате доверие.',
}, async () => {
  const page = await rawRequest(srv.port, { url: '/' });
  const appJs = box.read('scripts/viewer/app.js');
  const guarded = /DOMPurify|sanitize\(/.test(appJs) || !!page.headers['content-security-policy'];
  assert.ok(guarded, 'no sanitizer and no CSP');
});

test(T('security', 'Claude can read only inside the project folder', 'Claude може да чете само в папката на проекта'), {
  todo: 'The Read tool is allowed without a path limit. A hostile document could try to make Claude read other files on the computer; there is no network tool to carry them away, but the text reaches Anthropic and may land in a wiki page. :: Инструментът Read е разрешен без ограничение на пътя. Враждебен документ може да опита да накара Claude да чете други файлове на компютъра. Няма мрежов инструмент, с който да ги изнесе, но текстът стига до Anthropic и може да попадне в страница.',
}, () => {
  const list = box.read('scripts/agent.js').match(/const ALLOWED_TOOLS = \[([\s\S]*?)\];/)[1];
  assert.ok(!/'Read'/.test(list), 'plain Read is allowed');
});

test(T('security', 'The local interface asks for a password', 'Локалният интерфейс иска парола'), {
  todo: 'There are no users or passwords: anyone with access to your account on this computer can open the library. :: Няма потребители и пароли: всеки с достъп до вашия акаунт на този компютър може да отвори библиотеката.',
}, async () => {
  const r = await rawRequest(srv.port, { url: '/api/pages' });
  assert.equal(r.status, 401);
});

test(T('security', 'Library files are encrypted on disk', 'Файловете на библиотеката са шифровани на диска'), {
  todo: 'Files are plain text on disk. Use full-disk encryption (BitLocker, FileVault, LUKS) for sensitive material. :: Файловете са обикновен текст на диска. За чувствителни материали ползвайте шифроване на целия диск (BitLocker, FileVault, LUKS).',
}, () => {
  const before = 'A short sample text about entropy.';
  assert.ok(!box.read('raw/articles/sample-2020-note.txt').includes(before), 'readable as plain text');
});
