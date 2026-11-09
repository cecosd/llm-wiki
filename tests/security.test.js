// Сигурност: проверява се истинският сървър, пуснат във временно копие.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { T, makeSandbox, startServer, rawRequest, api, seedLibrary, PROJECT } from './helpers.js';
import { findChrome, openBrowser } from './browser.js';

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
  for (const rule of ['/raw/*', '/wiki/sources/*', '/wiki/concepts/*', '/drafts/', '/outputs/*', '/library.config.json', '/.library-auth.json', '/CLAUDE.local.md', '/.library-git/']) {
    assert.ok(ignore.includes(rule), rule);
  }
});

const HOSTILE = `---
title: Hostile page
type: concept
tags: [sample]
sources: []
related: []
created: 2026-01-01
updated: 2026-01-01
confidence: low
---

# Hostile page

CLEAN-TEXT-MARKER

<img src=x onerror="document.title='XSS-RAN'">
<script>document.title='XSS-RAN'</script>
<svg onload="document.title='XSS-RAN'"></svg>
<div style="position:fixed;inset:0" class="fixed inset-0" onclick="document.title='XSS-RAN'">covered</div>
<iframe srcdoc="<script>parent.document.title='XSS-RAN'</script>"></iframe>
<a id="jslink" href="javascript:document.title='XSS-RAN'">raw link</a>
<a href="  java&#10;script:document.title='XSS-RAN'">hidden scheme</a>
<a id="okay" href="https://example.com/a">good link</a>
<img id="beacon" src="https://example.com/leak?d=secret">

Markdown: [md link](javascript:document.title='XSS-RAN') and [data link](data:text/html,x) and ![pixel](https://example.com/p.png) and ![pixel2](//example.com/p.png).
`;

test(T('security', 'Content from a document cannot run code in the browser', 'Съдържание от документ не може да изпълни код в браузъра'), {
  skip: findChrome() ? false : 'No browser was found on the test machine, or Node.js is older than 22. Set CHROME_BIN to run this test. :: На тестовата машина няма браузър или Node.js е по-стар от 22. Задайте CHROME_BIN, за да се пусне този тест.',
}, async () => {
  box.write('wiki/concepts/hostile-page.md', HOSTILE);
  const b = await openBrowser(findChrome());
  try {
    await b.goto(`http://localhost:${srv.port}/#/p/hostile-page`);
    assert.ok(await b.waitForText('CLEAN-TEXT-MARKER'), 'the page did not open');
    await new Promise((r) => setTimeout(r, 500));
    assert.notEqual(await b.evaluate('document.title'), 'XSS-RAN');
    const html = await b.evaluate(`document.querySelector('.reading').innerHTML`);
    assert.doesNotMatch(html, /onerror|onload|onclick|<script|<iframe|<svg|position:\s*fixed|inset-0/i);
    const hrefs = await b.evaluate(`JSON.stringify([...document.querySelectorAll('.reading a[href]')].map((a) => a.href))`);
    for (const h of JSON.parse(hrefs)) assert.match(h, /^(https?:|mailto:)/, h);
    // Картинка от чужд адрес се зарежда сама и може да изнесе данни (в архива няма CSP): не остава в страницата.
    const srcs = await b.evaluate(`JSON.stringify([...document.querySelectorAll('.reading img')].map((i) => i.getAttribute('src')))`);
    for (const s of JSON.parse(srcs)) assert.doesNotMatch(String(s), /^(https?:)?\/\//i, s);
    assert.equal(await b.evaluate(`document.querySelector('.reading a[href="https://example.com/a"]')?.textContent`), 'good link', 'safe links stay');
    // Втората защита: дори нещо да мине през пречистването, вграденият код не се изпълнява.
    await b.evaluate(`(() => { const d = document.createElement('div'); d.innerHTML = '<img src=x onerror="document.title=&quot;CSP-FAILED&quot;">'; document.body.append(d); const s = document.createElement('script'); s.textContent = 'document.title="CSP-FAILED"'; document.body.append(s); })()`);
    await new Promise((r) => setTimeout(r, 500));
    assert.notEqual(await b.evaluate('document.title'), 'CSP-FAILED');
  } finally { await b.close(); box.write('wiki/concepts/hostile-page.md', ''); fs.rmSync(path.join(box.root, 'wiki/concepts/hostile-page.md')); }
});

test(T('security', 'Pages have a strict Content-Security-Policy and safe headers', 'Страниците имат строга Content-Security-Policy и безопасни заглавки'), async () => {
  for (const url of ['/', '/product/', '/api/stats']) {
    const h = (await rawRequest(srv.port, { url })).headers;
    const csp = String(h['content-security-policy']);
    assert.match(csp, /default-src 'self'/, url);
    assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline/, url);
    assert.match(csp, /object-src 'none'/, url);
    assert.match(csp, /frame-ancestors 'none'/, url);
    assert.equal(h['x-content-type-options'], 'nosniff', url);
    assert.equal(h['x-powered-by'], undefined, url);
  }
  // В страниците няма вграден код, иначе политиката би ги счупила.
  for (const f of ['scripts/viewer/index.html', 'docs/index.html']) assert.doesNotMatch(box.read(f), /<script>/, f);
});

