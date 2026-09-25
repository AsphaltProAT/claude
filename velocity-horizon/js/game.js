/* ============================================================================
   VELOCITY HORIZON — open-world arcade racer (cars · bikes · planes)
   Career mode: 11 festival events (circuits, sprints, cross-country scrambles,
   air races, a finale), speed traps, drift zones, jumps, collectibles, skill
   chains, credits/XP/levels, a vehicle shop with upgrades and paint, traffic,
   dynamic weather, day/night, saves, settings and gamepad support.
   Rendering: PBR + IBL reflections, procedural textures, atmospheric sky
   shader, bloom/FXAA post pipeline, GPU particles. Pure Three.js, no build.
   ========================================================================== */
(function () {
'use strict';

// treat hex colours as sRGB so paints render rich instead of gamma-washed
if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;

/* ---------------------------------------------------------------- utils -- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

function hash2(ix, iz) {
  let n = (ix * 374761393 + iz * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct) {
  let f = 0, amp = 1, fr = 1, tot = 0;
  for (let i = 0; i < oct; i++) { f += vnoise(x * fr, z * fr) * amp; tot += amp; amp *= 0.5; fr *= 2; }
  return f / tot;
}

/* ------------------------------------------------------- world geometry -- */
const WORLD = 3400;
const WATER_Y = 6;

function rawHeight(x, z) {
  return -8 + fbm(x * 0.0012, z * 0.0012, 4) * 90 + fbm(x * 0.006, z * 0.006, 3) * 7;
}
function lowHeight(x, z) {
  return -8 + fbm(x * 0.0012, z * 0.0012, 2) * 90;
}
function roadRadius(a) {
  return 520 + 140 * Math.sin(a * 3 + 1.7) + 60 * Math.sin(a * 5 + 0.6);
}
const ROAD_HALF = 8;
const CITY_R = 170;
const STRIP = { x: 1080, z: -140, hl: 260, hw: 26 };

// the downtown plateau sits above the waterline (the raw noise dips to -8 m here)
const CITY_H = 16;
let STRIP_H = 0;

// straight spoke roads from downtown out to the highway loop
const SPOKES = [0.42, 2.52, 4.30].map(a => {
  const r1 = roadRadius(a);
  const hx = Math.cos(a) * r1, hz = Math.sin(a) * r1;
  return { a, cx: Math.cos(a), cz: Math.sin(a), r0: CITY_R - 30, r1, hEnd: lowHeight(hx, hz) };
});
function spokeInfo(x, z) {
  let best = null;
  for (const s of SPOKES) {
    const along = x * s.cx + z * s.cz;
    if (along < s.r0 - 30 || along > s.r1 + 10) continue;
    const perp = Math.abs(-x * s.cz + z * s.cx);
    if (!best || perp < best.d) best = { d: perp, along, s };
  }
  return best;
}
function spokeHeight(s, along) {
  return lerp(CITY_H, s.hEnd, smoothstep(s.r0, s.r1, along));
}

function roadDistInfo(x, z) {
  const r = Math.hypot(x, z);
  if (r < 60) return { d: 1e9, a: 0 };
  const a = Math.atan2(z, x);
  return { d: Math.abs(r - roadRadius(a)), a: a };
}
function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  const si = spokeInfo(x, z);
  if (si) {
    const beyond = Math.max(0, si.along - si.s.r1);
    const d = Math.hypot(si.d, beyond);
    if (d < 48) {
      const along = clamp(si.along, si.s.r0, si.s.r1);
      h = lerp(spokeHeight(si.s, along), h, smoothstep(20, 48, d));
    }
  }
  const ri = roadDistInfo(x, z);
  if (ri.d < 52) {
    const rr = roadRadius(ri.a);
    const hr = lowHeight(Math.cos(ri.a) * rr, Math.sin(ri.a) * rr);
    h = lerp(hr, h, smoothstep(20, 52, ri.d));
  }
  const dc = Math.hypot(x, z);
  if (dc < 230) h = lerp(CITY_H, h, smoothstep(CITY_R - 20, 230, dc));
  const dx = Math.abs(x - STRIP.x) - STRIP.hl, dz = Math.abs(z - STRIP.z) - STRIP.hw;
  const dd = Math.max(dx, dz);
  if (dd < 45) h = lerp(STRIP_H, h, smoothstep(0, 45, dd));
  return h;
}
function groundNormal(x, z) {
  const e = 1.6;
  const keep = lastRamp;
  const hx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const hz = groundHeight(x, z + e) - groundHeight(x, z - e);
  lastRamp = keep;
  return new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}
function surfaceKind(x, z) {
  if (roadDistInfo(x, z).d < ROAD_HALF + 1.5) return 'road';
  const si = spokeInfo(x, z);
  if (si && si.d < ROAD_HALF + 1 && si.along > si.s.r0 && si.along < si.s.r1) return 'road';
  if (Math.hypot(x, z) < CITY_R) return 'city';
  if (Math.abs(x - STRIP.x) < STRIP.hl && Math.abs(z - STRIP.z) < STRIP.hw) return 'strip';
  return 'dirt';
}
function roadPoint(t) {
  const a = t * TAU;
  const r = roadRadius(a);
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  return new THREE.Vector3(x, terrainHeight(x, z), z);
}
function roadTangent(t) {
  const p1 = roadPoint((t + 0.0012) % 1), p0 = roadPoint((t + 1 - 0.0012) % 1);
  return p1.sub(p0).setY(0).normalize();
}

// kicker ramps: a curved wedge whose top follows base + h * u^1.6
const RAMPS = [];
function addRamp(x, z, dx, dz, def) {
  const len = def.len || 17, hw = def.hw || 3.4, h = def.h || 3.3;
  const r = { x, z, dx, dz, len, hw, h, base: terrainHeight(x, z) - 0.15, def,
    cx: x + dx * len / 2, cz: z + dz * len / 2, rad: len / 2 + hw + 1 };
  RAMPS.push(r);
  return r;
}
function rampTop(r, x, z) {
  const ox = x - r.x, oz = z - r.z;
  const u = ox * r.dx + oz * r.dz, v = -ox * r.dz + oz * r.dx;
  if (u < 0 || u > r.len || Math.abs(v) > r.hw) return -1e9;
  return r.base + Math.pow(u / r.len, 1.6) * r.h;
}
let lastRamp = null;
// terrain + anything drivable on top of it
function groundHeight(x, z) {
  let h = terrainHeight(x, z);
  lastRamp = null;
  for (const r of RAMPS) {
    if (Math.abs(x - r.cx) > r.rad || Math.abs(z - r.cz) > r.rad) continue;
    const rt = rampTop(r, x, z);
    if (rt > h) { h = rt; lastRamp = r; }
  }
  return h;
}

/* -------------------------------------------------- procedural textures - */
function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}
function toTex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 8;
  return t;
}

const asphaltTex = (() => {
  const [c, g] = makeCanvas(512);
  g.fillStyle = '#33363c'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 7000; i++) {
    const v = 42 + Math.random() * 38 | 0;
    g.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.18 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
  }
  // tire-polished tracks
  for (const u of [0.30, 0.70]) {
    const grad = g.createLinearGradient((u - 0.09) * 512, 0, (u + 0.09) * 512, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(12,12,14,0.42)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect((u - 0.09) * 512, 0, 0.18 * 512, 512);
  }
  // faint cracks
  g.strokeStyle = 'rgba(18,18,21,0.20)'; g.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    let x = Math.random() * 512, y = Math.random() * 512;
    g.moveTo(x, y);
    for (let j = 0; j < 6; j++) { x += (Math.random() - 0.5) * 60; y += Math.random() * 40; g.lineTo(x, y); }
    g.stroke();
  }
  return toTex(c, true);
})();
const asphaltBump = (() => {
  const [c, g] = makeCanvas(256);
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const v = 100 + Math.random() * 80 | 0;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  return toTex(c, false);
})();

const grassDetail = (() => {
  const [c, g] = makeCanvas(256);
  g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const v = 150 + Math.random() * 105 | 0;
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    const w = 1 + Math.random() * 2;
    g.fillRect(Math.random() * 256, Math.random() * 256, w, w * (0.5 + Math.random()));
  }
  for (let i = 0; i < 60; i++) {  // broader tonal blotches
    const v = 140 + Math.random() * 90 | 0;
    g.fillStyle = `rgba(${v},${v},${v},0.12)`;
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 34, 0, TAU);
    g.fill();
  }
  return toTex(c, false);
})();

const facadeMaps = (() => {
  const [c, g] = makeCanvas(256);
  const [ce, ge] = makeCanvas(256);
  g.fillStyle = '#a7adb8'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 140 + Math.random() * 50 | 0;
    g.fillStyle = `rgba(${v},${v + 3},${v + 8},0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 256);
  const cols = 5, rows = 7, mw = 10, mh = 9;
  const cw = (256 - mw * (cols + 1)) / cols, ch = (256 - mh * (rows + 1)) / rows;
  for (let ix = 0; ix < cols; ix++) for (let iy = 0; iy < rows; iy++) {
    const x = mw + ix * (cw + mw), y = mh + iy * (ch + mh);
    const gl = g.createLinearGradient(x, y, x, y + ch);
    const base = 26 + Math.random() * 26;
    gl.addColorStop(0, `rgb(${base + 24},${base + 34},${base + 52})`);
    gl.addColorStop(1, `rgb(${base},${base + 8},${base + 18})`);
    g.fillStyle = gl;
    g.fillRect(x, y, cw, ch);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x, y, cw, 3);
    if (Math.random() < 0.34) {           // lit at night
      const warm = 200 + Math.random() * 55 | 0;
      ge.fillStyle = `rgb(${warm},${warm * 0.82 | 0},${warm * 0.5 | 0})`;
      ge.fillRect(x + 1, y + 1, cw - 2, ch - 2);
    }
  }
  // concrete patch for roofs at uv (0..0.02)
  g.fillStyle = '#8e939c'; g.fillRect(0, 0, 6, 6);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 6, 6);
  return { map: toTex(c, true), emissive: toTex(ce, true) };
})();

const waterNormalTex = (() => {
  const size = 256;
  const [c, g] = makeCanvas(size);
  const img = g.createImageData(size, size);
  const H = (x, y) =>
    Math.sin(x * 0.11 + y * 0.06) * 1.2 + Math.sin(x * 0.05 - y * 0.09) * 1.6 +
    Math.sin((x + y) * 0.17) * 0.5 + Math.sin(Math.hypot(x - 128, y - 128) * 0.12) * 0.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1);
    const n = new THREE.Vector3(-dx, -dy, 1.6).normalize();
    const i = (y * size + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255;
    img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
    img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTex(c, false);
})();

const particleSprite = (() => {
  const [c, g] = makeCanvas(64);
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return toTex(c, false);
})();

const cloudSprite = (() => {
  const [c, g] = makeCanvas(128);
  for (let i = 0; i < 7; i++) {
    const x = 24 + Math.random() * 80, y = 46 + Math.random() * 36, r = 18 + Math.random() * 22;
    const gr = g.createRadialGradient(x, y, 2, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  return toTex(c, false);
})();

/* ------------------------------------------------------------ renderer -- */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87b7e8, 260, 1600);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 7000);
camera.position.set(0, 40, -30);

/* ------------------------------------------------------ post-processing - */
const composer = new THREE.EffectComposer(renderer);
composer.addPass(new THREE.RenderPass(scene, camera));
const bloomPass = new THREE.UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight), 0.38, 0.7, 0.92);
composer.addPass(bloomPass);
composer.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));
const fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
composer.addPass(fxaaPass);
function setPostSize() {
  const pr = renderer.getPixelRatio();
  composer.setSize(innerWidth, innerHeight);
  fxaaPass.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
}
setPostSize();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  setPostSize();
});

/* ------------------------------------------------------------- sky ------ */
const skyUniforms = {
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  uDay:   { value: 1 },
  uDawn:  { value: 0 },
  uNight: { value: 0 },
  uOvercast: { value: 0 },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = position;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 sunDir;
    uniform float uDay, uDawn, uNight, uOvercast;
    varying vec3 vDir;
    float hash13(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
    void main() {
      vec3 dir = normalize(vDir);
      float y = clamp(dir.y, -1.0, 1.0);
      vec3 dayZen   = vec3(0.13, 0.34, 0.72);
      vec3 dayHor   = vec3(0.60, 0.76, 0.94);
      vec3 nightZen = vec3(0.006, 0.010, 0.038);
      vec3 nightHor = vec3(0.028, 0.045, 0.105);
      vec3 zen = mix(nightZen, dayZen, uDay);
      vec3 hor = mix(nightHor, dayHor, uDay);
      float sunAzi = max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
      hor = mix(hor, vec3(0.99, 0.42, 0.19), uDawn * pow(sunAzi, 3.0) * 0.85);
      float t = pow(1.0 - max(y, 0.0), 2.4);
      vec3 col = mix(zen, hor, t);
      float s = max(dot(dir, sunDir), 0.0);
      col += vec3(1.0, 0.92, 0.75) * pow(s, 1100.0) * 6.0;
      col += vec3(1.0, 0.55, 0.26) * pow(s, 7.0) * (0.10 + uDawn * 0.45);
      // stars
      vec3 sp = floor(dir * 220.0);
      float star = step(0.9982, hash13(sp)) * (0.4 + 0.6 * hash13(sp + 7.0));
      col += vec3(star) * uNight * smoothstep(0.02, 0.28, y) * 0.9 * (1.0 - uOvercast);
      float grey = dot(col, vec3(0.3, 0.5, 0.2));
      col = mix(col, vec3(grey) * 0.82, uOvercast * 0.85);
      gl_FragColor = vec4(col, 1.0);
    }`
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(3300, 32, 16), skyMat);
skyDome.renderOrder = -10;
scene.add(skyDome);

// environment map (image-based lighting) regenerated as the sun moves
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(60, 24, 12), skyMat));
let envRT = null, envBucket = -1;
function updateEnvironment() {
  const bucket = Math.floor(dayTime * 24) * 10 + Math.round(skyUniforms.uOvercast.value * 4);
  if (bucket === envBucket) return;
  envBucket = bucket;
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
}

/* ------------------------------------------------------------- lights --- */
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3f5a36, 0.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -130; sun.shadow.camera.right = 130;
sun.shadow.camera.top = 130; sun.shadow.camera.bottom = -130;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun); scene.add(sun.target);

const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: (() => {
    const [c, g] = makeCanvas(128);
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,246,214,1)');
    gr.addColorStop(0.3, 'rgba(255,214,120,0.55)');
    gr.addColorStop(1, 'rgba(255,190,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return toTex(c, true);
  })(),
  transparent: true, depthWrite: false, fog: false
}));
sunSprite.scale.set(300, 300, 1);
scene.add(sunSprite);

/* ------------------------------------------------------------- terrain -- */
STRIP_H = lowHeight(STRIP.x, STRIP.z);

(function buildTerrain() {
  const SEG = 300;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 160, uv.getY(i) * 160);
  const colors = new Float32Array(pos.count * 3);
  const cGrassA = new THREE.Color(0x3f6b31), cGrassB = new THREE.Color(0x67943f);
  const cDirt = new THREE.Color(0x7a6242), cRock = new THREE.Color(0x8d867a);
  const cSand = new THREE.Color(0xcfc094), cSnow = new THREE.Color(0xf4f6f9);
  const col = new THREE.Color(), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const sl = Math.hypot(
      terrainHeight(x + 3, z) - terrainHeight(x - 3, z),
      terrainHeight(x, z + 3) - terrainHeight(x, z - 3)) / 6;
    col.copy(cGrassA).lerp(cGrassB, vnoise(x * 0.02, z * 0.02));
    const dirtN = vnoise(x * 0.004 + 7.3, z * 0.004 + 2.1);
    if (dirtN > 0.56) col.lerp(cDirt, smoothstep(0.56, 0.72, dirtN) * 0.85);
    col.lerp(cRock, smoothstep(0.35, 0.7, sl));
    col.lerp(tmp.copy(cSand), 1 - smoothstep(WATER_Y + 0.8, WATER_Y + 3.2, h));
    col.lerp(tmp.copy(cSnow), smoothstep(56 + vnoise(x * 0.01, z * 0.01) * 8, 68, h));
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0,
    map: grassDetail, bumpMap: grassDetail, bumpScale: 0.5, envMapIntensity: 0.3
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
})();

// water
const waterMat = new THREE.MeshStandardMaterial({
  color: 0x0e4d7e, transparent: true, opacity: 0.88,
  roughness: 0.08, metalness: 0.55,
  normalMap: waterNormalTex, normalScale: new THREE.Vector2(0.5, 0.5),
  envMapIntensity: 1.2
});
(function buildWater() {
  const geo = new THREE.PlaneGeometry(WORLD * 1.4, WORLD * 1.4, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 220, uv.getY(i) * 220);
  const mesh = new THREE.Mesh(geo, waterMat);
  mesh.position.y = WATER_Y;
  scene.add(mesh);
})();

/* ---------------------------------------------------------------- road -- */
const ROAD_SEGS = 720;
let lampHeadMat, roadMat;
(function buildRoad() {
  const pts = [];
  for (let i = 0; i <= ROAD_SEGS; i++) {
    const t = i / ROAD_SEGS;
    const c = roadPoint(t);
    const tan = roadTangent(t);
    pts.push({ c, nrm: new THREE.Vector3(-tan.z, 0, tan.x) });
  }
  function ribbon(halfW, lift, mat, dashEvery, withUV) {
    const verts = [], uvs = [], idx = [];
    let vAcc = 0;
    for (let i = 0; i <= ROAD_SEGS; i++) {
      const { c, nrm } = pts[i];
      if (i > 0) vAcc += c.distanceTo(pts[i - 1].c) / 14;
      const l = c.clone().addScaledVector(nrm, -halfW);
      const r = c.clone().addScaledVector(nrm, halfW);
      l.y = terrainHeight(l.x, l.z) + lift;
      r.y = terrainHeight(r.x, r.z) + lift;
      verts.push(l.x, l.y, l.z, r.x, r.y, r.z);
      uvs.push(0, vAcc, 1, vAcc);
    }
    for (let i = 0; i < ROAD_SEGS; i++) {
      if (dashEvery && (i % dashEvery) >= dashEvery / 2) continue;
      const a = i * 2, b = i * 2 + 1, c2 = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c2, b, d, c2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    if (withUV) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex, bumpMap: asphaltBump, bumpScale: 0.15,
    roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 0.5
  });
  ribbon(ROAD_HALF, 0.10, roadMat, 0, true);
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf0ecd8, roughness: 0.8, side: THREE.DoubleSide, envMapIntensity: 0.3
  });
  ribbon(0.20, 0.16, lineMat, 6, false);
  for (const s of [-1, 1]) {
    const verts = [], idx = [];
    for (let i = 0; i <= ROAD_SEGS; i++) {
      const { c, nrm } = pts[i];
      const a = c.clone().addScaledVector(nrm, s * (ROAD_HALF - 0.55));
      const b = c.clone().addScaledVector(nrm, s * (ROAD_HALF - 0.18));
      a.y = terrainHeight(a.x, a.z) + 0.15; b.y = terrainHeight(b.x, b.z) + 0.15;
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (let i = 0; i < ROAD_SEGS; i++) {
      const a = i * 2, b = i * 2 + 1, c2 = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c2, b, d, c2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, lineMat));
  }
  // street lamps around the loop (emissive heads glow at night via bloom)
  const lampCount = 48;
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 7.5, 8);
  poleGeo.translate(0, 3.75, 0);
  const poles = new THREE.InstancedMesh(poleGeo,
    new THREE.MeshStandardMaterial({ color: 0x5a616c, roughness: 0.5, metalness: 0.7 }), lampCount);
  const headGeo = new THREE.BoxGeometry(0.6, 0.18, 0.32);
  headGeo.translate(0, 7.4, 0);
  lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xdedbd0, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4
  });
  const heads = new THREE.InstancedMesh(headGeo, lampHeadMat, lampCount);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < lampCount; i++) {
    const t = i / lampCount;
    const c = roadPoint(t), tan = roadTangent(t);
    const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
    const p = c.clone().addScaledVector(nrm, (i % 2 ? 1 : -1) * (ROAD_HALF + 1.6));
    m4.makeRotationY(Math.atan2(tan.x, tan.z)).setPosition(p.x, terrainHeight(p.x, p.z), p.z);
    poles.setMatrixAt(i, m4);
    heads.setMatrixAt(i, m4);
  }
  poles.castShadow = true;
  scene.add(poles); scene.add(heads);
})();

/* ------------------------------------------------- downtown streets ----- */
let spokeRoadMat;
(function buildCityStreets() {
  // concrete plaza that conforms to the (flat) city plateau
  const floorGeo = new THREE.RingGeometry(0.5, CITY_R + 4, 72, 10);
  floorGeo.rotateX(-Math.PI / 2);
  const fp = floorGeo.attributes.position, fuv = floorGeo.attributes.uv;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i), z = fp.getZ(i);
    fp.setY(i, terrainHeight(x, z) + 0.07);
    fuv.setXY(i, x / 14, z / 14);
  }
  floorGeo.computeVertexNormals();
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
    map: asphaltTex, bumpMap: asphaltBump, bumpScale: 0.12, color: 0x9a9ea6,
    roughness: 0.82, metalness: 0.05, envMapIntensity: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
  }));
  floor.receiveShadow = true;
  scene.add(floor);

  // spoke roads out to the highway
  spokeRoadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex, bumpMap: asphaltBump, bumpScale: 0.15,
    roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 0.5,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0ecd8, roughness: 0.8, side: THREE.DoubleSide });
  for (const sp of SPOKES) {
    const r0 = CITY_R - 6, r1 = sp.r1 - ROAD_HALF * 0.6;
    const n = Math.ceil((r1 - r0) / 4);
    const nx = -sp.cz, nz = sp.cx;
    const verts = [], uvs = [], idx = [], lv = [], lidx = [];
    for (let i = 0; i <= n; i++) {
      const r = lerp(r0, r1, i / n);
      const cx = sp.cx * r, cz = sp.cz * r;
      for (const s of [-1, 1]) {
        const x = cx + nx * s * ROAD_HALF, z = cz + nz * s * ROAD_HALF;
        verts.push(x, terrainHeight(x, z) + 0.09, z);
        uvs.push(s < 0 ? 0 : 1, r / 14);
      }
      for (const s of [-1, 1]) {
        const x = cx + nx * s * 0.18, z = cz + nz * s * 0.18;
        lv.push(x, terrainHeight(x, z) + 0.15, z);
      }
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        if (i % 6 < 3) lidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, spokeRoadMat); m.receiveShadow = true;
    scene.add(m);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lv), 3));
    lg.setIndex(lidx); lg.computeVertexNormals();
    scene.add(new THREE.Mesh(lg, lineMat));
  }
})();

