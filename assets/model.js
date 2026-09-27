// Dataset indexing + progress logic (availability, regressive completion, item needs)
import { store } from './store.js';

// default = unlock order in the Tour story chapter; replaced at runtime by the order parsed from the wiki
export const TRADER_ORDER = ['Therapist', 'Ragman', 'Skier', 'Mechanic', 'Prapor', 'Peacekeeper', 'Jaeger', 'Fence', 'Ref', 'Lightkeeper', 'BTR Driver'];
export const ENDINGS = ['Savior', 'Debtor', 'Survivor', 'Fallen'];

export let D = null;
export const IX = {};

export function setDataset(ds, gameReqs = null) {
  D = ds;
  D.gameReqs = gameReqs || D.gameReqs || null;
  buildIndexes();
}

const rel = (g) => g.filter(a => a.type === 'complete');

function buildIndexes() {
  const Q = D.quests;
  IX.names = Object.keys(Q);
  for (const q of Object.values(Q)) q.pre = (q.prereq || []).map(g => g.filter(a => Q[a.q] && a.q !== q.name)).filter(g => g.length);
  // "leads to" on the wiki implies the reverse prerequisite; several sources for the same quest form one OR-group
  const rev = {};
  for (const a of Object.values(Q)) for (const b of a.leadsTo || []) {
    const B = Q[b];
    if (!B || B === a || B.pre.some(g => g.some(x => x.q === a.name))) continue;
    (rev[b] = rev[b] || []).push({ q: a.name, type: 'complete', fromLeads: true });
  }
  for (const [b, alts] of Object.entries(rev)) Q[b].pre.push(alts);
  // prerequisites from the game files (tarkov.dev export) fill links missing on the wiki pages
  const G = D.gameReqs?.quests || {};
  const V = D.gameReqs?.vars || {};
  const v2 = (D.gameReqs?.v || 1) >= 2;
  IX.vars = {};
  for (const [id, v] of Object.entries(V)) IX.vars[id] = { id, ...v, quests: [] };
  for (const q of Object.values(Q)) {
    const g = G[q.name];
    q.vars = [];
    if (!g) continue;
    if (v2) {
      // since patch 1.1 the game files are the reliable source for level / loyalty requirements –
      // many wiki pages still show the old ones (e.g. "level 30" for Small Things, Big Help)
      if (q.minLevelWiki === undefined) q.minLevelWiki = q.minLevel ?? null;
      q.minLevel = g.lvl || null;
      for (const [id, min] of g.vars || []) { const info = IX.vars[id]; if (!info) continue; q.vars.push({ v: id, min, trader: info.trader, tier: info.tier, group: info.groups.indexOf(min) }); info.quests.push(q.name); }
      if (q.vars.length) { if (q.llWiki === undefined) q.llWiki = q.ll || null; q.ll = { trader: q.vars[0].trader, level: q.vars[0].tier, fromGame: true }; }
      else if (g.ll?.length) { if (q.llWiki === undefined) q.llWiki = q.ll || null; q.ll = { trader: g.ll[0][0], level: g.ll[0][1], fromGame: true }; }
    } else if (!q.minLevel && g.lvl) q.minLevel = g.lvl;
    for (const r of g.req || []) {
      if (!Q[r.q] || r.q === q.name || q.pre.some(gr => gr.some(a => a.q === r.q))) continue;
      const st = r.st || [];
      const type = st.includes('active') ? 'accept' : st.includes('complete') ? 'complete' : st.includes('failed') ? 'fail' : 'complete';
      q.pre.push([{ q: r.q, type, fromGame: true }]);
    }
  }
  // traders unlocked by a quest (Jaeger ← Introduction, Ref ← Easy Money - Part 1, BTR Driver ← accept A Helping Hand)
  for (const [tn, T] of Object.entries(D.traders || {})) {
    const u = T.unlockQuest;
    if (!u || !Q[u.q]) continue;
    for (const q of Object.values(Q)) if (q.trader === tn && q.name !== u.q && !q.pre.some(g => g.some(a => a.q === u.q))) q.pre.push([{ q: u.q, type: u.type, fromTrader: true }]);
  }
  // Collector (Kappa) requires every quest the wiki marks as "required for Kappa"
  if (Q['Collector']) {
    const C = Q['Collector'];
    for (const q of Object.values(Q)) if (q.kappa === 'yes' && q.name !== 'Collector' && !q.event && !q.mode && !C.pre.some(g => g.some(x => x.q === q.name))) C.pre.push([{ q: q.name, type: 'complete', kappa: true }]);
  }
  for (const q of Object.values(Q)) {
    // seasonal variant
    let pre = q.pre.map(g => g.slice());
    for (const s of q.seasonal || []) {
      if (s.removePrereq?.length) pre = pre.map(g => g.filter(a => !s.removePrereq.includes(a.q))).filter(g => g.length);
      if (s.addPrereq?.length) for (const a of s.addPrereq) if (Q[a] && !pre.some(g => g.some(x => x.q === a))) pre.push([{ q: a, type: 'complete' }]);
    }
    q.preSeasonal = pre;
    q.allMaps = [...new Set([...(q.maps || []), ...q.objectives.flatMap(o => o.maps || [])])];
    q.slug = q.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
  // quest series ("Gunsmith - …", "… - Part N"): earlier members by part number, otherwise by unlock level
  const lvlOf = (q) => Math.max(q.minLevel || 0, (q.ll && D.traders[q.ll.trader]?.ll?.find(l => l.level === q.ll.level)?.pmcLevel) || 0);
  const groups = {};
  for (const q of Object.values(Q)) {
    const i = q.name.lastIndexOf(' - ');
    if (i < 0 || q.alts?.length || q.event || q.mode || q.vars?.length) continue; // loyalty-group quests are no chain any more
    let base = q.name.slice(0, i);
    const pm = q.name.match(/^(.*) - Part (\d+)$/i);
    if (pm) base = pm[1];
    (groups[(q.trader || '') + '|' + base] = groups[(q.trader || '') + '|' + base] || []).push(q);
  }
  IX.seriesPrev = {};
  for (const members of Object.values(groups)) {
    if (members.length < 2) continue;
    const part = (q) => { const m = q.name.match(/ - Part (\d+)$/i); return m ? +m[1] : null; };
    const allPart = members.every(q => part(q) != null);
    const ord = (q) => (allPart ? part(q) : lvlOf(q));
    for (const m of members) {
      const o = ord(m);
      if (!o) continue;
      const prev = members.filter(x => x !== m && ord(x) && ord(x) < o).map(x => x.name);
      if (prev.length) IX.seriesPrev[m.name] = prev;
    }
  }
  IX.graph = {};
  for (const mode of ['normal', 'seasonal']) {
    const dep = {};
    for (const q of Object.values(Q)) {
      const pre = mode === 'seasonal' ? q.preSeasonal : q.pre;
      for (const g of pre) for (const a of g) (dep[a.q] = dep[a.q] || new Set()).add(q.name);
    }
    IX.graph[mode] = { dep };
  }
  // traders unlocked through the Tour chapter (Skier, Mechanic, Prapor, Peacekeeper …)
  const tour = D.chapters?.['Tour'];
  IX.tourGates = {};
  (tour?.traderUnlocks || []).forEach((u, i) => { const idx = tour.objectives.findIndex(o => o.id === u.oid); if (idx >= 0) IX.tourGates[u.trader] = { oid: u.oid, idx, step: u.step, stage: i + 1 }; });
  const unlocked = Object.keys(IX.tourGates);
  const tOrder = unlocked.length ? [...TRADER_ORDER.filter(t => !unlocked.includes(t) && TRADER_ORDER.indexOf(t) < TRADER_ORDER.indexOf('Skier')), ...unlocked, ...TRADER_ORDER.filter(t => !unlocked.includes(t) && TRADER_ORDER.indexOf(t) > TRADER_ORDER.indexOf('Skier'))] : TRADER_ORDER;
  IX.traderOrder = tOrder;
  // the very first Tour step (escaping the Ground Zero tutorial) comes before any trader or other map
  IX.startGate = tour?.objectives?.[0] && /ground zero/i.test(tour.objectives[0].text) ? { oid: tour.objectives[0].id, idx: 0, step: tour.objectives[0].text, map: 'Ground Zero' } : null;
  IX.mapGates = {};
  for (const u of tour?.mapUnlocks || []) { const idx = tour.objectives.findIndex(o => o.id === u.oid); if (idx >= 0) IX.mapGates[u.map] = { oid: u.oid, idx, step: u.step }; }
  // Tour objective index a quest waits for (trader unlock and/or access to one of its maps), -1 = none
  const gateIdx = (q) => {
    let g = IX.tourGates[q.trader]?.idx ?? -1;
    const maps = (q.maps || []).filter(Boolean);
    if (maps.length && maps.every(m => IX.mapGates[m])) g = Math.max(g, Math.min(...maps.map(m => IX.mapGates[m].idx)));
    return g;
  };
  IX.gateIdx = (n) => gateIdx(Q[n]);
  // topological order (by normal graph); early quests follow the Tour unlock order of their trader, then level
  const indeg = {}; const out = {};
  for (const q of Object.values(Q)) { indeg[q.name] = 0; out[q.name] = []; }
  for (const q of Object.values(Q)) for (const g of q.pre) for (const a of g) { if (out[a.q]) { out[a.q].push(q.name); indeg[q.name]++; } }
  const effLevel = (q) => Math.max(q.minLevel || 0, (q.ll && D.traders[q.ll.trader]?.ll?.find(l => l.level === q.ll.level)?.pmcLevel) || 0);
  IX.effLevel = (n) => effLevel(Q[n]);
  const karmaLvl = (q) => (q.trader === 'Fence' && !effLevel(q) ? 10 : 0); // Fence quests depend on Scav karma, not on level
  const vgrp = (q) => (q.vars?.length ? q.vars[0].tier * 10 + q.vars[0].group : 0);
  const key = (n) => { const q = Q[n]; const ti = tOrder.indexOf(q.trader); const g = gateIdx(q); return [Math.max(effLevel(q), g >= 0 ? 1 + g / 3 : 0, karmaLvl(q)), g, effLevel(q), vgrp(q), ti < 0 ? 99 : ti, n]; };
  const cmp = (a, b) => { const A = key(a), B = key(b); for (let i = 0; i < A.length; i++) { if (A[i] < B[i]) return -1; if (A[i] > B[i]) return 1; } return 0; };
  let ready = Object.keys(indeg).filter(n => indeg[n] === 0).sort(cmp);
  const order = [];
  const depth = {};
  while (ready.length) {
    const n = ready.shift(); order.push(n);
    for (const m of out[n]) { depth[m] = Math.max(depth[m] || 0, (depth[n] || 0) + 1); if (--indeg[m] === 0) { ready.push(m); ready.sort(cmp); } }
  }
  for (const n of Object.keys(indeg)) if (!order.includes(n)) order.push(n); // cycles
  IX.order = order; IX.rank = Object.fromEntries(order.map((n, i) => [n, i])); IX.depth = depth;

  // kappa set
  const kap = new Set();
  const addReq = (n) => { if (kap.has(n) || !Q[n]) return; kap.add(n); for (const g of Q[n].pre) { const c = rel(g); if (c.length === 1 && g.length === 1) addReq(c[0].q); } };
  for (const q of Object.values(Q)) if (q.kappa === 'yes') addReq(q.name);
  if (Q['Collector']) addReq('Collector');
  IX.kappa = kap;
  IX.kappaSub = new Set(Object.values(Q).filter(q => q.kappa === 'sub').map(q => q.name));

  // traders
  const traders = new Set(Object.values(Q).map(q => q.trader).filter(Boolean));
  IX.traders = [...tOrder.filter(t => traders.has(t) || D.traders[t]), ...[...traders].filter(t => !tOrder.includes(t)).sort()];
  IX.byTrader = {};
  for (const n of order) { const t = Q[n].trader || 'Other'; (IX.byTrader[t] = IX.byTrader[t] || []).push(n); }

  // maps
  IX.maps = [...new Set(Object.values(Q).flatMap(q => q.allMaps))].sort();

  // item usage
  IX.itemUse = {};
  const use = (item, u) => { (IX.itemUse[item] = IX.itemUse[item] || []).push(u); };
  for (const q of Object.values(Q)) for (const n of q.needs || []) use(n.item, { type: 'quest', name: q.name, count: n.count, fir: n.fir, optional: n.optional });
  for (const m of D.hideout.modules) for (const L of m.levels) for (const i of L.items) use(i.item, { type: 'hideout', name: m.name, level: L.level, count: i.count, fir: i.fir });
  for (const c of Object.values(D.chapters)) for (const n of c.needs || []) use(n.item, { type: 'chapter', name: c.name, count: n.count, fir: n.fir, optional: n.optional });

  // hideout
  IX.modules = Object.fromEntries(D.hideout.modules.map(m => [m.name, m]));

  // chapters order
  const CH = D.chapters;
  const chNames = Object.keys(CH);
  const chDeps = {};
  for (const c of Object.values(CH)) {
    const deps = new Set(c.prereq.flat().map(a => a.q).filter(n => CH[n]));
    for (const h of c.reqHtml) for (const m of h.matchAll(/data-t="([^"]+)"/g)) if (CH[m[1]] && m[1] !== c.name) deps.add(m[1]);
    chDeps[c.name] = deps;
  }
  for (const c of Object.values(CH)) for (const l of c.leadsTo) if (CH[l]) chDeps[l].add(c.name);
  if (CH['Tour']) for (const n of chNames) if (n !== 'Tour') chDeps[n].add('Tour');
  const chDepth = {};
  const dd = (n, seen = new Set()) => { if (chDepth[n] != null) return chDepth[n]; if (seen.has(n)) return 0; seen.add(n); let d = 0; for (const p of chDeps[n]) d = Math.max(d, dd(p, seen) + 1); return (chDepth[n] = d); };
  chNames.forEach(n => dd(n));
  IX.chDeps = chDeps;
  IX.chapterOrder = chNames.sort((a, b) => (a === 'The Ticket') - (b === 'The Ticket') || (a === 'Tour' ? -1 : b === 'Tour' ? 1 : 0) || chDepth[a] - chDepth[b] || a.localeCompare(b));
}

// ---------- profile helpers ----------
export const P = () => store.p;
export const mode = () => (store.active === 'seasonal' ? 'seasonal' : 'normal');
export const isSeasonal = () => store.active === 'seasonal';
export const isPvE = () => store.active === 'pve';
export const preOf = (q) => (mode() === 'seasonal' ? q.preSeasonal : q.pre);

export function visible(q, p = P()) {
  if (!q) return false;
  if (q.mode === 'seasonal' && store.active !== 'seasonal') return false;
  if (q.mode === 'pve' && store.active !== 'pve') return false;
  if (store.active === 'seasonal' && q.seasonal?.some(s => /cannot be obtained|not available/i.test(s.text || ''))) return false;
  if (q.faction && p.settings.faction && q.faction !== p.settings.faction) return false;
  if (q.edition === 'EOD' && !p.settings.eod) return false;
  if (q.edition === 'Unheard' && !p.settings.unheard) return false;
  return true;
}

export const isDone = (name, p = P()) => !!p.quests[name];

export function traderLL(trader, p = P()) {
  const manual = p.settings.ll?.[trader];
  if (manual != null && manual !== '') return +manual;
  const t = D.traders[trader];
  if (!t || !t.ll?.length) return 4;
  let ll = 1;
  for (const r of t.ll) if ((r.pmcLevel || 0) <= p.settings.level) ll = Math.max(ll, r.level);
  return ll;
}

// Loyalty-group counter (patch 1.1): side tasks of a trader LL unlock in groups. The game raises a hidden counter
// per trader LL; we estimate it from what you did: the first group opens when you reach the LL, every finished
// task of that LL counts one up, reaching the next LL opens the next group – and quests you have open or finished
// prove the counter reached their threshold.
export function varValue(id, p = P()) {
  const info = IX.vars?.[id];
  if (!info) return Infinity;
  let ev = 0, done = 0;
  for (const n of info.quests) {
    const x = D.quests[n].vars.find(v => v.v === id);
    if (isDone(n, p)) { done++; ev = Math.max(ev, x.min); } else if (p.active?.[n]) ev = Math.max(ev, x.min);
  }
  const ll = traderLL(info.trader, p);
  if (ll < info.tier) return ev;
  const gs = info.groups;
  let est = gs[0] + done;
  if (ll > info.tier) { const idx = gs.filter(t => t <= est).length - 1; est = Math.max(est, gs[Math.min(gs.length - 1, Math.max(0, idx) + (ll - info.tier))]); }
  return Math.max(ev, est);
}
export function varNeed(x, p = P()) { return Math.max(0, x.min - varValue(x.v, p)); }

export function groupSatisfied(g, p = P()) {
  return g.some(a => {
    const q = D.quests[a.q];
    if (!q) return true;
    if (!visible(q, p)) return true; // not applicable to this profile
    if (a.type === 'complete' || a.type === 'fail') return isDone(a.q, p);
    if (a.type === 'accept') return isDone(a.q, p) || prereqsMet(q, p);
    return isDone(a.q, p);
  });
}
export const prereqsMet = (q, p = P()) => preOf(q).every(g => groupSatisfied(g, p));

export function questStatus(q, p = P()) {
  if (isDone(q.name, p)) return { s: 'done', reasons: [] };
  if (p.active?.[q.name]) return { s: 'available', reasons: [], active: true }; // you told us it is open in your game
  if (q.alts?.length && q.alts.some(a => isDone(a, p))) return { s: 'blocked', reasons: [{ k: 'alt', v: q.alts.filter(a => isDone(a, p)) }] };
  const reasons = [];
  for (const g of preOf(q)) if (!groupSatisfied(g, p)) reasons.push({ k: 'pre', g });
  if (q.minLevel && p.settings.level < q.minLevel) reasons.push({ k: 'level', v: q.minLevel });
  if (q.ll && q.ll.trader && traderLL(q.ll.trader, p) < q.ll.level) reasons.push({ k: 'll', v: q.ll });
  for (const x of q.vars || []) if (varValue(x.v, p) < x.min) reasons.push({ k: 'var', x });
  if (!startDone(p)) reasons.push({ k: 'start', step: IX.startGate.step });
  else if (!traderUnlocked(q.trader, p)) reasons.push({ k: 'tour', trader: q.trader, step: IX.tourGates[q.trader].step });
  if (!questMapsUnlocked(q, p)) reasons.push({ k: 'map', maps: q.maps });
  return { s: reasons.length ? 'locked' : 'available', reasons };
}

// ---------- regressive completion ----------
export function prerequisiteClosure(name, p = P()) {
  const out = new Set();
  const series = p.settings.seriesLogic !== false;
  const walk = (n) => {
    const q = D.quests[n];
    if (!q) return;
    if (series) for (const m of IX.seriesPrev?.[n] || []) if (!out.has(m) && m !== name && visible(D.quests[m], p)) { out.add(m); walk(m); }
    for (const g of preOf(q)) {
      const vis = g.filter(a => visible(D.quests[a.q], p));
      const comp = vis.filter(a => a.type === 'complete');
      if (!comp.length) {
        // "accept X" prerequisite: X itself need not be finished, but X's own prerequisites must be
        if (vis.length === 1 && vis[0].type === 'accept') walk(vis[0].q);
        continue;
      }
      if (comp.length === 1 && vis.length === 1) { const m = comp[0].q; if (!out.has(m)) { out.add(m); walk(m); } }
      else if (comp.some(a => isDone(a.q, p) || out.has(a.q))) { /* already satisfied */ }
    }
  };
  walk(name);
  return out;
}

export function traderUnlocked(trader, p = P()) {
  const g = IX.tourGates?.[trader];
  if (!g) return true;
  return !!p.ch['Tour'] || !!p.chObj[`Tour|${g.oid}`];
}
export function startDone(p = P()) {
  const g = IX.startGate;
  return !g || !!p.ch['Tour'] || !!p.chObj[`Tour|${g.oid}`];
}
export function mapUnlocked(map, p = P()) {
  if (!startDone(p) && map !== IX.startGate?.map) return false;
  const g = IX.mapGates?.[map];
  if (!g) return true;
  return !!p.ch['Tour'] || !!p.chObj[`Tour|${g.oid}`];
}
// a quest on several maps is possible as soon as one of them is accessible
export function questMapsUnlocked(q, p = P()) {
  const maps = (q.maps || []).filter(Boolean);
  if (!maps.length) return true;
  return maps.some(m => mapUnlocked(m, p));
}
// Tour objectives that must be done to have unlocked the traders / maps of these quests
export function tourStepsFor(names, p = P()) {
  const tour = D.chapters?.['Tour'];
  if (!tour || p.ch['Tour']) return [];
  let max = !startDone(p) && names.length ? 0 : -1;
  for (const n of names) {
    const q = D.quests[n];
    if (!q) continue;
    const g = IX.tourGates?.[q.trader];
    if (g && !traderUnlocked(q.trader, p)) max = Math.max(max, g.idx);
    if (!questMapsUnlocked(q, p)) { const idxs = q.maps.map(m => IX.mapGates[m]?.idx).filter(i => i != null); if (idxs.length) max = Math.max(max, Math.min(...idxs)); }
  }
  if (max < 0) return [];
  return tour.objectives.slice(0, max + 1).filter(o => !o.optional && !p.chObj[`Tour|${o.id}`]).map(o => o.id);
}

// "These quests are open in my game" → everything they depend on is done.
// strict: the in-game task list (Show completed off) shows EVERY unfinished quest of a trader, so for the traders
// you entered anything the tracker considers available but you did not tick must be finished – repeated until
// nothing changes (finishing one can make its follow-ups available). Level and loyalty gates stop the cascade.
export function applyActiveQuests(mode = 'merge') {
  const info = { level: null, strict: 0 };
  store.update(p => {
    if (mode === 'replace' || mode === 'strict') { p.quests = {}; }
    const act = Object.keys(p.active || {}).filter(n => D.quests[n]);
    for (const n of act) delete p.quests[n];
    // an open quest proves you reached its level requirement
    const minLv = Math.max(0, ...act.map(n => D.quests[n].minLevel || 0));
    if (minLv > (p.settings.level || 1)) { p.settings.level = minLv; info.level = minLv; }
    // …and the trader loyalty level it needs
    info.ll = [];
    for (const n of act) { const L = D.quests[n].ll; if (L?.trader && traderLL(L.trader, p) < L.level) { p.settings.ll = { ...(p.settings.ll || {}), [L.trader]: L.level }; info.ll.push(`${L.trader} LL${L.level}`); } }
    const all = new Set();
    for (const n of act) for (const m of prerequisiteClosure(n, p)) if (!p.active[m]) all.add(m);
    for (const m of all) p.quests[m] = 1;
    for (const id of tourStepsFor([...act, ...all], p)) p.chObj[`Tour|${id}`] = 1;
    if (mode === 'strict') {
      const traders = new Set(act.map(n => D.quests[n].trader));
      // loyalty groups you have open quests in: groups above the highest open one are locked, not finished
      const cap = {};
      for (const n of act) for (const x of D.quests[n].vars || []) cap[x.v] = Math.max(cap[x.v] || 0, x.min);
      for (let pass = 0; pass < 30; pass++) {
        let changed = 0;
        for (const n of IX.order) {
          const q = D.quests[n];
          if (p.quests[n] || p.active[n] || !traders.has(q.trader) || !visible(q, p)) continue;
          if ((q.vars || []).some(x => cap[x.v] != null && x.min > cap[x.v])) continue;
          if (questStatus(q, p).s !== 'available') continue;
          p.quests[n] = 1; changed++; info.strict++;
        }
        if (!changed) break;
      }
    }
  }, 'progress');
  return info;
}

export function completeQuest(name) {
  const add = prerequisiteClosure(name);
  const tourIds = tourStepsFor([name, ...add]);
  store.update(p => { p.quests[name] = 1; for (const n of add) p.quests[n] = 1; for (const id of tourIds) p.chObj[`Tour|${id}`] = 1; if (p.active) { delete p.active[name]; for (const n of add) delete p.active[n]; } });
  return add.size;
}

// dependents that would become invalid if `names` are un-done
export function doneDependents(name, p = P()) {
  const removed = new Set([name]);
  const dep = IX.graph[mode()].dep;
  const queue = [name];
  const out = [];
  while (queue.length) {
    const n = queue.shift();
    for (const d of dep[n] || []) {
      if (removed.has(d) || !isDone(d, p)) continue;
      const q = D.quests[d];
      const broken = preOf(q).some(g => g.some(a => a.q === n) && !g.some(a => a.type === 'complete' && !removed.has(a.q) && isDone(a.q, p)) && g.every(a => a.type !== 'accept'));
      if (broken) { removed.add(d); out.push(d); queue.push(d); }
    }
  }
  return out.sort((a, b) => IX.rank[a] - IX.rank[b]);
}

export function uncompleteQuests(names) {
  store.update(p => {
    for (const n of names) {
      delete p.quests[n];
    }
  });
}

// objectives
export const objKey = (q, o) => `${q}|${o}`;
export function objDone(qname, oid, p = P()) { return isDone(qname, p) || !!p.obj[objKey(qname, oid)]; }
export function questObjProgress(q, p = P()) {
  const req = q.objectives.filter(o => !o.optional && (o.depth || 1) === 1);
  const done = req.filter(o => objDone(q.name, o.id, p)).length;
  return { done, total: req.length };
}

// item counters
export const cntKey = (q, item) => `${q}|${item}`;
export function haveCount(qname, item, p = P()) { return p.cnt[cntKey(qname, item)] || 0; }

export function questNeeds(q, p = P(), { includeOptional = false } = {}) {
  return (q.needs || []).filter(n => includeOptional || !n.optional).map(n => {
    const have = isDone(q.name, p) ? n.count : Math.min(n.count, haveCount(q.name, n.item, p));
    return { ...n, have, missing: Math.max(0, n.count - have) };
  });
}

// ---------- hideout ----------
export const hLevel = (mod, p = P()) => p.hideout[mod] || 0;
export function moduleMax(mod) { return IX.modules[mod]?.levels.length || 0; }
export function levelReqStatus(mod, level, p = P()) {
  const L = IX.modules[mod]?.levels.find(l => l.level === level);
  if (!L) return { ok: false, missing: [] };
  const missing = [];
  for (const r of L.modules) if (hLevel(r.name, p) < r.level) missing.push({ k: 'module', ...r });
  for (const r of L.traders) if (traderLL(r.name, p) < r.level) missing.push({ k: 'trader', ...r });
  return { ok: !missing.length, missing, L };
}
export function hideoutClosure(mod, level) {
  // returns {module: requiredLevel} to set for building mod up to level
  const want = {};
  const walk = (m, lv) => {
    if ((want[m] || 0) >= lv) return;
    want[m] = lv;
    for (const L of IX.modules[m]?.levels || []) if (L.level <= lv) for (const r of L.modules) walk(r.name, r.level);
  };
  walk(mod, level);
  return want;
}
export function setModuleLevel(mod, level) {
  const want = hideoutClosure(mod, level);
  store.update(p => { for (const [m, lv] of Object.entries(want)) if (m === mod) p.hideout[m] = lv; else if ((p.hideout[m] || 0) < lv) p.hideout[m] = lv; });
}
export function hideoutDependents(mod, newLevel, p = P()) {
  const out = [];
  for (const m of D.hideout.modules) {
    const built = hLevel(m.name, p);
    for (const L of m.levels) if (L.level <= built) for (const r of L.modules) if (r.name === mod && r.level > newLevel) { out.push({ module: m.name, level: L.level - 1 }); }
  }
  // take min level per module
  const map = {};
  for (const o of out) map[o.module] = Math.min(map[o.module] ?? 99, o.level);
  return Object.entries(map).map(([module, level]) => ({ module, level }));
}
export const hcntKey = (m, lv, item) => `${m}|${lv}|${item}`;

// ---------- story ----------
export const chDone = (c, p = P()) => !!p.ch[c];
export function chapterClosure(name) {
  const out = new Set();
  const walk = (n) => { for (const d of IX.chDeps[n] || []) if (!out.has(d)) { out.add(d); walk(d); } };
  walk(name);
  return out;
}
export function objVisibleForEnding(o, ending) { return !o.endings || o.endings.includes(ending); }

// Story branch conditions ("If you kept the Armored case…") evaluated against the player's choices / progress.
// Returns true (applies), false (not your path) or null (unknown).
const condText = (c) => String(c || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
const condLinks = (c) => [...String(c || '').matchAll(/data-t="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
const doneAny = (n, p) => (D.quests[n] ? isDone(n, p) : D.chapters[n] ? !!p.ch[n] : null);
export function condStatus(cond, p = P()) {
  const t = condText(cond);
  if (!t || !/^(if|only if)\b/i.test(t)) return true; // stage headings ("Once…", "After…") are not branches
  const ch = p.settings.choices || {};
  if (/armored case/i.test(t) && !/\bor\b/i.test(t)) {
    const gave = /\b(gave|given)\b/i.test(t);
    if (!ch.armoredCase) return null;
    return gave ? ch.armoredCase === 'gave' : ch.armoredCase === 'kept';
  }
  if (/major evidence/i.test(t)) {
    if (!ch.evidence) return null;
    return /failed/i.test(t) ? ch.evidence === 'failed' : ch.evidence === 'received';
  }
  const ls = condLinks(cond).filter(n => D.quests[n] || D.chapters[n]);
  if (ls.length && /have not completed/i.test(t)) return ls.every(n => doneAny(n, p) === false);
  if (ls.length && /have completed/i.test(t)) return ls.some(n => doneAny(n, p) === true);
  return null;
}
export function objApplies(o, p = P()) { return objVisibleForEnding(o, p.settings.ending) && condStatus(o.cond, p) !== false; }
export function chapterProgress(c, p = P()) {
  const end = p.settings.ending;
  const req = c.objectives.filter(o => !o.optional && (o.depth || 1) === 1 && objVisibleForEnding(o, end) && condStatus(o.cond, p) !== false);
  const done = req.filter(o => chDone(c.name, p) || p.chObj[`${c.name}|${o.id}`]).length;
  return { done, total: req.length };
}

// ---------- shopping list ----------
export function shoppingList({ scope = 'all', includeCurrency = false, includeQuestItems = false, includeOptional = false } = {}, p = P()) {
  const agg = {};
  const add = (item, need, have, fir, src) => {
    const I = D.items[item];
    if (!I) return;
    if (I.currency && !includeCurrency) return;
    if (I.questItem && !includeQuestItems) return;
    const a = agg[item] || (agg[item] = { item, need: 0, have: 0, fir: 0, sources: [] });
    a.need += need; a.have += Math.min(have, need); if (fir) a.fir += Math.max(0, need - have);
    a.sources.push(src);
  };
  if (scope !== 'hideout') {
    for (const n of IX.order) {
      const q = D.quests[n];
      if (!visible(q, p) || isDone(n, p)) continue;
      if (q.alts?.some(a => isDone(a, p))) continue;
      if (scope === 'kappa' && !IX.kappa.has(n)) continue;
      if (scope === 'story') continue;
      for (const x of questNeeds(q, p, { includeOptional })) add(x.item, x.count, x.have, x.fir, { type: 'quest', name: n, count: x.count, have: x.have, fir: x.fir });
    }
  }
  if (scope === 'all' || scope === 'story') {
    for (const c of Object.values(D.chapters)) {
      if (chDone(c.name, p)) continue;
      for (const x of c.needs || []) {
        if (x.optional && !includeOptional) continue;
        const o = c.objectives.find(o => x.objectives.includes(o.id));
        if (o && !objApplies(o, p)) continue;
        add(x.item, x.count, 0, x.fir, { type: 'chapter', name: c.name, count: x.count, have: 0, fir: x.fir });
      }
    }
  }
  if (scope === 'all' || scope === 'hideout') {
    for (const m of D.hideout.modules) {
      const built = hLevel(m.name, p);
      for (const L of m.levels) {
        if (L.level <= built) continue;
        for (const i of L.items) {
          if (i.optional && !includeOptional) continue;
          const have = p.hcnt[hcntKey(m.name, L.level, i.item)] || 0;
          const fir = i.fir && !isSeasonal();
          add(i.item, i.count, have, fir, { type: 'hideout', name: m.name, level: L.level, count: i.count, have, fir });
        }
      }
    }
  }
  return Object.values(agg).filter(a => a.need > a.have).sort((a, b) => (b.need - b.have) - (a.need - a.have));
}
