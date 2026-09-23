// Seasonal modifiers ("perks"): selection, lookup and effects that the tracker takes into account.
import { store } from './store.js';
import { D, P, isSeasonal } from './model.js';
import { esc, attr, icon, img, itemChip, qlink } from './ui.js';
import { openPanel } from './components.js';

// Effects the tracker actually applies. Everything else is shown for reference.
const EFFECTS = {
  'Kappa Protocol': { kappa: true, note: 'You already own Secure container Kappa – Collector is only needed for its other rewards.' },
  'Hercules': { skills: { Strength: 15, Endurance: 15 }, note: 'Strength/Endurance requirements up to level 15 count as met.' },
  'Average': { allSkills: 25, cap: 25, note: 'All skills are 25 and cannot rise: skill requirements above 25 are impossible.' },
  'Incompetent': { cap: 30, note: 'Skills cap at 30: skill requirements above 30 are impossible.' },
  'The Tarkov Shooter': { skills: { 'Bolt-action Rifles': 25 } },
  'Handyman': { skills: { Crafting: 51 } },
  'No Flea Market': { noFlea: true, note: 'Flea market disabled: every needed item must be looted, crafted, bartered or bought from traders.' },
  'Broken Secure Container': { brokenContainer: true, note: 'Your secure container only holds cash, keys, dogtags, special equipment and BattlePass documents – quest items must be carried out in your rig/backpack.' },
  'Personality Vacuum': { noCharisma: true, note: 'Charisma cannot increase; all trader items cost 20% more.' },
  'Third Leg': { note: 'Therapist is 5% cheaper.' },
  'Allergic': { note: 'Check which 3 provisions/meds you are allergic to (practice mode) before relying on them.' },
};

export function modifiers() { return D.season?.modifiers || { common: [], positive: [], negative: [] }; }
export function activePerks(p = P()) {
  if (store.active !== 'seasonal') return [];
  const sel = p.settings.perks || {};
  const m = modifiers();
  return [...m.common.map(x => ({ ...x, group: 'common' })), ...m.positive.filter(x => sel[x.name]).map(x => ({ ...x, group: 'positive' })), ...m.negative.filter(x => sel[x.name]).map(x => ({ ...x, group: 'negative' }))];
}
export function perkFlags(p = P()) {
  const f = { skills: {}, cap: null, allSkills: null, notes: [] };
  for (const m of activePerks(p)) {
    const e = EFFECTS[m.name];
    if (!e) continue;
    if (e.kappa) f.kappa = m.name;
    if (e.noFlea) f.noFlea = m.name;
    if (e.brokenContainer) f.brokenContainer = m.name;
    if (e.noCharisma) f.noCharisma = m.name;
    if (e.allSkills) f.allSkills = e.allSkills;
    if (e.cap) f.cap = f.cap == null ? e.cap : Math.min(f.cap, e.cap);
    for (const [k, v] of Object.entries(e.skills || {})) f.skills[k.toLowerCase()] = Math.max(f.skills[k.toLowerCase()] || 0, v);
    if (e.note && m.group !== 'common') f.notes.push({ name: m.name, note: e.note });
  }
  return f;
}
// returns 'ok' | 'impossible' | null (unknown) for a skill requirement
export function skillReqStatus(skill, level, p = P()) {
  if (store.active !== 'seasonal') return null;
  const f = perkFlags(p);
  if (f.cap != null && level > f.cap) return 'impossible';
  const start = Math.max(f.skills[String(skill).toLowerCase()] || 0, f.allSkills || 0);
  if (start && start >= level) return 'ok';
  return null;
}

export function perkPoints(p = P()) {
  const sel = p.settings.perks || {};
  const m = modifiers();
  let spent = 0, gained = 0;
  for (const x of m.positive) if (sel[x.name]) spent += Math.abs(x.points || 0);
  for (const x of m.negative) if (sel[x.name]) gained += Math.abs(x.points || 0);
  return { spent, gained, net: gained - spent };
}

export function perksBannerHtml() {
  if (!isSeasonal() || !D.season?.modifiers) return '';
  const act = activePerks().filter(m => m.group !== 'common');
  const pts = perkPoints();
  return `<div class="perk-row"><span class="perk-lbl">Your perks</span>${act.length ? act.map(m => `<span class="perk-chip ${m.group}" data-tip="${attr(m.effect)}">${img(m.img, '', 'perk-ic')}${esc(m.name)}</span>`).join('') : '<span class="muted small">none selected</span>'}
    <span class="muted small">${pts.spent} pts spent · ${pts.gained} pts gained</span>
    <button class="btn btn-s" data-act="perks">${icon('gear')} Choose / look up perks</button></div>`;
}

