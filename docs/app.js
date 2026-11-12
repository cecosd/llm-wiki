// Код на страницата за продукта (docs/index.html). Текстовете и демо данните са в landing.js.
// Външен файл, защото Content-Security-Policy на сървъра забранява вградения код.
const { createApp, reactive, defineComponent, nextTick, markRaw } = Vue;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const LANGS = ['bg', 'en'];

/* ===== Език ===== */
function initLang() {
  let l = null;
  try { l = new URLSearchParams(location.search).get('lang'); } catch (e) {}
  if (!LANGS.includes(l)) { try { l = localStorage.getItem('llmwiki-lang'); } catch (e) {} }
  if (!LANGS.includes(l)) l = (navigator.languages || [navigator.language || '']).some(x => /^bg/i.test(x)) ? 'bg' : 'en';
  return l;
}
const TOUR_KEYS = [['ingest', '#demo'], ['cite', '#library'], ['search', '#library'], ['edit', '#page'], ['ask', '#page'], ['rename', '#page'], ['graph', '#graph'], ['learn', '#learn'], ['write', '#write'], ['settings', '#settings']];
function loadTour() { let t = {}; try { t = JSON.parse(localStorage.getItem('llmwiki-tour') || '{}'); } catch (e) {} return Object.fromEntries(TOUR_KEYS.map(k => [k[0], !!t[k[0]]])); }
const store = reactive({ lang: initLang(), page: 'forgetting-curve', history: [], reader: null, search: false, toast: null, edits: { bg: {}, en: {} }, tour: loadTour(), setTab: null });
const T = () => I18N[store.lang];

/* ===== Страници на текущия език ===== */
const PSETS = {}, PBY = {};
LANGS.forEach(L => {
  PSETS[L] = LIB.map(p => { const { bg, en, ...meta } = p; return { ...meta, ...p[L], area: p.area ? I18N[L].areas[p.area] : undefined }; });
  PBY[L] = Object.fromEntries(PSETS[L].map(p => [p.slug, p]));
});
const BY = new Proxy({}, { get: (_, k) => PBY[store.lang][k], has: (_, k) => k in PBY.bg });
const pages = () => PSETS[store.lang];
const SLUGS = LIB.map(p => p.slug);
const TYPE_KEYS = ['source', 'chapter', 'concept', 'entity', 'topic', 'comparison', 'question'];
const TYPE_META = { source: ['var(--t-source)', 'sources/'], chapter: ['var(--t-chapter)', 'sources/chapters/'], concept: ['var(--t-concept)', 'concepts/'], entity: ['var(--t-entity)', 'entities/'], topic: ['var(--t-topic)', 'topics/'], comparison: ['var(--t-comparison)', 'comparisons/'], question: ['var(--t-question)', 'questions/'] };
const typeColor = k => (TYPE_META[k] || TYPE_META.concept)[0];
const typeCount = k => LIB.filter(p => p.type === k).length;
const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const linksOf = body => { const s = new Set(); for (const m of body.matchAll(LINK_RE)) if (m[1] in PBY.bg) s.add(m[1]); return [...s]; };

/* Връзките са едни и същи на двата езика: изчисляват се от българския текст */
const OUT = {}, IN = {};
PSETS.bg.forEach(p => {
  const o = linksOf(p.body).filter(x => x !== p.slug);
  if (p.book && !o.includes(p.book)) o.push(p.book);
  (p.chapters || []).forEach(c => { if (!o.includes(c)) o.push(c); });
  OUT[p.slug] = o;
});
SLUGS.forEach(s => OUT[s].forEach(x => (IN[x] = IN[x] || []).push(s)));
const EDGES = [];
(() => { const seen = new Set(); SLUGS.forEach(s => OUT[s].forEach(x => { const k = [s, x].sort().join('|'); if (!seen.has(k)) { seen.add(k); EDGES.push(k.split('|')); } })); })();
LANGS.forEach(L => PSETS[L].forEach(p => {
  for (const m of p.body.matchAll(LINK_RE)) if (!(m[1] in PBY.bg)) console.warn('Broken link', L, p.slug, m[1]);
  const a = linksOf(p.body).sort().join(), b = linksOf(PBY.bg[p.slug].body).sort().join(); if (a !== b) console.warn('Link mismatch', L, p.slug);
}));