/* ------------------------------------------------------- stunt ramps ---- */
const CLEAR_ZONES = [];     // keep trees & rocks out of these circles
function isClear(x, z) {
  for (const c of CLEAR_ZONES) if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < c.r * c.r) return false;
  return true;
}
const hazardTex = (() => {
  const [c, g] = makeCanvas(128);
  g.fillStyle = '#f2b41c'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#16171a';
  for (let i = -128; i < 256; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 + 128, 128); g.lineTo(i + 128, 128); g.fill();
  }
  return toTex(c, true);
})();
function buildRampMesh(r) {
  const N = 12, pos = [], idx = [], uv = [];
  // top surface strip, then two side walls and the back wall
  for (let i = 0; i <= N; i++) {
    const u = i / N, y = Math.pow(u, 1.6) * r.h;
    pos.push(-r.hw, y, u * r.len, r.hw, y, u * r.len);
    uv.push(0, u * 3, 1, u * 3);
  }
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  top.setIndex(idx); top.computeVertexNormals();
  const sidePos = [], sideIdx = [];
  for (const sx of [-1, 1]) {
    const o = sidePos.length / 3;
    for (let i = 0; i <= N; i++) {
      const u = i / N, y = Math.pow(u, 1.6) * r.h;
      sidePos.push(sx * r.hw, -2.5, u * r.len, sx * r.hw, y, u * r.len);
    }
    for (let i = 0; i < N; i++) {
      const a = o + i * 2;
      if (sx > 0) sideIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else sideIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const o = sidePos.length / 3;
  sidePos.push(-r.hw, -2.5, r.len, r.hw, -2.5, r.len, -r.hw, r.h, r.len, r.hw, r.h, r.len);
  sideIdx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
  side.setIndex(sideIdx); side.computeVertexNormals();
  const grp = new THREE.Group();
  const topMesh = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6, metalness: 0.2 }));
  const sideMesh = new THREE.Mesh(side, new THREE.MeshStandardMaterial({ color: 0x4b5058, roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide }));
  topMesh.castShadow = sideMesh.castShadow = true;
  topMesh.receiveShadow = true;
  grp.add(topMesh, sideMesh);
  grp.position.set(r.x, r.base, r.z);
  grp.rotation.y = Math.atan2(r.dx, r.dz);
  // danger sign on a post beside the kicker
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), new THREE.MeshStandardMaterial({
    map: labelTex('DANGER', '#f2b41c', '#16171a'), side: THREE.DoubleSide, roughness: 0.6 }));
  sign.position.set(r.hw + 2.5, 3.6, 2);
  sign.rotation.y = Math.PI;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a616c, metalness: 0.6, roughness: 0.5 }));
  post.position.set(r.hw + 2.5, 1.5, 2.05);
  grp.add(sign, post);
  scene.add(grp);
}
// where an event's start marker stands in the world
function eventMarkerPos(e) {
  if (e.at) return new THREE.Vector3(e.at[0], terrainHeight(e.at[0], e.at[1]), e.at[1]);
  if (e.points) return new THREE.Vector3(e.points[0][0], terrainHeight(e.points[0][0], e.points[0][1]), e.points[0][1]);
  const t = ((e.t0 - 0.012) % 1 + 1) % 1;
  const c = roadPoint(t), tan = roadTangent(t);
  const x = c.x + tan.z * (ROAD_HALF + 11), z = c.z - tan.x * (ROAD_HALF + 11);   // outer shoulder
  return new THREE.Vector3(x, terrainHeight(x, z), z);
}
function labelTex(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 176;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 176);
  g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(8, 8, 240, 160);
  g.fillStyle = fg;
  g.beginPath(); g.moveTo(128, 26); g.lineTo(176, 104); g.lineTo(80, 104); g.closePath(); g.fill();
  g.fillStyle = bg; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.fillText('!', 128, 98);
  g.fillStyle = fg; g.font = 'bold 36px sans-serif'; g.fillText(text, 128, 150);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  return t;
}
(function buildRamps() {
  for (const j of VH.CONTENT.JUMPS) {
    let x, z, dx, dz;
    if (j.t !== undefined) {
      const c = roadPoint(j.t), tan = roadTangent(j.t);
      const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
      x = c.x + nrm.x * j.side * (ROAD_HALF + 5.5); z = c.z + nrm.z * j.side * (ROAD_HALF + 5.5);
      dx = tan.x; dz = tan.z;
    } else if (j.spoke !== undefined) {
      const sp = SPOKES[j.spoke];
      const r = lerp(sp.r0 + 30, sp.r1 - 20, j.u);
      x = sp.cx * r; z = sp.cz * r; dx = sp.cx; dz = sp.cz;   // launch outwards
    } else {
      x = j.at[0]; z = j.at[1]; dx = j.dir[0]; dz = j.dir[1];
    }
    const r = addRamp(x, z, dx, dz, j);
    buildRampMesh(r);
    CLEAR_ZONES.push({ x: r.cx, z: r.cz, r: 16 });
    CLEAR_ZONES.push({ x: r.x + dx * 50, z: r.z + dz * 50, r: 38 });   // landing zone
  }
  for (const e of VH.CONTENT.EVENTS) {
    if (e.points) for (const p of e.points) CLEAR_ZONES.push({ x: p[0], z: p[1], r: 16 });
    const m = eventMarkerPos(e);
    CLEAR_ZONES.push({ x: m.x, z: m.z, r: 22 });
  }
})();

/* ----------------------------------------------------------- city ------- */
const buildings = [];
let buildingMat;
(function buildCity() {
  const geos = [];
  function pushBox(x, z, w, h, d) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, CITY_H + h / 2, z);
    // UVs: tile windows on sides (5 m per column, 3.4 m per floor); roofs plain
    const uv = g.attributes.uv, nrm = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(nrm.getY(i)) > 0.5) { uv.setXY(i, 0.005, 0.005); continue; }
      const horiz = Math.abs(nrm.getX(i)) > 0.5 ? d : w;
      uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(horiz / 5)),
                  uv.getY(i) * Math.max(1, Math.round(h / 3.4)));
    }
    geos.push(g.toNonIndexed());
    buildings.push({ x, z, hw: w / 2, hd: d / 2, h });
  }
  for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 3; gz++) {
    if (gx === 0 && gz === 0) continue;
    const x = gx * 44 + (hash2(gx, gz) - 0.5) * 8;
    const z = gz * 44 + (hash2(gz, gx) - 0.5) * 8;
    if (Math.hypot(x, z) > CITY_R - 18) continue;
    const w = 16 + hash2(gx + 9, gz) * 10;
    const d = 16 + hash2(gx, gz + 9) * 10;
    let h = 18 + hash2(gx + 5, gz + 5) * 62;
    if (hash2(gx + 2, gz + 4) > 0.8) h += 40;         // a few real towers
    pushBox(x, z, w, h, d);
    if (h > 70) pushBox(x, z, w * 0.55, h + 18, d * 0.55);  // stepped crown
  }
  // merge into a single mesh
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const posArr = new Float32Array(total * 3), nrmArr = new Float32Array(total * 3), uvArr = new Float32Array(total * 2);
  let o = 0;
  for (const g of geos) {
    posArr.set(g.attributes.position.array, o * 3);
    nrmArr.set(g.attributes.normal.array, o * 3);
    uvArr.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nrmArr, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  buildingMat = new THREE.MeshStandardMaterial({
    map: facadeMaps.map, emissiveMap: facadeMaps.emissive,
    emissive: 0xffffff, emissiveIntensity: 0,
    roughness: 0.55, metalness: 0.35, envMapIntensity: 0.7
  });
  const mesh = new THREE.Mesh(merged, buildingMat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  // plaza monument
  const mon = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.4, 26, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.5, envMapIntensity: 0.6 }));
  mon.position.set(0, CITY_H + 13, 0); mon.castShadow = true;
  scene.add(mon);
  buildings.push({ x: 0, z: 0, hw: 3.4, hd: 3.4, h: 26 });
})();

/* ----------------------------------------------------------- airfield --- */
(function buildAirfield() {
  const g = new THREE.PlaneGeometry(STRIP.hl * 2, STRIP.hw * 2);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 36, uv.getY(i) * 4);
  const strip = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    map: asphaltTex, bumpMap: asphaltBump, bumpScale: 0.12,
    color: 0xb9babd, roughness: 0.9, envMapIntensity: 0.4
  }));
  strip.position.set(STRIP.x, STRIP_H + 0.12, STRIP.z);
  strip.receiveShadow = true;
  scene.add(strip);
  const dashGeo = new THREE.PlaneGeometry(14, 1.1); dashGeo.rotateX(-Math.PI / 2);
  const dashes = new THREE.InstancedMesh(dashGeo,
    new THREE.MeshStandardMaterial({ color: 0xf0ecd8, roughness: 0.85 }), 16);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 16; i++) {
    m4.makeTranslation(STRIP.x - STRIP.hl + 30 + i * 31, STRIP_H + 0.18, STRIP.z);
    dashes.setMatrixAt(i, m4);
  }
  scene.add(dashes);
  const hangar = new THREE.Mesh(new THREE.BoxGeometry(34, 12, 26),
    new THREE.MeshStandardMaterial({ color: 0x9c4436, roughness: 0.75, envMapIntensity: 0.5 }));
  hangar.position.set(STRIP.x - 80, STRIP_H + 6, STRIP.z + STRIP.hw + 26);
  hangar.castShadow = hangar.receiveShadow = true;
  scene.add(hangar);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 34, 3, 1),
    new THREE.MeshStandardMaterial({ color: 0x8a3c30, roughness: 0.8 }));
  roof.rotation.z = Math.PI / 2; roof.rotation.x = Math.PI;
  roof.position.set(STRIP.x - 80, STRIP_H + 12, STRIP.z + STRIP.hw + 26);
  scene.add(roof);
  buildings.push({ x: hangar.position.x, z: hangar.position.z, hw: 17, hd: 13, h: 14, base: STRIP_H });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 26, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.6, envMapIntensity: 0.6 }));
  tower.position.set(STRIP.x + 120, STRIP_H + 13, STRIP.z + STRIP.hw + 22);
  tower.castShadow = true;
  scene.add(tower);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(11, 5, 11),
    new THREE.MeshStandardMaterial({ color: 0x27394f, roughness: 0.15, metalness: 0.85, envMapIntensity: 1.1 }));
  cab.position.set(STRIP.x + 120, STRIP_H + 28.5, STRIP.z + STRIP.hw + 22);
  scene.add(cab);
  buildings.push({ x: tower.position.x, z: tower.position.z, hw: 5.5, hd: 5.5, h: 32, base: STRIP_H });
})();

/* --------------------------------------------------------- vegetation --- */
const treeGrid = new Map();
(function buildNature() {
  const N = 1500;
  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.5, 3.6, 7); trunkGeo.translate(0, 1.8, 0);
  // layered conifer
  const cone1 = new THREE.ConeGeometry(3.0, 5.4, 8); cone1.translate(0, 5.4, 0);
  const cone2 = new THREE.ConeGeometry(2.3, 4.6, 8); cone2.translate(0, 8.2, 0);
  const cone3 = new THREE.ConeGeometry(1.5, 3.6, 8); cone3.translate(0, 10.8, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo,
    new THREE.MeshStandardMaterial({ color: 0x5e4128, roughness: 1 }), N);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, envMapIntensity: 0.25 });
  const l1 = new THREE.InstancedMesh(cone1, leafMat, N);
  const l2 = new THREE.InstancedMesh(cone2, leafMat, N);
  const l3 = new THREE.InstancedMesh(cone3, leafMat, N);
  const blobGeo = new THREE.IcosahedronGeometry(2.6, 1); blobGeo.translate(0, 5.2, 0);
  const blobs = new THREE.InstancedMesh(blobGeo, leafMat, N);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  let placed = 0, blobCount = 0, tries = 0;
  const e = new THREE.Euler();
  while (placed < N && tries < N * 30) {
    tries++;
    const x = (hash2(tries, 17) - 0.5) * (WORLD - 200);
    const z = (hash2(tries, 71) - 0.5) * (WORLD - 200);
    const h = terrainHeight(x, z);
    if (h < WATER_Y + 2 || h > 55) continue;
    if (roadDistInfo(x, z).d < 24) continue;
    const si = spokeInfo(x, z);
    if (si && si.d < 20) continue;
    if (Math.hypot(x, z) < CITY_R + 30) continue;
    if (!isClear(x, z)) continue;
    if (Math.abs(x - STRIP.x) < STRIP.hl + 50 && Math.abs(z - STRIP.z) < STRIP.hw + 60) continue;
    const s = 0.65 + hash2(tries, 5) * 0.95;
    e.set((hash2(tries, 13) - 0.5) * 0.08, hash2(tries, 9) * TAU, (hash2(tries, 15) - 0.5) * 0.08);
    m4.makeRotationFromEuler(e).scale(new THREE.Vector3(s, s, s)).setPosition(x, h - 0.2, z);
    trunks.setMatrixAt(placed, m4);
    col.setHSL(0.29 + hash2(tries, 4) * 0.09, 0.42 + hash2(tries, 6) * 0.2, 0.22 + hash2(tries, 8) * 0.1);
    const deciduous = vnoise(x * 0.003, z * 0.003) > 0.55;
    if (deciduous) {
      blobs.setMatrixAt(blobCount, m4);
      blobs.setColorAt(blobCount, col);
      blobCount++;
      l1.setMatrixAt(placed, new THREE.Matrix4().makeScale(0, 0, 0));
      l2.setMatrixAt(placed, new THREE.Matrix4().makeScale(0, 0, 0));
      l3.setMatrixAt(placed, new THREE.Matrix4().makeScale(0, 0, 0));
    } else {
      l1.setMatrixAt(placed, m4); l1.setColorAt(placed, col);
      l2.setMatrixAt(placed, m4); l2.setColorAt(placed, col);
      l3.setMatrixAt(placed, m4); l3.setColorAt(placed, col);
    }
    const key = Math.floor(x / 40) + ',' + Math.floor(z / 40);
    if (!treeGrid.has(key)) treeGrid.set(key, []);
    treeGrid.get(key).push({ x, z });
    placed++;
  }
  trunks.count = l1.count = l2.count = l3.count = placed;
  blobs.count = blobCount;
  for (const im of [trunks, l1, l2, l3, blobs]) {
    im.castShadow = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    scene.add(im);
  }

  // rocks
  const R = 300;
  const rockGeo = new THREE.DodecahedronGeometry(1.6, 1);
  const rocks = new THREE.InstancedMesh(rockGeo,
    new THREE.MeshStandardMaterial({ color: 0x8d867a, roughness: 0.95, envMapIntensity: 0.3 }), R);
  let rp = 0;
  for (let i = 0; i < R * 20 && rp < R; i++) {
    const x = (hash2(i, 101) - 0.5) * (WORLD - 200);
    const z = (hash2(i, 202) - 0.5) * (WORLD - 200);
    const h = terrainHeight(x, z);
    if (h < WATER_Y + 1 || roadDistInfo(x, z).d < 18 || Math.hypot(x, z) < CITY_R + 20) continue;
    const si = spokeInfo(x, z);
    if ((si && si.d < 16) || !isClear(x, z)) continue;
    if (Math.abs(x - STRIP.x) < STRIP.hl + 40 && Math.abs(z - STRIP.z) < STRIP.hw + 50) continue;
    const s = 0.5 + hash2(i, 7) * 2.4;
    m4.makeRotationY(hash2(i, 3) * TAU).scale(new THREE.Vector3(s, s * 0.65, s)).setPosition(x, h + 0.2, z);
    rocks.setMatrixAt(rp++, m4);
  }
  rocks.count = rp; rocks.castShadow = true;
  scene.add(rocks);
})();

/* ------------------------------------------------------------- clouds --- */
const cloudGroup = new THREE.Group();
(function buildClouds() {
  for (let i = 0; i < 60; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudSprite, transparent: true, depthWrite: false,
      opacity: 0.5 + hash2(i, 3) * 0.35, fog: false
    }));
    const a = hash2(i, 11) * TAU, r = 250 + hash2(i, 22) * 1500;
    const s = 90 + hash2(i, 33) * 150;
    sp.position.set(Math.cos(a) * r, 250 + hash2(i, 44) * 160, Math.sin(a) * r);
    sp.scale.set(s, s * 0.42, 1);
    cloudGroup.add(sp);
  }
  scene.add(cloudGroup);
})();

/* --------------------------------------------------------- particle fx -- */
const MAXP = 420;
const pData = {
  pos: new Float32Array(MAXP * 3), vel: new Float32Array(MAXP * 3),
  life: new Float32Array(MAXP), maxLife: new Float32Array(MAXP),
  next: 0
};
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pData.pos, 3));
pGeo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(MAXP), 1));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAXP), 1));
pGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
const pMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uMap: { value: particleSprite } },
  vertexShader: `
    attribute float aLife; attribute float aSize; attribute vec3 aColor;
    varying float vLife; varying vec3 vColor;
    void main() {
      vLife = aLife; vColor = aColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (2.0 - aLife) * (190.0 / max(1.0, -mv.z));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform sampler2D uMap;
    varying float vLife; varying vec3 vColor;
    void main() {
      vec4 tex = texture2D(uMap, gl_PointCoord);
      gl_FragColor = vec4(vColor, tex.a * vLife * 0.55);
    }`
});
const pMesh = new THREE.Points(pGeo, pMat);
pMesh.frustumCulled = false;
scene.add(pMesh);
function spawnParticle(x, y, z, vx, vy, vz, life, size, r, g, b) {
  const i = pData.next; pData.next = (pData.next + 1) % MAXP;
  pData.pos[i * 3] = x; pData.pos[i * 3 + 1] = y; pData.pos[i * 3 + 2] = z;
  pData.vel[i * 3] = vx; pData.vel[i * 3 + 1] = vy; pData.vel[i * 3 + 2] = vz;
  pData.life[i] = life; pData.maxLife[i] = life;
  pGeo.attributes.aSize.setX(i, size);
  pGeo.attributes.aColor.setXYZ(i, r, g, b);
}
function stepParticles(dt) {
  const lifeAttr = pGeo.attributes.aLife;
  for (let i = 0; i < MAXP; i++) {
    if (pData.life[i] <= 0) { lifeAttr.setX(i, 0); continue; }
    pData.life[i] -= dt;
    pData.pos[i * 3] += pData.vel[i * 3] * dt;
    pData.pos[i * 3 + 1] += pData.vel[i * 3 + 1] * dt;
    pData.pos[i * 3 + 2] += pData.vel[i * 3 + 2] * dt;
    pData.vel[i * 3 + 1] += 1.6 * dt;
    lifeAttr.setX(i, Math.max(0, pData.life[i] / pData.maxLife[i]));
  }
  pGeo.attributes.position.needsUpdate = true;
  lifeAttr.needsUpdate = true;
  pGeo.attributes.aSize.needsUpdate = true;
  pGeo.attributes.aColor.needsUpdate = true;
}

/* ------------------------------------------------------ vehicle meshes -- */
function paintMat(color) {
  return new THREE.MeshPhysicalMaterial({
    color, metalness: 0.5, roughness: 0.34,
    clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 0.9
  });
}
function glassMat() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x0c1119, metalness: 1.0, roughness: 0.05, envMapIntensity: 1.4
  });
}
function darkMat() {
  return new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.6, metalness: 0.3 });
}
function chromeMat() {
  return new THREE.MeshStandardMaterial({ color: 0xd7dce4, roughness: 0.14, metalness: 1.0, envMapIntensity: 1.2 });
}
function shadowify(g) { g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g; }

function extrudeProfile(pts, width, mat, bevel) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9,
    bevelSegments: 3, steps: 1
  });
  geo.rotateY(-Math.PI / 2);              // profile length axis -> world Z
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(-(bb.min.x + bb.max.x) / 2, 0, 0);   // centre width
  return new THREE.Mesh(geo, mat);
}

function buildWheel(r, w) {
  const grp = new THREE.Group();
  const tireGeo = new THREE.CylinderGeometry(r, r, w, 22);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.92 }));
  grp.add(tire);
  const rimGeo = new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.03, 14);
  rimGeo.rotateZ(Math.PI / 2);
  grp.add(new THREE.Mesh(rimGeo, chromeMat()));
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, r * 1.02, r * 0.16), chromeMat());
    spoke.rotation.x = (i / 5) * Math.PI;
    grp.add(spoke);
  }
  return grp;
}

const CAR_PROFILES = {
  sports: {
    body: [[2.30, 0.30], [2.28, 0.55], [1.45, 0.62], [0.92, 0.66], [-1.55, 0.70], [-2.28, 0.64], [-2.30, 0.32]],
    glass: [[0.90, 0.63], [0.42, 1.06], [-0.62, 1.10], [-1.42, 0.66]],
    width: 1.94, wheelR: 0.35, wb: 1.42, tw: 0.86
  },
  muscle: {
    body: [[2.35, 0.34], [2.33, 0.66], [1.15, 0.74], [0.85, 0.76], [-1.45, 0.80], [-2.32, 0.74], [-2.35, 0.36]],
    glass: [[0.82, 0.73], [0.40, 1.12], [-0.72, 1.15], [-1.35, 0.76]],
    width: 1.96, wheelR: 0.37, wb: 1.45, tw: 0.86
  },
  suv: {
    body: [[2.20, 0.42], [2.18, 0.88], [1.30, 0.95], [0.95, 0.98], [-1.95, 1.00], [-2.18, 0.92], [-2.20, 0.46]],
    glass: [[0.92, 0.95], [0.55, 1.55], [-1.62, 1.58], [-1.95, 0.98]],
    width: 1.98, wheelR: 0.44, wb: 1.40, tw: 0.84
  }
};

