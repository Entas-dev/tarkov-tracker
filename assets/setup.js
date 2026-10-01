// Setup assistant – opens on the first start of a profile and after a reset, any time from the header.
// Edition, goal + ending, season perks, story progress, trader loyalty, open quests (guided list per trader and
// screenshot text recognition), hideout. Only real information counts: the tracker derives "done" from what you
// say is open (everything before an open quest is finished) – never from estimates.
import { store } from './store.js';
import { D, IX, P, visible, isDone, traderLL, llIsManual, chapterClosure, requiredChapters, plausibleOpen, impliedDone, impliedLater, previewActiveApply, applyActiveQuests, isSeasonal, ENDINGS } from './model.js';
import { esc, attr, icon, img, traderImg, toast } from './ui.js';
import { goalToggles, itemFilter, hideoutChecklistHtml } from './tabs-other.js';
import { perksBodyHtml } from './perks.js';
import { chapterStarted, recalcSpeedrun } from './speedrun.js';
import { buildIndex, matchLines } from './qmatch.js';

let isOpen = false;
let stepId = 'start';
const jobs = []; // screenshot jobs (session only)
let jobSeq = 0;

// ---------- per-profile draft (choices that only matter inside the assistant) ----------
const draft = () => (store.ui.wiz || {})[store.active] || {};
const setDraft = (patch) => store.setUi('wiz', { ...(store.ui.wiz || {}), [store.active]: { ...draft(), ...patch } });
export const activeOpts = () => ({ noOpen: Object.keys(draft().noOpen || {}), done: (draft().ocrDone || []).filter(n => D.quests[n]) });
// what the open-quests step would apply – to tell whether it was applied since the last change
const inputSig = () => { const o = activeOpts(); const a = Object.keys(P().active || {}).filter(n => P().active[n] && D.quests[n]).sort(); return a.length || o.noOpen.length || o.done.length ? JSON.stringify([a, o.noOpen.sort(), o.done.slice().sort()]) : ''; };
const unapplied = () => { const s = inputSig(); return !!s && draft().applied?.sig !== s; };

function pristine(p) {
  const any = (o) => Object.values(o || {}).some(Boolean);
  return !any(p.quests) && !any(p.ch) && !any(p.chObj) && !any(p.chStart) && !any(p.active) && !any(p.obj) && !Object.values(p.hideout || {}).some(v => v > 0) && (p.settings.level || 1) <= 1;
}
export const needsSetup = (p = P()) => !p.settings.setupDone && pristine(p);
export function maybeAutoSetup() { if (!isOpen && D && needsSetup()) openSetup('start'); }

const fresh = () => draft().fresh;
const STEPS = [
  { id: 'start', label: 'Start' },
  { id: 'goal', label: 'Goal & ending' },
  { id: 'perks', label: 'Season perks', when: () => isSeasonal() && !!D.season?.modifiers },
  { id: 'story', label: 'Story', when: () => fresh() !== true },
  { id: 'll', label: 'Loyalty', when: () => fresh() !== true },
  { id: 'quests', label: 'Open quests', when: () => fresh() !== true },
  { id: 'hideout', label: 'Hideout', when: () => fresh() !== true },
  { id: 'done', label: 'Done' },
];
const steps = () => STEPS.filter(s => !s.when || s.when());

export function openSetup(step = 'start') {
  isOpen = true;
  stepId = step;
  if (fresh() == null && !pristine(P())) setDraft({ fresh: false });
  // "nothing open at …" / "finished" marks belong to the list you entered back then – start over after a while
  if (draft().applied && Date.now() - draft().applied.at > 30 * 60e3) setDraft({ noOpen: {}, ocrDone: [], fromShot: {}, applied: null });
  renderSetup(true);
}
export const setupOpen = () => isOpen;
function closeSetup(finished) {
  isOpen = false;
  renderSetup();
  if (!P().settings.setupDone) store.update(p => { p.settings.setupDone = true; }, 'settings');
  if (!finished) toast(`Setup closed – open it again any time with the ${icon('wand')} button at the top.`, 4200);
}

