// Assembles a complete sky level: physically based sky, cloud seas, lights + shadows, floating track,
// themed scenery and weather.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Track } from './track.js';
import { buildTrackMeshes } from './trackmesh.js';
import THEMES from './themes.js';
import { instances, canvasTex, part, merge, sph } from './kit.js';
import { cloudSea, cloudPuffs, islandGeometry, peakGeometry, waterfall } from './sky.js';
import { makeNoise, rng, clamp } from './util.js';
import { Weather } from './fx.js';

const D2R = Math.PI / 180;

function applySky(sky, p, sunDir) {
  const u = sky.material.uniforms;
  u.turbidity.value = p.turb; u.rayleigh.value = p.ray; u.mieCoefficient.value = p.mie; u.mieDirectionalG.value = p.mieG;
  u.sunPosition.value.copy(sunDir);
}

export function buildWorld(levelDef, renderer) {
  const th = THEMES[levelDef.theme];
  const track = new Track(levelDef);
  const noise = makeNoise(levelDef.seed * 13 + 5);
  const r = rng(levelDef.seed * 101 + 9);
  const scene = new THREE.Scene();
  const group = new THREE.Group(); scene.add(group);
  const anim = [];
  scene.fog = new THREE.Fog(th.fog[0], th.fog[1], th.fog[2]);
  scene.background = new THREE.Color(th.fog[0]);

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, (90 - th.sky.elev) * D2R, th.sky.azim * D2R);
  const lightDir = th.light ? new THREE.Vector3().setFromSphericalCoords(1, (90 - th.light.elev) * D2R, th.light.azim * D2R) : sunDir.clone();
  const shadowDir = lightDir.clone(); shadowDir.y = Math.max(shadowDir.y, 0.42); shadowDir.normalize();

  // ---- physically based sky ----
  const sky = new Sky(); sky.scale.setScalar(450000); applySky(sky, th.sky, sunDir); scene.add(sky);
  let envRT = null;
  if (renderer) {
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(450000); applySky(sky2, th.sky, sunDir); envScene.add(sky2);
    const cl = th.clouds?.[0]?.color ?? 0xcccccc;
    const lower = new THREE.Mesh(new THREE.SphereGeometry(40000, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(cl).multiplyScalar(th.envFloor ?? 0.8), side: THREE.BackSide }));
    envScene.add(lower);
    const pm = new THREE.PMREMGenerator(renderer);
    envRT = pm.fromScene(envScene, 0.0, 1, 1e6); pm.dispose();
    scene.environment = envRT.texture; scene.environmentIntensity = th.envInt ?? 1;
    sky2.material.dispose(); sky2.geometry.dispose(); lower.geometry.dispose(); lower.material.dispose();
  }
  let stars = null;
  if (th.stars) {
    const n = 1500, p = new Float32Array(n * 3), c = new Float32Array(n * 3); const rr = rng(3), col = new THREE.Color();
    for (let i = 0; i < n; i++) { const u = rr() * 2 - 1, a = rr() * 6.28, s = Math.sqrt(1 - u * u); const y = Math.abs(u) * 0.97 + 0.03; p.set([Math.cos(a) * s * 2400, y * 2400, Math.sin(a) * s * 2400], i * 3); col.setHSL(0.6 + rr() * 0.1, 0.3, 0.6 + rr() * 0.4); c.set([col.r, col.g, col.b], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: th.stars === true ? 0.95 : th.stars, depthWrite: false }));
    stars.renderOrder = -9; scene.add(stars);
  }
  // sun glare
  let sunSpr = null;
  const glareDir = th.glareSun ? lightDir : sunDir;
  if (th.sky.elev > -1 || th.glareSun) {
    const t = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
    sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color: th.sun.color, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: (th.glare ?? 0.8) * 0.35 }));
    sunSpr.scale.setScalar(380); sunSpr.renderOrder = -9; scene.add(sunSpr);
  }

  // ---- lights (+ real-time shadows around the player) ----
  const hemi = new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]); scene.add(hemi);
  const sun = new THREE.DirectionalLight(th.sun.color, th.sun.int);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -52; sc.right = 52; sc.top = 52; sc.bottom = -52; sc.near = 1; sc.far = 420;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04; sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  // ---- cloud seas ----
  const seas = [];
  for (const c of th.clouds || []) {
    const m = cloudSea({ ...c, fog: th.fog, sunDir: lightDir.clone().setY(Math.max(lightDir.y, 0.2)).normalize() });
    scene.add(m); seas.push(m);
  }

  // ---- scenery context ----
  const bounds = track.bounds, cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const events = { thunder: null };
  const ctx = {
    events, track, th, group, r, noise, wd: track.wallD, scene, sunDir, lightDir, hemi, sun, anim, cx, cz, bounds,
    place(geo, mat, list, { cast = false } = {}) { const im = instances(geo, mat, list); im.castShadow = cast; group.add(im); return im; },
    // random points in the 3D volume around the track. cb(x,y,z) -> instance | null
    volume(o0, cb) {
      // scenery density is tuned per 2 km of road
      const o = { ...o0, count: o0.fixed ? o0.count : Math.round(o0.count * Math.max(1, track.length / 2000)) };
      const out = [], tries = o.tries ?? o.count * 20, N = track.N, placed = [];
      for (let t = 0; t < tries && out.length < o.count; t++) {
        const i = (r() * N) | 0, a = r() * 6.28, d = o.minD + r() * (o.maxD - o.minD);
        const x = track.px[i] + Math.cos(a) * d, z = track.pz[i] + Math.sin(a) * d;
        const y = track.py[i] + o.minY + r() * (o.maxY - o.minY);
        const n = track.nearestSample(x, z, o.minD + 1);
        if (n && Math.sqrt(n.d2) < o.minD) continue;
        if (o.spacing && placed.some((q) => (q[0] - x) ** 2 + (q[1] - z) ** 2 < o.spacing * o.spacing)) continue;
        const it = cb(x, y, z); if (it) { out.push(it); placed.push([x, z]); }
      }
      return out;
    },
    ring(n, radius, fn) {
      const list = [], R0 = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
      for (let k = 0; k < n; k++) { const a = (k / n) * 6.28 + r() * 0.2; const o = fn(a, k); const rad = radius + R0 * 0.4 + r() * 120; list.push({ x: cx + Math.cos(a) * rad, z: cz + Math.sin(a) * rad, y: o.y, s: o.s, ry: r() * 6.28, color: o.color }); }
      return list;
    },
    cumulus(list, opts) { const im = cloudPuffs(list, { fog: th.fog, ...opts }); scene.add(im); return im; },
    floor(y, color) { const m = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), new THREE.MeshBasicMaterial({ color })); m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = -6; scene.add(m); anim.push((dt, t, cam) => { m.position.x = cam.position.x; m.position.z = cam.position.z; }); return m; },
    waterfall(x, y, z, w, h, ry) { const m = waterfall(w, h); m.position.set(x, y - h / 2, z); m.rotation.y = ry; group.add(m); anim.push((dt, t) => { m.material.uniforms.uTime.value = t; }); return m; },
    aurora() {
      const tex = canvasTex(256, 64, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(60,255,160,0)'); gr.addColorStop(0.35, 'rgba(60,255,160,0.6)'); gr.addColorStop(0.75, 'rgba(150,90,255,0.35)'); gr.addColorStop(1, 'rgba(150,90,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1600, 360, 40, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        const a = (k / 4) * 6.28 + 0.8; m.position.set(cx + Math.cos(a) * 1400, 420 + k * 30, cz + Math.sin(a) * 1400); m.lookAt(cx, 300, cz); m.renderOrder = -7; scene.add(m);
        const p = m.geometry.attributes.position, base = Float32Array.from(p.array);
        anim.push((dt, t) => { for (let i = 0; i < p.count; i++) p.setY(i, base[i * 3 + 1] + Math.sin(base[i * 3] * 0.008 + t * 0.5 + k) * 36 * (base[i * 3 + 1] > 0 ? 1 : 0.2)); p.needsUpdate = true; });
      }
    },
    islandGeo: islandGeometry, peakGeo: peakGeometry,
  };
  th.build(ctx);

  const tm = buildTrackMeshes(track, th, group);
  const wl = Array.isArray(th.weather) ? th.weather : th.weather ? [th.weather] : [];
  const weather = wl.filter((k) => k !== 'none').map((k) => new Weather(k, scene));

  return {
    scene, track, th, tm, weather, levelDef, events, sun, hemi, exposure: th.exposure, heightAt: () => -1000,
    update(dt, t, camera, focus, raceT = t) {
      sky.position.copy(camera.position);
      if (sunSpr) sunSpr.position.copy(glareDir).multiplyScalar(2300).add(camera.position);
      if (stars) stars.position.copy(camera.position);
      for (const m of seas) { m.position.x = camera.position.x; m.position.z = camera.position.z; m.material.uniforms.uTime.value = t; m.material.uniforms.uCam.value.copy(camera.position); }
      if (focus) { sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(shadowDir, 200); }
      for (const f of anim) f(dt, t, camera);
      for (const f of tm.anim) f(t);
      tm.updatePickups(t, raceT);
      for (const w of weather) w.update(dt, camera);
    },
    dispose() {
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k]) m[k].dispose(); m.dispose(); }); });
      for (const w of weather) w.dispose();
      if (envRT) envRT.dispose();
    },
  };
}
