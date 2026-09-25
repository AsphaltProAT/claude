/* ============================================================================
   VELOCITY HORIZON — audio engine
   Everything is synthesized live with WebAudio: multi-oscillator engines with
   a gearbox feel, wind/tyre noise, one-shot effects, and a procedural
   synthwave soundtrack (drums, bass, pads, arpeggio) with reverb and delay.
   ========================================================================== */
(function () {
'use strict';
window.VH = window.VH || {};

let ctx = null;
let master, musicBus, sfxBus, comp, reverb, reverbSend, delay, delaySend;
let noiseBuf = null;
const vol = { master: 0.8, music: 0.55, sfx: 0.85 };
let muted = false;

/* ------------------------------------------------------------ plumbing -- */
function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { ctx = null; return false; }
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  master = ctx.createGain();
  master.connect(comp).connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.connect(master);

  // white noise shared by every noise source
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  // reverb: exponentially decaying stereo noise impulse
  reverb = ctx.createConvolver();
  const len = ctx.sampleRate * 2.6;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const c = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) c[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  reverb.buffer = ir;
  reverbSend = ctx.createGain(); reverbSend.gain.value = 0.9;
  reverbSend.connect(reverb).connect(musicBus);

  // tempo delay for the arpeggio
  delay = ctx.createDelay(1.0);
  const fb = ctx.createGain(); fb.gain.value = 0.36;
  const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
  delay.connect(dlp).connect(fb).connect(delay);
  delaySend = ctx.createGain(); delaySend.gain.value = 0.5;
  delaySend.connect(delay); dlp.connect(musicBus);

  buildEngine();
  applyVolumes();
  startScheduler();
  return true;
}

function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(muted ? 0 : vol.master, t, 0.05);
  musicBus.gain.setTargetAtTime(vol.music * 0.55, t, 0.1);
  sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.05);
}
function setVolumes(v) { Object.assign(vol, v); applyVolumes(); }
function setMuted(m) { muted = m; applyVolumes(); }

function noiseSource() {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.loop = true;
  s.loopStart = Math.random(); s.loopEnd = 2;
  return s;
}
function env(g, t, a, peak, dcy, sustain) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + dcy);
}

/* -------------------------------------------------------------- engine -- */
let eng = null;
function buildEngine() {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.4); }
  shaper.curve = curve;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
  const out = ctx.createGain(); out.gain.value = 0;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
  const o2 = ctx.createOscillator(); o2.type = 'sawtooth';
  const sub = ctx.createOscillator(); sub.type = 'square';
  const g1 = ctx.createGain(); g1.gain.value = 0.34;
  const g2 = ctx.createGain(); g2.gain.value = 0.28;
  const gs = ctx.createGain(); gs.gain.value = 0.22;
  o1.connect(g1).connect(shaper); o2.connect(g2).connect(shaper); sub.connect(gs).connect(shaper);
  shaper.connect(lp).connect(out).connect(sfxBus);
  o1.start(); o2.start(); sub.start();

  // turbine whine for the jet
  const whine = ctx.createOscillator(); whine.type = 'sine';
  const whineG = ctx.createGain(); whineG.gain.value = 0;
  whine.connect(whineG).connect(sfxBus); whine.start();

  // jet roar / wind / tyre squeal
  const mk = (type, f, q) => {
    const src = noiseSource();
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(flt).connect(g).connect(sfxBus); src.start();
    return { flt, g };
  };
  const roar = mk('bandpass', 320, 0.7);
  const wind = mk('bandpass', 700, 0.5);
  const skid = mk('bandpass', 1150, 2.2);
  const rumble = mk('lowpass', 140, 0.8);    // gravel under the tyres
  eng = { o1, o2, sub, lp, out, whine, whineG, roar, wind, skid, rumble };
}

