// Speedrun planner: simulates your progression raid by raid and bundles every quest objective
// (all traders + all story chapters) that can be done on the same map into one raid.
import { store } from './store.js';
import { D, IX, P, visible, questStatus, isDone, mapUnlocked, traderUnlocked, traderLL, varNeed, condStatus } from './model.js';
import { esc, attr, icon, img, traderImg, qlink, itemChip, fmt, progressBar } from './ui.js';
import { openPanel } from './components.js';
import { lootData, ensureLoot, lootState, neededLoot, lootForMap, whereText, itemImg, lootItem, bestMaps, mapDisplayName } from './loot.js';

const RAID_KINDS = new Set(['kill', 'visit', 'mark', 'place', 'extract', 'use']);
const MENU_KINDS = new Set(['handover', 'talk', 'rep', 'sell', 'build']);

// ---------- helpers ----------
function objMaps(q, o) {
  if (o.maps?.length) return o.maps;
  if ((RAID_KINDS.has(o.kind) || o.kind === 'find' || o.kind === 'other') && q.maps?.length) return q.maps;
  return [];
}
// 'raid' = must be done inside a raid on a map, 'loot' = find items anywhere, 'menu' = trader screen / hideout
const karmaQuest = (q) => q.reqHtml?.some(r => /karma/i.test(r.html));
function objType(q, o) {
  if (MENU_KINDS.has(o.kind)) return 'menu';
  const maps = objMaps(q, o);
  // objective without its own map on a quest that spans several maps (e.g. "eliminate Reshala") → flexible
  if (!o.maps?.length && (q.maps?.length || 0) > 1 && RAID_KINDS.has(o.kind)) return 'flex';
  if (o.kind === 'find') {
    const questItem = (o.items || []).some(i => D.items[i.item]?.questItem);
    return (o.maps?.length || questItem) && maps.length ? 'raid' : 'loot';
  }
  return maps.length ? 'raid' : 'menu';
}
const hasChildren = (list, o) => list.some(x => x.parent === o.id);
const levelFor = (exp) => { let l = 1; for (const r of D.expTable || []) if (exp >= r.total) l = r.level; return l; };
const expFor = (level) => (D.expTable || []).find(r => r.level === level)?.total || 0;

function cloneProfile(p) {
  return { ...p, quests: { ...p.quests }, obj: { ...p.obj }, ch: { ...p.ch }, chObj: { ...p.chObj }, chStart: { ...(p.chStart || {}) }, hideout: { ...(p.hideout || {}) }, settings: { ...p.settings, ll: { ...(p.settings.ll || {}) } } };
}
const objDoneIn = (sp, qn, oid) => !!sp.quests[qn] || !!sp.obj[`${qn}|${oid}`];

// ---------- story chapters (all of them, not only Tour) ----------
const chDoneIn = (sp, c, oid) => !!sp.ch[c] || !!sp.chObj[`${c}|${oid}`];
const linksIn = (html) => [...String(html || '').matchAll(/data-t="([^"]+)"/g)].map(m => m[1]);
// maps / keys named in the unlock text of a chapter ("Pick up the note … on Customs")
export function chapterStart(c) {
  if (c._start) return c._start;
  const txt = (c.reqHtml || []).join(' ');
  const maps = [...new Set(linksIn(txt).filter(t => IX.maps.includes(t)))];
  const keys = [...new Set(linksIn(txt).filter(t => /key|keycard/i.test(D.items[t]?.type || '') || /\bkey(card)?\b/i.test(t) && D.items[t]))];
  const first = (c.reqHtml || []).find(r => r && !/^File:/i.test(r)) || '';
  return (c._start = { maps, keys, html: first, tour: /data-t="Tour"/.test(txt), ic: (txt.match(/Intelligence Center level (\d)/i) || [])[1] });
}
function preOk(c, sp) { return (c.prereq || []).every(g => g.some(a => (D.chapters[a.q] ? !!sp.ch[a.q] : !!sp.quests[a.q]))); }
export function chapterStarted(c, sp) {
  if (sp.ch[c.name] || sp.chStart?.[c.name] || c.name === 'Tour') return true;
  if (c.objectives.some(o => sp.chObj[`${c.name}|${o.id}`])) return true;
  if (!preOk(c, sp)) return false;
  const st = chapterStart(c);
  if (st.ic && (sp.hideout?.['Intelligence Center'] || 0) >= +st.ic) return true;
  if (st.tour) { const tr = linksIn((c.reqHtml || []).join(' ')).find(t => D.traders[t]); return tr ? traderUnlocked(tr, sp) : !!sp.ch['Tour']; }
  return !st.maps.length && !st.ic && (c.prereq || []).length > 0; // unlocked by finishing the previous chapter (The Ticket)
}
function chMap(c, o) {
  if (o.maps?.length) return o.maps[0];
  if (c.name !== 'Tour' || !(RAID_KINDS.has(o.kind) || o.kind === 'find' || o.kind === 'other')) return null;
  // Tour objectives without a map link inherit the map of the next mapped step (e.g. the Terminal intercom → Shoreline)
  const i = c.objectives.indexOf(o);
  for (let k = i + 1; k < c.objectives.length; k++) { const x = c.objectives[k]; if (x.maps?.length && RAID_KINDS.has(x.kind)) return x.maps[0]; }
  return null;
}
const MODS = () => D.hideout.modules.map(m => m.name);
const MENU_TXT = /^(\(optional\)\s*)?(learn|find out|ask|talk|tell|report|wait|figure out|decide|choose|read|hand over|pay|give|return to the hideout|return to)/i;
// 'parent' | 'menu' (done at a trader / hideout) | 'raid' (on a map) | 'block' (hideout level / loyalty still missing) | 'unmapped' (in raid, map unknown)
function chStepType(c, o, sp) {
  if (hasChildren(c.objectives, o)) return 'parent';
  const t = o.text || '';
  const hm = t.match(new RegExp(`(${MODS().join('|')})\\s*level\\s*(\\d)`, 'i'));
  if (hm && /obtain|build|construct|upgrade|reach/i.test(t)) { const mod = MODS().find(m => m.toLowerCase() === hm[1].toLowerCase()); return (sp.hideout?.[mod] || 0) >= +hm[2] ? 'menu' : 'block'; }
  const lm = t.match(/Loyalty Level (\d) with (\w[\w ]*)/i);
  if (lm) { const tr = Object.keys(D.traders).find(x => lm[2].toLowerCase().startsWith(x.toLowerCase())); return tr && traderLL(tr, sp) >= +lm[1] ? 'menu' : 'block'; }
  if (MENU_KINDS.has(o.kind) || MENU_TXT.test(t)) return 'menu';
  if (chMap(c, o)) return 'raid';
  if (RAID_KINDS.has(o.kind) || o.kind === 'find' || o.kind === 'other') return 'unmapped';
  return 'menu';
}
const applies = (o, sp) => (!o.endings || o.endings.includes(sp.settings.ending || 'Savior')) && condStatus(o.cond, sp) !== false;
// next steps of a started chapter, in order, until something needs a raid
function chapterNext(c, sp) {
  const out = [];
  for (const o of c.objectives) {
    if (o.optional || chDoneIn(sp, c.name, o.id) || !applies(o, sp)) continue;
    if ((o.depth || 1) > 1 && o.parent && chDoneIn(sp, c.name, o.parent)) continue;
    out.push({ o, t: chStepType(c, o, sp) });
  }
  return out;
}

