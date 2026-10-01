// Screenshot text recognition for the setup assistant. Runs completely in your browser (Tesseract.js, loaded from
// the jsDelivr CDN on first use). It only sees the images you paste or drop – nothing reads or touches the game.
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

let workerP = null;
let logFn = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => rej(new Error('could not load the text recognition library'));
    document.head.appendChild(s);
  });
}
function worker() {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(TESS);
      const w = await window.Tesseract.createWorker('eng', 1, { logger: (m) => logFn?.(m) });
      await w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '300' });
      return w;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}
export const ocrReady = () => !!workerP;
export async function setPsm(psm) { const w = await worker(); await w.setParameters({ tessedit_pageseg_mode: String(psm) }); }

// scale up (the game font is small and condensed), grey by brightest channel (coloured status text), then make every
// region dark-text-on-light: the task list is light text on dark, the selected row dark text on a light bar.
// The background of each pixel = mean of its neighbourhood (integral image); dark neighbourhood → invert.
export async function preprocess(file) {
  const bmp = await createImageBitmap(file);
  const big = Math.max(bmp.width, bmp.height);
  let s = bmp.height < 700 ? 3 : bmp.height < 1300 ? 2 : 1.5;
  s = Math.max(1, Math.min(s, 4200 / big));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  const n = w * h;
  const g = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, k = 0; k < n; i += 4, k++) { const v = Math.max(d[i], d[i + 1], d[i + 2]); g[k] = v; hist[v]++; }
  const pct = (H, q) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += H[v]; if (acc >= q * n) return v; } return 255; };
  // dark UI ≈ 10–40, highlighted rows ≈ 180+; screenshots with little text have almost no bright pixels
  const mid = Math.max(90, Math.min(150, (pct(hist, 0.05) + pct(hist, 0.999)) / 2));
  // integral image for the neighbourhood mean
  const W1 = w + 1;
  const I = new Uint32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; } }
  const r = Math.max(6, Math.round(11 * s));
  const out = new Uint8Array(n);
  const h2 = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      const mean = sum / ((y1 - y0) * (x1 - x0));
      const v = g[y * w + x];
      const o = mean < mid ? 255 - v : v;
      out[y * w + x] = o; h2[o]++;
    }
  }
  // text is a tiny share of a mostly empty screenshot – don't let the dark end eat its anti-aliasing
  const lo = Math.min(pct(h2, 0.002), 60), hi = Math.max(lo + 60, pct(h2, 0.6));
  for (let i = 0, k = 0; k < n; i += 4, k++) {
    let v = Math.round(((out[k] - lo) * 255) / (hi - lo));
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return { canvas: c, scale: s, width: w / s, height: h / s };
}

// → {lines:[{text, conf}], ms}
export async function recognize(file, onProgress = () => {}) {
  const t0 = performance.now();
  logFn = (m) => { if (m.status === 'recognizing text') onProgress(0.25 + 0.75 * (m.progress || 0), 'Reading text…'); else onProgress(0.1, m.status ? m.status[0].toUpperCase() + m.status.slice(1) + '…' : 'Loading…'); };
  onProgress(0.02, workerP ? 'Preparing image…' : 'Loading text recognition (first time ≈ 5 MB)…');
  const w = await worker();
  const pre = await preprocess(file);
  onProgress(0.25, 'Reading text…');
  const r = await w.recognize(pre.canvas, {}, { text: true, blocks: true });
  const lines = [];
  const sc = pre.scale;
  for (const b of r.data.blocks || []) for (const para of b.paragraphs || []) for (const l of para.lines || []) {
    const bb = l.bbox ? { x0: l.bbox.x0 / sc, y0: l.bbox.y0 / sc, x1: l.bbox.x1 / sc, y1: l.bbox.y1 / sc } : null;
    lines.push({ text: l.text.replace(/\s+/g, ' ').trim(), conf: Math.round(l.confidence), bbox: bb });
  }
  if (!lines.length) for (const t of (r.data.text || '').split('\n')) if (t.trim()) lines.push({ text: t.trim(), conf: null });
  logFn = null;
  return { lines, ms: Math.round(performance.now() - t0) };
}
