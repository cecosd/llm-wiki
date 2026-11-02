// Вграден OCR без външни програми: tesseract.js + езикови данни от npm (български и английски).
// Работи офлайн. По-бавен е от ocrmypdf, затова extract.js предпочита ocrmypdf, ако е инсталиран.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './lib.js';

const require = createRequire(import.meta.url);
const LANGS = ['bul', 'eng'];
const DATA_DIR = path.join(ROOT, '.ocr-data');

/** Събира езиковите файлове на едно място (tesseract.js чете от една папка) */
function prepareLangs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const l of LANGS) {
    const dst = path.join(DATA_DIR, `${l}.traineddata.gz`);
    if (fs.existsSync(dst)) continue;
    const pkg = path.dirname(require.resolve(`@tesseract.js-data/${l}/package.json`));
    fs.copyFileSync(path.join(pkg, '4.0.0_best_int', `${l}.traineddata.gz`), dst);
  }
}

export function builtinOcrAvailable() {
  try {
    require.resolve('tesseract.js'); require.resolve('@napi-rs/canvas'); require.resolve('pdfjs-dist/package.json');
    LANGS.forEach((l) => require.resolve(`@tesseract.js-data/${l}/package.json`));
    return true;
  } catch { return false; }
}

/**
 * OCR на PDF страница по страница. Връща текст с маркери <!-- стр. N -->.
 * onProgress(done, total) се вика след всяка страница.
 */
export async function ocrPdf(file, onProgress = () => {}) {
  prepareLangs();
  const { getDocumentProxy, renderPageAsImage, definePDFJSModule } = await import('unpdf');
  // Целият pdf.js (не вграденият в unpdf) + wasm декодери: сканираните PDF често са JBIG2/JPEG2000,
  // а без декодер страницата излиза бяла и OCR не намира текст.
  await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'));
  const wasmUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'wasm') + path.sep;
  const { createWorker } = await import('tesseract.js');
  const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)), { wasmUrl });
  const worker = await createWorker(LANGS, 1, { langPath: DATA_DIR, gzip: true, cachePath: DATA_DIR });
  const parts = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const png = await renderPageAsImage(doc, i, { canvasImport: () => import('@napi-rs/canvas'), scale: 2 });
      const { data } = await worker.recognize(Buffer.from(png));
      const text = (data.text || '').trim();
      if (text) parts.push(`\n\n<!-- стр. ${i} -->\n\n${text}`);
      onProgress(i, doc.numPages);
    }
  } finally { await worker.terminate(); }
  return parts.join('');
}
