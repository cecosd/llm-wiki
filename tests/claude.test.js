// Работа с Claude чрез фалшив claude: проверява се какво приложението праща и как реагира, не качеството на отговора.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { T, makeSandbox, startServer, api, seedLibrary, waitFor } from './helpers.js';

let box, srv;
before(async () => {
  box = makeSandbox();
  seedLibrary(box);
  box.write('raw/articles/waiting.txt', 'A new text that waits for processing.\n');
  assert.equal(box.script('extract.js').status, 0);
  srv = await startServer(box);
});
after(async () => { await srv?.stop(); box?.remove(); });

test(T('claude', 'Nothing is sent to Claude when the application starts or a page is read', 'Нищо не се праща към Claude при стартиране и при четене на страница'), async () => {
  await api(srv.port, 'GET', '/api/pages');
  await api(srv.port, 'GET', '/api/page/entropy');
  await api(srv.port, 'GET', '/api/search?q=entropy');
  await api(srv.port, 'GET', '/api/path?q=entropy');
  assert.equal(box.claudeCalls().length, 0);
});

test(T('claude', 'Upload and sorting do not start paid processing while confirmation is on', 'Качването и подреждането не пускат платена обработка, докато потвърждението е включено'), async () => {
  const r = await api(srv.port, 'POST', '/api/inbox');
  assert.equal(r.status, 200);
  assert.equal(r.json.queued, 0);
  assert.equal(box.claudeCalls().length, 0);
});

test(T('claude', 'The cost estimate works without calling Claude', 'Оценката на цената работи, без да вика Claude'), async () => {
  const r = await api(srv.port, 'POST', '/api/estimate', { kind: 'ingest', paths: ['raw/articles/waiting.txt'] });
  assert.equal(r.status, 200);
  assert.notEqual(r.json.ok, false, JSON.stringify(r.json));
  assert.equal(box.claudeCalls().length, 0);
});

test(T('claude', 'The setup page sees the installed Claude Code and the sign-in', 'Страницата за инсталация вижда инсталирания Claude Code и входа в акаунта'), async () => {
  const { json } = await api(srv.port, 'GET', '/api/setup');
  assert.equal(json.steps.find((s) => s.id === 'claude').ok, true);
  assert.equal(json.steps.find((s) => s.id === 'login').ok, true);
  assert.equal(box.claudeCalls().length, 0);
});

test(T('claude', 'Processing runs with restricted permissions and a limited tool list', 'Обработката върви с ограничени права и краен списък инструменти'), async () => {
  const r = await api(srv.port, 'POST', '/api/agent/ingest', { paths: ['raw/articles/waiting.txt'] });
  assert.ok(r.json.queued >= 1, JSON.stringify(r.json));
  const call = await waitFor(() => box.claudeCalls().find((c) => c.args.includes('stream-json')));
  assert.equal(call.args[call.args.indexOf('--permission-mode') + 1], 'dontAsk');
  const tools = call.args[call.args.indexOf('--allowedTools') + 1];
  assert.match(tools, /Edit\(wiki\/\*\*\)/);
  assert.ok(!call.args.includes('--dangerously-skip-permissions'));
  assert.match(call.args[1], /\/wiki-ingest raw\/articles\/waiting\.txt/);
});

test(T('claude', 'A finished job is recorded with its status', 'Приключилата задача се записва със статуса си'), async () => {
  const job = await waitFor(async () => {
    const { json } = await api(srv.port, 'GET', '/api/agent');
    return !json.current && !json.queue.length && json.history?.find((h) => String(h.target).includes('waiting'));
  });
  assert.equal(job.status, 'done');
});

test(T('claude', 'A question to Claude gets an answer and sends only read-only permissions', 'Въпрос към Claude получава отговор и праща само права за четене'), async () => {
  const r = await api(srv.port, 'POST', '/api/ask', { slug: 'entropy', question: 'What is entropy?', level: 'light' });
  assert.equal(r.status, 200, r.body);
  assert.match(r.json.answer, /Fake answer/);
  const call = box.claudeCalls().at(-1);
  assert.equal(call.args[call.args.indexOf('--allowedTools') + 1], 'Read(./**),Glob,Grep');
  assert.match(call.stdin, /What is entropy\?/);
});

test(T('claude', 'The “Test the connection” button works', 'Бутонът „Опитай връзката“ работи'), async () => {
  const r = await api(srv.port, 'POST', '/api/setup/test');
  assert.equal(r.json.ok, true);
});

test(T('claude', 'Writing an article locally does not call Claude', 'Писането на статия локално не вика Claude'), async () => {
  const n = box.claudeCalls().length;
  const r = await api(srv.port, 'POST', '/api/write', { topic: 'entropy', mode: 'local', level: 'local' });
  assert.equal(r.status, 200, r.body);
  assert.equal(box.claudeCalls().length, n);
});

test(T('claude', 'A clear message appears when Claude Code is not signed in', 'При липсващ вход в Claude Code се показва ясно съобщение'), async () => {
  const other = await startServer(box, { FAKE_CLAUDE_MODE: 'auth' });
  try {
    const r = await api(other.port, 'POST', '/api/ask', { slug: 'entropy', question: 'What is entropy?', level: 'light' });
    assert.equal(r.json.kind, 'auth', r.body);
  } finally { await other.stop(); }
});

test(T('claude', 'A clear message appears when the subscription limit is reached', 'При изчерпан лимит се показва ясно съобщение'), async () => {
  const other = await startServer(box, { FAKE_CLAUDE_MODE: 'limit' });
  try {
    const r = await api(other.port, 'POST', '/api/ask', { slug: 'entropy', question: 'What is entropy?', level: 'light' });
    assert.equal(r.json.kind, 'limit', r.body);
  } finally { await other.stop(); }
});

test(T('claude', 'The application tells consumer plans from commercial terms', 'Приложението различава потребителски планове от търговски условия'), async () => {
  const consumer = await api(srv.port, 'GET', '/api/settings');
  assert.equal(consumer.json.account.terms, 'consumer');
  const other = await startServer(box, { FAKE_CLAUDE_AUTH: JSON.stringify({ loggedIn: true, authMethod: 'api_key' }) });
  try { assert.equal((await api(other.port, 'GET', '/api/settings')).json.account.terms, 'commercial'); }
  finally { await other.stop(); }
});