function buildCar(cfg) {
  const prof = CAR_PROFILES[cfg.profile || 'sports'];
  const g = new THREE.Group();
  const paint = paintMat(cfg.color);
  const body = extrudeProfile(prof.body, prof.width * 0.74, paint, 0.09);
  g.add(body);
  const glass = extrudeProfile(prof.glass, prof.width * 0.58, glassMat(), 0.05);
  g.add(glass);
  // underbody
  const under = new THREE.Mesh(new THREE.BoxGeometry(prof.width * 0.9, 0.16, 4.1), darkMat());
  under.position.y = 0.22;
  g.add(under);
  // splitter & diffuser
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(prof.width * 0.92, 0.09, 0.5), darkMat());
  splitter.position.set(0, 0.2, 2.2);
  const diffuser = splitter.clone(); diffuser.position.z = -2.2;
  g.add(splitter, diffuser);
  // mirrors
  for (const s of [-1, 1]) {
    const mr = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.14), paint);
    mr.position.set(s * (prof.width * 0.37 + 0.1), prof.glass[0][1] + 0.22, prof.glass[0][0] - 0.15);
    g.add(mr);
  }
  // spoiler
  if (cfg.spoiler) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(prof.width * 0.9, 0.06, 0.42), darkMat());
    sp.position.set(0, prof.body[4][1] + 0.34, -2.05);
    g.add(sp);
    for (const s of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.12), darkMat());
      st.position.set(s * 0.62, prof.body[4][1] + 0.16, -2.05);
      g.add(st);
    }
  }
  // lights
  const hlMat = new THREE.MeshStandardMaterial({
    color: 0xfff7d8, emissive: 0xfff3bd, emissiveIntensity: 1.4, roughness: 0.2
  });
  const tlMat = new THREE.MeshStandardMaterial({
    color: 0x60080a, emissive: 0xd8161a, emissiveIntensity: 1.6, roughness: 0.25
  });
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.13, 0.1), hlMat);
    hl.position.set(s * 0.62, prof.body[1][1] - 0.04, prof.body[0][0] + 0.02);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.08), tlMat);
    tl.position.set(s * 0.6, prof.body[5][1] + 0.02, prof.body[6][0] - 0.02);
    g.add(hl, tl);
    // exhaust
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.22, 10), chromeMat());
    ex.rotation.x = Math.PI / 2;
    ex.position.set(s * 0.42, 0.26, -2.28);
    g.add(ex);
  }
  // wheels
  const wheels = [], steer = [];
  for (const [sx, sz, isF] of [[1, 1, 1], [-1, 1, 1], [1, -1, 0], [-1, -1, 0]]) {
    const w = buildWheel(prof.wheelR, 0.28);
    const pivot = new THREE.Group();
    pivot.position.set(sx * (prof.width * 0.5 - 0.10), prof.wheelR, sz * prof.wb);
    pivot.add(w);
    g.add(pivot);
    wheels.push(w);
    if (isF) steer.push(pivot);
  }
  return { group: shadowify(g), wheels, steer, props: [] };
}

function buildBike(cfg) {
  const g = new THREE.Group();
  const paint = paintMat(cfg.color);
  // wheels: torus tires
  const wheels = [];
  for (const z of [0.98, -0.98]) {
    const grp = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.095, 12, 24),
      new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.9 }));
    grp.add(tire);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.05, 16), chromeMat());
    disc.rotation.z = Math.PI / 2;
    grp.add(disc);
    grp.position.set(0, 0.43, z);
    g.add(grp);
    wheels.push(grp);
  }
  // frame + tank + tail
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 1.5), darkMat());
  frame.position.set(0, 0.72, -0.05); frame.rotation.x = 0.06;
  g.add(frame);
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), paint);
  tank.scale.set(0.68, 0.62, 1.15); tank.position.set(0, 0.98, 0.28);
  g.add(tank);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.62), paint);
  tail.position.set(0, 1.0, -0.72); tail.rotation.x = -0.12;
  g.add(tail);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.5), darkMat());
  seat.position.set(0, 0.95, -0.3);
  g.add(seat);
  // front fork
  for (const s of [-1, 1]) {
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8), chromeMat());
    fork.position.set(s * 0.1, 0.78, 0.86); fork.rotation.x = -0.42;
    g.add(fork);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.05, 0.05), darkMat());
  bar.position.set(0, 1.14, 0.72);
  g.add(bar);
  // exhaust
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.8, 10), chromeMat());
  ex.rotation.x = Math.PI / 2 - 0.15; ex.position.set(0.16, 0.52, -0.55);
  g.add(ex);
  // rider
  const suit = new THREE.MeshStandardMaterial({ color: 0x1d2430, roughness: 0.75 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.32), suit);
  torso.position.set(0, 1.36, -0.16); torso.rotation.x = 0.55;
  g.add(torso);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), paintMat(cfg.color));
  helmet.position.set(0, 1.66, 0.14);
  g.add(helmet);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.62, 8), suit);
    arm.position.set(s * 0.24, 1.32, 0.32); arm.rotation.x = 1.0; arm.rotation.z = s * 0.25;
    g.add(arm);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.16), suit);
    leg.position.set(s * 0.2, 0.82, -0.18); leg.rotation.x = 0.7;
    g.add(leg);
  }
  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.07),
    new THREE.MeshStandardMaterial({ color: 0xfff7d8, emissive: 0xfff3bd, emissiveIntensity: 1.4 }));
  hl.position.set(0, 0.98, 1.06);
  g.add(hl);
  return { group: shadowify(g), wheels, steer: [], props: [] };
}

function buildPlane(cfg) {
  const g = new THREE.Group();
  const paint = paintMat(cfg.color);
  // fuselage — smooth lathe body
  const profile = cfg.jet
    ? [[0.01, -3.9], [0.14, -3.5], [0.30, -2.4], [0.44, -0.8], [0.46, 0.8], [0.36, 2.2], [0.2, 3.3], [0.02, 3.9]]
    : [[0.02, -3.3], [0.16, -2.9], [0.34, -1.9], [0.50, -0.5], [0.52, 0.7], [0.42, 1.9], [0.28, 2.7], [0.10, 3.2], [0.02, 3.3]];
  const lathe = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), 20);
  lathe.rotateX(Math.PI / 2);
  const fus = new THREE.Mesh(lathe, paint);
  fus.position.y = 1.15;
  g.add(fus);
  // wings
  const wingPts = cfg.jet
    ? [[-3.6, -1.5], [-0.7, 0.9], [0.7, 0.9], [3.6, -1.5], [3.6, -2.0], [0.6, -1.6], [-0.6, -1.6], [-3.6, -2.0]]
    : [[-4.7, 0.28], [-1.0, 0.85], [1.0, 0.85], [4.7, 0.28], [4.7, -0.15], [1.0, -0.8], [-1.0, -0.8], [-4.7, -0.15]];
  const wingShape = new THREE.Shape();
  wingShape.moveTo(wingPts[0][0], wingPts[0][1]);
  for (let i = 1; i < wingPts.length; i++) wingShape.lineTo(wingPts[i][0], wingPts[i][1]);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  wingGeo.rotateX(Math.PI / 2);
  const wing = new THREE.Mesh(wingGeo, paint);
  wing.position.set(0, cfg.jet ? 1.05 : 1.3, cfg.jet ? 0.4 : 0.3);
  g.add(wing);
  // tailplane
  const tp = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.09, 0.85), paint);
  tp.position.set(0, 1.28, -3.0);
  g.add(tp);
  // fin
  const finPts = [[0, 0], [0.95, 0.05], [0.55, 1.15], [0.15, 1.2]];
  const finShape = new THREE.Shape();
  finShape.moveTo(finPts[0][0], finPts[0][1]);
  for (let i = 1; i < finPts.length; i++) finShape.lineTo(finPts[i][0], finPts[i][1]);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false });
  finGeo.rotateY(-Math.PI / 2);
  const fin = new THREE.Mesh(finGeo, new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.4, metalness: 0.5 }));
  fin.position.set(0.04, 1.3, -2.6);
  g.add(fin);
  // canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 10), glassMat());
  canopy.scale.set(0.75, 0.62, 1.5);
  canopy.position.set(0, 1.62, 0.8);
  g.add(canopy);
  const props = [];
  if (cfg.jet) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 14), darkMat());
    nozzle.rotation.x = Math.PI / 2; nozzle.position.set(0, 1.15, -3.9);
    g.add(nozzle);
    const ab = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.6, 10),
      new THREE.MeshStandardMaterial({ color: 0xff9540, emissive: 0xff6a1f, emissiveIntensity: 2.6, transparent: true, opacity: 0.85 }));
    ab.rotation.x = -Math.PI / 2; ab.position.set(0, 1.15, -4.6);
    g.add(ab);
    props.push(ab);
  } else {
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 10), chromeMat());
    spinner.rotation.x = Math.PI / 2; spinner.position.set(0, 1.15, 3.45);
    g.add(spinner);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.7, 0.18), darkMat());
    prop.position.set(0, 1.15, 3.42);
    g.add(prop);
    props.push(prop);
  }
  // landing gear
  const wheels = [];
  for (const [x, z] of [[1.1, 0.9], [-1.1, 0.9], [0, -2.6]]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 8), chromeMat());
    strut.position.set(x, 0.55, z);
    const wGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 12);
    wGeo.rotateZ(Math.PI / 2);
    const w = new THREE.Mesh(wGeo, new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.9 }));
    w.position.set(x, 0.28, z);
    g.add(strut, w);
    wheels.push(w);
  }
  return { group: shadowify(g), wheels, steer: [], props };
}

/* ----------------------------------------------- real high-poly car ----- */
// Ferrari 458 Italia (~340k vertices) by vicent091036, from the three.js
// examples — decoded from the embedded base64 glb at startup.
let carTemplate = null;
function decodeGLB(b64, onLoad, label) {
  if (!b64 || !THREE.GLTFLoader) return;
  try {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const loader = new THREE.GLTFLoader();
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
    loader.parse(buf.buffer, '', onLoad, (e) => console.warn(label + ' parse failed', e));
  } catch (e) { console.warn(label + ' decode failed', e); }
}
decodeGLB(window.VH_CAR_GLB, (gltf) => {
  carTemplate = gltf.scene;
  window.__carModelLoaded = true;
  onModelsLoaded();
}, 'car model');

function buildCarFromGLB(cfg) {
  const g = new THREE.Group();
  const root = carTemplate.clone(true);
  // re-skin the demo model with our clearcoat paint + glass
  const body = root.getObjectByName('body');
  if (body) body.material = paintMat(cfg.color);
  const details = chromeMat();
  for (const n of ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'trim']) {
    const o = root.getObjectByName(n);
    if (o) o.material = details;
  }
  const glass = root.getObjectByName('glass');
  if (glass) glass.material = new THREE.MeshPhysicalMaterial({
    color: 0x11151c, metalness: 0.9, roughness: 0.05, envMapIntensity: 1.4,
    transparent: true, opacity: 0.32
  });
  // ground the model: wheels rest at y = 0; model faces -Z so spin it around
  const bb = new THREE.Box3().setFromObject(root);
  root.position.y -= bb.min.y;
  root.rotation.y = Math.PI;
  g.add(root);
  if (cfg.castShadow !== false) root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const wheels = [], steer = [];
  for (const n of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
    const w = root.getObjectByName(n);
    if (w) {
      wheels.push(w);
      if (n === 'wheel_fl' || n === 'wheel_fr') steer.push(w);
    }
  }
  const sw = root.getObjectByName('steering_wheel');
  return { group: g, glbRoot: root, wheels, steer, props: [], spinSign: -1, steerWheel: sw };
}

// Aerobatic stunt plane (BabylonJS free assets) — single instance, reused.
let planeBuilt = null;
decodeGLB(window.VH_PLANE_GLB, (gltf) => {
  const root = gltf.scene;
  const g = new THREE.Group();
  // The mesh is skinned and its rendered size lives in the skeleton's bind
  // matrices, so bounding boxes lie. Scale calibrated visually: ~9 m wingspan.
  root.scale.setScalar(105);
  const bb = new THREE.Box3().setFromObject(root);
  root.position.y -= bb.min.y;
  g.add(root);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const prop = root.getObjectByName('Propellor_Joint');
  planeBuilt = { group: g, glbRoot: root, wheels: [], steer: [], props: prop ? [prop] : [], shared: true };
  window.__planeModelLoaded = true;
  onModelsLoaded();
}, 'plane model');

function onModelsLoaded() {
  // swap placeholder meshes for the real models once they have decoded
  if (player.cfg && (player.cfg.glb || player.cfg.glbPlane)) setVehicle(player.vid, true);
  rebuildAIMeshes();
}

/* ======================================================================
   CONTENT · PROFILE · SETTINGS
   ====================================================================== */
const C = VH.CONTENT;
const VEHICLES = C.VEHICLES;
const vehicleById = (id) => VEHICLES.find(v => v.id === id) || VEHICLES[1];

let settings = VH.Save.loadSettings();
let profile = VH.Save.defaultProfile();
let careerLive = false;           // true once New Game / Continue is chosen

function saveProfile() {
  if (!careerLive) return;
  profile.current = player.vid;
  if (state === 'play' && !ev.active && player.grounded) {
    profile.lastPos = { x: player.pos.x, z: player.pos.z, yaw: player.yaw };
  }
  VH.Save.save(profile);
}
function upgradesOf(id) {
  if (!profile.upgrades[id]) profile.upgrades[id] = { engine: 0, handling: 0, nitro: 0 };
  return profile.upgrades[id];
}
// base vehicle + purchased upgrades + chosen paint = what the physics drives
function vehicleStats(v) {
  const up = profile.upgrades[v.id] || { engine: 0, handling: 0, nitro: 0 };
  const s = Object.assign({}, v);
  s.maxSpeed = v.maxSpeed * (1 + 0.05 * up.engine);
  s.accel = v.accel * (1 + 0.10 * up.engine);
  if (v.kind === 'plane') {
    s.turn = v.turn * (1 + 0.08 * up.handling);
  } else {
    s.grip = v.grip * (1 + 0.08 * up.handling);
    s.turn = v.turn * (1 + 0.05 * up.handling);
    s.offroad = Math.min(1, v.offroad + 0.04 * up.handling);
  }
  // linear drag chosen so the car settles at ~92% of its listed top speed
  s.drag = s.accel * 0.72 * Math.pow(0.08, 0.7) / (0.92 * s.maxSpeed);
  s.nitroBoost = 1.65 + 0.08 * up.nitro;
  s.nitroDrain = 32 * (1 - 0.12 * up.nitro);
  s.nitroRegen = 9 * (1 + 0.15 * up.nitro);
  s.color = profile.paints[v.id] !== undefined ? profile.paints[v.id] : v.color;
  return s;
}

/* ----------------------------------------------------------- the player - */
const player = {
  vid: 'bandit', cfg: null, mesh: null, wheels: [], steer: [], props: [], built: null,
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, roll: 0, visRoll: 0, visPitch: 0,
  throttleLevel: 0, grounded: true, nitro: 100, wheelSpin: 0,
  airTime: 0, lastGY: 0, rampContact: null, launch: null, recentRamp: null, recentRampT: 0,
  gear: 1, rpm: 0, slip: 0, drifting: false, nitroOn: false, speed: 0, fwdSpeed: 0,
};

const headlights = [];
(function makeHeadlights() {
  for (const s of [-1, 1]) {
    const sp = new THREE.SpotLight(0xfff2cc, 0, 130, 0.45, 0.45, 1.2);
    const tgt = new THREE.Object3D();
    scene.add(sp); scene.add(tgt);
    sp.target = tgt;
    headlights.push({ sp, tgt, side: s });
  }
})();

function disposeBuilt(b) {
  if (!b || b.shared || b.glbRoot) return;       // GLB clones share template geometry
  b.group.traverse(o => {
    if (o.isMesh) { o.geometry.dispose(); if (o.material.dispose) o.material.dispose(); }
  });
}
function setVehicle(id, keepMotion) {
  const cfg = vehicleStats(vehicleById(id));
  if (player.mesh) scene.remove(player.mesh);
  if (player.built && player.built !== planeBuilt) disposeBuilt(player.built);
  const built = (cfg.glb && carTemplate) ? buildCarFromGLB(cfg)
    : (cfg.glbPlane && planeBuilt) ? planeBuilt
    : cfg.kind === 'car' ? buildCar(cfg) : cfg.kind === 'bike' ? buildBike(cfg) : buildPlane(cfg);
  const kindChanged = !player.cfg || player.cfg.kind !== cfg.kind;
  player.vid = id;
  player.cfg = cfg;
  player.built = built;
  player.mesh = built.group;
  player.wheels = built.wheels;
  player.steer = built.steer;
  player.props = built.props;
  player.spinSign = built.spinSign || 1;
  player.steerWheel = built.steerWheel || null;
  if (!keepMotion || kindChanged) {
    player.vel.multiplyScalar(0.4);
    player.pitch = 0; player.roll = 0; player.throttleLevel = 0;
    player.grounded = true;
  }
  scene.add(player.mesh);
  player.mesh.position.copy(player.pos);
  ui.setVehicleInfo(cfg);
}

function respawnToRoad(forceT) {
  let t = forceT;
  if (t === undefined) {
    const a = Math.atan2(player.pos.z, player.pos.x);
    t = ((a / TAU) % 1 + 1) % 1;
    if (Math.hypot(player.pos.x, player.pos.z) < 1) t = 0.03;
  }
  const p = roadPoint(t), tan = roadTangent(t);
  placePlayer(p.x, p.z, Math.atan2(tan.x, tan.z));
}
function placePlayer(x, z, yaw) {
  player.pos.set(x, groundHeight(x, z) + 0.3, z);
  player.vel.set(0, 0, 0);
  player.yaw = yaw;
  player.pitch = player.roll = 0;
  player.throttleLevel = 0;
  player.grounded = true;
  player.airTime = 0; player.launch = null;
  player.lastGY = groundHeight(x, z);
  if (player.mesh) { player.mesh.position.copy(player.pos); player.mesh.rotation.set(0, yaw, 0); }
  snapCamera();
}
function teleportToAirfield() {
  placePlayer(STRIP.x - STRIP.hl + 40, STRIP.z, Math.atan2(1, 0));
  showMsg('AIRFIELD', 900);
}
function showMsg(text, ms) { ui.message(text, ms); }

/* -------------------------------------------------------------- input --- */
const keys = {};
let camMode = 0;
const pad = { on: false, throttle: 0, brake: 0, steer: 0, pitch: 0, hand: 0, nitro: 0, prev: [], pressed: [] };
function pollGamepad() {
  pad.pressed.length = 0;
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of list) if (g && g.connected) { gp = g; break; }
  if (!gp) { pad.on = false; return; }
  if (!pad.on) { pad.on = true; ui.toast('Controller connected', gp.id.slice(0, 40), 'info'); }
  const dz = (v) => Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86;
  const b = (i) => gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0;
  pad.throttle = b(7); pad.brake = b(6);
  pad.steer = -dz(gp.axes[0] || 0);
  pad.pitch = -dz(gp.axes[1] || 0);
  pad.hand = b(0) > 0.5 ? 1 : 0;
  pad.nitro = (b(2) > 0.5 || b(5) > 0.5) ? 1 : 0;
  for (let i = 0; i < gp.buttons.length; i++) {
    const on = gp.buttons[i].pressed;
    if (on && !pad.prev[i]) pad.pressed.push(i);
    pad.prev[i] = on;
  }
}
function inputAxis() {
  if (state !== 'play' || inputLocked()) return { throttle: 0, brake: 0, steer: 0, hand: 0, nitro: 0 };
  const t = (keys.KeyW || keys.ArrowUp) ? 1 : 0;
  const b = (keys.KeyS || keys.ArrowDown) ? 1 : 0;
  const l = (keys.KeyA || keys.ArrowLeft) ? 1 : 0;
  const r = (keys.KeyD || keys.ArrowRight) ? 1 : 0;
  return autopilotInput({
    throttle: Math.max(t, pad.throttle), brake: Math.max(b, pad.brake),
    steer: clamp((l - r) + pad.steer, -1, 1),
    hand: (keys.Space || pad.hand) ? 1 : 0,
    nitro: (keys.ShiftLeft || keys.ShiftRight || pad.nitro) ? 1 : 0
  });
}
function planeInput() {
  if (state !== 'play' || inputLocked()) return { thrUp: 0, thrDn: 0, pitchUp: 0, pitchDn: 0, rollL: 0, rollR: 0 };
  const inv = settings.invertPitch ? -1 : 1;
  const stickPitch = pad.pitch * inv;
  return {
    thrUp: Math.max(keys.KeyW ? 1 : 0, pad.throttle), thrDn: Math.max(keys.KeyS ? 1 : 0, pad.brake),
    pitchUp: Math.max((inv > 0 ? keys.ArrowUp : keys.ArrowDown) ? 1 : 0, Math.max(0, stickPitch)),
    pitchDn: Math.max((inv > 0 ? keys.ArrowDown : keys.ArrowUp) ? 1 : 0, Math.max(0, -stickPitch)),
    rollL: Math.max((keys.KeyA || keys.ArrowLeft) ? 1 : 0, Math.max(0, pad.steer)),
    rollR: Math.max((keys.KeyD || keys.ArrowRight) ? 1 : 0, Math.max(0, -pad.steer)),
  };
}
function inputLocked() { return ev.active && (ev.phase === 'countdown' || ev.phase === 'done'); }

/* ------------------------------------------------------------- physics -- */
const GRAV = 18;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpM = new THREE.Matrix4();
let camShake = 0;