const bodyOf = slug => { const e = store.edits[store.lang]; return e[slug] !== undefined ? e[slug] : BY[slug].body; };
function toast(text) { const id = Date.now() + Math.random(); store.toast = { text, id }; setTimeout(() => { if (store.toast && store.toast.id === id) store.toast = null; }, 3200); }
function go(slug, opts = {}) {
  if (!(slug in PBY.bg)) return;
  if (store.page !== slug) { store.history.push(store.page); store.page = slug; }
  if (opts.scroll) { const el = document.getElementById('library'); if (el) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' }); }
}
function openReader(slug, page) { store.reader = { slug, page: +page, hl: +page }; store.tour.cite = true; }
const readerSlug = p => { if (!p) return null; if (READER[p.slug]) return p.slug; if (p.book && READER[p.book]) return p.book; return null; };
const areaOf = p => p.area || (p.book && BY[p.book].area) || null;

/* ===== Markdown ===== */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const KIND = '(с\\.|разд\\.|p\\.|sec\\.)';
const CITE_RE = new RegExp('\\(\\[\\[([^\\]|]+)(?:\\|[^\\]]+)?\\]\\],\\s*' + KIND + '\\s*(\\d+)\\)', 'g');
const BARE_RE = new RegExp('\\(' + KIND + '\\s*(\\d+)\\)', 'g');
function wl(slug, txt) { const p = BY[slug]; if (!p) return txt || slug; return `<a class="wl" data-go="${slug}" style="--c:${typeColor(p.type)}" title="${esc(p.title)}">${txt || esc(p.title)}</a>`; }
const pgBtn = (rs, n, kind) => `<button class="pg" data-reader="${rs}" data-page="${n}">${kind} ${n}</button>`;
const citeLabel = p => p.type === 'chapter' ? `${BY[p.book].short}, ${T().cite.ch} ${p.chapter}` : (p.short || p.title);
function inline(s, ctx) {
  s = esc(s);
  s = s.replace(CITE_RE, (m, slug, kind, n) => { const p = BY[slug]; if (!p) return m; const rs = readerSlug(p); return `<span class="cite">(${wl(slug, esc(citeLabel(p)))}, ${rs ? pgBtn(rs, n, kind) : kind + ' ' + n})</span>`; });
  s = s.replace(BARE_RE, (m, kind, n) => { const rs = readerSlug(ctx); return rs ? `(${pgBtn(rs, n, kind)})` : m; });
  s = s.replace(LINK_RE, (m, slug, txt) => wl(slug, txt));
  return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code class="mono" style="font-size:.85em">$1</code>');
}
function mdTable(rows, ctx) {
  const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const head = cells(rows[0]), body = rows.slice(2).map(cells);
  return `<table><thead><tr>${head.map(h => `<th>${inline(h, ctx)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function md(body, ctx) {
  const L = body.split('\n'); let html = '', i = 0, contra = false;
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    if (l.trim() === '{{chart}}') { html += chartSvg(); i++; continue; }
    if (l.startsWith('## ')) { const h = l.slice(3); contra = /Противоречия|Contradictions/.test(h); html += `<h3>${inline(h, ctx)}</h3>`; i++; continue; }
    let block;
    if (l.startsWith('- ')) { const it = []; while (i < L.length && L[i].startsWith('- ')) it.push(`<li>${inline(L[i++].slice(2), ctx)}</li>`); block = `<ul>${it.join('')}</ul>`; }
    else if (l.startsWith('|')) { const rows = []; while (i < L.length && L[i].startsWith('|')) rows.push(L[i++]); block = mdTable(rows, ctx); }
    else { const ps = []; while (i < L.length && L[i].trim() && !/^(## |- |\||\{\{chart\}\})/.test(L[i])) ps.push(L[i++]); block = `<p>${inline(ps.join(' '), ctx)}</p>`; }
    html += contra ? `<div class="callout contra">${block}</div>` : block; contra = false;
  }
  return html;
}
function plain(body) {
  return body.replace(CITE_RE, (m, s) => `(${BY[s] ? citeLabel(BY[s]) : s})`).replace(LINK_RE, (m, s, x) => x || (BY[s] ? BY[s].title : s))
    .replace(/\{\{chart\}\}/g, '').replace(/^## .*$/gm, '').replace(/^\|.*$/gm, '').replace(/\*\*|\*|`/g, '').replace(/^- /gm, '').replace(BARE_RE, '').replace(/\s+/g, ' ').trim();
}
const firstSentence = p => { const x = plain(bodyOf(p.slug)); const m = x.match(/^.+?[.!?](\s|$)/); return (m ? m[0] : x).trim(); };
const apaHtml = s => esc(s).replace(/\*([^*]+)\*/g, '<i>$1</i>');
const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function chartSvg() {
  const li = store.lang === 'bg' ? 0 : 1, W = 560, H = 230, Lm = 44, Rm = 18, Tp = 20, B = 42;
  const lx = SAVINGS.map(d => Math.log10(d[1])), x0 = Math.min(...lx), x1 = Math.max(...lx);
  const X = v => Lm + (Math.log10(v) - x0) / (x1 - x0) * (W - Lm - Rm), Y = v => Tp + (1 - v / 70) * (H - Tp - B);
  const pts = SAVINGS.map(d => [X(d[1]), Y(d[2])]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${Y(0)} L${pts[0][0].toFixed(1)} ${Y(0)} Z`;
  const grid = [0, 20, 40, 60].map(v => `<line x1="${Lm}" x2="${W - Rm}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${Lm - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}%</text>`).join('');
  const dots = SAVINGS.map((d, i) => `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="4.5" fill="var(--panel)" stroke="var(--sage)" stroke-width="2"><title>${d[0][li]}: ${d[2]}%</title></circle><text x="${pts[i][0].toFixed(1)}" y="${(pts[i][1] - 10).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink)">${Math.round(d[2])}</text><text x="${pts[i][0].toFixed(1)}" y="${H - B + 18}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${d[0][li]}</text>`).join('');
  return `<figure style="margin:1.2em 0"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-width:620px" role="img" aria-label="${CHART_TXT[store.lang][0]}"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sage)" stop-opacity=".28"/><stop offset="1" stop-color="var(--sage)" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#ga)"/><path d="${line}" fill="none" stroke="var(--sage)" stroke-width="2.5" stroke-linejoin="round"/>${dots}</svg><figcaption class="text-xs faint">${CHART_TXT[store.lang][1]}</figcaption></figure>`;
}

/* ===== Търсене ===== */
const STOP = new Set(['как', 'какво', 'защо', 'кой', 'кои', 'коя', 'има', 'общо', 'между', 'това', 'тази', 'този', 'които', 'който', 'така', 'мога', 'моите', 'моят', 'моята', 'си', 'ги', 'го', 'при', 'без', 'или', 'но', 'не', 'са', 'съм', 'да', 'на', 'за', 'се', 'от', 'по', 'ли', 'ми', 'работи',
  'the', 'and', 'what', 'how', 'why', 'does', 'do', 'have', 'has', 'with', 'about', 'can', 'should', 'are', 'is', 'my', 'that', 'this', 'for', 'from', 'common', 'work', 'works']);
const stem = w => w.length <= 4 ? w : w.slice(0, Math.max(4, Math.min(6, w.length - 2)));
function rankPages(q, { stems = false } = {}) {
  const words = fold(q).split(/[^a-zа-я0-9-]+/i).filter(w => w.length > 1 && !STOP.has(w)).map(w => stems ? stem(w) : w);
  if (!words.length) return [];
  return pages().map(p => {
    const title = fold(p.title), al = fold((p.aliases || []).join(' ') + ' ' + p.slug + ' ' + (PBY.bg[p.slug].aliases || []).join(' ') + ' ' + (PBY.en[p.slug].aliases || []).join(' ')), tags = fold((p.tags || []).join(' ')), body = fold(plain(bodyOf(p.slug)));
    let s = 0; for (const w of words) { if (title.includes(w)) s += 10; if (al.includes(w)) s += 8; if (tags.includes(w)) s += 3; if (body.includes(w)) s += 1 + Math.min(3, body.split(w).length - 2); }
    return { p, s, words };
  }).filter(r => r.s > 0).sort((a, b) => b.s - a.s);
}
function snippet(p, words) {
  const x = plain(bodyOf(p.slug)), f = fold(x); let at = -1;
  for (const w of words) { at = f.indexOf(w); if (at >= 0) break; }
  if (at < 0) return esc(x.slice(0, 110)) + '…';
  const a = Math.max(0, at - 45); let h = esc(x.slice(a, at + 75));
  words.forEach(w => { const re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'); h = h.replace(re, '<mark>$1</mark>'); });
  return (a ? '…' : '') + h + '…';
}

/* ===== Брояч ===== */
const CountUp = defineComponent({
  props: { to: Number, from: { type: Number, default: 0 }, suffix: { type: String, default: '' } },
  data() { return { v: this.from }; },
  template: '<span>{{ v }}{{ suffix }}</span>',
  mounted() {
    const run = () => { if (REDUCED) { this.v = this.to; return; } const t0 = performance.now(), d = 1500; const f = x => { const k = Math.min(1, (x - t0) / d), e = 1 - Math.pow(1 - k, 3); this.v = Math.round(this.from + (this.to - this.from) * e); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); };
    this.io = new IntersectionObserver(es => { if (es[0].isIntersecting) { run(); this.io.disconnect(); } }, { threshold: .5 }); this.io.observe(this.$el);
  },
  beforeUnmount() { this.io.disconnect(); },
});

/* ===== Начало: живо платно ===== */
const HeroCanvas = defineComponent({
  template: '<canvas aria-hidden="true"></canvas>',
  mounted() {
    const cv = this.$el, ctx = cv.getContext('2d'); let W = 0, H = 0, dpr = 1, raf = 0, on = true, mouse = { x: -999, y: -999 }; const cols = {};
    const readCols = () => { const s = getComputedStyle(document.documentElement); ['--t-source', '--t-concept', '--t-entity', '--t-topic', '--t-question', '--t-chapter', '--sage', '--gold', '--panel'].forEach(k => { cols[k] = s.getPropertyValue(k).trim(); }); };
    readCols(); this.mo = new MutationObserver(readCols); this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const palette = () => [cols['--t-concept'], cols['--t-source'], cols['--t-entity'], cols['--t-topic'], cols['--t-question'], cols['--t-chapter']];
    let nodes = [], files = [], last = 0;
    const LABELS = ['PDF', 'EPUB', 'DOCX', 'CSV', 'XLSX', 'HTML', 'MD', 'DOI', 'TXT'];
    const size = () => {
      const nw = cv.clientWidth, nh = cv.clientHeight; if (!nw || !nh) return; const regen = !nodes.length || Math.abs(nw - W) > 80;
      dpr = Math.min(2, devicePixelRatio || 1); W = nw; H = nh; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!regen) { nodes.forEach(n => { n.x = Math.min(n.x, W - 4); n.y = Math.min(n.y, H - 30); }); return; }
      const n = W < 700 ? 26 : 54, left = W < 1000 ? 0 : W * .38;
      nodes = Array.from({ length: n }, (_, i) => ({ x: left + Math.random() * (W - left), y: 60 + Math.random() * (H - 120), vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25, r: 1.6 + Math.random() * 2.6, ci: i % 6, glow: 0 }));
    };
    const spawn = () => { const t = nodes[Math.floor(Math.random() * nodes.length)]; if (!t) return; const fromLeft = Math.random() < .6; files.push({ x: fromLeft ? -40 : t.x + (Math.random() - .5) * 300, y: fromLeft ? t.y + (Math.random() - .5) * 260 : H + 30, t, k: 0, label: LABELS[Math.floor(Math.random() * LABELS.length)] }); };
    const frame = ts => {
      raf = requestAnimationFrame(frame); if (!on || !W) return;
      ctx.clearRect(0, 0, W, H);
      if (ts - last > 1300 && files.length < 4) { spawn(); last = ts; }
      const pal = palette(), D = W < 700 ? 110 : 150;
      for (const n of nodes) { n.x += n.vx; n.y += n.vy; if (n.x < 0 || n.x > W) n.vx *= -1; if (n.y < 30 || n.y > H - 30) n.vy *= -1; const dx = mouse.x - n.x, dy = mouse.y - n.y, d = Math.hypot(dx, dy); if (d < 160 && d > 1) { n.x += dx / d * .35; n.y += dy / d * .35; } n.glow *= .965; }
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < D) { const fade = W >= 1000 ? Math.min(1, Math.min(a.x, b.x) / (W * .5) + .15) : .6; ctx.strokeStyle = cols['--sage']; ctx.globalAlpha = (1 - d / D) * .32 * fade + Math.max(a.glow, b.glow) * .4; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      for (const n of nodes) {
        const fade = W >= 1000 ? Math.min(1, n.x / (W * .5) + .2) : .7;
        ctx.globalAlpha = .85 * fade; ctx.fillStyle = pal[n.ci]; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + n.glow * 5, 0, 7); ctx.fill();
        if (n.glow > .05) { ctx.globalAlpha = n.glow * .5; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 6 + (1 - n.glow) * 26, 0, 7); ctx.strokeStyle = pal[n.ci]; ctx.stroke(); }
      }
      ctx.font = '600 10px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      files = files.filter(f => {
        f.k += .012; const e = 1 - Math.pow(1 - Math.min(1, f.k), 3), x = f.x + (f.t.x - f.x) * e, y = f.y + (f.t.y - f.y) * e;
        if (f.k >= 1) { f.t.glow = 1; return false; }
        ctx.globalAlpha = Math.min(1, f.k * 4) * (1 - Math.max(0, f.k - .85) * 6); ctx.fillStyle = cols['--panel']; ctx.strokeStyle = cols['--gold']; const w = ctx.measureText(f.label).width + 14;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 10, w, 20, 6); else ctx.rect(x - w / 2, y - 10, w, 20); ctx.fill(); ctx.stroke(); ctx.fillStyle = cols['--gold']; ctx.fillText(f.label, x, y + .5); return true;
      });
      ctx.globalAlpha = 1;
    };
    size(); this.ro = new ResizeObserver(() => size()); this.ro.observe(cv);
    this.onMove = e => { const r = cv.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; };
    this.onLeave = () => { mouse = { x: -999, y: -999 }; };
    cv.parentElement.addEventListener('pointermove', this.onMove); cv.parentElement.addEventListener('pointerleave', this.onLeave);
    this.io = new IntersectionObserver(es => { on = es[0].isIntersecting; }); this.io.observe(cv);
    if (REDUCED) { size(); frame(0); cancelAnimationFrame(raf); } else raf = requestAnimationFrame(frame);
    this.stop = () => cancelAnimationFrame(raf);
  },
  beforeUnmount() { this.stop(); this.ro.disconnect(); this.io.disconnect(); this.mo.disconnect(); },
});

/* ===== Начало: поток на агента ===== */
const HeroFeed = defineComponent({
  template: '#tpl-feed',
  data() { return { shown: [], i: 0, made: 0, upd: 0, contra: 0, pct: 4, id: 0 }; },
  watch: { L() { this.i = 0; this.shown = []; this.made = this.upd = this.contra = 0; this.tick(); } },
  mounted() { this.tick(); this.timer = setInterval(() => this.tick(), REDUCED ? 4000 : 1500); },
  beforeUnmount() { clearInterval(this.timer); },
  methods: {
    tick() {
      const F = this.t.feed.lines;
      if (this.i >= F.length) { this.i = 0; this.shown = []; this.made = this.upd = this.contra = 0; }
      const f = F[this.i++]; this.shown.push({ id: ++this.id, i: f[0], a: f[1], b: f[2], c: f[3] }); if (this.shown.length > 6) this.shown.shift();
      if (f[4]) this[f[4]]++; this.pct = Math.round(this.i / F.length * 100);
    },
  },
});

/* ===== Карта на връзките ===== */
const shortLabel = p => p.format === 'dataset' ? T().common.dataShort : p.type === 'chapter' ? T().common.chShort(p.chapter) : p.type === 'source' ? p.short.split('/')[0] : (p.title.length > 26 ? p.title.slice(0, 24) + '…' : p.title);
const KgGraph = defineComponent({
  template: '#tpl-kg',
  props: { slugs: { type: Array, default: null }, height: { type: Number, default: 480 }, mini: Boolean, selected: { type: String, default: null }, pulses: { type: Object, default: () => ({}) } },
  emits: ['pick'],
  data() { return { w: 800, nodes: [], links: [], hover: null, drag: null, tick: 0 }; },
  computed: {
    h() { return this.height; },
    focusSlug() { return this.drag ? this.drag.n.slug : (this.hover || this.selected || null); },
    nbr() { this.tick; const f = this.focusSlug, s = new Set(); if (f) { s.add(f); this.links.forEach(l => { if (l.s.slug === f) s.add(l.t.slug); if (l.t.slug === f) s.add(l.s.slug); }); } return s; },
  },
  watch: {
    slugs: { handler() { this.sync(); }, deep: true },
    pulses: { handler(v) { this.nodes.forEach(n => { if (v[n.slug] && v[n.slug] !== n.pulse) n.pulse = v[n.slug]; }); this.alpha = Math.max(this.alpha, .25); }, deep: true },
    height() { this.alpha = .6; },
    L() { this.nodes.forEach(n => { n.label = shortLabel(BY[n.slug]); }); this.tick++; },
  },
  created() { this.alpha = 1; },
  mounted() {
    const wrap = this.$refs.wrap; this.w = wrap.clientWidth || 800;
    this.ro = new ResizeObserver(() => { const nw = wrap.clientWidth; if (nw && Math.abs(nw - this.w) > 2) { const k = nw / this.w; this.nodes.forEach(n => { n.x *= k; }); this.w = nw; this.alpha = Math.max(this.alpha, .5); } });
    this.ro.observe(wrap);
    this.visible = true; this.io = new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }); this.io.observe(wrap);
    this.sync(); if (!this.mini) for (let i = 0; i < 140; i++) this.step();
    const loop = () => { this.raf = requestAnimationFrame(loop); if (!this.visible) return; if (this.step() || this.drag) this.tick++; };
    this.raf = requestAnimationFrame(loop);
  },
  beforeUnmount() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.io.disconnect(); },
  methods: {
    sync() {
      const want = this.slugs || SLUGS, have = new Map(this.nodes.map(n => [n.slug, n]));
      const nodes = want.filter(s => s in PBY.bg).map(s => have.get(s) || this.make(s, have)), set = new Map(nodes.map(n => [n.slug, n]));
      this.links = EDGES.filter(e => set.has(e[0]) && set.has(e[1])).map(e => markRaw({ k: e.join('|'), s: set.get(e[0]), t: set.get(e[1]) }));
      const deg = {}; this.links.forEach(l => { deg[l.s.slug] = (deg[l.s.slug] || 0) + 1; deg[l.t.slug] = (deg[l.t.slug] || 0) + 1; });
      nodes.forEach(n => { n.r = (this.mini ? 4.5 : 5.5) + Math.sqrt(deg[n.slug] || 0) * (this.mini ? 1.7 : 2.4) + (n.type === 'topic' ? 3 : 0); });
      this.nodes = nodes; this.alpha = Math.max(this.alpha, .8); this.tick++;
    },
    make(slug, have) {
      const p = BY[slug], nb = (OUT[slug] || []).concat(IN[slug] || []).map(s => have.get(s)).find(Boolean);
      const x = nb ? nb.x + (Math.random() - .5) * 50 : this.w / 2 + (Math.random() - .5) * this.w * .6, y = nb ? nb.y + (Math.random() - .5) * 50 : this.h / 2 + (Math.random() - .5) * this.h * .6;
      return markRaw({ slug, type: p.type, label: shortLabel(p), c: typeColor(p.type), x, y, vx: 0, vy: 0, r: 6, pulse: 0, fresh: Date.now() });
    },
    step() {
      const N = this.nodes, a = this.alpha, W = this.w, H = this.h;
      if (a < .004 && !this.drag) return false;
      const area = W * H / 684000, big = area > .6, rep = 22000 * area, len = Math.max(45, 110 * Math.sqrt(area)), cx = big ? .0006 : .002, cy = big ? .003 : .004;
      for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
        const p = N[i], q = N[j]; let dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy; if (d2 < .01) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = .5; } if (d2 > 810000) continue;
        const d = Math.sqrt(d2), f = rep * a / d2, fx = dx / d * f, fy = dy / d * f; p.vx -= fx; p.vy -= fy; q.vx += fx; q.vy += fy;
      }
      for (const l of this.links) { const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - len) / d * .02 * a; l.s.vx += dx * f; l.s.vy += dy * f; l.t.vx -= dx * f; l.t.vy -= dy * f; }
      for (const n of N) {
        n.vx += (W / 2 - n.x) * cx * a; n.vy += (H / 2 - n.y) * cy * a;
        if (this.drag && this.drag.n === n) { n.vx = n.vy = 0; continue; }
        n.vx *= .6; n.vy *= .6; const v = Math.hypot(n.vx, n.vy); if (v > 25) { n.vx *= 25 / v; n.vy *= 25 / v; }
        n.x = Math.max(n.r + 10, Math.min(W - n.r - 10, n.x + n.vx)); n.y = Math.max(n.r + 10, Math.min(H - n.r - 22, n.y + n.vy));
      }
      this.alpha *= .985; return true;
    },
    lit(l) { const f = this.focusSlug; return f && (l.s.slug === f || l.t.slug === f); },
    near(n) { return this.nbr.has(n.slug); },
    label(n) {
      if (this.focusSlug) return this.nbr.has(n.slug);
      if (this.mini) return n.type === 'topic' || n.type === 'source' || Date.now() - n.fresh < 2600;
      return this.w > 640 || n.type === 'topic' || n.type === 'source';
    },
    pt(e) { const r = this.$refs.wrap.querySelector('svg').getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * this.w, y: (e.clientY - r.top) / r.height * this.h }; },
    down(e, n) { this.drag = { n, x0: e.clientX, y0: e.clientY, moved: false }; try { this.$refs.wrap.querySelector('svg').setPointerCapture(e.pointerId); } catch (_) {} this.alpha = Math.max(this.alpha, .4); },
    move(e) { if (!this.drag) return; if (Math.abs(e.clientX - this.drag.x0) + Math.abs(e.clientY - this.drag.y0) > 5) this.drag.moved = true; if (!this.drag.moved) return; const p = this.pt(e); this.drag.n.x = p.x; this.drag.n.y = p.y; this.alpha = Math.max(this.alpha, .3); },
    up() { if (!this.drag) return; const moved = this.drag.moved, n = this.drag.n; this.drag = null; if (!moved) this.$emit('pick', n.slug); },
  },
});

