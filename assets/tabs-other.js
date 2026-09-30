// Hideout, Prestige, BattlePass, Achievements, Items tabs
import { store } from './store.js';
import { D, IX, P, hLevel, moduleMax, levelReqStatus, hcntKey, isSeasonal, isPvE, isDone, chDone, traderLL, shoppingList, questStatus, neededItems } from './model.js';
import { esc, attr, icon, img, qlink, itemChip, progressBar, fmt, statusBadge, traderImg } from './ui.js';
import { expanded } from './components.js';
import { skillReqStatus, perksNotesHtml } from './perks.js';
import { lootData, lootState, ensureLoot, itemIndex, bestMaps, mapDisplayName } from './loot.js';

const ui = () => store.ui;

// ---------------- HIDEOUT ----------------
export function renderHideout(root) {
  const p = P();
  const mods = D.hideout.modules;
  const totalLv = mods.reduce((s, m) => s + m.levels.length, 0);
  const builtLv = mods.reduce((s, m) => s + Math.min(hLevel(m.name, p), m.levels.length), 0);
  const f = ui().hf || 'all';
  const list = mods.filter(m => f === 'all' || (f === 'open' && hLevel(m.name, p) < m.levels.length) || (f === 'ready' && hLevel(m.name, p) < m.levels.length && levelReqStatus(m.name, hLevel(m.name, p) + 1, p).ok));
  root.innerHTML = `
  <div class="tab-head"><div><h1>Hideout</h1><p class="lede">Click a level pip to set what you have built; lower levels and required modules are set automatically.${isSeasonal() ? ' <b>Seasonal:</b> no hideout items need to be found in raid.' : ''}</p></div>
    <div class="head-stat">${progressBar(builtLv, totalLv, 'Module levels')}</div></div>
  ${perksNotesHtml('hideout')}
  <section class="panel hchk"><div class="panel-h"><h2>Checklist</h2><span class="small muted">Tick every level you have built. Required lower levels and modules are ticked automatically; built levels drop out of Needed Items.</span></div>
    <div class="hchk-grid">${mods.map(m => { const lv = hLevel(m.name, p); return `<div class="hchk-row ${lv >= m.levels.length ? 'max' : ''}">${img(m.img, '', 'hchk-ic')}<span class="hchk-n">${esc(m.name)}</span><span class="hchk-bx">${m.levels.map(L => { const on = L.level <= lv; const rdy = !on && L.level === lv + 1 && levelReqStatus(m.name, L.level, p).ok; return `<button class="hchk-b ${on ? 'on' : ''} ${rdy ? 'rdy' : ''}" data-act="hcheck" data-m="${attr(m.name)}" data-l="${L.level}" aria-pressed="${on}" aria-label="${attr(m.name)} level ${L.level}" data-tip="${attr(`${m.name} level ${L.level}${on ? ' – built (click to unbuild)' : rdy ? ' – can be built now' : ''}`)}">${on ? icon('check') : L.level}</button>`; }).join('')}</span></div>`; }).join('')}</div>
  </section>
  <div class="filters"><div class="seg" role="radiogroup" aria-label="Filter">${[['all', 'All modules'], ['open', 'Not maxed'], ['ready', 'Next level unlockable']].map(([v, l]) => `<button role="radio" aria-checked="${f === v}" class="seg-b ${f === v ? 'on' : ''}" data-act="hf" data-v="${v}">${l}</button>`).join('')}</div></div>
  <div class="hgrid">${list.map(m => moduleCard(m)).join('')}</div>`;
}

