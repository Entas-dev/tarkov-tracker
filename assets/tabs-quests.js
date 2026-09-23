// Story, Kappa, Traders, All quests tabs
import { store } from './store.js';
import { D, IX, P, ENDINGS, visible, questStatus, isDone, chDone, chapterProgress, chapterClosure, traderLL, questNeeds, isSeasonal } from './model.js';
import { esc, attr, icon, img, traderImg, qlink, itemChip, progressBar, fmt, statusBadge } from './ui.js';
import { questCard, objectiveRows, needsBlock, mapChips, expanded } from './components.js';

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
  ${e ? `<div class="ending-card"><div class="ending-quote">${e.quoteHtml}</div>${e.rewardsHtml?.length ? `<details><summary>${esc(ending)} rewards</summary><ul>${e.rewardsHtml.map(r => `<li>${r}</li>`).join('')}</ul></details>` : ''}</div>` : ''}
  <div class="chapters">
    ${order.map(n => chapterCard(D.chapters[n], required.has(n), ending)).join('')}
  </div>`;
}

function chapterCard(c, required, ending) {
  const p = P();
  const done = chDone(c.name, p);
  const pr = chapterProgress(c, p);
  const open = expanded.has('ch:' + c.name);
  const others = c.objectives.filter(o => o.endings && !o.endings.includes(ending)).length;
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
      ${needsBlock(c, { chapter: true })}
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
  const names = applyFilters(kap, 'kf');
  const traders = ['Prapor', 'Therapist', 'Skier', 'Peacekeeper', 'Mechanic', 'Ragman', 'Jaeger'];
  const colNeeds = col ? questNeeds(col, p, { includeOptional: false }) : [];
  const colHave = colNeeds.filter(n => n.missing === 0).length;
  root.innerHTML = `
  <div class="tab-head">
    <div class="th-with-img">${img(kItem?.img, 'Kappa', 'kappa-img')}<div><h1>Kappa</h1><p class="lede">Everything needed to finish <b>Collector</b> (Fence) and get the Kappa container.</p></div></div>
    <div class="head-stat">${progressBar(done, kap.length, 'Kappa quests')}${progressBar(colHave, colNeeds.length, 'Collector items')}</div>
  </div>
  ${col ? `<section class="panel">
    <div class="panel-h"><h2>Collector</h2>${statusBadge(questStatus(col, p).s)}<button class="ibtn" data-act="info" data-q="Collector" aria-label="Info">${icon('info')}</button></div>
    <div class="grid12">
      <div><div class="sub-h">Requirements</div><ul class="plain">${col.reqHtml.map(r => `<li class="d${r.depth}">${r.html}</li>`).join('')}</ul>
      <div class="ll-row">${traders.map(t => { const ll = traderLL(t, p); return `<span class="ll-pill ${ll >= 4 ? 'ok' : ''}" data-tip="${attr(t)}: LL${ll} (need 4)">${traderImg(t, 'll-ic')}LL${ll}</span>`; }).join('')}</div></div>
      <div><div class="sub-h">Items to hand over <span class="muted">(${colHave}/${colNeeds.length})</span></div><div class="chips cgrid">${colNeeds.map(n => itemChip(n.item, { count: n.count, have: n.have, fir: n.fir, counter: `Collector|${n.item}` })).join('')}</div></div>
    </div>
  </section>` : ''}
  ${filterBar('kf', { kappaToggle: false })}
  <div class="count-line">${names.length} quests shown</div>
  ${listHtml(names, 'kLim')}`;
}

// ---------------- TRADERS ----------------
export function renderTraders(root) {
  const p = P();
  const list = IX.traders.filter(t => D.traders[t] || IX.byTrader[t]);
  let sel = ui().trader && list.includes(ui().trader) ? ui().trader : list[0];
  const T = D.traders[sel] || { name: sel, ll: [] };
  const qs = (IX.byTrader[sel] || []).filter(n => visible(D.quests[n], p));
  const done = qs.filter(n => isDone(n, p)).length;
  const ll = traderLL(sel, p);
  const names = applyFilters(qs, 'tf');
  root.innerHTML = `
  <div class="tab-head"><div><h1>Traders</h1><p class="lede">Quests per trader in unlock order, plus loyalty levels.</p></div></div>
  <div class="trader-row" role="tablist" aria-label="Traders">
    ${list.map(t => { const all = (IX.byTrader[t] || []).filter(n => visible(D.quests[n], p)); const d = all.filter(n => isDone(n, p)).length; return `<button role="tab" aria-selected="${t === sel}" class="trader-tab ${t === sel ? 'on' : ''}" data-act="trader" data-t="${attr(t)}">${traderImg(t, 'tt-big')}<span class="tn">${esc(t)}</span><span class="tp">${d}/${all.length}</span></button>`; }).join('')}
  </div>
  <section class="panel trader-panel">
    <div class="trader-hero">${img(T.img, sel, 'trader-portrait')}
      <div class="trader-info">
        <h2>${esc(sel)}</h2>${T.fullName ? `<div class="muted">${esc(T.fullName)}</div>` : ''}
        ${progressBar(done, qs.length, 'Quests')}
        ${T.ll?.length ? `<table class="tbl ll-tbl"><thead><tr><th>LL</th><th>PMC level</th><th>Reputation</th>${T.ll.some(r => r.spend) ? '<th>Spent</th>' : ''}<th></th></tr></thead><tbody>
          <tr class="${ll === 1 ? 'cur' : ''}"><td>1</td><td>–</td><td>–</td>${T.ll.some(r => r.spend) ? '<td>–</td>' : ''}<td><button class="btn btn-s ${ll === 1 ? 'btn-p' : ''}" data-act="setll" data-t="${attr(sel)}" data-l="1">Current</button></td></tr>
          ${T.ll.map(r => `<tr class="${ll === r.level ? 'cur' : ''}"><td>${r.level}</td><td>${r.pmcLevel ?? '–'}</td><td>${r.rep ?? '–'}</td>${T.ll.some(x => x.spend) ? `<td>${esc(r.spend || '–')}</td>` : ''}<td><button class="btn btn-s ${ll === r.level ? 'btn-p' : ''}" data-act="setll" data-t="${attr(sel)}" data-l="${r.level}">Current</button></td></tr>`).join('')}
        </tbody></table>
        <div class="small muted">Your LL: <b>${ll}</b> ${p.settings.ll?.[sel] == null ? '(estimated from your PMC level – click "Current" to set it exactly)' : '(set manually)'} ${p.settings.ll?.[sel] != null ? `<button class="linkbtn" data-act="setll" data-t="${attr(sel)}" data-l="">reset to auto</button>` : ''}</div>` : ''}
        ${T.notesHtml?.length ? `<details><summary>Notes</summary><ul>${T.notesHtml.map(n => `<li>${n}</li>`).join('')}</ul></details>` : ''}
      </div>
    </div>
  </section>
  ${filterBar('tf', { trader: false })}
  ${listHtml(names, 'tLim', { showTrader: false })}`;
}

// ---------------- ALL QUESTS ----------------
export function renderQuests(root) {
  const p = P();
  const all = IX.order.filter(n => visible(D.quests[n], p));
  const done = all.filter(n => isDone(n, p)).length;
  const avail = all.filter(n => questStatus(D.quests[n], p).s === 'available').length;
  const names = applyFilters(IX.order, 'qf');
  root.innerHTML = `
  <div class="tab-head"><div><h1>All Quests</h1><p class="lede">${all.length} quests for this profile · <b>${avail}</b> available right now at level ${p.settings.level}.</p></div>
    <div class="head-stat">${progressBar(done, all.length, 'All quests')}</div></div>
  ${filterBar('qf')}
  <div class="count-line">${names.length} quests shown</div>
  ${listHtml(names, 'qLim')}`;
}