const GraphSection = defineComponent({
  template: '#tpl-graph-section',
  data() { return { off: {}, sel: null, big: innerWidth > 900, typeKeys: TYPE_KEYS }; },
  computed: {
    slugs() { return LIB.filter(p => !this.off[p.type]).map(p => p.slug); },
    page() { return this.sel ? BY[this.sel] : null; },
  },
  mounted() { this.onR = () => { this.big = innerWidth > 900; }; addEventListener('resize', this.onR); },
  beforeUnmount() { removeEventListener('resize', this.onR); },
  methods: {
    typeColor, count: typeCount,
    toggle(k) { this.off = { ...this.off, [k]: !this.off[k] }; if (this.page && this.off[this.page.type]) this.sel = null; },
    pick(slug) { this.sel = slug; store.tour.graph = true; },
    open(slug) { go(slug, { scroll: true }); },
    summary(p) { const s = firstSentence(p); return s.length > 180 ? s.slice(0, 178) + '…' : s; },
    degree(s) { return EDGES.filter(e => e[0] === s || e[1] === s).length; },
    back(s) { return (IN[s] || []).length; },
  },
});

/* ===== Демо 1: симулатор ===== */
const fakeHash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return (h.toString(16) + (h * 7919 >>> 0).toString(16)).slice(0, 12); };
const fmtN = n => n.toLocaleString(store.lang === 'bg' ? 'bg-BG' : 'en-US');
const IngestSim = defineComponent({
  template: '#tpl-sim',
  data() {
    return { files: FILES, done: {}, present: [], cur: null, last: null, opKey: '', stageIdx: 0, log: [], ask: null, modeIdx: 0, idxLang: 1, over: false,
      pulses: {}, history: [], synthDone: false, running: false, fast: false, auto: false, wide: innerWidth >= 1024, lid: 0, clock: 0 };
  },
  computed: {
    waiting() { return this.files.filter(f => !this.done[f.id]); },
    busy() { return !!this.cur || !!this.ask || this.running; },
    doneCount() { return Object.keys(this.done).length; },
    linkCount() { const s = new Set(this.present); return EDGES.filter(e => s.has(e[0]) && s.has(e[1])).length; },
    stageColor() { return this.cur ? 'var(--gold)' : 'var(--sage)'; },
    tree() {
      const c = k => this.present.filter(s => PBY.bg[s].type === k).length;
      return [['sources/', c('source'), 'var(--t-source)'], ['chapters/', c('chapter'), 'var(--t-chapter)'], ['concepts/', c('concept'), 'var(--t-concept)'], ['entities/', c('entity'), 'var(--t-entity)'],
        ['topics/', c('topic'), 'var(--t-topic)'], ['comparisons/', c('comparison'), 'var(--t-comparison)'], ['questions/', c('question'), 'var(--t-question)'], ['log.md', this.history.length, 'var(--muted)']];
    },
  },
  watch: { L() { if (!this.cur && !this.running) { this.log = []; this.last = null; this.opKey = ''; } } },
  mounted() { this.onR = () => { this.wide = innerWidth >= 1024; }; addEventListener('resize', this.onR); },
  beforeUnmount() { this.dead = true; removeEventListener('resize', this.onR); },
  methods: {
    fmt: n => fmtN(n),
    fx(f) { return f[store.lang] || f; },
    isDone(f) { return !!this.done[f.id]; },
    stamp() { this.clock += 1 + Math.floor(Math.random() * 3); const s = this.clock; return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); },
    async say(k, x, ms = 400) {
      if (this.dead) return; await sleep(REDUCED ? 30 : ms * (this.fast ? .3 : 1));
      this.log.push({ id: ++this.lid, k, x, t: this.stamp() });
      await nextTick(); const el = this.$refs.log; if (el) el.scrollTop = el.scrollHeight;
    },
    pulse(slug) { this.pulses = { ...this.pulses, [slug]: Date.now() + Math.random() }; },
    dragStart(e, f) { try { e.dataTransfer.setData('text/plain', f.id); e.dataTransfer.effectAllowed = 'move'; } catch (_) {} },
    drop(e) { this.over = false; let id = ''; try { id = e.dataTransfer.getData('text/plain'); } catch (_) {} const f = FILES.find(x => x.id === id); if (f && !this.busy && !this.done[f.id]) this.start(f); },
    askConfirm(f) { this.ask = f; nextTick(() => { if (this.$refs.ok) this.$refs.ok.focus(); }); return new Promise(res => { this.resolve = res; }); },
    confirm() { const r = this.resolve; this.ask = null; if (r) r(true); },
    cancel() { const r = this.resolve; this.ask = null; if (r) r(false); },
    async runAll() {
      const list = this.waiting.slice(); if (!list.length || this.busy) return;
      const sum = k => list.reduce((a, f) => a + f[k], 0);
      const ok = await this.askConfirm({ all: true, count: list.length, ext: T().common.all, color: 'var(--sage2)', folder: 'raw/inbox/', name: '', units: sum('units'), tin: sum('tin'), tout: sum('tout') });
      if (!ok) return;
      this.running = true; this.fast = true; this.auto = true;
      for (const f of list) { if (this.dead) return; await this.start(f, true); }
      this.running = false; this.fast = false; this.auto = false;
    },
    async start(f, inBatch) {
      if (this.cur || this.done[f.id] || (this.running && !inBatch)) return;
      const M = () => this.t.sim.msg, X = this.fx(f);
      this.cur = f; this.last = null; this.log = []; this.stageIdx = 0; this.clock = 0; this.opKey = '';
      await this.say('dim', '$ npm run inbox', 150);
      await this.say('ok', M().sorted(f.name, f.folder, X.why), 450);
      await this.say('dim', M().hash(fakeHash(f.name)), 300);
      this.stageIdx = 1;
      await this.say('dim', '$ npm run extract', 400);
      if (f.ocr) { await this.say('rd', M().ocr1, 450); await this.say('rd', M().ocr2(f.units), 900); }
      await this.say('ok', M().extracted(f.name.replace(/\.\w+$/, ''), f.units, X.unit, fmtN(f.words)), 450);
      this.stageIdx = 2;
      if (this.auto) await this.say('dim', M().auto(fmtN(f.tin)), 250);
      else {
        const ok = await this.askConfirm(f);
        if (!ok) { await this.say('wr', M().cancelled, 100); this.cur = null; this.opKey = 'cancel'; return; }
        await this.say('ok', M().confirmed(this.t.modes.cards[this.modeIdx].n, fmtN(f.tin)), 150);
      }
      this.stageIdx = 3;
      const mdl = MODELS[this.modeIdx];
      await this.say('dim', M().run(this.t.modes.cards[this.modeIdx].n, mdl[0], mdl[1]), 300);
      await this.say('rd', M().index, 400);
      if (this.idxLang && f.id !== 'csv') await this.say('dim', M().idx[this.idxLang], 250);
      for (const r of X.reads) { const sub = r.startsWith('@'); await this.say(sub ? 'rd' : 'dim', sub ? `[${this.modeIdx === 0 ? 'Haiku · chapter-reader' : mdl[0]}] ${r.slice(1)}` : r, sub ? 650 : 450); }
      this.stageIdx = 4;
      const snap = { file: f, added: [], updated: [] };
      for (const x of f.touch) {
        const opt = x.startsWith('?'), slug = opt ? x.slice(1) : x;
        if (this.present.includes(slug)) { await this.say('wr', M().upd(slug), 360); this.pulse(slug); snap.updated.push(slug); }
        else if (!opt) { await this.say('ok', M().created('wiki/' + TYPE_META[PBY.bg[slug].type][1] + slug + '.md'), 400); this.present.push(slug); snap.added.push(slug); }
      }
      let contra = 0;
      if ((f.id === 'ahr' && this.present.includes('karpathy-2026-llm-wiki')) || (f.id === 'kar' && this.present.includes('ahrens-2017-smart-notes'))) { contra = 1; await this.say('er', M().contra, 550); this.pulse('permanent-notes'); }
      await this.say('wr', M().indexed(snap.added.length), 350);
      await this.say('ok', M().lintq, 350);
      this.done = { ...this.done, [f.id]: true }; this.history.push(snap); this.synthDone = false;
      this.last = { file: f, made: snap.added.length, upd: snap.updated.length, contra };
      this.cur = null; store.tour.ingest = true;
    },
    srcCount(s) { return new Set(OUT[s].filter(x => this.present.includes(x)).map(x => PBY.bg[x].book || x).filter(x => PBY.bg[x].type === 'source')).size; },
    async synth() {
      if (this.busy) return; const M = this.t.sim.msg;
      this.running = true; this.last = null; this.log = []; this.clock = 0; this.opKey = 'synth';
      await this.say('dim', M.synth0, 150);
      const multi = this.present.filter(s => PBY.bg[s].type === 'concept' && this.srcCount(s) >= 2);
      await this.say('rd', M.multi(multi.length, multi.slice(0, 3).map(s => BY[s].title).join(', ')), 500);
      const d = this.done, km = ['bush', 'luh', 'kar', 'ahr'].filter(k => d[k]).length, want = [];
      if (km >= 2) want.push('memex-zettelkasten-llm-wiki');
      if (d.bush || d.luh || d.kar) want.push('knowledge-compounding', 'topic-knowledge-systems');
      if (d.ebb || d.csv) want.push('topic-memory');
      if (d.ebb && (d.ahr || d.csv)) want.push('why-we-forget');
      const snap = { synth: true, added: [], updated: [] };
      for (const s of want) { if (this.present.includes(s)) continue; await this.say('ok', M.created('wiki/' + TYPE_META[PBY.bg[s].type][1] + s + '.md'), 450); this.present.push(s); snap.added.push(s); }
      if (!snap.added.length) await this.say('dim', M.nothing, 300);
      await this.say('wr', M.synthEnd, 450);
      this.history.push(snap); this.synthDone = true; this.running = false;
    },
    async lint() {
      if (this.busy) return; const M = this.t.sim.msg;
      this.running = true; this.last = null; this.log = []; this.clock = 0; this.opKey = 'lint';
      const one = this.present.filter(s => PBY.bg[s].type === 'concept' && this.srcCount(s) === 1);
      const lines = M.lint(one.length, this.waiting.length);
      for (let i = 0; i < lines.length; i++) await this.say(i === 0 || i === lines.length - 1 ? 'dim' : (i === 4 && one.length) || (i === 5 && this.waiting.length) ? 'wr' : 'ok', lines[i], 280);
      if (one.length) await this.say('dim', M.gap(BY[one[0]].title), 300);
      this.running = false;
    },
    async undo() {
      if (this.cur || this.running || !this.history.length) return; const M = this.t.sim.msg;
      const s = this.history.pop();
      this.present = this.present.filter(x => !s.added.includes(x));
      if (s.file) { const d = { ...this.done }; delete d[s.file.id]; this.done = d; }
      if (s.synth) this.synthDone = false;
      this.last = null; this.log = []; this.clock = 0; this.opKey = 'undo';
      await this.say('wr', M.undone(s.synth ? M.undoSynth : M.undoFile(s.file.name)), 100);
      await this.say('dim', M.undoInfo(s.added.length, !!s.file), 250);
    },
    reset() { if (this.busy) return; this.present = []; this.done = {}; this.history = []; this.last = null; this.log = []; this.synthDone = false; this.opKey = ''; },
    openPage(slug) { go(slug, { scroll: true }); },
  },
});

