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
import { Track } from './track.js';
import { buildWorld } from './world.js';
import { Race } from './race.js';
import { Particles } from './fx.js';
import { UI } from './ui.js';
import { save, persist, isUnlocked, nextLevelIndex, carSetup, buyUpgrade, raceRewards } from './progress.js';
import { rng, clamp, lerp, wrapAngle, fmtTime } from './util.js';
import { canvasTex } from './kit.js';

const MENU_MUSIC = { root: 130.8, scale: 'minor', bpm: 112 };
const NAMES = ['Blaze', 'Nova', 'Viper', 'Rocket', 'Comet', 'Ghost', 'Zephyr', 'Maverick', 'Phantom', 'Storm', 'Kestrel', 'Apex', 'Bolt', 'Falcon', 'Rook'];
audio.musicOn = save.music; audio.sfxOn = save.sfx; audio.enabled = save.music || save.sfx;

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
const MAXPR = pixelRatio;
let composer = null, renderPass = null, bloom = null, fxOn = true;
const raceCam = new THREE.PerspectiveCamera(62, 1, 0.3, 4000), garageCam = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
function resize() {
  renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false);
  if (composer) { composer.setPixelRatio(pixelRatio); composer.setSize(innerWidth, innerHeight); }
  const fx = document.getElementById('fxlines'); fx.width = innerWidth / 2; fx.height = innerHeight / 2;
  for (const c of [raceCam, garageCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); }
}
addEventListener('resize', resize); resize();
const studioEnv = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
function initComposer() {
  if (composer) return;
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt); composer.setPixelRatio(pixelRatio); composer.setSize(innerWidth, innerHeight);
  renderPass = new RenderPass(new THREE.Scene(), raceCam); composer.addPass(renderPass);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.25, 0.45, 8); composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
function renderWorld(sess) {
  renderer.toneMappingExposure = sess.world.exposure ?? 0.5;
  if (fxOn && composer) { renderPass.scene = sess.world.scene; renderPass.camera = raceCam; composer.render(); }
  else renderer.render(sess.world.scene, raceCam);
}

