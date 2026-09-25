# Asset pipeline

Offline scripts that produce the embedded assets in `../assets/`. They need
Node.js and `playwright-core` (`npm install playwright-core`) plus a local
Chromium; the game itself needs none of this.

## `pack-textures.js` → `assets/textures.js`

Re-encodes Poly Haven 1K JPGs (2K for the asphalt colour map) through
Chromium's JPEG encoder and embeds them as data URIs.

1. Download from polyhaven.com (1K JPG): Diffuse + nor_gl for
   `rocky_terrain_02`, `forest_ground_04`, `rock_face_03`, `coast_sand_01`,
   `snow_02`, and Diffuse (2K) + nor_gl + Rough for `asphalt_track`.
2. Save them as `<asset>_<map>.jpg` (e.g. `rock_face_03_nor_gl.jpg`) in `tools/raw/`.
3. `node pack-textures.js`

## `run-bake.js` + `bake.html` → `assets/trees.js`

Bakes tree impostors: loads a glTF tree in headless Chromium, renders it from
3 azimuths (0/60/120°) with soft studio light onto transparent cells, dilates
edge colours so mipmaps don't produce dark halos, and packs a WebP atlas.

1. Download the 1K glTF of `fir_sapling` and `island_tree_02` from Poly Haven
   into `tools/fir_sapling/` and `tools/island_tree_02/`.
2. Copy `../vendor/three.min.js` and `../vendor/GLTFLoader.js` into `tools/`.
3. `node run-bake.js`

All source assets are CC0 (public domain).