// p: { kind, jet, rpm 0..1, throttle 0..1, speedRatio 0..1, skid 0..1,
//      offroad 0..1, active bool }
function engine(p) {
  if (!ctx || !eng) return;
  const t = ctx.currentTime, k = 0.035;
  if (!p.active) {
    eng.out.gain.setTargetAtTime(0, t, 0.08);
    eng.whineG.gain.setTargetAtTime(0, t, 0.08);
    eng.roar.g.gain.setTargetAtTime(0, t, 0.08);
    eng.wind.g.gain.setTargetAtTime(0, t, 0.08);
    eng.skid.g.gain.setTargetAtTime(0, t, 0.08);
    eng.rumble.g.gain.setTargetAtTime(0, t, 0.08);
    return;
  }
  let f, cutoff, gain;
  if (p.kind === 'plane' && p.jet) {
    f = 34 + p.throttle * 30;
    cutoff = 300 + p.throttle * 900;
    gain = 0.05 + p.throttle * 0.05;
    eng.whine.frequency.setTargetAtTime(700 + p.throttle * 1500 + p.speedRatio * 300, t, 0.2);
    eng.whineG.gain.setTargetAtTime(0.008 + p.throttle * 0.02, t, 0.2);
    eng.roar.flt.frequency.setTargetAtTime(220 + p.throttle * 500, t, 0.2);
    eng.roar.g.gain.setTargetAtTime(0.08 + p.throttle * 0.28, t, 0.15);
  } else if (p.kind === 'plane') {
    f = 26 + p.throttle * 44 + p.speedRatio * 8;
    cutoff = 380 + p.throttle * 1100;
    gain = 0.07 + p.throttle * 0.07;
    eng.whineG.gain.setTargetAtTime(0, t, 0.1);
    eng.roar.g.gain.setTargetAtTime(0.02 + p.throttle * 0.05, t, 0.2);
  } else {
    const bike = p.kind === 'bike';
    const idle = bike ? 46 : 34, span = bike ? 205 : 128;
    f = idle + p.rpm * span;
    cutoff = 450 + p.rpm * 2400 + p.throttle * 1300;
    gain = 0.07 + p.rpm * 0.06 + p.throttle * 0.05;
    eng.whineG.gain.setTargetAtTime(0, t, 0.1);
    eng.roar.g.gain.setTargetAtTime(0, t, 0.1);
  }
  eng.o1.frequency.setTargetAtTime(f, t, k);
  eng.o2.frequency.setTargetAtTime(f * 1.006 * 1.5, t, k);   // a fifth up, slightly off
  eng.sub.frequency.setTargetAtTime(f * 0.5, t, k);
  eng.lp.frequency.setTargetAtTime(cutoff, t, 0.05);
  eng.out.gain.setTargetAtTime(gain, t, 0.05);
  const s2 = p.speedRatio * p.speedRatio;
  eng.wind.flt.frequency.setTargetAtTime(500 + p.speedRatio * 900, t, 0.2);
  eng.wind.g.gain.setTargetAtTime(s2 * 0.2, t, 0.15);
  eng.skid.g.gain.setTargetAtTime(p.skid * 0.12, t, 0.04);
  eng.rumble.g.gain.setTargetAtTime(p.offroad * Math.min(1, p.speedRatio * 3) * 0.35, t, 0.1);
}

// gear change: a brief throttle cut
function shift() {
  if (!ctx || !eng) return;
  const t = ctx.currentTime;
  const g = eng.out.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(g.value * 0.25, t + 0.04);
  g.linearRampToValueAtTime(g.value, t + 0.16);
}

/* ------------------------------------------------------------ one-shots -- */
function tone(freq, type, t, a, dcy, peak, dest, glideTo) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + a + dcy);
  const g = ctx.createGain();
  env(g, t, a, peak, dcy);
  o.connect(g).connect(dest || sfxBus);
  o.start(t); o.stop(t + a + dcy + 0.05);
}
function burst(t, type, f, q, a, dcy, peak) {
  const s = noiseSource();
  const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
  const g = ctx.createGain(); env(g, t, a, peak, dcy);
  s.connect(flt).connect(g).connect(sfxBus);
  s.start(t); s.stop(t + a + dcy + 0.05);
}

