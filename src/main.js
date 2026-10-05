import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import platform from './platform.js';
import audio from './audio.js';
import { CARS, PAINTS, loadCar, buildCar, makeLivery } from './cars.js';
import { LEVELS } from './levels.js';
import THEMES from './themes.js';
import { buildWorld } from './world.js';
import { Race } from './race.js';
import { Particles } from './fx.js';
import { UI } from './ui.js';
import { rng, clamp, lerp, wrapAngle, fmtTime, smooth } from './util.js';
import { canvasTex } from './kit.js';

const params = new URLSearchParams(location.search);
const DEBUG = { level: params.get('level'), auto: params.has('auto'), unlock: params.has('unlock'), fps: params.has('fps'), laps: params.get('laps'), touch: params.has('touch'), nofx: params.has('nofx'), paint: params.get('paint') };

// ------------------------------------------------------------------ save data
const defaultSave = () => ({ v: 1, coins: 0, cars: { gr86: true }, car: 'gr86', paints: {}, levels: {}, sfx: true, music: true, runs: 0 });
let save = Object.assign(defaultSave(), platform.loadSave() || {});
if (DEBUG.unlock) { save.cars = Object.fromEntries(CARS.map((c) => [c.id, true])); save.coins = Math.max(save.coins, 5000); LEVELS.forEach((L) => (save.levels[L.id] = Object.assign({ stars: 1 }, save.levels[L.id]))); }
const persist = () => platform.saveData(save);
const isUnlocked = (i) => i === 0 || (save.levels[LEVELS[i - 1].id]?.stars || 0) >= 1;
const nextLevelIndex = () => { let i = 0; while (i < LEVELS.length - 1 && (save.levels[LEVELS[i].id]?.stars || 0) >= 1) i++; return i; };
audio.musicOn = save.music; audio.sfxOn = save.sfx; audio.enabled = save.music || save.sfx;

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !DEBUG.nofx; renderer.shadowMap.type = THREE.PCFShadowMap;
// post-processing: HDR scene -> bloom -> tone mapping (the sun, neon and lights glow like on a real camera)
let composer = null, renderPass = null, bloom = null, fxOn = !DEBUG.nofx;
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
const MAXPR = pixelRatio;
function resize() { renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false); if (composer) { composer.setPixelRatio(pixelRatio); composer.setSize(innerWidth, innerHeight); } const fx = document.getElementById('fxlines'); fx.width = innerWidth / 2; fx.height = innerHeight / 2; for (const c of cameras) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); } }
const raceCam = new THREE.PerspectiveCamera(62, 1, 0.3, 4000), garageCam = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
const cameras = [raceCam, garageCam];
addEventListener('resize', resize); resize();
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
function initComposer() {
  if (composer || DEBUG.nofx) return;
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt); composer.setPixelRatio(pixelRatio); composer.setSize(innerWidth, innerHeight);
  renderPass = new RenderPass(new THREE.Scene(), raceCam); composer.addPass(renderPass);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.45, 1.6); composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

// ------------------------------------------------------------------ UI
const ui = new UI(document.getElementById('ui'), {
  play: () => { audio.unlock(); audio.click(); startRace(nextLevelIndex()); },
  garage: () => { audio.click(); openGarage(); },
  levels: () => { audio.click(); openLevels(); },
  back: () => { audio.click(); openTitle(); },
  race: (i) => { audio.click(); startRace(i); },
  garageCar: (d) => { audio.click(); gIdx = (gIdx + d + CARS.length) % CARS.length; refreshGarage(); },
  garagePaint: (i) => { audio.click(); const R = rng(Date.now()); gPaint = i < 0 ? R.int(1, PAINTS.length - 1) : i; save.paints[CARS[gIdx].id] = gPaint; persist(); refreshGarage(); },
  garageSelect: () => { audio.click(); save.car = CARS[gIdx].id; persist(); refreshGarage(); },
  garageBuy: () => { const d = CARS[gIdx]; if (save.coins >= d.price) { save.coins -= d.price; save.cars[d.id] = true; save.car = d.id; persist(); audio.unlock_(); ui.confetti(); refreshGarage(); } },
  isUnlocked,
  pause: () => pauseRace(), resume: () => resumeRace(),
  restart: () => { audio.click(); startRace(S ? S.levelIndex : nextLevelIndex()); },
  quit: () => { audio.click(); endRace(); openTitle(); },
  next: () => { audio.click(); startRace(Math.min(LEVELS.length - 1, S.levelIndex + 1)); },
  toggleSound: () => { const on = !(save.sfx || save.music); save.sfx = save.music = on; audio.setEnabled(on); audio.setSfx(on); audio.setMusic(on); persist(); openTitle(); },
  toggleMusic: () => { save.music = !save.music; audio.setMusic(save.music); persist(); },
  toggleSfx: () => { save.sfx = !save.sfx; audio.setSfx(save.sfx); persist(); },
});
if (DEBUG.touch) { ui.isTouch = true; document.body.classList.add('is-touch'); }
addEventListener('touchstart', () => { if (!ui.isTouch) { ui.isTouch = true; document.body.classList.add('is-touch'); } }, { once: true, passive: true });
const toast = (t, c) => ui.toast(t, c);