// Complete everything that needs no raid: story talk/hand-in steps, quest hand-ins, finished quests.
function autoAdvance(sp, log) {
  let changed = true, guard = 0;
  while (changed && guard++ < 60) {
    changed = false;
    for (const cn of IX.chapterOrder) {
      const c = D.chapters[cn];
      if (!c || sp.ch[cn] || !chapterStarted(c, sp)) continue;
      for (const { o, t } of chapterNext(c, sp)) {
        if (t === 'parent') {
          const kids = c.objectives.filter(x => x.parent === o.id && !x.optional && applies(x, sp));
          if (kids.every(x => chDoneIn(sp, cn, x.id))) { sp.chObj[`${cn}|${o.id}`] = 1; changed = true; continue; }
          continue;
        }
        if (t === 'raid') break;
        if (t === 'block' || t === 'unmapped') { if (log?.blocked && !log.blocked.some(b => b.c === cn)) log.blocked.push({ c: cn, o, t }); break; }
        sp.chObj[`${cn}|${o.id}`] = 1; changed = true;
        log?.story.push({ c: cn, o });
      }
      if (c.objectives.every(o => o.optional || !applies(o, sp) || chDoneIn(sp, cn, o.id))) { sp.ch[cn] = 1; changed = true; }
    }
    // quests: when every raid objective is done, the rest happens at the trader
    for (const n of IX.order) {
      const q = D.quests[n];
      if (sp.quests[n] || !visible(q, sp) || karmaQuest(q)) continue;
      if (questStatus(q, sp).s !== 'available') continue;
      const req = q.objectives.filter(o => !o.optional && !hasChildren(q.objectives, o));
      const raidLeft = req.filter(o => objType(q, o) === 'raid' && !objDoneIn(sp, n, o.id));
      if (raidLeft.length) continue;
      const lootLeft = req.filter(o => (objType(q, o) === 'loot' || objType(q, o) === 'flex') && !objDoneIn(sp, n, o.id));
      sp.quests[n] = 1; changed = true;
      if (lootLeft.length) log?.loot.push(n); else log?.done.push(n);
    }
  }
}

function candidates(sp) {
  const cand = {}; // map -> [{kind:'quest'|'ch'|'start', …}]
  const add = (m, e) => { (cand[m] = cand[m] || []).push(e); };
  for (const n of IX.order) {
    const q = D.quests[n];
    if (sp.quests[n] || !visible(q, sp) || karmaQuest(q) || questStatus(q, sp).s !== 'available') continue;
    const earlier = []; // undone raid objectives before this one: a later step can only share their raid (same map)
    for (const o of q.objectives) {
      if (o.optional || objDoneIn(sp, n, o.id) || objType(q, o) !== 'raid' || hasChildren(q.objectives, o)) continue;
      const ms = objMaps(q, o).filter(m => mapUnlocked(m, sp) && earlier.every(e => objMaps(q, e).includes(m)));
      // an objective you can do on several maps counts less for each of them – exclusive objectives decide the map
      const w = 1 / Math.sqrt(Math.max(1, ms.length));
      for (const m of ms) add(m, { kind: 'quest', q, o, w });
      earlier.push(o);
    }
  }
  for (const cn of IX.chapterOrder) {
    const c = D.chapters[cn];
    if (!c || sp.ch[cn]) continue;
    if (chapterStarted(c, sp)) {
      // the next raid step(s) – consecutive steps on the same map count together
      let map = null;
      for (const { o, t } of chapterNext(c, sp)) {
        if (t === 'parent') continue;
        if (t !== 'raid') break;
        const m = chMap(c, o);
        if (map && m !== map) break;
        map = m;
        if (mapUnlocked(m, sp)) add(m, { kind: 'ch', c: cn, o });
      }
    } else if (preOk(c, sp)) {
      // storyline not started yet: pick up its note / visit its spot as early as possible
      for (const m of chapterStart(c).maps) if (mapUnlocked(m, sp)) add(m, { kind: 'start', c: cn });
    }
  }
  return cand;
}

