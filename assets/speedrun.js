// Speedrun planner: simulates your progression raid by raid and bundles every quest objective
// (all traders + the Tour story chapter) that can be done on the same map into one raid.
import { store } from './store.js';
import { D, IX, P, visible, questStatus, isDone, mapUnlocked, traderUnlocked } from './model.js';
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
// Tour objectives without a map link inherit the map of the next mapped step (e.g. the Terminal intercom → Shoreline)
function tourMap(tour, o) {
  if (o.maps?.length) return o.maps[0];
  if (!RAID_KINDS.has(o.kind)) return null;
  const i = tour.objectives.indexOf(o);
  for (let k = i + 1; k < tour.objectives.length; k++) { const x = tour.objectives[k]; if (x.maps?.length && RAID_KINDS.has(x.kind)) return x.maps[0]; }
  return null;
}
const tourType = (tour, o) => (hasChildren(tour.objectives, o) ? 'parent' : MENU_KINDS.has(o.kind) ? 'menu' : tourMap(tour, o) ? 'raid' : 'menu');
const levelFor = (exp) => { let l = 1; for (const r of D.expTable || []) if (exp >= r.total) l = r.level; return l; };
const expFor = (level) => (D.expTable || []).find(r => r.level === level)?.total || 0;

function cloneProfile(p) {
  return { ...p, quests: { ...p.quests }, obj: { ...p.obj }, ch: { ...p.ch }, chObj: { ...p.chObj }, settings: { ...p.settings, ll: { ...(p.settings.ll || {}) } } };
}
const objDoneIn = (sp, qn, oid) => !!sp.quests[qn] || !!sp.obj[`${qn}|${oid}`];
const tourDoneIn = (sp, oid) => !!sp.ch['Tour'] || !!sp.chObj[`Tour|${oid}`];