// ------------------------------------------------------------------ garage / menu scene
const garage = (() => {
  const scene = new THREE.Scene();
  const bg = canvasTex(8, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0b0430'); gr.addColorStop(0.55, '#3a0e72'); gr.addColorStop(1, '#ff2bd6'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  scene.background = bg; scene.environment = env; scene.fog = new THREE.Fog(0x1a0840, 14, 40);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x0c0624, metalness: 0.5, roughness: 0.45, envMapIntensity: 0.3 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const turn = new THREE.Group(); scene.add(turn);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.2, 48), new THREE.MeshStandardMaterial({ color: 0x1b1240, metalness: 0.8, roughness: 0.3 })); disc.position.y = -0.1; turn.add(disc);
  const rings = [0x00e5ff, 0xff2bd6].map((c, i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(3.7 + i * 0.5, 0.05, 6, 64), new THREE.MeshBasicMaterial({ color: c })); m.rotation.x = Math.PI / 2; m.position.y = 0.02 + i * 0.01; scene.add(m); return m; });
  scene.add(new THREE.HemisphereLight(0xaaccff, 0x442266, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 6, 5); scene.add(key);
  const l1 = new THREE.PointLight(0x00e5ff, 40, 20); l1.position.set(-5, 2, 3); scene.add(l1);
  const l2 = new THREE.PointLight(0xff2bd6, 40, 20); l2.position.set(5, 2, -3); scene.add(l2);
  // floating motes
  const n = 160, pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 24, Math.random() * 8, (Math.random() - 0.5) * 24], i * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.12, color: 0xffd6f8, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(motes);
  let car = null, t = 0;
  return {
    scene, cam: garageCam,
    async setCar(def, livery) {
      const tpl = await loadCar(def); if (car) turn.remove(car.root);
      car = buildCar(tpl, livery); car.root.rotation.y = 0.6; turn.add(car.root); car.shadow.visible = false; this.car = car;
    },
    update(dt, mode) {
      t += dt; turn.rotation.y += dt * 0.5; rings[0].rotation.z = t * 0.3;
      const aspect = innerWidth / innerHeight, portrait = aspect < 1; const dist = Math.max(8.6, 5.8 / (0.65 * aspect));
      const cy = mode === 'garage' ? 1.35 : 1.0;
      garageCam.position.set(Math.sin(t * 0.25) * 1.2, 1.9 + (portrait ? 0.6 : 0), dist);
      garageCam.lookAt(0, mode === 'garage' ? 0.1 : 0.55, 0);
      garageCam.setViewOffset(innerWidth, innerHeight, 0, mode === 'garage' ? innerHeight * 0.06 : innerHeight * 0.02, innerWidth, innerHeight);
      if (car) car.spin(dt * 3);
      motes.rotation.y += dt * 0.02;
    },
  };
})();
let gIdx = 0, gPaint = 0;
const paintFor = (def) => save.paints[def.id] ?? 0;
const liveryFor = (def, idx) => makeLivery(rng(1), PAINTS[idx]);
function refreshGarage() { const def = CARS[gIdx]; gPaint = paintFor(def); garage.setCar(def, liveryFor(def, gPaint)); ui.renderGarage(save, gIdx, gPaint); }
function openTitle() { mode = 'menu'; menuMode = 'title'; const def = CARS.find((c) => c.id === save.car) || CARS[0]; garage.setCar(def, liveryFor(def, paintFor(def))); ui.renderTitle(save, nextLevelIndex()); ui.show('title'); audio.stopMusic(); audio.playMusic({ root: 130.8, scale: 'minor', bpm: 110 }); platform.gameReady(); }
function openGarage() { menuMode = 'garage'; gIdx = Math.max(0, CARS.findIndex((c) => c.id === save.car)); refreshGarage(); ui.show('garage'); }
function openLevels() { menuMode = 'levels'; ui.renderLevels(save); ui.show('levels'); }

