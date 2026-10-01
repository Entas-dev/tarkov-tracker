// Stress test harness – injected into the running app. window.__stress.round(i, kind) performs one random action
// through the real UI handlers, then renders every tab and checks invariants. Returns {action, problems, ms}.
(async () => {
  const U = (f) => new URL('assets/' + f, location.href).href;
  const { store } = await import(U('store.js'));
  const M = await import(U('model.js'));
  const SR = await import(U('speedrun.js'));
  const TO = await import(U('tabs-other.js'));
  const D = () => M.D, IX = M.IX;
  let seed = 12345;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const errors = [];
  addEventListener('error', (e) => errors.push('error: ' + (e.message || e.error)));
  addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + (e.reason?.stack || e.reason)));
  const ce = console.error.bind(console);
  console.error = (...a) => { errors.push('console.error: ' + a.map(x => x?.stack || String(x)).join(' ')); ce(...a); };

  const TABS = ['story', 'speedrun', 'raid', 'kappa', 'hideout', 'traders', 'prestige', 'battlepass', 'quests', 'achievements', 'items'];
  async function act(data) {
    const b = document.createElement('button');
    for (const [k, v] of Object.entries(data)) b.dataset[k] = v;
    b.style.display = 'none';
    document.body.appendChild(b);
    b.click();
    b.remove();
    await sleep(15);
    // answer any confirmation dialog with a random button (sometimes Cancel)
    for (let k = 0; k < 3; k++) {
      const m = document.querySelector('.modal-wrap .modal-f');
      if (!m) break;
      const bs = [...m.querySelectorAll('button[data-i]')];
      const choice = pick(bs);
      lastDialog = choice.textContent.trim();
      choice.click();
      await sleep(15);
    }
  }
  let lastDialog = null;
  const snap = () => JSON.stringify(store.p);
  const quests = () => Object.values(D().quests).filter(q => M.visible(q));
  const avail = () => quests().filter(q => M.questStatus(q).s === 'available');
  const done = () => quests().filter(q => M.isDone(q.name));

  // ---------- invariants ----------
  function checkModel(problems, ctx) {
    const p = store.p;
    // store sanity
    const lv = p.settings.level;
    if (!Number.isInteger(lv) || lv < 1 || lv > 79) problems.push(`level invalid: ${lv}`);
    for (const k of ['cnt', 'hcnt']) for (const [key, v] of Object.entries(p[k] || {})) if (!(Number.isFinite(v) && v >= 0)) problems.push(`${k}[${key}] = ${v}`);
    // statuses
    let nAvail = 0;
    for (const q of Object.values(D().quests)) {
      let st;
      try { st = M.questStatus(q); } catch (e) { problems.push(`questStatus(${q.name}) threw ${e.message}`); continue; }
      if (M.isDone(q.name) && st.s !== 'done') problems.push(`${q.name}: done but status ${st.s}`);
      if (st.s === 'available') nAvail++;
      if (st.s === 'locked' && !st.reasons.length) problems.push(`${q.name}: locked without reason`);
    }
    // completing a quest must complete its single (non-OR) prerequisites, recursively
    if (ctx.completed) {
      const bad = [];
      const walk = (n, seen = new Set()) => {
        if (seen.has(n)) return; seen.add(n);
        const q = D().quests[n]; if (!q) return;
        for (const g of M.preOf(q)) {
          const vis = g.filter(a => M.visible(D().quests[a.q]));
          const comp = vis.filter(a => a.type === 'complete');
          if (comp.length === 1 && vis.length === 1) { if (!M.isDone(comp[0].q)) bad.push(`${comp[0].q} (before ${n})`); walk(comp[0].q, seen); }
        }
      };
      if (M.isDone(ctx.completed)) walk(ctx.completed); else problems.push(`${ctx.completed} was ticked but is not done`);
      if (bad.length) problems.push(`ticked ${ctx.completed} but prerequisites still open: ${bad.slice(0, 5).join(', ')}`);
    }
    if (ctx.unchecked && M.isDone(ctx.unchecked) && ctx.dialog && !/cancel/i.test(ctx.dialog)) problems.push(`${ctx.unchecked} still done after unchecking (${ctx.dialog})`);
    // Tour must not be finished as a side effect of another storyline
    if (ctx.tourBefore === false && ctx.chapter && ctx.chapter !== 'Tour' && p.ch['Tour']) problems.push(`Tour was marked finished by ticking ${ctx.chapter}`);
    for (const c of Object.keys(D().chapters)) if (c !== 'Tour' && M.chapterClosure(c).has('Tour')) problems.push(`chapter ${c} depends on Tour`);
    const req = M.requiredChapters();
    if (!req.has('The Ticket') || !req.has('Tour')) problems.push('required chapters missing Ticket/Tour');
    // needed items
    for (const sel of [{ story: true, quests: true, hideout: true }, { story: true }, { kappa: true }, { hideout: true }]) {
      let list;
      try { list = M.neededItems(sel, { gunsmith: true }); } catch (e) { problems.push(`neededItems ${JSON.stringify(sel)} threw ${e.message}`); continue; }
      for (const a of list) {
        if (!(a.need > 0) || a.have < 0 || a.have > a.need || a.fir > a.need || (a.have < a.need && !(a.prio >= 1 && a.prio <= 4))) { problems.push(`item ${a.item}: need ${a.need} have ${a.have} fir ${a.fir} prio ${a.prio}`); break; }
        const sum = a.sources.reduce((s, x) => s + x.count, 0);
        if (sum !== a.need) { problems.push(`item ${a.item}: sources ${sum} ≠ need ${a.need}`); break; }
        for (const s of a.sources) {
          if ((s.type === 'quest' || s.type === 'gunsmith') && M.isDone(s.name)) { problems.push(`item ${a.item} still needed for finished quest ${s.name}`); break; }
          if (s.type === 'hideout' && M.hLevel(s.name) >= s.level) { problems.push(`item ${a.item} still needed for built ${s.name} L${s.level}`); break; }
          if (s.type === 'chapter' && p.ch[s.name]) { problems.push(`item ${a.item} still needed for finished chapter ${s.name}`); break; }
        }
      }
    }
    // speedrun plan
    try {
      const plan = SR.planRaids({ maxRaids: 10, expPerRaid: 4000 });
      if (plan.raids.length > 10) problems.push('plan has more than 10 raids');
      plan.raids.forEach((r, i) => {
        if (!r.entries.length) problems.push(`raid ${i + 1} empty`);
        if (!r.map) problems.push(`raid ${i + 1} without map`);
        if (r.levelAfter < r.level) problems.push(`raid ${i + 1} level goes down`);
        const keys = r.entries.map(e => e.kind === 'quest' ? e.q.name + '|' + e.o.id : e.kind + e.c + (e.o?.id || ''));
        if (new Set(keys).size !== keys.length) problems.push(`raid ${i + 1} has duplicate objectives`);
        for (const e of r.entries) {
          if (e.kind === 'quest' && (M.isDone(e.q.name) || p.obj[e.q.name + '|' + e.o.id])) problems.push(`raid ${i + 1}: objective of finished quest ${e.q.name}`);
          if (e.kind === 'ch' && (p.ch[e.c] || p.chObj[e.c + '|' + e.o.id])) problems.push(`raid ${i + 1}: finished story step ${e.c}`);
        }
      });
      // In-Raid to-do for every map
      const maps = new Set([...IX.maps, ...plan.raids.map(r => r.map)]);
      for (const m of maps) {
        const t = SR.mapTodo(m);
        for (const e of [...t.entries, ...t.anywhere]) if (e.kind === 'quest' && (M.isDone(e.q.name) || M.questStatus(e.q).s !== 'available')) { problems.push(`In-Raid ${m}: ${e.q.name} is not available`); break; }
      }
    } catch (e) { problems.push('planner threw ' + (e.stack || e.message).slice(0, 300)); }
    return nAvail;
  }

  async function renderAll(problems) {
    for (const t of TABS) {
      const before = errors.length;
      location.hash = '#/' + t;
      await sleep(t === 'raid' ? 60 : 25);
      const main = document.querySelector('#main');
      const txt = main.innerText || '';
      if (txt.length < 40) problems.push(`tab ${t}: nearly empty`);
      const m = txt.match(/\bundefined\b|\bNaN\b|\[object Object\]/);
      if (m) problems.push(`tab ${t}: shows "${m[0]}" …${txt.slice(Math.max(0, m.index - 60), m.index + 20).replace(/\s+/g, ' ')}`);
      if (errors.length > before) problems.push(`tab ${t}: ${errors.slice(before).join(' | ').slice(0, 300)}`);
    }
    // Needed Items: every view; In-Raid: map docked; history drawer
    for (const v of ['grid', 'list', 'fit']) { store.setUi('iv', v); location.hash = '#/items'; await sleep(5); location.hash = '#/story'; await sleep(20); location.hash = '#/items'; await sleep(25); }
    const kap = document.querySelector('.tabs .tab-n')?.textContent || '';
    const kd = IX.order.filter(n => IX.kappa.has(n) && M.visible(D().quests[n]));
    if (kap !== `${kd.filter(n => M.isDone(n)).length}/${kd.length}`) problems.push(`Kappa counter "${kap}" wrong`);
  }

  window.__stress = {
    setSeed(s) { seed = s; },
    errors,
    async round(i, kind) {
      const t0 = performance.now();
      const problems = [];
      const ctx = { tourBefore: !!store.p.ch['Tour'] };
      const topBefore = store.history[0];
      const pb = JSON.parse(JSON.stringify(store.p));
      let allowQ = null, allowCh = null, allowChObj = null; // null = no restriction for this action
      const before = snap();
      let action = '';
      lastDialog = null;
      const errBefore = errors.length;
      const r = rnd();
      if (kind === 'quest' || r < 0.3) {
        // tick or untick a random quest (prefer quests you could do now / finished ones)
        const pool = rnd() < 0.55 ? avail() : rnd() < 0.6 ? done() : quests();
        const q = pick(pool.length ? pool : quests());
        const wasDone = M.isDone(q.name);
        action = `${wasDone ? 'untick' : 'tick'} quest ${q.name}`;
        allowQ = new Set([q.name, ...M.prerequisiteClosure(q.name)]); allowCh = new Set(); allowChObj = 'Tour|';
        await act({ act: 'quest', q: q.name });
        if (!wasDone) ctx.completed = q.name; else { ctx.unchecked = q.name; ctx.dialog = lastDialog || 'direct'; }
      } else if (r < 0.42) {
        const ap = avail().filter(q => q.objectives.length); const q = pick(ap.length ? ap : quests());
        const o = pick(q.objectives);
        action = `objective ${q.name} / ${o.text.slice(0, 40)}`;
        allowQ = new Set([q.name, ...M.prerequisiteClosure(q.name)]); allowCh = new Set(); allowChObj = 'Tour|';
        await act({ act: 'obj', q: q.name, o: o.id });
      } else if (r < 0.54) {
        const c = pick(Object.values(D().chapters));
        const o = pick(c.objectives);
        ctx.chapter = c.name;
        action = `story step ${c.name} / ${o.text.slice(0, 40)}`;
        allowQ = new Set(); allowCh = new Set([c.name, ...M.chapterClosure(c.name)]); allowChObj = c.name + '|';
        await act({ act: 'chobj', q: c.name, o: o.id });
      } else if (r < 0.58) {
        const c = pick(Object.keys(D().chapters));
        ctx.chapter = c;
        action = `chapter ${c}`;
        allowQ = new Set(); allowCh = new Set([c, ...M.chapterClosure(c)]); allowChObj = '-';
        await act({ act: 'chapter', c });
      } else if (r < 0.61) {
        const c = pick(Object.keys(D().chapters));
        action = `storyline start ${c}`; allowQ = new Set(); allowCh = new Set(); allowChObj = '-';
        await act({ act: 'ch-start', c });
      } else if (r < 0.68) {
        const m = pick(D().hideout.modules);
        const l = 1 + Math.floor(rnd() * m.levels.length);
        action = `hideout ${m.name} L${l}`; allowQ = new Set(); allowCh = new Set(); allowChObj = '-';
        await act({ act: 'hcheck', m: m.name, l: String(l) });
      } else if (r < 0.75) {
        const list = TO.itemList().filter(a => a.need > a.have);
        if (list.length) {
          const a = pick(list);
          const v = Math.floor(rnd() * (a.need + 1));
          action = `item ${a.item} have ${v}/${a.need}`; allowQ = new Set(); allowCh = new Set(); allowChObj = '-';
          await act({ act: 'it-set', item: a.item, v: String(v) });
          const now = TO.itemList().find(x => x.item === a.item);
          if (now && now.have !== Math.min(v, now.need) && now.need === a.need) problems.push(`item ${a.item}: set ${v}, shows ${now.have}`);
        }
      } else if (r < 0.81) {
        // "my open quests": random subset of available + a few locked, then apply with a random mode
        const pool = quests().filter(q => !M.isDone(q.name));
        const sel = Array.from({ length: 3 + Math.floor(rnd() * 12) }, () => pick(pool)).filter(Boolean);
        const mode = pick(['strict', 'replace', 'merge']);
        action = `open quests (${mode}): ${sel.length} quests`;
        store.update(p => { p.active = {}; for (const q of sel) p.active[q.name] = 1; });
        await act({ act: 'active-apply', mode });
        for (const q of sel) if (!M.isDone(q.name) && M.questStatus(q).s !== 'available') problems.push(`open quest ${q.name} not available after apply`);
      } else if (r < 0.86) {
        const v = 1 + Math.floor(rnd() * 79);
        action = `level ${v}`; allowQ = new Set(); allowCh = new Set(); allowChObj = '-';
        store.update(p => { p.settings.level = v; });
      } else if (r < 0.9) {
        const t = pick(Object.keys(D().traders).filter(t => D().traders[t].ll?.length));
        const l = pick(['', '1', '2', '3', '4']);
        action = `LL ${t} ${l || 'auto'}`; allowQ = new Set(); allowCh = new Set(); allowChObj = '-';
        await act({ act: 'setll', t, l });
      } else if (r < 0.93) {
        const e = pick(['Savior', 'Debtor', 'Survivor', 'Fallen']);
        action = `ending ${e}`; allowQ = new Set(); allowCh = new Set(); allowChObj = '-';
        await act({ act: 'ending', e });
      } else if (r < 0.95) {
        const h = store.history.length;
        if (h) { const k = Math.floor(rnd() * Math.min(h, 5)); action = `history undo #${k}`; await act({ act: 'hist-undo', i: String(k) }); }
        else action = 'history empty';
      } else if (r < 0.97) {
        // setup assistant: render every step on this random state, check the open-quests preview, close it
        action = 'setup assistant walkthrough'; allowQ = new Set(); allowCh = new Set(); allowChObj = '-';
        await act({ act: 'setup' });
        if (!document.querySelector('.wiz')) problems.push('setup assistant did not open');
        for (const id of [...document.querySelectorAll('.wiz-st')].map(b => b.dataset.s)) {
          const eb = errors.length;
          await act({ act: 'wz-go', s: id });
          const txt = document.querySelector('.wiz-b')?.innerText || '';
          const m = txt.match(/\bundefined\b|\bNaN\b|\[object Object\]/);
          if (m) problems.push(`setup step ${id}: shows "${m[0]}"`);
          if (txt.length < 30) problems.push(`setup step ${id}: nearly empty`);
          if (errors.length > eb) problems.push(`setup step ${id}: ${errors.slice(eb).join(' | ').slice(0, 300)}`);
        }
        const pv = M.previewActiveApply('strict', {});
        const act0 = Object.keys(store.p.active || {}).filter(n => store.p.active[n]);
        if (pv.doneAfter.some(n => act0.includes(n))) problems.push('preview marks an open quest as done');
        if ([...pv.capped, ...pv.choice].some(n => pv.profile.quests[n])) problems.push('preview: can\'t-tell quest is marked done');
        await act({ act: 'wz-close' });
        if (document.querySelector('.wiz')) problems.push('setup assistant did not close');
      } else {
        const id = pick(['pvp', 'seasonal', 'pve']);
        action = `profile ${id}`;
        await act({ act: 'profile', p: id });
      }
      if (allowQ) {
        const pa = store.p;
        const newQ = Object.keys(pa.quests).filter(n => pa.quests[n] && !pb.quests[n] && !allowQ.has(n));
        const newCh = Object.keys(pa.ch).filter(n => pa.ch[n] && !pb.ch[n] && !allowCh.has(n));
        const newO = Object.keys(pa.chObj).filter(k => pa.chObj[k] && !pb.chObj[k] && !k.startsWith(allowChObj));
        if (newQ.length) problems.push(`ticked quests nobody asked for: ${newQ.slice(0, 6).join(', ')}${newQ.length > 6 ? ` +${newQ.length - 6}` : ''}`);
        if (newCh.length) problems.push(`ticked chapters nobody asked for: ${newCh.join(', ')}`);
        if (newO.length) problems.push(`ticked story steps nobody asked for: ${newO.slice(0, 4).join(', ')}`);
      }
      if (errors.length > errBefore) problems.push('during action: ' + errors.slice(errBefore).join(' | ').slice(0, 400));
      // undo check: every 6th round revert the action and compare
      const nNew = topBefore ? store.history.indexOf(topBefore) : store.history.length;
      if (i % 6 === 5 && nNew > 0 && !action.startsWith('profile')) {
        store.undoTo(nNew - 1);
        const after = snap();
        const a = JSON.parse(before), b = JSON.parse(after);
        const diff = [];
        for (const k of ['quests', 'obj', 'ch', 'chObj', 'chStart', 'hideout', 'cnt', 'hcnt', 'active']) if (JSON.stringify(Object.fromEntries(Object.entries(a[k] || {}).sort())) !== JSON.stringify(Object.fromEntries(Object.entries(b[k] || {}).sort()))) diff.push(k);
        if (a.settings.level !== b.settings.level) diff.push('level');
        if (diff.length) problems.push(`undo did not restore: ${diff.join(', ')}`);
        action += ' → undone';
        delete ctx.completed; delete ctx.unchecked; delete ctx.chapter;
      }
      SR.recalcSpeedrun();
      const nAvail = checkModel(problems, ctx);
      await renderAll(problems);
      document.querySelector('[data-act="drawer-close"]')?.click();
      return { i, action, dialog: lastDialog, problems, ms: Math.round(performance.now() - t0), done: done().length, avail: nAvail, profile: store.active, level: store.p.settings.level };
    },
  };
})();
