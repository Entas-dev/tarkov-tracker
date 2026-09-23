// Shared UI helpers & components
import { D, IX, P, questStatus, isDone, visible, traderLL, questNeeds, isSeasonal, preOf, groupSatisfied, questObjProgress } from './model.js';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const attr = esc;
export const WIKI = 'https://escapefromtarkov.fandom.com';
export const wikiHref = (t) => `${WIKI}/wiki/${encodeURIComponent(String(t).replace(/ /g, '_'))}`;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function icon(name, cls = '') {
  const paths = {
    check: '<path d="M4 12.5l5 5L20 6.5" />',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    map: '<path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z"/><path d="M9 4v13M15 6.5v13"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  };
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

export function img(src, alt = '', cls = '') {
  if (!src) return `<span class="noimg ${cls}" aria-hidden="true"></span>`;
  return `<img class="${cls}" src="${attr(src)}" alt="${attr(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg ${cls}'}))">`;
}

export const traderImg = (t, cls = 'tr-ic') => img(D.traders[t]?.img, t, cls);

export function qlink(name, { cls = '' } = {}) {
  const q = D.quests[name];
  if (!q) return `<a class="wl ${cls}" data-t="${attr(name)}">${esc(name)}</a>`;
  const st = questStatus(q).s;
  return `<span class="ql ql-${st} ${cls}" data-q="${attr(name)}" data-tip-q="${attr(name)}">${esc(name)}</span>`;
}

export function itemChip(item, { count = null, have = null, fir = false, counter = null, small = false, optional = false } = {}) {
  const I = D.items[item] || { name: item };
  if (I.currency) counter = null;
  const done = counter && have != null && count != null && have >= count;
  const cnt = count != null ? `<span class="ic-count">${have != null && counter ? `${fmt(have)}/` : ''}${fmt(count)}</span>` : '';
  const firB = fir ? `<span class="fir" title="Found in raid">FiR</span>` : '';
  const ctr = counter ? `<span class="ctr"><button class="ctr-b" data-act="cnt" data-k="${attr(counter)}" data-d="-1" data-max="${count}" aria-label="minus">${icon('minus')}</button><button class="ctr-b" data-act="cnt" data-k="${attr(counter)}" data-d="1" data-max="${count}" aria-label="plus">${icon('plus')}</button></span>` : '';
  return `<span class="chip ${small ? 'chip-s' : ''} ${done ? 'chip-done' : ''} ${optional ? 'chip-opt' : ''}" data-tip-item="${attr(item)}">${img(I.img, I.name, 'chip-img')}<span class="chip-name" data-item="${attr(item)}">${esc(I.name)}</span>${cnt}${firB}${ctr}</span>`;
}

export function fmt(n) { if (n == null) return ''; return n >= 10000 ? n.toLocaleString('en-US') : String(n); }

export function statusBadge(s) {
  return { done: `<span class="badge b-done">${icon('check')}Done</span>`, available: `<span class="badge b-av">Available</span>`, locked: `<span class="badge b-lock">${icon('lock')}Locked</span>`, blocked: `<span class="badge b-muted" data-tip="You picked another option of this choice">Other choice taken</span>` }[s] || '';
}

export function progressBar(done, total, label = '') {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="pbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="pbar-fill" style="width:${pct}%"></div><span class="pbar-txt">${label ? esc(label) + ' · ' : ''}${done}/${total} · ${pct}%</span></div>`;
}

// ---------- Quest tooltip content ----------
export function questTooltip(name) {
  const q = D.quests[name];
  if (!q) return '';
  const p = P();
  const st = questStatus(q, p);
  const rows = [];
  const ok = (b) => b ? `<span class="t-ok">${icon('check')}</span>` : `<span class="t-no">${icon('x')}</span>`;
  if (q.minLevel) rows.push(`${ok(p.settings.level >= q.minLevel)} PMC level ${q.minLevel}`);
  if (q.ll) rows.push(`${ok(traderLL(q.ll.trader, p) >= q.ll.level)} ${esc(q.ll.trader)} LL${q.ll.level}`);
  for (const g of preOf(q)) {
    const sat = groupSatisfied(g, p);
    rows.push(`${ok(sat)} ${g.map(a => `${a.type === 'accept' ? 'Accept ' : a.type === 'fail' ? 'Fail ' : ''}<b>${esc(a.q)}</b>${a.delay ? ` <span class="muted">(+${esc(a.delay)})</span>` : ''}`).join(' <span class="muted">or</span> ')}`);
  }
  if (q.faction) rows.push(`${ok(p.settings.faction === q.faction)} ${q.faction} only`);
  if (q.edition) rows.push(`${ok(q.edition === 'EOD' ? p.settings.eod : p.settings.unheard)} ${q.edition === 'EOD' ? 'Edge of Darkness' : 'The Unheard'} edition`);
  for (const r of q.reqHtml) if (!/level|loyalty|must complete|unlocks|obtainable|edition|must accept|playing in/i.test(r.html.replace(/<[^>]+>/g, ''))) rows.push(`<span class="t-dot">•</span> ${r.html}`);
  const needs = questNeeds(q, p);
  const pr = questObjProgress(q, p);
  const seas = isSeasonal() && q.seasonal?.length ? `<div class="tt-seasonal">${q.seasonal.map(s => `<div>${s.html}</div>`).join('')}</div>` : '';
  return `<div class="tt-head">${traderImg(q.trader, 'tt-tr')}<div><div class="tt-title">${esc(q.name)}</div><div class="tt-sub">${esc(q.trader || '')}${q.allMaps.length ? ' · ' + esc(q.allMaps.join(', ')) : ''}</div></div>${statusBadge(st.s)}</div>
  <div class="tt-sec"><div class="tt-h">Requirements</div>${rows.length ? rows.map(r => `<div class="tt-row tt-req">${r.replace(/^(<span class="t-(?:ok|no|dot)">[\s\S]*?<\/span>)\s*([\s\S]*)$/, '$1<span>$2</span>')}</div>`).join('') : '<div class="muted">None</div>'}</div>
  <div class="tt-sec"><div class="tt-h">Objectives <span class="muted">${pr.done}/${pr.total}</span></div>${q.objectives.filter(o => (o.depth || 1) === 1).slice(0, 8).map(o => `<div class="tt-row">${o.optional ? '<span class="muted">(opt)</span> ' : ''}${o.html}</div>`).join('')}${q.objectives.filter(o => (o.depth || 1) === 1).length > 8 ? '<div class="muted">…</div>' : ''}</div>
  ${needs.length ? `<div class="tt-sec"><div class="tt-h">Items</div><div class="chips">${needs.map(n => itemChip(n.item, { count: n.count, fir: n.fir, small: true })).join('')}</div></div>` : ''}
  ${seas}
  ${IX.kappa.has(q.name) ? '<div class="tt-foot"><span class="badge b-kappa">Kappa</span></div>' : ''}`;
}

export function itemTooltip(item) {
  const I = D.items[item];
  if (!I) return '';
  const uses = (IX.itemUse[item] || []).slice(0, 10);
  return `<div class="tt-head">${img(I.img, I.name, 'tt-item')}<div><div class="tt-title">${esc(I.name)}</div><div class="tt-sub">${esc(I.type || '')}</div></div></div>
  ${uses.length ? `<div class="tt-sec"><div class="tt-h">Needed for</div>${uses.map(u => `<div class="tt-row">${u.type === 'hideout' ? `${esc(u.name)} L${u.level}` : esc(u.name)} · ${fmt(u.count)}${u.fir ? ' <span class="fir">FiR</span>' : ''}</div>`).join('')}${(IX.itemUse[item] || []).length > 10 ? '<div class="muted">…</div>' : ''}</div>` : ''}
  <div class="tt-foot muted">Click for where to find it</div>`;
}

// ---------- tooltip controller ----------
let tipEl = null, tipTimer = null, tipTarget = null;
export function initTooltips() {
  tipEl = document.createElement('div');
  tipEl.className = 'tooltip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip-q],[data-tip-item],[data-tip]');
    if (t === tipTarget) return;
    tipTarget = t;
    clearTimeout(tipTimer);
    if (!t) { hideTip(); return; }
    tipTimer = setTimeout(() => showTip(t), 180);
  });
  document.addEventListener('scroll', hideTip, true);
}
function showTip(t) {
  let html = '';
  if (t.dataset.tipQ) html = questTooltip(t.dataset.tipQ);
  else if (t.dataset.tipItem) html = itemTooltip(t.dataset.tipItem);
  else html = `<div class="tt-plain">${t.dataset.tip}</div>`;
  if (!html) return hideTip();
  tipEl.innerHTML = html;
  tipEl.classList.add('show');
  const r = t.getBoundingClientRect();
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  let x = r.left, y = r.bottom + 8;
  if (x + tw > innerWidth - 8) x = innerWidth - tw - 8;
  if (y + th > innerHeight - 8) y = r.top - th - 8;
  if (y < 8) y = 8;
  tipEl.style.left = Math.max(8, x) + 'px';
  tipEl.style.top = y + 'px';
}
export function hideTip() { tipEl?.classList.remove('show'); tipTarget = null; }

