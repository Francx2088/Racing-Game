// Car models: loading, normalising, wheel rigs and the procedural "livery" system that makes
// four base models look like dozens of different cars (recolour, patterns, finish, underglow, body tweaks).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { rng } from './util.js';

const BASE = import.meta.env.BASE_URL;

// phys: vmax (m/s), acc (accel multiplier), turn (steering rate multiplier), drift (drift-charge speed)
export const CARS = [
  { id: 'gr86', name: 'GR86 Drift', file: 'cars/gr86.glb', price: 0, len: 4.5,
    stats: { speed: 3, accel: 3, handling: 5, drift: 5 }, phys: { vmax: 92, acc: 1.0, turn: 1.12, drift: 1.35 },
    paint: /body_n|bonnet_n/, rig: 'wh' },
  { id: 'gt4', name: '718 GT4', file: 'cars/gt4.glb', price: 900, len: 5.7,
    stats: { speed: 4, accel: 4, handling: 4, drift: 3 }, phys: { vmax: 97, acc: 1.12, turn: 1.0, drift: 1.0 },
    paint: /^Material\.001$|^Material001$/, rig: 'bone' },
  { id: 'r35', name: 'R35 Silhouette', file: 'cars/r35.glb', price: 2200, len: 4.7,
    stats: { speed: 4, accel: 3, handling: 3, drift: 4 }, phys: { vmax: 101, acc: 1.0, turn: 0.92, drift: 1.15 },
    paint: /74d59a0|a7be1ef|5d8a605|ac35cdf/, rig: 'r35' },
  { id: 'z06', name: 'Z06 Carbon', file: 'cars/z06.glb', price: 4000, len: 4.5,
    stats: { speed: 5, accel: 5, handling: 3, drift: 3 }, phys: { vmax: 106, acc: 1.1, turn: 0.88, drift: 0.95 },
    paint: /^CHASSIS$|^mat_9$|^mat_38$/, rig: 'z06' },
];

// Paint presets. A paint never covers the car: it rotates the hue of the car's own textures
// towards `hue` (decals, numbers and shading stay), and gives grey panels a light tint.
export const PAINTS = [
  { name: 'Factory', stock: true },
  { name: 'Racing Red', hue: 0.0 },
  { name: 'Sunburst', hue: 0.07 },
  { name: 'Solar Yellow', hue: 0.14 },
  { name: 'Lime', hue: 0.24 },
  { name: 'Emerald', hue: 0.38 },
  { name: 'Teal', hue: 0.48 },
  { name: 'Sky Blue', hue: 0.56 },
  { name: 'Royal Blue', hue: 0.64 },
  { name: 'Violet', hue: 0.75 },
  { name: 'Magenta', hue: 0.85 },
  { name: 'Rose', hue: 0.94 },
];

// opts: { hue: 0..1 target hue, sat, tint: grey-panel tint amount }
export function makeLivery(r, paint) {
  if (paint && paint.stock) return { stock: true, glow: new THREE.Color(0x66ccff), size: [1, 1, 1] };
  if (paint) return { hue: paint.hue, sat: 1.1, tintAmt: 0.32, metal: null, glow: new THREE.Color().setHSL(paint.hue, 0.9, 0.55), size: [1, 1, 1] };
  const hue = r();
  return {
    hue, sat: r.range(0.85, 1.35), tintAmt: r.range(0.18, 0.42),
    metal: r() < 0.25 ? 0.15 : null, rough: 0.55,
    glow: new THREE.Color().setHSL(hue, 0.9, 0.55), size: [r.range(0.98, 1.03), r.range(0.98, 1.04), r.range(0.98, 1.02)],
  };
}

const FRAG_DECL = `uniform float uHue; uniform float uSat; uniform vec3 uTint; uniform float uTintAmt;
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
`;
const FRAG_BODY = `
  {
    vec3 col = diffuseColor.rgb;
    vec3 hsv = rgb2hsv(col);
    float colourful = smoothstep(0.14, 0.38, hsv.y) * smoothstep(0.015, 0.06, hsv.z);
    vec3 shifted = hsv2rgb(vec3(fract(hsv.x + uHue), clamp(hsv.y * uSat, 0.0, 1.0), hsv.z));
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 tinted = uTint * (lum / max(dot(uTint, vec3(0.2126, 0.7152, 0.0722)), 0.05));
    float mid = smoothstep(0.01, 0.08, lum) * (1.0 - smoothstep(0.55, 0.9, lum));
    vec3 grey = mix(col, tinted, uTintAmt * mid);
    diffuseColor.rgb = mix(grey, shifted, colourful);
  }
`;

