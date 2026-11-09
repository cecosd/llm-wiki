// Доставчици на модели: кой модел обработва библиотеката и как се стига до него.
//
// Три начина на работа (engine):
//  - agent:  Claude Code като агент с инструменти (чете и пише файлове сам, със скиловете и куката guard-read.js).
//            Освен с Claude, Claude Code може да говори с друг доставчик, който приема формата на Anthropic
//            (ANTHROPIC_BASE_URL + ANTHROPIC_DEFAULT_*_MODEL): DeepSeek, Ollama и други съвместими услуги.
//  - api:    без инструменти. Сървърът сам подава текста на части и сам пише страниците (pipeline.js); моделът
//            получава само текст. Работи с всеки API, съвместим с OpenAI, и с API на Anthropic.
//  - manual: същото като api, но заявката се копира в чат в браузъра (безплатен акаунт) и отговорът се поставя обратно.
//
// Настройките са в library.config.json (ключ "ai"); ключовете за API са в отделен файл .library-secrets.json
// (извън git, само за собственика, забранен за четене от агента). Модулът ползва само lib.js, за да няма кръгови импорти.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.js';

// Само отбелязва текстовете за превод (npm run i18n:check ги намира по функцията $t); превеждат се в server.js.
const $t = (s) => s;

export const CONFIG_FILE = path.join(ROOT, 'library.config.json');
export const SECRETS_FILE = path.join(ROOT, '.library-secrets.json');
export const TIERS = ['light', 'medium', 'strong'];

// Цени на Anthropic (USD за милион токена), както в estimate.js. Останалите доставчици: въвеждат се в Настройки.
const CLAUDE_TIERS = { light: 'haiku', medium: 'sonnet', strong: 'opus' };

/**
 * Готовите профили. models: модел по подразбиране за всяко ниво ('' = човекът го избира, напр. с „Зареди моделите“).
 * context: размер на контекста в токени (по подразбиране; сменя се в Настройки). rpm: заявки в минута (0 = без пауза).
 */
export const PRESETS = [
  // ---- Claude Code (агент с инструменти) ----
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

  // ---- API без инструменти (сървърът подава текста) ----
  { id: 'anthropic', group: 'api', engine: 'api', protocol: 'anthropic', name: 'Claude', vendor: 'Anthropic', needsKey: true, envKey: 'ANTHROPIC_API_KEY',
    label: $t('Claude API without Claude Code'), hint: $t('Direct requests to the Anthropic API. The server gives the model the text in parts and writes the pages itself.'),
    baseUrl: 'https://api.anthropic.com', models: { light: 'claude-haiku-5-5', medium: 'claude-sonnet-5-5', strong: 'claude-opus-5-5' }, context: 200000,
    keyUrl: 'https://console.anthropic.com/settings/keys', docs: 'https://docs.claude.com/en/api/messages' },
  { id: 'openai', group: 'api', engine: 'api', protocol: 'openai', name: 'ChatGPT', vendor: 'OpenAI', needsKey: true, envKey: 'OPENAI_API_KEY',
    label: $t('OpenAI API'), hint: $t('Paid per token. The server gives the model the text in parts and writes the pages itself.'),
    baseUrl: 'https://api.openai.com/v1', models: { light: '', medium: '', strong: '' }, context: 128000,
    keyUrl: 'https://platform.openai.com/api-keys', docs: 'https://platform.openai.com/docs/api-reference/chat' },
  { id: 'gemini', group: 'free', engine: 'api', protocol: 'openai', name: 'Gemini', vendor: 'Google', needsKey: true, envKey: 'GEMINI_API_KEY', free: true,
    label: $t('Google Gemini (free key from AI Studio)'), hint: $t('A key from Google AI Studio works without a card, within daily limits. On the free tier Google may use the content to improve its products: do not send private material.'),
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: { light: '', medium: '', strong: '' }, context: 1000000, rpm: 10,
    keyUrl: 'https://aistudio.google.com/apikey', docs: 'https://ai.google.dev/gemini-api/docs/openai' },
  { id: 'groq', group: 'free', engine: 'api', protocol: 'openai', name: 'Groq', vendor: 'Groq', needsKey: true, envKey: 'GROQ_API_KEY', free: true,
    label: $t('Groq (free tier)'), hint: $t('Fast open models with a free tier and limits per minute and per day.'),
    baseUrl: 'https://api.groq.com/openai/v1', models: { light: '', medium: '', strong: '' }, context: 128000, rpm: 20,
    keyUrl: 'https://console.groq.com/keys', docs: 'https://console.groq.com/docs/openai' },
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

  // ---- Ръчно: копиране в чат в браузъра ----
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

// ---------- Четене и запис ----------
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

/** Настройките на избрания доставчик, слети с профила. Никога не съдържа ключа. */
export function aiConfig(raw = readConfig().ai) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const p = presetOf(a.provider);
  const own = (a.profiles && a.profiles[p.id]) || {};
  const models = {};
  for (const t of TIERS) models[t] = str(own.models?.[t], 200) || p.models[t] || '';
  // празно ниво: взима най-близкото попълнено (лекото пада към средното, мощното към средното)
  const fill = models.medium || models.strong || models.light;
  for (const t of TIERS) if (!models[t]) models[t] = (t === 'light' ? models.medium : t === 'strong' ? models.medium : '') || fill || '';
  const prices = {};
  for (const t of TIERS) {
    const x = own.prices?.[t];
    prices[t] = x && (x.in !== '' && x.in != null) ? { in: num(x.in), out: num(x.out) } : null;
  }
  return {
    provider: p.id, preset: p, engine: p.engine, protocol: p.protocol,
    baseUrl: (str(own.baseUrl, 500) || p.baseUrl || '').replace(/\/+$/, ''),
    models, prices,
    context: num(own.context) || p.context || 8192,
    maxOutput: num(own.maxOutput) || 0,
    rpm: own.rpm === '' || own.rpm == null ? (p.rpm || 0) : num(own.rpm),
    vision: !!own.vision,
    // Името и надписите са на всеки доставчик поотделно (при смяна на модела се сменят и те)
    name: str(own.name, 40) || p.name || 'AI',
    labels: cleanLabels(own.labels),
    free: !!p.free, local: !!p.local || /^https?:\/\/(localhost|127\.|\[::1\])/i.test(str(own.baseUrl, 500) || p.baseUrl || ''),
    subscription: !!p.subscription,
  };
}

