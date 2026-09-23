// Page parsers: wikitext -> structured data
import {
  infobox, section, sectionList, bulletTree, links, files, galleryFiles, plain, inlineHtml,
  tables, num, normTitle, templates, lead
} from './wikitext.js';

const FIR_TARGETS = new Set(['Found in raid']);
const ENDINGS = ['Savior', 'Debtor', 'Survivor', 'Fallen'];

function splitBr(s) {
  return String(s || '').split(/<\s*\/?\s*br\s*\/?\s*>|\n/i).map(x => x.trim()).filter(Boolean);
}

// ---------- tokens for counting items in objectives ----------
export function objectiveSeq(raw) {
  const seq = [];
  const re = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
  let last = 0, m;
  const pushNums = (txt) => {
    const t = plain(txt);
    const nm = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:×|x)?\s*$/i) || t.match(/(\d[\d,]*)(?!.*\d)/);
    if (nm) seq.push({ n: parseFloat(nm[1].replace(/,/g, '')) });
  };
  while ((m = re.exec(raw))) {
    pushNums(raw.slice(last, m.index));
    const target = normTitle(m[1]);
    if (!/^(File|Image|Category):/i.test(m[1])) seq.push({ l: target, label: plain(m[2] ?? m[1]) });
    last = m.index + m[0].length;
  }
  const tail = plain(raw.slice(last));
  const tm = tail.match(/:\s*(\d[\d,]*)\s*$/); // "Collect the required amount in RUB: 300,000,000"
  if (tm) seq.push({ n: parseFloat(tm[1].replace(/,/g, '')), tail: true });
  return seq;
}

function objectiveKind(text) {
  const t = text.toLowerCase().replace(/^\(optional\)\s*/, '');
  if (/^(hand over|turn in|give|deliver|bring the found|transfer)/.test(t)) return 'handover';
  if (/^(find|obtain|locate and obtain|collect|retrieve|get|acquire|buy|purchase|barter)/.test(t)) return 'find';
  if (/^(stash|plant|place|install|leave|hide|put)/.test(t)) return 'place';
  if (/^(mark)/.test(t)) return 'mark';
  if (/^(eliminate|kill|neutralize|locate and eliminate)/.test(t)) return 'kill';
  if (/^(survive|extract|escape)/.test(t)) return 'extract';
  if (/^(locate|visit|reach|check|find out|arrive|explore|inspect|access|gain access)/.test(t)) return 'visit';
  if (/^(modify|build|assemble)/.test(t)) return 'build';
  if (/^(use the transit|use)/.test(t)) return 'use';
  if (/^(talk|ask|tell|report|contact|wait|negotiate|confirm)/.test(t)) return 'talk';
  if (/^(sell)/.test(t)) return 'sell';
  if (/^(reach loyalty|reach \d|obtain level|keep the standing|stay on good terms|reach [\d.]+ reputation)/.test(t)) return 'rep';
  return 'other';
}

function makeObjective(node, idx, extra = {}) {
  const raw = node.raw;
  const text = plain(raw);
  const optional = /^\(\s*optional\s*\)/i.test(text) || /\(''Optional''\)|\(Optional\)/i.test(raw);
  const lk = links(raw);
  const fir = lk.some(l => FIR_TARGETS.has(l.target)) || /found in raid|<font[^>]*>\s*in raid/i.test(raw);
  return {
    id: 'o' + idx,
    html: inlineHtml(raw),
    text,
    depth: node.depth,
    optional,
    fir,
    kind: objectiveKind(text.replace(/^\(optional\)\s*/i, '')),
    seq: objectiveSeq(raw),
    maps: [],
    notes: (node.notes || []).map(n => inlineHtml(n)),
    ...extra,
  };
}