// ---------- render ----------
export function renderSetup(reset = false) {
  let wrap = document.querySelector('.wiz-wrap');
  if (!isOpen || !D) { wrap?.remove(); document.body.classList.remove('wiz-on'); return; }
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'wiz-wrap';
    wrap.innerHTML = '<div class="wiz" role="dialog" aria-modal="true" aria-labelledby="wiz-t"></div>';
    document.body.appendChild(wrap);
    document.body.classList.add('wiz-on');
  }
  const box = wrap.querySelector('.wiz');
  const st = steps();
  let i = st.findIndex(s => s.id === stepId);
  if (i < 0) { i = 0; stepId = st[0].id; }
  const sameStep = box.dataset.step === stepId && !reset;
  const keep = {};
  if (sameStep) box.querySelectorAll('[data-keep]').forEach(el => { keep[el.dataset.keep] = el.scrollTop; });
  const ae = document.activeElement;
  const focus = ae && box.contains(ae) && ae.matches('input[type=search],input[type=number]') ? { sel: ae.dataset.wzq != null ? 'input[data-wzq]' : ae.dataset.set ? `input[data-set="${ae.dataset.set}"]` : null, pos: ae.type === 'search' ? ae.selectionStart : null } : null;
  box.dataset.step = stepId;
  box.innerHTML = `
    <div class="wiz-h"><div class="wiz-ttl" id="wiz-t">${icon('wand')}<span>Setup · ${esc(store.profile.long)}</span></div>
      <button class="ibtn" data-act="wz-close" aria-label="Close setup">${icon('x')}</button></div>
    <ol class="wiz-steps">${st.map((s, k) => `<li><button class="wiz-st ${k === i ? 'on' : ''} ${k < i ? 'past' : ''}" data-act="wz-go" data-s="${s.id}" ${k === i ? 'aria-current="step"' : ''}><span class="wiz-n">${k < i ? icon('check') : k + 1}</span>${esc(s.label)}</button></li>`).join('')}</ol>
    <div class="wiz-b" data-keep="wiz-b" tabindex="-1">${BODY[stepId]()}</div>
    <div class="wiz-f">${i > 0 ? `<button class="btn" data-act="wz-go" data-s="${st[i - 1].id}">Back</button>` : ''}<span class="grow"></span>
      ${stepId === 'done' ? '<button class="btn btn-p" data-act="wz-finish">Finish</button>' : `<span class="small muted wiz-hint">${i + 1} / ${st.length}</span><button class="btn btn-p" data-act="wz-go" data-s="${st[i + 1].id}">${stepId === 'start' && fresh() == null ? 'Skip – next' : 'Next'}</button>`}</div>`;
  box.querySelectorAll('[data-keep]').forEach(el => { if (keep[el.dataset.keep] != null) el.scrollTop = keep[el.dataset.keep]; });
  if (focus?.sel) { const el = box.querySelector(focus.sel); if (el) { el.focus(); if (focus.pos != null) try { el.setSelectionRange(focus.pos, focus.pos); } catch { } } }
  else if (!sameStep) box.querySelector('.wiz-b')?.focus?.();
}

const seg = (act, cur, opts, extra = '') => `<div class="seg" role="radiogroup">${opts.map(([v, l, tip]) => `<button role="radio" aria-checked="${cur === v}" class="seg-b ${cur === v ? 'on' : ''}" data-act="${act}" data-v="${attr(v)}" ${extra} ${tip ? `data-tip="${attr(tip)}"` : ''}>${l}</button>`).join('')}</div>`;

