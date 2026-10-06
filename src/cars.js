// Car models: loading, normalising, wheel rigs and the procedural "livery" system that makes
// four base models look like dozens of different cars (recolour, patterns, finish, underglow, body tweaks).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { rng } from './util.js';

const BASE = import.meta.env.BASE_URL;

// phys: vmax (m/s), acc (accel multiplier), turn (steering rate multiplier), drift (drift-charge speed)
export const CARS = [
  { id: 'gr86', name: 'GR86 Drift', file: 'cars/gr86.glb', price: 0, len: 4.5,
    stats: { speed: 3, accel: 3, handling: 5, drift: 5 }, phys: { vmax: 63, acc: 1.0, turn: 1.12, drift: 1.35 },
    paint: /body_n|bonnet_n/, rig: 'wh' },
  { id: 'gt4', name: '718 GT4', file: 'cars/gt4.glb', price: 900, len: 5.7,
    stats: { speed: 4, accel: 4, handling: 4, drift: 3 }, phys: { vmax: 67, acc: 1.12, turn: 1.0, drift: 1.0 },
    paint: /^Material\.001$|^Material001$/, rig: 'bone' },
  { id: 'r35', name: 'R35 Silhouette', file: 'cars/r35.glb', price: 2200, len: 4.7,
    stats: { speed: 4, accel: 3, handling: 3, drift: 4 }, phys: { vmax: 70, acc: 1.0, turn: 0.92, drift: 1.15 },
    paint: /74d59a0|a7be1ef|5d8a605|ac35cdf/, rig: 'r35' },
  { id: 'z06', name: 'Z06 Carbon', file: 'cars/z06.glb', price: 4000, len: 4.5,
    stats: { speed: 5, accel: 5, handling: 3, drift: 3 }, phys: { vmax: 73, acc: 1.1, turn: 0.88, drift: 0.95 },
    paint: /^CHASSIS$|^mat_9$|^mat_38$/, rig: 'z06', accent: /^RIMRING$/ },
];

// Curated paint presets the player can pick from (and the AI draws from, with random patterns).
export const PAINTS = [
  { name: 'Stock', stock: true },
  { name: 'Solar Flare', c1: 0xff4d1a, c2: 0xffd21f, pattern: 1 },
  { name: 'Ocean Drive', c1: 0x1479ff, c2: 0x20e3ff, pattern: 4 },
  { name: 'Toxic', c1: 0x7cff1a, c2: 0x151515, pattern: 2 },
  { name: 'Bubblegum', c1: 0xff5fb8, c2: 0xffffff, pattern: 1 },
  { name: 'Royal Purple', c1: 0x7a2cff, c2: 0xff3df2, pattern: 5 },
  { name: 'Lemon Drop', c1: 0xffe11a, c2: 0x111111, pattern: 3 },
  { name: 'Crimson', c1: 0xe0102a, c2: 0xffffff, pattern: 2 },
  { name: 'Mint', c1: 0x1ff0b0, c2: 0x0b3d91, pattern: 6 },
  { name: 'Sunset', c1: 0xff7a1a, c2: 0xff1f6e, pattern: 5 },
  { name: 'Arctic', c1: 0xdff6ff, c2: 0x2a8cff, pattern: 4 },
  { name: 'Midnight', c1: 0x1a1f5e, c2: 0x00e0ff, pattern: 1 },
  { name: 'Lime Rush', c1: 0xc6ff00, c2: 0x7a00ff, pattern: 4 },
  { name: 'Rose Gold', c1: 0xf0a08a, c2: 0x4a2030, pattern: 6, metal: 0.9 },
];

const VIVID = [0xff3b30, 0xff9500, 0xffd60a, 0x34c759, 0x00c7be, 0x0a84ff, 0x5e5ce6, 0xbf5af2, 0xff375f, 0xff6b2c, 0x30d158, 0x64d2ff,
  0xf5f5f5, 0x2b2b30, 0xff2d92, 0x9bff1f, 0x00f0ff, 0xb8860b, 0x8e2de2, 0xe84393];

