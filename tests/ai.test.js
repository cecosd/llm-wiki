// Други модели: API, съвместим с OpenAI (фалшив сървър в теста), ръчен режим и Claude Code с друг доставчик.
// Нищо не излиза в интернет и нищо не струва: проверява се какво приложението праща, какво записва и как реагира.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { T, makeSandbox, startServer, api, seedLibrary, waitFor, freePort, rawRequest } from './helpers.js';

// ---------- Фалшив модел (OpenAI /chat/completions) ----------
const calls = [];
const firstCite = (text) => (text.match(/\(\[\[[^\]]+\]\], p\. [\d?]+\)/) || ['([[sample-2020-note]], p. ?)'])[0];
function answer(prompt) {
  const pageOf = (t) => Number((t.match(/<!-- стр\. (\d+) -->/) || [])[1]) || null;
  if (/single word/.test(prompt)) return 'ok';
  if (/bibliographic data/.test(prompt)) return JSON.stringify({ title: 'Entropy and Order', authors: ['Carnot, S.'], year: 1990, apa: 'Carnot, S. (1990). *Entropy and order*. Test Press.', language: 'en', original_title: '', chapters: [{ title: 'Heat', printed_page: 1 }, { title: 'Order', printed_page: 3 }], tags: ['physics'] });
  if (/read this part of the source and return notes/.test(prompt)) {
    const p = pageOf(prompt) || 1;
    const second = p >= 3;
    return '```json\n' + JSON.stringify({
      title: second ? 'Order' : 'Heat', summary: second ? 'The chapter connects order and engines.' : 'The chapter introduces heat and entropy.',
      ideas: [{ text: second ? 'Order needs work.' : 'Entropy grows in closed systems.', page: p }],
      concepts: second
        ? [{ name: 'Heat engine', type: 'concept', note: 'Engines need a temperature difference.', page: p }, { name: 'Sadi Carnot', type: 'person', note: 'Described the ideal engine.', page: p + 1 }]
        : [{ name: 'Entropy', original: 'entropie', type: 'concept', note: 'Entropy measures disorder.', page: p }, { name: 'Heat engine', type: 'concept', note: 'A heat engine turns heat into work.', page: p + 1 }],
      quote: { text: 'Heat flows down.', page: p }, claims: [],
    }) + '\n```';
  }
  if (/write the data for its page in the library/.test(prompt)) return JSON.stringify({ in_brief: 'A short book about heat, order and entropy.', emphasis: 'The book puts the weight on entropy as the measure of order.', emphasis_reasoning: 'The stated purpose and the longest chapter show it.', key_ideas: [{ text: 'Entropy grows in closed systems.', page: 1, concept: 'Entropy' }, { text: 'Engines need a temperature difference.', page: 3, concept: 'Heat engine' }], area: 'Physics', tags: ['thermodynamics'], confidence: 'medium' });
  if (/write new pages of the library/.test(prompt)) {
    const pages = prompt.split('\n### ').slice(1).map((part) => {
      const [, name, kind] = part.split('\n')[0].match(/^(.+?)(?: \(.*\))?: (\w+)$/) || [, part.split('\n')[0], 'concept'];
      return { name, title: name, kind, definition: `${name} is defined in the notes ${firstCite(part)}.`, detail: `The source develops ${name} ${firstCite(part)}.`, aliases: [], tags: ['physics'] };
    });
    return JSON.stringify({ pages });
  }
  if (/already has pages for the items below/.test(prompt)) {
    const updates = prompt.split('\n### slug: ').slice(1).map((part) => ({ slug: part.split(/\s/)[0], add: `It also appears in engines ${firstCite(part)}.`, contradiction: '', aliases: ['entropie'] }));
    return JSON.stringify({ updates });
  }
  if (/reading assistant/.test(prompt)) return 'According to the source, entropy measures disorder ([[sample-2020-note]], p. ?).';
  return 'Fake answer.';
}
function fakeModel() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'fake-small' }, { id: 'fake-big' }] })); }
      let j = {}; try { j = JSON.parse(body); } catch {}
      const prompt = String(j.messages?.at(-1)?.content || '');
      calls.push({ url: req.url, auth: req.headers.authorization || null, model: j.model, prompt });
      res.setHeader('content-type', 'application/json');
      // Грешките на Google, както ги връща крайната точка, съвместима с OpenAI (масив с един обект)
      const google = (code, status, message, extra = {}) => { res.statusCode = code; res.end(JSON.stringify([{ error: { code, message, status, ...extra } }])); };
      if (j.model === 'err-prepay') return google(402, 'RESOURCE_EXHAUSTED', 'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.');
      if (j.model === 'err-daily') return google(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: err-daily\nPlease retry in 3.2s.', { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] }] });
      if (j.model === 'err-free0') return google(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: err-free0');
      if (j.model === 'err-minute' && calls.filter((c) => c.model === 'err-minute').length === 1) return google(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: err-minute\nPlease retry in 1s.', { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '5' }] }] });
      res.end(JSON.stringify({ choices: [{ message: { content: answer(prompt) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
    });
  });
}

let box, srv, model, modelPort;
const BOOK = 'raw/books/carnot-1990.pdf';
before(async () => {
  box = makeSandbox();
  seedLibrary(box);
  box.write(BOOK, '%PDF-1.4 fake');
  const pages = ['Chapter 1 Heat\nHeat flows from warm to cold.', 'Entropy grows in closed systems.', 'Chapter 2 Order\nEngines need a temperature difference.', 'Carnot described the ideal engine.'];
  box.write('raw/.extracted/books/carnot-1990.pdf.md', `<!-- извлечено от ${BOOK} | думи: 40 | 2026-11-09T00:00:00.000Z -->\n\n` + pages.map((t, i) => `<!-- стр. ${i + 1} -->\n${t}`).join('\n\n') + '\n');
  modelPort = await freePort();
  model = fakeModel();
  await new Promise((r) => model.listen(modelPort, '127.0.0.1', r));
  srv = await startServer(box);
});
after(async () => { await srv?.stop(); await new Promise((r) => (model ? model.close(r) : r())); box?.remove(); });

const KEY = 'sk-test-secret-123456';
const setProvider = (body) => api(srv.port, 'POST', '/api/ai', body);

test(T('ai', 'The model settings list the providers and start with the Claude subscription', 'Настройките на модела показват доставчиците и започват с абонамента за Claude'), async () => {
  const { json } = await api(srv.port, 'GET', '/api/ai');
  assert.equal(json.current.provider, 'claude-code');
  assert.equal(json.current.engine, 'agent');
  for (const id of ['claude-api', 'agent-ollama', 'openai', 'gemini', 'ollama', 'manual']) assert.ok(json.presets.some((p) => p.id === id), id);
});

test(T('ai', 'An API key is kept only in .library-secrets.json and never returned to the page', 'API ключът се пази само в .library-secrets.json и не се връща към страницата'), async () => {
  const r = await setProvider({ provider: 'openai-compatible', key: KEY, profile: { baseUrl: `http://127.0.0.1:${modelPort}/v1`, models: { light: 'fake-small', medium: 'fake-big', strong: '' }, context: 16000, name: 'Test model' } });
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  assert.ok(!r.body.includes(KEY), 'the key must not come back');
  assert.ok(box.read('.library-secrets.json').includes(KEY));
  assert.ok(!box.read('library.config.json').includes(KEY));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(box.root, '.library-secrets.json')).mode & 0o077, 0, 'only the owner may read the key file');
  const preset = r.json.presets.find((p) => p.id === 'openai-compatible');
  assert.equal(preset.keyMasked, '••••3456');
  const { json } = await api(srv.port, 'GET', '/api/agent');
  assert.equal(json.ai.engine, 'api');
  assert.equal(json.ai.name, 'Test model');
});

test(T('ai', 'The interface texts carry the name of the chosen model', 'Текстовете в интерфейса носят името на избрания модел'), async () => {
  const r = await rawRequest(srv.port, { url: '/locale.js' });
  assert.match(r.body, /"name":"Test model"/);
  assert.match(r.body, /Process with \{ai\}/);
  // Надпис, сменен само за този модел, стига до страницата
  await setProvider({ provider: 'openai-compatible', profile: { labels: { 'Process with {ai}': 'Run it' } } });
  assert.match((await rawRequest(srv.port, { url: '/locale.js' })).body, /"Process with \{ai\}":"Run it"/);
});

test(T('ai', 'Testing the connection and loading the models go to the chosen address with the key', 'Проверката на връзката и списъкът с модели отиват на избрания адрес с ключа'), async () => {
  const t = await api(srv.port, 'POST', '/api/setup/test');
  assert.equal(t.json.ok, true, JSON.stringify(t.json));
  const c = calls.find((x) => /single word/.test(x.prompt));
  assert.equal(c.auth, `Bearer ${KEY}`);
  assert.equal(c.model, 'fake-small');
  const m = await api(srv.port, 'POST', '/api/ai/models', { provider: 'openai-compatible' });
  assert.deepEqual(m.json.models, ['fake-big', 'fake-small']);
});

test(T('ai', 'A model on this computer is free in the estimate, which shows the tokens and the number of requests', 'Модел на този компютър е безплатен в оценката, която показва токените и броя заявки'), async () => {
  const { json } = await api(srv.port, 'POST', '/api/estimate', { kind: 'ingest', paths: [BOOK] });
  assert.equal(json.ok, true, JSON.stringify(json));
  assert.equal(json.engine, 'api');
  assert.equal(json.local, true, 'an address on localhost counts as a local model');
  assert.equal(json.free, true);
  assert.ok(json.calls >= 4, String(json.calls));
  assert.ok(json.input > 0);
});

test(T('ai', 'A model without tools processes a book: source, chapters, concepts, index and log', 'Модел без инструменти обработва книга: източник, глави, понятия, индекс и дневник'), async () => {
  const r = await api(srv.port, 'POST', '/api/agent/ingest', { paths: [BOOK] });
  assert.equal(r.json.queued, 1);
  const job = await waitFor(async () => {
    const { json } = await api(srv.port, 'GET', '/api/agent');
    return !json.current && !json.queue.length && json.history.find((h) => h.target === BOOK);
  }, 30000);
  assert.equal(job.status, 'done', `${job.report} ${job.detail || ''}`);
  const src = box.read('wiki/sources/carnot-1990-entropy.md');
  assert.match(src, /raw_path: raw\/books\/carnot-1990\.pdf/);
  assert.match(src, /depth: 2/);
  assert.match(src, /emphasis: The book puts the weight on entropy/);
  assert.match(src, /\[\[carnot-1990-entropy-ch01\]\]/);
  assert.match(box.read('wiki/sources/chapters/carnot-1990-entropy-ch02.md'), /pages: 3-4/);
  assert.ok(box.exists('wiki/concepts/heat-engine.md'), 'a new concept page');
  assert.ok(box.exists('wiki/entities/carnot-sadi.md'), 'a person page, surname first');
  const entropy = box.read('wiki/concepts/entropy.md');
  assert.match(entropy, /It also appears in engines \(\[\[carnot-1990-entropy-ch01\]\], p\. 1\)/, 'the existing concept is extended, with a citation to the chapter');
  assert.match(entropy, /A measure of disorder/, 'nothing of the old text is lost');
  assert.match(box.read('wiki/index.md'), /\[\[carnot-1990-entropy\]\]/);
  assert.match(box.read('wiki/log.md'), /ingest: Carnot, S\. \(1990\) Entropy and Order/);
  // AI_TEST_PEEK=1 показва написаните страници (за преглед на окото)
  if (process.env.AI_TEST_PEEK) for (const f of ['wiki/sources/carnot-1990-entropy.md', 'wiki/sources/chapters/carnot-1990-entropy-ch01.md', 'wiki/concepts/entropy.md', 'wiki/entities/carnot-sadi.md', 'wiki/log.md']) console.log(`===== ${f}\n${box.read(f)}`);
  assert.equal(box.claudeCalls().length, 0, 'Claude Code is not used');
  assert.equal(box.script('lint.js', '--quick').status, 0, 'no broken links');
  assert.ok(calls.some((c) => c.model === 'fake-small' && /return notes/.test(c.prompt)), 'chapters are read by the light model');
});

test(T('ai', 'A question about a page sends the page and the original text inside the request', 'Въпрос към страница праща страницата и оригиналния текст в самата заявка'), async () => {
  const r = await api(srv.port, 'POST', '/api/ask', { slug: 'entropy', question: 'What does it measure?', level: 'medium' });
  assert.equal(r.status, 200, r.body);
  assert.match(r.json.answer, /entropy measures disorder/);
  const c = calls.filter((x) => /reading assistant/.test(x.prompt)).at(-1);
  assert.match(c.prompt, /A measure of disorder/, 'the page is in the request');
  assert.match(c.prompt, /<!-- стр\. 1 -->/, 'the original pages are in the request');
});

test(T('ai', 'Copy and paste: the request waits for the answer pasted from a chat', 'Копиране и поставяне: заявката чака отговора, поставен от чата'), async () => {
  await setProvider({ provider: 'manual', profile: { name: 'ChatGPT' } });
  const pending = api(srv.port, 'POST', '/api/ask', { slug: 'entropy', question: 'What is it?', level: 'light' });
  const item = await waitFor(async () => (await api(srv.port, 'GET', '/api/manual')).json[0]);
  assert.match(item.text, /A measure of disorder/);
  const bad = await api(srv.port, 'POST', `/api/manual/${item.id}`, { text: '  ' });
  assert.equal(bad.json.ok, false);
  await api(srv.port, 'POST', `/api/manual/${item.id}`, { text: 'Answer pasted from the chat.' });
  const r = await pending;
  assert.equal(r.json.answer, 'Answer pasted from the chat.');
  assert.deepEqual((await api(srv.port, 'GET', '/api/manual')).json, []);
});

test(T('ai', 'Claude Code with another provider gets its address and models, without the Claude effort flag', 'Claude Code с друг доставчик получава адреса и моделите му, без флага за усилие на Claude'), async () => {
  await setProvider({ provider: 'agent-deepseek', key: 'sk-ds-test', profile: { models: { light: 'ds-chat', medium: 'ds-chat', strong: 'ds-reasoner' } } });
  box.write('raw/articles/second.txt', 'A second text.\n');
  assert.equal(box.script('extract.js').status, 0);
  await api(srv.port, 'POST', '/api/agent/ingest', { paths: ['raw/articles/second.txt'] });
  const call = await waitFor(() => box.claudeCalls().find((c) => c.args.includes('stream-json')));
  assert.equal(call.env.baseUrl, 'https://api.deepseek.com/anthropic');
  assert.equal(call.env.hasToken, true);
  assert.equal(call.env.sonnet, 'ds-chat');
  assert.equal(call.env.opus, 'ds-reasoner');
  assert.ok(!call.args.includes('--effort'));
  assert.match(call.args[call.args.indexOf('--disallowedTools') + 1], /\.library-secrets\.json/);
});

test(T('ai', 'The Claude subscription leaves the environment of Claude Code untouched', 'Абонаментът за Claude оставя средата на Claude Code непроменена'), async () => {
  await waitFor(async () => { const { json } = await api(srv.port, 'GET', '/api/agent'); return !json.current && !json.queue.length; });
  await setProvider({ provider: 'claude-code' });
  box.write('raw/articles/third.txt', 'A third text.\n');
  assert.equal(box.script('extract.js').status, 0);
  const before = box.claudeCalls().length;
  await api(srv.port, 'POST', '/api/agent/ingest', { paths: ['raw/articles/third.txt'] });
  const call = await waitFor(() => box.claudeCalls().slice(before).find((c) => c.args.includes('stream-json')));
  assert.equal(call.env.baseUrl, null);
  assert.equal(call.env.sonnet, null);
});

test(T('ai', 'Used-up prepaid credit, a used-up daily limit and a model without a free tier get a clear message and no repeated requests', 'Изчерпан предплатен кредит, изчерпан дневен лимит и модел без безплатно ниво дават ясно съобщение и без повторни заявки'), async () => {
  const cases = [['err-prepay', /prepaid credit of the project.*without billing/s], ['err-daily', /daily limit of requests for the model “err-daily”.*midnight Pacific/s], ['err-free0', /“err-free0” has no free tier/]];
  for (const [m, re] of cases) {
    await setProvider({ provider: 'openai-compatible', profile: { models: { light: m, medium: 'fake-small', strong: '' } } });
    const t = await api(srv.port, 'POST', '/api/setup/test');
    assert.equal(t.json.ok, false, m);
    assert.match(t.json.error, re);
    assert.equal(calls.filter((c) => c.model === m).length, 1, `${m}: no repeated request`);
  }
  // Лимит на минута: изчаква колкото казва Google („retry in 1s“) и минава от втория опит
  await setProvider({ provider: 'openai-compatible', profile: { models: { light: 'err-minute', medium: 'fake-small', strong: '' } } });
  const started = Date.now();
  const t = await api(srv.port, 'POST', '/api/setup/test');
  assert.equal(t.json.ok, true, JSON.stringify(t.json));
  assert.equal(calls.filter((c) => c.model === 'err-minute').length, 2);
  assert.ok(Date.now() - started < 4500, 'waits about the time Google asks, not the default 5 s');
  await setProvider({ provider: 'openai-compatible', profile: { models: { light: 'fake-small', medium: 'fake-big', strong: '' } } });
});

test(T('ai', 'Gemini has a free profile (Flash-Lite reads, Flash writes) and a paid one with prices for the estimate', 'Gemini има безплатен профил (Flash-Lite чете, Flash пише) и платен с цени за оценката'), async () => {
  const { json } = await api(srv.port, 'GET', '/api/ai');
  const free = json.presets.find((p) => p.id === 'gemini'), paid = json.presets.find((p) => p.id === 'gemini-paid');
  assert.equal(free.free, true);
  assert.match(free.defaults.models.light, /flash-lite/);
  assert.match(free.defaults.models.medium, /flash/);
  assert.equal(paid.free, false);
  assert.ok(paid.defaults.prices.medium.in > 0 && paid.values.prices.medium.out > 0, 'the prices of the profile are filled in');
  await setProvider({ provider: 'gemini-paid', key: 'AIza-test-key' });
  const e = await api(srv.port, 'POST', '/api/estimate', { kind: 'ingest', paths: [BOOK] });
  assert.equal(e.json.free, false);
  assert.ok(e.json.usd?.mid > 0, JSON.stringify(e.json));
  const { msToPacificMidnight } = await import(pathToFileURL(path.join(box.root, 'scripts', 'llm.js')).href);
  assert.equal(msToPacificMidnight(new Date('2026-11-09T20:00:00Z')), 12 * 3600000, 'noon in Los Angeles is 12 hours before the reset');
});

test(T('ai', 'The agent cannot read the file with the keys', 'Агентът не може да прочете файла с ключовете'), async () => {
  const { reasonToBlock } = await import(pathToFileURL(path.join(box.root, 'scripts', 'guard-read.js')).href);
  assert.ok(reasonToBlock({ tool_name: 'Read', tool_input: { file_path: path.join(box.root, '.library-secrets.json') } }, box.root));
  assert.ok(reasonToBlock({ tool_name: 'Grep', tool_input: { path: box.root, glob: '.library-secrets*' } }, box.root));
});