// ------------------------------------------------------------------ input
const keys = new Set();
addEventListener('keydown', (e) => {
  audio.unlock();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys.add(e.code);
  if ((e.code === 'Escape' || e.code === 'KeyP') && mode === 'race') { if (S && !S.over) (S.paused ? resumeRace() : pauseRace()); }
  if (e.code === 'KeyR' && mode === 'race' && S && !S.paused && S.race.state === 'racing') S.race._recover(S.race.player);
  if ((e.code === 'Enter' || e.code === 'Space') && mode === 'menu' && menuMode === 'title') ui.h.play();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('pointerdown', () => audio.unlock());
let steerState = 0;
function readInput(dt) {
  const k = (c) => keys.has(c);
  let target = 0, throttle = 0, brake = 0, drift = false, nitro = false;
  if (k('ArrowLeft') || k('KeyA')) target -= 1; if (k('ArrowRight') || k('KeyD')) target += 1;
  if (k('ArrowUp') || k('KeyW')) throttle = 1; if (k('ArrowDown') || k('KeyS')) brake = 1;
  if (k('Space')) drift = true; if (k('ShiftLeft') || k('ShiftRight') || k('KeyN') || k('KeyX')) nitro = true;
  // gamepad
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
  if (gp) {
    const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.12) target = ax;
    if (gp.buttons[7]?.value > 0.1) throttle = gp.buttons[7].value; if (gp.buttons[0]?.pressed) throttle = 1;
    if (gp.buttons[6]?.value > 0.1) brake = gp.buttons[6].value; if (gp.buttons[1]?.pressed) brake = 1;
    if (gp.buttons[2]?.pressed || gp.buttons[5]?.pressed) drift = true; if (gp.buttons[3]?.pressed || gp.buttons[4]?.pressed) nitro = true;
  }
  const t = ui.touch;
  if (ui.isTouch) {
    if (t.left) target -= 1; if (t.right) target += 1;
    const counting = S && S.race.state === 'countdown';
    if (t.brake) { brake = 1; throttle = 0; }
    else if (counting) throttle = (t.left || t.right || t.nitro || t.drift) ? 1 : 0;   // touch: any press = gas, for the perfect start
    else if (throttle === 0 && !keys.size && !gp) throttle = 1;
    if (t.drift) drift = true; if (t.nitro) nitro = true;
  }
  target = clamp(target, -1, 1);
  const rate = Math.abs(target) > Math.abs(steerState) ? 7 : 11;
  steerState += clamp(target - steerState, -rate * dt, rate * dt);
  return { steer: steerState, throttle, brake, drift, nitro };
}

// ------------------------------------------------------------------ race session
let mode = 'loading', menuMode = 'title', S = null;
const NAMES = ['Blaze', 'Nova', 'Viper', 'Rocket', 'Comet', 'Ghost', 'Zephyr', 'Maverick', 'Phantom', 'Storm', 'Drift King', 'Turbo T', 'Neon', 'Apex', 'Bolt'];
let sparks, smoke, flames, dust;
const CONTROLS_HINT = () => (ui.isTouch ? 'Hold <b>◀ ▶</b> to steer · hold <b>DRIFT</b> in corners · <b>NITRO</b> to boost' : '<b>←→</b> steer · <b>↑</b> gas · <b>↓</b> brake · hold <b>SPACE</b> in corners to drift · <b>SHIFT</b> nitro');

async function startRace(levelIndex) {
  endRace();
  ui.showBusy(`Loading ${LEVELS[levelIndex].name}…`); ui.show('none'); mode = 'loading';
  await new Promise((r) => setTimeout(r, 30));
  const L = { ...LEVELS[levelIndex] }; if (DEBUG.laps) L.laps = +DEBUG.laps;
  const world = buildWorld(L, renderer);
  const th = world.th;
  renderer.toneMappingExposure = th.exposure ?? 0.6; initComposer(); if (bloom) { bloom.strength = th.night ? 0.55 : 0.28; bloom.threshold = th.night ? 0.9 : 3.2; }
  // particles
  sparks = new Particles(world.scene, 700, true); smoke = new Particles(world.scene, 600, false); flames = new Particles(world.scene, 700, true); dust = new Particles(world.scene, 500, false);
  save.runs++;
  const R = rng(L.seed * 31 + save.runs * 7);
  const pdef = CARS.find((c) => c.id === save.car) || CARS[0];
  const total = 6;
  const names = [...NAMES]; for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  const pPaint = DEBUG.paint != null ? +DEBUG.paint : paintFor(pdef);
  const setups = [];
  const used = new Set();
  for (let i = 0; i < total - 1; i++) {
    const def = CARS[(i + Math.floor(R() * 4)) % 4];
    let liv; do { liv = makeLivery(R); } while (used.has(liv.tint.getHex()));
    used.add(liv.tint.getHex());
    const skill = (65 * L.ai * (0.95 + R() * 0.08)) / def.phys.vmax;
    setups.push({ id: 'ai' + i, name: names[i], def, isPlayer: false, skill, lane: R.range(-0.8, 0.8), livery: liv, color: liv.tint.getHex() });
  }
  const plivery = liveryFor(pdef, pPaint);
  setups.splice(total - 1 - Math.floor(R() * 2), 0, { id: 'me', name: 'YOU', def: pdef, isPlayer: true, livery: plivery, color: 0xffffff, lane: 0 });
  // visuals
  const tpls = {}; for (const d of CARS) tpls[d.id] = await loadCar(d);
  const visuals = new Map();
  for (const s of setups) {
    const v = buildCar(tpls[s.def.id], s.livery); v.tpl = tpls[s.def.id]; v.root.rotation.order = 'YXZ'; world.scene.add(v.root); visuals.set(s.id, v);
  }
  const cb = makeCallbacks();
  const race = new Race(world, setups, cb);
  S = { world, race, visuals, levelIndex, paused: false, over: false, t: 0, shake: 0, hit: 0, boostFx: 0, cam: { h: race.player.h, pos: new THREE.Vector3(), fov: 62, init: false, hint: -1, q: {} }, hintT: 0, finishT: 0, th, bestToast: false, lastWrong: 0, wrongT: 0, setups, startHint: true };
  syncVisuals(0); updateCamera(0.016, true);
  ui.initHud(world.track, total, L.laps, race.cars);
  ui.show('hud'); ui.hideLoading(); mode = 'race';
  audio.stopMusic(); audio.playMusic(th.bgm);
  resize();
}
function endRace() {
  if (!S) return;
  S.world.dispose(); S = null; audio.engine(0, 0, false, false); audio.skid(0);
  document.getElementById('vignette').className = '';
  const fx = document.getElementById('fxlines').getContext('2d'); fx.clearRect(0, 0, 9999, 9999);
}
function pauseRace() { if (!S || S.paused || S.over) return; S.paused = true; ui.showPause(save); audio.engine(0, 0, false, false); audio.skid(0); }
function resumeRace() { if (!S) return; S.paused = false; ui.hidePause(); }
platform.onPause(() => { if (mode === 'race') pauseRace(); audio.pause(); });
platform.onResume(() => audio.resume());

function makeCallbacks() {
  const mine = (c) => c.isPlayer;
  const pos = (c) => new THREE.Vector3(c.x, c.y + 0.6, c.z);
  return {
    onCountdown: (n) => {
      ui.setMsg(n > 0 ? String(n) : 'GO!', n > 0 ? '' : 'go'); audio.beep(n === 0);
      if (n === 3) ui.setHint(ui.isTouch ? 'Tap a button as the countdown hits <b>1</b> for a <b>PERFECT START</b>' : 'Tap <b>↑</b> as the countdown hits <b>1</b> for a <b>PERFECT START</b>');
      if (n === 0) { setTimeout(() => ui.setMsg(''), 900); ui.setHint(CONTROLS_HINT()); }
    },
    onPerfectStart: () => { toast('PERFECT START!', 'cyan'); audio.boost(); S.boostFx = 1; },
    onLap: (c, li, lt, best) => {
      if (!mine(c)) return;
      if (li < S.race.laps) { toast(`LAP ${li}/${S.race.laps}  ${fmtTime(lt)}`, 'gold'); audio.lap(); if (li === S.race.laps - 1) setTimeout(() => toast('FINAL LAP!', 'pink'), 700); }
      if (best && li > 1) setTimeout(() => toast('BEST LAP!', 'green'), 500);
    },
    onFinish: (c) => {
      if (!mine(c)) return;
      ui.setMsg('FINISH!', 'go'); audio.finish(c.place <= 3); S.finishT = 0.001; S.race.player.cruise = true; ui.setHint('');
    },
    onWall: (c, vn, sg) => {
      if (!mine(c)) return;
      S.shake = Math.max(S.shake, clamp(vn / 12, 0.1, 0.6)); audio.scrape(); if (vn > 10) { audio.bump(vn); flash('hit'); }
      for (let i = 0; i < 8; i++) sparks.emit(c.x, c.y + 0.5, c.z, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 0.4, 0.2, 1, 0.8, 0.3, 1, 0, 0, 12);
    },
    onBump: (a, b, v) => { if (mine(a) || mine(b)) { S.shake = Math.max(S.shake, clamp(v / 14, 0.1, 0.45)); audio.bump(v); const c = mine(a) ? a : b; for (let i = 0; i < 6; i++) sparks.emit((a.x + b.x) / 2, a.y + 0.6, (a.z + b.z) / 2, (Math.random() - 0.5) * 7, Math.random() * 4, (Math.random() - 0.5) * 7, 0.35, 0.2, 1, 0.9, 0.4, 1, 0, 0, 12); } },
    onObstacle: (c, k, o) => {
      S.world.tm.hideObstacle(k);
      const p = S.world.track.pointAt(o.s, o.d);
      for (let i = 0; i < 14; i++) smoke.emit(p.x, p.y + 0.6, p.z, (Math.random() - 0.5) * 12, Math.random() * 8, (Math.random() - 0.5) * 12, 0.7, 1.2, 1, 0.8, 0.5, 0.8, 3, 0, 14);
      if (mine(c)) { S.shake = Math.max(S.shake, 0.5); audio.bump(10); flash('hit'); }
    },
    onCoin: (c, i) => { audio.coin(); const p = S.world.track.pointAt(S.world.track.coins[i].s, S.world.track.coins[i].d); for (let k = 0; k < 6; k++) sparks.emit(p.x, p.y + 1.2, p.z, (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, 0.5, 0.25, 1, 0.85, 0.2, 1, 0, 2, 4); },
    onNitro: (c, i) => { audio.nitroPickup(); toast('+NITRO', 'cyan'); },
    onPad: (c) => { if (mine(c)) { audio.pad(); flash('boost', 900); S.shake = Math.max(S.shake, 0.18); toast('SPEED BOOST!', 'cyan'); } },
    onDriftStart: (c) => { },
    onDriftLevel: (c, l) => { if (mine(c)) audio.driftLevel(l); },
    onDriftBoost: (c, l) => { if (mine(c)) { audio.boost(); flash('boost', 600); toast(['', 'MINI TURBO', 'SUPER TURBO!', 'ULTRA TURBO!!'][l], ['', 'cyan', 'gold', 'pink'][l]); S.shake = Math.max(S.shake, 0.25); } },
    onLaunch: (c) => { },
    onLand: (c, v) => { if (mine(c)) { S.shake = Math.max(S.shake, clamp(v / 25, 0.15, 0.55)); audio.land(); } for (let i = 0; i < 12; i++) dust.emit(c.x + (Math.random() - 0.5) * 2, c.y + 0.2, c.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 8, Math.random() * 3, (Math.random() - 0.5) * 8, 0.8, 1.4, 0.8, 0.75, 0.65, 0.7, 4, 3, 6); },
    onOvertake: (p) => { if (S.race.state !== 'racing') return; audio.overtake(); toast(p === 1 ? "YOU'RE IN THE LEAD!" : `OVERTAKE!  P${p}`, 'green'); },
    onRecover: (c) => { if (mine(c)) toast('BACK ON TRACK', 'red'); },
  };
}
let flashTO = 0;
function flash(cls, ms = 350) { const v = document.getElementById('vignette'); v.className = cls; clearTimeout(flashTO); flashTO = setTimeout(() => (v.className = ''), ms); }

// ------------------------------------------------------------------ per-frame race helpers
const tmpV = new THREE.Vector3(), tmpE = new THREE.Euler();
function syncVisuals(dt) {
  const { race, visuals } = S;
  const sp = S.race.player;
  for (const c of race.cars) {
    const v = visuals.get(c.id), r = v.root;
    r.position.set(c.x, c.y, c.z);
    r.rotation.set(-c.pitch, c.h, -c.roll + c.lean * 0.6, 'YXZ');
    v.body.rotation.y = c.slip * 0.55 * (c.drifting ? 1.2 : 0.6);
    v.body.position.y = c.airborne ? 0 : Math.sin(S.t * 55 + c.grid * 3) * 0.006 * clamp(Math.abs(c.speed) / 40, 0, 1);
    v.spin(c.speed * dt); v.setSteer(c.steerState);
    const braking = c.isPlayer ? c.input.brake > 0 : false;
    v.tail.material.opacity = braking ? 0.9 : 0.25; v.setBeam(S.th.night ? 0.9 : S.th.road.wet ? 0.6 : 0.12);
    const glowBoost = (c.boostT > 0 || c.nitroOn) ? 1 : 0;
    v.glow.material.opacity = lerp(v.glow.material.opacity, (S.th.night ? 0.35 : 0.1) + glowBoost * 0.4 + (c.drifting ? 0.25 : 0), 1 - Math.exp(-10 * dt));
  }
}
const _wp = new THREE.Vector3();
function emitFx(dt) {
  const { race, visuals } = S;
  for (const c of race.cars) {
    const v = visuals.get(c.id); const near = c.isPlayer || Math.hypot(c.x - race.player.x, c.z - race.player.z) < 80; if (!near) continue;
    v.root.updateMatrixWorld(true);
    const hx = v.tpl.half.x * 0.78, hz = v.tpl.half.z * 0.72;
    const back = [[-hx, 0.25, -hz], [hx, 0.25, -hz]];
    const fwd = [Math.sin(c.h), Math.cos(c.h)];
    if (c.drifting) {
      const lv = c.driftLevel; const col = lv >= 3 ? [0.75, 0.35, 1] : lv === 2 ? [1, 0.6, 0.12] : lv === 1 ? [0.23, 0.63, 1] : [1, 1, 0.8];
      for (const b of back) { _wp.set(...b).applyMatrix4(v.root.matrixWorld); for (let i = 0; i < 2; i++) sparks.emit(_wp.x, _wp.y, _wp.z, (Math.random() - 0.5) * 5 - fwd[0] * 5, Math.random() * 3 + 1, (Math.random() - 0.5) * 5 - fwd[1] * 5, 0.35, 0.2, col[0], col[1], col[2], 1, 0, 0, 9); smoke.emit(_wp.x, _wp.y, _wp.z, (Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2, 0.8, 1.0, 0.9, 0.9, 0.95, 0.35, 2.4, 1, 0); }
    } else if (Math.abs(c.slip) > 0.22 && c.speed > 18 && c.onRoad && !c.airborne) {
      for (const b of back) { _wp.set(...b).applyMatrix4(v.root.matrixWorld); smoke.emit(_wp.x, _wp.y, _wp.z, (Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2, 0.7, 0.8, 0.9, 0.9, 0.95, 0.28, 2, 1, 0); }
    }
    if (c.boostT > 0 || c.nitroOn) {
      for (const sx of [-0.35, 0.35]) { _wp.set(sx * hx * 1.2, 0.35, -hz * 1.35).applyMatrix4(v.root.matrixWorld); flames.emit(_wp.x, _wp.y, _wp.z, -fwd[0] * 14 + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5, -fwd[1] * 14 + (Math.random() - 0.5) * 2, 0.26, 0.9, c.nitroOn ? 0.3 : 1, c.nitroOn ? 0.75 : 0.55, 1, 0.9, -2.2, 0, 0); }
    }
    if (!c.onRoad && c.surface !== 'ice' && c.speed > 12 && !c.airborne) {
      const th = S.th.road.shoulder;
      for (const b of back) { _wp.set(...b).applyMatrix4(v.root.matrixWorld); const k = new THREE.Color(th); dust.emit(_wp.x, _wp.y, _wp.z, (Math.random() - 0.5) * 3, 1.2, (Math.random() - 0.5) * 3, 0.7, 0.9, k.r * 1.1, k.g * 1.1, k.b * 1.1, 0.55, 2.6, 1, 0); }
    }
  }
}

function updateCamera(dt, snap = false) {
  const { race, cam, world } = S, c = race.player;
  const sp01 = clamp(Math.abs(c.speed) / 70, 0, 1.2);
  const boosting = c.boostT > 0 || c.nitroOn;
  const vh = Math.hypot(c.vx, c.vz) > 6 ? Math.atan2(c.vx, c.vz) : c.h;
  const th = c.h + wrapAngle(vh - c.h) * 0.45;
  cam.h += wrapAngle(th - cam.h) * (snap ? 1 : 1 - Math.exp(-5.5 * dt));
  const dist = 6.6 + sp01 * 1.8 + (boosting ? 1.0 : 0), height = 2.5 + sp01 * 0.5;
  const dx = Math.sin(cam.h), dz = Math.cos(cam.h);
  let ex = c.x - dx * dist, ez = c.z - dz * dist, ey = c.y + height;
  // keep above ground
  const tq = world.track.query(ex, ez, cam.hint, cam.q); cam.hint = tq.i0;
  const gy = Math.abs(tq.d) < world.track.wallD + 3 ? Math.max(tq.surfaceY, world.heightAt(ex, ez)) : world.heightAt(ex, ez);
  ey = Math.max(ey, gy + 1.3);
  const k = snap ? 1 : 1 - Math.exp(-14 * dt);
  cam.pos.x = lerp(cam.pos.x, ex, k); cam.pos.z = lerp(cam.pos.z, ez, k); cam.pos.y = lerp(cam.pos.y, ey, snap ? 1 : 1 - Math.exp(-9 * dt));
  const sh = S.shake;
  raceCam.position.set(cam.pos.x + (Math.random() - 0.5) * sh * 0.7, cam.pos.y + (Math.random() - 0.5) * sh * 0.5, cam.pos.z + (Math.random() - 0.5) * sh * 0.7);
  const ahead = 5 + sp01 * 4;
  raceCam.lookAt(c.x + Math.sin(c.h) * ahead * 0.5 + dx * ahead * 0.5, c.y + 1.3 + c.pitch * 3, c.z + Math.cos(c.h) * ahead * 0.5 + dz * ahead * 0.5);
  const tf = 60 + sp01 * 12 + (boosting ? 14 : 0);
  cam.fov = lerp(cam.fov, tf, snap ? 1 : 1 - Math.exp(-5 * dt));
  if (Math.abs(raceCam.fov - cam.fov) > 0.05) { raceCam.fov = cam.fov; raceCam.updateProjectionMatrix(); }
}

const linesCtx = document.getElementById('fxlines').getContext('2d');
function speedLines(intensity, t) {
  const cv = linesCtx.canvas, w = cv.width, h = cv.height;
  linesCtx.clearRect(0, 0, w, h);
  if (intensity < 0.05) return;
  linesCtx.strokeStyle = `rgba(255,255,255,${0.18 * intensity})`; linesCtx.lineWidth = 1.5;
  const n = Math.floor(26 * intensity) + 6; const cx = w / 2, cy = h * 0.46;
  linesCtx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = ((i * 137.5 + Math.floor(t * 20) * 53) % 360) * Math.PI / 180, r0 = (0.32 + ((i * 7919) % 100) / 400) * Math.min(w, h), r1 = r0 + (0.16 + intensity * 0.3) * Math.min(w, h);
    linesCtx.moveTo(cx + Math.cos(a) * r0 * 1.3, cy + Math.sin(a) * r0); linesCtx.lineTo(cx + Math.cos(a) * r1 * 1.3, cy + Math.sin(a) * r1);
  }
  linesCtx.stroke();
}

function finishRace() {
  const { race, levelIndex } = S, L = LEVELS[levelIndex], p = race.player;
  S.over = true;
  // let the remaining drivers finish off-screen so the results table has real times
  for (let i = 0; i < 90 * 60 && !race.cars.every((c) => c.finished); i++) race.update(1 / 60, { steer: 0, throttle: 0, brake: 0, drift: false, nitro: false });
  const place = p.place, stars = place === 1 ? 3 : place === 2 ? 2 : place === 3 ? 1 : 0;
  const bonus = [0, 300, 200, 140, 90, 60, 40][place] || 40, scale = 1 + levelIndex * 0.15;
  const rewards = [[`Finish position (${place}${['th', 'st', 'nd', 'rd'][place < 4 ? place : 0]})`, '+' + Math.round(bonus * scale)], [`Coins collected (${race.stats.coins})`, '+' + race.stats.coins * 5], [`Overtakes (${race.stats.overtakes})`, '+' + Math.min(race.stats.overtakes, 12) * 4], [`Drift turbos (${race.stats.drifts})`, '+' + Math.min(race.stats.drifts, 10) * 6]];
  let total = Math.round(bonus * scale) + race.stats.coins * 5 + Math.min(race.stats.overtakes, 12) * 4 + Math.min(race.stats.drifts, 10) * 6;
  if (p.perfect) { rewards.push(['Perfect start', '+30']); total += 30; }
  const rec = save.levels[L.id] || (save.levels[L.id] = {});
  const wasLocked = levelIndex + 1 < LEVELS.length && !isUnlocked(levelIndex + 1);
  const newRecord = place <= 3 && (!rec.best || p.finishTime < rec.best);
  if (place <= 3 && (!rec.best || p.finishTime < rec.best)) rec.best = p.finishTime;
  rec.stars = Math.max(rec.stars || 0, stars);
  save.coins += total; persist();
  platform.sendScore(Math.round(save.coins + LEVELS.reduce((a, l, i) => a + (save.levels[l.id]?.stars || 0) * 100, 0)));
  const unlock = wasLocked && isUnlocked(levelIndex + 1) ? `Unlocked: ${LEVELS[levelIndex + 1].name}!` : (levelIndex + 1 < LEVELS.length && !isUnlocked(levelIndex + 1) ? 'Finish in the top 3 to unlock the next track' : (CARS.some((c) => !save.cars[c.id] && save.coins >= c.price) ? 'You can afford a new car in the Garage!' : ''));
  mode = 'results';
  ui.showResults({ level: L, place, stars, order: race.order, rewards, total, bestLap: p.bestLap, newRecord, unlock, hasNext: levelIndex + 1 < LEVELS.length && isUnlocked(levelIndex + 1) });
  audio.engine(0, 0, false, false); audio.skid(0);
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), fpsAcc = 0, fpsN = 0, slow = 0, fast = 0;
const fpsEl = DEBUG.fps ? Object.assign(document.body.appendChild(document.createElement('div')), { className: 'fps' }) : null;
let firstFrame = false;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  // adaptive resolution
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1.5) {
    const avg = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
    if (avg > 1 / 38) slow++; else slow = 0;
    if (avg < 1 / 57) fast++; else fast = 0;
    if (slow >= 2 && pixelRatio > 0.7) { pixelRatio = Math.max(0.7, pixelRatio * 0.85); if (pixelRatio < 0.9) { fxOn = false; renderer.shadowMap.enabled = false; } resize(); slow = 0; }
    else if (fast >= 6 && pixelRatio < MAXPR) { pixelRatio = Math.min(MAXPR, pixelRatio * 1.1); resize(); fast = 0; }
    if (fpsEl) fpsEl.textContent = `${(1 / avg).toFixed(0)} fps · pr ${pixelRatio.toFixed(2)} · calls ${renderer.info.render.calls}`;
  }

  if (mode === 'race' && S) {
    if (!S.paused) {
      S.t += dt;
      const race = S.race, p = race.player;
      let inp = readInput(dt);
      if (DEBUG.auto && !p.finished) inp = race._ai(p, dt);
      p.input = inp;
      race.update(dt, inp);
      syncVisuals(dt);
      emitFx(dt);
      // camera & shake decay
      S.shake = Math.max(0, S.shake - dt * 1.6);
      updateCamera(dt);
      S.world.update(dt, S.t, raceCam, S.race.player.pos3 || (S.race.player.pos3 = new THREE.Vector3()).set(S.race.player.x, S.race.player.y, S.race.player.z));
      sparks.update(dt, innerHeight * renderer.getPixelRatio() * 0.9); smoke.update(dt, innerHeight * renderer.getPixelRatio() * 0.9); flames.update(dt, innerHeight * renderer.getPixelRatio() * 0.9); dust.update(dt, innerHeight * renderer.getPixelRatio() * 0.9);
      // HUD
      const L = S.world.track.length;
      const wrongWay = race.state === 'racing' && !p.finished && Math.cos(wrapAngle(p.h - p.q.head)) < -0.3 && Math.abs(p.speed) > 8;
      ui.updateHud({
        pos: p.place, laps: race.laps, lap: Math.max(1, Math.min(race.laps, p.lapIdx + 1)), time: race.state === 'racing' || race.state === 'done' ? (p.finished ? p.finishTime : race.time) : 0,
        best: p.bestLap, coins: p.coins, speed: Math.abs(p.speed) * 3.6, nitro: p.nitro, drifting: p.drifting, driftLevel: p.driftLevel, wrongWay,
        board: race.order.slice(0, 6).map((c) => ({ name: c.name, place: c.place, me: c.isPlayer, color: '#' + new THREE.Color(c.color).getHexString() })),
        cars: race.cars.map((c) => ({ x: c.x, z: c.z, me: c.isPlayer, color: '#' + new THREE.Color(c.color).getHexString() })),
      });
      if (S.startHint && race.state === 'racing' && race.time > 6) { ui.setHint(''); S.startHint = false; }
      // audio
      const sp01 = clamp(Math.abs(p.speed) / (p.def.phys.vmax * 1.2), 0, 1.1);
      audio.engine(sp01, race.state === 'countdown' ? (p.input.throttle > 0 ? 0.8 : 0.1) : inp.throttle, p.boostT > 0 || p.nitroOn, true);
      audio.skid(p.drifting ? 0.9 : Math.abs(p.slip) > 0.25 && p.speed > 18 && p.onRoad ? clamp(Math.abs(p.slip) * 2, 0, 0.9) : 0);
      // speed lines
      speedLines(clamp((Math.abs(p.speed) / p.def.phys.vmax - 0.62) * 2.2, 0, 1) + (p.boostT > 0 || p.nitroOn ? 0.5 : 0), S.t);
      if (S.finishT > 0) { S.finishT += dt; if (S.finishT > 2.6 && !S.over) finishRace(); }
    }
    if (S.debugCam) { raceCam.position.set(...S.debugCam.pos); raceCam.lookAt(...S.debugCam.look); if (S.debugCam.fov) { raceCam.fov = S.debugCam.fov; raceCam.updateProjectionMatrix(); } }
    if (fxOn && composer) { renderPass.scene = S.world.scene; renderPass.camera = raceCam; composer.render(); } else renderer.render(S.world.scene, raceCam);
  } else if (mode === 'menu' || mode === 'results' || mode === 'loading') {
    if (mode === 'results' && S) { S.world.update(dt, (S.t += dt), raceCam, tmpV.set(S.race.player.x, S.race.player.y, S.race.player.z)); S.race.update(dt, { steer: 0, throttle: 0, brake: 0, drift: false, nitro: false }); syncVisuals(dt); updateCamera(dt); if (fxOn && composer) { renderPass.scene = S.world.scene; renderPass.camera = raceCam; composer.render(); } else renderer.render(S.world.scene, raceCam); }
    else { garage.update(dt, menuMode); renderer.render(garage.scene, garageCam); }
  }
  if (!firstFrame) { firstFrame = true; platform.firstFrameReady(); }
}

// ------------------------------------------------------------------ boot
async function boot() {
  await platform.init();
  ui.setLoading(0.1, 'Loading cars…');
  let done = 0;
  for (const d of CARS) { await loadCar(d); ui.setLoading(0.1 + (++done / CARS.length) * 0.8); }
  ui.setLoading(1, 'Ready!');
  mode = 'menu'; renderer.setAnimationLoop(frame);
  if (DEBUG.level != null) { ui.hideLoading(); startRace(clamp(+DEBUG.level, 0, LEVELS.length - 1)); return; }
  openTitle(); ui.hideLoading();
}
function fastForward(sec, { finish = false } = {}) {
  const race = S.race, p = race.player; let t = 0;
  while (t < sec) { const inp = race._ai(p, 1 / 60); p.input = inp; race.update(1 / 60, inp); t += 1 / 60; if (finish && p.finished) break; }
  syncVisuals(0); updateCamera(0.016, true);
}
function debugView(o) { S.debugCam = o; }
window.__game = { fastForward, debugView, get S() { return S; }, save, ui, startRace, CARS, LEVELS, renderer };
boot().catch((e) => { console.error(e); document.getElementById('loadtxt').textContent = 'Failed to load: ' + e.message; });