function scoreMap(entries, sp) {
  let s = 0;
  const perQuest = {};
  for (const e of entries) {
    if (e.kind === 'ch') { s += 4; continue; }
    if (e.kind === 'start') { s += 6; continue; }
    s += (sp.active?.[e.q.name] ? 1.5 : 1) * (e.w ?? 1);
    (perQuest[e.q.name] = perQuest[e.q.name] || []).push(e.o.id);
  }
  for (const [n, ids] of Object.entries(perQuest)) {
    const q = D.quests[n];
    const left = q.objectives.filter(o => !o.optional && !hasChildren(q.objectives, o) && objType(q, o) === 'raid' && !objDoneIn(sp, n, o.id) && !ids.includes(o.id));
    if (!left.length) s += 1.5 + Math.min(2, (IX.graph.normal.dep[n]?.size || 0) * 0.3); // finishes the quest → unlocks follow-ups
  }
  return s;
}

// small tie-breaker: among maps with (almost) the same objectives prefer the one where more of the items you
// need soon can spawn. Capped below one objective, so loot never outweighs quest progress.
function lootBonusFn(needs) {
  if (!needs?.length) return () => 0;
  const top = needs.filter(n => n.prio >= 2);
  const cache = {};
  return (map) => {
    if (cache[map] != null) return cache[map];
    let b = 0;
    for (const x of lootForMap(map, top)) b += (x.prio === 3 ? 0.12 : 0.04) * x.rel;
    return (cache[map] = Math.min(0.8, b));
  };
}

const ekey = (e) => (e.kind === 'ch' ? `C${e.c}|${e.o.id}` : e.kind === 'start' ? `S${e.c}` : `${e.q.name}|${e.o.id}`);
export function planRaids({ maxRaids = 10, expPerRaid = 4000, lootNeeds = null } = {}) {
  const base = P();
  const lootBonus = lootBonusFn(lootNeeds);
  const sp = cloneProfile(base);
  let exp = expFor(sp.settings.level);
  const raids = [];
  const pre = { story: [], done: [], loot: [], blocked: [] };
  autoAdvance(sp, pre);
  for (let r = 0; r < maxRaids; r++) {
    const cand = candidates(sp);
    const maps = Object.keys(cand);
    if (!maps.length) break;
    let best = null, bestScore = -1;
    for (const m of maps) {
      const uniq = []; const seen = new Set();
      for (const e of cand[m]) { const k = ekey(e); if (!seen.has(k)) { seen.add(k); uniq.push(e); } }
      cand[m] = uniq;
      const sc = scoreMap(uniq, sp) + lootBonus(m);
      if (sc > bestScore) { bestScore = sc; best = m; }
    }
    const entries = cand[best];
    const levelBefore = sp.settings.level;
    for (const e of entries) {
      if (e.kind === 'ch') sp.chObj[`${e.c}|${e.o.id}`] = 1;
      else if (e.kind === 'start') sp.chStart[e.c] = 1;
      else sp.obj[`${e.q.name}|${e.o.id}`] = 1;
    }
    const log = { story: [], done: [], loot: [], blocked: [] };
    autoAdvance(sp, log);
    // EXP only for quests actually finished through raid objectives – item/menu-only quests are assumed but not credited
    const hasRaidObj = (n) => { const q = D.quests[n]; return q.objectives.some(o => !o.optional && objType(q, o) === 'raid'); };
    const gained = log.done.filter(hasRaidObj).reduce((s, n) => s + (D.quests[n].exp || 0), 0) + expPerRaid;
    if (expPerRaid > 0) { exp += gained; sp.settings.level = Math.max(sp.settings.level, levelFor(exp)); }
    raids.push({ map: best, entries, turnIns: log.done, lootQuests: log.loot, storyAfter: log.story, level: levelBefore, levelAfter: sp.settings.level, score: bestScore });
    for (const b of log.blocked) if (!pre.blocked.some(x => x.c === b.c)) pre.blocked.push({ ...b, after: r + 1 });
  }
  // loot to collect for quests that are (or become) available in the plan
  const loot = {};
  for (const n of IX.order) {
    const q = D.quests[n];
    if (isDone(n, base) || !visible(q, base)) continue;
    const st = questStatus(q, base).s;
    const inPlan = raids.some(r => r.entries.some(e => e.q?.name === n)) || st === 'available';
    if (!inPlan) continue;
    for (const o of q.objectives) {
      if (o.optional || objType(q, o) !== 'loot' || base.obj[`${n}|${o.id}`]) continue;
      for (const it of o.items || []) { if (D.items[it.item]?.currency) continue; const a = loot[it.item] || (loot[it.item] = { item: it.item, count: 0, fir: false, quests: [] }); a.count += it.count || 1; a.fir = a.fir || o.fir; if (!a.quests.includes(n)) a.quests.push(n); }
    }
  }
  return { raids, prelude: pre, loot: Object.values(loot).sort((a, b) => b.quests.length - a.quests.length) };
}

