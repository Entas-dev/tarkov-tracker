// Dataset indexing + progress logic (availability, regressive completion, item needs)
import { store } from './store.js';

export const TRADER_ORDER = ['Prapor', 'Therapist', 'Fence', 'Skier', 'Peacekeeper', 'Mechanic', 'Ragman', 'Jaeger', 'Ref', 'Lightkeeper', 'BTR Driver'];
export const ENDINGS = ['Savior', 'Debtor', 'Survivor', 'Fallen'];

export let D = null;
export const IX = {};

export function setDataset(ds) {
  D = ds;
  buildIndexes();
}

const rel = (g) => g.filter(a => a.type === 'complete');

function buildIndexes() {
  const Q = D.quests;
  IX.names = Object.keys(Q);
  for (const q of Object.values(Q)) {
    q.pre = (q.prereq || []).map(g => g.filter(a => Q[a.q] && a.q !== q.name)).filter(g => g.length);
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
  IX.graph = {};
  for (const mode of ['normal', 'seasonal']) {
    const dep = {};
    for (const q of Object.values(Q)) {
      const pre = mode === 'seasonal' ? q.preSeasonal : q.pre;
      for (const g of pre) for (const a of g) (dep[a.q] = dep[a.q] || new Set()).add(q.name);
    }
    IX.graph[mode] = { dep };
  }
  // topological order (by normal graph), tie-break by min level, trader order, name
  const indeg = {}; const out = {};
  for (const q of Object.values(Q)) { indeg[q.name] = 0; out[q.name] = []; }
  for (const q of Object.values(Q)) for (const g of q.pre) for (const a of g) { if (out[a.q]) { out[a.q].push(q.name); indeg[q.name]++; } }
  const effLevel = (q) => Math.max(q.minLevel || 0, (q.ll && D.traders[q.ll.trader]?.ll?.find(l => l.level === q.ll.level)?.pmcLevel) || 0);
  IX.effLevel = (n) => effLevel(Q[n]);
  const key = (n) => { const q = Q[n]; const ti = TRADER_ORDER.indexOf(q.trader); return [effLevel(q), ti < 0 ? 99 : ti, n]; };
  const cmp = (a, b) => { const A = key(a), B = key(b); for (let i = 0; i < 3; i++) { if (A[i] < B[i]) return -1; if (A[i] > B[i]) return 1; } return 0; };
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
  IX.traders = [...TRADER_ORDER.filter(t => traders.has(t) || D.traders[t]), ...[...traders].filter(t => !TRADER_ORDER.includes(t)).sort()];
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
  if (q.alts?.length && q.alts.some(a => isDone(a, p))) return { s: 'blocked', reasons: [{ k: 'alt', v: q.alts.filter(a => isDone(a, p)) }] };
  const reasons = [];
  for (const g of preOf(q)) if (!groupSatisfied(g, p)) reasons.push({ k: 'pre', g });
  if (q.minLevel && p.settings.level < q.minLevel) reasons.push({ k: 'level', v: q.minLevel });
  if (q.ll && q.ll.trader && traderLL(q.ll.trader, p) < q.ll.level) reasons.push({ k: 'll', v: q.ll });
  return { s: reasons.length ? 'locked' : 'available', reasons };
}

// ---------- regressive completion ----------
export function prerequisiteClosure(name, p = P()) {
  const out = new Set();
  const walk = (n) => {
    const q = D.quests[n];
    if (!q) return;
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

export function completeQuest(name) {
  const add = prerequisiteClosure(name);
  store.update(p => { p.quests[name] = 1; for (const n of add) p.quests[n] = 1; });
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
export function chapterProgress(c, p = P()) {
  const end = p.settings.ending;
  const req = c.objectives.filter(o => !o.optional && (o.depth || 1) === 1 && objVisibleForEnding(o, end));
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
        if (o && !objVisibleForEnding(o, p.settings.ending)) continue;
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
