// Quest cards, objective lists, info drawer
import { D, IX, P, questStatus, isDone, questNeeds, questObjProgress, objDone, cntKey, isSeasonal, preOf, traderLL } from './model.js';
import { esc, attr, icon, img, traderImg, qlink, itemChip, statusBadge, wikiHref, wikiSectionHtml, fmt, progressBar } from './ui.js';

export const expanded = new Set();

export function mapChips(maps) {
  return maps.map(m => `<button class="mchip" data-act="map" data-map="${attr(m)}" title="Open ${attr(m)} in map panel">${icon('map')}${esc(m)}</button>`).join('');
}

export function questBadges(q) {
  const b = [];
  if (IX.kappa.has(q.name)) b.push('<span class="badge b-kappa" data-tip="Required for Kappa (Collector)">Kappa</span>');
  else if (IX.kappaSub.has(q.name)) b.push('<span class="badge b-kappa-sub" data-tip="Not required itself, but a follow-up quest is required for Kappa">Kappa*</span>');
  if (q.trader === 'Lightkeeper') b.push('<span class="badge b-lk">LK</span>');
  if (q.event) b.push('<span class="badge b-event">Event</span>');
  if (q.mode === 'seasonal') b.push('<span class="badge b-season">Seasonal</span>');
  if (q.faction) b.push(`<span class="badge b-fac">${q.faction}</span>`);
  if (q.edition) b.push(`<span class="badge b-ed">${q.edition}</span>`);
  if (q.choice) b.push('<span class="badge b-choice" data-tip="Contains a choice that can lock other quests">Choice</span>');
  if (isSeasonal() && q.seasonal?.length) b.push('<span class="badge b-season" data-tip="Changed in the current season">Season change</span>');
  return b.join('');
}

export function objectiveRows(q, { chapter = false, ending = null } = {}) {
  const p = P();
  const done = chapter ? !!p.ch[q.name] : isDone(q.name, p);
  let lastCond = null, lastSec = undefined;
  const rows = [];
  for (const o of q.objectives) {
    if (chapter && ending && o.endings && !o.endings.includes(ending)) continue;
    if (chapter && o.section !== lastSec) { lastSec = o.section; if (o.section) rows.push(`<li class="obj-sec">${o.section.replace(/\s*$/, '')}</li>`); lastCond = null; }
    if (o.cond && o.cond !== lastCond) { rows.push(`<li class="obj-cond">${o.cond}</li>`); lastCond = o.cond; }
    const key = chapter ? `${q.name}|${o.id}` : `${q.name}|${o.id}`;
    const od = done || (chapter ? !!p.chObj[key] : !!p.obj[key]);
    const act = chapter ? 'chobj' : 'obj';
    rows.push(`<li class="obj d${o.depth || 1} ${o.optional ? 'opt' : ''} ${od ? 'is-done' : ''}">
      <button class="cb cb-s ${od ? 'on' : ''}" data-act="${act}" data-q="${attr(q.name)}" data-o="${o.id}" aria-pressed="${od}" aria-label="Toggle objective">${icon('check')}</button>
      <span class="obj-t">${o.optional ? '<span class="opt-tag">Optional</span>' : ''}${o.html}${o.fir ? ' <span class="fir">FiR</span>' : ''}${o.maps?.length ? ' ' + mapChips(o.maps) : ''}${(o.notes || []).map(n => `<div class="obj-note">${n}</div>`).join('')}${isSeasonal() && o.seasonal?.length ? o.seasonal.map(s => `<div class="seasonal-note">${icon('flag')} ${s.html}</div>`).join('') : ''}</span>
    </li>`);
  }
  return `<ul class="objs">${rows.join('')}</ul>`;
}

export function needsBlock(q, { chapter = false } = {}) {
  const p = P();
  const needs = chapter ? (q.needs || []).map(n => ({ ...n, have: p.cnt[`ch:${q.name}|${n.item}`] || 0 })) : questNeeds(q, p, { includeOptional: true });
  if (!needs.length) return '';
  return `<div class="needs"><div class="sub-h">Items</div><div class="chips">${needs.map(n => itemChip(n.item, { count: n.count, have: n.have, fir: n.fir, optional: n.optional, counter: (chapter ? 'ch:' : '') + cntKey(q.name, n.item) })).join('')}</div></div>`;
}