// what to take into the raid: markers / items to stash or place, gear to wear or use, keys (also for storyline starts)
function bringList(r) {
  const items = {}, wear = {}, keys = {};
  const isKey = (n) => /key|keycard/i.test(D.items[n]?.type || '') || /\bkey(card)?\b/i.test(n);
  for (const e of r.entries) {
    if (e.kind === 'start') { for (const k of chapterStart(D.chapters[e.c]).keys) keys[k] = keys[k] || { item: k, count: 1, alt: true }; continue; }
    const o = e.o;
    for (const it of o.items || []) {
      const I = D.items[it.item];
      if (!I || I.questItem || I.currency) continue;
      if (isKey(it.item)) { keys[it.item] = keys[it.item] || { item: it.item, count: 1 }; continue; }
      if (['mark', 'place', 'use'].includes(o.kind) || /\b(mark|stash|plant|place|install|hide|leave|put|use)\b/i.test(o.text)) { const a = items[it.item] || (items[it.item] = { item: it.item, count: 0 }); a.count += it.count || 1; }
      else if (/\b(wear|wearing|equipped|using|while|with an?|with the)\b/i.test(o.text) && ['kill', 'visit', 'extract', 'other'].includes(o.kind)) wear[it.item] = wear[it.item] || { item: it.item, count: 1 };
    }
    if (e.q) for (const nd of e.q.needs || []) if (isKey(nd.item) && (!nd.objectives?.length || nd.objectives.includes(o.id))) keys[nd.item] = keys[nd.item] || { item: nd.item, count: 1 };
  }
  return { items: Object.values(items), wear: Object.values(wear), keys: Object.values(keys) };
}

