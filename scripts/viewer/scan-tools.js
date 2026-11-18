// Photos of pages: finding the sheet in the photo, cutting it out with the perspective straightened, and levelling the text.
// Pure functions over RGBA pixels ({ data, width, height }, like ImageData), without dependencies: the browser uses them
// through window.ScanTools, and the tests import them in Node (globalThis.ScanTools).
// Corners are always in the order top-left, top-right, bottom-right, bottom-left, normalized to 0..1 of the photo,
// so that a corner found on a small copy fits the full photo too.
(function (root) {
  'use strict';

  /** A smaller copy (box average), so that detection is fast on a 12 MP photo */
  function shrink(img, maxSide) {
    const k = Math.max(1, Math.ceil(Math.max(img.width, img.height) / maxSide));
    const w = Math.max(1, Math.floor(img.width / k)), h = Math.max(1, Math.floor(img.height / k));
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = 0; dy < k; dy++) {
          const sy = y * k + dy; if (sy >= img.height) break;
          let i = (sy * img.width + x * k) * 4;
          for (let dx = 0; dx < k && x * k + dx < img.width; dx++, i += 4) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
        }
        const o = (y * w + x) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    return { data: out, width: w, height: h };
  }

  /** Otsu's threshold over values 0..255 */
  function otsu(hist, total) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, t = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; t = i; }
    }
    return t;
  }

  /** Convex hull (monotone chain), counter-clockwise in screen coordinates does not matter for us */
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  const area = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; };

  /** Reduces a convex polygon to 4 corners: removes the vertex that loses the least area, until 4 are left */
  function toQuad(poly) {
    const p = poly.slice();
    while (p.length > 4) {
      let best = 0, loss = Infinity;
      for (let i = 0; i < p.length; i++) {
        const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
        const l = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
        if (l < loss) { loss = l; best = i; }
      }
      p.splice(best, 1);
    }
    return p;
  }

  /**
   * Straightens the four sides. The corners from the convex hull are pulled out by light spots of the background that touch
   * the sheet (the white squares of a tablecloth). The real edge of the sheet is the line along which the most edge pixels lie:
   * for every side, angles of ±8° and shifts of ±12% around the rough side are tried, and the fullest line wins. Bumps are
   * short, the edge is long. The corners are then the crossings of neighbouring sides, moved out by `out` (the erosion).
   * Returns null when a side has too few points or a corner would move too far: then the rough corners stay.
   */
  function refineSides(q, edge, size, out) {
    const c = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
    const range = Math.max(4, Math.round(size * 0.12));
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 8) return null;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, th0 = Math.atan2(uy, ux);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const near = edge.filter((p) => { const t = (p.x - a.x) * ux + (p.y - a.y) * uy; return t > -0.1 * L && t < 1.1 * L; });
      const bins = new Float64Array(2 * range + 3);
      let best = null;
      for (let dt = -8; dt <= 8; dt += 0.5) {
        const th = th0 + (dt * Math.PI) / 180;
        let nx = Math.sin(th), ny = -Math.cos(th);
        if ((mid.x - c.x) * nx + (mid.y - c.y) * ny < 0) { nx = -nx; ny = -ny; } // outwards
        const off0 = mid.x * nx + mid.y * ny;
        bins.fill(0);
        for (const p of near) { const o = Math.round(p.x * nx + p.y * ny - off0) + range + 1; if (o >= 1 && o < bins.length - 1) bins[o]++; }
        for (let k = 1; k < bins.length - 1; k++) {
          const cnt = bins[k - 1] + bins[k] + bins[k + 1];
          if (!best || cnt > best.cnt) best = { cnt, nx, ny, off: off0 + (k - range - 1) };
        }
      }
      if (!best || best.cnt < L * 0.3) return null;
      lines.push({ nx: best.nx, ny: best.ny, off: best.off + out });
    }
    const res = [];
    for (let i = 0; i < 4; i++) {
      const l1 = lines[(i + 3) % 4], l2 = lines[i]; // corner i lies on the side before it and on its own side
      const det = l1.nx * l2.ny - l1.ny * l2.nx;
      if (Math.abs(det) < 1e-6) return null;
      const p = { x: (l1.off * l2.ny - l1.ny * l2.off) / det, y: (l1.nx * l2.off - l1.off * l2.nx) / det };
      if (Math.hypot(p.x - q[i].x, p.y - q[i].y) > size * 0.15) return null;
      res.push(p);
    }
    return res;
  }

  /** The corners in the order top-left, top-right, bottom-right, bottom-left */
  function orderCorners(pts) {
    const cx = pts.reduce((n, p) => n + p.x, 0) / pts.length, cy = pts.reduce((n, p) => n + p.y, 0) / pts.length;
    const s = pts.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); // clockwise on screen (y down)
    let first = 0;
    s.forEach((p, i) => { if (p.x + p.y < s[first].x + s[first].y) first = i; });
    return s.slice(first).concat(s.slice(0, first));
  }

  const ERODE = 3;
  const FULL = () => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

  /**
   * Finds the sheet in the photo. Paper is light and without colour; a tablecloth, a table or a hand are darker or coloured.
   * Returns { corners, found }. With found: false the corners are the whole photo (the person moves them by hand).
   */
  function detectPage(img) {
    const s = shrink(img, 360), w = s.width, h = s.height, n = w * h;
    const score = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = s.data[j], g = s.data[j + 1], b = s.data[j + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max ? (max - min) / max : 0;
      score[i] = max * (1 - sat); // bright and grey = paper
    }
    // a 3x3 blur, so that the letters do not cut the sheet into pieces
    const blur = new Uint8ClampedArray(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let t = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        t += score[yy * w + xx]; c++;
      }
      blur[y * w + x] = t / c;
    }
    const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[blur[i]]++;
    const t = otsu(hist, n);
    let mask = new Uint8Array(n); for (let i = 0; i < n; i++) mask[i] = blur[i] > t ? 1 : 0;
    // filling the holes: the dark lines of text inside the sheet are not background. Background is only what can be
    // reached from the border of the photo without crossing the light area.
    {
      const seen = new Uint8Array(n), qq = new Int32Array(n);
      let head = 0, tail = 0;
      const push = (k) => { if (!mask[k] && !seen[k]) { seen[k] = 1; qq[tail++] = k; } };
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (head < tail) {
        const k = qq[head++], x = k % w;
        if (x > 0) push(k - 1); if (x < w - 1) push(k + 1); if (k >= w) push(k - w); if (k < n - w) push(k + w);
      }
      for (let i = 0; i < n; i++) if (!seen[i]) mask[i] = 1;
    }
    // erosion (ERODE times 3x3): it cuts the thin bridges between the sheet and light spots of the background
    // (the white squares of a checked tablecloth); the corners are moved back out by the same amount below
    for (let it = 0; it < ERODE; it++) {
      const m2 = new Uint8Array(n);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        m2[k] = mask[k] && mask[k - 1] && mask[k + 1] && mask[k - w] && mask[k + w] && mask[k - w - 1] && mask[k - w + 1] && mask[k + w - 1] && mask[k + w + 1] ? 1 : 0;
      }
      mask = m2;
    }
    // the largest connected light area
    const label = new Int32Array(n), queue = new Int32Array(n);
    let bestId = 0, bestSize = 0, id = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i] || label[i]) continue;
      id++; let head = 0, tail = 0, size = 0; queue[tail++] = i; label[i] = id;
      while (head < tail) {
        const k = queue[head++]; size++;
        const x = k % w, y = (k - x) / w;
        if (x > 0 && mask[k - 1] && !label[k - 1]) { label[k - 1] = id; queue[tail++] = k - 1; }
        if (x < w - 1 && mask[k + 1] && !label[k + 1]) { label[k + 1] = id; queue[tail++] = k + 1; }
        if (y > 0 && mask[k - w] && !label[k - w]) { label[k - w] = id; queue[tail++] = k - w; }
        if (y < h - 1 && mask[k + w] && !label[k + w]) { label[k + w] = id; queue[tail++] = k + w; }
      }
      if (size > bestSize) { bestSize = size; bestId = id; }
    }
    if (bestSize < n * 0.12) return { corners: FULL(), found: false };
    // the outline: the leftmost and rightmost point of every row is enough for the convex hull
    const pts = [];
    for (let y = 0; y < h; y++) {
      let a = -1, b = -1;
      for (let x = 0; x < w; x++) if (label[y * w + x] === bestId) { if (a < 0) a = x; b = x; }
      if (a >= 0) { pts.push({ x: a, y }); if (b !== a) pts.push({ x: b + 1, y }); }
    }
    const quad = toQuad(hull(pts));
    if (quad.length < 4) return { corners: FULL(), found: false };
    const rough = orderCorners(quad);
    // the outer edge of the sheet, for straightening the sides: the first and last pixel of every row and every column
    // (the holes of the letters inside are not an edge)
    const edge = [];
    for (let y = 0; y < h; y++) {
      let a = -1, b = -1;
      for (let x = 0; x < w; x++) if (label[y * w + x] === bestId) { if (a < 0) a = x; b = x; }
      if (a >= 0) edge.push({ x: a + 0.5, y: y + 0.5 }, { x: b + 0.5, y: y + 0.5 });
    }
    for (let x = 0; x < w; x++) {
      let a = -1, b = -1;
      for (let y = 0; y < h; y++) if (label[y * w + x] === bestId) { if (a < 0) a = y; b = y; }
      if (a >= 0) edge.push({ x: x + 0.5, y: a + 0.5 }, { x: x + 0.5, y: b + 0.5 });
    }
    const fine = refineSides(rough, edge, Math.max(w, h), ERODE + 0.5);
    const qc = { x: rough.reduce((s0, p) => s0 + p.x, 0) / 4, y: rough.reduce((s0, p) => s0 + p.y, 0) / 4 };
    const q = (fine || rough.map((p) => {
      // back out by the erosion: along the diagonal, ERODE * sqrt(2) pixels of the small copy
      const dx = p.x - qc.x, dy = p.y + 0.5 - qc.y, len = Math.hypot(dx, dy) || 1, grow = ERODE * Math.SQRT2;
      return { x: p.x + (dx / len) * grow, y: p.y + 0.5 + (dy / len) * grow };
    })).map((p) => ({ x: Math.min(1, Math.max(0, p.x / w)), y: Math.min(1, Math.max(0, p.y / h)) }));
    const a = area(q);
    // almost the whole photo (already cropped, or no background) or too small: we do not cut
    if (a > 0.97 || a < 0.12) return { corners: FULL(), found: false };
    return { corners: q, found: true };
  }

  /** Rotating the result by 90° clockwise: the new top-left corner is the old bottom-left one */
  const rotateCorners = (c) => [c[3], c[0], c[1], c[2]];

  /** Solves A x = b (8x8) by Gaussian elimination */
  function solve(A, b) {
    const n = b.length, M = A.map((row, i) => row.concat(b[i]));
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  /** The homography that maps the rectangle 0..W x 0..H of the result onto the quadrilateral in the photo (in pixels) */
  function homography(W, H, quad) {
    const from = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = from[i], { x: u, y: v } = quad[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return h ? h.concat(1) : null;
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /** The size of the result: the longer of the opposite sides, limited to maxSide */
  function outSize(img, corners, maxSide) {
    const q = corners.map((p) => ({ x: p.x * img.width, y: p.y * img.height }));
    let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const k = Math.min(1, maxSide / Math.max(W, H));
    return { q, W: Math.max(8, Math.round(W * k)), H: Math.max(8, Math.round(H * k)) };
  }

  /**
   * Cuts the sheet out and straightens it. angle (degrees) additionally rotates the text about the centre (levelling),
   * in the same pass. Outside the photo the result is white.
   */
  function warp(img, corners, { maxSide = 2400, angle = 0, inset = 0 } = {}) {
    const { q, W: W0, H: H0 } = outSize(img, corners, maxSide);
    const m = homography(W0, H0, q);
    // inset: a thin margin (a fraction of the size) is left out, so that one or two pixels of the background
    // along the edge of the sheet do not become a dark frame
    const ix = Math.round(W0 * inset), iy = Math.round(H0 * inset), W = W0 - 2 * ix, H = H0 - 2 * iy;
    const out = new Uint8ClampedArray(W * H * 4);
    if (!m) { out.fill(255); return { data: out, width: W, height: H }; }
    const rad = (angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad), cx = W0 / 2, cy = H0 / 2;
    const sw = img.width, sh = img.height, src = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let px = x + ix + 0.5, py = y + iy + 0.5;
        if (angle) { const dx = px - cx, dy = py - cy; px = cx + dx * cos - dy * sin; py = cy + dx * sin + dy * cos; }
        const d = m[6] * px + m[7] * py + 1;
        const u = (m[0] * px + m[1] * py + m[2]) / d - 0.5, v = (m[3] * px + m[4] * py + m[5]) / d - 0.5;
        const o = (y * W + x) * 4;
        if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255; continue; }
        const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
        const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
        const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        for (let c = 0; c < 3; c++) {
          out[o + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
        }
        out[o + 3] = 255;
      }
    }
    return { data: out, width: W, height: H };
  }

  /**
   * The tilt of the text lines in degrees (-maxDeg..maxDeg). The dark points are projected onto the vertical
   * at different angles: where the lines are level, the projection has the sharpest peaks (the largest sum of squares).
   * Rotating the result by the returned angle levels the text.
   */
  function skewAngle(img, { maxDeg = 5, step = 0.2 } = {}) {
    const s = shrink(img, 900), w = s.width, h = s.height;
    const lum = new Uint8ClampedArray(w * h), hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) { lum[i] = (s.data[j] * 299 + s.data[j + 1] * 587 + s.data[j + 2] * 114) / 1000; hist[lum[i]]++; }
    const t = otsu(hist, w * h);
    const pts = [];
    // a margin of 4% is skipped: the edges of the sheet and shadows are not text
    const mx = Math.round(w * 0.04), my = Math.round(h * 0.04);
    for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) if (lum[y * w + x] < t) pts.push(x - w / 2, y - h / 2);
    if (pts.length < 200 || pts.length / 2 > w * h * 0.5) return 0; // no text, or a photo/illustration
    const bins = new Float64Array(h * 2 + 4);
    let best = 0, bestScore = -1;
    for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += step) {
      const r = (deg * Math.PI) / 180, sin = Math.sin(r), cos = Math.cos(r);
      bins.fill(0);
      for (let i = 0; i < pts.length; i += 2) { const yy = Math.round(-pts[i] * sin + pts[i + 1] * cos + h); if (yy >= 0 && yy < bins.length) bins[yy]++; }
      let sc = 0; for (let i = 0; i < bins.length; i++) sc += bins[i] * bins[i];
      if (sc > bestScore) { bestScore = sc; best = deg; }
    }
    return Math.abs(best) < step / 2 ? 0 : Math.round(best * 100) / 100;
  }

  /** Grey with stretched contrast: a lighter background and darker letters (better for OCR and a smaller file) */
  function enhance(img) {
    const n = img.width * img.height, d = img.data, hist = new Uint32Array(256), out = new Uint8ClampedArray(d.length);
    const lum = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) { lum[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000; hist[lum[i]]++; }
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.08) { hi = i; break; } } // the paper is most of the page
    if (hi - lo < 30) { lo = 0; hi = 255; }
    const k = 255 / (hi - lo);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = (lum[i] - lo) * k; out[j] = out[j + 1] = out[j + 2] = v; out[j + 3] = 255; }
    return { data: out, width: img.width, height: img.height };
  }

  root.ScanTools = { shrink, detectPage, rotateCorners, homography, warp, skewAngle, enhance, orderCorners, FULL };
})(typeof window !== 'undefined' ? window : globalThis);
