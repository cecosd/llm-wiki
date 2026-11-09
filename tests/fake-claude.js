#!/usr/bin/env node
// Фалшив claude за тестовете: не излиза в интернет и не харчи токени. Записва с какво е бил извикан.
import fs from 'node:fs';

const args = process.argv.slice(2);
const log = (entry) => { if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(entry) + '\n'); };

if (args[0] === '--version') { console.log('0.0.0 (fake claude)'); process.exit(0); }
if (args[0] === 'auth') {
  console.log(process.env.FAKE_CLAUDE_AUTH || JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' }));
  process.exit(0);
}

const format = args[args.indexOf('--output-format') + 1];
let stdin = '';
if (format === 'json') { try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* няма вход */ } }
// Само дали има ключ/адрес и кои модели, без самите ключове: така тестът вижда, накъде е насочен Claude Code
const env = {
  baseUrl: process.env.ANTHROPIC_BASE_URL || null, hasToken: !!process.env.ANTHROPIC_AUTH_TOKEN, hasApiKey: !!process.env.ANTHROPIC_API_KEY,
  haiku: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || null, sonnet: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || null, opus: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || null,
};
log({ args, stdin, env });

const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
if (mode === 'auth') { console.error('Invalid API key. Please run /login'); process.exit(1); }
if (mode === 'limit') { console.log(JSON.stringify({ type: 'result', is_error: true, result: 'usage limit reached' })); process.exit(1); }

const result = { type: 'result', subtype: 'success', is_error: false, result: 'Fake answer from the test double.', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } };
if (format === 'stream-json') console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session' }));
console.log(JSON.stringify(result));