/** Записва настройките на доставчика в library.config.json, без да пипа другите ключове. */
export function saveAiConfig(input = {}) {
  let disk = {};
  try { disk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch {}
  const cur = disk.ai && typeof disk.ai === 'object' ? disk.ai : {};
  const next = { ...cur, profiles: { ...(cur.profiles || {}) } };
  // activate: false записва профила, без да го прави текущ (напр. за „Зареди моделите“)
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

// ---------- Ключове ----------
function readSecrets() { try { return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')) || {}; } catch { return {}; } }
/** Ключът на доставчика: от променлива на средата (LIB_AI_KEY или типичната за доставчика), иначе от .library-secrets.json */
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
/** Записва ключ (или го маха с ''). Файлът е само за собственика (0600). */
export function setKey(id, key) {
  const p = presetOf(id);
  const s = readSecrets();
  s.keys = { ...(s.keys || {}) };
  const k = String(key || '').trim();
  if (k && (k.length > 500 || /\s/.test(k))) return { ok: false, error: 'bad-key' };
  if (k) s.keys[p.id] = k; else delete s.keys[p.id];
  // Пише се в самия файл (без временен до него): в изолацията само той е записваем, папката на проекта не е
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(SECRETS_FILE, 0o600); } catch {}
  return { ok: true };
}
const mask = (k) => (k ? '••••' + k.slice(-4) : '');

/** Готов ли е избраният доставчик (без заявка навън): има ли модел, адрес и ключ, когато трябват. */
export function readiness(cfg = aiConfig()) {
  const p = cfg.preset;
  if (p.id === 'claude-code' || cfg.engine === 'manual') return { ok: true };
  if (!cfg.baseUrl && p.protocol !== 'claude-code') return { ok: false, missing: 'url' };
  if (p.protocol === 'claude-code' && p.id !== 'claude-api' && !cfg.baseUrl) return { ok: false, missing: 'url' };
  if (p.needsKey && !keyFor(p.id)) return { ok: false, missing: 'key' };
  if (!cfg.models.medium) return { ok: false, missing: 'model' };
  return { ok: true };
}

/** Какво вижда интерфейсът: без ключове, само дали ги има. */
export function aiPublic(cfg = aiConfig()) {
  const p = cfg.preset;
  return {
    provider: p.id, name: cfg.name, vendor: p.vendor || cfg.name, engine: cfg.engine, protocol: cfg.protocol,
    tools: cfg.engine === 'agent', free: cfg.free, local: cfg.local, subscription: cfg.subscription,
    claude: p.vendor === 'Anthropic', delegate: cfg.engine === 'agent',
    tiers: Object.fromEntries(TIERS.map((t) => [t, cfg.models[t] || ''])),
    tierNames: p.protocol === 'claude-code' && p.vendor === 'Anthropic' ? { light: 'Haiku', medium: 'Sonnet', strong: 'Opus' } : Object.fromEntries(TIERS.map((t) => [t, cfg.models[t] || ''])),
    context: cfg.context, vision: cfg.vision, labels: cfg.labels, ready: readiness(cfg),
    prices: cfg.prices, priced: cfg.local || cfg.engine === 'manual' || p.vendor === 'Anthropic' || TIERS.some((t) => cfg.prices[t]),
  };
}
/** Пълните данни за страницата „Настройки“: профилите, текущите стойности и дали има ключ (маскиран). */
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
        free: !!p.free, local: !!p.local, keyUrl: p.keyUrl || null, docs: p.docs || null,
        defaults: { baseUrl: p.baseUrl || '', models: p.models, context: p.context, rpm: p.rpm || 0 },
        values: {
          baseUrl: (raw.profiles?.[p.id]?.baseUrl) || '', models: raw.profiles?.[p.id]?.models || { light: '', medium: '', strong: '' }, prices: c.prices,
          context: raw.profiles?.[p.id]?.context || '', rpm: raw.profiles?.[p.id]?.rpm ?? '', vision: c.vision, maxOutput: raw.profiles?.[p.id]?.maxOutput || '',
          name: raw.profiles?.[p.id]?.name || '', labels: c.labels,
        },
      };
    }),
    groups: PRESET_GROUPS,
  };
}

/** Името в текстовете на интерфейса („Попитай {ai}“). */
export const aiName = () => aiConfig().name;

/**
 * Средата за пускане на Claude Code. claude-code: средата остава както е (абонамент или настройките на самия Claude Code).
 * claude-api: ключът от настройките. Другите: адресът на доставчика и моделите за трите нива на Claude Code.
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
  env.ANTHROPIC_SMALL_FAST_MODEL = cfg.models.light; // по-стари версии на Claude Code
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'; // без телеметрия и проверки към Anthropic, когато моделът е другаде
  return env;
}
