/* Библиотека: интерфейс (Vue 3, без build стъпка). */
const { createApp, defineComponent, h } = Vue;
const I18N = window.I18N; // език и преводи: виж /locale.js и i18n.js

// ---------- Речници ----------
const TYPES = {
  chapter:    { label: $t('Chapter'),     plural: $t('Chapters'),     icon: 'bookmark', hex: '#dba27c', soft: 'bg-clay-100/70 text-clay-500 dark:bg-clay-500/10 dark:text-clay-400', desc: $t('The chapters of books: the step between the book and the text itself.') },
  source:     { label: $t('Source'),  plural: $t('Sources'), icon: 'book',    hex: '#c2703d', soft: 'bg-clay-100 text-clay-500 dark:bg-clay-500/15 dark:text-clay-400', desc: $t('Books, articles and tables that Claude has read and summarized.') },
  concept:    { label: $t('Concept'),   plural: $t('Concepts'),   icon: 'bulb',    hex: '#3f8571', soft: 'bg-sage-50 text-sage-600 dark:bg-sage-900/50 dark:text-sage-200', desc: $t('Ideas, theories and methods gathered from all sources.') },
  entity:     { label: $t('Person'),   plural: $t('People'),  icon: 'user',    hex: '#7c6bb8', soft: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300', desc: $t('Authors, schools, organizations and tools.') },
  topic:      { label: $t('Topic'),      plural: $t('Topics'),      icon: 'compass', hex: '#3b82a6', soft: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', desc: $t('Hubs that gather concepts and sources around one field.') },
  comparison: { label: $t('Comparison'), plural: $t('Comparisons'), icon: 'scale',   hex: '#c0507a', soft: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300', desc: $t('Approaches and authors set side by side.') },
  question:   { label: $t('Question'),    plural: $t('Questions'),   icon: 'help',    hex: '#8a8a3a', soft: 'bg-lime-50 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300', desc: $t('Saved answers to questions you asked the library.') },
  other:      { label: $t('Page'),  plural: $t('Other'),     icon: 'file',    hex: '#9d958a', soft: 'bg-ink/5 text-muted dark:bg-white/10', desc: '' },
};
const typeOrder = ['source', 'concept', 'entity', 'topic', 'comparison', 'question'];
const KINDS = { person: $t('Person'), organization: $t('Organization'), tool: $t('Tool'), work: $t('Work'), place: $t('Place'), school: $t('School') };
const FORMATS = { book: $t('Book'), paper: $t('Scientific paper'), article: $t('Article'), web: $t('Web'), dataset: $t('Table'), note: $t('Note'), image: $t('Image') };
const FORMAT_ICON = { book: 'book', paper: 'paper', article: 'file', web: 'globe', dataset: 'table', note: 'pen', image: 'image' };
const FORMAT_BG = { book: 'bg-gradient-to-br from-clay-400 to-clay-500', paper: 'bg-gradient-to-br from-sage-400 to-sage-600', article: 'bg-gradient-to-br from-sky-400 to-sky-600', web: 'bg-gradient-to-br from-violet-400 to-violet-600', dataset: 'bg-gradient-to-br from-emerald-400 to-emerald-600', note: 'bg-gradient-to-br from-amber-300 to-amber-500', image: 'bg-gradient-to-br from-rose-300 to-rose-500' };
const STATUS = { read: $t('Read in full'), skimmed: $t('Skimmed'), 'to-read': $t('To read') };
const CONF = {
  high:   { label: $t('high'), cls: 'bg-sage-50 text-sage-700 dark:bg-sage-900/50 dark:text-sage-200', dot: 'bg-sage-500', hint: $t('Several sources say the same thing, with no contradictions.') },
  medium: { label: $t('medium'), cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', dot: 'bg-amber-400', hint: $t('One good source or several with small differences.') },
  low:    { label: $t('low'),  cls: 'bg-clay-100 text-clay-500 dark:bg-clay-500/15 dark:text-clay-400', dot: 'bg-clay-400', hint: $t('There are almost no sources, there are contradictions or the page is incomplete. A good candidate for more reading.') },
};
const MODES = [
  { id: 'economy', label: $t('Economy'), hint: $t('Haiku reads the chapters, Sonnet writes the pages. Uses the least of your limit; for large numbers of books.') },
  { id: 'balanced', label: $t('Balanced'), hint: $t('Sonnet reads and writes. A finer reading, moderate cost.') },
  { id: 'best', label: $t('Best'), hint: $t('Opus reads and writes. The most thorough, but uses up the limit fastest.') },
];
const MODEL_OPTS = [
  { id: 'haiku', label: $t('Haiku (cheapest)') },
  { id: 'sonnet', label: $t('Sonnet (balanced)') },
  { id: 'opus', label: $t('Opus (most powerful)') },
];
const FOLDERS = { books: $t('book'), papers: $t('paper'), articles: $t('text'), web: $t('web'), data: $t('table'), notes: $t('note'), images: $t('picture'), other: $t('other') };

// ---------- Помощни ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function relDate(d) {
  if (!d) return '';
  const day = new Date(String(d).slice(0, 10) + 'T00:00:00');
  if (isNaN(day)) return String(d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((now - day) / 864e5);
  if (diff <= 0) return $t('today');
  if (diff === 1) return $t('yesterday');
  if (diff < 7) return $t('{0} days ago', [diff]);
  if (diff < 31) return $t('{0} {1} ago', [Math.round(diff / 7), Math.round(diff / 7) === 1 ? $t('week') : $t('weeks')]);
  return day.toLocaleDateString(I18N.lang, { day: 'numeric', month: 'long', year: diff > 300 ? 'numeric' : undefined });
}
const size = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const plural = (n, one, many) => (n === 1 ? one : many);
function fileIcon(name) {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (['pdf'].includes(e)) return 'paper';
  if (['epub', 'mobi', 'azw3', 'djvu', 'fb2'].includes(e)) return 'book';
  if (['xlsx', 'xls', 'csv', 'tsv', 'ods', 'json'].includes(e)) return 'table';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(e)) return 'image';
  if (['html', 'htm'].includes(e)) return 'globe';
  if (['md', 'txt'].includes(e)) return 'pen';
  return 'file';
}
// crypto.randomUUID и navigator.clipboard работят само в „сигурен контекст“ (https или localhost).
// На http://my.wiki браузърът не го счита за такъв, затова са нужни резервни варианти.
const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove(); return ok;
}
const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'x-library': '1', ...(opts.headers || {}) } });
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// Четецът: на живо – всички източници и глави; в архива – само текстовете, които са записани в него (LIB_STATIC.readerOf)
const readerOk = (type, slug) => ['source', 'chapter'].includes(type) && (!window.LIB_STATIC || Object.prototype.hasOwnProperty.call(window.LIB_STATIC.readerOf || {}, slug));

// Общи помощници, достъпни във всички шаблони
// ro: архивът за четене (виж archive.js). Там няма записи, Claude и пътища към raw/.
const shared = { MODEL_OPTS, MODES, TYPES, typeOrder, KINDS, FORMATS, FORMAT_ICON, FORMAT_BG, STATUS, CONF, relDate, size, plural, fileIcon, ro: !!window.LIB_STATIC };

// ---------- Иконки (линейни, 24×24) ----------
const ICONS = {
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  library:'M4 5v14M8 5v14M12 6l4 13M17 5l3 1-1 13',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  home: 'M4 11l8-7 8 7M6 10v9h12v-9',
  graph: 'M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7.5 6.2l8.7 1.3M6.6 6.9l2 10.2M17.2 8.6l-6.9 9.2',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5',
  paper: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  table: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
  pen: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 2-2 5 5M15 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  spinner: 'M12 3a9 9 0 1 0 9 9',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M5 12.5l4.5 4.5L19 7',
  chevron: 'M9 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  menu: 'M4 7h16M4 12h16M4 17h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  ghost: 'M5 21V10a7 7 0 0 1 14 0v11l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2zM10 10h.01M14 10h.01',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  stop: 'M7 7h10v10H7z',
  play: 'M8 5l11 7-11 7z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  x: 'M6 6l12 12M18 6L6 18',
  terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  route: 'M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 18h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
};
const Ic = defineComponent({
  props: { name: String },
  setup: (props) => () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    [h('path', { d: ICONS[props.name] || ICONS.file })]),
});

// ---------- Markdown с [[wikilinks]] ----------
// Номерата на страници („с. 53“) стават връзки към четеца: след [[източник]] сочат към него,
// а самостоятелните сочат към източника на текущата страница (ако има такъв).
const PAGE_RE = '(' + (I18N.pageUnits || 'с\\.|стр\\.|разд\\.|pp?\\.|sect\\.') + ')\\s*(\\d+)(?:\\s*[-–]\\s*\\d+)?';
function renderMarkdown(content, known, titles, opts = {}) {
  let body = content.replace(/^\s*#\s+.*\n/, ''); // заглавието се показва отгоре
  if (opts.stripSection) body = body.replace(new RegExp(`^##\\s+${opts.stripSection}\\s*\\n[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`, 'm'), '');
  const wl = (target, alias) => {
    const slug = target.trim().split('/').pop();
    const ok = known.has(slug);
    const label = alias || titles.get(slug) || slug;
    return { slug, html: `<a class="wl${ok ? '' : ' missing'}" data-slug="${esc(slug)}" href="#/p/${encodeURIComponent(slug)}"${ok ? '' : ` title="${esc($t('This page does not exist yet'))}"`}>${esc(label)}</a>` };
  };
  const pg = (src, num, text) => `<a class="pg" data-src="${esc(src)}" data-page="${num}" title="${esc($t('Open in the reader'))}">${esc(text)}</a>`;
  // 1) [[източник]], с. N
  body = body.replace(new RegExp(`\\[\\[([^\\]|#]+)(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\](,\\s*)${PAGE_RE}`, 'g'), (m, t, a, sep, unit, num) => {
    const w = wl(t, a);
    const readable = opts.readable ? opts.readable(w.slug) : known.has(w.slug);
    return w.html + sep + (readable ? pg(w.slug, num, m.slice(m.indexOf(sep) + sep.length)) : m.slice(m.indexOf(sep) + sep.length));
  });
  // 2) останалите [[връзки]]
  body = body.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t, a) => wl(t, a).html);
  // 3) самостоятелно „с. N“ на страница с източник
  if (opts.readerSrc) body = body.replace(new RegExp(`(?<![>\\w])${PAGE_RE}`, 'g'), (m, unit, num) => pg(opts.readerSrc, num, m));
  return sanitizeHtml(marked.parse(body, { gfm: true }));
}

// ---------- Пречистване на HTML ----------
// Текстът идва от документи и от Claude, затова не му се вярва: остават само безопасни елементи, атрибути и адреси.
// Разбира се от инертен документ (нищо в него не се изпълнява и не се зарежда). Втората защита е Content-Security-Policy.
const SAFE_TAGS = new Set('A ABBR B BLOCKQUOTE BR CAPTION CITE CODE DD DEL DETAILS DFN DIV DL DT EM FIGCAPTION FIGURE H1 H2 H3 H4 H5 H6 HR I IMG INPUT INS KBD LI MARK OL P PRE Q S SAMP SMALL SPAN STRONG SUB SUMMARY SUP TABLE TBODY TD TFOOT TH THEAD TR U UL VAR'.split(' '));
const DROP_WITH_CONTENT = new Set('SCRIPT STYLE IFRAME FRAME FRAMESET OBJECT EMBED APPLET NOSCRIPT NOEMBED NOFRAMES TEMPLATE SVG MATH TITLE TEXTAREA XMP PLAINTEXT LISTING LINK META BASE FORM SELECT BUTTON AUDIO VIDEO SOURCE TRACK CANVAS MARQUEE'.split(' '));
const SAFE_ATTRS = {
  A: ['href', 'title', 'class', 'data-slug', 'data-src', 'data-page'], IMG: ['src', 'alt', 'title'], CODE: ['class'],
  TD: ['align', 'colspan', 'rowspan'], TH: ['align', 'colspan', 'rowspan', 'scope'], OL: ['start'], DETAILS: ['open'],
  INPUT: ['type', 'checked', 'disabled'], ABBR: ['title'], DFN: ['title'],
};
const SAFE_CLASS = /^(wl|pg|missing|language-[\w-]+)$/; // чужд клас може да покрие екрана с подвеждащ елемент

function safeUrl(value, isImage) {
  // Браузърът пренебрегва контролни и невидими знаци в адреса, затова и проверката не бива да ги вижда.
  const v = [...String(value)].filter((c) => { const n = c.codePointAt(0); return n > 32 && !(n >= 127 && n <= 160) && !(n >= 8203 && n <= 8207) && n !== 8232 && n !== 8233 && n !== 65279; }).join('');
  const scheme = v.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) return !v.startsWith('\\');
  if (isImage) return scheme === 'https' || scheme === 'http' || /^data:image\/(png|jpe?g|gif|webp);/i.test(v);
  return scheme === 'https' || scheme === 'http' || scheme === 'mailto';
}

