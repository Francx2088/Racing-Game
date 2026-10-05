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

## The 10 tracks

| # | Track | Terrain / twist |
|---|---|---|
| 1 | Sunset Bay | beach causeway, palms, lighthouse, ocean |
| 2 | Dust Canyon | desert mesas, cacti, sand drifts, rock arches |
| 3 | Neon Grid | night city, right-angle blocks, rain, glowing walls, oil slicks |
| 4 | Frostbite Peak | snow, ice patches (almost no grip), aurora, snowfall |
| 5 | Jungle Twist | tight twisty muddy loop, giant trees, glowing mushrooms, fireflies |
| 6 | Magma Run | causeway over lava, spires, ember rain, volcano on the horizon |
| 7 | Sugar Rush | candy land: lollipops, donuts, cupcakes, syrup puddles, jumps |
| 8 | Lunar Leap | moon craters, **low gravity** big jumps, Earth in the sky |
| 9 | Highland Pass | autumn hills with big elevation changes, barns, fences, falling leaves |
| 10 | Rainbow Skyway | floating rainbow road above the clouds, banked turns, rings, islands |

Every level has its own layout, palette, fog, sky, terrain generator, scenery, weather, soundtrack scale and tempo.

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
src/trackmesh.js  road, kerbs, walls, start gantry, pads, ramps, coins, obstacles
src/terrain.js    heightfield that hugs the track
src/themes.js     palette, terrain, scenery & weather for each level
src/world.js      builds a complete level scene
src/cars.js       model loading, wheel rigs, livery shader
src/fx.js         particles + weather
src/audio.js      procedural engine / SFX / music (WebAudio, no audio files)
src/ui.js         menus, HUD, touch controls
src/platform.js   host adapter (save data, score, pause/resume) — the only file a YouTube Playables build needs to touch
```

### Debug URL flags

`?level=N` jump into track N (0-9) · `?unlock=1` unlock everything · `?auto=1` let the AI drive you · `?laps=1` · `?touch=1` force touch UI · `?fps` show fps.

## YouTube Playables

The game is intentionally SDK-free for now: every host interaction goes through `src/platform.js`
(`firstFrameReady`, `gameReady`, `loadSave`/`saveData`, `sendScore`, `onPause`/`onResume`, audio toggle).
Adding the [YouTube Playables SDK](https://developers.google.com/youtube/gaming/playables/reference/sdk) means wiring those functions to `ytgame.*`.
The game already follows the Playables rules: no network requests, no CDN assets, audio only after a user gesture, storage wrapped in try/catch.