function flattenObjectives(nodes, out = [], ctx = { cond: null }, extra = {}) {
  for (const n of nodes) {
    if (n.text) {
      // bold line -> condition header
      const t = plain(n.raw);
      if (/\{\{\s*Seasonal change/i.test(n.raw)) {
        const s = seasonalNotes(n.raw);
        if (out.length) (out[out.length - 1].seasonal = out[out.length - 1].seasonal || []).push(...s);
        else (ctx.pending = ctx.pending || []).push(...s);
        continue;
      }
      if (/\{\{/.test(n.raw) && !t) continue;
      if (t) ctx.cond = inlineHtml(n.raw.replace(/^'''|'''$/g, ''));
      continue;
    }
    const o = makeObjective(n, out.length + 1, { cond: ctx.cond, ...extra });
    if (/\{\{\s*Seasonal change/i.test(n.raw)) o.seasonal = seasonalNotes(n.raw);
    out.push(o);
    if (n.children?.length) flattenObjectives(n.children, out, { ...ctx, parent: o.id }, extra);
  }
  for (const o of out) if (o.depth > 1 && !o.parent) {
    // assign parent: nearest previous objective with smaller depth
    const i = out.indexOf(o);
    for (let j = i - 1; j >= 0; j--) if (out[j].depth < o.depth) { o.parent = out[j].id; break; }
  }
  return out;
}

export function seasonalNotes(raw) {
  return templates(raw).filter(t => /^Seasonal change/i.test(t.name)).map(t => ({ html: inlineHtml(t.positional[0] || ''), text: plain(t.positional[0] || '') }));
}

function relatedItemsTables(wt) {
  const out = [];
  for (const tb of tables(wt)) {
    const all = tb.rows.flat().map(c => plain(c.raw)).join(' ');
    if (!/Related Quest Items|Item name/i.test(all)) continue;
    // find header row with Item name
    let hi = tb.rows.findIndex(r => r.some(c => /item name|^item$/i.test(plain(c.raw))));
    if (hi < 0) continue;
    const head = tb.rows[hi].map(c => plain(c.raw).toLowerCase());
    const col = (re) => head.findIndex(h => re.test(h));
    const ci = col(/item name|^item$/), ca = col(/amount/), cr = col(/requirement/), cf = col(/in raid/), cn = col(/notes/);
    for (const r of tb.rows.slice(hi + 1)) {
      if (r.length < 2) continue;
      const itemCell = r[ci]?.raw || '';
      const lk = links(itemCell);
      const firTxt = plain(r[cf]?.raw || '');
      out.push({
        item: lk[0]?.target || null,
        label: plain(itemCell),
        html: inlineHtml(itemCell),
        amount: num(r[ca]?.raw),
        req: plain(r[cr]?.raw || ''),
        fir: /yes/i.test(firTxt) ? true : /no/i.test(firTxt) ? false : null,
        notes: r[cn] ? inlineHtml(r[cn].raw) : '',
      });
    }
  }
  return out;
}

function parsePrev(raw, self) {
  // returns groups: [[{q,type,delay}], ...] ; alternatives within a group are OR
  const groups = [];
  const lines = splitBr(raw);
  let orNext = false;
  for (const line of lines) {
    if (/^or$/i.test(plain(line))) { orNext = true; continue; }
    const lk = links(line).filter(l => l.target !== self);
    if (!lk.length) continue;
    const t = plain(line);
    const type = /^accept/i.test(t) ? 'accept' : /^fail/i.test(t) ? 'fail' : 'complete';
    const delay = (t.match(/\(\+([^)]+)\)/) || [])[1] || null;
    const alts = lk.map(l => ({ q: l.target, type, delay }));
    if (orNext && groups.length) groups[groups.length - 1].push(...alts);
    else groups.push(alts);
    orNext = false;
  }
  return groups;
}

export function parseQuest(title, wt, meta = {}) {
  const ib = infobox(wt, /^Infobox quest/i) || {};
  const giver = links(ib['given by'])[0]?.target || plain(ib['given by']) || null;
  const q = {
    name: title,
    trader: giver,
    maps: links(ib.location).map(l => l.target).filter(Boolean),
    locationHtml: inlineHtml(ib.location || ''),
    image: normTitle(ib.image || '') || null,
    icon: normTitle(ib.icon || '') || null,
    kappa: null,
    prereq: parsePrev(ib.previous, title),
    leadsTo: links(ib['leads to']).map(l => l.target).filter(t => t !== title),
    minLevel: null,
    ll: null,
    faction: null,
    edition: null,
    mode: null,
    reqHtml: [],
    seasonal: [],
    objectives: [],
    rewardsHtml: [],
    questItems: [],
    event: meta.cats?.has?.('Event content') || false,
    community: meta.cats?.has?.('Community Goal Quests') || false,
    choice: meta.tpls?.has?.('Multiple choice') || false,
    hasGuide: /==\s*Guide\s*==/i.test(wt),
    alts: [],
  };
  if (q.choice) q.alts = links(ib.related).map(l => l.target).filter(t => t !== title);
  const kr = plain(ib.reqkappa || '');
  q.kappa = /^yes/i.test(kr) ? 'yes' : /subsequent/i.test(kr) ? 'sub' : /^no/i.test(kr) ? 'no' : null;

  // Requirements
  const reqBody = section(wt, 'Requirements') || '';
  q.seasonal.push(...seasonalNotes(reqBody).map(n => ({ ...n, where: 'requirements' })));
  const reqTree = bulletTree(reqBody.replace(/\{\{\s*Seasonal change[\s\S]*?\}\}/gi, ''));
  const walkReq = (nodes, parentText = '') => {
    for (const n of nodes) {
      const t = plain(n.raw);
      if (!t || /^File:/i.test(n.raw) || /gallery/i.test(n.raw)) continue;
      q.reqHtml.push({ html: inlineHtml(n.raw), depth: n.depth || 1 });
      let m;
      if ((m = t.match(/(?:must be|reach)\s+(?:pmc\s+)?level\s+(\d+)/i)) && !/loyalty/i.test(t)) q.minLevel = Math.max(q.minLevel || 0, +m[1]);
      else if ((m = t.match(/level\s+(\d+)\s+to start/i))) q.minLevel = Math.max(q.minLevel || 0, +m[1]);
      if ((m = t.match(/loyalty level\s+(\d+)(?:\s+with\s+(.+?))?(?:\s+to|\.|$)/i)) || (m = t.match(/obtain level\s+(\d+)\s+loyalty with\s+(.+?)(?:\.|$)/i))) {
        const tl = links(n.raw).map(l => l.target);
        if (tl.length <= 1) q.ll = { trader: tl[0] || giver, level: +m[1] };
      }
      if ((m = t.match(/only obtainable by (BEAR|USEC)/i))) q.faction = m[1].toUpperCase();
      if (/Edge of Darkness/i.test(t)) q.edition = 'EOD';
      if (/Unheard/i.test(t) && /edition/i.test(t)) q.edition = q.edition || 'Unheard';
      if (/Seasonal mode/i.test(t) && /must be playing/i.test(t)) q.mode = 'seasonal';
      if (/PvE/i.test(t) && /must be playing/i.test(t)) q.mode = 'pve';
      if (/^must (?:complete|finish)\s/i.test(t) || /^complete the quest/i.test(t) || /unlocks .* after completion of/i.test(t) || /^Complete\s*\[\[/i.test(n.raw)) {
        const delay = (t.match(/unlocks\s+(.+?)\s+after/i) || [])[1] || null;
        for (const l of links(n.raw)) if (l.target !== title && !q.prereq.flat().some(p => p.q === l.target)) q.prereq.push([{ q: l.target, type: 'complete', delay, fromReq: true }]);
      }
      if (/^must accept/i.test(t)) {
        const lk = links(n.raw); const target = lk[lk.length - 1]?.target;
        if (target && !q.prereq.flat().some(p => p.q === target)) q.prereq.push([{ q: target, type: 'accept' }]);
      }
      if (/^complete the quests:?$/i.test(t) && n.children) {
        for (const c of n.children) for (const l of links(c.raw)) if (!q.prereq.flat().some(p => p.q === l.target)) q.prereq.push([{ q: l.target, type: 'complete', fromReq: true }]);
      }
      if (n.children?.length) walkReq(n.children, t);
    }
  };
  walkReq(reqTree);
  // seasonal structural changes
  for (const s of q.seasonal) {
    const lk = links(s.html.replace(/<a class="wl" data-t="([^"]+)">([^<]*)<\/a>/g, '[[$1|$2]]'));
    const m = s.text.match(/without completing\s+(.+?)[.]?$/i);
    if (m) s.removePrereq = lk.filter(l => s.text.indexOf(l.label) > s.text.indexOf('without')).map(l => l.target);
    const m2 = s.text.match(/follows directly after\s+(.+?)\s+without/i);
    if (m2) s.addPrereq = lk.filter(l => m2[1].includes(l.label)).map(l => l.target);
  }

  // Objectives
  const objBody = section(wt, 'Objectives') || '';
  q.seasonal.push(...seasonalNotes(objBody).map(n => ({ ...n, where: 'objectives' })));
  q.objectives = flattenObjectives(bulletTree(objBody));
  // Rewards
  const rewBody = section(wt, 'Rewards') || '';
  for (const n of bulletTree(rewBody)) {
    if (n.text) continue;
    q.rewardsHtml.push({ html: inlineHtml(n.raw), sub: (n.children || []).map(c => inlineHtml(c.raw)) });
  }
  q.seasonal.push(...seasonalNotes(rewBody).map(n => ({ ...n, where: 'rewards' })));
  // Related quest items (guide tables)
  q.questItems = relatedItemsTables(section(wt, 'Guide') || '');
  // any remaining seasonal notes elsewhere (lead/guide)
  const seen = new Set(q.seasonal.map(s => s.text));
  for (const s of seasonalNotes(wt)) if (!seen.has(s.text)) q.seasonal.push({ ...s, where: 'other' });
  return q;
}

// ---------- Story chapters ----------
export function parseStoryChapter(title, wt) {
  const ib = infobox(wt, /^Infobox/i) || {};
  const ch = {
    name: title,
    image: normTitle(ib.image || '') || null,
    icon: normTitle(ib.icon || '') || null,
    prereq: parsePrev(ib.previous, title),
    leadsTo: links(ib['leads to']).map(l => l.target),
    maps: links(ib.location).map(l => l.target),
    reqHtml: [],
    descHtml: '',
    objectives: [],
    rewardsHtml: [],
    endingRewards: {},
  };
  const desc = section(wt, 'Description') || '';
  const qt = templates(desc).find(t => /^quote/i.test(t.name));
  if (qt) ch.descHtml = inlineHtml(qt.positional[0] || '');
  const req = section(wt, 'Requirements') || '';
  ch.reqHtml = req.split('\n').map(l => l.replace(/^\*+\s*/, '').trim()).filter(Boolean).map(l => inlineHtml(l));
  const secs = sectionList(wt);
  const objSec = secs.find(s => s.level === 2 && s.titleText.toLowerCase() === 'objectives');
  if (objSec) {
    // direct body (before first subsection) = common objectives
    const out = [];
    const flat = (body, extra) => {
      const list = flattenObjectives(bulletTree(body), [], { cond: null }, extra);
      for (const o of list) { o.id = 'o' + (out.length + 1); out.push(o); }
      // fix parent ids after renumber
    };
    flat(objSec.direct, { section: null, endings: null });
    const subs = secs.filter(s => s.start > objSec.start && s.start < objSec.start + objSec.body.length + 50 && s.level === 3);
    for (const s of subs) {
      const endings = files(s.title).map(f => (f.file.match(/^(Savior|Debtor|Survivor|Fallen) icon/i) || [])[1]).filter(Boolean);
      flat(s.direct, { section: inlineHtml(s.title), sectionText: plain(s.title), endings: endings.length ? endings : null });
    }
    // recompute parents by order/depth within same section
    for (let i = 0; i < out.length; i++) {
      const o = out[i]; o.parent = null;
      if (o.depth > 1) for (let j = i - 1; j >= 0; j--) { if (out[j].section !== o.section) break; if (out[j].depth < o.depth) { o.parent = out[j].id; break; } }
    }
    ch.objectives = out;
  }
  const rew = secs.find(s => s.level === 2 && s.titleText.toLowerCase() === 'rewards');
  if (rew) {
    for (const n of bulletTree(rew.direct)) if (!n.text) ch.rewardsHtml.push({ html: inlineHtml(n.raw), sub: (n.children || []).map(c => inlineHtml(c.raw)) });
    for (const s of secs.filter(s => s.level === 3 && s.start > rew.start && s.start < rew.start + rew.body.length + 10)) {
      const e = (s.titleText.match(/^(Savior|Debtor|Survivor|Fallen)/i) || [])[1];
      const items = bulletTree(s.direct).filter(n => !n.text).map(n => ({ html: inlineHtml(n.raw), sub: (n.children || []).map(c => inlineHtml(c.raw)) }));
      if (e) ch.endingRewards[e] = items; else ch.rewardsHtml.push(...items);
    }
  }
  ch.hasGuide = /==\s*Guide\s*==/i.test(wt);
  return ch;
}

export function parseEndings(wt) {
  const out = {};
  for (const s of sectionList(wt)) {
    if (s.level !== 2 || !ENDINGS.includes(s.titleText)) continue;
    const qt = templates(s.body).find(t => /^quote/i.test(t.name));
    const rew = sectionList(s.body).find(x => /rewards/i.test(x.titleText));
    const icon = files(s.body).find(f => /icon/i.test(f.file))?.file || `${s.titleText} icon.png`;
    out[s.titleText] = {
      name: s.titleText,
      icon,
      quoteHtml: qt ? inlineHtml(qt.positional[0] || '') : '',
      rewardsHtml: rew ? bulletTree(rew.body).filter(n => !n.text).map(n => inlineHtml(n.raw)) : [],
    };
  }
  const img = files(wt).find(f => /flowchart/i.test(f.file));
  return { endings: out, flowchart: img?.file || null };
}

// ---------- Traders ----------
export function parseTrader(title, wt) {
  const ib = infobox(wt, /^Infobox/i) || {};
  const t = { name: title, fullName: plain(ib['full name'] || ''), image: normTitle(ib.image || '') || null, ll: [], notesHtml: [], currencies: plain(ib.currencies || '') };
  const llSec = section(wt, 'Loyalty Level Requirements') || section(wt, 'Loyalty levels') || '';
  for (const tb of tables(llSec)) {
    const head = tb.rows[0]?.map(c => plain(c.raw).toLowerCase()) || [];
    for (const r of tb.rows.slice(1)) {
      const cells = r.map(c => plain(c.raw));
      const rec = { level: num(cells[0]) };
      head.forEach((h, i) => {
        if (/required lvl|level req|pmc level|required level/.test(h)) rec.pmcLevel = num(cells[i]);
        else if (/rep/.test(h)) rec.rep = num(cells[i]);
        else if (/spen|sales|money/.test(h)) rec.spend = cells[i];
      });
      if (rec.level) t.ll.push(rec);
    }
  }
  const notes = section(wt, 'Notes') || '';
  t.notesHtml = bulletTree(notes).filter(n => !n.text).map(n => inlineHtml(n.raw));
  return t;
}

// ---------- Hideout ----------
export function parseHideout(wt) {
  const modSec = section(wt, 'Modules') || '';
  const portraits = {};
  for (const m of modSec.matchAll(/\[\[File:([^\]|]+?)\|[^\]]*\]\]\s*([^<\n]+?)\s*<\/div>/g)) portraits[m[2].trim()] = normTitle(m[1]);
  const modules = [];
  for (const tb of tables(modSec)) {
    const title = tb.rows[0]?.[0]?.raw || '';
    const name = plain(title.split(/<br\s*\/?>/i)[0]);
    if (!name) continue;
    const note = title.split(/<br\s*\/?>/i).slice(1).join(' ');
    const mod = { name, portrait: portraits[name] || null, noteHtml: inlineHtml(note), levels: [] };
    let head = null;
    for (const r of tb.rows.slice(1)) {
      const cells = r.map(c => plain(c.raw));
      if (cells.some(c => /^requirements/i.test(c))) { head = cells.map(c => c.toLowerCase()); continue; }
      if (!head) continue;
      const lvl = num(cells[0]);
      if (lvl == null) continue;
      const ri = head.findIndex(h => /requirement/.test(h)), fi = head.findIndex(h => /function/.test(h)), ti = head.findIndex(h => /time/.test(h));
      const reqRaw = r[ri]?.raw || '';
      const L = { level: lvl, items: [], modules: [], traders: [], skills: [], other: [], functionsHtml: [], time: cells[ti] || '' };
      let optionalTask = false;
      for (const n of bulletTree(reqRaw)) {
        if (n.text) { if (plain(n.raw)) L.other.push(inlineHtml(n.raw)); continue; }
        const t = plain(n.raw);
        const lk = links(n.raw);
        let m;
        if (/^optional task/i.test(t)) { optionalTask = true; L.other.push(inlineHtml(n.raw)); continue; }
        if (optionalTask && !lk.length) { L.other.push(inlineHtml(n.raw)); continue; }
        if (lk.length === 1 && lk[0].target !== 'Hideout' && !/^[\d,]+/.test(t) && (m = t.match(/level\s+(\d+)/i)) && !/loyalty/i.test(t)) { L.skills.push({ name: lk[0].target, level: +m[1] }); continue; }
        if (lk.some(l => l.target === 'Hideout' && /modules/i.test(l.anchor)) || (lk[0]?.target === 'Hideout')) {
          const lbl = lk.find(l => l.target === 'Hideout')?.label || '';
          m = t.match(/level\s+(\d+)/i);
          L.modules.push({ name: lbl, level: m ? +m[1] : 1 });
        } else if ((m = t.match(/loyalty level\s+(\d+)/i)) || (m = t.match(/\bLL\s*(\d+)/))) {
          L.traders.push({ name: lk[0]?.target || t, level: +m[1] });
        } else if ((m = t.match(/^level\s+(\d+)\s+(.+)$/i)) && lk.length) {
          L.skills.push({ name: lk[0].target, level: +m[1] });
        } else if (lk.length && (m = t.match(/^([\d,]+)\s*(?:x|×)?\s*/i))) {
          const item = lk.find(l => !FIR_TARGETS.has(l.target));
          L.items.push({ item: item?.target, label: item?.label, count: num(m[1]), fir: lk.some(l => FIR_TARGETS.has(l.target)) || /found in raid/i.test(t), optional: optionalTask || undefined });
        } else if (lk.length && /^\[\[/.test(n.raw.trim())) {
          const item = lk[0];
          L.items.push({ item: item.target, label: item.label, count: 1, fir: /in raid/i.test(t), optional: optionalTask || undefined });
        } else L.other.push(inlineHtml(n.raw));
      }
      for (const n of bulletTree(r[fi]?.raw || '')) L.functionsHtml.push(inlineHtml(n.raw));
      mod.levels.push(L);
    }
    modules.push(mod);
  }
  const seasonal = seasonalNotes(modSec);
  return { modules, seasonal };
}

// ---------- Prestige ----------
export function parsePrestige(wt) {
  const cond = section(wt, 'Conditions') || '';
  const levels = [];
  const tb = tables(cond)[0];
  if (tb) {
    const head = tb.rows[0].map(c => plain(c.raw).toLowerCase());
    const col = (re) => head.findIndex(h => re.test(h));
    const cL = col(/pmc level/), cQ = col(/quests/), cS = col(/story/), cK = col(/skills/), cH = col(/hideout/), cI = col(/items/);
    for (const r of tb.rows.slice(1)) {
      const lv = num(r[0]?.raw);
      if (lv == null) continue;
      const bl = (i) => (r[i] ? bulletTree(r[i].raw).filter(n => !n.text || plain(n.raw)).map(n => ({ html: inlineHtml(n.raw), text: plain(n.raw), links: links(n.raw).map(l => l.target) })).filter(x => x.text && !/^N\/A$/i.test(x.text)) : []);
      levels.push({
        level: lv,
        pmcLevel: num(r[cL]?.raw),
        quests: bl(cQ),
        story: bl(cS),
        skills: bl(cK).map(s => ({ ...s, skill: s.links[0] || null, level: num(s.text.match(/level\s+(\d+)/i)?.[1]) })),
        hideout: bl(cH).map(h => { const m = h.text.match(/^(.+?)\s+level\s+(\d+)/i); return { ...h, module: m ? m[1].trim() : h.text, level: m ? +m[2] : 1 }; }),
        itemsHtml: r[cI] ? inlineHtml(r[cI].raw) : '',
        itemsText: r[cI] ? plain(r[cI].raw) : '',
        rewards: [],
        icon: null,
      });
    }
  }
  for (const s of sectionList(wt)) {
    const m = s.titleText.match(/^Prestige\s+(\d+)/);
    if (!m || s.level !== 3) continue;
    const L = levels.find(l => l.level === +m[1]);
    if (!L) continue;
    L.icon = files(s.body).find(f => /icon/i.test(f.file))?.file || null;
    L.rewards = bulletTree(s.body).filter(n => !n.text).map(n => inlineHtml(n.raw));
  }
  return { introHtml: inlineHtml((lead(wt).split('\n')[0] || '').replace(/\{\{PAGENAME\}\}/g, 'Prestige')), levels };
}

// ---------- BattlePass ----------
export function parseBattlePass(wt) {
  const secs = sectionList(wt);
  const season = secs.find(s => s.level === 2 && /season/i.test(s.titleText));
  const body = season?.body || wt;
  const out = { season: season ? plain(season.title) : 'BattlePass', start: null, end: null, levelsCount: null, docTypes: [], limitsHtml: [], levels: [], introHtml: '' };
  const m = plain(body).match(/started on ([A-Z][a-z]+ \d{1,2}, \d{4}) and ends on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (m) { out.start = new Date(m[1] + ' UTC').toISOString(); out.end = new Date(m[2] + ' UTC').toISOString(); }
  const lc = plain(body).match(/contains (\d+) free levels/); if (lc) out.levelsCount = +lc[1];
  const prog = secs.find(s => s.level === 3 && /progression/i.test(s.titleText));
  if (prog) {
    out.introHtml = prog.direct.split('\n').filter(l => l.trim() && !/^\*|^\[\[File/.test(l.trim())).map(l => inlineHtml(l)).join('<br>');
    for (const n of bulletTree(prog.direct)) {
      if (n.text) continue;
      const lk = links(n.raw);
      if (!lk.length) continue;
      out.docTypes.push({ name: lk[0].target, maps: lk.slice(1).map(l => l.target) });
    }
  }
  const lim = secs.find(s => s.level === 3 && /limits/i.test(s.titleText));
  if (lim) out.limitsHtml = lim.direct.split('\n').filter(l => l.trim()).map(l => inlineHtml(l.replace(/^\*+\s*/, '')));
  const rew = secs.find(s => s.level === 3 && /rewards/i.test(s.titleText));
  if (rew) {
    out.rewardsIntroHtml = rew.direct.split('{|')[0].split('\n').filter(l => l.trim()).map(l => inlineHtml(l)).join('<br>');
    const tb = tables(rew.direct)[0];
    if (tb) {
      let page = 1;
      for (const r of tb.rows) {
        if (r.length < 4) continue;
        const lvRaw = r[0].raw;
        const lv = num(lvRaw);
        if (lv == null) continue;
        const pm = plain(lvRaw).match(/Page\s+(\d+)/i); if (pm) page = +pm[1];
        const icon = files(r[1]?.raw || '')[0]?.file || null;
        const nameCell = r[2]?.raw || '';
        out.levels.push({ level: lv, page, icon, html: inlineHtml(nameCell), name: plain(nameCell), link: links(nameCell)[0]?.target || null, type: plain(r[3]?.raw || ''), price: num(r[4]?.raw) });
      }
    }
  }
  return out;
}

// ---------- Achievements ----------
export function parseAchievements(wt) {
  const out = [];
  for (const s of sectionList(wt)) {
    if (s.level !== 2) continue;
    const sec = s.titleText;
    if (/trivia/i.test(sec)) continue;
    for (const tb of tables(s.direct)) {
      const hi = tb.rows.findIndex(r => r.some(c => /^name$/i.test(plain(c.raw))));
      if (hi < 0) continue;
      const head = tb.rows[hi].map(c => plain(c.raw).toLowerCase());
      const col = (re) => head.findIndex(h => re.test(h));
      const cI = col(/icon/), cN = col(/^name$/), cD = col(/description/), cR = col(/reward/), cH = col(/hidden/), cRa = col(/rarity/);
      for (const r of tb.rows.slice(hi + 1)) {
        const name = plain(r[cN]?.raw || '');
        if (!name) continue;
        out.push({
          name, section: sec,
          icon: files(r[cI]?.raw || '')[0]?.file || null,
          descHtml: inlineHtml(r[cD]?.raw || ''),
          desc: plain(r[cD]?.raw || ''),
          rewardHtml: inlineHtml(r[cR]?.raw || ''),
          hidden: /yes/i.test(plain(r[cH]?.raw || '')),
          rarity: plain(r[cRa]?.raw || ''),
        });
      }
    }
  }
  return out;
}

// ---------- Events ----------
export function parseEvents(wt) {
  const secs = sectionList(wt).filter(s => s.level === 2);
  const pastIdx = wt.indexOf('This section describes past events');
  const out = [];
  for (const s of secs) {
    const m = s.titleText.match(/^(.*?)\s*\(([^)]*\d{4})\)\s*$/);
    const title = m ? m[1] : s.titleText;
    const dateTxt = m ? m[2] : '';
    let date = null;
    const dm = dateTxt.match(/(\d{1,2})(?:-\d{1,2})?\s+([A-Z][a-z]+)\s+(\d{4})/);
    if (dm) { const d = new Date(`${dm[2]} ${dm[1]}, ${dm[3]} UTC`); if (!isNaN(d)) date = d.toISOString(); }
    const active = pastIdx > 0 && s.start < pastIdx;
    const img = galleryFiles(s.body)[0]?.file || files(s.body)[0]?.file || null;
    const qt = templates(s.body).find(t => /^quote/i.test(t.name));
    const changes = bulletTree(s.body.replace(/\{\|[\s\S]*?\|\}/g, '')).filter(n => !n.text).map(n => inlineHtml(n.raw));
    const quests = [];
    for (const n of bulletTree(s.body)) { const t = plain(n.raw); if (/^Quest .* has been added/i.test(t)) quests.push(...links(n.raw).map(l => l.target)); }
    out.push({ title: plain(title), dateText: dateTxt, date, active, image: img, quoteHtml: qt ? inlineHtml(qt.positional[0] || '') : '', changesHtml: changes.slice(0, 30), quests });
    if (out.length >= 12) break;
  }
  return out;
}

export function parseSeasons(wt) {
  const secs = sectionList(wt);
  const s1 = secs.find(s => s.level === 2);
  if (!s1) return null;
  const txt = plain(s1.direct);
  const m = txt.match(/started on ([A-Z][a-z]+ \d{1,2}, \d{4}) and ends on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  const diff = secs.find(s => s.level === 3 && /differences/i.test(s.titleText));
  return {
    name: plain(s1.title),
    start: m ? new Date(m[1] + ' UTC').toISOString() : null,
    end: m ? new Date(m[2] + ' UTC').toISOString() : null,
    differencesHtml: diff ? bulletTree(diff.direct).filter(n => !n.text).map(n => inlineHtml(n.raw)) : [],
  };
}

// ---------- linked pages (items/maps/npcs) ----------
const NON_ITEM = new Set(['quest', 'character', 'location', 'boss', 'npc', 'faction', 'skill', 'story chapter']);
export function classifyPage(title, wt) {
  const tps = templates(wt);
  const ib = tps.find(t => /^Infobox/i.test(t.name));
  if (!ib) return { kind: /^#REDIRECT/i.test(wt) ? 'redirect' : 'page' };
  const type = ib.name.replace(/^Infobox\s*/i, '').trim().toLowerCase();
  const p = ib.params;
  if (type === 'location') return { kind: 'map', image: normTitle(p.image || '') || null };
  if (NON_ITEM.has(type)) return { kind: type === 'character' ? 'npc' : type, image: normTitle(p.image || '') || null };
  return {
    kind: 'item',
    infobox: type,
    icon: normTitle(p.icon || '') || null,
    image: normTitle(p.image || '') || null,
    grid: p.grid || null,
    itemType: plain(p.type || ''),
    node: (p.node || '').trim() || null,
  };
}
