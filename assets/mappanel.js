// Collapsible map panel (top right): map selection, active quests on that map, objective + quest item markers.
// Map images & marker coordinates: tarkov.dev (maps by the tarkov.dev community). Quest logic: wiki data.
import { store } from './store.js';
import { D, IX, P, visible, questStatus, isDone, objDone } from './model.js';
import { esc, attr, icon, img, itemChip, traderImg, fmt } from './ui.js';
import { lootData, ensureLoot, lootState, mapLoot, lootPoints, containerCanHold, itemIndex, itemImg, neededLoot, whereText, findability } from './loot.js';

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';

let qT = null;
let panel, mapEl, listEl, leafletMap, L, mapCfgs = null, curKey = null, markerLayer = null, extractLayer = null, focusQuest = null;
let md = null; // marker snapshot {tasks, maps, fetchedAt, gameMode} built daily from json.tarkov.dev
let mdState = 'idle';
let lootLayer = null;
let hl = { item: null, cont: null, fit: false }; // highlighted loot item index / container type name
const view = () => store.ui.mpView || 'quests';
const MAP_ALIAS = { 'ground-zero-21': 'ground-zero', 'ground-zero-tutorial': 'ground-zero', 'night-factory': 'factory', 'the-lab-dark': 'the-lab' };
const mapIs = (m, cfg) => (MAP_ALIAS[m] || m) === cfg.normalizedName;

const WIKI_TO_KEY = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function initMapPanel() {
  panel = document.createElement('section');
  panel.className = 'mappanel collapsed';
  panel.setAttribute('aria-label', 'Map panel');
  panel.innerHTML = `
    <button class="mp-toggle" data-mp="toggle" aria-expanded="false">${icon('map')}<span>Map</span></button>
    <div class="mp-box">
      <div class="mp-head">
        <select class="mp-select" aria-label="Choose map"></select>
        <label class="tog small"><input type="checkbox" data-mp="extracts" checked> Extracts</label>
        <label class="tog small" data-tip="Quests view: loose-loot spawn points of items your active quests need, and doors for needed keys"><input type="checkbox" data-mp="loot" checked> Item spawns</label>
        <span class="mp-status small muted"></span>
        <button class="ibtn" data-mp="size" aria-label="Enlarge">${icon('expand')}</button>
        <button class="ibtn" data-mp="toggle" aria-label="Collapse">${icon('x')}</button>
      </div>
      <div class="mp-body">
        <div class="mp-map" role="application" aria-label="Interactive map"></div>
        <div class="mp-list"></div>
      </div>
      <div class="mp-foot small muted">Map images, marker &amp; spawn positions: <a href="https://tarkov.dev/maps" target="_blank" rel="noopener">tarkov.dev</a> · Quests &amp; container loot tables: EFT wiki</div>
    </div>`;
  document.body.appendChild(panel);
  mapEl = panel.querySelector('.mp-map');
  listEl = panel.querySelector('.mp-list');
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mp]');
    if (b?.dataset.mp === 'toggle') togglePanel();
    if (b?.dataset.mp === 'size') { panel.classList.toggle('big'); setTimeout(() => leafletMap?.invalidateSize(), 220); }
    const fq = e.target.closest('[data-mpq]');
    if (fq) { focusQuest = fq.dataset.mpq === focusQuest ? null : fq.dataset.mpq; drawMarkers(true); renderList(); }
    const v = e.target.closest('[data-mpv]');
    if (v) { store.setUi('mpView', v.dataset.mpv); if (v.dataset.mpv === 'loot') ensureLoot(); renderList(); drawMarkers(); setTimeout(() => leafletMap?.invalidateSize(), 60); }
    const li = e.target.closest('[data-mpi]');
    if (li && !e.target.closest('.chip-name')) { const i = +li.dataset.mpi; hl = { item: hl.item === i ? null : i, cont: null, fit: true }; renderList(); drawMarkers(); }
    const lc = e.target.closest('[data-mpc]');
    if (lc) { const c = lc.dataset.mpc; hl = { item: null, cont: hl.cont === c ? null : c, fit: true }; renderList(); drawMarkers(); }
    const ls = e.target.closest('[data-mpls]');
    if (ls) { const k = ls.dataset.mpls, v = ls.dataset.v; store.setUi(k, k === 'mplLim' ? (store.ui.mplLim || 80) + 150 : v); renderList(); }
  });
  panel.addEventListener('input', (e) => {
    const q = e.target.closest('[data-mplq]');
    if (q) { store.setUi('mplq', q.value); clearTimeout(qT); qT = setTimeout(() => { const pos = q.selectionStart; renderList(); const nq = listEl.querySelector('[data-mplq]'); if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch { } } }, 180); }
  });
  panel.querySelector('.mp-select').addEventListener('change', (e) => showMap(e.target.value));
  panel.querySelector('[data-mp="extracts"]').addEventListener('change', () => drawMarkers());
  panel.querySelector('[data-mp="loot"]').addEventListener('change', () => drawMarkers());
  store.on((reason) => {
    if (reason === 'profile' && initP && md?.gameMode !== store.profile.gameMode) { md = null; loadMarkers(); }
    if (reason === 'profile' && initP) { hl = { item: null, cont: null, fit: false }; ensureLoot(); }
    if (!panel.classList.contains('collapsed')) { renderList(); drawMarkers(); }
  });
}