function stepGroundVehicle(dt) {
  const cfg = player.cfg;
  const inp = inputAxis();
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const rx = fz, rz = -fx;
  let vf = player.vel.x * fx + player.vel.z * fz;
  let vr = player.vel.x * rx + player.vel.z * rz;

  const kind = surfaceKind(player.pos.x, player.pos.z);
  const onPaved = kind !== 'dirt' || player.rampContact;
  const surf = onPaved ? 1 : cfg.offroad;
  const wetGrip = 1 - weather.wet * 0.2;

  let boost = 1;
  const nitroOn = inp.nitro && player.nitro > 0 && inp.throttle > 0.1;
  if (nitroOn) {
    boost = cfg.nitroBoost; player.nitro = Math.max(0, player.nitro - cfg.nitroDrain * dt);
  } else {
    player.nitro = Math.min(100, player.nitro + cfg.nitroRegen * dt);
  }
  player.nitroOn = nitroOn;

  let drifting = false;
  if (player.grounded) {
    const maxS = cfg.maxSpeed * surf * (boost > 1 ? 1.14 : 1);
    if (inp.throttle) vf += cfg.accel * 0.72 * surf * boost * inp.throttle * dt * Math.pow(clamp(1 - vf / maxS, 0, 1), 0.7);
    if (inp.brake) {
      if (vf > 0.5) vf -= 34 * inp.brake * dt;
      else vf = Math.max(vf - 8 * inp.brake * dt, -13);
    }
    // aero/rolling drag, plus engine braking off the throttle and off-road scrub
    vf -= vf * (cfg.drag + (inp.throttle ? 0 : 0.14) + (onPaved ? 0 : 0.25 * (1 - cfg.offroad))) * dt;
    const spdFac = clamp(Math.abs(vf) / 7, 0, 1) / (1 + Math.abs(vf) * 0.014);
    let yawRate = inp.steer * cfg.turn * spdFac * Math.sign(vf || 1);
    if (inp.hand) yawRate *= 1.6;
    player.yaw += yawRate * dt;
    const grip = (inp.hand ? 1.7 : cfg.grip * (onPaved ? 1 : 0.55)) * wetGrip;
    vr *= Math.exp(-grip * dt);
    drifting = (inp.hand && Math.abs(vf) > 8) || Math.abs(vr) > 6;
    if (inp.hand && Math.abs(vf) > 8) vf -= vf * 0.35 * dt;
    const gx = (terrainHeight(player.pos.x + 1.6, player.pos.z) - terrainHeight(player.pos.x - 1.6, player.pos.z)) / 3.2;
    const gz = (terrainHeight(player.pos.x, player.pos.z + 1.6) - terrainHeight(player.pos.x, player.pos.z - 1.6)) / 3.2;
    if (!player.rampContact) vf -= GRAV * (fx * gx + fz * gz) * dt * 0.55;
  }

  player.vel.x = fx * vf + rx * vr;
  player.vel.z = fz * vf + rz * vr;
  player.vel.y -= GRAV * dt;
  player.pos.addScaledVector(player.vel, dt);

  // ground contact. While grounded the vertical speed follows the surface,
  // so crests and kicker ramps launch the car for real.
  const gY = groundHeight(player.pos.x, player.pos.z);
  const ramp = lastRamp;
  if (player.pos.y <= gY + 0.02) {
    const impactVy = -player.vel.y;
    player.pos.y = gY;
    if (player.airTime > 0.35) onLanding(impactVy);
    const follow = (gY - player.lastGY) / dt;
    player.vel.y = clamp(follow, -30, 30);
    if (impactVy > 14) { player.vel.x *= 0.7; player.vel.z *= 0.7; }
    player.grounded = true;
    player.airTime = 0;
    player.rampContact = ramp;
    if (ramp) { player.recentRamp = ramp; player.recentRampT = 0.35; }
    player.launch = null;
  } else {
    const h = player.pos.y - gY;
    if (player.grounded && h > 0.35) {
      // just left the ground — remember where, for jump distances
      player.launch = { x: player.pos.x, z: player.pos.z, ramp: player.recentRampT > 0 ? player.recentRamp : null };
    }
    player.grounded = h < 0.35;
    if (!player.grounded) player.airTime += dt;
    player.rampContact = null;
  }
  player.lastGY = gY;
  player.recentRampT -= dt;

  const impact = collideWorld() + collideDynamic();
  if (impact > 7) onImpact(impact);
  waterCheck();

  // ------- slip / drift state for the skill system
  const spd = Math.abs(vf);
  player.slip = spd > 3 ? Math.atan2(Math.abs(vr), Math.abs(vf)) : 0;
  player.drifting = player.grounded && spd > 9 && (player.slip > 0.2 || drifting);
  player.fwdSpeed = vf;

  // ------- particles
  if (player.grounded && drifting && spd > 6) {
    for (const s of [-1, 1]) {
      spawnParticle(
        player.pos.x - fx * 1.4 + rx * s * 0.8, player.pos.y + 0.25, player.pos.z - fz * 1.4 + rz * s * 0.8,
        -fx * 2 + (Math.random() - 0.5) * 2, 0.6, -fz * 2 + (Math.random() - 0.5) * 2,
        0.8 + Math.random() * 0.4, 2.6, 0.82, 0.82, 0.84);
    }
  }
  if (player.grounded && !onPaved && spd > 7 && Math.random() < 0.75) {
    const wet = weather.wet;
    spawnParticle(
      player.pos.x - fx * 1.2 + (Math.random() - 0.5), player.pos.y + 0.2, player.pos.z - fz * 1.2 + (Math.random() - 0.5),
      -fx * 3 + (Math.random() - 0.5) * 3, 1.2, -fz * 3 + (Math.random() - 0.5) * 3,
      1.0 + Math.random() * 0.6, 3.4, lerp(0.62, 0.36, wet), lerp(0.52, 0.3, wet), lerp(0.38, 0.22, wet));
  }
  if (player.grounded && onPaved && weather.wet > 0.4 && spd > 14 && Math.random() < weather.wet) {
    spawnParticle(   // road spray in the rain
      player.pos.x - fx * 2.2 + (Math.random() - 0.5) * 1.6, player.pos.y + 0.3, player.pos.z - fz * 2.2 + (Math.random() - 0.5) * 1.6,
      -fx * 4 + (Math.random() - 0.5) * 2, 1.5, -fz * 4 + (Math.random() - 0.5) * 2,
      0.6, 2.8, 0.8, 0.84, 0.9);
  }
  if (nitroOn) {
    for (const s of [-1, 1]) {
      spawnParticle(
        player.pos.x - fx * 2.3 + rx * s * 0.42, player.pos.y + 0.3, player.pos.z - fz * 2.3 + rz * s * 0.42,
        -fx * 8, 0.2, -fz * 8, 0.22, 1.3, 1.0, 0.62, 0.18);
    }
  }

  // ------- visuals
  player.wheelSpin += vf * dt / 0.36;
  const ss = player.spinSign || 1;
  for (const w of player.wheels) w.rotation.x = player.wheelSpin * ss;
  for (const p of player.steer) p.rotation.y = inp.steer * 0.42 * ss;
  if (player.steerWheel) player.steerWheel.rotation.z = inp.steer * 1.6;
  if (player.grounded) {
    const n = groundNormal(player.pos.x, player.pos.z);
    const fwd = tmpV.set(fx, 0, fz).addScaledVector(n, -n.dot(tmpV2.set(fx, 0, fz))).normalize();
    const right = tmpV2.crossVectors(n, fwd);
    tmpM.makeBasis(right, n, fwd);
    player.visPitch = 0;
  } else {
    // nose follows the flight path in the air
    const hs = Math.max(6, Math.hypot(player.vel.x, player.vel.z));
    player.visPitch = lerp(player.visPitch, clamp(Math.atan2(player.vel.y, hs) * 0.7, -0.6, 0.5), 1 - Math.exp(-3 * dt));
    const cp = Math.cos(player.visPitch), sp = Math.sin(player.visPitch);
    const fwd = tmpV.set(fx * cp, sp, fz * cp);
    const right = tmpV2.set(fz, 0, -fx);
    const up = new THREE.Vector3().crossVectors(fwd, right);
    tmpM.makeBasis(right, up, fwd);
  }
  player.mesh.quaternion.setFromRotationMatrix(tmpM);
  if (cfg.kind === 'bike') {
    const lean = clamp(-inp.steer * clamp(vf / 25, 0, 1) * 0.55 + vr * 0.02, -0.65, 0.65);
    player.visRoll = lerp(player.visRoll, lean, 1 - Math.exp(-8 * dt));
    player.mesh.rotateZ(player.visRoll);
  }
  player.mesh.position.copy(player.pos);

  // ------- gearbox (for the tacho & engine note)
  const r = clamp(spd / cfg.maxSpeed, 0, 1.2);
  const gears = cfg.kind === 'bike' ? 6 : 6;
  let gear = clamp(Math.floor(r * gears * 0.999) + 1, 1, gears);
  if (vf < -0.5) gear = 0;                       // reverse
  if (gear !== player.gear && gear > 0 && player.gear > 0) VH.Audio.shift();
  player.gear = gear;
  const inGear = gear === 0 ? clamp(-vf / 13, 0, 1) : (r * gears) - (gear - 1);
  const targetRpm = player.grounded ? clamp(0.18 + inGear * 0.8, 0.12, 1) : clamp(0.3 + inp.throttle * 0.7, 0, 1);
  player.rpm = lerp(player.rpm, spd < 0.5 ? 0.1 + inp.throttle * 0.5 : targetRpm, 1 - Math.exp(-12 * dt));
  return spd;
}

function onLanding(impactVy) {
  VH.Audio.sfx('land', impactVy / 20);
  camShake = Math.max(camShake, clamp(impactVy / 40, 0.1, 0.6));
  skillAirEnd();
  if (player.launch) {
    const dist = Math.hypot(player.pos.x - player.launch.x, player.pos.z - player.launch.z);
    if (player.launch.ramp) registerJump(player.launch.ramp.def, dist);
    if (dist > profile.stats.bestJump && player.launch.ramp) profile.stats.bestJump = dist;
  }
  for (let i = 0; i < 12; i++) spawnParticle(
    player.pos.x + (Math.random() - 0.5) * 3, player.pos.y + 0.3, player.pos.z + (Math.random() - 0.5) * 3,
    (Math.random() - 0.5) * 6, 1 + Math.random() * 2, (Math.random() - 0.5) * 6,
    0.9, 3.2, 0.6, 0.55, 0.48);
}
function onImpact(strength) {
  VH.Audio.sfx('impact', strength / 25);
  camShake = Math.max(camShake, clamp(strength / 30, 0.15, 0.8));
  if (strength > 10) skillBreak();
}

function stepPlane(dt) {
  const cfg = player.cfg;
  const inp = planeInput();
  player.throttleLevel = clamp(player.throttleLevel + (inp.thrUp - inp.thrDn) * 0.55 * dt, 0, 1);

  const speed = player.vel.length();
  const stall = 26, takeoff = 33;

  if (player.grounded) {
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    let vf = player.vel.x * fx + player.vel.z * fz;
    vf += (player.throttleLevel * cfg.accel * 1.15 - vf * 0.25) * dt * 2.2;
    if (vf < 0) vf = 0;
    const spdFac = clamp(vf / 6, 0, 1) / (1 + vf * 0.03);
    player.yaw += (inp.rollL - inp.rollR) * 1.6 * spdFac * dt;
    player.vel.set(fx * vf, 0, fz * vf);
    player.pos.addScaledVector(player.vel, dt);
    player.pos.y = terrainHeight(player.pos.x, player.pos.z);
    if (vf > takeoff) {
      player.grounded = false;
      player.pitch = 0.16;
      player.vel.y = 4;
      showMsg('WHEELS UP!', 900);
    }
    player.roll = lerp(player.roll, 0, 6 * dt);
  } else {
    player.pitch = clamp(player.pitch + (inp.pitchUp - inp.pitchDn) * 1.15 * dt, -1.1, 1.1);
    player.roll += (inp.rollR - inp.rollL) * 2.3 * dt;
    if (!inp.rollL && !inp.rollR) player.roll = lerp(player.roll, 0, 1.2 * dt);
    player.yaw -= Math.sin(player.roll) * cfg.turn * dt * (0.4 + speed / cfg.maxSpeed);
    const cp = Math.cos(player.pitch);
    const dir = tmpV.set(Math.sin(player.yaw) * cp, Math.sin(player.pitch), Math.cos(player.yaw) * cp);
    let s = speed;
    s += (player.throttleLevel * cfg.accel - s * s * (cfg.accel / (cfg.maxSpeed * cfg.maxSpeed))) * dt;
    s -= GRAV * Math.sin(player.pitch) * dt * 0.7;
    s = Math.max(s, 0);
    player.vel.copy(dir).multiplyScalar(s);
    if (s < stall) {
      player.vel.y -= (stall - s) * 1.4 * dt * 4;
      player.pitch = lerp(player.pitch, -0.35, dt * 0.8);
    }
    player.pos.addScaledVector(player.vel, dt);

    const gY = terrainHeight(player.pos.x, player.pos.z);
    let crashed = hitBuilding();
    if (!crashed && player.pos.y < gY + 0.4) {
      const kind = surfaceKind(player.pos.x, player.pos.z);
      const gentle = player.vel.y > -9 && Math.abs(player.pitch) < 0.28 && Math.abs(player.roll) < 0.4;
      if (gentle && (kind === 'strip' || kind === 'road' || kind === 'city')) {
        player.grounded = true; player.pitch = 0; player.roll = 0;
        player.pos.y = gY; player.vel.y = 0;
        showMsg('TOUCHDOWN', 900);
        VH.Audio.sfx('land', 0.4);
      } else if (gentle) {
        player.grounded = true; player.pitch = 0; player.roll = 0;
        player.pos.y = gY; player.vel.y = 0;
        player.vel.multiplyScalar(0.5);
        VH.Audio.sfx('land', 0.6);
        for (let i = 0; i < 10; i++) spawnParticle(
          player.pos.x + (Math.random() - 0.5) * 3, player.pos.y + 0.3, player.pos.z + (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 5, 2 + Math.random() * 2, (Math.random() - 0.5) * 5,
          1.2, 3.5, 0.62, 0.52, 0.38);
      } else crashed = true;
    }
    if (crashed) planeCrash();
  }
  waterCheck();

  for (const p of player.props) {
    if (cfg.jet) { const sc = 0.4 + player.throttleLevel * 1.3; p.scale.set(1, sc, 1); }
    else p.rotation.z += (4 + player.throttleLevel * 55) * dt;
  }
  player.mesh.rotation.set(0, 0, 0);
  player.mesh.rotation.order = 'YXZ';
  player.mesh.rotation.y = player.yaw;
  player.mesh.rotation.x = -player.pitch;
  player.mesh.rotation.z = -player.roll;
  player.mesh.position.copy(player.pos);
  player.rpm = player.throttleLevel;
  return player.vel.length();
}
function hitBuilding() {
  for (const b of buildings) {
    if (Math.abs(player.pos.x - b.x) < b.hw + 1.5 && Math.abs(player.pos.z - b.z) < b.hd + 1.5 &&
        player.pos.y < (b.base !== undefined ? b.base : CITY_H) + b.h) return true;
  }
  return false;
}
function planeCrash() {
  for (let i = 0; i < 26; i++) spawnParticle(
    player.pos.x + (Math.random() - 0.5) * 4, player.pos.y + 1, player.pos.z + (Math.random() - 0.5) * 4,
    (Math.random() - 0.5) * 10, 3 + Math.random() * 6, (Math.random() - 0.5) * 10,
    1.6, 5, 0.35, 0.32, 0.3);
  VH.Audio.sfx('impact', 1);
  camShake = 0.9;
  skillBreak();
  if (ev.active && ev.def.type === 'air') { showMsg('CRASH!  Back to the last ring…', 1400); airRespawn(); return; }
  player.pos.y = terrainHeight(player.pos.x, player.pos.z) + 1.2;
  player.vel.multiplyScalar(0.25);
  player.vel.y = 6;
  player.pitch = 0.25; player.roll = 0;
  player.throttleLevel = Math.min(player.throttleLevel, 0.4);
  // pop out of any building footprint we flew into
  for (const b of buildings) {
    if (Math.abs(player.pos.x - b.x) < b.hw + 2 && Math.abs(player.pos.z - b.z) < b.hd + 2) {
      player.pos.y = (b.base !== undefined ? b.base : CITY_H) + b.h + 4;
    }
  }
  showMsg('CRASH!', 1100);
}

// returns the hardest impact speed this frame
function collideWorld() {
  let impact = 0;
  for (const b of buildings) {
    const dx = player.pos.x - b.x, dz = player.pos.z - b.z;
    const px = b.hw + 1.1 - Math.abs(dx), pz = b.hd + 1.1 - Math.abs(dz);
    if (px > 0 && pz > 0 && player.pos.y < (b.base !== undefined ? b.base : CITY_H) + b.h + 2) {
      if (px < pz) { impact = Math.max(impact, Math.abs(player.vel.x)); player.pos.x += Math.sign(dx) * px; player.vel.x *= -0.25; }
      else { impact = Math.max(impact, Math.abs(player.vel.z)); player.pos.z += Math.sign(dz) * pz; player.vel.z *= -0.25; }
      player.vel.multiplyScalar(0.82);
    }
  }
  const cx = Math.floor(player.pos.x / 40), cz = Math.floor(player.pos.z / 40);
  for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
    const cell = treeGrid.get((cx + ix) + ',' + (cz + iz));
    if (!cell) continue;
    for (const t of cell) {
      const dx = player.pos.x - t.x, dz = player.pos.z - t.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.9 * 1.9 && d2 > 1e-6 && player.pos.y < terrainHeight(t.x, t.z) + 8) {
        const d = Math.sqrt(d2), push = (1.9 - d);
        const vn = -(player.vel.x * dx + player.vel.z * dz) / d;
        if (vn > 0) impact = Math.max(impact, vn);
        player.pos.x += (dx / d) * push; player.pos.z += (dz / d) * push;
        player.vel.multiplyScalar(0.6);
      }
    }
  }
  return impact;
}
function waterCheck() {
  if (terrainHeight(player.pos.x, player.pos.z) < WATER_Y - 1 && player.pos.y < WATER_Y + 0.5) {
    showMsg('SPLASH!  Back to the road…', 1200);
    skillBreak();
    if (ev.active && ev.def.type === 'air') { airRespawn(); return; }
    if (ev.active && ev.def.type === 'scramble') { scrambleRespawn(); return; }
    respawnToRoad();
  }
}

// oriented-box test of the player against a car-sized obstacle
function carOverlap(ox, oz, oyaw, halfW, halfL) {
  const dx = player.pos.x - ox, dz = player.pos.z - oz;
  const cs = Math.cos(oyaw), sn = Math.sin(oyaw);
  const lx = dx * cs - dz * sn;          // local right
  const lz = dx * sn + dz * cs;          // local forward
  const pr = player.cfg.kind === 'bike' ? 0.6 : 1.0;
  const px = halfW + pr - Math.abs(lx), pz = halfL + (player.cfg.kind === 'bike' ? 1.1 : 2.1) - Math.abs(lz);
  if (px <= 0 || pz <= 0) return null;
  // push-out direction in world space
  if (px < pz) return { nx: Math.sign(lx) * cs, nz: -Math.sign(lx) * sn, depth: px };
  return { nx: Math.sign(lz) * sn, nz: Math.sign(lz) * cs, depth: pz };
}
function collideDynamic() {
  let impact = 0;
  const bodies = [];
  if (!ev.active || ev.def.type === 'scramble') for (const c of traffic) if (c.visible) bodies.push(c);
  if (ev.active && ev.ai) for (const a of aiRacers) bodies.push(a);
  for (const o of bodies) {
    if (Math.abs(player.pos.x - o.pos.x) > 7 || Math.abs(player.pos.z - o.pos.z) > 7) continue;
    if (Math.abs(player.pos.y - o.pos.y) > 3) continue;
    const hit = carOverlap(o.pos.x, o.pos.z, o.yaw, o.halfW || 1.0, o.halfL || 2.3);
    if (!hit) continue;
    player.pos.x += hit.nx * hit.depth;
    player.pos.z += hit.nz * hit.depth;
    const ovx = Math.sin(o.yaw) * o.speed, ovz = Math.cos(o.yaw) * o.speed;
    const rvn = (player.vel.x - ovx) * hit.nx + (player.vel.z - ovz) * hit.nz;
    if (rvn < 0) {
      impact = Math.max(impact, -rvn);
      player.vel.x -= hit.nx * rvn * 1.3;
      player.vel.z -= hit.nz * rvn * 1.3;
      player.vel.multiplyScalar(0.85);
      if (o.bump) o.bump(-rvn);
    }
  }
  return impact;
}

/* ======================================================================
   ROAD METRICS — arc length and curvature around the highway loop
   ====================================================================== */
const ROAD_N = 1440;
const roadCum = new Float32Array(ROAD_N + 1);
const roadCurv = new Float32Array(ROAD_N);
(function measureRoad() {
  let prev = roadPoint(0);
  const tans = [];
  for (let i = 0; i <= ROAD_N; i++) {
    const p = roadPoint(i / ROAD_N);
    if (i > 0) roadCum[i] = roadCum[i - 1] + p.distanceTo(prev);
    prev = p;
    if (i < ROAD_N) tans.push(roadTangent(i / ROAD_N));
  }
  const seg = roadCum[ROAD_N] / ROAD_N;
  for (let i = 0; i < ROAD_N; i++) {
    const a = tans[(i + ROAD_N - 2) % ROAD_N], b = tans[(i + 2) % ROAD_N];
    roadCurv[i] = Math.acos(clamp(a.dot(b), -1, 1)) / (4 * seg);
  }
})();
const ROAD_LEN = roadCum[ROAD_N];
const wrap01 = (t) => ((t % 1) + 1) % 1;
function arcLen(t0, span) {     // metres from t0 forward by span (0..1)
  const tt0 = wrap01(t0), tt1 = tt0 + span;
  const at = (t) => {
    const w = Math.floor(t), f = (t - w) * ROAD_N, i = Math.floor(f);
    const c = roadCum[i] + (roadCum[Math.min(ROAD_N, i + 1)] - roadCum[i]) * (f - i);
    return w * ROAD_LEN + c;
  };
  return at(tt1) - at(tt0);
}
function curvAt(t) { return roadCurv[Math.floor(wrap01(t) * ROAD_N) % ROAD_N]; }
function trackT(x, z) { return wrap01(Math.atan2(z, x) / TAU); }

/* InstancedMesh frustum culling uses the base geometry around the origin in
   this three.js release, so scattered instances would pop out of view. */
function noCull(o) { o.frustumCulled = false; return o; }

function mergeGeos(list) {
  let n = 0;
  const flat = list.map(g => { const ng = g.index ? g.toNonIndexed() : g; n += ng.attributes.position.count; return ng; });
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}

/* ======================================================================
   TRAFFIC — instanced civilian cars circulating both ways on the loop
   ====================================================================== */
