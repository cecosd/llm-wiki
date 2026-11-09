// Преводи на интерфейса. /locale.js (от сървъра) задава window.__I18N = { lang, locales, messages };
// ключът е английският текст, а липсващ превод показва самия ключ.
(() => {
  const D = window.__I18N || { lang: 'en', locales: [], messages: {} };
  const fmt = (s, args) => (args ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] ?? m)) : s);
  window.I18N = {
    lang: D.lang,
    locales: D.locales,
    pageUnits: D.pageUnits || '',
    contentLang: D.contentLang || '',
    // Езикът се пази в бисквитка (за интерфейса и съобщенията на сървъра); сървърът сменя и езика на съдържанието
    // (CLAUDE.md, шаблони, промптове), за да са на един език. После страницата се зарежда наново.
    async setLang(code) {
      let r = { ok: true };
      try { r = await (await fetch('/api/lang', { method: 'POST', headers: { 'content-type': 'application/json', 'x-library': '1' }, body: JSON.stringify({ code }) })).json(); } catch { /* офлайн: само интерфейсът */ }
      if (!r.ok) return r; // сървърът отказа (обработката работи): нито интерфейсът, нито съдържанието се сменят
      document.cookie = `lang=${encodeURIComponent(code)}; path=/; max-age=31536000; samesite=lax`;
      location.reload();
      return r;
    },
  };
  // Моделът: името замества {ai} („Попитай {ai}“ → „Попитай Gemini“), а надписите от „Настройки → Модел“
  // заменят цели текстове по английския ключ.
  const AI = D.ai || { name: 'Claude', labels: {} };
  window.AI = AI;
  window.$t = (key, args) => {
    const s = fmt((AI.labels && AI.labels[key]) || (D.messages[key] ?? key), args);
    return s.indexOf('{ai}') >= 0 ? s.replace(/\{ai\}/g, AI.name || 'AI') : s;
  };
  document.documentElement.lang = D.lang;
  document.title = window.$t('Library');
})();
