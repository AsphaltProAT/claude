/* ============================================================================
   VELOCITY HORIZON — open-world arcade racer (cars · bikes · planes)
   Pure Three.js, no build step. Everything procedural: terrain, road, city,
   airfield, day/night cycle, races with AI, arcade-sim vehicle physics.
   ========================================================================== */
(function () {
'use strict';

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
const WORLD = 3400;                       // world is WORLD x WORLD meters
const WATER_Y = 6;

function rawHeight(x, z) {
  return -8 + fbm(x * 0.0012, z * 0.0012, 4) * 90 + fbm(x * 0.006, z * 0.006, 3) * 7;
}
function lowHeight(x, z) {                // smooth base used under road/city
  return -8 + fbm(x * 0.0012, z * 0.0012, 2) * 90;
}
function roadRadius(a) {                  // star-shaped loop around origin
  return 520 + 140 * Math.sin(a * 3 + 1.7) + 60 * Math.sin(a * 5 + 0.6);
}
const ROAD_HALF = 8;                      // paved half-width
const CITY_R = 170;
const STRIP = { x: 1080, z: -140, hl: 260, hw: 26 }; // airfield rectangle

let CITY_H = 0, STRIP_H = 0;              // filled at init

function roadDistInfo(x, z) {             // lateral distance to road centreline
  const r = Math.hypot(x, z);
  if (r < 60) return { d: 1e9, a: 0 };
  const a = Math.atan2(z, x);
  return { d: Math.abs(r - roadRadius(a)), a: a };
}
function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  // road corridor
  const ri = roadDistInfo(x, z);
  if (ri.d < 42) {
    const rr = roadRadius(ri.a);
    const hr = lowHeight(Math.cos(ri.a) * rr, Math.sin(ri.a) * rr);
    h = lerp(hr, h, smoothstep(10, 42, ri.d));
  }
  // city plateau
  const dc = Math.hypot(x, z);
  if (dc < 230) h = lerp(CITY_H, h, smoothstep(CITY_R - 20, 230, dc));
  // airfield
  const dx = Math.abs(x - STRIP.x) - STRIP.hl, dz = Math.abs(z - STRIP.z) - STRIP.hw;
  const dd = Math.max(dx, dz);
  if (dd < 45) h = lerp(STRIP_H, h, smoothstep(0, 45, dd));
  return h;
}
function groundNormal(x, z) {
  const e = 1.6;
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  const n = new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e));
  return n.normalize();
}
function surfaceKind(x, z) {              // 'road' | 'city' | 'strip' | 'dirt'
  if (roadDistInfo(x, z).d < ROAD_HALF + 1.5) return 'road';
  if (Math.hypot(x, z) < CITY_R) return 'city';
  if (Math.abs(x - STRIP.x) < STRIP.hl && Math.abs(z - STRIP.z) < STRIP.hw) return 'strip';
  return 'dirt';
}
function roadPoint(t) {                   // t in [0,1) -> point on centreline
  const a = t * TAU;
  const r = roadRadius(a);
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  return new THREE.Vector3(x, terrainHeight(x, z), z);
}
function roadTangent(t) {
  const p1 = roadPoint((t + 0.0012) % 1), p0 = roadPoint((t + 1 - 0.0012) % 1);
  return p1.sub(p0).setY(0).normalize();
}

/* ------------------------------------------------------------ renderer -- */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87b7e8, 250, 1500);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 5000);
camera.position.set(0, 40, -30);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ------------------------------------------------------------- lights --- */
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3f5a36, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0007;
scene.add(sun); scene.add(sun.target);

// visible sun disc
function makeGlowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(255,245,210,1)', 'rgba(255,200,90,0)'),
  transparent: true, depthWrite: false, fog: false
}));
sunSprite.scale.set(420, 420, 1);
scene.add(sunSprite);

/* ------------------------------------------------------------- terrain -- */
CITY_H = lowHeight(0, 0);
STRIP_H = lowHeight(STRIP.x, STRIP.z);

(function buildTerrain() {
  const SEG = 220;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrassA = new THREE.Color(0x4d7a3a), cGrassB = new THREE.Color(0x6f9c4a);
  const cRock = new THREE.Color(0x8a8378), cSand = new THREE.Color(0xc9b98a);
  const cSnow = new THREE.Color(0xf2f4f7), col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    // slope estimate for colouring
    const sl = Math.hypot(
      terrainHeight(x + 3, z) - terrainHeight(x - 3, z),
      terrainHeight(x, z + 3) - terrainHeight(x, z - 3)) / 6;
    if (h < WATER_Y + 1.5) col.copy(cSand);
    else if (h > 66) col.copy(cSnow);
    else if (sl > 0.55) col.copy(cRock);
    else col.copy(cGrassA).lerp(cGrassB, vnoise(x * 0.02, z * 0.02));
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
})();

// water
(function buildWater() {
  const geo = new THREE.PlaneGeometry(WORLD * 1.4, WORLD * 1.4);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1c6fae, transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.1
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_Y;
  scene.add(mesh);
})();