const TRAFFIC_N = 30;
const traffic = [];
const trafficIM = [];      // every instanced mesh (for show / hide)
let trafficHidden = false;
(function buildTraffic() {
  const profs = ['sports', 'muscle', 'suv'];
  const colors = [0xb8bcc4, 0x2a2d33, 0xe9e9ec, 0x8c1d1d, 0x1d3f7a, 0x3b5f3a, 0xc9a227, 0x6d6f75, 0x5a2d6e, 0x9ea3ab, 0x113a44, 0xa04a16];
  const perProf = Math.ceil(TRAFFIC_N / profs.length);
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 0.8 });
  const gMat = glassMat();
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff7d8, emissive: 0xfff3bd, emissiveIntensity: 1.2 });
  const tlMat = new THREE.MeshStandardMaterial({ color: 0x60080a, emissive: 0xd8161a, emissiveIntensity: 1.4 });
  const profIM = {};
  for (const pn of profs) {
    const prof = CAR_PROFILES[pn];
    const body = extrudeProfile(prof.body, prof.width * 0.74, bodyMat, 0.09).geometry;
    const glass = extrudeProfile(prof.glass, prof.width * 0.58, gMat, 0.05).geometry;
    const box = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); return b; };
    const hl = mergeGeos([-1, 1].map(s => box(0.44, 0.13, 0.1, s * 0.62, prof.body[1][1] - 0.04, prof.body[0][0] + 0.02)));
    const tl = mergeGeos([-1, 1].map(s => box(0.5, 0.12, 0.08, s * 0.6, prof.body[5][1] + 0.02, prof.body[6][0] - 0.02)));
    const ims = {
      body: new THREE.InstancedMesh(body, bodyMat, perProf),
      glass: new THREE.InstancedMesh(glass, gMat, perProf),
      hl: new THREE.InstancedMesh(hl, hlMat, perProf),
      tl: new THREE.InstancedMesh(tl, tlMat, perProf),
    };
    ims.body.castShadow = true;
    for (const k in ims) { noCull(ims[k]); scene.add(ims[k]); trafficIM.push(ims[k]); }
    profIM[pn] = ims;
  }
  const wheelGeo = new THREE.CylinderGeometry(1, 1, 0.28, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = noCull(new THREE.InstancedMesh(wheelGeo,
    new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.9 }), TRAFFIC_N * 4));
  scene.add(wheels); trafficIM.push(wheels);

  const count = { sports: 0, muscle: 0, suv: 0 };
  for (let i = 0; i < TRAFFIC_N; i++) {
    const pn = profs[i % 3];
    const idx = count[pn]++;
    const dir = i % 2 ? 1 : -1;
    const car = {
      t: hash2(i, 91), dir, lane: 4.0, prof: CAR_PROFILES[pn], ims: profIM[pn], idx,
      cruise: 17 + hash2(i, 7) * 9, speed: 20, stop: 0, spin: 0, nearCd: 0,
      pos: new THREE.Vector3(), yaw: 0, visible: true, halfW: 1.0, halfL: 2.3, i,
    };
    car.bump = (v) => { if (v > 3) { car.stop = 2.5; car.speed = 0; } };
    profIM[pn].body.setColorAt(idx, new THREE.Color(colors[i % colors.length]));
    traffic.push(car);
  }
  for (const pn of profs) profIM[pn].body.instanceColor.needsUpdate = true;
  traffic.wheels = wheels;
})();
const _tm = new THREE.Matrix4(), _tw = new THREE.Matrix4(), _te = new THREE.Euler(0, 0, 0, 'YXZ');
const _tq = new THREE.Quaternion(), _ts = new THREE.Vector3(), _tp = new THREE.Vector3();
function setTrafficVisible(v) {
  trafficHidden = !v;
  for (const im of trafficIM) im.visible = v;
  for (const c of traffic) c.visible = v;
}
function stepTraffic(dt) {
  const want = settings.traffic && !(ev.active && ev.ai);
  if (want === trafficHidden) setTrafficVisible(want);
  if (trafficHidden) return;
  for (const c of traffic) {
    // keep a gap to whoever is ahead in the same lane
    let target = c.cruise;
    for (const o of traffic) {
      if (o === c || o.dir !== c.dir) continue;
      const gap = wrap01((o.t - c.t) * c.dir) * ROAD_LEN;
      if (gap < 30) target = Math.min(target, o.speed * clamp((gap - 9) / 18, 0, 1));
    }
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const dx = player.pos.x - c.pos.x, dz = player.pos.z - c.pos.z;
    const along = dx * fx + dz * fz, lat = dx * fz - dz * fx;
    if (along > 0 && along < 24 && Math.abs(lat) < 2.8 && Math.abs(player.pos.y - c.pos.y) < 4) {
      target = Math.min(target, clamp((along - 7) / 17, 0, 1) * c.cruise);
    }
    if (c.stop > 0) { c.stop -= dt; target = 0; }
    c.speed += clamp(target - c.speed, -14 * dt, 5 * dt);
    c.t = wrap01(c.t + c.dir * c.speed * dt / ROAD_LEN);

    const p = roadPoint(c.t), tan = roadTangent(c.t);
    const nx = -tan.z, nz = tan.x;
    c.pos.set(p.x + nx * c.lane * c.dir, 0, p.z + nz * c.lane * c.dir);
    c.pos.y = terrainHeight(c.pos.x, c.pos.z) + 0.08;
    c.yaw = Math.atan2(tan.x * c.dir, tan.z * c.dir);
    const cfx = Math.sin(c.yaw), cfz = Math.cos(c.yaw);
    const pitch = Math.atan2(terrainHeight(c.pos.x + cfx * 2, c.pos.z + cfz * 2) - terrainHeight(c.pos.x - cfx * 2, c.pos.z - cfz * 2), 4);
    _te.set(-pitch, c.yaw, 0);
    _tq.setFromEuler(_te);
    _tm.compose(c.pos, _tq, _ts.set(1, 1, 1));
    c.ims.body.setMatrixAt(c.idx, _tm);
    c.ims.glass.setMatrixAt(c.idx, _tm);
    c.ims.hl.setMatrixAt(c.idx, _tm);
    c.ims.tl.setMatrixAt(c.idx, _tm);
    c.spin += c.speed * dt / c.prof.wheelR;
    let wi = 0;
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      _tw.makeRotationX(c.spin);
      _tw.scale(_ts.set(1, c.prof.wheelR, c.prof.wheelR));
      _tw.setPosition(sx * (c.prof.width * 0.5 - 0.1), c.prof.wheelR, sz * c.prof.wb);
      _tw.premultiply(_tm);
      traffic.wheels.setMatrixAt(c.i * 4 + wi++, _tw);
    }
    // near misses: close, fast pass without contact
    c.nearCd -= dt;
    const d2 = dx * dx + dz * dz;
    const rel = Math.hypot(player.vel.x - cfx * c.speed, player.vel.z - cfz * c.speed);
    if (c.nearCd <= 0 && d2 < 4.8 * 4.8 && Math.abs(lat) > 2.1 && rel > 13 && player.speed > 14 &&
        player.cfg.kind !== 'plane' && state === 'play' && Math.abs(player.pos.y - c.pos.y) < 3) {
      c.nearCd = 3;
      skillInstant('NEAR MISS', 350);
      profile.stats.nearMisses++;
      VH.Audio.sfx('nearmiss');
    }
  }
  for (const im of trafficIM) im.instanceMatrix.needsUpdate = true;
}

/* ======================================================================
   AI RIVALS — rail drivers with corner speed, lane changes, rubber band
   ====================================================================== */
const aiRacers = [];
const AI_COLORS = [0xcfd2d6, 0xd07a14, 0x7b3fb8];
(function buildAI() {
  for (let i = 0; i < 3; i++) {
    const car = buildCar({ color: AI_COLORS[i], spoiler: i !== 1, profile: i === 1 ? 'muscle' : 'sports' });
    const bike = buildBike({ color: AI_COLORS[i] });
    const ai = {
      car, bike, mesh: car.group, wheels: car.wheels, spinSign: 1, lane: [-3.4, 3.4, 0][i], laneTarget: 0,
      skill: [1.03, 1.0, 0.965][i], dist: 0, speed: 0, spin: 0, finished: false, finishTime: 0,
      pos: new THREE.Vector3(), yaw: 0, halfW: 1.0, halfL: 2.3, blocked: 0,
    };
    ai.laneTarget = ai.lane;
    ai.bump = (v) => {
      if (ai.bumpCd > 0 || v < 4) return;
      ai.bumpCd = 0.8;
      ai.speed *= 0.85;
    };
    ai.car.group.visible = ai.bike.group.visible = false;
    scene.add(ai.car.group); scene.add(ai.bike.group);
    aiRacers.push(ai);
  }
})();
function rebuildAIMeshes() {
  if (!carTemplate) return;
  aiRacers.forEach((ai, i) => {
    if (ai.car.glbRoot) return;
    const vis = ai.car.group.visible;
    scene.remove(ai.car.group);
    disposeBuilt(ai.car);
    ai.car = buildCarFromGLB({ color: AI_COLORS[i], castShadow: false });
    ai.car.group.visible = vis;
    scene.add(ai.car.group);
    if (ai.mesh !== ai.bike.group) { ai.mesh = ai.car.group; ai.wheels = ai.car.wheels; ai.spinSign = -1; }
  });
}
function showAI(kind) {
  for (const ai of aiRacers) {
    const useBike = kind === 'bike';
    ai.car.group.visible = !useBike && !!kind;
    ai.bike.group.visible = useBike;
    const b = useBike ? ai.bike : ai.car;
    ai.mesh = b.group; ai.wheels = b.wheels; ai.spinSign = b.spinSign || 1;
    ai.halfW = useBike ? 0.45 : 1.0; ai.halfL = useBike ? 1.1 : 2.3;
  }
}
function placeAI(ai) {
  const t = wrap01(ev.t0 + ai.dist / ROAD_LEN);
  const p = roadPoint(t), tan = roadTangent(t);
  ai.pos.set(p.x - tan.z * ai.lane, 0, p.z + tan.x * ai.lane);
  ai.pos.y = terrainHeight(ai.pos.x, ai.pos.z);
  ai.yaw = Math.atan2(tan.x, tan.z);
  ai.mesh.position.copy(ai.pos);
  const fx = Math.sin(ai.yaw), fz = Math.cos(ai.yaw);
  const pitch = Math.atan2(terrainHeight(ai.pos.x + fx * 2, ai.pos.z + fz * 2) - terrainHeight(ai.pos.x - fx * 2, ai.pos.z - fz * 2), 4);
  ai.mesh.rotation.set(-pitch, ai.yaw, 0, 'YXZ');
}
function stepAI(dt) {
  if (!ev.active || !ev.ai) return;
  if (ev.phase === 'countdown' || ev.phase === 'intro') { for (const ai of aiRacers) placeAI(ai); return; }
  const prog = playerProgress();
  for (const ai of aiRacers) {
    const look = ai.dist + 25 + ai.speed * 0.9;
    const tAhead = ev.t0 + look / ROAD_LEN;
    const k = Math.max(curvAt(tAhead), curvAt(ev.t0 + (ai.dist + 12) / ROAD_LEN), 1e-4);
    const corner = Math.sqrt(30 * ev.pace / k);
    let target = Math.min(ev.aiBase * ai.skill, corner);
    const gap = ai.dist - prog;                      // + = AI ahead of player
    if (gap > 45) target *= gap > 160 ? 0.84 : 0.93;
    else if (gap < -45) target *= gap < -160 ? 1.22 : 1.1;
    if (ai.finished) target = Math.min(target, 20);
    // the player blocks our lane — brake and pull out to pass
    const fx = Math.sin(ai.yaw), fz = Math.cos(ai.yaw);
    const dx = player.pos.x - ai.pos.x, dz = player.pos.z - ai.pos.z;
    const along = dx * fx + dz * fz, lat = dx * fz - dz * fx;
    if (along > 0 && along < 16 && Math.abs(lat) < 2.6) {
      target = Math.min(target, Math.max(0, player.fwdSpeed - 1));
      ai.blocked += dt;
      if (ai.blocked > 0.4) ai.laneTarget = lat < 0 ? -3.6 : 3.6;   // lat > 0: player is on our left
    } else ai.blocked = Math.max(0, ai.blocked - dt);
    ai.lane = lerp(ai.lane, ai.laneTarget, 1 - Math.exp(-1.6 * dt));
    ai.bumpCd = (ai.bumpCd || 0) - dt;
    ai.speed += clamp(target - ai.speed, -16 * dt, 9 * dt);
    ai.dist += ai.speed * dt;
    if (!ai.finished && ai.dist >= ev.totalLen) { ai.finished = true; ai.finishTime = ev.time; }
    placeAI(ai);
    ai.spin += ai.speed * dt / 0.36;
    for (const w of ai.wheels) w.rotation.x = ai.spin * (ai.spinSign || 1);
  }
}

/* ======================================================================
   EVENTS — route building, countdown, checkpoints, results
   ====================================================================== */
const ev = { active: false, def: null, phase: '', time: 0, countdown: 0, gates: [], cp: 0, lap: 0, laps: 1,
  lapLen: 0, totalLen: 0, ai: false, group: null, lapStart: 0, bestLap: 0, t0: 0, pace: 1, aiBase: 40,
  prevDay: null, targets: null, beacon: null };

const markerGroup = new THREE.Group();
scene.add(markerGroup);
const markers = [];      // { def, pos, ring, beam, label, kind:'event' }
const TYPE_COLORS = { circuit: 0xff4f7b, sprint: 0xff9d2e, scramble: 0x8fd14f, air: 0x52c8ff };
const TYPE_ICONS = { circuit: '⟳', sprint: '➜', scramble: '⛰', air: '✈' };
const TYPE_NAMES = { circuit: 'Circuit Race', sprint: 'Sprint Race', scramble: 'Cross-Country', air: 'Air Race' };

const beamTex = (() => {
  const [c, g] = makeCanvas(64);
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = toTex(c, false); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
})();
function makeBeam(color, radius, height) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 20, 1, true);
  geo.translate(0, height / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false
  }));
  m.renderOrder = 5;
  return m;
}
function makeGroundRing(color, r) {
  const geo = new THREE.RingGeometry(r - 0.9, r, 48);
  geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
}
function makeLabel(lines, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  const col = '#' + new THREE.Color(color).getHexString();
  g.fillStyle = 'rgba(8,12,26,0.78)';
  g.beginPath(); g.roundRect ? g.roundRect(4, 4, 504, 152, 26) : g.rect(4, 4, 504, 152); g.fill();
  g.fillStyle = col; g.fillRect(4, 4, 14, 152);
  g.fillStyle = '#fff'; g.font = 'bold 50px Segoe UI, sans-serif'; g.textBaseline = 'middle';
  g.fillText(lines[0], 40, 58);
  g.fillStyle = col; g.font = 'bold 30px Segoe UI, sans-serif';
  g.fillText(lines[1], 40, 118);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(16, 5, 1);
  sp.renderOrder = 6;
  return sp;
}
function refreshMarkerLabel(m) {
  const lock = eventLock(m.def);
  const stars = (profile.events[m.def.id] || {}).stars || 0;
  const sub = lock ? '🔒 ' + lock : TYPE_NAMES[m.def.type] + '   ' + '★'.repeat(stars) + '☆'.repeat(3 - stars);
  if (m.label) { m.label.material.map.dispose(); m.group.remove(m.label); }
  m.label = makeLabel([m.def.name, sub], lock ? 0x7d8699 : TYPE_COLORS[m.def.type]);
  m.label.position.set(0, 9, 0);
  m.group.add(m.label);
  m.beam.material.color.setHex(lock ? 0x5b6272 : TYPE_COLORS[m.def.type]);
  m.ring.material.color.setHex(lock ? 0x5b6272 : TYPE_COLORS[m.def.type]);
}
(function buildMarkers() {
  for (const def of C.EVENTS) {
    const pos = eventMarkerPos(def);
    const g = new THREE.Group();
    g.position.copy(pos);
    const color = TYPE_COLORS[def.type];
    const beam = makeBeam(color, 2.2, 80);
    const ring = makeGroundRing(color, 9);
    ring.position.y = 0.25;
    g.add(beam, ring);
    markerGroup.add(g);
    markers.push({ def, pos, group: g, beam, ring, label: null });
  }
})();
function refreshAllMarkers() { for (const m of markers) refreshMarkerLabel(m); }

function totalStars() {
  let n = 0;
  for (const k in profile.events) n += profile.events[k].stars || 0;
  return n;
}
// null when enterable, otherwise the reason it is locked
function eventLock(def) {
  if (profile.level < (def.level || 1)) return 'Reach level ' + def.level;
  if (def.stars && totalStars() < def.stars) return def.stars + ' ★ needed (' + totalStars() + ')';
  return null;
}
function vehicleAllowed(def, cfg) { return def.allow.includes((cfg || player.cfg).kind); }
function allowText(def) {
  const n = { car: 'Cars', bike: 'Bikes', plane: 'Planes' };
  return def.allow.map(k => n[k]).join(' & ');
}
function eventCard(def) {
  const rec = profile.events[def.id] || {};
  let detail;
  if (def.type === 'circuit') detail = def.laps + (def.laps > 1 ? ' laps' : ' lap') + ' · 3 rivals' + (def.night ? ' · night' : '');
  else if (def.type === 'sprint') detail = (arcLen(def.t0, wrap01(def.t1 - def.t0)) / 1000).toFixed(1) + ' km · 3 rivals';
  else if (def.type === 'scramble') detail = (def.points.length - 1) + ' checkpoints · time trial';
  else detail = def.rings.length + ' rings · time trial';
  return {
    id: def.id, name: def.name, type: TYPE_NAMES[def.type], color: TYPE_COLORS[def.type], desc: def.desc,
    detail, allow: allowText(def), lock: eventLock(def), vehicleOK: vehicleAllowed(def),
    stars: rec.stars || 0, best: rec.best || null, reward: def.reward, done: !!rec.done,
  };
}

// ---------- route construction
function roadGateVisual(pos, tan, color) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4a68, emissive: color, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.35 });
  const pylonGeo = new THREE.CylinderGeometry(0.2, 0.28, 9, 10);
  const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
  for (const s of [-1, 1]) {
    const py = new THREE.Mesh(pylonGeo, mat);
    const pp = pos.clone().addScaledVector(nrm, s * (ROAD_HALF + 2.4));
    py.position.set(pp.x, terrainHeight(pp.x, pp.z) + 4.5, pp.z);
    py.castShadow = true;
    grp.add(py);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 6, 0.5, 0.5), mat);
  beam.position.set(pos.x, terrainHeight(pos.x, pos.z) + 9.4, pos.z);
  beam.rotation.y = Math.atan2(tan.x, tan.z) + Math.PI / 2;
  grp.add(beam);
  return { grp, mat };
}
function flareVisual(pos, color) {
  const grp = new THREE.Group();
  grp.position.copy(pos);
  const beam = makeBeam(color, 3, 60);
  const ring = makeGroundRing(color, 12);
  ring.position.y = 0.3;
  grp.add(beam, ring);
  return { grp, mat: beam.material, ring };
}
function ringVisual(pos, dir, color) {
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.4 });
  const m = new THREE.Mesh(new THREE.TorusGeometry(12, 0.8, 10, 48), mat);
  m.position.copy(pos);
  m.lookAt(pos.clone().add(dir));
  const grp = new THREE.Group(); grp.add(m);
  return { grp, mat };
}
function buildRoute(def) {
  const gates = [];
  let cum = 0;
  const color = TYPE_COLORS[def.type];
  if (def.type === 'circuit' || def.type === 'sprint') {
    const span = def.type === 'circuit' ? 1 : wrap01(def.t1 - def.t0);
    const N = def.type === 'circuit' ? 12 : Math.max(5, Math.round(span * 16));
    for (let i = 1; i <= N; i++) {
      const t = def.t0 + span * i / N;
      const pos = roadPoint(wrap01(t)), tan = roadTangent(wrap01(t));
      const vis = roadGateVisual(pos, tan, i === N ? 0xffd75e : color);
      gates.push({ pos, r: 21, cum: arcLen(def.t0, span * i / N), ...vis, finish: i === N, road: true });
    }
    ev.lapLen = arcLen(def.t0, span);
  } else if (def.type === 'scramble') {
    let prev = new THREE.Vector3(def.points[0][0], 0, def.points[0][1]);
    for (let i = 1; i < def.points.length; i++) {
      const [x, z] = def.points[i];
      const pos = new THREE.Vector3(x, terrainHeight(x, z), z);
      cum += Math.hypot(x - prev.x, z - prev.z);
      prev = pos;
      const vis = flareVisual(pos, i === def.points.length - 1 ? 0xffd75e : color);
      gates.push({ pos, r: 16, cum, ...vis, finish: i === def.points.length - 1 });
    }
    ev.lapLen = cum;
  } else {
    const s = def.start;
    let prev = new THREE.Vector3(s[0], terrainHeight(s[0], s[1]) + s[2], s[1]);
    const pts = def.rings.map(([x, z, agl]) => new THREE.Vector3(x, Math.max(terrainHeight(x, z), WATER_Y) + agl, z));
    for (let i = 0; i < pts.length; i++) {
      const pos = pts[i];
      cum += pos.distanceTo(prev);
      const dir = (i + 1 < pts.length ? pts[i + 1].clone().sub(prev) : pos.clone().sub(prev)).normalize();
      prev = pos;
      const vis = ringVisual(pos, dir, i === pts.length - 1 ? 0xffd75e : color);
      gates.push({ pos, r: 16, cum, ...vis, finish: i === pts.length - 1, ring: true });
    }
    ev.lapLen = cum;
  }
  return gates;
}
function highlightGates() {
  ev.gates.forEach((g, i) => {
    const next = i === ev.cp, after = i === ev.cp + 1 || (ev.cp === ev.gates.length - 1 && i === 0 && ev.lap + 1 < ev.laps);
    const base = g.finish ? 0xffd75e : TYPE_COLORS[ev.def.type];
    if (g.ring) {
      g.mat.emissiveIntensity = next ? 2.6 : after ? 0.9 : 0.25;
      g.grp.visible = i >= ev.cp || ev.laps > 1;
    } else if (g.road) {
      g.mat.emissive.setHex(next ? 0x2affc6 : base);
      g.mat.emissiveIntensity = next ? 2.4 : after ? 0.8 : 0.25;
    } else {
      g.mat.opacity = next ? 1 : after ? 0.45 : 0.12;
      g.grp.visible = i >= ev.cp;
    }
  });
  if (ev.beacon) {
    const g = ev.gates[ev.cp];
    if (g) ev.beacon.position.set(g.pos.x, g.ring ? g.pos.y - 60 : g.pos.y, g.pos.z);
  }
}

