// Collapsible map panel (top right): map selection, active quests on that map, objective + quest item markers.
// Map images & marker coordinates: tarkov.dev (maps by the tarkov.dev community). Quest logic: wiki data.
import { store } from './store.js';
import { D, IX, P, visible, questStatus, isDone, objDone } from './model.js';
import { esc, attr, icon, img, itemChip, traderImg } from './ui.js';
import { idbGet, idbSet } from './data.js';
import { fetchTarkovDev } from '../builder/tarkovdev.js';

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';

let panel, mapEl, listEl, leafletMap, L, mapCfgs = null, curKey = null, markerLayer = null, extractLayer = null, focusQuest = null;
let tdev = null; // {tasks, maps, fetchedAt, gameMode}
let tdevState = 'idle';

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
        <span class="mp-status small muted"></span>
        <button class="ibtn" data-mp="size" aria-label="Enlarge">${icon('expand')}</button>
        <button class="ibtn" data-mp="toggle" aria-label="Collapse">${icon('x')}</button>
      </div>
      <div class="mp-body">
        <div class="mp-map" role="application" aria-label="Interactive map"></div>
        <div class="mp-list"></div>
      </div>
      <div class="mp-foot small muted">Map images &amp; marker positions: <a href="https://tarkov.dev/maps" target="_blank" rel="noopener">tarkov.dev</a> · Quests: EFT wiki</div>
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
  });
  panel.querySelector('.mp-select').addEventListener('change', (e) => showMap(e.target.value));
  panel.querySelector('[data-mp="extracts"]').addEventListener('change', () => drawMarkers());
  store.on((reason) => {
    if (reason === 'profile' && initP && tdev?.gameMode !== store.profile.gameMode) { tdev = null; loadTarkovDev(); }
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
    loadTarkovDev();
  })();
  return initP;
}

const NAMES = { 'streets-of-tarkov': 'Streets of Tarkov', 'ground-zero': 'Ground Zero', 'the-lab': 'The Lab', 'the-labyrinth': 'The Labyrinth' };
const displayName = (k) => NAMES[k] || k.replace(/(^|-)([a-z])/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase());
const wikiNameFor = (k) => { const d = displayName(k); return IX.maps.find(m => norm(m) === norm(d)) || d; };

// ---------- tarkov.dev positions ----------
async function loadTarkovDev() {
  const gm = store.profile.gameMode;
  const key = 'tdev-' + gm;
  const cached = await idbGet(key);
  if (cached) { tdev = cached; tdevState = 'cached'; }
  setStatus();
  if (cached && Date.now() - cached.fetchedAt < 6 * 3600e3) return;
  tdevState = tdev ? 'refreshing' : 'loading'; setStatus();
  try {
    tdev = await fetchTarkovDev(gm);
    idbSet(key, tdev);
    tdevState = 'live';
  } catch (e) {
    // fall back to snapshot shipped with the site (written by the daily GitHub Action)
    try {
      const snap = await fetch(`data/tarkovdev-${gm}.json`, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null));
      if (snap?.tasks) { tdev = snap; tdevState = 'snapshot'; } else if (!tdev) tdevState = 'down';
    } catch { if (!tdev) tdevState = 'down'; }
    console.warn('tarkov.dev unavailable:', e.message);
  }
  setStatus();
  drawMarkers();
}
function setStatus() {
  const s = panel.querySelector('.mp-status');
  const txt = { idle: '', loading: 'Loading markers…', refreshing: '', cached: '', live: '', snapshot: 'Markers from snapshot', down: 'Marker data unavailable (tarkov.dev down) – map & quest list still work' }[tdevState] || '';
  s.textContent = txt;
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
  setTimeout(() => { leafletMap?.invalidateSize(); if (!focusQuest) leafletMap?.fitBounds(b); }, 80);
  markerLayer = L.layerGroup().addTo(leafletMap);
  extractLayer = L.layerGroup().addTo(leafletMap);
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

function renderList() {
  if (!curKey) return;
  const p = P();
  const names = activeQuestsHere();
  const wn = wikiNameFor(curKey);
  listEl.innerHTML = `<div class="mp-lh"><b>${esc(displayName(curKey))}</b> · ${names.length} active quests</div>` + (names.map(n => {
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

function tdevTask(name) {
  if (!tdev) return null;
  const k = norm(name);
  return tdev.tasks.find(t => norm(t.name) === k) || null;
}
function hasMarkers(name) {
  const t = tdevTask(name);
  if (!t) return false;
  const cfg = mapCfgs.find(m => m.key === curKey);
  return t.objectives.some(o => (o.zones || []).some(z => z.map?.normalizedName === cfg.normalizedName) || (o.possibleLocations || []).some(l => l.map?.normalizedName === cfg.normalizedName));
}

function drawMarkers(fit = false) {
  if (!leafletMap || !markerLayer) return;
  markerLayer.clearLayers(); extractLayer.clearLayers();
  const cfg = mapCfgs.find(m => m.key === curKey);
  const p = P();
  const names = activeQuestsHere();
  const pts = [];
  if (tdev) {
    for (const n of names) {
      const t = tdevTask(n);
      if (!t) continue;
      const foc = focusQuest === n;
      for (const o of t.objectives) {
        for (const z of o.zones || []) {
          if (z.map?.normalizedName !== cfg.normalizedName || !z.position) continue;
          if (z.outline?.length > 2) L.polygon(z.outline.map(pos), { color: foc ? '#f2c14e' : '#c9a227', weight: foc ? 2 : 1, fillOpacity: foc ? 0.25 : 0.1, interactive: false }).addTo(markerLayer);
          const m = L.marker(pos(z.position), { icon: L.divIcon({ className: `mk mk-obj ${foc ? 'mk-focus' : ''}`, html: '<span></span>', iconSize: [18, 18] }) });
          m.bindPopup(`<b>${esc(n)}</b><br>${esc(o.description)}`);
          m.addTo(markerLayer); if (foc || !focusQuest) pts.push(pos(z.position));
        }
        for (const loc of o.possibleLocations || []) {
          if (loc.map?.normalizedName !== cfg.normalizedName) continue;
          for (const ps of loc.positions || []) {
            const m = L.marker(pos(ps), { icon: L.divIcon({ className: `mk mk-item ${foc ? 'mk-focus' : ''}`, html: o.questItem?.iconLink ? `<img src="${attr(o.questItem.iconLink)}" alt="">` : '<span></span>', iconSize: [26, 26] }) });
            m.bindPopup(`<b>${esc(n)}</b><br>${esc(o.questItem?.name || o.description)}`);
            m.addTo(markerLayer); if (foc || !focusQuest) pts.push(pos(ps));
          }
        }
      }
    }
    if (panel.querySelector('[data-mp="extracts"]').checked) {
      const mp = tdev.maps?.find(m => m.normalizedName === cfg.normalizedName);
      for (const ex of mp?.extracts || []) {
        if (!ex.position || (ex.faction && ex.faction !== 'pmc' && ex.faction !== 'shared')) continue;
        L.marker(pos(ex.position), { icon: L.divIcon({ className: `mk mk-ex ${ex.faction === 'shared' ? 'mk-shared' : ''}`, html: `<span>${esc(ex.name)}</span>`, iconSize: null }) }).addTo(extractLayer);
      }
    }
  }
  if (fit && focusQuest && pts.length) leafletMap.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: (cfg.maxZoom || 5) - 1 });
}
