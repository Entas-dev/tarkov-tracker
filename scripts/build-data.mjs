// Node entry for the daily GitHub Action: builds data/dataset.json from the EFT wiki
// and snapshots tarkov.dev map marker positions (fallback when tarkov.dev is down at runtime).
import fs from 'node:fs';
import { buildDataset } from '../builder/build.js';
import { Wiki } from '../builder/wiki.js';
import { fetchTarkovDev } from '../builder/tarkovdev.js';

const out = new URL('../data/', import.meta.url);
const wiki = new Wiki({ concurrency: 3, userAgent: 'EFT-Quest-Tracker/1.0 (GitHub Pages fan project; daily data refresh)' });
const ds = await buildDataset({ wiki });
const qn = Object.keys(ds.quests).length;
if (qn < 200) { console.error(`Only ${qn} quests parsed – refusing to overwrite dataset`); process.exit(1); }
fs.writeFileSync(new URL('dataset.json', out), JSON.stringify(ds));
console.log(`dataset.json: ${qn} quests, ${Object.keys(ds.items).length} items, ${wiki.requests} requests, ${(fs.statSync(new URL('dataset.json', out)).size / 1e6).toFixed(2)} MB`);

for (const gm of ['regular', 'pve']) {
  try {
    const t = await fetchTarkovDev(gm);
    fs.writeFileSync(new URL(`tarkovdev-${gm}.json`, out), JSON.stringify(t));
    console.log(`tarkovdev-${gm}.json: ${t.tasks.length} tasks`);
  } catch (e) {
    console.warn(`tarkov.dev (${gm}) unavailable, keeping previous snapshot: ${e.message}`);
  }
}