/* ===== Демо 2: библиотеката ===== */
function sortedPages() { return pages().slice().sort((a, b) => TYPE_KEYS.indexOf(a.type) - TYPE_KEYS.indexOf(b.type) || a.title.localeCompare(b.title, store.lang)); }
function yamlOf(p) {
  const q = v => `"${String(v).replace(/"/g, '\\"')}"`, arr = a => '[' + a.join(', ') + ']';
  const L = [['title', q(p.title)], ['type', p.type]];
  if (p.kind) L.push(['kind', p.kind]);
  if (p.book) L.push(['book', q('[[' + p.book + ']]')], ['chapter', p.chapter], ['pages', q(p.pages)]);
  if (p.type === 'source') L.push(['raw_path', p.raw], ['format', p.format], ['year', p.year], ['apa', q(p.apa)], ['emphasis', q(p.emphasis)], ['area', p.area], ['depth', 2]);
  if (p.lang) L.push(['lang', p.lang]); if (p.original_title) L.push(['original_title', q(p.original_title)]); if (p.page_offset !== undefined) L.push(['page_offset', p.page_offset]);
  if (p.aliases) L.push(['aliases', arr(p.aliases)]);
  L.push(['tags', arr(p.tags || [])], ['related', arr(OUT[p.slug].slice(0, 6).map(s => q('[[' + s + ']]')))], ['confidence', p.confidence], ['created', '2026-11-06'], ['updated', '2026-11-06']);
  return `<span class="c">---</span>\n${L.map(([k, v]) => `<span class="k">${k}:</span> <span class="s">${esc(v)}</span>`).join('\n')}\n<span class="c">---</span>\n\n${esc(bodyOf(p.slug))}`;
}
const WikiExplorer = defineComponent({
  template: '#tpl-explorer',
  data() { return { store, coll: PBY.bg[store.page].type, raw: false, focus: false, bubble: null, panel: null, linkQ: '', typeKeys: TYPE_KEYS, list: ['ahrens-2017-smart-notes', 'zettelkasten', 'why-we-forget'] }; },
  computed: {
    page() { return BY[store.page]; },
    /* Колекции като в приложението: умна (по условие за етикет, пълни се сама) и ръчен списък (бутонът „Списък“) */
    cols() {
      const C = this.t.exp.col, tags = C.smartTags;
      return [
        { id: 'smart', name: C.smart, hint: C.smartHint, color: 'var(--gold)', icon: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>', pages: sortedPages().filter(p => (p.tags || []).some(g => tags.includes(g))) },
        { id: 'list', name: C.list, hint: C.listHint, color: 'var(--sage)', icon: '<path d="M6 3h12v18l-6-4-6 4z"/>', pages: this.list.map(s => BY[s]).filter(Boolean) },
      ];
    },
    curCol() { return this.cols.find(c => c.id === this.coll); },
    inList() { return this.list.includes(store.page); },
    body() { return bodyOf(store.page); },
    html() { return md(this.body, this.page); },
    folder() { return TYPE_META[this.page.type][1]; },
    area() { return areaOf(this.page); },
    collPages() { return this.curCol ? this.curCol.pages : sortedPages().filter(p => p.type === this.coll); },
    backlinks() { const s = store.page; return pages().filter(p => p.slug !== s && (linksOf(bodyOf(p.slug)).includes(s) || p.book === s || (p.chapters || []).includes(s))).map(p => p.slug); },
    related() { const o = linksOf(this.body).filter(s => s !== store.page); if (this.page.book && !o.includes(this.page.book)) o.push(this.page.book); return o; },
    rawHtml() { return yamlOf(this.page); },
    edited() { return Object.keys(store.edits[store.lang]).length > 0; },
    linkHits() {
      const all = sortedPages().filter(p => p.slug !== store.page), typed = fold(this.linkQ).trim();
      if (typed) { const hit = all.filter(p => fold(p.title + ' ' + (p.aliases || []).join(' ')).includes(typed)); return (hit.length ? hit : rankPages(this.linkQ, { stems: true }).map(r => r.p).filter(p => p.slug !== store.page)).slice(0, 8); }
      const ranked = this.panel ? rankPages(this.panel.text, { stems: true }).map(r => r.p).filter(p => p.slug !== store.page) : [];
      return [...new Set([...ranked, ...all])].slice(0, 8);
    },
  },
  watch: {
    'store.page'(s) {
      if (!(this.curCol && this.curCol.pages.some(p => p.slug === s))) this.coll = PBY.bg[s].type; // в колекция остава, ако страницата е в нея
      this.bubble = null; this.panel = null;
      nextTick(() => { const b = this.$refs.box; if (b && b.getBoundingClientRect().top < 0) b.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); });
    },
    L() { this.bubble = null; this.panel = null; },
  },
  methods: {
    typeColor, count: typeCount, apa: apaHtml,
    get: s => BY[s], title: s => (BY[s] ? BY[s].title : s),
    go(s) { go(s); }, openSearch() { store.search = true; },
    toggleList() {
      const s = store.page, C = this.t.exp.col;
      if (this.list.includes(s)) { this.list = this.list.filter(x => x !== s); toast(C.removedToast); } else { this.list = [...this.list, s]; toast(C.addedToast); }
    },
    back() { const p = store.history.pop(); if (p) store.page = p; },
    onClick(e) { const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); go(a.dataset.go); return; } const b = e.target.closest('[data-reader]'); if (b) openReader(b.dataset.reader, b.dataset.page); },
    neighbour(d) { const S = sortedPages(), i = S.findIndex(p => p.slug === store.page), n = S.length; return S[(i + d + n) % n]; },
    step(d) { go(this.neighbour(d).slug); },
    short: s => (s.length > 70 ? s.slice(0, 68) + '…' : s),
    onSelect() {
      setTimeout(() => {
        const sel = getSelection(), txt = sel ? sel.toString().trim() : '';
        if (!txt || txt.length < 3 || txt.length > 400 || !sel.rangeCount) { this.bubble = null; return; }
        const range = sel.getRangeAt(0), box = this.$el.querySelector('.md');
        if (!box || !box.contains(range.commonAncestorContainer)) { this.bubble = null; return; }
        const r = range.getBoundingClientRect(), ar = this.$refs.art.getBoundingClientRect();
        this.bubble = { x: Math.max(130, Math.min(ar.width - 130, r.left + r.width / 2 - ar.left)), y: Math.max(48, r.top - ar.top), text: txt };
      }, 10);
    },
    act(kind) {
      const text = this.bubble.text; this.bubble = null;
      this.panel = { kind, text, links: [], err: '' };
      if (kind === 'link') { this.linkQ = ''; nextTick(() => this.$refs.linkInp && this.$refs.linkInp.focus()); }
      if (kind === 'del') { const blk = this.findBlock(text); if (!blk) this.panel.err = this.t.exp.err.para; else this.panel.links = linksOf(blk.text); }
      try { getSelection().removeAllRanges(); } catch (_) {}
    },
    findBlock(text) {
      const x = text.replace(/\s+/g, ' ').slice(0, 40), blocks = this.body.split(/\n\n/);
      const i = blocks.findIndex(b => !b.startsWith('## ') && plain(b).replace(/\s+/g, ' ').includes(x));
      return i < 0 ? null : { i, text: blocks[i], blocks };
    },
    setBody(b) { store.edits[store.lang] = { ...store.edits[store.lang], [store.page]: b }; },
    applyLink(slug) {
      const x = this.panel.text, body = this.body, E = this.t.exp.err;
      if (/[\n[\]*|]/.test(x)) { this.panel.err = E.format; return; }
      const parts = body.split(x);
      if (parts.length !== 2) { this.panel.err = parts.length > 2 ? E.many : E.notfound; return; }
      if (parts[0].lastIndexOf('[[') > parts[0].lastIndexOf(']]')) { this.panel.err = E.inlink; return; }
      this.setBody(parts[0] + (fold(x) === fold(BY[slug].title) ? `[[${slug}]]` : `[[${slug}|${x}]]`) + parts[1]);
      this.panel = null; toast(this.t.exp.toastLink);
      nextTick(() => { const el = this.$el.querySelector(`.md [data-go="${slug}"]`); if (el) el.classList.add('new'); });
    },
    applyDelete() {
      const blk = this.findBlock(this.panel.text); if (!blk) return;
      blk.blocks.splice(blk.i, 1); this.setBody(blk.blocks.join('\n\n'));
      this.panel = null; toast(this.t.exp.toastDel);
    },
    resetEdits() { store.edits[store.lang] = {}; toast(this.t.exp.toastReset); },
  },
});

