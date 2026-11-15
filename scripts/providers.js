// Model providers: which model processes the library and how it is reached.
//
// Three ways of working (engine):
//  - agent:  Claude Code as an agent with tools (it reads and writes files itself, with the skills and the guard-read.js hook).
//            Besides Claude, Claude Code can talk to another provider that accepts the Anthropic format
//            (ANTHROPIC_BASE_URL + ANTHROPIC_DEFAULT_*_MODEL): DeepSeek, Ollama and other compatible services.
//  - api:    without tools. The server itself passes the text in parts and writes the pages itself (pipeline.js); the model
//            receives only text. Works with any OpenAI-compatible API and with the Anthropic API.
//  - manual: the same as api, but the request is copied into a chat in the browser (a free account) and the answer is pasted back.
//
// The settings are in library.config.json (key "ai"); the API keys are in a separate file .library-secrets.json
// (outside git, only for the owner, forbidden for the agent to read). The module uses only lib.js, to avoid circular imports.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.js';

// It only marks the texts for translation (npm run i18n:check finds them by the $t function); they are translated in server.js.
const $t = (s) => s;

export const CONFIG_FILE = path.join(ROOT, 'library.config.json');
export const SECRETS_FILE = path.join(ROOT, '.library-secrets.json');
export const TIERS = ['light', 'medium', 'strong'];
/** Models that do not write text: speech, sound, images, embeddings, safety checks */
export const NOT_TEXT = /whisper|orpheus|playai|tts|speech|transcri|audio|realtime|embed|rerank|moderation|guard|dall-e|gpt-image|imagen|-image|veo-|lyria|sora|\baqa\b|-ocr|computer-use|gemini-live/i;

// Anthropic prices (USD per million tokens), as in estimate.js. The other providers: entered in Settings.
const CLAUDE_TIERS = { light: 'haiku', medium: 'sonnet', strong: 'opus' };

/**
 * The ready profiles. models: the default model for each level ('' = the person chooses it, for example with "Load the models").
 * context: the size of the context in tokens (the default; changed in Settings). rpm: requests per minute (0 = no pause).
 */
