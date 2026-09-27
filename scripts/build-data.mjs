// Node entry for the daily GitHub Action: builds data/dataset.json from the EFT wiki
// and snapshots tarkov.dev map marker positions (fallback when tarkov.dev is down at runtime).
import fs from 'node:fs';
import { buildDataset } from '../builder/build.js';
import { Wiki } from '../builder/wiki.js';
import { fetchTarkovJson, transformMapData, transformGameReqs } from '../builder/mapdata.js';
import { fetchWikiContainers, transformLoot } from '../builder/loot.js';

const out = new URL('../data/', import.meta.url);
const wiki = new Wiki({ concurrency: 3, userAgent: 'EFT-Quest-Tracker/1.0 (GitHub Pages fan project; daily data refresh)' });
const ds = await buildDataset({ wiki });
const qn = Object.keys(ds.quests).length;
if (qn < 200) { console.error(`Only ${qn} quests parsed – refusing to overwrite dataset`); process.exit(1); }
fs.writeFileSync(new URL('dataset.json', out), JSON.stringify(ds));
console.log(`dataset.json: ${qn} quests, ${Object.keys(ds.items).length} items, ${wiki.requests} requests, ${(fs.statSync(new URL('dataset.json', out)).size / 1e6).toFixed(2)} MB`);

// Container loot tables from the wiki (what can spawn in a toolbox, jacket, …)
let wikiContainers = [];
try {
  wikiContainers = await fetchWikiContainers(wiki, console.log);
  console.log(`wiki loot tables: ${wikiContainers.length} containers, ${wikiContainers.reduce((s, c) => s + c.items.length, 0)} entries`);
} catch (e) { console.warn('wiki container loot tables unavailable: ' + e.message); }

const kb = (f) => (fs.statSync(new URL(f, out)).size / 1024).toFixed(0) + ' KB';
for (const gm of ['regular', 'pve']) {
  try {
    const raw = await fetchTarkovJson(gm, globalThis.fetch, { withItems: true });
    const md = transformMapData(raw);
    fs.writeFileSync(new URL(`mapdata-${gm}.json`, out), JSON.stringify(md));
    console.log(`mapdata-${gm}.json: ${md.tasks.length} tasks with positions, ${md.maps.length} maps, ${kb(`mapdata-${gm}.json`)}`);
    if (gm === 'regular') {
      const gr = transformGameReqs({ ...raw, wikiQuests: ds.quests, log: console.log });
      fs.writeFileSync(new URL('prereq-game.json', out), JSON.stringify(gr));
      console.log(`prereq-game.json: ${Object.keys(gr.quests).length} quests, ${Object.keys(gr.vars).length} loyalty-group counters, ${Object.values(gr.quests).filter(q => q.vars).length} quests gated by them`);
    }
    // per-map loot (loose spawns + containers with their wiki loot tables)
    const loot = transformLoot({ ...raw, wikiContainers, gameMode: gm });
    fs.writeFileSync(new URL(`loot-${gm}.json`, out), JSON.stringify(loot));
    const nm = Object.keys(loot.maps).length;
    const noTable = loot.containers.filter(c => c[3] < 0 || !loot.tables[c[3]].length).map(c => c[1]);
    console.log(`loot-${gm}.json: ${loot.items.length} items, ${loot.containers.length} container types (${noTable.length} without wiki loot table: ${noTable.join(', ')}), ${nm} maps, ${kb(`loot-${gm}.json`)}`);
  } catch (e) {
    console.warn(`map data (${gm}) unavailable, keeping previous snapshot: ${e.stack || e.message}`);
  }
}
