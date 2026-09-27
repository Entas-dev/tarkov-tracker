// Story, Kappa, Traders, All quests tabs
import { store } from './store.js';
import { D, IX, P, ENDINGS, condStatus, traderUnlocked, visible, questStatus, isDone, chDone, chapterProgress, chapterClosure, traderLL, questNeeds, isSeasonal } from './model.js';
import { esc, attr, icon, img, traderImg, qlink, itemChip, progressBar, fmt, statusBadge } from './ui.js';
import { questCard, objectiveRows, needsBlock, mapChips, expanded } from './components.js';
import { perksNotesHtml } from './perks.js';
import { taskScreen, chapterScreen } from './tasks.js';

const ui = () => store.ui;
const setUi = (k, v) => store.setUi(k, v);

// ---------------- MAIN STORY ----------------
export function renderStory(root) {
  const p = P();
  const ending = p.settings.ending || 'Savior';
  const E = D.endings?.endings || {};
  const ticket = D.chapters['The Ticket'];
  const required = new Set(['The Ticket', ...chapterClosure('The Ticket')]);
  if (ticket) for (const o of ticket.objectives) if (!o.endings || o.endings.includes(ending)) for (const m of (o.html + (o.cond || '')).matchAll(/data-t="([^"]+)"/g)) if (D.chapters[m[1]]) { required.add(m[1]); for (const d of chapterClosure(m[1])) required.add(d); }
  const order = IX.chapterOrder;
  const reqDone = order.filter(c => required.has(c) && chDone(c, p)).length;
  const reqTotal = order.filter(c => required.has(c)).length;
  const e = E[ending];
  root.innerHTML = `
  <div class="tab-head">
    <div><h1>Main Story</h1><p class="lede">Finish <b>The Ticket</b>. Pick the ending you are going for; objectives of other paths are hidden.</p></div>
    <div class="head-stat">${progressBar(reqDone, reqTotal, 'Chapters for ' + ending)}</div>
  </div>
  <div class="endings" role="radiogroup" aria-label="Target ending">
    ${ENDINGS.map(n => `<button class="ending ${n === ending ? 'on' : ''}" role="radio" aria-checked="${n === ending}" data-act="ending" data-e="${n}">${img(E[n]?.img, n, 'ending-ic')}<span>${n}</span></button>`).join('')}
    ${D.endings?.flowchartImg ? `<a class="btn" href="${attr(D.endings.flowchartImg.replace(/\/scale-to-width-down\/\d+/, ''))}" target="_blank" rel="noopener">${icon('ext')} Endings flowchart</a>` : ''}
  </div>
  <div class="choices"><span class="perk-lbl">Your story choices</span>
    ${choiceSeg('armoredCase', 'Armored case (Falling Skies)', [['gave', 'Gave it to Prapor'], ['kept', 'Kept it']])}
    ${choiceSeg('evidence', 'Major evidence (They Are Already Here)', [['received', 'Received'], ['failed', 'Failed']])}
    <span class="small muted">Used to hide the branches you did not take and to auto-check earlier steps correctly.</span></div>
  ${e ? `<div class="ending-card"><div class="ending-quote">${e.quoteHtml}</div>${e.rewardsHtml?.length ? `<details><summary>${esc(ending)} rewards</summary><ul>${e.rewardsHtml.map(r => `<li>${r}</li>`).join('')}</ul></details>` : ''}</div>` : ''}
  ${chapterScreen({ order, required, ending })}`;
}

function choiceSeg(k, label, opts) {
  const cur = P().settings.choices?.[k];
  return `<span class="choice"><span class="small">${esc(label)}:</span><span class="seg">${opts.map(([v, l]) => `<button class="seg-b ${cur === v ? 'on' : ''}" data-act="choice" data-k="${k}" data-v="${v}" aria-pressed="${cur === v}">${esc(l)}</button>`).join('')}</span></span>`;
}