// ---------- modal ----------
export function confirmDialog({ title, bodyHtml, buttons }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${attr(title)}"><div class="modal-h">${esc(title)}</div><div class="modal-b">${bodyHtml}</div><div class="modal-f">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'btn-p' : ''} ${b.danger ? 'btn-d' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    document.body.appendChild(wrap);
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) close(buttons[+b.dataset.i].value); else if (e.target === wrap) close(null); });
    wrap.querySelector('.btn-p, button')?.focus();
  });
}

export function toast(msg, ms = 2600) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.innerHTML = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- live wiki content ----------
const wikiCache = new Map();
export async function wikiApi(params) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const r = await fetch(`${WIKI}/api.php?${qs}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
export async function wikiSections(page) {
  const k = 'sec|' + page;
  if (wikiCache.has(k)) return wikiCache.get(k);
  const p = wikiApi({ action: 'parse', page, prop: 'sections', redirects: '1' }).then(j => j.parse?.sections || []);
  wikiCache.set(k, p);
  return p;
}
export async function wikiSectionHtml(page, matchRe) {
  const secs = await wikiSections(page);
  const s = secs.find(x => matchRe.test(x.line.replace(/<[^>]+>/g, '')));
  if (!s) return null;
  const k = `html|${page}|${s.index}`;
  if (!wikiCache.has(k)) wikiCache.set(k, wikiApi({ action: 'parse', page, section: s.index, prop: 'text', disableeditsection: '1', disablelimitreport: '1', redirects: '1' }).then(j => sanitizeWikiHtml(j.parse?.text || '')));
  return wikiCache.get(k);
}
export function sanitizeWikiHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  root.querySelectorAll('script,style,noscript,.mw-editsection,.navbox,.toc,link,meta').forEach(n => n.remove());
  root.querySelectorAll('h2').forEach((n, i) => { if (i === 0) n.remove(); });
  root.querySelectorAll('table').forEach(t => { if (/Related Quest Items/i.test(t.rows?.[0]?.textContent || '')) t.remove(); });
  root.querySelectorAll('img').forEach(im => {
    const src = im.getAttribute('data-src') || im.getAttribute('src');
    if (!src || src.startsWith('data:')) { im.remove(); return; }
    im.setAttribute('src', src); im.removeAttribute('data-src'); im.removeAttribute('srcset'); im.setAttribute('loading', 'lazy'); im.setAttribute('referrerpolicy', 'no-referrer');
    im.classList.remove('lazyload');
  });
  root.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const isImg = a.querySelector('img');
    if (href.startsWith('/wiki/') && !isImg) {
      const t = decodeURIComponent(href.slice(6).split('#')[0]).replace(/_/g, ' ');
      if (!/^(File|Category|Special):/.test(t)) { a.className = 'wl'; a.dataset.t = t; a.removeAttribute('href'); return; }
    }
    if (isImg) {
      const im = a.querySelector('img');
      const full = href.startsWith('http') ? href : (im?.getAttribute('src') || '').replace(/\/scale-to-width-down\/\d+/, '');
      a.setAttribute('href', full); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener');
      return;
    }
    if (href.startsWith('/')) a.setAttribute('href', WIKI + href);
    a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener');
  });
  root.querySelectorAll('[style]').forEach(n => { const s = n.getAttribute('style'); n.setAttribute('style', s.replace(/(?:^|;)\s*(?:background[^;]*|color[^;]*|border[^;]*|box-shadow[^;]*)/gi, '')); });
  return root.innerHTML;
}
