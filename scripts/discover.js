// Добавяне на статия по DOI или по директен адрес (без търсене в каталози).
// DOI се разрешава през doi.org към страницата на издателя; от нея се четат метаданните (citation_* етикетите,
// които издателите слагат за Google Scholar) и връзката към PDF, ако има такава. После се сваля PDF файлът или,
// ако няма свободен, текстът на страницата, а най-накрая само резюмето. Всичко отива в raw/inbox/.
//
// Сигурност: свалят се само https адреси; адресът и всяко пренасочване се проверяват да не сочат към
// локалната мрежа; размерът е ограничен; PDF се признава само по съдържание (%PDF).
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { RAW } from './lib.js';
import { $t } from './i18n.js';
import { P } from './vocab.js';

const INBOX = path.join(RAW, 'inbox');
const MAX_BYTES = 120 * 1024 ** 2;
const UA = 'LLM-Wiki/1.0 (personal reading tool; mailto:' + (process.env.LIBRARY_MAILTO || 'noreply@example.com') + ')';

const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: '', ю: 'yu', я: 'ya' };
const latin = (s) => [...String(s).toLowerCase()].map((c) => (c in CYR ? CYR[c] : c)).join('').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') ;
}

/** Проверява, че адресът е публичен https. Връща URL обекта или хвърля грешка. */
async function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error($t('Invalid address.')); }
  if (u.protocol !== 'https:') throw new Error($t('Only https addresses are supported.'));
  if (u.port && u.port !== '443') throw new Error($t('This port is not allowed.'));
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || /\.(local|internal|lan)$/i.test(host)) throw new Error($t('The address points to the local network.'));
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error($t('The address points to the local network.'));
  return u;
}

/** Сваля тялото на отговора с ограничение на размера; следва пренасочвания само към публични адреси */
async function download(rawUrl, accept) {
  let url = rawUrl;
  for (let hop = 0; hop < 5; hop++) {
    const u = await safeUrl(url);
    const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(90000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), u).href; continue; }
    if (!r.ok) throw new Error($t('The site responded with {0}.', [r.status]));
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error($t('The file is too large.'));
    const chunks = []; let n = 0;
    for await (const c of r.body) { n += c.length; if (n > MAX_BYTES) throw new Error($t('The file is too large.')); chunks.push(c); }
    return { buf: Buffer.concat(chunks), type: String(r.headers.get('content-type') || ''), url };
  }
  throw new Error($t('Too many redirects.'));
}

function uniqueName(dir, base, ext) {
  let t = path.join(dir, base + ext);
  for (let i = 2; fs.existsSync(t); i++) t = path.join(dir, `${base}-${i}${ext}`);
  return t;
}


const decode = (t) => String(t).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

/** Метаданни от етикетите на страницата (citation_*, DC.*, og:*) */
function metaOf(html) {
  const out = {};
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content\s*=\s*["']([\s\S]*?)["']\s*\/?>/i) || [])[1];
    if (!name || content == null) continue;
    (out[name.toLowerCase()] ||= []).push(decode(content));
  }
  const first = (...k) => { for (const x of k) if (out[x]?.[0]) return out[x][0]; return null; };
  const year = (first('citation_publication_date', 'citation_date', 'citation_online_date', 'dc.date', 'article:published_time') || '').match(/(19|20)\d{2}/)?.[0] || null;
  return {
    title: first('citation_title', 'dc.title', 'og:title') || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''),
    authors: out.citation_author || out['dc.creator'] || [],
    year: year ? Number(year) : null,
    doi: first('citation_doi', 'dc.identifier'),
    venue: first('citation_journal_title', 'citation_conference_title', 'og:site_name'),
    lang: first('citation_language', 'dc.language'),
    pdf: first('citation_pdf_url'),
    abstract: first('citation_abstract', 'dc.description', 'description', 'og:description') || '',
  };
}

/** Какво е въведено: DOI, адрес с https или нищо разпознаваемо */
export function parseInput(input) {
  const s = String(input || '').trim();
  const doi = s.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s]+)$/i);
  if (doi) { const d = doi[1].replace(/[.,;]+$/, ''); return { kind: 'doi', doi: d, page: 'https://doi.org/' + d }; }
  if (/^https:\/\//i.test(s)) return { kind: 'url', page: s, pdf: /\.pdf($|[?#])/i.test(s) ? s : null };
  return null;
}

/**
 * Добавя публикация в raw/inbox/ по DOI или адрес. Ред на опитите: PDF (директен адрес или citation_pdf_url
 * от страницата) → текстът на страницата → само резюме (маркирано като непълно). Връща { ok, file, kind, note }.
 */