// dominant hue of the paint textures, so a preset hue can be reached from any base colour
function dominantHue(images) {
  const c = document.createElement('canvas'); c.width = c.height = 48; const g = c.getContext('2d', { willReadFrequently: true });
  const bins = new Float32Array(36); let total = 0;
  for (const img of images) {
    try { g.clearRect(0, 0, 48, 48); g.drawImage(img, 0, 0, 48, 48); } catch { continue; }
    const d = g.getImageData(0, 0, 48, 48).data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0;
      if (sat < 0.3 || mx < 0.12) continue;
      let h; if (mx === r) h = ((gg - b) / (mx - mn)) % 6; else if (mx === gg) h = (b - r) / (mx - mn) + 2; else h = (r - gg) / (mx - mn) + 4;
      h = ((h / 6) + 1) % 1; bins[Math.floor(h * 36) % 36] += sat * mx; total += sat * mx;
    }
  }
  if (total < 40) return null;
  let best = 0; for (let i = 1; i < 36; i++) if (bins[i] > bins[best]) best = i;
  return (best + 0.5) / 36;
}

let glowTex, shadowTex, beamTex, flameGeo;

// a 1.8 m flame jet pointing backwards (-z); aL runs 0 at the nozzle to 1 at the tip
function flameGeometry() {
  if (flameGeo) return flameGeo;
  const L = 1.8, g = new THREE.ConeGeometry(0.2, L, 18, 10, true);
  g.translate(0, L / 2, 0);                 // wide end at the nozzle (y = 0), tip at y = L
  const pos = g.attributes.position, a = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) a[i] = pos.getY(i) / L;
  g.rotateX(-Math.PI / 2);                  // tip now points backwards (-z)
  g.setAttribute('aL', new THREE.BufferAttribute(a, 1));
  return (flameGeo = g);
}
function flameMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 } },
    vertexShader: `attribute float aL; varying float vL; varying vec2 vP;
      void main(){ vL = aL; vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uPower; varying float vL; varying vec2 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float a = atan(vP.y, vP.x);
        float t = n(vec2(a * 2.0, vL * 7.0 - uTime * 26.0)) * 0.6 + n(vec2(a * 5.0 + 3.0, vL * 15.0 - uTime * 40.0)) * 0.4;
        float reach = 0.55 + 0.45 * t;
        float alpha = smoothstep(reach, reach * 0.25, vL) * smoothstep(0.0, 0.05, vL);
        vec3 core = vec3(0.55, 0.75, 1.0) * 2.2, mid = vec3(1.0, 0.78, 0.3) * 1.9, outer = vec3(1.0, 0.32, 0.06) * 1.4;
        vec3 col = mix(core, mid, smoothstep(0.02, 0.22, vL)); col = mix(col, outer, smoothstep(0.25, 0.75, vL));
        gl_FragColor = vec4(col * (0.7 + 0.5 * t), alpha * uPower);
      }`,
  });
}
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

  const paintImages = new Set();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const mat = o.material;
    if (def.paint.test(mat.name) && !mat.transparent) { o.userData.paint = true; if (mat.map?.image) paintImages.add(mat.map.image); }
  });
  const baseHue = dominantHue(paintImages);
  return { def, wrap, half, height: half.y * 2, baseHue };
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
      if (livery.metal != null) { m.metalness = livery.metal; m.roughness = livery.rough; if ('clearcoat' in m) m.clearcoat = 0.2; }
      const shift = tpl.baseHue == null ? 0 : livery.hue - tpl.baseHue;
      const u = { uHue: { value: ((shift % 1) + 1) % 1 }, uSat: { value: livery.sat }, uTint: { value: new THREE.Color().setHSL(livery.hue, 0.85, 0.5) }, uTintAmt: { value: livery.tintAmt } };
      uniformSets.push(u);
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_DECL).replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_BODY);
      };
      m.customProgramCacheKey = () => 'paint-hue-v2';
      o.material = m;
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

  // exhaust flames (shown while boosting)
  const flames = new THREE.Group(); flames.visible = false;
  const fmat = flameMaterial();
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(flameGeometry(), fmat);
    f.position.set(sx * tpl.half.x * 0.32, tpl.height * 0.24, -tpl.half.z + 0.05); f.renderOrder = 8;
    flames.add(f);
  }
  root.add(flames);

  return {
    root, body, wheels, glow, shadow, tail, livery, uniformSets, def, beamMat, flames, flameMat: fmat,
    setFlame(power, t) {
      flames.visible = power > 0.02; fmat.uniforms.uPower.value = power; fmat.uniforms.uTime.value = t;
      for (const f of flames.children) f.scale.set(1, 1, 0.7 + power * (0.55 + Math.random() * 0.35));
    },
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
