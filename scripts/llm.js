// Requests to a model without tools: text in, text out. Used when the provider is not Claude Code
// (see providers.js): an OpenAI-compatible API, the Anthropic API, Ollama (the native /api/chat, so that the context can be set)
// and manual mode (the request is copied into a chat in the browser, the answer is pasted back into the interface).
//
// No external libraries: the built-in fetch of Node. The key is never written into the history or into the errors.
import { aiConfig, keyFor, NOT_TEXT } from './providers.js';
import { $t } from './i18n.js';

/** A message for the person by the kind of the error (kind) from complete() or from the pipeline. */
export function errorText(r, cfg = aiConfig()) {
  const name = cfg.name;
  switch (r?.kind) {
    case 'auth': return $t('{0} rejected the key. Check it in Settings → Model.', [name]);
    case 'limit': return cfg.subscription ? $t('The subscription limit has been reached. Try later or with a lighter model.') : $t('{0} reports a limit on requests. Try later or with a lighter model.', [name]);
    case 'quota': return $t('{0} reports that the credit or the free quota is used up.', [name]);
    case 'prepay': return $t('{0}: the prepaid credit of the project of this key is used up. A project linked to a billing account is on the paid tier even with no credit, so the free tier does not apply to it. Add credit in AI Studio (Billing), or for the free tier use a key from a project without billing.', [name]);
    case 'daily': return r.retryAfter
      ? $t('{0}: the daily limit for the model “{1}” is used up. {0} frees it again in about {2}. Shorter texts, a lighter model for reading chapters or a paid key help.', [name, r.model || cfg.models.medium || '?', waitText(r.retryAfter)])
      : $t('{0}: the daily limit of requests for the model “{1}” is used up. It resets at midnight Pacific time. Try again then, set a lighter model for reading chapters, or use a paid key.', [name, r.model || cfg.models.medium || '?']);
    case 'not-chat': return $t('{0} does not write text with the model “{1}”: it is a model for speech, sound, images or safety checks. Choose a text model in Settings → Model.', [name, r.model || cfg.models.medium || '?']);
    case 'terms': return $t('{0} asks you to accept the terms of the model “{1}” in its console first (the link is in the details). Usually such a model is not for text: choose a text model in Settings → Model.', [name, r.model || cfg.models.medium || '?']);
    case 'too-big': {
      const m = String(r.error || r.message || '').match(/Limit (\d+), Requested (\d+)/i);
      return m
        ? $t('{0}: one request ({1} tokens) is larger than the limit of tokens per minute of this key ({2}). Set “Context” in Settings → Model to about {3}, or use a paid plan.', [name, m[2], m[1], Math.floor(Number(m[1]) * 0.85)])
        : $t('{0}: one request is larger than this key allows. Lower “Context” in Settings → Model, or use a paid plan.', [name]);
    }
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

/** "2 h 5 min" or "12 min" for the time until the next attempt */
function waitText(sec) {
  const min = Math.max(1, Math.ceil(sec / 60));
  return min >= 60 ? $t('{0} h {1} min', [Math.floor(min / 60), min % 60]) : $t('{0} min', [min]);
}

/**
 * How many seconds to wait by the text of the error, when there is no retry-after header. Google writes "Please retry in 34.5s"
 * or "retryDelay": "34s"; Groq gives retry-after on 429 (Groq, n.d.-c), and the text says "try again in 1m2.5s".
 */
export function hintSeconds(raw) {
  const s = String(raw || '');
  const m = s.match(/(?:retry|try again) in\s+((?:[\d.]+(?:h|ms|m|s)\s*)+)/i);
  if (m) {
    let n = 0;
    for (const [, v, u] of m[1].matchAll(/([\d.]+)(h|ms|m|s)/gi)) n += Number(v) * ({ h: 3600, m: 60, s: 1, ms: 0.001 }[u.toLowerCase()]);
    return n;
  }
  return Number((s.match(/"retryDelay":\s*"([\d.]+)s"/) || [])[1]) || 0;
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/** An approximate number of tokens by the number of characters (Cyrillic about 2.2 characters per token, Latin about 3.8). */
export function approxTokens(text) {
  const s = String(text || ''); let cyr = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0x400 && c <= 0x4ff) cyr++; }
  return Math.ceil(cyr / 2.2 + (s.length - cyr) / 3.8);
}
/** Cuts a text to about n tokens (by characters, with a margin). */
export function clipTokens(text, n) {
  const s = String(text || '');
  if (approxTokens(s) <= n) return s;
  let lo = 0, hi = s.length;
  while (hi - lo > 200) { const mid = (lo + hi) >> 1; if (approxTokens(s.slice(0, mid)) <= n) lo = mid; else hi = mid; }
  return s.slice(0, lo);
}

/** JSON from a model answer: without ```, the first whole object or array, with a fix of a trailing comma. */
export function parseJsonLoose(text, { salvage = false } = {}) {
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
    try { return JSON.parse(cand); } catch { /* the next attempt */ }
  }
  return salvage && end < 0 ? salvageJson(body) : null;
}

