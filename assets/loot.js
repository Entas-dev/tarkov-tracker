// Loot index per map: loose-loot spawn points & container positions (tarkov.dev export, refreshed daily)
// + what each container can hold (wiki loot tables). Used by the map panel, item info and the Speedrun plan.
import { store } from './store.js';
import { D, P, shoppingList, questStatus, hLevel, isDone, levelReqStatus } from './model.js';

// Heuristic weights for "expected finds per raid": a loose spot spawns something only sometimes and picks one
// of its candidates; a container rolls a few items from its loot table. Only used for ranking, never shown as odds.
const LOOSE_W = 0.3, CONT_W = 1.5;
// tarkov.dev variants that duplicate a main map – left out of "best map" rankings
const VARIANTS = new Set(['ground-zero-21', 'ground-zero-tutorial', 'night-factory', 'the-lab-dark', 'terminal']);
const NAMES = { 'streets-of-tarkov': 'Streets of Tarkov', 'ground-zero': 'Ground Zero', 'ground-zero-21': 'Ground Zero 21+', 'the-lab': 'The Lab', 'the-labyrinth': 'The Labyrinth', 'night-factory': 'Night Factory', 'the-lab-dark': 'The Lab (dark)' };
export const mapDisplayName = (k) => NAMES[k] || String(k).replace(/(^|-)([a-z])/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase());
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

let LD = null, loadedGm = null, pending = null, pendingGm = null, state = 'idle';
export const lootState = () => state;
export const lootData = () => (LD && loadedGm === store.profile.gameMode ? LD : null);