/* ---------------------------------------------------------------- road -- */
const ROAD_SEGS = 720;
(function buildRoad() {
  function ribbon(halfW, lift, color, dashEvery) {
    const pts = [];
    for (let i = 0; i <= ROAD_SEGS; i++) {
      const t = i / ROAD_SEGS;
      const c = roadPoint(t);
      const tan = roadTangent(t);
      const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
      pts.push({ c, nrm });
    }
    const verts = [], idx = [];
    for (let i = 0; i <= ROAD_SEGS; i++) {
      const { c, nrm } = pts[i];
      const l = c.clone().addScaledVector(nrm, -halfW);
      const r = c.clone().addScaledVector(nrm, halfW);
      l.y = terrainHeight(l.x, l.z) + lift;
      r.y = terrainHeight(r.x, r.z) + lift;
      verts.push(l.x, l.y, l.z, r.x, r.y, r.z);
    }
    for (let i = 0; i < ROAD_SEGS; i++) {
      if (dashEvery && (i % dashEvery) >= dashEvery / 2) continue;
      const a = i * 2, b = i * 2 + 1, c2 = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c2, b, d, c2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.92, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  ribbon(ROAD_HALF, 0.10, 0x2b2e35, 0);           // asphalt
  ribbon(0.22, 0.16, 0xf5f2df, 6);                 // dashed centre line
  // edge lines
  (function edges() {
    for (const s of [-1, 1]) {
      const verts = [], idx = [];
      for (let i = 0; i <= ROAD_SEGS; i++) {
        const t = i / ROAD_SEGS;
        const c = roadPoint(t), tan = roadTangent(t);
        const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
        const a = c.clone().addScaledVector(nrm, s * (ROAD_HALF - 0.55));
        const b = c.clone().addScaledVector(nrm, s * (ROAD_HALF - 0.15));
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
      scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf5f2df, roughness: 0.9, side: THREE.DoubleSide })));
    }
  })();
})();

/* ----------------------------------------------------------- city ------- */
const buildings = [];   // {x,z,hw,hd,h} for collisions
(function buildCity() {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.25 });
  const list = [];
  for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 3; gz++) {
    if (Math.abs(gx) <= 0 && Math.abs(gz) <= 0) continue;           // central plaza
    const x = gx * 44 + (hash2(gx, gz) - 0.5) * 8;
    const z = gz * 44 + (hash2(gz, gx) - 0.5) * 8;
    if (Math.hypot(x, z) > CITY_R - 18) continue;
    const w = 16 + hash2(gx + 9, gz) * 10;
    const d = 16 + hash2(gx, gz + 9) * 10;
    const h = 18 + hash2(gx + 5, gz + 5) * 62;
    list.push({ x, z, w, d, h });
    buildings.push({ x, z, hw: w / 2, hd: d / 2, h });
  }
  const im = new THREE.InstancedMesh(boxGeo, mat, list.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const palette = [0x9aa7b8, 0x7d8ba0, 0xb8b2a6, 0x8fa3b5, 0x6e7a8f];
  list.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d).setPosition(b.x, CITY_H, b.z);
    im.setMatrixAt(i, m4);
    im.setColorAt(i, col.setHex(palette[i % palette.length]).multiplyScalar(0.8 + hash2(i, 3) * 0.4));
  });
  im.castShadow = im.receiveShadow = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  scene.add(im);
  // plaza monument
  const mon = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.4, 26, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.6 }));
  mon.position.set(0, CITY_H + 13, 0); mon.castShadow = true;
  scene.add(mon);
  buildings.push({ x: 0, z: 0, hw: 3.4, hd: 3.4, h: 26 });
})();

/* ----------------------------------------------------------- airfield --- */
(function buildAirfield() {
  const g = new THREE.PlaneGeometry(STRIP.hl * 2, STRIP.hw * 2);
  g.rotateX(-Math.PI / 2);
  const strip = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.95 }));
  strip.position.set(STRIP.x, STRIP_H + 0.12, STRIP.z);
  strip.receiveShadow = true;
  scene.add(strip);
  // centre dashes
  const dashGeo = new THREE.PlaneGeometry(14, 1.1); dashGeo.rotateX(-Math.PI / 2);
  const dashes = new THREE.InstancedMesh(dashGeo,
    new THREE.MeshStandardMaterial({ color: 0xf5f2df }), 16);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 16; i++) {
    m4.makeTranslation(STRIP.x - STRIP.hl + 30 + i * 31, STRIP_H + 0.18, STRIP.z);
    dashes.setMatrixAt(i, m4);
  }
  scene.add(dashes);
  // hangar + tower
  const hangar = new THREE.Mesh(new THREE.BoxGeometry(34, 12, 26),
    new THREE.MeshStandardMaterial({ color: 0xb04a3a, roughness: 0.8 }));
  hangar.position.set(STRIP.x - 80, STRIP_H + 6, STRIP.z + STRIP.hw + 26);
  hangar.castShadow = hangar.receiveShadow = true;
  scene.add(hangar);
  buildings.push({ x: hangar.position.x, z: hangar.position.z, hw: 17, hd: 13, h: 12 });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 26, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.7 }));
  tower.position.set(STRIP.x + 120, STRIP_H + 13, STRIP.z + STRIP.hw + 22);
  tower.castShadow = true;
  scene.add(tower);
  buildings.push({ x: tower.position.x, z: tower.position.z, hw: 4, hd: 4, h: 26 });
})();