const BODY = {
  start() {
    const p = P();
    const ed = p.settings.unheard ? 'unheard' : p.settings.eod ? 'eod' : 'std';
    const f = fresh();
    return `
      <h2 class="wiz-h2">Where do you start?</h2>
      <div class="wiz-cards">
        <button class="wiz-card ${f === true ? 'on' : ''}" data-act="wz-fresh" data-v="1">${icon('star')}<b>Fresh character</b><span class="small">New wipe or new character: level 1, nothing done yet.</span></button>
        <button class="wiz-card ${f === false ? 'on' : ''}" data-act="wz-fresh" data-v="0">${icon('list')}<b>Already playing</b><span class="small">Tell the tracker which quests are open in your game (screenshots or a short list per trader) – everything before them is marked done.</span></button>
      </div>
      <h3 class="wiz-h3">Game edition</h3>
      ${seg('wz-ed', ed, [['std', 'Standard / LB / PfE'], ['eod', 'Edge of Darkness'], ['unheard', 'The Unheard']])}
      <p class="small muted">Decides which edition-only quests exist for you. The Unheard includes everything from Edge of Darkness.</p>
      <div class="wiz-row">
        <div><h3 class="wiz-h3">Faction</h3>${seg('wz-fac', p.settings.faction, [['USEC', 'USEC'], ['BEAR', 'BEAR']])}</div>
        <div><h3 class="wiz-h3">PMC level</h3><input type="number" class="wiz-lvl" min="1" max="79" value="${p.settings.level}" data-set="level" aria-label="PMC level"></div>
      </div>
      ${isSeasonal() ? `<p class="small muted">${icon('flag')} Seasonal profile${D.season?.name ? ` – <b>${esc(D.season.name)}</b>` : ''}: seasonal quest changes are applied; you pick your perks in a later step.</p>` : ''}`;
  },

  goal() {
    const p = P();
    const E = D.endings?.endings || {};
    const tag = (n) => ((E[n]?.quoteHtml || '').match(/<b>([^<]+)<\/b>/) || [])[1] || '';
    return `
      <h2 class="wiz-h2">What are you going for?</h2>
      <p class="small">Needed Items counts the items for these goals (you can still switch them there). Default: Story + Kappa.</p>
      ${goalToggles(itemFilter())}
      <h2 class="wiz-h2">Your ending</h2>
      <p class="small">Main Story hides the objectives of the other paths. You can change it later.</p>
      <div class="wiz-end">${ENDINGS.map(n => `<button class="ending ${n === p.settings.ending ? 'on' : ''}" role="radio" aria-checked="${n === p.settings.ending}" data-act="ending" data-e="${n}">${img(E[n]?.img, n, 'ending-ic')}<span><span>${n}</span>${tag(n) ? `<span class="wiz-tag">${esc(tag(n).replace(/:$/, ''))}</span>` : ''}</span></button>`).join('')}</div>`;
  },

  perks() {
    return `<h2 class="wiz-h2">Season perks</h2>${perksBodyHtml({ rewards: false })}`;
  },

  story() {
    const p = P();
    const req = requiredChapters(p.settings.ending || 'Savior', p);
    const state = (c) => (p.ch[c] ? 2 : c === 'Tour' ? (p.chStart?.Tour || Object.keys(p.chObj).some(k => k.startsWith('Tour|') && p.chObj[k]) ? 1 : 0) : chapterStarted(D.chapters[c], p) ? 1 : 0);
    return `
      <h2 class="wiz-h2">Story progress</h2>
      <p class="small">Mark the story chapters you finished or are working on. Finishing a chapter also finishes the chapters it requires. <b>Tour</b> unlocks traders and maps: finished = all of them are unlocked; in progress = the tracker unlocks what your open quests need.</p>
      <div class="wiz-chs">${IX.chapterOrder.map(c => {
        const ch = D.chapters[c];
        const v = state(c);
        return `<div class="wiz-ch ${v === 2 ? 'done' : v === 1 ? 'started' : ''}">${img(ch.iconImg, '', 'ch-mini wiz-chic')}<span class="wiz-chn">${esc(c)}${req.has(c) ? ` <span class="badge b-story" data-tip="Needed for the ${attr(p.settings.ending)} ending">${esc(p.settings.ending)}</span>` : ''}</span>
          ${seg('wz-ch', v, [[0, 'Not started'], [1, c === 'Tour' ? 'In progress' : 'Started'], [2, 'Done']], `data-c="${attr(c)}"`)}</div>`;
      }).join('')}</div>`;
  },

  ll() {
    const p = P();
    const traders = IX.traders.filter(t => D.traders[t]?.ll?.length && t !== 'Fence');
    return `
      <h2 class="wiz-h2">Trader loyalty</h2>
      <p class="small">Set the loyalty level (LL) you have with each trader. <b>Auto</b> is the highest LL your PMC level allows – your real one is often lower. With the real LL, quests above it count as "not unlocked yet" instead of "finished" when you enter your open quests.</p>
      <div class="wiz-lls">${traders.map(t => {
        const max = 1 + D.traders[t].ll.length;
        const man = llIsManual(t, p);
        const cur = traderLL(t, p);
        return `<div class="wiz-ll">${traderImg(t, 'wiz-tr')}<b>${esc(t)}</b><span class="as-ll">${Array.from({ length: max }, (_, k) => k + 1).map(l => `<button class="as-llb ${man && cur === l ? 'on' : ''}" data-act="setll" data-t="${attr(t)}" data-l="${l}" aria-label="${attr(t)} loyalty level ${l}">${l}</button>`).join('')}
          ${man ? `<button class="linkbtn" data-act="setll" data-t="${attr(t)}" data-l="">auto</button>` : `<span class="small muted" data-tip="Estimated from your PMC level (level ${p.settings.level})">auto ${cur}</span>`}</span></div>`;
      }).join('')}</div>`;
  },

  quests() { return questsStep(); },

  hideout() {
    return `
      <h2 class="wiz-h2">Hideout</h2>
      <p class="small">Tick every level you have built – required lower levels and modules are ticked automatically. Built levels drop out of Needed Items.</p>
      ${hideoutChecklistHtml(P())}`;
  },

  done() {
    const p = P();
    const nDone = Object.keys(p.quests).filter(n => p.quests[n] && D.quests[n]).length;
    const nOpen = Object.keys(p.active || {}).filter(n => p.active[n] && D.quests[n] && !isDone(n, p)).length;
    const nCh = Object.keys(p.ch).filter(c => p.ch[c] && D.chapters[c]).length;
    const nH = D.hideout.modules.reduce((s, m) => s + Math.min(p.hideout[m.name] || 0, m.levels.length), 0);
    const g = itemFilter();
    const goals = [['story', 'Story'], ['kappa', 'Kappa'], ['lightkeeper', 'Lightkeeper'], ['quests', 'All quests'], ['hideout', 'Hideout']].filter(([k]) => g[k]).map(([, l]) => l);
    return `
      <h2 class="wiz-h2">All set</h2>
      ${unapplied() ? `<div class="notice">${icon('info')}<div>Your open quests from step <b>Open quests</b> are <b>not applied yet</b> – nothing before them is marked done. <button class="btn btn-s btn-p" data-act="wz-apply" data-mode="strict">${icon('check')} Apply – full task list</button> <button class="linkbtn" data-act="wz-go" data-s="quests">Back to the preview</button></div></div>` : ''}
      <div class="wiz-sum">
        <div><span class="muted small">Edition</span><b>${p.settings.unheard ? 'The Unheard' : p.settings.eod ? 'Edge of Darkness' : 'Standard'}</b></div>
        <div><span class="muted small">Faction · level</span><b>${esc(p.settings.faction)} · ${p.settings.level}</b></div>
        <div><span class="muted small">Goal</span><b>${esc(goals.join(' + ') || '–')}</b></div>
        <div><span class="muted small">Ending</span><b>${esc(p.settings.ending)}</b></div>
        <div><span class="muted small">Quests done · open</span><b>${nDone} · ${nOpen}</b></div>
        <div><span class="muted small">Chapters done · hideout levels</span><b>${nCh} · ${nH}</b></div>
      </div>
      <p class="small">Where to go next:</p>
      <div class="wiz-next">
        <button class="btn" data-act="wz-finish" data-go="speedrun">${icon('map')} Speedrun plan</button>
        <button class="btn" data-act="wz-finish" data-go="story">${icon('flag')} Main Story</button>
        <button class="btn" data-act="wz-finish" data-go="items">${icon('box')} Needed Items</button>
      </div>
      <p class="small muted">Everything you set here is in <b>History</b> (clock icon) and can be undone. Open this assistant again with the ${icon('wand')} button at the top.</p>`;
  },
};