function moduleCard(m) {
  const p = P();
  const lv = hLevel(m.name, p);
  const max = m.levels.length;
  const next = m.levels.find(L => L.level === lv + 1);
  const open = expanded.has('h:' + m.name);
  const st = next ? levelReqStatus(m.name, next.level, p) : null;
  const levelBlock = (L) => {
    const rs = levelReqStatus(m.name, L.level, p);
    return `<div class="hl ${L.level <= lv ? 'built' : ''}">
      <div class="hl-h"><b>Level ${L.level}</b> <span class="muted">${esc(L.time)}</span>${L.level > lv ? (rs.ok ? '<span class="badge b-av">Unlockable</span>' : '<span class="badge b-lock">' + icon('lock') + 'Locked</span>') : statusBadge('done')}</div>
      ${L.items.length ? `<div class="chips">${L.items.map(i => { const k = hcntKey(m.name, L.level, i.item); const have = L.level <= lv ? i.count : (p.hcnt[k] || 0); return itemChip(i.item, { count: i.count, have, fir: i.fir && !isSeasonal(), counter: L.level <= lv ? null : 'h:' + k }); }).join('')}</div>` : ''}
      <ul class="hreq">
        ${L.modules.map(r => `<li class="${hLevel(r.name, p) >= r.level ? 'ok' : 'no'}">${hLevel(r.name, p) >= r.level ? icon('check') : icon('x')} ${esc(r.name)} level ${r.level}</li>`).join('')}
        ${L.traders.map(r => `<li class="${traderLL(r.name, p) >= r.level ? 'ok' : 'no'}">${traderLL(r.name, p) >= r.level ? icon('check') : icon('x')} ${esc(r.name)} LL${r.level}</li>`).join('')}
        ${L.skills.map(r => { const s = skillReqStatus(r.name, r.level, p); return s === 'ok' ? `<li class="ok" data-tip="Covered by your season perks">${icon('check')} ${esc(r.name)} skill level ${r.level}</li>` : s === 'impossible' ? `<li class="no" data-tip="Your season perks cap skills below this level">${icon('x')} ${esc(r.name)} skill level ${r.level} (impossible with your perks)</li>` : `<li class="na">• ${esc(r.name)} skill level ${r.level}</li>`; }).join('')}
        ${L.other.map(o => `<li class="na">• ${o}</li>`).join('')}
      </ul>
      ${L.functionsHtml.length ? `<div class="hl-fn small muted">${L.functionsHtml.join(' · ')}</div>` : ''}
    </div>`;
  };
  return `<article class="hcard ${lv >= max ? 'maxed' : ''}">
    <div class="hc-head">
      ${img(m.img, m.name, 'h-ic')}
      <div class="hc-title"><b>${esc(m.name)}</b><div class="pips" role="group" aria-label="${attr(m.name)} level">
        <button class="pip0 ${lv === 0 ? 'on' : ''}" data-act="hlevel" data-m="${attr(m.name)}" data-l="0" data-tip="Not built">0</button>
        ${m.levels.map(L => `<button class="pip ${L.level <= lv ? 'on' : ''}" data-act="hlevel" data-m="${attr(m.name)}" data-l="${L.level}" aria-label="Level ${L.level}" data-tip="Set built level to ${L.level}">${L.level}</button>`).join('')}
      </div></div>
      <button class="ibtn" data-act="info-mod" data-m="${attr(m.name)}" aria-label="Info">${icon('info')}</button>
    </div>
    ${next ? `<div class="hc-next"><div class="sub-h">Next: level ${next.level} ${st.ok ? '<span class="badge b-av">Unlockable</span>' : ''}</div>${levelBlock(next).replace('class="hl ', 'class="hl hl-next ')}
      <button class="btn btn-s btn-p" data-act="hlevel" data-m="${attr(m.name)}" data-l="${next.level}">${icon('check')} Built level ${next.level}</button></div>` : `<div class="hc-next maxed-note">${icon('check')} Max level</div>`}
    ${max > 1 ? `<button class="linkbtn" data-act="expand-h" data-m="${attr(m.name)}">${open ? 'Hide' : 'Show'} all levels</button>` : ''}
    ${open ? `<div class="hc-all">${m.levels.map(levelBlock).join('')}</div>` : ''}
  </article>`;
}

