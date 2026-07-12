# Velocity Horizon 🏎️✈️🏍️

An open-world arcade racing game inspired by Forza Horizon and The Crew Motorfest —
**cars, superbikes and planes** in one seamless procedurally-generated world.
Runs entirely in your browser. No install, no build step, works offline.

## ▶️ How to play

**Just open `index.html` in any modern browser** (Chrome, Edge, Firefox, Safari).
Double-clicking the file works — everything is bundled locally.

If you prefer a local server:

```bash
cd velocity-horizon
python3 -m http.server 8000
# then open http://localhost:8000
```

## 🌍 The world

- Procedural island (~3.4 km across): rolling hills, mountains with snow caps, lakes, forests
- A grand **highway loop** (~3.3 km) winding through the landscape
- A **downtown city** with skyscrapers at the center of the island
- A full **airfield** — runway, hangar and control tower — for the planes
- **Day/night cycle** with sunrise/sunset skies, a moving sun, clouds and working headlights at night

## 🚗 The garage (press V, or keys 1–7)

| # | Vehicle | Class | Character |
|---|---------|-------|-----------|
| 1 | 458 Italia | Hypercar | Real ~340k-vertex model · 340 km/h |
| 2 | Bandit V8 | Muscle | Loves going sideways |
| 3 | Trailcat 4X4 | Offroader | Barely slows down off tarmac |
| 4 | Viper R | Superbike | Fast, flickable, leans into corners |
| 5 | Dust Hopper | Dirt bike | Made for the hills |
| 6 | Skyhawk | Stunt plane | Take off from the runway (press T) |
| 7 | Thunder Jet | Jet | Afterburner scream, 475 km/h |

## 🎮 Controls

| Input | Driving | Flying |
|-------|---------|--------|
| `W` / `S` | accelerate / brake–reverse | throttle up / down |
| `A` `D` or `←` `→` | steer | bank & turn |
| `↑` / `↓` | accelerate / brake | climb / dive |
| `Space` | handbrake · drift | — |
| `Shift` | nitro boost | — |

**World keys:** `Enter` start/quit race · `V` garage · `1–7` quick-switch vehicle ·
`R` reset to road · `T` teleport to airfield · `C` camera view · `N` skip time of day ·
`H` help · `M` mute

## 🏁 Racing

Press **Enter** to line up against 3 AI rivals: 2 laps of the island highway,
12 glowing checkpoint gates. Live position, lap and timer on the HUD; the minimap
shows the next gate. Win the trophy. 🏆

## ✈️ Flying

Pick the Skyhawk or Thunder Jet, press `T` for the airfield, hold `W` to spool the
throttle — the plane rotates off the runway by itself past ~120 km/h. Land gently
(shallow pitch, low speed) on the runway or a road. Rough landings are forgiven…
mostly.

## 🔧 Tech notes

- Pure [Three.js](https://threejs.org/) (vendored in `vendor/`), zero dependencies, no bundler
- The hypercar (and AI rivals) is a real high-poly glTF model — *Ferrari 458 Italia*
  by **vicent091036**, from the three.js examples — meshopt-compressed and embedded
  as base64 (`assets/car-models.js`) so the game still runs from a double-clicked
  `index.html` with no server and no network
- Everything procedural: terrain (value-noise fBm), road ribbon, city, vegetation,
  and every texture (asphalt, grass, building facades, water normals) painted at
  load time on canvases — no downloaded assets
- **PBR pipeline**: clearcoat car paint (`MeshPhysicalMaterial`), image-based lighting
  from a PMREM-filtered procedural sky, ACES filmic tone mapping, sRGB color management
- **Post-processing**: UnrealBloom + FXAA + gamma correction via EffectComposer
- **Atmosphere shader**: custom sky dome GLSL — day/dawn/night gradients, sun disc,
  procedural stars; environment relit as the sun moves
- Night set-dressing: lit building windows (emissive maps), glowing street lamps,
  working headlights
- GPU particles (custom shader `Points`) for drift smoke, off-road dust and nitro flames
- Arcade-sim physics: per-surface grip, drifting, slope forces, stall/lift flight
  model, bike lean; engine + tire-skid audio synthesized live with WebAudio
