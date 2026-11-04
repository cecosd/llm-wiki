// Приложение и интерфейс: сървърът тръгва, екраните са свързани, преводите са пълни.
// Истински браузър се ползва, ако има: задава се с CHROME_BIN или се търси в обичайните пътища.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { T, makeSandbox, startServer, rawRequest, api, seedLibrary, PROJECT } from './helpers.js';
import { findChrome, openBrowser } from './browser.js';

let box, srv;
before(async () => { box = makeSandbox(); seedLibrary(box); srv = await startServer(box); });
after(async () => { await srv?.stop(); box?.remove(); });

const CHROME = findChrome();

test(T('app', 'All server and browser scripts have valid syntax', 'Всички скриптове на сървъра и браузъра са със здрав синтаксис'), () => {
  const files = [...fs.readdirSync(path.join(box.root, 'scripts')).filter((f) => f.endsWith('.js')).map((f) => path.join('scripts', f)), 'scripts/viewer/app.js', 'scripts/viewer/i18n.js'];
  assert.ok(files.length > 15);
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', path.join(box.root, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test(T('app', 'The application opens and serves its main page and libraries', 'Приложението се отваря и връща основната страница и библиотеките'), async () => {
  const home = await rawRequest(srv.port, { url: '/' });
  assert.equal(home.status, 200);
  assert.match(home.body, /id="tpl-app"/);
  for (const f of ['vue.js', 'marked.js', 'tailwind.js']) assert.equal((await rawRequest(srv.port, { url: `/vendor/${f}` })).status, 200, f);
  assert.equal((await rawRequest(srv.port, { url: '/locale.js' })).status, 200);
});

test(T('app', 'Every screen component has its template', 'Всеки екран има своя шаблон'), () => {
  const html = box.read('scripts/viewer/index.html');
  const js = box.read('scripts/viewer/app.js');
  const used = [...js.matchAll(/template:\s*'#(tpl-[\w-]+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 5);
  for (const id of used) assert.ok(html.includes(`id="${id}"`), id);
});

test(T('app', 'Every menu address leads to a screen', 'Всеки адрес от менюто води към екран'), () => {
  const html = box.read('scripts/viewer/index.html');
  const js = box.read('scripts/viewer/app.js');
  for (const name of ['path', 'write', 'find', 'areas', 'graph', 'setup', 'settings']) {
    assert.ok(html.includes(`href="#/${name}"`), `menu ${name}`);
    assert.ok(js.includes(`parts[0] === '${name}'`), `route ${name}`);
    assert.ok(html.includes(`route.name==='${name}'`), `view ${name}`);
  }
});

test(T('app', 'Pages, search, link map and statistics answer correctly', 'Страниците, търсенето, картата на връзките и статистиката отговарят правилно'), async () => {
  const pages = (await api(srv.port, 'GET', '/api/pages')).json;
  assert.ok(pages.some((p) => p.slug === 'entropy'));
  const page = (await api(srv.port, 'GET', '/api/page/entropy')).json;
  assert.equal(page.data?.title ?? page.title, 'Entropy');
  assert.equal((await api(srv.port, 'GET', '/api/page/no-such-page')).status, 404);
  assert.ok(JSON.stringify((await api(srv.port, 'GET', '/api/search?q=entropy')).json).includes('entropy'));
  assert.ok(JSON.stringify((await api(srv.port, 'GET', '/api/graph')).json).includes('entropy'));
  assert.equal((await api(srv.port, 'GET', '/api/stats')).status, 200);
});

test(T('app', 'Learning by question works locally without Claude', 'Ученето по въпрос работи локално, без Claude'), async () => {
  const r = await api(srv.port, 'GET', '/api/path?q=entropy');
  assert.equal(r.status, 200, r.body);
  assert.ok(JSON.stringify(r.json).includes('entropy'));
});

test(T('app', 'A page can be renamed by hand without changing its file name', 'Страница може да се преименува на ръка, без да се сменя името на файла'), async () => {
  const r = await api(srv.port, 'POST', '/api/page/rename', { slug: 'entropy', title: 'Entropy (renamed)' });
  assert.equal(r.status, 200, r.body);
  assert.match(box.read('wiki/concepts/entropy.md'), /title: .*Entropy \(renamed\)/);
  assert.ok(box.exists('wiki/concepts/entropy.md'));
});

test(T('app', 'The interface is complete in English and Bulgarian', 'Интерфейсът е пълен на английски и български'), () => {
  const r = box.script('i18n-check.js');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const en = JSON.parse(box.read('locales/en.json')).messages;
  const bg = JSON.parse(box.read('locales/bg.json')).messages;
  assert.deepEqual(Object.keys(en).filter((k) => !(k in bg)), []);
});

test(T('app', 'The language of the interface follows the choice of the user', 'Езикът на интерфейса следва избора на потребителя'), async () => {
  const bg = await rawRequest(srv.port, { url: '/locale.js', headers: { cookie: 'lang=bg' } });
  assert.match(bg.body, /"lang":"bg"/);
  const en = await rawRequest(srv.port, { url: '/locale.js', headers: { cookie: 'lang=en' } });
  assert.match(en.body, /"lang":"en"/);
});

test(T('app', 'The product page opens and names its authors', 'Страницата за продукта се отваря и посочва авторите си'), async () => {
  assert.equal((await rawRequest(srv.port, { url: '/product/' })).status, 200);
  const js = fs.readFileSync(path.join(PROJECT, 'docs', 'landing.js'), 'utf8');
  assert.equal((await rawRequest(srv.port, { url: '/product/landing.js' })).status, 200);
  for (const s of ['SDevelopers LTD', 'ЕсДевелопърс ЕООД', 'Claude']) assert.ok(js.includes(s), s);
  assert.ok(!js.includes('—'), 'no em dash in the texts');
  for (const f of ['vendor/vue.js', 'vendor/tailwind.js']) assert.equal((await rawRequest(srv.port, { url: `/product/${f}` })).status, 200, f);
});

test(T('app', 'Screens and the product page open in a real browser', 'Екраните и страницата за продукта се отварят в истински браузър'), {
  skip: CHROME ? false : 'No browser was found on the test machine, or Node.js is older than 22. Set CHROME_BIN to run this test. :: На тестовата машина няма браузър или Node.js е по-стар от 22. Задайте CHROME_BIN, за да се пусне този тест.',
}, async () => {
  const b = await openBrowser(CHROME);
  try {
    const base = `http://localhost:${srv.port}`;
    const screens = { '/#/': 'Library', '/#/settings': 'Check for a new version', '/#/setup': 'Getting the library ready', '/#/areas': 'Areas of knowledge', '/#/p/entropy': 'A measure of disorder', '/product/?lang=bg': 'ЕсДевелопърс ЕООД', '/product/?lang=en': 'What works and what does not' };
    for (const [url, text] of Object.entries(screens)) {
      await b.goto(base + url);
      assert.ok(await b.waitForText(text), `${url} does not show “${text}”`);
    }
  } finally { await b.close(); }
});