export function makeLivery(r, forcePaint) {
  if (forcePaint) {
    if (forcePaint.stock) return { stock: true, glow: new THREE.Color(0x66ccff), size: [1, 1, 1] };
    return {
      tint: new THREE.Color(forcePaint.c1), tint2: new THREE.Color(forcePaint.c2), pattern: forcePaint.pattern || 0, pw: 0.5,
      metal: forcePaint.metal ?? 0.55, rough: 0.28, clear: 1, glow: new THREE.Color(forcePaint.c2).lerp(new THREE.Color(forcePaint.c1), 0.3),
      size: [1, 1, 1],
    };
  }
  const c1 = r.pick(VIVID); let c2 = r.pick(VIVID);
  while (c2 === c1) c2 = r.pick(VIVID);
  const matte = r() < 0.2;
  return {
    tint: new THREE.Color(c1), tint2: new THREE.Color(c2), pattern: r.int(0, 6), pw: r.range(0.35, 0.7),
    metal: matte ? 0.1 : r.range(0.3, 0.8), rough: matte ? 0.65 : r.range(0.2, 0.4), clear: matte ? 0 : 1,
    glow: new THREE.Color(c2), size: [r.range(0.97, 1.04), r.range(0.96, 1.06), r.range(0.97, 1.03)],
  };
}

const VERT_DECL = 'attribute vec3 aCarPos;\nvarying vec3 vCarPos;\n';
const FRAG_DECL = 'varying vec3 vCarPos;\nuniform vec3 uTint;\nuniform vec3 uTint2;\nuniform float uPattern;\nuniform float uPW;\nuniform float uStrength;\n';
const FRAG_BODY = `
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float shade = 0.42 + 1.1 * pow(lum, 0.7);
  vec3 p = vCarPos;
  float pm = 0.0;
  if (uPattern > 0.5 && uPattern < 1.5) pm = step(abs(abs(p.x) - 0.2), uPW * 0.3);
  else if (uPattern < 2.5 && uPattern > 1.5) pm = step(abs(p.x), uPW * 0.55);
  else if (uPattern < 3.5 && uPattern > 2.5) pm = step(p.y, 0.22 + uPW * 0.25);
  else if (uPattern < 4.5 && uPattern > 3.5) pm = step(0.0, p.x * 0.9 + p.z * 0.8 - 0.15 + (uPW - 0.5));
  else if (uPattern < 5.5 && uPattern > 4.5) pm = smoothstep(0.35, -0.75, p.z);
  else if (uPattern > 5.5) pm = step(0.7, p.y);
  vec3 painted = mix(uTint, uTint2, pm) * shade;
  diffuseColor.rgb = mix(diffuseColor.rgb, painted, uStrength);
`;

let glowTex, shadowTex, beamTex;
function radialTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

let loader;
const cache = new Map();

export function loadCar(def) {
  if (cache.has(def.id)) return cache.get(def.id);
  if (!loader) {
    loader = new GLTFLoader();
  }
  const p = new Promise((resolve, reject) => {
    loader.load(BASE + def.file, (gltf) => resolve(prepareTemplate(def, gltf.scene)), undefined, reject);
  });
  cache.set(def.id, p);
  return p;
}

function prepareTemplate(def, model) {
  const wrap = new THREE.Group();
  wrap.add(model);
  let box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const k = def.len / size.z;
  model.scale.setScalar(k);
  model.position.set(-ctr.x * k, -box.min.y * k, -ctr.z * k);
  wrap.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(wrap);
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);

  // per-vertex car-space coordinates (x,z in -1..1, y in 0..1) for shader livery patterns
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const mat = o.material;
    if (def.paint.test(mat.name) && !mat.transparent) {
      const pos = o.geometry.attributes.position;
      if (!o.geometry.attributes.aCarPos) {
        const arr = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          arr[i * 3] = v.x / half.x; arr[i * 3 + 1] = (v.y - box.min.y) / (half.y * 2); arr[i * 3 + 2] = v.z / half.z;
        }
        o.geometry.setAttribute('aCarPos', new THREE.BufferAttribute(arr, 3));
      }
      o.userData.paint = true;
    } else if (def.accent && def.accent.test(mat.name)) o.userData.accent = true;
  });
  return { def, wrap, half, height: half.y * 2 };
}

