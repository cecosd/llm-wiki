// Колекции, които човекът си прави в интерфейса:
//   - умни: филтър по вид, етикет, област, формат, увереност, статус, автор, година и дума в заглавието;
//     страниците се изчисляват наново при всяко отваряне, затова колекцията се пълни сама;
//   - ръчни списъци: подредени страници, добавени на ръка (напр. „За дипломната“);
//   - менюто: редът и скриването на видовете страници, които има в wiki/ (Източници, Глави, Понятия и т.н.).
// Пазят се в outputs/collections.json: това са данни на човека, не част от wiki/, и Claude не ги чете.
// Страниците не се променят. Ако страница от списък бъде обединена или премахната, тя остава в списъка като
// липсваща, докато човекът не я махне.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OUTPUTS } from './lib.js';
import { $t } from './i18n.js';

const file = () => path.join(OUTPUTS, 'collections.json');
const LIMIT = { items: 200, slugs: 5000, values: 60, text: 120, name: 80 };
const SLUG_RE = /^[^\s/\\?#]{1,200}$/;
const TYPE_RE = /^[a-z][a-z0-9_-]{0,40}$/;
const ID_RE = /^[a-z0-9]{6,24}$/;
const LISTS = ['types', 'tags', 'areas', 'formats', 'confidence', 'status'];

const today = () => new Date().toISOString().slice(0, 10);
const text = (v, n = LIMIT.text) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const textList = (v, re) => (Array.isArray(v) ? [...new Set(v.map((x) => text(x)).filter((x) => x && (!re || re.test(x))))].slice(0, LIMIT.values) : []);
const yearOf = (v) => { const n = Number(v); return v !== '' && v != null && Number.isInteger(n) && n > 0 && n < 3000 ? n : null; };
const slugList = (v) => (Array.isArray(v) ? [...new Set(v.map(String).filter((s) => SLUG_RE.test(s)))].slice(0, LIMIT.slugs) : []);
const empty = () => ({ version: 1, menu: { order: [], hidden: [] }, items: [] });

/** Филтърът на умна колекция: И между полетата, ИЛИ между стойностите в едно поле. Празно поле не ограничава. */
export function cleanFilter(f = {}) {
  const out = {};
  for (const k of LISTS) out[k] = textList(f?.[k], k === 'types' ? TYPE_RE : null);
  out.author = text(f?.author, 80);
  out.q = text(f?.q, 80);
  out.yearFrom = yearOf(f?.yearFrom);
  out.yearTo = yearOf(f?.yearTo);
  return out;
}

function cleanItem(raw) {
  if (!raw || typeof raw !== 'object' || !ID_RE.test(String(raw.id || ''))) return null;
  const name = text(raw.name, LIMIT.name);
  if (!name) return null;
  const kind = raw.kind === 'list' ? 'list' : 'smart';
  const item = { id: String(raw.id), kind, name, created: text(raw.created, 10) || today(), updated: text(raw.updated, 10) || today() };
  if (kind === 'smart') item.filter = cleanFilter(raw.filter);
  else item.slugs = slugList(raw.slugs);
  return item;
}

export function readCollections() {
  let d;
  try { d = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return empty(); }
  const out = empty();
  out.menu.order = textList(d?.menu?.order, TYPE_RE);
  out.menu.hidden = textList(d?.menu?.hidden, TYPE_RE);
  out.items = (Array.isArray(d?.items) ? d.items : []).map(cleanItem).filter(Boolean).slice(0, LIMIT.items);
  return out;
}

function write(data) {
  fs.mkdirSync(OUTPUTS, { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file());
  return data;
}

/** Нова колекция (без id) или промяна на съществуваща (име и филтър; видът ѝ не се сменя). */
export function saveCollection(input = {}) {
  const data = readCollections();
  const name = text(input.name, LIMIT.name);
  if (!name) return { ok: false, error: $t('Give the collection a name.') };
  if (input.id) {
    const it = data.items.find((x) => x.id === String(input.id));
    if (!it) return { ok: false, error: $t('There is no such collection.') };
    it.name = name; it.updated = today();
    if (it.kind === 'smart') it.filter = cleanFilter(input.filter);
    else if (Array.isArray(input.slugs)) it.slugs = slugList(input.slugs);
    write(data);
    return { ok: true, item: it, collections: data };
  }
  if (data.items.length >= LIMIT.items) return { ok: false, error: $t('There are too many collections. Delete one you no longer need.') };
  const kind = input.kind === 'list' ? 'list' : 'smart';
  const item = { id: crypto.randomBytes(6).toString('hex'), kind, name, created: today(), updated: today() };
  if (kind === 'smart') item.filter = cleanFilter(input.filter);
  else item.slugs = slugList(input.slugs);
  data.items.push(item);
  write(data);
  return { ok: true, item, collections: data };
}

export function deleteCollection(id) {
  const data = readCollections();
  const i = data.items.findIndex((x) => x.id === id);
  if (i < 0) return { ok: false, error: $t('There is no such collection.') };
  data.items.splice(i, 1);
  write(data);
  return { ok: true, collections: data };
}

/** Ръчен списък: add (slug или списък), remove (slug), move ({ slug, dir: -1 | 1 }). */
export function changeList(id, { add, remove, move } = {}) {
  const data = readCollections();
  const it = data.items.find((x) => x.id === id);
  if (!it) return { ok: false, error: $t('There is no such collection.') };
  if (it.kind !== 'list') return { ok: false, error: $t('Pages are added only to lists. A smart collection fills itself from its filter.') };
  for (const s of slugList([].concat(add ?? []))) if (!it.slugs.includes(s)) it.slugs.push(s);
  if (remove != null) it.slugs = it.slugs.filter((s) => s !== String(remove));
  if (move && typeof move === 'object') {
    const i = it.slugs.indexOf(String(move.slug)), j = i + (Number(move.dir) < 0 ? -1 : 1);
    if (i >= 0 && j >= 0 && j < it.slugs.length) [it.slugs[i], it.slugs[j]] = [it.slugs[j], it.slugs[i]];
  }
  it.slugs = it.slugs.slice(0, LIMIT.slugs);
  it.updated = today();
  write(data);
  return { ok: true, item: it, collections: data };
}

/** Менюто: редът и скритите видове страници, плюс редът на колекциите (по id). */
export function saveMenu({ order, hidden, items } = {}) {
  const data = readCollections();
  if (order !== undefined) data.menu.order = textList(order, TYPE_RE);
  if (hidden !== undefined) data.menu.hidden = textList(hidden, TYPE_RE);
  if (Array.isArray(items)) {
    const pos = new Map(items.map((id, i) => [String(id), i]));
    data.items.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  write(data);
  return { ok: true, collections: data };
}
