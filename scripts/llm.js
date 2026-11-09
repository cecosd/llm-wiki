// Заявки към модел без инструменти: текст навътре, текст навън. Ползва се, когато доставчикът не е Claude Code
// (виж providers.js): API, съвместим с OpenAI, API на Anthropic, Ollama (родният /api/chat, за да се зададе контекстът)
// и ръчен режим (заявката се копира в чат в браузъра, отговорът се поставя обратно в интерфейса).
//
// Без външни библиотеки: вграденият fetch на Node. Ключът никога не се записва в историята или в грешките.
import { aiConfig, keyFor } from './providers.js';
import { $t } from './i18n.js';

/** Съобщение за човека по вида на грешката (kind) от complete() или от конвейера. */
export function errorText(r, cfg = aiConfig()) {
  const name = cfg.name;
  switch (r?.kind) {
    case 'auth': return $t('{0} rejected the key. Check it in Settings → Model.', [name]);
    case 'limit': return cfg.subscription ? $t('The subscription limit has been reached. Try later or with a lighter model.') : $t('{0} reports a limit on requests. Try later or with a lighter model.', [name]);
    case 'quota': return $t('{0} reports that the credit or the free quota is used up.', [name]);
    case 'prepay': return $t('{0}: the prepaid credit of the project of this key is used up. A project linked to a billing account is on the paid tier even with no credit, so the free tier does not apply to it. Add credit in AI Studio (Billing), or for the free tier use a key from a project without billing.', [name]);
    case 'daily': return $t('{0}: the daily limit of requests for the model “{1}” is used up. It resets at midnight Pacific time. Try again then, set a lighter model for reading chapters, or use a paid key.', [name, r.model || cfg.models.medium || '?']);
    case 'no-free': return $t('{0}: the model “{1}” has no free tier for this project (limit 0). Choose a model with a free tier (for Gemini: Flash or Flash-Lite) or use a paid key.', [name, r.model || cfg.models.medium || '?']);
    case 'model': return $t('{0} does not know the model “{1}”. Choose another one in Settings → Model.', [name, r.model || cfg.models.medium || '?']);
    case 'context': return $t('The text is too long for the context of the model. Set “Context” in Settings → Model to the real size of the model, or choose a lighter level.');
    case 'offline': return $t('{0} does not answer at {1}. Start it and try again.', [name, cfg.baseUrl || '?']);
    case 'timeout': return $t('{ai} did not respond in {0} min. Try a lighter model or a shorter question.', [r.minutes || 10]);
    case 'cancelled': return $t('Stopped.');
    case 'format': return $t('{ai} returned an answer in an unexpected form. Try again or with a more powerful level.');
    case 'missing': return $t('The original file is missing from raw/.');
    case 'no-text': return $t('There is no extracted text for this file. Run “Sort and extract text” or check the format.');
    case 'no-vision': return $t('This is an image, and the chosen model does not read images. Turn on “Reads images” in Settings → Model for a model that can, or add the text of the image.');
    case 'no-pages': return $t('The text has no page markers, so it cannot be split into chapters.');
    case 'not-ready': return $t('The model is not set up yet. Choose it in Settings → Model.');
    default: return $t('{ai} returned no answer.') + (r?.error && r.error !== 'error' ? ` (${String(r.error).slice(0, 200)})` : '');
  }
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/** Приблизителен брой токени по брой знаци (кирилицата около 2,2 знака на токен, латиницата около 3,8). */
export function approxTokens(text) {
  const s = String(text || ''); let cyr = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0x400 && c <= 0x4ff) cyr++; }
  return Math.ceil(cyr / 2.2 + (s.length - cyr) / 3.8);
}
/** Отрязва текст до приблизително n токена (по знаци, със запас). */
export function clipTokens(text, n) {
  const s = String(text || '');
  if (approxTokens(s) <= n) return s;
  let lo = 0, hi = s.length;
  while (hi - lo > 200) { const mid = (lo + hi) >> 1; if (approxTokens(s.slice(0, mid)) <= n) lo = mid; else hi = mid; }
  return s.slice(0, lo);
}