// ---------------- PRESTIGE ----------------
export function renderPrestige(root) {
  const p = P();
  const pr = D.prestige;
  const notPvp = store.active !== 'pvp';
  const man = p.prestigeManual;
  const reached = Object.keys(p.prestige).filter(k => p.prestige[k]).map(Number);
  const cur = reached.length ? Math.max(...reached) : 0;
  const cond = (ok, html, manKey) => `<li class="${ok ? 'ok' : 'no'}">${manKey ? `<button class="cb cb-s ${ok ? 'on' : ''}" data-act="pman" data-k="${attr(manKey)}" aria-pressed="${ok}" aria-label="Toggle">${icon('check')}</button>` : `<span class="st">${ok ? icon('check') : icon('x')}</span>`}<span>${html}</span></li>`;
  root.innerHTML = `
  <div class="tab-head"><div><h1>Prestige</h1><p class="lede">${pr.introHtml || ''}</p></div><div class="head-stat">${progressBar(cur, pr.levels.length, 'Prestige')}</div></div>
  ${notPvp ? `<div class="notice">${icon('info')} According to the wiki, Prestige only exists in the <b>PvP</b> game mode. You are viewing the <b>${esc(store.profile.long)}</b> profile; conditions below are evaluated against it for reference.</div>` : ''}
  <div class="plist">${pr.levels.map(L => {
    const conds = [];
    conds.push(cond(p.settings.level >= (L.pmcLevel || 0), `PMC level ${L.pmcLevel} <span class="muted">(you: ${p.settings.level})</span>`));
    for (const q of L.quests) { const n = q.links[0]; const ok = n && D.quests[n] ? isDone(n, p) : !!man[`${L.level}|q|${q.text}`]; conds.push(cond(ok, n && D.quests[n] ? qlink(n) : q.html, n && D.quests[n] ? null : `${L.level}|q|${q.text}`)); }
    for (const s of L.story) { const ch = s.links.find(x => D.chapters[x]); const isComplete = /^complete/i.test(s.text) && ch; const ok = isComplete ? chDone(ch, p) : !!man[`${L.level}|s|${s.text}`]; conds.push(cond(ok, s.html, isComplete ? null : `${L.level}|s|${s.text}`)); }
    for (const s of L.skills) conds.push(cond(!!man[`${L.level}|k|${s.text}`], s.html, `${L.level}|k|${s.text}`));
    for (const h of L.hideout) { const m = D.hideout.modules.find(x => x.name.toLowerCase() === h.module.toLowerCase()); conds.push(cond(m ? hLevel(m.name, p) >= h.level : !!man[`${L.level}|h|${h.text}`], h.html, m ? null : `${L.level}|h|${h.text}`)); }
    if (L.itemsText) conds.push(cond(!!man[`${L.level}|i`], L.itemsHtml, `${L.level}|i`));
    const okAll = !conds.some(c => c.startsWith('<li class="no"'));
    const got = !!p.prestige[L.level];
    return `<article class="pcard ${got ? 'is-done' : ''}">
      <div class="pc-head">${img(L.img, 'Prestige ' + L.level, 'p-ic')}<div><h2>Prestige ${L.level}</h2>${okAll && !got ? '<span class="badge b-av">All conditions met</span>' : ''}</div>
      <button class="btn ${got ? 'btn-p' : ''}" data-act="prestige" data-l="${L.level}" aria-pressed="${got}">${icon('check')} ${got ? 'Reached' : 'Mark reached'}</button></div>
      <div class="grid2"><div><div class="sub-h">Conditions</div><ul class="conds">${conds.join('')}</ul></div>
      <div><div class="sub-h">Rewards</div><ul class="plain small">${L.rewards.map(r => `<li>${r}</li>`).join('')}</ul></div></div>
    </article>`;
  }).join('')}</div>`;
}

