// Every quest chain, once: injected into the running app (see chains_run.py). window.__chains.run(profile) returns
// {checked, problems:[...], notes:[...]} for one profile (pvp / seasonal / pve).
//  A) data: every requirement from the game files is part of the quest's chain in the tracker (otherwise the
//     tracker would show the quest too early)
//  B) "only this quest is open" with a full task list: its chain is done, nothing after it is done, and afterwards
//     no other quest counts as available – also not in the Speedrun plan
//  C) "only what it requires": the chain alone makes the quest available (or the reason is a known gate)
(async () => {
  const U = (f) => new URL('assets/' + f, location.href).href;
  const { store } = await import(U('store.js'));
  const M = await import(U('model.js'));
  const SR = await import(U('speedrun.js'));
  const D = M.D, IX = M.IX;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function baseProfile(q, { full }) {
    const p = clone(store.p);
    for (const k of ['quests', 'active', 'obj', 'cnt', 'hideout', 'hcnt', 'ch', 'chObj', 'chStart', 'autoBy', 'notOpen']) p[k] = {};
    p.settings = { ...p.settings, edition: 'unheard', eod: true, unheard: true, faction: q.faction || 'USEC', ll: {}, rep: { Fence: 6 }, seriesLogic: true };
    p.ch = { Tour: 1 };
    if (full) { p.settings.level = 79; for (const t of Object.keys(D.traders)) if (D.traders[t].ll?.length) p.settings.ll[t] = 1 + D.traders[t].ll.length; }
    else p.settings.level = Math.max(1, IX.effLevel(q.name) || 1);
    return p;
  }
  // quests that need `name` finished (or failed) – they can't be done while it is open
  function after(name, p) {
    const out = new Set();
    const dep = IX.graph[M.mode()].dep;
    const queue = [name];
    while (queue.length) {
      const n = queue.shift();
      for (const d of dep[n] || []) {
        if (out.has(d)) continue;
        const q = D.quests[d];
        const pre = M.preOf(q);
        if (pre.some(g => g.some(a => a.q === n) && g.every(a => (a.q === n || out.has(a.q)) && a.type !== 'accept'))) { out.add(d); queue.push(d); }
      }
    }
    return out;
  }
  // everything the tracker requires before q (all options of OR groups, accept links included)
  function anyChain(name) {
    const out = new Set();
    const walk = (n) => { for (const g of M.preOf(D.quests[n])) for (const a of g) if (!out.has(a.q) && D.quests[a.q]) { out.add(a.q); walk(a.q); } };
    walk(name);
    return out;
  }

  async function run(profile) {
    store.setActive(profile);
    const problems = [], notes = [];
    const names = IX.order.filter(n => M.visible(D.quests[n], { ...store.p, settings: { ...store.p.settings, eod: true, unheard: true, faction: D.quests[n].faction || 'USEC' } }));
    // ---- A) game files vs tracker chains ----
    const G = D.gameReqs?.quests || {};
    for (const n of names) {
      const g = G[n];
      if (!g) continue;
      const chain = anyChain(n);
      const variants = g.alts || [g.req || []];
      // every variant's requirements must be in the chain – for several variants (one page, several tasks) one is enough
      const removed = new Set(profile === 'seasonal' ? (D.quests[n].seasonal || []).flatMap(x => x.removePrereq || []) : []);
      const ok = variants.some(rs => rs.every(r => !D.quests[r.q] || r.q === n || removed.has(r.q) || chain.has(r.q) || (r.via || []).some(v => chain.has(v))));
      if (!ok) problems.push(`A ${profile} ${n}: game requires ${variants.map(rs => rs.map(r => r.q).join(' + ')).join(' OR ')} – not in the tracker chain`);
      if ((g.lvl || 0) !== (D.quests[n].minLevel || 0)) problems.push(`A ${profile} ${n}: level ${D.quests[n].minLevel} vs game ${g.lvl}`);
    }
    // ---- B) only this quest open, full list ----
    let checked = 0;
    const t0 = performance.now();
    for (const n of names) {
      const q = D.quests[n];
      const p = baseProfile(q, { full: true });
      p.active = { [n]: 1 };
      const info = M.computeActiveApply(p, 'strict', {});
      checked++;
      const chain = M.prerequisiteClosure(n, { ...p, quests: {} });
      const miss = [...chain].filter(m => !p.quests[m]);
      if (miss.length) problems.push(`B ${profile} ${n}: chain not done: ${miss.slice(0, 5).join(', ')}`);
      const aft = after(n, p);
      const bad = [...aft].filter(m => p.quests[m]);
      if (bad.length) problems.push(`B ${profile} ${n}: done although it needs ${n}: ${bad.slice(0, 5).join(', ')}`);
      // nothing but the open quest may count as available now
      const avail = IX.order.filter(m => M.visible(D.quests[m], p) && M.questStatus(D.quests[m], p).s === 'available');
      const extra = avail.filter(m => m !== n);
      if (extra.length) problems.push(`B ${profile} ${n}: also "available": ${extra.slice(0, 6).join(', ')}${extra.length > 6 ? ` +${extra.length - 6}` : ''}`);
      if (M.questStatus(q, p).s !== 'available') problems.push(`B ${profile} ${n}: the open quest is ${M.questStatus(q, p).s}`);
      // conditional tasks (events, lost standing, failed tasks) are never finished by the cascade
      const condDone = Object.keys(p.quests).filter(m => D.quests[m]?.cond && !chain.has(m));
      if (condDone.length) problems.push(`B ${profile} ${n}: conditional task marked done: ${condDone.slice(0, 4).join(', ')}`);
      // Speedrun: the first raid only works on the open quest (and story)
      {
        const real = store.p;
        const saved = clone(real);
        Object.assign(real, clone(p));
        try {
          const plan = SR.planRaids({ maxRaids: 1, expPerRaid: 0 });
          // only the open quest is available now; everything else in the plan has to unlock on the way (= is locked now)
          const now = (m) => M.questStatus(D.quests[m], p).s === 'available';
          const others = (plan.raids[0]?.entries || []).filter(e => e.kind === 'quest' && e.q.name !== n && now(e.q.name)).map(e => e.q.name);
          if (others.length) problems.push(`B ${profile} ${n}: Speedrun raid 1 has quests you can't have: ${[...new Set(others)].slice(0, 5).join(', ')}`);
          // "ready to hand in" only when every objective is ticked (talking / "do not …" need nothing); item quests only if open now
          const leaf = (q, o) => !o.optional && !q.objectives.some(x => x.parent === o.id && !x.optional);
          const pre = [...plan.prelude.done.filter(m => D.quests[m].objectives.some(o => leaf(D.quests[m], o) && o.kind !== 'talk' && !/^(do not|don't|without)\b/i.test(o.text || '') && !p.obj[m + '|' + o.id])), ...(plan.prelude.items || []).filter(m => M.questStatus(D.quests[m], p).s !== 'available').map(m => m + ' (item quest not open)')];
          if (pre.length) problems.push(`B ${profile} ${n}: Speedrun says "hand in now" for quests that still need a raid or items: ${pre.slice(0, 5).join(', ')}`);
        } finally { for (const k of Object.keys(real)) delete real[k]; Object.assign(real, saved); }
      }
    }
    const msB = Math.round(performance.now() - t0);
    // ---- C) only what it requires ----
    const gates = {};
    for (const n of names) {
      const q = D.quests[n];
      const p = baseProfile(q, { full: false });
      p.active = { [n]: 1 };
      M.computeActiveApply(p, 'replace', {});
      delete p.active[n];
      const st = M.questStatus(q, p);
      if (st.s === 'available') continue;
      for (const r of st.reasons) {
        const k = r.k === 'pre' ? `pre ${r.g.length > 1 ? 'OR-group' : r.g[0].type}` : r.k;
        (gates[k] = gates[k] || []).push(n);
        // a single required quest that the chain did not finish is a broken chain
        if (r.k === 'pre' && r.g.length === 1 && r.g[0].type === 'complete') problems.push(`C ${profile} ${n}: chain misses ${r.g[0].q}`);
        if (r.k === 'level') problems.push(`C ${profile} ${n}: level ${r.v} not reached by its own requirement`);
      }
    }
    for (const [k, v] of Object.entries(gates)) notes.push(`C ${profile}: ${v.length} quests also need "${k}" (${v.slice(0, 4).join(', ')}${v.length > 4 ? ' …' : ''})`);
    return { profile, checked, msB, problems, notes };
  }
  window.__chains = { run };
})();
