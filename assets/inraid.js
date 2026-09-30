// In-Raid view: left half every needed item (all at once), top right the map, bottom right what to do on that map.
import { store } from './store.js';
import { D, P } from './model.js';
import { esc, attr, icon, fmt } from './ui.js';
import { itemList, itemFilter, itemTile, itemPop, fitGrids, goalToggles } from './tabs-other.js';
import { mapTodo, bringHtml, raidBodyHtml } from './speedrun.js';
import { dockMap, currentMapWiki, highlightedIndex, bossInfo } from './mappanel.js';
import { lootData, lootState, ensureLoot, lootForMap, itemIndex } from './loot.js';

const ui = () => store.ui;
// map to start with: the next raid of the stored Speedrun plan
function planMap() {
  const d = ui().srPlans?.[store.active]?.data;
  return d?.raids?.[0]?.map || null;
}

function sizeLayout(ir) {
  const top = ir.getBoundingClientRect().top + window.scrollY;
  ir.style.setProperty('--ir-top', Math.round(top + 10) + 'px');
}

export function renderInRaid(root) {
  let ir = root.querySelector(':scope > .ir');
  if (!ir) {
    root.innerHTML = `<div class="ir">
      <section class="ir-items" data-keep="ir-items" aria-label="Needed items"></section>
      <section class="ir-map" aria-label="Map"></section>
      <section class="ir-todo" data-keep="ir-todo" aria-label="To do on this map"></section>
    </div>`;
    ir = root.querySelector('.ir');
  }
  sizeLayout(ir);
  dockMap(ir.querySelector('.ir-map'), planMap());
  const map = currentMapWiki() || planMap() || 'Customs';
  renderTodo(ir.querySelector('.ir-todo'), map);
  renderItemsPane(ir.querySelector('.ir-items'), map);
}

function renderItemsPane(el, map) {
  const f = itemFilter();
  const mode = ui().irClick || 'tick';
  const onlyHere = !!ui().irHere;
  const all = itemList();
  const open = all.filter(a => a.need > a.have);
  const ld = lootData();
  if (!ld && lootState() === 'idle') ensureLoot();
  // items worth grabbing on this map (good odds compared with the other maps)
  let here = new Set();
  if (ld) {
    const needs = open.map(a => ({ item: a.item, li: itemIndex(a.item), prio: Math.min(a.prio, 3), missing: a.need - a.have })).filter(x => x.li >= 0);
    here = new Set(lootForMap(map, needs).map(x => x.item));
  }
  const list = onlyHere ? open.filter(a => here.has(a.item)) : open;
  const hi = highlightedIndex();
  const pop = ui().ipop ? all.find(a => a.item === ui().ipop) : null;
  const hlName = hi != null ? open.find(a => itemIndex(a.item) === hi)?.item || lootData()?.items[hi]?.n : null;
  el.innerHTML = `
    <div class="ir-h">
      <h2>Items <span class="small muted">${list.length}${onlyHere ? ` of ${open.length}` : ''} · ${fmt(list.reduce((s, a) => s + a.need - a.have, 0))} pcs</span></h2>
      ${goalToggles(f, true)}
      <div class="seg seg-s" role="radiogroup" aria-label="Click on an item"><button role="radio" aria-checked="${mode === 'tick'}" class="seg-b ${mode === 'tick' ? 'on' : ''}" data-act="ir-click" data-v="tick" data-tip="Click ticks the item (or lets you set how many you have)">${icon('check')} Tick</button><button role="radio" aria-checked="${mode === 'map'}" class="seg-b ${mode === 'map' ? 'on' : ''}" data-act="ir-click" data-v="map" data-tip="Click shows where the item can spawn on the map">${icon('map')} Spawns</button></div>
      <label class="tog small" data-tip="${attr(`Only items with good odds on ${map}`)}"><input type="checkbox" data-irhere ${onlyHere ? 'checked' : ''}> Only ${esc(map)}</label>
    </div>
    ${hlName ? `<div class="ir-hl small">${icon('map')} Showing spawns of <b>${esc(hlName)}</b> <button class="linkbtn" data-act="ir-hl" data-item="">clear</button></div>` : ''}
    ${list.length ? `<div class="ig-fitwrap" data-fit="pane"><div class="ig-grid fit">${list.map(a => itemTile(a, { act: mode === 'map' ? 'ir-hl' : 'it-tap', here: here.has(a.item), sel: mode === 'map' ? hi != null && itemIndex(a.item) === hi : undefined })).join('')}</div></div>`
    : `<div class="empty small">${onlyHere ? `None of your needed items has good odds on ${esc(map)}.` : 'Nothing left to collect for these goals.'}</div>`}
    ${pop && mode !== 'map' ? itemPop(pop) : ''}`;
  fitGrids(el);
}

function renderTodo(el, map) {
  const p = P();
  const t = mapTodo(map, { bosses: bossInfo() });
  const n = t.entries.length + t.anywhere.length;
  const nq = new Set(t.entries.filter(e => e.kind === 'quest').map(e => e.q.name)).size;
  const story = t.entries.some(e => e.kind !== 'quest');
  el.innerHTML = `
    <div class="ir-h"><h2>To do on ${esc(t.map)}${story ? ' <span class="badge b-story">Storyline</span>' : ''}</h2><span class="small muted">${t.entries.length} objective${t.entries.length !== 1 ? 's' : ''} · ${nq} quest${nq !== 1 ? 's' : ''}${t.anywhere.length ? ` · ${t.anywhere.length} on any map` : ''}</span></div>
    ${t.maps.length ? `<div class="ir-maps">${t.maps.slice(0, 12).map(m => `<button class="chip chip-s ${m.map === t.map ? 'on' : ''} ${m.story ? 'story' : ''}" data-act="map" data-map="${attr(m.map)}" data-tip="${attr(`${m.n} objective${m.n > 1 ? 's' : ''} on ${m.map}${m.story ? ' incl. storyline' : ''}`)}">${esc(m.map)} <span class="ic-count">${m.n}</span></button>`).join('')}</div>` : ''}
    ${bringHtml(t.bring)}
    ${n ? `<div class="raid-b ir-b">${raidBodyHtml(t, p, { anywhere: t.anywhere })}</div>` : `<div class="empty small">Nothing to do on ${esc(t.map)} for your current progress${t.maps.length ? ' – pick one of the maps above' : ''}.</div>`}
    ${t.later ? `<p class="small muted">+${t.later} more objective${t.later > 1 ? 's' : ''} here once you hand in the quests before them (see Speedrun).</p>` : ''}
    ${t.turnIns.length ? `<p class="small"><span class="muted">Finished after this raid:</span> ${t.turnIns.map(x => esc(x)).join(', ')}</p>` : ''}`;
}

let rT = null;
addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { const ir = document.querySelector('.ir'); if (ir) { sizeLayout(ir); fitGrids(ir); } }, 120); });
