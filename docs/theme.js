// Тема преди първото изрисуване. Отделен файл, защото Content-Security-Policy забранява вградения код.
(function () {
  var t = null;
  try { t = localStorage.getItem('llmwiki-theme'); } catch (e) {}
  if (!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();