export function ensureLoot() {
  const gm = store.profile.gameMode;
  if (LD && loadedGm === gm) return Promise.resolve(LD);
  if (pending && pendingGm === gm) return pending;
  state = 'loading'; pendingGm = gm;
  pending = fetch(`data/loot-${gm}.json`, { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => { LD = build(j); loadedGm = gm; state = 'ok'; pending = null; store.notify?.('loot'); return LD; })
    .catch(e => { console.warn('loot data unavailable', e); state = 'missing'; pending = null; store.notify?.('loot'); return null; });
  return pending;
}

function build(j) {
  const items = j.items.map((a, i) => ({ i, id: a[0], n: a[1], s: a[2], cat: j.cats[a[3]] || '', p: a[4], sz: a[5], alt: a[6] || null }));
  const byId = new Map(items.map(x => [x.id, x.i]));
  const byName = new Map();
  for (const x of items) { byName.set(norm(x.n), x.i); if (x.alt && !byName.has(norm(x.alt))) byName.set(norm(x.alt), x.i); }
  const tables = j.tables.map(t => new Set(t));
  const containers = j.containers.map((c, i) => ({ i, id: c[0], n: c[1], wiki: c[2], t: c[3] }));
  // item → container indices whose loot table lists it
  const itemConts = new Map();
  for (const c of containers) if (c.t >= 0) for (const it of tables[c.t]) { const a = itemConts.get(it) || []; a.push(c.i); itemConts.set(it, a); }
  const maps = {};
  for (const [k, m] of Object.entries(j.maps)) maps[k] = { key: k, loose: m.loose, cont: m.cont, _ix: null };
  return { raw: j, fetchedAt: j.fetchedAt, items, byId, byName, tables, containers, itemConts, maps };
}

// per map: loose spot counts/expectation per item, container counts per type
function mapIndex(k) {
  const m = LD?.maps[k];
  if (!m) return null;
  if (m._ix) return m._ix;
  const looseN = new Map(), looseE = new Map(), contN = new Map();
  for (const pt of m.loose) {
    const n = pt.length - 2;
    for (let q = 2; q < pt.length; q++) { const it = pt[q]; looseN.set(it, (looseN.get(it) || 0) + 1); looseE.set(it, (looseE.get(it) || 0) + 1 / n); }
  }
  for (const c of m.cont) contN.set(c[0], (contN.get(c[0]) || 0) + 1);
  // expected finds from containers per item
  const contE = new Map();
  for (const [ci, cnt] of contN) {
    const c = LD.containers[ci];
    if (c.t < 0) continue;
    const t = LD.tables[c.t];
    const w = (cnt * CONT_W) / Math.max(1, t.size);
    for (const it of t) contE.set(it, (contE.get(it) || 0) + w);
  }
  m._ix = { looseN, looseE, contN, contE };
  return m._ix;
}

export const lootMapKeys = () => (LD ? Object.keys(LD.maps) : []);
export function keyForMap(name) {
  if (!LD || !name) return null;
  const k = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (LD.maps[k]) return k;
  if (LD.maps['the-' + k]) return 'the-' + k;
  const n = norm(name);
  return Object.keys(LD.maps).find(x => norm(x) === n || norm(mapDisplayName(x)) === n) || null;
}
export function itemIndex(name) {
  if (!LD || !name) return -1;
  const I = D?.items?.[name];
  if (I?.node && LD.byId.has(I.node)) return LD.byId.get(I.node);
  const x = LD.byName.get(norm(name));
  return x == null ? -1 : x;
}
export const lootItem = (i) => LD?.items[i] || null;
// display name: the wiki item name when the dataset knows it
export const itemDisplayName = (x) => x.n;
export const itemImg = (x) => D?.items?.[x.n]?.img || `https://assets.tarkov.dev/${x.id}-icon.webp`;

// score (expected finds per raid, heuristic) + the facts behind it
export function findability(k, i) {
  const ix = mapIndex(k);
  if (!ix || i < 0) return null;
  const loose = ix.looseN.get(i) || 0;
  const conts = [];
  for (const ci of LD.itemConts.get(i) || []) { const n = ix.contN.get(ci); if (n) conts.push({ c: LD.containers[ci], n }); }
  // merge container variants with the same name (e.g. three jacket ids)
  const merged = {};
  for (const x of conts) { const m = merged[x.c.n] || (merged[x.c.n] = { name: x.c.n, wiki: x.c.wiki, n: 0, ids: [] }); m.n += x.n; m.ids.push(x.c.i); }
  const cl = Object.values(merged).sort((a, b) => b.n - a.n);
  const score = (ix.looseE.get(i) || 0) * LOOSE_W + (ix.contE.get(i) || 0);
  return { score, loose, conts: cl };
}

const bestCache = new Map();
export function bestMaps(i) {
  if (!LD || i < 0) return [];
  if (bestCache.has(i) && bestCache.get(i).ld === LD) return bestCache.get(i).v;
  const v = Object.keys(LD.maps).filter(k => !VARIANTS.has(k)).map(k => ({ key: k, ...findability(k, i) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  bestCache.set(i, { ld: LD, v });
  return v;
}

export function whereText(f) {
  if (!f) return '';
  const parts = [];
  if (f.loose) parts.push(`${f.loose} loose spot${f.loose > 1 ? 's' : ''}`);
  for (const c of f.conts.slice(0, 3)) parts.push(`${c.name} ×${c.n}`);
  if (f.conts.length > 3) parts.push(`+${f.conts.length - 3} container types`);
  return parts.join(' · ');
}

// ---------- needed items with a priority ----------
// prio 3: a quest that is available now (or in the plan) needs it · 2: next hideout level you can build / story · 1: later
export function neededLoot(p = P(), soonQuests = null) {
  if (!LD) return [];
  const list = shoppingList({ scope: 'all' }, p);
  const out = [];
  for (const a of list) {
    const li = itemIndex(a.item);
    if (li < 0) continue;
    let prio = 1, soonN = 0;
    const why = [];
    for (const s of a.sources) {
      let soon = false;
      if (s.type === 'quest') {
        const q = D.quests[s.name];
        soon = !!(soonQuests?.has(s.name) || (q && !isDone(s.name, p) && questStatus(q, p).s === 'available'));
        if (soon) prio = Math.max(prio, 3);
      } else if (s.type === 'chapter') { soon = true; prio = Math.max(prio, 2); }
      else if (s.type === 'hideout') { soon = s.level === hLevel(s.name, p) + 1 && levelReqStatus(s.name, s.level, p).ok; if (soon) prio = Math.max(prio, 2); }
      if (soon) soonN += Math.max(0, s.count - (s.have || 0));
      why.push({ ...s, soon });
    }
    why.sort((x, y) => y.soon - x.soon);
    const missing = a.need - a.have;
    out.push({ item: a.item, li, need: a.need, have: a.have, missing, soonMissing: Math.min(missing, soonN), fir: a.fir, prio, sources: why });
  }
  return out;
}

// needed items worth grabbing on this map: good odds compared with the other maps
export function lootForMap(mapName, needs) {
  const k = keyForMap(mapName);
  if (!k) return [];
  const out = [];
  for (const n of needs) {
    const f = findability(k, n.li);
    if (!f || f.score <= 0) continue;
    const best = bestMaps(n.li);
    const top = best[0]?.score || f.score;
    const rel = f.score / top;
    const rank = best.findIndex(b => b.key === k);
    // keep it to maps that are among the best for this item (top 3 or at least 60 % of the best odds)
    if (rank > 2 && rel < 0.6 && !(f.loose && n.prio === 3)) continue;
    out.push({ ...n, f, rel, best: rank === 0, rank });
  }
  return out.sort((a, b) => b.prio - a.prio || b.rel - a.rel || b.missing - a.missing);
}

// ---------- full loot list of one map (map panel) ----------
export function mapLoot(k) {
  const ix = mapIndex(k);
  if (!ix) return null;
  const m = LD.maps[k];
  const ids = new Set([...ix.looseN.keys(), ...ix.contE.keys()]);
  const items = [...ids].map(i => ({ i, x: LD.items[i], loose: ix.looseN.get(i) || 0, score: (ix.looseE.get(i) || 0) * LOOSE_W + (ix.contE.get(i) || 0) }));
  const merged = {};
  for (const [ci, n] of ix.contN) {
    const c = LD.containers[ci];
    const e = merged[c.n] || (merged[c.n] = { name: c.n, wiki: c.wiki, n: 0, ids: [], size: c.t >= 0 ? LD.tables[c.t].size : 0 });
    e.n += n; e.ids.push(ci);
  }
  return { items, conts: Object.values(merged).sort((a, b) => b.n - a.n), looseSpots: m.loose.length, contCount: m.cont.length };
}
export const containerCanHold = (ci, i) => { const c = LD?.containers[ci]; return !!c && c.t >= 0 && LD.tables[c.t].has(i); };
export const lootPoints = (k) => LD?.maps[k] || null;
export function itemContainers(i) {
  if (!LD || i < 0) return [];
  const seen = new Map();
  for (const ci of LD.itemConts.get(i) || []) { const c = LD.containers[ci]; if (!seen.has(c.n)) seen.set(c.n, { name: c.n, wiki: c.wiki, size: LD.tables[c.t].size }); }
  return [...seen.values()].sort((a, b) => a.size - b.size);
}