export const PRESETS = [
  // ---- Claude Code (an agent with tools) ----
  { id: 'claude-code', group: 'claude', engine: 'agent', protocol: 'claude-code', name: 'Claude', vendor: 'Anthropic',
    label: $t('Claude subscription (Claude Code)'), hint: $t('Claude Code with the account you signed in with (Pro or Max, or the API key in its own settings). Reads and writes the pages itself, with the library skills.'),
    models: { ...CLAUDE_TIERS }, context: 200000, subscription: true, docs: 'https://docs.claude.com/en/docs/claude-code/setup' },
  { id: 'claude-api', group: 'claude', engine: 'agent', protocol: 'claude-code', name: 'Claude', vendor: 'Anthropic', needsKey: true, envKey: 'ANTHROPIC_API_KEY',
    label: $t('Claude with an API key (Claude Code)'), hint: $t('The same agent, but paid per token from an Anthropic Console key, without a subscription.'),
    models: { ...CLAUDE_TIERS }, context: 200000, keyUrl: 'https://console.anthropic.com/settings/keys', docs: 'https://code.claude.com/docs/en/env-vars' },
  { id: 'agent-deepseek', group: 'agent', engine: 'agent', protocol: 'claude-code', name: 'DeepSeek', vendor: 'DeepSeek', needsKey: true, envKey: 'DEEPSEEK_API_KEY',
    label: $t('DeepSeek through Claude Code'), hint: $t('Claude Code works as usual, but the model is DeepSeek (an endpoint compatible with Anthropic). Needs a model that handles tools well.'),
    baseUrl: 'https://api.deepseek.com/anthropic', listUrl: 'https://api.deepseek.com/models', models: { light: '', medium: '', strong: '' }, context: 128000,
    keyUrl: 'https://platform.deepseek.com/api_keys', docs: 'https://api-docs.deepseek.com/guides/anthropic_api' },
  { id: 'agent-ollama', group: 'agent', engine: 'agent', protocol: 'claude-code', name: 'Ollama', vendor: 'Ollama', local: true,
    label: $t('Local model in Ollama through Claude Code'), hint: $t('Ollama 0.14 or newer accepts the format of Anthropic. The data stays on this computer. Choose a model that handles tools well and has a large context (at least 32,000 tokens).'),
    baseUrl: 'http://localhost:11434', listUrl: 'http://localhost:11434/v1/models', models: { light: '', medium: '', strong: '' }, context: 32768,
    docs: 'https://docs.ollama.com/api/anthropic-compatibility' },
  { id: 'agent-custom', group: 'agent', engine: 'agent', protocol: 'claude-code', name: 'AI', vendor: '', needsKey: true,
    label: $t('Another service compatible with Anthropic (Claude Code)'), hint: $t('Any address that accepts the Messages API of Anthropic (a gateway such as LiteLLM, or a provider with such an endpoint). Claude Code adds /v1/messages itself.'),
    baseUrl: '', models: { light: '', medium: '', strong: '' }, context: 128000 },

  // ---- An API without tools (the server passes the text) ----
  { id: 'anthropic', group: 'api', engine: 'api', protocol: 'anthropic', name: 'Claude', vendor: 'Anthropic', needsKey: true, envKey: 'ANTHROPIC_API_KEY',
    label: $t('Claude API without Claude Code'), hint: $t('Direct requests to the Anthropic API. The server gives the model the text in parts and writes the pages itself.'),
    baseUrl: 'https://api.anthropic.com', models: { light: 'claude-haiku-5-5', medium: 'claude-sonnet-5-5', strong: 'claude-opus-5-5' }, context: 200000,
    keyUrl: 'https://console.anthropic.com/settings/keys', docs: 'https://docs.claude.com/en/api/messages' },
  { id: 'openai', group: 'api', engine: 'api', protocol: 'openai', name: 'ChatGPT', vendor: 'OpenAI', needsKey: true, envKey: 'OPENAI_API_KEY',
    label: $t('OpenAI API'), hint: $t('Paid per token. The server gives the model the text in parts and writes the pages itself.'),
    baseUrl: 'https://api.openai.com/v1', models: { light: '', medium: '', strong: '' }, context: 128000,
    keyUrl: 'https://platform.openai.com/api-keys', docs: 'https://platform.openai.com/docs/api-reference/chat' },
  // Gemini: the free tier is only for a project WITHOUT a billing account. Since 23.03.2026 a project linked to a billing account
  // is on the paid tier even with 0 credit, and then the requests return 402 (Google, n.d., Billing). The limits are per
  // project and per model, so reading the chapters (light) is on Flash-Lite, and writing (medium) on Flash.
  // Pro and Gemini 4 Argon have no free tier (Google, n.d., Pricing).
  { id: 'gemini', group: 'free', engine: 'api', protocol: 'openai', name: 'Gemini', vendor: 'Google', needsKey: true, envKey: 'GEMINI_API_KEY', free: true,
    label: $t('Google Gemini, free tier (project without billing)'), hint: $t('A key from Google AI Studio, from a project that is NOT linked to a billing account. Limits per minute and per day apply to each project and model (see Rate limits in AI Studio); a book takes about as many requests as it has chapters, plus 5 to 10. On the free tier Google uses the content to improve its products: do not send private material.'),
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: { light: 'gemini-3.5-flash-lite', medium: 'gemini-3.8-flash', strong: 'gemini-3.8-flash' }, context: 1000000, rpm: 5,
    keyUrl: 'https://aistudio.google.com/apikey', docs: 'https://aistudio.google.com/docs/rate-limits', limitsUrl: 'https://aistudio.google.com/rate-limit' },
  // The prices are the standard ones after the introductory discounts (Flash until 31.12.2026, Argon until 30.11.2026 are at half price),
  // so that the estimate does not come out lower than the bill. They are changed in Settings -> Model.
  { id: 'gemini-paid', group: 'api', engine: 'api', protocol: 'openai', name: 'Gemini', vendor: 'Google', needsKey: true, envKey: 'GEMINI_API_KEY',
    label: $t('Google Gemini, paid (project with billing)'), hint: $t('A key from an AI Studio project linked to a billing account. New accounts pay in advance (Prepay, at least 5 USD); at 0 credit every key of the account stops. The content is not used to improve Google products. Google AI Pro and Ultra include monthly Cloud credits that count for the Gemini API after you activate them in the Google Developer Program.'),
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: { light: 'gemini-3.5-flash-lite', medium: 'gemini-3.8-flash', strong: 'gemini-4-argon' }, context: 1000000,
    prices: { light: { in: 0.30, out: 2.50 }, medium: { in: 1.50, out: 7.50 }, strong: { in: 4.00, out: 20.00 } },
    keyUrl: 'https://aistudio.google.com/apikey', docs: 'https://aistudio.google.com/docs/billing', billingUrl: 'https://aistudio.google.com/billing' },
  // Groq: the table of limits gives gpt-oss 8000 tokens per minute and 200 000 per day (Groq, n.d.-c). The page does not say
  // clearly for which plan, and the column for the Developer plan in the models is much higher (250 000 per minute; Groq, n.d.-d),
  // so these are the limits of the free plan. One request must fit in the limit per minute, so the context
  // is 7000, not 131 072. Llama 3.x was stopped for the free plan on 16.08.2026 (Groq, n.d.-b); the limits are per model,
  // so gpt-oss-20b reads and gpt-oss-120b writes.
  { id: 'groq', group: 'free', engine: 'api', protocol: 'openai', name: 'Groq', vendor: 'Groq', needsKey: true, envKey: 'GROQ_API_KEY', free: true,
    label: $t('Groq (free tier)'), hint: $t('A free key from the Groq console. On the free plan each model has about 8,000 tokens per minute and 200,000 tokens per day, so every request carries a short part of the text: enough for articles and short texts, not for a whole book in one day. Only text models work; Groq also lists models for speech and safety checks.'),
    baseUrl: 'https://api.groq.com/openai/v1', models: { light: 'openai/gpt-oss-20b', medium: 'openai/gpt-oss-120b', strong: 'openai/gpt-oss-120b' }, context: 7000, rpm: 30, tpd: 200000, reasoningEffort: 'low',
    keyUrl: 'https://console.groq.com/keys', docs: 'https://console.groq.com/docs/rate-limits', limitsUrl: 'https://console.groq.com/settings/limits' },
  { id: 'openrouter', group: 'free', engine: 'api', protocol: 'openai', name: 'OpenRouter', vendor: 'OpenRouter', needsKey: true, envKey: 'OPENROUTER_API_KEY', free: true,
    label: $t('OpenRouter (many models, some free)'), hint: $t('One key for models of many vendors. Models whose name ends in :free cost nothing, with limits.'),
    baseUrl: 'https://openrouter.ai/api/v1', models: { light: '', medium: '', strong: '' }, context: 128000, rpm: 15,
    keyUrl: 'https://openrouter.ai/settings/keys', docs: 'https://openrouter.ai/docs/quickstart' },
  { id: 'deepseek', group: 'api', engine: 'api', protocol: 'openai', name: 'DeepSeek', vendor: 'DeepSeek', needsKey: true, envKey: 'DEEPSEEK_API_KEY',
    label: $t('DeepSeek API'), hint: $t('Inexpensive per token. The server gives the model the text in parts and writes the pages itself.'),
    baseUrl: 'https://api.deepseek.com', models: { light: '', medium: '', strong: '' }, context: 128000,
    keyUrl: 'https://platform.deepseek.com/api_keys', docs: 'https://api-docs.deepseek.com/' },
  { id: 'mistral', group: 'api', engine: 'api', protocol: 'openai', name: 'Mistral', vendor: 'Mistral AI', needsKey: true, envKey: 'MISTRAL_API_KEY',
    label: $t('Mistral API'), hint: $t('European provider. The server gives the model the text in parts and writes the pages itself.'),
    baseUrl: 'https://api.mistral.ai/v1', models: { light: '', medium: '', strong: '' }, context: 128000,
    keyUrl: 'https://console.mistral.ai/api-keys', docs: 'https://docs.mistral.ai/api/' },
  { id: 'ollama', group: 'local', engine: 'api', protocol: 'openai', name: 'Ollama', vendor: 'Ollama', local: true,
    label: $t('Local model in Ollama'), hint: $t('Free and private: nothing leaves this computer. Works with small models too, because the server gives them the text in small parts.'),
    baseUrl: 'http://localhost:11434/v1', models: { light: '', medium: '', strong: '' }, context: 8192, docs: 'https://docs.ollama.com/api/openai-compatibility' },
  { id: 'lmstudio', group: 'local', engine: 'api', protocol: 'openai', name: 'LM Studio', vendor: 'LM Studio', local: true,
    label: $t('Local model in LM Studio'), hint: $t('Free and private. Start the local server in LM Studio (port 1234) and load a model.'),
    baseUrl: 'http://localhost:1234/v1', models: { light: '', medium: '', strong: '' }, context: 8192, docs: 'https://lmstudio.ai/docs/app/api/endpoints/openai' },
  { id: 'openai-compatible', group: 'local', engine: 'api', protocol: 'openai', name: 'AI', vendor: '', local: false,
    label: $t('Another service compatible with OpenAI'), hint: $t('Any address with /chat/completions: llama.cpp, vLLM, Jan, LocalAI or another provider. The key is optional.'),
    baseUrl: '', models: { light: '', medium: '', strong: '' }, context: 8192 },

  // ---- Manual: copying into a chat in the browser ----
  { id: 'manual', group: 'manual', engine: 'manual', protocol: 'manual', name: 'AI', vendor: '', free: true,
    label: $t('Any chat in the browser (copy and paste)'), hint: $t('For a free account without API (ChatGPT, Gemini, Claude.ai, Le Chat). The library shows the request, you paste it in the chat and paste the answer back. Each step is one copy.'),
    models: { light: '', medium: '', strong: '' }, context: 24000 },
];
export const PRESET_GROUPS = [
  { id: 'claude', label: $t('Claude') },
  { id: 'agent', label: $t('Other models through Claude Code (agent with tools)') },
  { id: 'free', label: $t('Free API keys') },
  { id: 'api', label: $t('Paid API without tools') },
  { id: 'local', label: $t('Local models') },
  { id: 'manual', label: $t('Without API') },
];
export const presetOf = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

