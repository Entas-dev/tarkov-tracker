// Builds the complete tracker dataset from the EFT Fandom wiki.
import { Wiki } from './wiki.js';
import { links, tables, plain, normTitle, WIKI_BASE } from './wikitext.js';
import {
  parseQuest, parseStoryChapter, parseEndings, parseTrader, parseHideout, parsePrestige,
  parseBattlePass, parseAchievements, parseEvents, parseSeasons, classifyPage,
} from './parse.js';

export const DATASET_VERSION = 1;
const CURRENCIES = new Set(['Roubles', 'Dollars', 'Euros', 'GP coin', 'TarCoin']);
const MONEY = new Set(['Roubles', 'Dollars', 'Euros']);
const NEVER_ITEM = new Set(['Found in raid', 'EXP', 'Scavs', 'PMC', 'Hideout', 'Flea Market', 'Escape from Tarkov', 'Loot', 'Weapons', 'Quests']);

export async function buildDataset({ wiki = new Wiki(), log = console.log, progress = () => {} } = {}) {
  const t0 = Date.now();
  const step = (p, msg) => { progress(p, msg); log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`); };

  step(0.02, 'Reading category lists');
  const [questTitles, traderTitles, chapterCat] = await Promise.all([
    wiki.categoryMembers('Category:Quests'),
    wiki.categoryMembers('Category:Traders'),
    wiki.categoryMembers('Category:Story chapters'),
  ]);
  step(0.06, `Found ${questTitles.length} quest pages; reading categories`);
  const meta = await wiki.meta(questTitles);
  const activeQuests = questTitles.filter(t => !meta[t]?.cats.has('Historical content'));

  const special = ['Hideout', 'Prestige', 'BattlePass', 'Achievements', 'Events', 'Seasons', 'Endings', 'Story chapters'];
  step(0.1, `Downloading ${activeQuests.length} quests + chapters + traders`);
  const pages = await wiki.wikitext([...activeQuests, ...traderTitles, ...chapterCat, ...special]);

  // chapter order from Story chapters table
  const scTable = tables(pages['Story chapters'].wikitext)[0];
  let chapterTitles = [];
  if (scTable) for (const r of scTable.rows) { const l = links(r[1]?.raw || '')[0]; if (l) chapterTitles.push(l.target); }
  if (!chapterTitles.length) chapterTitles = chapterCat.filter(t => t !== 'Story chapters');
  const chapterSet = new Set(chapterTitles);
  const missingCh = chapterTitles.filter(t => !pages[t]);
  if (missingCh.length) Object.assign(pages, await wiki.wikitext(missingCh));

  step(0.35, 'Parsing quests');
  const quests = {};
  for (const t of activeQuests) {
    if (chapterSet.has(t)) continue;
    const p = pages[t];
    if (!p || p.missing || !/Infobox quest/i.test(p.wikitext)) continue;
    try { quests[t] = parseQuest(t, p.wikitext, meta[t] || {}); } catch (e) { log('parse error ' + t + ': ' + e.message); }
  }
  const chapters = {};
  for (const t of chapterTitles) {
    const p = pages[t];
    if (!p || p.missing) continue;
    try { chapters[t] = parseStoryChapter(t, p.wikitext); } catch (e) { log('chapter parse error ' + t + ': ' + e.message); }
  }
  const traders = {};
  for (const t of traderTitles) {
    const p = pages[t];
    if (!p || p.missing || !/Infobox character/i.test(p.wikitext)) continue;
    traders[t] = parseTrader(t, p.wikitext);
  }
  const hideout = parseHideout(pages['Hideout'].wikitext);
  const prestige = parsePrestige(pages['Prestige'].wikitext);
  const battlepass = parseBattlePass(pages['BattlePass'].wikitext);
  const achievements = parseAchievements(pages['Achievements'].wikitext);
  const events = parseEvents(pages['Events'].wikitext);
  const season = parseSeasons(pages['Seasons'].wikitext);
  const endings = parseEndings(pages['Endings'].wikitext);

  // ---- linked pages -> items / maps
  step(0.5, 'Collecting linked items');
  const known = new Set([...Object.keys(quests), ...Object.keys(chapters), ...Object.keys(traders), ...special]);
  const targets = new Set();
  const addSeq = (o) => { for (const s of o.seq || []) if (s.l && !known.has(s.l) && !NEVER_ITEM.has(s.l)) targets.add(s.l); };
  for (const q of Object.values(quests)) { q.objectives.forEach(addSeq); q.questItems.forEach(r => r.item && targets.add(r.item)); q.maps.forEach(m => targets.add(m)); }
  for (const c of Object.values(chapters)) c.objectives.forEach(addSeq);
  for (const m of hideout.modules) for (const L of m.levels) L.items.forEach(i => i.item && targets.add(i.item));
  for (const l of battlepass.levels) if (l.link) targets.add(l.link);
  for (const d of battlepass.docTypes) { targets.add(d.name); d.maps.forEach(m => targets.add(m)); }
  const targetList = [...targets].filter(t => t && !/^(Hideout|Game modes|Seasons)$/.test(t));
  step(0.55, `Downloading ${targetList.length} linked pages`);
  const linked = await wiki.wikitext(targetList);
  const cls = {};
  for (const t of targetList) {
    const p = linked[t];
    if (!p || p.missing) { cls[t] = { kind: 'missing' }; continue; }
    cls[t] = { ...classifyPage(p.title, p.wikitext), canonical: p.title };
  }
  for (const c of CURRENCIES) if (cls[c]) cls[c] = { ...cls[c], kind: 'item', currency: true };

  // ---- items registry
  const items = {};
  const itemKey = (t) => (cls[t]?.canonical || t);
  const regItem = (t) => {
    const c = cls[t];
    if (!c || c.kind !== 'item') return null;
    const k = itemKey(t);
    if (!items[k]) items[k] = { name: k, icon: c.icon || c.image || null, type: c.itemType || c.infobox || '', node: c.node || null, currency: !!c.currency || MONEY.has(k), questItem: /quest/i.test(c.itemType || '') };
    return k;
  };

  const resolveObjective = (o) => {
    let pending = null;
    o.items = []; o.maps = [];
    for (const s of o.seq || []) {
      if (s.n != null) { pending = s.n; continue; }
      if (!s.l) continue;
      if (s.l === 'Found in raid') continue;
      const c = cls[s.l];
      if (c?.kind === 'item') { const k = regItem(s.l); if (!o.items.some(i => i.item === k)) o.items.push({ item: k, count: pending ?? 1, counted: pending != null }); pending = null; }
      else if (c?.kind === 'map') { const m = c.canonical || s.l; if (!o.maps.includes(m)) o.maps.push(m); pending = null; }
      else pending = null;
    }
    // "Collect the required amount in RUB: 300,000,000"
    const tail = (o.seq || []).find(s => s.tail);
    if (tail && !o.items.length) {
      const cur = /RUB|rouble/i.test(o.text) ? 'Roubles' : /USD|dollar/i.test(o.text) ? 'Dollars' : /EUR/i.test(o.text) ? 'Euros' : null;
      if (cur) { cls[cur] = cls[cur] || { kind: 'item', currency: true, canonical: cur }; items[cur] = items[cur] || { name: cur, icon: null, currency: true }; o.items.push({ item: cur, count: tail.n, counted: true }); }
    }
    delete o.seq;
  };

  const needKinds = new Set(['handover', 'find', 'place', 'mark', 'build']);
  const computeNeeds = (q) => {
    const needs = {};
    for (const o of q.objectives) {
      if (!needKinds.has(o.kind) || !o.items.length) continue;
      for (const it of o.items) {
        const I = items[it.item];
        if (!I) continue;
        const n = needs[it.item] || (needs[it.item] = { item: it.item, count: 0, fir: false, optional: true, objectives: [] });
        n.count = Math.max(n.count, it.count || 1);
        n.fir = n.fir || (o.fir && (o.kind === 'handover' || o.kind === 'find'));
        n.optional = n.optional && o.optional;
        n.objectives.push(o.id);
      }
    }
    // guide table overrides (amount & FiR)
    for (const r of q.questItems || []) {
      if (!r.item) continue;
      const k = regItem(r.item);
      if (!k) continue;
      r.item = k;
      const n = needs[k];
      if (n) { if (r.amount && /hand ?over|required|find/i.test(r.req)) n.count = Math.max(n.count, r.amount); if (r.fir === true) n.fir = true; if (/required|hand ?over/i.test(r.req) && !/optional/i.test(r.req)) n.optional = false; }
      else if (/required/i.test(r.req) && !/optional/i.test(r.req)) needs[k] = { item: k, count: r.amount || 1, fir: r.fir === true, optional: false, objectives: [], key: /key|keycard/i.test(items[k].type || '') };
    }
    q.needs = Object.values(needs);
  };

  step(0.7, 'Resolving objectives and item requirements');
  for (const q of Object.values(quests)) { q.objectives.forEach(resolveObjective); computeNeeds(q); q.maps = q.maps.map(m => cls[m]?.canonical || m); }
  for (const c of Object.values(chapters)) { c.objectives.forEach(resolveObjective); computeNeeds(c); }
  for (const m of hideout.modules) for (const L of m.levels) {
    const keep = [];
    for (const i of L.items) {
      const c = cls[i.item];
      if (c && c.kind !== 'item' && c.kind !== 'missing') { L.skills.push({ name: c.canonical || i.item, level: i.count || 1 }); continue; }
      const k = regItem(i.item) || i.item; i.item = k;
      if (!items[k]) items[k] = { name: k, icon: null, currency: MONEY.has(k) };
      keep.push(i);
    }
    L.items = keep;
  }
  for (const d of battlepass.docTypes) { regItem(d.name); d.maps = d.maps.map(m => cls[m]?.canonical || m); }
  for (const l of battlepass.levels) if (l.link && cls[l.link]?.kind === 'item') l.item = regItem(l.link);

  const maps = [...new Set(Object.entries(cls).filter(([, c]) => c.kind === 'map').map(([t, c]) => c.canonical || t))].sort();

  // ---- images
  step(0.8, 'Resolving image URLs');
  const want = { 96: new Set(), 480: new Set(), 160: new Set() };
  for (const i of Object.values(items)) if (i.icon) want[96].add(i.icon);
  for (const q of Object.values(quests)) { if (q.image) want[480].add(q.image); if (q.icon) want[96].add(q.icon); }
  for (const c of Object.values(chapters)) { if (c.image) want[480].add(c.image); if (c.icon) want[96].add(c.icon); }
  for (const t of Object.values(traders)) if (t.image) want[160].add(t.image);
  for (const m of hideout.modules) if (m.portrait) want[96].add(m.portrait);
  for (const a of achievements) if (a.icon) want[96].add(a.icon);
  for (const l of battlepass.levels) if (l.icon) want[96].add(l.icon);
  for (const l of prestige.levels) if (l.icon) want[96].add(l.icon);
  for (const e of Object.values(endings.endings)) if (e.icon) want[96].add(e.icon);
  for (const e of events) if (e.image) want[480].add(e.image);
  if (endings.flowchart) want[480].add(endings.flowchart);
  if (season?.modifiers) for (const grp of Object.values(season.modifiers)) for (const m of grp) if (m.icon) want[96].add(m.icon);
  for (const r of season?.rewards || []) if (r.icon) want[96].add(r.icon);
  const images = {};
  for (const [w, set] of Object.entries(want)) {
    const res = await wiki.imageUrls([...set], +w);
    for (const [f, v] of Object.entries(res)) images[f] = v.thumb;
  }
  // fallback item icons via "<Name> icon.png" for items without infobox icon
  const noIcon = Object.values(items).filter(i => !i.icon || !images[i.icon]);
  if (noIcon.length) {
    const guesses = noIcon.map(i => `${i.name} icon.png`);
    const res = await wiki.imageUrls(guesses, 96);
    for (const i of noIcon) { const g = `${i.name} icon.png`; if (res[g]) { i.icon = g; images[g] = res[g].thumb; } }
  }
  const img = (f) => (f && images[f]) || null;
  for (const i of Object.values(items)) i.img = img(i.icon);
  for (const q of Object.values(quests)) { q.img = img(q.image); q.iconImg = img(q.icon); }
  for (const c of Object.values(chapters)) { c.img = img(c.image); c.iconImg = img(c.icon); }
  for (const t of Object.values(traders)) t.img = img(t.image);
  for (const m of hideout.modules) m.img = img(m.portrait);
  for (const a of achievements) a.img = img(a.icon);
  for (const l of battlepass.levels) l.img = img(l.icon) || (l.item && items[l.item]?.img) || null;
  for (const l of prestige.levels) l.img = img(l.icon);
  for (const e of Object.values(endings.endings)) e.img = img(e.icon);
  for (const e of events) e.img = img(e.image);
  endings.flowchartImg = img(endings.flowchart);
  if (season?.modifiers) for (const grp of Object.values(season.modifiers)) for (const m of grp) m.img = img(m.icon);
  for (const r of season?.rewards || []) r.img = img(r.icon);

  step(1, 'Done');
  return {
    meta: { version: DATASET_VERSION, builtAt: new Date().toISOString(), source: WIKI_BASE, requests: wiki.requests, ms: Date.now() - t0, questCount: Object.keys(quests).length },
    quests, chapters, chapterOrder: chapterTitles, endings, traders, hideout, prestige, battlepass, achievements, events, season, items, maps,
  };
}
