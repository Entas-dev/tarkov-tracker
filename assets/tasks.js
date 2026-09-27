// In-game style task screen: task list grouped by loyalty level (or trader) on the left, task details on the right.
import { store } from './store.js';
import { D, IX, P, visible, questStatus, isDone, questObjProgress, questNeeds, traderLL, traderUnlocked, questMapsUnlocked, preOf, groupSatisfied, varNeed, chReqMet, isSeasonal } from './model.js';
import { esc, attr, icon, img, traderImg, qlink, itemChip, fmt } from './ui.js';
import { objectiveRows, needsBlock, questBadges } from './components.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
// quests without a loyalty level unlock through task chains / the story, not through a trader LL (patch 1.1)
const llGroup = (q) => (q.ll?.level ? `LL${q.ll.level}` : 'chain');
const CHAIN_SVG = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9.5 14.5l5-5"/><path d="M7.5 11.5l-2 2a3.5 3.5 0 005 5l2-2"/><path d="M16.5 12.5l2-2a3.5 3.5 0 00-5-5l-2 2"/></svg>';

// ---------- task type (the icon in front of every task, like in the game) ----------
const hasKids = (q, o) => q.objectives.some(x => x.parent === o.id);
export function taskType(q) {
  if (q._type) return q._type;
  const req = q.objectives.filter(o => !o.optional && !hasKids(q, o));
  const k = (x) => req.filter(o => o.kind === x).length;
  let t = 'complete';
  if (req.length && req.every(o => o.kind === 'kill' || o.kind === 'extract') && k('kill')) t = 'elim';
  else if (req.some(o => o.kind === 'find' && (o.items || []).some(i => D.items[i.item]?.questItem)) && !k('kill')) t = 'discover';
  else if (req.length && req.every(o => /skill/i.test(o.text) || o.kind === 'other') && req.some(o => /skill/i.test(o.text))) t = 'skill';
  else if (k('sell') || req.some(o => o.kind === 'handover' && (o.items || []).some(i => D.items[i.item]?.currency))) t = 'merchant';
  return (q._type = t);
}
const TYPE_LABEL = { elim: 'Elimination', discover: 'Discover', complete: 'Completion', skill: 'Skill', merchant: 'Merchant' };
const TYPE_SVG = {
  elim: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/>',
  discover: '<circle cx="10" cy="10" r="6.2"/><path d="M14.6 14.6L21 21"/>',
  complete: '<path d="M3.5 3v18M3.5 3h6M3.5 21h6"/><circle cx="16" cy="4.6" r="1.9" fill="currentColor"/><path d="M14.6 7.8l-3.6 4.4 3.2 2.6-1.6 6"/><path d="M13.9 8.6l2.7 3 3.2-.8"/><path d="M11 12.2l-3.4 1.6"/>',
  skill: '<path d="M4 20h16"/><path d="M6 16v-4M11 16V9M16 16V5"/><path d="M13.5 7.5L16 5l2.5 2.5"/>',
  merchant: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 17V7h3.2a2.8 2.8 0 010 5.6H9.5M8 14.6h5.5"/>',
};
export const typeIcon = (t, cls = '') => `<svg class="tt-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TYPE_SVG[t] || TYPE_SVG.complete}</svg>`;

// ---------- state ----------
const DEF = { sc: false, sl: true, q: '', map: '', kappa: false, view: 'list', sel: '', col: {} };
export const tsState = (id) => ({ ...DEF, ...(store.ui.ts?.[id] || {}) });
export function tsSet(id, patch) { const all = { ...(store.ui.ts || {}) }; all[id] = { ...tsState(id), ...patch }; store.setUi('ts', all); }

const statusOf = (q, p) => { const s = questStatus(q, p); return { ...s, act: s.s === 'available' && !!p.active?.[q.name] }; };
const STATUS_TXT = { done: 'Completed', available: 'Available', locked: 'Locked', blocked: 'Unavailable' };