// ---------------- BATTLEPASS ----------------
export function renderBattlepass(root) {
  const p = P();
  const bp = D.battlepass;
  const now = Date.now();
  const end = bp.end ? new Date(bp.end).getTime() : null;
  const daysLeft = end ? Math.max(0, Math.ceil((end - now) / 864e5)) : null;
  const claimed = bp.levels.filter(l => p.bp[l.level]).length;
  const spent = bp.levels.filter(l => p.bp[l.level]).reduce((s, l) => s + (l.price || 0), 0);
  const total = bp.levels.reduce((s, l) => s + (l.price || 0), 0);
  const pages = {};
  for (const l of bp.levels) (pages[l.page] = pages[l.page] || []).push(l);
  root.innerHTML = `
  <div class="tab-head"><div><h1>BattlePass</h1><p class="lede">${esc(bp.season)} · ${bp.start ? new Date(bp.start).toLocaleDateString('en-GB') : ''} – ${bp.end ? new Date(bp.end).toLocaleDateString('en-GB') : ''}${daysLeft != null ? ` · <b>${daysLeft} days left</b>` : ''}. Shared across all game modes.</p></div>
    <div class="head-stat">${progressBar(claimed, bp.levels.length, 'Levels claimed')}${progressBar(spent, total, 'Documents spent')}</div></div>
  <section class="panel">
    <div class="panel-h"><h2>Documents</h2><span class="muted small">Count what you have in stash</span></div>
    <div class="docs">${bp.docTypes.map(d => { const I = D.items[d.name]; const have = p.bpDocs[d.name] || 0; return `<div class="doc">${img(I?.img, d.name, 'doc-ic')}<div class="doc-t"><b data-item="${attr(d.name)}" class="chip-name">${esc(d.name)}</b><div class="small muted">${esc(d.maps.join(', '))}</div></div><span class="ctr"><button class="ctr-b" data-act="bpdoc" data-k="${attr(d.name)}" data-d="-1" aria-label="minus">${icon('minus')}</button><span class="ctr-v">${have}</span><button class="ctr-b" data-act="bpdoc" data-k="${attr(d.name)}" data-d="1" aria-label="plus">${icon('plus')}</button></span></div>`; }).join('')}</div>
    ${bp.introHtml ? `<details><summary>How progression works</summary><p class="small">${bp.introHtml}</p>${bp.limitsHtml.map(l => `<p class="small">${l}</p>`).join('')}${bp.rewardsIntroHtml ? `<p class="small">${bp.rewardsIntroHtml}</p>` : ''}</details>` : ''}
  </section>
  ${Object.entries(pages).map(([pg, ls]) => `<section class="bp-page"><h2>Page ${pg}</h2><div class="bp-grid">${ls.map(l => `<button class="bp-lv ${p.bp[l.level] ? 'on' : ''}" data-act="bp" data-l="${l.level}" aria-pressed="${!!p.bp[l.level]}">
      <span class="bp-n">${l.level}</span>${img(l.img, l.name, 'bp-ic')}<span class="bp-name">${esc(l.name)}</span><span class="bp-type small muted">${esc(l.type)}</span><span class="bp-price">${l.price ?? ''} docs</span>${p.bp[l.level] ? `<span class="bp-check">${icon('check')}</span>` : ''}</button>`).join('')}</div></section>`).join('')}`;
}

