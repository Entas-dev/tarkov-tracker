// Minimal wikitext helpers (MediaWiki / Fandom). No dependencies; runs in browser and Node.

export const WIKI_BASE = 'https://escapefromtarkov.fandom.com';

export function wikiUrl(title) {
  return `${WIKI_BASE}/wiki/${encodeURIComponent(String(title).replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%23/g, '#').replace(/%3A/g, ':')}`;
}

export function normTitle(t) {
  if (!t) return '';
  let s = String(t).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/#.*$/, '').trim();
  if (s) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

export function stripComments(t) {
  return String(t || '').replace(/<!--[\s\S]*?-->/g, '');
}

// Find matching close for {{ ... }} starting at index i (pointing at "{{")
function matchBraces(t, i, open = '{{', close = '}}') {
  let depth = 0;
  for (let k = i; k < t.length - 1; k++) {
    if (t.startsWith(open, k)) { depth++; k += open.length - 1; continue; }
    if (t.startsWith(close, k)) { depth--; k += close.length - 1; if (depth === 0) return k + 1; }
  }
  return -1;
}

// Returns top-level templates [{name, params:{}, positional:[], raw, start, end}]
export function templates(t) {
  const out = [];
  t = String(t || '');
  let i = 0;
  while ((i = t.indexOf('{{', i)) !== -1) {
    if (t[i + 2] === '{') { // {{{param}}} - skip
      const e = t.indexOf('}}}', i); i = e < 0 ? i + 3 : e + 3; continue;
    }
    const end = matchBraces(t, i);
    if (end < 0) break;
    const raw = t.slice(i, end);
    out.push({ ...parseTemplate(raw), raw, start: i, end });
    i = end;
  }
  return out;
}

// Split by top-level pipes (ignoring pipes inside [[ ]] and {{ }})
export function splitTop(s, sep = '|') {
  const parts = [];
  let depthB = 0, depthL = 0, cur = '';
  for (let k = 0; k < s.length; k++) {
    const two = s.slice(k, k + 2);
    if (two === '{{') { depthB++; cur += two; k++; continue; }
    if (two === '}}') { depthB--; cur += two; k++; continue; }
    if (two === '[[') { depthL++; cur += two; k++; continue; }
    if (two === ']]') { depthL--; cur += two; k++; continue; }
    if (s[k] === sep && depthB === 0 && depthL === 0) { parts.push(cur); cur = ''; continue; }
    cur += s[k];
  }
  parts.push(cur);
  return parts;
}

export function parseTemplate(raw) {
  const inner = raw.slice(2, -2);
  const parts = splitTop(inner);
  const name = (parts.shift() || '').trim();
  const params = {}; const positional = [];
  for (const p of parts) {
    const eq = p.indexOf('=');
    const brk = p.search(/\[\[|\{\{/);
    if (eq > 0 && (brk < 0 || eq < brk)) {
      params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
    } else positional.push(p.trim());
  }
  return { name, params, positional };
}

export function infobox(t, nameRe = /^Infobox/i) {
  const tp = templates(t).find(x => nameRe.test(x.name));
  return tp ? { type: tp.name.replace(/^Infobox\s*/i, '').trim().toLowerCase(), ...tp.params } : null;
}

// Sections: returns list [{level, title, body, start}] where body is text until next heading of same-or-higher level
export function sectionList(t) {
  t = String(t || '');
  const re = /^(={2,6})\s*(.+?)\s*\1\s*$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(t))) heads.push({ level: m[1].length, title: m[2], idx: m.index, after: m.index + m[0].length });
  return heads.map((h, i) => {
    let end = t.length;
    for (let j = i + 1; j < heads.length; j++) if (heads[j].level <= h.level) { end = heads[j].idx; break; }
    // direct body (until next heading of any level)
    const directEnd = i + 1 < heads.length ? heads[i + 1].idx : t.length;
    return { level: h.level, title: h.title, titleText: plain(h.title), body: t.slice(h.after, end), direct: t.slice(h.after, directEnd), start: h.idx };
  });
}

export function section(t, name) {
  const want = String(name).toLowerCase();
  const s = sectionList(t).find(x => x.titleText.toLowerCase() === want);
  return s ? s.body : null;
}

export function lead(t) {
  t = String(t || '');
  const m = t.match(/^={2,6}.+?={2,6}\s*$/m);
  return m ? t.slice(0, m.index) : t;
}

// Bullet list parsing. Returns [{depth, raw, children:[]}] as tree. Non-bullet bold lines become {heading:true}
export function bulletTree(body) {
  const lines = String(body || '').split('\n');
  const root = { depth: 0, children: [] };
  const stack = [root];
  for (let line of lines) {
    const l = line.replace(/\s+$/, '');
    const m = l.match(/^(\*+|#+)\s*(.*)$/);
    if (m) {
      const depth = m[1].length;
      const node = { depth, raw: m[2], children: [] };
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else if (/^:+/.test(l)) {
      // indented note -> attach to last node as note
      const last = stack[stack.length - 1];
      if (last && last !== root) (last.notes = last.notes || []).push(l.replace(/^:+\s*/, ''));
    } else if (l.trim()) {
      stack.length = 1;
      root.children.push({ depth: 0, raw: l.trim(), text: true, children: [] });
    }
  }
  return root.children;
}

export function links(raw) {
  const out = [];
  const re = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
  let m;
  while ((m = re.exec(String(raw || '')))) {
    const target = m[1].trim();
    if (/^(File|Image|Category|:Category|[a-z]{2}(-[a-z]+)?):/i.test(target)) continue;
    out.push({ target: normTitle(target), anchor: (target.split('#')[1] || '').trim(), label: (m[2] ?? target).trim() });
  }
  return out;
}

export function files(raw) {
  const out = [];
  const re = /\[\[(?:File|Image):([^\]|]+)((?:\|[^\]]*)?)\]\]/gi;
  let m;
  while ((m = re.exec(String(raw || '')))) {
    const opts = m[2] ? m[2].slice(1).split('|') : [];
    out.push({ file: normTitle(m[1]), opts });
  }
  return out;
}

export function galleryFiles(raw) {
  const out = [];
  const re = /<gallery[^>]*>([\s\S]*?)<\/gallery>/gi;
  let m;
  while ((m = re.exec(String(raw || '')))) {
    for (const line of m[1].split('\n')) {
      const l = line.trim();
      if (!l) continue;
      const [f, ...cap] = l.split('|');
      const file = normTitle(f.replace(/^(File|Image):/i, ''));
      if (file) out.push({ file, caption: plain(cap.join('|')) });
    }
  }
  return out;
}

const ENT = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&ndash;': '–', '&mdash;': '—', '&times;': '×' };
function decodeEnt(s) { return s.replace(/&[a-z#0-9]+;/gi, e => ENT[e] ?? e); }

// Plain text rendering
export function plain(raw) {
  let s = stripComments(raw);
  s = s.replace(/\{\{\s*(?:Seasonal change)\s*\|([\s\S]*?)\}\}/gi, '$1');
  // remove templates (non nested approximation, repeat)
  for (let i = 0; i < 4; i++) s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '');
  s = s.replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1').replace(/\[https?:\/\/[^\]]+\]/g, '');
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
  s = s.replace(/'''''|'''|''/g, '');
  return decodeEnt(s).replace(/[ \t]+/g, ' ').trim();
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Inline HTML rendering. Links become <a class="wl" data-t="Title">label</a>. ctx.onLink(target) may collect link targets.
export function inlineHtml(raw, ctx = {}) {
  let s = stripComments(raw);
  s = s.replace(/\{\{\s*Seasonal change\s*\|([\s\S]*?)\}\}/gi, '<span class="seasonal-inline">$1</span>');
  for (let i = 0; i < 4; i++) s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '');
  // protect html tags we keep
  const keep = [];
  s = s.replace(/<font\s+color="?([#a-z0-9]+)"?\s*>/gi, (m, c) => { keep.push(`<span class="c-${colorClass(c)}">`); return `\u0000${keep.length - 1}\u0000`; });
  s = s.replace(/<\/font>/gi, () => { keep.push('</span>'); return `\u0000${keep.length - 1}\u0000`; });
  s = s.replace(/<br\s*\/?>/gi, () => { keep.push('<br>'); return `\u0000${keep.length - 1}\u0000`; });
  s = s.replace(/<\/?(?:span|div|small|big|center|sup|sub|u|s|li|ul|nowiki)[^>]*>/gi, '');
  s = s.replace(/<[^>\u0000]+>/g, '');
  // links
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, t, l) => {
    const target = normTitle(t);
    if (ctx.onLink) ctx.onLink(target);
    keep.push(`<a class="wl" data-t="${esc(target)}">`); const a = keep.length - 1;
    keep.push('</a>'); const b = keep.length - 1;
    return `\u0000${a}\u0000${l ?? t.replace(/#.*/, '')}\u0000${b}\u0000`;
  });
  s = s.replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, (m, u, l) => { keep.push(`<a href="${esc(u)}" target="_blank" rel="noopener">`); const a = keep.length - 1; keep.push('</a>'); return `\u0000${a}\u0000${l}\u0000${keep.length - 1}\u0000`; });
  s = decodeEnt(s);
  s = esc(s);
  s = s.replace(/'''''(.+?)'''''/g, '<b><i>$1</i></b>').replace(/'''(.+?)'''/g, '<b>$1</b>').replace(/''(.+?)''/g, '<i>$1</i>').replace(/'''|''/g, '');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, n) => keep[+n]);
  return s.replace(/[ \t]+/g, ' ').trim();
}

function colorClass(c) {
  c = c.toLowerCase();
  if (/red|#f00|#ff0000|#c/.test(c)) return 'red';
  if (/green|#0f0|#00ff00|#008000/.test(c)) return 'green';
  if (/orange|gold|yellow/.test(c)) return 'orange';
  return 'x';
}

// Wikitable parsing: returns array of rows; each row is array of {header:boolean, raw}
export function tables(t) {
  const out = [];
  t = String(t || '');
  let i = 0;
  while ((i = t.indexOf('{|', i)) !== -1) {
    // match nested tables
    let depth = 0, k = i, end = -1;
    while (k < t.length) {
      if (t.startsWith('{|', k)) { depth++; k += 2; continue; }
      if (t.startsWith('|}', k)) { depth--; k += 2; if (depth === 0) { end = k; break; } continue; }
      k++;
    }
    if (end < 0) break;
    out.push(parseTable(t.slice(i, end)));
    i = end;
  }
  return out;
}

export function parseTable(raw) {
  const lines = raw.split('\n');
  const rows = []; let row = null; let caption = null; let cell = null;
  const pushCell = (c) => { if (!row) { row = []; rows.push(row); } row.push(c); cell = c; };
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (/^\s*\|\}/.test(line)) break;
    if (/^\s*\|-/.test(line)) { row = null; cell = null; continue; }
    if (/^\s*\|\+/.test(line)) { caption = line.replace(/^\s*\|\+\s*/, ''); continue; }
    const m = line.match(/^\s*([!|])(.*)$/);
    if (m) {
      const header = m[1] === '!';
      const sep = header ? /!!|\|\|/ : /\|\|/;
      const parts = splitCells(m[2], sep);
      for (const p of parts) pushCell({ header, raw: stripCellAttrs(p), attrs: cellAttrs(p) });
    } else if (cell) {
      cell.raw += '\n' + line;
    }
  }
  return { caption, rows };
}

function splitCells(s, sepRe) {
  // split on || or !! at top level
  const out = []; let cur = ''; let dl = 0, db = 0;
  for (let k = 0; k < s.length; k++) {
    const two = s.slice(k, k + 2);
    if (two === '[[') { dl++; cur += two; k++; continue; }
    if (two === ']]') { dl--; cur += two; k++; continue; }
    if (two === '{{') { db++; cur += two; k++; continue; }
    if (two === '}}') { db--; cur += two; k++; continue; }
    if (dl === 0 && db === 0 && (two === '||' || (sepRe.source.includes('!!') && two === '!!'))) { out.push(cur); cur = ''; k++; continue; }
    cur += s[k];
  }
  out.push(cur);
  return out;
}

function cellAttrs(p) {
  const parts = splitTop(p);
  if (parts.length > 1 && /=\s*"/.test(parts[0]) && !/\[\[|\{\{/.test(parts[0])) return parts[0];
  if (parts.length > 1 && /^\s*(style|class|colspan|rowspan|data-sort-value|align|width)\s*=/.test(parts[0])) return parts[0];
  return '';
}
function stripCellAttrs(p) {
  const parts = splitTop(p);
  if (parts.length > 1 && (/^\s*(style|class|colspan|rowspan|data-sort-value|align|width)\s*=/.test(parts[0]) || (/=\s*"/.test(parts[0]) && !/\[\[|\{\{/.test(parts[0])))) return parts.slice(1).join('|').trim();
  return p.trim();
}

export function num(s) {
  if (s == null) return null;
  const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export function slug(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-');
}
