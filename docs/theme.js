// Theme before the first paint. A separate file, because the Content-Security-Policy forbids inline code.
(() => { document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches); })();