function togglePanel(force) {
  const open = force ?? panel.classList.contains('collapsed');
  panel.classList.toggle('collapsed', !open);
  panel.querySelector('.mp-toggle').setAttribute('aria-expanded', String(open));
  if (open) { ensureInit().then(() => { if (!curKey) showMap(store.ui.mapKey || 'customs'); else { leafletMap?.invalidateSize(); renderList(); drawMarkers(); } }); }
}

export function openMap(wikiMapName, questName = null) {
  focusQuest = questName;
  togglePanel(true);
  ensureInit().then(() => {
    const k = WIKI_TO_KEY(wikiMapName);
    const cfg = mapCfgs.find(m => m.key === k || m.normalizedName === k) || mapCfgs.find(m => k.includes(m.normalizedName));
    showMap(cfg ? cfg.key : (curKey || 'customs'));
  });
}

// open the map on the loot view with one item's spawns highlighted
export function openMapLoot(wikiMapName, itemName) {
  focusQuest = null;
  store.setUi('mpView', 'loot');
  togglePanel(true);
  ensureInit().then(async () => {
    await ensureLoot();
    const i = itemIndex(itemName);
    hl = { item: i >= 0 ? i : null, cont: null, fit: true };
    if (i >= 0) store.setUi('mplq', '');
    const k = WIKI_TO_KEY(wikiMapName || '');
    const cfg = mapCfgs.find(m => m.key === k || m.normalizedName === k) || mapCfgs.find(m => k && k.includes(m.normalizedName)) || mapCfgs.find(m => m.key === curKey);
    showMap(cfg ? cfg.key : 'customs');
  });
}

async function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}
async function loadJs(src) {
  if (window.L) return;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}

let initP = null;
function ensureInit() {
  if (initP) return initP;
  initP = (async () => {
    loadCss(LEAFLET_CSS);
    await loadJs(LEAFLET_JS);
    L = window.L;
    mapCfgs = await fetch('data/maps.json').then(r => r.json());
    const sel = panel.querySelector('.mp-select');
    sel.innerHTML = mapCfgs.map(m => `<option value="${m.key}">${esc(displayName(m.key))}</option>`).join('');
    loadMarkers();
    ensureLoot();
  })();
  return initP;
}