// ---------------- ACHIEVEMENTS ----------------
export function renderAchievements(root) {
  const p = P();
  const A = D.achievements;
  const sections = [...new Set(A.map(a => a.section))];
  const f = ui().af || { sec: sections.filter(s => !/arena|retired/i.test(s)), status: 'all', q: '' };
  const secSel = new Set(f.sec || []);
  const q = (f.q || '').toLowerCase();
  const list = A.filter(a => secSel.has(a.section) && (f.status === 'all' || (f.status === 'done') === !!p.ach[a.name]) && (!q || (a.name + ' ' + a.desc).toLowerCase().includes(q)));
  const inSel = A.filter(a => secSel.has(a.section));
  const done = inSel.filter(a => p.ach[a.name]).length;
  const rc = (r) => /legend/i.test(r) ? 'r-leg' : /rare/i.test(r) ? 'r-rare' : 'r-com';
  root.innerHTML = `
  <div class="tab-head"><div><h1>Achievements</h1><p class="lede">Tick what you have unlocked. Filter by category below.</p></div><div class="head-stat">${progressBar(done, inSel.length, 'Selected categories')}</div></div>
  <div class="filters">
    <div class="seg multi" aria-label="Categories">${sections.map(s => `<button class="seg-b ${secSel.has(s) ? 'on' : ''}" data-act="asec" data-v="${attr(s)}" aria-pressed="${secSel.has(s)}">${esc(s)}</button>`).join('')}</div>
    <label class="search">${icon('search')}<input type="search" placeholder="Search achievements" value="${attr(f.q || '')}" data-af="q" aria-label="Search achievements"></label>
    <select data-af="status" aria-label="Status"><option value="all" ${f.status === 'all' ? 'selected' : ''}>All</option><option value="open" ${f.status === 'open' ? 'selected' : ''}>Not unlocked</option><option value="done" ${f.status === 'done' ? 'selected' : ''}>Unlocked</option></select>
  </div>
  <div class="agrid">${list.map(a => `<button class="acard ${p.ach[a.name] ? 'on' : ''} ${rc(a.rarity)}" data-act="ach" data-a="${attr(a.name)}" aria-pressed="${!!p.ach[a.name]}">
    ${img(a.img, a.name, 'a-ic')}<span class="a-body"><span class="a-name">${esc(a.name)} ${a.hidden ? '<span class="badge b-muted">Hidden</span>' : ''}</span><span class="a-desc">${a.descHtml}</span>${a.rewardHtml ? `<span class="a-rew small">Reward: ${a.rewardHtml}</span>` : ''}<span class="a-meta small"><span class="rar">${esc(a.rarity)}</span> · ${esc(a.section)}</span></span>
    <span class="a-check">${icon('check')}</span></button>`).join('') || '<div class="empty">No achievements match.</div>'}</div>`;
}

// ---------------- NEEDED ITEMS ----------------
const IDEF = { story: true, kappa: false, quests: true, hideout: true, currency: false, questItems: false, optional: false, gunsmith: true, gsAll: false, q: '', showDone: false };
export const itemFilter = () => ({ ...IDEF, ...(ui().if2 || {}) });
export const itemView = () => ui().iv || 'fit';
export function itemList() {
  const f = itemFilter();
  return neededItems({ story: f.story, kappa: f.kappa, quests: f.quests, hideout: f.hideout }, { includeCurrency: f.currency, includeQuestItems: f.questItems, includeOptional: f.optional, gunsmith: f.gunsmith, gunsmithAll: f.gsAll });
}
const PRIO = [[3, 'Needed now', 'open quests you can do now and the next hideout level you can build'], [2, 'Next up', 'story, next hideout levels once their requirements are met'], [1, 'Later', 'locked quests and later hideout levels']];
export const srcLabel = (s) => (s.type === 'hideout' ? `${s.name} L${s.level}${s.story ? ' (story)' : ''}` : s.type === 'gunsmith' ? `${s.name} – build part` : s.name);
const onlyGs = (a) => a.sources.some(s => s.type === 'gunsmith' && s.count > s.have) && a.sources.every(s => s.type === 'gunsmith' || s.count <= s.have);
const tipText = (a) => {
  const open = a.sources.filter(s => s.count > s.have);
  const gs = open.find(s => s.type === 'gunsmith');
  return `${a.item} – need ${a.need - a.have}${a.have ? ` (have ${a.have}/${a.need})` : ''}${a.fir ? `, ${a.fir} FiR` : ''}: ${open.slice(0, 4).map(s => `${srcLabel(s)} ×${s.count - s.have}`).join(', ')}${open.length > 4 ? ` +${open.length - 4}` : ''}${gs ? ` · Traders: ${gs.buy}${gs.alts?.length ? ` · or: ${gs.alts.join(', ')}` : ''}` : ''}`;
};

