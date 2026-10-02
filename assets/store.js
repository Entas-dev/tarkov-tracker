// Progress + settings persistence (per profile), in localStorage.
const KEY = 'eft-tracker-v1';
export const PROFILES = [
  { id: 'pvp', label: 'PMC', long: 'PMC (PvP)', gameMode: 'regular' },
  { id: 'seasonal', label: 'Seasonal', long: 'PMC Seasonal', gameMode: 'regular' },
  { id: 'pve', label: 'PvE', long: 'PvE', gameMode: 'pve' },
];

const blankProgress = () => ({
  quests: {}, active: {}, obj: {}, cnt: {},
  hideout: {}, hcnt: {},
  ch: {}, chObj: {}, chStart: {}, autoBy: {}, notOpen: {},
  ach: {}, bp: {}, bpDocs: {}, prestige: {}, prestigeManual: {},
  settings: { level: 1, faction: 'USEC', eod: false, unheard: false, ending: 'Savior', ll: {}, llAuto: true, goal: { story: true, kappa: true }, setupDone: false },
});

let state = load();
const listeners = new Set();

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }
  if (!s || typeof s !== 'object') s = {};
  s.active = s.active || 'pvp';
  s.profiles = s.profiles || {};
  for (const p of PROFILES) s.profiles[p.id] = merge(blankProgress(), s.profiles[p.id] || {});
  s.ui = s.ui || {};
  return s;
}
function merge(base, add) {
  for (const k of Object.keys(add)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && add[k] && typeof add[k] === 'object') base[k] = merge(base[k], add[k]);
    else base[k] = add[k];
  }
  return base;
}

let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); } }, 150);
}

// ---------- change history (per profile, small diffs, undo to any point) ----------
const TRACK = ['quests', 'active', 'obj', 'cnt', 'hideout', 'hcnt', 'ch', 'chObj', 'chStart', 'ach', 'bp', 'bpDocs', 'prestige', 'prestigeManual', 'autoBy', 'notOpen'];
const HIST_MAX = 60;
function snapMaps(p) {
  const o = {};
  for (const k of TRACK) o[k] = { ...(p[k] || {}) };
  o.level = p.settings.level; o.ll = { ...(p.settings.ll || {}) }; o.choices = { ...(p.settings.choices || {}) }; o.rep = { ...(p.settings.rep || {}) };
  return o;
}
function diffMaps(b, p) {
  const ch = {}; let n = 0;
  const cmp = (k, a, c) => { for (const key of new Set([...Object.keys(a), ...Object.keys(c)])) if (JSON.stringify(a[key]) !== JSON.stringify(c[key])) { (ch[k] = ch[k] || {})[key] = a[key] === undefined ? null : a[key]; if (k !== 'autoBy') n++; } };
  for (const k of TRACK) cmp(k, b[k], p[k] || {});
  cmp('$ll', b.ll, p.settings.ll || {});
  cmp('$choices', b.choices, p.settings.choices || {});
  cmp('$rep', b.rep, p.settings.rep || {});
  if (b.level !== p.settings.level) { ch.$level = b.level; n++; }
  return n ? { ch, n } : null;
}
function revert(p, ch) {
  for (const [k, vals] of Object.entries(ch)) {
    if (k === '$level') { p.settings.level = vals; continue; }
    const tgt = k === '$ll' ? (p.settings.ll = p.settings.ll || {}) : k === '$choices' ? (p.settings.choices = p.settings.choices || {}) : k === '$rep' ? (p.settings.rep = p.settings.rep || {}) : (p[k] = p[k] || {});
    for (const [key, v] of Object.entries(vals)) { if (v === null) delete tgt[key]; else tgt[key] = v; }
  }
}
let nextLabel = null;

export const store = {
  get active() { return state.active; },
  get profile() { return PROFILES.find(p => p.id === state.active); },
  get p() { return state.profiles[state.active]; },
  get ui() { return state.ui; },
  setActive(id) { state.active = id; save(); emit('profile'); },
  update(fn, reason = 'progress', label = null) {
    const p = this.p;
    const before = snapMaps(p);
    fn(p);
    const d = diffMaps(before, p);
    if (d) {
      const h = (state.hist = state.hist || {});
      const list = (h[state.active] = h[state.active] || []);
      list.unshift({ t: Date.now(), label: label || nextLabel || reason, n: d.n, ch: d.ch });
      if (list.length > HIST_MAX) list.length = HIST_MAX;
    }
    nextLabel = null;
    save(); emit(reason);
  },
  // label for the next update (actions that call model helpers)
  label(l) { nextLabel = l; },
  get history() { return (state.hist?.[state.active] || []); },
  // revert the newest entries up to and including index i
  undoTo(i = 0) {
    const list = state.hist?.[state.active] || [];
    if (!list.length || i < 0 || i >= list.length) return 0;
    const p = this.p;
    const done = list.splice(0, i + 1);
    for (const e of done) revert(p, e.ch);
    save(); emit('progress');
    return done.length;
  },
  setUi(k, v) { state.ui[k] = v; save(); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  notify(reason) { emit(reason); },
  exportJson() { return JSON.stringify({ app: 'eft-tracker', exportedAt: new Date().toISOString(), ...state }, null, 1); },
  importJson(txt) {
    const j = JSON.parse(txt);
    if (!j || !j.profiles) throw new Error('Not a tracker export file');
    const s = { active: j.active || 'pvp', profiles: {}, ui: state.ui };
    for (const p of PROFILES) s.profiles[p.id] = merge(blankProgress(), j.profiles[p.id] || {});
    state = s; save(); emit('profile');
  },
  resetProfile(id = state.active) { state.profiles[id] = blankProgress(); if (state.hist) state.hist[id] = []; if (state.ui.wiz) delete state.ui.wiz[id]; if (state.ui.srPlans) delete state.ui.srPlans[id]; save(); emit('profile'); },
};

function emit(reason) { for (const fn of listeners) { try { fn(reason); } catch (e) { console.error(e); } } }