// ---------- open quests ----------
const shotIdx = () => buildIndex(Object.keys(D.quests), { maps: IX.maps, traders: Object.keys(D.traders) });
let idxCache = null;
function questsStep() {
  const p = P();
  const dr = draft();
  const act = Object.keys(p.active || {}).filter(n => p.active[n] && D.quests[n] && visible(D.quests[n], p)); // applying reopens ticked quests that were marked done
  const before = impliedDone(act, p);
  const later = impliedLater(act, p);
  const noOpen = dr.noOpen || {};
  const fromShot = dr.fromShot || {};
  const q = (dr.q || '').toLowerCase().trim();
  const showAll = !!dr.showAll;
  // per trader: candidates that can be open right now
  const info = {};
  for (const t of IX.traders) {
    const names = (IX.byTrader[t] || []).filter(n => visible(D.quests[n], p));
    if (!names.length) continue;
    const r = { open: [], cand: [], before: 0, later: 0, gated: 0, done: 0 };
    for (const n of names) {
      if (act.includes(n)) { r.open.push(n); r.cand.push(n); continue; }
      if (isDone(n, p)) { r.done++; continue; }
      if (before.has(n)) { r.before++; continue; }
      if (later.has(n)) { r.later++; continue; }
      if (!plausibleOpen(D.quests[n], p)) { r.gated++; continue; }
      r.cand.push(n);
    }
    info[t] = r;
  }
  const traders = Object.keys(info);
  let sel = dr.trader && info[dr.trader] ? dr.trader : traders.find(t => info[t].cand.length) || traders[0];
  const T = info[sel];
  const row = (n) => {
    const Q = D.quests[n];
    const on = act.includes(n);
    const lv = Q.minLevel > 1 ? `<span class="wq-b">Lv ${Q.minLevel}</span>` : '';
    const ll = Q.ll?.level > 1 ? `<span class="wq-b">LL${Q.ll.level}</span>` : '';
    const k = IX.kappa.has(n) ? '<span class="wq-b wq-k">K</span>' : '';
    return `<label class="as-row wq-row ${on ? 'on' : ''}"><input type="checkbox" data-active="${attr(n)}" ${on ? 'checked' : ''}><span class="wq-n">${esc(n)}${isDone(n, p) ? ` <span class="small muted">${on ? '(marked done now – reopened when you apply)' : 'done'}</span>` : ''}</span>${fromShot[n] ? `<span class="wq-shot" data-tip="Found on a screenshot">${icon('upload')}</span>` : ''}${k}${lv}${ll}${q ? `<span class="small muted">${esc(Q.trader)}</span>` : ''}</label>`;
  };
  let listHtml;
  if (q) {
    const hits = IX.order.filter(n => visible(D.quests[n], p) && n.toLowerCase().includes(q)).slice(0, 60);
    listHtml = hits.map(row).join('') || '<div class="empty small">No quest matches.</div>';
  } else if (noOpen[sel]) {
    listHtml = `<div class="wq-none small">${icon('check')} You said nothing is open at ${esc(sel)} – every task the tracker sees as unlocked there counts as finished. <button class="linkbtn" data-act="wz-noopen" data-t="${attr(sel)}">Undo</button></div>`;
  } else {
    const names = showAll ? (IX.byTrader[sel] || []).filter(n => visible(D.quests[n], p) && !isDone(n, p) || act.includes(n)) : T.cand;
    listHtml = names.map(row).join('') || '<div class="empty small">Nothing that can be open here.</div>';
  }
  return `
    <h2 class="wiz-h2">Your open quests</h2>
    <p class="small">In the game open every trader's <b>Tasks</b> (Show completed and Show locked <b>off</b>) – that list is what the tracker needs. Everything before an open quest is finished; anything unlocked that is <b>not</b> in your list is finished too. You see exactly what will be marked before you apply.</p>
    <div class="wq">
        <section class="wq-sec wq-a">
          <h3 class="wiz-h3"><span class="wq-num">1</span>Screenshots <span class="small muted">fastest</span></h3>
          <p class="small">Per trader: <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, select the task list, then <kbd>Ctrl</kbd>+<kbd>V</kbd> here (scroll and repeat for long lists). The text is read <b>in your browser</b> – the game is never touched.</p>
          <div class="wq-drop" data-act="wz-pick" role="button" tabindex="0" aria-label="Add screenshots">${icon('upload')}<span><b>Paste</b> (Ctrl+V), <b>drop</b> images or <b>click</b> to pick files</span></div>
          <input type="file" id="wz-file" accept="image/*" multiple hidden>
          ${jobs.length ? `<div class="wq-jobs">${jobs.slice().reverse().map(jobHtml).join('')}</div>` : ''}
        </section>
        <section class="wq-sec wq-c">
          <h3 class="wiz-h3"><span class="wq-num">3</span>Apply</h3>
          ${applyHtml(act)}
        </section>
      <section class="wq-sec wq-r">
        <h3 class="wiz-h3"><span class="wq-num">2</span>Check per trader <span class="small muted">${act.length} open ticked</span></h3>
        <div class="wq-trs">${traders.map(t => { const r = info[t]; return `<button class="wq-tr ${t === sel && !q ? 'on' : ''} ${noOpen[t] ? 'none' : ''}" data-act="wz-tr" data-t="${attr(t)}" data-tip="${attr(`${t}: ${r.open.length} open ticked · ${r.cand.length - r.open.length} more can be open`)}">${traderImg(t, 'wq-tri')}<span>${esc(t)}</span>${r.open.length ? `<span class="wq-c">${r.open.length}</span>` : noOpen[t] ? `<span class="wq-c none">${icon('check')}</span>` : ''}</button>`; }).join('')}</div>
        <label class="search wq-search">${icon('search')}<input type="search" data-wzq placeholder="Search any quest" value="${attr(dr.q || '')}" aria-label="Search quests"></label>
        ${q ? '' : `<div class="wq-th">${traderImg(sel, 'mp-tr')}<b>${esc(sel)}</b><span class="small muted">LL ${traderLL(sel, p)}${llIsManual(sel, p) ? '' : ' (auto)'}</span>
          <button class="btn btn-s ${noOpen[sel] ? 'btn-p' : ''}" data-act="wz-noopen" data-t="${attr(sel)}" data-tip="Your in-game list for this trader is empty: all unlocked tasks are done">Nothing open here</button></div>
          <p class="small muted wq-sub">Tick what you see in the game. Hidden: ${T.done} done${T.before ? ` · ${T.before} finished before your open quests` : ''}${T.later ? ` · ${T.later} only after them` : ''}${T.gated ? ` · ${T.gated} need a higher level / LL` : ''}. <button class="linkbtn" data-act="wz-all">${showAll ? 'Show only possible ones' : 'Show all'}</button></p>`}
        <div class="wq-list" data-keep="wq-list">${listHtml}</div>
      </section>
    </div>`;
}

