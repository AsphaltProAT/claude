/* ============================================================================
   VELOCITY HORIZON — open-world arcade racer (cars · bikes · planes)
   v2 "peak graphics": PBR + IBL reflections, procedural textures, atmospheric
   sky shader with stars, bloom/FXAA post pipeline, particle smoke & dust,
   curved car bodies with clearcoat paint, night city with lit windows.
   Pure Three.js, no build step, no downloaded assets.
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

let CITY_H = 0, STRIP_H = 0;

function roadDistInfo(x, z) {
  const r = Math.hypot(x, z);
  if (r < 60) return { d: 1e9, a: 0 };
  const a = Math.atan2(z, x);
  return { d: Math.abs(r - roadRadius(a)), a: a };
}
function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  const ri = roadDistInfo(x, z);
  if (ri.d < 42) {
    const rr = roadRadius(ri.a);
    const hr = lowHeight(Math.cos(ri.a) * rr, Math.sin(ri.a) * rr);
    h = lerp(hr, h, smoothstep(10, 42, ri.d));
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
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}
function surfaceKind(x, z) {
  if (roadDistInfo(x, z).d < ROAD_HALF + 1.5) return 'road';
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
    uniform float uDay, uDawn, uNight;
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
      col += vec3(star) * uNight * smoothstep(0.02, 0.28, y) * 0.9;
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
  const bucket = Math.floor(dayTime * 24);
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
CITY_H = lowHeight(0, 0);
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
let lampHeadMat;
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
  ribbon(ROAD_HALF, 0.10, new THREE.MeshStandardMaterial({
    map: asphaltTex, bumpMap: asphaltBump, bumpScale: 0.15,
    roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 0.5
  }), 0, true);
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
  buildings.push({ x: hangar.position.x, z: hangar.position.z, hw: 17, hd: 13, h: 12 });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 26, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.6, envMapIntensity: 0.6 }));
  tower.position.set(STRIP.x + 120, STRIP_H + 13, STRIP.z + STRIP.hw + 22);
  tower.castShadow = true;
  scene.add(tower);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(11, 5, 11),
    new THREE.MeshStandardMaterial({ color: 0x27394f, roughness: 0.15, metalness: 0.85, envMapIntensity: 1.1 }));
  cab.position.set(STRIP.x + 120, STRIP_H + 28.5, STRIP.z + STRIP.hw + 22);
  scene.add(cab);
  buildings.push({ x: tower.position.x, z: tower.position.z, hw: 5.5, hd: 5.5, h: 32 });
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
    if (Math.hypot(x, z) < CITY_R + 30) continue;
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
(function loadCarModel() {
  if (!window.VH_CAR_GLB || !THREE.GLTFLoader) return;
  try {
    const bin = atob(window.VH_CAR_GLB);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const loader = new THREE.GLTFLoader();
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
    loader.parse(buf.buffer, '', (gltf) => {
      carTemplate = gltf.scene;
      window.__carModelLoaded = true;
      // refresh anything already built from the placeholder
      if (player.cfg && player.cfg.glb) setVehicle(VEHICLES.indexOf(player.cfg));
      upgradeAIMeshes();
    }, (e) => console.warn('car model parse failed', e));
  } catch (e) { console.warn('car model decode failed', e); }
})();

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
(function loadPlaneModel() {
  if (!window.VH_PLANE_GLB || !THREE.GLTFLoader) return;
  try {
    const bin = atob(window.VH_PLANE_GLB);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const loader = new THREE.GLTFLoader();
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
    loader.parse(buf.buffer, '', (gltf) => {
      const root = gltf.scene;
      const g = new THREE.Group();
      // The mesh is skinned and its rendered size lives in the skeleton's bind
      // matrices, so bounding boxes lie. Scale calibrated visually: ~9 m wingspan.
      const SCALE = 105;
      root.scale.setScalar(SCALE);
      const bb = new THREE.Box3().setFromObject(root);
      root.position.y -= bb.min.y;
      g.add(root);
      root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      const prop = root.getObjectByName('Propellor_Joint');
      planeBuilt = { group: g, glbRoot: root, wheels: [], steer: [], props: prop ? [prop] : [] };
      window.__planeModelLoaded = true;
      if (player.cfg && player.cfg.glbPlane) setVehicle(VEHICLES.indexOf(player.cfg));
    }, (e) => console.warn('plane model parse failed', e));
  } catch (e) { console.warn('plane model decode failed', e); }
})();

function upgradeAIMeshes() {
  if (!carTemplate) return;
  const colors = [0xcfd2d6, 0xd07a14, 0x7b3fb8];
  aiRacers.forEach((ai, i) => {
    scene.remove(ai.mesh);
    const b = buildCarFromGLB({ color: colors[i], castShadow: false });
    ai.mesh = b.group;
    ai.wheels = b.wheels;
    ai.spinSign = -1;
    scene.add(ai.mesh);
    placeAI(ai);
  });
}

/* ------------------------------------------------------ vehicle configs - */
const VEHICLES = [
  { key: '1', name: '458 Italia',  cls: 'Hypercar',   kind: 'car',  profile: 'sports', glb: true, color: 0xc4161c, maxSpeed: 94,  accel: 26, grip: 9.0, turn: 2.5, offroad: 0.45, spoiler: true,
    hint: '<b>W</b> gas · <b>Space</b> drift · <b>Shift</b> nitro' },
  { key: '2', name: 'Bandit V8',   cls: 'Muscle',     kind: 'car',  profile: 'muscle', color: 0x1d4fc4, maxSpeed: 80,  accel: 22, grip: 6.5, turn: 2.3, offroad: 0.5,  spoiler: false,
    hint: 'Loves going sideways. <b>Space</b> to drift.' },
  { key: '3', name: 'Trailcat 4X4',cls: 'Offroader',  kind: 'car',  profile: 'suv',    color: 0x33702e, maxSpeed: 55,  accel: 15, grip: 8.0, turn: 2.1, offroad: 0.95, spoiler: false,
    hint: 'Barely slows down off the tarmac. Climb everything.' },
  { key: '4', name: 'Viper R',     cls: 'Superbike',  kind: 'bike', color: 0xd8b012, maxSpeed: 86,  accel: 25, grip: 8.5, turn: 2.9, offroad: 0.35,
    hint: 'Fast and flickable — lean into corners.' },
  { key: '5', name: 'Dust Hopper', cls: 'Dirt bike',  kind: 'bike', color: 0xd05e17, maxSpeed: 48,  accel: 17, grip: 7.5, turn: 3.1, offroad: 0.9,
    hint: 'Made for the hills. Jump everything.' },
  { key: '6', name: 'Skyhawk',     cls: 'Stunt plane',kind: 'plane',color: 0xdcd8cc, maxSpeed: 88,  accel: 15, grip: 0, turn: 1.6, offroad: 1, jet: false, glbPlane: true,
    hint: '<b>W/S</b> throttle · <b>↑↓</b> pitch · <b>A/D</b> bank. <b>T</b> = airfield.' },
  { key: '7', name: 'Thunder Jet', cls: 'Jet',        kind: 'plane',color: 0x2e3642, maxSpeed: 132, accel: 26, grip: 0, turn: 1.3, offroad: 1, jet: true,
    hint: 'Afterburner scream. Needs room to turn.' },
];

