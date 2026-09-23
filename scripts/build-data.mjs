// Node entry for the daily GitHub Action: builds data/dataset.json from the EFT wiki
// and snapshots tarkov.dev map marker positions (fallback when tarkov.dev is down at runtime).
import fs from 'node:fs';
import { buildDataset } from '../builder/build.js';
import { Wiki } from '../builder/wiki.js';
import { fetchTarkovJson, transformMapData, transformGameReqs } from '../builder/mapdata.js';

const out = new URL('../data/', import.meta.url);
const wiki = new Wiki({ concurrency: 3, userAgent: 'EFT-Quest-Tracker/1.0 (GitHub Pages fan project; daily data refresh)' });
const ds = await buildDataset({ wiki });
const qn = Object.keys(ds.quests).length;
if (qn < 200) { console.error(`Only ${qn} quests parsed – refusing to overwrite dataset`); process.exit(1); }
fs.writeFileSync(new URL('dataset.json', out), JSON.stringify(ds));
console.log(`dataset.json: ${qn} quests, ${Object.keys(ds.items).length} items, ${wiki.requests} requests, ${(fs.statSync(new URL('dataset.json', out)).size / 1e6).toFixed(2)} MB`);

// Map markers (quest zones, quest item spawns, extracts, key doors, item spawns) from tarkov.dev's static JSON exports
const neededNodes = new Set(Object.values(ds.items).map(i => i.node).filter(Boolean));
for (const gm of ['regular', 'pve']) {
  try {
    const raw = await fetchTarkovJson(gm);
    const md = transformMapData({ ...raw, neededNodes });
    fs.writeFileSync(new URL(`mapdata-${gm}.json`, out), JSON.stringify(md));
    console.log(`mapdata-${gm}.json: ${md.tasks.length} tasks with positions, ${md.maps.length} maps`);
    if (gm === 'regular') {
      const gr = transformGameReqs(raw);
      fs.writeFileSync(new URL('prereq-game.json', out), JSON.stringify(gr));
      console.log(`prereq-game.json: ${Object.keys(gr.quests).length} quests`);
    }
  } catch (e) {
    console.warn(`map data (${gm}) unavailable, keeping previous snapshot: ${e.message}`);
  }
}
