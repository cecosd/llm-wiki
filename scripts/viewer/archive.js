// The static archive: the same interface, but the data comes from the embedded lib-static, not from the server.
// Here fetch is replaced for the addresses /api/... Everything that leads to writing or to Claude is hidden in app.js (the ro flag).
// The texts for the reader are in reader/<source>.js next to index.html and are loaded on first opening (file:// does not allow fetch).
// The file is embedded into index.html by scripts/archive.js; in the ordinary library it is not loaded.
(() => {
  const el = document.getElementById('lib-static'); // embedded by scripts/archive.js as JSON
  const data = window.LIB_STATIC = el ? JSON.parse(el.textContent) : { api: {}, meta: {}, readerOf: {} };
  const readerOf = data.readerOf || {};
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

  // Search in the titles, aliases and text: the same as the server, but without folding Cyrillic and Latin
  const plainLinks = (s) => s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a.trim().split('/').pop());
  function search(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits = [];
    for (const p of data.api['/api/pages'] || []) {
      const title = (String(p.title) + ' ' + (p.aliases || []).join(' ')).toLowerCase();
      const content = data.api['/api/page/' + p.slug]?.content || '';
      const body = content.toLowerCase();
      const inTitle = title.includes(q);
      const idx = body.indexOf(q);
      if (!inTitle && idx === -1) continue;
      const count = body.split(q).length - 1;
      const from = Math.max(0, idx - 50);
      const snippet = idx === -1 ? p.excerpt
        : (from ? '…' : '') + plainLinks(content.slice(from, idx + q.length + 90)).replace(/[#*_`]/g, '') + '…';
      hits.push({ ...p, score: (inTitle ? 100 : 0) + count, snippet });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, 40);
  }

  // The text of a book: the file reader/<key>.js sets window.LIB_READER_DATA[key]; it is loaded once
  function loadReader(key) {
    const have = window.LIB_READER_DATA && window.LIB_READER_DATA[key];
    if (have) return Promise.resolve(have);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'reader/' + key + '.js';
      s.onload = () => (window.LIB_READER_DATA && window.LIB_READER_DATA[key] ? resolve(window.LIB_READER_DATA[key]) : reject(new Error('empty')));
      s.onerror = () => reject(new Error('missing'));
      document.head.appendChild(s);
    });
  }
  // The same logic as /api/reader in server.js: which page, which section and which chapters
  function readerPayload(R, pageParam) {
    if (!R.order.length) return { book: R.book, unit: null, text: R.whole };
    const want = Number(pageParam) || R.order[0];
    const page = (String(want) in R.units) ? want : R.order.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best), R.order[0]);
    const chapter = R.chapters.find((c) => c.a && page >= c.a && page <= c.b) || null;
    return {
      book: R.book, unit: R.unit, page, first: R.order[0], last: R.order[R.order.length - 1],
      text: R.units[page], printed: R.offset ? page - R.offset : null, chapter, pdfUrl: null,
    };
  }
  const notInArchive = () => json({ error: 'The text of this source is not in the archive' }, 404);

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.startsWith('/api/')) return realFetch(input, init);
    const [route, query = ''] = url.split('?');
    const path = decodeURIComponent(route);
    if (init && init.method && init.method !== 'GET') return Promise.resolve(json({ ok: false, error: 'Read-only archive' }, 403));
    if (path === '/api/search') return Promise.resolve(json(search(new URLSearchParams(query).get('q') || '')));
    if (path === '/api/reader') {
      const q = new URLSearchParams(query);
      const src = q.get('src') || '';
      if (!Object.prototype.hasOwnProperty.call(readerOf, src)) return Promise.resolve(notInArchive());
      const key = readerOf[src];
      return loadReader(key).then((R) => json(readerPayload(R, q.get('page'))), () => notInArchive());
    }
    if (path.startsWith('/api/page/')) {
      const d = data.api[path];
      return Promise.resolve(d ? json(d) : json({ error: 'There is no such page' }, 404));
    }
    if (path in data.api) return Promise.resolve(json(data.api[path]));
    return Promise.resolve(json({ ok: false, error: 'Not available in the archive' }, 404));
  };
  window.LIB_ARCHIVE_META = data.meta || {}; // date and number of pages for the start view
})();