function jobHtml(j) {
  const sts = { open: 'open', done: 'done', locked: 'locked', failed: 'failed' };
  return `<div class="wq-job" data-job="${j.id}">
    ${j.url ? `<img class="wq-thumb" src="${attr(j.url)}" alt="">` : ''}
    <div class="wq-jb"><div class="small"><b>${esc(j.name)}</b> ${j.st === 'ok' ? `<span class="muted">· ${j.found.length} quest${j.found.length !== 1 ? 's' : ''} found · ${(j.ms / 1000).toFixed(1)} s</span>` : j.st === 'err' ? `<span class="c-red">· ${esc(j.err)}</span>` : `<span class="muted wq-msg">· ${esc(j.msg || 'waiting…')}</span>`}</div>
      ${j.st === 'run' || j.st === 'wait' ? `<div class="rb"><div class="rb-f" style="width:${Math.round((j.pct || 0) * 100)}%"></div></div>` : ''}
      ${j.st === 'ok' ? `<div class="wq-found">${j.found.map(f => `<span class="wq-f st-${sts[f.status] || 'open'}" data-tip="${attr(`Read: “${f.text}”${f.status === 'done' ? ' – Completed: counts as finished' : f.status === 'locked' ? ' – Locked: ignored' : f.status === 'failed' ? ' – Failed: ignored' : ' – open'}`)}">${esc(f.name)}${f.status === 'done' ? ' ✓' : f.status === 'locked' ? ' 🔒' : ''}</span>`).join('')}</div>
        ${j.detected?.length ? `<div class="small c-ok">Detected: ${esc(j.detected.join(', '))}</div>` : ''}
        ${j.unmatched.length ? `<details class="small"><summary>${j.unmatched.length} line${j.unmatched.length > 1 ? 's' : ''} not recognised</summary><ul class="wq-un">${j.unmatched.slice(0, 40).map(u => `<li>${esc(u)}</li>`).join('')}</ul><span class="muted">Tick those quests in the list on the right.</span></details>` : ''}` : ''}
    </div>
    <button class="ibtn" data-act="wz-jobx" data-id="${j.id}" aria-label="Remove">${icon('x')}</button></div>`;
}