/* ===== Четец ===== */
const ReaderDrawer = defineComponent({
  template: '#tpl-reader',
  data() { return { store }; },
  computed: {
    r() { return store.reader; },
    src() { return this.r ? BY[this.r.slug] : null; },
    rd() { if (!this.r) return null; const d = READER[this.r.slug]; return { kind: d.kind, scan: d.scan, head: d.head[store.lang === 'bg' ? 0 : 1], pages: d.pages }; },
    keys() { return this.rd ? Object.keys(this.rd.pages).map(Number).sort((a, b) => a - b) : []; },
    text() { const p = this.rd.pages[this.r.page]; return p ? p[store.lang === 'bg' ? 1 : 2] : this.t.reader.missing; },
    hlIndex() { const p = this.rd.pages[this.r.page]; return p && this.r.page === this.r.hl ? p[0] : -1; },
    prev() { const k = this.keys.filter(x => x < this.r.page); return k.length ? k[k.length - 1] : null; },
    next() { const k = this.keys.find(x => x > this.r.page); return k === undefined ? null : k; },
  },
  methods: {
    close() { store.reader = null; },
    toSource() { const s = this.r.slug; this.close(); go(s, { scroll: true }); },
  },
});

/* ===== Търсене ===== */
const SearchPalette = defineComponent({
  template: '#tpl-search',
  data() { return { store, q: '', idx: 0 }; },
  computed: {
    hits() {
      if (!this.q.trim()) return ['topic-memory', 'topic-knowledge-systems', 'forgetting-curve', 'zettelkasten', 'memex', 'bush-vannevar'].map(s => ({ p: BY[s], snip: esc(firstSentence(BY[s]).slice(0, 110)) }));
      return rankPages(this.q).slice(0, 9).map(r => ({ p: r.p, snip: snippet(r.p, r.words) }));
    },
  },
  watch: {
    'store.search'(v) { if (v) { this.q = ''; this.idx = 0; nextTick(() => this.$refs.inp && this.$refs.inp.focus()); } },
    q() { this.idx = 0; },
  },
  methods: {
    typeColor,
    close() { store.search = false; },
    move(d) { const n = this.hits.length; if (n) this.idx = (this.idx + d + n) % n; },
    pick(h) { if (!h) return; store.tour.search = true; this.close(); go(h.p.slug, { scroll: true }); },
    mark(s) { let h = esc(s); const f = fold(s); fold(this.q).split(/\s+/).filter(w => w.length > 1).forEach(w => { const i = f.indexOf(w); if (i >= 0) { const o = s.slice(i, i + w.length); h = h.replace(esc(o), '<mark>' + esc(o) + '</mark>'); } }); return h; },
  },
});

/* ===== Работа със страница: редакция, махане, въпрос, план-конспект, промяна с Claude, заглавие, връзка, фокус ===== */
const PT_ICO = {
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  del: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  ask: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
  outline: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  claude: '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  rename: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  focus: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
};
const PT_BTN = ['ask', 'edit', 'link', 'del', 'claude'];
const linkCounts = s => { const m = new Map(); for (const x of String(s).matchAll(LINK_RE)) m.set(x[1], (m.get(x[1]) || 0) + 1); return m; };
const sameLinks = (a, b) => { const x = linkCounts(a), y = linkCounts(b), d = []; for (const k of new Set([...x.keys(), ...y.keys()])) if ((x.get(k) || 0) !== (y.get(k) || 0)) d.push(k); return d; };
const isHead = md => md.startsWith('## ');
/* Като plain(), но цитатите пазят номера на страницата: (Ebbinghaus, 1885/1913, гл. 8, с. 96) */
const ptPlain = x => plain(String(x).replace(CITE_RE, (m, s, kind, n) => `(${BY[s] ? citeLabel(BY[s]) : s}, ${kind} ${n})`));
function ptState(L) { const P = I18N[L].pt; return { blocks: P.blocks.map((md, id) => ({ id, md })), title: P.title, aliases: [...P.aliases], tags: [...P.tags], hist: [] }; }
const freshAi = level => ({ open: false, sel: '', bid: null, intent: 'ask', q: '', level, busy: false, waited: 1, kind: null, answer: '', prop: null, applied: false, saved: false });