function cleanNode(parent) {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === 3) continue; // текст
    if (node.nodeType !== 1) { node.remove(); continue; } // коментари и всичко останало
    const tag = node.tagName.toUpperCase();
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || DROP_WITH_CONTENT.has(tag)) { node.remove(); continue; }
    cleanNode(node);
    if (!SAFE_TAGS.has(tag)) { node.replaceWith(...node.childNodes); continue; }
    const allowed = SAFE_ATTRS[tag] || [];
    for (const { name, value } of [...node.attributes]) {
      const n = name.toLowerCase();
      if (!allowed.includes(n) || ((n === 'href' || n === 'src') && !safeUrl(value, n === 'src'))) node.removeAttribute(name);
      else if (n === 'class') {
        const keep = value.split(/\s+/).filter((c) => SAFE_CLASS.test(c)).join(' ');
        if (keep) node.setAttribute('class', keep); else node.removeAttribute('class');
      }
    }
    if (tag === 'INPUT') { // остават само отметките от Markdown списъци
      if (String(node.getAttribute('type')).toLowerCase() !== 'checkbox') { node.remove(); continue; }
      node.setAttribute('disabled', '');
    }
  }
}

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  cleanNode(doc.body);
  return doc.body.innerHTML;
}

// ---------- Компоненти ----------
const ViewToggle = defineComponent({
  template: '#tpl-viewtoggle',
  props: { modelValue: String },
  emits: ['update:modelValue'],
});

const PageCard = defineComponent({
  template: '#tpl-card',
  props: { p: Object, big: Boolean },
  computed: { T() { return TYPES[this.p.type] || TYPES.other; } },
  methods: { relDate },
  data: () => ({ FORMATS, FORMAT_ICON, KINDS }),
});

const HomeView = defineComponent({
  template: '#tpl-home',
  props: { stats: Object, pages: Array, agent: Object },
  emits: ['refresh', 'toast'],
  data: () => ({ ...shared, drag: false, uploads: [], sorting: false, sortLog: '', uploading: false, showHistory: false }),
  computed: {
    greeting() {
      const hr = new Date().getHours();
      return hr < 5 ? $t('Good night') : hr < 11 ? $t('Good morning') : hr < 18 ? $t('Good afternoon') : $t('Good evening');
    },
    today() { return new Date().toLocaleDateString(I18N.lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); },
    steps() {
      return [
        { title: $t('Upload'), text: $t('Drop files in the field below or into raw/inbox/.') },
        { title: $t('Sort'), text: $t('Files go into folders and their text is extracted.') },
        { title: $t('Process'), text: $t('Claude Code reads them and writes the pages.') },
        { title: $t('Explore'), text: $t('Search, follow links, ask the library.') },
      ];
    },
    lastJob() { return this.agent?.history?.[0] || null; },
    // изборът на модели: явният, иначе този от режима
    writerNow() { const st = this.agent?.settings || {}; return st.writer || ({ economy: 'sonnet', balanced: 'sonnet', best: 'opus' }[st.mode] || 'sonnet'); },
    readerNow() { const st = this.agent?.settings || {}; return st.reader || (st.mode === 'economy' ? 'haiku' : this.writerNow); },
    jobsOf() { const a = this.agent; return (k) => !!a && (a.current?.kind === k || a.queue?.some((q) => q.kind === k)); },
    upgrading() { return this.jobsOf('upgrade'); },
    synthQueued() { return this.jobsOf('synthesis'); },
    canSynthesize() { return (this.stats.depth?.total || 0) >= 2; },
    newInbox() { return (this.stats.inbox || []).filter((f) => !f.duplicateOf); },
    dupes() { return (this.stats.inbox || []).length - this.newInbox.length; },
    step() {
      const s = this.stats;
      if (this.agent?.current) return 2;
      if (this.newInbox.length) return 1;
      if (s.pending?.length) return 2;
      if (s.pages) return 3;
      return 0;
    },
    commands() {
      if (this.stats.pending?.length) return [{ cmd: '/wiki-ingest', text: $t('process everything pending') }, { cmd: $t('Process everything without questions'), text: $t('without stopping to discuss') }];
      if (!this.stats.pages) return [{ cmd: '/wiki-inbox', text: $t('if you put files directly into raw/inbox/') }];
      return [{ cmd: '/wiki-query ', text: $t('ask the library') }, { cmd: '/wiki-lint', text: $t('check for contradictions and gaps') }];
    },
    inboxOnly() {
      const up = new Set(this.uploads.map((u) => u.savedAs));
      return (this.stats.inbox || []).filter((f) => !up.has(f.name));
    },
  },
  methods: {
    count: (n, one, many) => `${n || 0} ${(n || 0) === 1 ? one : many}`,
    folderLabel: (f) => FOLDERS[f] || f,
    logLabel: (k) => ({ ingest: $t('processing'), query: $t('question'), lint: $t('check'), refactor: $t('restructuring'), inbox: $t('inbox') }[k] || k),
    logColor: (k) => ({ ingest: 'bg-clay-400', query: 'bg-lime-500', lint: 'bg-sky-500', refactor: 'bg-violet-400', inbox: 'bg-sage-400' }[k] || 'bg-muted'),
    copy(t) { this.$root.copy(t); },
    isRecent: (j) => Date.now() - new Date(j.finishedAt).getTime() < 36 * 3600e3,
    async post(url, body) {
      const r = await api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
      return r.json();
    },
    async start() {
      if (!(await this.$root.confirmClaude({ kind: 'ingest' }))) return;
      const r = await this.post('/api/agent/ingest');
      this.$emit('toast', r.queued ? { text: $t('Claude started: {0} {1} in the queue', [r.queued, plural(r.queued, $t('file'), $t('files'))]) } : { text: $t('They are already in the queue'), icon: 'alert' });
    },
    async stop() { await this.post('/api/agent/cancel'); },
    async resume() { await this.post('/api/agent/resume'); },
    async undo(id) {
      if (!confirm($t('Restore the wiki to how it was before this processing? The file will show up as unprocessed again.'))) return;
      const r = await this.post('/api/agent/undo', { id });
      this.$emit('toast', r.ok ? { text: $t('Restored. The file is waiting to be processed again.'), icon: 'undo' } : { text: r.error, icon: 'alert' });
      this.$emit('refresh');
    },
    async setSetting(k, v) { await this.post('/api/agent/settings', { [k]: v }); },
    // файл, който не искаш: мести се в raw/.trash/ (не се губи безвъзвратно)
    async discard(body, name) {
      if (!confirm($t('Remove “{0}”?\n\nThe file is moved to raw/.trash/ and is not processed. You can bring it back from there by hand.', [name]))) return;
      const r = await this.post('/api/raw/discard', body);
      this.$emit('toast', r.ok ? { text: $t('The file has been removed.') } : { text: r.error || $t('I could not'), icon: 'alert' });
      this.$emit('refresh');
    },
    // готов режим сменя и двата избора на модел
    async pickMode(id) { await this.post('/api/agent/settings', { mode: id, reader: '', writer: '' }); },
    clock: (iso) => new Date(iso).toLocaleTimeString(I18N.lang, { hour: '2-digit', minute: '2-digit' }),
    async upgradeAll() {
      if (!(await this.$root.confirmClaude({ kind: 'upgrade' }))) return;
      const r = await this.post('/api/agent/upgrade');
      this.$emit('toast', r.queued ? { text: $t('{0} {1} in the upgrade queue', [r.queued, plural(r.queued, $t('source is'), $t('sources are'))]) } : { text: $t('They are already in the queue'), icon: 'alert' });
    },
    async synthesize() {
      if (!(await this.$root.confirmClaude({ kind: 'synthesis' }))) return;
      const r = await this.post('/api/agent/synthesis');
      this.$emit('toast', r.queued ? { text: $t('The synthesis is in the queue') } : { text: $t('Already in the queue'), icon: 'alert' });
    },
    onDrop(e) { this.drag = false; this.upload([...e.dataTransfer.files]); },
    onPick(e) { this.upload([...e.target.files]); e.target.value = ''; },
    async upload(files) {
      if (!files.length) return;
      this.uploading = true;
      const jobs = files.map((f) => {
        const u = Vue.reactive({ id: uid(), name: f.name, size: f.size, progress: 0, error: false, savedAs: null });
        this.uploads.unshift(u);
        return new Promise((resolve) => {
          const x = new XMLHttpRequest();
          x.open('PUT', '/api/upload');
          x.setRequestHeader('x-filename', encodeURIComponent(f.name));
          x.setRequestHeader('x-library', '1');
          x.upload.onprogress = (ev) => { if (ev.lengthComputable) u.progress = Math.round((ev.loaded / ev.total) * 100); };
          x.onload = () => {
            if (x.status === 200) { u.progress = 100; try { u.savedAs = JSON.parse(x.responseText).name; } catch {} }
            else u.error = true;
            resolve();
          };
          x.onerror = () => { u.error = true; resolve(); };
          x.send(f);
        });
      });
      await Promise.all(jobs);
      this.uploading = false;
      const ok = files.length - this.uploads.filter((u) => u.error).length;
      this.$emit('toast', { text: $t('{0} {1} to the inbox', [ok, plural(ok, $t('file was uploaded'), $t('files were uploaded'))]) });
      this.$emit('refresh');
    },
    async sortInbox() {
      this.sorting = true;
      try {
        const r = await (await api('/api/inbox', { method: 'POST' })).json();
        this.sortLog = r.log || r.error || '';
        this.uploads = [];
        if (r.needsConfirm) { this.$emit('refresh'); this.start(); }
        this.$emit('toast', !r.ok ? { text: $t('Something went wrong, see “What happened”.'), icon: 'alert' }
          : r.queued ? { text: $t('Sorted. Claude started processing ({0}).', [r.queued]) } : { text: $t('Sorted.') });
      } catch {
        this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' });
      } finally {
        this.sorting = false;
        this.$emit('refresh');
      }
    },
  },
});

