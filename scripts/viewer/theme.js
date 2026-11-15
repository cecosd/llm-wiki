// The theme before the first paint, so that there is no flash. A separate file, because the Content-Security-Policy forbids embedded code.
(() => {
  let t = 'system';
  try { t = localStorage.getItem('theme') || 'system'; } catch {}
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