export async function importPaper(input) {
  const p = parseInput(input);
  if (!p) throw new Error($t('Paste a DOI (10.xxxx/…) or an address starting with https://'));
  fs.mkdirSync(INBOX, { recursive: true });
  const notes = [];
  let it = { title: '', authors: [], year: null, doi: p.doi || null, venue: null, lang: null, abstract: '', page: p.page };
  const baseOf = () => {
    const a0 = it.authors[0] || '';
    const surname = a0 ? latin(a0.includes(',') ? a0.split(',')[0] : a0.split(/\s+/).filter(Boolean).slice(-1)[0]) : '';
    const title = latin(it.title || (p.doi ? p.doi.replace(/[^a-z0-9]+/gi, '-') : new URL(p.page).hostname)).split('-').slice(0, 6).join('-');
    return [surname || 'avtor', it.year, title].filter(Boolean).join('-').slice(0, 90) || 'statia';
  };
  const savePdf = (buf, note) => {
    const file = uniqueName(INBOX, baseOf(), '.pdf');
    fs.writeFileSync(file, buf);
    return { ok: true, file: path.basename(file), kind: 'pdf', note, bytes: buf.length, title: it.title || null };
  };
  const tryPdf = async (url) => {
    try {
      const d = await download(url, 'application/pdf');
      if (d.buf.slice(0, 5).toString('latin1').startsWith('%PDF')) return d.buf;
      notes.push($t('The link to the PDF did not return a PDF file.'));
    } catch (e) { notes.push(`PDF: ${e.message}`); }
    return null;
  };

  if (p.pdf) {
    it.title = decodeURIComponent(p.pdf.split('/').pop().replace(/\.pdf.*$/i, '')).replace(/[-_]+/g, ' ');
    const buf = await tryPdf(p.pdf);
    if (buf) return savePdf(buf, $t('The PDF file was downloaded.'));
  }

  let html = null;
  if (p.page && !p.pdf) {
    try {
      const d = await download(p.page, 'text/html,application/xhtml+xml,application/pdf');
      if (/pdf/i.test(d.type) || d.buf.slice(0, 5).toString('latin1').startsWith('%PDF')) return savePdf(d.buf, $t('The address opened a PDF directly.'));
      html = d.buf.toString('utf8');
      const m = metaOf(html);
      it = { ...it, ...Object.fromEntries(Object.entries(m).filter(([k, v]) => k !== 'pdf' && v && (!Array.isArray(v) || v.length))) };
      it.doi = it.doi || p.doi || null;
      if (m.pdf) {
        const buf = await tryPdf(new URL(m.pdf, d.url).href);
        if (buf) return savePdf(buf, $t('The PDF file that the publisher points to on the article page was downloaded.'));
      }
    } catch (e) { notes.push($t('Page: {0}', [e.message])); }
  }

  const yaml = (s) => JSON.stringify(String(s ?? ''));
  const meta = [
    '---',
    `title: ${yaml(it.title)}`,
    `authors: [${it.authors.map(yaml).join(', ')}]`,
    `year: ${it.year || ''}`,
    it.doi ? `doi: ${yaml(it.doi)}` : null,
    it.venue ? `venue: ${yaml(it.venue)}` : null,
    it.lang ? `lang: ${yaml(it.lang)}` : null,
    `source: ${yaml(p.page)}`,
    '---',
    '',
  ].filter((x) => x !== null).join('\n');

  if (html) {
    const body = html.replace(/<(script|style|nav|header|footer|noscript|svg|form|aside)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
    if (body.replace(/\s+/g, ' ').length > 4000) {
      const file = uniqueName(INBOX, baseOf(), '.md');
      fs.writeFileSync(file, `${meta}# ${it.title || P('Web page')}\n\n${body}\n`);
      return { ok: true, file: path.basename(file), kind: 'web', note: $t('I did not find a free PDF: I took the page text. Check whether it is the whole article.'), warnings: notes, title: it.title || null };
    }
    notes.push($t('The page has no accessible full text (probably behind a subscription).'));
  }

  if (it.abstract.length < 200) {
    return { ok: false, error: $t('I could not get the text. {0} Download the file yourself and upload it.', [notes.join(' ')]).trim(), warnings: notes };
  }
  const file = uniqueName(INBOX, baseOf(), '.md');
  fs.writeFileSync(file, P('{0}# {1}\n\n> NOTE: only the abstract is available. The full text was not free.\n\n{2}\n', [meta, it.title || P('Article'), it.abstract]));
  return { ok: true, file: path.basename(file), kind: 'abstract', note: $t('The full text is not free: only the abstract was added. If you have access to the PDF, upload it instead.'), warnings: notes, title: it.title || null };
}