/** JSON от отговор на модел: без ```, първият цял обект или масив, с поправка на запетая накрая. */
export function parseJsonLoose(text) {
  let t = String(text || '').trim().replace(/^﻿/, '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start < 0) return null;
  const open = t[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) { end = i; break; }
  }
  const body = end > 0 ? t.slice(start, end + 1) : t.slice(start);
  for (const cand of [body, body.replace(/,\s*([}\]])/g, '$1'), body.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1')]) {
    try { return JSON.parse(cand); } catch { /* следващ опит */ }
  }
  return null;
}

// ---------- Ръчен режим: заявки, които чакат човека ----------
const manual = { items: new Map(), listeners: new Set(), seq: 0 };
const notify = () => { for (const fn of manual.listeners) { try { fn(manualList()); } catch {} } };
export const onManual = (fn) => manual.listeners.add(fn);
export function manualList() {
  return [...manual.items.values()].map(({ id, label, text, json, at, step }) => ({ id, label, text, json, at, step }));
}
export function manualAnswer(id, answer) {
  const it = manual.items.get(String(id));
  if (!it) return { ok: false };
  const text = String(answer ?? '').trim();
  if (!text) return { ok: false, empty: true };
  manual.items.delete(it.id); notify();
  it.resolve({ ok: true, text, usage: { in: approxTokens(it.text), out: approxTokens(text) }, costUsd: 0 });
  return { ok: true };
}
export function manualCancel(id) {
  const it = manual.items.get(String(id));
  if (!it) return { ok: false };
  manual.items.delete(it.id); notify();
  it.resolve({ ok: false, kind: 'cancelled', error: 'cancelled' });
  return { ok: true };
}
function manualRequest({ label, system, prompt, json, signal, step }) {
  return new Promise((resolve) => {
    const id = String(++manual.seq);
    const text = [system, prompt].filter(Boolean).join('\n\n');
    const it = { id, label: String(label || ''), text, json: !!json, at: new Date().toISOString(), step: step || null, resolve };
    manual.items.set(id, it); notify();
    if (signal) {
      if (signal.aborted) return manualCancel(id);
      signal.addEventListener('abort', () => manualCancel(id), { once: true });
    }
  });
}

/** Милисекунди до следващата полунощ в Лос Анджелис: тогава Google нулира дневните лимити (Google, n.d., Rate limits) */
export function msToPacificMidnight(at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(at).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const passed = ((p.hour % 24) * 3600 + p.minute * 60 + p.second) * 1000;
  return Math.max(60000, 86400000 - passed);
}

// ---------- Пауза между заявките (безплатните ключове имат лимит на минута) ----------
const lastAt = new Map();
async function pace(cfg, signal) {
  if (!cfg.rpm) return;
  const gap = Math.ceil(60000 / cfg.rpm), prev = lastAt.get(cfg.provider) || 0;
  const wait = prev + gap - Date.now();
  if (wait > 0) await sleep(wait, signal);
  lastAt.set(cfg.provider, Date.now());
}

// Видът на грешката по кода и текста. msg е целият отговор (при Google в него са и подробностите за квотата).
// Google: изчерпана предплата е 402 (по-рано 429) с „prepayment credits are depleted“; дневен лимит е 429 с
// quotaId „...PerDay...“; модел без безплатно ниво е 429 с „limit: 0“. Тези три не минават с повторен опит.
const errKind = (status, msg) => {
  if (/prepayment credits|prepay/i.test(msg)) return 'prepay';
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|invalid[_ ]api[_ ]key|incorrect api key/i.test(msg)) return 'auth';
  if (status === 429 && (/limit:\s*0\b|"quotaValue":\s*"0"/.test(msg))) return 'no-free';
  if (status === 429 && /PerDay|per day|daily/i.test(msg)) return 'daily';
  if (status === 429) return 'limit';
  if (status === 404 || /model.*(not found|does not exist|unknown)|no such model/i.test(msg)) return 'model';
  if (status === 400 && /context|too long|maximum.*tokens|token limit|too many tokens/i.test(msg)) return 'context';
  if (status === 402 || /insufficient|credit|balance|quota/i.test(msg)) return 'quota';
  return 'error';
};

