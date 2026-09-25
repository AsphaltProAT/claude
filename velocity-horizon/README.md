# Velocity Horizon 🏎️✈️🏍️

An open-world festival racing game in the spirit of Forza Horizon and The Crew Motorfest —
**cars, superbikes and planes** on one procedurally-generated island, with a full career:
events, rivals, progression, a garage to buy and tune your machines, traffic, dynamic
weather and a day/night cycle. Runs entirely in your browser. No install, no build step,
works offline.

## ▶️ How to play

**Open `index.html` in any modern browser** (Chrome, Edge, Firefox, Safari).
Double-clicking the file works — everything is bundled locally.

If you prefer a local server:

```bash
cd velocity-horizon
python3 -m http.server 8000
# then open http://localhost:8000
```

Pick **New Game** on the title screen. Progress saves automatically (browser local
storage) — **Continue** picks up where you left off.

## 🏆 Career

You arrive at the festival with 20,000 credits and a Bandit V8. Drive into a glowing
marker and press **Enter** to start an event. Every finish pays credits and XP; placing
well earns up to three ★ stars. Level up to unlock events and vehicles, collect stars to
open the **Horizon Finale** downtown — win it to become festival champion.

| Event | Type | Unlocks | For |
|-------|------|---------|-----|
| Horizon Opener | Circuit · 1 lap vs 3 rivals | Lv 1 | Cars & bikes |
| Highland Sprint | Sprint vs 3 rivals | Lv 1 | Cars |
| Valley Scramble | Cross-country time trial | Lv 2 | Cars & bikes |
| Two-Wheel Rush | Sprint vs 3 rivals | Lv 2 | Bikes |
| Skyline Rings | Air race — 10 rings round the island | Lv 3 | Planes |
| Highway Grand Prix | Circuit · 2 laps | Lv 3 | Cars |
| Ridge Runner | Cross-country time trial | Lv 4 | Cars & bikes |
| Midnight Run | Circuit · 2 laps at night | Lv 5 | Cars & bikes |
| Peak Threader | Air race through the northern peaks | Lv 6 | Planes |
| Island Circuit Pro | Circuit · 3 laps | Lv 6 | Cars & bikes |
| **Horizon Finale** | Circuit · 3 laps, the decider | Lv 8 + 24 ★ | Cars |

**Free-roam stunts** — always live, no start needed, each worth up to three stars:

- **Speed traps** (4) — hit them flat out
- **Drift zones** (3) — drift from the purple gate to the next one
- **Danger jumps** (5) — hazard-striped kicker ramps; distance is measured to landing

**Neon tokens** — 30 hidden collectibles (5 of them in the sky, for pilots). They appear
on the world map once you are close.

**Skill chains** — drifting, big air, top speed, low flying and near-missing traffic all
score skill points. Chain them for a multiplier (up to x5); stop for a few seconds to bank
the chain as credits and XP. Crashing breaks the chain.

## 🚗 Garage (V)

| # | Vehicle | Class | Price | Unlock |
|---|---------|-------|-------|--------|
| 1 | 458 Italia | Hypercar — real ~340k-vertex model | 110,000 | Lv 5 |
| 2 | Bandit V8 | Muscle — your first ride | owned | — |
| 3 | Trailcat 4X4 | Offroader | 24,000 | — |
| 4 | Viper R | Superbike | 42,000 | Lv 3 |
| 5 | Dust Hopper | Dirt bike | 14,000 | — |
| 6 | Skyhawk | Stunt plane — real textured model | 60,000 | Lv 3 |
| 7 | Thunder Jet | Jet | 190,000 | Lv 8 |

Each vehicle has three upgrade tracks (engine, tyres & suspension / airframe, nitrous)
with three stages each, plus a paint shop.

## 🎮 Controls

| Input | Driving | Flying | Gamepad |
|-------|---------|--------|---------|
| `W` / `S` | accelerate / brake–reverse | throttle up / down | RT / LT |
| `A` `D` or `←` `→` | steer | bank & turn | left stick |
| `↑` / `↓` | accelerate / brake | climb / dive | left stick ↕ |
| `Space` | handbrake · drift | — | A |
| `Shift` | nitro | — | X or RB |

**World:** `Enter` start event · `M`/`Tab` world map · `V` garage · `1–7` quick-switch an owned
vehicle · `R` reset to road / last checkpoint · `C` camera (chase / close / cockpit /
cinematic) · `Q` radio · `T` airfield · `N` skip time of day · `H` help · `Esc` pause.

## ⚙️ Settings

Graphics quality (Low → Ultra: resolution scale, shadow resolution, bloom), field of view,
camera shake, master / music / effects volume, km/h or mph, rival difficulty, traffic,
dynamic weather and inverted flight pitch. Settings are remembered per device.

## 🌍 The world

- Procedural island (~3.4 km across): rolling hills, snow-capped mountains, lakes, forests
- A grand **highway loop** (~3.3 km) with two-way traffic, plus three spoke roads into town
- A **downtown city** on a plateau with skyscrapers — and the finale
- A full **airfield** — runway, hangar and control tower
- **Day/night cycle** with sunrise/sunset skies, moonlight, lit windows and street lamps
- **Dynamic weather** — clear, overcast and rain fronts with wet, reflective roads, less
  grip, road spray and the occasional lightning storm

## 🔧 Tech notes

- Pure [Three.js](https://threejs.org/) (vendored in `vendor/`), zero dependencies, no bundler
- `js/game.js` — world, physics, traffic, AI, events, stunts, weather, camera, game states
- `js/ui.js` — title, pause, settings, garage & shop, world map, results, HUD & gauge
- `js/audio.js` — WebAudio synthesis: multi-oscillator engines with a gearbox, wind, tyres,
  rain, impacts, UI sounds and a procedural synthwave soundtrack (drums, bass, pads,
  arpeggio, reverb, delay) that shifts between menu, cruising and race arrangements
- `js/content.js` — vehicles, prices, upgrades, events, stunts and the XP curve (pure data)
- `js/save.js` — career profile and settings persistence (local storage, fully guarded)
- The hypercar is a real high-poly glTF model — *Ferrari 458 Italia* by **vicent091036**,
  from the three.js examples — meshopt-compressed and embedded as base64
  (`assets/car-models.js`) so the game still runs from a double-clicked `index.html`
- The stunt plane is the textured *aerobatic plane* from the free
  [BabylonJS asset library](https://github.com/BabylonJS/Assets), embedded the same way
- Everything else is procedural: terrain (value-noise fBm), roads, city, vegetation, and
  every texture painted at load time on canvases
- **PBR pipeline**: clearcoat paint, image-based lighting from a PMREM-filtered procedural
  sky, ACES filmic tone mapping; **post**: UnrealBloom + FXAA + gamma correction
- Instanced rendering for traffic, trees, rocks and tokens; GPU particles for smoke, dust,
  spray and nitro
- Arcade-sim physics: per-surface grip, drifting, slope forces, ground-following vertical
  velocity (crests and ramps launch you for real), oriented-box collisions with traffic and
  rivals, stall/lift flight model, bike lean
- AI rivals follow the racing line with curvature-limited corner speeds, pull out to pass,
  and scale their pace to your vehicle, the event and the difficulty setting
