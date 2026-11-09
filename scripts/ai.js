// Кратки въпроси към модела (въпрос към страница, конспект, предложение за промяна, пътека, писане, области).
// С Claude Code моделът чете файловете сам (agentPrompt). Без инструменти сървърът слага материала в самия текст
// на заявката (textPrompt), колкото позволява контекстът на модела: textPrompt(budget) получава броя токени, които
// могат да влязат. Нивата light, medium и strong съвпадат с трите модела на доставчика.
import { askClaude, PATH_LEVELS } from './agent.js';
import { aiConfig, readiness } from './providers.js';
import { complete, errorText } from './llm.js';
import { P } from './vocab.js';

export const usesTools = () => aiConfig().engine === 'agent';

const SYSTEM = () => [
  P('You are a careful assistant of a personal knowledge library. You answer only from the material you are given in the request.'),
  P('Write in English, clearly and simply, without an em dash (—).'),
].join(' ');

/** Колко токена материал влизат в заявката на това ниво (по-лекото ниво праща по-малко) */
export function textBudget(level = 'medium', out = 2500, cfg = aiConfig()) {
  const frac = { light: 0.5, medium: 0.75, strong: 0.9 }[level] || 0.75;
  return Math.max(1500, Math.floor(cfg.context * 0.85 * frac) - out - 900);
}

/**
 * Един въпрос към избрания модел. Връща { ok, text, cost } или { ok:false, kind, error, detail } (като askClaude).
 * agentPrompt: за Claude Code (чете файловете сам). textPrompt: низ или функция(budget) с целия материал вътре.
 */
export async function askAI({ level = 'medium', agentPrompt, textPrompt, json = false, maxTokens = 2500, maxTurns, timeoutMs, signal, label }) {
  const cfg = aiConfig();
  const L = PATH_LEVELS[level] || PATH_LEVELS.medium;
  if (cfg.engine === 'agent') {
    return askClaude({ prompt: agentPrompt, model: L.model, effort: L.effort, maxTurns: maxTurns ?? L.maxTurns, timeoutMs: timeoutMs ?? L.timeoutMs, signal });
  }
  if (!readiness(cfg).ok) return { ok: false, kind: 'not-ready', error: errorText({ kind: 'not-ready' }, cfg) };
  const prompt = typeof textPrompt === 'function' ? textPrompt(textBudget(level, maxTokens, cfg)) : String(textPrompt ?? agentPrompt ?? '');
  const r = await complete({ tier: PATH_LEVELS[level] ? level : 'medium', system: SYSTEM(), prompt, json, maxTokens, signal, label, timeoutMs: Math.max(timeoutMs || 0, 600000), cfg });
  return r.ok ? { ok: true, text: r.text, cost: r.costUsd } : { ok: false, kind: r.kind, error: errorText(r, cfg), detail: String(r.detail || r.error || '').slice(0, 1500) };
}