// ------------------------------------------------------------------ UI wiring
let mode = 'boot', S = null, demo = null, trackIdx = 0, gIdx = 0, gTab = 'paint';
const ui = new UI(document.getElementById('ui'), {
  play: () => { audio.unlock(); audio.click(); startRace(trackIdx); },
  garage: () => { audio.click(); openGarage(); },
  tracks: () => { audio.click(); openTracks(); },
  home: () => { audio.click(); openHome(); },
  trackPick: (d) => { audio.click(); trackIdx = (trackIdx + d + LEVELS.length) % LEVELS.length; renderTracks(); queueDemo(trackIdx); },
  race: (i) => { audio.unlock(); audio.click(); startRace(i); },
  garageCar: (d) => { audio.click(); gIdx = (gIdx + d + CARS.length) % CARS.length; refreshGarage(true); },
  garageTab: (t) => { audio.click(); gTab = t; refreshGarage(false); },
  garagePaint: (i) => { audio.click(); save.paints[CARS[gIdx].id] = i; persist(); refreshGarage(true); },
  garageUpgrade: (id) => { if (buyUpgrade(CARS[gIdx].id, id)) { audio.unlock_(); ui.toast('Upgrade installed', 'g'); } refreshGarage(false); },
  garageSelect: () => { audio.click(); save.car = CARS[gIdx].id; persist(); refreshGarage(false); },
  garageBuy: () => { const d = CARS[gIdx]; if (save.coins >= d.price) { save.coins -= d.price; save.cars[d.id] = true; save.car = d.id; persist(); audio.unlock_(); refreshGarage(false); } },
  pause: () => pauseRace(), resume: () => resumeRace(),
  restart: () => { audio.click(); startRace(S ? S.levelIndex : trackIdx); },
  quit: () => { audio.click(); endRace(); openHome(); },
  next: () => { audio.click(); startRace(Math.min(LEVELS.length - 1, S.levelIndex + 1)); },
  toggleSound: () => { const on = !(save.sfx || save.music); save.sfx = save.music = on; audio.setEnabled(on); audio.setSfx(on); audio.setMusic(on); persist(); renderHome(); },
  toggleMusic: () => { save.music = !save.music; audio.setMusic(save.music); persist(); },
  toggleSfx: () => { save.sfx = !save.sfx; audio.setSfx(save.sfx); persist(); },
});
// a touch on a device we took for a desktop: switch to the on-screen controls that fit its size
addEventListener('touchstart', () => { if (ui.device === 'desktop') ui.setDevice(Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet'); }, { once: true, passive: true });
const toast = (t, c) => ui.toast(t, c);

// cheap per-track facts for the menus (course generation only, no meshes)
const trackInfo = [];
function infoFor(i) {
  if (!trackInfo[i]) { const t = new Track(LEVELS[i]); trackInfo[i] = { length: t.finishS - t.startS, jumps: t.gaps.length, checkpoints: t.checkpoints.length - 1, track: t }; }
  return trackInfo[i];
}
function routeSvg(t) {
  const b = t.bounds, w = b.maxX - b.minX, h = b.maxZ - b.minZ, S = 100 / Math.max(w, h), ox = (100 - w * S) / 2, oy = (100 - h * S) / 2;
  let d = ''; for (let i = 0; i < t.N; i += 6) d += (i ? 'L' : 'M') + (ox + (t.px[i] - b.minX) * S).toFixed(1) + ' ' + (oy + (t.pz[i] - b.minZ) * S).toFixed(1);
  const e = t.pointAt(t.finishS, 0), sx = ox + (t.px[0] - b.minX) * S, sy = oy + (t.pz[0] - b.minZ) * S;
  return `<svg class="route" viewBox="-4 -4 108 108"><path d="${d}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="5" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><circle cx="${sx}" cy="${sy}" r="3" fill="#3fe39c"/><circle cx="${ox + (e.x - b.minX) * S}" cy="${oy + (e.z - b.minZ) * S}" r="3" fill="#ffd60a"/></svg>`;
}

function renderHome() { ui.renderHome(save, trackIdx, infoFor(trackIdx)); }
function renderTracks() { ui.renderTracks(save, trackIdx, infoFor(trackIdx), isUnlocked(trackIdx)); }
function openHome() {
  mode = 'home'; trackIdx = clamp(trackIdx, 0, LEVELS.length - 1);
  renderHome(); ui.show('home'); queueDemo(trackIdx, 0);
  audio.stopMusic(); audio.playMusic(MENU_MUSIC); platform.gameReady();
}
function openTracks() { mode = 'tracks'; renderTracks(); ui.show('tracks'); }

// ------------------------------------------------------------------ garage (studio turntable)
const garage = (() => {
  const scene = new THREE.Scene();
  scene.background = canvasTex(8, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0a1530'); gr.addColorStop(0.6, '#16264d'); gr.addColorStop(1, '#2b3f6e'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  scene.environment = studioEnv; scene.fog = new THREE.Fog(0x16264d, 16, 44);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x0c1428, metalness: 0.6, roughness: 0.35 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const turn = new THREE.Group(); scene.add(turn);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.75, 0.16, 64), new THREE.MeshStandardMaterial({ color: 0x1a2440, metalness: 0.85, roughness: 0.25 }));
  disc.position.y = -0.08; disc.receiveShadow = true; turn.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.72, 0.035, 6, 96), new THREE.MeshBasicMaterial({ color: 0xffd60a })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; scene.add(ring);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a3350, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(4, 7, 5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 }); scene.add(key);
  let car = null, t = 0, token = 0;
  return {
    scene,
    async setCar(def, livery) {
      const my = ++token; const tpl = await loadCar(def); if (my !== token) return;
      if (car) turn.remove(car.root);
      car = buildCar(tpl, livery); car.root.rotation.y = 0.6; car.glow.visible = false; car.setBeam(0); turn.add(car.root);
    },
    update(dt) {
      t += dt; turn.rotation.y += dt * 0.35;
      const aspect = innerWidth / innerHeight, dist = Math.max(10.5, 6.4 / (0.65 * aspect));
      garageCam.position.set(Math.sin(t * 0.2) * 1.1, 2.2 + (aspect < 1 ? 0.6 : 0), dist);
      garageCam.lookAt(0, 0.2, 0);
      garageCam.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.26, innerWidth, innerHeight);
      if (car) car.spin(dt * 3);
    },
  };
})();
const paintFor = (def) => save.paints[def.id] ?? 0;
const liveryFor = (def) => makeLivery(rng(1), PAINTS[paintFor(def)]);
function refreshGarage(reloadCar) {
  const def = CARS[gIdx];
  if (reloadCar) garage.setCar(def, liveryFor(def));
  ui.renderGarage(save, gIdx, paintFor(def), gTab);
}
function openGarage() {
  if (S) endRace();
  mode = 'garage'; gIdx = Math.max(0, CARS.findIndex((c) => c.id === save.car)); refreshGarage(true); ui.show('garage');
}

// ------------------------------------------------------------------ input
const keys = new Set();
addEventListener('keydown', (e) => {
  audio.unlock();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys.add(e.code);
  if ((e.code === 'Escape' || e.code === 'KeyP') && mode === 'race' && S && !S.over) (S.paused ? resumeRace() : pauseRace());
  if (e.code === 'KeyR' && mode === 'race' && S && !S.paused && S.race.state === 'racing') S.race._respawn(S.race.player, false);
  if (e.code === 'Enter' && mode === 'home') ui.h.play();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('pointerdown', () => audio.unlock());
let steerState = 0;
function readInput(dt) {
  const k = (c) => keys.has(c);
  let target = 0, throttle = 0, brake = 0, drift = false;
  if (k('ArrowLeft') || k('KeyA')) target -= 1; if (k('ArrowRight') || k('KeyD')) target += 1;
  if (k('ArrowUp') || k('KeyW')) throttle = 1; if (k('ArrowDown') || k('KeyS')) brake = 1;
  if (k('Space') || k('ShiftLeft') || k('ShiftRight')) drift = true;
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
  if (gp) {
    const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.12) target = ax;
    if (gp.buttons[7]?.value > 0.1) throttle = gp.buttons[7].value; if (gp.buttons[0]?.pressed) throttle = 1;
    if (gp.buttons[6]?.value > 0.1) brake = gp.buttons[6].value; if (gp.buttons[1]?.pressed) brake = 1;
    if (gp.buttons[2]?.pressed || gp.buttons[5]?.pressed) drift = true;
  }
  let analog = false;
  if (ui.isTouch) {
    const t = ui.touch;
    if (t.steer != null) { target = t.steer; analog = true; }
    if (t.left) target -= 1; if (t.right) target += 1;
    if (t.brake || t.brake2) { brake = 1; throttle = 0; } else if (throttle === 0 && !keys.size && !gp) throttle = 1;
  }
  target = clamp(target, -1, 1);
  const rate = analog ? 14 : Math.abs(target) > Math.abs(steerState) ? 7 : 11;
  steerState += clamp(target - steerState, -rate * dt, rate * dt);
  return { steer: steerState, throttle, brake, drift };
}

// ------------------------------------------------------------------ sessions (a world + a race + car visuals)
async function createSession(levelIndex, isDemo, progress = () => {}) {
  const L = LEVELS[levelIndex];
  const world = buildWorld(L, renderer);
  progress(0.55);
  const fx = { sparks: new Particles(world.scene, 600, true), smoke: new Particles(world.scene, 700, false), fire: new Particles(world.scene, 900, true), dust: new Particles(world.scene, 400, false) };
  const R = rng(L.seed * 31 + (save.runs || 0) * 7 + (isDemo ? 999 : 0));
  const names = [...NAMES]; for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  const setups = [];
  const nAI = isDemo ? 6 : 5;
  for (let i = 0; i < nAI; i++) {
    const def = CARS[(i + Math.floor(R() * 4)) % 4], livery = makeLivery(R);
    const skill = (96 * L.ai * (0.96 + R() * 0.08)) / def.phys.vmax;
    setups.push({ id: 'ai' + i, name: names[i], def, skill, lane: R.range(-0.8, 0.8), livery, color: new THREE.Color().setHSL(livery.hue, 0.8, 0.55).getHex() });
  }
  if (!isDemo) {
    const def = CARS.find((c) => c.id === save.car) || CARS[0], cs = carSetup(def);
    setups.splice(nAI - Math.floor(R() * 2), 0, { id: 'me', name: 'You', def, isPlayer: true, livery: liveryFor(def), color: 0xffffff, lane: 0, phys: cs.phys, boostMul: cs.boostMul });
  }
  const tpls = {}; for (const d of CARS) tpls[d.id] = await loadCar(d);
  progress(0.8);
  const visuals = new Map();
  for (const s of setups) {
    const v = buildCar(tpls[s.def.id], s.livery); v.tpl = tpls[s.def.id]; v.root.rotation.order = 'YXZ'; v.glow.visible = false; v.flame = 0;
    world.scene.add(v.root); visuals.set(s.id, v);
  }
  const sess = { world, fx, visuals, levelIndex, demo: isDemo, t: 0, shake: 0, th: world.th, cam: { h: 0, pos: new THREE.Vector3(), fov: 62, hint: -1, q: {} } };
  sess.race = new Race(world, setups, isDemo ? {} : raceCallbacks(sess), { demo: isDemo });
  if (!isDemo) {
    const pl = new THREE.PointLight(0xff8a30, 0, 14, 2); pl.position.set(0, 0.6, -visuals.get('me').tpl.half.z - 0.8);
    visuals.get('me').root.add(pl); sess.exhaustLight = pl;
  }
  sess.focus = sess.race.player || sess.race.cars[0];
  sess.cam.h = sess.focus.h;
  return sess;
}
function disposeSession(sess) {
  if (!sess) return;
  sess.world.dispose();
}

// menu background: an AI race on the selected track with a cinematic camera
let demoTimer = 0, demoBuilding = false;
function queueDemo(i, delay = 450) {
  clearTimeout(demoTimer);
  if (demo && demo.levelIndex === i) return;
  demoTimer = setTimeout(async () => {
    if (demoBuilding || (mode !== 'home' && mode !== 'tracks')) return;
    demoBuilding = true;
    const next = await createSession(i, true);
    demoBuilding = false;
    if (mode !== 'home' && mode !== 'tracks') { disposeSession(next); return; }
    const old = demo; demo = next; disposeSession(old);
    demo.shot = 0; demo.shotT = 0; fxOn = fxOn && !!composer;
    if (demo.levelIndex !== trackIdx) queueDemo(trackIdx);
  }, delay);
}

// ------------------------------------------------------------------ race flow
async function startRace(levelIndex) {
  endRace();
  mode = 'loading'; trackIdx = levelIndex;
  ui.show('none'); ui.showRaceLoading(levelIndex, infoFor(levelIndex));
  audio.stopMusic();
  await new Promise((r) => setTimeout(r, 60));
  clearTimeout(demoTimer); disposeSession(demo); demo = null;
  save.runs = (save.runs || 0) + 1; persist();
  ui.setRaceLoading(0.35);
  await new Promise((r) => setTimeout(r, 30));
  const sess = await createSession(levelIndex, false, (p) => ui.setRaceLoading(p));
  S = sess; S.paused = false; S.over = false; S.finishT = 0; S.startHint = true; S.cpIdx = 1; S.lastWind = 0; S.gapWarned = new Set();
  ui.setRaceLoading(1);
  syncVisuals(S, 0); chaseCam(S, 0.016, true);
  ui.initHud(S.world.track, S.race.cars);
  renderWorld(S);                       // compile shaders before revealing
  ui.show('hud'); ui.hideRaceLoading(); mode = 'race';
  ui.setHint(controlsHint());
  audio.playMusic(S.th.bgm);
  audio.ambience((Array.isArray(S.th.weather) ? S.th.weather : []).includes('rain') ? 'rain' : 'none');
  S.world.events.thunder = (dist) => setTimeout(() => audio.thunder(), Math.min(2500, dist * 3));
}
const controlsHint = () => (ui.device === 'phone'
  ? '<b>Slide your finger</b> left and right to steer · second finger brakes · hit the <b>yellow pads</b> to boost'
  : ui.isTouch ? 'Hold <b>◀ ▶</b> to steer · <b>BRAKE</b> for the tight bends · hit the <b>yellow pads</b> to boost'
  : '<b>← →</b> steer · <b>↑</b> gas · <b>↓</b> brake · <b>SPACE</b> handbrake · hit the <b>yellow pads</b> to boost');
function endRace() {
  if (!S) return;
  disposeSession(S); S = null;
  audio.engine(0, 0, false, false); audio.skid(0); audio.ambience('none');
  document.getElementById('vignette').className = '';
  const fx = document.getElementById('fxlines').getContext('2d'); fx.clearRect(0, 0, 9999, 9999);
}
function pauseRace() { if (!S || S.paused || S.over) return; S.paused = true; ui.showPause(save); audio.engine(0, 0, false, false); audio.skid(0); audio.ambience('none'); }
function resumeRace() { if (!S) return; S.paused = false; ui.hidePause(); audio.ambience((Array.isArray(S.th.weather) ? S.th.weather : []).includes('rain') ? 'rain' : 'none'); }
platform.onPause(() => { if (mode === 'race') pauseRace(); audio.pause(); });
platform.onResume(() => audio.resume());

let flashTO = 0;
function flash(cls, ms = 350) { const v = document.getElementById('vignette'); v.className = cls; clearTimeout(flashTO); flashTO = setTimeout(() => (v.className = ''), ms); }

function raceCallbacks(sess) {
  const mine = (c) => c.isPlayer;
  return {
    onCountdown: (n) => { ui.setMsg(n > 0 ? String(n) : 'GO', n > 0 ? '' : 'go'); audio.beep(n === 0); if (n === 0) setTimeout(() => ui.setMsg(''), 900); },
    onFinish: (c) => { if (!mine(c)) return; ui.setMsg('FINISH', 'go'); audio.finish(c.place <= 3); sess.finishT = 0.001; ui.setHint(''); },
    onWall: (c, vn) => {
      if (!mine(c)) return;
      sess.shake = Math.max(sess.shake, clamp(vn / 12, 0.1, 0.6)); audio.scrape(); if (vn > 10) { audio.bump(vn); flash('hit'); }
      for (let i = 0; i < 8; i++) sess.fx.sparks.emit(c.x, c.y + 0.5, c.z, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 0.4, 0.2, 1, 0.8, 0.3, 1, 0, 0, 12);
    },
    onBump: (a, b, v) => { if (mine(a) || mine(b)) { sess.shake = Math.max(sess.shake, clamp(v / 14, 0.1, 0.45)); audio.bump(v); } },
    onObstacle: (c, k, o) => {
      if (o.kind === 'crate') for (let i = 0; i < 14; i++) sess.fx.dust.emit(o.x, o.y, o.z, (Math.random() - 0.5) * 10 + c.vx * 0.4, Math.random() * 6, (Math.random() - 0.5) * 10 + c.vz * 0.4, 0.9, 0.5, 0.62, 0.45, 0.26, 1, 0.4, 2, 12);
      for (let i = 0; i < 10; i++) sess.fx.smoke.emit(c.x, c.y + 0.6, c.z, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 0.7, 1.1, 0.85, 0.85, 0.85, 0.6, 3, 0, 10);
      if (mine(c)) { sess.shake = Math.max(sess.shake, 0.5); audio.bump(10); flash('hit'); toast('HIT!', 'r'); }
    },
    onPad: (c, stack) => { if (mine(c)) { audio.boost(); audio.pad(); flash('boost', 900); sess.shake = Math.max(sess.shake, 0.22 + stack * 0.08); toast(stack ? `BOOST ×${stack + 1}` : 'BOOST', 'y'); } },
    onKnockout: () => { audio.overtake(); toast('KNOCKOUT · +40', 'y'); },
    onLand: (c, v) => {
      if (mine(c)) { sess.shake = Math.max(sess.shake, clamp(v / 25, 0.15, 0.55)); audio.land(); }
      for (let i = 0; i < 12; i++) sess.fx.dust.emit(c.x + (Math.random() - 0.5) * 2, c.y + 0.2, c.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 8, Math.random() * 3, (Math.random() - 0.5) * 8, 0.8, 1.4, 0.8, 0.8, 0.8, 0.6, 4, 3, 6);
    },
    onLaunch: (c) => { if (mine(c) && sess.world.track.gapAhead(c.q.s - 25, 40)) toast('AIRBORNE', 'b'); },
    onOvertake: (p) => { if (sess.race.state !== 'racing') return; audio.overtake(); toast(p === 1 ? 'YOU TAKE THE LEAD' : `OVERTAKE · P${p}`, 'g'); },
    onRespawn: (c, fell) => { if (!mine(c)) return; flash('fall', 500); toast(fell ? 'FELL OFF · BACK TO CHECKPOINT' : 'BACK ON TRACK', 'r'); chaseCam(sess, 0.016, true); },
  };
}

// ------------------------------------------------------------------ per-frame helpers
function syncVisuals(sess, dt) {
  for (const c of sess.race.cars) {
    const v = sess.visuals.get(c.id), r = v.root;
    r.position.set(c.x, c.y, c.z);
    r.rotation.set(-c.pitch, c.h, -c.roll + c.lean * 0.6, 'YXZ');
    r.visible = !(c.respawnT > 0 && Math.floor(c.respawnT * 10) % 2);
    v.body.rotation.y = c.slip * 0.55 * (c.drifting ? 1.2 : 0.6);
    v.body.position.y = c.airborne ? 0 : Math.sin(sess.t * 55 + c.grid * 3) * 0.006 * clamp(Math.abs(c.speed) / 40, 0, 1);
    v.spin(c.speed * dt); v.setSteer(c.steerState);
    v.tail.material.opacity = c.isPlayer && c.input.brake > 0 ? 0.9 : 0.25;
    v.setBeam(sess.th.night ? 0.9 : sess.th.road.wet ? 0.6 : 0.1);
    const target = c.boostT > 0 ? clamp(0.55 + c.boostT * 0.4, 0, 1) : 0;
    v.flame = lerp(v.flame, target, 1 - Math.exp(-(target > v.flame ? 18 : 6) * dt));
    v.setFlame(v.flame, sess.t);
  }
  if (sess.exhaustLight) { const v = sess.visuals.get('me'); sess.exhaustLight.intensity = v.flame * (14 + Math.random() * 8); }
}
const _wp = new THREE.Vector3();
function emitFx(sess, dt) {
  const { race, visuals, fx } = sess, f = sess.focus;
  for (const c of race.cars) {
    if (Math.hypot(c.x - f.x, c.z - f.z) > 90) continue;
    const v = visuals.get(c.id); v.root.updateMatrixWorld(true);
    const hx = v.tpl.half.x * 0.78, hz = v.tpl.half.z * 0.72, fwd = [Math.sin(c.h), Math.cos(c.h)];
    if (v.flame > 0.05) {
      for (const sx of [-0.32, 0.32]) {
        _wp.set(sx * v.tpl.half.x, v.tpl.height * 0.24, -v.tpl.half.z - 0.25).applyMatrix4(v.root.matrixWorld);
        for (let k = 0; k < 2; k++) {
          const hot = Math.random();
          fx.fire.emit(_wp.x, _wp.y, _wp.z, -fwd[0] * (8 + Math.random() * 6) + (Math.random() - 0.5) * 1.5, (Math.random() - 0.2) * 1.4, -fwd[1] * (8 + Math.random() * 6) + (Math.random() - 0.5) * 1.5, 0.18 + Math.random() * 0.14, 0.35 + v.flame * 0.35, 1, 0.45 + hot * 0.4, 0.1 + hot * 0.15, 0.9, -0.3, 1, 0);
        }
        if (Math.random() < 0.12) fx.smoke.emit(_wp.x, _wp.y, _wp.z, c.vx * 0.6, 0.8, c.vz * 0.6, 0.5, 0.5, 0.35, 0.35, 0.38, 0.25, 1.4, 1, -0.5);
      }
    }
    const back = [[-hx, 0.25, -hz], [hx, 0.25, -hz]];
    if ((c.drifting || (Math.abs(c.slip) > 0.22 && c.speed > 18)) && c.onRoad && !c.airborne) {
      for (const b of back) { _wp.set(...b).applyMatrix4(v.root.matrixWorld); fx.smoke.emit(_wp.x, _wp.y, _wp.z, (Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2, 0.8, 0.9, 0.9, 0.9, 0.95, c.drifting ? 0.35 : 0.25, 2.4, 1, 0); }
    }
  }
}

// chase camera for the player
function chaseCam(sess, dt, snap = false) {
  const { cam, world } = sess, c = sess.focus;
  const sp01 = clamp(Math.abs(c.speed) / 100, 0, 1.3), boosting = c.boostT > 0;
  const vh = Math.hypot(c.vx, c.vz) > 6 ? Math.atan2(c.vx, c.vz) : c.h;
  cam.h += wrapAngle(c.h + wrapAngle(vh - c.h) * 0.45 - cam.h) * (snap ? 1 : 1 - Math.exp(-5.5 * dt));
  const dist = 9.6 + sp01 * 2.6 + (boosting ? 1.6 : 0), height = 3.5 + sp01 * 0.7;
  const dx = Math.sin(cam.h), dz = Math.cos(cam.h);
  const ex = c.x - dx * dist, ez = c.z - dz * dist;
  const tq = world.track.query(ex, ez, cam.hint, cam.q); cam.hint = tq.i0;
  let ey = c.y + height;
  if (Math.abs(tq.d) < world.track.wallD + 3 && world.track.hasRoad(tq.s)) ey = Math.max(ey, tq.surfaceY + 1.3);
  const k = snap ? 1 : 1 - Math.exp(-14 * dt);
  cam.pos.x = lerp(cam.pos.x, ex, k); cam.pos.z = lerp(cam.pos.z, ez, k); cam.pos.y = lerp(cam.pos.y, ey, snap ? 1 : 1 - Math.exp(-9 * dt));
  const sh = sess.shake;
  raceCam.position.set(cam.pos.x + (Math.random() - 0.5) * sh * 0.7, cam.pos.y + (Math.random() - 0.5) * sh * 0.5, cam.pos.z + (Math.random() - 0.5) * sh * 0.7);
  const ahead = 8 + sp01 * 8;
  raceCam.lookAt(c.x + (Math.sin(c.h) + dx) * ahead * 0.5, c.y + 1.6 + c.pitch * 3, c.z + (Math.cos(c.h) + dz) * ahead * 0.5);
  cam.roll = lerp(cam.roll || 0, c.airborne ? 0 : c.roll, snap ? 1 : 1 - Math.exp(-6 * dt));
  raceCam.rotateZ(-cam.roll * 0.45);
  setFov(sess, 62 + sp01 * 12 + (boosting ? 10 : 0), snap);
}
function setFov(sess, f, snap) {
  sess.cam.fov = lerp(sess.cam.fov, f, snap ? 1 : 0.08);
  if (Math.abs(raceCam.fov - sess.cam.fov) > 0.05) { raceCam.fov = sess.cam.fov; raceCam.updateProjectionMatrix(); }
}
// cinematic shots for the menu background
const SHOTS = ['chase', 'side', 'front', 'orbit', 'low'];
function cinematicCam(sess, dt) {
  sess.shotT += dt;
  if (sess.shotT > 6.5 || !sess.focus) {
    sess.shotT = 0; sess.shot = (sess.shot + 1) % SHOTS.length;
    // follow whoever is leading
    sess.focus = sess.race.order[Math.floor(Math.random() * 2)];
  }
  const c = sess.focus, shot = SHOTS[sess.shot], t = sess.shotT;
  const f = [Math.sin(c.h), Math.cos(c.h)], r = [-f[1], f[0]];
  if (shot === 'chase') { chaseCam(sess, dt, t < dt * 1.5); return; }
  let p, look = [c.x, c.y + 1, c.z];
  if (shot === 'side') p = [c.x + r[0] * 9 - f[0] * 2, c.y + 2.2, c.z + r[1] * 9 - f[1] * 2];
  else if (shot === 'front') p = [c.x + f[0] * 10 + r[0] * 2.5, c.y + 1.3, c.z + f[1] * 10 + r[1] * 2.5];
  else if (shot === 'low') { p = [c.x - f[0] * 5 + r[0] * 3.2, c.y + 0.6, c.z - f[1] * 5 + r[1] * 3.2]; look = [c.x + f[0] * 8, c.y + 0.9, c.z + f[1] * 8]; }
  else { const a = t * 0.35 + 1; p = [c.x + Math.cos(a) * 16, c.y + 7, c.z + Math.sin(a) * 16]; }
  raceCam.position.set(...p); raceCam.lookAt(...look);
  setFov(sess, shot === 'orbit' ? 55 : 50, t < dt * 1.5);
}

const linesCtx = document.getElementById('fxlines').getContext('2d');
function speedLines(intensity, t) {
  const cv = linesCtx.canvas, w = cv.width, h = cv.height;
  linesCtx.clearRect(0, 0, w, h);
  if (intensity < 0.05) return;
  linesCtx.strokeStyle = `rgba(255,255,255,${0.16 * intensity})`; linesCtx.lineWidth = 1.5;
  const n = Math.floor(26 * intensity) + 6, cx = w / 2, cy = h * 0.46;
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
  for (let i = 0; i < 90 * 60 && !race.cars.every((c) => c.finished); i++) race.update(1 / 60);
  const rewards = raceRewards(race, levelIndex);
  const rec = save.levels[L.id] || (save.levels[L.id] = {});
  const newRecord = !rec.best || p.finishTime < rec.best;
  if (newRecord) rec.best = p.finishTime;
  const wasOpen = levelIndex + 1 < LEVELS.length && (save.levels[L.id]?.stars || 0) >= 1;
  rec.stars = Math.max(rec.stars || 0, rewards.stars);
  save.coins += rewards.total; persist();
  platform.sendScore(LEVELS.reduce((a, l) => a + (save.levels[l.id]?.stars || 0), 0));
  let note = '';
  if (!wasOpen && rewards.stars > 0 && levelIndex + 1 < LEVELS.length) note = `${LEVELS[levelIndex + 1].name} is next`;
  else if (rewards.stars === 0) note = 'Finish in the top 3 to earn stars. Upgrades in the Garage help you keep up.';
  mode = 'results';
  ui.showResults({ level: L, place: p.place, time: p.finishTime, order: race.order, rewards, newRecord, note, hasNext: levelIndex + 1 < LEVELS.length && isUnlocked(levelIndex + 1) });
  audio.engine(0, 0, false, false); audio.skid(0);
}

function raceFrame(dt) {
  const race = S.race, p = race.player, T = S.world.track;
  S.t += dt;
  const inp = DEV.auto && !p.finished ? race._ai(p, dt) : readInput(dt);
  p.input = inp;
  race.update(dt, inp);
  syncVisuals(S, dt); emitFx(S, dt);
  S.shake = Math.max(0, S.shake - dt * 1.6);
  chaseCam(S, dt);
  S.world.update(dt, S.t, raceCam, tmpV.set(p.x, p.y, p.z), race.time, race.obs);
  for (const k in S.fx) S.fx[k].update(dt, innerHeight * renderer.getPixelRatio() * 0.9);

  // race notices
  if (race.state === 'racing' && !p.finished) {
    while (S.cpIdx < T.checkpoints.length && p.maxS >= T.checkpoints[S.cpIdx]) { if (T.hasRoad(T.checkpoints[S.cpIdx])) toast('CHECKPOINT', 'w'); S.cpIdx++; }
    if (p.wind && !S.lastWind) toast('CROSSWIND', 'b');
    S.lastWind = p.wind;
    const g = T.gapAhead(p.q.s, 260);
    if (g && !S.gapWarned.has(g.s0)) { S.gapWarned.add(g.s0); toast('JUMP AHEAD · HIT THE PAD', 'y'); }
  }
  const wrongWay = race.state === 'racing' && !p.finished && Math.cos(wrapAngle(p.h - p.q.head)) < -0.3 && Math.abs(p.speed) > 8;
  ui.updateHud({
    pos: p.place, time: race.state === 'countdown' ? 0 : p.finished ? p.finishTime : race.time,
    speed: Math.abs(p.speed) * 3.6, boost: clamp(p.boostT / (2.8 * p.boostMul), 0, 1), wrongWay,
    cars: race.cars.map((c) => ({ id: c.id, x: c.x, z: c.z, prog: c.prog, me: c.isPlayer, color: c.color })),
  });
  if (S.startHint && race.state === 'racing' && race.time > 7) { ui.setHint(''); S.startHint = false; }
  // audio
  const sp01 = clamp(Math.abs(p.speed) / (p.phys.vmax * 1.2), 0, 1.1);
  audio.engine(sp01, race.state === 'countdown' ? (inp.throttle > 0 ? 0.8 : 0.1) : inp.throttle, p.boostT > 0, true);
  let best = null, bd = 1e9;
  for (const c of race.cars) { if (c === p) continue; const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < bd) { bd = d; best = c; } }
  if (best) { const rx = -Math.cos(p.h), rz = Math.sin(p.h); audio.rival(bd, ((best.x - p.x) * rx + (best.z - p.z) * rz) / Math.max(bd, 1), Math.abs(best.speed) / best.phys.vmax); }
  audio.skid(p.drifting ? 0.9 : Math.abs(p.slip) > 0.25 && p.speed > 18 && p.onRoad ? clamp(Math.abs(p.slip) * 2, 0, 0.9) : 0);
  speedLines(clamp((Math.abs(p.speed) / 100 - 0.55) * 2, 0, 1) + (p.boostT > 0 ? 0.5 : 0), S.t);
  if (S.finishT > 0) { S.finishT += dt; if (S.finishT > 2.4 && !S.over) finishRace(); }
}

// ------------------------------------------------------------------ main loop
const tmpV = new THREE.Vector3();
let last = performance.now(), fpsAcc = 0, fpsN = 0, slow = 0, fast = 0, firstFrame = false;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1.5) {
    const avg = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
    if (avg > 1 / 38) slow++; else slow = 0;
    if (avg < 1 / 57) fast++; else fast = 0;
    if (slow >= 2 && pixelRatio > 0.7) { pixelRatio = Math.max(0.7, pixelRatio * 0.85); if (pixelRatio < 0.9) { fxOn = false; renderer.shadowMap.enabled = false; } resize(); slow = 0; }
    else if (fast >= 6 && pixelRatio < MAXPR) { pixelRatio = Math.min(MAXPR, pixelRatio * 1.1); resize(); fast = 0; }
  }
  if (mode === 'race' && S) {
    if (!S.paused) raceFrame(dt);
    renderWorld(S);
  } else if (mode === 'results' && S) {
    S.t += dt; S.race.update(dt); syncVisuals(S, dt); chaseCam(S, dt);
    S.world.update(dt, S.t, raceCam, tmpV.set(S.focus.x, S.focus.y, S.focus.z), S.race.time, S.race.obs);
    renderWorld(S);
  } else if ((mode === 'home' || mode === 'tracks') && demo) {
    demo.t += dt; demo.race.update(dt); syncVisuals(demo, dt); emitFx(demo, dt); cinematicCam(demo, dt);
    demo.world.update(dt, demo.t, raceCam, tmpV.set(demo.focus.x, demo.focus.y, demo.focus.z), demo.race.time, demo.race.obs);
    for (const k in demo.fx) demo.fx[k].update(dt, innerHeight * renderer.getPixelRatio() * 0.9);
    renderWorld(demo);
  } else if (mode === 'garage') {
    garage.update(dt); renderer.toneMappingExposure = 1; renderer.render(garage.scene, garageCam);
  } else {
    renderer.setClearColor(0x070b18); renderer.clear();
  }
  if (!firstFrame) { firstFrame = true; platform.firstFrameReady(); }
}

