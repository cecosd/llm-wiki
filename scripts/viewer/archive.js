// Статичният архив: същият интерфейс, но данните идват от вградените lib-static, а не от сървъра.
// Тук се подменя fetch за адресите /api/... Всичко, което води до запис или до Claude, се скрива в app.js (флагът ro).
// Текстовете за четеца са в reader/<източник>.js до index.html и се зареждат при първо отваряне (file:// не позволява fetch).
// Файлът се вгражда в index.html от scripts/archive.js; в обикновената библиотека не се зарежда.
(() => {
  const el = document.getElementById('lib-static'); // вгражда се от scripts/archive.js като JSON
  const data = window.LIB_STATIC = el ? JSON.parse(el.textContent) : { api: {}, meta: {}, readerOf: {} };
  const readerOf = data.readerOf || {};
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

  // Търсене в заглавията, псевдонимите и текста: същото като сървъра, но без сгъване на кирилица и латиница
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

  // Текстът на книга: файлът reader/<ключ>.js задава window.LIB_READER_DATA[ключ]; зарежда се веднъж
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
  // Същата логика като /api/reader в server.js: коя страница, кой раздел и кои глави
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
  window.LIB_ARCHIVE_META = data.meta || {}; // дата и брой страници за началния изглед
})();
