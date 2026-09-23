// tarkov.dev GraphQL query used only for map marker positions (objective zones, quest item spawns, extracts)
export const TDEV_URL = 'https://api.tarkov.dev/graphql';
const zoneF = 'zones { id map { normalizedName } position { x y z } outline { x y z } }';
export const TDEV_QUERY = `query TrackerMap($gm: GameMode) {
  tasks(gameMode: $gm) { name objectives { id type description optional
    ... on TaskObjectiveBasic { ${zoneF} }
    ... on TaskObjectiveMark { ${zoneF} markerItem { name } }
    ... on TaskObjectiveShoot { ${zoneF} }
    ... on TaskObjectiveUseItem { ${zoneF} }
    ... on TaskObjectiveQuestItem { ${zoneF} questItem { name iconLink } possibleLocations { map { normalizedName } positions { x y z } } }
  } }
  maps(gameMode: $gm) { normalizedName extracts { name faction position { x y z } } }
}`;

export async function fetchTarkovDev(gameMode = 'regular', fetchFn = globalThis.fetch) {
  const r = await fetchFn(TDEV_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: TDEV_QUERY, variables: { gm: gameMode } }) });
  const j = await r.json();
  if (!j.data?.tasks) throw new Error((j.errors && (j.errors[0]?.message || j.errors[0])) || 'tarkov.dev returned no data');
  return { tasks: j.data.tasks, maps: j.data.maps, fetchedAt: Date.now(), gameMode };
}

// Per-map loose loot spawns + locked doors (for "where to find" markers of items needed by active quests)
export const TDEV_LOOT_QUERY = `query TrackerLoot($gm: GameMode, $n: [String!]) {
  maps(gameMode: $gm, name: $n) { normalizedName
    lootLoose { items { name } position { x y z } }
    locks { lockType key { name } position { x y z } }
  }
}`;
export async function fetchMapLoot(gameMode, mapName, fetchFn = globalThis.fetch) {
  const r = await fetchFn(TDEV_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: TDEV_LOOT_QUERY, variables: { gm: gameMode, n: [mapName] } }) });
  const j = await r.json();
  const m = j.data?.maps?.[0];
  if (!m) throw new Error((j.errors && (j.errors[0]?.message || j.errors[0])) || 'no map data');
  return { loot: (m.lootLoose || []).map(l => ({ i: (l.items || []).map(x => x.name), p: l.position })), locks: (m.locks || []).filter(l => l.key && l.position).map(l => ({ k: l.key.name, p: l.position })), fetchedAt: Date.now() };
}