// ------------------------------------------------------------------ boot
const DEV = { auto: false };
async function boot() {
  await platform.init();
  initComposer();
  ui.setBoot(0.08, 'Loading cars…');
  let n = 0;
  for (const d of CARS) { await loadCar(d); ui.setBoot(0.08 + (++n / CARS.length) * 0.5); }
  ui.setBoot(0.65, 'Building tracks…');
  await new Promise((r) => setTimeout(r, 20));
  ui.setThumbs(LEVELS.map((_, i) => routeSvg(infoFor(i).track)));
  trackIdx = nextLevelIndex();
  ui.setBoot(0.8, 'Warming up the engines…');
  mode = 'home';
  demo = await createSession(trackIdx, true); demo.shot = 0; demo.shotT = 0;
  renderer.setAnimationLoop(frame);
  ui.setBoot(1, 'Ready');
  if (import.meta.env.DEV) devHooks();
  else openHome();
  ui.hideBoot();
}

// Development helpers (stripped from production builds): ?level=N opens a race, ?auto lets the AI drive.
function devHooks() {
  const q = new URLSearchParams(location.search);
  DEV.auto = q.has('auto');
  window.__game = {
    audio, ui, get S() { return S; }, get demo() { return demo; },
    fastForward(sec) { const race = S.race, p = race.player; for (let t = 0; t < sec; t += 1 / 60) { const i = race._ai(p, 1 / 60); p.input = i; race.update(1 / 60, i); } syncVisuals(S, 0); chaseCam(S, 0.016, true); },
  };
  if (q.has('level')) startRace(clamp(+q.get('level'), 0, LEVELS.length - 1)); else openHome();
}
boot().catch((e) => { console.error(e); ui.setBoot(1, 'Something went wrong while loading. Please refresh the page.'); });
