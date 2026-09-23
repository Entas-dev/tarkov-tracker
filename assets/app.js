// App bootstrap, header, routing, global actions
import { store, PROFILES } from './store.js';
import { D, IX, setDataset, P, visible, isDone, completeQuest, prerequisiteClosure, doneDependents, uncompleteQuests, questObjProgress, objKey, chapterClosure, chDone, chapterProgress, hLevel, setModuleLevel, hideoutDependents, objVisibleForEnding, objApplies, condStatus, questStatus } from './model.js';
import { esc, attr, icon, img, initTooltips, hideTip, confirmDialog, toast, $, $$ } from './ui.js';
import { expanded, openQuestInfo, openChapterInfo, openItemInfo, openWikiPage, openModuleInfo, closeDrawer } from './components.js';
import { renderStory, renderKappa, renderTraders, renderQuests } from './tabs-quests.js';
import { renderHideout, renderPrestige, renderBattlepass, renderAchievements, renderItems } from './tabs-other.js';
import { loadDataset, buildLive, isStale, ageText } from './data.js';
import { initMapPanel, openMap } from './mappanel.js';
import { perksBannerHtml, openPerks, togglePerk } from './perks.js';

const TABS = [
  { id: 'story', label: 'Main Story', render: renderStory },
  { id: 'kappa', label: 'Kappa', render: renderKappa },
  { id: 'hideout', label: 'Hideout', render: renderHideout },
  { id: 'traders', label: 'Traders', render: renderTraders },
  { id: 'prestige', label: 'Prestige', render: renderPrestige },
  { id: 'battlepass', label: 'BattlePass', render: renderBattlepass },
  { id: 'quests', label: 'All Quests', render: renderQuests },
  { id: 'achievements', label: 'Achievements', render: renderAchievements },
  { id: 'items', label: 'Needed Items', render: renderItems },
];

let current = 'story';
let lastDrawer = null;

// ---------- theme ----------
function applyTheme() {
  let t = null;
  try { t = localStorage.getItem('eft-theme'); } catch { }
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
function currentTheme() { return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); }
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('eft-theme', next); } catch { }
  applyTheme(); renderHeader();
}

// ---------- shell ----------
function shell() {
  document.body.innerHTML = `
  <a class="skip" href="#main">Skip to content</a>
  <header class="top">
    <div class="top-row">
      <div class="brand">${icon('star', 'brand-ic')}<span>EFT Tracker</span></div>
      <div class="profile-seg seg" role="radiogroup" aria-label="Profile"></div>
      <div class="hdr-ctrls"></div>
    </div>
    <nav class="tabs" aria-label="Sections"></nav>
  </header>
  <div class="banner-slot"></div>
  <main id="main" class="main" tabindex="-1"></main>
  <footer class="foot"></footer>`;
}

function renderHeader() {
  const p = P();
  $('.profile-seg').innerHTML = PROFILES.map(pr => `<button role="radio" aria-checked="${store.active === pr.id}" class="seg-b ${store.active === pr.id ? 'on' : ''}" data-act="profile" data-p="${pr.id}" data-tip="${attr(pr.long)}">${esc(pr.label)}</button>`).join('');
  $('.hdr-ctrls').innerHTML = `
    <label class="lvl" data-tip="Your PMC level – used for the level filter and trader LL estimate">Lvl <input type="number" min="1" max="79" value="${p.settings.level}" data-set="level" aria-label="PMC level"></label>
    <select data-set="faction" aria-label="Faction"><option ${p.settings.faction === 'USEC' ? 'selected' : ''}>USEC</option><option ${p.settings.faction === 'BEAR' ? 'selected' : ''}>BEAR</option></select>
    <button class="ibtn" data-act="theme" aria-label="Toggle light/dark mode" data-tip="Light / dark">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button>
    <button class="ibtn" data-act="settings" aria-label="Settings" data-tip="Settings, backup, data update">${icon('gear')}</button>`;
  const kap = D ? IX.order.filter(n => IX.kappa.has(n) && visible(D.quests[n], p)) : [];
  const kd = kap.filter(n => isDone(n, p)).length;
  $('.tabs').innerHTML = TABS.map(t => `<a href="#/${t.id}" class="tab ${t.id === current ? 'on' : ''}" ${t.id === current ? 'aria-current="page"' : ''}>${esc(t.label)}${t.id === 'kappa' && D ? ` <span class="tab-n">${kd}/${kap.length}</span>` : ''}${t.id === 'prestige' && store.active !== 'pvp' ? ' <span class="tab-n muted">PvP</span>' : ''}</a>`).join('');
}

