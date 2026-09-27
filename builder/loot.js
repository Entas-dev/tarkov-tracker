// Per-map loot index: WHERE items can spawn (tarkov.dev static export: loose-loot spawn points + container
// positions) combined with WHAT each container can hold (EFT wiki: "Loot Table" section of every container page).
// Output: data/loot-<gameMode>.json – compact, index based (items[] referenced by number).
import { links, normTitle } from './wikitext.js';

const HEX24 = /^[0-9a-f]{24}$/i;
const wikiTitleOf = (link) => { try { return decodeURIComponent(String(link || '').split('/wiki/')[1] || '').replace(/_/g, ' ').replace(/#.*/, '').trim() || null; } catch { return null; } };

// ---------- wiki: container pages + their loot tables ----------
export async function fetchWikiContainers(wiki, log = () => {}) {
  const looting = (await wiki.wikitext(['Looting']))['Looting'];
  const wt = looting?.wikitext || '';
  const start = wt.search(/==\s*Loot Containers\s*==/i);
  let sec = start >= 0 ? wt.slice(start) : '';
  const end = sec.slice(5).search(/\n==/);
  if (end >= 0) sec = sec.slice(0, end + 5);
  // container names are the header cells of the table: "![[Toolbox]]"
  const headerLines = sec.split('\n').filter(l => /^!\s*\[\[/.test(l) && !/^!\s*\[\[(File|Image):/i.test(l)).join('\n');
  const titles = [...new Set(links(headerLines).map(l => l.target).filter(Boolean))];
  log(`loot containers on wiki: ${titles.length}`);
  const pages = await wiki.wikitext(titles);
  const out = [];
  for (const t of titles) {
    const p = pages[t];
    if (!p || p.missing) continue;
    const w = p.wikitext;
    if (!/\|\s*type\s*=[^\n]*Loot[ _]Container/i.test(w)) continue;
    const node = (w.match(/\|\s*node\s*=\s*([0-9a-f]{24})/i) || [])[1] || null;
    const ls = w.search(/==\s*Loot Table\s*==/i);
    const items = [];
    if (ls >= 0) {
      let tb = w.slice(ls + 5);
      const le = tb.search(/\n==[^=]/);
      if (le >= 0) tb = tb.slice(0, le);
      // rows: |{{<item id>}} \n |Type   (older pages use [[Item]] links)
      for (const row of tb.split(/\n\|-/)) {
        const cells = row.split('\n').filter(l => l.startsWith('|') && !l.startsWith('|}') && !l.startsWith('{|')).map(l => l.slice(1).trim());
        if (!cells.length) continue;
        const idm = cells[0].match(/\{\{\s*([0-9a-f]{24})\s*\}\}/i);
        const lk = !idm ? links(cells[0]).find(l => !/^(File|Image):/i.test(l.target)) : null;
        const type = (cells[1] || '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').trim();
        if (idm) items.push({ id: idm[1].toLowerCase(), type });
        else if (lk) items.push({ title: normTitle(lk.target), type });
      }
    }
    out.push({ title: p.title, node, items });
  }
  return out;
}

// ---------- combine ----------
const r1 = (n) => Math.round(n * 10) / 10;

// Output (arrays instead of objects to keep the file small):
//   cats:       ['Building materials', …]
//   items:      [[id, name (wiki title), shortName, catIndex, price, slots, altName?], …]
//   tables:     [[itemIndex, …], …]                       wiki loot table per container page
//   containers: [[id, name, wikiTitle|null, tableIndex|-1], …]
//   maps:       { <tarkov.dev map key>: { loose: [[x, z, itemIndex…], …], cont: [[containerIndex, x, z], …] } }
export function transformLoot({ maps, mapsEn, items, itemsEn, wikiContainers = [], gameMode = 'regular' }) {
  const tr = (k, dict) => (k != null && dict?.data?.[k] != null && dict.data[k] !== '' ? dict.data[k] : k);
  const tItems = items.data.items || {};
  const hb = items.data.handbookCategories || {};
  const byWikiTitle = {};
  for (const it of Object.values(tItems)) { const t = wikiTitleOf(it.wikiLink); if (t && !byWikiTitle[t]) byWikiTitle[t] = it.id; }

  const cats = [], catIdx = new Map();
  const cat = (name) => { if (!name) return -1; if (!catIdx.has(name)) { catIdx.set(name, cats.length); cats.push(name); } return catIdx.get(name); };
  // item registry (only items that can actually be looted somewhere)
  const idx = new Map(); const list = [];
  const reg = (id) => {
    if (idx.has(id)) return idx.get(id);
    const it = tItems[id];
    if (!it) return -1;
    const wiki = wikiTitleOf(it.wikiLink);
    const name = tr(it.name, itemsEn);
    const c = (it.handbookCategories || []).map(h => tr(hb[h]?.name, itemsEn)).find(Boolean) || '';
    const e = [id, wiki || name, tr(it.shortName, itemsEn), cat(c), Math.round(it.avg24hPrice || it.lastLowPrice || it.basePrice || 0), (it.width || 1) * (it.height || 1)];
    if (wiki && name && name !== wiki) e.push(name);
    idx.set(id, list.length); list.push(e);
    return idx.get(id);
  };

  // containers: tarkov.dev ids → wiki loot table (matched by the wiki infobox node, else by name, else by a
  // sibling container with the same tarkov.dev type name, e.g. the second "duffle-bag" id → Sports bag)
  const cDefs = maps.data.lootContainers || {};
  const wByNode = {}, wByName = {};
  for (const c of wikiContainers) { if (c.node) wByNode[c.node.toLowerCase()] = c; wByName[c.title.toLowerCase()] = c; }
  const match = (id) => {
    const d = cDefs[id] || { id, normalizedName: id };
    const name = tr(d.name, mapsEn) || d.normalizedName;
    return { d, name, w: wByNode[id.toLowerCase()] || wByName[String(name).toLowerCase()] || wByName[String(d.normalizedName).replace(/-/g, ' ')] || null };
  };
  const byType = {};
  for (const id of Object.keys(cDefs)) { const m = match(id); if (m.w && !byType[m.d.normalizedName]) byType[m.d.normalizedName] = m.w; }
  const tables = [], tIdx = new Map();
  const table = (w) => {
    if (!w) return -1;
    if (tIdx.has(w.title)) return tIdx.get(w.title);
    const its = [];
    for (const x of w.items || []) {
      const iid = x.id || (x.title && byWikiTitle[x.title]);
      if (!iid || !HEX24.test(iid)) continue;
      const k = reg(iid);
      if (k >= 0 && !its.includes(k)) its.push(k);
    }
    tIdx.set(w.title, tables.length); tables.push(its);
    return tIdx.get(w.title);
  };
  const cIdx = new Map(); const containers = [];
  const regC = (id) => {
    if (cIdx.has(id)) return cIdx.get(id);
    const m = match(id);
    const w = m.w || byType[m.d.normalizedName] || null;
    cIdx.set(id, containers.length); containers.push([id, w?.title || m.name, w?.title || null, table(w)]);
    return cIdx.get(id);
  };

  const outMaps = {};
  for (const m of Object.values(maps.data.maps || {})) {
    const loose = [];
    for (const l of m.lootLoose || []) {
      if (!l.position) continue;
      const ids = [...new Set((l.items || []).map(reg).filter(k => k >= 0))];
      if (ids.length) loose.push([r1(l.position.x), r1(l.position.z), ...ids]);
    }
    const cont = [];
    for (const c of m.lootContainers || []) {
      if (!c.position || !c.lootContainer) continue;
      cont.push([regC(c.lootContainer), r1(c.position.x), r1(c.position.z)]);
    }
    if (loose.length || cont.length) outMaps[m.normalizedName] = { loose, cont };
  }
  return {
    v: 1, source: 'Spawn points & container positions: json.tarkov.dev · Container loot tables: EFT wiki',
    gameMode, fetchedAt: Date.now(), cats, items: list, tables, containers, maps: outMaps,
  };
}