// one icon tile · opts.act: click action (it-tap = tick / count, ir-hl = show spawns) · opts.here: spawns on the current map · opts.sel
export function itemTile(a, opts = {}) {
  const I = D.items[a.item] || {};
  const miss = Math.max(0, a.need - a.have);
  const sel = opts.sel ?? ui().ipop === a.item;
  const gs = onlyGs(a);
  return `<button class="ig-t p${Math.min(a.prio, 3)} ${miss ? '' : 'got'} ${sel ? 'sel' : ''} ${opts.here ? 'here' : ''}" data-act="${opts.act || 'it-tap'}" data-item="${attr(a.item)}" data-tip="${attr(tipText(a))}" aria-label="${attr(`${a.item}: ${a.have} of ${a.need}`)}">
    ${img(I.img, a.item, 'ig-img')}${a.fir && miss ? '<span class="ig-fir">FiR</span>' : ''}${a.prio >= 4 ? '<span class="ig-act">!</span>' : gs ? '<span class="ig-gs">GS</span>' : ''}${opts.here ? `<span class="ig-here" aria-label="spawns on this map">${icon('map')}</span>` : ''}
    <span class="ig-n">${miss ? fmt(miss) : icon('check')}</span>${a.have && miss ? `<span class="ig-have">${fmt(a.have)}/${fmt(a.need)}</span>` : ''}</button>`;
}
export const legendHtml = () => `<div class="ig-leg small muted"><span><i class="lg p3"></i>Needed now</span><span><i class="lg p2"></i>Next up</span><span><i class="lg p1"></i>Later</span><span><b class="lg-b act">!</b> open quest you ticked</span><span><b class="lg-b fir">FiR</b> found in raid</span><span><b class="lg-b gs">GS</b> Gunsmith part no trader sells</span></div>`;

// size the tiles of every "all at once" grid so that all of them fit into the space they have
export function fitGrids(scope = document) {
  for (const wrap of scope.querySelectorAll('.ig-fitwrap')) {
    const grid = wrap.querySelector('.ig-grid');
    if (!grid) continue;
    const n = grid.children.length;
    const H = wrap.dataset.fit === 'page' ? Math.max(260, window.innerHeight - (wrap.getBoundingClientRect().top + window.scrollY) - 14) : wrap.clientHeight - 2;
    const W = grid.clientWidth || wrap.clientWidth;
    const g = 3;
    let s = 26;
    for (let t = 112; t >= 26; t--) { const cols = Math.max(1, Math.floor((W + g) / (t + g))); if (Math.ceil(n / cols) * (t + g) - g <= H) { s = t; break; } }
    grid.style.setProperty('--ig-s', s + 'px');
    grid.classList.toggle('sm', s < 52);
    grid.classList.toggle('xs', s < 38);
  }
}
let fitT = null;
addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => fitGrids(), 120); });

export function goalToggles(f, compact = false) {
  const tog = (k, l, tip) => `<button class="seg-b ${f[k] ? 'on' : ''}" data-act="ifx" data-k="${k}" aria-pressed="${!!f[k]}" data-tip="${attr(tip)}">${l}</button>`;
  return `<div class="seg multi" role="group" aria-label="Goals">
      ${tog('story', 'Story', 'Chapters you need for your ending – including the hideout levels the story requires')}
      ${tog('kappa', 'Kappa', 'All Kappa-required quests incl. Collector')}
      ${tog('quests', compact ? 'Quests' : 'All quests', 'Every unfinished quest')}
      ${tog('hideout', 'Hideout', 'Every hideout level you have not built')}
      ${compact ? '' : '<button class="seg-b" data-act="ifall" data-tip="Story + all quests + hideout">All</button>'}
    </div>`;
}