/** Една заявка по протокола на доставчика. Връща { ok, text, usage } или { ok:false, status, message }. */
async function request(cfg, { model, system, prompt, images, json, maxTokens, temperature, signal }) {
  const key = keyFor(cfg.provider);
  const base = cfg.baseUrl;
  let url, headers = { 'content-type': 'application/json' }, body, pick;
  if (cfg.protocol === 'anthropic') {
    url = `${base}/v1/messages`;
    headers = { ...headers, 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    const content = images?.length ? [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })), { type: 'text', text: prompt }] : prompt;
    body = { model, max_tokens: maxTokens || 4096, ...(system ? { system } : {}), messages: [{ role: 'user', content }] };
    pick = (j) => ({ text: (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), usage: { in: j.usage?.input_tokens ?? null, out: j.usage?.output_tokens ?? null } });
  } else if (cfg.provider === 'ollama') {
    // Родният API на Ollama: само тук може да се зададе размерът на контекста (num_ctx); иначе дългият текст се реже тихо.
    url = `${base.replace(/\/v1$/, '')}/api/chat`;
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt, ...(images?.length ? { images: images.map((im) => im.data) } : {}) }];
    body = { model, messages, stream: false, ...(json ? { format: 'json' } : {}), options: { num_ctx: cfg.context, temperature: temperature ?? 0.2, ...(maxTokens ? { num_predict: maxTokens } : {}) } };
    pick = (j) => ({ text: j.message?.content || '', usage: { in: j.prompt_eval_count ?? null, out: j.eval_count ?? null } });
  } else {
    url = `${base}/chat/completions`;
    if (key) headers.authorization = `Bearer ${key}`;
    if (cfg.provider === 'openrouter') { headers['x-title'] = 'LLM Wiki'; }
    const user = images?.length ? [{ type: 'text', text: prompt }, ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } }))] : prompt;
    const official = /api\.openai\.com/.test(base);
    body = { model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }], stream: false };
    if (maxTokens) body[official ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
    if (!official) body.temperature = temperature ?? 0.2;
    pick = (j) => ({ text: j.choices?.[0]?.message?.content ?? '', usage: { in: j.usage?.prompt_tokens ?? null, out: j.usage?.completion_tokens ?? null } });
  }
  const send = async (b) => {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(b), signal });
    const raw = await r.text();
    let j = null; try { j = JSON.parse(raw); } catch {}
    if (!r.ok) {
      // Google връща грешката и като масив: [{ "error": {...} }]
      const e = Array.isArray(j) ? j[0] : j;
      const message = String(e?.error?.message || (typeof e?.error === 'string' ? e.error : '') || e?.message || raw || r.statusText).slice(0, 600);
      // Колко да се чака: заглавката Retry-After, или „retry in 34.5s“ / "retryDelay": "34s" в отговора на Google
      const hinted = Number((raw.match(/retry in ([\d.]+)\s*s/i) || raw.match(/"retryDelay":\s*"([\d.]+)s"/) || [])[1]) || 0;
      return { ok: false, status: r.status, message, raw: raw.slice(0, 4000), retryAfter: Number(r.headers.get('retry-after')) || Math.ceil(hinted) };
    }
    const out = pick(j || {});
    return { ok: true, text: String(out.text || ''), usage: out.usage };
  };
  let res = await send(body);
  // Някои сървъри не приемат max_tokens или temperature: един повторен опит без тях
  if (!res.ok && res.status === 400 && body.max_tokens && /max_tokens/i.test(res.message)) {
    body.max_completion_tokens = body.max_tokens; delete body.max_tokens; res = await send(body);
  }
  if (!res.ok && res.status === 400 && 'temperature' in body && /temperature/i.test(res.message)) { delete body.temperature; res = await send(body); }
  return res;
}

/**
 * Текстов отговор от избрания модел. tier: light | medium | strong. За ръчния режим чака, докато човекът постави отговора.
 * Връща { ok, text, usage: {in,out}, costUsd, model } или { ok:false, kind, error, detail }.
 * kind: auth | limit | quota | model | context | offline | timeout | cancelled | error.
 */