// short reason for a locked task (shown in the row, like the lock hint in game)
function lockHint(q, st, p) {
  const r = st.reasons?.[0];
  if (!r) return '';
  if (r.k === 'level') return `Lvl ${r.v}`;
  if (r.k === 'll') return `${ROMAN[r.v.level] ? 'LL' + r.v.level : ''}`;
  if (r.k === 'var') return `group ${r.x.group + 1}`;
  if (r.k === 'tour' || r.k === 'start') return 'Tour';
  if (r.k === 'map') return (r.maps || [])[0] || 'map';
  if (r.k === 'pre') { const a = r.g?.[0]; return a ? `after ${a.q.length > 22 ? a.q.slice(0, 21) + '…' : a.q}` : ''; }
  if (r.k === 'chapter') return r.c.ch;
  return '';
}

// ---------- the screen ----------
// opts: { id, names (ordered), group: 'll' | 'trader', filters: {map, kappa} }
export function taskScreen({ id, names, group = 'll', showKappaToggle = true }) {
  const p = P();
  const s = tsState(id);
  const q = s.q.toLowerCase().trim();
  const rows = [];
  for (const n of names) {
    const Q = D.quests[n];
    if (!Q || !visible(Q, p)) continue;
    const st = statusOf(Q, p);
    if (st.s === 'done' && !s.sc) continue;
    if ((st.s === 'locked' || st.s === 'blocked') && !s.sl) continue;
    if (s.map && !Q.allMaps.includes(s.map)) continue;
    if (s.kappa && !IX.kappa.has(n)) continue;
    if (q) {
      const hay = (n + ' ' + (Q.trader || '') + ' ' + Q.allMaps.join(' ') + ' ' + Q.objectives.map(o => o.text).join(' ') + ' ' + (Q.needs || []).map(x => x.item).join(' ')).toLowerCase();
      if (!q.split(/\s+/).every(w => hay.includes(w))) continue;
    }
    rows.push({ n, Q, st });
  }
  // groups
  const groups = new Map();
  for (const r of rows) {
    const g = group === 'trader' ? (r.Q.trader || 'Other') : llGroup(r.Q);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  let keys = [...groups.keys()];
  if (group === 'll') keys.sort((a, b) => (a === 'chain') - (b === 'chain') || a.localeCompare(b));
  else keys.sort((a, b) => (IX.traders.indexOf(a) + 1 || 99) - (IX.traders.indexOf(b) + 1 || 99));
  // selection: keep it if still listed, otherwise the first available task
  let sel = rows.find(r => r.n === s.sel) ? s.sel : (rows.find(r => r.st.s === 'available') || rows[0])?.n || '';
  const selQ = sel ? D.quests[sel] : null;
  const total = (n) => n.filter(x => visible(D.quests[x], p));
  const grpHead = (g, list) => {
    const all = group === 'trader' ? total(IX.byTrader[g] || []) : total(names.filter(n => D.quests[n] && llGroup(D.quests[n]) === g));
    const dn = all.filter(n => isDone(n, p)).length;
    const col = !!s.col[g];
    const chain = g === 'chain';
    const badge = group === 'trader' ? traderImg(g, 'ts-gimg') : `<span class="ts-roman">${chain ? CHAIN_SVG : ROMAN[+g.slice(2)] || g.slice(2)}</span>`;
    const label = group === 'trader' ? esc(g) : chain ? 'Task chains &amp; story' : `Loyalty level ${esc(g.slice(2))}`;
    return `<button class="ts-gh" data-act="ts-grp" data-id="${id}" data-g="${attr(g)}" aria-expanded="${!col}">${badge}<span class="ts-gl">${label}</span><span class="ts-gc">${dn}/${all.length}</span><span class="ts-chev ${col ? 'col' : ''}">${icon('chevron')}</span></button>`;
  };
  const row = (r) => {
    const t = taskType(r.Q);
    const hint = r.st.s === 'locked' ? lockHint(r.Q, r.st, p) : '';
    const pr = questObjProgress(r.Q, p);
    return `<button class="ts-row st-${r.st.s} ${r.st.act ? 'st-active' : ''} ${r.n === sel ? 'sel' : ''}" data-act="ts-sel" data-id="${id}" data-q="${attr(r.n)}" role="option" aria-selected="${r.n === sel}">
      <span class="ts-ti" title="${TYPE_LABEL[t]}">${r.st.s === 'locked' ? icon('lock') : r.st.s === 'done' ? icon('check') : typeIcon(t)}</span>
      <span class="ts-name">${esc(r.n)}</span>
      ${IX.kappa.has(r.n) ? '<span class="ts-k" title="Required for Kappa">K</span>' : ''}
      ${r.st.act ? '<span class="ts-tag">Active</span>' : ''}
      ${hint ? `<span class="ts-hint">${esc(hint)}</span>` : ''}
      ${r.st.s === 'available' && pr.done ? `<span class="ts-hint">${pr.done}/${pr.total}</span>` : ''}
      <span class="ts-go">${icon('chevron')}</span>
    </button>`;
  };
  const tile = (r) => `<button class="ts-tile st-${r.st.s} ${r.st.act ? 'st-active' : ''} ${r.n === sel ? 'sel' : ''}" data-act="ts-sel" data-id="${id}" data-q="${attr(r.n)}" role="option" aria-selected="${r.n === sel}">
      ${img(r.Q.img, '', 'ts-timg')}<span class="ts-tname">${r.st.s === 'locked' ? icon('lock') : typeIcon(taskType(r.Q))}<span>${esc(r.n)}</span></span></button>`;
  const list = keys.map(g => {
    const col = !!s.col[g];
    const items = groups.get(g);
    return `<section class="ts-grp">${grpHead(g, items)}${col ? '' : `<div class="${s.view === 'grid' ? 'ts-grid' : 'ts-rows'}">${items.map(s.view === 'grid' ? tile : row).join('')}</div>`}</section>`;
  }).join('');
  const maps = [...new Set(names.flatMap(n => D.quests[n]?.allMaps || []))].sort();
  return `<div class="ts" data-ts="${id}">
    <div class="ts-bar">
      <label class="ts-cb"><input type="checkbox" data-tsopt="sc" data-id="${id}" ${s.sc ? 'checked' : ''}><span class="ts-box">${icon('check')}</span>Show completed</label>
      <label class="ts-cb"><input type="checkbox" data-tsopt="sl" data-id="${id}" ${s.sl ? 'checked' : ''}><span class="ts-box">${icon('check')}</span>Show locked</label>
      ${showKappaToggle ? `<label class="ts-cb"><input type="checkbox" data-tsopt="kappa" data-id="${id}" ${s.kappa ? 'checked' : ''}><span class="ts-box">${icon('check')}</span>Kappa only</label>` : ''}
      <label class="search search-s">${icon('search')}<input type="search" data-tsq="${id}" placeholder="Search tasks, items, maps" value="${attr(s.q)}" aria-label="Search tasks"></label>
      <select data-tsmap="${id}" aria-label="Map"><option value="">All maps</option>${maps.map(m => `<option ${s.map === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <span class="ts-views" role="group" aria-label="View">
        <button class="ts-vb ${s.view !== 'grid' ? 'on' : ''}" data-act="ts-view" data-id="${id}" data-v="list" aria-label="List view" aria-pressed="${s.view !== 'grid'}">${icon('list')}</button>
        <button class="ts-vb ${s.view === 'grid' ? 'on' : ''}" data-act="ts-view" data-id="${id}" data-v="grid" aria-label="Grid view" aria-pressed="${s.view === 'grid'}"><svg class="ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg></button>
      </span>
    </div>
    <div class="ts-body">
      <div class="ts-list" role="listbox" aria-label="Tasks" data-keep="ts-list-${id}">${list || `<div class="ts-empty">No tasks with these settings.${!s.sc ? ' Tick <b>Show completed</b> to see finished ones.' : ''}</div>`}</div>
      <div class="ts-detail" data-keep="ts-detail-${id}" id="ts-detail-${id}">${selQ ? taskDetail(selQ, id) : '<div class="ts-empty">Select a task.</div>'}</div>
    </div>
  </div>`;
}

// ---------- detail pane ----------
export function taskDetail(q, id = '') {
  const p = P();
  const st = statusOf(q, p);
  const pr = questObjProgress(q, p);
  const ok = (b) => `<span class="${b ? 't-ok' : 't-no'}">${icon(b ? 'check' : 'x')}</span>`;
  const req = [];
  if (IX.startGate && !(p.ch['Tour'] || p.chObj['Tour|' + IX.startGate.oid])) req.push(`${ok(false)} ${esc(IX.startGate.step)} <span class="muted">(Tour)</span>`);
  if (IX.tourGates?.[q.trader]) req.push(`${ok(traderUnlocked(q.trader, p))} ${esc(q.trader)} unlocked <span class="muted">(Tour: ${esc(IX.tourGates[q.trader].step)})</span>`);
  { const ms = (q.maps || []).filter(Boolean); if (ms.length && ms.every(m => IX.mapGates?.[m])) req.push(`${ok(questMapsUnlocked(q, p))} Access to ${esc(ms.join(' or '))}`); }
  if (q.minLevel) req.push(`${ok(p.settings.level >= q.minLevel)} PMC level ${q.minLevel}`);
  if (q.ll) req.push(`${ok(traderLL(q.ll.trader, p) >= q.ll.level)} ${esc(q.ll.trader)} loyalty level ${q.ll.level} <span class="muted">(yours: ${traderLL(q.ll.trader, p)})</span>`);
  for (const x of q.vars || []) { const need = varNeed(x, p); req.push(`${ok(!need)} ${esc(x.trader)} LL${x.tier} task group ${x.group + 1}/${IX.vars[x.v].groups.length}${need ? ` <span class="muted">– ${need} more ${esc(x.trader)} LL${x.tier} task${need > 1 ? 's' : ''} or LL${x.tier + 1}</span>` : ''}`); }
  for (const c of q.chReq || []) req.push(`${ok(chReqMet(c, p))} <span>${c.html}</span>`);
  const kapG = preOf(q).filter(g => g.every(a => a.kappa));
  if (kapG.length) { const vis = kapG.filter(g => visible(D.quests[g[0].q], p)); const dn = vis.filter(g => groupSatisfied(g, p)).length; req.push(`${ok(dn === vis.length)} All Kappa-required tasks <span class="muted">(${dn}/${vis.length})</span>`); }
  for (const g of preOf(q)) { if (g.every(a => a.kappa)) continue; req.push(`${ok(groupSatisfied(g, p))} ${g.map(a => `${a.type === 'accept' ? 'Accept ' : a.type === 'fail' ? 'Fail ' : ''}${qlink(a.q)}`).join(' <span class="muted">or</span> ')}`); }
  if (q.faction) req.push(`${ok(p.settings.faction === q.faction)} ${q.faction} only`);
  for (const r of q.reqHtml || []) if (!/level|loyalty|must complete|unlocks|obtainable|edition|must accept|playing in/i.test(r.html.replace(/<[^>]+>/g, '')) && !(q.chReq || []).some(c => c.html === r.html)) req.push(`<span class="t-dot">•</span> ${r.html}`);
  const t = taskType(q);
  const done = st.s === 'done';
  const needs = questNeeds(q, p, { includeOptional: true });
  return `<article class="td st-${st.s}">
    <header class="td-h">
      <span class="td-type" title="${TYPE_LABEL[t]}">${typeIcon(t)}</span>
      <div class="td-ht"><h2>${esc(q.name)}</h2><div class="td-sub">${traderImg(q.trader, 'td-tr')}<span>${esc(q.trader || '')}</span>${q.allMaps.length ? `<span class="muted">· ${esc(q.allMaps.join(', '))}</span>` : ''}</div></div>
      <span class="td-status s-${st.s} ${st.act ? 's-active' : ''}">${st.act ? 'Active' : STATUS_TXT[st.s]}</span>
    </header>
    ${q.img ? `<div class="td-img">${img(q.img, q.name, 'td-banner')}</div>` : ''}
    <div class="td-actions">
      <button class="btn ${done ? '' : 'btn-p'}" data-act="quest" data-q="${attr(q.name)}">${icon('check')} ${done ? 'Mark not done' : 'Complete task'}</button>
      ${!done ? `<button class="btn ${st.act ? 'on' : ''}" data-act="ts-active" data-q="${attr(q.name)}" data-tip="Mark it as open (accepted) in your game – the Speedrun guide prioritises it">${st.act ? 'Open in game ✓' : 'Open in game'}</button>` : ''}
      ${q.allMaps.length ? `<button class="btn" data-act="map" data-map="${attr(q.allMaps[0])}" data-focus="${attr(q.name)}">${icon('map')} Map</button>` : ''}
      <button class="btn" data-act="info" data-q="${attr(q.name)}" data-tip="Guide, locations and pictures from the wiki">${icon('info')} Guide</button>
    </div>
    <div class="td-badges">${questBadges(q).replace(/<span class="badge b-active"[^>]*>Active<\/span>/, '')}</div>
    ${isSeasonal() && q.seasonal?.length ? `<div class="seasonal-box">${icon('flag')}<div>${q.seasonal.map(s => `<div>${s.html}</div>`).join('')}</div></div>` : ''}
    ${req.length ? `<section class="td-sec"><h3>Requirements</h3><div class="td-req">${req.map(r => `<div class="tt-req">${r.replace(/^(<span class="t-(?:ok|no|dot)">[\s\S]*?<\/span>)\s*([\s\S]*)$/, '$1<span>$2</span>')}</div>`).join('')}</div></section>` : ''}
    <section class="td-sec"><h3>Objectives <span class="muted">${pr.done}/${pr.total}</span></h3>${objectiveRows(q)}</section>
    ${needs.length ? needsBlock(q).replace('<div class="sub-h">Items</div>', '<h3>Items</h3>').replace('class="needs"', 'class="needs td-sec"') : ''}
    ${q.rewardsHtml?.length ? `<section class="td-sec"><h3>Rewards</h3><ul class="td-rew">${q.rewardsHtml.map(r => `<li>${r.html}${r.sub.length ? `<ul>${r.sub.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul></section>` : ''}
    ${q.leadsTo?.length ? `<section class="td-sec"><h3>Leads to</h3><div class="td-next">${q.leadsTo.map(n => D.quests[n] ? `<button class="ts-mini" data-act="ts-sel" data-id="${attr(id)}" data-q="${attr(n)}" data-tip-q="${attr(n)}">${typeIcon(taskType(D.quests[n]))}${esc(n)}</button>` : qlink(n)).join('')}</div></section>` : ''}
  </article>`;
}

// arrow keys move the selection inside a task list
export function initTaskKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const cur = e.target.closest?.('.ts-row, .ts-tile');
    if (!cur) return;
    const all = [...cur.closest('.ts-list').querySelectorAll('.ts-row, .ts-tile')];
    const i = all.indexOf(cur);
    const nx = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!nx) return;
    e.preventDefault();
    const q = nx.dataset.q, id = nx.dataset.id;
    tsSet(id, { sel: q });
    store.notify('ui');
    requestAnimationFrame(() => document.querySelector(`.ts-list [data-q="${CSS.escape(q)}"]`)?.focus());
  });
}