const SFX = {
  hover(t)    { tone(1400, 'sine', t, 0.002, 0.04, 0.025); },
  click(t)    { tone(880, 'triangle', t, 0.002, 0.07, 0.07); tone(1320, 'sine', t + 0.03, 0.002, 0.06, 0.04); },
  back(t)     { tone(660, 'triangle', t, 0.002, 0.08, 0.06, null, 440); },
  error(t)    { tone(180, 'square', t, 0.004, 0.18, 0.05); tone(150, 'square', t + 0.1, 0.004, 0.2, 0.05); },
  count(t)    { tone(660, 'square', t, 0.004, 0.22, 0.07); },
  go(t)       { tone(1320, 'square', t, 0.004, 0.5, 0.08); tone(990, 'square', t, 0.004, 0.5, 0.05); },
  checkpoint(t) { [880, 1175, 1568].forEach((f, i) => tone(f, 'triangle', t + i * 0.05, 0.003, 0.22, 0.07)); },
  lap(t)      { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 'triangle', t + i * 0.07, 0.003, 0.3, 0.08)); },
  token(t)    { [1319, 1760, 2093, 2637].forEach((f, i) => tone(f, 'sine', t + i * 0.045, 0.002, 0.3, 0.07)); },
  nearmiss(t) { burst(t, 'bandpass', 900, 0.8, 0.05, 0.35, 0.22); tone(520, 'sawtooth', t, 0.01, 0.25, 0.02, null, 300); },
  skill(t)    { tone(1046, 'sine', t, 0.003, 0.14, 0.05); tone(1568, 'sine', t + 0.04, 0.003, 0.16, 0.04); },
  bank(t)     { [523, 659, 784, 1046].forEach((f, i) => tone(f, 'triangle', t + i * 0.06, 0.003, 0.35, 0.07)); },
  broken(t)   { tone(330, 'sawtooth', t, 0.004, 0.35, 0.05, null, 110); },
  buy(t)      { [659, 988, 1319].forEach((f, i) => tone(f, 'triangle', t + i * 0.08, 0.003, 0.4, 0.08)); burst(t, 'highpass', 6000, 0.5, 0.002, 0.3, 0.05); },
  levelup(t)  { [523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 'square', t + i * 0.09, 0.004, 0.45, 0.05)); },
  finish(t)   { [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 'triangle', t + i * 0.11, 0.004, 0.6, 0.08)); },
  lose(t)     { [440, 392, 330].forEach((f, i) => tone(f, 'triangle', t + i * 0.14, 0.004, 0.45, 0.07)); },
  whoosh(t)   { burst(t, 'bandpass', 700, 0.6, 0.12, 0.45, 0.25); },
  impact(t, s) {
    const k = Math.min(1, s || 0.6);
    burst(t, 'lowpass', 500, 0.7, 0.002, 0.28, 0.5 * k);
    tone(90, 'sine', t, 0.002, 0.3, 0.45 * k, null, 40);
    burst(t + 0.01, 'bandpass', 2400, 1.4, 0.002, 0.12, 0.12 * k);   // glass/metal tick
  },
  land(t, s)  { tone(70, 'sine', t, 0.002, 0.25, 0.35 * Math.min(1, s || 0.5), null, 38); burst(t, 'lowpass', 300, 0.7, 0.002, 0.2, 0.25 * Math.min(1, s || 0.5)); },
  thunder(t)  { burst(t, 'lowpass', 120, 0.6, 0.4, 3.5, 0.6); },
};
function sfx(name, strength) {
  if (!ctx || !SFX[name]) return;
  SFX[name](ctx.currentTime + 0.005, strength);
}

/* -------------------------------------------------------------- weather -- */
let rain = null;
function setRain(amount) {
  if (!ctx) return;
  if (!rain) {
    const src = noiseSource();
    const flt = ctx.createBiquadFilter(); flt.type = 'highpass'; flt.frequency.value = 1800;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(flt).connect(g).connect(sfxBus); src.start();
    rain = g;
  }
  rain.gain.setTargetAtTime(amount * 0.09, ctx.currentTime, 0.6);
}

/* --------------------------------------------------------------- music -- */
// A-minor synthwave. Four progressions rotate every 4 bars; the arrangement
// thins out for menus and fills in for races.
const BPM = 104;
const STEP = 60 / BPM / 4;             // one 16th note
const PROGS = [
  [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],   // Am  F  C  G
  [[53, 57, 60, 64], [55, 59, 62], [52, 55, 59], [57, 60, 64]], // Fmaj7 G Em Am
  [[50, 53, 57], [57, 60, 64], [53, 57, 60], [52, 56, 59]],   // Dm Am F E
  [[57, 60, 64], [55, 59, 62], [53, 57, 60], [55, 59, 62]],   // Am G F G
];
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
let musicMode = 'off', step = 0, nextTime = 0, bar = 0, schedTimer = null;

