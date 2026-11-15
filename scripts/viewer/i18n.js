// Translations of the interface. /locale.js (from the server) sets window.__I18N = { lang, locales, messages };
// the key is the English text, and a missing translation shows the key itself.
(() => {
  const D = window.__I18N || { lang: 'en', locales: [], messages: {} };
  const fmt = (s, args) => (args ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] ?? m)) : s);
  window.I18N = {
    lang: D.lang,
    locales: D.locales,
    pageUnits: D.pageUnits || '',
    contentLang: D.contentLang || '',
    // The language is kept in a cookie (for the interface and the messages of the server); the server also changes the content language
    // (CLAUDE.md, templates, prompts), so that they are in one language. Then the page loads again.
    async setLang(code) {
      let r = { ok: true };
      try { r = await (await fetch('/api/lang', { method: 'POST', headers: { 'content-type': 'application/json', 'x-library': '1' }, body: JSON.stringify({ code }) })).json(); } catch { /* offline: only the interface */ }
      if (!r.ok) return r; // the server refused (processing is running): neither the interface nor the content changes
      document.cookie = `lang=${encodeURIComponent(code)}; path=/; max-age=31536000; samesite=lax`;
      location.reload();
      return r;
    },
  };
  // The model: the name replaces {ai} ("Ask {ai}" -> "Ask Gemini"), and the labels from "Settings -> Model"
  // replace whole texts by the English key.
  const AI = D.ai || { name: 'Claude', labels: {} };
  window.AI = AI;
  window.$t = (key, args) => {
    const s = fmt((AI.labels && AI.labels[key]) || (D.messages[key] ?? key), args);
    return s.indexOf('{ai}') >= 0 ? s.replace(/\{ai\}/g, AI.name || 'AI') : s;
  };
  document.documentElement.lang = D.lang;
  document.title = window.$t('Library');
})();