/* --------------------------------------------------------- vegetation --- */
const treeGrid = new Map();  // spatial hash "cx,cz" -> [{x,z}]
(function buildNature() {
  const N = 900;
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 4, 6); trunkGeo.translate(0, 2, 0);
  const leafGeo = new THREE.ConeGeometry(3.2, 9, 7); leafGeo.translate(0, 8, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo,
    new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 1 }), N);
  const leaves = new THREE.InstancedMesh(leafGeo,
    new THREE.MeshStandardMaterial({ color: 0x2f6b33, roughness: 1 }), N);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  let placed = 0, tries = 0;
  while (placed < N && tries < N * 30) {
    tries++;
    const x = (hash2(tries, 17) - 0.5) * (WORLD - 200);
    const z = (hash2(tries, 71) - 0.5) * (WORLD - 200);
    const h = terrainHeight(x, z);
    if (h < WATER_Y + 2 || h > 58) continue;
    if (roadDistInfo(x, z).d < 26) continue;
    if (Math.hypot(x, z) < CITY_R + 30) continue;
    if (Math.abs(x - STRIP.x) < STRIP.hl + 50 && Math.abs(z - STRIP.z) < STRIP.hw + 60) continue;
    const s = 0.7 + hash2(tries, 5) * 0.9;
    m4.makeRotationY(hash2(tries, 9) * TAU).scale(new THREE.Vector3(s, s, s)).setPosition(x, h, z);
    trunks.setMatrixAt(placed, m4);
    leaves.setMatrixAt(placed, m4);
    leaves.setColorAt(placed, col.setHSL(0.32 + hash2(tries, 4) * 0.06, 0.5, 0.28 + hash2(tries, 8) * 0.1));
    const key = Math.floor(x / 40) + ',' + Math.floor(z / 40);
    if (!treeGrid.has(key)) treeGrid.set(key, []);
    treeGrid.get(key).push({ x, z });
    placed++;
  }
  trunks.count = leaves.count = placed;
  trunks.castShadow = leaves.castShadow = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  scene.add(trunks); scene.add(leaves);

  // rocks
  const R = 260;
  const rockGeo = new THREE.DodecahedronGeometry(1.6, 0);
  const rocks = new THREE.InstancedMesh(rockGeo,
    new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 1 }), R);
  let rp = 0;
  for (let i = 0; i < R * 20 && rp < R; i++) {
    const x = (hash2(i, 101) - 0.5) * (WORLD - 200);
    const z = (hash2(i, 202) - 0.5) * (WORLD - 200);
    const h = terrainHeight(x, z);
    if (h < WATER_Y + 1 || roadDistInfo(x, z).d < 18 || Math.hypot(x, z) < CITY_R + 20) continue;
    if (Math.abs(x - STRIP.x) < STRIP.hl + 40 && Math.abs(z - STRIP.z) < STRIP.hw + 50) continue;
    const s = 0.5 + hash2(i, 7) * 2.2;
    m4.makeRotationY(hash2(i, 3) * TAU).scale(new THREE.Vector3(s, s * 0.7, s)).setPosition(x, h + 0.3, z);
    rocks.setMatrixAt(rp++, m4);
  }
  rocks.count = rp; rocks.castShadow = true;
  scene.add(rocks);
})();

/* ------------------------------------------------------------- clouds --- */
const cloudGroup = new THREE.Group();
(function buildClouds() {
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
  const im = new THREE.InstancedMesh(geo, mat, 40);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 40; i++) {
    const a = hash2(i, 11) * TAU, r = 300 + hash2(i, 22) * 1400;
    const s = 30 + hash2(i, 33) * 60;
    m4.makeScale(s, s * 0.32, s * 0.8)
      .setPosition(Math.cos(a) * r, 260 + hash2(i, 44) * 120, Math.sin(a) * r);
    im.setMatrixAt(i, m4);
  }
  cloudGroup.add(im);
  scene.add(cloudGroup);
})();

/* ------------------------------------------------------ vehicle meshes -- */
function stdMat(color, opts) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.4, metalness: 0.6 }, opts || {}));
}
function shadowify(g) { g.traverse(o => { if (o.isMesh) { o.castShadow = true; } }); return g; }

function buildCar(cfg) {
  const g = new THREE.Group();
  const paint = stdMat(cfg.color);
  // body
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.4), paint);
  body.position.y = 0.55;
  g.add(body);
  // nose taper
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 0.9), paint);
  nose.position.set(0, 0.48, 2.5); nose.rotation.x = 0.06;
  g.add(nose);
  // cabin
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.9),
    stdMat(0x11151c, { roughness: 0.15, metalness: 0.8 }));
  cab.position.set(0, 1.05, -0.25);
  g.add(cab);
  // spoiler for sporty cars
  if (cfg.spoiler) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.5), stdMat(0x14171d));
    sp.position.set(0, 1.12, -2.1);
    const st1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), stdMat(0x14171d));
    st1.position.set(0.6, 0.95, -2.1);
    const st2 = st1.clone(); st2.position.x = -0.6;
    g.add(sp, st1, st2);
  }
  // lights
  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.08),
    stdMat(0xfff6cc, { emissive: 0xfff2b0, emissiveIntensity: 0.7 }));
  hl.position.set(0.6, 0.62, 2.21);
  const hl2 = hl.clone(); hl2.position.x = -0.6;
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.06),
    stdMat(0xff2222, { emissive: 0xaa0000, emissiveIntensity: 0.8 }));
  tl.position.set(0.6, 0.66, -2.21);
  const tl2 = tl.clone(); tl2.position.x = -0.6;
  g.add(hl, hl2, tl, tl2);
  // wheels
  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 14);
  wg.rotateZ(Math.PI / 2);
  const wm = stdMat(0x15181d, { roughness: 0.8, metalness: 0.2 });
  const wheels = [], steer = [];
  for (const [x, z, isF] of [[0.95, 1.45, 1], [-0.95, 1.45, 1], [0.95, -1.45, 0], [-0.95, -1.45, 0]]) {
    const w = new THREE.Mesh(wg, wm);
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.42, z);
    pivot.add(w);
    g.add(pivot);
    wheels.push(w);
    if (isF) steer.push(pivot);
  }
  return { group: shadowify(g), wheels, steer, props: [] };
}