test(T('security', 'Uploaded HTML and SVG open isolated from the application', 'Качени HTML и SVG се отварят изолирани от приложението'), async () => {
  box.write('raw/web/evil.html', '<script>fetch("/api/pages")</script>');
  box.write('raw/images/evil.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  box.write('raw/papers/ok.pdf', '%PDF-1.4');
  for (const url of ['/raw/web/evil.html', '/raw/images/evil.svg']) assert.match(String((await rawRequest(srv.port, { url })).headers['content-security-policy']), /^sandbox/, url);
  assert.equal((await rawRequest(srv.port, { url: '/raw/papers/ok.pdf' })).headers['content-security-policy'], undefined, 'the browser PDF viewer must keep working');
});

test(T('security', 'Other websites cannot read data even with a simple request', 'Други сайтове не могат да четат данни дори с обикновена заявка'), async () => {
  const get = (headers) => rawRequest(srv.port, { url: '/api/pages', headers });
  assert.equal((await get({ origin: 'https://evil.example' })).status, 403);
  assert.equal((await get({ origin: 'null' })).status, 403);
  assert.equal((await get({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' })).status, 403);
  assert.equal((await get({ 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors' })).status, 403, 'another port on this computer');
  assert.equal((await get({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' })).status, 200);
  assert.equal((await get({ origin: `http://localhost:${srv.port}` })).status, 200);
  assert.equal((await rawRequest(srv.port, { url: '/', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } })).status, 200, 'opening a link stays possible');
});

test(T('security', 'Claude can read only inside the project folder', 'Claude може да чете само в папката на проекта'), () => {
  const code = box.read('scripts/agent.js');
  const list = code.match(/const ALLOWED_TOOLS = \[([\s\S]*?)\];/)[1];
  assert.ok(!/'Read'/.test(list), 'plain Read is allowed');
  assert.ok(list.includes("'Read(./**)'"));
  assert.ok(!/allowedTools', 'Read/.test(code), 'plain Read in the question mode');
  assert.equal((code.match(/\.\.\.guardArgs\(\)/g) || []).length, 2, 'every start of Claude uses the guard');

  // Истинската кука, като отделен процес, както я пуска Claude Code.
  const guard = (tool_name, tool_input) => spawnSync(process.execPath, [path.join(box.root, 'scripts/guard-read.js')], { input: JSON.stringify({ tool_name, tool_input, cwd: box.root }), encoding: 'utf8' }).status;
  const outside = path.join(os.tmpdir(), 'outside.txt');
  for (const [tool, input] of [
    ['Read', { file_path: outside }], ['Read', { file_path: '../outside.txt' }], ['Read', { file_path: path.join(os.homedir(), '.ssh/id_rsa') }],
    ['Grep', { pattern: 'x', path: os.tmpdir() }], ['Grep', { pattern: 'x', path: '..' }], ['Grep', { pattern: 'x', glob: '../**' }], ['Grep', { pattern: 'x', glob: '/etc/*' }],
    ['Glob', { pattern: '*', path: os.tmpdir() }], ['Glob', { pattern: '../*' }], ['Glob', { pattern: '/etc/*' }], ['Glob', { pattern: 'raw/../../*' }],
    ['Read', { file_path: '.git/config' }], ['Read', { file_path: '.library-git/HEAD' }], ['Read', { file_path: '.library-auth.json' }], ['Read', { file_path: 'library.config.json' }], ['Grep', { pattern: 'x', path: '.library-git' }], ['Glob', { pattern: '.library-git/**' }],
  ]) assert.equal(guard(tool, input), 2, `${tool} ${JSON.stringify(input)}`);
  for (const [tool, input] of [
    ['Read', { file_path: path.join(box.root, 'wiki/index.md') }], ['Read', { file_path: 'raw/.extracted/a.md' }], ['Read', { file_path: 'CLAUDE.md' }],
    ['Grep', { pattern: 'x' }], ['Grep', { pattern: 'x', path: 'wiki', glob: '**/*.md' }], ['Glob', { pattern: 'wiki/**/*.md' }],
  ]) assert.equal(guard(tool, input), 0, `${tool} ${JSON.stringify(input)}`);
  assert.notEqual(spawnSync(process.execPath, [path.join(box.root, 'scripts/guard-read.js')], { input: 'not json', encoding: 'utf8' }).status, 0, 'unreadable request is refused');
});

test(T('security', 'Claude cannot copy files from outside raw/ through text extraction', 'Claude не може да копира файлове извън raw/ чрез извличането на текст'), () => {
  // Claude има право да пуска `npm run extract <път>`. Път извън raw/ не бива да се извлича: иначе текстът на чужд файл
  // попада в проекта, където Claude може да го прочете.
  const tag = `x${process.pid}${Date.now()}`;
  const sibling = path.join(path.dirname(box.root), `${tag}-other-project`);
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'SECRET-OUTSIDE');
  box.write('.library-auth.json', '{"salt":"00","hash":"00"}');
  try {
    for (const target of [path.join(sibling, 'secret.txt'), `../${path.basename(sibling)}/secret.txt`, 'raw/../.library-auth.json', '.library-auth.json']) {
      const r = box.script('extract.js', target);
      assert.notEqual(r.status, 0, target);
      assert.match(r.stderr + r.stdout, /raw\//, target);
    }
    // Там, където старият код би записал текста: в проекта и до него
    assert.ok(!box.exists(`${path.basename(sibling)}/secret.txt.md`), 'copied into the project');
    assert.ok(!box.exists('raw/.library-auth.json.md'), 'password file copied under another name');
    // Обикновен файл в raw/ се извлича както преди
    box.write('raw/articles/plain.txt', 'plain text');
    assert.equal(box.script('extract.js', 'raw/articles/plain.txt').status, 0);
    assert.ok(box.exists('raw/.extracted/articles/plain.txt.md'));
  } finally { fs.rmSync(sibling, { recursive: true, force: true }); fs.rmSync(path.join(box.root, '.library-auth.json'), { force: true }); }
});

test(T('security', 'A forged raw_path cannot delete files outside the library', 'Подправен raw_path не може да изтрие файлове извън библиотеката'), () => {
  const victim = path.join(path.dirname(box.root), `victim-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(victim, 'must stay');
  // raw/../../../<име> води до папката над проекта (както би го написал подведен Claude)
  const rawPath = `raw/../../../${path.basename(victim, '.md')}`;
  box.write('wiki/sources/forged-src.md', `---\ntitle: Forged\ntype: source\ntags: []\nsources: []\nrelated: []\ncreated: 2026-01-01\nupdated: 2026-01-01\nconfidence: low\nraw_path: ${rawPath}\nformat: article\n---\n\n# Forged\n`);
  try {
    const r = box.script('remove.js', 'forged-src', '--apply');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(victim), 'the file outside the library was deleted');
    assert.ok(!box.exists('wiki/sources/forged-src.md'), 'the page itself is removed as usual');
  } finally { fs.rmSync(victim, { force: true }); fs.rmSync(path.join(box.root, 'wiki/sources/forged-src.md'), { force: true }); }
});

test(T('security', 'The guard settings are outside the folders Claude may write to', 'Настройките на пазача са извън папките, в които Claude може да пише'), async () => {
  const { guardArgs } = await import(pathToFileURL(path.join(box.root, 'scripts', 'agent.js')).href);
  const args = guardArgs();
  const file = args[args.indexOf('--settings') + 1];
  assert.ok(file && fs.existsSync(file), 'the settings file exists');
  for (const dir of ['wiki', 'outputs']) assert.ok(path.relative(path.join(box.root, dir), file).startsWith('..'), `inside ${dir}/`);
  assert.match(fs.readFileSync(file, 'utf8'), /guard-read\.js/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.dirname(file)).mode & 0o077, 0, 'the folder is private');
});

test(T('security', 'The my.wiki name is accepted only after it is set in hosts', 'Името my.wiki се приема само след запис в hosts'), async () => {
  // .wiki е истински домейн: без запис в hosts чужд сървър би могъл да се представи като my.wiki (DNS rebinding).
  assert.ok(!box.exists('.wiki-launch'));
  for (const host of ['my.wiki', `my.wiki:${srv.port}`]) assert.equal((await rawRequest(srv.port, { url: '/api/pages', headers: { host } })).status, 403, host);
});

test(T('security', 'The addresses are checked at the moment of connecting (DNS rebinding)', 'Адресите се проверяват в момента на свързване (DNS rebinding)'), async () => {
  const code = box.read('scripts/discover.js');
  assert.match(code, /lookup: guardedLookup/);
  assert.doesNotMatch(code, /await fetch\(/);
  const { guardedLookup, isPrivateIp } = await import(pathToFileURL(path.join(box.root, 'scripts/discover.js')).href);
  // 'localhost' минава през истинския DNS на машината и дава вътрешен адрес.
  const err = await new Promise((resolve) => guardedLookup('localhost', {}, (e) => resolve(e)));
  assert.ok(err, 'a name that resolves to an internal address must fail while connecting');
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1', '192.168.0.1', '100.64.0.1', '0.0.0.0', '198.18.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::', 'ff02::1', 'nonsense']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test(T('security', 'When a password is set, nothing opens without signing in', 'Когато е зададена парола, нищо не се отваря без вход'), async () => {
  const box2 = makeSandbox();
  seedLibrary(box2);
  const s = await startServer(box2);
  try {
    assert.equal((await rawRequest(s.port, { url: '/api/pages' })).status, 200, 'off by default');
    const set = (body, headers = {}) => rawRequest(s.port, { method: 'POST', url: '/api/auth/password', headers: { 'x-library': '1', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal(JSON.parse((await set({ password: 'short' })).body).ok, false, 'a short password is refused');
    const on = await set({ password: 'correct horse battery' });
    assert.equal(JSON.parse(on.body).ok, true);
    const cookie = on.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    const session = cookie.split(';')[0];

    const stored = box2.read('.library-auth.json');
    assert.ok(!stored.includes('correct horse'), 'the password is not stored as text');

    for (const url of ['/api/pages', '/api/settings', '/raw/articles/sample-2020-note.txt', '/api/events', '/app.js']) assert.equal((await rawRequest(s.port, { url })).status, 401, url);
    assert.equal((await rawRequest(s.port, { url: '/', headers: { accept: 'text/html' } })).headers.location, '/login');
    assert.equal((await rawRequest(s.port, { url: '/api/pages', headers: { cookie: 'library_session=wrong' } })).status, 401);
    assert.equal((await rawRequest(s.port, { url: '/api/pages', headers: { cookie: session } })).status, 200);

    const login = (password) => rawRequest(s.port, { method: 'POST', url: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(password)}` });
    assert.equal((await login('wrong password')).status, 401);
    const good = await login('correct horse battery');
    assert.equal(good.status, 303);
    assert.equal((await rawRequest(s.port, { url: '/api/pages', headers: { cookie: good.headers['set-cookie'][0].split(';')[0] } })).status, 200);

    // Смяна и махане искат текущата парола.
    assert.equal(JSON.parse((await set({ current: 'nope', password: null }, { cookie: session })).body).ok, false);
    // След няколко грешни опита дори вярната парола чака.
    for (let i = 0; i < 5; i++) await login('wrong password');
    assert.equal((await login('correct horse battery')).status, 401, 'locked after repeated failures');
  } finally { await s.stop(); box2.remove(); }
});

test(T('security', 'Library files are encrypted on disk', 'Файловете на библиотеката са шифровани на диска'), {
  todo: 'Files are plain text on disk. Use full-disk encryption (BitLocker, FileVault, LUKS) for sensitive material. :: Файловете са обикновен текст на диска. За чувствителни материали ползвайте шифроване на целия диск (BitLocker, FileVault, LUKS).',
}, () => {
  const before = 'A short sample text about entropy.';
  assert.ok(!box.read('raw/articles/sample-2020-note.txt').includes(before), 'readable as plain text');
});