export function perksNotesHtml(kind) {
  if (!isSeasonal()) return '';
  const f = perkFlags();
  const out = [];
  if (kind === 'kappa' && f.kappa) out.push(EFFECTS['Kappa Protocol'].note);
  if (kind === 'items' && f.noFlea) out.push(EFFECTS['No Flea Market'].note);
  if (kind === 'items' && f.brokenContainer) out.push(EFFECTS['Broken Secure Container'].note);
  if (kind === 'traders' && f.noCharisma) out.push(EFFECTS['Personality Vacuum'].note);
  if (kind === 'traders' && activePerks().some(m => m.name === 'Third Leg')) out.push(EFFECTS['Third Leg'].note);
  if (kind === 'hideout') { if (f.cap != null) out.push(`Skill cap ${f.cap} from your perks – higher skill requirements are marked impossible.`); if (Object.keys(f.skills).length || f.allSkills) out.push('Skill requirements covered by your perks are marked as met.'); }
  return out.map(n => `<div class="notice perk-notice">${icon('flag')}<div>${esc(n)}</div></div>`).join('');
}

export function openPerks() {
  const p = P();
  const sel = p.settings.perks || {};
  const m = modifiers();
  const pts = perkPoints(p);
  const row = (x, group) => `<label class="perk ${sel[x.name] || group === 'common' ? 'on' : ''}">
      ${group === 'common' ? `<span class="perk-cb fixed" title="Always active">${icon('check')}</span>` : `<input type="checkbox" data-perk="${attr(x.name)}" ${sel[x.name] ? 'checked' : ''} aria-label="${attr(x.name)}">`}
      ${img(x.img, x.name, 'perk-big')}
      <span class="perk-b"><b>${esc(x.name)}</b>${x.points != null ? ` <span class="perk-pts ${x.points < 0 ? 'neg' : 'pos'}">${x.points > 0 ? '+' : ''}${x.points}</span>` : ''}<span class="small">${x.effectHtml}</span>${x.notesHtml ? `<span class="small muted">${x.notesHtml}</span>` : ''}${EFFECTS[x.name]?.note ? `<span class="small perk-eff">${icon('check')} Tracker: ${esc(EFFECTS[x.name].note)}</span>` : ''}</span>
    </label>`;
  const rewards = D.season?.rewards || [];
  const html = `
    <p class="small muted">Tick the personal modifiers you picked for your seasonal character. Common modifiers always apply. Effects that change requirements (skills, Kappa, flea market, container) are applied in the other tabs.</p>
    <div class="perk-sum"><b>${pts.spent}</b> points spent on positive · <b>${pts.gained}</b> gained from negative · net <b>${pts.net >= 0 ? '+' : ''}${pts.net}</b></div>
    <div class="sub-h">Common modifiers (always active)</div><div class="perk-list">${m.common.map(x => row(x, 'common')).join('')}</div>
    <div class="sub-h">Positive modifiers (cost points)</div><div class="perk-list">${m.positive.map(x => row(x, 'positive')).join('')}</div>
    <div class="sub-h">Negative modifiers (give points)</div><div class="perk-list">${m.negative.map(x => row(x, 'negative')).join('')}</div>
    ${rewards.length ? `<div class="sub-h">Seasonal rewards</div><table class="tbl"><thead><tr><th>Reward</th><th>Type</th><th>Level</th><th>Quest</th></tr></thead><tbody>${rewards.map(r => `<tr><td><span class="rw">${img(r.img, r.name, 'perk-ic')}${esc(r.name)}</span></td><td>${esc(r.type)}</td><td>${r.level ?? '–'}</td><td>${D.quests[r.quest] ? qlink(r.quest) : esc(r.quest)}</td></tr>`).join('')}</tbody></table>` : ''}
    <p class="small muted">Source: <a href="https://escapefromtarkov.fandom.com/wiki/Seasons" target="_blank" rel="noopener">Seasons (wiki)</a></p>`;
  openPanel(`${icon('flag', 'dr-ic')}<span>Season perks</span>`, html);
}

export function togglePerk(name, on) {
  store.update(p => { p.settings.perks = p.settings.perks || {}; if (on) p.settings.perks[name] = 1; else delete p.settings.perks[name]; }, 'perks');
}
