// Short questions to the model (a question to a page, an outline, a suggested change, a path, writing, areas).
// With Claude Code the model reads the files itself (agentPrompt). Without tools the server puts the material into the text
// of the request itself (textPrompt), as much as the context of the model allows: textPrompt(budget) receives the number of tokens that
// can fit. The levels light, medium and strong match the three models of the provider.
import { askClaude, PATH_LEVELS } from './agent.js';
import { aiConfig, readiness } from './providers.js';
import { complete, errorText } from './llm.js';
import { P } from './vocab.js';

export const usesTools = () => aiConfig().engine === 'agent';

const SYSTEM = () => [
  P('You are a careful assistant of a personal knowledge library. You answer only from the material you are given in the request.'),
  P('Write in English, clearly and simply, without an em dash (—).'),
].join(' ');

/** How many tokens of material go into the request at this level (a lighter level sends less) */
export function textBudget(level = 'medium', out = 2500, cfg = aiConfig()) {
  const frac = { light: 0.5, medium: 0.75, strong: 0.9 }[level] || 0.75;
  return Math.max(1500, Math.floor(cfg.context * 0.85 * frac) - out - 900);
}

/**
 * One question to the chosen model. Returns { ok, text, cost } or { ok:false, kind, error, detail } (like askClaude).
 * agentPrompt: for Claude Code (it reads the files itself). textPrompt: a string or a function(budget) with all the material inside.
 * temperature and system apply only without tools: Claude Code has no such settings (the creativity of writing
 * reaches it as an instruction in the prompt itself).
 */
export async function askAI({ level = 'medium', agentPrompt, textPrompt, json = false, maxTokens = 2500, maxTurns, timeoutMs, signal, label, temperature, system }) {
  const cfg = aiConfig();
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  if (cfg.engine === 'agent') {
    return askClaude({ prompt: agentPrompt, model: L.model, effort: L.effort, maxTurns: maxTurns ?? L.maxTurns, timeoutMs: timeoutMs ?? L.timeoutMs, signal });
  }
  if (!readiness(cfg).ok) return { ok: false, kind: 'not-ready', error: errorText({ kind: 'not-ready' }, cfg) };
  const prompt = typeof textPrompt === 'function' ? textPrompt(textBudget(level, maxTokens, cfg)) : String(textPrompt ?? agentPrompt ?? '');
  const r = await complete({ tier: PATH_LEVELS[level] ? level : 'medium', system: system || SYSTEM(), prompt, json, maxTokens, temperature, signal, label, timeoutMs: Math.max(timeoutMs || 0, 600000), cfg });
  return r.ok ? { ok: true, text: r.text, cost: r.costUsd } : { ok: false, kind: r.kind, error: errorText(r, cfg), detail: String(r.detail || r.error || '').slice(0, 1500) };
}