// ---------- Reading and writing ----------
let cache = { mtime: -1, data: {} };
function readConfig() {
  try {
    const m = fs.statSync(CONFIG_FILE).mtimeMs;
    if (m !== cache.mtime) cache = { mtime: m, data: JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {} };
  } catch { cache = { mtime: -1, data: {} }; }
  return cache.data;
}
const num = (v, d = 0) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
const str = (v, n = 300) => String(v ?? '').trim().slice(0, n);
const cleanLabels = (x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).filter(([k, v]) => typeof v === 'string' && v.trim()).slice(0, 300).map(([k, v]) => [String(k).slice(0, 500), v.trim().slice(0, 300)]))
  : {});

/** The settings of the chosen provider, merged with the profile. It never contains the key. */
export function aiConfig(raw = readConfig().ai) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const p = presetOf(a.provider);
  const own = (a.profiles && a.profiles[p.id]) || {};
  const models = {};
  for (const t of TIERS) models[t] = str(own.models?.[t], 200) || p.models[t] || '';
  // an empty level: takes the nearest filled one (light falls back to medium, strong to medium)
  const fill = models.medium || models.strong || models.light;
  for (const t of TIERS) if (!models[t]) models[t] = (t === 'light' ? models.medium : t === 'strong' ? models.medium : '') || fill || '';
  const prices = {};
  for (const t of TIERS) {
    // The prices of the profile, if the person has not entered their own (an empty field in the settings = unknown price)
    const x = own.prices ? own.prices[t] : p.prices?.[t];
    prices[t] = x && (x.in !== '' && x.in != null) ? { in: num(x.in), out: num(x.out) } : null;
  }
  return {
    provider: p.id, preset: p, engine: p.engine, protocol: p.protocol,
    baseUrl: (str(own.baseUrl, 500) || p.baseUrl || '').replace(/\/+$/, ''),
    models, prices,
    context: num(own.context) || p.context || 8192,
    maxOutput: num(own.maxOutput) || 0,
    rpm: own.rpm === '' || own.rpm == null ? (p.rpm || 0) : num(own.rpm),
    tpd: p.tpd || 0, // tokens per day for one model on the free plan (for the warning in the estimate)
    vision: !!own.vision,
    // The name and the labels are separate for each provider (when the model changes, they change too)
    name: str(own.name, 40) || p.name || 'AI',
    labels: cleanLabels(own.labels),
    free: !!p.free, local: !!p.local || /^https?:\/\/(localhost|127\.|\[::1\])/i.test(str(own.baseUrl, 500) || p.baseUrl || ''),
    subscription: !!p.subscription,
  };
}