export function renderItems(root) {
  const f = itemFilter();
  const view = itemView();
  const all = itemList();
  const q = (f.q || '').toLowerCase();
  const shown = all.filter(a => !q || a.item.toLowerCase().includes(q) || a.sources.some(s => s.name.toLowerCase().includes(q)));
  const open = shown.filter(a => a.need > a.have);
  const done = shown.filter(a => a.need <= a.have);
  const firTotal = open.reduce((s, a) => s + a.fir, 0);
  const ld = lootData();
  if (!ld && lootState() === 'idle') ensureLoot();
  const where = (item) => { if (!ld) return ''; const bm = bestMaps(itemIndex(item)).slice(0, 3); return bm.length ? `<div class="i-where small muted">Best maps: ${bm.map(b => esc(mapDisplayName(b.key))).join(', ')}</div>` : ''; };
  const row = (a) => { const I = D.items[a.item] || {}; const miss = a.need - a.have; const gs = a.sources.find(s => s.type === 'gunsmith' && s.count > s.have); return `<div class="irow p${Math.min(a.prio, 3)}">
    ${img(I.img, a.item, 'i-ic')}
    <div class="i-main"><div class="i-name"><span class="chip-name" data-item="${attr(a.item)}" data-tip-item="${attr(a.item)}">${esc(a.item)}</span></div>
      <div class="i-src small">${a.sources.filter(s => s.count > s.have).slice(0, 6).map(s => `<span class="src">${s.type === 'hideout' ? esc(srcLabel(s)) : s.type === 'chapter' ? `<a class="wl" data-t="${attr(s.name)}">${esc(s.name)}</a>` : qlink(s.name) + (s.type === 'gunsmith' ? ' <span class="muted">part</span>' : '')} ×${fmt(s.count - s.have)}${s.fir ? ' <span class="fir">FiR</span>' : ''}</span>`).join('')}</div>${gs ? `<div class="small muted">Traders: ${esc(gs.buy)}${gs.alts?.length ? ` · or one of: ${esc(gs.alts.join(', '))}` : ''}</div>` : ''}${where(a.item)}</div>
    <div class="i-num"><b>${fmt(Math.max(0, miss))}</b>${a.fir ? `<span class="fir">${fmt(a.fir)} FiR</span>` : ''}</div>
    <button class="btn btn-s" data-act="it-tap" data-item="${attr(a.item)}">Have</button>
    <button class="ibtn" data-act="info-item" data-item="${attr(a.item)}" aria-label="Where to find">${icon('info')}</button>
  </div>`; };
  const pop = ui().ipop ? all.find(a => a.item === ui().ipop) : null;
  const section = ([pr, title, hint]) => {
    const list = open.filter(a => Math.min(a.prio, 3) === pr);
    if (!list.length) return '';
    return `<section class="ig-sec"><h2 class="ig-h">${title} <span class="muted small">${list.length} items · ${hint}</span></h2>
      ${view === 'list' ? `<div class="ilist">${list.map(row).join('')}</div>` : `<div class="ig-grid">${list.map(a => itemTile(a)).join('')}</div>`}</section>`;
  };
  const any = f.story || f.kappa || f.quests || f.hideout;
  root.innerHTML = `
  <div class="tab-head"><div><h1>Needed Items</h1><p class="lede">Everything you still need for the goals you pick. Click an item to tick it (or set how many you have) – most urgent first.</p></div>
    <div class="head-stat"><div class="stat"><b>${open.length}</b> items · <b>${fmt(open.reduce((s, a) => s + a.need - a.have, 0))}</b> pieces · <b class="c-red">${fmt(firTotal)}</b> must be FiR</div></div></div>
  ${perksNotesHtml('items')}
  <div class="filters">
    <span class="small muted">For</span>
    ${goalToggles(f)}
    <label class="search">${icon('search')}<input type="search" placeholder="Search items or quests" value="${attr(f.q || '')}" data-if2="q" aria-label="Search items"></label>
    <div class="seg" role="radiogroup" aria-label="View">${[['fit', 'All at once', 'Every item on one screen – tiles shrink to fit'], ['grid', 'By priority', 'Bigger icons, grouped by priority'], ['list', 'List', 'With sources and best maps']].map(([v, l, t]) => `<button role="radio" aria-checked="${view === v}" class="seg-b ${view === v ? 'on' : ''}" data-act="ifv" data-v="${v}" data-tip="${attr(t)}">${l}</button>`).join('')}</div>
    <label class="tog" data-tip="Parts of the wiki's example Gunsmith builds that no trader sells for money (barter-only or loot-only)"><input type="checkbox" data-if2="gunsmith" ${f.gunsmith ? 'checked' : ''}> Gunsmith parts</label>
    ${f.gunsmith ? `<label class="tog" data-tip="Also list the Gunsmith parts you can buy from traders"><input type="checkbox" data-if2="gsAll" ${f.gsAll ? 'checked' : ''}> + buyable</label>` : ''}
    <label class="tog"><input type="checkbox" data-if2="currency" ${f.currency ? 'checked' : ''}> Money</label>
    <label class="tog"><input type="checkbox" data-if2="questItems" ${f.questItems ? 'checked' : ''}> Quest items</label>
    <label class="tog"><input type="checkbox" data-if2="optional" ${f.optional ? 'checked' : ''}> Optional</label>
  </div>
  ${!any ? '<div class="empty">Pick at least one goal above.</div>' : ''}
  ${view === 'fit' ? (open.length ? `${legendHtml()}<div class="ig-fitwrap" data-fit="page"><div class="ig-grid fit">${open.map(a => itemTile(a)).join('')}</div></div>` : any ? '<div class="empty">Nothing left to collect for these goals.</div>' : '')
    : (PRIO.map(section).join('') || (any ? '<div class="empty">Nothing left to collect for these goals.</div>' : ''))}
  ${done.length ? `<section class="ig-sec"><h2 class="ig-h"><button class="linkbtn" data-act="ifx" data-k="showDone">${f.showDone ? 'Hide' : 'Show'} collected (${done.length})</button></h2>${f.showDone ? `<div class="ig-grid">${done.map(a => itemTile(a)).join('')}</div>` : ''}</section>` : ''}
  ${pop ? itemPop(pop) : ''}`;
  fitGrids(root);
}

