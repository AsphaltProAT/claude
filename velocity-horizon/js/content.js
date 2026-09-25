/* ============================================================================
   VELOCITY HORIZON — game content
   Vehicles, prices, upgrades, paint, progression curve and the event list.
   Pure data: game.js resolves road positions (t = 0..1 around the highway
   loop) and terrain heights when it builds the world.
   ========================================================================== */
(function () {
'use strict';
window.VH = window.VH || {};

const VEHICLES = [
  { id: 'f458',     key: '1', name: '458 Italia',   cls: 'Hypercar',    kind: 'car',  profile: 'sports', glb: true,
    color: 0xc4161c, maxSpeed: 94, accel: 26, grip: 9.0, turn: 2.5, offroad: 0.45, spoiler: true,
    price: 110000, level: 5,
    blurb: 'Real ~340k-vertex model. The fastest thing on four wheels.',
    hint: '<b>W</b> gas · <b>Space</b> drift · <b>Shift</b> nitro' },
  { id: 'bandit',   key: '2', name: 'Bandit V8',    cls: 'Muscle',      kind: 'car',  profile: 'muscle',
    color: 0x1d4fc4, maxSpeed: 80, accel: 22, grip: 6.5, turn: 2.3, offroad: 0.5, spoiler: false,
    price: 0, level: 1,
    blurb: 'Your first ride. Loves going sideways.',
    hint: 'Loves going sideways. <b>Space</b> to drift.' },
  { id: 'trailcat', key: '3', name: 'Trailcat 4X4', cls: 'Offroader',   kind: 'car',  profile: 'suv',
    color: 0x33702e, maxSpeed: 55, accel: 15, grip: 8.0, turn: 2.1, offroad: 0.95, spoiler: false,
    price: 24000, level: 1,
    blurb: 'Barely slows down off the tarmac. King of the scrambles.',
    hint: 'Barely slows down off the tarmac. Climb everything.' },
  { id: 'viper',    key: '4', name: 'Viper R',      cls: 'Superbike',   kind: 'bike',
    color: 0xd8b012, maxSpeed: 86, accel: 25, grip: 8.5, turn: 2.9, offroad: 0.35,
    price: 42000, level: 3,
    blurb: 'Fast and flickable — lean into corners.',
    hint: 'Fast and flickable — lean into corners.' },
  { id: 'hopper',   key: '5', name: 'Dust Hopper',  cls: 'Dirt bike',   kind: 'bike',
    color: 0xd05e17, maxSpeed: 48, accel: 17, grip: 7.5, turn: 3.1, offroad: 0.9,
    price: 14000, level: 1,
    blurb: 'Cheap, light and made for the hills. Jump everything.',
    hint: 'Made for the hills. Jump everything.' },
  { id: 'skyhawk',  key: '6', name: 'Skyhawk',      cls: 'Stunt plane', kind: 'plane',
    color: 0xdcd8cc, maxSpeed: 88, accel: 15, grip: 0, turn: 1.6, offroad: 1, jet: false, glbPlane: true,
    price: 60000, level: 3,
    blurb: 'Real textured aerobatic model. Unlocks the air races.',
    hint: '<b>W/S</b> throttle · <b>↑↓</b> pitch · <b>A/D</b> bank. <b>T</b> = airfield.' },
  { id: 'thunder',  key: '7', name: 'Thunder Jet',  cls: 'Jet',         kind: 'plane',
    color: 0x2e3642, maxSpeed: 132, accel: 26, grip: 0, turn: 1.3, offroad: 1, jet: true,
    price: 190000, level: 8,
    blurb: 'Afterburner scream at 475 km/h. Needs room to turn.',
    hint: 'Afterburner scream. Needs room to turn.' },
];

// three upgrade tracks; planes only get engine + handling
const UPGRADES = {
  engine:   { name: 'Engine',   desc: '+5% top speed, +10% acceleration per stage', cost: [9000, 18000, 32000] },
  handling: { name: 'Tyres & Suspension', desc: '+8% grip, +5% steering, better off-road', cost: [6000, 12000, 22000],
              planeName: 'Airframe', planeDesc: '+8% turn rate per stage' },
  nitro:    { name: 'Nitrous',  desc: 'Stronger boost, slower drain per stage', cost: [5000, 10000, 18000] },
};
function upgradeCost(vehicle, slot, stage) {
  // pricier machines cost more to tune
  const tier = Math.min(2.2, Math.max(0.6, (vehicle.price || 20000) / 60000));
  return Math.round(UPGRADES[slot].cost[stage] * tier / 500) * 500;
}

const PAINTS = [
  0xc4161c, 0x1d4fc4, 0xd8b012, 0x33702e, 0xd05e17, 0xe9e9ec,
  0x121418, 0x6a2fb8, 0x12a3a3, 0xd63c86, 0x8a8f99, 0x0f2f5c,
];

// XP needed to go from `level` to level + 1
function xpToNext(level) { return 1100 + level * 650; }
const MAX_LEVEL = 50;

/* ------------------------------------------------------------- events --- */
// type:
//   circuit  — laps of the island highway vs AI
//   sprint   — point-to-point along the highway vs AI (t0 -> t1)
//   scramble — cross-country checkpoint time trial ([x, z] points)
//   air      — plane ring time trial ([x, z, height above ground] rings)
// allow: which vehicle kinds may enter.  stars: min total stars to unlock.
const EVENTS = [
  { id: 'opener', name: 'Horizon Opener', type: 'circuit', laps: 1, t0: 0.020, pace: 0.80,
    allow: ['car', 'bike'], level: 1, reward: { credits: 7000, xp: 900 },
    desc: 'One lap of the island highway. Welcome to the festival.' },
  { id: 'coastal', name: 'Highland Sprint', type: 'sprint', t0: 0.10, t1: 0.44, pace: 0.86,
    allow: ['car'], level: 1, reward: { credits: 8000, xp: 1000 },
    desc: 'Flat out over the southern hills. Cars only.' },
  { id: 'valley', name: 'Valley Scramble', type: 'scramble',
    points: [[-560, 420], [-760, 560], [-980, 470], [-1120, 240], [-1080, -40], [-880, -200], [-660, -120], [-560, 120]],
    allow: ['car', 'bike'], level: 2, reward: { credits: 9000, xp: 1100 },
    desc: 'Cross-country through the western valley. Off-roaders rule here.' },
  { id: 'twowheel', name: 'Two-Wheel Rush', type: 'sprint', t0: 0.55, t1: 0.90, pace: 0.90,
    allow: ['bike'], level: 2, reward: { credits: 10000, xp: 1200 },
    desc: 'Bikes only, from the western bends to the northern ridge.' },
  { id: 'skyline', name: 'Skyline Rings', type: 'air',
    start: [880, -140, 70], heading: -Math.PI / 2, at: [960, -196],
    rings: [[640, -300, 70], [280, -560, 80], [-180, -640, 90], [-600, -470, 80], [-820, -60, 70],
            [-660, 360, 60], [-250, 660, 70], [260, 650, 80], [660, 360, 70], [900, -60, 55]],
    allow: ['plane'], level: 3, reward: { credits: 12000, xp: 1400 },
    desc: 'A lap of the island through ten sky rings.' },
  { id: 'gp', name: 'Highway Grand Prix', type: 'circuit', laps: 2, t0: 0.30, pace: 0.94,
    allow: ['car'], level: 3, reward: { credits: 15000, xp: 1700 },
    desc: 'Two laps, three rivals, no mercy.' },
  { id: 'ridge', name: 'Ridge Runner', type: 'scramble',
    points: [[60, 820], [-260, 1040], [-120, 1330], [260, 1340], [420, 1060], [620, 900], [380, 760]],
    allow: ['car', 'bike'], level: 4, reward: { credits: 13000, xp: 1500 },
    desc: 'Southern ridgelines and big drops. Hold on.' },
  { id: 'night', name: 'Midnight Run', type: 'circuit', laps: 2, t0: 0.70, pace: 0.97, night: true,
    allow: ['car', 'bike'], level: 5, reward: { credits: 19000, xp: 2100 },
    desc: 'The island after dark. Headlights on, nerves steady.' },
  { id: 'peaks', name: 'Peak Threader', type: 'air',
    start: [1100, -320, 60], heading: Math.PI, at: [1160, -196],
    rings: [[1150, -620, 45], [1000, -980, 40], [640, -1240, 45], [250, -1120, 40], [0, -820, 45],
            [-320, -1000, 45], [-720, -1180, 45], [-1100, -900, 50], [-1020, -480, 45], [-600, -220, 55],
            [-200, -320, 60], [300, -400, 50], [780, -220, 45]],
    allow: ['plane'], level: 6, reward: { credits: 22000, xp: 2400 },
    desc: 'Low and fast through the northern peaks.' },
  { id: 'pro', name: 'Island Circuit Pro', type: 'circuit', laps: 3, t0: 0.46, pace: 1.05,
    allow: ['car', 'bike'], level: 6, reward: { credits: 26000, xp: 3000 },
    desc: 'Three laps against the festival\'s pro drivers.' },
  { id: 'finale', name: 'Horizon Finale', type: 'circuit', laps: 3, t0: 0.85, pace: 1.14,
    allow: ['car'], level: 8, stars: 24, reward: { credits: 75000, xp: 7000 }, finale: true,
    at: [0, -40],
    desc: 'The championship decider. Win this and the festival is yours.' },
];

// free-roam PR stunts: always live, no start needed
const SPEED_TRAPS = [
  { id: 'trap1', name: 'Southern Straight', t: 0.170, stars: [170, 220, 265] },
  { id: 'trap2', name: 'West Bend',         t: 0.430, stars: [170, 220, 265] },
  { id: 'trap3', name: 'Ridge Top',         t: 0.785, stars: [170, 220, 265] },
  { id: 'trap4', name: 'Runway',            at: [1080, -140], axis: 'x', stars: [180, 240, 290] },
];
const DRIFT_ZONES = [
  { id: 'drift1', name: 'Lakeside Slide', t0: 0.225, t1: 0.285, stars: [1500, 3200, 5200] },
  { id: 'drift2', name: 'Western Hook',   t0: 0.495, t1: 0.560, stars: [1500, 3200, 5200] },
  { id: 'drift3', name: 'Crown Esses',    t0: 0.880, t1: 0.940, stars: [1500, 3200, 5200] },
];
// ramps: on a highway shoulder (t + side), on a city spoke, or at a fixed spot
const JUMPS = [
  { id: 'jump1', name: 'Hilltop Hop',   t: 0.135, side: 1, stars: [60, 115, 170] },
  { id: 'jump2', name: 'Lake View',     t: 0.370, side: -1, stars: [60, 115, 170] },
  { id: 'jump3', name: 'Crest Launch',  t: 0.735, side: 1, stars: [60, 115, 170] },
  { id: 'jump4', name: 'Runway Kicker', at: [805, -140], dir: [-1, 0], stars: [90, 160, 230] },
  { id: 'jump5', name: 'Downtown Drop', spoke: 1, u: 0.55, stars: [50, 95, 140] },
];
const TOKEN_COUNT = 30;

VH.CONTENT = {
  VEHICLES, UPGRADES, PAINTS, upgradeCost, xpToNext, MAX_LEVEL,
  EVENTS, SPEED_TRAPS, DRIFT_ZONES, JUMPS, TOKEN_COUNT,
};
})();
