const { chromium } = require('playwright-core');
const fs = require('fs');
const http = require('http');
const path = require('path');

// Put three.min.js, GLTFLoader.js and the Poly Haven model folders next to
// this script (see tools/README.md), then: node run-bake.js
const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(8765);

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 300)); });
  await page.goto('http://127.0.0.1:8765/bake.html');
  const jobs = [
    { key: 'fir', url: 'fir_sapling/fir_sapling_1k.gltf', node: 'fir_sapling_a', w: 384, h: 768 },
    { key: 'broad', url: 'island_tree_02/island_tree_02_1k.gltf', node: null, w: 640, h: 512 },
  ];
  const out = {};
  for (const j of jobs) {
    const t0 = Date.now();
    const r = await page.evaluate(({ url, node, w, h }) => window.bake(url, node, 3, w, h), j);
    fs.writeFileSync(path.join(ROOT, j.key + '.webp'), Buffer.from(r.dataUrl.split(',')[1], 'base64'));
    out[j.key] = { src: r.dataUrl, aspect: (2 * r.R) / r.H, views: r.views };
    console.log(j.key, 'H', r.H.toFixed(2), 'R', r.R.toFixed(2),
      'webp', (r.dataUrl.length * 0.75 / 1024 | 0) + 'KB', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  // preview sheet on a grey background so I can inspect the alpha edges
  const prev = await page.evaluate(async (srcs) => {
    const imgs = await Promise.all(srcs.map(s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; })));
    const W = Math.max(...imgs.map(i => i.width)), Hs = imgs.reduce((s, i) => s + i.height, 0);
    const c = document.createElement('canvas'); c.width = W; c.height = Hs;
    const g = c.getContext('2d'); g.fillStyle = '#9aa7b4'; g.fillRect(0, 0, W, Hs);
    let y = 0; for (const i of imgs) { g.drawImage(i, 0, y); y += i.height; }
    return c.toDataURL('image/png');
  }, Object.values(out).map(o => o.src));
  fs.writeFileSync(path.join(ROOT, 'preview.png'), Buffer.from(prev.split(',')[1], 'base64'));
  const js = '// Tree impostor atlases baked from Poly Haven models (CC0): fir_sapling,\n' +
    '// island_tree_02. 3 views each (0/60/120 deg), WebP with alpha.\n' +
    'window.VH_TREES = ' + JSON.stringify(out) + ';\n';
  fs.writeFileSync(path.join(__dirname, '../assets/trees.js'), js);
  console.log('trees.js', (js.length / 1024 | 0) + 'KB');
  await browser.close(); server.close();
})().catch(e => { console.error('FAILED', e.message); server.close(); process.exit(1); });
