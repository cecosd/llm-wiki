// Photos of pages: finding the sheet on a tablecloth, levelling the text, the PDF from JPEG pages,
// and the whole way through the server (upload, PDF in raw/books/, OCR, weak pages, a model for them).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { T, makeSandbox, startServer, api, rawRequest, waitFor } from './helpers.js';

let box, scan;
before(async () => {
  box = makeSandbox();
  await import(pathToFileURL(path.join(box.root, 'scripts/viewer/scan-tools.js')).href);
  scan = await import(pathToFileURL(path.join(box.root, 'scripts/scan.js')).href);
});
after(() => box?.remove());
const ST = () => globalThis.ScanTools;

/** A synthetic photo: a red and white checked tablecloth and a white sheet (a quadrilateral) with dark lines of "text" tilted by tilt° */
function photo({ w = 1200, h = 900, quad, tilt = 0, cloth = true, wood = false }) {
  const data = new Uint8ClampedArray(w * h * 4);
  const inside = (x, y) => {
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
    }
    return true;
  };
  const t = Math.tan((tilt * Math.PI) / 180);
  // the distance from the nearest side: the text keeps a margin, as on a real page
  const margin = (x, y) => Math.min(...quad.map((a, i) => { const b = quad[(i + 1) % 4]; return ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y); }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    let c;
    if (inside(x, y)) {
      // lines every 28 px, 6 px thick, 50 px from the edges: "text"
      const yy = y - (x - w / 2) * t;
      c = (((yy % 28) + 28) % 28) < 6 && margin(x, y) > 50 ? [40, 40, 40] : [245, 244, 240];
    } else if (wood) c = [120, 80, 45];
    else if (cloth) c = ((Math.floor(x / 30) + Math.floor(y / 30)) % 2) ? [200, 40, 50] : [235, 235, 235];
    else c = [90, 70, 50];
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }
  return { data, width: w, height: h };
}

test(T('library', 'Photos of pages: the sheet is found on a checked tablecloth', 'Снимки на страници: листът се намира върху карирана мушама'), () => {
  // clockwise from top left, a little rotated and in perspective
  const cases = [
    { quad: [{ x: 330, y: 110 }, { x: 900, y: 150 }, { x: 870, y: 820 }, { x: 290, y: 780 }] },
    { quad: [{ x: 420, y: 120 }, { x: 780, y: 120 }, { x: 980, y: 840 }, { x: 220, y: 840 }] }, // in perspective
    { quad: [{ x: 420, y: 60 }, { x: 1010, y: 230 }, { x: 820, y: 860 }, { x: 230, y: 690 }], wood: true },
  ];
  for (const { quad, wood } of cases) {
    const img = photo({ quad, wood });
    const d = ST().detectPage(img);
    assert.equal(d.found, true);
    d.corners.forEach((c, i) => {
      assert.ok(Math.hypot(c.x * img.width - quad[i].x, c.y * img.height - quad[i].y) < 18,
        `corner ${i}: ${Math.round(c.x * img.width)},${Math.round(c.y * img.height)} vs ${quad[i].x},${quad[i].y}`);
    });
  }
  // a photo that is already only the page: nothing is cut
  const full = photo({ quad: [{ x: -5, y: -5 }, { x: 1205, y: -5 }, { x: 1205, y: 905 }, { x: -5, y: 905 }] });
  assert.equal(ST().detectPage(full).found, false);
});

