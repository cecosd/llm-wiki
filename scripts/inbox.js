// Сортира raw/inbox/ по папки и записва файловете в manifest.json.
// Употреба:
//   npm run inbox
//   npm run inbox -- --dry                    само показва какво би направил
//   npm run inbox -- --move <raw път> <папка>  ръчно преместване на сортиран файл
import fs from 'node:fs';
import path from 'node:path';
import { RAW, ROOT, rel, walk, sha256, loadManifest, saveManifest, today } from './lib.js';
import { $t } from './i18n.js';

const BOOK_PAGES = 80; // PDF с повече страници → books/

const EXT = {
  books: ['.epub', '.mobi', '.azw', '.azw3', '.djvu', '.fb2'],
  articles: ['.docx', '.doc', '.odt', '.rtf', '.txt', '.pages'],
  web: ['.html', '.htm', '.mhtml', '.webarchive'],
  data: ['.xlsx', '.xlsm', '.xls', '.ods', '.csv', '.tsv', '.json', '.xml', '.parquet', '.sqlite', '.db'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.tif', '.tiff', '.bmp'],
};

function pdfPages(file) {
  // Бърза евристика без зависимости: брои /Type /Page обекти.
  const buf = fs.readFileSync(file).toString('latin1');
  const m = buf.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 0;
}

function classify(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return pdfPages(file) > BOOK_PAGES ? 'books' : 'papers';
  if (ext === '.md' || ext === '.markdown') {
    // Obsidian Web Clipper слага source: URL във frontmatter
    const head = fs.readFileSync(file, 'utf8').slice(0, 1500);
    return /^(source|url):\s*https?:/m.test(head) ? 'web' : 'notes';
  }
  for (const [dir, exts] of Object.entries(EXT)) if (exts.includes(ext)) return dir;
  return 'other';
}

function uniqueTarget(dir, name) {
  let target = path.join(dir, name);
  const { name: base, ext } = path.parse(name);
  let i = 2;
  while (fs.existsSync(target)) target = path.join(dir, `${base}-${i++}${ext}`);
  return target;
}

const args = process.argv.slice(2);
const manifest = loadManifest();

if (args[0] === '--move') {
  const [, from, toDir] = args;
  const src = path.resolve(ROOT, from);
  if (!fs.existsSync(src)) { console.error($t('No such file: {0}', [from])); process.exit(1); }
  const dest = uniqueTarget(path.join(RAW, toDir), path.basename(src));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
  const entry = manifest.files[rel(src)];
  if (entry) { delete manifest.files[rel(src)]; manifest.files[rel(dest)] = { ...entry, folder: toDir }; }
  saveManifest(manifest);
  console.log(`✔ ${rel(src)} → ${rel(dest)}`);
  console.log($t('  If there is already a source page, update raw_path in it.'));
  process.exit(0);
}

const dry = args.includes('--dry');
const known = new Map(Object.entries(manifest.files).map(([p, e]) => [e.sha256, p]));
const inbox = walk(path.join(RAW, 'inbox')).filter((f) => !f.endsWith('.gitkeep'));

if (!inbox.length) { console.log($t('The inbox is empty.')); process.exit(0); }

let moved = 0, dupes = 0;
for (const file of inbox) {
  const hash = sha256(file);
  if (known.has(hash)) {
    console.log($t('⚠ duplicate: {0} = {1} (left in the inbox)', [path.basename(file), known.get(hash)]));
    dupes++; continue;
  }
  const folder = classify(file);
  const dest = uniqueTarget(path.join(RAW, folder), path.basename(file));
  console.log(`${dry ? '·' : '✔'} ${path.basename(file)} → ${rel(dest)}`);
  if (dry) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(file, dest);
  manifest.files[rel(dest)] = {
    sha256: hash, folder, added: today(), bytes: fs.statSync(dest).size, original_name: path.basename(file),
  };
  known.set(hash, rel(dest));
  moved++;
}
if (!dry) saveManifest(manifest);
console.log($t('\n{0}: {1} moved, {2} duplicates.', [dry ? $t('Dry run') : $t('Done'), moved, dupes]));
if (moved && !dry) console.log($t('Next: npm run extract'));