function chapterCard(c, required, ending) {
  const p = P();
  const done = chDone(c.name, p);
  const pr = chapterProgress(c, p);
  const open = expanded.has('ch:' + c.name);
  const others = c.objectives.filter(o => (o.endings && !o.endings.includes(ending)) || condStatus(o.cond, p) === false).length;
  const endRew = c.endingRewards?.[ending];
  return `<article class="chcard ${done ? 'is-done' : ''} ${required ? '' : 'ch-opt'} ${open ? 'open' : ''}">
    <div class="qc-head">
      <button class="cb ${done ? 'on' : ''}" data-act="chapter" data-c="${attr(c.name)}" aria-pressed="${done}" aria-label="Mark chapter done">${icon('check')}</button>
      ${img(c.iconImg, '', 'ch-ic')}
      <div class="qc-main" data-act="expand-ch" data-c="${attr(c.name)}">
        <div class="qc-title"><span class="ch-name">${esc(c.name)}</span> ${required ? '<span class="badge b-req">Required</span>' : '<span class="badge b-muted">Side chapter</span>'}</div>
        <div class="qc-meta"><span>${pr.done}/${pr.total} objectives</span>${c.maps.length ? `<span>${esc(c.maps.join(', '))}</span>` : ''}${others ? `<span class="muted">${others} objectives on other paths hidden</span>` : ''}</div>
      </div>
      ${done ? statusBadge('done') : ''}
      <button class="ibtn" data-act="info-ch" data-c="${attr(c.name)}" aria-label="Info">${icon('info')}</button>
      <button class="ibtn chev ${open ? 'rot' : ''}" data-act="expand-ch" data-c="${attr(c.name)}" aria-label="Expand">${icon('chevron')}</button>
    </div>
    ${open ? `<div class="qc-body">
      ${c.descHtml ? `<blockquote>${c.descHtml}</blockquote>` : ''}
      ${c.reqHtml.length ? `<div class="sub-h">Unlock</div>${c.reqHtml.map(r => `<p class="small">${r}</p>`).join('')}` : ''}
      <div class="sub-h">Objectives</div>${objectiveRows(c, { chapter: true, ending })}
      ${needsBlock(c, { chapter: true, ending })}
      ${c.rewardsHtml.length || endRew ? `<details class="rew"><summary>Rewards</summary><ul>${[...c.rewardsHtml, ...(endRew || [])].map(r => `<li>${r.html}</li>`).join('')}</ul></details>` : ''}
    </div>` : ''}
  </article>`;
}