function renderFooter() {
  $('.foot').innerHTML = D ? `Data: <a href="https://escapefromtarkov.fandom.com" target="_blank" rel="noopener">EFT Wiki</a> (CC BY-SA) · updated ${ageText(D)} · ${Object.keys(D.quests).length} quests · <button class="linkbtn" data-act="refresh">Update from wiki now</button> · Map data: <a href="https://tarkov.dev" target="_blank" rel="noopener">tarkov.dev</a> · Progress is stored in this browser only – use Settings → Export for backups.` : '';
}

function renderBanner() {
  const slot = $('.banner-slot');
  if (!D) { slot.innerHTML = ''; return; }
  const dismissed = store.ui.dismissedEvents || [];
  const act = (D.events || []).filter(e => e.active && !dismissed.includes(e.title + e.dateText));
  const season = D.season;
  const sEnd = season?.end ? Math.ceil((new Date(season.end) - Date.now()) / 864e5) : null;
  slot.innerHTML = act.map(e => `<div class="banner-ev" role="status">
      ${e.img ? img(e.img, '', 'ev-img') : icon('flag', 'ev-ic')}
      <div class="ev-main"><div><span class="ev-tag">Event</span> <b>${esc(e.title)}</b> <span class="muted">since ${esc(e.dateText)}</span></div>
      <details><summary>What changed</summary>${e.quoteHtml ? `<p class="small">${e.quoteHtml}</p>` : ''}<ul class="small">${e.changesHtml.map(c => `<li>${c}</li>`).join('')}</ul></details></div>
      <button class="ibtn" data-act="dismiss-ev" data-k="${attr(e.title + e.dateText)}" aria-label="Dismiss">${icon('x')}</button></div>`).join('')
    + (store.active === 'seasonal' && season ? `<div class="banner-ev season"><span class="ev-tag">Season</span> <b>${esc(season.name)}</b>${sEnd != null ? ` <span class="muted">ends in ${sEnd} days</span>` : ''}<details><summary>Differences in this mode</summary><ul class="small">${season.differencesHtml.map(d => `<li>${d}</li>`).join('')}</ul></details>${perksBannerHtml()}</div>` : '');
}

function render() {
  if (!D) return;
  const tab = TABS.find(t => t.id === current) || TABS[0];
  const main = $('#main');
  const y = window.scrollY;
  const focusSel = document.activeElement?.matches?.('input[type=search]') ? { f: document.activeElement.dataset.f || document.activeElement.dataset.af || document.activeElement.dataset.if, pos: document.activeElement.selectionStart } : null;
  hideTip();
  tab.render(main);
  window.scrollTo(0, y);
  if (focusSel) { const el = main.querySelector(`input[type=search][data-f="${focusSel.f}"],input[type=search][data-af="${focusSel.f}"],input[type=search][data-if="${focusSel.f}"]`); if (el) { el.focus(); try { el.setSelectionRange(focusSel.pos, focusSel.pos); } catch { } } }
  renderHeader();
  if (lastDrawer && document.querySelector('.drawer.open')) { const b = $('.drawer-b'); const s = b.scrollTop; const live = b.querySelector('.live')?.innerHTML; lastDrawer(); const nb = $('.drawer-b'); if (live) { const l = nb.querySelector('.live'); if (l) l.innerHTML = live; } nb.scrollTop = s; }
}

function route() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  current = TABS.some(t => t.id === id) ? id : 'story';
  hideTip();
  render();
  $('#main').scrollTop = 0;
}