const PageTools = defineComponent({
  template: '#tpl-pagetools',
  data() {
    return {
      store, ICO: PT_ICO, BTN: PT_BTN, S2: { bg: ptState('bg'), en: ptState('en') }, tool: null, tried: {}, pulse: null, focus: false, bubble: null, flash: null, renaming: false, titleDraft: '',
      man: { open: false, bid: null, md: '', before: '', err: '' }, del: { open: false, bid: null, text: '', links: [] }, lk: { open: false, bid: null, text: '', q: '', err: '' }, ai: freshAi(1),
    };
  },
  computed: {
    P() { return this.t.pt; },
    st() { return this.S2[this.L]; },
    triedN() { return Object.keys(this.tried).length; },
    replaceable() { return this.ai.kind === 'simple' || this.ai.kind === 'sel'; },
    lkHits() {
      const all = sortedPages().filter(p => p.slug !== 'spaced-repetition'), q = fold(this.lk.q).trim();
      if (q) { const hit = all.filter(p => fold(p.title + ' ' + (p.aliases || []).join(' ')).includes(q)); return (hit.length ? hit : rankPages(this.lk.q, { stems: true }).map(r => r.p).filter(p => p.slug !== 'spaced-repetition')).slice(0, 8); }
      const first = this.tool === 'link' ? [BY[this.P.linkTo]] : [];
      const ranked = this.lk.text ? rankPages(this.lk.text, { stems: true }).map(r => r.p).filter(p => p.slug !== 'spaced-repetition') : [];
      return [...new Set([...first, ...ranked, ...all])].slice(0, 8);
    },
  },
  watch: { L() { this.closeAll(); this.renaming = false; } },
  mounted() {
    this.onKey = e => {
      if (e.key !== 'Escape' || store.search || store.reader) return;
      if (this.man.open || this.del.open || this.lk.open) { this.man.open = this.del.open = this.lk.open = false; return; }
      if (this.ai.open) { this.closeAi(); return; }
      if (this.focus) this.focus = false;
    };
    addEventListener('keydown', this.onKey);
  },
  beforeUnmount() { removeEventListener('keydown', this.onKey); this.stopTimers(); },
  methods: {
    typeColor,
    render(x) { return md(x, BY['spaced-repetition']); },
    plainOf: x => ptPlain(x),
    onClick(e) { const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); go(a.dataset.go, { scroll: true }); return; } const b = e.target.closest('[data-reader]'); if (b) openReader(b.dataset.reader, b.dataset.page); },
    onEsc() {},
    stopTimers() { clearTimeout(this.timer); clearInterval(this.tick); },
    closeAll() { this.stopTimers(); this.bubble = null; this.pulse = null; this.man.open = this.del.open = this.lk.open = false; this.ai = freshAi(this.ai.level); },
    done(k) { if (!this.tried[k]) this.tried = { ...this.tried, [k]: true }; if (this.tool === k) this.pulse = null; },

    /* --- избор на текст --- */
    onSelect(e) { if (e && e.target && e.target.closest && e.target.closest('.pt-ai, .bubble, input, textarea, button')) return; setTimeout(() => this.measureSel(), 10); },
    measureSel() {
      const sel = getSelection(), txt = sel ? sel.toString().replace(/\s+/g, ' ').trim() : '';
      if (!txt || txt.length < 2 || txt.length > 800 || !sel.rangeCount) { this.bubble = null; return false; }
      const range = sel.getRangeAt(0), body = this.$refs.body;
      if (!body || !body.contains(range.commonAncestorContainer)) { this.bubble = null; return false; }
      const blockOf = n => { const el = n.nodeType === 1 ? n : n.parentElement; return el ? el.closest('[data-bid]') : null; };
      const a = blockOf(range.startContainer), b = blockOf(range.endContainer);
      const r = range.getBoundingClientRect(), ar = this.$refs.art.getBoundingClientRect(), half = Math.min(185, ar.width / 2 - 8);
      this.bubble = { x: Math.max(half + 8, Math.min(ar.width - half - 8, r.left + r.width / 2 - ar.left)), y: Math.max(64, r.top - ar.top), text: txt, bid: a && a === b ? +a.dataset.bid : null };
      return true;
    },
    selectText(bid, word) {
      const body = this.$refs.body; if (!body) return false;
      let el = body.querySelector(`[data-bid="${bid}"]`);
      if (!el) { const b = this.st.blocks.find(x => !isHead(x.md)); if (!b) return false; el = body.querySelector(`[data-bid="${b.id}"]`); word = null; }
      const range = document.createRange(); let ok = false;
      if (word) {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(word); if (i >= 0 && !n.parentElement.closest('a, button')) { range.setStart(n, i); range.setEnd(n, i + word.length); ok = true; break; } }
      }
      if (!ok) range.selectNodeContents(el.querySelector('p') || el);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      return this.measureSel();
    },
    act(kind) {
      const b = this.bubble; if (!b) return; this.bubble = null;
      const block = b.bid === null ? null : this.st.blocks.find(x => x.id === b.bid), head = block && isHead(block.md);
      try { getSelection().removeAllRanges(); } catch (_) {}
      if (kind === 'ask') { this.openAi('ask', block && !head ? { text: b.text, bid: block.id } : null); return; }
      if (!block) { toast(this.P.err.para); return; }
      if (head) { toast(this.P.err.heading); return; }
      if (kind === 'claude') { this.openAi('edit', { text: b.text, bid: block.id }); return; }
      this.pulse = null;
      if (kind === 'edit') { this.man = { open: true, bid: block.id, md: block.md, before: block.md, err: '' }; nextTick(() => this.$refs.manInp && this.$refs.manInp.focus()); }
      else if (kind === 'del') { this.del = { open: true, bid: block.id, text: ptPlain(block.md), links: [...new Set([...block.md.matchAll(LINK_RE)].map(m => (BY[m[1]] ? BY[m[1]].title : m[1])))] }; nextTick(() => this.$refs.delCancel && this.$refs.delCancel.focus()); }
      else if (kind === 'link') { this.lk = { open: true, bid: block.id, text: b.text, q: '', err: '' }; if (this.tool === 'link') this.pulse = 'pick'; nextTick(() => this.$refs.lkInp && this.$refs.lkInp.focus()); }
    },

    /* --- промени и връщане --- */
    snap() { const s = this.st; s.hist.push(JSON.stringify({ blocks: s.blocks, title: s.title, aliases: s.aliases, tags: s.tags })); if (s.hist.length > 40) s.hist.shift(); },
    undo() { const s = this.st, h = s.hist.pop(); if (!h) return; const o = JSON.parse(h); Object.assign(s, { blocks: o.blocks, title: o.title, aliases: o.aliases, tags: o.tags }); this.ai.applied = false; this.bubble = null; toast(this.P.undone); },
    flashBlock(id) { this.flash = null; nextTick(() => { this.flash = id; clearTimeout(this.flashT); this.flashT = setTimeout(() => { this.flash = null; }, 1800); }); },
    setBlock(id, text) { const s = this.st, i = s.blocks.findIndex(b => b.id === id); if (i >= 0) s.blocks.splice(i, 1, { id, md: text }); this.flashBlock(id); },
    saveManual() {
      const m = this.man; if (m.md === m.before || !m.md.trim()) return;
      const d = sameLinks(m.before, m.md);
      if (d.length) { m.err = this.P.man.err(d.slice(0, 4).map(s => `[[${s}]]`).join(', ') + (d.length > 4 ? '…' : '')); return; }
      this.snap(); this.setBlock(m.bid, m.md.trim()); m.open = false; toast(this.P.man.saved); this.done('edit'); store.tour.edit = true;
    },
    applyDel() {
      const s = this.st, i = s.blocks.findIndex(b => b.id === this.del.bid); if (i < 0) return;
      this.snap(); s.blocks.splice(i, 1); this.del.open = false; toast(this.P.del.done); this.done('del'); store.tour.edit = true;
    },
    applyLink(slug) {
      const k = this.lk, blk = this.st.blocks.find(b => b.id === k.bid), E = this.t.exp.err, x = k.text;
      if (!blk) return;
      if (/[\n[\]*|]/.test(x)) { k.err = E.format; return; }
      const parts = blk.md.split(x);
      if (parts.length !== 2) { k.err = parts.length > 2 ? E.many : E.notfound; return; }
      if (parts[0].lastIndexOf('[[') > parts[0].lastIndexOf(']]')) { k.err = E.inlink; return; }
      this.snap(); this.setBlock(blk.id, parts[0] + (fold(x) === fold(BY[slug].title) ? `[[${slug}]]` : `[[${slug}|${x}]]`) + parts[1]);
      k.open = false; this.pulse = null; toast(this.P.lk.done); this.done('link');
      nextTick(() => { const el = this.$refs.body && this.$refs.body.querySelector(`[data-bid="${blk.id}"] [data-go="${slug}"]`); if (el) el.classList.add('new'); });
    },
    startRename() { this.renaming = true; this.titleDraft = this.st.title; if (this.pulse === 'rename') this.pulse = null; nextTick(() => { const i = this.$refs.titleInp; if (i) { i.focus(); i.select(); } }); },
    saveRename() {
      const v = this.titleDraft.replace(/\s+/g, ' ').trim(); this.renaming = false;
      if (!v || v === this.st.title) return;
      this.snap(); this.st.title = v; toast(this.P.renamed); this.done('rename'); store.tour.rename = true;
    },
    toggleFocus() { this.focus = !this.focus; if (this.focus) this.done('focus'); this.pulse = null; this.bubble = null; },

    /* --- помощникът --- */
    openAi(intent = 'ask', sel = null) {
      this.stopTimers(); this.bubble = null;
      this.ai = { ...freshAi(this.ai.level), open: true, intent, sel: sel ? sel.text : '', bid: sel ? sel.bid : null, q: intent === 'edit' ? this.P.ai.presetEdit : '' };
      if (intent === 'edit') this.pulse = this.tool === 'claude' ? 'propose' : null;
      else if (this.tool === 'outline' && !sel) this.pulse = 'outline';
      else if (this.tool === 'ask' && !sel) { this.ai.q = this.P.ai.presets[0]; this.pulse = 'askgo'; }
      else this.pulse = null;
    },
    closeAi() { this.stopTimers(); this.ai.open = false; this.ai.busy = false; if (['askgo', 'outline', 'propose', 'apply'].includes(this.pulse)) this.pulse = null; },
    think(kind, fn) {
      this.stopTimers(); const a = this.ai;
      Object.assign(a, { busy: true, kind, waited: 1, answer: '', prop: null, applied: false, saved: false }); this.pulse = null;
      this.tick = setInterval(() => { a.waited++; }, 1000);
      this.timer = setTimeout(() => { clearInterval(this.tick); a.busy = false; fn(); nextTick(() => { const b = this.$refs.aiBody; if (b) b.scrollTo({ top: b.scrollHeight, behavior: REDUCED ? 'auto' : 'smooth' }); }); }, REDUCED ? 300 : 1500 + 600 * a.level);
    },
    cancelAi() { this.stopTimers(); this.ai.busy = false; this.ai.kind = null; toast(this.P.ai.cancelled); },
    submit() { if (this.ai.intent === 'edit') this.propose(); else this.ask(); },
    simpleOf(b) { const P = this.P; return P.blocks[b.id] !== undefined && b.md === P.blocks[b.id] ? P.simple[b.id] : b.md; },
    ask() {
      if (this.ai.busy || this.ai.q.trim().length < 3) return;
      const q = fold(this.ai.q), pre = this.P.ai.presets.map(fold);
      let kind = 'source';
      if (this.ai.bid !== null) kind = 'sel';
      else if (q === pre[0] || /прост|разбира|simpl|easier/.test(q)) kind = 'simple';
      else if (q === pre[2] || /пример|example/.test(q)) kind = 'example';
      this.think(kind, () => {
        const P = this.P, s = this.st;
        if (kind === 'simple') this.ai.answer = s.blocks.map(b => this.simpleOf(b)).join('\n\n');
        else if (kind === 'sel') { const b = s.blocks.find(x => x.id === this.ai.bid); this.ai.answer = P.answers.selHead + (b ? this.simpleOf(b) : '') + '\n\n' + P.answers.selNote; }
        else this.ai.answer = P.answers[kind];
        this.done('ask'); store.tour.ask = true;
      });
    },
    outline() { if (this.ai.busy) return; this.think('outline', () => { this.ai.answer = this.P.outline; this.done('outline'); store.tour.ask = true; }); },
    propose() { if (this.ai.busy || this.ai.q.trim().length < 3) return; this.think('sel', () => { this.makeProp('replace'); }); },
    makeProp() {
      const P = this.P, a = this.ai, s = this.st, edits = [];
      const add = b => { if (isHead(b.md)) return; const after = this.simpleOf(b); if (after !== b.md) edits.push({ id: b.id, before: ptPlain(b.md), after: ptPlain(after), md: after }); };
      let append = null, summary = P.summary.simple;
      if (a.kind === 'sel') { const b = s.blocks.find(x => x.id === a.bid); if (b) add(b); }
      else if (a.kind === 'simple') s.blocks.forEach(add);
      else if (P.append[a.kind]) { append = P.append[a.kind]; summary = P.summary[a.kind]; }
      if (!edits.length && !append) summary = P.summary.none;
      a.prop = { edits, append, summary };
      if (this.tool) this.pulse = 'apply';
      nextTick(() => { const b = this.$refs.aiBody; if (b) b.scrollTo({ top: b.scrollHeight, behavior: REDUCED ? 'auto' : 'smooth' }); });
    },
    applyProp() {
      const p = this.ai.prop, s = this.st; if (!p) return;
      this.snap();
      p.edits.forEach(e => this.setBlock(e.id, e.md));
      if (p.append) { const id = Math.max(99, ...s.blocks.map(b => b.id)) + 1; s.blocks.push({ id, md: '## ' + p.append[0] }, { id: id + 1, md: p.append[1] }); this.flashBlock(id + 1); }
      this.P.meta.aliases.forEach(x => { if (!s.aliases.includes(x)) s.aliases.push(x); });
      this.P.meta.tags.forEach(x => { if (!s.tags.includes(x)) s.tags.push(x); });
      this.ai.prop = null; this.ai.applied = true; this.pulse = null; this.done('claude');
    },
    saveQ() { this.ai.saved = true; toast(this.P.ai.savedToast); },
    async copyAns() { try { await navigator.clipboard.writeText(this.ai.answer); toast(this.t.common.copied); } catch (_) { toast(this.t.common.copyFail); } },

    /* --- водене по инструментите --- */
    async demoTool(name) {
      this.tool = name; this.pulse = null; this.bubble = null; this.man.open = this.del.open = this.lk.open = false; this.renaming = false;
      if (!['ask', 'outline'].includes(name) && this.ai.open) this.closeAi();
      const show = async (el, block) => {
        const r = el.getBoundingClientRect(), bad = block === 'center' ? r.top < 110 || r.bottom > innerHeight - 30 : r.top < 60 || r.top > innerHeight * .45;
        if (bad) { el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block }); await sleep(REDUCED ? 0 : 550); }
      };
      if (!['edit', 'del', 'claude', 'link'].includes(name)) {
        await show(this.$refs.art, 'start');
        if (this.tool !== name) return;
        if (name === 'focus') { if (innerWidth < 640) this.toggleFocus(); else this.pulse = 'focus'; return; }
        if (name === 'rename') { this.pulse = 'rename'; return; }
        this.openAi('ask'); return;
      }
      const ids = this.st.blocks.filter(b => !isHead(b.md)).map(b => b.id);
      const fresh = ids.filter(id => this.st.blocks.find(b => b.id === id).md === this.P.blocks[id]);
      const pick = { edit: 2, del: 5, claude: fresh.includes(0) ? 0 : fresh[0], link: 1 }[name];
      const bid = ids.includes(pick) ? pick : ids[ids.length - 1];
      if (bid === undefined) return;
      const el = this.$refs.body && this.$refs.body.querySelector(`[data-bid="${bid}"]`);
      if (el) await show(el, 'center');
      if (this.tool !== name) return;
      if (this.selectText(bid, name === 'link' && bid === 1 ? this.P.linkWord : null)) this.pulse = name;
    },
  },
});

