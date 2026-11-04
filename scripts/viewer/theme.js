// Тема преди първото рисуване, за да няма проблясване. Отделен файл, защото Content-Security-Policy забранява вграден код.
(() => {
  let t = 'system';
  try { t = localStorage.getItem('theme') || 'system'; } catch {}
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