// ---------- actions ----------
async function toggleQuest(name) {
  const q = D.quests[name];
  if (!isDone(name)) {
    const n = completeQuest(name);
    toast(n ? `<b>${esc(name)}</b> done · ${n} prerequisite quest${n > 1 ? 's' : ''} checked too` : `<b>${esc(name)}</b> done`);
    return;
  }
  const deps = doneDependents(name);
  if (!deps.length) { uncompleteQuests([name]); return; }
  const v = await confirmDialog({
    title: 'Uncheck quest',
    bodyHtml: `<p><b>${esc(name)}</b> is a prerequisite for ${deps.length} quest${deps.length > 1 ? 's' : ''} you marked as done:</p><ul class="dep-list">${deps.slice(0, 30).map(d => `<li>${esc(d)}</li>`).join('')}${deps.length > 30 ? `<li>… +${deps.length - 30}</li>` : ''}</ul><p>Reset them too?</p>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Only this quest', value: 'one' }, { label: `Reset all ${deps.length + 1}`, value: 'all', primary: true, danger: true }],
  });
  if (v === 'one') uncompleteQuests([name]);
  if (v === 'all') uncompleteQuests([name, ...deps]);
}

async function toggleObjective(qname, oid) {
  const q = D.quests[qname];
  const key = objKey(qname, oid);
  if (isDone(qname)) {
    // unchecking an objective of a finished quest -> quest becomes unfinished
    const deps = doneDependents(qname);
    let reset = [qname];
    if (deps.length) {
      const v = await confirmDialog({ title: 'Quest no longer finished', bodyHtml: `<p>Unchecking this objective marks <b>${esc(qname)}</b> as not done. ${deps.length} dependent quest${deps.length > 1 ? 's are' : ' is'} marked done:</p><ul class="dep-list">${deps.slice(0, 20).map(d => `<li>${esc(d)}</li>`).join('')}</ul>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Keep dependents', value: 'one' }, { label: 'Reset dependents too', value: 'all', primary: true, danger: true }] });
      if (!v) return;
      if (v === 'all') reset = [qname, ...deps];
    }
    store.update(p => { for (const n of reset) delete p.quests[n]; for (const o of q.objectives) p.obj[objKey(qname, o.id)] = 1; delete p.obj[key]; });
    return;
  }
  if (P().obj[key]) { store.update(p => { delete p.obj[key]; }); return; }
  // checking an objective: its sub-steps are done, "hand over X" implies "find X", and the quest's prerequisites must be done
  const o = q.objectives.find(x => x.id === oid);
  const extra = descendants(q.objectives, oid);
  if (o?.kind === 'handover') for (const x of q.objectives) if (x.kind === 'find' && x.items?.some(i => o.items?.some(j => j.item === i.item))) extra.push(x.id, ...descendants(q.objectives, x.id));
  const pre = [...prerequisiteClosure(qname)].filter(n => !isDone(n));
  store.update(p => { p.obj[key] = 1; for (const id of extra) p.obj[objKey(qname, id)] = 1; for (const n of pre) p.quests[n] = 1; });
  if (pre.length) toast(`${pre.length} prerequisite quest${pre.length > 1 ? 's' : ''} of <b>${esc(qname)}</b> checked too`);
  const pr = questObjProgress(q);
  if (pr.total && pr.done === pr.total) { const n = completeQuest(qname); toast(`All objectives done – <b>${esc(qname)}</b> completed${n ? ` (+${n} prerequisites)` : ''}`); }
}