/**
 * Cut JSON (the model reached the output limit): keeps the finished items up to the last comma or closing
 * bracket and closes the open objects and lists. Used only as a last resort, when the repair does not work either.
 */
export function salvageJson(s) {
  const stack = []; let inStr = false, esc = false, cut = -1, cutStack = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { stack.pop(); if (!stack.length) return null; cut = i + 1; cutStack = stack.slice(); }
    else if (c === ',') { cut = i; cutStack = stack.slice(); }
  }
  if (cut < 0 || !cutStack?.length) return null;
  try { return JSON.parse(s.slice(0, cut) + cutStack.reverse().join('')); } catch { return null; }
}

// ---------- Manual mode: requests that wait for the person ----------
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

/** Milliseconds until the next midnight in Los Angeles: then Google resets the daily limits (Google, n.d., Rate limits) */
export function msToPacificMidnight(at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(at).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const passed = ((p.hour % 24) * 3600 + p.minute * 60 + p.second) * 1000;
  return Math.max(60000, 86400000 - passed);
}

// ---------- A pause between requests (free keys have a limit per minute) ----------
const lastAt = new Map();
async function pace(cfg, signal) {
  if (!cfg.rpm) return;
  const gap = Math.ceil(60000 / cfg.rpm), prev = lastAt.get(cfg.provider) || 0;
  const wait = prev + gap - Date.now();
  if (wait > 0) await sleep(wait, signal);
  lastAt.set(cfg.provider, Date.now());
}

// The kind of the error by the code and the text. msg is the whole answer (with Google it also holds the details of the quota).
// Google: used-up prepayment is 402 (earlier 429) with "prepayment credits are depleted"; a daily limit is 429 with
// quotaId "...PerDay..."; a model without a free tier is 429 with "limit: 0". These three are not retried.
// Groq: a speech model returns "does not support chat completions", and a model with terms "requires terms acceptance" (this is how
// Groq answered in a test installation on 9.11.2026). A request larger than allowed is 413 (Groq, n.d.-a); in
// its text Groq writes the limit per minute and the requested size ("Limit N, Requested M"), if they are there.
const errKind = (status, msg) => {
  if (/prepayment credits|prepay/i.test(msg)) return 'prepay';
  if (/does not support chat|not a chat model|only supports? (?:audio|speech|transcription|embeddings?)/i.test(msg)) return 'not-chat';
  if (/terms acceptance|accept the terms|model_terms_required/i.test(msg)) return 'terms';
  if (status === 413 || /request too large|reduce your message size/i.test(msg)) return 'too-big';
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|invalid[_ ]api[_ ]key|incorrect api key/i.test(msg)) return 'auth';
  if (status === 429 && (/limit:\s*0\b|"quotaValue":\s*"0"/.test(msg))) return 'no-free';
  if (status === 429 && /PerDay|per day|daily/i.test(msg)) return 'daily';
  if (status === 429) return 'limit';
  if (status === 404 || /model.*(not found|does not exist|unknown)|no such model/i.test(msg)) return 'model';
  if (status === 400 && /context|too long|maximum.*tokens|token limit|too many tokens/i.test(msg)) return 'context';
  if (status === 402 || /insufficient|credit|balance|quota/i.test(msg)) return 'quota';
  return 'error';
};