function kick(t, v) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  const g = ctx.createGain(); env(g, t, 0.002, v, 0.32);
  o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.4);
}
function snare(t, v) {
  const s = noiseSource();
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
  const g = ctx.createGain(); env(g, t, 0.001, v, 0.18);
  s.connect(f).connect(g); g.connect(musicBus); g.connect(reverbSend);
  s.start(t); s.stop(t + 0.25);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(190, t);
  const og = ctx.createGain(); env(og, t, 0.001, v * 0.6, 0.1);
  o.connect(og).connect(musicBus); o.start(t); o.stop(t + 0.15);
}
function hat(t, v, open) {
  const s = noiseSource();
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
  const g = ctx.createGain(); env(g, t, 0.001, v, open ? 0.2 : 0.045);
  s.connect(f).connect(g).connect(musicBus); s.start(t); s.stop(t + 0.3);
}
function bass(t, note, len, v) {
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(note);
  const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = midi(note - 12);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
  f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(180, t + len);
  const g = ctx.createGain(); env(g, t, 0.005, v, len, v * 0.3);
  const m = ctx.createGain(); m.gain.value = 0.5;
  o.connect(f); o2.connect(m).connect(f); f.connect(g).connect(musicBus);
  o.start(t); o2.start(t); o.stop(t + len + 0.05); o2.stop(t + len + 0.05);
}
function pad(t, notes, len, v) {
  for (const n of notes) for (const det of [-7, 6]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = midi(n); o.detune.value = det;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + len * 0.35);
    g.gain.linearRampToValueAtTime(v * 0.8, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.3);
    o.connect(f).connect(g); g.connect(musicBus); g.connect(reverbSend);
    o.start(t); o.stop(t + len + 0.4);
  }
}
function pluck(t, note, v) {
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = midi(note);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(3800, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.2);
  const g = ctx.createGain(); env(g, t, 0.002, v, 0.22);
  o.connect(f).connect(g); g.connect(musicBus); g.connect(delaySend); g.connect(reverbSend);
  o.start(t); o.stop(t + 0.3);
}

function scheduleStep(s, t) {
  const within = s % 16;
  if (within === 0) bar++;
  const prog = PROGS[Math.floor(bar / 4) % PROGS.length];
  const chord = prog[bar % 4];
  const root = chord[0];
  const full = musicMode === 'drive' || musicMode === 'race';
  const race = musicMode === 'race';

  if (within === 0) pad(t, chord, STEP * 16, full ? 0.022 : 0.03);
  if (full) {
    if (within % 4 === 0) kick(t, 0.5);
    if (within === 4 || within === 12) snare(t, 0.2);
    if (within % 2 === 1 || race) hat(t, race && within % 2 === 0 ? 0.03 : 0.05, within === 14);
    const bpat = [0, 0, 12, 0, 0, 12, 0, 7];
    if (within % 2 === 0) bass(t, root - 24 + bpat[(within / 2) % 8], STEP * 1.8, 0.14);
  }
  // arpeggio: chord tones cycling across two octaves
  const arp = [0, 1, 2, 1, 0, 1, 2, 3];
  const tones = chord.concat([chord[0] + 12]);
  if (full || within % 2 === 0) {
    const n = tones[arp[within % 8] % tones.length] + (within >= 8 ? 12 : 0) + 12;
    pluck(t, n, full ? 0.028 : 0.022);
  }
}
function startScheduler() {
  if (schedTimer) return;
  schedTimer = setInterval(() => {
    if (!ctx || musicMode === 'off') return;
    const now = ctx.currentTime;
    if (nextTime < now) nextTime = now + 0.05;
    while (nextTime < now + 0.14) {
      scheduleStep(step, nextTime);
      step++;
      nextTime += STEP;
    }
  }, 25);
}
function music(mode) {
  if (mode === musicMode) return;
  musicMode = mode;
  if (ctx && mode !== 'off') {
    // restart phrase for a clean downbeat
    step = 0; bar = -1;
    nextTime = ctx.currentTime + 0.08;
  }
}

VH.Audio = {
  init, setVolumes, setMuted, engine, shift, sfx, music, setRain,
  get ready() { return !!ctx; },
  get muted() { return muted; },
  get musicMode() { return musicMode; },
};
})();