/** Writes the settings of the provider into library.config.json without touching the other keys. */
export function saveAiConfig(input = {}) {
  let disk = {};
  try { disk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch {}
  const cur = disk.ai && typeof disk.ai === 'object' ? disk.ai : {};
  const next = { ...cur, profiles: { ...(cur.profiles || {}) } };
  // activate: false writes the profile without making it the current one (for example for "Load the models")
  const known = input.provider && PRESETS.some((p) => p.id === input.provider);
  if (known && input.activate !== false) next.provider = input.provider;
  const id = known ? input.provider : (next.provider || 'claude-code');
  if (input.profile && typeof input.profile === 'object') {
    const pr = input.profile, own = { ...(next.profiles[id] || {}) };
    if ('name' in pr) own.name = str(pr.name, 40);
    if ('labels' in pr) own.labels = cleanLabels(pr.labels);
    if ('baseUrl' in pr) {
      const u = str(pr.baseUrl, 500);
      if (u && !/^https?:\/\/[^\s]+$/i.test(u)) return { ok: false, error: 'bad-url' };
      own.baseUrl = u;
    }
    if (pr.models && typeof pr.models === 'object') own.models = Object.fromEntries(TIERS.map((t) => [t, str(pr.models[t], 200)]));
    if (pr.prices && typeof pr.prices === 'object') own.prices = Object.fromEntries(TIERS.map((t) => [t, pr.prices[t] && pr.prices[t].in !== '' && pr.prices[t].in != null ? { in: num(pr.prices[t].in), out: num(pr.prices[t].out) } : null]));
    for (const k of ['context', 'maxOutput']) if (k in pr) own[k] = num(pr[k]);
    if ('rpm' in pr) own.rpm = pr.rpm === '' ? '' : num(pr.rpm);
    if ('vision' in pr) own.vision = !!pr.vision;
    next.profiles[id] = own;
  }
  disk.ai = next;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(disk, null, 2) + '\n');
  return { ok: true };
}