export async function complete({ tier = 'medium', system = '', prompt, images = null, json = false, maxTokens = 0, temperature, signal, timeoutMs = 600000, label = '', step = null, cfg = aiConfig() }) {
  if (cfg.engine === 'manual') {
    const r = await manualRequest({ label, system, prompt, json, signal, step });
    return r.ok ? { ...r, model: 'manual' } : { ok: false, kind: 'cancelled', error: 'cancelled' };
  }
  const model = cfg.models[tier] || cfg.models.medium;
  if (!model) return { ok: false, kind: 'model', error: 'no-model' };
  if (!cfg.baseUrl) return { ok: false, kind: 'error', error: 'no-url' };
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let maxOut = cfg.maxOutput ? Math.min(maxTokens || cfg.maxOutput, cfg.maxOutput) : maxTokens;
  let widened = false;
  try {
    for (let attempt = 0; ; attempt++) {
      await pace(cfg, ac.signal);
      if (ac.signal.aborted) break;
      let res;
      try { res = await request(cfg, { model, system, prompt, images, json, maxTokens: maxOut, temperature, signal: ac.signal }); }
      catch (e) {
        if (ac.signal.aborted) break;
        const offline = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(String(e?.cause?.code || e?.message || ''));
        if (offline && cfg.local) return { ok: false, kind: 'offline', error: 'offline', detail: String(e?.cause?.code || e?.message) };
        if (attempt < 2) { await sleep(3000 * (attempt + 1), ac.signal); continue; }
        return { ok: false, kind: offline ? 'offline' : 'error', error: String(e?.message || e), detail: String(e?.cause?.code || '') };
      }
      // Празен отговор: моделите, които „мислят“ преди отговора, понякога изхарчват лимита за изход. Един опит с по-голям.
      if (res.ok && !res.text.trim() && !widened && maxOut) { widened = true; maxOut = Math.min(32000, maxOut * 4); continue; }
      if (res.ok) {
        const pr = cfg.prices[tier] || cfg.prices.medium;
        const costUsd = cfg.local ? 0 : pr && res.usage.in != null ? ((res.usage.in || 0) * pr.in + (res.usage.out || 0) * pr.out) / 1e6 : null;
        return { ok: true, text: res.text, usage: res.usage, costUsd, model };
      }
      const kind = errKind(res.status, res.raw || res.message);
      // Лимит на минута и сривове при доставчика минават с изчакване; изчерпан кредит или дневен лимит не
      const retryable = (res.status === 429 && kind === 'limit') || res.status >= 500;
      if (retryable && attempt < 3) {
        await sleep(Math.min(65000, (res.retryAfter ? res.retryAfter * 1000 + 500 : 0) || [5000, 15000, 40000][attempt]), ac.signal);
        continue;
      }
      return { ok: false, kind, error: res.message, status: res.status, model };
    }
    return signal?.aborted ? { ok: false, kind: 'cancelled', error: 'cancelled' } : { ok: false, kind: 'timeout', error: 'timeout', minutes: Math.round(timeoutMs / 60000) };
  } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); }
}

/** Списъкът с модели на доставчика (за „Зареди моделите“). Връща { ok, models: [id] }. */
export async function listModels(cfg = aiConfig()) {
  const key = keyFor(cfg.provider);
  const p = cfg.preset;
  let url;
  if (cfg.protocol === 'anthropic') url = `${cfg.baseUrl}/v1/models`;
  else if (cfg.provider === 'ollama') url = `${cfg.baseUrl.replace(/\/v1$/, '')}/api/tags`;
  else if (cfg.protocol === 'claude-code') url = p.listUrl || (cfg.baseUrl ? `${cfg.baseUrl}/v1/models` : null);
  else url = `${cfg.baseUrl}/models`;
  if (!url) return { ok: false, error: 'no-url' };
  const headers = {};
  if (key) { headers.authorization = `Bearer ${key}`; headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    const raw = await r.text().catch(() => '');
    let j = null; try { j = JSON.parse(raw); } catch {}
    const e = Array.isArray(j) ? j[0] : j;
    if (!r.ok) return { ok: false, kind: errKind(r.status, raw), error: String(e?.error?.message || (typeof e?.error === 'string' ? e.error : '') || r.statusText).slice(0, 300) };
    // Google дава имената като „models/gemini-...“; в заявките се ползват без представката
    const list = (j?.data || j?.models || []).map((m) => String(m.id || m.name || m.model || '').replace(/^models\//, '')).filter(Boolean);
    return { ok: true, models: [...new Set(list)].sort((a, b) => a.localeCompare(b)).slice(0, 400) };
  } catch (e) {
    return { ok: false, kind: cfg.local ? 'offline' : 'error', error: String(e?.cause?.code || e?.message || e) };
  }
}
