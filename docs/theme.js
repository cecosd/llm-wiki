// The theme before the first paint. A separate file, because the Content-Security-Policy forbids embedded code.
(function () {
  var t = null;
  try { t = localStorage.getItem('llmwiki-theme'); } catch (e) {}
  if (!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();