export function questCard(q, { showTrader = true } = {}) {
  const p = P();
  const st = questStatus(q, p);
  const pr = questObjProgress(q, p);
  const open = expanded.has(q.name);
  const seasonal = isSeasonal() && q.seasonal?.length ? `<div class="seasonal-box">${icon('flag')}<div>${q.seasonal.map(s => `<div>${s.html}</div>`).join('')}</div></div>` : '';
  const needsMini = !open ? questNeeds(q, p).filter(n => n.missing > 0).slice(0, 4).map(n => itemChip(n.item, { count: n.count, fir: n.fir, small: true })).join('') : '';
  return `<article class="qcard qs-${st.s} ${open ? 'open' : ''}" data-qcard="${attr(q.name)}">
    <div class="qc-head">
      <button class="cb ${st.s === 'done' ? 'on' : ''}" data-act="quest" data-q="${attr(q.name)}" aria-pressed="${st.s === 'done'}" aria-label="Mark ${attr(q.name)} done">${icon('check')}</button>
      ${showTrader ? traderImg(q.trader, 'qc-tr') : ''}
      <div class="qc-main" data-act="expand" data-q="${attr(q.name)}">
        <div class="qc-title">${qlink(q.name)} ${questBadges(q)}</div>
        <div class="qc-meta">${showTrader && q.trader ? `<span>${esc(q.trader)}</span>` : ''}${q.minLevel ? `<span>Lvl ${q.minLevel}</span>` : ''}${q.ll ? `<span>LL${q.ll.level}</span>` : ''}${q.allMaps.length ? `<span>${esc(q.allMaps.slice(0, 3).join(', '))}${q.allMaps.length > 3 ? '…' : ''}</span>` : ''}<span>${pr.done}/${pr.total} obj.</span>${needsMini ? `<span class="chips mini">${needsMini}</span>` : ''}</div>
      </div>
      ${statusBadge(st.s)}
      <button class="ibtn" data-act="info" data-q="${attr(q.name)}" aria-label="Info: where and how" data-tip="Details, locations &amp; guide">${icon('info')}</button>
      <button class="ibtn chev ${open ? 'rot' : ''}" data-act="expand" data-q="${attr(q.name)}" aria-label="Expand">${icon('chevron')}</button>
    </div>
    ${open ? `<div class="qc-body">${seasonal}${objectiveRows(q)}${needsBlock(q)}
      ${q.rewardsHtml.length ? `<details class="rew"><summary>Rewards</summary><ul>${q.rewardsHtml.map(r => `<li>${r.html}${r.sub.length ? `<ul>${r.sub.map(s => `<li>${s}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul></details>` : ''}
      ${q.leadsTo.length ? `<div class="leads">Leads to: ${q.leadsTo.map(n => qlink(n)).join(', ')}</div>` : ''}
    </div>` : ''}
  </article>`;
}

// ---------- Info drawer ----------
let drawer = null;
function ensureDrawer() {
  if (drawer) return drawer;
  drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('aria-label', 'Details');
  drawer.innerHTML = `<div class="drawer-h"><div class="drawer-title"></div><button class="ibtn" data-act="drawer-close" aria-label="Close">${icon('x')}</button></div><div class="drawer-b"></div>`;
  document.body.appendChild(drawer);
  return drawer;
}
export function closeDrawer() { drawer?.classList.remove('open'); }
function openDrawer(title, html) {
  const d = ensureDrawer();
  d.querySelector('.drawer-title').innerHTML = title;
  d.querySelector('.drawer-b').innerHTML = html;
  d.querySelector('.drawer-b').scrollTop = 0;
  d.classList.add('open');
  return d.querySelector('.drawer-b');
}
async function fillLive(el, page, re, fallback = 'No guide section on the wiki.') {
  const box = el.querySelector('.live');
  if (!box) return;
  try {
    const html = await wikiSectionHtml(page, re);
    box.innerHTML = html ? `<div class="wiki-html">${html}</div>` : `<div class="muted">${fallback}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="muted">Could not load the wiki right now (${esc(e.message)}). <a href="${wikiHref(page)}" target="_blank" rel="noopener">Open on wiki</a></div>`;
  }
}

export function openQuestInfo(name) {
  const q = D.quests[name];
  if (!q) return openWikiPage(name);
  const p = P();
  const st = questStatus(q, p);
  const reqs = [];
  if (q.minLevel) reqs.push(`PMC level ${q.minLevel}`);
  if (q.ll) reqs.push(`${esc(q.ll.trader)} loyalty level ${q.ll.level} <span class="muted">(yours: ${traderLL(q.ll.trader, p)})</span>`);
  for (const g of preOf(q)) reqs.push(g.map(a => `${a.type === 'accept' ? 'Accept ' : a.type === 'fail' ? 'Fail ' : 'Complete '}${qlink(a.q)}${a.delay ? ` <span class="muted">(+${esc(a.delay)})</span>` : ''}`).join(' <b>or</b> '));
  for (const r of q.reqHtml) if (!/level|loyalty|must complete|unlocks .* after|must accept/i.test(r.html.replace(/<[^>]+>/g, ''))) reqs.push(r.html);
  const qi = q.questItems?.length ? `<div class="sub-h">Quest items (wiki table)</div><table class="tbl"><thead><tr><th>Item</th><th>Amount</th><th>Requirement</th><th>FiR</th><th>Notes</th></tr></thead><tbody>${q.questItems.map(r => `<tr><td>${r.item && D.items[r.item] ? itemChip(r.item, { small: true }) : r.html}</td><td>${fmt(r.amount) || ''}</td><td>${esc(r.req)}</td><td>${r.fir === true ? '<span class="fir">FiR</span>' : r.fir === false ? 'No' : '–'}</td><td>${r.notes}</td></tr>`).join('')}</tbody></table>` : '';
  const html = `
    ${q.img ? `<div class="banner">${img(q.img, q.name, 'banner-img')}</div>` : ''}
    <div class="info-meta">${traderImg(q.trader, 'info-tr')}<div><div><b>${esc(q.trader || '')}</b> ${statusBadge(st.s)} ${questBadges(q)}</div><div class="muted">${q.locationHtml || ''}</div></div></div>
    <div class="info-actions">${q.allMaps.map(m => `<button class="btn" data-act="map" data-map="${attr(m)}" data-focus="${attr(q.name)}">${icon('map')} Show on ${esc(m)}</button>`).join('')}<a class="btn" href="${wikiHref(q.name)}" target="_blank" rel="noopener">${icon('ext')} Wiki</a></div>
    ${isSeasonal() && q.seasonal?.length ? `<div class="seasonal-box">${icon('flag')}<div>${q.seasonal.map(s => `<div>${s.html}</div>`).join('')}</div></div>` : ''}
    <div class="sub-h">Requirements</div><ul class="plain">${reqs.map(r => `<li>${r}</li>`).join('') || '<li class="muted">None</li>'}</ul>
    <div class="sub-h">Objectives</div>${objectiveRows(q)}
    ${needsBlock(q)}
    ${qi}
    ${q.rewardsHtml.length ? `<div class="sub-h">Rewards</div><ul class="plain">${q.rewardsHtml.map(r => `<li>${r.html}</li>`).join('')}</ul>` : ''}
    <div class="sub-h">Guide &amp; locations <span class="muted">(live from wiki)</span></div><div class="live"><div class="loading">Loading guide…</div></div>`;
  const el = openDrawer(`${traderImg(q.trader, 'dr-ic')}<span>${esc(q.name)}</span>`, html);
  fillLive(el, q.name, /^guide$/i);
}

export function openChapterInfo(name) {
  const c = D.chapters[name];
  if (!c) return openWikiPage(name);
  const html = `${c.img ? `<div class="banner">${img(c.img, c.name, 'banner-img')}</div>` : ''}
    ${c.descHtml ? `<blockquote>${c.descHtml}</blockquote>` : ''}
    <div class="info-actions">${c.maps.map(m => `<button class="btn" data-act="map" data-map="${attr(m)}">${icon('map')} ${esc(m)}</button>`).join('')}<a class="btn" href="${wikiHref(c.name)}" target="_blank" rel="noopener">${icon('ext')} Wiki</a></div>
    ${c.reqHtml.length ? `<div class="sub-h">How to unlock</div>${c.reqHtml.map(r => `<p>${r}</p>`).join('')}` : ''}
    <div class="sub-h">Guide <span class="muted">(live from wiki)</span></div><div class="live"><div class="loading">Loading guide…</div></div>`;
  const el = openDrawer(`${img(c.iconImg, '', 'dr-ic')}<span>${esc(c.name)}</span>`, html);
  fillLive(el, c.name, /^guide$/i);
}

export function openItemInfo(item) {
  const I = D.items[item];
  if (!I) return openWikiPage(item);
  const uses = IX.itemUse[item] || [];
  const html = `<div class="item-hero">${img(I.img, I.name, 'item-big')}<div><div class="muted">${esc(I.type || '')}</div>${I.node ? `<div class="muted small">ID ${esc(I.node)}</div>` : ''}<a class="btn" href="${wikiHref(I.name)}" target="_blank" rel="noopener">${icon('ext')} Wiki</a></div></div>
    ${uses.length ? `<div class="sub-h">Needed for</div><ul class="plain">${uses.map(u => `<li>${u.type === 'hideout' ? `<a class="wl" data-module="${attr(u.name)}">${esc(u.name)} L${u.level}</a>` : u.type === 'chapter' ? `<a class="wl" data-t="${attr(u.name)}">${esc(u.name)}</a> <span class="muted">(story)</span>` : qlink(u.name)} · ${fmt(u.count)}${u.fir ? ' <span class="fir">FiR</span>' : ''}${u.optional ? ' <span class="muted">(optional)</span>' : ''}</li>`).join('')}</ul>` : ''}
    <div class="sub-h">Where to find <span class="muted">(live from wiki)</span></div><div class="live"><div class="loading">Loading…</div></div>`;
  const el = openDrawer(`${img(I.img, '', 'dr-ic')}<span>${esc(I.name)}</span>`, html);
  fillLive(el, I.name, /locat|spawn|where|found|obtain|how to get/i, 'The wiki page has no location section. Check the wiki page for barters, crafts and trader offers.');
}

export function openWikiPage(title) {
  const html = `<div class="info-actions"><a class="btn" href="${wikiHref(title)}" target="_blank" rel="noopener">${icon('ext')} Open on wiki</a></div><div class="live"><div class="loading">Loading…</div></div>`;
  const el = openDrawer(`<span>${esc(title)}</span>`, html);
  fillLive(el, title, /.*/);
}

export function openModuleInfo(name) {
  const m = D.hideout.modules.find(x => x.name === name);
  if (!m) return;
  const html = `<div class="item-hero">${img(m.img, m.name, 'item-big')}<div>${m.noteHtml ? `<div>${m.noteHtml}</div>` : ''}<a class="btn" href="${wikiHref('Hideout')}" target="_blank" rel="noopener">${icon('ext')} Wiki</a></div></div>
  ${m.levels.map(L => `<div class="sub-h">Level ${L.level} <span class="muted">${esc(L.time)}</span></div><div class="chips">${L.items.map(i => itemChip(i.item, { count: i.count, fir: i.fir && !isSeasonal(), small: true })).join('')}</div>
  <ul class="plain">${L.modules.map(r => `<li>${esc(r.name)} level ${r.level}</li>`).join('')}${L.traders.map(r => `<li>${esc(r.name)} LL${r.level}</li>`).join('')}${L.skills.map(r => `<li>${esc(r.name)} skill level ${r.level}</li>`).join('')}${L.other.map(o => `<li>${o}</li>`).join('')}</ul>
  <div class="muted small">${L.functionsHtml.join(' · ')}</div>`).join('')}`;
  openDrawer(`${img(m.img, '', 'dr-ic')}<span>${esc(m.name)}</span>`, html);
}