function buildBike(cfg) {
  const g = new THREE.Group();
  const paint = stdMat(cfg.color);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 1.9), paint);
  frame.position.y = 0.72;
  g.add(frame);
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.7), stdMat(0x14171d));
  tank.position.set(0, 1.0, 0.25);
  g.add(tank);
  // rider
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.4), stdMat(0x232a36, { roughness: 0.8 }));
  torso.position.set(0, 1.38, -0.15); torso.rotation.x = 0.5;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), stdMat(cfg.color, { roughness: 0.2 }));
  helmet.position.set(0, 1.72, 0.12);
  g.add(torso, helmet);
  // handlebar
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.07), stdMat(0x333));
  bar.position.set(0, 1.12, 0.78);
  g.add(bar);
  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.16, 14);
  wg.rotateZ(Math.PI / 2);
  const wm = stdMat(0x15181d, { roughness: 0.8 });
  const wheels = [];
  for (const z of [0.95, -0.95]) {
    const w = new THREE.Mesh(wg, wm);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.42, z); pivot.add(w);
    g.add(pivot); wheels.push(w);
  }
  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.07),
    stdMat(0xfff6cc, { emissive: 0xfff2b0, emissiveIntensity: 0.7 }));
  hl.position.set(0, 0.95, 1.05); g.add(hl);
  return { group: shadowify(g), wheels, steer: [], props: [] };
}

function buildPlane(cfg) {
  const g = new THREE.Group();
  const paint = stdMat(cfg.color);
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 6.4, 10), paint);
  fus.rotation.x = Math.PI / 2; fus.position.y = 1.1;
  g.add(fus);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.16, 1.6), paint);
  wing.position.set(0, 1.15, 0.3);
  g.add(wing);
  const tailW = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.13, 0.9), paint);
  tailW.position.set(0, 1.25, -2.9);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.3, 1.0), stdMat(0xe8e4da));
  fin.position.set(0, 1.9, -2.9);
  g.add(tailW, fin);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8),
    stdMat(0x1a2c44, { roughness: 0.1, metalness: 0.9 }));
  canopy.scale.set(0.8, 0.7, 1.4); canopy.position.set(0, 1.62, 0.7);
  g.add(canopy);
  const props = [];
  if (cfg.jet) {
    // afterburner glow
    const ab = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.4, 8),
      stdMat(0xff8833, { emissive: 0xff6a1f, emissiveIntensity: 2, transparent: true, opacity: 0.85 }));
    ab.rotation.x = -Math.PI / 2; ab.position.set(0, 1.1, -3.9);
    g.add(ab);
    props.push(ab);
  } else {
    const prop = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.22), stdMat(0x222));
    prop.position.set(0, 1.1, 3.35);
    g.add(prop);
    props.push(prop);
  }
  // landing gear
  const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10);
  wg.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[1.1, 0.9], [-1.1, 0.9], [0, -2.6]]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), stdMat(0x333));
    strut.position.set(x, 0.55, z);
    const w = new THREE.Mesh(wg, stdMat(0x15181d));
    w.position.set(x, 0.3, z);
    g.add(strut, w);
    wheels.push(w);
  }
  return { group: shadowify(g), wheels, steer: [], props };
}