async function toggleChapter(name) {
  if (!chDone(name)) {
    const add = chapterClosure(name);
    store.update(p => { p.ch[name] = 1; for (const c of add) p.ch[c] = 1; });
    toast(`<b>${esc(name)}</b> done${add.size ? ` · ${add.size} earlier chapter${add.size > 1 ? 's' : ''} checked too` : ''}`);
    return;
  }
  const deps = Object.keys(D.chapters).filter(c => chDone(c) && chapterClosure(c).has(name));
  let reset = [name];
  if (deps.length) {
    const v = await confirmDialog({ title: 'Uncheck chapter', bodyHtml: `<p>${deps.map(esc).join(', ')} depend${deps.length === 1 ? 's' : ''} on <b>${esc(name)}</b>.</p>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Only this', value: 'one' }, { label: 'Reset all', value: 'all', primary: true, danger: true }] });
    if (!v) return;
    if (v === 'all') reset = [name, ...deps];
  }
  store.update(p => { for (const c of reset) delete p.ch[c]; });
}

function descendants(list, id) {
  const out = [];
  const walk = (pid) => { for (const x of list) if (x.parent === pid && !out.includes(x.id)) { out.push(x.id); walk(x.id); } };
  walk(id);
  return out;
}
const isBranchCond = (c) => !!c && /^(if|only if)\b/i.test(c.replace(/<[^>]+>/g, '').trim());

function toggleChObj(cname, oid) {
  const c = D.chapters[cname];
  const key = `${cname}|${oid}`;
  if (chDone(cname)) { store.update(p => { delete p.ch[cname]; for (const o of c.objectives) p.chObj[`${cname}|${o.id}`] = 1; delete p.chObj[key]; }); return; }
  if (P().chObj[key]) { store.update(p => { delete p.chObj[key]; }); return; }
  // story objectives are sequential: checking one checks everything before it on your ending path (skipping alternative "If …" branches),
  // its own sub-steps, and all earlier chapters this chapter depends on
  const ending = P().settings.ending;
  const idx = c.objectives.findIndex(x => x.id === oid);
  const o = c.objectives[idx];
  // checking a step inside a branch tells us which choice you made
  const ct = (o.cond || '').replace(/<[^>]+>/g, '');
  const infer = {};
  if (/^(if|only if)\b/i.test(ct) && /armored case/i.test(ct) && !/\bor\b/i.test(ct)) infer.armoredCase = /\b(gave|given)\b/i.test(ct) ? 'gave' : 'kept';
  if (/^if\b/i.test(ct) && /major evidence/i.test(ct)) infer.evidence = /failed/i.test(ct) ? 'failed' : 'received';
  if (Object.keys(infer).length) store.update(p => { p.settings.choices = { ...(p.settings.choices || {}), ...infer }; });
  const prev = c.objectives.slice(0, idx).filter(x => !x.optional && objApplies(x) && (!isBranchCond(x.cond) || x.cond === o.cond || condStatus(x.cond) === true || (x.parent && x.parent === o.parent)));
  const ids = [oid, ...prev.map(x => x.id), ...descendants(c.objectives, oid)];
  const chs = [...chapterClosure(cname)].filter(n => !chDone(n));
  store.update(p => { for (const id of ids) p.chObj[`${cname}|${id}`] = 1; for (const n of chs) p.ch[n] = 1; });
  const extra = ids.length - 1;
  if (extra || chs.length) toast(`${extra ? `${extra} earlier objective${extra > 1 ? 's' : ''}` : ''}${extra && chs.length ? ' and ' : ''}${chs.length ? `chapter${chs.length > 1 ? 's' : ''} ${chs.map(esc).join(', ')}` : ''} checked too`);
  const pr = chapterProgress(c);
  if (pr.total && pr.done === pr.total) { toggleChapter(cname); }
}

async function setHideout(mod, level) {
  const cur = hLevel(mod);
  if (level === cur && level > 0) level = level - 1; // clicking the current top pip un-builds it
  if (level > cur) { setModuleLevel(mod, level); toast(`${esc(mod)} → level ${level}`); return; }
  const deps = hideoutDependents(mod, level);
  if (deps.length) {
    const v = await confirmDialog({ title: 'Lower module level', bodyHtml: `<p>These built modules require <b>${esc(mod)}</b> above level ${level}:</p><ul class="dep-list">${deps.map(d => `<li>${esc(d.module)} → level ${d.level}</li>`).join('')}</ul>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Only this module', value: 'one' }, { label: 'Lower them too', value: 'all', primary: true, danger: true }] });
    if (!v) return;
    store.update(p => { p.hideout[mod] = level; if (v === 'all') for (const d of deps) p.hideout[d.module] = Math.min(p.hideout[d.module] || 0, d.level); });
    return;
  }
  store.update(p => { p.hideout[mod] = level; });
}

async function settingsDialog() {
  const p = P();
  const v = await confirmDialog({
    title: 'Settings',
    bodyHtml: `
      <div class="set-grid">
        <label class="tog"><input type="checkbox" id="s-eod" ${p.settings.eod ? 'checked' : ''}> I own <b>Edge of Darkness</b> (EOD-only quests)</label>
        <label class="tog"><input type="checkbox" id="s-unh" ${p.settings.unheard ? 'checked' : ''}> I own <b>The Unheard</b> edition</label>
        <p class="small muted">Settings apply to the <b>${esc(store.profile.long)}</b> profile.</p>
        <div class="set-row"><button class="btn" data-x="export">${icon('download')} Export progress</button><button class="btn" data-x="import">${icon('upload')} Import progress</button><input type="file" id="s-file" accept="application/json" hidden></div>
        <div class="set-row"><button class="btn" data-x="refresh">${icon('refresh')} Update data from wiki now</button><button class="btn btn-d" data-x="reset">Reset this profile</button></div>
        <p class="small muted">Data built ${esc(ageText(D))}. The site also refreshes itself automatically once a day. Nothing here reads or touches the game.</p>
      </div>`,
    buttons: [{ label: 'Close', value: 'close', primary: true }],
  });
  return v;
}

function onSettingsClick(e) {
  const b = e.target.closest('[data-x]');
  if (!b || !e.target.closest('.modal')) return;
  const x = b.dataset.x;
  if (x === 'export') {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `eft-tracker-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  if (x === 'import') { const f = document.getElementById('s-file'); f.onchange = async () => { try { store.importJson(await f.files[0].text()); toast('Progress imported'); document.querySelector('.modal-wrap')?.remove(); } catch (err) { toast('Import failed: ' + esc(err.message)); } }; f.click(); }
  if (x === 'refresh') { document.querySelector('.modal-wrap')?.remove(); refreshData(true); }
  if (x === 'reset') { if (confirm(`Reset all progress of the ${store.profile.long} profile?`)) { store.resetProfile(); document.querySelector('.modal-wrap')?.remove(); } }
}
document.addEventListener('change', (e) => {
  if (e.target.id === 's-eod' || e.target.id === 's-unh') store.update(p => { p.settings.eod = document.getElementById('s-eod').checked; p.settings.unheard = document.getElementById('s-unh').checked; });
});

async function refreshData(manual = false) {
  const bar = document.createElement('div');
  bar.className = 'refresh-bar';
  bar.innerHTML = `<span class="rb-t">Updating from wiki…</span><div class="rb"><div class="rb-f"></div></div>`;
  document.body.appendChild(bar);
  try {
    const ds = await buildLive((pct, msg) => { bar.querySelector('.rb-f').style.width = Math.round(pct * 100) + '%'; bar.querySelector('.rb-t').textContent = msg; });
    setDataset(ds); render(); renderBanner(); renderFooter();
    toast(`Data updated: ${Object.keys(ds.quests).length} quests`);
  } catch (e) {
    console.error(e);
    if (manual) toast('Wiki update failed: ' + esc(e.message));
  } finally { bar.remove(); }
}

function onClick(e) {
  const t = e.target;
  // links inside wiki html / generated html
  const wl = t.closest('a.wl');
  if (wl) {
    e.preventDefault();
    if (wl.dataset.module) return (lastDrawer = () => openModuleInfo(wl.dataset.module))();
    const title = wl.dataset.t;
    if (D.quests[title]) return (lastDrawer = () => openQuestInfo(title))();
    if (D.chapters[title]) return (lastDrawer = () => openChapterInfo(title))();
    if (D.items[title]) return (lastDrawer = () => openItemInfo(title))();
    lastDrawer = null; return openWikiPage(title);
  }
  const ql = t.closest('.ql[data-q]');
  if (ql && !t.closest('[data-act]')) { hideTip(); return (lastDrawer = () => openQuestInfo(ql.dataset.q))(); }
  const cn = t.closest('.chip-name[data-item]');
  if (cn && !t.closest('button')) { hideTip(); return (lastDrawer = () => openItemInfo(cn.dataset.item))(); }
  const b = t.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  const p = P();
  switch (a) {
    case 'profile': store.setActive(b.dataset.p); break;
    case 'theme': toggleTheme(); break;
    case 'settings': settingsDialog(); break;
    case 'refresh': refreshData(true); break;
    case 'quest': toggleQuest(b.dataset.q); break;
    case 'obj': toggleObjective(b.dataset.q, b.dataset.o); break;
    case 'chapter': toggleChapter(b.dataset.c); break;
    case 'chobj': toggleChObj(b.dataset.q, b.dataset.o); break;
    case 'ending': store.update(pp => { pp.settings.ending = b.dataset.e; }); break;
    case 'choice': store.update(pp => { pp.settings.choices = { ...(pp.settings.choices || {}), [b.dataset.k]: pp.settings.choices?.[b.dataset.k] === b.dataset.v ? undefined : b.dataset.v }; }); break;
    case 'expand': { const k = b.dataset.q; expanded.has(k) ? expanded.delete(k) : expanded.add(k); render(); break; }
    case 'expand-ch': { const k = 'ch:' + b.dataset.c; expanded.has(k) ? expanded.delete(k) : expanded.add(k); render(); break; }
    case 'expand-h': { const k = 'h:' + b.dataset.m; expanded.has(k) ? expanded.delete(k) : expanded.add(k); render(); break; }
    case 'info': hideTip(); (lastDrawer = () => openQuestInfo(b.dataset.q))(); break;
    case 'info-ch': (lastDrawer = () => openChapterInfo(b.dataset.c))(); break;
    case 'info-item': (lastDrawer = () => openItemInfo(b.dataset.item))(); break;
    case 'info-mod': (lastDrawer = () => openModuleInfo(b.dataset.m))(); break;
    case 'drawer-close': closeDrawer(); lastDrawer = null; break;
    case 'perks': (lastDrawer = openPerks)(); break;
    case 'map': openMap(b.dataset.map, b.dataset.focus || null); break;
    case 'cnt': {
      const k = b.dataset.k, d = +b.dataset.d, max = +b.dataset.max || Infinity;
      store.update(pp => {
        const bucket = k.startsWith('h:') ? pp.hcnt : pp.cnt;
        const kk = k.startsWith('h:') ? k.slice(2) : k;
        const step = e.shiftKey ? 10 : 1;
        const v = Math.max(0, Math.min(max, (bucket[kk] || 0) + d * step));
        if (v) bucket[kk] = v; else delete bucket[kk];
      });
      break;
    }
    case 'trader': store.setUi('trader', b.dataset.t); render(); break;
    case 'setll': store.update(pp => { pp.settings.ll = pp.settings.ll || {}; if (b.dataset.l === '') delete pp.settings.ll[b.dataset.t]; else pp.settings.ll[b.dataset.t] = +b.dataset.l; }); break;
    case 'hlevel': setHideout(b.dataset.m, +b.dataset.l); break;
    case 'hf': store.setUi('hf', b.dataset.v); render(); break;
    case 'prestige': { const l = +b.dataset.l; store.update(pp => { if (pp.prestige[l]) { for (const k of Object.keys(pp.prestige)) if (+k >= l) delete pp.prestige[k]; } else for (let i = 1; i <= l; i++) pp.prestige[i] = 1; }); break; }
    case 'pman': store.update(pp => { const k = b.dataset.k; if (pp.prestigeManual[k]) delete pp.prestigeManual[k]; else pp.prestigeManual[k] = 1; }); break;
    case 'bp': store.update(pp => { const l = b.dataset.l; if (pp.bp[l]) delete pp.bp[l]; else pp.bp[l] = 1; }); break;
    case 'bpdoc': store.update(pp => { const k = b.dataset.k; const v = Math.max(0, (pp.bpDocs[k] || 0) + (+b.dataset.d) * (e.shiftKey ? 5 : 1)); if (v) pp.bpDocs[k] = v; else delete pp.bpDocs[k]; }); break;
    case 'ach': store.update(pp => { const n = b.dataset.a; if (pp.ach[n]) delete pp.ach[n]; else pp.ach[n] = 1; }); break;
    case 'asec': { const f = store.ui.af || { sec: [...new Set(D.achievements.map(x => x.section))].filter(s => !/arena|retired/i.test(s)), status: 'all', q: '' }; const s = new Set(f.sec); s.has(b.dataset.v) ? s.delete(b.dataset.v) : s.add(b.dataset.v); store.setUi('af', { ...f, sec: [...s] }); render(); break; }
    case 'iscope': store.setUi('if', { ...(store.ui.if || {}), scope: b.dataset.v }); render(); break;
    case 'more': store.setUi(b.dataset.k, (store.ui[b.dataset.k] || 120) + 150); render(); break;
    case 'dismiss-ev': store.setUi('dismissedEvents', [...(store.ui.dismissedEvents || []), b.dataset.k]); renderBanner(); break;
  }
}

let searchT = null;
function onInput(e) {
  const el = e.target;
  if (el.dataset.set === 'level') { const v = Math.max(1, Math.min(79, parseInt(el.value, 10) || 1)); store.update(p => { p.settings.level = v; }); return; }
  const fp = el.closest('[data-fprefix]')?.dataset.fprefix;
  const setF = (bucket, key, val, isText) => {
    const f = { ...(store.ui[bucket] || {}) }; f[key] = val; store.setUi(bucket, f);
    if (isText) { clearTimeout(searchT); searchT = setTimeout(render, 160); } else render();
  };
  if (fp && el.dataset.f) return setF(fp, el.dataset.f, el.type === 'checkbox' ? el.checked : el.value, el.type === 'search');
  if (el.dataset.af) { const base = store.ui.af || { sec: [...new Set(D.achievements.map(x => x.section))].filter(s => !/arena|retired/i.test(s)), status: 'all', q: '' }; store.setUi('af', { ...base, [el.dataset.af]: el.value }); if (el.type === 'search') { clearTimeout(searchT); searchT = setTimeout(render, 160); } else render(); return; }
  if (el.dataset.if) { const base = { scope: 'all', ...(store.ui.if || {}) }; store.setUi('if', { ...base, [el.dataset.if]: el.type === 'checkbox' ? el.checked : el.value }); if (el.type === 'search') { clearTimeout(searchT); searchT = setTimeout(render, 160); } else render(); }
}

// ---------- boot ----------
async function boot() {
  applyTheme();
  shell();
  initTooltips();
  initMapPanel();
  document.addEventListener('click', onClick);
  document.addEventListener('click', onSettingsClick);
  document.addEventListener('input', (e) => { if (e.target.matches('input[type=search]')) onInput(e); });
  document.addEventListener('change', (e) => { if (e.target.dataset?.perk) { togglePerk(e.target.dataset.perk, e.target.checked); return; } if (e.target.matches('select,input[type=checkbox],input[type=number]') && !e.target.id?.startsWith('s-') && !e.target.closest('.mappanel')) { if (e.target.dataset.set === 'faction') store.update(p => { p.settings.faction = e.target.value; }); else onInput(e); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); lastDrawer = null; hideTip(); } });
  addEventListener('hashchange', route);
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => renderHeader());
  store.on((reason) => { render(); if (reason === 'profile' || reason === 'perks') { renderBanner(); } });

  $('#main').innerHTML = `<div class="boot"><div class="boot-t">Loading quest data…</div><div class="rb"><div class="rb-f" style="width:10%"></div></div></div>`;
  let ds = await loadDataset();
  if (!ds) {
    $('#main').innerHTML = `<div class="boot"><div class="boot-t">First start: reading all quests from the EFT wiki (≈20–40 s)…</div><div class="rb"><div class="rb-f"></div></div><div class="boot-m small muted"></div></div>`;
    try {
      ds = await buildLive((pct, msg) => { const f = $('.boot .rb-f'); if (f) f.style.width = Math.round(pct * 100) + '%'; const m = $('.boot-m'); if (m) m.textContent = msg; });
    } catch (e) {
      $('#main').innerHTML = `<div class="boot"><div class="boot-t">Could not load data from the wiki: ${esc(e.message)}</div><button class="btn" onclick="location.reload()">Retry</button></div>`;
      return;
    }
  }
  setDataset(ds);
  route();
  renderBanner();
  renderFooter();
  if (isStale(ds)) refreshData(false); // background auto-update
}

boot();
