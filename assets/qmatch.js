// Matches text lines (from screenshot text recognition or pasted text) against quest names.
// Pure functions without DOM / app imports – the tests run them in Node too.

export const normName = (s) => String(s || '').toLowerCase().replace(/[’'`´]/g, '').replace(/&/g, ' and ').replace(/(^|\s)[|!](?=\s)/g, '$1i').replace(/[^a-z0-9]+/g, ' ').trim();
// wiki page names that differ from the in-game task name
export const gameName = (n) => String(n).replace(/\s*\((quest|Prestige \d+)\)$/i, '');

// status column of the in-game task list
const STATUS = [['available', 'open'], ['active', 'open'], ['started', 'open'], ['progress', 'open'], ['completed', 'done'], ['complete', 'done'], ['success', 'done'], ['finished', 'done'], ['locked', 'locked'], ['failed', 'failed']];
// words that can follow a task name in its row (location, type, status, trader …)
const COLUMN_WORDS = 'any various multiple location locations name type status task tasks trader progress in turn hand show completed locked available active started failed success finished new elimination pickup completion discover exploration loyalty experience skill merchant standing weapon assembly mod multi daily weekly operational the of and on all maps none optional trading services gesture insurance repair transfer flea market character overview'.split(' ');

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
// allowed typos for a name of this length (short names must be exact)
const allowed = (len) => (len <= 4 ? 0 : len <= 7 ? 1 : len <= 12 ? 2 : Math.floor(len * 0.17));

// names: quest names; extra: {maps:[], traders:[]} – their words count as "other columns" of a row
export function buildIndex(names, extra = {}) {
  const byKey = new Map();
  for (const n of names) {
    const key = normName(gameName(n));
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(n);
  }
  const byWc = new Map();
  for (const [key, ns] of byKey) {
    const wc = key.split(' ').length;
    const e = { key, names: ns, len: key.length, wc, short: wc === 1 && key.length <= 8 };
    if (!byWc.has(wc)) byWc.set(wc, []);
    byWc.get(wc).push(e);
  }
  const known = new Set(COLUMN_WORDS);
  for (const s of [...(extra.maps || []), ...(extra.traders || [])]) for (const w of normName(s).split(' ')) if (w) known.add(w);
  return { byWc, known, size: byKey.size };
}

const isJunk = (t) => t.length <= 2 || /^\d+$/.test(t);
function statusOf(tokens) {
  for (const t of tokens) {
    if (t.length < 4) continue;
    for (const [w, st] of STATUS) if (t === w || (t.length >= 5 && lev(t, w, 1) <= 1)) return st;
  }
  return null;
}

// one quest per line: the name has to start the line (after icon noise) and may only be followed by the
// row's other columns (map, type, status …). Lines of descriptions / objectives don't match that shape.
export function matchLine(text, idx) {
  const toks = normName(text).split(' ').filter(Boolean);
  if (!toks.length) return null;
  let best = null;
  for (let s = 0; s <= Math.min(2, toks.length - 1); s++) {
    if (s > 0 && !isJunk(toks[s - 1])) break; // only skip icon noise in front of the name
    for (let L = 1; L <= Math.min(9, toks.length - s); L++) {
      const w = toks.slice(s, s + L).join(' ');
      const tail = toks.slice(s + L);
      const unknown = tail.filter(t => !isJunk(t) && !idx.known.has(t));
      for (let wc = Math.max(1, L - 1); wc <= L + 1; wc++) {
        for (const e of idx.byWc.get(wc) || []) {
          const max = allowed(e.len);
          if (Math.abs(e.len - w.length) > max) continue;
          if (e.short ? unknown.length > 0 || tail.length > 4 : unknown.length > 2) continue;
          const d = w === e.key ? 0 : lev(w, e.key, max);
          if (d > max || (d > 0 && unknown.length > 1)) continue; // a misread name must not be followed by much other text
          if (wc !== L && d > 2) continue; // split / merged words: hardly anything else may differ
          const score = d / e.len;
          if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) < 1e-9 && e.len > best.e.len)) best = { e, d, score, tail };
        }
      }
    }
  }
  if (!best) return null;
  return { key: best.e.key, names: best.e.names, dist: best.d, status: statusOf(best.tail), text };
}

// lines: [{text, conf?, bbox?}] or strings. Returns matches (one per quest) and lines that look like a task row but
// were not recognised. With boxes (screenshots) the rows are rebuilt: a name has to be the leftmost text of its row
// (a map called like a quest – "Reserve" – sits in the location column) and the status is read from the same row.
const rowMates = (a, all) => all.filter(b => b !== a && b.bbox && Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0) > 0.5 * Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0));
const hasWords = (t) => /[A-Za-z]{3,}/.test(String(t).replace(/&/g, ' '));
export function matchLines(lines, idx) {
  const L = lines.map(l => (typeof l === 'string' ? { text: l } : l)).filter(l => l.text && l.text.trim());
  const found = [];
  const unmatched = [];
  for (const l of L) {
    const m = matchLine(l.text, idx);
    if (m) { found.push({ m, l }); continue; }
    const toks = normName(l.text).split(' ').filter(Boolean);
    const words = toks.filter(t => t.length >= 3 && !/^\d+$/.test(t));
    if (words.length && toks.length <= 9 && words.some(t => !idx.known.has(t))) unmatched.push(l.text.trim());
  }
  // names of a task list start in one column: drop matches far away from it (description / objective text)
  const boxed = found.filter(f => f.l.bbox);
  let col = null;
  if (boxed.length >= 4) {
    const W = Math.max(...L.filter(l => l.bbox).map(l => l.bbox.x1));
    const tol = Math.max(50, 0.04 * W);
    let best = 0;
    for (const a of boxed) { const n = boxed.filter(b => Math.abs(b.l.bbox.x0 - a.l.bbox.x0) <= tol).length; if (n > best) { best = n; col = a.l.bbox.x0; } }
    if (best < 4) col = null;
    else { const near = boxed.filter(b => Math.abs(b.l.bbox.x0 - col) <= tol); col = { x: near.reduce((s, b) => s + b.l.bbox.x0, 0) / near.length, tol }; }
  }
  const matches = [];
  const seen = new Map();
  for (const { m, l } of found) {
    if (col && l.bbox && Math.abs(l.bbox.x0 - col.x) > col.tol * 1.5) continue;
    if (l.bbox) {
      const mates = rowMates(l, L);
      const left = mates.filter(b => b.bbox.x1 <= l.bbox.x0 + 2 && hasWords(b.text));
      if (left.length) continue;
      if (!m.status) for (const b of mates.filter(b => b.bbox.x0 >= l.bbox.x1 - 2).sort((a, b) => a.bbox.x0 - b.bbox.x0)) { const st = statusOf(normName(b.text).split(' ')); if (st) { m.status = st; break; } }
    }
    const prev = seen.get(m.key);
    if (!prev) { seen.set(m.key, m); matches.push(m); }
    else if (m.status && m.status !== 'open' && (!prev.status || prev.status === 'open')) prev.status = m.status;
    else if (m.status && !prev.status) prev.status = m.status;
  }
  return { matches, unmatched };
}