/* ------------------------------------------------------ vehicle configs - */
const VEHICLES = [
  { key: '1', name: 'Falcon GT',   cls: 'Hypercar',   kind: 'car',  color: 0xd12b2b, maxSpeed: 94,  accel: 26, grip: 9.0, turn: 2.5, offroad: 0.45, spoiler: true,
    hint: '<b>W</b> gas · <b>Space</b> drift · <b>Shift</b> nitro' },
  { key: '2', name: 'Bandit V8',   cls: 'Muscle',     kind: 'car',  color: 0x2456c9, maxSpeed: 80,  accel: 22, grip: 6.5, turn: 2.3, offroad: 0.5,  spoiler: false,
    hint: 'Loves going sideways. <b>Space</b> to drift.' },
  { key: '3', name: 'Trailcat 4X4',cls: 'Offroader',  kind: 'car',  color: 0x3e8a3a, maxSpeed: 55,  accel: 15, grip: 8.0, turn: 2.1, offroad: 0.95, spoiler: false,
    hint: 'Barely slows down off the tarmac. Climb everything.' },
  { key: '4', name: 'Viper R',     cls: 'Superbike',  kind: 'bike', color: 0xe8c020, maxSpeed: 86,  accel: 25, grip: 8.5, turn: 2.9, offroad: 0.35,
    hint: 'Fast and flickable — lean into corners.' },
  { key: '5', name: 'Dust Hopper', cls: 'Dirt bike',  kind: 'bike', color: 0xe06a1f, maxSpeed: 48,  accel: 17, grip: 7.5, turn: 3.1, offroad: 0.9,
    hint: 'Made for the hills. Jump everything.' },
  { key: '6', name: 'Skyhawk',     cls: 'Stunt plane',kind: 'plane',color: 0xe8e4da, maxSpeed: 88,  accel: 15, grip: 0, turn: 1.6, offroad: 1, jet: false,
    hint: '<b>W/S</b> throttle · <b>↑↓</b> pitch · <b>A/D</b> bank. <b>T</b> = airfield.' },
  { key: '7', name: 'Thunder Jet', cls: 'Jet',        kind: 'plane',color: 0x39404d, maxSpeed: 132, accel: 26, grip: 0, turn: 1.3, offroad: 1, jet: true,
    hint: 'Afterburner scream. Needs room to turn.' },
];

