// Преводи на интерфейса. /locale.js (от сървъра) задава window.__I18N = { lang, locales, messages };
// ключът е английският текст, а липсващ превод показва самия ключ.
(() => {
  const D = window.__I18N || { lang: 'en', locales: [], messages: {} };
  const fmt = (s, args) => (args ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] ?? m)) : s);
  window.I18N = {
    lang: D.lang,
    locales: D.locales,
    pageUnits: D.pageUnits || '',
    // Езикът се пази в бисквитка (за интерфейса и съобщенията на сървъра); сървърът сменя и езика на съдържанието
    // (CLAUDE.md, шаблони, промптове), за да са на един език. После страницата се зарежда наново.
    async setLang(code) {
      document.cookie = `lang=${encodeURIComponent(code)}; path=/; max-age=31536000; samesite=lax`;
      try { await fetch('/api/lang', { method: 'POST', headers: { 'content-type': 'application/json', 'x-library': '1' }, body: JSON.stringify({ code }) }); } catch { /* офлайн: само интерфейсът */ }
      location.reload();
    },
  };
  window.$t = (key, args) => fmt(D.messages[key] ?? key, args);
  document.documentElement.lang = D.lang;
  document.title = window.$t('Library');
})();
