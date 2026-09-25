/* ============================================================================
   VELOCITY HORIZON — profile persistence
   One save slot in localStorage. Every access is guarded: private windows and
   blocked storage just mean progress lives for the session only.
   ========================================================================== */
(function () {
'use strict';
window.VH = window.VH || {};

const KEY = 'velocity-horizon.profile.v1';
const KEY_SETTINGS = 'velocity-horizon.settings.v1';

function defaultSettings() {
  return {
    quality: 'high',        // low | medium | high | ultra
    master: 0.8, music: 0.55, sfx: 0.85,
    units: 'kmh',           // kmh | mph
    shake: true,
    fov: 62,
    difficulty: 'normal',   // easy | normal | hard
    invertPitch: false,
    traffic: true,
    weather: true,
  };
}

function defaultProfile() {
  return {
    version: 1,
    created: Date.now(),
    credits: 20000,
    xp: 0,
    level: 1,
    owned: ['bandit'],
    current: 'bandit',
    upgrades: {},           // vehicleId -> { engine, tires, nitro }
    paints: {},             // vehicleId -> hex colour
    events: {},             // eventId   -> { stars, best, done }
    tokens: [],             // collected token indices
    stats: {
      distance: 0, topSpeed: 0, bestDrift: 0, bestJump: 0, bestAir: 0,
      nearMisses: 0, racesWon: 0, eventsDone: 0, playTime: 0, skillBanked: 0,
    },
    finaleWon: false,
    tutorialDone: false,
    lastPos: null,
  };
}

// fill gaps when a save from an older build is loaded
function migrate(p) {
  const d = defaultProfile();
  for (const k in d) if (p[k] === undefined) p[k] = d[k];
  for (const k in d.stats) if (p.stats[k] === undefined) p.stats[k] = d.stats[k];
  if (!p.owned.includes(p.current)) p.current = p.owned[0] || 'bandit';
  return p;
}

let storageOK = true;
function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch (e) { storageOK = false; return null; }
}
function write(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); return true; }
  catch (e) { storageOK = false; return false; }
}
function wipe() {
  try { localStorage.removeItem(KEY); } catch (e) { /* nothing to wipe */ }
}

// settings live apart from the career so they survive "New Game"
function loadSettings() {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY_SETTINGS);
    if (raw) Object.assign(d, JSON.parse(raw));
  } catch (e) { storageOK = false; }
  return d;
}
function saveSettings(s) {
  try { localStorage.setItem(KEY_SETTINGS, JSON.stringify(s)); } catch (e) { storageOK = false; }
}

VH.Save = {
  loadSettings, saveSettings,
  defaultProfile, defaultSettings,
  load: read, save: write, wipe,
  hasSave: () => read() !== null,
  storageOK: () => storageOK,
};
})();