/* ----------------------------------------------------------- the player - */
const player = {
  cfg: null, mesh: null, wheels: [], steer: [], props: [],
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, roll: 0, visRoll: 0, visPitch: 0,
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

function setVehicle(idx, opts) {
  const cfg = VEHICLES[idx];
  if (!cfg) return;
  if (player.mesh) scene.remove(player.mesh);
  const built = cfg.kind === 'car' ? buildCar(cfg) : cfg.kind === 'bike' ? buildBike(cfg) : buildPlane(cfg);
  player.cfg = cfg;
  player.mesh = built.group;
  player.wheels = built.wheels;
  player.steer = built.steer;
  player.props = built.props;
  player.vel.multiplyScalar(0.4);
  player.pitch = 0; player.roll = 0; player.throttleLevel = 0;
  player.grounded = true;
  if (!(opts && opts.keepPos)) { /* keep position by default */ }
  scene.add(player.mesh);
  document.getElementById('veh-name').textContent = cfg.name;
  document.getElementById('veh-class').textContent = cfg.cls;
  document.getElementById('veh-hint').innerHTML = cfg.hint;
  document.getElementById('nitro-row').style.display = cfg.kind === 'plane' ? 'none' : 'flex';
  document.getElementById('thr-row').style.display = cfg.kind === 'plane' ? 'flex' : 'none';
  document.getElementById('alt-row').style.display = cfg.kind === 'plane' ? 'flex' : 'none';
  document.getElementById('spd-unit').textContent = 'KM/H';
  refreshGarageActive(idx);
}

function respawnToRoad() {
  // nearest point on loop by angle
  const a = Math.atan2(player.pos.z, player.pos.x);
  let t = ((a / TAU) % 1 + 1) % 1;
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
  player.yaw = Math.atan2(1, 0);   // facing +X down the runway
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
  if (k === 'KeyC') camMode = (camMode + 1) % 3;
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
function toggleGarage() {
  const g = document.getElementById('garage');
  g.classList.toggle('open');
}
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
  const rx = fz, rz = -fx;                       // right vector
  let vf = player.vel.x * fx + player.vel.z * fz;
  let vr = player.vel.x * rx + player.vel.z * rz;

  const kind = surfaceKind(player.pos.x, player.pos.z);
  const onPaved = kind !== 'dirt';
  const surf = onPaved ? 1 : cfg.offroad;

  // nitro
  let boost = 1;
  if (inp.nitro && player.nitro > 0 && inp.throttle) {
    boost = 1.65; player.nitro = Math.max(0, player.nitro - 32 * dt);
  } else {
    player.nitro = Math.min(100, player.nitro + 9 * dt);
  }

  if (player.grounded) {
    // engine / brake
    const maxS = cfg.maxSpeed * surf * (boost > 1 ? 1.14 : 1);
    if (inp.throttle) vf += cfg.accel * surf * boost * dt * clamp(1 - vf / maxS, 0, 1);
    if (inp.brake) {
      if (vf > 0.5) vf -= 34 * dt;
      else vf = Math.max(vf - 8 * dt, -13);      // reverse
    }
    // rolling resistance + aero drag
    vf -= vf * (0.06 + Math.abs(vf) * 0.0012) * dt * 3;
    // steering
    const spdFac = clamp(Math.abs(vf) / 7, 0, 1) / (1 + Math.abs(vf) * 0.014);
    let yawRate = inp.steer * cfg.turn * spdFac * Math.sign(vf || 1);
    if (inp.hand) yawRate *= 1.6;
    player.yaw += yawRate * dt;
    // lateral grip (drift when handbrake)
    const grip = inp.hand ? 1.7 : cfg.grip * (onPaved ? 1 : 0.55);
    vr *= Math.exp(-grip * dt);
    if (inp.hand && Math.abs(vf) > 8) vf -= vf * 0.35 * dt;
    // slope pull
    const gx = (terrainHeight(player.pos.x + 1.6, player.pos.z) - terrainHeight(player.pos.x - 1.6, player.pos.z)) / 3.2;
    const gz = (terrainHeight(player.pos.x, player.pos.z + 1.6) - terrainHeight(player.pos.x, player.pos.z - 1.6)) / 3.2;
    vf -= GRAV * (fx * gx + fz * gz) * dt * 0.55;
  }

  player.vel.x = fx * vf + rx * vr;
  player.vel.z = fz * vf + rz * vr;
  player.vel.y -= GRAV * dt;
  player.pos.addScaledVector(player.vel, dt);

  // ground contact
  const gY = terrainHeight(player.pos.x, player.pos.z);
  if (player.pos.y <= gY + 0.02) {
    player.pos.y = gY;
    if (player.vel.y < -14) { player.vel.x *= 0.7; player.vel.z *= 0.7; } // hard landing scrub
    player.vel.y = 0;
    player.grounded = true;
  } else {
    player.grounded = player.pos.y - gY < 0.6;
  }

  collideWorld();
  waterCheck();

  // ------- visuals
  player.wheelSpin += vf * dt / 0.42;
  for (const w of player.wheels) w.rotation.x = player.wheelSpin;
  for (const p of player.steer) p.rotation.y = inp.steer * 0.42;
  // orient to ground normal
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
  // throttle lever
  player.throttleLevel = clamp(player.throttleLevel + (inp.thrUp - inp.thrDn) * 0.55 * dt, 0, 1);

  const speed = player.vel.length();
  const stall = 26, takeoff = 33;

  if (player.grounded) {
    // taxi like a simple car
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    let vf = player.vel.x * fx + player.vel.z * fz;
    vf += (player.throttleLevel * cfg.accel * 1.15 - vf * 0.25) * dt * 2.2;
    if (vf < 0) vf = 0;
    const spdFac = clamp(vf / 6, 0, 1) / (1 + vf * 0.03);
    player.yaw += (inp.rollL - inp.rollR) * 1.6 * spdFac * dt;
    player.vel.set(fx * vf, 0, fz * vf);
    player.pos.addScaledVector(player.vel, dt);
    player.pos.y = terrainHeight(player.pos.x, player.pos.z);
    if (vf > takeoff) {                        // rotate!
      player.grounded = false;
      player.pitch = 0.16;
      player.vel.y = 4;
      showMsg('WHEELS UP!', 900);
    }
    player.roll = lerp(player.roll, 0, 6 * dt);
  } else {
    // pitch & roll
    player.pitch = clamp(player.pitch + (inp.pitchUp - inp.pitchDn) * 1.15 * dt, -1.1, 1.1);
    player.roll += (inp.rollR - inp.rollL) * 2.3 * dt;
    if (!inp.rollL && !inp.rollR) player.roll = lerp(player.roll, 0, 1.2 * dt);
    // banked turn
    player.yaw -= Math.sin(player.roll) * cfg.turn * dt * (0.4 + speed / cfg.maxSpeed);
    // forward direction
    const cp = Math.cos(player.pitch);
    const dir = tmpV.set(Math.sin(player.yaw) * cp, Math.sin(player.pitch), Math.cos(player.yaw) * cp);
    // speed: thrust vs drag vs gravity along path
    let s = speed;
    s += (player.throttleLevel * cfg.accel - s * s * (cfg.accel / (cfg.maxSpeed * cfg.maxSpeed))) * dt;
    s -= GRAV * Math.sin(player.pitch) * dt * 0.7;
    s = Math.max(s, 0);
    player.vel.copy(dir).multiplyScalar(s);
    // stall sink
    if (s < stall) {
      player.vel.y -= (stall - s) * 1.4 * dt * 4;
      player.pitch = lerp(player.pitch, -0.35, dt * 0.8);
    }
    player.pos.addScaledVector(player.vel, dt);

    // ground interaction
    const gY = terrainHeight(player.pos.x, player.pos.z);
    if (player.pos.y < gY + 0.4) {
      const kind = surfaceKind(player.pos.x, player.pos.z);
      const gentle = player.vel.y > -9 && Math.abs(player.pitch) < 0.28 && Math.abs(player.roll) < 0.4;
      if (gentle && (kind === 'strip' || kind === 'road' || kind === 'city')) {
        player.grounded = true; player.pitch = 0; player.roll = 0;
        player.pos.y = gY; player.vel.y = 0;
        showMsg('TOUCHDOWN', 900);
      } else if (gentle) {                     // rough field landing — bleed speed
        player.grounded = true; player.pitch = 0; player.roll = 0;
        player.pos.y = gY; player.vel.y = 0;
        player.vel.multiplyScalar(0.5);
      } else {                                  // crash — forgiving bounce
        player.pos.y = gY + 1.2;
        player.vel.multiplyScalar(0.25);
        player.vel.y = 6;
        player.pitch = 0.25; player.roll = 0;
        player.throttleLevel = Math.min(player.throttleLevel, 0.4);
        showMsg('CRASH!', 1100);
      }
    }
  }
  waterCheck();

  // visuals
  for (const p of player.props) {
    if (cfg.jet) { const s = 0.4 + player.throttleLevel * 1.3; p.scale.set(1, s, 1); }
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
  // buildings (axis aligned)
  for (const b of buildings) {
    const dx = player.pos.x - b.x, dz = player.pos.z - b.z;
    const px = b.hw + 1.1 - Math.abs(dx), pz = b.hd + 1.1 - Math.abs(dz);
    if (px > 0 && pz > 0 && player.pos.y < CITY_H + b.h + 2) {
      if (px < pz) { player.pos.x += Math.sign(dx) * px; player.vel.x *= -0.25; }
      else { player.pos.z += Math.sign(dz) * pz; player.vel.z *= -0.25; }
      player.vel.multiplyScalar(0.82);
    }
  }
  // trees via spatial hash
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
    if (race.active) { /* keep racing from road */ }
  }
}

/* ------------------------------------------------------------ AI racers - */
const AI_COUNT = 3;
const aiRacers = [];
(function buildAI() {
  const colors = [0xe0e0e0, 0xef8f1f, 0x9b59d0];
  for (let i = 0; i < AI_COUNT; i++) {
    const cfg = { color: colors[i], spoiler: i !== 1 };
    const b = buildCar(cfg);
    scene.add(b.group);
    aiRacers.push({
      mesh: b.group, wheels: b.wheels, t: 0.995 - i * 0.0035,
      baseSpeed: 46 + i * 3.5, speed: 0, spin: 0, laps: 0, prevT: 0
    });
  }
  parkAI();
})();
function parkAI() {
  aiRacers.forEach((ai, i) => {
    ai.t = ((0.997 - i * 0.004) % 1 + 1) % 1;
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
  const loopLen = 3300;   // approx metres
  for (const ai of aiRacers) {
    // rubber-band vs player progress
    const lead = (ai.laps + ai.t) - (race.laps + race.progressT);
    let sp = ai.baseSpeed * (lead > 0.06 ? 0.82 : lead < -0.06 ? 1.18 : 1);
    ai.speed = lerp(ai.speed, sp, dt * 0.8);
    const prev = ai.t;
    ai.t = (ai.t + (ai.speed / loopLen) * dt) % 1;
    if (ai.t < prev) ai.laps++;
    placeAI(ai);
    ai.spin += ai.speed * dt / 0.42;
    for (const w of ai.wheels) w.rotation.x = ai.spin;
  }
}

/* ------------------------------------------------------------- race ----- */
const CHECKPOINTS = 12;
const race = {
  active: false, countdown: 0, time: 0, laps: 0, lapTotal: 2,
  nextCp: 0, progressT: 0, startT: 0.0, gates: [], results: false
};
(function buildGates() {
  const pylonGeo = new THREE.CylinderGeometry(0.5, 0.7, 9, 8);
  for (let i = 0; i < CHECKPOINTS; i++) {
    const t = (i + 1) / CHECKPOINTS % 1;
    const p = roadPoint(t), tan = roadTangent(t);
    const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
    const grp = new THREE.Group();
    const matOff = new THREE.MeshStandardMaterial({ color: 0x3a4a68, emissive: 0x101830, emissiveIntensity: 0.4 });
    for (const s of [-1, 1]) {
      const py = new THREE.Mesh(pylonGeo, matOff);
      const pp = p.clone().addScaledVector(nrm, s * (ROAD_HALF + 1.6));
      py.position.set(pp.x, terrainHeight(pp.x, pp.z) + 4.5, pp.z);
      py.castShadow = true;
      grp.add(py);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 4, 0.7, 0.7), matOff);
    beam.position.set(p.x, terrainHeight(p.x, p.z) + 9.2, p.z);
    beam.rotation.y = Math.atan2(tan.x, tan.z) + Math.PI / 2;
    grp.add(beam);
    scene.add(grp);
    race.gates.push({ t, pos: p.clone(), grp, mat: matOff });
  }
  // start arch (at t = 0 gate = index CHECKPOINTS-1)
})();
function setGateGlow(idx) {
  race.gates.forEach((g, i) => {
    g.mat.emissive.setHex(i === idx ? 0x2affc6 : 0x101830);
    g.mat.emissiveIntensity = i === idx ? 1.6 : 0.4;
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
  race.active = true; race.results = false;
  race.countdown = 3.5; race.time = 0; race.laps = 0; race.nextCp = 0;
  // grid up just behind the start line
  const t0 = 0.999;
  const p = roadPoint(t0), tan = roadTangent(t0);
  player.pos.copy(p); player.pos.y += 0.4;
  player.vel.set(0, 0, 0);
  player.yaw = Math.atan2(tan.x, tan.z);
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
  race.progressT = ((trackT() - 0) % 1 + 1) % 1;
  // checkpoint pass
  const gate = race.gates[race.nextCp];
  if (gate && player.pos.distanceTo(gate.pos) < 24) {
    race.nextCp++;
    if (race.nextCp >= CHECKPOINTS) {
      race.nextCp = 0; race.laps++;
      if (race.laps >= race.lapTotal) {
        finishRace();
        return;
      } else showMsg(`LAP ${race.laps + 1} / ${race.lapTotal}`, 1100);
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
let dayTime = 0.32;            // 0..1, full cycle
const DAY_LEN = 300;           // seconds per cycle
const skyDay = new THREE.Color(0x87b7e8), skyNight = new THREE.Color(0x0a1030),
      skyDawn = new THREE.Color(0xf5956a);
const fogCol = new THREE.Color();
function stepDayNight(dt) {
  dayTime = (dayTime + dt / DAY_LEN) % 1;
  const sunEl = Math.sin(dayTime * TAU);         // >0 day, <0 night
  const az = dayTime * TAU + Math.PI / 2;
  const sd = new THREE.Vector3(Math.cos(az) * 0.8, sunEl, Math.sin(az) * 0.6).normalize();
  sun.position.copy(player.pos).addScaledVector(sd, 380);
  sun.target.position.copy(player.pos);
  sun.intensity = Math.max(0, sunEl) * 1.25 + 0.02;
  hemi.intensity = 0.14 + Math.max(0, sunEl) * 0.5;
  sunSprite.position.copy(camera.position).addScaledVector(sd, 2800);
  sunSprite.material.opacity = smoothstep(-0.12, 0.05, sunEl);

  // sky colour: night -> dawn -> day
  const dayAmt = smoothstep(-0.08, 0.25, sunEl);
  const dawnAmt = Math.exp(-Math.pow((sunEl - 0.05) * 5.5, 2));
  fogCol.copy(skyNight).lerp(skyDay, dayAmt).lerp(skyDawn, dawnAmt * 0.55);
  renderer.setClearColor(fogCol);
  scene.fog.color.copy(fogCol);
  sun.color.setHSL(0.09, clamp(0.9 - dayAmt, 0, 0.75), 0.9);

  // headlights
  const night = sunEl < 0.06 && player.cfg.kind !== 'plane';
  for (const h of headlights) {
    h.sp.intensity = night ? 2.2 : 0;
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
  cloudGroup.rotation.y += dt * 0.002;
}

/* -------------------------------------------------------------- camera -- */
const camPos = new THREE.Vector3(0, 30, -20);
function stepCamera(dt, speed) {
  const cfg = player.cfg;
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const spdRatio = clamp(speed / cfg.maxSpeed, 0, 1);
  let target;
  if (camMode === 0) {          // chase
    const back = cfg.kind === 'plane' ? 16 : 9.5;
    const up = cfg.kind === 'plane' ? 5.5 : 3.4;
    target = tmpV.set(player.pos.x - fx * back, player.pos.y + up, player.pos.z - fz * back);
  } else if (camMode === 1) {   // close / bumper-ish
    const back = cfg.kind === 'plane' ? 10 : 4.5;
    target = tmpV.set(player.pos.x - fx * back, player.pos.y + 2.0, player.pos.z - fz * back);
  } else {                      // cinematic orbit
    const a = performance.now() * 0.00025;
    target = tmpV.set(player.pos.x + Math.cos(a) * 22, player.pos.y + 9, player.pos.z + Math.sin(a) * 22);
  }
  // keep camera above terrain
  const camGround = terrainHeight(target.x, target.z) + 1.2;
  if (target.y < camGround) target.y = camGround;
  const k = 1 - Math.exp(-(camMode === 2 ? 2.2 : 5.5) * dt);
  camPos.lerp(target, k);
  camera.position.copy(camPos);
  camera.lookAt(player.pos.x + fx * 10, player.pos.y + 1.6, player.pos.z + fz * 10);
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
  // water hint
  g.fillStyle = 'rgba(28,90,140,0.25)'; g.fillRect(0, 0, 196, 196);
  // land
  g.fillStyle = 'rgba(58,86,48,0.9)';
  g.beginPath(); g.arc(98, 98, 92, 0, TAU); g.fill();
  // city
  g.fillStyle = 'rgba(120,130,150,0.9)';
  const [cx, cy] = w2m(0, 0);
  g.beginPath(); g.arc(cx, cy, CITY_R * 186 / WORLD, 0, TAU); g.fill();
  // airstrip
  g.fillStyle = 'rgba(70,74,84,1)';
  const [ax, ay] = w2m(STRIP.x - STRIP.hl, STRIP.z - STRIP.hw);
  g.fillRect(ax, ay, STRIP.hl * 2 * 186 / WORLD, Math.max(3, STRIP.hw * 2 * 186 / WORLD));
  // road
  g.strokeStyle = '#e8e4da'; g.lineWidth = 2.4; g.beginPath();
  mmRoad.forEach((p, i) => {
    const [x, y] = w2m(p.x, p.z);
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  });
  g.closePath(); g.stroke();
  // next checkpoint
  if (race.active) {
    const gpos = race.gates[race.nextCp].pos;
    const [gx, gy] = w2m(gpos.x, gpos.z);
    g.fillStyle = '#2affc6';
    g.beginPath(); g.arc(gx, gy, 4.5, 0, TAU); g.fill();
  }
  // AI
  g.fillStyle = '#ff7b6b';
  for (const ai of aiRacers) {
    const [x, y] = w2m(ai.mesh.position.x, ai.mesh.position.z);
    g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill();
  }
  // player arrow
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
    // skid noise
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
  stepCamera(dt, speed);
  stepHUD(dt, speed);
  stepAudio(speed);
  mmClock += dt;
  if (mmClock > 0.12) { drawMinimap(); mmClock = 0; }
  renderer.render(scene, camera);
}
frame();

document.getElementById('loading').classList.add('done');
window.__gameReady = true;

})();