const PageView = defineComponent({
  template: '#tpl-page',
  props: { slug: String, pages: Array, version: Number, focus: Boolean },
  emits: ['toast', 'refresh', 'focus'],
  data: () => ({
    ...shared, LEVELS, rename: { on: false, value: '', busy: false }, man: { open: false, md: '', before: '', hash: '', busy: false, error: '' }, page: null, error: false, toc: [], activeH: null, observer: null, chapView: store.get('view:chapters', 'cards'),
    selBtn: null, lk: { open: false, sel: '', q: '', busy: false, error: '' },
    ai: { open: false, intent: 'ask', sel: '', question: '', level: store.get('asklevel', 'medium'), busy: false, busy2: false, waited: 0, error: '', answer: '', asked: '', proposal: null, saved: false, applied: null },
  }),
  computed: {
    T() { return TYPES[this.page?.type] || TYPES.other; },
    html() {
      if (!this.page) return '';
      const types = new Map(this.pages.map((p) => [p.slug, p.type]));
      return renderMarkdown(this.page.content, new Set(this.pages.map((p) => p.slug)), new Map(this.pages.map((p) => [p.slug, p.title])), {
        readerSrc: ['source', 'chapter'].includes(this.page.type) ? this.page.readerSrc : null,
        readable: (slug) => readerOk(types.get(slug), slug),
        stripSection: this.page.chapters?.length ? $t('Chapters') : null,
      });
    },
    firstPage() { return Number(String(this.page?.pages || '').split(/[-–]/)[0]) || undefined; },
    canAsk() { return !!this.page && !['index', 'log', 'overview'].includes(this.page.slug) && !this.ro; },
    // Режимът фокус важи за всички страници от колекциите (и в архива)
    canFocus() { return !!this.page && !['index', 'log', 'overview'].includes(this.page.slug); },
    // страниците, към които може да се сочи от избрания текст: без служебните и без текущата
    linkCandidates() {
      const q = this.lk.q.trim().toLowerCase();
      return this.pages
        .filter((p) => !p.special && p.slug !== this.page?.slug)
        .filter((p) => !q || [p.title, p.slug, ...(p.aliases || [])].some((s) => String(s).toLowerCase().includes(q)))
        .sort(titleCmp);
    },
    aiHtml() {
      if (!this.ai.answer) return '';
      const types = new Map(this.pages.map((p) => [p.slug, p.type]));
      return renderMarkdown(this.ai.answer, new Set(this.pages.map((p) => p.slug)), new Map(this.pages.map((p) => [p.slug, p.title])), {
        readerSrc: ['source', 'chapter'].includes(this.page?.type) ? this.page.readerSrc : null,
        readable: (slug) => readerOk(types.get(slug), slug),
      });
    },
    // „Сочат насам“: главите се групират под книгата си
    bookGroups() {
      const g = new Map();
      for (const b of this.page?.backlinks || []) {
        if (b.type !== 'chapter' || !b.book) continue;
        if (!g.has(b.book)) g.set(b.book, { book: b.book, title: b.bookTitle || b.book, items: [] });
        g.get(b.book).items.push(b);
      }
      for (const x of g.values()) x.items.sort((a, b) => (a.chapter || 0) - (b.chapter || 0));
      return [...g.values()];
    },
    otherBacklinks() {
      const books = new Set(this.bookGroups.map((g) => g.book));
      return (this.page?.backlinks || []).filter((b) => !(b.type === 'chapter' && b.book) && !books.has(b.slug));
    },
    queuedHere() {
      const a = this.$root.agent, slug = this.page?.slug;
      return !!a && (a.current?.target === slug || a.queue?.some((q) => q.target === slug));
    },
    queuedChapters() {
      const a = this.$root.agent;
      return !!a && (a.current?.target === this.page?.slug || a.queue?.some((q) => q.target === this.page?.slug));
    },
    authors() {
      const a = this.page?.authors;
      return Array.isArray(a) ? a.join(', ') : a || '';
    },
  },
  watch: {
    chapView(v) { store.set('view:chapters', v); },
    slug: { immediate: true, handler(s, old) { if (old !== undefined && s !== old) { this.resetAi(); this.rename.on = false; this.man.open = false; this.lk.open = false; } this.load(s !== old); } },
    version() { this.load(false); },
    html() { this.$nextTick(this.buildToc); },
  },
  methods: {
    inline: (s) => sanitizeHtml(marked.parseInline(String(s))),
    async load(scrollTop = true) {
      const r = await fetch('/api/page/' + encodeURIComponent(this.slug));
      if (!r.ok) { this.error = true; this.page = null; document.title = $t('Missing · Library'); return; }
      this.error = false;
      this.page = await r.json();
      document.title = $t('{0} · Library', [this.page.title]);
      if (scrollTop) window.scrollTo({ top: 0 });
    },
    buildToc() {
      const root = this.$refs.body;
      if (!root) return;
      const used = new Set();
      this.toc = [...root.querySelectorAll('h2, h3')].map((el) => {
        let id = 'h-' + el.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
        while (used.has(id)) id += '-';
        used.add(id); el.id = id;
        return { id, text: el.textContent.trim(), level: Number(el.tagName[1]) };
      });
      this.observer?.disconnect();
      this.observer = new IntersectionObserver((entries) => {
        const vis = entries.filter((e) => e.isIntersecting);
        if (vis.length) this.activeH = vis[0].target.id;
      }, { rootMargin: '0px 0px -70% 0px' });
      root.querySelectorAll('h2, h3').forEach((el) => this.observer.observe(el));
    },
    scrollTo(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    onClick(e) {
      const pg = e.target.closest('a.pg');
      if (pg) { e.preventDefault(); this.$root.openReader(pg.dataset.src, Number(pg.dataset.page)); return; }
      const a = e.target.closest('a.wl');
      if (a) { e.preventDefault(); location.hash = '#/p/' + a.dataset.slug; }
    },
    async upgradeThis() {
      if (!(await this.$root.confirmClaude({ kind: 'upgrade', slugs: [this.page.slug] }))) return;
      const r = await (await api('/api/agent/upgrade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slugs: [this.page.slug] }) })).json();
      this.$emit('toast', r.queued ? { text: $t('Added for upgrade. Progress is on the home page.') } : { text: $t('Already in the queue'), icon: 'alert' });
    },
    async rebuildIndex() {
      if (!confirm($t('Rebuild the index, log and overview from all pages? Existing descriptions, entries and your text in the overview are kept, and old versions are copied to outputs/. It does not use your limit.'))) return;
      const r = await (await api('/api/index/rebuild', { method: 'POST' })).json();
      this.$emit('toast', r.ok ? { text: $t('Done: index ({0} pages), log (+{1} entries) and overview.', [r.count, r.restoredLog]) } : { text: r.error || $t('I could not'), icon: 'alert' });
    },
    async removeThis() {
      const pr = await (await api('/api/remove/preview?slug=' + encodeURIComponent(this.page.slug))).json();
      if (!pr.ok) { this.$emit('toast', { text: pr.error, icon: 'alert' }); return; }
      const msg = $t('Remove “{0}”?\n\n', [pr.title])
        + $t('• Source pages that are removed: {0}\n', [pr.pages.length])
        + $t('• Pages with citations that are cleaned: {0}\n', [pr.touched.length])
        + (pr.orphaned.length ? $t('• Left without a source (for review): {0}\n', [pr.orphaned.length]) : '')
        + (pr.hasNotes ? $t('• Your notes are kept in the archive\n') : '')
        + $t('\nThe pages are archived in outputs/removed/, and the “Undo” button on the home page brings everything back.');
      if (!confirm(msg)) return;
      const r = await (await api('/api/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: this.page.slug }) })).json();
      this.$emit('toast', r.ok ? { text: $t('The source has been removed. “Undo” is on the home page.') } : { text: r.error || $t('I could not remove it'), icon: 'alert' });
      if (r.ok) location.hash = '#/';
    },
    levelLabel(id) { return LEVELS.find((l) => l.id === id)?.label || id; },
    // --- Ръчно преименуване и редакция (без Claude; връзките между страниците не се променят) ---
    startRename() {
      if (!this.canAsk) return;
      window.getSelection()?.removeAllRanges(); this.selBtn = null;
      this.rename = { on: true, value: this.page.title, busy: false };
      this.$nextTick(() => { const el = this.$refs.renameInput; el?.focus(); el?.select(); });
    },
    async saveRename() {
      const v = this.rename.value.replace(/\s+/g, ' ').trim();
      if (this.rename.busy) return;
      if (!v || v === this.page.title) { this.rename.on = false; return; }
      this.rename.busy = true;
      try {
        const r = await (await api('/api/page/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: this.page.slug, title: v }) })).json();
        if (r.ok) { this.rename.on = false; this.$emit('toast', { text: $t('The title has been changed. The links are the same. “Undo” is on the home page.') }); await this.load(false); this.$emit('refresh'); }
        else this.$emit('toast', { text: r.error || $t('I could not change it'), icon: 'alert' });
      } catch { this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
      this.rename.busy = false;
    },
    async openManual() {
      const text = this.selBtn?.text; this.selBtn = null;
      if (!text) return;
      try {
        const r = await (await api('/api/page/locate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: this.page.slug, selection: text }) })).json();
        if (!r.ok) { this.$emit('toast', { text: r.error || $t('I did not find the passage'), icon: 'alert' }); return; }
        this.man = { open: true, md: r.markdown, before: r.markdown, hash: r.hash, busy: false, error: '' };
        window.getSelection()?.removeAllRanges();
        this.$nextTick(() => this.$refs.manText?.focus());
      } catch { this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
    },
    async saveManual() {
      if (this.man.busy || this.man.md === this.man.before) return;
      this.man.busy = true; this.man.error = '';
      try {
        const r = await (await api('/api/page/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: this.page.slug, before: this.man.before, after: this.man.md, hash: this.man.hash }) })).json();
        if (r.ok) { this.man.open = false; this.$emit('toast', { text: $t('The text has been saved. “Undo” is on the home page.') }); await this.load(false); this.$emit('refresh'); }
        else this.man.error = r.error || $t('I could not save it');
      } catch { this.man.error = $t('The server is not responding'); }
      this.man.busy = false;
    },
    // Маха абзаца заедно с връзките в него; потвърждение с откъс и списък на връзките, „Върни“ отменя
    async deleteParagraph() {
      const text = this.selBtn?.text; this.selBtn = null;
      if (!text) return;
      try {
        const r = await (await api('/api/page/locate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: this.page.slug, selection: text }) })).json();
        if (!r.ok) { this.$emit('toast', { text: r.error || $t('I did not find the paragraph'), icon: 'alert' }); return; }
        const links = [...new Set([...r.markdown.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim().split('/').pop()))];
        const plain = r.markdown.replace(/\s+/g, ' ').trim();
        const msg = $t('Remove this paragraph?\n\n“{0}”\n\n', [plain.length > 260 ? plain.slice(0, 260) + '…' : plain])
          + (links.length ? $t('Along with it, {0} {1} are removed: {2}{3}\n\n', [links.length, links.length === 1 ? $t('link') : $t('links'), links.slice(0, 8).join(', '), links.length > 8 ? '…' : '']) : '')
          + $t('The “Undo” button on the home page reverts the change.');
        if (!confirm(msg)) return;
        const d = await (await api('/api/page/delete-paragraph', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: this.page.slug, before: r.markdown, hash: r.hash }) })).json();
        window.getSelection()?.removeAllRanges();
        if (d.ok) { this.$emit('toast', { text: $t('The paragraph has been removed. “Undo” is on the home page.') }); await this.load(false); this.$emit('refresh'); }
        else this.$emit('toast', { text: d.error || $t('I could not remove the paragraph'), icon: 'alert' });
      } catch { this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
    },
    // Връзка: избраният текст става [[страница]] (или [[страница|текст]]); диалогът показва колекцията за избор
    openLink() {
      const text = this.selBtn?.text; this.selBtn = null;
      if (!text) return;
      window.getSelection()?.removeAllRanges();
      this.lk = { open: true, sel: text, q: '', busy: false, error: '' };
      this.$nextTick(() => this.$refs.linkQ?.focus());
    },
    async pickLink(p) {
      if (this.lk.busy) return;
      this.lk.busy = true; this.lk.error = '';
      try {
        const r = await (await api('/api/page/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: this.page.slug, selection: this.lk.sel, target: p.slug }) })).json();
        if (r.ok) { this.lk.open = false; this.$emit('toast', { text: $t('The link has been added. “Undo” is on the home page.') }); await this.load(false); this.$emit('refresh'); }
        else this.lk.error = r.error || $t('I could not add the link');
      } catch { this.lk.error = $t('The server is not responding'); }
      this.lk.busy = false;
    },
    // --- Помощник на страницата ---
    readSelection() {
      const sel = window.getSelection(), root = this.$refs.body;
      if (!sel || sel.isCollapsed || !root || !this.canAsk) { this.selBtn = null; return; }
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 8 || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) { this.selBtn = null; return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      this.selBtn = { x: Math.min(Math.max(r.left + r.width / 2, 110), window.innerWidth - 110), y: Math.max(r.top - 8, 56), text };
    },
    openAi(intent) {
      if (this.selBtn?.text) { this.ai.sel = this.selBtn.text.slice(0, 2000); }
      this.ai.intent = intent; this.ai.open = true; this.selBtn = null;
      this.$nextTick(() => this.$el.querySelector?.('aside[data-ai] textarea')?.focus());
    },
    closeAi() { this.cancelAi(); this.ai.open = false; },
    resetAi() {
      this.cancelAi();
      Object.assign(this.ai, { open: false, sel: '', question: '', busy: false, busy2: false, error: '', answer: '', asked: '', proposal: null, saved: false, applied: null });
      this.selBtn = null;
    },
    setAiLevel(id) { this.ai.level = id; store.set('asklevel', id); },
    submitAi() { if (this.ai.question.trim().length < 3 || this.ai.busy) return; (this.ai.sel && this.ai.intent === 'edit') ? this.proposeAi('selection') : this.askAi(); },
    cancelAi() { const ac = this.aiAc; this.aiAc = null; clearInterval(this.aiTimer); ac?.abort(); this.ai.busy = false; },
    // обща заявка към Claude с „Откажи“ и броене на секундите
    async aiCall(url, body) {
      this.cancelAi(); this.ai.busy = true; this.ai.error = ''; this.ai.waited = 0;
      const ac = new AbortController(); this.aiAc = ac;
      this.aiTimer = setInterval(() => { this.ai.waited++; }, 1000);
      let out = null;
      try {
        const r = await api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || $t('The server is not responding'));
        out = d;
      } catch (e) { if (e.name !== 'AbortError' && this.aiAc === ac) this.ai.error = e.message || $t('Error'); }
      if (this.aiAc !== ac) return null;
      clearInterval(this.aiTimer); this.aiAc = null; this.ai.busy = false;
      return out;
    },
    async askAi() {
      const q = this.ai.question.trim(); if (q.length < 3) return;
      if (!(await this.$root.confirmClaude({ kind: 'ask', slug: this.page.slug, question: q, selection: this.ai.sel, level: this.ai.level }))) return;
      this.ai.question = ''; // въпросът е изпратен: полето е чисто за следващата заявка
      const d = await this.aiCall('/api/ask', { slug: this.page.slug, question: q, selection: this.ai.sel, level: this.ai.level });
      if (!d) { if (!this.ai.question) this.ai.question = q; return; } // неуспех или отказ: въпросът се връща в полето
      Object.assign(this.ai, { answer: d.answer, asked: q, proposal: null, saved: false, applied: null });
      this.$nextTick(() => this.$refs.aiBody?.scrollTo({ top: 9999, behavior: 'smooth' }));
    },
    async askConspect() {
      if (!(await this.$root.confirmClaude({ kind: 'conspect', slug: this.page.slug, level: this.ai.level }))) return;
      const d = await this.aiCall('/api/conspect', { slug: this.page.slug, level: this.ai.level });
      if (!d) return;
      Object.assign(this.ai, { answer: d.answer, asked: $t('Outline of the original'), proposal: null, saved: false, applied: null });
      this.$nextTick(() => this.$refs.aiBody?.scrollTo({ top: 9999, behavior: 'smooth' }));
    },
    async proposeAi(mode) {
      const body = mode === 'selection'
        ? { slug: this.page.slug, mode, selection: this.ai.sel, instruction: this.ai.question.trim(), level: this.ai.level }
        : { slug: this.page.slug, mode, question: this.ai.asked, answer: this.ai.answer, level: this.ai.level };
      if (!(await this.$root.confirmClaude({ kind: 'improve', ...body }))) return;
      if (mode === 'selection') this.ai.question = ''; // инструкцията е изпратена
      const d = await this.aiCall('/api/improve', body);
      if (!d) { if (mode === 'selection' && !this.ai.question) this.ai.question = body.instruction; return; }
      this.ai.proposal = d; this.ai.applied = null;
      this.$nextTick(() => this.$refs.aiBody?.scrollTo({ top: 9999, behavior: 'smooth' }));
    },
    // отговорът става нов текст на страницата (или на избрания откъс): първо преглед „било, става“, после потвърждение
    async replaceAi() {
      this.ai.busy2 = true; this.ai.error = '';
      try {
        const r = await api('/api/improve/replace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: this.page.slug, answer: this.ai.answer, selection: this.ai.sel }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) this.ai.error = d.error || $t('I could not prepare the replacement');
        else { this.ai.proposal = d; this.ai.applied = null; this.$nextTick(() => this.$refs.aiBody?.scrollTo({ top: 9999, behavior: 'smooth' })); }
      } catch { this.ai.error = $t('The server is not responding'); }
      this.ai.busy2 = false;
    },
    async applyAi() {
      this.ai.busy2 = true;
      try {
        const r = await (await api('/api/improve/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: this.ai.proposal.id }) })).json();
        if (r.ok) { this.ai.applied = r; this.ai.proposal = null; this.$emit('toast', { text: $t('The page has been improved. “Undo” reverts it.') }); await this.load(false); }
        else this.ai.error = r.error || $t('I could not apply it');
      } catch { this.ai.error = $t('The server is not responding'); }
      this.ai.busy2 = false;
    },
    async undoAi() {
      const r = await (await api('/api/agent/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: this.ai.applied.undoId }) })).json();
      this.$emit('toast', r.ok ? { text: $t('Restored.'), icon: 'undo' } : { text: r.error, icon: 'alert' });
      if (r.ok) { this.ai.applied = null; await this.load(false); }
    },
    async saveAi() {
      const r = await (await api('/api/ask/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: this.page.slug, question: this.ai.asked, answer: this.ai.answer }) })).json();
      if (r.ok) { this.ai.saved = true; this.$emit('toast', { text: $t('Saved as a question: it can now be found by search and paths.') }); }
      else this.ai.error = r.error || $t('I could not save it');
    },
    async splitChapters() {
      if (!(await this.$root.confirmClaude({ kind: 'chapters', slug: this.page.slug }))) return;
      const r = await (await api('/api/agent/chapters', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: this.page.slug }) })).json();
      this.$emit('toast', r.queued ? { text: $t('Added to the queue. Follow the progress on the home page.') } : { text: r.error || $t('Already in the queue'), icon: 'alert' });
    },
  },
  mounted() {
    this.onSel = () => { clearTimeout(this.selTimer); this.selTimer = setTimeout(() => this.readSelection(), 120); };
    this.onScroll = () => { this.selBtn = null; };
    document.addEventListener('selectionchange', this.onSel);
    window.addEventListener('scroll', this.onScroll, { passive: true });
  },
  beforeUnmount() {
    this.observer?.disconnect(); this.cancelAi();
    document.removeEventListener('selectionchange', this.onSel); window.removeEventListener('scroll', this.onScroll); clearTimeout(this.selTimer);
  },
});

// Ключ за азбучен ред: личностите се подреждат по фамилия (последната дума), останалото по заглавие
const surnameOf = (p) => {
  const t = String(p.title).replace(/\(.*?\)/g, ' ').trim();
  if (t.includes(',')) return t;
  const w = t.split(/\s+/).filter(Boolean);
  return w.length > 1 ? w[w.length - 1] + ' ' + w.slice(0, -1).join(' ') : t;
};
const isPerson = (p) => p.type === 'entity' && p.kind === 'person';
const sortKey = (p) => (isPerson(p) ? surnameOf(p) : String(p.title));
const letterOf = (p) => {
  const c = sortKey(p).replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toLocaleUpperCase('bg');
  return c && /[\p{L}]/u.test(c) ? c : '#';
};
// Азбуки: първо българската (кирилица), после английската (латиница), накрая останалото
const scriptOf = (k) => (/\p{Script=Cyrillic}/u.test(k) ? 'bg' : /\p{Script=Latin}/u.test(k) ? 'en' : 'other');
const SCRIPT_RANK = { bg: 0, en: 1, other: 2 };
const SCRIPT_LABEL = { bg: $t('Bulgarian'), en: 'English', other: $t('Other') };
const titleCmp = (a, b) => {
  const ka = sortKey(a).replace(/^[^\p{L}\p{N}]+/u, ''), kb = sortKey(b).replace(/^[^\p{L}\p{N}]+/u, '');
  const ra = SCRIPT_RANK[scriptOf(ka.charAt(0))], rb = SCRIPT_RANK[scriptOf(kb.charAt(0))];
  return ra - rb || ka.localeCompare(kb, ra === 0 ? 'bg' : 'en');
};

const CollectionView = defineComponent({
  template: '#tpl-collection',
  props: { pages: Array, type: String, tag: String },
  emits: ['toast'],
  data: () => ({
    ...shared, SCRIPT_LABEL, filter: '', sort: store.get('sort', 'title'), fmt: 'all', view: 'cards', letter: '',
    dupes: { pairs: [], authors: [] }, dupOpen: false, dupKeep: {}, authCanon: {}, dupPlan: null, dupBusy: false,
    mergeOpen: false, mergeTitle: '', mergePick: [], mergePlan: null, mergeBusy: false,
  }),
  created() { this.view = store.get('view:' + this.viewKey, 'cards'); this.loadDupes(); },
  watch: {
    sort(v) { store.set('sort', v); },
    view(v) { store.set('view:' + this.viewKey, v); },
    viewKey(k) { this.view = store.get('view:' + k, 'cards'); },
    type() { this.fmt = 'all'; this.filter = ''; this.letter = ''; this.dupPlan = null; this.dupOpen = false; this.mergeOpen = false; this.mergePick = []; this.mergeTitle = ''; this.mergePlan = null; this.loadDupes(); },
    tag() { this.letter = ''; },
    pages() { clearTimeout(this.dupTimer); this.dupTimer = setTimeout(() => this.loadDupes(), 400); },
  },
  computed: {
    viewKey() { return this.tag ? 'tag' : this.type; },
    T() { return TYPES[this.type] || TYPES.other; },
    formats() { return [...new Set(this.pages.filter((p) => p.type === 'source' && p.format).map((p) => p.format))]; },
    surnameSort() { return this.type === 'entity' && !this.tag; },
    // страниците на колекцията преди буквата (от тях се броят буквите)
    base() {
      const q = this.filter.trim().toLowerCase();
      let l = this.pages.filter((p) => !p.special && (this.tag ? p.tags.includes(this.tag) : p.type === this.type));
      if (this.fmt !== 'all') l = l.filter((p) => p.format === this.fmt);
      if (q) l = l.filter((p) => (p.title + ' ' + (p.aliases || []).join(' ') + ' ' + p.excerpt + ' ' + p.tags.join(' ')).toLowerCase().includes(q));
      return l;
    },
    baseCount() { return this.base.length; },
    letters() {
      const n = new Map();
      for (const p of this.base) { const k = letterOf(p); n.set(k, (n.get(k) || 0) + 1); }
      return [...n].map(([k, c]) => ({ k, n: c, s: scriptOf(k) }))
        .sort((a, b) => SCRIPT_RANK[a.s] - SCRIPT_RANK[b.s] || (a.k === '#') - (b.k === '#') || a.k.localeCompare(b.k, a.s === 'bg' ? 'bg' : 'en'));
    },
    list() {
      let l = this.base;
      if (this.letter) l = l.filter((p) => letterOf(p) === this.letter);
      const by = {
        title: titleCmp,
        updated: (a, b) => String(b.updated || '').localeCompare(String(a.updated || '')),
        links: (a, b) => b.backlinks - a.backlinks,
      }[this.sort];
      return [...l].sort(by);
    },
    // при азбучен ред: заглавие за всяка буква, за да се чете по-лесно
    groups() {
      if (this.sort !== 'title' || this.letter || this.baseCount < 8) return [{ k: '', items: this.list }];
      const g = [];
      for (const p of this.list) {
        const k = letterOf(p);
        if (!g.length || g[g.length - 1].k !== k) g.push({ k, s: scriptOf(k), first: !g.length || g[g.length - 1].s !== scriptOf(k), items: [] });
        g[g.length - 1].items.push(p);
      }
      return g;
    },
    myPairs() { return this.tag ? [] : this.dupes.pairs.filter((p) => p.a.type === this.type); },
    myAuthors() { return this.type === 'source' && !this.tag ? this.dupes.authors : []; },
    dupTitle() {
      const a = this.myPairs.length, b = this.myAuthors.length;
      const parts = [];
      if (a) parts.push($t('{0} {1} by spelling', [a, plural(a, $t('possible duplicate'), $t('possible duplicates'))]));
      if (b) parts.push($t('{0} {1} with different spellings', [b, plural(b, $t('author'), $t('authors'))]));
      return parts.join($t(' and '));
    },
  },
  methods: {
    async loadDupes() {
      if (this.ro || this.tag || !['entity', 'concept', 'topic', 'source'].includes(this.type)) { this.dupes = { pairs: [], authors: [] }; return; }
      try { this.dupes = await (await fetch('/api/dupes')).json(); } catch { /* не е критично */ }
    },
    pk(p) { return p.a.slug + '|' + p.b.slug; },
    keepOf(p) { return this.dupKeep[this.pk(p)] || (p.a.backlinks >= p.b.backlinks ? p.a.slug : p.b.slug); },
    canonOf(g, i) { return this.authCanon[i] || g.variants[0].name; },
    async askMerge(p) {
      const keep = this.keepOf(p), drop = keep === p.a.slug ? p.b.slug : p.a.slug;
      const plan = await (await fetch(`/api/merge/preview?keep=${encodeURIComponent(keep)}&drop=${encodeURIComponent(drop)}`)).json();
      this.dupPlan = { key: this.pk(p), keep, drop, plan };
    },
    async doMerge() {
      const d = this.dupPlan; if (!d) return;
      this.dupBusy = true;
      try {
        const r = await (await api('/api/merge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keep: d.keep, drop: d.drop }) })).json();
        this.$emit('toast', r.ok ? { text: $t('Merged: “{0}” → “{1}”', [r.drop.title, r.keep.title]) } : { text: r.error || $t('I could not merge'), icon: 'alert' });
      } catch { this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
      this.dupBusy = false; this.dupPlan = null; this.loadDupes();
    },
    async notSame(p) {
      await api('/api/dupes/ignore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: p.a.slug, b: p.b.slug }) });
      this.loadDupes();
    },
    async normAuthors(g, i) {
      const canonical = this.canonOf(g, i);
      this.dupBusy = true;
      try {
        const r = await (await api('/api/authors/normalize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ canonical, names: g.variants.map((v) => v.name) }) })).json();
        this.$emit('toast', r.ok ? { text: $t('Unified spelling “{0}” in {1} {2}', [canonical, r.files, plural(r.files, $t('source'), $t('sources'))]) } : { text: r.error || $t('I could not'), icon: 'alert' });
      } catch { this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
      this.dupBusy = false; this.loadDupes();
    },
    titleOf(slug) { return this.pages.find((p) => p.slug === slug)?.title || slug; },
    togglePick(slug) {
      const i = this.mergePick.indexOf(slug);
      if (i >= 0) this.mergePick.splice(i, 1); else this.mergePick.push(slug);
      this.mergePlan = null;
    },
    moveMerge(i, dir) {
      const j = i + dir; if (j < 0 || j >= this.mergePick.length) return;
      [this.mergePick[i], this.mergePick[j]] = [this.mergePick[j], this.mergePick[i]];
      this.mergePlan = null;
    },
    async previewMergeBook() {
      this.mergePlan = await (await api('/api/merge-sources/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: this.mergeTitle, slugs: this.mergePick }) })).json();
    },
    async doMergeBook() {
      if (!this.mergePlan?.ok) return;
      this.mergeBusy = true;
      try {
        const r = await (await api('/api/merge-sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: this.mergeTitle, slugs: this.mergePick }) })).json();
        this.$emit('toast', r.ok ? { text: $t('Book created: “{0}” with {1} chapters', [r.title, r.chapters.length]) } : { text: r.error || $t('I could not merge'), icon: 'alert' });
        if (r.ok) { this.mergeOpen = false; this.mergePick = []; this.mergeTitle = ''; this.mergePlan = null; }
      } catch { this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
      this.mergeBusy = false;
    },
  },
  beforeUnmount() { clearTimeout(this.dupTimer); },
});

// ---------- Пътека за учене ----------
// Въпросът става подредена пътека. Страниците се четат в панел до пътеката, така че
// следването на връзки не те изважда от нея: винаги се виждат „къде съм“ и „накъде вървя“.
const LEVELS = [
  { id: 'local', label: $t('Quick'), hint: $t('Arranges by words from the question. Works locally, without Claude and without using your limit, but does not understand meaning.') },
  { id: 'light', label: $t('Light'), hint: $t('Claude with the light model (Haiku): quick and economical, arranges by the index and a few opened pages.') },
  { id: 'medium', label: $t('Medium'), hint: $t('Claude with the medium model (Sonnet): reads the main pages and arranges from the general to the specific.') },
  { id: 'strong', label: $t('Powerful'), hint: $t('Claude with the most powerful model (Opus): reads the most, follows citations to chapters and marks contradictions. The slowest and the most expensive for your limit.') },
];
// ---------- Обхват: области и теми, общи за „Учене по въпрос“ и „Писане с wiki“ ----------
const scope = Vue.reactive((() => { let a = []; try { a = JSON.parse(store.get('scope:areas', '[]')); } catch {} return { areas: Array.isArray(a) ? a.map(String) : [], focus: [] }; })());
const scopeKey = () => scope.areas.slice().sort().join(',') + '~' + scope.focus.slice().sort().join(',');
const scopeQuery = () => (scope.areas.length ? '&a=' + encodeURIComponent(scope.areas.join(',')) : '') + (scope.focus.length ? '&f=' + encodeURIComponent(scope.focus.join(',')) : '');
const scopeBody = () => ({ areas: [...scope.areas], focus: [...scope.focus] });
const ScopeBar = defineComponent({
  template: '#tpl-scope',
  props: { q: String, pages: Array },
  data: () => ({ scope, topics: [], loading: false }),
  computed: {
    areaList() {
      const m = new Map();
      for (const p of this.pages || []) if (p.area && p.type === 'source') m.set(p.area, (m.get(p.area) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'bg')).map(([name, n]) => ({ name, n }));
    },
    names() { return new Set(this.areaList.map((a) => a.name)); },
  },
  watch: {
    q() { clearTimeout(this.t); this.t = setTimeout(() => this.fetchTopics(), 450); },
    'scope.areas'() { this.fetchTopics(); },
    areaList() { // област, която вече я няма (преименувана или обединена), излиза от избора
      const keep = this.scope.areas.filter((a) => this.names.has(a));
      if (keep.length !== this.scope.areas.length) { this.scope.areas = keep; store.set('scope:areas', JSON.stringify(keep)); }
    },
  },
  created() { this.fetchTopics(); },
  beforeUnmount() { clearTimeout(this.t); },
  methods: {
    toggleArea(name) {
      const a = new Set(this.scope.areas); a.has(name) ? a.delete(name) : a.add(name);
      this.scope.areas = [...a]; store.set('scope:areas', JSON.stringify(this.scope.areas));
    },
    clearAreas() { this.scope.areas = []; store.set('scope:areas', '[]'); },
    toggleTopic(slug) { const f = new Set(this.scope.focus); f.has(slug) ? f.delete(slug) : f.add(slug); this.scope.focus = [...f]; },
    async fetchTopics() {
      const q = (this.q || '').trim();
      if (q.length < 3 && !this.scope.areas.length) { this.topics = []; this.scope.focus = []; return; }
      this.loading = true;
      try {
        const r = await fetch('/api/topics?q=' + encodeURIComponent(q) + (this.scope.areas.length ? '&a=' + encodeURIComponent(this.scope.areas.join(',')) : ''));
        this.topics = r.ok ? await r.json() : [];
      } catch { this.topics = []; }
      this.loading = false;
      const have = new Set(this.topics.map((t) => t.slug));
      const keep = this.scope.focus.filter((s) => have.has(s));
      if (keep.length !== this.scope.focus.length) this.scope.focus = keep;
    },
  },
});

const AreasView = defineComponent({
  template: '#tpl-areas',
  props: { pages: Array },
  emits: ['toast', 'refresh'],
  data: () => ({
    ...shared, LEVELS, data: null, open: {}, rn: null, busy: false, prop: null, cls: { level: 'light', busy: false, error: '', waited: 0 },
  }),
  computed: {
    names() { return (this.data?.areas || []).map((a) => a.name); },
    classifyLevels() { return LEVELS.filter((l) => l.id !== 'local'); },
  },
  created() { this.load(); },
  watch: { pages() { this.load(); } },
  beforeUnmount() { clearInterval(this.timer); },
  methods: {
    async load() { try { this.data = await (await fetch('/api/areas')).json(); } catch { this.data = null; } },
    srcOf(name) { return (this.data?.sources || []).filter((s) => s.area === name); },
    async post(url, body) { const r = await api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.json().catch(() => ({})); },
    async setArea(s, area) {
      const r = await this.post('/api/areas/set', { slug: s.slug, area });
      this.$emit('toast', r.ok ? { text: $t('The area has been changed. “Undo” is on the home page.') } : { text: r.error || $t('I could not'), icon: 'alert' });
      await this.load(); this.$emit('refresh');
    },
    startRename(a) { this.rn = { from: a.name, value: a.name }; this.$nextTick(() => this.$el.querySelector('input[data-rename]')?.focus()); },
    async saveRename() {
      const { from, value } = this.rn, to = value.trim();
      if (!to || to === from) { this.rn = null; return; }
      const merge = this.names.find((n) => n.toLowerCase() === to.toLowerCase() && n !== from);
      if (merge && !confirm($t('“{0}” already exists. Merge “{1}” into it? All pages from “{2}” will move to “{3}”.', [merge, from, from, merge]))) return;
      this.busy = true;
      const r = await this.post('/api/areas/rename', { from, to });
      this.busy = false;
      this.$emit('toast', r.ok ? { text: merge ? $t('The areas have been merged.') : $t('The area has been renamed.') } : { text: r.error || $t('I could not'), icon: 'alert' });
      if (r.ok) { this.rn = null; await this.load(); this.$emit('refresh'); }
    },
    async classify() {
      if (this.cls.busy) return;
      if (!(await this.$root.confirmClaude({ kind: 'areas', level: this.cls.level }))) return;
      this.cls.busy = true; this.cls.error = ''; this.cls.waited = 0; this.prop = null;
      this.timer = setInterval(() => { this.cls.waited++; }, 1000);
      const ac = new AbortController(); this.ac = ac;
      try {
        const r = await api('/api/areas/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: this.cls.level }), signal: ac.signal });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || $t('The server is not responding'));
        this.prop = d;
      } catch (e) { if (e.name !== 'AbortError') this.cls.error = e.message || $t('Error'); }
      clearInterval(this.timer); this.cls.busy = false; this.ac = null;
    },
    cancelClassify() { this.ac?.abort(); },
    async applyProp() {
      const items = this.prop.items.filter((i) => i.area.trim()).map((i) => ({ slug: i.slug, area: i.area.trim() }));
      this.busy = true;
      const r = await this.post('/api/areas/apply', { items });
      this.busy = false;
      if (r.ok) { this.$emit('toast', { text: $t('Areas saved ({0}). “Undo” is on the home page.', [items.length]) }); const rest = this.prop.remaining; this.prop = null; await this.load(); this.$emit('refresh'); if (rest) this.cls.error = $t('{0} more sources are left without an area: run the detection again.', [rest]); }
      else this.cls.error = r.error || $t('I could not save it');
    },
  },
});

const PathView = defineComponent({
  template: '#tpl-path',
  props: { q: String, mode: { type: String, default: 'local' }, pages: Array },
  emits: ['toast'],
  data: () => ({
    ...shared, LEVELS, input: '', loading: false, res: null, done: new Set(), current: null,
    stack: [], panel: null, panelLoading: false, recent: [], saved: [], mobilePanel: false,
    error: '', pending: false, waited: 0, wantGen: false, picked: store.get('pathlevel', 'local'),
  }),
  computed: {
    level() { const m = this.q ? this.mode : this.picked; return LEVELS.some((l) => l.id === m) ? m : 'local'; },
    sig() { return (this.q || '') + '|' + this.level + '|' + scopeKey(); },
    levelInfo() { return LEVELS.find((l) => l.id === this.level); },
    steps() { return this.res?.steps || []; },
    total() { return this.steps.length; },
    doneN() { return this.steps.filter((s) => this.done.has(s.slug)).length; },
    groups() { return (this.res?.stages || []).map((g) => ({ ...g, items: this.steps.filter((s) => s.stage === g.id) })); },
    idx() { return this.steps.findIndex((s) => s.slug === this.current); },
    known() { return new Set(this.pages.map((p) => p.slug)); },
    titles() { return new Map(this.pages.map((p) => [p.slug, p.title])); },
    types() { return new Map(this.pages.map((p) => [p.slug, p.type])); },
    panelHtml() {
      if (!this.panel) return '';
      return renderMarkdown(this.panel.content, this.known, this.titles, {
        readerSrc: ['source', 'chapter'].includes(this.panel.type) ? this.panel.readerSrc : null,
        readable: (slug) => readerOk(this.types.get(slug), slug),
        stripSection: this.panel.chapters?.length ? $t('Chapters') : null,
      });
    },
    trail() { return this.stack.map((s) => ({ slug: s, title: this.titles.get(s) || s })); },
  },
  watch: {
    q: { immediate: true, handler(q) { this.input = q || ''; } },
    sig: { immediate: true, handler() { this.run(); } },
  },
  created() { this.recent = this.loadRecent(); this.loadSaved(); },
  beforeUnmount() { this.cancel(); },
  methods: {
    levelLabel(id) { return LEVELS.find((l) => l.id === id)?.label || id; },
    async loadSaved() { try { this.saved = await (await fetch('/api/path/list')).json(); } catch { this.saved = []; } },
    async deleteSaved(r) {
      if (!confirm($t('Delete the composed path “{0}” ({1} model)? Next time it will have to be composed again, which uses part of your limit.', [r.q, this.levelLabel(r.level).toLowerCase()]))) return;
      try {
        const d = await (await api('/api/path/saved', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: r.q, level: r.level, areas: r.areas || [], focus: r.focus || [] }) })).json();
        this.$emit('toast', d.ok ? { text: $t('The path has been deleted.') } : { text: d.error || $t('I could not'), icon: 'alert' });
        await this.loadSaved();
      } catch { this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
    },
    href(q, level) { return '#/path/' + encodeURIComponent(q) + (level && level !== 'local' ? '?m=' + level : ''); },
    // Нивото се помни. Ако вече има въпрос, пътеката се отваря на новото ниво; Claude не се пуска сам, освен при generate
    setLevel(id, generate = false) {
      this.picked = id; store.set('pathlevel', id);
      this.wantGen = generate;
      if (this.q) location.hash = this.href(this.q, id);
    },
    key() { const sk = scopeKey(); return 'path:' + (this.level === 'local' ? '' : this.level + ':') + (this.q || '').trim().toLowerCase() + (sk === '~' ? '' : '|' + sk); },
    // отваряне на запазена пътека: връща и обхвата, с който е съставена
    applyScope(r) { scope.areas = [...(r.areas || [])]; scope.focus = [...(r.focus || [])]; store.set('scope:areas', JSON.stringify(scope.areas)); },
    loadRecent() { try { return JSON.parse(store.get('paths', '[]')); } catch { return []; } },
    pushRecent(q) {
      const l = [q, ...this.loadRecent().filter((x) => x !== q)].slice(0, 8);
      store.set('paths', JSON.stringify(l)); this.recent = l;
    },
    forget(q) {
      const l = this.loadRecent().filter((x) => x !== q);
      store.set('paths', JSON.stringify(l)); store.set('path:' + q.trim().toLowerCase(), ''); this.recent = l;
    },
    submit() {
      const v = this.input.trim();
      if (!v) return;
      this.wantGen = this.level !== 'local'; // изрично натискане на бутона = съгласие да се харчи от лимита
      const target = this.href(v, this.level);
      if (v === this.q && location.hash === target) this.run(); else location.hash = target;
    },
    async run() {
      this.cancel(); this.panel = null; this.stack = []; this.mobilePanel = false; this.error = ''; this.pending = false; this.res = null;
      const gen = this.wantGen; this.wantGen = false;
      if (!this.q || !this.q.trim()) { this.done = new Set(); this.current = null; this.loading = false; return; }
      this.loading = true;
      const q = this.q, level = this.level;
      try {
        if (level === 'local') {
          this.res = await (await fetch('/api/path?q=' + encodeURIComponent(q) + scopeQuery())).json();
        } else {
          const saved = await (await fetch(`/api/path/saved?level=${level}&q=${encodeURIComponent(q)}${scopeQuery()}`)).json();
          if (saved) this.res = saved;
          else if (gen) { this.loading = false; return this.generate(); }
          else { this.loading = false; this.pending = true; return; }
        }
      } catch { this.res = { steps: [], stages: [], note: $t('The server is not responding') }; }
      if (q !== this.q || level !== this.level) return; // междувременно е сменен въпросът
      this.loading = false;
      this.afterResult();
    },
    // Съставяне от Claude: само при изрично действие. Затварянето на страницата или „Откажи“ спира Claude.
    async generate(fresh = false) {
      if (!(await this.$root.confirmClaude({ kind: 'path', q: this.q.trim(), level: this.level, ...scopeBody() }))) return;
      this.cancel(); this.error = ''; this.pending = false; this.loading = true; this.res = null; this.waited = 0;
      const ac = new AbortController(); this.ac = ac;
      this.timer = setInterval(() => { this.waited++; }, 1000);
      let result = null, err = '';
      try {
        const r = await api('/api/path/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: this.q.trim(), level: this.level, fresh, ...scopeBody() }), signal: ac.signal });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || $t('The server is not responding'));
        result = d;
      } catch (e) { err = e.name === 'AbortError' ? '' : (e.message || $t('Error')); if (e.name === 'AbortError') result = false; }
      if (this.ac !== ac) return; // има по-нова заявка
      clearInterval(this.timer); this.ac = null; this.loading = false;
      if (result === false) { this.pending = true; return; }
      if (err) { this.error = err; return; }
      this.res = result; this.loadSaved(); this.afterResult();
    },
    cancel() { const ac = this.ac; this.ac = null; clearInterval(this.timer); ac?.abort(); },
    afterResult() {
      let saved = {}; try { saved = JSON.parse(store.get(this.key(), '{}') || '{}'); } catch {}
      const have = new Set(this.steps.map((s) => s.slug));
      this.done = new Set((saved.done || []).filter((s) => have.has(s)));
      if (this.steps.length) {
        if (this.level === 'local') this.pushRecent(this.q.trim());
        const target = have.has(saved.current) ? saved.current : (this.steps.find((s) => !this.done.has(s.slug)) || this.steps[0]).slug;
        this.go(target, false);
      }
    },
    save() { store.set(this.key(), JSON.stringify({ done: [...this.done], current: this.current })); },
    async go(slug, mobile = true) {
      this.current = slug; this.stack = [slug]; this.save();
      if (mobile) this.mobilePanel = true;
      await this.loadPanel(slug);
    },
    async loadPanel(slug) {
      this.panelLoading = true;
      try {
        const r = await fetch('/api/page/' + encodeURIComponent(slug));
        this.panel = r.ok ? await r.json() : { slug, title: slug, type: 'other', content: $t('*This page does not exist yet.*'), backlinks: [], outgoing: [] };
      } catch { this.panel = null; }
      this.panelLoading = false;
      this.$nextTick(() => this.$refs.panelBody?.scrollTo({ top: 0 }));
    },
    // връзка вътре в панела: отваря се в панела, пътеката остава
    onPanelClick(e) {
      const pg = e.target.closest('a.pg');
      if (pg) { e.preventDefault(); this.$root.openReader(pg.dataset.src, Number(pg.dataset.page)); return; }
      const a = e.target.closest('a.wl');
      if (a && !a.classList.contains('missing')) { e.preventDefault(); this.open(a.dataset.slug); }
    },
    open(slug) { this.stack.push(slug); this.loadPanel(slug); },
    back() { if (this.stack.length > 1) { this.stack.pop(); this.loadPanel(this.stack[this.stack.length - 1]); } },
    backToStep() { if (this.current) this.go(this.current, true); },
    toggleDone(slug) {
      const d = new Set(this.done); d.has(slug) ? d.delete(slug) : d.add(slug); this.done = d; this.save();
    },
    next() {
      if (this.current) { const d = new Set(this.done); d.add(this.current); this.done = d; }
      const after = this.steps.slice(this.idx + 1).concat(this.steps.slice(0, this.idx)).find((s) => !this.done.has(s.slug));
      if (after) this.go(after.slug, true);
      else { this.save(); this.$emit('toast', { text: $t('The path has been walked to the end') }); }
    },
    reset() { this.done = new Set(); this.save(); },
    stepIcon(s) { return (TYPES[s.type] || TYPES.other); },
  },
});



// ---------- Писане с wiki ----------
const WRITE_HINTS = {
  local: $t('Arranges the text from the library’s pages into an article structure. Without Claude, does not use your limit, but it is a draft to edit, not a connected text.'),
  light: $t('Claude with the light model (Haiku): quick and economical; a simpler text.'),
  medium: $t('Claude with the medium model (Sonnet): reads the main pages and writes a connected text.'),
  strong: $t('Claude with the most powerful model (Opus): reads the most, checks claims against the original and describes contradictions. The slowest and the most expensive for your limit.'),
};
// ---------- Добави статия по DOI или адрес ----------
const LANGS = [
  { id: 'bg', label: $t('Library language only'), hint: $t('Pages in the library language. Original terms are only in parentheses.') },
  { id: 'both', label: $t('Library language + original terms'), hint: $t('Pages in the library language, but the title and terms of the original are kept in the index and search finds them. A good choice when the translation is poor.') },
  { id: 'original', label: $t('In the language of the source'), hint: $t('Pages (summaries, chapters, key ideas) are written in the language of the source.') },
];
const SetupView = defineComponent({
  template: '#tpl-setup',
  emits: ['copy', 'done'],
  data: () => ({ data: null, busy: false, testing: false, testMsg: '', testOk: false }),
  created() { this.load(); },
  methods: {
    async load() {
      this.busy = true;
      try { this.data = await (await fetch('/api/setup')).json(); } catch {} finally { this.busy = false; }
    },
    async testConn() {
      this.testing = true; this.testMsg = '';
      try {
        const d = await (await api('/api/setup/test', { method: 'POST' })).json();
        this.testOk = !!d.ok;
        this.testMsg = d.ok ? $t('The connection works. Claude answered.') : (d.error || $t('Claude returned no answer.'));
        if (d.ok) this.load();
      } catch { this.testOk = false; this.testMsg = $t('The server is not responding.'); }
      this.testing = false;
    },
    async markDone() {
      try { await api('/api/agent/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupDone: true }) }); } catch {}
      this.$emit('done');
    },
    finish() { this.markDone(); },
    skip() { this.markDone().then(() => (location.hash = '#/')); },
  },
});

const SettingsView = defineComponent({
  template: '#tpl-settings',
  emits: ['copy'],
  data: () => ({ info: null, code: null, packages: null, tests: null, testError: '', archive: { busy: false, result: null, error: '', list: [] }, busy: { code: false, packages: false, tests: false, auth: false }, pw: { current: '', next: '', message: '', bad: false } }),
  computed: {
    updateCmd() {
      const pack = this.info?.contentLang && this.info.contentLang !== 'en' ? ` && npm run content -- ${this.info.contentLang}` : '';
      // Инсталираните копия на езиковия пакет се връщат преди git pull, иначе git отказва заради локалната разлика.
      return `git restore CLAUDE.md .claude wiki/_templates scripts/starter && git pull && npm install${pack}`;
    },
    testGroups() {
      if (!this.tests) return [];
      const keys = [...new Set(this.tests.tests.map((t) => t.group))];
      return keys.map((key) => {
        const items = this.tests.tests.filter((t) => t.group === key);
        return { key, items, title: this.pick(this.tests.groups?.[key] || { en: key }), pass: items.filter((t) => t.status === 'pass').length, bad: items.filter((t) => t.status === 'fail' || t.status === 'known').length };
      });
    },
  },
  created() { this.load(); this.loadArchives(); },
  methods: {
    pick(o) { return (window.__I18N?.lang === 'bg' && o.bg) || o.en; },
    async load() {
      try {
        const d = await (await fetch('/api/settings')).json();
        this.info = d; this.tests = d.tests; this.busy.tests = d.testsRunning;
      } catch { this.info = null; }
    },
    async post(key, url) {
      this.busy[key] = true;
      try { return await (await api(url, { method: 'POST' })).json(); }
      catch { return { ok: false, error: $t('The server is not responding.') }; }
      finally { this.busy[key] = false; }
    },
    // Архивът за четене: ZIP файл в outputs/archive/, после бутон за свалянето му
    async makeArchive() {
      this.archive = { ...this.archive, busy: true, result: null, error: '' };
      try {
        const d = await (await api('/api/archive', { method: 'POST' })).json();
        if (d.ok) this.archive.result = d; else this.archive.error = d.error || $t('The archive could not be made.');
      } catch { this.archive.error = $t('The server is not responding.'); }
      finally { this.archive.busy = false; this.loadArchives(); }
    },
    // Направените архиви: списък с изтриване на избрани
    async loadArchives() { try { this.archive.list = await (await fetch('/api/archives')).json(); } catch { this.archive.list = []; } },
    async removeArchive(a) {
      if (!window.confirm($t('Delete the archive {0}? The file cannot be restored.', [a.name]))) return;
      try { await api('/api/archive/' + encodeURIComponent(a.name), { method: 'DELETE' }); } catch { /* списъкът се презарежда отдолу */ }
      this.loadArchives();
    },
    async checkCode() { this.code = await this.post('code', '/api/updates/code'); },
    async checkPackages() {
      const d = await this.post('packages', '/api/updates/packages');
      this.packages = d.outdated ? d : { outdated: { ok: false, error: d.error }, audit: { ok: false, error: d.error } };
    },
    async savePassword(remove) {
      this.busy.auth = true;
      try {
        const body = JSON.stringify({ current: this.pw.current, password: remove ? null : this.pw.next });
        const d = await (await api('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
        this.pw.bad = !d.ok;
        this.pw.message = d.ok ? (remove ? $t('The password was removed.') : $t('The password was saved.')) : d.error;
        if (d.ok) { this.pw.current = ''; this.pw.next = ''; this.info.auth = d.auth; }
      } catch { this.pw.bad = true; this.pw.message = $t('The server is not responding.'); }
      finally { this.busy.auth = false; }
    },
    async signOut() {
      try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.href = '/login'; }
    },
    async runTests() {
      this.testError = '';
      const d = await this.post('tests', '/api/tests/run');
      if (d.results) this.tests = d.results;
      if (!d.ok) this.testError = d.error || '';
    },
  },
});

const FindView = defineComponent({
  template: '#tpl-find',
  emits: ['toast', 'refresh'],
  data: () => ({ ...shared, LANGS, input: '', loading: false, error: '', added: [] }),
  methods: {
    async fetchIt() {
      const v = this.input.trim(); if (v.length < 8 || this.loading) return;
      this.loading = true; this.error = '';
      try {
        const r = await api('/api/web/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: v }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) this.error = d.error || $t('I could not add it.');
        else {
          const st = this.$root.agent?.settings || {};
          const fresh = (d.paths || []).length > 0;
          this.added.unshift({
            id: uid(), title: d.title || d.file, file: d.file, kind: d.kind, note: d.note, bad: d.kind === 'abstract', paths: d.paths || [],
            mode: ['economy', 'balanced', 'best'].includes(st.mode) ? st.mode : 'economy', lang: st.lang || 'both',
            state: fresh ? 'choose' : 'later',
            extra: fresh ? '' : $t('No new file appeared for processing: it is probably already in the library. See the home page.'),
          });
          this.input = ''; this.$emit('refresh');
        }
      } catch { this.error = $t('The server is not responding.'); }
      this.loading = false;
    },
    // обработката тръгва с избраните режим и език само за този файл, след преглед на токените и цената
    async process(a) {
      if (a.busy) return; a.busy = true;
      const opts = { mode: a.mode, lang: a.lang };
      try {
        if (!(await this.$root.confirmClaude({ kind: 'ingest', paths: a.paths, opts }))) { a.state = 'later'; a.extra = $t('The file is waiting to be processed on the home page.'); a.busy = false; return; }
        const r = await (await api('/api/agent/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: a.paths, opts }) })).json();
        if (r.queued) { a.state = 'queued'; this.$emit('toast', { text: $t('Claude started processing. Progress is on the home page.') }); }
        else { a.state = 'later'; a.extra = $t('Already in the queue.'); }
      } catch { this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
      a.busy = false;
    },
    modeLabel(id) { return MODES.find((m) => m.id === id)?.label || id; },
    langLabel(id) { return LANGS.find((l) => l.id === id)?.label || id; },
  },
});

const WriteView = defineComponent({
  template: '#tpl-write',
  props: { id: String, pages: Array },
  emits: ['toast'],
  data: () => ({
    ...shared, LEVELS, hints: WRITE_HINTS,
    topic: '', level: store.get('writelevel', 'local'), length: store.get('writelength', 'medium'), voice: store.get('writevoice', ''),
    loading: false, waited: 0, error: '', drafts: [], filter: '',
    doc: null, body: '', saved: '', mode: 'preview', saving: false, loadError: false, warnings: [],
    cont: { open: false, instruction: '', words: 600, level: store.get('writelevel', 'local') === 'local' ? 'medium' : store.get('writelevel', 'medium'), busy: false, waited: 0, error: '', prev: null, note: '' },
  }),
  computed: {
    dirty() { return !!this.doc && this.body !== this.saved; },
    // Статията е на езика на библиотеката (contentLang), а не на езика на интерфейса: при разминаване се казва предварително
    langNote() {
      if (!I18N.contentLang || I18N.contentLang === I18N.lang) return '';
      const name = (code) => I18N.locales.find((l) => l.code === code)?.name || code;
      return $t('The article will be in {0}, the language of the library. The interface is in {1}. To make them the same, choose the language in the sidebar language menu.', [name(I18N.contentLang), name(I18N.lang)]);
    },
    docTitle() { return this.body.match(/^#\s+(.+)$/m)?.[1] || this.doc?.title || ''; },
    wordsN() { return (this.body.match(/[\p{L}\p{N}]+/gu) || []).length; },
    html() {
      return renderMarkdown(this.body, new Set(), new Map(), {});
    },
  },
  watch: {
    id: { immediate: true, handler(id) { id ? this.load() : this.loadList(); } },
    filter() { clearTimeout(this.ft); this.ft = setTimeout(() => this.loadList(), 250); },
  },
  mounted() {
    this.onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && this.id) { e.preventDefault(); if (this.dirty) this.save(); } };
    this.onLeave = (e) => { if (this.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', this.onKey); window.addEventListener('beforeunload', this.onLeave);
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('beforeunload', this.onLeave);
    this.cancel(); this.cancelCont(); clearTimeout(this.ft);
    if (this.dirty) this.save(true); // не губим написаното при излизане от страницата
  },
  methods: {
    levelLabel(id) { return LEVELS.find((l) => l.id === id)?.label || id; },
    setLevel(id) { this.level = id; store.set('writelevel', id); },
    setLength(k) { this.length = k; store.set('writelength', k); },
    saveVoice() { store.set('writevoice', this.voice); },
    async removeDraft(d) {
      if (!confirm($t('Delete “{0}”?\n\nThe file is moved to drafts/.trash/ and can be brought back from there.', [d.title]))) return;
      try {
        const r = await (await api('/api/drafts/' + encodeURIComponent(d.id), { method: 'DELETE' })).json();
        this.$emit('toast', r.ok ? { text: $t('The text has been deleted.') } : { text: r.error || $t('I could not'), icon: 'alert' });
      } catch { this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
      await this.loadList();
    },
    async loadList() {
      try { this.drafts = await (await fetch('/api/drafts?q=' + encodeURIComponent(this.filter.trim()))).json(); } catch { this.drafts = []; }
    },
    cancel() { const ac = this.ac; this.ac = null; clearInterval(this.timer); ac?.abort(); this.loading = false; },
    async create() {
      const topic = this.topic.trim(); if (topic.length < 4 || this.loading) return;
      if (this.level !== 'local' && !(await this.$root.confirmClaude({ kind: 'write', topic, level: this.level, length: this.length, ...scopeBody() }))) return;
      this.cancel(); this.error = ''; this.loading = true; this.waited = 0;
      const ac = new AbortController(); this.ac = ac;
      this.timer = setInterval(() => { this.waited++; }, 1000);
      let out = null, err = '';
      const voice = this.level === 'local' ? '' : this.voice;
      if (this.level !== 'local') { this.topic = ''; this.voice = ''; this.saveVoice(); } // изпратено: заглавието и примерният текст се затриват
      try {
        const r = await api('/api/write', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal,
          body: JSON.stringify({ topic, level: this.level, length: this.length, voice, ...scopeBody() }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || $t('The server is not responding'));
        out = d;
      } catch (e) { err = e.name === 'AbortError' ? '' : (e.message || $t('Error')); }
      if (this.ac !== ac) return;
      clearInterval(this.timer); this.ac = null; this.loading = false;
      if (err) { // неуспешно: връщаме написаното, за да не се губи
        this.error = err;
        if (!this.topic) this.topic = topic;
        if (!this.voice && voice) { this.voice = voice; this.saveVoice(); }
        return;
      }
      if (!out) return;
      store.set('writewarn:' + out.id, JSON.stringify(out.warnings || []));
      this.$emit('toast', { text: $t('Saved to {0}', [out.path]) });
      location.hash = '#/write/' + out.id;
    },
    // Дописване с Claude: новият текст влиза в редактора (преди Заключение), записът е твой; „Върни добавеното“ го маха
    async continueDoc() {
      const c = this.cont; if (c.busy || !this.doc) return;
      const topic = c.instruction.trim() || this.docTitle;
      if (!(await this.$root.confirmClaude({ kind: 'write', topic, level: c.level, length: c.words <= 800 ? 'short' : 'medium', ...scopeBody() }))) return;
      this.cancelCont(); c.busy = true; c.error = ''; c.note = ''; c.waited = 0;
      const ac = new AbortController(); this.contAc = ac;
      this.contTimer = setInterval(() => { c.waited++; }, 1000);
      let out = null, err = '';
      try {
        const r = await api('/api/drafts/' + encodeURIComponent(this.doc.id) + '/continue', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal,
          body: JSON.stringify({ body: this.body, instruction: c.instruction, words: c.words, level: c.level, ...scopeBody() }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || $t('The server is not responding'));
        out = d;
      } catch (e) { err = e.name === 'AbortError' ? '' : (e.message || $t('Error')); }
      if (this.contAc !== ac) return;
      clearInterval(this.contTimer); this.contAc = null; c.busy = false;
      if (err) { c.error = err; return; }
      if (!out) return;
      c.prev = this.body; this.body = out.markdown; this.mode = 'preview'; c.instruction = '';
      c.note = $t('About {0} words were added ({1}). Review and press “Save”.', [out.added, out.placed]);
      if (out.warnings?.length) this.warnings = [...this.warnings, ...out.warnings];
    },
    cancelCont() { const ac = this.contAc; this.contAc = null; clearInterval(this.contTimer); ac?.abort(); this.cont.busy = false; },
    undoCont() { if (this.cont.prev == null) return; this.body = this.cont.prev; this.cont.prev = null; this.cont.note = ''; },
    async load() {
      this.cancelCont(); this.cont.prev = null; this.cont.note = '';
      this.doc = null; this.loadError = false; this.mode = 'preview';
      let w = []; try { w = JSON.parse(store.get('writewarn:' + this.id, '[]')); } catch {}
      this.warnings = w; store.set('writewarn:' + this.id, '[]');
      try {
        const r = await fetch('/api/drafts/' + encodeURIComponent(this.id));
        if (!r.ok) { this.loadError = true; return; }
        const d = await r.json();
        this.doc = d; this.body = d.body; this.saved = d.body;
        document.title = $t('{0} · Library', [d.title]);
      } catch { this.loadError = true; }
    },
    async save(quiet = false) {
      if (!this.doc || this.saving) return;
      const id = this.doc.id, body = this.body;
      this.saving = true;
      try {
        const r = await (await api('/api/drafts/' + encodeURIComponent(id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) })).json();
        if (r.ok) { this.saved = body; this.doc = { ...this.doc, title: r.title, words: r.words, updated: r.updated }; if (!quiet) this.$emit('toast', { text: $t('Saved.') }); }
        else if (!quiet) this.$emit('toast', { text: r.error || $t('I could not save it'), icon: 'alert' });
      } catch { if (!quiet) this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
      this.saving = false;
    },
    download() {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([this.body], { type: 'text/markdown;charset=utf-8' }));
      a.download = this.doc.id + '.md'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    async remove() {
      if (!confirm($t('Delete “{0}”? The file is moved to drafts/.trash/ and can be brought back from there.', [this.docTitle]))) return;
      this.saved = this.body; // без автоматичен запис при излизане
      const r = await (await api('/api/drafts/' + encodeURIComponent(this.doc.id), { method: 'DELETE' })).json();
      this.$emit('toast', r.ok ? { text: $t('Moved to drafts/.trash/') } : { text: r.error || $t('I could not'), icon: 'alert' });
      if (r.ok) location.hash = '#/write';
    },
  },
});

const GraphView = defineComponent({
  template: '#tpl-graph',
  props: { version: Number },
  data: () => ({ ...shared, nodes: [], edges: [], hover: null, loaded: false }),
  watch: { version() { this.load(); } },
  async mounted() {
    this.view = { x: 0, y: 0, k: 1 };
    this.setup();
    await this.load();
  },
  beforeUnmount() { cancelAnimationFrame(this.raf); this.ro?.disconnect(); },
  methods: {
    async load() {
      const g = await (await fetch('/api/graph')).json();
      const old = new Map((this.nodes || []).map((n) => [n.id, n]));
      const nodes = g.nodes.map((n, i) => {
        const o = old.get(n.id);
        const a = (i / Math.max(1, g.nodes.length)) * Math.PI * 2;
        return { ...n, x: o?.x ?? Math.cos(a) * 200 + Math.random() * 20, y: o?.y ?? Math.sin(a) * 200 + Math.random() * 20, vx: 0, vy: 0, r: 5 + Math.sqrt(n.degree) * 3 };
      });
      const idx = new Map(nodes.map((n) => [n.id, n]));
      this.nodes = Vue.markRaw(nodes);
      this.edges = Vue.markRaw(g.edges.map(([a, b]) => [idx.get(a), idx.get(b)]).filter(([a, b]) => a && b));
      this.loaded = true;
      this.autoFit = !this.touched;
      this.alpha = old.size ? 0.4 : 1;
      this.tick();
    },
    setup() {
      const c = this.$refs.canvas;
      const resize = () => {
        const r = c.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        c.width = r.width * dpr; c.height = r.height * dpr;
        this.dpr = dpr; this.w = r.width; this.hgt = r.height;
        this.draw();
      };
      this.ro = new ResizeObserver(resize); this.ro.observe(c);
      const toWorld = (ev) => {
        const r = c.getBoundingClientRect();
        return { sx: ev.clientX - r.left, sy: ev.clientY - r.top, x: (ev.clientX - r.left - this.w / 2 - this.view.x) / this.view.k, y: (ev.clientY - r.top - this.hgt / 2 - this.view.y) / this.view.k };
      };
      const pick = (p) => this.nodes.find((n) => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 < (n.r + 4) ** 2);
      let drag = null, moved = false;
      c.addEventListener('pointerdown', (ev) => {
        const p = toWorld(ev); const n = pick(p); moved = false; this.touched = true; this.autoFit = false;
        drag = n ? { node: n } : { pan: true, x0: ev.clientX - this.view.x, y0: ev.clientY - this.view.y };
        c.setPointerCapture(ev.pointerId);
      });
      c.addEventListener('pointermove', (ev) => {
        const p = toWorld(ev);
        if (drag?.node) { drag.node.x = p.x; drag.node.y = p.y; drag.node.fixed = true; moved = true; this.alpha = Math.max(this.alpha, 0.3); this.tick(); }
        else if (drag?.pan) { this.view.x = ev.clientX - drag.x0; this.view.y = ev.clientY - drag.y0; moved = true; this.draw(); }
        else { const n = pick(p); this.hover = n ? { title: n.title, x: p.sx, y: p.sy, id: n.id } : null; c.style.cursor = n ? 'pointer' : ''; this.draw(); }
      });
      c.addEventListener('pointerup', (ev) => {
        if (drag?.node) { drag.node.fixed = false; if (!moved) location.hash = '#/p/' + drag.node.id; }
        drag = null;
      });
      c.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        this.touched = true; this.autoFit = false;
        const k = Math.min(4, Math.max(0.2, this.view.k * Math.exp(-ev.deltaY * 0.0015)));
        const r = c.getBoundingClientRect();
        const mx = ev.clientX - r.left - this.w / 2, my = ev.clientY - r.top - this.hgt / 2;
        this.view.x = mx - (mx - this.view.x) * (k / this.view.k);
        this.view.y = my - (my - this.view.y) * (k / this.view.k);
        this.view.k = k; this.draw();
      }, { passive: false });
    },
    tick() {
      cancelAnimationFrame(this.raf);
      const step = () => {
        const N = this.nodes, a = this.alpha;
        for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
          const p = N[i], q = N[j]; let dx = q.x - p.x, dy = q.y - p.y; let d2 = dx * dx + dy * dy || 0.01;
          const f = (2600 / d2) * a; const d = Math.sqrt(d2);
          dx /= d; dy /= d; p.vx -= dx * f; p.vy -= dy * f; q.vx += dx * f; q.vy += dy * f;
        }
        for (const [p, q] of this.edges) {
          const dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - 130) * 0.02 * a;
          p.vx += (dx / d) * f; p.vy += (dy / d) * f; q.vx -= (dx / d) * f; q.vy -= (dy / d) * f;
        }
        for (const n of N) {
          n.vx -= n.x * 0.004 * a; n.vy -= n.y * 0.004 * a;
          if (!n.fixed) { n.x += n.vx; n.y += n.vy; }
          n.vx *= 0.6; n.vy *= 0.6;
        }
        this.alpha *= 0.985;
        if (this.autoFit) this.fit();
        this.draw();
        if (this.alpha > 0.02) this.raf = requestAnimationFrame(step);
        else this.autoFit = false;
      };
      this.raf = requestAnimationFrame(step);
    },
    // Мащабира и центрира, така че всички точки да се виждат (докато потребителят не пипне картата)
    fit() {
      if (!this.nodes.length || !this.w) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of this.nodes) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r + 18); }
      const padX = 120, padTop = 150, padBottom = 110;
      const k = Math.min(2.2, (this.w - padX * 2) / Math.max(1, x1 - x0), (this.hgt - padTop - padBottom) / Math.max(1, y1 - y0));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      this.view.k = Math.max(0.2, k);
      this.view.x = -cx * this.view.k;
      this.view.y = -cy * this.view.k + (padTop - padBottom) / 2;
    },
    draw() {
      const c = this.$refs.canvas; if (!c || !this.w) return;
      const ctx = c.getContext('2d');
      const dark = document.documentElement.classList.contains('dark');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.hgt);
      ctx.translate(this.w / 2 + this.view.x, this.hgt / 2 + this.view.y);
      ctx.scale(this.view.k, this.view.k);
      const hid = this.hover?.id;
      const near = new Set(hid ? this.edges.flatMap(([p, q]) => (p.id === hid ? [q.id] : q.id === hid ? [p.id] : [])) : []);
      for (const [p, q] of this.edges) {
        const on = hid && (p.id === hid || q.id === hid);
        ctx.strokeStyle = on ? (dark ? 'rgba(177,211,198,.8)' : 'rgba(47,111,98,.7)') : dark ? 'rgba(255,255,255,.09)' : 'rgba(38,35,30,.1)';
        ctx.lineWidth = (on ? 1.6 : 1) / this.view.k;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      for (const n of this.nodes) {
        const dim = hid && n.id !== hid && !near.has(n.id);
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.fillStyle = (TYPES[n.type] || TYPES.other).hex;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = dark ? '#12110f' : '#fffdf9'; ctx.lineWidth = 2 / this.view.k; ctx.stroke();
        if (this.view.k > 0.7 && (n.degree > 1 || this.view.k > 1.3 || n.id === hid || near.has(n.id))) {
          ctx.fillStyle = dark ? 'rgba(236,231,221,.85)' : 'rgba(38,35,30,.8)';
          ctx.font = `${n.id === hid ? 600 : 500} ${12 / this.view.k}px Inter Variable, system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText(n.title.length > 28 ? n.title.slice(0, 27) + '…' : n.title, n.x, n.y + n.r + 13 / this.view.k);
        }
      }
      ctx.globalAlpha = 1;
    },
  },
});

// ---------- Приложение ----------
// Начало на архива (само за четене): броячи, последни промени и етикети. Заменя началната страница с Claude.
const ArchiveHome = defineComponent({
  template: '#tpl-archive-home',
  props: { stats: Object },
  data: () => ({ ...shared, meta: window.LIB_ARCHIVE_META || {} }),
});

function parseRoute() {
  const [hashPath, hashQuery = ''] = location.hash.split('?');
  const parts = hashPath.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (!parts[0]) return { name: 'home' };
  if (parts[0] === 'p' && parts[1]) return { name: 'page', slug: parts[1] };
  if (parts[0] === 'c' && parts[1]) return { name: 'collection', type: parts[1] };
  if (parts[0] === 'tag' && parts[1]) return { name: 'tag', tag: parts[1] };
  if (parts[0] === 'graph') return { name: 'graph' };
  if (parts[0] === 'write') return { name: 'write', id: parts[1] || '' };
  if (parts[0] === 'find') return { name: 'find' };
  if (parts[0] === 'areas') return { name: 'areas' };
  if (parts[0] === 'setup') return { name: 'setup' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'path') return { name: 'path', q: parts.slice(1).join('/'), mode: new URLSearchParams(hashQuery).get('m') || 'local' };
  return { name: 'page', slug: parts[0] }; // стари връзки #/slug
}

const app = createApp({
  template: '#tpl-app',
  data: () => ({
    ...shared, I18N, route: parseRoute(), pages: [], stats: {}, version: 0, live: false, setupLeft: 0,
    drawer: false, palette: false, pq: '', hits: [], pi: 0, toasts: [], agent: null, reader: null, cost: null,
    focus: store.get('focus', '0') === '1', // режим фокус: само текстът на страницата (запомня се на този компютър)
    theme: store.get('theme', 'system'), isMac: /Mac|iPhone|iPad/.test(navigator.platform),
  }),
  computed: {
    focusOn() { return this.focus && this.route.name === 'page' && !['index', 'log', 'overview'].includes(this.route.slug); },
    countBy() { return this.pages.reduce((a, p) => (p.special ? a : ((a[p.type] = (a[p.type] || 0) + 1), a)), {}); },
    paletteItems() {
      if (this.pq.trim().length >= 2) return this.hits;
      return [...this.pages].filter((p) => !p.special).sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))).slice(0, 8);
    },
  },
  methods: {
    setFocus(v) { this.focus = !!v; store.set('focus', v ? '1' : '0'); },
    // В архива екраните, които пишат или викат Claude, не работят: връщаме към началото
    guardArchive() { if (window.LIB_STATIC && ['path', 'write', 'find', 'areas', 'setup', 'settings'].includes(this.route.name)) location.hash = '#/'; },
    async refresh() {
      const [pages, stats] = await Promise.all([fetch('/api/pages').then((r) => r.json()), fetch('/api/stats').then((r) => r.json())]);
      this.pages = pages; this.stats = stats;
    },
    toast({ text, icon }) {
      const t = { id: Math.random(), text, icon };
      this.toasts.push(t);
      setTimeout(() => (this.toasts = this.toasts.filter((x) => x.id !== t.id)), 3500);
    },
    // Смяната на езика от менюто: ако обработката работи, сървърът отказва; селекторът се връща и се показва причината
    async changeLang(e) {
      const r = await I18N.setLang(e.target.value);
      if (!r.ok) { e.target.value = I18N.lang; this.toast({ text: r.error, icon: 'alert' }); }
    },
    // Оценка на токени и цена преди всяко действие с Claude. Връща true, ако човекът потвърди.
    async confirmClaude(spec) {
      if (this.agent?.settings && this.agent.settings.confirmCost === false) return true;
      if (this.cost) this.costAnswer(false);
      return new Promise((resolve) => {
        this.cost = { spec, est: null, loading: true, error: '', never: false, resolve };
        api('/api/estimate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec) })
          .then((r) => r.json()).then((d) => {
            if (!this.cost || this.cost.resolve !== resolve) return;
            if (d.ok) this.cost.est = d; else this.cost.error = d.error || $t('The estimate failed.');
            this.cost.loading = false;
          }).catch(() => { if (this.cost?.resolve === resolve) { this.cost.error = $t('The server is not responding.'); this.cost.loading = false; } });
      });
    },
    async costAnswer(ok) {
      const c = this.cost; if (!c) return; this.cost = null;
      if (ok && c.never) { try { await api('/api/agent/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmCost: false }) }); } catch {} }
      c.resolve(!!ok);
    },
    fmtUsd(v) { return v < 0.005 ? $t('under $0.01') : '$' + v.toFixed(v < 1 ? 2 : 2).replace('.', ','); },
    fmtTok(n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + $t(' M') : n >= 1000 ? (Math.round(n / 100) / 10 + '').replace('.', ',') + $t(' K') : String(n); },
    async copy(text) {
      if (await copyText(text)) this.toast({ text: $t('Copied'), icon: 'copy' });
      else this.toast({ text: $t('I could not copy'), icon: 'alert' });
    },
    setTheme(m) {
      this.theme = m; store.set('theme', m);
      const dark = m === 'dark' || (m === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
      this.version++; // графът се прерисува с новите цветове
    },
    // ---------- Четец ----------
    async openReader(src, page) {
      this.reader = { src, page, loading: true, data: null, error: null };
      await this.loadReader(src, page);
    },
    async loadReader(src, page) {
      try {
        const r = await fetch(`/api/reader?src=${encodeURIComponent(src)}${page ? '&page=' + page : ''}`);
        const d = await r.json();
        if (!this.reader) return;
        this.reader = r.ok ? { src, page: d.page, loading: false, data: d } : { src, page, loading: false, error: d.error };
        this.$nextTick(() => this.$refs.readerBody?.scrollTo({ top: 0 }));
      } catch { if (this.reader) this.reader = { src, page, loading: false, error: $t('The server is not responding') }; }
    },
    readerGo(d) {
      const r = this.reader?.data; if (!r?.unit) return;
      const n = Math.min(r.last, Math.max(r.first, r.page + d));
      if (n !== r.page) this.loadReader(this.reader.src, n);
    },
    async loadAgent() { try { this.agent = await (await fetch('/api/agent')).json(); } catch {} this.loadSetup(); },
    // Точка в менюто, ако нещо задължително липсва; при първо влизане отваря екрана за инсталация
    async loadSetup() {
      try {
        const s = await (await fetch('/api/setup')).json();
        this.setupLeft = s.blocking;
        if (s.blocking && !this.agent?.settings?.setupDone && this.route.name === 'home') location.hash = '#/setup';
      } catch {}
    },
    openPalette() { this.palette = true; this.pq = ''; this.hits = []; this.pi = 0; this.$nextTick(() => this.$refs.paletteInput?.focus()); },
    paletteSearch() {
      clearTimeout(this._t); this.pi = 0;
      this._t = setTimeout(async () => {
        this.hits = this.pq.trim().length >= 2 ? await (await fetch('/api/search?q=' + encodeURIComponent(this.pq.trim()))).json() : [];
      }, 150);
    },
    paletteKeys(e) {
      const n = this.paletteItems.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.pi = (this.pi + 1) % Math.max(n, 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.pi = (this.pi - 1 + n) % Math.max(n, 1); }
      else if (e.key === 'Enter' && this.paletteItems[this.pi]) { location.hash = '#/p/' + this.paletteItems[this.pi].slug; this.palette = false; }
      else if (e.key === 'Escape') this.palette = false;
    },
    connect() {
      const es = new EventSource('/api/events');
      es.onopen = () => (this.live = true);
      es.onerror = () => (this.live = false);
      es.onmessage = (e) => {
        this.live = true;
        let d = {}; try { d = JSON.parse(e.data); } catch {}
        if (d.type === 'agent') { this.agent = d.state; return; }
        clearTimeout(this._rt);
        this._rt = setTimeout(() => { this.refresh(); this.version++; }, 250);
      };
    },
  },
  async mounted() {
    window.addEventListener('hashchange', () => { this.route = parseRoute(); this.drawer = false; if (this.route.name !== 'page') document.title = $t('Library'); this.guardArchive(); });
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.palette ? (this.palette = false) : this.openPalette(); }
      else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); this.openPalette(); }
      else if (e.key === 'Escape') {
        if (this.focusOn && !this.reader && !this.palette && !this.drawer) this.setFocus(false); // Esc излиза от фокуса
        this.palette = false; this.drawer = false; this.reader = null;
      }
      else if (this.reader && !this.palette && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); this.readerGo(e.key === 'ArrowRight' ? 1 : -1); }
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.theme === 'system' && this.setTheme('system'));
    this.guardArchive();
    await Promise.all([this.refresh(), window.LIB_STATIC ? null : this.loadAgent()]);
    if (!window.LIB_STATIC) this.connect(); // архивът няма сървър и живи събития
  },
});

app.config.globalProperties.$t = $t;
app.component('ic', Ic);
app.component('page-card', PageCard);
app.component('home-view', HomeView);
app.component('page-view', PageView);
app.component('collection-view', CollectionView);
app.component('graph-view', GraphView);
app.component('path-view', PathView);
app.component('write-view', WriteView);
app.component('find-view', FindView);
app.component('areas-view', AreasView);
app.component('setup-view', SetupView);
app.component('settings-view', SettingsView);
app.component('scope-bar', ScopeBar);
app.component('view-toggle', ViewToggle);
app.component('archive-home', ArchiveHome);
app.mount('#app');
