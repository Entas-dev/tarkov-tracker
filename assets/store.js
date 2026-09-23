// Progress + settings persistence (per profile), in localStorage.
const KEY = 'eft-tracker-v1';
export const PROFILES = [
  { id: 'pvp', label: 'PMC', long: 'PMC (PvP)', gameMode: 'regular' },
  { id: 'seasonal', label: 'Seasonal', long: 'PMC Seasonal', gameMode: 'regular' },
  { id: 'pve', label: 'PvE', long: 'PvE', gameMode: 'pve' },
];

const blankProgress = () => ({
  quests: {}, obj: {}, cnt: {},
  hideout: {}, hcnt: {},
  ch: {}, chObj: {},
  ach: {}, bp: {}, bpDocs: {}, prestige: {}, prestigeManual: {},
  settings: { level: 1, faction: 'USEC', eod: false, unheard: false, ending: 'Savior', ll: {}, llAuto: true },
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

export const store = {
  get active() { return state.active; },
  get profile() { return PROFILES.find(p => p.id === state.active); },
  get p() { return state.profiles[state.active]; },
  get ui() { return state.ui; },
  setActive(id) { state.active = id; save(); emit('profile'); },
  update(fn, reason = 'progress') { fn(this.p); save(); emit(reason); },
  setUi(k, v) { state.ui[k] = v; save(); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  exportJson() { return JSON.stringify({ app: 'eft-tracker', exportedAt: new Date().toISOString(), ...state }, null, 1); },
  importJson(txt) {
    const j = JSON.parse(txt);
    if (!j || !j.profiles) throw new Error('Not a tracker export file');
    const s = { active: j.active || 'pvp', profiles: {}, ui: state.ui };
    for (const p of PROFILES) s.profiles[p.id] = merge(blankProgress(), j.profiles[p.id] || {});
    state = s; save(); emit('profile');
  },
  resetProfile(id = state.active) { state.profiles[id] = blankProgress(); save(); emit('profile'); },
};

function emit(reason) { for (const fn of listeners) { try { fn(reason); } catch (e) { console.error(e); } } }
