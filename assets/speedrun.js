// Speedrun planner: simulates your progression raid by raid and bundles every quest objective
// (all traders + all story chapters) that can be done on the same map into one raid.
import { store } from './store.js';
import { D, IX, P, mode, visible, questStatus, isDone, mapUnlocked, traderUnlocked, traderLL, varNeed, condStatus, hLevel, focusQuests, focusGates, helpsFocus } from './model.js';
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
  if (maps.length) return 'raid';
  // eliminate / extract / … "on any location": needs a raid, just not a particular map
  if (RAID_KINDS.has(o.kind)) return 'any';
  // "Shoot a target from over 40 m", "Gain the Fatigue status effect" – in a raid; hand-ins / "Return to the hideout" are not
  if (o.kind === 'other' && !/^(hand ?over|return|do not|don't)\b/i.test(o.text || '')) return 'any';
  return 'menu';
}
const IN_RAID = new Set(['raid', 'any', 'flex']);
// work outside a raid that only you can do: hand over / find items, build a weapon, sell … ("Do not kill X" and talking
// to the trader need nothing)
const outsideWork = (q, o) => !IN_RAID.has(objType(q, o)) && o.kind !== 'talk' && !/^(do not|don't|without)\b/i.test(o.text || '');
const reqObjs = (q) => q.objectives.filter(o => !o.optional && !hasReqKids(q.objectives, o));
// a quest objective whose sub-steps are all optional is itself the thing to do ("Mark any ATM" + optional locations)
const hasReqKids = (list, o) => list.some(x => x.parent === o.id && !x.optional);
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
  // keys that belong to the spot on a given map (the unlock text lists one line per location)
  const keysByMap = {}, htmlByMap = {};
  for (const line of c.reqHtml || []) {
    const ls = linksIn(line);
    for (const m of ls.filter(t => IX.maps.includes(t))) { keysByMap[m] = [...new Set([...(keysByMap[m] || []), ...ls.filter(t => keys.includes(t))])]; htmlByMap[m] = htmlByMap[m] ? htmlByMap[m] + '<br>' + line : line; }
  }
  return (c._start = { maps, keys, keysByMap, htmlByMap, html: first, tour: /data-t="Tour"/.test(txt), ic: (txt.match(/Intelligence Center level (\d)/i) || [])[1] });
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
  // a step whose sub-steps are all optional ("Locate the traces …" + optional spots on several maps): where they are
  const kids = c.objectives.filter(x => x.parent === o.id);
  if (kids.length && kids.every(x => x.optional)) { const k = kids.find(x => x.maps?.length); if (k) return k.maps[0]; }
  if (c.name !== 'Tour' || !(RAID_KINDS.has(o.kind) || o.kind === 'find' || o.kind === 'other')) return null;
  // Tour objectives without a map link inherit the map of the next mapped step (e.g. the Terminal intercom → Shoreline)
  const i = c.objectives.indexOf(o);
  for (let k = i + 1; k < c.objectives.length; k++) { const x = c.objectives[k]; if (x.maps?.length && RAID_KINDS.has(x.kind)) return x.maps[0]; }
  return null;
}
const MODS = () => D.hideout.modules.map(m => m.name);
const MENU_TXT = /^(\(optional\)\s*)?(learn|find out|ask|talk|tell|report|wait|figure out|decide|choose|read|hand over|pay|give|return to the hideout|return to)/i;
// hand-in of things you may not have yet (found-in-raid items, money, dogtags …) – not the story item picked up in an
// earlier step ("Hand over the flash drive to Prapor")
function chNeedsItems(c, o) {
  if (!(o.kind === 'handover' || /^hand over/i.test(o.text || ''))) return false;
  if (o.fir || /found in raid/i.test(o.text || '')) return true;
  const before = c.objectives.slice(0, c.objectives.indexOf(o));
  return (o.items || []).some(i => !D.items[i.item]?.questItem && !before.some(x => (x.items || []).some(j => j.item === i.item)));
}
// 'parent' | 'menu' (done at a trader / hideout) | 'items' (hand-in of items you may not have) | 'raid' (on a map) |
// 'block' (hideout level / loyalty still missing) | 'unmapped' (in raid, map unknown)
function chStepType(c, o, sp) {
  const kids = c.objectives.filter(x => x.parent === o.id);
  if (kids.some(x => !x.optional)) return 'parent';
  const t = o.text || '';
  const hm = t.match(new RegExp(`(${MODS().join('|')})\\s*level\\s*(\\d)`, 'i'));
  if (hm && /obtain|build|construct|upgrade|reach/i.test(t)) { const mod = MODS().find(m => m.toLowerCase() === hm[1].toLowerCase()); return hLevel(mod, sp) >= +hm[2] ? 'menu' : 'block'; }
  const lm = t.match(/Loyalty Level (\d) with (\w[\w ]*)/i);
  if (lm) { const tr = Object.keys(D.traders).find(x => lm[2].toLowerCase().startsWith(x.toLowerCase())); return tr && traderLL(tr, sp) >= +lm[1] ? 'menu' : 'block'; }
  // only optional sub-steps ("Find out what Kozlov was involved in" + optional "Access Kozlov's room"): the step happens
  // where they happen
  if (kids.length && !MENU_KINDS.has(o.kind) && kids.some(x => ['raid', 'unmapped'].includes(chStepType(c, x, sp)))) return chMap(c, o) ? 'raid' : 'unmapped';
  if (chNeedsItems(c, o)) return 'items';
  // "Read the note on Kozlov's door" is read in the raid, "Read the transcript …" in your stash
  if (MENU_KINDS.has(o.kind) || (MENU_TXT.test(t) && !/^read\b.*\b(on|in)\b/i.test(t))) return 'menu';
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

// Complete what happens at the traders without anything from you: story talk/hand-in steps and quests whose objectives are
// all done. Quests that still need items / a weapon build are NOT assumed (you may not have the items) – except quests
// whose raid part the plan itself just finished (sp._raided): those are handed in after that raid, items included.
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
        if (t === 'items') { if (log?.storyItems && !log.storyItems.some(b => b.c === cn)) log.storyItems.push({ c: cn, o }); break; }
        if (t === 'block' || t === 'unmapped') { if (log?.blocked && !log.blocked.some(b => b.c === cn)) log.blocked.push({ c: cn, o, t }); break; }
        sp.chObj[`${cn}|${o.id}`] = 1; changed = true;
        log?.story.push({ c: cn, o });
      }
      if (c.objectives.every(o => o.optional || !applies(o, sp) || chDoneIn(sp, cn, o.id))) { sp.ch[cn] = 1; changed = true; }
    }
    // quests: every raid objective done → hand it in (items too, if the plan finished its raid part)
    for (const n of IX.order) {
      const q = D.quests[n];
      if (sp.quests[n] || !visible(q, sp) || karmaQuest(q)) continue;
      if (questStatus(q, sp).s !== 'available') continue;
      const left = reqObjs(q).filter(o => !objDoneIn(sp, n, o.id));
      if (left.some(o => IN_RAID.has(objType(q, o)))) continue;
      const items = left.some(o => outsideWork(q, o));
      if (items && !sp._raided?.has(n)) continue;
      sp.quests[n] = 1; changed = true;
      if (items) log?.loot.push(n); else log?.done.push(n);
    }
  }
}