test(T('library', 'Photos of pages: cutting out, turning by 90° and levelling the lines', 'Снимки на страници: изрязване, завъртане на 90° и изправяне на редовете'), () => {
  const quad = [{ x: 200, y: 100 }, { x: 1000, y: 100 }, { x: 1000, y: 800 }, { x: 200, y: 800 }];
  const img = photo({ quad, tilt: 2.5, cloth: false });
  const corners = quad.map((p) => ({ x: p.x / img.width, y: p.y / img.height }));
  const out = ST().warp(img, corners, { maxSide: 600 });
  assert.equal(out.width, 600);
  assert.ok(Math.abs(out.height - Math.round(600 * 700 / 800)) <= 1);
  // the corner of the result is paper, not the dark background
  assert.ok(out.data[0] > 200, 'the top-left pixel is light');
  const turned = ST().warp(img, ST().rotateCorners(corners), { maxSide: 600 });
  assert.equal(turned.height, 600, 'after a turn by 90° the page is upright');
  const a = ST().skewAngle(out);
  assert.ok(Math.abs(a - 2.5) <= 0.4, `the tilt found: ${a}`);
  const level = ST().warp(img, corners, { maxSide: 600, angle: a });
  assert.ok(Math.abs(ST().skewAngle(level)) <= 0.4, 'after levelling the lines are level');
  assert.equal(ST().skewAngle(ST().warp(photo({ quad, cloth: false }), corners, { maxSide: 600 })), 0);
});

/** A JPEG page with @napi-rs/canvas (a dependency of the built-in OCR) */
async function jpegPage(text) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const c = createCanvas(1200, 1600);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  if (text) { g.fillStyle = '#000'; g.font = 'bold 64px sans-serif'; text.split('\n').forEach((line, i) => g.fillText(line, 100, 200 + i * 110)); }
  return c.toBuffer('image/jpeg', 90);
}

test(T('library', 'Photos of pages: the PDF from the pages opens and has one page per photo', 'Снимки на страници: PDF файлът от страниците се отваря и има по страница на снимка'), async () => {
  const pages = [await jpegPage('one'), await jpegPage('')];
  assert.deepEqual(scan.jpegInfo(pages[0]), { width: 1200, height: 1600, components: 3 });
  const pdf = scan.buildPdf(pages, { title: 'Заглавие' });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const { getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  assert.equal(doc.numPages, 2);
  const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
  assert.equal(Math.round(vp.width), 432); // 1200 px at 200 dpi
  // the same count as inbox.js uses for books and articles
  assert.equal(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g).length, 2);
});

