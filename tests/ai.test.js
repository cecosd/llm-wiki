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
  // Писане с wiki: художествен текст (цитат в текста, който трябва да изчезне, и списък „Based on“), абзац, дописване
  const filler = 'The old monk copied the pages slowly and thought about how order fades in a closed room. '.repeat(9);
  if (/You are writing a literary text/.test(prompt)) return `# The Copyist\n\n${filler}He remembered that disorder grows ([[sample-2020-note]], p. 1).\n\n* * *\n\n${filler}\n\n## Based on\n\n- [[sample-2020-note]]\n- [[no-such-page]]`;
  if (/TASK: rewrite the marked passage/.test(prompt)) return 'A rewritten paragraph: entropy measures disorder ([[sample-2020-note]], p. 2).';
  if (/TASK: write a NEW passage for the marked place/.test(prompt)) return '```markdown\nA new paragraph about order and work ([[sample-2020-note]], p. 3).\n```';
  if (/TASK: write a NEW text that is added to the end of the text/.test(prompt)) return `## Engines\n\n${'Engines turn the flow of heat into work and leave more disorder behind. '.repeat(6)}([[sample-2020-note]], p. 4).`;
  return 'Fake answer.';
}
function fakeModel() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      // Като списъка на Groq: модели за текст, за реч и за проверки за безопасност, и един изключен
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ data: [{ id: 'fake-small', active: true }, { id: 'whisper-large-v3' }, { id: 'canopylabs/orpheus-v1-english' }, { id: 'fake-big' }, { id: 'meta-llama/llama-prompt-guard-2-22m' }, { id: 'fake-retired', active: false }] }));
      }
      let j = {}; try { j = JSON.parse(body); } catch {}
      const prompt = String(j.messages?.at(-1)?.content || '');
      calls.push({ url: req.url, auth: req.headers.authorization || null, model: j.model, prompt, max: j.max_tokens || j.max_completion_tokens || null, effort: j.reasoning_effort || null, temp: j.temperature ?? null, system: j.messages?.[0]?.role === 'system' ? j.messages[0].content : null });
      res.setHeader('content-type', 'application/json');
      // Грешките на Google, както ги връща крайната точка, съвместима с OpenAI (масив с един обект)
      const google = (code, status, message, extra = {}) => { res.statusCode = code; res.end(JSON.stringify([{ error: { code, message, status, ...extra } }])); };
      if (j.model === 'err-prepay') return google(402, 'RESOURCE_EXHAUSTED', 'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.');
      if (j.model === 'err-daily') return google(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: err-daily\nPlease retry in 3.2s.', { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] }] });
      if (j.model === 'err-free0') return google(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: err-free0');
      if (j.model === 'err-minute' && calls.filter((c) => c.model === 'err-minute').length === 1) return google(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: err-minute\nPlease retry in 1s.', { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '5' }] }] });
      // Грешките на Groq: обект { error: { message, type } }, с текстовете от тестовата инсталация
      const groq = (code, message, type = 'invalid_request_error') => { res.statusCode = code; res.end(JSON.stringify({ error: { message, type } })); };
      if (j.model === 'whisper-large-v3') return groq(400, 'The model `whisper-large-v3` does not support chat completions');
      if (j.model === 'canopylabs/orpheus-v1-english') return groq(400, 'The model `canopylabs/orpheus-v1-english` requires terms acceptance. Please have the org admin accept the terms at https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english');
      if (j.model === 'err-toobig') return groq(413, 'Request too large for model `err-toobig` in organization `org_test` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 9500, please reduce your message size and try again.', 'tokens');
      if (j.model === 'err-tpd') return groq(429, 'Rate limit reached for model `err-tpd` in organization `org_test` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199990, Requested 900. Please try again in 2m30s.', 'tokens');
      // Модел, който „мисли“ и стига лимита за изход: първият отговор е отрязан (finish_reason „length“)
      if (j.model === 'err-cut' && calls.filter((c) => c.model === 'err-cut').length === 1) return res.end(JSON.stringify({ choices: [{ message: { content: '{"answ' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 300 } }));
      if (j.model === 'err-tpm' && calls.filter((c) => c.model === 'err-tpm').length === 1) return groq(429, 'Rate limit reached for model `err-tpm` in organization `org_test` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 500. Please try again in 1.2s.', 'tokens');
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
  assert.deepEqual(m.json.models, ['fake-big', 'fake-small'], 'only text models, without the retired one');
  assert.equal(m.json.hidden, 3, 'speech and safety models are counted as hidden');
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

test(T('ai', 'Groq: a model for speech, terms to accept, a request over the limit per minute and a used-up daily limit get a clear message; the test reaches every level', 'Groq: модел за реч, условия за приемане, заявка над лимита на минута и изчерпан дневен лимит дават ясно съобщение; проверката стига до всяко ниво'), async () => {
  const cases = [
    ['whisper-large-v3', /does not write text with the model “whisper-large-v3”/],
    ['canopylabs/orpheus-v1-english', /accept the terms of the model “canopylabs\/orpheus-v1-english”/],
    ['err-toobig', /one request \(9500 tokens\) is larger than the limit of tokens per minute of this key \(8000\).*about 6800/s],
    ['err-tpd', /daily limit for the model “err-tpd” is used up.*in about 3 min/s],
  ];
  for (const [m, re] of cases) {
    await setProvider({ provider: 'openai-compatible', profile: { models: { light: 'fake-small', medium: 'fake-big', strong: m } } });
    const t = await api(srv.port, 'POST', '/api/setup/test');
    assert.equal(t.json.ok, false, m);
    assert.equal(t.json.model, m, 'the test reaches the strong level');
    assert.match(t.json.error, re);
    assert.equal(calls.filter((c) => c.model === m).length, 1, `${m}: no repeated request`);
  }
  // Лимит на минута: Groq пише „Please try again in 1.2s“; изчаква толкова и минава от втория опит
  await setProvider({ provider: 'openai-compatible', profile: { models: { light: 'err-tpm', medium: 'fake-small', strong: '' } } });
  const started = Date.now();
  const t = await api(srv.port, 'POST', '/api/setup/test');
  assert.equal(t.json.ok, true, JSON.stringify(t.json));
  assert.equal(t.json.model, 'err-tpm, fake-small');
  assert.equal(calls.filter((c) => c.model === 'err-tpm').length, 2);
  assert.ok(Date.now() - started < 4500, 'waits about the time Groq asks, not the default 5 s');
  await setProvider({ provider: 'openai-compatible', profile: { models: { light: 'fake-small', medium: 'fake-big', strong: '' } } });
  const { hintSeconds } = await import(pathToFileURL(path.join(box.root, 'scripts', 'llm.js')).href);
  assert.equal(hintSeconds('Please try again in 1m2.5s.'), 62.5);
  assert.equal(hintSeconds('Please try again in 2h5m'), 7500);
  assert.equal(hintSeconds('Please try again in 250ms.'), 0.25);
  assert.equal(hintSeconds('Please retry in 34.5s.'), 34.5);
  assert.equal(hintSeconds('"retryDelay": "41s"'), 41);
});

test(T('ai', 'An answer cut off at the output limit is asked again with more room; a cut JSON keeps its complete part', 'Отговор, отрязан на лимита за изход, се иска пак с повече място; отрязан JSON запазва завършената си част'), async () => {
  await setProvider({ provider: 'openai-compatible', profile: { models: { light: 'err-cut', medium: 'fake-small', strong: '' } } });
  const t = await api(srv.port, 'POST', '/api/setup/test');
  assert.equal(t.json.ok, true, JSON.stringify(t.json));
  const cut = calls.filter((c) => c.model === 'err-cut');
  assert.equal(cut.length, 2);
  assert.ok(cut[1].max > cut[0].max, `more room the second time: ${cut[0].max} → ${cut[1].max}`);
  await setProvider({ provider: 'openai-compatible', profile: { models: { light: 'fake-small', medium: 'fake-big', strong: '' } } });
  const { parseJsonLoose, salvageJson } = await import(pathToFileURL(path.join(box.root, 'scripts', 'llm.js')).href);
  const truncated = '```json\n{"title":"Heat","ideas":[{"text":"Entropy grows.","page":1},{"text":"Engines ne';
  assert.equal(parseJsonLoose(truncated), null, 'not salvaged unless asked');
  assert.deepEqual(parseJsonLoose(truncated, { salvage: true }), { title: 'Heat', ideas: [{ text: 'Entropy grows.', page: 1 }] });
  assert.equal(salvageJson('{"a":1}'), null, 'a complete object is not touched');
});

test(T('ai', 'Groq has text models by default and a context that fits its free limit per minute; the estimate warns when a source needs more tokens than a day gives', 'Groq има модели за текст по подразбиране и контекст, който се побира в безплатния лимит на минута; оценката предупреждава, когато източникът иска повече токени, отколкото дава един ден'), async () => {
  const { json } = await api(srv.port, 'GET', '/api/ai');
  const g = json.presets.find((p) => p.id === 'groq'), notText = new RegExp(json.notText, 'i');
  for (const t of ['light', 'medium', 'strong']) assert.ok(g.defaults.models[t] && !notText.test(g.defaults.models[t]), t);
  assert.ok(g.defaults.context <= 8000, 'one request fits in 8000 tokens per minute');
  assert.ok(notText.test('whisper-large-v3') && notText.test('canopylabs/orpheus-arabic-saudi') && notText.test('openai/gpt-oss-safeguard-20b'));
  // Профилът (с адреса на фалшивия сървър) пробва и двата модела и иска кратко мислене само от gpt-oss
  await setProvider({ provider: 'groq', key: 'gsk-test-key', profile: { baseUrl: `http://127.0.0.1:${modelPort}/v1` } });
  const t = await api(srv.port, 'POST', '/api/setup/test');
  assert.equal(t.json.ok, true, JSON.stringify(t.json));
  assert.equal(t.json.model, `${g.defaults.models.light}, ${g.defaults.models.medium}`);
  assert.ok(calls.filter((c) => /gpt-oss/.test(c.model)).every((c) => c.effort === 'low'));
  assert.ok(calls.filter((c) => /^fake/.test(c.model)).every((c) => c.effort === null), 'other models get no reasoning_effort');
  const LONG = 'raw/articles/long-2020.txt';
  box.write(LONG, 'long');
  box.write('raw/.extracted/articles/long-2020.txt.md', `<!-- извлечено от ${LONG} | думи: 160000 | 2026-11-09T00:00:00.000Z -->\n\n` + 'Entropy grows in closed systems and engines need a temperature difference. '.repeat(13000));
  try {
    const long = await api(srv.port, 'POST', '/api/estimate', { kind: 'ingest', paths: [LONG] });
    assert.ok(long.json.warnings.some((w) => /thousand tokens per day/.test(w)), JSON.stringify(long.json.warnings));
    const short = await api(srv.port, 'POST', '/api/estimate', { kind: 'ingest', paths: [BOOK] });
    assert.ok(!short.json.warnings.some((w) => /thousand tokens per day/.test(w)), JSON.stringify(short.json.warnings));
  } finally {
    fs.rmSync(path.join(box.root, LONG), { force: true });
    fs.rmSync(path.join(box.root, 'raw/.extracted/articles/long-2020.txt.md'), { force: true });
  }
});

test(T('ai', 'The agent cannot read the file with the keys', 'Агентът не може да прочете файла с ключовете'), async () => {
  const { reasonToBlock } = await import(pathToFileURL(path.join(box.root, 'scripts', 'guard-read.js')).href);
  assert.ok(reasonToBlock({ tool_name: 'Read', tool_input: { file_path: path.join(box.root, '.library-secrets.json') } }, box.root));
  assert.ok(reasonToBlock({ tool_name: 'Grep', tool_input: { path: box.root, glob: '.library-secrets*' } }, box.root));
});

// ---------- Писане с wiki: видове текст, креативност, празен документ, абзаци ----------
const useFakeModel = () => setProvider({ provider: 'openai-compatible', key: KEY, profile: { baseUrl: `http://127.0.0.1:${modelPort}/v1`, models: { light: 'fake-small', medium: 'fake-big', strong: '' }, context: 16000, name: 'Test model' } });

test(T('ai', 'Fiction: the creativity becomes the temperature, the story has no citations and its sources are listed under “Based on”', 'Художествен текст: креативността става температура, в разказа няма цитати, а източниците са под „По мотиви от“'), async () => {
  await useFakeModel();
  const quick = await api(srv.port, 'POST', '/api/write', { topic: 'A monk and entropy', level: 'local', genre: 'story' });
  assert.equal(quick.status, 400, 'the quick draft only arranges a scientific article');
  const r = await api(srv.port, 'POST', '/api/write', { topic: 'A monk and entropy', level: 'medium', length: 'short', genre: 'story', creativity: 5, areas: ['Physics'] });
  assert.equal(r.status, 200, r.body);
  const c = calls.filter((x) => /You are writing a literary text/.test(x.prompt)).at(-1);
  assert.equal(c.temp, 1, 'creativity 5 is sent as temperature 1');
  assert.match(c.prompt, /CREATIVITY 5 of 5/);
  assert.match(c.prompt, /Do NOT put citations or page numbers inside the story/);
  assert.match(c.system, /careful writer/, 'writing has its own system prompt');
  const d = (await api(srv.port, 'GET', `/api/drafts/${r.json.id}`)).json;
  assert.equal(d.genre, 'story');
  assert.equal(d.creativity, 5);
  assert.deepEqual(d.scope, { areas: ['Physics'], focus: [] }, 'the scope it was written with is kept');
  assert.ok(d.bibHeads.includes('Based on') && d.bibHeads.includes('Библиография'), 'the editor learns the bibliography headings of every language');
  const [story, list] = d.body.split(/^## Based on\s*$/m);
  assert.ok(list, 'there is a “Based on” section');
  assert.doesNotMatch(story, /\[\[|Sample, 2020|p\. 1\)/, 'no citations are left in the story');
  assert.match(story, /disorder grows\./);
  assert.match(list, /Sample, A\. \(2020\)\. \*Sample note\*\./);
  assert.equal((d.body.match(/^## /gm) || []).length, 1, 'the list written by the model is replaced, not repeated');
  assert.ok(r.json.warnings.some((w) => /no-such-page/.test(w)), JSON.stringify(r.json.warnings));
});

test(T('ai', 'A blank document: own text, a paragraph rewritten and a paragraph added, with one bibliography in any language', 'Празен документ: собствен текст, пренаписан и добавен абзац, с една библиография на всеки език'), async () => {
  await useFakeModel();
  const b = await api(srv.port, 'POST', '/api/drafts', { title: 'my own text', genre: 'essay' });
  assert.equal(b.json.ok, true, b.body);
  const id = b.json.id;
  assert.match((await api(srv.port, 'GET', `/api/drafts/${id}`)).json.body, /^# My own text\s*$/);
  const body = '# My own text\n\nFirst paragraph by me.\n\nSecond paragraph by me.\n\n## Библиография\n\nOld, B. (1999). *Old book*.\n';
  const put = await api(srv.port, 'PUT', `/api/drafts/${id}`, { body, meta: { creativity: 4, scope: { areas: ['Physics'], focus: [] }, genre: 'nonsense' } });
  assert.equal(put.json.ok, true, put.body);
  const saved = (await api(srv.port, 'GET', `/api/drafts/${id}`)).json;
  assert.equal(saved.genre, 'essay', 'an unknown kind of text is ignored');
  assert.equal(saved.creativity, 4);
  assert.equal(saved.mode, 'blank');

  // пренаписване на втория абзац: креативността идва от текста, ако не е дадена
  const target = 'Second paragraph by me.', start = body.indexOf(target), end = start + target.length;
  const rw = await api(srv.port, 'POST', `/api/drafts/${id}/block`, { body, action: 'rewrite', start, end, target, level: 'medium' });
  assert.equal(rw.status, 200, rw.body);
  assert.equal(calls.filter((x) => /TASK: rewrite the marked passage/.test(x.prompt)).at(-1).temp, 0.9);
  assert.match(calls.filter((x) => /TASK: rewrite the marked passage/.test(x.prompt)).at(-1).prompt, /⟦START OF THE PASSAGE TO REWRITE⟧\nSecond paragraph by me\.\n⟦END OF THE PASSAGE⟧/);
  const md1 = rw.json.markdown;
  assert.equal(md1.slice(rw.json.start, rw.json.end), 'A rewritten paragraph: entropy measures disorder (Sample, 2020, p. 2).');
  assert.match(md1, /First paragraph by me\.\n\nA rewritten paragraph/);
  assert.doesNotMatch(md1, /Second paragraph by me/);
  assert.equal((md1.match(/^## /gm) || []).length, 1, 'still one bibliography');
  assert.match(md1, /## Библиография\n\nOld, B\. \(1999\)\. \*Old book\*\.\n\nSample, A\. \(2020\)/, 'the old entry stays, the new one is added');

  // нов абзац след първия
  const first = 'First paragraph by me.', fs1 = md1.indexOf(first);
  const ins = await api(srv.port, 'POST', `/api/drafts/${id}/block`, { body: md1, action: 'insert', start: fs1, end: fs1 + first.length, level: 'medium', words: 80, instruction: 'about work' });
  assert.equal(ins.status, 200, ins.body);
  const md2 = ins.json.markdown;
  assert.match(md2, /First paragraph by me\.\n\nA new paragraph about order and work \(Sample, 2020, p\. 3\)\.\n\nA rewritten paragraph/);
  assert.equal(md2.slice(ins.json.start, ins.json.end), 'A new paragraph about order and work (Sample, 2020, p. 3).');
  assert.equal((md2.match(/^Sample, A\./gm) || []).length, 1, 'a source is listed once');

  // отказ: текстът се е разминал, или мястото е в библиографията
  const stale = await api(srv.port, 'POST', `/api/drafts/${id}/block`, { body: md2, action: 'rewrite', start, end, target, level: 'medium' });
  assert.equal(stale.json.kind, 'locate', stale.body);
  const bi = md2.indexOf('Old, B.');
  const inBib = await api(srv.port, 'POST', `/api/drafts/${id}/block`, { body: md2, action: 'insert', start: bi, end: bi + 10, level: 'medium' });
  assert.equal(inBib.json.kind, 'locate', inBib.body);
  assert.equal(box.read(`drafts/${id}.md`).includes('A new paragraph'), false, 'nothing is saved until the person presses “Save”');
});

test(T('ai', 'Two blank documents with the same title keep their own kind of text and creativity', 'Два празни документа със същото заглавие пазят свой вид текст и креативност'), async () => {
  const a = (await api(srv.port, 'POST', '/api/drafts', { title: '', genre: 'essay' })).json;
  const b = (await api(srv.port, 'POST', '/api/drafts', { title: '', genre: 'essay' })).json;
  assert.notEqual(a.id, b.id);
  assert.equal(box.read(`drafts/${a.id}.md`), box.read(`drafts/${b.id}.md`), 'the two files start with the same text');
  await api(srv.port, 'PUT', `/api/drafts/${a.id}`, { body: '# Untitled text\n\nMine.\n', meta: { genre: 'story', creativity: 5 } });
  const second = (await api(srv.port, 'GET', `/api/drafts/${b.id}`)).json;
  assert.equal(second.genre, 'essay', 'the change of the first one does not leak into the second');
  assert.equal(second.creativity, 3);
  assert.equal(second.title, 'Untitled text');
});

test(T('ai', 'Continuing a scientific article puts the new text before the conclusion and keeps one bibliography, also with Bulgarian headings', 'Дописването на научна статия слага новия текст преди заключението и пази една библиография, и при български заглавия'), async () => {
  await useFakeModel();
  const b = await api(srv.port, 'POST', '/api/drafts', { title: 'Entropy', genre: 'article' });
  const body = '# Entropy\n\n## Увод\n\nIntro text.\n\n## Заключение\n\nThe end.\n\n## Библиография\n\nOld, B. (1999). *Old book*.\n';
  const r = await api(srv.port, 'POST', `/api/drafts/${b.json.id}/continue`, { body, level: 'medium', words: 200, creativity: 1 });
  assert.equal(r.status, 200, r.body);
  assert.equal(calls.filter((x) => /added to the end of the text/.test(x.prompt)).at(-1).temp, 0.2, 'creativity 1 is temperature 0.2');
  const md = r.json.markdown;
  assert.ok(md.indexOf('## Engines') > md.indexOf('Intro text.') && md.indexOf('## Engines') < md.indexOf('## Заключение'), md);
  assert.equal((md.match(/^## Библиография/gm) || []).length, 1, md);
  assert.match(md, /Old, B\. \(1999\)[\s\S]*Sample, A\. \(2020\)/);
  const est = await api(srv.port, 'POST', '/api/estimate', { kind: 'write', topic: 'Entropy', level: 'medium', words: 80 });
  const big = await api(srv.port, 'POST', '/api/estimate', { kind: 'write', topic: 'Entropy', level: 'medium', length: 'long' });
  assert.ok(est.json.output < big.json.output, 'a paragraph is estimated by its own length');
});
