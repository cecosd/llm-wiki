/* Library: the interface (Vue 3, no build step). */
const { createApp, defineComponent, h, reactive } = Vue;
const I18N = window.I18N; // language and translations: see /locale.js and i18n.js

// ---------- Dictionaries ----------
const TYPES = {
  chapter:    { label: $t('Chapter'),     plural: $t('Chapters'),     icon: 'bookmark', hex: '#dba27c', soft: 'bg-clay-100/70 text-clay-500 dark:bg-clay-500/10 dark:text-clay-400', desc: $t('The chapters of books: the step between the book and the text itself.') },
  source:     { label: $t('Source'),  plural: $t('Sources'), icon: 'book',    hex: '#c2703d', soft: 'bg-clay-100 text-clay-500 dark:bg-clay-500/15 dark:text-clay-400', desc: $t('Books, articles and tables that {ai} has read and summarized.') },
  concept:    { label: $t('Concept'),   plural: $t('Concepts'),   icon: 'bulb',    hex: '#3f8571', soft: 'bg-sage-50 text-sage-600 dark:bg-sage-900/50 dark:text-sage-200', desc: $t('Ideas, theories and methods gathered from all sources.') },
  entity:     { label: $t('Person'),   plural: $t('People'),  icon: 'user',    hex: '#7c6bb8', soft: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300', desc: $t('Authors, schools, organizations and tools.') },
  topic:      { label: $t('Topic'),      plural: $t('Topics'),      icon: 'compass', hex: '#3b82a6', soft: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', desc: $t('Hubs that gather concepts and sources around one field.') },
  comparison: { label: $t('Comparison'), plural: $t('Comparisons'), icon: 'scale',   hex: '#c0507a', soft: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300', desc: $t('Approaches and authors set side by side.') },
  question:   { label: $t('Question'),    plural: $t('Questions'),   icon: 'help',    hex: '#8a8a3a', soft: 'bg-lime-50 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300', desc: $t('Saved answers to questions you asked the library.') },
  other:      { label: $t('Page'),  plural: $t('Other'),     icon: 'file',    hex: '#9d958a', soft: 'bg-ink/5 text-muted dark:bg-white/10', desc: '' },
};
const typeOrder = ['source', 'concept', 'entity', 'topic', 'comparison', 'question'];
// The order of the kinds in the menu until the person changes it (unknown kinds go after them in alphabetical order)
const NAV_ORDER = ['source', 'chapter', 'concept', 'entity', 'topic', 'comparison', 'question'];
/** The description of a kind. A kind that is not in TYPES (a new kind in wiki/) is shown under its own name. */
const typeInfo = (t) => {
  if (TYPES[t]) return TYPES[t];
  const name = t ? String(t)[0].toUpperCase() + String(t).slice(1) : TYPES.other.label;
  return { ...TYPES.other, label: name, plural: name };
};
// The person's collections (outputs/collections.json): smart (by filter) and manual lists
const COL_STYLE = {
  smart: { icon: 'filter', soft: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  list: { icon: 'bookmark', soft: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' },
};
/** Whether the page falls into a smart collection: AND between the fields, OR between the values in one field. */
function matchFilter(p, f = {}) {
  if (!p || p.special) return false;
  const any = (a) => Array.isArray(a) && a.length > 0;
  if (any(f.types) && !f.types.includes(p.type)) return false;
  if (any(f.tags) && !f.tags.some((t) => (p.tags || []).includes(t))) return false;
  if (any(f.areas) && !f.areas.includes(p.area)) return false;
  if (any(f.formats) && !f.formats.includes(p.format)) return false;
  if (any(f.confidence) && !f.confidence.includes(p.confidence)) return false;
  if (any(f.status) && !f.status.includes(p.status)) return false;
  if (f.author && ![].concat(p.authors || []).join('; ').toLowerCase().includes(String(f.author).toLowerCase())) return false;
  if (f.yearFrom || f.yearTo) {
    const y = Number(String(p.year ?? '').match(/\d{4}/)?.[0]);
    if (!y || (f.yearFrom && y < f.yearFrom) || (f.yearTo && y > f.yearTo)) return false;
  }
  if (f.q) {
    const q = String(f.q).toLowerCase();
    if (![p.title, ...(p.aliases || [])].some((s) => String(s || '').toLowerCase().includes(q))) return false;
  }
  return true;
}
/** The filter in words, for the subtitle of a smart collection */
function filterSummary(f = {}) {
  const bits = [];
  const join = (a) => a.join(', ');
  if (f.types?.length) bits.push(join(f.types.map((t) => typeInfo(t).plural)));
  if (f.tags?.length) bits.push($t('tag: {0}', [join(f.tags.map((t) => '#' + t))]));
  if (f.areas?.length) bits.push($t('area: {0}', [join(f.areas)]));
  if (f.formats?.length) bits.push(join(f.formats.map((x) => FORMATS[x] || x)));
  if (f.confidence?.length) bits.push($t('confidence: {0}', [join(f.confidence.map((x) => CONF[x]?.label || x))]));
  if (f.status?.length) bits.push(join(f.status.map((x) => STATUS[x] || x)));
  if (f.author) bits.push($t('author: {0}', [f.author]));
  if (f.yearFrom && f.yearTo) bits.push($t('years {0} to {1}', [f.yearFrom, f.yearTo]));
  else if (f.yearFrom) bits.push($t('from {0}', [f.yearFrom]));
  else if (f.yearTo) bits.push($t('until {0}', [f.yearTo]));
  if (f.q) bits.push($t('title contains “{0}”', [f.q]));
  return bits.length ? bits.join(' · ') : $t('all pages');
}
// The kinds of entries in the log (wiki/log.md)
const LOG_KINDS = {
  ingest: { label: $t('processing'), dot: 'bg-clay-400' },
  upgrade: { label: $t('upgrade'), dot: 'bg-amber-400' },
  synthesis: { label: $t('synthesis'), dot: 'bg-sky-500' },
  query: { label: $t('question'), dot: 'bg-lime-500' },
  lint: { label: $t('check'), dot: 'bg-teal-500' },
  refactor: { label: $t('restructuring'), dot: 'bg-violet-400' },
  inbox: { label: $t('inbox'), dot: 'bg-sage-400' },
};
const logLabel = (k) => LOG_KINDS[k]?.label || k || $t('other');
const logColor = (k) => LOG_KINDS[k]?.dot || 'bg-muted';
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
// The chosen model (providers.js through /locale.js): the name for "{ai}", the way of working and the models of the three levels.
// With Claude the levels are Haiku, Sonnet and Opus; with another provider they are the models chosen in "Settings -> Model".
const AI = window.AI || { name: 'Claude', engine: 'agent', tools: true, claude: true, subscription: true, tierNames: {}, labels: {} };
const TN = { light: AI.tierNames?.light || $t('Light'), medium: AI.tierNames?.medium || $t('Medium'), strong: AI.tierNames?.strong || $t('Powerful') };
/** Where the data goes in an action with the model (for the short notes in the interface) */
const dataNote = () => (AI.engine === 'manual' ? $t('you paste it into the chat yourself')
  : AI.local ? $t('it stays on this computer')
  : AI.subscription ? $t('sent to Anthropic through your subscription')
  : $t('sent to {0}', [AI.vendor || AI.name]));
const MODES = [
  { id: 'economy', label: $t('Economy'), hint: $t('{0} reads the chapters, {1} writes the pages. Uses the least of your limit; for large numbers of books.', [TN.light, TN.medium]) },
  { id: 'balanced', label: $t('Balanced'), hint: $t('{0} reads and writes. A finer reading, moderate cost.', [TN.medium]) },
  { id: 'best', label: $t('Best'), hint: $t('{0} reads and writes. The most thorough, but uses up the limit fastest.', [TN.strong]) },
];
const MODEL_OPTS = [
  { id: 'haiku', label: $t('{0} (cheapest)', [TN.light]) },
  { id: 'sonnet', label: $t('{0} (balanced)', [TN.medium]) },
  { id: 'opus', label: $t('{0} (most powerful)', [TN.strong]) },
];
const FOLDERS = { books: $t('book'), papers: $t('paper'), articles: $t('text'), web: $t('web'), data: $t('table'), notes: $t('note'), images: $t('picture'), other: $t('other') };

// ---------- Helpers ----------
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
// crypto.randomUUID and navigator.clipboard work only in a "secure context" (https or localhost).
// On http://my.wiki the browser does not consider it one, so fallbacks are needed.
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

// How much of the program to show. The names are a joke on purpose: nobody should feel silly for starting at the bottom.
// The level only hides menu items and settings sections; every address still works if you type it.
const USE_LEVELS = [
  { id: 'bookworm', icon: 'book', name: $t('Bookworm'), tagline: $t('I just want to read and ask questions'),
    text: $t('Reading, searching, learning by question and writing. Everything technical stays out of sight.') },
  { id: 'librarian', icon: 'list', name: $t('Librarian'), tagline: $t('I add books and look after the shelves'),
    text: $t('Adds the tools for new sources, areas, the log, the setup check, privacy and archives.') },
  { id: 'keeper', icon: 'key', name: $t('Keeper of the Scrolls'), tagline: $t('Show me every switch'),
    text: $t('Everything: safe mode, the site address, the tests and all the other settings.') },
];
const USE_ORDER = USE_LEVELS.map((l) => l.id);
const useState = reactive({ id: (() => { const v = store.get('use:level', 'librarian'); return USE_ORDER.includes(v) ? v : 'librarian'; })() });
/** True when the chosen level is the given one or a higher one */
const atLeast = (id) => USE_ORDER.indexOf(useState.id) >= USE_ORDER.indexOf(id);
const setUseLevel = (id) => { if (USE_ORDER.includes(id)) { useState.id = id; store.set('use:level', id); } };

// The reader: live - all sources and chapters; in the archive - only the texts that are saved in it (LIB_STATIC.readerOf)
const readerOk = (type, slug) => ['source', 'chapter'].includes(type) && (!window.LIB_STATIC || Object.prototype.hasOwnProperty.call(window.LIB_STATIC.readerOf || {}, slug));

// Common helpers, available in all templates
// ro: the archive for reading (see archive.js). There are no writes, no Claude and no paths to raw/ there.
const shared = { USE_LEVELS, useState, atLeast, setUseLevel, MODEL_OPTS, MODES, TYPES, typeOrder, typeInfo, COL_STYLE, filterSummary, logLabel, logColor, KINDS, FORMATS, FORMAT_ICON, FORMAT_BG, STATUS, CONF, relDate, size, plural, fileIcon, ro: !!window.LIB_STATIC, AI, TN, dataNote };

// ---------- Icons (line, 24x24) ----------
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
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
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
  panel: 'M4 5h16v14H4zM9 5v14',
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
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2',
  power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  docs: 'M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h8',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  route: 'M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 18h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  filter: 'M4 5h16l-6 7.5V18l-4 2v-7.5z',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1Q11.3 5 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7q2.3 0 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4',
  cloud: 'M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9.5 4.5 4.5 0 0 1 17.5 18H7zM12 12v5M9.5 14.5 12 12l2.5 2.5',
  shield: 'M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z',
  key: 'M7.5 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM11 12h10M17 12v3M20 12v2',
  box: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
};
const Ic = defineComponent({
  props: { name: String },
  setup: (props) => () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    [h('path', { d: ICONS[props.name] || ICONS.file })]),
});

// ---------- Markdown with [[wikilinks]] ----------
// The page numbers ("p. 53") become links to the reader: after [[source]] they point to it,
// and the standalone ones point to the source of the current page (if there is one).
const PAGE_RE = '(' + (I18N.pageUnits || 'с\\.|стр\\.|разд\\.|pp?\\.|sect\\.') + ')\\s*(\\d+)(?:\\s*[-–]\\s*\\d+)?';
function renderMarkdown(content, known, titles, opts = {}) {
  let body = content.replace(/^\s*#\s+.*\n/, ''); // the title is shown at the top
  if (opts.stripSection) body = body.replace(new RegExp(`^##\\s+${opts.stripSection}\\s*\\n[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`, 'm'), '');
  const wl = (target, alias) => {
    const slug = target.trim().split('/').pop();
    const ok = known.has(slug);
    const label = alias || titles.get(slug) || slug;
    return { slug, html: `<a class="wl${ok ? '' : ' missing'}" data-slug="${esc(slug)}" href="#/p/${encodeURIComponent(slug)}"${ok ? '' : ` title="${esc($t('This page does not exist yet'))}"`}>${esc(label)}</a>` };
  };
  const pg = (src, num, text) => `<a class="pg" data-src="${esc(src)}" data-page="${num}" title="${esc($t('Open in the reader'))}">${esc(text)}</a>`;
  // 1) [[source]], p. N
  body = body.replace(new RegExp(`\\[\\[([^\\]|#]+)(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\](,\\s*)${PAGE_RE}`, 'g'), (m, t, a, sep, unit, num) => {
    const w = wl(t, a);
    const readable = opts.readable ? opts.readable(w.slug) : known.has(w.slug);
    return w.html + sep + (readable ? pg(w.slug, num, m.slice(m.indexOf(sep) + sep.length)) : m.slice(m.indexOf(sep) + sep.length));
  });
  // 2) the other [[links]]
  body = body.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t, a) => wl(t, a).html);
  // 3) a standalone "p. N" on a page with a source
  if (opts.readerSrc) body = body.replace(new RegExp(`(?<![>\\w])${PAGE_RE}`, 'g'), (m, unit, num) => pg(opts.readerSrc, num, m));
  return sanitizeHtml(marked.parse(body, { gfm: true }));
}

// ---------- Sanitising HTML ----------
// The text comes from documents and from Claude, so it is not trusted: only safe elements, attributes and addresses stay.
// It is parsed in an inert document (nothing in it runs or loads). The second protection is the Content-Security-Policy.
const SAFE_TAGS = new Set('A ABBR B BLOCKQUOTE BR CAPTION CITE CODE DD DEL DETAILS DFN DIV DL DT EM FIGCAPTION FIGURE H1 H2 H3 H4 H5 H6 HR I IMG INPUT INS KBD LI MARK OL P PRE Q S SAMP SMALL SPAN STRONG SUB SUMMARY SUP TABLE TBODY TD TFOOT TH THEAD TR U UL VAR'.split(' '));
const DROP_WITH_CONTENT = new Set('SCRIPT STYLE IFRAME FRAME FRAMESET OBJECT EMBED APPLET NOSCRIPT NOEMBED NOFRAMES TEMPLATE SVG MATH TITLE TEXTAREA XMP PLAINTEXT LISTING LINK META BASE FORM SELECT BUTTON AUDIO VIDEO SOURCE TRACK CANVAS MARQUEE'.split(' '));
const SAFE_ATTRS = {
  A: ['href', 'title', 'class', 'data-slug', 'data-src', 'data-page'], IMG: ['src', 'alt', 'title'], CODE: ['class'],
  TD: ['align', 'colspan', 'rowspan'], TH: ['align', 'colspan', 'rowspan', 'scope'], OL: ['start'], DETAILS: ['open'],
  INPUT: ['type', 'checked', 'disabled'], ABBR: ['title'], DFN: ['title'],
};
const SAFE_CLASS = /^(wl|pg|missing|language-[\w-]+)$/; // a foreign class could cover the screen with a misleading element

function safeUrl(value, isImage) {
  // The browser ignores control and invisible characters in the address, so the check must not see them either.
  const v = [...String(value)].filter((c) => { const n = c.codePointAt(0); return n > 32 && !(n >= 127 && n <= 160) && !(n >= 8203 && n <= 8207) && n !== 8232 && n !== 8233 && n !== 65279; }).join('');
  const scheme = v.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  // A picture from a foreign address loads by itself, without a click, and can carry data out in its address. In the application the CSP
  // stops it, but the archive for reading opens from disk without a CSP, so only embedded and local pictures stay here.
  if (!scheme) return !v.startsWith('\\') && !(isImage && v.startsWith('//'));
  if (isImage) return /^data:image\/(png|jpe?g|gif|webp);/i.test(v);
  return scheme === 'https' || scheme === 'http' || scheme === 'mailto';
}

function cleanNode(parent) {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === 3) continue; // text
    if (node.nodeType !== 1) { node.remove(); continue; } // comments and everything else
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
    if (tag === 'INPUT') { // only the checkboxes of Markdown lists stay
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

// ---------- Components ----------
const ViewToggle = defineComponent({
  template: '#tpl-viewtoggle',
  props: { modelValue: String },
  emits: ['update:modelValue'],
});

const PageCard = defineComponent({
  template: '#tpl-card',
  props: { p: Object, big: Boolean },
  computed: { T() { return typeInfo(this.p.type); } },
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
        { title: $t('Process'), text: $t('{ai} reads them and writes the pages.') },
        { title: $t('Explore'), text: $t('Search, follow links, ask the library.') },
      ];
    },
    lastJob() { return this.agent?.history?.[0] || null; },
    // the choice of models: the explicit one, otherwise the one from the mode
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
    copy(t) { this.$root.copy(t); },
    isRecent: (j) => Date.now() - new Date(j.finishedAt).getTime() < 36 * 3600e3,
    async post(url, body) {
      const r = await api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
      return r.json();
    },
    async start() {
      if (!(await this.$root.confirmClaude({ kind: 'ingest' }))) return;
      const r = await this.post('/api/agent/ingest');
      this.$emit('toast', r.queued ? { text: $t('{ai} started: {0} {1} in the queue', [r.queued, plural(r.queued, $t('file'), $t('files'))]) } : { text: $t('They are already in the queue'), icon: 'alert' });
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
    // a file you do not want: it is moved to raw/.trash/ (not lost for good)
    async discard(body, name) {
      if (!confirm($t('Remove “{0}”?\n\nThe file is moved to raw/.trash/ and is not processed. You can bring it back from there by hand.', [name]))) return;
      const r = await this.post('/api/raw/discard', body);
      this.$emit('toast', r.ok ? { text: $t('The file has been removed.') } : { text: r.error || $t('I could not'), icon: 'alert' });
      this.$emit('refresh');
    },
    // a ready mode changes both model choices
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
          : r.queued ? { text: $t('Sorted. {ai} started processing ({0}).', [r.queued]) } : { text: $t('Sorted.') });
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
    ...shared, LEVELS, rename: { on: false, value: '', busy: false }, man: { open: false, md: '', before: '', hash: '', busy: false, error: '' }, page: null, error: false, loading: false, loadStage: 'ask', waited: 0, toc: [], activeH: null, observer: null, chapView: store.get('view:chapters', 'cards'),
    selBtn: null, lk: { open: false, sel: '', q: '', busy: false, error: '' }, listMenu: false,
    ai: { open: false, intent: 'ask', sel: '', question: '', level: store.get('asklevel', 'medium'), busy: false, busy2: false, waited: 0, error: '', answer: '', asked: '', proposal: null, saved: false, applied: null },
  }),
  computed: {
    T() { return typeInfo(this.page?.type); },
    // the manual lists and whether the page is in them (the "List" button)
    myLists() { return (this.$root.collections?.items || []).filter((c) => c.kind === 'list').map((c) => ({ ...c, has: c.slugs.includes(this.page?.slug) })); },
    inLists() { return this.myLists.filter((c) => c.has).length; },
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
    // Focus mode applies to all pages of the collections (in the archive too)
    canFocus() { return !!this.page && !['index', 'log', 'overview'].includes(this.page.slug); },
    // the pages that can be linked to from the selected text: without the service ones and without the current one
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
    // "Pointing here": the chapters are grouped under their book
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
    // For a page that is linked but not written yet: what the agent is doing about it right now
    buildState() {
      const a = this.$root.agent;
      if (a?.current) {
        const c = a.current;
        return { kind: 'working', label: c.label, index: c.index, total: c.total, steps: c.steps.slice(-5), created: c.created.length, updated: c.updated.length };
      }
      if (a?.queue?.length) return { kind: 'queued', waiting: a.queue.length };
      return { kind: 'idle' };
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
    slug: { immediate: true, handler(s, old) { if (old !== undefined && s !== old) { this.resetAi(); this.rename.on = false; this.man.open = false; this.lk.open = false; this.listMenu = false; } this.load(s !== old); } },
    version() { this.load(false); },
    html() { this.$nextTick(this.buildToc); },
  },
  methods: {
    inline: (s) => sanitizeHtml(marked.parseInline(String(s))),
    async load(scrollTop = true) {
      // a progress line while the page opens: the stage and the seconds waited (the previous page stays until the new one is ready)
      const mine = (this._loadId = (this._loadId || 0) + 1);
      this.loadStage = 'ask'; this.waited = 0; this.loading = true;
      const t0 = Date.now();
      clearInterval(this._waitTimer);
      this._waitTimer = setInterval(() => { this.waited = Math.floor((Date.now() - t0) / 1000); }, 500);
      try {
        const r = await fetch('/api/page/' + encodeURIComponent(this.slug));
        this.loadStage = 'read';
        if (mine !== this._loadId) return; // another page was opened meanwhile
        if (!r.ok) { this.error = true; this.page = null; document.title = $t('Missing · Library'); return; }
        this.error = false;
        this.page = await r.json();
      } finally { if (mine === this._loadId) { clearInterval(this._waitTimer); this.loading = false; } }
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
    // --- Manual lists: the page enters or leaves a list; a new list starts with it ---
    toggleList(c) { this.$root.listChange(c.id, c.has ? { remove: this.page.slug } : { add: this.page.slug }, c.has ? $t('Removed from “{0}”', [c.name]) : $t('Added to “{0}”', [c.name])); },
    newListWithPage() { this.listMenu = false; this.$root.openColEditor({ kind: 'list', slugs: [this.page.slug] }); },
    // --- Manual renaming and editing (without Claude; the links between the pages do not change) ---
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
    // Removes the paragraph together with the links in it; a confirmation with the passage and the list of the links, "Undo" cancels it
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
    // Link: the selected text becomes [[page]] (or [[page|text]]); the dialog shows the collection to choose from
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
    // --- The helper of the page ---
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
    // a common request to Claude with "Cancel" and counting of the seconds
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
      this.ai.question = ''; // the question is sent: the field is clean for the next request
      const d = await this.aiCall('/api/ask', { slug: this.page.slug, question: q, selection: this.ai.sel, level: this.ai.level });
      if (!d) { if (!this.ai.question) this.ai.question = q; return; } // a failure or a refusal: the question returns to the field
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
      if (mode === 'selection') this.ai.question = ''; // the instruction is sent
      const d = await this.aiCall('/api/improve', body);
      if (!d) { if (mode === 'selection' && !this.ai.question) this.ai.question = body.instruction; return; }
      this.ai.proposal = d; this.ai.applied = null;
      this.$nextTick(() => this.$refs.aiBody?.scrollTo({ top: 9999, behavior: 'smooth' }));
    },
    // the answer becomes the new text of the page (or of the selected passage): first a "before, after" review, then a confirmation
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

// A key for alphabetical order: persons are ordered by surname (the last word), the rest by title
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
// The alphabets: first Bulgarian (Cyrillic), then English (Latin), finally the rest
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
  // type: kind of pages (#/c/source); tag: a tag (#/tag/x); cid: a collection of the person (#/col/<id>)
  props: { pages: Array, type: String, tag: String, cid: String },
  emits: ['toast'],
  data: () => ({
    ...shared, SCRIPT_LABEL, filter: '', sort: 'title', fmt: 'all', view: 'cards', letter: '',
    dupes: { pairs: [], authors: [] }, dupOpen: false, dupKeep: {}, authCanon: {}, dupPlan: null, dupBusy: false,
    mergeOpen: false, mergeTitle: '', mergePick: [], mergePlan: null, mergeBusy: false,
  }),
  created() { this.view = store.get('view:' + this.viewKey, 'cards'); this.sort = store.get(this.sortKey, this.isList ? 'manual' : 'title'); this.loadDupes(); },
  watch: {
    sort(v) { store.set(this.sortKey, v); },
    sortKey(k) { this.sort = store.get(k, this.isList ? 'manual' : 'title'); },
    view(v) { store.set('view:' + this.viewKey, v); },
    viewKey(k) { this.view = store.get('view:' + k, 'cards'); },
    type() { this.reset(); },
    cid() { this.reset(); },
    tag() { this.letter = ''; },
    pages() { clearTimeout(this.dupTimer); this.dupTimer = setTimeout(() => this.loadDupes(), 400); },
  },
  computed: {
    viewKey() { return this.cid ? 'col:' + this.cid : this.tag ? 'tag' : this.type; },
    // The list also has "order in the list"; it is the default and is kept separately from the order of the other collections
    sortKey() { return this.isList ? 'sort:list' : 'sort'; },
    custom() { return this.cid ? (this.$root.collections?.items || []).find((c) => c.id === this.cid) || null : null; },
    isList() { return this.custom?.kind === 'list'; },
    // ordering and removing by hand: only in a list, with "order in the list" and without a filter
    editable() { return this.isList && this.sort === 'manual' && !this.ro && !this.filter.trim() && !this.letter; },
    T() { return this.custom ? COL_STYLE[this.custom.kind] : typeInfo(this.type); },
    heading() { return this.custom ? this.custom.name : this.tag ? '#' + this.tag : this.T.plural; },
    subtitle() {
      if (this.custom) return this.isList ? $t('A list you put together by hand.') : filterSummary(this.custom.filter);
      return this.tag ? '' : this.T.desc;
    },
    formats() { return [...new Set(this.pages.filter((p) => p.type === 'source' && p.format).map((p) => p.format))]; },
    surnameSort() { return this.type === 'entity' && !this.tag && !this.cid; },
    // the pages of the list that are no longer there (merged or removed)
    missing() {
      if (!this.isList) return [];
      const known = new Set(this.pages.map((p) => p.slug));
      return this.custom.slugs.filter((s) => !known.has(s));
    },
    // the pages the index lists but that are not written yet (only in the collection of their kind; not in a room, not in tags or your own collections)
    notWritten() {
      if (this.custom || this.tag || this.cid || this.$root.room) return [];
      const q = this.filter.trim().toLowerCase();
      return (this.$root.pending || []).filter((x) => x.type === this.type && (!q || x.title.toLowerCase().includes(q) || x.slug.includes(q)));
    },
    buildKind() { const a = this.$root.agent; return a?.current ? 'working' : a?.queue?.length ? 'queued' : 'idle'; },
    // the pages of the collection before the letter (the letters are counted from them)
    base() {
      const q = this.filter.trim().toLowerCase();
      let l;
      if (this.cid) {
        const c = this.custom;
        if (!c) l = [];
        else if (c.kind === 'smart') l = this.pages.filter((p) => matchFilter(p, c.filter));
        else { const by = new Map(this.pages.map((p) => [p.slug, p])); l = c.slugs.map((s) => by.get(s)).filter(Boolean); }
      } else l = this.pages.filter((p) => !p.special && (this.tag ? p.tags.includes(this.tag) : p.type === this.type));
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
      if (this.sort === 'manual' && this.isList) return l;
      const by = {
        title: titleCmp,
        updated: (a, b) => String(b.updated || '').localeCompare(String(a.updated || '')),
        links: (a, b) => b.backlinks - a.backlinks,
      }[this.sort] || titleCmp;
      return [...l].sort(by);
    },
    // in alphabetical order: a heading for every letter, to make it easier to read
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
    reset() { this.fmt = 'all'; this.filter = ''; this.letter = ''; this.dupPlan = null; this.dupOpen = false; this.mergeOpen = false; this.mergePick = []; this.mergeTitle = ''; this.mergePlan = null; this.loadDupes(); },
    editCustom() { const c = this.custom; if (c) this.$root.openColEditor(c); },
    removeCustom() { const c = this.custom; if (c) this.$root.deleteCollection(c); },
    moveInList(slug, dir) { this.$root.listChange(this.cid, { move: { slug, dir } }); },
    dropFromList(slug) { this.$root.listChange(this.cid, { remove: slug }, $t('Removed from the list')); },
    async loadDupes() {
      if (this.ro || this.tag || this.cid || !['entity', 'concept', 'topic', 'source'].includes(this.type)) { this.dupes = { pairs: [], authors: [] }; return; }
      try { this.dupes = await (await fetch('/api/dupes')).json(); } catch { /* not critical */ }
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

// ---------- A learning path ----------
// The question becomes an ordered path. The pages are read in a panel next to the path, so that
// following links does not take you out of it: "where am I" and "where am I going" are always visible.
// In manual mode the levels do not change the model, only how much material goes into the request for copying
const MANUAL_HINTS = {
  light: $t('A short request with little material: the quickest to copy.'),
  medium: $t('A request with the main pages of the library.'),
  strong: $t('The longest request, with the most material from the library.'),
};
const LEVELS = [
  { id: 'local', label: $t('Quick'), hint: $t('Arranges by words from the question. Works locally, without {ai} and without using your limit, but does not understand meaning.') },
  { id: 'light', label: $t('Light'), hint: AI.engine === 'manual' ? MANUAL_HINTS.light : $t('{ai} with the light model ({0}): quick and economical, arranges by the index and a few opened pages.', [TN.light]) },
  { id: 'medium', label: $t('Medium'), hint: AI.engine === 'manual' ? MANUAL_HINTS.medium : $t('{ai} with the medium model ({0}): reads the main pages and arranges from the general to the specific.', [TN.medium]) },
  { id: 'strong', label: $t('Powerful'), hint: AI.engine === 'manual' ? MANUAL_HINTS.strong : $t('{ai} with the most powerful model ({0}): reads the most, follows citations to chapters and marks contradictions. The slowest and the most expensive for your limit.', [TN.strong]) },
];
// ---------- Scope: areas and topics, common for "Learn by question" and "Write with the wiki" ----------
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
    // The suggested topics plus the chosen ones that are not among the suggestions (for example from an opened saved path).
    // A chosen topic does not disappear silently: it stays with a tick and is removed with a click.
    shownTopics() {
      const have = new Set(this.topics.map((t) => t.slug)), bySlug = new Map((this.pages || []).map((p) => [p.slug, p]));
      const extra = this.scope.focus.filter((s) => !have.has(s)).map((s) => ({ slug: s, title: bySlug.get(s)?.title || s, area: bySlug.get(s)?.area || null }));
      return [...extra, ...this.topics];
    },
  },
  watch: {
    q() { clearTimeout(this.t); this.t = setTimeout(() => this.fetchTopics(), 450); },
    'scope.areas'() { this.fetchTopics(); },
    areaList() { // an area that is no longer there (renamed or merged) leaves the choice
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
      if (q.length < 3 && !this.scope.areas.length) { this.topics = []; return; }
      this.loading = true;
      try {
        const r = await fetch('/api/topics?q=' + encodeURIComponent(q) + (this.scope.areas.length ? '&a=' + encodeURIComponent(this.scope.areas.join(',')) : ''));
        this.topics = r.ok ? await r.json() : [];
      } catch { this.topics = []; }
      this.loading = false;
      // The chosen topics are NOT removed because they are not among the suggestions for the current text: this is how the scope
      // of a saved path was lost and it "disappeared". Only topics whose pages are no longer there are removed.
      if (this.pages?.length) {
        const known = new Set(this.pages.map((p) => p.slug));
        const keep = this.scope.focus.filter((s) => known.has(s));
        if (keep.length !== this.scope.focus.length) this.scope.focus = keep;
      }
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
    error: '', pending: false, others: [], waited: 0, wantGen: false, picked: store.get('pathlevel', 'local'),
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
    // The level is remembered. If there is already a question, the path opens at the new level; Claude is not started by itself, except with generate
    setLevel(id, generate = false) {
      this.picked = id; store.set('pathlevel', id);
      this.wantGen = generate;
      if (this.q) location.hash = this.href(this.q, id);
    },
    key() { const sk = scopeKey(); return 'path:' + (this.level === 'local' ? '' : this.level + ':') + (this.q || '').trim().toLowerCase() + (sk === '~' ? '' : '|' + sk); },
    // opening a saved path: it also returns the scope with which it was composed
    applyScope(r) { scope.areas = [...(r.areas || [])]; scope.focus = [...(r.focus || [])]; store.set('scope:areas', JSON.stringify(scope.areas)); this.$root.syncScope(); },
    // the scope of a saved path in words: areas and topics (with their titles)
    scopeLabel(r) { return [...(r.areas || []), ...(r.focus || []).map((s) => this.titles.get(s) || s)].join(' · '); },
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
      this.wantGen = this.level !== 'local'; // pressing the button explicitly = consent to use the limit
      const target = this.href(v, this.level);
      if (v === this.q && location.hash === target) this.run(); else location.hash = target;
    },
    async run() {
      this.cancel(); this.panel = null; this.stack = []; this.mobilePanel = false; this.error = ''; this.pending = false; this.others = []; this.res = null;
      const gen = this.wantGen; this.wantGen = false;
      if (!this.q || !this.q.trim()) { this.done = new Set(); this.current = null; this.loading = false; return; }
      this.loading = true;
      // every run has a number: an answer to an older run (another question, level or scope) does not write over the newer one
      const q = this.q, level = this.level, seq = this.runSeq = (this.runSeq || 0) + 1;
      const stale = () => seq !== this.runSeq;
      let res = null;
      try {
        if (level === 'local') {
          res = await (await fetch('/api/path?q=' + encodeURIComponent(q) + scopeQuery())).json();
        } else {
          const saved = await (await fetch(`/api/path/saved?level=${level}&q=${encodeURIComponent(q)}${scopeQuery()}`)).json();
          if (stale()) return;
          if (saved?.steps) res = saved;
          else if (gen) { this.loading = false; return this.generate(); }
          else { this.loading = false; this.others = saved?.others || []; this.pending = true; return; }
        }
      } catch { res = { steps: [], stages: [], note: $t('The server is not responding') }; }
      if (stale()) return; // meanwhile the question, the level or the scope has changed
      this.res = res;
      this.loading = false;
      this.afterResult();
    },
    // Composing by Claude: only on an explicit action. Closing the page or "Cancel" stops Claude.
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
      if (this.ac !== ac) return; // there is a newer request
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
    // a link inside the panel: it opens in the panel, the path stays
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



// ---------- Write with the wiki ----------
const WRITE_HINTS = {
  local: $t('Arranges the text from the library’s pages into an article structure. Without {ai}, does not use your limit, but it is a draft to edit, not a connected text.'),
  light: AI.engine === 'manual' ? MANUAL_HINTS.light : $t('{ai} with the light model ({0}): quick and economical; a simpler text.', [TN.light]),
  medium: AI.engine === 'manual' ? MANUAL_HINTS.medium : $t('{ai} with the medium model ({0}): reads the main pages and writes a connected text.', [TN.medium]),
  strong: AI.engine === 'manual' ? MANUAL_HINTS.strong : $t('{ai} with the most powerful model ({0}): reads the most, checks claims against the original and describes contradictions. The slowest and the most expensive for your limit.', [TN.strong]),
};
// ---------- Add an article by DOI or address ----------
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
        this.testMsg = d.manual ? $t('Copy and paste needs no test: you send the requests yourself.') : d.ok ? $t('The connection works. {ai} answered.') : (d.error || $t('{ai} returned no answer.'));
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

// ---------- Settings -> Model ----------
// The main buttons and windows whose labels the person most often wants to change (the search finds all the others)
const MAIN_LABELS = ['Process with {ai}', 'Ask {ai}', 'Ask {ai} about this page', 'With {ai}', 'Compose with {ai}', 'Write with {ai}', 'Continue with {ai}',
  'Determine with {ai}', 'Send to {ai}', 'Before sending to {ai}', '{ai} is working', 'Question to {ai}', 'Writing with {ai}', '{ai} level', 'Quick, without {ai}'];
const AiSettings = defineComponent({
  template: '#tpl-ai',
  data: () => ({ ...shared, s: null, sel: '', form: null, key: '', showKey: false, busy: false, msg: '', bad: false, models: [], modelsMsg: '', loadingModels: false, testing: false, testMsg: '', testOk: false, labelQuery: '', tiers: ['light', 'medium', 'strong'] }),
  computed: {
    preset() { return this.s?.presets.find((p) => p.id === this.sel) || null; },
    groups() { return (this.s?.groups || []).map((g) => ({ ...g, items: this.s.presets.filter((p) => p.group === g.id) })).filter((g) => g.items.length); },
    show() {
      const p = this.preset || {};
      const fixed = ['claude-code', 'claude-api'].includes(p.id);
      return {
        url: !fixed && p.engine !== 'manual', key: (p.needsKey || p.keyOptional) && p.engine !== 'manual',
        models: !fixed && p.engine !== 'manual', context: !fixed, rpm: p.engine === 'api', vision: p.engine === 'api',
        prices: !fixed && !p.local && p.engine !== 'manual',
      };
    },
    labelKeys() {
      const all = Object.keys(window.__I18N?.messages || {});
      const q = this.labelQuery.trim().toLowerCase();
      if (!q) return [...new Set([...MAIN_LABELS, ...Object.keys(this.form?.labels || {})])].filter((k) => all.includes(k));
      return all.filter((k) => k.toLowerCase().includes(q) || this.preview(k, true).toLowerCase().includes(q)).slice(0, 60);
    },
    changedLabels() { return Object.values(this.form?.labels || {}).filter(Boolean).length; },
    /** "What happens and why" for the chosen profile: the steps of the setup and the reason for each */
    /** The levels whose fields have a model for speech, sound, images or checks chosen (it does not write text) */
    badModels() {
      let re = null; try { re = this.s?.notText ? new RegExp(this.s.notText, 'i') : null; } catch {}
      return re && this.form ? this.tiers.filter((t) => re.test(this.form.models[t] || '')) : [];
    },
    howSteps() {
      const p = this.preset; if (!p) return [];
      const out = [];
      if (p.id === 'claude-code') {
        out.push($t('Claude Code reads the sources and writes the pages itself, with the skills and the rules in CLAUDE.md. Why: as an agent it can open files, check the existing pages and fix links on its own.'));
        out.push($t('Sign in once with claude in a terminal (see Setup). Nothing else is needed here.'));
      } else if (p.engine === 'agent') {
        out.push($t('Claude Code still does the work, but every request goes to this provider. Why: you keep the agent and the skills and only change who answers.'));
      } else if (p.engine === 'api') {
        out.push($t('The server cuts each source into chapters, sends them one by one and writes the pages from the answers. Why: this model has no tools, so it cannot open files itself.'));
      } else {
        out.push($t('Every step is a request that you copy into the chat and an answer that you paste back. Why: a free chat has no API that the library could call.'));
      }
      if (p.needsKey) out.push($t('Get a key (link above) and paste it. Why: the provider counts the limits and the cost by this key.'));
      if (this.show.models) out.push($t('Choose the models, or press “Load the models”. The light one reads the chapters, the medium one writes the pages, the powerful one is for synthesis and the “Best” mode. Why: reading makes the most requests, so a cheaper model there saves money and limits.'));
      if (p.local) out.push($t('Set the context to the real size of the model. Why: the server splits the text so that every part fits.'));
      if (p.id === 'groq') out.push($t('The free plan of Groq counts tokens: about 8,000 per minute and 200,000 per day for each model. Why the context is 7,000: one request must fit in the limit per minute. A whole book does not fit in one day; the estimate warns before you start.'));
      else if (p.free) out.push($t('Free tiers count requests per minute and per day. A book takes about one request per chapter plus 5 to 10. When the daily limit runs out, the queue waits for the reset.'));
      if (p.billingUrl) out.push($t('Check the credit before a big job (link “Credit and billing”). Why: with prepayment every key of the account stops at 0.'));
      if (p.engine === 'api') out.push($t('Press “Test the connection”: one short request to each chosen model. Why: a wrong key, a missing credit or a model that does not write text show up before a whole book is sent.'));
      else if (p.engine !== 'manual' && p.id !== 'claude-code') out.push($t('Press “Test the connection”: one short request of a few tokens. Why: a wrong key, a missing credit or a wrong model show up before a whole book is sent.'));
      return out;
    },
  },
  created() { this.load(); },
  methods: {
    engineText: (e) => (e === 'agent' ? $t('agent with tools') : e === 'manual' ? $t('copy and paste') : $t('without tools')),
    tierLabel(t) { return { light: $t('Light model (reads chapters)'), medium: $t('Medium model (writes the pages)'), strong: $t('Powerful model (synthesis)') }[t]; },
    /** The text of the key of the interface language, with the name from the form instead of {ai} */
    preview(k, raw) {
      const name = this.form?.name || this.preset?.name || 'AI';
      const t = (!raw && this.form?.labels?.[k]) || (window.__I18N?.messages?.[k] ?? k);
      return String(t).replace(/\{ai\}/g, name);
    },
    async load() {
      try { this.s = await (await fetch('/api/ai')).json(); } catch { this.s = null; return; }
      if (!this.sel) this.sel = this.s.current.provider;
      // An address like #/settings/model?pick=ollama (from the start screen) opens this profile directly
      const want = new URLSearchParams(location.hash.split('?')[1] || '').get('pick');
      if (want && this.s.presets.some((p) => p.id === want)) this.sel = want;
      this.fill();
    },
    fill() {
      const p = this.preset; if (!p) return;
      const v = p.values || {};
      const price = (t) => ({ in: v.prices?.[t]?.in ?? '', out: v.prices?.[t]?.out ?? '' });
      this.form = {
        baseUrl: v.baseUrl || '', models: { light: '', medium: '', strong: '', ...(v.models || {}) },
        prices: { light: price('light'), medium: price('medium'), strong: price('strong') },
        context: v.context || '', rpm: v.rpm ?? '', vision: !!v.vision, name: v.name || '', labels: { ...(v.labels || {}) },
      };
      this.key = ''; this.models = []; this.modelsMsg = ''; this.testMsg = ''; this.msg = '';
    },
    pick(id) { this.sel = id; this.fill(); },
    setLabel(k, v) { const l = { ...this.form.labels }; if (v && v.trim()) l[k] = v; else delete l[k]; this.form.labels = l; },
    async post(body) {
      const r = await api('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return r.json();
    },
    /** reload: after saving the page loads again, so that the names and labels change everywhere */
    async save(quiet, activate = true) {
      this.busy = true; this.msg = ''; this.bad = false;
      try {
        const f = this.form;
        const r = await this.post({ provider: this.sel, activate, ...(this.key ? { key: this.key } : {}), profile: { baseUrl: f.baseUrl, models: f.models, prices: f.prices, context: f.context || 0, rpm: f.rpm, vision: f.vision, name: f.name, labels: f.labels } });
        if (!r.ok) { this.bad = true; this.msg = r.error || $t('I could not'); return false; }
        this.s = r; this.key = '';
        if (!quiet) { this.msg = $t('Saved. The page reloads with the new names…'); setTimeout(() => location.reload(), 700); }
        return true;
      } catch { this.bad = true; this.msg = $t('The server is not responding.'); return false; }
      finally { this.busy = false; }
    },
    async removeKey() {
      if (!confirm($t('Remove the saved key of {0}?', [this.preset.label]))) return;
      const r = await this.post({ provider: this.sel, activate: false, removeKey: true });
      if (r.ok) { this.s = r; this.msg = $t('The key was removed.'); this.bad = false; }
    },
    async loadModels() {
      if (!(await this.save(true, false))) return; // the address and the key are needed by the server, but the model in use does not change
      this.loadingModels = true; this.modelsMsg = '';
      try {
        const d = await (await api('/api/ai/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: this.sel }) })).json();
        if (d.ok) {
          this.models = d.models;
          this.modelsMsg = (d.models.length ? $t('{0} models: choose them from the list in the fields above.', [d.models.length]) : $t('The provider returned no models.'))
            + (d.hidden ? ' ' + $t('{0} models for speech, sound, images or safety checks are not shown: they do not write text.', [d.hidden]) : '');
        }
        else this.modelsMsg = d.error || $t('I could not');
      } catch { this.modelsMsg = $t('The server is not responding.'); }
      finally { this.loadingModels = false; }
    },
    async test() {
      this.testMsg = '';
      if (this.sel !== this.s.current.provider && !confirm($t('The test saves this model as the one in use. Continue?'))) return;
      if (!(await this.save(true))) return;
      this.testing = true;
      try {
        const d = await (await api('/api/setup/test', { method: 'POST' })).json();
        this.testOk = !!d.ok;
        this.testMsg = d.ok ? $t('The connection works ({0}). Save to reload the page with the new names.', [d.model || this.preset.name]) : [d.error, d.detail].filter(Boolean).join(' ');
      } catch { this.testOk = false; this.testMsg = $t('The server is not responding.'); }
      finally { this.testing = false; }
    },
  },
});

// The sections of the settings (the submenu on the left, address #/settings/<section>)
// A new version of the program: what changed, whether it may break something, and the install button.
const CodeUpdate = defineComponent({
  template: '#tpl-code-update',
  props: { info: { type: Object, required: true }, skippable: Boolean },
  emits: ['skip', 'done'],
  data: () => ({ ...shared, busy: false, error: '', files: [], result: null, restarting: false }),
  methods: {
    async install(force) {
      this.busy = true; this.error = ''; this.files = [];
      let d;
      try { d = await (await api('/api/updates/code/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force: force === true }) })).json(); }
      catch { d = { ok: false, message: $t('The server is not responding.') }; }
      this.busy = false;
      if (!d.ok) { this.error = d.message || $t('The update did not work.'); this.files = d.files || []; return; }
      this.result = d;
      if (d.restart) { this.restarting = true; await waitForServer(); location.reload(); return; }
      this.$emit('done', d);
    },
  },
});

const SETTINGS_SECTIONS = [
  { id: 'model', icon: 'sparkle', min: 'bookworm', label: $t('Model') },
  { id: 'mode', icon: 'lock', min: 'keeper', label: $t('Mode and safety') },
  { id: 'address', icon: 'globe', min: 'keeper', label: $t('Site address') },
  { id: 'updates', icon: 'refresh', min: 'bookworm', label: $t('Updates') },
  { id: 'data', icon: 'shield', min: 'librarian', label: $t('Data and privacy') },
  { id: 'password', icon: 'key', min: 'librarian', label: $t('Password') },
  { id: 'backup', icon: 'cloud', min: 'bookworm', label: $t('Backups') },
  { id: 'archive', icon: 'box', min: 'librarian', label: $t('Archive for reading') },
  { id: 'tests', icon: 'check', min: 'keeper', label: $t('Tests') },
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- The application: mode (normal or safe), site name (hosts), stopping ----------
// The server cannot touch hosts or restart itself: it asks the launcher (scripts/app.js) through scripts/app-control.js.
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){0,3}$/;
const SAFE_SUFFIXES = ['localhost', 'test', 'local', 'lan', 'internal', 'home.arpa', 'wiki', 'library'];
const postJson = (url, body) => api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());
/** Waits for the server to start again: on every start /api/app/presence returns a different `boot`. */
/** After the server exits to restart (an update): wait until it answers again. With a password it answers 401, which is enough. */
async function waitForServer() {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  await pause(2500);
  for (let i = 0; i < 180; i++) {
    try { const r = await fetch('/api/settings', { cache: 'no-store' }); if (r.status < 500) return; } catch { /* not up yet */ }
    await pause(1000);
  }
}

async function waitForRestart(oldBoot) {
  await wait(1200);
  for (let i = 0; i < 90; i++) {
    try { const d = await (await fetch('/api/app/presence', { cache: 'no-store' })).json(); if (d.boot && d.boot !== oldBoot) return true; } catch {}
    await wait(1000);
  }
  return false;
}
const AppSettings = defineComponent({
  template: '#tpl-app-settings',
  props: { part: { type: String, default: 'mode' } },
  data: () => ({ ...shared, info: null, boot: '', busy: false, msg: '', bad: false, name: '', force: false, cmd: '', shown: '' }),
  computed: {
    isSafe() { return this.info?.mode === 'safe'; },
    iso() { return this.info?.isolation || 'none'; },
    isoLabel() { return { bubblewrap: $t('Strong protection (bubblewrap)'), permission: $t('Basic protection (Node permissions)'), none: $t('No protection') }[this.iso]; },
    check() {
      const n = this.name.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!n) return { ok: false, empty: true };
      if (n.length > 100 || !HOST_RE.test(n) || /^\d+(\.\d+)*$/.test(n) || n === 'localhost') return { ok: false, error: $t('Use letters, digits and hyphens, with dots between the parts (for example biblioteka.test).') };
      const safe = SAFE_SUFFIXES.some((s) => n === s || n.endsWith('.' + s));
      return { ok: true, name: n, real: !safe && n.includes('.'), bare: !n.includes('.') };
    },
    /** What the mode that works now (or the one chosen for comparison) protects and what it does not */
    protects() {
      const w = this.shown || this.iso;
      if (w === 'bubblewrap') return [
        $t('A package of the program reading your other files: SSH keys, other projects, the Windows drives, browser data.'),
        $t('Changing the program itself while it runs (scripts/ and node_modules/ are read-only inside).'),
        $t('Starting Windows programs from inside Linux.'),
        $t('Reading the keys and settings of other programs: only this library’s own folder is visible.'),
      ];
      if (w === 'permission') return [
        $t('The server and its packages (Node code) reading or writing files outside the library folder.'),
        $t('Changing the program’s own code (scripts/, node_modules/) while it runs.'),
        $t('Text extraction and other Node helper processes: they get the same limits.'),
      ];
      return [$t('Nothing extra: the program has the same rights as your user account. The protections in “Always on” still apply.')];
    },
    notProtects() {
      const w = this.shown || this.iso;
      const common = [
        $t('The network is open: it is needed for the AI provider and for “Add an article”. A hostile package could still send out what it can read, which is the library itself.'),
        $t('Your own library files (raw/, wiki/) can still be changed by the program. Use “Undo” and backups.'),
      ];
      if (w === 'bubblewrap') return [...common, $t('Mistakes of the AI inside the library folder.')];
      if (w === 'permission') return [
        $t('Programs that the server starts (git, Claude Code, ocrmypdf, pdftotext) run with your normal rights. This is a seat belt, not a cage.'),
        $t('A determined attacker: Node’s own documentation says this mode does not stop malicious code. For that, use strong protection (Linux or WSL with bubblewrap).'),
        $t('Text recognition of scanned PDFs (OCR) is off in this mode because it needs a native add-on. Use normal mode for those files.'),
        ...common,
      ];
      return [$t('Everything: any package in the program could read or change any file your account can.'), ...common];
    },
    always() {
      return [
        $t('The server listens only on your own computer (127.0.0.1), never on the network.'),
        $t('Only the page of this program can talk to the server (checks of the Host name, the origin and a required header), so another website cannot read your library.'),
        $t('Content security rules block inline code and outside addresses in the pages; HTML from sources is cleaned.'),
        $t('A password for the page is optional (Settings → Password).'),
      ];
    },
  },
  created() { this.load(); },
  methods: {
    async load() {
      try { this.info = await (await fetch('/api/app')).json(); } catch { this.info = null; return; }
      try { this.boot = (await (await fetch('/api/app/presence')).json()).boot || ''; } catch {}
      this.name = this.info.host || this.info.hostsEntry || '';
    },
    err(r) {
      return ({
        'no-launcher': $t('The program was not started with the app launcher, so it cannot do this from here.'),
        timeout: $t('The launcher did not answer in time.'),
        denied: $t('The system did not allow the change (the administrator window was closed or refused).'),
        name: $t('This name is not valid.'),
        mode: $t('This mode does not exist.'),
        unavailable: $t('Safe mode is not available on this computer (Node.js 23 or newer is needed).'),
        'real-domain': $t('This name looks like a real website. After this change that website would not open on this computer.'),
      })[r?.error] || r?.error || $t('Something went wrong.');
    },
    async setMode(mode) {
      const text = mode === 'safe'
        ? $t('Restart the library in safe mode? The page reloads in a few seconds. Work that {ai} is doing now is stopped.')
        : $t('Restart the library in normal mode? The page reloads in a few seconds. Work that {ai} is doing now is stopped.');
      if (!confirm(text)) return;
      this.busy = true; this.msg = ''; this.bad = false;
      const r = await postJson('/api/app/mode', { mode }).catch(() => ({ ok: false, error: 'timeout' }));
      if (!r.ok) { this.busy = false; this.msg = this.err(r); this.bad = true; return; }
      this.msg = $t('Restarting…');
      if (await waitForRestart(this.boot)) location.reload(); else { this.busy = false; this.msg = $t('The server did not come back. Close the window and open the library again.'); this.bad = true; }
    },
    async saveName(remove) {
      if (!remove && !this.check.ok) return;
      this.busy = true; this.msg = $t('Waiting for the administrator window…'); this.bad = false; this.cmd = '';
      const r = await postJson('/api/app/host', { name: remove ? '' : this.check.name, force: this.force }).catch(() => ({ ok: false, error: 'timeout' }));
      if (!r.ok) { this.busy = false; this.msg = this.err(r); this.bad = true; this.cmd = r.command || ''; return; }
      this.msg = $t('Saved. Restarting…');
      if (await waitForRestart(this.boot)) { location.href = r.url || location.origin + '/'; } else { this.busy = false; this.msg = $t('The server did not come back. Close the window and open the library again.'); this.bad = true; }
    },
    async quit() {
      if (!confirm($t('Stop the library and close the window?'))) return;
      await postJson('/api/app/quit').catch(() => {});
      this.$root.stopped = true;
    },
  },
});

// ---------- The start screen: how the library works, where things are, what to set up ----------
const WelcomeView = defineComponent({
  template: '#tpl-welcome',
  props: { agent: { type: Object, default: null } },
  emits: ['tour', 'finish'],
  data: () => ({ ...shared, setup: null, info: null }),
  computed: {
    steps() {
      return [
        { icon: 'upload', title: $t('1. Add'), text: $t('Drop PDF, EPUB, Word, text or image files on the home page, or add an article by its DOI or address.'), where: $t('Home · Add an article'), href: '#/' },
        { icon: 'sparkle', title: $t('2. Process'), text: $t('The AI reads each new file and writes linked pages: a summary of the source, its chapters, the concepts and the people. You see the cost before it starts.'), where: $t('Home · the “Process” button'), href: '#/' },
        { icon: 'book', title: $t('3. Read and search'), text: $t('Open any page, follow the links, press the page numbers to open the original text, search with Ctrl K, or look at the link map.'), where: $t('Menu · Library'), href: '#/p/index' },
        { icon: 'route', title: $t('4. Learn and write'), text: $t('Ask a question and get a reading path through your own sources. Write an article, an essay, a review or a story from what you have read, as creative as you choose, or write yourself with help paragraph by paragraph.'), where: $t('Menu · Learn and write'), href: '#/path' },
      ];
    },
    models() {
      return [
        { id: 'claude-code', icon: 'sparkle', title: $t('Claude'), text: $t('You have a Claude subscription or key. The most capable choice: it works with files itself.') },
        { id: 'gemini', icon: 'link', title: $t('Another provider with a key'), text: $t('ChatGPT, Gemini (a free tier exists), Groq, DeepSeek, Mistral and others. You paste one key.') },
        { id: 'ollama', icon: 'monitor', title: $t('A model on this computer'), text: $t('Ollama or LM Studio. Free and private: nothing leaves the computer. Needs a capable computer.') },
        { id: 'manual', icon: 'copy', title: $t('No account'), text: $t('Copy each request into any chat in your browser and paste the answer back. Slow but free.') },
      ];
    },
    modelReady() { return !!this.setup && this.setup.steps.filter((s) => ['ai', 'claude', 'login'].includes(s.id)).every((s) => s.ok); },
    firstReady() { return !!this.setup?.steps.find((s) => s.id === 'first')?.ok; },
  },
  async created() {
    try { this.setup = await (await fetch('/api/setup')).json(); } catch {}
    try { this.info = await (await fetch('/api/app')).json(); } catch {}
  },
});

// ---------- The tour: lights up the real buttons one by one ----------
// route: the step opens this screen and waits for the element; at the end the tour returns to where it started.
// group: the group in the menu that must be open for the element to be seen.
const TOUR_STEPS = () => [
  { sel: 'home', title: $t('Home'), text: $t('Add your files here. They are sorted by type and wait to be processed.') },
  { sel: 'search', title: $t('Search'), text: $t('Finds pages by title, alias and text. The shortcut is Ctrl K (⌘ K on a Mac).') },
  { sel: 'work', group: 'work', title: $t('Learn and write'), text: $t('Ask a question to get a reading path, write a text from your sources, or add an article by DOI or address.') },
  // Write with the wiki: on the screen itself, because the important choices are there (not in the archive for reading, where the screen is absent)
  ...(window.LIB_STATIC ? [] : [
    { sel: 'write-kind', route: '#/write', title: $t('Write with the wiki'), text: $t('Choose the kind of text: a scientific article, an essay, popular science, a literature review or fiction. Then write the topic or the question.') },
    { sel: 'write-who', route: '#/write', title: $t('Who writes, and how freely'), text: $t('The quick draft arranges a text of any kind without {ai}. Light, Medium and Powerful let {ai} write; then you also choose the length and the creativity, from 1 (strict) to 5 (bold). Creativity changes the style and the interpretation: the facts and the citations always come only from your sources.') },
    { sel: 'write-blank', route: '#/write', title: $t('Your own text'), text: $t('“Blank document” opens an empty text that you write yourself. In the editor, click the title to change it; in “Preview”, point at a paragraph to change it, rewrite it with {ai} or add a new one after it. The card “Help from {ai}” shows which areas and topics are used, and you can change them.') },
  ]),
  { sel: 'lib', title: $t('Library'), text: $t('The index of everything, the log of what the AI changed, the link map and the areas of knowledge.') },
  { sel: 'cols', title: $t('Collections'), text: $t('Pages grouped by type, by tag, or in lists you build yourself. The plus sign makes a new one.') },
  { sel: 'settings', title: $t('Settings'), text: $t('Choose the AI model, switch between normal and safe mode, set the name of your local site, back up and update.') },
  { sel: 'docs', title: $t('Documentation'), text: $t('The full guide, for everyday use and for the terminal. You can come back to this tour from the welcome page.') },
];
const TourOverlay = defineComponent({
  template: '#tpl-tour',
  emits: ['close'],
  data: () => ({ i: 0, rect: null, steps: TOUR_STEPS() }),
  computed: {
    step() { return this.steps[this.i]; },
    card() {
      const r = this.rect; const w = Math.min(340, innerWidth - 32);
      if (!r || innerWidth < 1024) return { width: w + 'px', left: (innerWidth - w) / 2 + 'px', bottom: '16px' };
      // to the right of the element if there is room (the menu); otherwise below or above it (the elements of the page)
      if (r.right + 16 + w <= innerWidth - 16) return { width: w + 'px', left: r.right + 16 + 'px', top: Math.max(16, Math.min(r.top - 8, innerHeight - 260)) + 'px' };
      const left = Math.max(16, Math.min(r.left, innerWidth - w - 16)) + 'px';
      return r.bottom + 280 <= innerHeight ? { width: w + 'px', left, top: r.bottom + 14 + 'px' } : { width: w + 'px', left, bottom: Math.max(16, innerHeight - r.top + 14) + 'px' };
    },
    hole() {
      const r = this.rect; if (!r) return null;
      return { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' };
    },
  },
  mounted() { this.place(); addEventListener('resize', this.place); addEventListener('keydown', this.key); },
  unmounted() {
    removeEventListener('resize', this.place); removeEventListener('keydown', this.key); clearTimeout(this.findT);
    if (this.back != null) location.hash = this.back; // the tour opened another screen: back to where it started
  },
  methods: {
    place() {
      const s = this.step;
      if (s.route && !location.hash.startsWith(s.route)) { if (this.back == null) this.back = location.hash || '#/'; location.hash = s.route; }
      if (s.group && this.$root.navOpen && !this.$root.navOpen(s.group)) this.$root.navToggle(s.group);
      clearTimeout(this.findT);
      const t0 = Date.now();
      // The screen may still be loading: the element is awaited for up to 3 seconds, then the card stays in the middle
      const find = () => {
        if (this.step !== s) return;
        const el = document.querySelector(`[data-tour="${s.sel}"]`);
        if ((!el || !el.offsetParent) && Date.now() - t0 < 3000) { this.rect = null; this.findT = setTimeout(find, 100); return; }
        if (!el || !el.offsetParent) { this.rect = null; return; }
        el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        this.rect = r.width && r.left >= 0 && r.right <= innerWidth ? r : null;
      };
      this.$nextTick(find);
    },
    go(d) { const n = this.i + d; if (n < 0) return; if (n >= this.steps.length) return this.$emit('close'); this.i = n; this.place(); },
    key(e) { if (e.key === 'Escape') this.$emit('close'); else if (e.key === 'ArrowRight') this.go(1); else if (e.key === 'ArrowLeft') this.go(-1); },
  },
});

// ---------- Documentation: pages in scripts/viewer/help/<language>/<id>.md, the list in help/index.json ----------
const DocsView = defineComponent({
  template: '#tpl-docs',
  props: { id: { type: String, default: '' } },
  data: () => ({ ...shared, index: null, texts: {}, track: store.get('docs:track', 'all'), q: '', hits: [], html: '', toc: [], error: '', loading: false, all: false }),
  computed: {
    lang() { return I18N.lang; },
    groups() {
      if (!this.index) return [];
      return this.index.groups.map((g) => ({ ...g, pages: g.pages.filter((p) => this.track === 'all' || p.track === 'both' || p.track === this.track) })).filter((g) => g.pages.length);
    },
    flat() { return this.groups.flatMap((g) => g.pages); },
    curId() { return this.id || this.index?.groups[0]?.pages[0]?.id || ''; },
    cur() { return this.index?.groups.flatMap((g) => g.pages).find((p) => p.id === this.curId) || null; },
    pos() { return this.flat.findIndex((p) => p.id === this.curId); },
    prev() { return this.pos > 0 ? this.flat[this.pos - 1] : null; },
    next() { return this.pos >= 0 && this.pos < this.flat.length - 1 ? this.flat[this.pos + 1] : null; },
  },
  watch: {
    curId() { this.show(); },
    track(v) { store.set('docs:track', v); },
    q() { this.search(); },
  },
  async created() {
    try { this.index = await (await fetch('/help/index.json')).json(); } catch { this.error = $t('The documentation could not be loaded.'); return; }
    await this.show();
  },
  methods: {
    t(o) { return (o && (o[this.lang] || o.en || o.bg)) || ''; },
    async text(id) {
      if (this.texts[id] != null) return this.texts[id];
      for (const l of [this.lang, 'en', 'bg']) {
        try { const r = await fetch(`/help/${l}/${id}.md`); if (r.ok) { this.texts[id] = await r.text(); return this.texts[id]; } } catch {}
      }
      this.texts[id] = ''; return '';
    },
    async show() {
      if (!this.curId) return;
      this.loading = true;
      const md = await this.text(this.curId);
      let n = 0; const toc = [];
      const out = sanitizeHtml(marked.parse(md, { gfm: true })).replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (m, lvl, inner) => {
        const id = 'h' + (++n); toc.push({ id, lvl: Number(lvl), text: inner.replace(/<[^>]+>/g, '') });
        return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
      });
      this.html = out; this.toc = toc; this.loading = false;
      this.$nextTick(() => window.scrollTo({ top: 0 }));
    },
    jump(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    async search() {
      const q = this.q.trim().toLowerCase();
      if (q.length < 2) { this.hits = []; return; }
      if (!this.all) { await Promise.all(this.index.groups.flatMap((g) => g.pages).map((p) => this.text(p.id))); this.all = true; }
      if (q !== this.q.trim().toLowerCase()) return;
      const out = [];
      for (const g of this.index.groups) for (const p of g.pages) {
        const body = this.texts[p.id] || ''; const low = body.toLowerCase();
        const inTitle = this.t(p.title).toLowerCase().includes(q); const at = low.indexOf(q);
        if (!inTitle && at < 0) continue;
        const from = Math.max(0, at - 50);
        out.push({ id: p.id, title: this.t(p.title), group: this.t(g.title), snippet: at < 0 ? '' : (from ? '…' : '') + body.slice(from, at + 110).replace(/[#*`>|]/g, ' ').replace(/\s+/g, ' ').trim() + '…', rank: inTitle ? 0 : 1 });
      }
      this.hits = out.sort((a, b) => a.rank - b.rank).slice(0, 25);
    },
    open(id) { this.q = ''; this.hits = []; location.hash = '#/docs/' + id; },
  },
});

const SettingsView = defineComponent({
  template: '#tpl-settings',
  props: { section: { type: String, default: 'model' } },
  emits: ['copy'],
  data: () => ({ ...shared, SETTINGS_SECTIONS, autoUpdates: store.get('updates:auto', '1') === '1', info: null, code: null, packages: null, tests: null, testError: '', archive: { busy: false, result: null, error: '', list: [] }, busy: { code: false, packages: false, tests: false, auth: false }, pw: { current: '', next: '', message: '', bad: false }, upd: { busy: '', result: null, error: '', restarting: false } }),
  computed: {
    current() { return SETTINGS_SECTIONS.find((s) => s.id === this.section) || SETTINGS_SECTIONS[0]; },
    // the sections of the chosen level; the open one always stays in the list
    sections() { return SETTINGS_SECTIONS.filter((s) => atLeast(s.min) || s.id === this.section); },
    // the packages with a safe new version (within package.json) and those that have only a major new version
    safeUpdates() { return (this.packages?.outdated?.items || []).filter((p) => p.wanted && p.current && p.wanted !== p.current); },
    majorOnly() { return (this.packages?.outdated?.items || []).filter((p) => p.major && (!p.wanted || p.wanted === p.current)); },
    updateCmd() {
      const pack = this.info?.contentLang && this.info.contentLang !== 'en' ? ` && npm run content -- ${this.info.contentLang}` : '';
      // The installed copies of the language pack are put back before git pull, otherwise git refuses because of the local difference.
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
  // on a phone the submenu is a scrolling row: the chosen section must be visible
  mounted() { this.showSection(); },
  watch: { section() { this.showSection(); } },
  methods: {
    showSection() { this.$nextTick(() => this.$el?.querySelector?.('nav [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })); },
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
    // The archive for reading: a ZIP file in outputs/archive/, then a button to download it
    async makeArchive() {
      this.archive = { ...this.archive, busy: true, result: null, error: '' };
      try {
        const d = await (await api('/api/archive', { method: 'POST' })).json();
        if (d.ok) this.archive.result = d; else this.archive.error = d.error || $t('The archive could not be made.');
      } catch { this.archive.error = $t('The server is not responding.'); }
      finally { this.archive.busy = false; this.loadArchives(); }
    },
    // The archives made: a list with deletion of the chosen ones
    async loadArchives() { try { this.archive.list = await (await fetch('/api/archives')).json(); } catch { this.archive.list = []; } },
    async removeArchive(a) {
      if (!window.confirm($t('Delete the archive {0}? The file cannot be restored.', [a.name]))) return;
      try { await api('/api/archive/' + encodeURIComponent(a.name), { method: 'DELETE' }); } catch { /* the list is reloaded below */ }
      this.loadArchives();
    },
    async checkCode() { this.code = await this.post('code', '/api/updates/code'); },
    setAutoUpdates(on) { this.autoUpdates = on; store.set('updates:auto', on ? '1' : '0'); },
    async checkPackages() {
      const d = await this.post('packages', '/api/updates/packages');
      this.packages = d.outdated ? d : { outdated: { ok: false, error: d.error }, audit: { ok: false, error: d.error } };
    },
    // Updating to the safe versions (npm update). names: one package; without it all.
    async applyUpdate(name) {
      const list = name ? [name] : this.safeUpdates.map((p) => p.name);
      if (!list.length) return;
      const restartNote = this.info?.supervised ? $t('The library then restarts by itself (about half a minute).') : $t('Then stop the library and start it again so that the new versions load.');
      const authNote = this.info?.auth ? ' ' + $t('With a password you will have to sign in again.') : '';
      if (!confirm($t('Update {0} to the safe version allowed by package.json?', [name || $t('{0} packages', [list.length])]) + '\n\n' + restartNote + authNote)) return;
      this.upd = { busy: name || '*', result: null, error: '', restarting: false };
      let d;
      try {
        d = await (await api('/api/updates/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ names: name ? [name] : [] }) })).json();
      } catch { d = { ok: false, error: $t('The server is not responding.') }; }
      if (!d.ok) { this.upd = { busy: '', result: null, error: d.error || $t('I could not'), restarting: false }; return; }
      if (d.restart) {
        this.upd = { busy: '', result: d, error: '', restarting: true };
        await this.waitForRestart();
        location.reload();
        return;
      }
      this.upd = { busy: '', result: d, error: '', restarting: false };
      this.checkPackages();
    },
    // the server exits and the launcher starts it again: we wait until it answers again (with a password it answers 401, and that is enough)
    waitForRestart() { return waitForServer(); },
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
    // the processing starts with the chosen mode and language only for this file, after a review of the tokens and the cost
    async process(a) {
      if (a.busy) return; a.busy = true;
      const opts = { mode: a.mode, lang: a.lang };
      try {
        if (!(await this.$root.confirmClaude({ kind: 'ingest', paths: a.paths, opts }))) { a.state = 'later'; a.extra = $t('The file is waiting to be processed on the home page.'); a.busy = false; return; }
        const r = await (await api('/api/agent/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: a.paths, opts }) })).json();
        if (r.queued) { a.state = 'queued'; this.$emit('toast', { text: $t('{ai} started processing. Progress is on the home page.') }); }
        else { a.state = 'later'; a.extra = $t('Already in the queue.'); }
      } catch { this.$emit('toast', { text: $t('The server is not responding'), icon: 'alert' }); }
      a.busy = false;
    },
    modeLabel(id) { return MODES.find((m) => m.id === id)?.label || id; },
    langLabel(id) { return LANGS.find((l) => l.id === id)?.label || id; },
  },
});

// ---------- Photos of pages (viewer/scan-tools.js in the browser, scripts/scan.js on the server) ----------
// The photos are cut out and straightened here, on the person's computer; only the finished pages (and the originals) go to the server.
// The decoded photos are never kept in Vue state: 40 photos of 12 MP would take gigabytes. Only the file, the corners and a thumbnail are kept.
const SCAN_KINDS = [
  { id: 'book', label: $t('Book'), hint: $t('A source with chapters (raw/books/).') },
  { id: 'paper', label: $t('Article'), hint: $t('A scientific or other article (raw/papers/).') },
  { id: 'document', label: $t('Other document'), hint: $t('A letter, notes, a handout (raw/articles/).') },
];
const SCAN_DECODE = 4000;   // the long side of a decoded photo for the final page
const SCAN_PAGE = 2400;     // the long side of a finished page (about 200 dpi for A4)
const SCAN_VIEW = 1400;     // the photo in the editor and for the detection
const SCAN_INSET = 0.008;   // a thin margin left out along the edge, as scanners do (no dark frame from the background)
const natCmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** A photo file -> ImageData of at most maxSide px (the orientation from EXIF is applied by the browser) */
async function decodePhoto(file, maxSide) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return ctx.getImageData(0, 0, c.width, c.height);
}
function imageToCanvas(img, canvas = document.createElement('canvas')) {
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return canvas;
}
const canvasBlob = (c, q = 0.85) => new Promise((r) => c.toBlob(r, 'image/jpeg', q));

/** The finished page from a decoded photo: cut, straightened, levelled and (if not in colour) with a clean contrast */
function scanPage(img, p, maxSide, { level, color }) {
  let angle = 0;
  if (level) angle = ScanTools.skewAngle(ScanTools.warp(img, p.corners, { maxSide: 1000 }));
  let out = ScanTools.warp(img, p.corners, { maxSide, angle, inset: SCAN_INSET });
  if (!color) out = ScanTools.enhance(out);
  return { out, angle };
}

let scanEditImg = null; // the decoded photo in the editor (outside Vue on purpose)

const ScanView = defineComponent({
  template: '#tpl-scan',
  emits: ['toast', 'refresh'],
  data: () => ({
    ...shared, SCAN_KINDS, LANGS, drag: false, pages: [], title: '', kind: 'book', level: true, color: false,
    analyzing: 0, stage: 'edit', progress: { done: 0, total: 0 }, error: '', scan: null, poll: null, dragFrom: -1,
    edit: null, mode: 'economy', lang: 'both', processed: false, readAsked: false,
  }),
  computed: {
    ready() { return this.pages.length > 0 && !this.analyzing && this.title.trim().length > 0 && this.pages.every((p) => !p.error); },
    bad() { return this.pages.filter((p) => p.error).length; },
    job() { return this.scan?.job || {}; },
    busyJob() { return ['waiting', 'ocr', 'model'].includes(this.job.phase); },
    weakThumbs() { return (this.scan?.weak || []).map((n) => ({ n, thumb: this.pages[n - 1]?.thumb || '' })); },
    poly() { return this.edit ? this.edit.corners.map((c) => `${c.x * this.edit.w},${c.y * this.edit.h}`).join(' ') : ''; },
  },
  created() {
    const st = this.$root.agent?.settings || {};
    this.mode = ['economy', 'balanced', 'best'].includes(st.mode) ? st.mode : 'economy';
    this.lang = st.lang || 'both';
  },
  beforeUnmount() { clearInterval(this.poll); scanEditImg = null; this.pages.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb)); },
  methods: {
    onDrop(e) { this.drag = false; this.add([...e.dataTransfer.files]); },
    onPick(e) { this.add([...e.target.files]); e.target.value = ''; },
    async add(files) {
      const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|tiff?|bmp|gif)$/i.test(f.name)).sort((a, b) => natCmp(a.name, b.name));
      if (imgs.length < files.length) this.$emit('toast', { text: $t('Only photos can be added here.'), icon: 'alert' });
      // src: what the browser reads (a JPEG converted on the server for HEIC); file stays the original that is kept
      const fresh = imgs.map((f) => Vue.reactive({ id: uid(), file: f, src: null, converting: false, name: f.name, corners: ScanTools.FULL(), found: false, angle: 0, thumb: '', error: '', busy: true }));
      this.pages.push(...fresh);
      // one by one, so that the page stays responsive
      for (const p of fresh) { this.analyzing++; await this.analyze(p, true); this.analyzing--; await nextFrame(); }
    },
    /** Finds the sheet (detect) and makes the thumbnail of the finished page */
    async analyze(p, detect) {
      p.busy = true; p.error = '';
      try {
        const img = await this.readPhoto(p, SCAN_VIEW);
        if (detect) { const d = ScanTools.detectPage(img); p.corners = d.corners; p.found = d.found; }
        await this.makeThumb(p, img);
      } catch (e) { p.error = e.message || $t('The browser cannot read this photo. Save it as JPG and add it again.'); }
      p.converting = false; p.busy = false;
    },
    /**
     * Decodes a photo. When the browser cannot (HEIC from an iPhone in Chrome and Edge), the server converts it
     * to JPEG once (/api/scan/convert) and the JPEG is used from then on. Safari opens HEIC by itself.
     */
    async readPhoto(p, maxSide) {
      try { return await decodePhoto(p.src || p.file, maxSide); }
      catch (first) {
        if (p.src) throw first;
        p.converting = true;
        const r = await api('/api/scan/convert', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: p.file });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(r.status === 400 ? $t('The browser cannot read this photo. Save it as JPG and add it again.') : d.error || $t('The HEIC photo could not be converted.'));
        }
        p.src = await r.blob();
        p.converting = false;
        return decodePhoto(p.src, maxSide);
      }
    },
    async makeThumb(p, img) {
      const { out, angle } = scanPage(img, p, 420, { level: this.level, color: this.color });
      p.angle = angle;
      const blob = await canvasBlob(imageToCanvas(out), 0.8);
      if (p.thumb) URL.revokeObjectURL(p.thumb);
      p.thumb = URL.createObjectURL(blob);
    },
    async redoAll() {
      for (const p of this.pages) { if (p.error) continue; this.analyzing++; await this.analyze(p, false); this.analyzing--; await nextFrame(); }
    },
    move(i, d) { const j = i + d; if (j < 0 || j >= this.pages.length) return; const [p] = this.pages.splice(i, 1); this.pages.splice(j, 0, p); },
    dropOn(i) { if (this.dragFrom < 0 || this.dragFrom === i) return; const [p] = this.pages.splice(this.dragFrom, 1); this.pages.splice(i, 0, p); this.dragFrom = -1; },
    remove(i) { const [p] = this.pages.splice(i, 1); if (p?.thumb) URL.revokeObjectURL(p.thumb); },
    sortByName() { this.pages.sort((a, b) => natCmp(a.name, b.name)); },
    clearAll() { if (!confirm($t('Remove all photos from the list? The files on your computer are not touched.'))) return; this.pages.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb)); this.pages = []; },

    // ----- the editor of the corners -----
    async openEdit(i) {
      const p = this.pages[i]; if (!p || p.busy) return;
      try {
        scanEditImg = await this.readPhoto(p, SCAN_VIEW);
        const url = URL.createObjectURL(await canvasBlob(imageToCanvas(scanEditImg), 0.9));
        this.edit = { i, url, w: scanEditImg.width, h: scanEditImg.height, corners: p.corners.map((c) => ({ ...c })), dragging: -1 };
        this.$nextTick(() => this.preview());
      } catch { this.$emit('toast', { text: $t('I could not open the photo.'), icon: 'alert' }); }
    },
    closeEdit(save) {
      const e = this.edit; if (!e) return;
      const p = this.pages[e.i];
      if (save && p) { p.corners = e.corners.map((c) => ({ ...c })); p.found = true; if (scanEditImg) this.makeThumb(p, scanEditImg); }
      URL.revokeObjectURL(e.url); this.edit = null; scanEditImg = null;
    },
    pointAt(ev) {
      const r = this.$refs.editSvg.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) };
    },
    grab(k, ev) { this.edit.dragging = k; ev.target.setPointerCapture?.(ev.pointerId); },
    dragMove(ev) { const e = this.edit; if (!e || e.dragging < 0) return; e.corners.splice(e.dragging, 1, this.pointAt(ev)); },
    dragEnd() { if (!this.edit || this.edit.dragging < 0) return; this.edit.dragging = -1; this.preview(); },
    nudge(k, ev) {
      const step = ev.shiftKey ? 0.02 : 0.004, d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      if (!d) return; ev.preventDefault();
      const c = this.edit.corners[k];
      this.edit.corners.splice(k, 1, { x: Math.min(1, Math.max(0, c.x + d[0] * step)), y: Math.min(1, Math.max(0, c.y + d[1] * step)) });
      clearTimeout(this._pv); this._pv = setTimeout(() => this.preview(), 250);
    },
    editAuto() { if (!scanEditImg) return; this.edit.corners = ScanTools.detectPage(scanEditImg).corners; this.preview(); },
    editFull() { this.edit.corners = ScanTools.FULL(); this.preview(); },
    editRotate() { this.edit.corners = ScanTools.rotateCorners(this.edit.corners); this.preview(); },
    preview() {
      const c = this.$refs.editPreview; if (!c || !scanEditImg || !this.edit) return;
      const { out } = scanPage(scanEditImg, { corners: this.edit.corners }, 700, { level: this.level, color: this.color });
      imageToCanvas(out, c);
    },
    cornerName: (k) => [$t('top left'), $t('top right'), $t('bottom right'), $t('bottom left')][k],

    // ----- upload, PDF, OCR -----
    async putPart(id, kind, n, blob, name) {
      const r = await api(`/api/scan/${id}/${kind}/${n}`, { method: 'PUT', headers: { 'x-filename': encodeURIComponent(name || `${kind}-${n}.jpg`) }, body: blob });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || $t('The upload failed.'));
    },
    async build() {
      if (!this.ready) return;
      this.stage = 'upload'; this.error = ''; this.progress = { done: 0, total: this.pages.length };
      try {
        const s = await (await api('/api/scan', { method: 'POST' })).json();
        if (!s.id) throw new Error(s.error || $t('The server is not responding.'));
        for (let i = 0; i < this.pages.length; i++) {
          const p = this.pages[i];
          const img = await this.readPhoto(p, SCAN_DECODE);
          const { out, angle } = scanPage(img, p, SCAN_PAGE, { level: this.level, color: this.color });
          p.angle = angle;
          const blob = await canvasBlob(imageToCanvas(out), 0.85);
          await this.putPart(s.id, 'page', i + 1, blob);
          await this.putPart(s.id, 'orig', i + 1, p.file, p.name);
          this.progress.done = i + 1;
          await nextFrame();
        }
        const layout = this.pages.map((p) => ({ corners: p.corners, angle: p.angle, color: this.color, name: p.name }));
        const r = await api(`/api/scan/${s.id}/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: this.title.trim(), kind: this.kind, layout }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || $t('The server is not responding.'));
        this.stage = 'ocr';
        this.scan = { id: s.id, pdf: d.pdf, pages: d.pages, job: { phase: 'waiting' } };
        this.$emit('refresh');
        this.watch();
      } catch (e) { this.error = e.message; this.stage = 'edit'; }
    },
    watch() {
      clearInterval(this.poll);
      const tick = async () => {
        try {
          const d = await (await api(`/api/scan/${this.scan.id}`)).json();
          if (d.id) this.scan = d;
        } catch { return; }
        if (this.busyJob) return;
        clearInterval(this.poll); this.poll = null;
        this.stage = 'result';
        this.$emit('refresh');
        // OCR first; where it is weak, a model (after the estimate of the tokens and the cost)
        if (this.scan.weak?.length && !this.readAsked) { this.readAsked = true; this.readWeak(); }
      };
      this.poll = setInterval(tick, 1500); tick();
    },
    async readWeak() {
      const id = this.scan?.id; if (!id || !this.scan.weak?.length) return;
      if (!(await this.$root.confirmClaude({ kind: 'scan-pages', id }))) return;
      const r = await api(`/api/scan/${id}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { this.$emit('toast', { text: d.error || $t('I could not'), icon: 'alert' }); return; }
      if (d.started) { this.stage = 'ocr'; this.scan.job = { phase: 'model', done: 0, total: d.total }; this.watch(); }
    },
    async cancelRead() { if (this.scan?.id) await api(`/api/scan/${this.scan.id}/cancel`, { method: 'POST' }); },
    async process() {
      if (!this.scan?.pdf) return;
      const opts = { mode: this.mode, lang: this.lang }, paths = [this.scan.pdf];
      if (!(await this.$root.confirmClaude({ kind: 'ingest', paths, opts }))) return;
      const r = await (await api('/api/agent/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths, opts }) })).json().catch(() => ({}));
      this.processed = true;
      this.$emit('toast', r.queued ? { text: $t('{ai} started processing. Progress is on the home page.') } : { text: $t('Already in the queue.'), icon: 'alert' });
    },
    again() {
      clearInterval(this.poll); this.pages.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
      Object.assign(this, { pages: [], title: '', stage: 'edit', scan: null, error: '', processed: false, readAsked: false });
    },
    modeLabel(id) { return MODES.find((m) => m.id === id)?.label || id; },
  },
});

// Kinds of text and creativity (the same values as GENRES and CREATIVITY_DEFAULT in scripts/write.js)
const GENRE_LIST = [
  { id: 'article', label: $t('Scientific article'), hint: $t('Abstract, keywords, introduction, theoretical framework, analysis, discussion, conclusion and a bibliography in APA 7.'), ph: $t('The topic or question, e.g. What caused the First World War and what do historians say about it') },
  { id: 'essay', label: $t('Essay'), hint: $t('A personal, reasoned text: one line of thought, counterarguments and a clear position. Citations in APA 7 and a bibliography.'), ph: $t('The question of the essay, e.g. Can a war be just?') },
  { id: 'popular', label: $t('Popular science'), hint: $t('For a wide audience: lively language, examples, every term explained. Fewer citations and a bibliography.'), ph: $t('What should the reader understand, e.g. How does memory work') },
  { id: 'review', label: $t('Literature review'), hint: $t('Who claims what: themes, agreements and differences between the authors, a table of the positions, gaps and a bibliography.'), ph: $t('The field of the review, e.g. Theories of motivation') },
  { id: 'story', label: $t('Fiction'), hint: $t('A short story with characters and a plot built on the ideas of the library. No citations in the text: the sources are listed at the end under “Based on”.'), ph: $t('What the story is about, e.g. A day in the life of a medieval monk who copies books') },
];
const CREATIVITY = [
  { n: 1, label: $t('Strict'), hint: $t('Plain, precise language. Stays as close as possible to the texts, without its own interpretation.') },
  { n: 2, label: $t('Restrained'), hint: $t('Clear language with a little colour. Connects the ideas only where the texts connect them.') },
  { n: 3, label: $t('Balanced'), hint: $t('Lively language with images and examples. Its own interpretation where it follows from the texts.') },
  { n: 4, label: $t('Free'), hint: $t('Expressive language and metaphors. Bold interpretations, an unusual angle, unexpected connections between the authors.') },
  { n: 5, label: $t('Bold'), hint: $t('An original, daring text with a strong voice and play with form. Hypotheses presented as its own reading.') },
];
const CREATIVITY_DEFAULT = { article: 2, essay: 3, popular: 3, review: 1, story: 4 };
const genreOk = (g) => (GENRE_LIST.some((x) => x.id === g) ? g : 'article');
const creativityFor = (g) => { const n = Number(store.get('writecreat:' + g, '')); return n >= 1 && n <= 5 ? n : CREATIVITY_DEFAULT[g] || 2; };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordCount = (s) => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;
// How many different works the text cites (author + year in parentheses): only for the cost estimate of the review
const citedWorksOf = (md) => {
  const seen = new Set();
  for (const m of String(md).matchAll(/\(([^()\n]*?\d{4}[^()\n]*?)\)/g)) {
    for (const part of m[1].split(';')) { const x = part.match(/([\p{L}'’-]{2,})[^\d;]*?((?:1[5-9]|20)\d{2})/u); if (x) seen.add(x[1].toLowerCase() + x[2]); }
  }
  return seen.size;
};

/**
 * The text of the draft in blocks: paragraphs, headings and lists, separated by an empty line (code in ``` stays whole).
 * Every block keeps its beginning and end in the Markdown, so that exactly it can be changed. The first line "# ..." is the title.
 * The blocks from the bibliography (bibRe) on have bib: true: the server fills them in.
 */
function splitBlocks(md, bibRe) {
  const out = []; let pos = 0, cur = null, fence = false;
  for (const line of md.split('\n')) {
    const start = pos, end = pos + line.length; pos = end + 1;
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!line.trim() && !fence) { if (cur) { out.push(cur); cur = null; } continue; }
    if (cur) cur.end = end; else cur = { start, end };
  }
  if (cur) out.push(cur);
  // the title: only the first line of the first block, if it is "# ..."; the rest of the block is a separate paragraph
  if (out[0] && /^#\s/.test(md.slice(out[0].start, out[0].end))) {
    const first = out[0], nl = md.indexOf('\n', first.start);
    if (nl >= 0 && nl < first.end) { out.splice(1, 0, { start: nl + 1, end: first.end }); first.end = nl; }
    first.title = true;
  }
  let inBib = false;
  return out.map((b, i) => {
    const text = md.slice(b.start, b.end).replace(/\r$/, '');
    if (/^##\s/.test(text)) inBib = !!bibRe && bibRe.test(text.split('\n')[0].replace(/\r$/, ''));
    return { i, start: b.start, end: b.end, text, title: !!b.title, heading: /^#{1,6}\s/.test(text) && !text.includes('\n'), bib: inBib };
  });
}

const WriteView = defineComponent({
  template: '#tpl-write',
  props: { id: String, pages: Array },
  emits: ['toast'],
  data: () => {
    const genre = genreOk(store.get('writegenre', 'article'));
    const lvl = store.get('writelevel', 'local');
    return {
      ...shared, LEVELS, hints: WRITE_HINTS, GENRE_LIST, CREATIVITY, scope,
      genre, creativity: creativityFor(genre),
      topic: '', level: lvl, length: store.get('writelength', 'medium'), voice: store.get('writevoice', ''),
      loading: false, waited: 0, error: '', drafts: [], filter: '', blankBusy: false,
      doc: null, body: '', saved: '', savedMeta: '', mode: 'preview', saving: false, loadError: false, warnings: [], bibHeads: [],
      // the help of the model in the editor: kind, creativity and level apply to continuing and to paragraphs
      ed: { genre: 'article', creativity: 2, level: store.get('writeedlevel', lvl === 'local' ? 'medium' : lvl), open: store.get('write:aiopen', '1') !== '0' },
      undoStack: [], flash: null, hover: -1, active: -1, titleEdit: null,
      blk: { open: '', text: '', instruction: '', words: 150, own: true, busy: false, waited: 0, error: '' },
      cont: { instruction: '', words: 600, busy: false, waited: 0, error: '', note: '' },
      // Review with the wiki (the wiki-review skill): fix = a fixed text + a report, report = only a report
      rev: { instruction: '', mode: store.get('write:revmode', 'fix') === 'report' ? 'report' : 'fix', busy: false, waited: 0, error: '', note: '', report: '', reportPath: '', open: true },
    };
  },
  computed: {
    levels() { return this.genre === 'article' ? LEVELS : LEVELS.filter((l) => l.id !== 'local'); },
    aiLevels() { return LEVELS.filter((l) => l.id !== 'local'); },
    genreInfo() { return GENRE_LIST.find((g) => g.id === this.genre) || GENRE_LIST[0]; },
    creatInfo() { return CREATIVITY[this.creativity - 1] || CREATIVITY[1]; },
    edCreatInfo() { return CREATIVITY[this.ed.creativity - 1] || CREATIVITY[1]; },
    metaKey() { return JSON.stringify([this.ed.genre, this.ed.creativity, [...scope.areas].sort(), [...scope.focus].sort(), this.doc?.cites || []]); },
    dirty() { return !!this.doc && (this.body !== this.saved || this.metaKey !== this.savedMeta); },
    busyAny() { return this.blk.busy || this.cont.busy || this.rev.busy; },
    reviewHtml() { return this.rev.report ? renderMarkdown(this.rev.report, new Set(), new Map(), {}) : ''; },
    // The article is in the language of the library (contentLang), not in the language of the interface: with a mismatch it says so in advance
    langNote() {
      if (!I18N.contentLang || I18N.contentLang === I18N.lang) return '';
      const name = (code) => I18N.locales.find((l) => l.code === code)?.name || code;
      return $t('The article will be in {0}, the language of the library. The interface is in {1}. To make them the same, choose the language in the sidebar language menu.', [name(I18N.contentLang), name(I18N.lang)]);
    },
    docTitle() { return this.body.match(/^#\s+(.+)$/m)?.[1]?.trim() || this.doc?.title || ''; },
    wordsN() { return wordCount(this.body); },
    bibRe() {
      const heads = this.bibHeads.length ? this.bibHeads : ['Bibliography', 'Библиография', 'Based on', 'По мотиви от', 'References'];
      return new RegExp(`^##[ \\t]*(?:${heads.map(reEsc).join('|')})[ \\t]*:?[ \\t]*$`, 'i');
    },
    blocks() {
      const f = this.flash;
      return splitBlocks(this.body, this.bibRe).map((b) => ({ ...b, fresh: !!f && b.start < f.end && b.end > f.start }));
    },
    shownBlocks() { return this.blocks.filter((b) => !b.title).map((b) => ({ ...b, html: renderMarkdown(b.text, new Set(), new Map(), {}) })); },
    titleBlock() { return this.blocks.find((b) => b.title) || null; },
    // The suggested topics follow what is being worked on at the moment
    scopeQ() { return (this.blk.instruction || this.cont.instruction || this.rev.instruction || this.docTitle).slice(0, 300); },
    citedPages() {
      const by = new Map((this.pages || []).map((p) => [p.slug, p]));
      return (this.doc?.cites || []).map((s) => ({ slug: s, title: by.get(s)?.title || s, missing: !by.has(s) }));
    },
  },
  watch: {
    id: { immediate: true, handler(id) { id ? this.load() : this.loadList(); } },
    filter() { clearTimeout(this.ft); this.ft = setTimeout(() => this.loadList(), 250); },
    genre(g) {
      store.set('writegenre', g); this.creativity = creativityFor(g);
    },
  },
  mounted() {
    this.onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && this.id) { e.preventDefault(); if (this.dirty) this.save(); } };
    this.onLeave = (e) => { if (this.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', this.onKey); window.addEventListener('beforeunload', this.onLeave);
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('beforeunload', this.onLeave);
    this.cancel(); this.cancelCont(); this.cancelBlock(); this.cancelRev(); clearTimeout(this.ft); clearTimeout(this.flashT);
    if (this.dirty) this.save(true); // we do not lose what was written when leaving the page
  },
  methods: {
    levelLabel(id) { return LEVELS.find((l) => l.id === id)?.label || id; },
    modeLabel(m) { return m === 'local' ? $t('Quick draft') : m === 'blank' ? $t('Own text') : `${AI.name} · ${this.levelLabel(m)}`; },
    genreLabel(g) { return (GENRE_LIST.find((x) => x.id === g) || GENRE_LIST[0]).label; },
    setLevel(id) { this.level = id; store.set('writelevel', id); },
    setLength(k) { this.length = k; store.set('writelength', k); },
    setCreativity(n) { this.creativity = n; store.set('writecreat:' + this.genre, String(n)); },
    setEdLevel(id) { this.ed.level = id; store.set('writeedlevel', id); },
    toggleHelp() { this.ed.open = !this.ed.open; store.set('write:aiopen', this.ed.open ? '1' : '0'); },
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
      const ai = this.level !== 'local';
      if (ai && !(await this.$root.confirmClaude({ kind: 'write', topic, level: this.level, length: this.length, ...scopeBody() }))) return;
      this.cancel(); this.error = ''; this.loading = true; this.waited = 0;
      const ac = new AbortController(); this.ac = ac;
      this.timer = setInterval(() => { this.waited++; }, 1000);
      let out = null, err = '';
      const voice = ai ? this.voice : '';
      if (ai) { this.topic = ''; this.voice = ''; this.saveVoice(); } // sent: the title and the example text are cleared
      try {
        const r = await api('/api/write', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal,
          body: JSON.stringify({ topic, genre: this.genre, creativity: this.creativity, level: this.level, length: this.length, voice, ...scopeBody() }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || $t('The server is not responding'));
        out = d;
      } catch (e) { err = e.name === 'AbortError' ? '' : (e.message || $t('Error')); }
      if (this.ac !== ac) return;
      clearInterval(this.timer); this.ac = null; this.loading = false;
      if (err) { // failed: we return what was written, so that it is not lost
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
    // A blank document: the person writes alone; the text in the topic field becomes the title
    async createBlank() {
      if (this.blankBusy) return;
      this.blankBusy = true; this.error = '';
      try {
        const r = await api('/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: this.topic.trim(), genre: this.genre, ...scopeBody() }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.id) throw new Error(d.error || $t('I could not'));
        this.topic = '';
        store.set('writeblank:' + d.id, '1');
        location.hash = '#/write/' + d.id;
      } catch (e) { this.error = e.message || $t('Error'); }
      this.blankBusy = false;
    },

    // ---------- Editor ----------
    pushUndo(prev = this.body) { this.undoStack.push(prev); if (this.undoStack.length > 30) this.undoStack.shift(); },
    undo() { if (!this.undoStack.length || this.busyAny) return; this.body = this.undoStack.pop(); this.flash = null; this.cont.note = ''; this.rev.note = ''; this.closeBlock(); },
    markFresh(start, end) { this.flash = { start, end }; clearTimeout(this.flashT); this.flashT = setTimeout(() => { this.flash = null; }, 8000); },
    addCited(list) {
      const have = new Set(this.doc.cites || []), add = (list || []).map((c) => c.slug).filter((s) => s && !have.has(s));
      if (add.length) this.doc = { ...this.doc, cites: [...(this.doc.cites || []), ...add] };
    },
    startTitle() { if (!this.busyAny) { this.titleEdit = this.docTitle; this.$nextTick(() => this.$refs.titleInput?.focus()); } },
    saveTitle() {
      const t = String(this.titleEdit ?? '').replace(/\s+/g, ' ').trim(); this.titleEdit = null;
      if (!t || t === this.docTitle) return;
      this.pushUndo();
      this.body = /^#\s+.*$/m.test(this.body) ? this.body.replace(/^#\s+.*$/m, `# ${t}`) : `# ${t}\n\n${this.body.replace(/^\s+/, '')}`;
    },
    openBlock(kind, b) {
      if (this.busyAny) return;
      this.blk.open = `${kind}:${b ? b.i : -1}`; this.blk.error = ''; this.blk.instruction = '';
      this.blk.text = kind === 'edit' ? b.text : ''; this.blk.own = true;
      this.$nextTick(() => this.$el.querySelector?.('[data-blk-focus]')?.focus());
    },
    closeBlock() { if (!this.blk.busy) { this.blk.open = ''; this.blk.error = ''; } },
    isOpen(kind, b) { return this.blk.open === `${kind}:${b ? b.i : -1}`; },
    // Manual change of a paragraph; an empty text = removal
    applyEdit(b) {
      const t = this.blk.text.replace(/\s+$/, '');
      if (!t.trim()) return this.removeBlock(b);
      if (t !== b.text) { this.pushUndo(); this.body = this.body.slice(0, b.start) + t + this.body.slice(b.end); this.markFresh(b.start, b.start + t.length); }
      this.blk.open = '';
    },
    // A new paragraph after block b (without b: at the beginning, after the title if there is one)
    insertAt(b) { return b ? b.end : (this.titleBlock ? this.titleBlock.end : 0); },
    insertOwn(b) {
      const t = this.blk.text.trim(); if (!t) return;
      const at = this.insertAt(b), sep = at === 0 ? '' : '\n\n', after = this.body.slice(at);
      this.pushUndo();
      this.body = this.body.slice(0, at) + sep + t + (at === 0 && after.trim() ? '\n\n' : '') + (after || '\n');
      this.markFresh(at + sep.length, at + sep.length + t.length);
      this.blk.open = '';
    },
    removeBlock(b) {
      const before = this.body.slice(0, b.start).replace(/\s+$/, ''), after = this.body.slice(b.end).replace(/^\s+/, '');
      this.pushUndo();
      this.body = before && after ? `${before}\n\n${after}` : (before || after) + '\n';
      this.blk.open = ''; this.flash = null;
      this.$emit('toast', { text: $t('The paragraph was removed. “Undo” brings it back.') });
    },
    cancelBlock() { const ac = this.blkAc; this.blkAc = null; clearInterval(this.blkTimer); ac?.abort(); this.blk.busy = false; },
    // A paragraph with the model: rewrite = rewriting b, insert = a new paragraph after b. The result goes into the text without saving.
    async aiBlock(action, b) {
      const k = this.blk; if (this.busyAny || !this.doc) return;
      const at = action === 'rewrite' ? b : null;
      const start = at ? b.start : (b ? b.start : 0), end = at ? b.end : this.insertAt(b);
      const words = at ? wordCount(b.text) : k.words;
      const topic = k.instruction.trim() || (at ? b.text.slice(0, 200) : this.docTitle);
      if (!(await this.$root.confirmClaude({ kind: 'write', topic, level: this.ed.level, words, ...scopeBody() }))) return;
      this.cancelBlock(); k.busy = true; k.error = ''; k.waited = 0;
      const ac = new AbortController(); this.blkAc = ac;
      this.blkTimer = setInterval(() => { k.waited++; }, 1000);
      const sent = this.body;
      let out = null, err = '';
      try {
        const r = await api('/api/drafts/' + encodeURIComponent(this.doc.id) + '/block', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal,
          body: JSON.stringify({ body: sent, action, start, end, target: at ? sent.slice(start, end) : '', instruction: k.instruction, words, level: this.ed.level, genre: this.ed.genre, creativity: this.ed.creativity, ...scopeBody() }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || $t('The server is not responding'));
        out = d;
      } catch (e) { err = e.name === 'AbortError' ? '' : (e.message || $t('Error')); }
      if (this.blkAc !== ac) return;
      clearInterval(this.blkTimer); this.blkAc = null; k.busy = false;
      if (err) { k.error = err; return; }
      if (!out) return;
      if (this.body !== sent) { k.error = $t('The text changed while {ai} was writing, so the result was not put in. Try again.'); return; }
      this.pushUndo(sent); this.body = out.markdown; this.mode = 'preview';
      this.markFresh(out.start, out.end); this.addCited(out.cited);
      if (out.warnings?.length) this.warnings = [...this.warnings, ...out.warnings];
      k.open = ''; k.instruction = '';
      this.$emit('toast', { text: action === 'rewrite' ? $t('The paragraph was rewritten. Review it and press “Save”.') : $t('About {0} words were added. Review them and press “Save”.', [out.added]) });
    },
    // Continuing with the model: the new text goes into the editor (in a scientific article before the Conclusion), the saving is yours
    async continueDoc() {
      const c = this.cont; if (this.busyAny || !this.doc) return;
      const topic = c.instruction.trim() || this.docTitle;
      if (!(await this.$root.confirmClaude({ kind: 'write', topic, level: this.ed.level, words: c.words, ...scopeBody() }))) return;
      this.cancelCont(); c.busy = true; c.error = ''; c.note = ''; c.waited = 0;
      const ac = new AbortController(); this.contAc = ac;
      this.contTimer = setInterval(() => { c.waited++; }, 1000);
      const sent = this.body;
      let out = null, err = '';
      try {
        const r = await api('/api/drafts/' + encodeURIComponent(this.doc.id) + '/continue', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal,
          body: JSON.stringify({ body: sent, instruction: c.instruction, words: c.words, level: this.ed.level, genre: this.ed.genre, creativity: this.ed.creativity, ...scopeBody() }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || $t('The server is not responding'));
        out = d;
      } catch (e) { err = e.name === 'AbortError' ? '' : (e.message || $t('Error')); }
      if (this.contAc !== ac) return;
      clearInterval(this.contTimer); this.contAc = null; c.busy = false;
      if (err) { c.error = err; return; }
      if (!out) return;
      if (this.body !== sent) { c.error = $t('The text changed while {ai} was writing, so the result was not put in. Try again.'); return; }
      this.pushUndo(sent); this.body = out.markdown; this.mode = 'preview'; c.instruction = ''; this.flash = null;
      this.addCited(out.cited);
      c.note = $t('About {0} words were added ({1}). Review and press “Save”.', [out.added, out.placed]);
      if (out.warnings?.length) this.warnings = [...this.warnings, ...out.warnings];
    },
    cancelCont() { const ac = this.contAc; this.contAc = null; clearInterval(this.contTimer); ac?.abort(); this.cont.busy = false; },
    setRevMode(m) { this.rev.mode = m; store.set('write:revmode', m); },
    // Review with the wiki: the model checks the citations in the originals, fixes APA, grounding and wording by the wiki-review skill.
    // With "Fix the text" the fixed text goes into the editor without saving; the report is seen under the panel.
    async reviewDoc() {
      const v = this.rev; if (this.busyAny || !this.doc) return;
      const words = wordCount(this.body);
      if (!(await this.$root.confirmClaude({ kind: 'review', level: this.ed.level, words, sources: citedWorksOf(this.body), mode: v.mode, ...scopeBody() }))) return;
      this.cancelRev(); v.busy = true; v.error = ''; v.note = ''; v.waited = 0;
      const ac = new AbortController(); this.revAc = ac;
      this.revTimer = setInterval(() => { v.waited++; }, 1000);
      const sent = this.body;
      let out = null, err = '';
      try {
        const r = await api('/api/drafts/' + encodeURIComponent(this.doc.id) + '/review', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal,
          body: JSON.stringify({ body: sent, instruction: v.instruction, mode: v.mode, level: this.ed.level, genre: this.ed.genre, ...scopeBody() }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || $t('The server is not responding'));
        out = d;
      } catch (e) { err = e.name === 'AbortError' ? '' : (e.message || $t('Error')); }
      if (this.revAc !== ac) return;
      clearInterval(this.revTimer); this.revAc = null; v.busy = false;
      if (err) { v.error = err; return; }
      if (!out) return;
      v.report = out.report || ''; v.reportPath = out.reportPath || ''; v.open = true;
      if (out.warnings?.length) this.warnings = [...this.warnings, ...out.warnings];
      if (out.mode !== 'fix' || !out.markdown) return;
      if (this.body !== sent) { v.error = $t('The text changed while {ai} was working, so the corrected text was not put in. The report is below.'); return; }
      this.pushUndo(sent); this.body = out.markdown; this.mode = 'preview'; this.flash = null; v.instruction = '';
      this.addCited(out.cited);
      v.note = $t('The corrected text is in the editor. Read the report, check the text and press “Save”.');
    },
    cancelRev() { const ac = this.revAc; this.revAc = null; clearInterval(this.revTimer); ac?.abort(); this.rev.busy = false; },
    async load() {
      this.cancelCont(); this.cancelBlock(); this.cancelRev(); this.cont.note = ''; this.rev.note = ''; this.rev.report = ''; this.rev.reportPath = ''; this.rev.error = '';
      this.blk.open = ''; this.undoStack = []; this.flash = null; this.titleEdit = null;
      this.doc = null; this.loadError = false; this.mode = 'preview';
      let w = []; try { w = JSON.parse(store.get('writewarn:' + this.id, '[]')); } catch {}
      this.warnings = w; store.set('writewarn:' + this.id, '[]');
      try {
        const r = await fetch('/api/drafts/' + encodeURIComponent(this.id));
        if (!r.ok) { this.loadError = true; return; }
        const d = await r.json();
        const blank = store.get('writeblank:' + this.id, '') === '1';
        if (blank) store.set('writeblank:' + this.id, '');
        const body = blank ? d.body.replace(/\s*$/, '\n\n') : d.body; // the blank document opens with the cursor on a new line
        this.doc = d; this.body = body; this.saved = body; this.bibHeads = d.bibHeads || [];
        this.ed.genre = genreOk(d.genre); this.ed.creativity = d.creativity || CREATIVITY_DEFAULT[this.ed.genre];
        // The scope with which the text was written becomes the current one: it is visible and can be changed
        if (d.scope && (d.scope.areas?.length || d.scope.focus?.length)) {
          scope.areas = [...(d.scope.areas || [])]; scope.focus = [...(d.scope.focus || [])]; store.set('scope:areas', JSON.stringify(scope.areas));
          this.$root.syncScope(); // in a room the areas stay the room's
        }
        this.savedMeta = this.metaKey;
        document.title = $t('{0} · Library', [d.title]);
        // a new blank document: a place to write at once (the help is collapsed, without changing what is remembered)
        if (blank) { this.mode = 'edit'; this.ed.open = false; this.$nextTick(() => { const t = this.$refs.raw; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }); }
      } catch { this.loadError = true; }
    },
    async save(quiet = false) {
      if (!this.doc || this.saving) return;
      const id = this.doc.id, body = this.body, key = this.metaKey;
      const meta = { genre: this.ed.genre, creativity: this.ed.creativity, scope: scopeBody(), cites: this.doc.cites || [] };
      this.saving = true;
      try {
        const r = await (await api('/api/drafts/' + encodeURIComponent(id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body, meta }) })).json();
        if (r.ok) { this.saved = body; this.savedMeta = key; this.doc = { ...this.doc, title: r.title, words: r.words, updated: r.updated }; if (!quiet) this.$emit('toast', { text: $t('Saved.') }); }
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
      this.saved = this.body; this.savedMeta = this.metaKey; // without automatic saving when leaving
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
      if (this.$root.room) { // a room: only its pages and the links between them
        const keep = new Set(this.$root.pages.map((p) => p.slug));
        g.nodes = g.nodes.filter((n) => keep.has(n.id)); g.edges = g.edges.filter(([a, b]) => keep.has(a) && keep.has(b));
      }
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
    // Scales and centres, so that all the points are visible (until the user touches the map)
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

// ---------- Application ----------
// The start of the archive (read-only): counters, latest changes and tags. Replaces the start page with Claude.
// ---------- Log: wiki/log.md, the newest entries on top, by days, with a filter by kind and search ----------
const LOG_PAGE = 60;
const LogView = defineComponent({
  template: '#tpl-log',
  props: { pages: Array, version: Number },
  data: () => ({ ...shared, entries: null, error: '', kind: '', q: '', limit: LOG_PAGE, open: {} }),
  created() { this.load(); },
  watch: {
    version() { this.load(); }, // a new entry from processing or a manual change: the list refreshes itself
    kind() { this.limit = LOG_PAGE; },
    q() { this.limit = LOG_PAGE; },
  },
  computed: {
    kinds() {
      const n = {};
      for (const e of this.entries || []) n[e.kind] = (n[e.kind] || 0) + 1;
      return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ k, n: c }));
    },
    filtered() {
      const q = this.q.trim().toLowerCase();
      return (this.entries || []).filter((e) => (!this.kind || e.kind === this.kind) && (!q || (e.title + '\n' + e.body).toLowerCase().includes(q)));
    },
    // by days: "today", "yesterday", then the date
    groups() {
      const g = [];
      for (const e of this.filtered.slice(0, this.limit)) {
        if (!g.length || g[g.length - 1].date !== e.date) g.push({ date: e.date, items: [] });
        g[g.length - 1].items.push(e);
      }
      return g;
    },
    known() { return new Set(this.pages.map((p) => p.slug)); },
    titles() { return new Map(this.pages.map((p) => [p.slug, p.title])); },
  },
  methods: {
    async load() {
      try { const d = await (await fetch('/api/log')).json(); this.entries = d.entries || []; this.error = ''; }
      catch { this.error = $t('The server is not responding.'); if (!this.entries) this.entries = []; }
    },
    dayLabel(d) {
      if (!d) return $t('Without a date');
      const rel = relDate(d);
      const full = new Date(d + 'T00:00:00').toLocaleDateString(I18N.lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return rel === $t('today') || rel === $t('yesterday') ? `${rel[0].toUpperCase() + rel.slice(1)} · ${full}` : full;
    },
    key: (e) => e.n + '|' + e.date,
    body(e) { return renderMarkdown(e.body, this.known, this.titles); },
    long: (e) => e.body.split('\n').length > 6,
    onClick(e) {
      const a = e.target.closest('a.wl');
      if (a) { e.preventDefault(); location.hash = '#/p/' + a.dataset.slug; }
    },
  },
});

// ---------- Collections: the kinds in the menu, the smart collections and the manual lists ----------
const CollectionsView = defineComponent({
  template: '#tpl-collections',
  props: { pages: Array },
  data: () => ({ ...shared }),
  computed: {
    col() { return this.$root.collections; },
    types() { return this.$root.allTypes; },
    smart() { return this.col.items.filter((c) => c.kind === 'smart'); },
    lists() { return this.col.items.filter((c) => c.kind === 'list'); },
  },
  methods: {
    count(c) { return this.$root.colCount(c); },
    hidden(t) { return this.col.menu.hidden.includes(t); },
    toggleType(t) {
      const h = this.col.menu.hidden;
      this.$root.saveMenu({ hidden: h.includes(t) ? h.filter((x) => x !== t) : [...h, t] });
    },
    moveType(i, dir) {
      const order = this.types.map((x) => x.t), j = i + dir;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      this.$root.saveMenu({ order });
    },
    resetTypes() { this.$root.saveMenu({ order: [], hidden: [] }); },
    // the collections move only among their own kind (smart or lists)
    moveCol(c, dir) {
      const same = this.col.items.filter((x) => x.kind === c.kind), i = same.indexOf(c), j = i + dir;
      if (j < 0 || j >= same.length) return;
      const ids = this.col.items.map((x) => x.id), a = ids.indexOf(c.id), b = ids.indexOf(same[j].id);
      [ids[a], ids[b]] = [ids[b], ids[a]];
      this.$root.saveMenu({ items: ids });
    },
  },
});

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
  if (parts[0] === 'col' && parts[1]) return { name: 'custom', id: parts[1] };
  if (parts[0] === 'collections') return { name: 'collections' };
  if (parts[0] === 'log') return { name: 'log' };
  if (parts[0] === 'tag' && parts[1]) return { name: 'tag', tag: parts[1] };
  if (parts[0] === 'graph') return { name: 'graph' };
  if (parts[0] === 'write') return { name: 'write', id: parts[1] || '' };
  if (parts[0] === 'find') return { name: 'find' };
  if (parts[0] === 'scan') return { name: 'scan' };
  if (parts[0] === 'areas') return { name: 'areas' };
  if (parts[0] === 'setup') return { name: 'setup' };
  if (parts[0] === 'welcome') return { name: 'welcome' };
  if (parts[0] === 'docs') return { name: 'docs', id: parts[1] || '' };
  if (parts[0] === 'settings') return { name: 'settings', section: SETTINGS_SECTIONS.some((s) => s.id === parts[1]) ? parts[1] : 'model' };
  if (parts[0] === 'path') return { name: 'path', q: parts.slice(1).join('/'), mode: new URLSearchParams(hashQuery).get('m') || 'local' };
  return { name: 'page', slug: parts[0] }; // old links #/slug
}


// ---------- Backups and synchronisation (scripts/sync.js) ----------
const ago = (iso) => {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 2) return $t('just now');
  if (m < 60) return $t('{0} min ago', [m]);
  if (m < 1440) return $t('{0} h ago', [Math.round(m / 60)]);
  return $t('{0} days ago', [Math.round(m / 1440)]);
};
const SYNC_MODES = () => ({
  backup: { label: $t('Backup'), hint: $t('A copy for disaster recovery. Always writes yours to the folder; older versions and files you deleted go to _deleted.') },
  sync: { label: $t('Shared folder'), hint: $t('A folder you share with other people (for example in a cloud service). Only the sources, the pages and the drafts go there; your settings, history and code stay yours. If they changed something, you are asked what to take and what to overwrite.') },
  pull: { label: $t('Take from a copy'), hint: $t('Only takes what a colleague added. Nothing is written in their folder.') },
});
const jpost = async (url, body) => { try { return await (await api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json(); } catch { return { ok: false, error: $t('The server is not responding.') }; } };
const SyncModal = defineComponent({
  template: '#tpl-sync-modal',
  props: { req: Object },
  emits: ['close'],
  data: () => ({ showFiles: false, targets: [], tid: '', stage: 'pick', plan: null, dec: {}, choices: {}, segs: {}, previews: {}, open: {}, result: null, error: '', progress: null, timer: null }),
  computed: {
    target() { return this.targets.find((t) => t.id === this.tid); },
    items() { return this.plan ? [...this.plan.conflicts.map((c) => ({ ...c, conflict: true })), ...this.plan.incoming] : []; },
  },
  async mounted() {
    await this.load();
    const id = this.req?.id || (this.targets.length === 1 && this.targets[0].online ? this.targets[0].id : '');
    if (id) this.start(id);
  },
  beforeUnmount() { this.stopPoll(); },
  methods: {
    ago, size, modeLabel: (m) => SYNC_MODES()[m]?.label || m,
    catInfo(c) {
      return ({
        raw: [$t('Original files'), $t('Your books, articles and other sources (PDF, EPUB, DOCX…)')],
        extracted: [$t('Extracted text'), $t('Text taken from the sources, used for reading and searching')],
        wiki: [$t('Pages'), $t('The pages {ai} wrote: sources, chapters, concepts, people, topics, the index and the log')],
        drafts: [$t('Drafts'), $t('Your articles from “Write with the wiki”')],
        outputs: [$t('Settings and history'), $t('Your collections, saved paths, history of processing and reports')],
        history: [$t('Undo history'), $t('The history that “Undo” uses (.library-git)')],
        code: [$t('Program code'), $t('The program itself, without node_modules')],
      })[c] || [c, ''];
    },
    pushCats() { return Object.entries(this.plan?.pushSummary || {}).map(([c, g]) => ({ c, ...g, label: this.catInfo(c)[0], hint: this.catInfo(c)[1] })); },
    async load() { // the server tells the truth; on an error an error is shown, not "no copies"
      try { this.targets = (await (await api('/api/sync')).json()).targets || []; this.$root.syncInfo = this.targets; }
      catch { this.targets = this.$root.syncInfo || []; this.error = $t('The server is not responding.'); }
    },
    poll() { this.stopPoll(); this.timer = setInterval(async () => { try { this.progress = (await (await api('/api/sync')).json()).progress; } catch { /* the next attempt */ } }, 400); },
    stopPoll() { if (this.timer) clearInterval(this.timer); this.timer = null; this.progress = null; },
    async start(id) {
      this.tid = id; this.stage = 'loading'; this.error = ''; this.plan = null; this.poll();
      const p = await jpost(`/api/sync/${id}/plan`);
      this.stopPoll();
      if (!p.ok) { this.error = p.error || $t('I could not'); this.stage = this.req?.id ? 'plan' : 'pick'; return; }
      this.plan = p; this.stage = 'plan';
    },
    startReview() {
      this.dec = {}; this.choices = {}; this.segs = {}; this.open = {};
      for (const it of this.items) { this.dec[it.rel] = 'skip'; }
      this.stage = 'review';
    },
    options(it) {
      const o = [{ v: 'skip', t: $t('Skip') }, { v: 'theirs', t: it.conflict ? $t('Take theirs') : $t('Take') }];
      if (it.conflict) o.splice(1, 0, { v: 'mine', t: $t('Keep mine') });
      if (it.text && it.kind !== 'log' && (it.conflict || it.kind === 'changed')) o.push({ v: 'merge', t: $t('By paragraph') });
      return o;
    },
    takeAll(changed) { for (const it of this.items) if (it.conflict ? changed && !it.text : (changed || it.kind === 'new' || it.kind === 'log')) this.dec[it.rel] = 'theirs'; },
    skipAll() { for (const it of this.items) this.dec[it.rel] = 'skip'; },
    async toggle(it) {
      this.open[it.rel] = !this.open[it.rel];
      if (!this.open[it.rel] || this.segs[it.rel] || this.previews[it.rel]) return;
      const d = await jpost(`/api/sync/${this.tid}/diff`, { rel: it.rel });
      if (d.segments) {
        let k = 0; this.segs[it.rel] = d.segments.map((g) => (g.same ? g : { ...g, k: k++ }));
        this.choices[it.rel] = Array.from({ length: k }, () => (it.conflict ? 'm' : 't'));
      } else this.previews[it.rel] = d.preview || '';
    },
    choose(rel, k, v) { this.choices[rel][k] = v; this.dec[rel] = 'merge'; },
    async forget() { await jpost(`/api/sync/${this.tid}/forget`); this.start(this.tid); },
    confirmOverwrite() {
      if (window.confirm($t('Overwrite the changes by others with yours? Their versions stay in _deleted in that folder.'))) this.run('overwrite');
    },
    async run(strategy) {
      const decisions = {};
      if (strategy === 'review') for (const it of this.items) {
        const d = this.dec[it.rel];
        if (d === 'merge') decisions[it.rel] = { choices: (this.choices[it.rel] || []).slice() };
        else if (d && d !== 'skip') decisions[it.rel] = d;
      }
      this.stage = 'running'; this.error = ''; this.poll();
      const r = await jpost(`/api/sync/${this.tid}/run`, { strategy, decisions });
      this.stopPoll();
      this.result = r; this.stage = 'result';
      this.$root.refresh(); this.$root.loadSync();
      if (r.ok && (r.pulled || r.merged)) this.$root.loadAgent?.();
    },
    close() { if (this.stage === 'running') return; this.$emit('close'); },
  },
});

const BackupSettings = defineComponent({
  template: '#tpl-backup-settings',
  data: () => ({ targets: [], isolated: false, form: { name: '', path: '', mode: 'backup', code: true, secrets: false, keepDays: 30 }, probe: null, error: '', busy: false, checks: {} }),
  mounted() { this.load(); },
  watch: { '$root.syncReq'(v) { if (!v) this.load(); } },
  methods: {
    ago, size, modeLabel: (m) => SYNC_MODES()[m].label, modeHint: (m) => SYNC_MODES()[m].hint,
    async load() { try { const d = await (await api('/api/sync')).json(); this.targets = d.targets || []; this.isolated = !!d.isolated; } catch { this.targets = []; } this.$root.loadSync(); },
    async test() { this.probe = this.form.path.trim() ? await jpost('/api/sync/check', { path: this.form.path }) : null; },
    async add() {
      this.busy = true; this.error = '';
      const r = await jpost('/api/sync/targets', this.form);
      this.busy = false;
      if (!r.ok) { this.error = r.error || $t('I could not'); return; }
      this.form = { name: '', path: '', mode: 'backup', code: true, secrets: false, keepDays: 30 }; this.probe = null;
      this.$root.toast({ text: $t('The copy was added.') });
      await this.load();
    },
    async remove(t) {
      if (!window.confirm($t('Remove “{0}” from the list? The files in the folder stay where they are.', [t.name]))) return;
      await api('/api/sync/targets/' + encodeURIComponent(t.id), { method: 'DELETE' });
      this.load();
    },
    async verify(t) { this.checks[t.id] = { ok: true, files: 0, missingCount: 0, differentCount: 0, wait: true }; this.checks[t.id] = await jpost(`/api/sync/${t.id}/verify`); },
  },
});

const app = createApp({
  template: '#tpl-app',
  data: () => ({
    // allPages: everything the server knows; pages (computed) is what the person sees: the whole library or one room (an area)
    ...shared, I18N, route: parseRoute(), allPages: [], pending: [], room: store.get('room', ''), roomMenu: false, stats: {}, version: 0, live: false, setupLeft: 0, tour: false, appInfo: null, stopped: false,
    drawer: false, palette: false, pq: '', hits: [], pi: 0, toasts: [], agent: null, reader: null, cost: null,
    manual: [], manualHidden: false, manualShow: false, manualText: '', manualBusy: false, manualError: '', // manual mode (copying into a chat)
    updInfo: null, updOpen: false, modelWarn: null, modelWarnHidden: false, // quiet checks at start: a new version, a retired model
    syncReq: null, syncInfo: [], // backups: the open window and the targets (for the button in the menu)
    focus: store.get('focus', '0') === '1', // focus mode: only the text of the page (remembered on this computer)
    navHidden: store.get('nav:hidden', '0') === '1', // the side menu hidden (remembered on this computer)
    theme: store.get('theme', 'system'), isMac: /Mac|iPhone|iPad/.test(navigator.platform),
    collections: { menu: { order: [], hidden: [] }, items: [] }, colEdit: null, // the person's collections and the window for them
    navClosed: (() => { try { return JSON.parse(store.get('nav:closed', '{}')) || {}; } catch { return {}; } })(), // the collapsed groups in the menu
  }),
  computed: {
    // ---------- Rooms: entering an area shows only its pages everywhere (menu, search, map, collections, learning, writing) ----------
    pages() { return this.room ? this.allPages.filter((p) => p.special || p.area === this.room) : this.allPages; },
    rooms() {
      const m = new Map();
      for (const p of this.allPages) if (!p.special && p.area) { const e = m.get(p.area) || { name: p.area, pages: 0, sources: 0 }; e.pages++; if (p.type === 'source') e.sources++; m.set(p.area, e); }
      return [...m.values()].sort((a, b) => b.sources - a.sources || a.name.localeCompare(b.name, I18N.lang));
    },
    // the numbers of the sidebar and the home page: for a room they are counted from its pages, the work in progress stays as it is
    viewStats() {
      if (!this.room) return this.stats;
      const own = this.pages.filter((p) => !p.special), keep = new Set(own.map((p) => p.slug));
      const byType = {}, tags = new Map();
      for (const p of own) { byType[p.type] = (byType[p.type] || 0) + 1; for (const t of p.tags || []) tags.set(t, (tags.get(t) || 0) + 1); }
      return {
        ...this.stats, pages: own.length, raw: byType.source || 0, byType, log: [],
        tags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
        recent: (this.stats.recent || []).filter((p) => keep.has(p.slug)),
        lowConfidence: (this.stats.lowConfidence || []).filter((p) => keep.has(p.slug)),
      };
    },
    syncStale() { if (!this.syncInfo.length) return false; const t = this.syncInfo.map((x) => x.last?.at).filter(Boolean).sort().pop(); return !t || Date.now() - new Date(t).getTime() > 7 * 86400000; },
    syncLine() {
      if (!this.syncInfo.length) return $t('Your library is only on this computer');
      const t = this.syncInfo.map((x) => x.last?.at).filter(Boolean).sort().pop();
      return t ? $t('Last copy: {0}', [ago(t)]) : $t('Never copied');
    },
    focusOn() { return this.focus && this.route.name === 'page' && !['index', 'log', 'overview'].includes(this.route.slug); },
    countBy() { return this.pages.reduce((a, p) => (p.special ? a : ((a[p.type] = (a[p.type] || 0) + 1), a)), {}); },
    // The kinds that exist in wiki/: first in the order chosen by the person, then the default one, then the new ones in alphabetical order
    allTypes() {
      const rank = (t) => { const i = this.collections.menu.order.indexOf(t); if (i >= 0) return i; const j = NAV_ORDER.indexOf(t); return 1000 + (j >= 0 ? j : 100); };
      return Object.entries(this.countBy).filter(([t]) => !!t)
        .map(([t, n]) => ({ t, n })).sort((a, b) => rank(a.t) - rank(b.t) || a.t.localeCompare(b.t));
    },
    navTypes() { return this.allTypes.filter((x) => !this.collections.menu.hidden.includes(x.t)); },
    smartCols() { return this.collections.items.filter((c) => c.kind === 'smart'); },
    listCols() { return this.collections.items.filter((c) => c.kind === 'list'); },
    // for the window of a smart collection: what can be chosen and how many pages will come in
    tagOptions() {
      const n = new Map();
      for (const p of this.pages) if (!p.special) for (const t of p.tags || []) n.set(t, (n.get(t) || 0) + 1);
      return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
    },
    areaOptions() { return [...new Set(this.allPages.map((p) => p.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, I18N.lang)); },
    formatOptions() { return [...new Set(this.pages.map((p) => p.format).filter(Boolean))]; },
    colEditCount() { return this.colEdit?.kind === 'smart' ? this.pages.filter((p) => matchFilter(p, this.colEdit.filter)).length : 0; },
    paletteItems() {
      if (this.pq.trim().length >= 2) return this.hits;
      return [...this.pages].filter((p) => !p.special).sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))).slice(0, 8);
    },
  },
  methods: {
    async loadSync() { if (window.LIB_STATIC) return; try { this.syncInfo = (await (await api('/api/sync')).json()).targets || []; } catch { /* the button stays as it is */ } },
    openSync(id) { this.syncReq = { id: id || '' }; },
    closeSync() { this.syncReq = null; this.loadSync(); },
    syncButton() { this.drawer = false; if (this.syncInfo.length) this.openSync(); else location.hash = '#/settings/backup'; },
    setNav(show) { this.navHidden = !show; store.set('nav:hidden', show ? '0' : '1'); },
    setFocus(v) { this.focus = !!v; store.set('focus', v ? '1' : '0'); },
    // In the archive the screens that write or call Claude do not work: we return to the start
    guardArchive() { if (window.LIB_STATIC && ['path', 'write', 'find', 'scan', 'areas', 'setup', 'settings', 'collections', 'welcome', 'docs'].includes(this.route.name)) location.hash = '#/'; },
    // ---------- The menu: collapsing the groups ----------
    navOpen(g) { return !this.navClosed[g]; },
    navToggle(g) { this.navClosed = { ...this.navClosed, [g]: !this.navClosed[g] }; store.set('nav:closed', JSON.stringify(this.navClosed)); },
    // ---------- The person's collections ----------
    async loadCollections() {
      try { const d = await (await fetch('/api/collections')).json(); if (d && Array.isArray(d.items)) this.collections = d; } catch { /* the menu stays with the kinds */ }
    },
    colCount(c) {
      if (c.kind === 'smart') return this.pages.filter((p) => matchFilter(p, c.filter)).length;
      const known = new Set(this.pages.map((p) => p.slug));
      return c.slugs.filter((s) => known.has(s)).length;
    },
    async colSend(url, body, method = 'POST') {
      try {
        const r = await (await api(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
        if (r.collections) this.collections = r.collections;
        if (!r.ok) this.toast({ text: r.error || $t('I could not'), icon: 'alert' });
        return r;
      } catch { this.toast({ text: $t('The server is not responding'), icon: 'alert' }); return { ok: false }; }
    },
    // The window for a new or an existing collection: spec is the collection or { kind, slugs }
    openColEditor(spec = {}) {
      const kind = spec.kind === 'list' ? 'list' : 'smart';
      const f = spec.filter || {};
      this.colEdit = {
        id: spec.id || null, kind, name: spec.name || '', slugs: spec.slugs ? [...spec.slugs] : [], tagInput: '', busy: false,
        filter: { types: [...(f.types || [])], tags: [...(f.tags || [])], areas: [...(f.areas || [])], formats: [...(f.formats || [])], confidence: [...(f.confidence || [])], status: [...(f.status || [])], author: f.author || '', q: f.q || '', yearFrom: f.yearFrom || '', yearTo: f.yearTo || '' },
      };
      this.$nextTick(() => this.$refs.colName?.focus());
    },
    colToggle(field, v) { const a = this.colEdit.filter[field]; const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); },
    colAddTag() { const t = this.colEdit.tagInput.trim().replace(/^#/, ''); if (t && !this.colEdit.filter.tags.includes(t)) this.colEdit.filter.tags.push(t); this.colEdit.tagInput = ''; },
    async saveColEditor() {
      const e = this.colEdit; if (!e || !e.name.trim()) return;
      e.busy = true;
      const body = { id: e.id || undefined, kind: e.kind, name: e.name };
      if (e.kind === 'smart') body.filter = { ...e.filter, yearFrom: e.filter.yearFrom || null, yearTo: e.filter.yearTo || null };
      else if (!e.id) body.slugs = e.slugs;
      const r = await this.colSend('/api/collections', body);
      e.busy = false;
      if (!r.ok) return;
      this.colEdit = null;
      this.toast({ text: e.id ? $t('Saved') : $t('Collection created: “{0}”', [r.item.name]) });
      if (!e.id && !e.slugs.length) location.hash = '#/col/' + r.item.id; // a new blank or smart collection: it opens at once
    },
    async deleteCollection(c) {
      if (!confirm($t('Delete the collection “{0}”? The pages themselves are not touched.', [c.name]))) return;
      const r = await this.colSend('/api/collections/' + encodeURIComponent(c.id), null, 'DELETE');
      if (r.ok) { this.toast({ text: $t('The collection was deleted.') }); if (this.route.name === 'custom' && this.route.id === c.id) location.hash = '#/collections'; }
    },
    async listChange(id, change, okText) {
      const r = await this.colSend('/api/collections/' + encodeURIComponent(id) + '/pages', change);
      if (r.ok && okText) this.toast({ text: okText, icon: 'bookmark' });
    },
    saveMenu(patch) { return this.colSend('/api/collections/menu', patch); },
    async refresh() {
      const [pages, stats] = await Promise.all([fetch('/api/pages').then((r) => r.json()), fetch('/api/stats').then((r) => r.json())]);
      this.allPages = pages; this.stats = stats;
      this.pending = await fetch('/api/pending').then((r) => (r.ok ? r.json() : [])).catch(() => []); // listed in the index, no file yet
      // the room was renamed, merged or emptied: we step out into the whole library
      if (this.room && !this.rooms.some((r) => r.name === this.room)) this.setRoom('');
      else if (this.room) this.syncScope();
    },
    // In a room, learning and writing work only inside it: the chosen areas of the scope are the room
    syncScope() {
      const want = this.room ? [this.room] : [];
      if (scope.areas.join(',') !== want.join(',')) { scope.areas = want; store.set('scope:areas', JSON.stringify(want)); }
    },
    setRoom(name) {
      this.room = name || ''; store.set('room', this.room);
      scope.focus = [];
      if (this.room) this.syncScope(); else { scope.areas = []; store.set('scope:areas', '[]'); }
      this.roomMenu = false; this.drawer = false; this.version++; // the map is drawn again
      if (this.route.name === 'page' && this.room) {
        const p = this.allPages.find((x) => x.slug === this.route.slug);
        if (p && !p.special && p.area !== this.room) location.hash = '#/'; // the page we were on is in another room
      } else if (['index', 'log'].includes(this.route.slug) && this.room) location.hash = '#/';
    },
    toast({ text, icon }) {
      const t = { id: Math.random(), text, icon };
      this.toasts.push(t);
      setTimeout(() => (this.toasts = this.toasts.filter((x) => x.id !== t.id)), 3500);
    },
    // Changing the language from the menu: if processing is running, the server refuses; the selector returns and the reason is shown
    async changeLang(e) {
      const r = await I18N.setLang(e.target.value);
      if (!r.ok) { e.target.value = I18N.lang; this.toast({ text: r.error, icon: 'alert' }); }
    },
    // An estimate of tokens and cost before every action with Claude. Returns true if the person confirms.
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
      this.version++; // the graph is redrawn with the new colours
    },
    // ---------- Reader ----------
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
    // Only if the address in the browser is really the start page (this.route may lag after fast navigation)
    onHome() { return parseRoute().name === 'home'; },
    // Two quiet requests when the program starts: is there a new version, and does the chosen model still exist.
    // Both can be turned off in Settings -> Updates (the choice is kept in this browser).
    async quietChecks() {
      if (store.get('updates:auto', '1') !== '1') return;
      try {
        const u = await (await fetch('/api/updates/quick')).json();
        if (u.ok && u.status === 'behind' && store.get('updates:skip', '') !== u.remote) this.updInfo = u;
      } catch { /* no network: stay silent */ }
      try {
        const h = await (await fetch('/api/ai/health')).json();
        if (h && h.ok === false && h.missing?.length) this.modelWarn = h;
      } catch { /* stay silent */ }
    },
    skipVersion() { store.set('updates:skip', this.updInfo?.remote || ''); this.updOpen = false; this.updInfo = null; },
    async loadAgent() {
      try { this.agent = await (await fetch('/api/agent')).json(); } catch {}
      // First start: the welcome comes at once, without waiting for the checks of the setup screen
      if (this.agent?.settings && !this.agent.settings.welcomeDone && this.onHome()) location.hash = '#/welcome';
      if (AI.engine === 'manual') { try { this.setManual(await (await fetch('/api/manual')).json()); } catch {} }
      this.loadSetup();
    },
    // ---------- Manual mode: requests that wait for an answer from the chat ----------
    setManual(items) {
      const first = this.manual[0]?.id;
      this.manual = Array.isArray(items) ? items : [];
      if (this.manual[0]?.id !== first) { this.manualText = ''; this.manualError = ''; this.manualShow = false; if (this.manual.length) this.manualHidden = false; }
    },
    async manualSend() {
      const it = this.manual[0]; if (!it) return;
      this.manualBusy = true; this.manualError = '';
      try {
        const r = await (await api('/api/manual/' + encodeURIComponent(it.id), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: this.manualText }) })).json();
        if (!r.ok) this.manualError = r.error || $t('I could not');
      } catch { this.manualError = $t('The server is not responding.'); }
      finally { this.manualBusy = false; }
    },
    async manualSkip() {
      const it = this.manual[0]; if (!it) return;
      if (!confirm($t('Stop this request? The task it belongs to stops too, and its half-finished changes are rolled back.'))) return;
      try { await api('/api/manual/' + encodeURIComponent(it.id) + '/cancel', { method: 'POST' }); } catch {}
    },
    // A dot in the menu if something required is missing; on the first sign-in it opens the setup screen
    async loadSetup() {
      try {
        const s = await (await fetch('/api/setup')).json();
        this.setupLeft = s.blocking;
        // First start: a welcome, then (if something is missing) the setup screen
        if (this.agent?.settings && !this.agent.settings.welcomeDone && this.onHome()) location.hash = '#/welcome';
        else if (s.blocking && !this.agent?.settings?.setupDone && this.onHome()) location.hash = '#/setup';
      } catch {}
    },
    async loadApp() { try { this.appInfo = await (await fetch('/api/app')).json(); } catch {} },
    startTour() { this.drawer = false; location.hash = '#/'; this.tour = true; },
    async finishWelcome(to) {
      try { await api('/api/agent/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ welcomeDone: true }) }); } catch {}
      await this.loadAgent();
      location.hash = to || '#/';
    },
    async quitApp() {
      if (!confirm($t('Stop the library and close the window?'))) return;
      try { await api('/api/app/quit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch {}
      this.stopped = true;
    },
    openPalette() { this.palette = true; this.pq = ''; this.hits = []; this.pi = 0; this.$nextTick(() => this.$refs.paletteInput?.focus()); },
    paletteSearch() {
      clearTimeout(this._t); this.pi = 0;
      this._t = setTimeout(async () => {
        const hits = this.pq.trim().length >= 2 ? await (await fetch('/api/search?q=' + encodeURIComponent(this.pq.trim()))).json() : [];
        const known = this.room ? new Set(this.pages.map((p) => p.slug)) : null; // in a room only its pages are found
        this.hits = known ? hits.filter((h) => known.has(h.slug)) : hits;
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
        if (d.type === 'manual') { this.setManual(d.items); return; }
        clearTimeout(this._rt);
        this._rt = setTimeout(() => { this.refresh(); this.version++; }, 250);
      };
    },
  },
  async mounted() {
    window.addEventListener('hashchange', () => { this.route = parseRoute(); this.drawer = false; this.roomMenu = false; if (this.route.name !== 'page') document.title = $t('Library'); this.guardArchive(); });
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.palette ? (this.palette = false) : this.openPalette(); }
      else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); this.openPalette(); }
      else if (e.key === '[' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) { this.setNav(this.navHidden); }
      else if (e.key === 'Escape') {
        if (this.focusOn && !this.reader && !this.palette && !this.drawer) this.setFocus(false); // Esc leaves the focus
        this.palette = false; this.drawer = false; this.reader = null;
      }
      else if (this.reader && !this.palette && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); this.readerGo(e.key === 'ArrowRight' ? 1 : -1); }
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.theme === 'system' && this.setTheme('system'));
    this.guardArchive();
    await Promise.all([this.refresh(), this.loadCollections(), window.LIB_STATIC ? null : this.loadAgent(), this.loadSync(), window.LIB_STATIC ? null : this.loadApp()]);
    if (!window.LIB_STATIC) { this.connect(); this.quietChecks(); } // the archive has no server and no live events
  },
});

app.config.globalProperties.$t = $t;
app.component('ic', Ic);
app.component('sync-modal', SyncModal);
app.component('backup-settings', BackupSettings);
app.component('page-card', PageCard);
app.component('home-view', HomeView);
app.component('page-view', PageView);
app.component('collection-view', CollectionView);
app.component('graph-view', GraphView);
app.component('path-view', PathView);
app.component('write-view', WriteView);
app.component('find-view', FindView);
app.component('scan-view', ScanView);
app.component('areas-view', AreasView);
app.component('setup-view', SetupView);
app.component('settings-view', SettingsView);
app.component('app-settings', AppSettings);
app.component('welcome-view', WelcomeView);
app.component('docs-view', DocsView);
app.component('tour-overlay', TourOverlay);
app.component('ai-settings', AiSettings);
app.component('scope-bar', ScopeBar);
app.component('code-update', CodeUpdate);
app.component('view-toggle', ViewToggle);
app.component('archive-home', ArchiveHome);
app.component('log-view', LogView);
app.component('collections-view', CollectionsView);
app.mount('#app');
