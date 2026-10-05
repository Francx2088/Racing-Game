# 🏁 Turbo Racing

An arcade 3D racing game built with [three.js](https://threejs.org/) — **10 tracks, 4 cars, endless paint jobs**.
Made to run in the browser (desktop + mobile) and to be packaged later as a **YouTube Playable**.

## Play it

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build (static files in `dist/`, relative paths so it can be hosted anywhere):

```bash
npm run build
npm run preview    # http://localhost:4173
```

### Controls

| | Keyboard | Touch |
|---|---|---|
| Steer | ← → / A D | slide over the ◀ ▶ pad |
| Gas | ↑ / W | automatic |
| Brake / reverse | ↓ / S | BRAKE |
| **Drift** (hold in a corner) | Space | DRIFT |
| **Nitro** | Shift / N | NITRO |
| Pause | Esc / P | ❚❚ |
| Reset to track | R | – |

Gamepad is supported too (left stick, RT/A gas, LT/B brake, X drift, Y nitro).

### What makes it addictive

* **Start last, fight to the front** – you start on the back row of a 6-car grid every race.
* **Drift mini-turbos** – hold drift through a corner, release for a blue → orange → purple boost.
* **Perfect start** – hit the gas as the countdown reaches `1`.
* **Boost pads, nitro cells, coins, jumps/ramps** and surface hazards (ice, mud, oil, sand, syrup, moon dust…).
* **Progression** – podium stars unlock the next track, coins unlock the 4 cars and the paint shop.
* Rubber-banding AI that gets sharper every level (0.80 → 1.02 of your top speed).

## The 10 sky worlds

Every track is a road **floating in the sky** — a concrete box-girder deck on pylons that vanish into the clouds, with crash barriers, lamp posts and real-time shadows.

| # | Track | Atmosphere |
|---|---|---|
| 1 | Sunset Summit | golden hour, glowing sea of clouds, floating grass islands |
| 2 | Alpine Ridge | clear noon, weaving between snow-capped peaks, ice patches |
| 3 | Thunderhead | storm front: dark cumulonimbus, lightning, rain, wet reflective road |
| 4 | Midnight Metropolis | night, skyscrapers glowing below the clouds, neon signs, glass barriers |
| 5 | Aurora Drift | polar night, aurora, floating icebergs, snowfall |
| 6 | Ember Skies | volcanic sunset, lava glowing through the clouds, drifting embers |
| 7 | Paradise Isles | tropical floating islands with palms and waterfalls |
| 8 | Stratosphere | edge of space, curved Earth with atmosphere rim, satellites, low gravity |
| 9 | Sandstone Spires | dawn over floating sandstone spires and desert far below |
| 10 | Cloud Kingdom | god rays, rainbow, marble ruins, golden rings |

### How it looks realistic
* **Physically based sky** (Preetham/Rayleigh-Mie scattering) per level, and the *same sky is baked into the reflection map*, so cars, glass and wet asphalt reflect the real sky of that level.
* Animated, sun-lit **cloud seas** (two layers, parallax) + instanced cumulus + fast **cloud wisps** streaming past for speed.
* **PBR asphalt** generated procedurally (grain, tyre-wear lanes with different roughness, seams, cracks, skid marks, worn paint) with normal + roughness maps.
* Real-time **shadow maps** that follow the player, HDR **bloom** and filmic tone mapping, headlight beams at night/storms.

## One set of cars, endless looks

`public/cars/*.glb` are the four car models (Draco-compressed GLB). `src/cars.js` turns each model into any number of different cars:

* a **shader livery** recolours the baked paint texture (keeping decals/shading) with two colours and one of 7 **patterns**
  (twin stripes, fat stripe, rocker two-tone, diagonal split, rear fade, roof two-tone, solid),
* random **finish** (gloss / metallic / matte) and clear-coat,
* coloured **underglow**, accent-coloured rims and a slight random **body proportion** change,
* wheels spin and the front wheels steer on all four models.

Opponents get a fresh, unique livery each race; the player picks one of 14 paints in the garage (or the 🎲 button).

## Code map

```
src/main.js       boot, input, game loop, camera, effects, race flow, save data
src/race.js       arcade physics, drift/boost, AI drivers, laps, pickups, standings (no rendering)
src/levels.js     the 10 track layouts + gameplay tuning
src/track.js      spline sampling, banking, nearest-point queries, procedural pickups/hazards
src/trackmesh.js  road, deck, barriers, lamps, pylons, start gantry, pads, ramps, coins, obstacles
src/sky.js        cloud sea shader, cumulus, rock islands, mountain peaks, PBR asphalt textures
src/themes.js     sky, clouds, lighting, road look, scenery & weather for each level
src/world.js      builds a complete level scene
src/cars.js       model loading, wheel rigs, livery shader
src/fx.js         particles + weather
src/audio.js      procedural engine / SFX / music (WebAudio, no audio files)
src/ui.js         menus, HUD, touch controls
src/platform.js   host adapter (save data, score, pause/resume) — the only file a YouTube Playables build needs to touch
```

### Debug URL flags

`?level=N` jump into track N (0-9) · `?unlock=1` unlock everything · `?auto=1` let the AI drive you · `?laps=1` · `?touch=1` force touch UI · `?fps` show fps · `?nofx` disable bloom/shadows.

## YouTube Playables

The game is intentionally SDK-free for now: every host interaction goes through `src/platform.js`
(`firstFrameReady`, `gameReady`, `loadSave`/`saveData`, `sendScore`, `onPause`/`onResume`, audio toggle).
Adding the [YouTube Playables SDK](https://developers.google.com/youtube/gaming/playables/reference/sdk) means wiring those functions to `ytgame.*`.
The game already follows the Playables rules: no network requests, no CDN assets, audio only after a user gesture, storage wrapped in try/catch.