/** One request by the protocol of the provider. Returns { ok, text, usage } or { ok:false, status, message }. */
async function request(cfg, { model, system, prompt, images, json, maxTokens, temperature, signal }) {
  const key = keyFor(cfg.provider);
  const base = cfg.baseUrl;
  let url, headers = { 'content-type': 'application/json' }, body, pick;
  if (cfg.protocol === 'anthropic') {
    url = `${base}/v1/messages`;
    headers = { ...headers, 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    const content = images?.length ? [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })), { type: 'text', text: prompt }] : prompt;
    // temperature only when the task asks for it (creativity in writing); otherwise the default of the model stays
    body = { model, max_tokens: maxTokens || 4096, ...(system ? { system } : {}), ...(temperature != null ? { temperature } : {}), messages: [{ role: 'user', content }] };
    pick = (j) => ({ text: (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), usage: { in: j.usage?.input_tokens ?? null, out: j.usage?.output_tokens ?? null } });
  } else if (cfg.provider === 'ollama') {
    // The native Ollama API: only here can the size of the context (num_ctx) be set; otherwise a long text is silently cut.
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
    // gpt-oss thinks before answering and spends from the output limit and from the daily tokens; for notes and pages "low" is enough
    if (cfg.preset.reasoningEffort && /gpt-oss/i.test(model)) body.reasoning_effort = cfg.preset.reasoningEffort;
    pick = (j) => ({ text: j.choices?.[0]?.message?.content ?? '', usage: { in: j.usage?.prompt_tokens ?? null, out: j.usage?.completion_tokens ?? null } });
  }
  const send = async (b) => {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(b), signal });
    const raw = await r.text();
    let j = null; try { j = JSON.parse(raw); } catch {}
    if (!r.ok) {
      // Google returns the error also as an array: [{ "error": {...} }]
      const e = Array.isArray(j) ? j[0] : j;
      const message = String(e?.error?.message || (typeof e?.error === 'string' ? e.error : '') || e?.message || raw || r.statusText).slice(0, 600);
      // How long to wait: the Retry-After header or the hint in the text (Google and Groq write it differently)
      return { ok: false, status: r.status, message, raw: raw.slice(0, 4000), retryAfter: Number(r.headers.get('retry-after')) || Math.ceil(hintSeconds(raw)) };
    }
    const out = pick(j || {});
    // Cut at the output limit: finish_reason "length" (OpenAI), stop_reason "max_tokens" (Anthropic), done_reason "length" (Ollama)
    const cut = j?.choices?.[0]?.finish_reason === 'length' || j?.stop_reason === 'max_tokens' || j?.done_reason === 'length';
    return { ok: true, text: String(out.text || ''), usage: out.usage, ...(cut ? { cut: true } : {}) };
  };
  let res = await send(body);
  // Some servers do not accept max_tokens or temperature: one more attempt without them
  if (!res.ok && res.status === 400 && body.max_tokens && /max_tokens/i.test(res.message)) {
    body.max_completion_tokens = body.max_tokens; delete body.max_tokens; res = await send(body);
  }
  if (!res.ok && res.status === 400 && 'temperature' in body && /temperature/i.test(res.message)) { delete body.temperature; res = await send(body); }
  if (!res.ok && res.status === 400 && 'reasoning_effort' in body && /reasoning/i.test(res.message)) { delete body.reasoning_effort; res = await send(body); }
  return res;
}

