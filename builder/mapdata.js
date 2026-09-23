// Map marker snapshot from tarkov.dev's static JSON exports (json.tarkov.dev) – the same files the tarkov.dev website uses.
// Built daily by the GitHub Action into data/mapdata-<gameMode>.json, so the site never depends on the live GraphQL API.
export const JSON_BASE = 'https://json.tarkov.dev';

export async function fetchTarkovJson(gameMode = 'regular', fetchFn = globalThis.fetch) {
  const get = async (n) => {
    const r = await fetchFn(`${JSON_BASE}/${gameMode}/${n}`);
    if (!r.ok) throw new Error(`json.tarkov.dev ${gameMode}/${n}: HTTP ${r.status}`);
    return r.json();
  };
  const [tasks, tasksEn, maps, mapsEn] = await Promise.all([get('tasks'), get('tasks_en'), get('maps'), get('maps_en')]);
  return { tasks, tasksEn, maps, mapsEn, gameMode };
}

export async function buildMapData({ gameMode = 'regular', neededNodes = null, fetchFn = globalThis.fetch } = {}) {
  return transformMapData({ ...(await fetchTarkovJson(gameMode, fetchFn)), neededNodes });
}

const wikiTitle = (link) => { try { return decodeURIComponent(String(link || '').split('/wiki/')[1] || '').replace(/_/g, ' ').replace(/#.*/, '').trim() || null; } catch { return null; } };

// Quest prerequisites straight from the game files (via tarkov.dev), keyed by wiki page title.
// Used to fill links the wiki pages are missing (e.g. the Gunsmith Master chain).
export function transformGameReqs({ tasks, tasksEn }) {
  const tr = (k) => (k != null && tasksEn?.data?.[k] ? tasksEn.data[k] : k);
  const all = Object.values(tasks.data.tasks || {});
  const byId = Object.fromEntries(all.map(t => [t.id, t]));
  const quests = {};
  for (const t of all) {
    const title = wikiTitle(t.wikiLink) || tr(t.name);
    const req = (t.taskRequirements || []).map(r => { const p = byId[r.task]; return p ? { q: wikiTitle(p.wikiLink) || tr(p.name), st: r.status || [] } : null; }).filter(Boolean);
    quests[title] = { req, lvl: t.minPlayerLevel || 0, kappa: !!t.kappaRequired, lk: !!t.lightkeeperRequired };
  }
  return { source: 'json.tarkov.dev', fetchedAt: Date.now(), quests };
}

export function transformMapData({ tasks, tasksEn, maps, mapsEn, neededNodes = null, gameMode = 'regular' }) {
  const tr = (k, dict) => (k != null && dict?.data?.[k] != null && dict.data[k] !== '' ? dict.data[k] : k);
  const r2 = (n) => Math.round(n * 100) / 100;
  const P = (p) => (p ? { x: r2(p.x), y: r2(p.y), z: r2(p.z) } : null);
  const mapsArr = Object.values(maps.data.maps || {});
  const mapNorm = Object.fromEntries(mapsArr.map(m => [m.id, m.normalizedName]));
  const qi = tasks.data.questItems || {};
  const out = { source: 'json.tarkov.dev', gameMode, fetchedAt: Date.now(), tasks: [], maps: [] };
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
      loot: (m.lootLoose || []).map(l => ({ i: (l.items || []).filter(id => !neededNodes || neededNodes.has(id)), p: P(l.position) })).filter(l => l.i.length && l.p),
    });
  }
  return out;
}