// Complete everything that needs no raid: Tour talk/hand-in steps, quest hand-ins, finished quests.
function autoAdvance(sp, log) {
  const tour = D.chapters?.['Tour'];
  let changed = true, guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    // Tour: sequential, stop at the first step that needs a raid
    if (tour && !sp.ch['Tour']) {
      for (const o of tour.objectives) {
        if (o.optional || tourDoneIn(sp, o.id)) continue;
        if ((o.depth || 1) > 1 && o.parent && tourDoneIn(sp, o.parent)) continue;
        const t = tourType(tour, o);
        if (t === 'parent') {
          const kids = tour.objectives.filter(x => x.parent === o.id && !x.optional);
          if (kids.every(x => tourDoneIn(sp, x.id))) { sp.chObj[`Tour|${o.id}`] = 1; changed = true; continue; }
          continue; // its children come next
        }
        if (t === 'raid') break;
        sp.chObj[`Tour|${o.id}`] = 1; changed = true;
        log?.tour.push(o);
      }
      if (tour.objectives.every(o => o.optional || tourDoneIn(sp, o.id))) { sp.ch['Tour'] = 1; }
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
  const cand = {}; // map -> [{kind:'quest'|'tour', q, o}]
  const add = (m, e) => { (cand[m] = cand[m] || []).push(e); };
  for (const n of IX.order) {
    const q = D.quests[n];
    if (sp.quests[n] || !visible(q, sp) || karmaQuest(q) || questStatus(q, sp).s !== 'available') continue;
    const earlier = []; // undone raid objectives before this one: a later step can only share their raid (same map)
    for (const o of q.objectives) {
      if (o.optional || objDoneIn(sp, n, o.id) || objType(q, o) !== 'raid' || hasChildren(q.objectives, o)) continue;
      for (const m of objMaps(q, o)) if (mapUnlocked(m, sp) && earlier.every(e => objMaps(q, e).includes(m))) add(m, { kind: 'quest', q, o });
      earlier.push(o);
    }
  }
  // Tour: the next raid step(s) – consecutive steps on the same map count together
  const tour = D.chapters?.['Tour'];
  if (tour && !sp.ch['Tour']) {
    let map = null;
    for (const o of tour.objectives) {
      if (o.optional || tourDoneIn(sp, o.id)) continue;
      const t = tourType(tour, o);
      if (t === 'parent') continue;
      if (t !== 'raid') break;
      const m = tourMap(tour, o);
      if (map && m !== map) break;
      map = m;
      if (mapUnlocked(m, sp)) add(m, { kind: 'tour', o });
    }
  }
  return cand;
}

function scoreMap(entries, sp) {
  let s = 0;
  const perQuest = {};
  for (const e of entries) {
    if (e.kind === 'tour') { s += 4; continue; }
    s += sp.active?.[e.q.name] ? 1.5 : 1;
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

export function planRaids({ maxRaids = 10, expPerRaid = 4000, lootNeeds = null } = {}) {
  const base = P();
  const lootBonus = lootBonusFn(lootNeeds);
  const sp = cloneProfile(base);
  let exp = expFor(sp.settings.level);
  const raids = [];
  const pre = { tour: [], done: [], loot: [] };
  autoAdvance(sp, pre);
  for (let r = 0; r < maxRaids; r++) {
    const cand = candidates(sp);
    const maps = Object.keys(cand);
    if (!maps.length) break;
    let best = null, bestScore = -1;
    for (const m of maps) {
      // an objective that allows several maps is only counted once per quest+objective
      const uniq = []; const seen = new Set();
      for (const e of cand[m]) { const k = e.kind === 'tour' ? 'T' + e.o.id : e.q.name + '|' + e.o.id; if (!seen.has(k)) { seen.add(k); uniq.push(e); } }
      cand[m] = uniq;
      const sc = scoreMap(uniq, sp) + lootBonus(m);
      if (sc > bestScore) { bestScore = sc; best = m; }
    }
    const entries = cand[best];
    const levelBefore = sp.settings.level;
    for (const e of entries) {
      if (e.kind === 'tour') sp.chObj[`Tour|${e.o.id}`] = 1;
      else sp.obj[`${e.q.name}|${e.o.id}`] = 1;
    }
    const log = { tour: [], done: [], loot: [] };
    autoAdvance(sp, log);
    // EXP only for quests actually finished through raid objectives – item/menu-only quests are assumed but not credited
    const hasRaidObj = (n) => { const q = D.quests[n]; return q.objectives.some(o => !o.optional && objType(q, o) === 'raid'); };
    const gained = log.done.filter(hasRaidObj).reduce((s, n) => s + (D.quests[n].exp || 0), 0) + expPerRaid;
    if (expPerRaid > 0) { exp += gained; sp.settings.level = Math.max(sp.settings.level, levelFor(exp)); }
    raids.push({ map: best, entries, turnIns: log.done, lootQuests: log.loot, tourAfter: log.tour, level: levelBefore, levelAfter: sp.settings.level, score: bestScore });
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

// ---------- stored plan (only recalculated on request) ----------
const PLAN_V = 1;
function progressSig(p) {
  const keys = (o) => Object.keys(o || {}).filter(k => o[k]).sort().join(',');
  const str = [keys(p.quests), keys(p.obj), keys(p.ch), keys(p.chObj), keys(p.active), JSON.stringify(p.hideout || {}), p.settings.level].join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h >>> 0);
}
function serializePlan(plan) {
  return {
    raids: plan.raids.map(r => ({ map: r.map, e: r.entries.map(e => (e.kind === 'tour' ? ['T', e.o.id] : [e.q.name, e.o.id])), t: r.turnIns, l: r.lootQuests || [], ta: r.tourAfter.map(o => o.id), lv: r.level, la: r.levelAfter })),
    pre: { tour: plan.prelude.tour.map(o => o.id), done: plan.prelude.done, loot: plan.prelude.loot },
    loot: plan.loot,
  };
}
function hydratePlan(d) {
  const tour = D.chapters?.['Tour'];
  const tobj = (id) => tour?.objectives.find(o => o.id === id) || null;
  const qobj = (n, id) => D.quests[n]?.objectives.find(o => o.id === id) || null;
  const q = (n) => !!D.quests[n];
  return {
    raids: d.raids.map(r => ({
      map: r.map,
      entries: r.e.map(([a, b]) => (a === 'T' ? (tobj(b) ? { kind: 'tour', o: tobj(b) } : null) : (qobj(a, b) ? { kind: 'quest', q: D.quests[a], o: qobj(a, b) } : null))).filter(Boolean),
      turnIns: r.t.filter(q), lootQuests: r.l.filter(q), tourAfter: r.ta.map(tobj).filter(Boolean), level: r.lv, levelAfter: r.la,
    })).filter(r => r.entries.length),
    prelude: { tour: d.pre.tour.map(tobj).filter(Boolean), done: d.pre.done.filter(q), loot: d.pre.loot.filter(q) },
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
  const entryDone = (e) => (e.kind === 'tour' ? !!p.ch['Tour'] || !!p.chObj['Tour|' + e.o.id] : isDone(e.q.name, p) || !!p.obj[e.q.name + '|' + e.o.id]);
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
  const bring = (r) => {
    const items = {};
    for (const e of r.entries) {
      if (e.kind !== 'quest') continue;
      if (e.o.kind === 'mark' || e.o.kind === 'place' || e.o.kind === 'use') for (const it of e.o.items || []) { const a = items[it.item] || (items[it.item] = { item: it.item, count: 0 }); a.count += it.count || 1; }
      for (const nd of e.q.needs || []) if (/key/i.test(D.items[nd.item]?.type || nd.item) && nd.objectives?.includes(e.o.id)) items[nd.item] = items[nd.item] || { item: nd.item, count: 1 };
    }
    return Object.values(items);
  };
  root.innerHTML = `
  <div class="tab-head"><div><h1>Speedrun Guide</h1><p class="lede">Your next raids, planned from your current progress: every objective that can be done on the same map is bundled into one raid – across all traders and the Tour chapter. Tick objectives here or anywhere else – the plan stays put until you press <b>Recalculate</b>.</p></div>
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
  ${plan.prelude.tour.length || plan.prelude.done.length || plan.prelude.loot.length ? `<section class="panel sr-pre"><div class="panel-h"><h2>Right now, before your next raid</h2></div>
    ${plan.prelude.tour.length ? `<div class="sub-h">Tour steps at the traders</div><ul class="plain">${plan.prelude.tour.map(o => `<li>${o.html}</li>`).join('')}</ul>` : ''}
    ${plan.prelude.loot.length ? `<div class="sub-h">Collect the items and hand in</div><div class="chips">${plan.prelude.loot.map(n => `<span class="chip">${traderImg(D.quests[n].trader, 'chip-img')}${qlink(n)}</span>`).join('')}</div>` : ''}
    ${plan.prelude.done.length ? `<div class="sub-h">Quests you can hand in</div><div class="chips">${plan.prelude.done.map(n => `<span class="chip">${traderImg(D.quests[n].trader, 'chip-img')}${qlink(n)}</span>`).join('')}</div>` : ''}</section>` : ''}
  <ol class="raids">${plan.raids.map((r, i) => {
    const groups = [];
    const tourE = r.entries.filter(e => e.kind === 'tour');
    const byQ = {};
    for (const e of r.entries) if (e.kind === 'quest') (byQ[e.q.name] = byQ[e.q.name] || []).push(e.o);
    const br = bring(r);
    const lt = raidLoot[i];
    const ltTop = lt.filter(x => x.prio >= 2).slice(0, 8);
    const ltRest = lt.filter(x => !ltTop.includes(x)).slice(0, 30);
    const rDone = raidDone(r);
    return `<li class="raid ${rDone ? 'raid-done' : ''}">
      <div class="raid-h"><span class="raid-n">${i + 1}</span><div class="raid-t"><h2>${esc(r.map)}${rDone ? ' <span class="badge b-done">' + icon('check') + 'Done</span>' : ''}</h2><div class="small muted">${r.entries.length} objective${r.entries.length > 1 ? 's' : ''} · ${Object.keys(byQ).length} quest${Object.keys(byQ).length !== 1 ? 's' : ''}${tourE.length ? ' + Tour' : ''} · est. level ${r.level}${r.levelAfter > r.level ? ` → ${r.levelAfter}` : ''}</div></div>
        <button class="btn btn-s" data-act="map" data-map="${attr(r.map)}">${icon('map')} Map</button></div>
      ${br.length ? `<div class="raid-bring"><span class="small muted">Bring:</span> ${br.map(b => itemChip(b.item, { count: b.count, small: true })).join('')}</div>` : ''}
      <div class="raid-b">
        ${tourE.length ? `<div class="raid-q tour-q"><div class="raid-qh">${icon('flag')} <b>Tour</b> <span class="small muted">story chapter</span></div><ul class="objs">${tourE.map(e => `<li class="obj"><button class="cb cb-s ${p.chObj['Tour|' + e.o.id] ? 'on' : ''}" data-act="chobj" data-q="Tour" data-o="${e.o.id}" aria-label="Toggle">${icon('check')}</button><span class="obj-t">${e.o.html}</span></li>`).join('')}</ul></div>` : ''}
        ${Object.entries(byQ).map(([n, objs]) => `<div class="raid-q"><div class="raid-qh">${traderImg(D.quests[n].trader, 'mp-tr')} ${qlink(n)} ${r.turnIns.includes(n) ? '<span class="badge b-av" data-tip="All raid objectives done after this raid – hand it in">finishes</span>' : ''}<button class="ibtn" data-act="info" data-q="${attr(n)}" aria-label="Info">${icon('info')}</button></div>
          <ul class="objs">${objs.map(o => `<li class="obj"><button class="cb cb-s ${p.obj[n + '|' + o.id] ? 'on' : ''}" data-act="obj" data-q="${attr(n)}" data-o="${o.id}" aria-label="Toggle">${icon('check')}</button><span class="obj-t">${o.html}${o.kind === 'kill' && /\b([5-9]|\d{2,})\b/.test(o.text) ? ' <span class="small muted">(may need more than one raid)</span>' : ''}</span></li>`).join('')}</ul></div>`).join('')}
      </div>
      ${lt.length ? `<div class="raid-loot"><div class="raid-lh">${icon('box')} <span class="small"><b>Grab on ${esc(r.map)}</b> – items you still need for quests / hideout that spawn here</span></div>
        ${ltTop.length ? `<div class="chips">${ltTop.map(x => lootChip(x, r.map)).join('')}</div>` : ''}
        ${ltRest.length ? `<details class="raid-more"><summary class="small">${ltTop.length ? 'More' : 'Items for later'} (${ltRest.length})</summary><div class="chips">${ltRest.map(x => lootChip(x, r.map)).join('')}</div></details>` : ''}</div>` : ''}
      ${r.turnIns.length || r.tourAfter.length || r.lootQuests?.length ? `<div class="raid-after"><span class="small muted">After the raid:</span> ${r.tourAfter.length ? `<span class="small">Tour: ${r.tourAfter.map(o => o.text).map(esc).join(' → ')}</span>` : ''} ${r.turnIns.length ? `<span class="small">hand in ${r.turnIns.map(n => qlink(n)).join(', ')}</span>` : ''}${r.lootQuests?.length ? ` <span class="small">· unlocked item quests: ${r.lootQuests.map(n => qlink(n)).join(', ')}</span>` : ''}</div>` : ''}
    </li>`;
  }).join('') || '<div class="empty">Nothing to plan – every available quest objective is done, or the next quests need a higher level / trader loyalty.</div>'}</ol>
  ${lootPlanHtml(plan, needs, raidLoot, ld)}
  <p class="small muted">How it's planned: from your ticked progress the planner simulates raid by raid. Each raid picks the map where you can do the most objectives, preferring Tour steps (they unlock traders and maps) and objectives that finish a quest. After each raid it hands in finished quests and estimates your level from quest EXP plus the EXP-per-raid setting. Objectives that allow several maps are assigned to one of them. When two maps are about equal, the one where more of your needed items can spawn wins. Item spawns: loose-loot spots and container positions from tarkov.dev, container contents from the wiki loot tables – spawns are random, so this tells you where your odds are best, not where an item is guaranteed. Computed in ${ms} ms.</p>`;
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
  const groups = IX.traders.map(t => {
    const names = (IX.byTrader[t] || []).filter(n => visible(D.quests[n], p) && (!q || n.toLowerCase().includes(q)));
    if (!names.length) return '';
    return `<div class="as-g"><div class="sub-h">${traderImg(t, 'mp-tr')} ${esc(t)}</div>${names.map(n => {
      const done = isDone(n, p), on = !!act[n] && !done;
      return `<label class="as-row ${done ? 'is-done' : ''} ${on ? 'on' : ''}"><input type="checkbox" data-active="${attr(n)}" ${on ? 'checked' : ''}> <span>${esc(n)}</span>${done ? ' <span class="small muted">done</span>' : ''}</label>`;
    }).join('')}</div>`;
  }).join('');
  openPanel(`${icon('list', 'dr-ic')}<span>My open quests</span>`, `
    <p class="small">Tick every quest that is <b>currently open</b> in your trader task lists. When you press <b>Apply</b>, every quest those depend on (including earlier parts of the same series and the Tour steps that unlock their trader/map) is marked as done – so you never have to tick finished quests one by one.</p>
    <div class="as-bar">
      <label class="search">${icon('search')}<input type="search" data-as="q" placeholder="Search quest name" value="${attr(store.ui.asq || '')}" aria-label="Search quests"></label>
      <span class="small"><b>${nAct}</b> selected</span>
    </div>
    <div class="as-actions">
      <button class="btn btn-p" data-act="active-apply" data-mode="replace" data-tip="Clears your done list and rebuilds it from the open quests">Apply – rebuild my progress</button>
      <button class="btn" data-act="active-apply" data-mode="merge" data-tip="Keeps everything you already ticked and adds what the open quests imply">Apply – keep my ticks</button>
      <button class="btn" data-act="active-apply" data-mode="strict" data-tip="Use this if you ticked EVERY quest in the task list of those traders: anything the tracker thinks is available for them but you did not tick is counted as finished">Apply – list is complete per trader</button>
      <button class="btn btn-s" data-act="active-clear">Clear selection</button>
    </div>
    <div class="as-list">${groups || '<div class="empty small">No quest matches.</div>'}</div>`);
}