function startEvent(def) {
  if (ev.active || !careerLive) return;
  const lock = eventLock(def);
  if (lock) { VH.Audio.sfx('error'); showMsg('LOCKED\n' + lock, 1600); return; }
  if (!vehicleAllowed(def)) { VH.Audio.sfx('error'); showMsg('Requires: ' + allowText(def) + '\nOpen the garage (V)', 1900); return; }
  VH.Audio.sfx('click');
  ev.active = true; ev.def = def; ev.phase = 'intro';
  ui.prompt(null);
  ui.fade(true);
  setTimeout(() => { setupEvent(def); ui.fade(false); }, 420);
}
function setupEvent(def) {
  if (ev.group) { scene.remove(ev.group); ev.group = null; }
  skillReset();
  driftZone.active = null;
  ev.time = 0; ev.cp = 0; ev.lap = 0; ev.bestLap = 0; ev.lapStart = 0; ev.lapTimes = [];
  ev.laps = def.type === 'circuit' ? def.laps : 1;
  ev.ai = def.type === 'circuit' || def.type === 'sprint';
  ev.t0 = def.t0 || 0;
  ev.pace = def.pace || 1;
  ev.gates = buildRoute(def);
  ev.totalLen = ev.lapLen * ev.laps;
  ev.group = new THREE.Group();
  for (const g of ev.gates) ev.group.add(g.grp);
  ev.beacon = makeBeam(0x2affc6, 1.6, 140);
  ev.group.add(ev.beacon);
  scene.add(ev.group);
  markerGroup.visible = false;
  if (def.night) { ev.prevDay = dayTime; dayTime = 0.8; }

  if (ev.ai) {
    const diff = { easy: 0.86, normal: 1.0, hard: 1.1 }[settings.difficulty] || 1;
    ev.aiBase = 0.92 * player.cfg.maxSpeed * 0.8 * ev.pace * diff;
    showAI(player.cfg.kind);
    aiRacers.forEach((ai, i) => {
      ai.dist = -(8 + i * 9); ai.speed = 0; ai.finished = false; ai.finishTime = 0;
      ai.lane = ai.laneTarget = [-3.4, 3.4, 0][i];
      placeAI(ai);
    });
    const t = wrap01(ev.t0 - 45 / ROAD_LEN);
    const p = roadPoint(t), tan = roadTangent(t);
    placePlayer(p.x + tan.z * 1.7, p.z - tan.x * 1.7, Math.atan2(tan.x, tan.z));
  } else if (def.type === 'scramble') {
    showAI(null);
    const [x, z] = def.points[0], [nx, nz] = def.points[1];
    placePlayer(x, z, Math.atan2(nx - x, nz - z));
  } else {
    showAI(null);
    const [x, z, agl] = def.start;
    placePlayer(x, z, def.heading);
    player.pos.y = terrainHeight(x, z) + agl;
    player.grounded = false;
    player.pitch = 0;
    player.throttleLevel = 0.75;
    player.vel.set(Math.sin(def.heading) * 55, 0, Math.cos(def.heading) * 55);
    snapCamera();
  }
  // trial star times scale with what you brought: a quicker machine must set quicker times
  if (def.type === 'scramble') {
    const eff = 0.92 * player.cfg.maxSpeed * Math.max(player.cfg.offroad, 0.5), L = ev.totalLen;
    ev.targets = [L / (eff * 0.42), L / (eff * 0.56), L / (eff * 0.7)];
  } else if (def.type === 'air') {
    const eff = player.cfg.maxSpeed, L = ev.totalLen;
    ev.targets = [L / (eff * 0.5), L / (eff * 0.62), L / (eff * 0.74)];
  }
  else ev.targets = null;
  highlightGates();
  ev.phase = 'countdown';
  ev.countdown = 3.4;
  ev.lastCount = 4;
  VH.Audio.music('race');
}
function airRespawn() {
  const def = ev.def;
  const prev = ev.cp > 0 ? ev.gates[ev.cp - 1].pos : new THREE.Vector3(def.start[0], terrainHeight(def.start[0], def.start[1]) + def.start[2], def.start[1]);
  const next = ev.gates[ev.cp].pos;
  const yaw = Math.atan2(next.x - prev.x, next.z - prev.z);
  player.pos.copy(prev);
  player.pos.y = Math.max(prev.y, terrainHeight(prev.x, prev.z) + 40);
  player.yaw = yaw; player.pitch = 0; player.roll = 0; player.grounded = false;
  player.vel.set(Math.sin(yaw) * 50, 0, Math.cos(yaw) * 50);
  player.throttleLevel = Math.max(player.throttleLevel, 0.7);
  snapCamera();
}
function scrambleRespawn() {
  const def = ev.def;
  const prev = ev.cp > 0 ? ev.gates[ev.cp - 1].pos : new THREE.Vector3(def.points[0][0], 0, def.points[0][1]);
  const next = ev.gates[ev.cp].pos;
  placePlayer(prev.x, prev.z, Math.atan2(next.x - prev.x, next.z - prev.z));
}
function playerProgress() {
  const g = ev.gates[ev.cp];
  if (!g) return ev.totalLen;
  const prevCum = ev.cp > 0 ? ev.gates[ev.cp - 1].cum : 0;
  const seg = g.cum - prevCum;
  const d = g.ring ? player.pos.distanceTo(g.pos) : Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z);
  return ev.lap * ev.lapLen + prevCum + clamp(seg - d, 0, seg);
}
function racePosition() {
  const mine = playerProgress();
  let pos = 1;
  for (const ai of aiRacers) if (ai.finished || ai.dist > mine) pos++;
  return pos;
}
function stepEvent(dt) {
  if (!ev.active) return;
  if (ev.phase === 'countdown') {
    ev.countdown -= dt;
    const n = Math.ceil(ev.countdown);
    if (n !== ev.lastCount && n <= 3) {
      ev.lastCount = n;
      if (n <= 0) { showMsg('GO!', 800); VH.Audio.sfx('go'); ev.phase = 'run'; }
      else { showMsg(String(n), 900); VH.Audio.sfx('count'); }
    }
    if (player.cfg.kind !== 'plane') player.vel.set(0, 0, 0);
    return;
  }
  if (ev.phase !== 'run') return;
  ev.time += dt;
  const g = ev.gates[ev.cp];
  const d = g.ring ? player.pos.distanceTo(g.pos) : Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z);
  if (d < g.r) {
    ev.cp++;
    if (ev.cp >= ev.gates.length) {
      const lapTime = ev.time - ev.lapStart;
      ev.lapTimes.push(lapTime);
      if (!ev.bestLap || lapTime < ev.bestLap) ev.bestLap = lapTime;
      ev.lap++;
      ev.lapStart = ev.time;
      if (ev.lap >= ev.laps) { finishEvent(); return; }
      ev.cp = 0;
      showMsg(ev.lap + 1 === ev.laps ? 'FINAL LAP' : `LAP ${ev.lap + 1} / ${ev.laps}`, 1200);
      VH.Audio.sfx('lap');
    } else VH.Audio.sfx('checkpoint');
    highlightGates();
  }
  if (ev.beacon) ev.beacon.material.opacity = 0.6 + Math.sin(performance.now() * 0.006) * 0.25;
}
const fmtTime = (t) => {
  if (t === null || t === undefined) return '—';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
};
function finishEvent() {
  ev.phase = 'done';
  const def = ev.def;
  let position = 0, stars = 0, mult;
  if (ev.ai) {
    position = racePosition();
    stars = [3, 2, 1, 0][position - 1];
    mult = [1, 0.55, 0.35, 0.2][position - 1];
  } else {
    stars = ev.targets.filter(t => ev.time <= t).length;
    mult = [0.35, 0.6, 0.8, 1][stars];
  }
  const rec = profile.events[def.id] || { stars: 0, best: null, done: false };
  const first = !rec.done;
  const repeat = first ? 1 : 0.6;
  const credits = Math.round(def.reward.credits * mult * repeat / 50) * 50;
  const xp = Math.round(def.reward.xp * mult * repeat);
  const newBest = rec.best === null || ev.time < rec.best;
  const prevStars = rec.stars;
  rec.stars = Math.max(rec.stars, stars);
  if (newBest) rec.best = ev.time;
  rec.done = true;
  profile.events[def.id] = rec;
  profile.stats.eventsDone++;
  if (position === 1) profile.stats.racesWon++;
  const champion = def.finale && position === 1 && !profile.finaleWon;
  if (champion) profile.finaleWon = true;
  VH.Audio.sfx(position === 1 || (!ev.ai && stars > 0) ? 'finish' : 'lose');
  state = 'results';
  addCredits(credits, true);
  addXP(xp);
  refreshAllMarkers();
  saveProfile();
  ui.showResults({
    name: def.name, type: TYPE_NAMES[def.type], color: TYPE_COLORS[def.type],
    position, field: ev.ai ? 4 : 0, time: ev.time, timeText: fmtTime(ev.time),
    bestLap: ev.laps > 1 ? fmtTime(ev.bestLap) : null,
    stars, prevStars, credits, xp, newBest, first,
    targets: ev.targets ? ev.targets.map(fmtTime) : null,
    champion,
  });
}
function cleanupEvent() {
  if (ev.group) {
    ev.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    scene.remove(ev.group);
  }
  ev.group = null; ev.beacon = null; ev.gates = [];
  showAI(null);
  if (ev.prevDay !== null) { dayTime = ev.prevDay; ev.prevDay = null; }
  ev.active = false; ev.def = null; ev.phase = '';
  markerGroup.visible = true;
  VH.Audio.music('drive');
}
function quitEvent() {
  if (!ev.active) return;
  cleanupEvent();
  respawnToRoad();
  showMsg('EVENT ABANDONED', 1200);
}
function restartEvent() {
  if (!ev.def) return;
  const def = ev.def;
  cleanupEvent();
  startEvent(def);
}
function eventNearby() {
  if (ev.active) return null;
  let best = null, bd = 1e9;
  for (const m of markers) {
    const d = Math.hypot(player.pos.x - m.pos.x, player.pos.z - m.pos.z);
    if (d < 13 && d < bd && Math.abs(player.pos.y - m.pos.y) < 12) { bd = d; best = m.def; }
  }
  return best;
}

/* ======================================================================
   PR STUNTS — speed traps, drift zones, jumps (always live in free roam)
   ====================================================================== */
const traps = [];
(function buildTraps() {
  const cam = new THREE.MeshStandardMaterial({ color: 0x2b3240, metalness: 0.7, roughness: 0.4 });
  for (const def of C.SPEED_TRAPS) {
    let pos, dir, halfW;
    if (def.t !== undefined) {
      pos = roadPoint(def.t); dir = roadTangent(def.t); halfW = ROAD_HALF + 2;
    } else {
      pos = new THREE.Vector3(def.at[0], terrainHeight(def.at[0], def.at[1]), def.at[1]);
      dir = new THREE.Vector3(1, 0, 0); halfW = STRIP.hw;
    }
    const nrm = new THREE.Vector3(-dir.z, 0, dir.x);
    const grp = new THREE.Group();
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, 1.2), new THREE.MeshBasicMaterial({
      color: 0x3be8ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    const sq = new THREE.Group(); sq.add(strip);
    sq.position.set(pos.x, terrainHeight(pos.x, pos.z) + 0.2, pos.z);
    sq.rotation.y = Math.atan2(dir.x, dir.z);
    strip.rotation.set(-Math.PI / 2, 0, 0);
    grp.add(sq);
    const pp = pos.clone().addScaledVector(nrm, halfW + 1.5);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 6.5, 8), cam);
    pole.position.set(pp.x, terrainHeight(pp.x, pp.z) + 3.25, pp.z);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 1.0), cam);
    box.position.set(pp.x, terrainHeight(pp.x, pp.z) + 6.6, pp.z);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3040 }));
    lens.position.copy(box.position).addScaledVector(nrm, -0.4);
    grp.add(pole, box, lens);
    const label = makeLabel([def.name, 'SPEED TRAP'], 0x3be8ff);
    label.position.set(pp.x, terrainHeight(pp.x, pp.z) + 10, pp.z);
    label.scale.set(10, 3.1, 1);
    grp.add(label);
    scene.add(grp);
    traps.push({ def, pos, dir, halfW, cool: 0 });
  }
})();
const driftZones = [];
const driftZone = { active: null };
(function buildDriftZones() {
  for (const def of C.DRIFT_ZONES) {
    const a = roadPoint(def.t0), ta = roadTangent(def.t0);
    const b = roadPoint(def.t1), tb = roadTangent(def.t1);
    const va = roadGateVisual(a, ta, 0xb45cff), vb = roadGateVisual(b, tb, 0xb45cff);
    va.mat.emissiveIntensity = vb.mat.emissiveIntensity = 1.1;
    scene.add(va.grp, vb.grp);
    const label = makeLabel([def.name, 'DRIFT ZONE'], 0xb45cff);
    label.position.set(a.x, terrainHeight(a.x, a.z) + 13, a.z);
    label.scale.set(10, 3.1, 1);
    scene.add(label);
    driftZones.push({ def, a, b });
  }
})();
function starsFor(thresholds, v) { return thresholds.filter(t => v >= t).length; }
function stuntRecord(def, value, unit, fmt) {
  const rec = profile.events[def.id] || { stars: 0, best: 0 };
  const stars = starsFor(def.stars, value);
  const improved = value > (rec.best || 0);
  const newStars = Math.max(0, stars - rec.stars);
  if (improved) rec.best = value;
  rec.stars = Math.max(rec.stars, stars);
  profile.events[def.id] = rec;
  const starTxt = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  ui.toast(def.name + '  ' + starTxt, fmt(value) + (improved ? '  · NEW BEST' : '  · best ' + fmt(rec.best)), stars ? 'gold' : 'info');
  if (newStars) {
    addCredits(newStars * 1500);
    addXP(newStars * 300);
    VH.Audio.sfx('bank');
    refreshAllMarkers();
  }
  saveProfile();
}
function speedText(ms) { return settings.units === 'mph' ? Math.round(ms * 2.237) + ' mph' : Math.round(ms * 3.6) + ' km/h'; }
function stepStunts(dt) {
  if (ev.active || state !== 'play' || player.cfg.kind === 'plane') { driftZone.active = null; return; }
  for (const t of traps) {
    t.cool -= dt;
    const dx = player.pos.x - t.pos.x, dz = player.pos.z - t.pos.z;
    const along = dx * t.dir.x + dz * t.dir.z, lat = -dx * t.dir.z + dz * t.dir.x;
    if (t.cool <= 0 && Math.abs(along) < 5 && Math.abs(lat) < t.halfW && player.speed > 5) {
      t.cool = 4;
      stuntRecord(t.def, player.speed * 3.6, 'km/h', v => speedText(v / 3.6));
      VH.Audio.sfx('whoosh');
    }
  }
  if (!driftZone.active) {
    for (const z of driftZones) {
      if (Math.hypot(player.pos.x - z.a.x, player.pos.z - z.a.z) < 13 && player.speed > 6) {
        driftZone.active = { z, score: 0, time: 0 };
        showMsg('DRIFT ZONE', 900);
        break;
      }
    }
  } else {
    const dz = driftZone.active;
    dz.time += dt;
    if (Math.hypot(player.pos.x - dz.z.b.x, player.pos.z - dz.z.b.z) < 15) {
      driftZone.active = null;
      stuntRecord(dz.z.def, Math.round(dz.score), 'pts', v => Math.round(v).toLocaleString() + ' pts');
      if (dz.score > profile.stats.bestDrift) profile.stats.bestDrift = Math.round(dz.score);
    } else if (dz.time > 60 || roadDistInfo(player.pos.x, player.pos.z).d > 45) {
      driftZone.active = null;
      showMsg('DRIFT ZONE FAILED', 1100);
    }
  }
}
function registerJump(def, dist) {
  if (ev.active || !careerLive) return;
  stuntRecord(def, Math.round(dist), 'm', v => Math.round(v) + ' m');
}

/* ======================================================================
   COLLECTIBLES — 30 neon tokens (25 on the ground, 5 in the sky)
   ====================================================================== */
const tokens = [];
const tokenGroup = new THREE.Group();
scene.add(tokenGroup);
let tokenIM, tokenBeamIM;
(function buildTokens() {
  let tries = 0;
  const cols = 6, rows = 5, span = WORLD - 500;
  const ground = C.TOKEN_COUNT - 5;
  while (tokens.length < ground && tries < 4000) {
    tries++;
    const cell = tokens.length;
    const cx = cell % cols, cz = Math.floor(cell / cols) % rows;
    const x = -span / 2 + (cx + 0.15 + hash2(tries, 3) * 0.7) * span / cols;
    const z = -span / 2 + (cz + 0.15 + hash2(tries, 5) * 0.7) * span / rows;
    const h = terrainHeight(x, z);
    if (h < WATER_Y + 1.5 || h > 62) continue;
    let blocked = false;
    for (const b of buildings) if (Math.abs(x - b.x) < b.hw + 4 && Math.abs(z - b.z) < b.hd + 4) blocked = true;
    const cell2 = treeGrid.get(Math.floor(x / 40) + ',' + Math.floor(z / 40));
    if (cell2) for (const t of cell2) if (Math.hypot(t.x - x, t.z - z) < 6) blocked = true;
    if (blocked) continue;
    tokens.push({ pos: new THREE.Vector3(x, h + 1.8, z), air: false });
  }
  const air = [[0, 0, 175], [STRIP.x, STRIP.z, 90], [-900, -700, 70], [700, 950, 70], [-300, 1100, 80]];
  for (const [x, z, agl] of air) tokens.push({ pos: new THREE.Vector3(x, Math.max(terrainHeight(x, z), CITY_H) + agl, z), air: true });
  const geo = new THREE.OctahedronGeometry(1.1, 0);
  tokenIM = noCull(new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({
    color: 0x9ff6ff, emissive: 0x2de0ff, emissiveIntensity: 2.2, metalness: 0.4, roughness: 0.2 }), tokens.length));
  const bgeo = new THREE.CylinderGeometry(0.5, 0.5, 40, 10, 1, true); bgeo.translate(0, 20, 0);
  tokenBeamIM = noCull(new THREE.InstancedMesh(bgeo, new THREE.MeshBasicMaterial({
    color: 0x2de0ff, map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }), tokens.length));
  tokenGroup.add(tokenIM, tokenBeamIM);
})();
const _tkM = new THREE.Matrix4(), _tkQ = new THREE.Quaternion(), _tkE = new THREE.Euler(), _tkS = new THREE.Vector3();
function stepTokens(dt) {
  const now = performance.now() * 0.001;
  tokens.forEach((t, i) => {
    const got = profile.tokens.includes(i);
    _tkE.set(0, now * 1.8 + i, 0.4);
    _tkQ.setFromEuler(_tkE);
    const s = got ? 0 : 1 + Math.sin(now * 3 + i) * 0.08;
    _tkS.set(s * 0.8, s * 1.3, s * 0.8);
    _tp.copy(t.pos); _tp.y += Math.sin(now * 2 + i) * 0.4;
    _tkM.compose(_tp, _tkQ, _tkS);
    tokenIM.setMatrixAt(i, _tkM);
    _tkS.set(got ? 0 : 1, got ? 0 : 1, got ? 0 : 1);
    _tkM.compose(t.pos, _tkQ.identity(), _tkS);
    tokenBeamIM.setMatrixAt(i, _tkM);
    if (!got && careerLive && state === 'play' && player.pos.distanceTo(t.pos) < (t.air ? 11 : 5.5)) collectToken(i);
  });
  tokenIM.instanceMatrix.needsUpdate = true;
  tokenBeamIM.instanceMatrix.needsUpdate = true;
}
function collectToken(i) {
  profile.tokens.push(i);
  const n = profile.tokens.length;
  VH.Audio.sfx('token');
  for (let k = 0; k < 24; k++) spawnParticle(tokens[i].pos.x, tokens[i].pos.y, tokens[i].pos.z,
    (Math.random() - 0.5) * 10, Math.random() * 8, (Math.random() - 0.5) * 10, 0.9, 2.2, 0.4, 0.95, 1.0);
  const bonus = n === tokens.length ? 50000 : 1000;
  ui.toast('Neon Token ' + n + ' / ' + tokens.length, '+' + bonus.toLocaleString() + ' CR  ·  +250 XP' + (n === tokens.length ? '  ·  ALL FOUND!' : ''), 'token');
  addCredits(bonus);
  addXP(250);
  saveProfile();
}

/* ======================================================================
   SKILL CHAINS — drift, air, speed, near misses → credits & XP
   ====================================================================== */
const skill = { chain: 0, mult: 1, timer: 0, cur: null, curPts: 0, curTime: 0, idle: 0, count: 0 };
const CHAIN_TIME = 4.5;
function skillReset() { skill.chain = 0; skill.mult = 1; skill.timer = 0; skill.cur = null; skill.curPts = 0; skill.curTime = 0; skill.count = 0; }
function stepSkills(dt) {
  if (state !== 'play' || !careerLive || (ev.active && ev.phase !== 'run')) return;
  const speed = player.speed;
  let active = null, rate = 0;
  if (player.cfg.kind !== 'plane') {
    if (player.drifting) { active = 'DRIFT'; rate = speed * Math.min(player.slip, 0.9) * 34; }
    else if (!player.grounded && player.airTime > 0.3) { active = 'AIR'; rate = 420; }
    else if (speed > 58) { active = 'SPEED'; rate = (speed - 52) * 24; }
  } else if (!player.grounded) {
    const agl = player.pos.y - terrainHeight(player.pos.x, player.pos.z);
    if (agl < 14 && speed > 35) { active = 'LOW FLYER'; rate = 360; }
    else if (speed > player.cfg.maxSpeed * 0.9) { active = 'AIRSPEED'; rate = 140; }
  }
  if (active) {
    if (skill.cur && skill.cur !== active) commitSkill();
    skill.cur = active; skill.curPts += rate * dt; skill.curTime += dt; skill.idle = 0; skill.timer = CHAIN_TIME;
    if (driftZone.active && active === 'DRIFT') driftZone.active.score += rate * dt;
  } else if (skill.cur) {
    skill.idle += dt;
    if (skill.idle > 0.4) commitSkill();
  }
  if (!skill.cur && skill.chain > 0) {
    skill.timer -= dt;
    if (skill.timer <= 0) bankChain();
  }
}
function skillName() {
  const n = skill.cur, t = skill.curTime, p = skill.curPts;
  if (n === 'AIR') return t > 3 ? 'HUGE AIR' : t > 1.6 ? 'BIG AIR' : 'AIR';
  if (n === 'DRIFT') return p > 6000 ? 'EPIC DRIFT' : p > 2500 ? 'GREAT DRIFT' : 'DRIFT';
  return n;
}
function commitSkill() {
  const name = skillName(), pts = Math.round(skill.curPts);
  if (skill.cur === 'AIR' && skill.curTime > profile.stats.bestAir) profile.stats.bestAir = +skill.curTime.toFixed(2);
  skill.cur = null; skill.curPts = 0; skill.curTime = 0; skill.idle = 0;
  if (pts < 60) return;
  skill.chain += pts * skill.mult;
  skill.count++;
  skill.mult = Math.min(5, 1 + Math.floor(skill.count / 2));
  skill.timer = CHAIN_TIME;
  ui.skillPop(name, pts);
  VH.Audio.sfx('skill');
}
function skillInstant(name, pts) {
  if (state !== 'play' || !careerLive || (ev.active && ev.phase !== 'run')) return;
  skill.chain += pts * skill.mult;
  skill.count++;
  skill.mult = Math.min(5, 1 + Math.floor(skill.count / 2));
  skill.timer = CHAIN_TIME;
  ui.skillPop(name, pts);
}
function skillAirEnd() { if (skill.cur === 'AIR') commitSkill(); }
function skillBreak() {
  if (skill.chain > 0 || skill.curPts > 200) { ui.chainBroken(); VH.Audio.sfx('broken'); }
  skillReset();
}
function bankChain() {
  const pts = Math.round(skill.chain);
  skillReset();
  if (pts <= 0) return;
  const cr = Math.round(pts * 0.25 / 10) * 10, xp = Math.round(pts * 0.3);
  profile.stats.skillBanked += pts;
  ui.chainBanked(pts, cr, xp);
  VH.Audio.sfx('bank');
  addCredits(cr);
  addXP(xp);
}