/* ===== Настройки: парола, архив, инсталация, обновления, тестове ===== */
const SET_ICO = {
  model: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  pwd: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  archive: '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>',
  backup: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M12 7v5l3 2"/>',
  setup: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  updates: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  tests: '<path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/><path d="M7 15h10"/>',
};
function archName() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `library-archive-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`; }
const SettingsDemo = defineComponent({
  template: '#tpl-settings',
  data() {
    return {
      store, TESTS, ICO: SET_ICO, tab: 'model', seen: { model: true }, pulseTests: false,
      mdl: { sel: 'claude', step: -1, busy: false, done: false, test: { busy: false, ok: false, s: '' } },
      pw: { set: '', next: '', cur: '', msg: '', bad: false }, login: { open: false, pw: '', msg: '', ok: false, fails: 0, wait: 0 },
      arc: { busy: false, done: false, step: -1, name: archName(), list: [] }, bk: { mode: '', busy: false, step: -1, done: false, stage: '', pc: 't' }, chk: { busy: false, at: 99 }, conn: { busy: false, ok: false, s: '' },
      ver: { busy: false, done: false }, pkg: { busy: false, done: false, act: '', restarting: false, updated: [], msg: '' }, run: { busy: false, done: false, n: 0 },
    };
  },
  computed: {
    S() { return this.t.set; },
    opt() { return this.S.model.opts.find(o => o.id === this.mdl.sel) || this.S.model.opts[0]; },
    loc() { return this.L === 'bg' ? 'bg-BG' : 'en-US'; },
    nPages() { return LIB.length; },
    mb() { return (1.6).toLocaleString(this.loc); },
    dateStr() { return new Date(TESTS.date + 'T12:00:00').toLocaleDateString(this.loc, { day: 'numeric', month: 'long', year: 'numeric' }); },
    groups() { return TESTS.groups.map(([id, bg, en]) => { const items = TESTS.tests.filter(x => x[0] === id); return { id, name: this.L === 'bg' ? bg : en, items, pass: items.filter(x => x[1] === 'pass').length, known: items.some(x => x[1] === 'known') }; }); },
    curTest() { const x = TESTS.tests[Math.max(0, Math.min(this.run.n, TESTS.tests.length) - 1)]; return x ? x[this.L === 'bg' ? 2 : 3] : ''; },
    /* Обновяване на пакети: както в приложението, бутонът е само за версиите, които package.json позволява */
    safeLeft() { return TESTS.outdated.filter(p => p.wanted !== p.current && !this.pkg.updated.includes(p.name)); },
    majorOnly() { return TESTS.outdated.filter(p => p.major && p.wanted === p.current); },
  },
  watch: { 'store.setTab'(v) { if (!v) return; this.setTab(v); this.pulseTests = v === 'tests'; store.setTab = null; } },
  beforeUnmount() { clearInterval(this.lockT); },
  methods: {
    toast,
    setTab(k) { this.tab = k; if (!this.seen[k]) this.seen = { ...this.seen, [k]: true }; },
    mark() { store.tour.settings = true; },
    /* Модел: избор на начин на работа, стъпките на обработката и опит за връзка (всичко е само в паметта на страницата) */
    pickModel(id) { this.mdl = { sel: id, step: -1, busy: false, done: false, test: { busy: false, ok: false, s: '' } }; },
    async runFlow() {
      const M = this.mdl, id = M.sel; if (M.busy) return; M.busy = true; M.done = false;
      for (let i = 0; i < this.opt.flow.length; i++) { if (this.mdl.sel !== id) return; M.step = i; await sleep(REDUCED ? 60 : 700); }
      M.step = 99; M.busy = false; M.done = true; this.mark();
    },
    async testModel() {
      const T = this.mdl.test; if (T.busy) return; T.ok = false;
      if (!this.opt.test) { T.ok = true; T.s = ''; this.mark(); return; }
      T.busy = true; await sleep(REDUCED ? 100 : 1200); T.busy = false; T.ok = true;
      T.s = ({ local: 2.3, gfree: 0.9, gpaid: 0.8, agent: 1.6 }[this.mdl.sel] || 1.4).toLocaleString(this.loc); this.mark();
    },
    msg(text, bad) { this.pw.msg = text; this.pw.bad = !!bad; },
    setPwd() { const v = this.pw.next; if (v.length < 8) { this.msg(this.S.pwd.short, true); return; } this.pw.set = v; this.pw.next = ''; this.msg(this.S.pwd.setDone); this.mark(); },
    removePwd() { if (this.pw.cur !== this.pw.set) { this.msg(this.S.pwd.wrongCur, true); return; } this.pw.set = ''; this.pw.cur = ''; this.msg(this.S.pwd.removed); },
    lockNow() { clearInterval(this.lockT); this.login = { open: true, pw: '', msg: '', ok: false, fails: 0, wait: 0 }; nextTick(() => this.$refs.loginInp && this.$refs.loginInp.focus()); },
    tryLogin() {
      const g = this.login, T = this.S.pwd.login;
      if (g.ok) return;
      if (g.wait) { g.msg = T.locked; g.pw = ''; return; }
      if (g.pw === this.pw.set) { g.ok = true; g.msg = T.ok; g.fails = 0; setTimeout(() => { this.login.open = false; }, 1500); return; }
      g.fails++; g.pw = '';
      if (g.fails >= 5) {
        g.fails = 0; g.msg = T.locked; g.wait = 60; clearInterval(this.lockT);
        this.lockT = setInterval(() => { if (--this.login.wait <= 0) { clearInterval(this.lockT); this.login.wait = 0; this.login.msg = ''; } }, 1000);
      } else g.msg = T.wrong;
    },
    closeLogin() { clearInterval(this.lockT); this.login.open = false; },
    async makeArchive() {
      const A = this.arc; if (A.busy) return; A.busy = true; A.done = false; A.name = archName();
      for (let i = 0; i < this.S.arc.steps.length; i++) { A.step = i; await sleep(REDUCED ? 60 : 650); }
      A.step = 99; A.busy = false; A.done = true; if (!A.list.includes(A.name)) A.list.unshift(A.name); this.mark();
    },
    delArchive(i) { this.arc.list.splice(i, 1); toast(this.S.arc.deleted); },
    /* Резервни копия: две копия в паметта на страницата. Резервното не пита; общата папка показва чужди промени и пита */
    async runBk(kind) {
      const B = this.bk; if (B.busy) return;
      Object.assign(B, { mode: kind, busy: true, done: false, stage: '', step: 0, pc: 't' });
      const n = kind === 'backup' ? this.S.bk.steps.length : 1;
      for (let i = 0; i < n; i++) { B.step = i; await sleep(REDUCED ? 60 : 650); }
      B.busy = false;
      if (kind === 'backup') { B.done = true; this.mark(); } else B.stage = 'notice';
    },
    endBk(stage) { this.bk.stage = stage; this.mark(); },
    async recheck() { if (this.chk.busy) return; this.chk.busy = true; for (let i = 0; i < this.S.setup.items.length; i++) { this.chk.at = i; await sleep(REDUCED ? 30 : 260); } this.chk.at = 99; this.chk.busy = false; this.mark(); },
    async testConn() { if (this.conn.busy) return; this.conn.busy = true; this.conn.ok = false; await sleep(REDUCED ? 100 : 1400); this.conn.busy = false; this.conn.ok = true; this.conn.s = (1.4).toLocaleString(this.loc); this.mark(); },
    async checkVer() { if (this.ver.busy) return; this.ver.busy = true; this.ver.done = false; await sleep(REDUCED ? 100 : 1100); this.ver.busy = false; this.ver.done = true; this.mark(); },
    async checkPkg() { if (this.pkg.busy) return; this.pkg.busy = true; this.pkg.done = false; await sleep(REDUCED ? 100 : 1800); this.pkg.busy = false; this.pkg.done = true; this.mark(); },
    async updatePkg(name) {
      const P = this.pkg; if (P.act || P.restarting) return;
      const list = this.safeLeft.filter(p => !name || p.name === name); if (!list.length) return;
      P.act = name || '*'; P.msg = '';
      await sleep(REDUCED ? 100 : 1500); // npm update --ignore-scripts
      P.act = ''; P.restarting = true;
      await sleep(REDUCED ? 100 : 1800); // библиотеката се пуска отново с новите версии
      P.restarting = false; P.updated = [...P.updated, ...list.map(p => p.name)];
      P.msg = this.S.upd.updated(list.map(p => `${p.name} ${p.current} → ${p.wanted}`).join(', ')); this.mark();
    },
    async runTests() {
      const R = this.run; if (R.busy) return; R.busy = true; R.done = false; R.n = 0; this.pulseTests = false;
      for (let i = 1; i <= TESTS.tests.length; i++) { R.n = i; await sleep(REDUCED ? 4 : 65); }
      R.busy = false; R.done = true; this.mark();
    },
    async copy(x) { try { await navigator.clipboard.writeText(x); toast(this.t.common.copied); } catch (_) { toast(this.t.common.copyFail); } },
  },
});

/* ===== Демо 4: учене ===== */
const TYPE_RANK = { topic: 0, concept: 1, comparison: 2, chapter: 3, source: 3, question: 4, entity: 5 };
const MINS = { topic: 3, concept: 4, comparison: 3, source: 6, chapter: 5, entity: 2, question: 2 };
function tokens(text) { const out = [], re = /\(\[\[[^\]]+\]\](?:,\s*(?:с\.|разд\.|p\.|sec\.)\s*\d+)?\)[.,;:]?|\[\[[^\]]+\]\][.,;:]?|\S+/g; let m; while ((m = re.exec(text))) out.push(m[0]); return out; }
const LearnDemo = defineComponent({
  template: '#tpl-learn',
  data() { return { q: '', level: 2, busy: false, steps: [], done: [], answer: '', answerShown: '', gen: 0 }; },
  computed: {
    presets() { return PRESETS[store.lang]; },
    doneN() { return this.done.filter(Boolean).length; },
    minutes() { return this.steps.reduce((a, s) => a + s.min, 0); },
  },
  watch: { L() { this.gen++; this.q = ''; this.steps = []; this.done = []; this.answer = ''; this.answerShown = ''; this.busy = false; } },
  methods: {
    typeColor, get: s => BY[s],
    open(s) { go(s, { scroll: true }); },
    onClick(e) { const a = e.target.closest('[data-go]'); if (a) { go(a.dataset.go, { scroll: true }); return; } const b = e.target.closest('[data-reader]'); if (b) openReader(b.dataset.reader, b.dataset.page); },
    localPath(q) {
      const ranked = rankPages(q, { stems: true }).slice(0, 9).map(r => r.p);
      if (!ranked.length) return this.t.learnUI.fallback.map(([slug, why, min]) => ({ slug, why, min }));
      return ranked.sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type]).slice(0, 6).map(p => ({ slug: p.slug, why: this.t.learnUI.why[p.type], min: MINS[p.type] }));
    },
    async ask(q) {
      q = (q || '').trim(); if (!q || this.busy) return;
      const tok = ++this.gen; this.busy = true; this.steps = []; this.answer = ''; this.answerShown = '';
      const pre = this.presets.find(p => p.q === q);
      await sleep(REDUCED ? 50 : this.level === 0 ? 450 : 1300); if (tok !== this.gen) return;
      const steps = pre ? pre.steps.map(([slug, why, min]) => ({ slug, why, min })) : this.localPath(q);
      this.steps = steps; this.done = steps.map(() => false); this.busy = false; store.tour.learn = true;
      if (this.level === 0) return;
      let a = pre ? pre.answer : this.t.learnUI.freeAnswer;
      if (pre && this.level === 3) a += ' ' + pre.plus;
      this.answer = a; const tk = tokens(a);
      for (let i = 1; i <= tk.length; i++) { if (tok !== this.gen) return; this.answerShown = inline(tk.slice(0, i).join(' '), null); await sleep(REDUCED ? 0 : 28); }
    },
  },
});

/* ===== Демо 5: писане ===== */
const ctWrap = s => s.replace(/\(([A-Z][^()]*?\d{4}[^()]*?)\)/g, '<span class="ct">($1)</span>');
const WriteDemo = defineComponent({
  template: '#tpl-write',
  data() { return { topic: 0, level: 2, busy: false, out: [], continued: false, gen: 0 }; },
  computed: {
    topics() { return TOPICS[store.lang]; },
    fileName() { return this.topics[this.topic].file; },
    docTitle() { return this.topics[this.topic].title; },
  },
  watch: { L() { this.gen++; this.out = []; this.busy = false; this.continued = false; } },
  methods: {
    localDoc(tp) {
      const W = this.t.writeUI, cite = slug => { const s = OUT[slug].map(x => PBY.bg[x].book || x).find(x => PBY.bg[x].type === 'source'); return s ? BY[s].short : 'LLM Wiki'; };
      return [{ h: W.localH1, ps: [W.localNote(tp.pages.length)] }, { h: W.localH2, ps: tp.pages.map(s => `${firstSentence(BY[s])} (${cite(s)})`) }];
    },
    async run() {
      if (this.busy) return; const tok = ++this.gen; this.busy = true; this.out = []; this.continued = false;
      const tp = this.topics[this.topic], blocks = this.level === 0 ? this.localDoc(tp) : tp.doc.map(([h, ps]) => ({ h, ps })), sp = REDUCED ? 0 : this.level === 0 ? 8 : 16;
      for (const b of blocks) {
        const cur = { h: b.h, ps: [] }; this.out.push(cur); await sleep(sp * 6);
        for (const p of b.ps) {
          const w = p.split(' '); cur.ps.push('');
          for (let i = 1; i <= w.length; i += 2) { if (tok !== this.gen) return; cur.ps[cur.ps.length - 1] = ctWrap(esc(w.slice(0, i).join(' '))); await sleep(sp); }
          cur.ps[cur.ps.length - 1] = ctWrap(esc(p));
        }
      }
      const bib = { h: this.t.writeUI.bibH, ps: [], bib: true }; this.out.push(bib);
      for (const k of tp.bib) { if (tok !== this.gen) return; bib.ps.push(REF[k]); await sleep(sp * 8); }
      this.busy = false; store.tour.write = true;
    },
    cont() {
      const tp = this.topics[this.topic], i = this.out.findIndex(b => b.h === this.t.writeUI.conclH);
      this.out.splice(i < 0 ? this.out.length - 1 : i, 0, { h: tp.more[0], ps: tp.more[1].map(p => ctWrap(esc(p))), added: true }); this.continued = true;
      toast(this.t.writeUI.toastCont);
    },
    uncont() { this.out = this.out.filter(b => !b.added); this.continued = false; },
    async copyText() {
      const strip = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      const txt = '# ' + this.docTitle + '\n\n' + this.out.map(b => '## ' + b.h + '\n\n' + b.ps.map(strip).join('\n\n')).join('\n\n');
      try { await navigator.clipboard.writeText(txt); toast(this.t.writeUI.toastCopy); } catch (_) { toast(this.t.common.copyFail); }
    },
    save() { toast(this.t.writeUI.toastSave(this.fileName)); },
  },
});