// Build a fresh, independently coloured car from a template.
export function buildCar(tpl, livery) {
  const { def } = tpl;
  const root = new THREE.Group();
  const body = new THREE.Group();            // scaled body-tweak group (livery size)
  const model = tpl.wrap.clone(true);
  body.add(model);
  root.add(body);
  body.scale.set(...livery.size);

  const uniformSets = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.paint && !livery.stock) {
      const m = o.material.clone();
      m.color.set(0xffffff);
      if (livery.metal != null) { m.metalness = livery.metal; m.roughness = livery.rough; }
      if ('clearcoat' in m) m.clearcoat = livery.clear ?? 1;
      const u = { uTint: { value: livery.tint }, uTint2: { value: livery.tint2 }, uPattern: { value: livery.pattern }, uPW: { value: livery.pw }, uStrength: { value: 1 } };
      uniformSets.push(u);
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_DECL).replace('#include <begin_vertex>', '#include <begin_vertex>\n vCarPos = aCarPos;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_DECL).replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_BODY);
      };
      m.customProgramCacheKey = () => 'livery-v1';
      o.material = m;
    } else if (o.userData.accent && !livery.stock) {
      const m = o.material.clone(); m.color.copy(livery.tint2); o.material = m;
    }
  });

  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // wheel rig
  const wheels = rigWheels(def, model);

  // blob shadow + underglow
  shadowTex = shadowTex || radialTexture('rgba(0,0,0,0.65)', 'rgba(0,0,0,0)');
  glowTex = glowTex || radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(tpl.half.x * 2.9, tpl.half.z * 2.5), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.45, depthWrite: false, fog: true }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.05; shadow.renderOrder = 2;
  root.add(shadow);
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: livery.glow || 0x66ccff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(tpl.half.x * 3.4, tpl.half.z * 2.7), glowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.08; glow.renderOrder = 3;
  root.add(glow);

  // brake / tail glow sprites
  const tail = new THREE.Mesh(new THREE.PlaneGeometry(tpl.half.x * 1.5, 0.28), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
  tail.position.set(0, tpl.height * 0.52, -tpl.half.z - 0.03); tail.rotation.y = Math.PI;
  root.add(tail);

  // headlights: glow sprites + soft beams on the road ahead (visible mostly at night / in storms)
  beamTex = beamTex || (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(255,244,214,0.55)'); gr.addColorStop(1, 'rgba(255,244,214,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(26, 128); g.lineTo(38, 128); g.lineTo(64, 0); g.lineTo(0, 0); g.closePath(); g.fill(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const lights = new THREE.Group();
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 26), beamMat); b.rotation.x = -Math.PI / 2; b.rotation.z = sx * 0.04; b.position.set(sx * tpl.half.x * 0.62, 0.12, tpl.half.z + 13.5); b.renderOrder = 4; lights.add(b);
  }
  root.add(lights);

  return {
    root, body, wheels, glow, shadow, tail, livery, uniformSets, def, beamMat,
    setBeam(k) { beamMat.opacity = k; },
    setSteer(s) { for (const w of wheels) if (w.steer) w.steer.rotation.y = -s * 0.45; },
    spin(dist) { for (const w of wheels) w.spin.rotation.x += dist / 0.34; },
  };
}

function rigWheels(def, model) {
  const wheels = [];
  const find = (re, nonMesh = true) => { const out = []; model.traverse((o) => { if ((!nonMesh || !o.isMesh) && re.test(o.name)) out.push(o); }); return out; };
  const wrap = (w, front) => {
    const parent = w.parent;
    const steer = new THREE.Group(), spin = new THREE.Group();
    steer.position.copy(w.position); w.position.set(0, 0, 0);
    parent.add(steer); steer.add(spin); spin.add(w);
    wheels.push({ spin, steer: front ? steer : null, front });
  };
  if (def.rig === 'bone') {
    for (const id of ['FL', 'FR', 'BL', 'BR']) {
      const spin = find(new RegExp(`^bone_wheel_${id}_rotation$`))[0], steer = find(new RegExp(`^bone_wheel_${id}_steer$`))[0];
      if (spin) wheels.push({ spin, steer: id[0] === 'F' ? steer : null, front: id[0] === 'F' });
    }
  } else if (def.rig === 'wh') {
    for (const w of find(/WH_(front|rear)\d*$/)) wrap(w, /WH_front/.test(w.name));
  } else if (def.rig === 'r35') {
    for (const w of find(/^body_unref_unblend\d+$/)) wrap(w, w.position.z > 0);
  } else if (def.rig === 'z06') {
    for (const w of find(/^mesh_43(\d+)?$/)) wrap(w, w.position.z > 0);
  }
  return wheels;
}
