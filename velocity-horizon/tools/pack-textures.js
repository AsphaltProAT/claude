// Re-encode Poly Haven JPGs via Chromium canvas and bundle as data URIs.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const RAW = process.argv[2] || path.join(__dirname, 'raw');   // downloaded Poly Haven JPGs
const OUT = path.join(__dirname, '../assets/textures.js');
const jobs = [
  ['grass_col',   'rocky_terrain_02_Diffuse.jpg', 0.82],
  ['grass_nor',   'rocky_terrain_02_nor_gl.jpg',  0.88],
  ['dirt_col',    'forest_ground_04_Diffuse.jpg', 0.82],
  ['dirt_nor',    'forest_ground_04_nor_gl.jpg',  0.88],
  ['rock_col',    'rock_face_03_Diffuse.jpg',     0.82],
  ['rock_nor',    'rock_face_03_nor_gl.jpg',      0.88],
  ['sand_col',    'coast_sand_01_Diffuse.jpg',    0.82],
  ['sand_nor',    'coast_sand_01_nor_gl.jpg',     0.88],
  ['snow_col',    'snow_02_Diffuse.jpg',          0.82],
  ['snow_nor',    'snow_02_nor_gl.jpg',           0.88],
  ['asph_col',    'asphalt_track_Diffuse.jpg',    0.80],
  ['asph_nor',    'asphalt_track_nor_gl.jpg',     0.88],
  ['asph_rough',  'asphalt_track_Rough.jpg',      0.80],
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  const out = {};
  let total = 0;
  for (const [key, file, q] of jobs) {
    const b64 = fs.readFileSync(path.join(RAW, file)).toString('base64');
    const dataUrl = await page.evaluate(async ({ b64, q }) => {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/jpeg', q);
    }, { b64, q });
    out[key] = dataUrl;
    const kb = (dataUrl.length * 0.75 / 1024) | 0;
    total += kb;
    console.log(key.padEnd(11), (fs.statSync(path.join(RAW, file)).size / 1024 | 0) + 'KB ->', kb + 'KB');
  }
  await browser.close();
  const js = '// Photoscanned PBR textures from Poly Haven (polyhaven.com) — CC0 public domain.\n' +
    '// rocky_terrain_02, forest_ground_04, rock_face_03, coast_sand_01, snow_02, asphalt_track.\n' +
    '// Re-encoded to game-weight JPEGs and embedded so the game runs from file://\n' +
    'window.VH_TEX = ' + JSON.stringify(out) + ';\n';
  fs.writeFileSync(OUT, js);
  console.log('total', (total / 1024).toFixed(2), 'MB binary;', (js.length / 1048576).toFixed(2), 'MB file');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