// ---------- stored plan (only recalculated on request) ----------
const PLAN_V = 2;
function progressSig(p) {
  const keys = (o) => Object.keys(o || {}).filter(k => o[k]).sort().join(',');
  const str = [keys(p.quests), keys(p.obj), keys(p.ch), keys(p.chObj), keys(p.chStart), keys(p.active), JSON.stringify(p.hideout || {}), p.settings.level].join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h >>> 0);
}
const serE = (e) => (e.kind === 'ch' ? ['C', e.c, e.o.id] : e.kind === 'start' ? ['S', e.c] : [e.q.name, e.o.id]);
const serS = (x) => [x.c, x.o.id];
function serializePlan(plan) {
  return {
    raids: plan.raids.map(r => ({ map: r.map, e: r.entries.map(serE), t: r.turnIns, l: r.lootQuests || [], sa: r.storyAfter.map(serS), lv: r.level, la: r.levelAfter })),
    pre: { story: plan.prelude.story.map(serS), done: plan.prelude.done, loot: plan.prelude.loot, blocked: plan.prelude.blocked.map(b => [b.c, b.o.id, b.t, b.after || 0]) },
    loot: plan.loot,
  };
}
function hydratePlan(d) {
  const cobj = (c, id) => D.chapters[c]?.objectives.find(o => o.id === id) || null;
  const qobj = (n, id) => D.quests[n]?.objectives.find(o => o.id === id) || null;
  const q = (n) => !!D.quests[n];
  const hs = ([c, id]) => (cobj(c, id) ? { c, o: cobj(c, id) } : null);
  const he = (a) => (a[0] === 'C' ? (cobj(a[1], a[2]) ? { kind: 'ch', c: a[1], o: cobj(a[1], a[2]) } : null) : a[0] === 'S' ? (D.chapters[a[1]] ? { kind: 'start', c: a[1] } : null) : (qobj(a[0], a[1]) ? { kind: 'quest', q: D.quests[a[0]], o: qobj(a[0], a[1]) } : null));
  return {
    raids: d.raids.map(r => ({ map: r.map, entries: r.e.map(he).filter(Boolean), turnIns: r.t.filter(q), lootQuests: r.l.filter(q), storyAfter: r.sa.map(hs).filter(Boolean), level: r.lv, levelAfter: r.la })).filter(r => r.entries.length),
    prelude: { story: d.pre.story.map(hs).filter(Boolean), done: d.pre.done.filter(q), loot: d.pre.loot.filter(q), blocked: d.pre.blocked.map(([c, id, t, after]) => (cobj(c, id) ? { c, o: cobj(c, id), t, after } : null)).filter(Boolean) },
    loot: (d.loot || []).filter(a => D.items[a.item]),
  };
}
export function recalcSpeedrun() {
  const all = { ...(store.ui.srPlans || {}) };
  delete all[store.active];
  store.setUi('srPlans', all);
}
function agoText(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
const chIcon = (c) => img(D.chapters[c]?.iconImg, '', 'mp-tr ch-mini');
const storySteps = (list) => { const by = {}; for (const x of list) (by[x.c] = by[x.c] || []).push(x.o); return Object.entries(by).map(([c, os]) => `<span class="small">${chIcon(c)} <b>${esc(c)}</b>: ${os.map(o => esc(o.text)).join(' → ')}</span>`).join(' '); };

// ---------- tab ----------
export function renderSpeedrun(root) {
  const p = P();
  const ui = store.ui.sr || { n: 10, exp: 4000 };
  const t0 = performance.now();
  const ld = lootData();
  if (!ld && lootState() !== 'missing') ensureLoot();
  const sig = progressSig(p);
  let stored = store.ui.srPlans?.[store.active];
  let plan = null;
  if (stored && stored.v === PLAN_V && stored.n === ui.n && stored.exp === ui.exp) { try { plan = hydratePlan(stored.data); } catch (e) { console.warn('stored plan unreadable', e); plan = null; } }
  if (!plan) {
    const needs0 = ld ? neededLoot(p) : null;
    plan = planRaids({ maxRaids: ui.n, expPerRaid: ui.exp, lootNeeds: needs0 });
    stored = { v: PLAN_V, n: ui.n, exp: ui.exp, at: Date.now(), sig, data: serializePlan(plan) };
    store.setUi('srPlans', { ...(store.ui.srPlans || {}), [store.active]: stored });
  }
  const stale = stored.sig !== sig;
  const entryDone = (e) => (e.kind === 'ch' ? !!p.ch[e.c] || !!p.chObj[`${e.c}|${e.o.id}`] : e.kind === 'start' ? chapterStarted(D.chapters[e.c], p) : isDone(e.q.name, p) || !!p.obj[e.q.name + '|' + e.o.id]);
  const raidDone = (r) => r.entries.every(entryDone);
  // quests that the plan works on count as "soon" for item priorities
  const soon = new Set();
  for (const r of plan.raids) { for (const e of r.entries) if (e.q) soon.add(e.q.name); r.turnIns.forEach(n => soon.add(n)); (r.lootQuests || []).forEach(n => soon.add(n)); }
  plan.loot.forEach(a => a.quests.forEach(n => soon.add(n)));
  const needs = ld ? neededLoot(p, soon) : [];
  const raidLoot = plan.raids.map(r => (ld ? lootForMap(r.map, needs) : []));
  const ms = Math.round(performance.now() - t0);
  const totalObj = plan.raids.reduce((s, r) => s + r.entries.length, 0);
  const totalQ = plan.raids.reduce((s, r) => s + r.turnIns.length, 0);
  const pr = plan.prelude;
  root.innerHTML = `
  <div class="tab-head"><div><h1>Speedrun Guide</h1><p class="lede">Your next raids, planned from your current progress: every objective that can be done on the same map is bundled into one raid – across all traders and all story chapters. Raids with a <b class="c-story">red frame</b> move a storyline forward or start a new one. The plan stays put until you press <b>Recalculate</b>.</p></div>
    <div class="head-stat"><div class="stat"><b>${plan.raids.length}</b> raids · <b>${totalObj}</b> objectives · <b>${totalQ}</b> quests finished</div></div></div>
  <div class="notice">${icon('list')}<div>Quicker than ticking finished quests: <b>tell the tracker which quests are open in your game</b> and it marks everything before them as done. <button class="btn btn-s btn-p" data-act="active-setup">Set my open quests</button></div></div>
  <div class="filters">
    <span class="small muted">Plan</span>
    <div class="seg" role="radiogroup" aria-label="Number of raids">${[5, 10, 20, 40].map(n => `<button role="radio" aria-checked="${ui.n === n}" class="seg-b ${ui.n === n ? 'on' : ''}" data-act="sr" data-k="n" data-v="${n}">${n} raids</button>`).join('')}</div>
    <span class="small muted" data-tip="EXP you earn per raid besides quest rewards (kills, looting, survival). Used to estimate when level-gated quests unlock. 'off' keeps your current level for the whole plan.">Level-ups</span>
    <div class="seg" role="radiogroup" aria-label="EXP per raid">${[[0, 'off'], [1500, 'low'], [4000, 'normal'], [8000, 'high']].map(([v, l]) => `<button role="radio" aria-checked="${ui.exp === v}" class="seg-b ${ui.exp === v ? 'on' : ''}" data-act="sr" data-k="exp" data-v="${v}">${l}</button>`).join('')}</div>
    <button class="btn ${stale ? 'btn-p' : ''}" data-act="sr-recalc" data-tip="Plan again from your current progress">${icon('refresh')} Recalculate</button>
    <span class="small muted">planned ${agoText(stored.at)}</span>
  </div>
  ${stale ? `<div class="notice sr-stale">${icon('refresh')}<div>Your progress changed since this plan was made. Ticks show up here, but the raid order stays as it is until you press <b>Recalculate</b>. <button class="btn btn-s btn-p" data-act="sr-recalc">Recalculate now</button></div></div>` : ''}
  ${pr.story.length || pr.done.length || pr.loot.length || pr.blocked.length ? `<section class="panel sr-pre"><div class="panel-h"><h2>Right now, before your next raid</h2></div>
    ${pr.story.length ? `<div class="sub-h">Story steps at the traders</div><div class="sr-story">${storySteps(pr.story)}</div>` : ''}
    ${pr.loot.length ? `<div class="sub-h">Collect the items and hand in</div><div class="chips">${pr.loot.map(n => `<span class="chip">${traderImg(D.quests[n].trader, 'chip-img')}${qlink(n)}</span>`).join('')}</div>` : ''}
    ${pr.done.length ? `<div class="sub-h">Quests you can hand in</div><div class="chips">${pr.done.map(n => `<span class="chip">${traderImg(D.quests[n].trader, 'chip-img')}${qlink(n)}</span>`).join('')}</div>` : ''}
    ${pr.blocked.length ? `<div class="sub-h">Story steps the plan can't place on a map</div><ul class="sr-blocked">${pr.blocked.map(b => `<li>${chIcon(b.c)} <b>${esc(b.c)}</b>: ${b.o.html} <span class="small muted">${b.t === 'block' ? '– needs a hideout level / trader loyalty first' : '– location not on the wiki page, see the guide'}${b.after ? ` (reached after raid ${b.after})` : ''}</span> <button class="btn btn-s" data-act="info-ch" data-c="${attr(b.c)}">${icon('info')} Guide</button></li>`).join('')}</ul>` : ''}</section>` : ''}
  <ol class="raids">${plan.raids.map((r, i) => {
    const chE = r.entries.filter(e => e.kind === 'ch');
    const startE = r.entries.filter(e => e.kind === 'start');
    const byC = {}; for (const e of chE) (byC[e.c] = byC[e.c] || []).push(e.o);
    const byQ = {}; for (const e of r.entries) if (e.kind === 'quest') (byQ[e.q.name] = byQ[e.q.name] || []).push(e.o);
    const br = bringList(r);
    const lt = raidLoot[i];
    const ltTop = lt.filter(x => x.prio >= 2).slice(0, 8);
    const ltRest = lt.filter(x => !ltTop.includes(x)).slice(0, 30);
    const rDone = raidDone(r);
    const story = chE.length || startE.length;
    return `<li class="raid ${rDone ? 'raid-done' : ''} ${story ? 'raid-story' : ''}">
      <div class="raid-h"><span class="raid-n">${i + 1}</span><div class="raid-t"><h2>${esc(r.map)}${story ? ' <span class="badge b-story">Storyline</span>' : ''}${rDone ? ' <span class="badge b-done">' + icon('check') + 'Done</span>' : ''}</h2><div class="small muted">${r.entries.length} objective${r.entries.length > 1 ? 's' : ''} · ${Object.keys(byQ).length} quest${Object.keys(byQ).length !== 1 ? 's' : ''}${Object.keys(byC).length ? ` + ${Object.keys(byC).join(', ')}` : ''} · est. level ${r.level}${r.levelAfter > r.level ? ` → ${r.levelAfter}` : ''}</div></div>
        <button class="btn btn-s" data-act="map" data-map="${attr(r.map)}">${icon('map')} Map</button></div>
      ${br.items.length || br.wear.length || br.keys.length ? `<div class="raid-bring">${br.items.length ? `<span class="small muted">Bring:</span> ${br.items.map(b => itemChip(b.item, { count: b.count, small: true })).join('')}` : ''}${br.wear.length ? ` <span class="small muted">Wear / use:</span> ${br.wear.map(b => itemChip(b.item, { small: true })).join('')}` : ''}${br.keys.length ? ` <span class="small muted">Keys:</span> ${br.keys.map(b => itemChip(b.item, { small: true })).join('')}${br.keys.some(k => k.alt) ? ' <span class="small muted">(one of them)</span>' : ''}` : ''}</div>` : ''}
      <div class="raid-b">
        ${startE.map(e => { const c = D.chapters[e.c]; const st = chapterStart(c); return `<div class="raid-q story-q"><div class="raid-qh">${chIcon(e.c)} <b>Start storyline: ${esc(e.c)}</b><button class="ibtn" data-act="info-ch" data-c="${attr(e.c)}" aria-label="Guide">${icon('info')}</button></div><div class="small">${st.html}</div><button class="btn btn-s ${chapterStarted(c, p) ? 'on' : ''}" data-act="ch-start" data-c="${attr(e.c)}">${chapterStarted(c, p) ? 'Started ✓' : 'I picked it up – mark as started'}</button></div>`; }).join('')}
        ${Object.entries(byC).map(([c, objs]) => `<div class="raid-q story-q"><div class="raid-qh">${chIcon(c)} <b>${esc(c)}</b> <span class="small muted">story chapter</span><button class="ibtn" data-act="info-ch" data-c="${attr(c)}" aria-label="Guide">${icon('info')}</button></div><ul class="objs">${objs.map(o => `<li class="obj"><button class="cb cb-s ${p.chObj[c + '|' + o.id] ? 'on' : ''}" data-act="chobj" data-q="${attr(c)}" data-o="${o.id}" aria-label="Toggle">${icon('check')}</button><span class="obj-t">${o.html}</span></li>`).join('')}</ul></div>`).join('')}
        ${Object.entries(byQ).map(([n, objs]) => `<div class="raid-q"><div class="raid-qh">${traderImg(D.quests[n].trader, 'mp-tr')} ${qlink(n)} ${notYet(n, p)}${r.turnIns.includes(n) ? '<span class="badge b-av" data-tip="All raid objectives done after this raid – hand it in">finishes</span>' : ''}<button class="ibtn" data-act="info" data-q="${attr(n)}" aria-label="Info">${icon('info')}</button></div>
          <ul class="objs">${objs.map(o => `<li class="obj"><button class="cb cb-s ${p.obj[n + '|' + o.id] ? 'on' : ''}" data-act="obj" data-q="${attr(n)}" data-o="${o.id}" aria-label="Toggle">${icon('check')}</button><span class="obj-t">${o.html}${o.kind === 'kill' && /\b([5-9]|\d{2,})\b/.test(o.text) ? ' <span class="small muted">(may need more than one raid)</span>' : ''}</span></li>`).join('')}</ul></div>`).join('')}
      </div>
      ${lt.length ? `<div class="raid-loot"><div class="raid-lh">${icon('box')} <span class="small"><b>Grab on ${esc(r.map)}</b> – items you still need for quests / hideout that spawn here</span></div>
        ${ltTop.length ? `<div class="chips">${ltTop.map(x => lootChip(x, r.map)).join('')}</div>` : ''}
        ${ltRest.length ? `<details class="raid-more"><summary class="small">${ltTop.length ? 'More' : 'Items for later'} (${ltRest.length})</summary><div class="chips">${ltRest.map(x => lootChip(x, r.map)).join('')}</div></details>` : ''}</div>` : ''}
      ${r.turnIns.length || r.storyAfter.length || r.lootQuests?.length ? `<div class="raid-after"><span class="small muted">After the raid:</span> ${storySteps(r.storyAfter)} ${r.turnIns.length ? `<span class="small">hand in ${r.turnIns.map(n => qlink(n)).join(', ')}</span>` : ''}${r.lootQuests?.length ? ` <span class="small">· unlocked item quests: ${r.lootQuests.map(n => qlink(n)).join(', ')}</span>` : ''}</div>` : ''}
    </li>`;
  }).join('') || '<div class="empty">Nothing to plan – every available quest objective is done, or the next quests need a higher level / trader loyalty.</div>'}</ol>
  ${lootPlanHtml(plan, needs, raidLoot, ld)}
  <p class="small muted">How it's planned: from your ticked progress the planner simulates raid by raid. Each raid picks the map where you get the most done: storyline starts count most (so you pick up every storyline as early as possible), then story steps, then quest objectives – an objective that is possible on several maps counts less than one that only works on this map, and objectives that finish a quest count extra. After each raid it hands in finished quests and estimates your level from quest EXP plus the EXP-per-raid setting. When two maps are about equal, the one where more of your needed items can spawn wins. Item spawns: loose-loot spots and container positions from tarkov.dev, container contents from the wiki loot tables. Computed in ${ms} ms.</p>`;
}

// quest that is not unlocked in your game yet – the plan expects it to open after earlier hand-ins / level-ups
function notYet(n, p) {
  const st = questStatus(D.quests[n], p);
  if (st.s !== 'locked') return '';
  const why = st.reasons.map(r => r.k === 'var' ? `after ${varNeed(r.x, p)} more finished ${r.x.trader} LL${r.x.tier} task${varNeed(r.x, p) > 1 ? 's' : ''} (e.g. the hand-ins before this raid)` : r.k === 'level' ? `at PMC level ${r.v}` : r.k === 'll' ? `at ${r.v.trader} LL${r.v.level}` : r.k === 'pre' ? `after ${r.g.map(a => a.q).join(' or ')}` : r.k === 'tour' || r.k === 'start' ? 'after the Tour steps' : r.k === 'map' ? 'when the map is unlocked' : r.k === 'chapter' ? `after the ${r.c.ch} step` : '').filter(Boolean);
  return `<span class="badge b-lock" data-tip="${attr('Not in your task list yet – unlocks ' + (why.join(', ') || 'during the plan') + '. Hand in the earlier quests first.')}">${icon('lock')}unlocks first</span>`;
}

// ---------- loot ----------
function srcText(x) {
  return x.sources.slice(0, 5).map(s => `${s.type === 'hideout' ? `${s.name} L${s.level}` : s.name} ×${s.count - (s.have || 0)}${s.soon ? '' : ' (later)'}`).join(', ') + (x.sources.length > 5 ? ` +${x.sources.length - 5} more` : '');
}
function lootChip(x, map) {
  const it = lootItem(x.li);
  const I = D.items[x.item] || {};
  const tip = `${whereText(x.f)}${x.best ? ' · best map for this item' : ''} — ${x.soonMissing && x.soonMissing < x.missing ? `${x.soonMissing} needed soon, ${x.missing} in total` : `${x.missing} needed`}: ${srcText(x)}`;
  return `<span class="chip chip-s lchip lp${x.prio}" data-tip="${attr(tip)}">${img(I.img || itemImg(it), x.item, 'chip-img')}<span class="chip-name" data-item="${attr(x.item)}">${esc(x.item)}</span><span class="ic-count">${fmt(x.soonMissing || x.missing)}</span>${x.fir ? '<span class="fir">FiR</span>' : ''}${x.best ? `<span class="lbest" aria-label="best map">${icon('star')}</span>` : ''}<button class="ibtn ibtn-s" data-act="loot-show" data-item="${attr(x.item)}" data-map="${attr(map)}" aria-label="Show spawns on the map">${icon('map')}</button></span>`;
}
function lootPlanHtml(plan, needs, raidLoot, ld) {
  if (!ld) {
    const st = lootState();
    return plan.loot.length ? `<section class="panel"><div class="panel-h"><h2>Loot to keep while raiding</h2><span class="small muted">${st === 'missing' ? 'Spawn data not available yet' : 'Loading spawn data…'}</span></div>
    <div class="chips cgrid">${plan.loot.slice(0, 40).map(a => itemChip(a.item, { count: a.count, fir: a.fir, small: true })).join('')}</div></section>` : '';
  }
  const inRaids = new Map();
  raidLoot.forEach((lt, i) => { for (const x of lt) { const a = inRaids.get(x.item) || []; a.push(i); inRaids.set(x.item, a); } });
  const top = needs.filter(n => n.prio >= 2).sort((a, b) => b.prio - a.prio || (inRaids.get(b.item)?.length ? 1 : 0) - (inRaids.get(a.item)?.length ? 1 : 0) || b.soonMissing - a.soonMissing);
  const noSpawn = plan.loot.filter(a => !needs.some(n => n.item === a.item && bestMaps(n.li).length));
  const lim = store.ui.srLootLim || 30;
  return `<section class="panel"><div class="panel-h"><h2>Loot plan</h2><span class="small muted">Items your open quests, the story and your next hideout levels still need – where they spawn best and in which of the planned raids you can grab them</span></div>
    <div class="lplan">${top.slice(0, lim).map(n => {
      const it = lootItem(n.li); const I = D.items[n.item] || {};
      const bm = bestMaps(n.li).slice(0, 3);
      const rs = inRaids.get(n.item) || [];
      return `<div class="lp-row lp${n.prio}">${img(I.img || itemImg(it), n.item, 'i-ic')}
        <div class="lp-main"><div><span class="chip-name" data-item="${attr(n.item)}" data-tip-item="${attr(n.item)}">${esc(n.item)}</span> <b>×${fmt(n.soonMissing || n.missing)}</b>${n.soonMissing && n.soonMissing < n.missing ? ` <span class="small muted">(${fmt(n.missing)} total)</span>` : ''}${n.fir ? ' <span class="fir">FiR</span>' : ''} <span class="small muted">for ${esc(srcText(n))}</span></div>
          <div class="small">${bm.length ? `Best: ${bm.map(b => `<button class="linkbtn" data-act="loot-show" data-item="${attr(n.item)}" data-map="${attr(mapDisplayName(b.key))}" data-tip="${attr(whereText(b))}">${esc(mapDisplayName(b.key))}</button>`).join(', ')}` : '<span class="muted">No spawn data – barter, craft or flea</span>'}${rs.length ? ` · <span class="muted">in your plan:</span> ${rs.slice(0, 4).map(i => `raid ${i + 1} (${esc(plan.raids[i].map)})`).join(', ')}${rs.length > 4 ? ' …' : ''}` : ''}</div></div></div>`;
    }).join('') || '<div class="empty small">No quest or next-level hideout items missing.</div>'}</div>
    ${top.length > lim ? `<button class="btn more" data-act="more" data-k="srLootLim">Show more (${top.length - lim} hidden)</button>` : ''}
    ${noSpawn.length ? `<div class="sub-h">Quest items without spawn data</div><div class="chips">${noSpawn.slice(0, 30).map(a => itemChip(a.item, { count: a.count, fir: a.fir, small: true })).join('')}</div>` : ''}
  </section>`;
}

// ---------- "my open quests" setup ----------
export function openActiveSetup() {
  const p = P();
  const q = (store.ui.asq || '').toLowerCase().trim();
  const act = p.active || {};
  const nAct = Object.keys(act).filter(n => D.quests[n] && !isDone(n, p)).length;
  const minLv = Math.max(0, ...Object.keys(act).filter(n => D.quests[n]).map(n => D.quests[n].minLevel || 0));
  const llSel = (t) => {
    if (!D.traders[t]?.ll?.length || t === 'Fence') return '';
    const man = p.settings.ll?.[t];
    const cur = traderLL(t, p);
    return `<span class="as-ll small"><span class="muted">LL</span>${[1, 2, 3, 4].map(l => `<button class="as-llb ${man != null && +man === l ? 'on' : ''}" data-act="setll" data-t="${attr(t)}" data-l="${l}" aria-label="Loyalty level ${l}">${l}</button>`).join('')}${man == null ? `<span class="muted" data-tip="Estimated from your PMC level – set it to your real loyalty level">auto ${cur}</span>` : `<button class="linkbtn" data-act="setll" data-t="${attr(t)}" data-l="">auto</button>`}</span>`;
  };
  const groups = IX.traders.map(t => {
    const names = (IX.byTrader[t] || []).filter(n => visible(D.quests[n], p) && (!q || n.toLowerCase().includes(q)));
    if (!names.length) return '';
    const nOn = names.filter(n => act[n] && !isDone(n, p)).length;
    return `<div class="as-g"><div class="sub-h as-gh">${traderImg(t, 'mp-tr')} ${esc(t)} ${nOn ? `<span class="badge b-av">${nOn} open</span>` : ''}${llSel(t)}</div>${names.map(n => {
      const done = isDone(n, p), on = !!act[n] && !done;
      return `<label class="as-row ${done ? 'is-done' : ''} ${on ? 'on' : ''}"><input type="checkbox" data-active="${attr(n)}" ${on ? 'checked' : ''}> <span>${esc(n)}</span>${done ? ' <span class="small muted">done</span>' : ''}</label>`;
    }).join('')}</div>`;
  }).join('');
  openPanel(`${icon('list', 'dr-ic')}<span>My open quests</span>`, `
    <ol class="as-steps small">
      <li>In the game open every trader's <b>Tasks</b> with <b>Show completed</b> and <b>Show locked</b> turned off, and set your <b>PMC level</b>: <input type="number" min="1" max="79" value="${p.settings.level}" data-set="level" class="as-lvl" aria-label="PMC level">${minLv > p.settings.level ? ` <span class="c-orange">your open quests need at least level ${minLv}</span>` : ''}</li>
      <li>Tick <b>every</b> quest you see there. Also set the <b>loyalty level (LL)</b> you have with each of those traders – quests above your LL then count as "not unlocked yet" instead of finished.</li>
      <li>Press <b>Apply – this is my full task list</b>.</li>
    </ol>
    <p class="small muted">Why the full list matters: many quests (e.g. Ragman's LL1 quests) have no quest before or after them, so the tracker can't tell from one open quest whether another one is finished. If it is not in your in-game list, it is finished – that's what the first button uses.</p>
    <div class="as-bar">
      <label class="search">${icon('search')}<input type="search" data-as="q" placeholder="Search quest name" value="${attr(store.ui.asq || '')}" aria-label="Search quests"></label>
      <span class="small"><b>${nAct}</b> selected</span>
    </div>
    <div class="as-actions">
      <button class="btn btn-p" data-act="active-apply" data-mode="strict" data-tip="For every trader you ticked quests for: anything the tracker thinks is available but is not in your list is counted as finished (repeated for follow-ups). Your ticks from before are replaced.">Apply – this is my full task list</button>
      <button class="btn" data-act="active-apply" data-mode="replace" data-tip="Only marks the quests your open quests require (earlier parts, prerequisites). Everything else stays open.">Apply – only what they require</button>
      <button class="btn" data-act="active-apply" data-mode="merge" data-tip="Keeps everything you already ticked and adds what the open quests require">Apply – keep my ticks</button>
      <button class="btn btn-s" data-act="active-clear">Clear selection</button>
    </div>
    <div class="as-list">${groups || '<div class="empty small">No quest matches.</div>'}</div>`);
}
