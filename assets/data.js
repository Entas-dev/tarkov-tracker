// Dataset loading: prebuilt data/dataset.json (GitHub Action, daily) + IndexedDB cache + live wiki build in the browser.
import { buildDataset, DATASET_VERSION } from '../builder/build.js';
import { Wiki } from '../builder/wiki.js';

const DB = 'eft-tracker', ST = 'kv';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbGet(k) {
  try { const db = await idb(); return await new Promise((res, rej) => { const t = db.transaction(ST).objectStore(ST).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); } catch { return null; }
}
export async function idbSet(k, v) {
  try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(ST, 'readwrite').objectStore(ST).put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); } catch (e) { console.warn('idb set failed', e); }
}

const age = (ds) => ds?.meta?.builtAt ? Date.now() - new Date(ds.meta.builtAt).getTime() : Infinity;
const ok = (ds) => ds && ds.meta?.version === DATASET_VERSION && ds.quests && Object.keys(ds.quests).length > 50;

export async function loadDataset() {
  const [cached, remote] = await Promise.all([
    idbGet('dataset'),
    fetch('data/dataset.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const cands = [cached, remote].filter(ok).sort((a, b) => age(a) - age(b));
  return cands[0] || null;
}

export async function loadGameReqs() {
  try { const r = await fetch('data/prereq-game.json', { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
}

export const STALE_MS = 24 * 3600e3;
export const isStale = (ds) => age(ds) > STALE_MS;

let running = null;
export function buildLive(onProgress = () => {}) {
  if (running) return running;
  running = (async () => {
    const wiki = new Wiki({ concurrency: 4 });
    const ds = await buildDataset({ wiki, log: (m) => console.log('[wiki]', m), progress: onProgress });
    await idbSet('dataset', ds);
    return ds;
  })().finally(() => { running = null; });
  return running;
}

export function ageText(ds) {
  const a = age(ds);
  if (!isFinite(a)) return 'unknown';
  const h = Math.round(a / 3600e3);
  if (h < 1) return 'just now';
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
