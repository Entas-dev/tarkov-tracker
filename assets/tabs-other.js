// Hideout, Prestige, BattlePass, Achievements, Items tabs
import { store } from './store.js';
import { D, IX, P, hLevel, moduleMax, levelReqStatus, hcntKey, isSeasonal, isPvE, isDone, chDone, traderLL, shoppingList, questStatus } from './model.js';
import { esc, attr, icon, img, qlink, itemChip, progressBar, fmt, statusBadge, traderImg } from './ui.js';
import { expanded } from './components.js';
import { skillReqStatus, perksNotesHtml } from './perks.js';

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

// ---------------- ITEMS (shopping list) ----------------
export function renderItems(root) {
  const f = ui().if || { scope: 'all', currency: false, questItems: false, optional: false, q: '' };
  const list = shoppingList({ scope: f.scope, includeCurrency: f.currency, includeQuestItems: f.questItems, includeOptional: f.optional });
  const q = (f.q || '').toLowerCase();
  const shown = list.filter(a => !q || a.item.toLowerCase().includes(q));
  const firTotal = shown.reduce((s, a) => s + a.fir, 0);
  const lim = ui().iLim || 150;
  root.innerHTML = `
  <div class="tab-head"><div><h1>Needed Items</h1><p class="lede">Everything you still need across unfinished quests, story and hideout. Don't sell these.</p></div>
    <div class="head-stat"><div class="stat"><b>${shown.length}</b> different items · <b>${fmt(shown.reduce((s, a) => s + a.need - a.have, 0))}</b> pieces · <b class="c-red">${fmt(firTotal)}</b> must be FiR</div></div></div>
  ${perksNotesHtml('items')}
  <div class="filters">
    <div class="seg" role="radiogroup" aria-label="Scope">${[['all', 'Everything'], ['kappa', 'Kappa quests'], ['hideout', 'Hideout'], ['story', 'Story']].map(([v, l]) => `<button role="radio" aria-checked="${f.scope === v}" class="seg-b ${f.scope === v ? 'on' : ''}" data-act="iscope" data-v="${v}">${l}</button>`).join('')}</div>
    <label class="search">${icon('search')}<input type="search" placeholder="Search items" value="${attr(f.q || '')}" data-if="q" aria-label="Search items"></label>
    <label class="tog"><input type="checkbox" data-if="currency" ${f.currency ? 'checked' : ''}> Money</label>
    <label class="tog"><input type="checkbox" data-if="questItems" ${f.questItems ? 'checked' : ''}> Quest-only items</label>
    <label class="tog"><input type="checkbox" data-if="optional" ${f.optional ? 'checked' : ''}> Optional objectives</label>
  </div>
  <div class="ilist">${shown.slice(0, lim).map(a => { const I = D.items[a.item] || {}; const miss = a.need - a.have; return `<div class="irow">
    ${img(I.img, a.item, 'i-ic')}
    <div class="i-main"><div class="i-name"><span class="chip-name" data-item="${attr(a.item)}" data-tip-item="${attr(a.item)}">${esc(a.item)}</span></div>
      <div class="i-src small">${a.sources.slice(0, 6).map(s => `<span class="src">${s.type === 'hideout' ? `${esc(s.name)} L${s.level}` : s.type === 'chapter' ? `<a class="wl" data-t="${attr(s.name)}">${esc(s.name)}</a>` : qlink(s.name)} ×${fmt(s.count - (s.have || 0))}${s.fir ? ' <span class="fir">FiR</span>' : ''}</span>`).join('')}${a.sources.length > 6 ? `<span class="muted">+${a.sources.length - 6} more</span>` : ''}</div></div>
    <div class="i-num"><b>${fmt(miss)}</b>${a.fir ? `<span class="fir">${fmt(a.fir)} FiR</span>` : ''}</div>
    <button class="ibtn" data-act="info-item" data-item="${attr(a.item)}" aria-label="Where to find">${icon('info')}</button>
  </div>`; }).join('') || '<div class="empty">Nothing left to collect for this scope.</div>'}</div>
  ${shown.length > lim ? `<button class="btn more" data-act="more" data-k="iLim">Show more (${shown.length - lim} hidden)</button>` : ''}`;
}