function candidates(sp, { anyMap = false } = {}) {
  const cand = {}; // map -> [{kind:'quest'|'ch'|'start', …}]
  const add = (m, e) => { (cand[m] = cand[m] || []).push(e); };
  const allMaps = anyMap ? IX.maps.filter(m => mapUnlocked(m, sp) && !/arena/i.test(m)) : [];
  for (const n of IX.order) {
    const q = D.quests[n];
    if (sp.quests[n] || !visible(q, sp) || karmaQuest(q) || questStatus(q, sp).s !== 'available') continue;
    const earlier = []; // undone raid objectives before this one: a later step can only share their raid (same map)
    for (const o of q.objectives) {
      if (anyMap && !o.optional && !objDoneIn(sp, n, o.id) && !hasReqKids(q.objectives, o)) {
        // planner: objectives for any map / one of several maps ride along in whichever raid fits best
        const t = objType(q, o);
        if (t === 'any') { for (const m of allMaps) add(m, { kind: 'quest', q, o, w: 0.3, any: true }); continue; }
        if (t === 'flex') { const ms = (q.maps || []).filter(m => mapUnlocked(m, sp)); for (const m of ms) add(m, { kind: 'quest', q, o, w: 1 / Math.sqrt(Math.max(1, ms.length)) }); continue; }
      }
      if (o.optional || objDoneIn(sp, n, o.id) || objType(q, o) !== 'raid' || hasReqKids(q.objectives, o)) continue;
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

// Story + Kappa first: side quests only tip the balance (a little more when they count toward a loyalty group a
// Kappa task still waits for)
const questWeight = (q, fx) => (!fx ? 1 : fx.focus.has(q.name) ? 1 : helpsFocus(q, fx.gates) ? 0.45 : 0.18);
function scoreMap(entries, sp, fx = null) {
  let s = 0;
  const perQuest = {};
  for (const e of entries) {
    if (e.kind === 'ch') { s += 4; continue; }
    if (e.kind === 'start') { s += 6; continue; }
    s += (sp.active?.[e.q.name] ? 1.5 : 1) * (e.w ?? 1) * questWeight(e.q, fx);
    (perQuest[e.q.name] = perQuest[e.q.name] || []).push(e.o.id);
  }
  for (const [n, ids] of Object.entries(perQuest)) {
    const q = D.quests[n];
    const left = q.objectives.filter(o => !o.optional && !hasReqKids(q.objectives, o) && IN_RAID.has(objType(q, o)) && !objDoneIn(sp, n, o.id) && !ids.includes(o.id));
    if (!left.length) s += (1.5 + Math.min(2, (IX.graph.normal.dep[n]?.size || 0) * 0.3)) * questWeight(q, fx); // finishes the quest → unlocks follow-ups
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

// open quests (available now) with nothing left to do in a raid – only items to find / hand over, a weapon to build, …
// They're not part of the raid plan: you hand them in whenever you have the items.
export function itemQuests(p) {
  const out = [];
  for (const n of IX.order) {
    const q = D.quests[n];
    if (isDone(n, p) || !visible(q, p) || karmaQuest(q) || questStatus(q, p).s !== 'available') continue;
    const left = reqObjs(q).filter(o => !objDoneIn(p, n, o.id));
    if (!left.length || left.some(o => IN_RAID.has(objType(q, o))) || !left.some(o => outsideWork(q, o))) continue;
    out.push(n);
  }
  return out;
}

const ekey = (e) => (e.kind === 'ch' ? `C${e.c}|${e.o.id}` : e.kind === 'start' ? `S${e.c}` : `${e.q.name}|${e.o.id}`);
export function planRaids({ maxRaids = 10, expPerRaid = 4000, lootNeeds = null } = {}) {
  const base = P();
  const lootBonus = lootBonusFn(lootNeeds);
  const sp = cloneProfile(base);
  sp._raided = new Set();
  let exp = expFor(sp.settings.level);
  const raids = [];
  const pre = { story: [], done: [], loot: [], blocked: [], storyItems: [] };
  autoAdvance(sp, pre);
  pre.items = itemQuests(base);
  const focus = focusQuests(base);
  for (let r = 0; r < maxRaids; r++) {
    const fx = { focus, gates: focusGates(sp, focus) };
    const cand = candidates(sp, { anyMap: true });
    const maps = Object.keys(cand);
    if (!maps.length) break;
    let best = null, bestScore = -1;
    for (const m of maps) {
      const uniq = []; const seen = new Set();
      for (const e of cand[m]) { const k = ekey(e); if (!seen.has(k)) { seen.add(k); uniq.push(e); } }
      cand[m] = uniq;
      const sc = scoreMap(uniq, sp, fx) + lootBonus(m);
      if (sc > bestScore) { bestScore = sc; best = m; }
    }
    const entries = cand[best];
    const levelBefore = sp.settings.level;
    for (const e of entries) {
      if (e.kind === 'ch') sp.chObj[`${e.c}|${e.o.id}`] = 1;
      else if (e.kind === 'start') sp.chStart[e.c] = 1;
      else { sp.obj[`${e.q.name}|${e.o.id}`] = 1; sp._raided.add(e.q.name); }
    }
    const log = { story: [], done: [], loot: [], blocked: [], storyItems: [] };
    autoAdvance(sp, log);
    // EXP only for quests actually finished through raid objectives – item/menu-only quests are assumed but not credited
    const hasRaidObj = (n) => { const q = D.quests[n]; return q.objectives.some(o => !o.optional && IN_RAID.has(objType(q, o))); };
    const gained = [...log.done, ...log.loot].filter(hasRaidObj).reduce((s, n) => s + (D.quests[n].exp || 0), 0) + expPerRaid;
    if (expPerRaid > 0) { exp += gained; sp.settings.level = Math.max(sp.settings.level, levelFor(exp)); }
    raids.push({ map: best, entries, turnIns: log.done, lootQuests: log.loot, storyAfter: log.story, level: levelBefore, levelAfter: sp.settings.level, score: bestScore });
    for (const b of log.blocked) if (!pre.blocked.some(x => x.c === b.c)) pre.blocked.push({ ...b, after: r + 1 });
    for (const b of log.storyItems) if (!pre.storyItems.some(x => x.c === b.c)) pre.storyItems.push({ ...b, after: r + 1 });
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
    if (e.kind === 'start') { const st = chapterStart(D.chapters[e.c]); const ks = st.keysByMap[r.map] || []; for (const k of ks) keys[k] = keys[k] || { item: k, count: 1, alt: ks.length > 1 }; continue; }
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
const PLAN_V = 5;
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
    pre: { story: plan.prelude.story.map(serS), done: plan.prelude.done, items: plan.prelude.items || [], si: (plan.prelude.storyItems || []).map(b => [b.c, b.o.id, b.after || 0]), blocked: plan.prelude.blocked.map(b => [b.c, b.o.id, b.t, b.after || 0]) },
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
    prelude: { story: d.pre.story.map(hs).filter(Boolean), done: d.pre.done.filter(q), loot: [], items: (d.pre.items || []).filter(q), storyItems: (d.pre.si || []).map(([c, id, after]) => (cobj(c, id) ? { c, o: cobj(c, id), after } : null)).filter(Boolean), blocked: d.pre.blocked.map(([c, id, t, after]) => (cobj(c, id) ? { c, o: cobj(c, id), t, after } : null)).filter(Boolean) },
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
  (plan.prelude.items || []).forEach(n => soon.add(n));
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
  <div class="notice">${icon('list')}<div>Quicker than ticking finished quests: <b>tell the tracker which quests are open in your game</b> – paste screenshots of your task lists or tick them per trader – and it marks everything before them as done. <button class="btn btn-s btn-p" data-act="active-setup">Set my open quests</button></div></div>
  <div class="filters">
    <span class="small muted">Plan</span>
    <div class="seg" role="radiogroup" aria-label="Number of raids">${[5, 10, 20, 40].map(n => `<button role="radio" aria-checked="${ui.n === n}" class="seg-b ${ui.n === n ? 'on' : ''}" data-act="sr" data-k="n" data-v="${n}">${n} raids</button>`).join('')}</div>
    <span class="small muted" data-tip="EXP you earn per raid besides quest rewards (kills, looting, survival). Used to estimate when level-gated quests unlock. 'off' keeps your current level for the whole plan.">Level-ups</span>
    <div class="seg" role="radiogroup" aria-label="EXP per raid">${[[0, 'off'], [1500, 'low'], [4000, 'normal'], [8000, 'high']].map(([v, l]) => `<button role="radio" aria-checked="${ui.exp === v}" class="seg-b ${ui.exp === v ? 'on' : ''}" data-act="sr" data-k="exp" data-v="${v}">${l}</button>`).join('')}</div>
    <button class="btn ${stale ? 'btn-p' : ''}" data-act="sr-recalc" data-tip="Plan again from your current progress">${icon('refresh')} Recalculate</button>
    <span class="small muted">planned ${agoText(stored.at)}</span>
  </div>
  ${Object.keys(p.active || {}).some(n => p.active[n] && D.quests[n]) && p.settings.fullList !== 2 ? `<div class="notice">${icon('refresh')}<div>Your open quests were entered with an older version. <b>Apply them once more</b> (Set my open quests → Apply – this is my full task list): then only they count as available and quests you can't have leave the plan. <button class="btn btn-s btn-p" data-act="active-setup">Open</button></div></div>` : ''}
  ${(() => { const no = Object.keys(p.notOpen || {}).filter(n => p.notOpen[n] && D.quests[n] && !isDone(n, p) && !p.active?.[n] && visible(D.quests[n], p)); return no.length ? `<div class="notice">${icon('info')}<div><b>${no.length}</b> quest${no.length > 1 ? 's' : ''} that were not in your task list stay out of the plan (finished or not unlocked yet – the list can't tell). <button class="btn btn-s" data-act="active-setup">Resolve them</button></div></div>` : ''; })()}
  ${stale ? `<div class="notice sr-stale">${icon('refresh')}<div>Your progress changed since this plan was made. Ticks show up here, but the raid order stays as it is until you press <b>Recalculate</b>. <button class="btn btn-s btn-p" data-act="sr-recalc">Recalculate now</button></div></div>` : ''}
  ${pr.story.length || pr.done.length ? `<section class="panel sr-pre"><div class="panel-h"><h2>Right now, before your next raid</h2><span class="small muted">only trader visits – nothing here needs items you don't have</span></div>
    ${pr.story.length ? `<div class="sub-h">Story steps at the traders</div><div class="sr-story">${storySteps(pr.story)}</div>` : ''}
    ${pr.done.length ? `<div class="sub-h">Ready to hand in <span class="small muted">– every objective is ticked</span></div><div class="chips">${qChips(pr.done, p)}</div>` : ''}
    </section>` : ''}
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
      <div class="raid-h"><span class="raid-n">${i + 1}</span><div class="raid-t"><h2>${esc(r.map)}${story ? ' <span class="badge b-story">Storyline</span>' : ''}${rDone ? ' <span class="badge b-done">' + icon('check') + 'Done</span>' : ''}</h2><div class="small muted">${r.entries.length} objective${r.entries.length > 1 ? 's' : ''} · ${(() => { const f = focusQuests(p); const ks = Object.keys(byQ); const nf = ks.filter(n => f.has(n)).length, ns = ks.length - nf; return `${nf} Kappa${p.settings.goal?.lightkeeper ? '/LK' : ''} quest${nf !== 1 ? 's' : ''}${ns ? ` <span class="side-n">+ ${ns} side</span>` : ''}`; })()}${Object.keys(byC).length ? ` + ${Object.keys(byC).join(', ')}` : ''} · est. level ${r.level}${r.levelAfter > r.level ? ` → ${r.levelAfter}` : ''}</div></div>
        <button class="btn btn-s" data-act="map" data-map="${attr(r.map)}">${icon('map')} Map</button></div>
      ${bringHtml(br)}
      <div class="raid-b">${raidBodyHtml(r, p)}</div>
      ${lt.length ? `<div class="raid-loot"><div class="raid-lh">${icon('box')} <span class="small"><b>Grab on ${esc(r.map)}</b> – items you still need for quests / hideout that spawn here</span></div>
        ${ltTop.length ? `<div class="chips">${ltTop.map(x => lootChip(x, r.map)).join('')}</div>` : ''}
        ${ltRest.length ? `<details class="raid-more"><summary class="small">${ltTop.length ? 'More' : 'Items for later'} (${ltRest.length})</summary><div class="chips">${ltRest.map(x => lootChip(x, r.map)).join('')}</div></details>` : ''}</div>` : ''}
      ${r.turnIns.length || r.storyAfter.length || r.lootQuests?.length ? `<div class="raid-after"><span class="small muted">After the raid:</span> ${storySteps(r.storyAfter)} ${r.turnIns.length ? `<span class="small">hand in ${qNames(r.turnIns, p)}</span>` : ''}${r.lootQuests?.length ? ` <span class="small" data-tip="The raid part is done after this raid – they also need items (see the loot plan). The plan assumes you hand them in now.">${r.turnIns.length ? '· ' : ''}hand in once you have the items: ${qNames(r.lootQuests, p)}</span>` : ''}</div>` : ''}
    </li>`;
  }).join('') || '<div class="empty">Nothing to plan – every available quest objective is done, or the next quests need a higher level / trader loyalty.</div>'}</ol>
  ${pr.blocked.length ? `<section class="panel sr-blk"><div class="panel-h"><h2>Story steps the plan can't place</h2><span class="small muted">no map on the wiki page, or a hideout level / trader loyalty is missing – check the guide and do them on the way</span></div><ul class="sr-blocked">${pr.blocked.map(b => `<li>${chIcon(b.c)} <b>${esc(b.c)}</b>: ${b.o.html} <span class="small muted">${b.t === 'block' ? '– needs a hideout level / trader loyalty first' : '– location not on the wiki page, see the guide'}${b.after ? ` (reached after raid ${b.after})` : ''}</span> <button class="btn btn-s" data-act="info-ch" data-c="${attr(b.c)}">${icon('info')} Guide</button></li>`).join('')}</ul></section>` : ''}
  ${itemQuestsHtml(pr.items || [], pr.storyItems || [], p)}
  ${lootPlanHtml(plan, needs, raidLoot, ld)}
  <p class="small muted">How it's planned: from your ticked progress the planner simulates raid by raid. Each raid picks the map where you get the most done: storyline starts count most (so you pick up every storyline as early as possible), then story steps, then quest objectives – an objective that is possible on several maps counts less than one that only works on this map, and objectives that finish a quest count extra. After each raid it hands in finished quests and estimates your level from quest EXP plus the EXP-per-raid setting. When two maps are about equal, the one where more of your needed items can spawn wins. Item spawns: loose-loot spots and container positions from tarkov.dev, container contents from the wiki loot tables. Computed in ${ms} ms.</p>`;
}

// open quests without a raid part: not in the raid plan, hand them in whenever you have the items
function itemQuestsHtml(names, storyItems, p) {
  const list = names.filter(n => D.quests[n] && !isDone(n, p));
  const si = storyItems.filter(b => !p.ch[b.c] && !p.chObj[`${b.c}|${b.o.id}`]);
  if (!list.length && !si.length) return '';
  const f = focusQuests(p);
  const dep = IX.graph[mode()]?.dep || IX.graph.normal.dep;
  const what = (q) => { const left = reqObjs(q).filter(o => !objDoneIn(p, q.name, o.id) && outsideWork(q, o)); return left.some(o => o.kind === 'build') ? 'weapon build' : left.some(o => o.kind === 'sell') ? 'sell items' : 'items'; };
  const chip = (n) => {
    const q = D.quests[n];
    const nx = [...(dep[n] || [])].filter(x => D.quests[x] && visible(D.quests[x], p));
    const raidDone = reqObjs(q).some(o => IN_RAID.has(objType(q, o)));
    return `<span class="chip ${f.has(n) ? '' : 'side'}" data-tip="${attr(`${raidDone ? 'Raid part done – ' : ''}needs ${what(q)}${nx.length ? ` · unlocks ${nx.join(', ')}` : ''}`)}">${traderImg(q.trader, 'chip-img')}${qlink(n)} <span class="small muted">${what(q)}${nx.length ? ` · unlocks ${nx.length}` : ''}</span></span>`;
  };
  const fo = list.filter(n => f.has(n)), so = list.filter(n => !f.has(n));
  return `<section class="panel sr-items"><div class="panel-h"><h2>Item hand-ins – no raid needed</h2><span class="small muted">Hand them in whenever you have the items – they're not part of the raid plan. What comes after them joins the plan once you tick them and press Recalculate.</span></div>
    ${si.length ? `<div class="sub-h">Story</div><ul class="sr-blocked sr-si">${si.map(b => `<li><button class="cb cb-s" data-act="chobj" data-q="${attr(b.c)}" data-o="${b.o.id}" aria-label="Tick">${icon('check')}</button>${chIcon(b.c)} <b>${esc(b.c)}</b>: ${b.o.html}${b.after ? ` <span class="small muted">(reached after raid ${b.after})</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${fo.length ? `<div class="sub-h">Quests – open now</div><div class="chips">${fo.map(chip).join('')}</div>` : ''}
    ${so.length ? `<div class="raid-side-h"><span>Side quests</span> <span class="small">open now · not needed for Story / Kappa${p.settings.goal?.lightkeeper ? ' / Lightkeeper' : ''}</span></div><div class="chips">${so.map(chip).join('')}</div>` : ''}</section>`;
}

// ---------- shared raid blocks (Speedrun cards + In-Raid view) ----------
export function bringHtml(br) {
  if (!br.items.length && !br.wear.length && !br.keys.length) return '';
  return `<div class="raid-bring">${br.items.length ? `<span class="small muted">Bring:</span> ${br.items.map(b => itemChip(b.item, { count: b.count, small: true })).join('')}` : ''}${br.wear.length ? ` <span class="small muted">Wear / use:</span> ${br.wear.map(b => itemChip(b.item, { small: true })).join('')}` : ''}${br.keys.length ? ` <span class="small muted">Keys:</span> ${br.keys.map(b => itemChip(b.item, { small: true })).join('')}${br.keys.some(k => k.alt) ? ' <span class="small muted">(one of them)</span>' : ''}` : ''}</div>`;
}
const objLi = (n, o, p) => { const anyMap = objType(D.quests[n], o) === 'any'; return `<li class="obj"><button class="cb cb-s ${p.obj[n + '|' + o.id] ? 'on' : ''}" data-act="obj" data-q="${attr(n)}" data-o="${o.id}" aria-label="Toggle">${icon('check')}</button><span class="obj-t">${o.html}${anyMap ? ' <span class="badge b-muted" data-tip="Works on any map – planned into this raid">any map</span>' : ''}${o.kind === 'kill' && /\b([5-9]|\d{2,})\b/.test(o.text) ? ' <span class="small muted">(may need more than one raid)</span>' : ''}</span></li>`; };
// Story + Kappa first; side quests below in their own colour
const isSide = (n, f) => !f.has(n);
const sideTip = 'Side quest – not needed for the story or Kappa';
function qChips(names, p) {
  const f = focusQuests(p);
  return [...names.filter(n => f.has(n)), ...names.filter(n => !f.has(n))].map(n => `<span class="chip ${f.has(n) ? '' : 'side'}" ${f.has(n) ? '' : `data-tip="${attr(sideTip + (p.settings.goal?.lightkeeper ? ' or Lightkeeper' : ''))}"`}>${traderImg(D.quests[n].trader, 'chip-img')}${qlink(n)}</span>`).join('');
}
function qNames(names, p) {
  const f = focusQuests(p);
  return [...names.filter(n => f.has(n)).map(n => qlink(n)), ...names.filter(n => !f.has(n)).map(n => `<span class="side-n">${qlink(n)}</span>`)].join(', ');
}
const questBlock = (n, objs, p, badges = '', side = false) => `<div class="raid-q ${side ? 'side' : ''}"><div class="raid-qh">${traderImg(D.quests[n].trader, 'mp-tr')} ${qlink(n)} ${notYet(n, p)}${badges}<button class="ibtn" data-act="info" data-q="${attr(n)}" aria-label="Info">${icon('info')}</button></div>
  <ul class="objs">${objs.map(o => objLi(n, o, p)).join('')}</ul></div>`;
export function raidBodyHtml(r, p, { anywhere = [] } = {}) {
  const startE = r.entries.filter(e => e.kind === 'start');
  const byC = {}; for (const e of r.entries) if (e.kind === 'ch') (byC[e.c] = byC[e.c] || []).push(e.o);
  const byQ = {}; for (const e of r.entries) if (e.kind === 'quest') (byQ[e.q.name] = byQ[e.q.name] || []).push(e.o);
  const byA = {}; for (const e of anywhere) (byA[e.q.name] = byA[e.q.name] || []).push(e.o);
  return `${startE.map(e => { const c = D.chapters[e.c]; const st = chapterStart(c); return `<div class="raid-q story-q"><div class="raid-qh">${chIcon(e.c)} <b>Start storyline: ${esc(e.c)}</b><button class="ibtn" data-act="info-ch" data-c="${attr(e.c)}" aria-label="Guide">${icon('info')}</button></div><div class="small">${st.html}${st.htmlByMap[r.map] && st.htmlByMap[r.map] !== st.html ? `<br>${st.htmlByMap[r.map]}` : ''}</div><button class="btn btn-s ${chapterStarted(c, p) ? 'on' : ''}" data-act="ch-start" data-c="${attr(e.c)}">${chapterStarted(c, p) ? 'Started ✓' : 'I picked it up – mark as started'}</button></div>`; }).join('')}
    ${Object.entries(byC).map(([c, objs]) => `<div class="raid-q story-q"><div class="raid-qh">${chIcon(c)} <b>${esc(c)}</b> <span class="small muted">story chapter</span><button class="ibtn" data-act="info-ch" data-c="${attr(c)}" aria-label="Guide">${icon('info')}</button></div><ul class="objs">${objs.map(o => `<li class="obj"><button class="cb cb-s ${p.chObj[c + '|' + o.id] ? 'on' : ''}" data-act="chobj" data-q="${attr(c)}" data-o="${o.id}" aria-label="Toggle">${icon('check')}</button><span class="obj-t">${o.html}</span></li>`).join('')}</ul></div>`).join('')}
    ${(() => {
      const f = focusQuests(p);
      const gates = focusGates(p, f);
      const fin = (n) => (r.turnIns.includes(n) ? '<span class="badge b-av" data-tip="All raid objectives done after this raid – hand it in">finishes</span>' : '');
      const anyB = '<span class="badge b-muted" data-tip="Can be done on any map">any map</span>';
      const help = (n) => (helpsFocus(D.quests[n], gates) ? '<span class="badge b-muted" data-tip="Counts toward the loyalty group a Kappa task is still waiting for">helps Kappa</span>' : '');
      const q = Object.entries(byQ), a = Object.entries(byA);
      const sq = q.filter(([n]) => isSide(n, f)), sa = a.filter(([n]) => isSide(n, f));
      return `${q.filter(([n]) => !isSide(n, f)).map(([n, objs]) => questBlock(n, objs, p, fin(n))).join('')}
        ${a.filter(([n]) => !isSide(n, f)).map(([n, objs]) => questBlock(n, objs, p, anyB)).join('')}
        ${sq.length || sa.length ? `<div class="raid-side-h"><span>Side quests</span> <span class="small">not needed for Story / Kappa${p.settings.goal?.lightkeeper ? ' / Lightkeeper' : ''} – do them when they're on the way</span></div>
          ${sq.map(([n, objs]) => questBlock(n, objs, p, fin(n) + help(n), true)).join('')}${sa.map(([n, objs]) => questBlock(n, objs, p, anyB + help(n), true)).join('')}` : ''}`;
    })()}`;
}

// ---------- In-Raid view: everything you can do on one map right now ----------
const normM = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function mapTodo(map, { bosses = null } = {}) {
  const p = P();
  const sp = cloneProfile(p);
  autoAdvance(sp, null); // story talk / hand-in steps count as done (they happen at the traders)
  const cand = candidates(sp);
  const avail = (e) => e.kind !== 'quest' || (!isDone(e.q.name, p) && questStatus(e.q, p).s === 'available');
  const dedup = (list) => { const seen = new Set(); return (list || []).filter(e => { const k = ekey(e); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const focus = focusQuests(p);
  const maps = Object.keys(cand).map(m => { const es = dedup(cand[m]).filter(avail); return { map: m, n: es.length, f: es.filter(e => e.kind !== 'quest' || focus.has(e.q.name)).length, story: cand[m].some(e => e.kind !== 'quest') }; }).filter(x => x.n).sort((a, b) => b.story - a.story || b.f - a.f || b.n - a.n);
  const key = Object.keys(cand).find(m => m === map) || Object.keys(cand).find(m => normM(m) === normM(map) || (normM(map) === 'groundzero' && normM(m).startsWith('groundzero')));
  const all = dedup(cand[key]);
  const entries = all.filter(avail);
  const later = all.length - entries.length;
  const act = (e) => (e.kind !== 'quest' ? 0 : (focus.has(e.q.name) ? 0 : 2) + (p.active?.[e.q.name] ? 1 : 2));
  entries.sort((a, b) => act(a) - act(b));
  const turnIns = [];
  const byQ = {}; for (const e of entries) if (e.kind === 'quest') (byQ[e.q.name] = byQ[e.q.name] || []).push(e.o.id);
  for (const [n, ids] of Object.entries(byQ)) { const q = D.quests[n]; if (!q.objectives.some(o => !o.optional && !hasReqKids(q.objectives, o) && objType(q, o) === 'raid' && !objDoneIn(sp, n, o.id) && !ids.includes(o.id))) turnIns.push(n); }
  // objectives of open quests that work on any map (eliminate PMCs anywhere, flexible boss kills on this map …)
  const anywhere = [];
  for (const n of IX.order) {
    const q = D.quests[n];
    if (isDone(n, p) || !visible(q, p) || karmaQuest(q) || questStatus(q, p).s !== 'available') continue;
    for (const o of q.objectives) {
      if (o.optional || p.obj[`${n}|${o.id}`] || hasReqKids(q.objectives, o)) continue;
      const t = objType(q, o);
      if (!(t === 'flex' || t === 'any')) continue;
      // "eliminate Reshala" only where Reshala can spawn
      const named = bosses ? bosses.all.filter(b => new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(o.text)) : [];
      if (named.length ? !named.some(b => bosses.here.has(b)) : t === 'flex' && !(q.maps || []).some(m => normM(m) === normM(map))) continue;
      anywhere.push({ kind: 'quest', q, o });
    }
  }
  const r = { map: key || map, entries, turnIns };
  return { ...r, anywhere, later, maps, bring: bringList(r) };
}

// quest that is not unlocked in your game yet – the plan expects it to open after earlier hand-ins / level-ups
function notYet(n, p) {
  const st = questStatus(D.quests[n], p);
  if (st.s !== 'locked') return '';
  const why = st.reasons.map(r => r.k === 'var' ? `after ${varNeed(r.x, p)} more finished ${r.x.trader} LL${r.x.tier} task${varNeed(r.x, p) > 1 ? 's' : ''} (earlier hand-ins in the plan)` : r.k === 'level' ? `at PMC level ${r.v}` : r.k === 'll' ? `at ${r.v.trader} LL${r.v.level}` : r.k === 'pre' ? `after ${r.g.map(a => a.q).join(' or ')}` : r.k === 'tour' || r.k === 'start' ? 'after the Tour steps' : r.k === 'map' ? 'when the map is unlocked' : r.k === 'chapter' ? `after the ${r.c.ch} step` : r.k === 'rep' ? `at ${r.r.trader} reputation ${r.r.value}` : '').filter(Boolean);
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