test(T('library', 'Photos of pages: upload, one PDF in the books, OCR and a model only for the weak pages', 'Снимки на страници: качване, един PDF при книгите, OCR и модел само за слабите страници'), { timeout: 240000 }, async () => {
  const srv = await startServer(box);
  try {
    const s = await api(srv.port, 'POST', '/api/scan', {});
    assert.ok(s.json?.id, 'a batch is created');
    const id = s.json.id;
    const put = (kind, n, body, name = '') => rawRequest(srv.port, { method: 'PUT', url: `/api/scan/${id}/${kind}/${n}`, headers: { 'x-library': '1', 'x-filename': encodeURIComponent(name) }, body });
    // not a JPEG, a bad number and a path in the id are refused
    assert.equal((await put('page', 1, Buffer.from('not an image'))).status, 400);
    assert.equal((await put('page', 0, await jpegPage('x'))).status, 400);
    assert.equal((await rawRequest(srv.port, { method: 'PUT', url: '/api/scan/..%2F..%2Fwiki/page/1', headers: { 'x-library': '1' }, body: 'x' })).status, 404);
    // HEIC from an iPhone is converted to JPEG on the server; anything else is refused with 400
    const notHeic = await rawRequest(srv.port, { method: 'POST', url: '/api/scan/convert', headers: { 'x-library': '1', 'content-type': 'application/octet-stream' }, body: await jpegPage('x') });
    assert.equal(notHeic.status, 400);
    const head = Buffer.from('\0\0\0\x18ftypheic\0\0\0\0', 'latin1');
    assert.equal(scan.isHeic(head), true);
    assert.equal(scan.isHeic(Buffer.from('\0\0\0\x18ftypisom\0\0\0\0', 'latin1')), false, 'an MP4 video is not HEIC');
    const broken = await rawRequest(srv.port, { method: 'POST', url: '/api/scan/convert', headers: { 'x-library': '1', 'content-type': 'application/octet-stream' }, body: Buffer.concat([head, Buffer.alloc(64)]) });
    assert.equal(broken.status, 500, 'a broken HEIC gives an error, not a crash');
    assert.equal((await api(srv.port, 'GET', '/api/stats')).status, 200, 'the server still answers');
    assert.equal((await put('page', 1, await jpegPage('THE QUICK BROWN FOX\nJUMPS OVER THE\nLAZY DOG AGAIN'))).status, 200);
    assert.equal((await put('page', 2, await jpegPage(''))).status, 200);
    assert.equal((await put('orig', 1, Buffer.from('original photo'), 'IMG_0001.JPG')).status, 200);
    // without a title it does not finish
    assert.equal((await api(srv.port, 'POST', `/api/scan/${id}/finish`, { title: ' ', kind: 'book' })).status, 400);
    const f = await api(srv.port, 'POST', `/api/scan/${id}/finish`, { title: 'Моята книга', kind: 'book', layout: [{ corners: ST().FULL(), angle: 1.2 }] });
    assert.equal(f.status, 200, f.body);
    assert.equal(f.json.pdf, 'raw/books/моята-книга.pdf');
    assert.ok(box.exists('raw/books/моята-книга.pdf'));
    assert.ok(box.exists(`raw/.scans/${id}/orig-001.jpg`), 'the original photo is kept');
    const manifest = JSON.parse(box.read('raw/manifest.json'));
    assert.equal(manifest.files['raw/books/моята-книга.pdf'].scan, id);
    assert.equal((await api(srv.port, 'POST', `/api/scan/${id}/finish`, { title: 'again', kind: 'book' })).status, 409, 'a batch is finished once');

    const done = await waitFor(async () => { const r = await api(srv.port, 'GET', `/api/scan/${id}`); return r.json?.job?.phase === 'done' || r.json?.job?.phase === 'error' ? r.json : null; }, 200000);
    assert.equal(done.job.phase, 'done', done.job.error);
    const ex = box.read('raw/.extracted/books/моята-книга.pdf.md');
    assert.match(ex, /^<!-- извлечено с OCR \(вграден\) от raw\/books\/моята-книга\.pdf \| думи: \d+ \|/);
    assert.match(ex, /<!-- стр\. 1 -->\n\n[^]*(QUICK|BROWN|LAZY)/, 'OCR reads the text of the first page');
    assert.ok(!done.weak.includes(1), 'a clear page is not weak');
    assert.ok(done.weak.includes(2), 'the empty page is weak');
    // the PDF from photos is not taken by "process everything" before its text is ready, but it is pending after the OCR
    assert.equal(scan.scanNotReady('raw/books/моята-книга.pdf'), false);

    // the estimate counts only the weak pages; then the (fake) model reads them
    const est = await api(srv.port, 'POST', '/api/estimate', { kind: 'scan-pages', id });
    assert.equal(est.json.ok, true, est.body);
    assert.equal(est.json.parts.length, done.weak.length);
    const before = box.claudeCalls().length;
    const r = await api(srv.port, 'POST', `/api/scan/${id}/read`, {});
    assert.equal(r.json.started, true);
    const after2 = await waitFor(async () => { const x = await api(srv.port, 'GET', `/api/scan/${id}`); return x.json?.job?.phase === 'done' ? x.json : null; }, 60000);
    assert.deepEqual(after2.weak, []);
    assert.ok(after2.byModel.includes(2));
    const calls = box.claudeCalls().slice(before);
    assert.equal(calls.length, done.weak.length, 'one call per weak page');
    assert.match(calls[0].stdin, /raw\/\.scans\/.+\/model-00\d\.jpg/, 'the model is told which image to open');
    assert.match(box.read('raw/.extracted/books/моята-книга.pdf.md'), /<!-- стр\. 2 -->\n\nFake answer from the test double\./);
    assert.match(box.read('raw/.extracted/books/моята-книга.pdf.md'), /OCR \(вграден \+ модел за \d+ стр\.\)/);

    // a new extraction keeps what the model read (it was paid for)
    const ext = box.script('extract.js', '--force', 'raw/books/моята-книга.pdf');
    assert.equal(ext.status, 0, ext.stdout + ext.stderr);
    assert.match(box.read('raw/.extracted/books/моята-книга.pdf.md'), /Fake answer from the test double\./);
  } finally { await srv.stop(); }
});