/**
 * A text answer from the chosen model. tier: light | medium | strong. For manual mode it waits until the person pastes the answer.
 * Returns { ok, text, usage: {in,out}, costUsd, model } or { ok:false, kind, error, detail }.
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
  const spent = { in: 0, out: 0 };
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
      // An empty or cut answer: the models that "think" before answering (gpt-oss, Gemini) spend from the output limit,
      // and notes in Bulgarian do not fit. One attempt with a larger limit, which must still fit in the context
      // together with the text (otherwise Groq refuses the whole request). The tokens of the first attempt are counted too.
      if (res.ok && (res.cut || !res.text.trim()) && !widened && maxOut) {
        widened = true;
        const more = Math.min(32000, maxOut * 4, cfg.context - approxTokens(system) - approxTokens(prompt) - 200);
        if (more > maxOut) { maxOut = more; spent.in += res.usage.in || 0; spent.out += res.usage.out || 0; continue; }
      }
      if (res.ok) {
        const usage = res.usage.in == null ? res.usage : { in: res.usage.in + spent.in, out: (res.usage.out || 0) + spent.out };
        const pr = cfg.prices[tier] || cfg.prices.medium;
        const costUsd = cfg.local ? 0 : pr && usage.in != null ? ((usage.in || 0) * pr.in + (usage.out || 0) * pr.out) / 1e6 : null;
        return { ok: true, text: res.text, usage, costUsd, model, ...(res.cut ? { cut: true } : {}) };
      }
      const kind = errKind(res.status, res.raw || res.message);
      // A limit per minute and provider failures pass with waiting; used-up credit or a daily limit do not
      const retryable = (res.status === 429 && kind === 'limit') || res.status >= 500;
      if (retryable && attempt < 3) {
        await sleep(Math.min(65000, (res.retryAfter ? res.retryAfter * 1000 + 500 : 0) || [5000, 15000, 40000][attempt]), ac.signal);
        continue;
      }
      // Daily limit: Groq says when it is freed; Google resets at midnight Pacific time (quotaId "...PerDay...")
      const dailyWait = kind === 'daily' && res.retryAfter && !/PerDay/.test(res.raw || '') ? res.retryAfter : 0;
      return { ok: false, kind, error: res.message, status: res.status, model, ...(dailyWait ? { retryAfter: dailyWait } : {}) };
    }
    return signal?.aborted ? { ok: false, kind: 'cancelled', error: 'cancelled' } : { ok: false, kind: 'timeout', error: 'timeout', minutes: Math.round(timeoutMs / 60000) };
  } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); }
}

/** The list of models of the provider (for "Load the models"). Returns { ok, models: [id], hidden }. */
export async function listModels(cfg = aiConfig()) {
  const key = keyFor(cfg.provider);
  const p = cfg.preset;
  let url;
  if (cfg.protocol === 'anthropic') url = `${cfg.baseUrl}/v1/models?limit=1000`; // the default page is only 20 models
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
    // Google gives the names as "models/gemini-..."; in requests they are used without the prefix.
    // Disabled models (Groq: "active": false) are not shown.
    const all = [...new Set((j?.data || j?.models || []).filter((m) => m?.active !== false)
      .map((m) => String(m.id || m.name || m.model || '').replace(/^models\//, '')).filter(Boolean))];
    // The lists mix models for text with ones for speech, sound, images and safety checks (Groq, n.d.-d);
    // the latter do not write pages, so they are not offered. The name can still be typed by hand.
    const models = all.filter((id) => !NOT_TEXT.test(id)).sort((a, b) => a.localeCompare(b)).slice(0, 400);
    return { ok: true, models, hidden: all.length - models.length };
  } catch (e) {
    return { ok: false, kind: cfg.local ? 'offline' : 'error', error: String(e?.cause?.code || e?.message || e) };
  }
}

// ---------- Is the chosen model still offered? ----------
const sameModel = (a, b) => {
  const n = (x) => String(x).toLowerCase().replace(/^models\//, '').replace(/:latest$/, '');
  return n(a) === n(b);
};

/**
 * A free check of the chosen models against the list the provider publishes (one GET, no tokens).
 * Providers retire models from time to time; when that happens requests start to fail with "unknown model".
 * Returns { ok, missing: [{ tier, model }], available: [first few models] } when something is gone, { ok: true } otherwise.
 * It stays silent (ok: true, unknown: true) whenever the answer cannot be trusted: no network, no key, a provider with
 * no list, or the Claude subscription (Haiku, Sonnet and Opus are names of families that always point to the current model).
 */
export async function modelHealth(cfg = aiConfig()) {
  if (cfg.engine === 'manual') return { ok: true, skipped: true };
  if (cfg.preset.protocol === 'claude-code' && !cfg.baseUrl && !cfg.preset.listUrl) return { ok: true, skipped: true, auto: true };
  const r = await listModels(cfg);
  // A list cut at 400 entries (listModels) cannot prove that a model is gone
  if (!r.ok || !r.models?.length || r.models.length >= 400) return { ok: true, unknown: true, kind: r.kind || null };
  const missing = [];
  for (const tier of ['light', 'medium', 'strong']) {
    const model = cfg.models[tier];
    if (model && !r.models.some((m) => sameModel(m, model)) && !missing.some((x) => sameModel(x.model, model))) missing.push({ tier, model });
  }
  return missing.length ? { ok: false, missing, available: r.models.slice(0, 12) } : { ok: true };
}