/* ======================================================================
   PROGRESSION — credits, XP and levels
   ====================================================================== */
function addCredits(n, silent) {
  profile.credits += n;
  if (!silent && n > 0) ui.creditsPop(n);
}
function addXP(n) {
  profile.xp += n;
  while (profile.level < C.MAX_LEVEL && profile.xp >= C.xpToNext(profile.level)) {
    profile.xp -= C.xpToNext(profile.level);
    profile.level++;
    const bonus = 2000 + profile.level * 500;
    profile.credits += bonus;
    const unlocked = [];
    for (const e of C.EVENTS) if (e.level === profile.level) unlocked.push(e.name);
    for (const v of VEHICLES) if (v.level === profile.level && v.price) unlocked.push(v.name);
    ui.toast('LEVEL ' + profile.level + '!', '+' + bonus.toLocaleString() + ' CR' + (unlocked.length ? '  ·  Unlocked: ' + unlocked.join(', ') : ''), 'level');
    VH.Audio.sfx('levelup');
    refreshAllMarkers();
  }
}

/* ======================================================================
   WEATHER — clear / cloudy / rain fronts, wet roads, lightning
   ====================================================================== */
const weather = { kind: 'clear', timer: 140, overcast: 0, rain: 0, wet: 0, tOver: 0, tRain: 0, flash: 0 };
const RAIN_N = 2600;
const rainPos = new Float32Array(RAIN_N * 6);
const rainDrops = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) {
  rainDrops[i * 3] = (Math.random() - 0.5) * 90;
  rainDrops[i * 3 + 1] = -6 + Math.random() * 42;
  rainDrops[i * 3 + 2] = (Math.random() - 0.5) * 90;
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0xb4c8e0, transparent: true, opacity: 0, depthWrite: false, fog: false });
const rainMesh = noCull(new THREE.LineSegments(rainGeo, rainMat));
rainMesh.visible = false;
scene.add(rainMesh);
function setWeather(kind) {
  weather.kind = kind;
  weather.tOver = kind === 'clear' ? 0 : kind === 'cloudy' ? 0.62 : 0.95;
  weather.tRain = kind === 'rain' ? 0.65 + Math.random() * 0.35 : 0;
  weather.timer = 130 + Math.random() * 160;
}
function stepWeather(dt) {
  if (!settings.weather) { weather.tOver = 0; weather.tRain = 0; }
  else if ((weather.timer -= dt) <= 0) {
    const r = Math.random();
    setWeather(r < 0.5 ? 'clear' : r < 0.75 ? 'cloudy' : 'rain');
  }
  weather.overcast += clamp(weather.tOver - weather.overcast, -dt / 25, dt / 25);
  const rainTarget = weather.overcast > 0.72 ? weather.tRain : 0;
  weather.rain += clamp(rainTarget - weather.rain, -dt / 12, dt / 12);
  weather.wet += clamp((weather.rain > 0.2 ? 1 : 0) - weather.wet, -dt / 70, dt / 22);
  skyUniforms.uOvercast.value = weather.overcast;
  for (const m of [roadMat, spokeRoadMat]) {
    m.roughness = lerp(0.85, 0.28, weather.wet);
    m.envMapIntensity = lerp(0.5, 1.5, weather.wet);
    m.color.setScalar(lerp(1, 0.6, weather.wet));
  }
  const cloudShade = lerp(1, 0.5, weather.overcast);
  for (const c of cloudGroup.children) c.material.color.setScalar(cloudShade);
  rainMesh.visible = weather.rain > 0.01;
  if (rainMesh.visible) {
    rainMat.opacity = weather.rain * 0.55;
    const fall = 34 * dt, wx = -0.18, len = 1.2;
    for (let i = 0; i < RAIN_N; i++) {
      let y = rainDrops[i * 3 + 1] - fall;
      if (y < -6) y += 42;
      rainDrops[i * 3 + 1] = y;
      const x = rainDrops[i * 3], z = rainDrops[i * 3 + 2], o = i * 6;
      rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z;
      rainPos[o + 3] = x + wx; rainPos[o + 4] = y - len; rainPos[o + 5] = z;
    }
    rainGeo.attributes.position.needsUpdate = true;
    rainMesh.position.copy(camera.position);
  }
  if (weather.rain > 0.7 && Math.random() < dt * 0.05) {
    weather.flash = 1;
    setTimeout(() => VH.Audio.sfx('thunder'), 500 + Math.random() * 1600);
  }
  weather.flash = Math.max(0, weather.flash - dt * 4);
  VH.Audio.setRain(state === 'title' ? weather.rain * 0.5 : weather.rain);
}

/* --------------------------------------------------------- day / night -- */
let dayTime = 0.30;
const DAY_LEN = 360;
const fogDay = new THREE.Color(0x9ac2ee), fogNight = new THREE.Color(0x070b18),
      fogDawn = new THREE.Color(0xe8875a), fogGrey = new THREE.Color(0x8a939e), fogCol = new THREE.Color();
function stepDayNight(dt) {
  dayTime = (dayTime + dt / DAY_LEN) % 1;
  const sunEl = Math.sin(dayTime * TAU);
  const az = dayTime * TAU + Math.PI / 2;
  const sd = tmpV.set(Math.cos(az) * 0.8, sunEl, Math.sin(az) * 0.6).normalize();

  const uDay = smoothstep(-0.08, 0.25, sunEl);
  const uDawn = Math.exp(-Math.pow((sunEl - 0.05) * 5.5, 2)) * (1 - weather.overcast * 0.7);
  const uNight = 1 - smoothstep(-0.18, 0.0, sunEl);
  skyUniforms.sunDir.value.copy(sd);
  skyUniforms.uDay.value = uDay;
  skyUniforms.uDawn.value = uDawn;
  skyUniforms.uNight.value = uNight;

  // after sunset the key light becomes a cool moon on the opposite side
  const moon = sunEl < -0.02;
  sun.position.copy(player.pos).addScaledVector(sd, moon ? -380 : 380);
  if (moon) sun.position.y = player.pos.y + 300;
  sun.target.position.copy(player.pos);
  sun.intensity = (moon ? 0.34 * smoothstep(-0.02, -0.2, sunEl) : Math.max(0, sunEl) * 1.55 + 0.02) * (1 - weather.overcast * 0.78);
  if (moon) sun.color.setHex(0x9fb4ff);
  else sun.color.setHSL(0.085, clamp(0.95 - uDay * 0.75, 0, 0.9), 0.88);
  hemi.intensity = 0.11 + uDay * (0.21 + weather.overcast * 0.12) + weather.flash * 1.6;

  sunSprite.position.copy(camera.position).addScaledVector(sd, 2900);
  sunSprite.material.opacity = smoothstep(-0.12, 0.05, sunEl) * (1 - weather.overcast);

  fogCol.copy(fogNight).lerp(fogDay, uDay).lerp(fogDawn, uDawn * 0.4);
  fogCol.lerp(fogGrey, weather.overcast * uDay * 0.75);
  scene.fog.color.copy(fogCol);
  scene.fog.near = lerp(260, 70, weather.rain);
  scene.fog.far = lerp(1600, 620, weather.rain);

  // lit windows & street lamps after dark
  const dark = Math.max(uNight, weather.overcast * 0.35);
  buildingMat.emissiveIntensity = dark * 1.5;
  if (lampHeadMat) lampHeadMat.emissiveIntensity = dark * 3.0;

  const lightsOn = (sunEl < 0.06 || weather.rain > 0.5) && player.cfg.kind !== 'plane';
  for (const h of headlights) {
    h.sp.intensity = lightsOn ? 2.6 : 0;
    if (lightsOn) {
      const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
      const rxv = fz, rzv = -fx;
      h.sp.position.set(
        player.pos.x + fx * 2 + rxv * h.side * 0.7,
        player.pos.y + 0.8,
        player.pos.z + fz * 2 + rzv * h.side * 0.7);
      h.tgt.position.set(player.pos.x + fx * 40, player.pos.y - 1, player.pos.z + fz * 40);
    }
  }
  cloudGroup.rotation.y += dt * 0.0018;
  skyDome.position.set(camera.position.x, 0, camera.position.z);
  updateEnvironment();
}

/* -------------------------------------------------------------- camera -- */
const camPos = new THREE.Vector3(0, 30, -20);
function snapCamera() {
  if (!player.cfg) return;
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const back = player.cfg.kind === 'plane' ? 16 : 9.5;
  camPos.set(player.pos.x - fx * back, player.pos.y + 3.4, player.pos.z - fz * back);
}
function stepCamera(dt, speed) {
  const cfg = player.cfg;
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const spdRatio = clamp(speed / cfg.maxSpeed, 0, 1);
  const now = performance.now();
  if (state === 'title') {
    // slow turntable orbit; the car sits right of centre, clear of the menu
    const a = now * 0.00009 + 2.2;
    camPos.set(player.pos.x + Math.cos(a) * 8.4, 0, player.pos.z + Math.sin(a) * 8.4);
    camPos.y = Math.max(player.pos.y + 1.25, groundHeight(camPos.x, camPos.z) + 0.8);
    camera.position.copy(camPos);
    let lx = player.pos.x - camPos.x, lz = player.pos.z - camPos.z;
    const ln = Math.hypot(lx, lz) || 1; lx /= ln; lz /= ln;
    camera.lookAt(player.pos.x + lz * 1.8, player.pos.y + 0.75, player.pos.z - lx * 1.8);
    camera.fov = 42;
    camera.updateProjectionMatrix();
    return;
  }
  if (state === 'results') {
    const a = now * 0.00018;
    const target = tmpV.set(player.pos.x + Math.cos(a) * 13, player.pos.y + 4.5, player.pos.z + Math.sin(a) * 13);
    target.y = Math.max(target.y, groundHeight(target.x, target.z) + 1);
    camPos.lerp(target, 1 - Math.exp(-3 * dt));
    camera.position.copy(camPos);
    camera.lookAt(player.pos.x, player.pos.y + 1.2, player.pos.z);
    camera.fov = lerp(camera.fov, 50, 1 - Math.exp(-3 * dt));
    camera.updateProjectionMatrix();
    return;
  }
  let target;
  if (camMode === 0) {
    const back = cfg.kind === 'plane' ? 16 : 9.5;
    const up = cfg.kind === 'plane' ? 5.5 : 3.4;
    target = tmpV.set(player.pos.x - fx * back, player.pos.y + up, player.pos.z - fz * back);
  } else if (camMode === 1) {
    const back = cfg.kind === 'plane' ? 10 : 4.5;
    target = tmpV.set(player.pos.x - fx * back, player.pos.y + 2.0, player.pos.z - fz * back);
  } else if (camMode === 2) {           // cockpit / driver's eye
    const up = cfg.kind === 'plane' ? 2.2 : cfg.kind === 'bike' ? 1.55 : 1.16;
    const rxv = fz, rzv = -fx;
    const side = cfg.kind === 'car' ? -0.34 : 0;
    const fwd = cfg.kind === 'plane' ? 0.3 : -0.1;
    target = tmpV.set(
      player.pos.x + fx * fwd + rxv * side,
      player.pos.y + up + (player.grounded ? 0 : Math.sin(player.visPitch) * 0.5),
      player.pos.z + fz * fwd + rzv * side);
  } else {
    const a = now * 0.00025;
    target = tmpV.set(player.pos.x + Math.cos(a) * 22, player.pos.y + 9, player.pos.z + Math.sin(a) * 22);
  }
  if (camMode !== 2) {
    const camGround = groundHeight(target.x, target.z) + 1.2;
    if (target.y < camGround) target.y = camGround;
  }
  const k = 1 - Math.exp(-(camMode === 3 ? 2.2 : camMode === 2 ? 22 : 5.5) * dt);
  camPos.lerp(target, k);
  camera.position.copy(camPos);
  // speed + impact shake
  const sh = settings.shake ? spdRatio * spdRatio * (camMode === 2 ? 0.03 : 0.09) + camShake * 0.5 : 0;
  camShake = Math.max(0, camShake - dt * 2.2);
  camera.position.x += (Math.random() - 0.5) * sh;
  camera.position.y += (Math.random() - 0.5) * sh;
  if (camMode === 2 && cfg.kind === 'plane') {
    camera.lookAt(
      camera.position.x + Math.sin(player.yaw) * 30 * Math.cos(player.pitch),
      camera.position.y + Math.sin(player.pitch) * 30,
      camera.position.z + Math.cos(player.yaw) * 30 * Math.cos(player.pitch));
  } else if (camMode === 2) {
    camera.lookAt(camera.position.x + fx * 30, camera.position.y - 0.15 + Math.sin(player.visPitch) * 30, camera.position.z + fz * 30);
  } else {
    camera.lookAt(player.pos.x + fx * 10, player.pos.y + 1.6, player.pos.z + fz * 10);
  }
  camera.fov = lerp(camera.fov, settings.fov + spdRatio * 16 + (player.nitroOn ? 6 : 0), 1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();
}

/* ======================================================================
   MAP — painted once from the heightfield, used by minimap & world map
   ====================================================================== */
const MAP_PX = 640;
const mapCanvas = (function buildMapCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = MAP_PX;
  const g = c.getContext('2d');
  const img = g.createImageData(MAP_PX, MAP_PX);
  const hs = new Float32Array(MAP_PX * MAP_PX);
  const sc = WORLD / MAP_PX;
  for (let y = 0; y < MAP_PX; y++) for (let x = 0; x < MAP_PX; x++) {
    hs[y * MAP_PX + x] = terrainHeight(-WORLD / 2 + (x + 0.5) * sc, -WORLD / 2 + (y + 0.5) * sc);
  }
  const col = new THREE.Color(), tmp = new THREE.Color();
  const cG1 = new THREE.Color(0x3f6b31), cG2 = new THREE.Color(0x5f8a3c), cRock = new THREE.Color(0x8d867a),
        cSand = new THREE.Color(0xcfc094), cSnow = new THREE.Color(0xf4f6f9), cWater = new THREE.Color(0x1b4f7c);
  for (let y = 0; y < MAP_PX; y++) for (let x = 0; x < MAP_PX; x++) {
    const i = y * MAP_PX + x, h = hs[i];
    const hx = hs[i + (x < MAP_PX - 1 ? 1 : 0)] - hs[i - (x > 0 ? 1 : 0)];
    const hz = hs[i + (y < MAP_PX - 1 ? MAP_PX : 0)] - hs[i - (y > 0 ? MAP_PX : 0)];
    const slope = Math.hypot(hx, hz) / (2 * sc);
    if (h < WATER_Y) {
      col.copy(cWater).multiplyScalar(0.8 + clamp((h - WATER_Y + 12) / 12, 0, 1) * 0.35);
    } else {
      col.copy(cG1).lerp(cG2, clamp((h - 10) / 40, 0, 1));
      col.lerp(cRock, smoothstep(0.35, 0.7, slope));
      col.lerp(tmp.copy(cSand), 1 - smoothstep(WATER_Y + 0.8, WATER_Y + 3.2, h));
      col.lerp(tmp.copy(cSnow), smoothstep(58, 68, h));
      const shade = clamp(1 + (-hx + -hz) / (2 * sc) * 0.9, 0.55, 1.35);   // light from the north-west
      col.multiplyScalar(shade);
    }
    img.data[i * 4] = clamp(col.r * 255, 0, 255);
    img.data[i * 4 + 1] = clamp(col.g * 255, 0, 255);
    img.data[i * 4 + 2] = clamp(col.b * 255, 0, 255);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const m = (v) => (v + WORLD / 2) / sc;
  // downtown
  g.fillStyle = 'rgba(150,154,164,0.95)';
  g.beginPath(); g.arc(m(0), m(0), CITY_R / sc, 0, TAU); g.fill();
  g.fillStyle = 'rgba(80,86,98,0.95)';
  for (const b of buildings) if (b.base === undefined) g.fillRect(m(b.x - b.hw), m(b.z - b.hd), b.hw * 2 / sc, b.hd * 2 / sc);
  // airfield
  g.fillStyle = '#4c5058';
  g.fillRect(m(STRIP.x - STRIP.hl), m(STRIP.z - STRIP.hw), STRIP.hl * 2 / sc, STRIP.hw * 2 / sc);
  // roads
  const road = (w, style) => {
    g.strokeStyle = style; g.lineWidth = w; g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= 360; i++) {
      const p = roadPoint(i / 360);
      i ? g.lineTo(m(p.x), m(p.z)) : g.moveTo(m(p.x), m(p.z));
    }
    g.closePath(); g.stroke();
    for (const s of SPOKES) {
      g.beginPath();
      g.moveTo(m(s.cx * (CITY_R - 10)), m(s.cz * (CITY_R - 10)));
      g.lineTo(m(s.cx * s.r1), m(s.cz * s.r1));
      g.stroke();
    }
  };
  road(6, 'rgba(20,22,28,0.9)');
  road(3.4, '#e9e4d6');
  return c;
})();

/* -------------------------------------------------------------- minimap - */
const mmCanvas = document.getElementById('minimap');
const mmCtx = mmCanvas.getContext('2d');
function drawMinimap() {
  const g = mmCtx, S = mmCanvas.width, R = S / 2;
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(R, R, R - 2, 0, TAU); g.clip();
  g.fillStyle = '#10223a'; g.fillRect(0, 0, S, S);
  const viewM = lerp(520, 1000, clamp(player.speed / 80, 0, 1)) * (player.cfg.kind === 'plane' ? 1.6 : 1);
  const s = S / viewM;
  const heading = Math.atan2(Math.cos(player.yaw), Math.sin(player.yaw));
  const rot = -Math.PI / 2 - heading;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const px = player.pos.x, pz = player.pos.z;
  const toMM = (x, z) => {
    const dx = (x - px) * s, dz = (z - pz) * s;
    return [R + dx * cs - dz * sn, R + dx * sn + dz * cs];
  };
  g.save();
  g.translate(R, R); g.rotate(rot);
  g.imageSmoothingEnabled = true;
  g.drawImage(mapCanvas, (-WORLD / 2 - px) * s, (-WORLD / 2 - pz) * s, WORLD * s, WORLD * s);
  g.restore();
  // event route
  if (ev.active && ev.gates.length) {
    g.strokeStyle = 'rgba(42,255,198,0.85)'; g.lineWidth = 3; g.setLineDash([6, 5]);
    g.beginPath();
    let first = true;
    for (let i = ev.cp; i < Math.min(ev.gates.length, ev.cp + 4); i++) {
      const [x, y] = toMM(ev.gates[i].pos.x, ev.gates[i].pos.z);
      if (first) { const [x0, y0] = toMM(px, pz); g.moveTo(x0, y0); first = false; }
      g.lineTo(x, y);
    }
    g.stroke(); g.setLineDash([]);
    const ng = ev.gates[ev.cp];
    if (ng) {
      let [x, y] = toMM(ng.pos.x, ng.pos.z);
      const d = Math.hypot(x - R, y - R);
      if (d > R - 10) { x = R + (x - R) * (R - 10) / d; y = R + (y - R) * (R - 10) / d; }
      g.fillStyle = '#2affc6'; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill();
    }
    if (ev.ai) {
      g.fillStyle = '#ff7b6b';
      for (const ai of aiRacers) { const [x, y] = toMM(ai.pos.x, ai.pos.z); g.beginPath(); g.arc(x, y, 4, 0, TAU); g.fill(); }
    }
  } else {
    for (const m of markers) {
      const [x, y] = toMM(m.pos.x, m.pos.z);
      if (x < -10 || y < -10 || x > S + 10 || y > S + 10) continue;
      g.fillStyle = eventLock(m.def) ? '#6d7588' : '#' + new THREE.Color(TYPE_COLORS[m.def.type]).getHexString();
      g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(TYPE_ICONS[m.def.type], x, y + 0.5);
    }
    g.fillStyle = '#3be8ff';
    for (const t of traps) { const [x, y] = toMM(t.pos.x, t.pos.z); g.fillRect(x - 3, y - 3, 6, 6); }
    g.fillStyle = '#b45cff';
    for (const z of driftZones) { const [x, y] = toMM(z.a.x, z.a.z); g.fillRect(x - 3, y - 3, 6, 6); }
    g.fillStyle = '#f2b41c';
    for (const r of RAMPS) { const [x, y] = toMM(r.x, r.z); g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 4, y + 3); g.lineTo(x - 4, y + 3); g.fill(); }
  }
  if (!trafficHidden) {
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (const c of traffic) {
      const [x, y] = toMM(c.pos.x, c.pos.z);
      if (x > 0 && y > 0 && x < S && y < S) g.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }
  // player arrow (always pointing up)
  g.fillStyle = '#59d1ff'; g.strokeStyle = '#06101f'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(R, R - 9); g.lineTo(R + 6, R + 6); g.lineTo(R, R + 3); g.lineTo(R - 6, R + 6); g.closePath();
  g.fill(); g.stroke();
  // north marker on the rim
  const nAng = rot - Math.PI / 2;
  g.fillStyle = '#ffd75e'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('N', R + Math.cos(nAng) * (R - 12), R + Math.sin(nAng) * (R - 12));
  g.restore();
  g.strokeStyle = 'rgba(130,170,255,0.45)'; g.lineWidth = 2;
  g.beginPath(); g.arc(R, R, R - 2, 0, TAU); g.stroke();
}

/* ======================================================================
   GAME STATE — title · play · pause · map · garage · results
   ====================================================================== */
let state = 'boot';
let radioOn = true;
function setState(s) { state = s; ui.setState(s); }