/* ===== Поверителност ===== */
const PrivacyFlow = defineComponent({
  template: '#tpl-privacy',
  data() { return { sel: 3, hit: 'ai', packet: null, ZONES, ACT_TO }; },
  methods: {
    zoneColor(k) { return ZONES.find(z => z.k === k).c; },
    center(k) { const el = [].concat(this.$refs['z' + k])[0], st = this.$refs.stage.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - st.left + r.width / 2 - 6, y: r.top - st.top + 34 }; },
    async pick(i) {
      this.sel = i; const to = ACT_TO[i]; this.hit = null;
      if (to === 'local' || REDUCED) { await sleep(60); this.hit = to; return; }
      const a = this.center('local'), b = this.center(to), c = this.zoneColor(to), id = Date.now();
      this.packet = { id, style: { left: a.x + 'px', top: a.y + 'px', '--c': c } };
      await nextTick(); await sleep(30);
      if (this.packet && this.packet.id === id) this.packet.style = { left: b.x + 'px', top: b.y + 'px', '--c': c, transition: 'left .9s cubic-bezier(.5,0,.2,1), top .9s cubic-bezier(.5,0,.2,1)' };
      await sleep(920); if (this.packet && this.packet.id === id) { this.packet = null; this.hit = to; }
    },
  },
});

/* ===== Терминал ===== */
const TerminalDemo = defineComponent({
  template: '#tpl-terminal',
  data() { return { sel: 0, typed: '', lines: [], phase: 2, auto: true, run: 0 }; },
  computed: { cmds() { return CMDS[store.lang]; } },
  watch: { L() { if (this.started) this.play(this.sel); } },
  mounted() { this.io = new IntersectionObserver(es => { if (es[0].isIntersecting && !this.started) { this.started = true; this.play(0); } }, { threshold: .4 }); this.io.observe(this.$el); },
  beforeUnmount() { this.run++; this.io.disconnect(); },
  methods: {
    pick(i) { this.auto = false; this.play(i); },
    async play(i) {
      const tok = ++this.run, c = this.cmds[i]; this.sel = i; this.typed = ''; this.lines = []; this.phase = 0;
      for (const ch of c.c) { this.typed += ch; await sleep(REDUCED ? 0 : 38); if (tok !== this.run) return; }
      this.phase = 1; await sleep(250);
      for (const l of c.lines) { await sleep(REDUCED ? 0 : 230); if (tok !== this.run) return; this.lines.push(l); }
      this.phase = 2;
      if (this.auto) { await sleep(2800); if (tok === this.run && this.auto) this.play((i + 1) % this.cmds.length); }
    },
  },
});

/* ===== Малки демота ===== */
const DupesDemo = defineComponent({
  template: '#tpl-dupes',
  data() { return { merged: false }; },
  methods: {
    pos(i) { return this.merged ? { top: '38px', left: '8%', opacity: i ? 0 : 1, transform: i ? 'scale(.85)' : 'scale(1.06)', borderColor: i ? '' : 'var(--sage)' } : { top: [0, 52, 104][i] + 'px', left: [0, 22, 8][i] + '%', opacity: 1, transform: `rotate(${[-2, 1.5, -1][i]}deg)` }; },
  },
});
const UndoDemo = defineComponent({ template: '#tpl-undo', data() { return { at: 4 }; } });

/* ===== Обиколка ===== */
const TourWidget = defineComponent({
  template: '#tpl-tour',
  data() { return { store, open: false, boom: false, keys: TOUR_KEYS }; },
  computed: { n() { return TOUR_KEYS.filter(k => store.tour[k[0]]).length; } },
  watch: {
    n(v, old) {
      try { localStorage.setItem('llmwiki-tour', JSON.stringify(store.tour)); } catch (_) {}
      if (v > old && v < TOUR_KEYS.length) { const m = this.t.tour.step(v, TOUR_KEYS.length); setTimeout(() => toast(m), store.toast ? 2200 : 0); }
      if (v === TOUR_KEYS.length && old < v) { this.open = true; this.confetti(); toast(this.t.tour.all); }
    },
  },
  methods: {
    go(it, e) { this.open = false; if (it[0] === 'search') { e.preventDefault(); store.search = true; } },
    async confetti() {
      if (REDUCED) return; this.boom = true; await nextTick(); const cv = this.$refs.cv; if (!cv) return;
      const ctx = cv.getContext('2d'), W = cv.width = innerWidth, H = cv.height = innerHeight, cs = ['#6fb39d', '#e7c47c', '#e09460', '#8fb0e6', '#c49ae0', '#e48a98'];
      const ps = Array.from({ length: 160 }, () => ({ x: W / 2 + (Math.random() - .5) * 200, y: H * .6, vx: (Math.random() - .5) * 16, vy: -8 - Math.random() * 12, s: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: cs[Math.floor(Math.random() * cs.length)] }));
      const t0 = performance.now();
      const f = x => { ctx.clearRect(0, 0, W, H); ps.forEach(p => { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }); if (x - t0 < 3500) requestAnimationFrame(f); else this.boom = false; };
      requestAnimationFrame(f);
    },
  },
});

/* ===== Приложението ===== */
const app = createApp({
  data() {
    return {
      store, MODELS, theme: document.documentElement.getAttribute('data-theme') || 'dark', scrolled: false, activeSec: '', menu: false, ba: 'before', baTouched: false, pipeOn: 0, persona: 0, doiText: '', doiState: 0,
      chaosItems: [{ c: 'var(--t-concept)', b: [70, 14, 6] }, { c: 'var(--t-source)', b: [22, 22, -8] }, { c: 'var(--t-concept)', b: [64, 82, 4] }, { c: 'var(--t-question)', b: [28, 66, -5] }, { c: 'var(--t-source)', b: [80, 50, 10] }, { c: 'var(--t-entity)', b: [44, 42, -12] }, { c: 'var(--t-topic)', b: [16, 88, 7] }],
      chaosLinks: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [1, 5], [2, 3], [4, 1]],
      pipe: [
        { k: 'raw', c: 'var(--t-source)', icon: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>' },
        { k: 'claude', c: 'var(--clay)', icon: '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>' },
        { k: 'wiki', c: 'var(--t-concept)', icon: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l7.5 0M7.5 8l3.5 8M16.5 9l-3.5 7"/>' },
        { k: 'lint', c: 'var(--gold)', icon: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>' },
        { k: 'run', c: 'var(--t-question)', icon: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>' }],
      refs: [REF.ahrens, REF.anth, REF.bush, REF.ebb, REF.goog, REF.kar, REF.luh],
    };
  },
  watch: { 'store.lang': { handler() { this.applyLang(); }, immediate: true } },
  mounted() {
    let ticking = false; const secs = ['why', 'how', 'demo', 'library', 'page', 'graph', 'learn', 'write', 'modes', 'compare', 'features', 'privacy', 'settings', 'terminal', 'who', 'start', 'faq'];
    const onScroll = () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => {
        ticking = false; const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
        if (this.$refs.prog) this.$refs.prog.style.transform = `scaleX(${h > 0 ? y / h : 0})`;
        const sc = y > 30; if (sc !== this.scrolled) this.scrolled = sc;
        let act = ''; for (const id of secs) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < innerHeight * .35) act = id; }
        if (act !== this.activeSec) this.activeSec = act;
      });
    };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.setAttribute('data-in', ''); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
    nextTick(() => {
      document.querySelectorAll('.reveal').forEach(el => io.observe(el));
      const seen = el => { if (el.hasAttribute('data-in')) return; if (el.getBoundingClientRect().top < innerHeight) el.setAttribute('data-in', ''); else io.observe(el); };
      new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.classList.contains('reveal')) seen(n); n.querySelectorAll('.reveal').forEach(seen); }))).observe(document.getElementById('app'), { childList: true, subtree: true });
    });
    const baIo = new IntersectionObserver(es => { if (es[0].isIntersecting) { baIo.disconnect(); setTimeout(() => { if (!this.baTouched && !REDUCED) this.ba = 'after'; }, 1400); } }, { threshold: .6 });
    nextTick(() => this.$refs.chaosCard && baIo.observe(this.$refs.chaosCard));
    addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '');
      if ((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 'k') { e.preventDefault(); store.search = !store.search; }
      else if (e.key === '/' && !typing && !store.search) { e.preventDefault(); store.search = true; }
      else if (e.key === 'Escape') { if (store.search) store.search = false; else if (store.reader) store.reader = null; else this.menu = false; }
    });
    const doi = 'https://doi.org/10.1000/182';
    const loopDoi = async () => { for (;;) { this.doiText = ''; this.doiState = 0; for (let i = 0; i <= doi.length; i += 2) { this.doiText = doi.slice(0, i); await sleep(110); } this.doiState = 1; await sleep(1300); this.doiState = 2; await sleep(2600); } };
    if (!REDUCED) setTimeout(loopDoi, 1200); else { this.doiText = doi; this.doiState = 2; }
  },
  methods: {
    applyLang() {
      const L = store.lang, d = I18N[L].meta; document.documentElement.lang = L; document.title = d.title;
      const m = document.querySelector('meta[name=description]'); if (m) m.content = d.desc;
      try { localStorage.setItem('llmwiki-lang', L); } catch (_) {}
      try { const u = new URL(location.href); if (u.searchParams.get('lang') !== L) { u.searchParams.set('lang', L); history.replaceState(null, '', u); } } catch (_) {}
    },
    switchLang() { store.lang = store.lang === 'bg' ? 'en' : 'bg'; this.menu = false; },
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', this.theme);
      try { localStorage.setItem('llmwiki-theme', this.theme); } catch (_) {}
      const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = this.theme === 'dark' ? '#0c0d0b' : '#f6f3ec';
    },
    openSearch() { store.search = true; },
    glow(e) { const el = e.currentTarget, r = el.getBoundingClientRect(); el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px'); },
    async copy(x) { try { await navigator.clipboard.writeText(x.replace(/\s+#.*$/gm, '')); toast(this.t.common.copied); } catch (_) { toast(this.t.common.copyFail); } },
    cls(c) { return { y: 'yes', n: 'no', p: 'part' }[c[0]]; },
    sym(c) { return { y: '✓', n: '✕', p: '◐' }[c[0]]; },
    chaosAfter(i) { if (!i) return [50, 50]; const a = (i - 1) / 6 * Math.PI * 2 - Math.PI / 2, n = innerWidth < 640; return [50 + (n ? 22 : 34) * Math.cos(a), 50 + (n ? 40 : 38) * Math.sin(a)]; },
    chaosStyle(f, i) {
      if (this.ba === 'after') { const [x, y] = this.chaosAfter(i); return { left: x + '%', top: y + '%', transform: `translate(-50%,-50%) scale(${i ? 1 : 1.12})`, borderColor: i ? 'var(--line)' : 'var(--sage)', fontWeight: i ? 500 : 700, zIndex: i ? 1 : 2 }; }
      return { left: f.b[0] + '%', top: f.b[1] + '%', transform: `translate(-50%,-50%) rotate(${f.b[2]}deg)`, opacity: .9 };
    },
    chaosPath(l) { const a = this.chaosAfter(l[0]), b = this.chaosAfter(l[1]); return `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`; },
  },
});
app.mixin({ computed: { t() { return I18N[store.lang]; }, L() { return store.lang; }, isMac() { return IS_MAC; } } });
app.component('hero-canvas', HeroCanvas);
app.component('hero-feed', HeroFeed);
app.component('count-up', CountUp);
app.component('kg-graph', KgGraph);
app.component('graph-section', GraphSection);
app.component('ingest-sim', IngestSim);
app.component('wiki-explorer', WikiExplorer);
app.component('page-tools', PageTools);
app.component('settings-demo', SettingsDemo);
app.component('reader-drawer', ReaderDrawer);
app.component('search-palette', SearchPalette);
app.component('learn-demo', LearnDemo);
app.component('write-demo', WriteDemo);
app.component('privacy-flow', PrivacyFlow);
app.component('terminal-demo', TerminalDemo);
app.component('dupes-demo', DupesDemo);
app.component('undo-demo', UndoDemo);
app.component('tour-widget', TourWidget);
app.mount('#app');