const NAMES = { 'streets-of-tarkov': 'Streets of Tarkov', 'ground-zero': 'Ground Zero', 'the-lab': 'The Lab', 'the-labyrinth': 'The Labyrinth' };
const displayName = (k) => NAMES[k] || k.replace(/(^|-)([a-z])/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase());
const wikiNameFor = (k) => { const d = displayName(k); return IX.maps.find(m => norm(m) === norm(d)) || d; };

// ---------- marker data (snapshot of tarkov.dev's static exports, refreshed daily by the GitHub Action) ----------
async function loadMarkers() {
  const gm = store.profile.gameMode;
  mdState = 'loading'; setStatus();
  try {
    const r = await fetch(`data/mapdata-${gm}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    md = await r.json();
    mdState = 'ok';
  } catch (e) { md = null; mdState = 'missing'; console.warn('map markers unavailable', e); }
  setStatus();
  renderList();
  drawMarkers();
}
function setStatus() {
  const s = panel.querySelector('.mp-status');
  if (mdState === 'loading') s.textContent = 'Loading markers…';
  else if (mdState === 'missing') s.textContent = 'Marker data not available yet – map & quest list still work';
  else if (mdState === 'ok') { const h = Math.round((Date.now() - md.fetchedAt) / 3600e3); s.textContent = `Markers: tarkov.dev data, ${h < 1 ? 'just updated' : h + ' h old'}`; }
  else s.textContent = '';
}

// ---------- map rendering ----------
function getCRS(cfg) {
  let sx = 1, sy = 1, mx = 0, my = 0;
  if (cfg.transform) { sx = cfg.transform[0]; sy = cfg.transform[2] * -1; mx = cfg.transform[1]; my = cfg.transform[3]; }
  const rot = (ll, r) => {
    if (!r || (!ll.lng && !ll.lat)) return ll;
    const a = (r * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return L.latLng(ll.lng * s + ll.lat * c, ll.lng * c - ll.lat * s);
  };
  return L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(sx, mx, sy, my),
    projection: L.extend({}, L.Projection.LonLat, {
      project: (ll) => L.Projection.LonLat.project(rot(ll, cfg.coordinateRotation)),
      unproject: (pt) => rot(L.Projection.LonLat.unproject(pt), -cfg.coordinateRotation),
    }),
  });
}
const pos = (p) => [p.z, p.x];
const bnds = (b) => L.latLngBounds([b[0][1], b[0][0]], [b[1][1], b[1][0]]);

async function showMap(key) {
  await ensureInit();
  const cfg = mapCfgs.find(m => m.key === key) || mapCfgs[0];
  curKey = cfg.key;
  store.setUi('mapKey', curKey);
  panel.querySelector('.mp-select').value = curKey;
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  mapEl.innerHTML = '';
  leafletMap = L.map(mapEl, { crs: getCRS(cfg), minZoom: cfg.minZoom ?? 1, maxZoom: Math.max(cfg.maxZoom ?? 5, 6), zoomSnap: 0.25, attributionControl: false, zoomControl: true });
  const b = bnds(cfg.bounds);
  if (cfg.tilePath) {
    L.tileLayer(cfg.tilePath, { tileSize: cfg.tileSize || 256, bounds: b, maxNativeZoom: cfg.maxZoom, maxZoom: Math.max(cfg.maxZoom ?? 5, 6) }).addTo(leafletMap);
  } else if (cfg.svgPath) {
    const sb = cfg.svgBounds ? bnds(cfg.svgBounds) : b;
    try {
      const txt = await fetch(cfg.svgPath).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
      const svg = new DOMParser().parseFromString(txt, 'image/svg+xml').documentElement;
      for (const g of svg.querySelectorAll(':scope > g')) if (cfg.svgLayer && g.id && g.id !== cfg.svgLayer && g.dataset?.keepWithGroup !== cfg.svgLayer && (cfg.layers || []).some(l => l.svgLayer === g.id)) g.remove();
      L.svgOverlay(svg, sb).addTo(leafletMap);
    } catch {
      L.imageOverlay(cfg.svgPath, sb).addTo(leafletMap);
    }
  }
  leafletMap.fitBounds(b);
  const hlOn = view() === 'loot' && (hl.item != null || hl.cont);
  if (hlOn) hl.fit = true;
  setTimeout(() => { leafletMap?.invalidateSize(); if (hlOn) { hl.fit = true; drawMarkers(); } else if (!focusQuest) leafletMap?.fitBounds(b); }, 80);
  markerLayer = L.layerGroup().addTo(leafletMap);
  extractLayer = L.layerGroup().addTo(leafletMap);
  lootLayer = L.layerGroup().addTo(leafletMap);
  renderList();
  drawMarkers(true);
}

function activeQuestsHere() {
  const p = P();
  const wn = wikiNameFor(curKey);
  return IX.order.filter(n => {
    const q = D.quests[n];
    if (!visible(q, p) || isDone(n, p)) return false;
    if (!q.allMaps.some(m => norm(m) === norm(wn) || (norm(wn) === 'groundzero' && norm(m).startsWith('groundzero')))) return false;
    return questStatus(q, p).s === 'available';
  });
}

function viewTabs(nq) {
  const v = view();
  return `<div class="mp-tabs" role="tablist"><button role="tab" aria-selected="${v === 'quests'}" class="mp-tab ${v === 'quests' ? 'on' : ''}" data-mpv="quests">Quests <span class="muted">${nq}</span></button><button role="tab" aria-selected="${v === 'loot'}" class="mp-tab ${v === 'loot' ? 'on' : ''}" data-mpv="loot">${icon('box')} Loot</button></div>`;
}
function renderList() {
  if (!curKey) return;
  panel.classList.toggle('loot', view() === 'loot');
  if (view() === 'loot') return renderLootList();
  const p = P();
  const names = activeQuestsHere();
  const wn = wikiNameFor(curKey);
  listEl.innerHTML = viewTabs(names.length) + `<div class="mp-lh"><b>${esc(displayName(curKey))}</b> · ${names.length} active quests</div>` + (names.map(n => {
    const q = D.quests[n];
    const objs = q.objectives.filter(o => !o.optional && !objDone(n, o.id, p) && (!o.maps?.length || o.maps.some(m => norm(m) === norm(wn))));
    const needs = (q.needs || []).filter(x => !x.optional);
    return `<div class="mp-q ${focusQuest === n ? 'focus' : ''}">
      <div class="mp-qh" data-mpq="${attr(n)}" role="button" tabindex="0">${traderImg(q.trader, 'mp-tr')}<span class="ql" data-q="${attr(n)}" data-tip-q="${attr(n)}">${esc(n)}</span>${hasMarkers(n) ? `<span class="mp-pin" title="Has map markers">${icon('map')}</span>` : ''}</div>
      <ul>${objs.slice(0, 6).map(o => `<li>${o.html}</li>`).join('')}</ul>
      ${needs.length ? `<div class="chips">${needs.slice(0, 6).map(x => itemChip(x.item, { count: x.count, fir: x.fir, small: true })).join('')}</div>` : ''}
    </div>`;
  }).join('') || '<div class="empty small">No available quests on this map for your current progress.</div>');
}

const curCfg = () => mapCfgs?.find(m => m.key === curKey);
function renderLootList() {
  const ld = lootData();
  const cfg = curCfg();
  const nq = activeQuestsHere().length;
  if (!ld) {
    if (lootState() !== 'missing') ensureLoot();
    listEl.innerHTML = viewTabs(nq) + `<div class="empty small">${lootState() === 'missing' ? 'Loot data is not available yet (it is built by the daily data update).' : 'Loading loot data…'}</div>`;
    return;
  }
  const ml = mapLoot(cfg.normalizedName);
  if (!ml) { listEl.innerHTML = viewTabs(nq) + '<div class="empty small">No loot data for this map.</div>'; return; }
  const needs = new Map(neededLoot(P()).map(n => [n.li, n]));
  const q = (store.ui.mplq || '').toLowerCase().trim();
  const src = store.ui.mplSrc || 'all', sort = store.ui.mplSort || 'need', lim = store.ui.mplLim || 80;
  let rows = ml.items.filter(r => (src !== 'loose' || r.loose) && (src !== 'needed' || needs.has(r.i)) && (!q || r.x.n.toLowerCase().includes(q) || r.x.s.toLowerCase().includes(q) || r.x.cat.toLowerCase().includes(q) || (r.x.alt || '').toLowerCase().includes(q)));
  const val = (r) => r.x.p / Math.max(1, r.x.sz);
  if (sort === 'value') rows.sort((a, b) => val(b) - val(a));
  else if (sort === 'chance') rows.sort((a, b) => b.score - a.score);
  else rows.sort((a, b) => (needs.get(b.i)?.prio || 0) - (needs.get(a.i)?.prio || 0) || b.score - a.score);
  const seg = (k, cur, opts) => `<div class="seg seg-s">${opts.map(([v, l]) => `<button class="seg-b ${cur === v ? 'on' : ''}" data-mpls="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const nNeeded = ml.items.filter(r => needs.has(r.i)).length;
  listEl.innerHTML = viewTabs(nq) + `
    <div class="mp-lh"><b>${esc(displayName(curKey))}</b> · ${fmt(ml.items.length)} items can spawn · ${fmt(ml.looseSpots)} loose spots · ${fmt(ml.contCount)} containers · <b class="c-acc">${nNeeded}</b> you need</div>
    <div class="ml-conts">${ml.conts.map(c => `<button class="chip chip-s ml-c ${hl.cont === c.name ? 'on' : ''}" data-mpc="${attr(c.name)}" data-tip="${attr(c.size ? `Loot table (wiki): ${c.size} possible items – click to show all ${c.n} on the map` : 'No loot table on the wiki – click to show positions')}">${esc(c.name)} <span class="ic-count">${c.n}</span></button>`).join('')}</div>
    <div class="ml-bar">
      <label class="search search-s">${icon('search')}<input type="search" data-mplq placeholder="Search loot" value="${attr(store.ui.mplq || '')}" aria-label="Search loot on this map"></label>
      ${seg('mplSrc', src, [['all', 'All'], ['loose', 'Loose'], ['needed', 'Needed']])}
      ${seg('mplSort', sort, [['need', 'Needed first'], ['chance', 'Chance'], ['value', '₽/slot']])}
    </div>
    <div class="ml-list">${rows.slice(0, lim).map(r => {
      const n = needs.get(r.i);
      const f = findability(cfg.normalizedName, r.i);
      return `<div class="ml-row ${hl.item === r.i ? 'on' : ''} ${n ? 'lp' + n.prio : ''}" data-mpi="${r.i}" role="button" tabindex="0">
        ${img(itemImg(r.x), r.x.n, 'ml-ic')}
        <div class="ml-main"><div class="ml-n"><span class="chip-name" data-item="${attr(r.x.n)}">${esc(r.x.n)}</span>${n ? ` <span class="ml-need" data-tip="${attr('Still needed for ' + n.sources.slice(0, 4).map(s => (s.type === 'hideout' ? `${s.name} L${s.level}` : s.name) + ' ×' + (s.count - (s.have || 0))).join(', '))}">need ${fmt(n.missing)}${n.fir ? ' FiR' : ''}</span>` : ''}</div>
          <div class="small muted">${esc(whereText(f) || '–')}</div></div>
        <div class="ml-v small muted">${r.x.p ? fmt(Math.round(val(r))) + ' ₽' : ''}</div>
      </div>`;
    }).join('') || '<div class="empty small">Nothing matches.</div>'}</div>
    ${rows.length > lim ? `<button class="btn btn-s more" data-mpls="mplLim">Show more (${rows.length - lim})</button>` : ''}
    <p class="small muted">Click an item or container to show where it can spawn. Loose spots &amp; container positions: tarkov.dev · what a container can hold: wiki loot tables. Spawns are random – this shows possibilities, not guarantees.</p>`;
}

function mdTask(name) {
  if (!md) return null;
  return md.tasks.find(t => t.wiki === name) || md.tasks.find(t => norm(t.name) === norm(name)) || null;
}
function hasMarkers(name) {
  const t = mdTask(name);
  if (!t) return false;
  const cfg = mapCfgs.find(m => m.key === curKey);
  return t.objectives.some(o => o.zones.some(z => mapIs(z.map, cfg)) || o.locs.some(l => mapIs(l.map, cfg)));
}

function neededHere(names) {
  const items = new Map(), keys = new Map(); // items: loot index -> name · keys: node id -> name
  for (const n of names) {
    for (const x of D.quests[n].needs || []) {
      const I = D.items[x.item];
      if (!I || I.currency) continue;
      if (/key|keycard/i.test(I.type || '') || /key(card)?\b/i.test(x.item)) { if (I.node) keys.set(I.node, I.name); }
      else { const li = itemIndex(I.name); if (li >= 0) items.set(li, I.name); }
    }
  }
  return { items, keys };
}

function drawMarkers(fit = false) {
  if (!leafletMap || !markerLayer) return;
  markerLayer.clearLayers(); extractLayer.clearLayers(); lootLayer?.clearLayers();
  const cfg = curCfg();
  const names = activeQuestsHere();
  const lootView = view() === 'loot';
  const pts = [];
  const lp = lootData() ? lootPoints(cfg.normalizedName) : null;
  if (md && !lootView) {
    for (const n of names) {
      const t = mdTask(n);
      if (!t) continue;
      const foc = focusQuest === n;
      if (focusQuest && !foc) continue;
      for (const o of t.objectives) {
        for (const z of o.zones) {
          if (!mapIs(z.map, cfg) || !z.p) continue;
          if (z.o?.length > 2) L.polygon(z.o.map(pos), { color: foc ? '#f2c14e' : '#c9a227', weight: foc ? 2 : 1, fillOpacity: foc ? 0.25 : 0.1, interactive: false }).addTo(markerLayer);
          const m = L.marker(pos(z.p), { icon: L.divIcon({ className: `mk mk-obj ${foc ? 'mk-focus' : ''}`, html: '<span></span>', iconSize: [18, 18] }) });
          m.bindPopup(`<b>${esc(n)}</b><br>${esc(o.d)}${o.opt ? ' <i>(optional)</i>' : ''}`);
          m.addTo(markerLayer); pts.push(pos(z.p));
        }
        for (const loc of o.locs) {
          if (!mapIs(loc.map, cfg)) continue;
          for (const ps of loc.ps) {
            const m = L.marker(pos(ps), { icon: L.divIcon({ className: `mk mk-item ${foc ? 'mk-focus' : ''}`, html: o.qi?.i ? `<img src="${attr(o.qi.i)}" alt="">` : '<span></span>', iconSize: [26, 26] }) });
            m.bindPopup(`<b>${esc(n)}</b><br>${esc(o.qi?.n || o.d)}<br><span class="small">${esc(o.d)}</span>`);
            m.addTo(markerLayer); pts.push(pos(ps));
          }
        }
      }
    }
  }
  const mp = md ? md.maps.filter(m => mapIs(m.map, cfg)) : [];
  if (panel.querySelector('[data-mp="extracts"]').checked) {
    const seen = new Set();
    for (const m of mp) for (const ex of m.extracts) {
      if (ex.f && ex.f !== 'pmc' && ex.f !== 'shared') continue;
      const k = ex.n + '|' + Math.round(ex.p.x) + '|' + Math.round(ex.p.z);
      if (seen.has(k)) continue; seen.add(k);
      L.marker(pos(ex.p), { icon: L.divIcon({ className: `mk mk-ex ${ex.f === 'shared' ? 'mk-shared' : ''}`, html: `<span>${esc(ex.n)}</span>`, iconSize: null }) }).addTo(extractLayer);
    }
  }
  const xz = (x, z) => [z, x];
  if (!lootView && panel.querySelector('[data-mp="loot"]').checked) {
    const { items, keys } = neededHere(focusQuest ? [focusQuest] : names);
    if (lp && items.size) {
      let cnt = 0;
      for (const l of lp.loose) {
        if (cnt > 800) break;
        const hit = []; for (let q = 2; q < l.length; q++) if (items.has(l[q])) hit.push(items.get(l[q]));
        if (!hit.length) continue;
        cnt++;
        L.marker(xz(l[0], l[1]), { icon: L.divIcon({ className: 'mk mk-loot', html: '<span></span>', iconSize: [12, 12] }) }).bindPopup(`<b>Possible spawn</b><br>${hit.map(esc).join('<br>')}`).addTo(lootLayer);
      }
    }
    for (const m of mp) for (const k of m.locks) {
      if (!keys.has(k.k)) continue;
      L.marker(pos(k.p), { icon: L.divIcon({ className: 'mk mk-lock', html: `<span>${icon('lock')}</span>`, iconSize: [20, 20] }) }).bindPopup(`<b>Door for</b><br>${esc(keys.get(k.k))}`).addTo(lootLayer);
    }
  }
  // loot view: highlighted item (loose spots + containers that can hold it) or one container type
  if (lootView && lp && (hl.item != null || hl.cont)) {
    const ld = lootData();
    const hpts = [];
    if (hl.item != null) {
      const it = ld.items[hl.item];
      for (const l of lp.loose) {
        let has = false; for (let q = 2; q < l.length; q++) if (l[q] === hl.item) { has = true; break; }
        if (!has) continue;
        const n = l.length - 2;
        L.marker(xz(l[0], l[1]), { icon: L.divIcon({ className: 'mk mk-loot mk-hl', html: '<span></span>', iconSize: [14, 14] }), zIndexOffset: 500 })
          .bindPopup(`<b>${esc(it.n)}</b><br>Loose spawn spot${n > 1 ? ` <span class="small">(one of ${n} possible items here)</span>` : ''}`).addTo(lootLayer);
        hpts.push(xz(l[0], l[1]));
      }
      for (const c of lp.cont) {
        if (!containerCanHold(c[0], hl.item)) continue;
        const cn = ld.containers[c[0]].n;
        L.circleMarker(xz(c[1], c[2]), { radius: 4, color: '#1d1f22', weight: 1, fillColor: '#7fb3d5', fillOpacity: 0.9 }).bindPopup(`<b>${esc(cn)}</b><br><span class="small">can contain ${esc(it.n)}</span>`).addTo(lootLayer);
        hpts.push(xz(c[1], c[2]));
      }
    } else {
      for (const c of lp.cont) {
        if (ld.containers[c[0]].n !== hl.cont) continue;
        L.circleMarker(xz(c[1], c[2]), { radius: 5, color: '#1d1f22', weight: 1, fillColor: '#f2c14e', fillOpacity: 0.95 }).bindPopup(`<b>${esc(hl.cont)}</b>`).addTo(lootLayer);
        hpts.push(xz(c[1], c[2]));
      }
    }
    if (hl.fit && hpts.length) { hl.fit = false; leafletMap.fitBounds(L.latLngBounds(hpts).pad(0.15), { maxZoom: (cfg.maxZoom || 5) - 1 }); }
  }
  if (fit && focusQuest && pts.length) leafletMap.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: (cfg.maxZoom || 5) - 1 });
}