/* ----------------------------------------------------------- the player - */
const player = {
  cfg: null, mesh: null, wheels: [], steer: [], props: [],
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, roll: 0, visRoll: 0,
  throttleLevel: 0, grounded: true, nitro: 100, wheelSpin: 0,
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

function setVehicle(idx) {
  const cfg = VEHICLES[idx];
  if (!cfg) return;
  if (player.mesh) scene.remove(player.mesh);
  const built = (cfg.glb && carTemplate) ? buildCarFromGLB(cfg)
    : (cfg.glbPlane && planeBuilt) ? planeBuilt
    : cfg.kind === 'car' ? buildCar(cfg) : cfg.kind === 'bike' ? buildBike(cfg) : buildPlane(cfg);
  player.cfg = cfg;
  player.mesh = built.group;
  player.wheels = built.wheels;
  player.steer = built.steer;
  player.props = built.props;
  player.spinSign = built.spinSign || 1;
  player.steerWheel = built.steerWheel || null;
  player.vel.multiplyScalar(0.4);
  player.pitch = 0; player.roll = 0; player.throttleLevel = 0;
  player.grounded = true;
  scene.add(player.mesh);
  document.getElementById('veh-name').textContent = cfg.name;
  document.getElementById('veh-class').textContent = cfg.cls;
  document.getElementById('veh-hint').innerHTML = cfg.hint;
  document.getElementById('nitro-row').style.display = cfg.kind === 'plane' ? 'none' : 'flex';
  document.getElementById('thr-row').style.display = cfg.kind === 'plane' ? 'flex' : 'none';
  document.getElementById('alt-row').style.display = cfg.kind === 'plane' ? 'flex' : 'none';
  refreshGarageActive(idx);
}

function respawnToRoad(forceT) {
  let t = forceT;
  if (t === undefined) {
    const a = Math.atan2(player.pos.z, player.pos.x);
    t = ((a / TAU) % 1 + 1) % 1;
    if (Math.hypot(player.pos.x, player.pos.z) < 1) t = 0.03;
  }
  const p = roadPoint(t), tan = roadTangent(t);
  player.pos.copy(p); player.pos.y += 0.5;
  player.vel.set(0, 0, 0);
  player.yaw = Math.atan2(tan.x, tan.z);
  player.pitch = player.roll = 0;
  player.grounded = true;
}
function teleportToAirfield() {
  player.pos.set(STRIP.x - STRIP.hl + 40, STRIP_H + 0.5, STRIP.z);
  player.vel.set(0, 0, 0);
  player.yaw = Math.atan2(1, 0);
  player.pitch = player.roll = 0;
  player.throttleLevel = 0;
  player.grounded = true;
  showMsg('AIRFIELD', 900);
}

/* -------------------------------------------------------------- input --- */
const keys = {};
let camMode = 0, muted = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  initAudio();
  const k = e.code;
  if (k === 'KeyV') toggleGarage();
  if (k === 'Escape') closeGarage();
  if (k === 'KeyH') { const h = document.getElementById('help'); h.style.display = h.style.display === 'block' ? 'none' : 'block'; }
  if (k === 'KeyC') camMode = (camMode + 1) % 4;
  if (k === 'KeyR' && !race.active) respawnToRoad();
  if (k === 'KeyT' && !race.active) teleportToAirfield();
  if (k === 'KeyN') dayTime = (dayTime + 0.08) % 1;
  if (k === 'KeyM') muted = !muted;
  if (k === 'Enter') race.active ? endRace(false) : startRace();
  const num = parseInt(e.key, 10);
  if (num >= 1 && num <= VEHICLES.length && !race.active) { setVehicle(num - 1); closeGarage(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

function inputAxis() {
  const t = (keys.KeyW || keys.ArrowUp) ? 1 : 0;
  const b = (keys.KeyS || keys.ArrowDown) ? 1 : 0;
  const l = (keys.KeyA || keys.ArrowLeft) ? 1 : 0;
  const r = (keys.KeyD || keys.ArrowRight) ? 1 : 0;
  return { throttle: t, brake: b, steer: l - r, hand: keys.Space ? 1 : 0, nitro: (keys.ShiftLeft || keys.ShiftRight) ? 1 : 0 };
}
function planeInput() {
  return {
    thrUp: keys.KeyW ? 1 : 0, thrDn: keys.KeyS ? 1 : 0,
    pitchUp: keys.ArrowUp ? 1 : 0, pitchDn: keys.ArrowDown ? 1 : 0,
    rollL: (keys.KeyA || keys.ArrowLeft) ? 1 : 0, rollR: (keys.KeyD || keys.ArrowRight) ? 1 : 0,
  };
}

/* ---------------------------------------------------------- garage UI --- */
function toggleGarage() { document.getElementById('garage').classList.toggle('open'); }
function closeGarage() { document.getElementById('garage').classList.remove('open'); }
function refreshGarageActive(idx) {
  document.querySelectorAll('.vcard').forEach((c, i) => c.classList.toggle('active', i === idx));
}
(function buildGarageUI() {
  const grid = document.getElementById('garage-grid');
  VEHICLES.forEach((v, i) => {
    const spd = Math.round(v.maxSpeed / 1.4);
    const acc = Math.round(v.accel * 3.4);
    const hnd = Math.round((v.turn / 3.2) * 100);
    const off = Math.round(v.offroad * 100);
    const el = document.createElement('div');
    el.className = 'vcard';
    el.innerHTML = `<span class="key">${v.key}</span><div class="nm">${v.name}</div><div class="tp">${v.cls}</div>
      <div class="stat"><span>Top speed</span><span class="sbar"><i style="width:${spd}%"></i></span></div>
      <div class="stat"><span>Accel</span><span class="sbar"><i style="width:${acc}%"></i></span></div>
      <div class="stat"><span>Handling</span><span class="sbar"><i style="width:${hnd}%"></i></span></div>
      <div class="stat"><span>Off-road</span><span class="sbar"><i style="width:${off}%"></i></span></div>`;
    el.addEventListener('click', () => { if (!race.active) { setVehicle(i); closeGarage(); } });
    grid.appendChild(el);
  });
})();

/* ----------------------------------------------------------- messages --- */
let msgTimer = null;
function showMsg(text, ms) {
  const m = document.getElementById('msg');
  m.textContent = text;
  m.classList.add('show');
  if (msgTimer) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => m.classList.remove('show'), ms || 1400);
}

/* ------------------------------------------------------------- physics -- */
const GRAV = 18;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

function stepGroundVehicle(dt) {
  const cfg = player.cfg;
  const inp = inputAxis();
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const rx = fz, rz = -fx;
  let vf = player.vel.x * fx + player.vel.z * fz;
  let vr = player.vel.x * rx + player.vel.z * rz;

  const kind = surfaceKind(player.pos.x, player.pos.z);
  const onPaved = kind !== 'dirt';
  const surf = onPaved ? 1 : cfg.offroad;

  let boost = 1;
  const nitroOn = inp.nitro && player.nitro > 0 && inp.throttle;
  if (nitroOn) {
    boost = 1.65; player.nitro = Math.max(0, player.nitro - 32 * dt);
  } else {
    player.nitro = Math.min(100, player.nitro + 9 * dt);
  }

  let drifting = false;
  if (player.grounded) {
    const maxS = cfg.maxSpeed * surf * (boost > 1 ? 1.14 : 1);
    if (inp.throttle) vf += cfg.accel * surf * boost * dt * clamp(1 - vf / maxS, 0, 1);
    if (inp.brake) {
      if (vf > 0.5) vf -= 34 * dt;
      else vf = Math.max(vf - 8 * dt, -13);
    }
    vf -= vf * (0.06 + Math.abs(vf) * 0.0012) * dt * 3;
    const spdFac = clamp(Math.abs(vf) / 7, 0, 1) / (1 + Math.abs(vf) * 0.014);
    let yawRate = inp.steer * cfg.turn * spdFac * Math.sign(vf || 1);
    if (inp.hand) yawRate *= 1.6;
    player.yaw += yawRate * dt;
    const grip = inp.hand ? 1.7 : cfg.grip * (onPaved ? 1 : 0.55);
    vr *= Math.exp(-grip * dt);
    drifting = (inp.hand && Math.abs(vf) > 8) || Math.abs(vr) > 6;
    if (inp.hand && Math.abs(vf) > 8) vf -= vf * 0.35 * dt;
    const gx = (terrainHeight(player.pos.x + 1.6, player.pos.z) - terrainHeight(player.pos.x - 1.6, player.pos.z)) / 3.2;
    const gz = (terrainHeight(player.pos.x, player.pos.z + 1.6) - terrainHeight(player.pos.x, player.pos.z - 1.6)) / 3.2;
    vf -= GRAV * (fx * gx + fz * gz) * dt * 0.55;
  }

  player.vel.x = fx * vf + rx * vr;
  player.vel.z = fz * vf + rz * vr;
  player.vel.y -= GRAV * dt;
  player.pos.addScaledVector(player.vel, dt);

  const gY = terrainHeight(player.pos.x, player.pos.z);
  if (player.pos.y <= gY + 0.02) {
    player.pos.y = gY;
    if (player.vel.y < -14) { player.vel.x *= 0.7; player.vel.z *= 0.7; }
    player.vel.y = 0;
    player.grounded = true;
  } else {
    player.grounded = player.pos.y - gY < 0.6;
  }

  collideWorld();
  waterCheck();

  // ------- particles
  const spd = Math.abs(vf);
  if (player.grounded && drifting && spd > 6) {
    for (const s of [-1, 1]) {
      spawnParticle(
        player.pos.x - fx * 1.4 + rx * s * 0.8, player.pos.y + 0.25, player.pos.z - fz * 1.4 + rz * s * 0.8,
        -fx * 2 + (Math.random() - 0.5) * 2, 0.6, -fz * 2 + (Math.random() - 0.5) * 2,
        0.8 + Math.random() * 0.4, 2.6, 0.82, 0.82, 0.84);
    }
  }
  if (player.grounded && !onPaved && spd > 7 && Math.random() < 0.75) {
    spawnParticle(
      player.pos.x - fx * 1.2 + (Math.random() - 0.5), player.pos.y + 0.2, player.pos.z - fz * 1.2 + (Math.random() - 0.5),
      -fx * 3 + (Math.random() - 0.5) * 3, 1.2, -fz * 3 + (Math.random() - 0.5) * 3,
      1.0 + Math.random() * 0.6, 3.4, 0.62, 0.52, 0.38);
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
  const n = player.grounded ? groundNormal(player.pos.x, player.pos.z) : new THREE.Vector3(0, 1, 0);
  const fwd = tmpV.set(fx, 0, fz).addScaledVector(n, -n.dot(tmpV2.set(fx, 0, fz))).normalize();
  const right = tmpV2.crossVectors(n, fwd);
  const m = new THREE.Matrix4().makeBasis(right, n, fwd);
  player.mesh.quaternion.setFromRotationMatrix(m);
  if (cfg.kind === 'bike') {
    const lean = clamp(-inp.steer * clamp(vf / 25, 0, 1) * 0.55 + vr * 0.02, -0.65, 0.65);
    player.visRoll = lerp(player.visRoll, lean, 1 - Math.exp(-8 * dt));
    player.mesh.rotateZ(player.visRoll);
  }
  player.mesh.position.copy(player.pos);
  return Math.abs(vf);
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
    if (player.pos.y < gY + 0.4) {
      const kind = surfaceKind(player.pos.x, player.pos.z);
      const gentle = player.vel.y > -9 && Math.abs(player.pitch) < 0.28 && Math.abs(player.roll) < 0.4;
      if (gentle && (kind === 'strip' || kind === 'road' || kind === 'city')) {
        player.grounded = true; player.pitch = 0; player.roll = 0;
        player.pos.y = gY; player.vel.y = 0;
        showMsg('TOUCHDOWN', 900);
      } else if (gentle) {
        player.grounded = true; player.pitch = 0; player.roll = 0;
        player.pos.y = gY; player.vel.y = 0;
        player.vel.multiplyScalar(0.5);
        for (let i = 0; i < 10; i++) spawnParticle(
          player.pos.x + (Math.random() - 0.5) * 3, player.pos.y + 0.3, player.pos.z + (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 5, 2 + Math.random() * 2, (Math.random() - 0.5) * 5,
          1.2, 3.5, 0.62, 0.52, 0.38);
      } else {
        player.pos.y = gY + 1.2;
        player.vel.multiplyScalar(0.25);
        player.vel.y = 6;
        player.pitch = 0.25; player.roll = 0;
        player.throttleLevel = Math.min(player.throttleLevel, 0.4);
        for (let i = 0; i < 16; i++) spawnParticle(
          player.pos.x + (Math.random() - 0.5) * 4, player.pos.y, player.pos.z + (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 8, 3 + Math.random() * 4, (Math.random() - 0.5) * 8,
          1.4, 4.5, 0.45, 0.4, 0.36);
        showMsg('CRASH!', 1100);
      }
    }
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
  return player.vel.length();
}

function collideWorld() {
  for (const b of buildings) {
    const dx = player.pos.x - b.x, dz = player.pos.z - b.z;
    const px = b.hw + 1.1 - Math.abs(dx), pz = b.hd + 1.1 - Math.abs(dz);
    if (px > 0 && pz > 0 && player.pos.y < CITY_H + b.h + 2) {
      if (px < pz) { player.pos.x += Math.sign(dx) * px; player.vel.x *= -0.25; }
      else { player.pos.z += Math.sign(dz) * pz; player.vel.z *= -0.25; }
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
      if (d2 < 1.9 * 1.9 && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (1.9 - d);
        player.pos.x += (dx / d) * push; player.pos.z += (dz / d) * push;
        player.vel.multiplyScalar(0.6);
      }
    }
  }
}
function waterCheck() {
  if (terrainHeight(player.pos.x, player.pos.z) < WATER_Y - 1 && player.pos.y < WATER_Y + 0.5) {
    showMsg('SPLASH!  Back to the road…', 1200);
    respawnToRoad();
  }
}

/* ------------------------------------------------------------ AI racers - */
const AI_COUNT = 3;
const aiRacers = [];
(function buildAI() {
  const colors = [0xcfd2d6, 0xd07a14, 0x7b3fb8];
  const profiles = ['sports', 'muscle', 'sports'];
  for (let i = 0; i < AI_COUNT; i++) {
    const cfg = { color: colors[i], spoiler: i !== 1, profile: profiles[i] };
    const b = buildCar(cfg);
    scene.add(b.group);
    aiRacers.push({
      mesh: b.group, wheels: b.wheels, t: 0.995 - i * 0.0035,
      baseSpeed: 46 + i * 3.5, speed: 0, spin: 0, laps: 0
    });
  }
  parkAI();
})();
function parkAI() {
  aiRacers.forEach((ai, i) => {
    ai.t = ((0.998 - i * 0.0032) % 1 + 1) % 1;
    ai.laps = 0;
    placeAI(ai);
  });
}
function placeAI(ai) {
  const p = roadPoint(ai.t), tan = roadTangent(ai.t);
  const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
  const lane = ((aiRacers.indexOf(ai) % 3) - 1) * 3.4;
  p.addScaledVector(nrm, lane);
  p.y = terrainHeight(p.x, p.z);
  ai.mesh.position.copy(p);
  ai.mesh.rotation.set(0, Math.atan2(tan.x, tan.z), 0);
}
function stepAI(dt) {
  if (!race.active || race.countdown > 0) return;
  const loopLen = 3300;
  for (const ai of aiRacers) {
    const lead = (ai.laps + ai.t) - (race.laps + race.progressT);
    let sp = ai.baseSpeed * (lead > 0.06 ? 0.82 : lead < -0.06 ? 1.18 : 1);
    ai.speed = lerp(ai.speed, sp, dt * 0.8);
    const prev = ai.t;
    ai.t = (ai.t + (ai.speed / loopLen) * dt) % 1;
    if (ai.t < prev) ai.laps++;
    placeAI(ai);
    ai.spin += ai.speed * dt / 0.36;
    for (const w of ai.wheels) w.rotation.x = ai.spin * (ai.spinSign || 1);
  }
}

/* ------------------------------------------------------------- race ----- */
const CHECKPOINTS = 12;
const race = {
  active: false, countdown: 0, time: 0, laps: 0, lapTotal: 2,
  nextCp: 0, progressT: 0, gates: []
};
(function buildGates() {
  const pylonGeo = new THREE.CylinderGeometry(0.20, 0.28, 9, 10);
  for (let i = 0; i < CHECKPOINTS; i++) {
    const t = (i + 1) / CHECKPOINTS % 1;
    const p = roadPoint(t), tan = roadTangent(t);
    const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
    const grp = new THREE.Group();
    const matOff = new THREE.MeshStandardMaterial({
      color: 0x3a4a68, emissive: 0x101830, emissiveIntensity: 0.4,
      metalness: 0.6, roughness: 0.35
    });
    for (const s of [-1, 1]) {
      const py = new THREE.Mesh(pylonGeo, matOff);
      const pp = p.clone().addScaledVector(nrm, s * (ROAD_HALF + 2.4));
      py.position.set(pp.x, terrainHeight(pp.x, pp.z) + 4.5, pp.z);
      py.castShadow = true;
      grp.add(py);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 6, 0.4, 0.4), matOff);
    beam.position.set(p.x, terrainHeight(p.x, p.z) + 9.4, p.z);
    beam.rotation.y = Math.atan2(tan.x, tan.z) + Math.PI / 2;
    grp.add(beam);
    scene.add(grp);
    race.gates.push({ t, pos: p.clone(), grp, mat: matOff });
  }
})();
function setGateGlow(idx) {
  race.gates.forEach((g, i) => {
    g.mat.emissive.setHex(i === idx ? 0x2affc6 : 0x101830);
    g.mat.emissiveIntensity = i === idx ? 2.2 : 0.4;
    g.mat.color.setHex(i === idx ? 0x2fd8a8 : 0x3a4a68);
  });
}
function trackT() {
  const a = Math.atan2(player.pos.z, player.pos.x);
  return ((a / TAU) % 1 + 1) % 1;
}
function startRace() {
  if (race.active) return;
  if (player.cfg.kind === 'plane') { showMsg('Races are for ground vehicles!\nPick a car or bike (V)', 1800); return; }
  race.active = true;
  race.countdown = 3.5; race.time = 0; race.laps = 0; race.nextCp = 0;
  const t0 = 0.984;
  const p = roadPoint(t0), tan = roadTangent(t0);
  player.pos.copy(p); player.pos.y += 0.4;
  player.vel.set(0, 0, 0);
  player.yaw = Math.atan2(tan.x, tan.z);
  // snap mesh + camera to the grid so the countdown shows the line-up
  player.mesh.position.copy(player.pos);
  player.mesh.rotation.set(0, player.yaw, 0);
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  camPos.set(player.pos.x - fx * 9.5, player.pos.y + 3.4, player.pos.z - fz * 9.5);
  parkAI();
  setGateGlow(0);
}
function endRace(finished) {
  race.active = false;
  setGateGlow(-1);
  if (!finished) showMsg('RACE ABANDONED', 1200);
}
function stepRace(dt) {
  if (!race.active) return;
  if (race.countdown > 0) {
    const before = Math.ceil(race.countdown);
    race.countdown -= dt;
    const after = Math.ceil(race.countdown);
    if (after !== before || race.countdown <= 0) {
      if (race.countdown <= 0) showMsg('GO!', 700);
      else showMsg(String(after), 900);
    }
    player.vel.set(0, 0, 0);
    return;
  }
  race.time += dt;
  race.progressT = trackT();
  const gate = race.gates[race.nextCp];
  if (gate && player.pos.distanceTo(gate.pos) < 24) {
    race.nextCp++;
    if (race.nextCp >= CHECKPOINTS) {
      race.nextCp = 0; race.laps++;
      if (race.laps >= race.lapTotal) { finishRace(); return; }
      else showMsg(`LAP ${race.laps + 1} / ${race.lapTotal}`, 1100);
    }
    setGateGlow(race.nextCp);
  }
}
function playerPosition() {
  const mine = race.laps + race.nextCp / CHECKPOINTS;
  let pos = 1;
  for (const ai of aiRacers) if (ai.laps + ai.t > mine + 0.02) pos++;
  return pos;
}
function finishRace() {
  const pos = playerPosition();
  const mins = Math.floor(race.time / 60), secs = (race.time % 60).toFixed(1);
  const medal = pos === 1 ? '🏆  VICTORY!' : pos === 2 ? '🥈  2ND PLACE' : pos === 3 ? '🥉  3RD PLACE' : `${pos}TH PLACE`;
  showMsg(`${medal}\n${mins}:${secs.padStart(4, '0')}`, 4200);
  endRace(true);
}

/* --------------------------------------------------------- day / night -- */
let dayTime = 0.30;
const DAY_LEN = 300;
const fogDay = new THREE.Color(0x9ac2ee), fogNight = new THREE.Color(0x070b18),
      fogDawn = new THREE.Color(0xe8875a), fogCol = new THREE.Color();
function stepDayNight(dt) {
  dayTime = (dayTime + dt / DAY_LEN) % 1;
  const sunEl = Math.sin(dayTime * TAU);
  const az = dayTime * TAU + Math.PI / 2;
  const sd = tmpV.set(Math.cos(az) * 0.8, sunEl, Math.sin(az) * 0.6).normalize();

  const uDay = smoothstep(-0.08, 0.25, sunEl);
  const uDawn = Math.exp(-Math.pow((sunEl - 0.05) * 5.5, 2));
  const uNight = 1 - smoothstep(-0.18, 0.0, sunEl);
  skyUniforms.sunDir.value.copy(sd);
  skyUniforms.uDay.value = uDay;
  skyUniforms.uDawn.value = uDawn;
  skyUniforms.uNight.value = uNight;

  sun.position.copy(player.pos).addScaledVector(sd, 380);
  sun.target.position.copy(player.pos);
  sun.intensity = Math.max(0, sunEl) * 1.55 + 0.02;
  sun.color.setHSL(0.085, clamp(0.95 - uDay * 0.75, 0, 0.9), 0.88);
  hemi.intensity = 0.05 + uDay * 0.27;

  sunSprite.position.copy(camera.position).addScaledVector(sd, 2900);
  sunSprite.material.opacity = smoothstep(-0.12, 0.05, sunEl);

  fogCol.copy(fogNight).lerp(fogDay, uDay).lerp(fogDawn, uDawn * 0.4);
  scene.fog.color.copy(fogCol);

  // lit windows & street lamps after dark
  buildingMat.emissiveIntensity = uNight * 1.5;
  if (lampHeadMat) lampHeadMat.emissiveIntensity = uNight * 3.0;

  const night = sunEl < 0.06 && player.cfg.kind !== 'plane';
  for (const h of headlights) {
    h.sp.intensity = night ? 2.6 : 0;
    if (night) {
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
function stepCamera(dt, speed) {
  const cfg = player.cfg;
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const spdRatio = clamp(speed / cfg.maxSpeed, 0, 1);
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
    const rxv = fz, rzv = -fx;          // sit on the left for the car
    const side = cfg.kind === 'car' ? -0.34 : 0;
    const fwd = cfg.kind === 'plane' ? 0.3 : -0.1;
    target = tmpV.set(
      player.pos.x + fx * fwd + rxv * side,
      player.pos.y + up,
      player.pos.z + fz * fwd + rzv * side);
  } else {
    const a = performance.now() * 0.00025;
    target = tmpV.set(player.pos.x + Math.cos(a) * 22, player.pos.y + 9, player.pos.z + Math.sin(a) * 22);
  }
  if (camMode !== 2) {
    const camGround = terrainHeight(target.x, target.z) + 1.2;
    if (target.y < camGround) target.y = camGround;
  }
  const k = 1 - Math.exp(-(camMode === 3 ? 2.2 : camMode === 2 ? 22 : 5.5) * dt);
  camPos.lerp(target, k);
  camera.position.copy(camPos);
  // speed shake
  const sh = spdRatio * spdRatio * (camMode === 2 ? 0.03 : 0.09);
  camera.position.x += (Math.random() - 0.5) * sh;
  camera.position.y += (Math.random() - 0.5) * sh;
  if (camMode === 2 && cfg.kind === 'plane') {
    camera.lookAt(
      camera.position.x + Math.sin(player.yaw) * 30 * Math.cos(player.pitch),
      camera.position.y + Math.sin(player.pitch) * 30,
      camera.position.z + Math.cos(player.yaw) * 30 * Math.cos(player.pitch));
  } else if (camMode === 2) {
    camera.lookAt(camera.position.x + fx * 30, camera.position.y - 0.15, camera.position.z + fz * 30);
  } else {
    camera.lookAt(player.pos.x + fx * 10, player.pos.y + 1.6, player.pos.z + fz * 10);
  }
  camera.fov = lerp(camera.fov, 62 + spdRatio * 16, 1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();
}

/* ----------------------------------------------------------------- HUD -- */
const spdEl = document.getElementById('spd');
const nitroFill = document.getElementById('nitro-fill');
const thrFill = document.getElementById('thr-fill');
const altVal = document.getElementById('alt-val');
const raceMain = document.getElementById('race-main');
const raceSub = document.getElementById('race-sub');
let hudClock = 0;
function stepHUD(dt, speed) {
  hudClock += dt;
  if (hudClock < 0.08) return;
  hudClock = 0;
  spdEl.textContent = Math.round(speed * 3.6);
  nitroFill.style.width = player.nitro + '%';
  thrFill.style.width = (player.throttleLevel * 100) + '%';
  if (player.cfg.kind === 'plane') {
    const alt = Math.max(0, player.pos.y - terrainHeight(player.pos.x, player.pos.z));
    altVal.textContent = Math.round(alt) + ' m';
  }
  if (race.active) {
    if (race.countdown > 0) {
      raceMain.textContent = 'GET READY';
      raceSub.textContent = `2 laps · ${CHECKPOINTS} checkpoints`;
    } else {
      const mins = Math.floor(race.time / 60), secs = (race.time % 60).toFixed(1);
      raceMain.textContent = `P${playerPosition()} / ${AI_COUNT + 1}   ·   LAP ${race.laps + 1}/${race.lapTotal}   ·   ${mins}:${secs.padStart(4, '0')}`;
      raceSub.textContent = 'Follow the glowing gates · Enter to quit race';
    }
  } else {
    raceMain.textContent = 'FREE ROAM';
    raceSub.textContent = 'Press ENTER to start a race · V for garage · H for help';
  }
}

/* -------------------------------------------------------------- minimap - */
const mmCanvas = document.getElementById('minimap');
const mmCtx = mmCanvas.getContext('2d');
const mmRoad = [];
for (let i = 0; i <= 120; i++) mmRoad.push(roadPoint(i / 120));
function w2m(x, z) {
  const s = 186 / WORLD;
  return [98 + x * s, 98 + z * s];
}
function drawMinimap() {
  const g = mmCtx;
  g.clearRect(0, 0, 196, 196);
  g.fillStyle = 'rgba(10,18,38,0.85)';
  g.beginPath(); g.arc(98, 98, 96, 0, TAU); g.fill();
  g.save();
  g.beginPath(); g.arc(98, 98, 96, 0, TAU); g.clip();
  g.fillStyle = 'rgba(28,90,140,0.25)'; g.fillRect(0, 0, 196, 196);
  g.fillStyle = 'rgba(58,86,48,0.9)';
  g.beginPath(); g.arc(98, 98, 92, 0, TAU); g.fill();
  g.fillStyle = 'rgba(120,130,150,0.9)';
  const [cx, cy] = w2m(0, 0);
  g.beginPath(); g.arc(cx, cy, CITY_R * 186 / WORLD, 0, TAU); g.fill();
  g.fillStyle = 'rgba(70,74,84,1)';
  const [ax, ay] = w2m(STRIP.x - STRIP.hl, STRIP.z - STRIP.hw);
  g.fillRect(ax, ay, STRIP.hl * 2 * 186 / WORLD, Math.max(3, STRIP.hw * 2 * 186 / WORLD));
  g.strokeStyle = '#e8e4da'; g.lineWidth = 2.4; g.beginPath();
  mmRoad.forEach((p, i) => {
    const [x, y] = w2m(p.x, p.z);
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  });
  g.closePath(); g.stroke();
  if (race.active) {
    const gpos = race.gates[race.nextCp].pos;
    const [gx, gy] = w2m(gpos.x, gpos.z);
    g.fillStyle = '#2affc6';
    g.beginPath(); g.arc(gx, gy, 4.5, 0, TAU); g.fill();
  }
  g.fillStyle = '#ff7b6b';
  for (const ai of aiRacers) {
    const [x, y] = w2m(ai.mesh.position.x, ai.mesh.position.z);
    g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill();
  }
  const [px, py] = w2m(player.pos.x, player.pos.z);
  g.translate(px, py);
  g.rotate(Math.atan2(Math.sin(player.yaw), Math.cos(player.yaw)));
  g.fillStyle = '#59d1ff';
  g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath(); g.fill();
  g.restore();
}

/* --------------------------------------------------------------- audio -- */
let audio = null;
function initAudio() {
  if (audio) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const engine = ctx.createOscillator();
    engine.type = 'sawtooth';
    const engGain = ctx.createGain(); engGain.gain.value = 0;
    const engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 700;
    engine.connect(engFilter).connect(engGain).connect(ctx.destination);
    engine.start();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const skidGain = ctx.createGain(); skidGain.gain.value = 0;
    const skidF = ctx.createBiquadFilter(); skidF.type = 'bandpass'; skidF.frequency.value = 900;
    noise.connect(skidF).connect(skidGain).connect(ctx.destination);
    noise.start();
    audio = { ctx, engine, engGain, skidGain };
  } catch (e) { audio = null; }
}
function stepAudio(speed) {
  if (!audio) return;
  if (muted) { audio.engGain.gain.value = 0; audio.skidGain.gain.value = 0; return; }
  const cfg = player.cfg;
  const r = clamp(speed / cfg.maxSpeed, 0, 1);
  if (cfg.kind === 'plane') {
    audio.engine.frequency.value = 42 + player.throttleLevel * 70 + r * 30;
    audio.engGain.gain.value = 0.035 + player.throttleLevel * 0.05;
    audio.skidGain.gain.value = 0;
  } else {
    const gear = Math.min(5, Math.floor(r * 5.5));
    const inGear = (r * 5.5) - gear;
    audio.engine.frequency.value = 65 + inGear * 150 + gear * 18;
    const inp = inputAxis();
    audio.engGain.gain.value = 0.028 + r * 0.03 + inp.throttle * 0.018;
    const drifting = inp.hand && speed > 8 && player.grounded;
    audio.skidGain.gain.value = drifting ? 0.05 : 0;
  }
}

/* ---------------------------------------------------------------- main -- */
setVehicle(0);
respawnToRoad();
camPos.copy(player.pos).add(new THREE.Vector3(0, 6, -12));
updateEnvironment();

const clock = new THREE.Clock();
let mmClock = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const locked = race.active && race.countdown > 0;
  let speed = 0;
  if (player.cfg.kind === 'plane') speed = stepPlane(dt);
  else speed = locked ? 0 : stepGroundVehicle(dt);
  stepAI(dt);
  stepRace(dt);
  stepDayNight(dt);
  stepParticles(dt);
  waterMat.normalMap.offset.x += dt * 0.012;
  waterMat.normalMap.offset.y += dt * 0.007;
  stepCamera(dt, speed);
  stepHUD(dt, speed);
  stepAudio(speed);
  mmClock += dt;
  if (mmClock > 0.12) { drawMinimap(); mmClock = 0; }
  composer.render();
}
frame();

document.getElementById('loading').classList.add('done');
window.__gameReady = true;

})();