// ---------- Keys ----------
function readSecrets() { try { return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')) || {}; } catch { return {}; } }
/** The key of the provider: from an environment variable (LIB_AI_KEY or the typical one for the provider), otherwise from .library-secrets.json */
export function keyFor(id) {
  const p = presetOf(id);
  return String(process.env.LIB_AI_KEY || (p.envKey && process.env[p.envKey]) || readSecrets().keys?.[p.id] || '').trim();
}
export const keySource = (id) => {
  const p = presetOf(id);
  if (process.env.LIB_AI_KEY) return 'env';
  if (p.envKey && process.env[p.envKey]) return 'env';
  return readSecrets().keys?.[p.id] ? 'file' : null;
};
/** Writes a key (or removes it with ''). The file is only for the owner (0600). */
export function setKey(id, key) {
  const p = presetOf(id);
  const s = readSecrets();
  s.keys = { ...(s.keys || {}) };
  const k = String(key || '').trim();
  if (k && (k.length > 500 || /\s/.test(k))) return { ok: false, error: 'bad-key' };
  if (k) s.keys[p.id] = k; else delete s.keys[p.id];
  // It is written into the file itself (without a temporary one next to it): in the isolation only it is writable, the project folder is not
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(SECRETS_FILE, 0o600); } catch {}
  return { ok: true };
}
const mask = (k) => (k ? '••••' + k.slice(-4) : '');

/** Is the chosen provider ready (without a request outside): is there a model, an address and a key, where they are needed. */
export function readiness(cfg = aiConfig()) {
  const p = cfg.preset;
  if (p.id === 'claude-code' || cfg.engine === 'manual') return { ok: true };
  if (!cfg.baseUrl && p.protocol !== 'claude-code') return { ok: false, missing: 'url' };
  if (p.protocol === 'claude-code' && p.id !== 'claude-api' && !cfg.baseUrl) return { ok: false, missing: 'url' };
  if (p.needsKey && !keyFor(p.id)) return { ok: false, missing: 'key' };
  if (!cfg.models.medium) return { ok: false, missing: 'model' };
  return { ok: true };
}

/** True once the person has picked a model in Settings -> Model (until then the defaults only fill the gaps) */
export const aiChosen = () => !!readConfig().ai?.provider;

/** What the interface sees: without keys, only whether they exist. */
export function aiPublic(cfg = aiConfig()) {
  const p = cfg.preset;
  return {
    provider: p.id, chosen: aiChosen(), name: cfg.name, vendor: p.vendor || cfg.name, engine: cfg.engine, protocol: cfg.protocol,
    tools: cfg.engine === 'agent', free: cfg.free, local: cfg.local, subscription: cfg.subscription,
    claude: p.vendor === 'Anthropic', delegate: cfg.engine === 'agent',
    tiers: Object.fromEntries(TIERS.map((t) => [t, cfg.models[t] || ''])),
    tierNames: p.protocol === 'claude-code' && p.vendor === 'Anthropic' ? { light: 'Haiku', medium: 'Sonnet', strong: 'Opus' } : Object.fromEntries(TIERS.map((t) => [t, cfg.models[t] || ''])),
    context: cfg.context, vision: cfg.vision, labels: cfg.labels, ready: readiness(cfg),
    prices: cfg.prices, priced: cfg.local || cfg.engine === 'manual' || p.vendor === 'Anthropic' || TIERS.some((t) => cfg.prices[t]),
  };
}
/** The full data for the "Settings" page: the profiles, the current values and whether there is a key (masked). */
export function aiSettings() {
  const raw = readConfig().ai || {};
  return {
    current: aiPublic(),
    presets: PRESETS.map((p) => {
      const c = aiConfig({ ...raw, provider: p.id });
      return {
        id: p.id, group: p.group, engine: p.engine, protocol: p.protocol, name: p.name, vendor: p.vendor, label: p.label, hint: p.hint,
        needsKey: !!p.needsKey, keyOptional: !p.needsKey && p.engine !== 'manual' && p.id !== 'claude-code' && p.id !== 'agent-ollama',
        hasKey: !!keyFor(p.id), keyMasked: mask(keyFor(p.id)), keySource: keySource(p.id), envKey: p.envKey || null,
        free: !!p.free, local: !!p.local, keyUrl: p.keyUrl || null, docs: p.docs || null, limitsUrl: p.limitsUrl || null, billingUrl: p.billingUrl || null,
        defaults: { baseUrl: p.baseUrl || '', models: p.models, context: p.context, rpm: p.rpm || 0, prices: p.prices || null },
        values: {
          baseUrl: (raw.profiles?.[p.id]?.baseUrl) || '', models: raw.profiles?.[p.id]?.models || { light: '', medium: '', strong: '' }, prices: c.prices,
          context: raw.profiles?.[p.id]?.context || '', rpm: raw.profiles?.[p.id]?.rpm ?? '', vision: c.vision, maxOutput: raw.profiles?.[p.id]?.maxOutput || '',
          name: raw.profiles?.[p.id]?.name || '', labels: c.labels,
        },
      };
    }),
    groups: PRESET_GROUPS,
    notText: NOT_TEXT.source, // the page warns if such a model is chosen in a model field
  };
}

/** The name in the texts of the interface ("Ask {ai}"). */
export const aiName = () => aiConfig().name;

/**
 * The environment for running Claude Code. claude-code: the environment stays as it is (a subscription or the settings of Claude Code itself).
 * claude-api: the key from the settings. The others: the address of the provider and the models for the three levels of Claude Code.
 */
export function claudeEnv(cfg = aiConfig(), base = process.env) {
  const env = { ...base };
  const p = cfg.preset;
  if (cfg.engine !== 'agent' || p.id === 'claude-code') return env;
  for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) delete env[k];
  if (p.id === 'claude-api') { env.ANTHROPIC_API_KEY = keyFor(p.id); return env; }
  env.ANTHROPIC_BASE_URL = cfg.baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = keyFor(p.id) || (cfg.local ? 'ollama' : 'none');
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = cfg.models.light;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = cfg.models.medium;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = cfg.models.strong;
  env.ANTHROPIC_SMALL_FAST_MODEL = cfg.models.light; // older versions of Claude Code
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'; // without telemetry and checks to Anthropic when the model is elsewhere
  return env;
}