function stageTitleScene() {
  // the hero shot: the 458 on the downtown plaza at golden hour
  setVehicle('f458');
  const sp = SPOKES[0], r = sp.r0 + 105;
  placePlayer(sp.cx * r, sp.cz * r, Math.atan2(-sp.cx, -sp.cz) + 0.5);
  dayTime = 0.455;
  player.vel.set(0, 0, 0);
}
function enterTitle() {
  careerLive = false;
  profile = VH.Save.load() || VH.Save.defaultProfile();
  stageTitleScene();
  setState('title');
  ui.showTitle(VH.Save.hasSave());
  VH.Audio.music('menu');
  refreshAllMarkers();
}
function beginCareer() {
  careerLive = true;
  refreshAllMarkers();
  setState('play');
  ui.hideTitle();
  if (radioOn) VH.Audio.music('drive'); else VH.Audio.music('off');
  ui.refreshProfile();
}
let tutorial = null;
function newGame() {
  VH.Save.wipe();
  profile = VH.Save.defaultProfile();
  ui.fade(true);
  setTimeout(() => {
    setVehicle('bandit');
    dayTime = 0.29;
    setWeather('clear'); weather.overcast = weather.rain = weather.wet = 0;
    const op = C.EVENTS.find(e => e.id === 'opener');
    respawnToRoad(wrap01(op.t0 - 0.03));
    beginCareer();
    tutorial = { step: 0, timer: 2.5 };
    saveProfile();
    ui.fade(false);
    showMsg('VELOCITY HORIZON\nFESTIVAL', 2600);
  }, 450);
}
function continueGame() {
  const saved = VH.Save.load();
  if (!saved) return newGame();
  profile = saved;
  ui.fade(true);
  setTimeout(() => {
    setVehicle(profile.current);
    dayTime = 0.3;
    const lp = profile.lastPos;
    if (lp && terrainHeight(lp.x, lp.z) > WATER_Y) placePlayer(lp.x, lp.z, lp.yaw);
    else respawnToRoad(0.03);
    beginCareer();
    ui.fade(false);
    ui.toast('Welcome back', 'Level ' + profile.level + ' · ' + profile.credits.toLocaleString() + ' CR · ' + totalStars() + ' ★', 'info');
  }, 450);
}
function quitToTitle() {
  if (ev.active) cleanupEvent();
  saveProfile();
  skillReset();
  driftZone.active = null;
  tutorial = null;
  ui.fade(true);
  setTimeout(() => { enterTitle(); ui.fade(false); }, 420);
}
function pauseGame() { if (state !== 'play') return; setState('pause'); ui.openPause(ev.active); VH.Audio.sfx('click'); }
function resumeGame() { setState('play'); ui.closePanels(); VH.Audio.sfx('back'); }
function openGarage() {
  if (ev.active) { showMsg('Garage is closed during events', 1200); VH.Audio.sfx('error'); return; }
  setState('garage'); ui.openGarage(); VH.Audio.sfx('click');
}
function openMap() { setState('map'); ui.openMap(); VH.Audio.sfx('click'); }
function resultsContinue() {
  if (state !== 'results') return;
  const champion = ui.resultsChampion();
  ui.hideResults();
  cleanupEvent();
  setState('play');
  if (champion) { setState('ending'); ui.showEnding(endingStats()); }
}
function resultsRestart() {
  if (state !== 'results') return;
  ui.hideResults();
  setState('play');
  restartEvent();
}
function endingStats() {
  const s = profile.stats;
  return [
    ['Level', profile.level], ['Stars', totalStars() + ' / ' + maxStars()],
    ['Events completed', s.eventsDone], ['Races won', s.racesWon],
    ['Distance driven', (s.distance / 1000).toFixed(1) + ' km'], ['Top speed', speedText(s.topSpeed)],
    ['Near misses', s.nearMisses], ['Neon tokens', profile.tokens.length + ' / ' + tokens.length],
    ['Time played', Math.round(s.playTime / 60) + ' min'],
  ];
}
function maxStars() { return (C.EVENTS.length + C.SPEED_TRAPS.length + C.DRIFT_ZONES.length + C.JUMPS.length) * 3; }

function stepTutorial(dt) {
  if (!tutorial || state !== 'play') return;
  tutorial.timer -= dt;
  if (tutorial.timer > 0) return;
  const tips = [
    ['Welcome to the festival!', 'Drive into a glowing marker and press ENTER to start an event. The Horizon Opener is just ahead.'],
    ['World map — M', 'See every event, speed trap, drift zone, jump and token. Click an event to fast travel.'],
    ['Skill chains', 'Drift, jump, go fast and near-miss traffic to build a chain. Keep it alive, then bank it for credits & XP.'],
    ['Garage — V', 'Buy cars, bikes and planes, upgrade engines and tyres, and pick your paint.'],
    ['The Horizon Finale', 'Downtown. Unlocks at level 8 with 24 stars. Win it to become champion.'],
  ];
  const t = tips[tutorial.step++];
  if (!t) { tutorial = null; profile.tutorialDone = true; return; }
  ui.toast(t[0], t[1], 'tip');
  tutorial.timer = 10;
}

/* -------------------------------------------------------- UI command API - */
function selectVehicle(id) {
  if (!profile.owned.includes(id) || ev.active) return false;
  const wasPlane = player.cfg.kind === 'plane';
  setVehicle(id);
  const nowPlane = player.cfg.kind === 'plane';
  if (wasPlane !== nowPlane || !player.grounded) {
    if (terrainHeight(player.pos.x, player.pos.z) < WATER_Y) respawnToRoad();
    else placePlayer(player.pos.x, player.pos.z, player.yaw);
  }
  profile.current = id;
  saveProfile();
  return true;
}
function buyVehicle(id) {
  const v = vehicleById(id);
  if (profile.owned.includes(id)) return { ok: false, msg: 'Already owned' };
  if (profile.level < v.level) return { ok: false, msg: 'Requires level ' + v.level };
  if (profile.credits < v.price) return { ok: false, msg: 'Not enough credits' };
  profile.credits -= v.price;
  profile.owned.push(id);
  VH.Audio.sfx('buy');
  ui.toast('New vehicle!', v.name + ' added to your garage', 'gold');
  selectVehicle(id);
  return { ok: true };
}
function buyUpgrade(id, slot) {
  const v = vehicleById(id);
  const up = upgradesOf(id);
  if (up[slot] >= 3) return { ok: false, msg: 'Fully upgraded' };
  const cost = C.upgradeCost(v, slot, up[slot]);
  if (profile.credits < cost) return { ok: false, msg: 'Not enough credits' };
  profile.credits -= cost;
  up[slot]++;
  if (id === player.vid) {
    const keepNitro = player.nitro;
    player.cfg = vehicleStats(v);
    player.nitro = keepNitro;
  }
  VH.Audio.sfx('buy');
  saveProfile();
  return { ok: true };
}
function setPaint(id, hex) {
  profile.paints[id] = hex;
  if (id === player.vid) setVehicle(id, true);
  VH.Audio.sfx('click');
  saveProfile();
}
function applyQuality(q) {
  const dpr = window.devicePixelRatio || 1;
  const Q = {
    low:    { pr: Math.min(dpr, 1) * 0.7, shadow: 0, bloom: false },
    medium: { pr: Math.min(dpr, 1), shadow: 1024, bloom: true },
    high:   { pr: Math.min(dpr, 1.5), shadow: 2048, bloom: true },
    ultra:  { pr: Math.min(dpr, 2), shadow: 4096, bloom: true },
  }[q] || { pr: 1, shadow: 2048, bloom: true };
  renderer.setPixelRatio(Q.pr);
  renderer.setSize(innerWidth, innerHeight);
  setPostSize();
  sun.castShadow = Q.shadow > 0;
  if (Q.shadow && sun.shadow.mapSize.x !== Q.shadow) {
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  bloomPass.enabled = Q.bloom;
}
function applySettings(patch) {
  const prevQ = settings.quality;
  Object.assign(settings, patch || {});
  VH.Save.saveSettings(settings);
  if (!patch || patch.quality !== undefined && patch.quality !== prevQ) applyQuality(settings.quality);
  VH.Audio.setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx });
}
function fastTravel(id) {
  if (ev.active || !careerLive) return false;
  const m = markers.find(mm => mm.def.id === id);
  if (!m) return false;
  const back = new THREE.Vector3(m.pos.x - 20, 0, m.pos.z);
  // approach from the road side when the marker is on the highway
  if (m.def.t0 !== undefined && !m.def.at) {
    const t = wrap01(m.def.t0 - 0.02);
    const p = roadPoint(t);
    back.set(p.x, 0, p.z);
  }
  ui.fade(true);
  setTimeout(() => {
    placePlayer(back.x, back.z, Math.atan2(m.pos.x - back.x, m.pos.z - back.z));
    ui.closePanels();
    setState('play');
    ui.fade(false);
  }, 380);
  return true;
}
function mapInfo() {
  return {
    canvas: mapCanvas, world: WORLD,
    player: { x: player.pos.x, z: player.pos.z, yaw: player.yaw },
    events: markers.map(m => Object.assign(eventCard(m.def), { x: m.pos.x, z: m.pos.z, icon: TYPE_ICONS[m.def.type] })),
    traps: traps.map(t => ({ name: t.def.name, x: t.pos.x, z: t.pos.z, rec: profile.events[t.def.id] || null, fmt: v => speedText(v / 3.6) })),
    drifts: driftZones.map(z => ({ name: z.def.name, x: z.a.x, z: z.a.z, rec: profile.events[z.def.id] || null, fmt: v => Math.round(v).toLocaleString() + ' pts' })),
    jumps: RAMPS.map(r => ({ name: r.def.name, x: r.x, z: r.z, rec: profile.events[r.def.id] || null, fmt: v => Math.round(v) + ' m' })),
    tokens: tokens.map((t, i) => ({ x: t.pos.x, z: t.pos.z, found: profile.tokens.includes(i), air: t.air })),
    stars: totalStars(), maxStars: maxStars(), inEvent: ev.active,
  };
}

const api = {
  get profile() { return profile; },
  get settings() { return settings; },
  content: C, vehicles: VEHICLES,
  vehicleStats, upgradesOf, vehicleById,
  currentVehicle: () => player.vid,
  inEvent: () => ev.active,
  hasSave: () => VH.Save.hasSave(),
  buyVehicle, selectVehicle, buyUpgrade, setPaint, applySettings,
  newGame, continueGame, resume: resumeGame, quitToTitle,
  restartEvent: () => { ui.closePanels(); setState('play'); restartEvent(); },
  quitEvent: () => { ui.closePanels(); setState('play'); quitEvent(); },
  openGarage: () => { ui.closePanels(); openGarage(); },
  openMap: () => { ui.closePanels(); openMap(); },
  closePanel: () => resumeGame(),
  resultsContinue, resultsRestart,
  mapInfo, fastTravel, eventCard, totalStars, maxStars,
  startEventById: (id) => { const d = C.EVENTS.find(e => e.id === id); if (d) startEvent(d); },
  sfx: (n) => VH.Audio.sfx(n),
  fmtTime, speedText,
  wipeSave: () => { VH.Save.wipe(); },
};

const ui = VH.createUI(api);

/* -------------------------------------------------------------- input --- */
function doAction(a) {
  switch (state) {
    case 'title':
      if (a === 'confirm') ui.menuConfirm();
      else if (a === 'back') ui.subBack();
      break;
    case 'play':
      if (a === 'pause') pauseGame();
      else if (a === 'map') openMap();
      else if (a === 'garage') openGarage();
      else if (a === 'camera') camMode = (camMode + 1) % 4;
      else if (a === 'confirm') { const d = eventNearby(); if (d) startEvent(d); }
      else if (a === 'reset') {
        if (!ev.active) respawnToRoad();
        else if (ev.phase === 'run' && ev.def.type === 'scramble') scrambleRespawn();
        else if (ev.phase === 'run' && ev.def.type === 'air') airRespawn();
        else if (ev.phase === 'run') {           // back onto the racing line at our last gate
          const g = ev.gates[Math.max(0, ev.cp - 1)];
          const t = trackT(g.pos.x, g.pos.z);
          respawnToRoad(ev.cp ? t : wrap01(ev.t0 - 30 / ROAD_LEN));
        }
      }
      break;
    case 'pause':
      if (a === 'confirm') ui.menuConfirm();
      else if (a === 'pause' || a === 'back') { if (!ui.subBack()) resumeGame(); }
      break;
    case 'map':
      if (a === 'confirm') ui.menuConfirm();
      else if (a === 'map' || a === 'back' || a === 'pause') resumeGame();
      break;
    case 'garage':
      if (a === 'confirm') ui.menuConfirm();
      else if (a === 'garage' || a === 'back' || a === 'pause') resumeGame();
      break;
    case 'results':
      if (a === 'confirm') resultsContinue();
      else if (a === 'reset') resultsRestart();
      break;
    case 'ending':
      if (a === 'confirm' || a === 'back' || a === 'pause') { ui.hideEnding(); setState('play'); }
      break;
  }
}
addEventListener('keydown', (e) => {
  const k = e.code;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
  VH.Audio.init();
  if (e.repeat) return;
  keys[k] = true;
  if (k === 'Escape' || k === 'KeyP') doAction(state === 'play' ? 'pause' : 'back');
  else if (k === 'KeyM' || k === 'Tab') doAction('map');
  else if (k === 'KeyV') doAction('garage');
  else if (k === 'KeyC') doAction('camera');
  else if ((k === 'Enter' || k === 'NumpadEnter') && (state === 'play' || state === 'results' || state === 'ending')) {
    e.preventDefault();          // no native click on whatever button the next screen focuses
    doAction('confirm');
  }
  else if (k === 'KeyR') doAction('reset');
  if (state !== 'play') return;
  if (k === 'KeyH') ui.toggleHelp();
  if (k === 'KeyT' && !ev.active) teleportToAirfield();
  if (k === 'KeyN' && !ev.active) dayTime = (dayTime + 0.08) % 1;
  if (k === 'KeyQ') {
    radioOn = !radioOn;
    VH.Audio.music(radioOn ? (ev.active ? 'race' : 'drive') : 'off');
    showMsg(radioOn ? 'RADIO ON' : 'RADIO OFF', 800);
  }
  const num = parseInt(e.key, 10);
  if (num >= 1 && num <= VEHICLES.length && !ev.active) {
    const v = VEHICLES[num - 1];
    if (profile.owned.includes(v.id)) { if (v.id !== player.vid) selectVehicle(v.id); }
    else { VH.Audio.sfx('error'); showMsg(v.name + ' — not owned\nBuy it in the garage (V)', 1500); }
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play') pauseGame(); });
function handlePadButtons() {
  for (const b of pad.pressed) {
    VH.Audio.init();
    if (b === 9) doAction(state === 'play' ? 'pause' : 'back');
    else if (b === 8) doAction('map');
    else if (b === 3) doAction('camera');
    else if (b === 0) doAction('confirm');
    else if (b === 1) doAction(state === 'results' ? 'reset' : 'back');
    else if (b === 4 && state === 'play') doAction('reset');
    else if (b === 12) ui.menuMove(-1);
    else if (b === 13) ui.menuMove(1);
    else if (b === 14) ui.menuMove(-1, true);
    else if (b === 15) ui.menuMove(1, true);
  }
}

/* ---------------------------------------------------------------- HUD --- */
let hudClock = 0, mmClock = 0, promptClock = 0, saveClock = 0, lastPrompt = null;
function stepHUD(dt) {
  hudClock += dt;
  if (hudClock < 0.066) return;
  hudClock = 0;
  const cfg = player.cfg;
  let evHud = null;
  if (ev.active && ev.gates.length) {
    const g = ev.gates[Math.min(ev.cp, ev.gates.length - 1)];
    const next = ev.targets ? ev.targets.slice().reverse().find(t => ev.time <= t) : null;
    evHud = {
      name: ev.def.name, phase: ev.phase, type: ev.def.type, ai: ev.ai,
      pos: ev.ai ? racePosition() : 0, field: 4, lap: Math.min(ev.lap + 1, ev.laps), laps: ev.laps,
      cp: ev.cp, cps: ev.gates.length, time: fmtTime(ev.time),
      bestLap: ev.bestLap ? fmtTime(ev.bestLap) : null,
      nextStar: next !== undefined && next !== null ? fmtTime(next) : null,
      starsNow: ev.targets ? ev.targets.filter(t => ev.time <= t).length : null,
      dist: Math.round(g.ring ? player.pos.distanceTo(g.pos) : Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z)),
    };
  }
  ui.hud({
    speed: player.speed, units: settings.units, gear: player.gear, rpm: player.rpm,
    nitro: player.nitro, nitroOn: player.nitroOn, kind: cfg.kind, maxSpeed: cfg.maxSpeed,
    throttle: player.throttleLevel,
    alt: Math.max(0, player.pos.y - terrainHeight(player.pos.x, player.pos.z)),
    credits: profile.credits, level: profile.level, xp: profile.xp, xpNext: C.xpToNext(profile.level),
    event: evHud,
    chain: (skill.chain > 0 || skill.cur) ? {
      chain: Math.round(skill.chain), mult: skill.mult, cur: skill.cur ? skillName() : null,
      curPts: Math.round(skill.curPts), timer: skill.cur ? 1 : skill.timer / CHAIN_TIME } : null,
    driftZone: driftZone.active ? Math.round(driftZone.active.score) : null,
    weather: weather.kind, radio: radioOn,
  });
}
function stepPrompt(dt) {
  promptClock += dt;
  if (promptClock < 0.2) return;
  promptClock = 0;
  const def = state === 'play' && careerLive ? eventNearby() : null;
  if (def) { ui.prompt(eventCard(def)); lastPrompt = def; }
  else if (lastPrompt) { ui.prompt(null); lastPrompt = null; }
}

/* --------------------------------------------------------------- audio -- */
function stepAudio() {
  const cfg = player.cfg;
  const r = clamp(player.speed / cfg.maxSpeed, 0, 1);
  const inp = cfg.kind === 'plane' ? null : inputAxis();
  VH.Audio.engine({
    active: state === 'play' || state === 'results',
    kind: cfg.kind, jet: !!cfg.jet, rpm: player.rpm,
    throttle: cfg.kind === 'plane' ? player.throttleLevel : (inp.throttle || 0),
    speedRatio: r,
    skid: cfg.kind !== 'plane' && player.grounded && player.drifting ? clamp(player.slip * 2, 0.3, 1) : 0,
    offroad: cfg.kind !== 'plane' && player.grounded && surfaceKind(player.pos.x, player.pos.z) === 'dirt' ? 1 : 0,
  });
}

/* ---------------------------------------------------------------- debug - */
// test hooks (used by the automated browser checks)
const autopilot = { on: false };
window.__vh = {
  get state() { return state; }, player, ev, weather, autopilot,
  get profile() { return profile; },
  startEvent: (id, patch) => startEvent(Object.assign({}, C.EVENTS.find(e => e.id === id), patch || {})),
  newGame, continueGame, setWeather, setDay: (t) => { dayTime = t; },
  teleport: (x, z, yaw) => placePlayer(x, z, yaw || 0),
  roadT: (t) => respawnToRoad(t),
  give: (cr, xp) => { addCredits(cr || 0); addXP(xp || 0); },
  selectVehicle: (id) => { if (!profile.owned.includes(id)) profile.owned.push(id); selectVehicle(id); },
  finishNow: () => { if (ev.active && ev.phase === 'run') { ev.cp = ev.gates.length - 1; ev.lap = ev.laps - 1; const g = ev.gates[ev.cp]; player.pos.set(g.pos.x, g.pos.y, g.pos.z); } },
  ramps: RAMPS, markers, ROAD_LEN, camera, scene, renderer,
};
function autopilotInput(inp) {
  if (!autopilot.on || state !== 'play') return inp;
  let tx, tz, vmax = 999;
  if (ev.active && !ev.gates[ev.cp]) return inp;
  if (ev.active && !ev.gates[ev.cp].road) { tx = ev.gates[ev.cp].pos.x; tz = ev.gates[ev.cp].pos.z; vmax = 45; }
  else {
    const t = trackT(player.pos.x, player.pos.z);
    const p = roadPoint(wrap01(t + (12 + player.speed * 0.45) / ROAD_LEN)); tx = p.x; tz = p.z;
    const k = Math.max(curvAt(t + (player.speed * 1.4 + 20) / ROAD_LEN), curvAt(t + 15 / ROAD_LEN), 1e-4);
    vmax = Math.sqrt((autopilot.lat || 30) / k);
  }
  let diff = Math.atan2(tx - player.pos.x, tz - player.pos.z) - player.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const v = player.speed;
  return { throttle: v < vmax ? 1 : 0, brake: v > vmax + 4 ? 1 : 0,
    steer: clamp(diff * 2.2, -1, 1), hand: 0, nitro: autopilot.nitro !== false && v < vmax - 8 && Math.abs(diff) < 0.12 ? 1 : 0 };
}

/* ---------------------------------------------------------------- main -- */
applySettings();
scene.traverse(o => { if (o.isInstancedMesh) o.frustumCulled = false; });
setVehicle('f458');
enterTitle();
snapCamera();
updateEnvironment();

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  tick(Math.min(clock.getDelta(), 0.05));
  composer.render();
}
function tick(rawDt) {
  pollGamepad();
  handlePadButtons();
  const frozen = state === 'pause' || state === 'map' || state === 'garage' || state === 'ending';
  const dt = frozen ? 0 : rawDt;
  if (dt > 0 && state !== 'title') {
    player.speed = player.cfg.kind === 'plane' ? stepPlane(dt) : stepGroundVehicle(dt);
    if (state === 'play' && careerLive) {
      profile.stats.distance += player.speed * dt;
      profile.stats.playTime += dt;
      if (player.speed > profile.stats.topSpeed && player.cfg.kind !== 'plane') profile.stats.topSpeed = player.speed;
    }
  } else if (state === 'title') {
    player.speed = 0;
    for (const p of player.props) p.rotation.z += dt * 3;
  }
  stepAI(dt);
  if (state === 'play') stepEvent(dt);
  stepTraffic(dt);
  stepStunts(dt);
  stepTokens(dt);
  stepSkills(dt);
  stepTutorial(dt);
  stepWeather(dt);
  stepDayNight(dt);
  stepParticles(dt);
  waterMat.normalMap.offset.x += dt * 0.012;
  waterMat.normalMap.offset.y += dt * 0.007;
  stepCamera(rawDt, player.speed);
  stepAudio();
  if (state !== 'title') {
    stepHUD(rawDt);
    stepPrompt(rawDt);
    mmClock += rawDt;
    if (mmClock > 0.05) { drawMinimap(); mmClock = 0; }
  }
  if (state === 'map') ui.drawMap();
  if (careerLive && state === 'play' && (saveClock += rawDt) > 20) { saveClock = 0; saveProfile(); }
  for (const m of markers) m.ring.rotation.y += rawDt * 0.5;
}
// debug: run the simulation faster than real time (no rendering in between)
window.__vh.advance = (sec) => { for (let t = 0; t < sec; t += 1 / 60) tick(1 / 60); };
frame();

addEventListener('beforeunload', () => saveProfile());
document.getElementById('loading').classList.add('done');
window.__gameReady = true;

})();