function applyHtml(act) {
  const dr = draft();
  const opts = activeOpts();
  if (!act.length && !opts.noOpen.length && !opts.done.length) return '<p class="small muted">Add screenshots or tick your open quests first.</p>';
  const t0 = performance.now();
  const pv = previewActiveApply('strict', opts);
  const ms = Math.round(performance.now() - t0);
  const byT = (list) => { const g = {}; for (const n of list) (g[D.quests[n].trader] = g[D.quests[n].trader] || []).push(n); return Object.entries(g).sort((a, b) => IX.traders.indexOf(a[0]) - IX.traders.indexOf(b[0])); };
  const p = P();
  // quests the full-list rule would finish only because the LL is an estimate
  const llRisk = pv.strictList.filter(n => { const L = D.quests[n].ll; return L?.trader && L.level > 1 && !llIsManual(L.trader, p); });
  const keepOpen = (n) => `<button class="linkbtn" data-act="wz-keep" data-q="${attr(n)}" data-tip="It is in my in-game list – keep it open">open</button>`;
  return `
    <div class="wq-pv">
      <div><b>${act.length}</b> open quest${act.length !== 1 ? 's' : ''} ticked${opts.noOpen.length ? ` · nothing open at ${esc(opts.noOpen.join(', '))}` : ''}${opts.done.length ? ` · ${opts.done.length} marked as finished` : ''}</div>
      <div><b>${pv.doneAfter.length}</b> quests will be marked done:</div>
      <ul class="small wq-pvl">
        <li><b>${pv.closure.length + opts.done.length}</b> come before your open / completed quests</li>
        <li><b>${pv.strictList.length}</b> are unlocked but not in your list ${pv.strictList.length ? '<span class="muted">– check them:</span>' : ''}</li>
        ${pv.removed.length ? `<li><b>${pv.removed.length}</b> ticks you had before are removed (not before any open quest)</li>` : ''}
        ${pv.level ? `<li>PMC level raised to <b>${pv.level}</b></li>` : ''}${pv.ll.length ? `<li>${esc(pv.ll.join(', '))} set</li>` : ''}
      </ul>
      ${pv.strictList.length ? `<details class="wq-strict" ${pv.strictList.length <= 25 ? 'open' : ''}><summary class="small">Unlocked but not in your list → finished (${pv.strictList.length})</summary>${byT(pv.strictList).map(([t, ns]) => `<div class="wq-sg">${traderImg(t, 'mp-tr')} <b class="small">${esc(t)}</b><div class="wq-sl">${ns.map(n => `<span class="wq-s ${llRisk.includes(n) ? 'risk' : ''}">${esc(n)} ${keepOpen(n)}</span>`).join('')}</div></div>`).join('')}</details>` : ''}
      ${pv.capped.length || pv.choice.length ? `<details class="wq-strict" open><summary class="small">Can't tell from your list (${pv.capped.length + pv.choice.length}) – tick the ones you finished</summary>
        ${pv.choice.length ? `<p class="small muted">Either-or quests – you did one of them (or none yet):</p><div class="wq-sl">${pv.choice.map(n => `<button class="wq-s wq-tg" data-act="wz-done" data-q="${attr(n)}" data-tip="${attr(`${D.quests[n].trader} · instead of ${D.quests[n].alts.join(', ')}`)}">${esc(n)}</button>`).join('')}</div>` : ''}
        ${pv.capped.length ? `<p class="small muted">Higher loyalty group – unlocks after enough finished tasks at that LL; not in your list means finished <b>or</b> still locked:</p>${byT(pv.capped).map(([t, ns]) => `<div class="wq-sg">${traderImg(t, 'mp-tr')} <b class="small">${esc(t)}</b><div class="wq-sl">${ns.map(n => `<button class="wq-s wq-tg" data-act="wz-done" data-q="${attr(n)}">${esc(n)}</button>`).join('')}</div></div>`).join('')}` : ''}</details>` : ''}
      ${opts.done.length ? `<details class="wq-strict"><summary class="small">Marked as finished by you / screenshots (${opts.done.length})</summary><div class="wq-sl">${opts.done.map(n => `<button class="wq-s wq-tg on" data-act="wz-done" data-q="${attr(n)}" data-tip="Click to remove">${icon('check')} ${esc(n)}</button>`).join('')}</div></details>` : ''}
      ${llRisk.length ? `<div class="notice wq-warn">${icon('info')}<div class="small"><b>${llRisk.length}</b> of them need a loyalty level the tracker only <b>estimated</b> (${esc([...new Set(llRisk.map(n => D.quests[n].ll.trader))].join(', '))}). Set your real LL in the <button class="linkbtn" data-act="wz-go" data-s="ll">Loyalty</button> step, otherwise locked quests may be marked done.</div></div>` : ''}
      <div class="wq-btns">
        <button class="btn btn-p" data-act="wz-apply" data-mode="strict">${icon('check')} Apply – this is my full task list</button>
        <details class="small wq-more"><summary>Other ways</summary>
          <button class="btn btn-s" data-act="wz-apply" data-mode="replace" data-tip="Only marks what your open quests require. Everything else stays open.">Only what they require</button>
          <button class="btn btn-s" data-act="wz-apply" data-mode="merge" data-tip="Keeps everything you already ticked and adds what the open quests require">Keep my ticks + add</button>
          <button class="btn btn-s" data-act="active-clear">Clear ticked open quests</button>
        </details>
      </div>
      ${dr.applied && !unapplied() ? `<div class="small c-ok wq-applied">${icon('check')} Applied ${new Date(dr.applied.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${dr.applied.done} quests done, ${dr.applied.open} open.</div>` : `<div class="small c-orange">Not applied yet – nothing is marked until you press Apply.</div>`}
      <p class="small muted">Preview ${ms} ms · undo any time in History.</p>
    </div>`;
}

// ---------- screenshots ----------
async function addFiles(files) {
  const imgs = [...files].filter(f => f && /^image\//.test(f.type));
  if (!imgs.length) { toast('No image found – copy a screenshot (Win+Shift+S) and paste it here'); return; }
  for (const f of imgs) jobs.push({ id: ++jobSeq, file: f, name: f.name && f.name !== 'image.png' ? f.name : `Screenshot ${jobSeq}`, url: URL.createObjectURL(f), st: 'wait', pct: 0, found: [], unmatched: [] });
  renderSetup();
  runJobs();
}
let running = false;
async function runJobs() {
  if (running) return;
  running = true;
  try {
    const { recognize } = await import('./ocr.js');
    for (const j of jobs) {
      if (j.st !== 'wait') continue;
      j.st = 'run';
      const upd = () => { const el = document.querySelector(`.wq-job[data-job="${j.id}"]`); if (!el) return; const f = el.querySelector('.rb-f'); if (f) f.style.width = Math.round(j.pct * 100) + '%'; const m = el.querySelector('.wq-msg'); if (m) m.textContent = '· ' + (j.msg || ''); };
      try {
        const r = await recognize(j.file, (pct, msg) => { j.pct = pct; j.msg = msg; upd(); });
        j.ms = r.ms;
        j.lines = r.lines;
        applyShot(j, matchLines(r.lines, idxCache || (idxCache = shotIdx())));
        j.st = 'ok';
      } catch (e) {
        console.warn('screenshot failed', e);
        j.st = 'err'; j.err = e.message || String(e);
      }
      j.file = null;
      renderSetup();
    }
  } catch (e) {
    for (const j of jobs) if (j.st === 'wait' || j.st === 'run') { j.st = 'err'; j.err = e.message || String(e); }
    renderSetup();
  } finally { running = false; }
}
// recognised names → open quests (and Completed ones as finished); edition / faction follow from the quests you have
function applyShot(j, res) {
  const p0 = P();
  const nextPrestige = 1 + Math.max(0, ...Object.keys(p0.prestige || {}).filter(k => p0.prestige[k]).map(Number));
  const pickName = (names) => names.find(n => new RegExp(`\\(Prestige ${nextPrestige}\\)$`).test(n) && visible(D.quests[n], p0)) || names.find(n => visible(D.quests[n], p0) && !isDone(n, p0)) || names.find(n => D.quests[n]) || names[0];
  const found = [];
  for (const m of res.matches) {
    const name = pickName(m.names);
    if (!D.quests[name] || found.some(f => f.name === name)) continue;
    found.push({ name, status: m.status || 'open', text: m.text });
  }
  j.found = found;
  j.unmatched = res.unmatched;
  const det = [];
  const open = found.filter(f => f.status === 'open').map(f => f.name);
  const done = found.filter(f => f.status === 'done').map(f => f.name);
  const qs = [...open, ...done].map(n => D.quests[n]);
  const set = {};
  if (qs.some(q => q.edition === 'Unheard') && !p0.settings.unheard) { set.unheard = true; set.eod = true; det.push('The Unheard edition'); }
  else if (qs.some(q => q.edition === 'EOD') && !p0.settings.eod) { set.eod = true; det.push('Edge of Darkness'); }
  const fac = qs.find(q => q.faction)?.faction;
  if (fac && fac !== p0.settings.faction) { set.faction = fac; det.push(fac); }
  j.detected = det;
  const dr = draft();
  setDraft({ ocrDone: [...new Set([...(dr.ocrDone || []), ...done])], fromShot: { ...(dr.fromShot || {}), ...Object.fromEntries([...open, ...done].map(n => [n, 1])) } });
  if (!open.length && !Object.keys(set).length) return;
  store.update(p => {
    Object.assign(p.settings, set);
    p.active = p.active || {};
    for (const n of open) p.active[n] = 1;
    for (const n of done) delete p.active[n];
  }, 'progress', `Screenshot: ${open.length} open quest${open.length !== 1 ? 's' : ''} recognised`);
}

// ---------- events ----------
function onClick(e) {
  const b = e.target.closest('[data-act^="wz-"]');
  if (!b) return;
  const a = b.dataset.act;
  switch (a) {
    case 'wz-go': stepId = b.dataset.s; renderSetup(true); break;
    case 'wz-close': closeSetup(false); break;
    case 'wz-finish': { closeSetup(true); if (b.dataset.go) location.hash = '#/' + b.dataset.go; toast('Setup saved'); break; }
    case 'wz-fresh': { const v = b.dataset.v === '1'; setDraft({ fresh: v }); if (v) stepId = 'start'; renderSetup(); break; }
    case 'wz-ed': { const v = b.dataset.v; store.update(p => { p.settings.eod = v !== 'std'; p.settings.unheard = v === 'unheard'; }, 'settings'); break; }
    case 'wz-fac': store.update(p => { p.settings.faction = b.dataset.v; }, 'settings'); break;
    case 'wz-ch': {
      const c = b.dataset.c, v = +b.dataset.v;
      store.update(p => {
        p.chStart = p.chStart || {};
        if (v === 2) { p.ch[c] = 1; for (const d of chapterClosure(c)) p.ch[d] = 1; }
        else {
          delete p.ch[c];
          if (v === 1) p.chStart[c] = 1;
          else { delete p.chStart[c]; for (const k of Object.keys(p.chObj)) if (k.startsWith(c + '|')) delete p.chObj[k]; }
        }
      }, 'progress', `${c}: ${['not started', 'started', 'done'][v]}`);
      break;
    }
    case 'wz-tr': setDraft({ trader: b.dataset.t, q: '' }); renderSetup(); document.querySelector('.wq-list')?.scrollTo(0, 0); break;
    case 'wz-all': setDraft({ showAll: !draft().showAll }); renderSetup(); break;
    case 'wz-noopen': { const t = b.dataset.t; const no = { ...(draft().noOpen || {}) }; if (no[t]) delete no[t]; else no[t] = 1; setDraft({ noOpen: no }); renderSetup(); break; }
    case 'wz-done': { const n = b.dataset.q; const d = new Set(draft().ocrDone || []); if (d.has(n)) d.delete(n); else d.add(n); setDraft({ ocrDone: [...d] }); renderSetup(); break; }
    case 'wz-keep': store.update(p => { p.active = p.active || {}; p.active[b.dataset.q] = 1; }, 'progress', `${b.dataset.q} is open`); break;
    case 'wz-pick': document.getElementById('wz-file')?.click(); break;
    case 'wz-jobx': { const i = jobs.findIndex(j => j.id === +b.dataset.id); if (i >= 0) { if (jobs[i].url) URL.revokeObjectURL(jobs[i].url); jobs.splice(i, 1); } renderSetup(); break; }
    case 'wz-apply': {
      const mode = b.dataset.mode;
      const before = Object.keys(P().quests).length;
      recalcSpeedrun();
      const info = applyActiveQuests(mode, activeOpts());
      const p = P();
      const done = Object.keys(p.quests).filter(n => p.quests[n] && D.quests[n]).length;
      const open = Object.keys(p.active || {}).filter(n => p.active[n] && D.quests[n] && !isDone(n, p)).length;
      setDraft({ applied: { at: Date.now(), done, open, mode, sig: inputSig() } });
      toast(`${done} quests marked done (${done - before >= 0 ? '+' : ''}${done - before}) · ${open} open${info.level ? ` · level ${info.level}` : ''}${info.ll?.length ? ` · ${info.ll.join(', ')}` : ''}`, 4200);
      renderSetup();
      break;
    }
  }
}
function onInput(e) {
  if (!isOpen) return;
  if (e.target.matches?.('input[data-wzq]')) { setDraft({ q: e.target.value }); clearTimeout(onInput.t); onInput.t = setTimeout(renderSetup, 140); }
}
function onChange(e) {
  if (e.target.id === 'wz-file') { addFiles(e.target.files); e.target.value = ''; }
}
// a pasted screenshot anywhere on the site goes to the open-quests step
function onPaste(e) {
  if (!D) return;
  const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
  if (!files.length) for (const it of e.clipboardData?.items || []) if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) files.push(f); }
  if (!files.length) return;
  e.preventDefault();
  if (fresh() === true) setDraft({ fresh: false });
  if (!isOpen || stepId !== 'quests') openSetup('quests');
  addFiles(files);
}
function onDrag(e) {
  if (!isOpen || stepId !== 'quests') return;
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  const z = document.querySelector('.wq-drop');
  if (e.type === 'drop') { z?.classList.remove('over'); addFiles(e.dataTransfer.files); }
  else z?.classList.toggle('over', e.type !== 'dragleave');
}
function onKey(e) {
  if (!isOpen) return;
  if (e.key === 'Escape' && !document.querySelector('.modal-wrap')) { e.stopPropagation(); closeSetup(false); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.wq-drop')) { e.preventDefault(); document.getElementById('wz-file')?.click(); }
}
document.addEventListener('click', onClick);
document.addEventListener('input', onInput);
document.addEventListener('change', onChange);
document.addEventListener('paste', onPaste);
for (const t of ['dragover', 'dragenter', 'dragleave', 'drop']) document.addEventListener(t, onDrag);
document.addEventListener('keydown', onKey, true);
store.on(() => { if (isOpen) renderSetup(); });