// ---------------- shared quest list ----------------
function filterBar(prefix, { trader = true, map = true, kappaToggle = true, statusDefault = 'open' } = {}) {
  const f = ui()[prefix] || {};
  const st = f.status || statusDefault;
  return `<div class="filters" data-fprefix="${prefix}">
    <label class="search">${icon('search')}<input type="search" placeholder="Search quests, items, maps…" value="${attr(f.q || '')}" data-f="q" aria-label="Search"></label>
    <select data-f="status" aria-label="Status">
      ${[['open', 'Not done'], ['available', 'Available now'], ['locked', 'Locked'], ['done', 'Done'], ['all', 'All']].map(([v, l]) => `<option value="${v}" ${st === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    ${trader ? `<select data-f="trader" aria-label="Trader"><option value="">All traders</option>${IX.traders.map(t => `<option ${f.trader === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
    ${map ? `<select data-f="map" aria-label="Map"><option value="">All maps</option>${IX.maps.map(m => `<option ${f.map === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>` : ''}
    ${kappaToggle ? `<label class="tog"><input type="checkbox" data-f="kappa" ${f.kappa ? 'checked' : ''}> Kappa only</label>` : ''}
    <select data-f="sort" aria-label="Sort"><option value="order" ${f.sort !== 'level' && f.sort !== 'name' ? 'selected' : ''}>Quest order</option><option value="level" ${f.sort === 'level' ? 'selected' : ''}>Level</option><option value="name" ${f.sort === 'name' ? 'selected' : ''}>Name</option></select>
  </div>`;
}

function applyFilters(names, prefix, statusDefault = 'open') {
  const p = P();
  const f = ui()[prefix] || {};
  const st = f.status || statusDefault;
  const q = (f.q || '').toLowerCase().trim();
  let out = names.filter(n => {
    const Q = D.quests[n];
    if (!visible(Q, p)) return false;
    if (f.trader && Q.trader !== f.trader) return false;
    if (f.map && !Q.allMaps.includes(f.map)) return false;
    if (f.kappa && !IX.kappa.has(n)) return false;
    const s = questStatus(Q, p).s;
    if (st === 'open' && (s === 'done' || s === 'blocked')) return false;
    if (st !== 'open' && st !== 'all' && s !== st) return false;
    if (q) {
      const hay = (n + ' ' + (Q.trader || '') + ' ' + Q.allMaps.join(' ') + ' ' + Q.objectives.map(o => o.text).join(' ') + ' ' + (Q.needs || []).map(x => x.item).join(' ')).toLowerCase();
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  });
  if (f.sort === 'level') out.sort((a, b) => IX.effLevel(a) - IX.effLevel(b) || IX.rank[a] - IX.rank[b]);
  else if (f.sort === 'name') out.sort((a, b) => a.localeCompare(b));
  return out;
}

function listHtml(names, limitKey, opts) {
  const lim = ui()[limitKey] || 120;
  const shown = names.slice(0, lim);
  return `<div class="qlist">${shown.map(n => questCard(D.quests[n], opts)).join('') || '<div class="empty">Nothing here with the current filters.</div>'}</div>
    ${names.length > lim ? `<button class="btn more" data-act="more" data-k="${limitKey}">Show ${Math.min(150, names.length - lim)} more (${names.length - lim} hidden)</button>` : ''}`;
}

// ---------------- KAPPA ----------------
export function renderKappa(root) {
  const p = P();
  const kap = IX.order.filter(n => IX.kappa.has(n) && visible(D.quests[n], p));
  const done = kap.filter(n => isDone(n, p)).length;
  const col = D.quests['Collector'];
  const kItem = D.items['Secure container Kappa'];
  const traders = ['Prapor', 'Therapist', 'Skier', 'Peacekeeper', 'Mechanic', 'Ragman', 'Jaeger'];
  const colNeeds = col ? questNeeds(col, p, { includeOptional: false }) : [];
  const colHave = colNeeds.filter(n => n.missing === 0).length;
  root.innerHTML = `
  <div class="tab-head">
    <div class="th-with-img">${img(kItem?.img, 'Kappa', 'kappa-img')}<div><h1>Kappa</h1><p class="lede">Everything needed to finish <b>Collector</b> (Fence) and get the Kappa container.</p></div></div>
    <div class="head-stat">${progressBar(done, kap.length, 'Kappa quests')}${progressBar(colHave, colNeeds.length, 'Collector items')}</div>
  </div>
  ${perksNotesHtml('kappa')}
  ${col ? `<section class="panel">
    <div class="panel-h"><h2>Collector</h2>${statusBadge(questStatus(col, p).s)}<button class="ibtn" data-act="info" data-q="Collector" aria-label="Info">${icon('info')}</button></div>
    <div class="grid12">
      <div><div class="sub-h">Requirements</div><ul class="plain">${col.reqHtml.map(r => `<li class="d${r.depth}">${r.html}</li>`).join('')}</ul>
      <div class="ll-row">${traders.map(t => { const ll = traderLL(t, p); return `<span class="ll-pill ${ll >= 4 ? 'ok' : ''}" data-tip="${attr(t)}: LL${ll} (need 4)">${traderImg(t, 'll-ic')}LL${ll}</span>`; }).join('')}</div></div>
      <div><div class="sub-h">Items to hand over <span class="muted">(${colHave}/${colNeeds.length})</span></div><div class="chips cgrid">${colNeeds.map(n => itemChip(n.item, { count: n.count, have: n.have, fir: n.fir, counter: `Collector|${n.item}` })).join('')}</div></div>
    </div>
  </section>` : ''}
  ${taskScreen({ id: 'kappa', names: kap, group: 'trader', showKappaToggle: false })}`;
}

// ---------------- TRADERS ----------------
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
export function renderTraders(root) {
  const p = P();
  const list = IX.traders.filter(t => D.traders[t] || IX.byTrader[t]);
  let sel = ui().trader && list.includes(ui().trader) ? ui().trader : list[0];
  const T = D.traders[sel] || { name: sel, ll: [] };
  const qs = (IX.byTrader[sel] || []).filter(n => visible(D.quests[n], p));
  const done = qs.filter(n => isDone(n, p)).length;
  const ll = traderLL(sel, p);
  const manual = p.settings.ll?.[sel] != null;
  root.innerHTML = `
  <div class="tr-strip" role="tablist" aria-label="Traders">
    ${list.map(t => { const all = (IX.byTrader[t] || []).filter(n => visible(D.quests[n], p)); const d = all.filter(n => isDone(n, p)).length; const locked = IX.tourGates?.[t] && !traderUnlocked(t, p); const tl = traderLL(t, p); return `<button role="tab" aria-selected="${t === sel}" class="tr-card ${t === sel ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="trader" data-t="${attr(t)}">
      <span class="tr-pic">${traderImg(t, 'tr-portrait')}${D.traders[t]?.ll?.length && t !== 'Fence' ? `<span class="tr-ll">${ROMAN[tl] || tl}</span>` : ''}${locked ? `<span class="tr-lock">${icon('lock')}</span>` : ''}</span>
      <span class="tr-name">${esc(t)}</span><span class="tr-prog">${d}/${all.length}</span></button>`; }).join('')}
  </div>
  ${perksNotesHtml('traders')}
  ${IX.tourGates?.[sel] && !traderUnlocked(sel, p) ? `<div class="notice">${icon('lock')}<div><b>${esc(sel)}</b> is still locked. It unlocks in the story chapter <b>Tour</b> at step <b>${esc(IX.tourGates[sel].step)}</b>. Tick that step in the Main Story tab (or any ${esc(sel)} quest) to unlock it here.</div></div>` : ''}
  <div class="tr-bar">
    <div class="tr-bar-name"><b>${esc(sel)}</b>${T.fullName ? `<span class="muted">${esc(T.fullName)}</span>` : ''}</div>
    <div class="tr-bar-prog">${progressBar(done, qs.length, 'Tasks')}</div>
    ${T.ll?.length && sel !== 'Fence' ? `<div class="tr-llsel"><span class="muted">Loyalty</span>${[1, ...T.ll.map(r => r.level)].map(l => { const r = T.ll.find(x => x.level === l); return `<button class="tr-llb ${ll === l ? 'on' : ''}" data-act="setll" data-t="${attr(sel)}" data-l="${l}" data-tip="${attr(l === 1 ? 'LL1' : `LL${l}: PMC level ${r?.pmcLevel ?? '–'}, reputation ${r?.rep ?? '–'}`)}">${ROMAN[l]}</button>`; }).join('')}<span class="small muted">${manual ? `set by you · <button class="linkbtn" data-act="setll" data-t="${attr(sel)}" data-l="">auto</button>` : 'estimated from your level'}</span></div>` : ''}
    ${T.notesHtml?.length ? `<details class="tr-notes"><summary>Notes</summary><ul>${T.notesHtml.map(n => `<li>${n}</li>`).join('')}</ul></details>` : ''}
  </div>
  ${taskScreen({ id: 'tr-' + sel, names: IX.byTrader[sel] || [], group: 'll' })}`;
}

// ---------------- ALL QUESTS ----------------
export function renderQuests(root) {
  const p = P();
  const all = IX.order.filter(n => visible(D.quests[n], p));
  const done = all.filter(n => isDone(n, p)).length;
  const avail = all.filter(n => questStatus(D.quests[n], p).s === 'available').length;
  root.innerHTML = `
  <div class="tab-head"><div><h1>All Quests</h1><p class="lede">${all.length} quests for this profile · <b>${avail}</b> available right now at level ${p.settings.level}. <button class="btn btn-s" data-act="active-setup">Set my open quests</button></p></div>
    <div class="head-stat">${progressBar(done, all.length, 'All quests')}</div></div>
  ${taskScreen({ id: 'all', names: IX.order, group: 'trader' })}`;
}
