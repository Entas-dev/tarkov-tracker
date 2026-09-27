// Map marker snapshot from tarkov.dev's static JSON exports (json.tarkov.dev) – the same files the tarkov.dev website uses.
// Built daily by the GitHub Action into data/mapdata-<gameMode>.json, so the site never depends on the live GraphQL API.
export const JSON_BASE = 'https://json.tarkov.dev';

export async function fetchTarkovJson(gameMode = 'regular', fetchFn = globalThis.fetch, { withItems = false } = {}) {
  const get = async (n) => {
    const r = await fetchFn(`${JSON_BASE}/${gameMode}/${n}`);
    if (!r.ok) throw new Error(`json.tarkov.dev ${gameMode}/${n}: HTTP ${r.status}`);
    return r.json();
  };
  const [tasks, tasksEn, maps, mapsEn, tradersEn, items, itemsEn] = await Promise.all([get('tasks'), get('tasks_en'), get('maps'), get('maps_en'),
    get('traders_en').catch(() => null), withItems ? get('items') : null, withItems ? get('items_en') : null]);
  return { tasks, tasksEn, maps, mapsEn, tradersEn, items, itemsEn, gameMode };
}

export async function buildMapData({ gameMode = 'regular', fetchFn = globalThis.fetch } = {}) {
  return transformMapData(await fetchTarkovJson(gameMode, fetchFn));
}

const wikiTitle = (link) => { try { return decodeURIComponent(String(link || '').split('/wiki/')[1] || '').replace(/_/g, ' ').replace(/#.*/, '').trim() || null; } catch { return null; } };

// Quest requirements straight from the game files (via tarkov.dev), keyed by wiki page title.
// Since patch 1.1 (Aug 2026) most side tasks are unlocked in small groups per trader loyalty level: the game
// gates them with a hidden per-trader-LL counter ("globalVariable >= N") instead of a PMC level or a previous
// quest – the wiki pages still show the old requirements. v2 of this file exports those counters too.
export function transformGameReqs({ tasks, tasksEn, tradersEn = null, wikiQuests = null, log = () => {} }) {
  const tr = (k) => (k != null && tasksEn?.data?.[k] ? tasksEn.data[k] : k);
  const trader = (id) => tradersEn?.data?.[`${id} Nickname`] || id;
  const all = Object.values(tasks.data.tasks || {});
  const byId = Object.fromEntries(all.map(t => [t.id, t]));
  const quests = {};
  const vmem = {}; // variable id -> {traders:Set, members:[[title, min]]}
  for (const t of all) {
    const title = wikiTitle(t.wikiLink) || tr(t.name);
    const req = (t.taskRequirements || []).map(r => { const p = byId[r.task]; return p ? { q: wikiTitle(p.wikiLink) || tr(p.name), st: r.status || [] } : null; }).filter(Boolean);
    const vars = [];
    for (const o of t.otherRequirements || []) {
      if (o.type !== 'globalVariable' || !o.variableId) continue;
      const min = o.compareMethod === '>' ? (o.value || 0) + 1 : (o.value || 0);
      vars.push([o.variableId, min]);
      const v = vmem[o.variableId] || (vmem[o.variableId] = { traders: new Set(), members: [] });
      v.traders.add(trader(t.trader)); v.members.push([title, min]);
    }
    const ll = (t.traderRequirements || []).filter(r => r.requirementType === 'level').map(r => [trader(r.trader), r.value]);
    quests[title] = { req, lvl: t.minPlayerLevel || 0, kappa: !!t.kappaRequired, lk: !!t.lightkeeperRequired, trader: trader(t.trader) };
    if (vars.length) quests[title].vars = vars;
    if (ll.length) quests[title].ll = ll;
    if ((t.otherRequirements || []).some(o => o.type === 'dialogue')) quests[title].dialogue = true;
  }
  // which trader loyalty level does each counter belong to? The counters of a trader were created in LL order
  // (their ids ascend); where the wiki still names a loyalty level for most members, that wins.
  const vars = {};
  const perTrader = {};
  for (const [id, v] of Object.entries(vmem)) { const tn = [...v.traders][0]; (perTrader[tn] = perTrader[tn] || []).push(id); }
  for (const [tn, ids] of Object.entries(perTrader)) {
    ids.sort();
    ids.forEach((id, i) => {
      const v = vmem[id];
      const votes = {};
      for (const [title] of v.members) { const l = wikiQuests?.[title]?.ll; if (l?.level && l.trader === tn) votes[l.level] = (votes[l.level] || 0) + 1; }
      const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      const known = v.members.filter(([title]) => wikiQuests?.[title]?.ll).length;
      const tier = top && top[1] * 2 > known && top[1] >= 2 ? +top[0] : i + 1;
      const groups = [...new Set(v.members.map(m => m[1]))].sort((a, b) => a - b);
      vars[id] = { trader: tn, tier, groups };
      log(`  ${tn} LL${tier} (${id.slice(-6)}): ${groups.map(g => `≥${g}: ${v.members.filter(m => m[1] === g).map(m => m[0]).join(', ')}`).join(' | ')}`);
    });
  }
  return { v: 2, source: 'json.tarkov.dev', fetchedAt: Date.now(), quests, vars };
}

// Loose-loot spawn points live in data/loot-<gameMode>.json (builder/loot.js) since v2 of this file.
export function transformMapData({ tasks, tasksEn, maps, mapsEn, gameMode = 'regular' }) {
  const tr = (k, dict) => (k != null && dict?.data?.[k] != null && dict.data[k] !== '' ? dict.data[k] : k);
  const r2 = (n) => Math.round(n * 100) / 100;
  const P = (p) => (p ? { x: r2(p.x), y: r2(p.y), z: r2(p.z) } : null);
  const mapsArr = Object.values(maps.data.maps || {});
  const mapNorm = Object.fromEntries(mapsArr.map(m => [m.id, m.normalizedName]));
  const qi = tasks.data.questItems || {};
  const out = { v: 2, source: 'json.tarkov.dev', gameMode, fetchedAt: Date.now(), tasks: [], maps: [] };
  for (const t of Object.values(tasks.data.tasks || {})) {
    let wiki = null;
    if (t.wikiLink) { try { wiki = decodeURIComponent(t.wikiLink.split('/wiki/')[1] || '').replace(/_/g, ' ').replace(/#.*/, '').trim() || null; } catch { wiki = null; } }
    const objectives = [];
    for (const o of t.objectives || []) {
      const zones = (o.zones || []).filter(z => z.position).map(z => ({ map: mapNorm[z.map] || z.map, p: P(z.position), o: (z.outline || []).map(P) }));
      const locs = (o.possibleLocations || []).map(l => ({ map: mapNorm[l.map] || l.map, ps: (l.positions || []).map(P) })).filter(l => l.ps.length);
      if (!zones.length && !locs.length) continue;
      const q = o.questItem ? qi[o.questItem] : null;
      objectives.push({ d: tr(o.description, tasksEn), opt: !!o.optional, zones, locs, qi: q ? { n: tr(q.name, tasksEn), i: q.iconLink || null } : null });
    }
    if (objectives.length) out.tasks.push({ name: tr(t.name, tasksEn), wiki, objectives });
  }
  for (const m of mapsArr) {
    out.maps.push({
      map: m.normalizedName,
      extracts: (m.extracts || []).filter(e => e.position).map(e => ({ n: tr(e.name, mapsEn), f: e.faction, p: P(e.position) })),
      locks: (m.locks || []).filter(l => l.key && l.position).map(l => ({ k: l.key, p: P(l.position) })),
    });
  }
  return out;
}