export function itemPop(a) {
  const I = D.items[a.item] || {};
  const open = a.sources.filter(s => s.count > 0);
  return `<div class="ipop" role="dialog" aria-label="${attr(a.item)}">
    <div class="ipop-h">${img(I.img, a.item, 'ipop-img')}<div class="ipop-t"><b>${esc(a.item)}</b><span class="small muted">need ${fmt(a.need)}${a.fir ? ` · ${fmt(a.fir)} FiR` : ''}</span></div><button class="ibtn" data-act="it-close" aria-label="Close">${icon('x')}</button></div>
    <div class="ipop-c">
      <button class="btn" data-act="it-set" data-item="${attr(a.item)}" data-v="${Math.max(0, a.have - 1)}" aria-label="One less">${icon('minus')}</button>
      <input type="number" min="0" max="${a.need}" value="${a.have}" data-itset="${attr(a.item)}" aria-label="How many you have">
      <span class="ipop-of">/ ${fmt(a.need)}</span>
      <button class="btn" data-act="it-set" data-item="${attr(a.item)}" data-v="${Math.min(a.need, a.have + 1)}" aria-label="One more">${icon('plus')}</button>
      <button class="btn btn-p" data-act="it-set" data-item="${attr(a.item)}" data-v="${a.need}">All</button>
      <button class="btn" data-act="it-set" data-item="${attr(a.item)}" data-v="0">None</button>
    </div>
    <div class="ipop-s small">${open.map(s => `<div><span class="${s.count > s.have ? '' : 'muted'}">${esc(srcLabel(s))}</span> <b>${fmt(s.have)}/${fmt(s.count)}</b>${s.fir ? ' <span class="fir">FiR</span>' : ''}${s.type === 'gunsmith' ? ` <span class="muted">· ${esc(s.buy)}${s.alts?.length ? ` · or: ${esc(s.alts.join(', '))}` : ''}</span>` : ''}</div>`).join('')}</div>
    <div class="ipop-f"><button class="linkbtn" data-act="info-item" data-item="${attr(a.item)}">Where to find</button></div>
  </div>`;
}
