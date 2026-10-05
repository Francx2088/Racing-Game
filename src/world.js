// Assembles a full level scene: sky, lights, terrain, water, track meshes, themed scenery, weather.
import * as THREE from 'three';
import { Track } from './track.js';
import { buildTerrain } from './terrain.js';
import { buildTrackMeshes } from './trackmesh.js';
import THEMES from './themes.js';
import { instances, litMat, part, merge, sph, tor, canvasTex, css } from './kit.js';
import { makeNoise, rng, clamp } from './util.js';
import { Weather } from './fx.js';

function skyDome(th) {
  const geo = new THREE.SphereGeometry(2600, 32, 20);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(th.sky[0]), mid = new THREE.Color(th.sky[1]), bot = new THREE.Color(th.sky[2]), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 2600;
    if (y > 0.18) c.copy(mid).lerp(top, Math.pow(clamp((y - 0.18) / 0.82, 0, 1), 0.7));
    else if (y > -0.02) c.copy(bot).lerp(mid, clamp((y + 0.02) / 0.2, 0, 1));
    else c.copy(bot);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10; m.frustumCulled = false;
  return m;
}
const glowSprite = (color, size, inner = 0.15) => {
  const t = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(inner, '#fff'); gr.addColorStop(inner + 0.12, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size); s.renderOrder = -9; return s;
};

export function buildWorld(levelDef) {
  const th = THEMES[levelDef.theme];
  const track = new Track(levelDef);
  const noise = makeNoise(levelDef.seed * 13 + 5);
  const r = rng(levelDef.seed * 101 + 9);
  const scene = new THREE.Scene();
  const group = new THREE.Group(); scene.add(group);
  const anim = [];
  scene.fog = new THREE.Fog(th.fog[0], th.fog[1], th.fog[2]);
  scene.background = new THREE.Color(th.fog[0]);

  // sky
  const sky = skyDome(th); scene.add(sky);
  const sunDir = new THREE.Vector3(...th.sun.pos).normalize();
  const sunSpr = glowSprite(th.sun.color, 520); sunSpr.position.copy(sunDir).multiplyScalar(2300); scene.add(sunSpr);
  let stars = null;
  if (th.stars) {
    const n = 1100, p = new Float32Array(n * 3); const rr = rng(3);
    for (let i = 0; i < n; i++) { const u = rr() * 2 - 1, a = rr() * 6.28, s = Math.sqrt(1 - u * u); const y = Math.abs(u) * 0.95 + 0.05; p.set([Math.cos(a) * s * 2400, y * 2400, Math.sin(a) * s * 2400], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 3.2, sizeAttenuation: false, color: 0xffffff, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
    stars.renderOrder = -9; scene.add(stars);
  }
  if (th.earth) {
    const tex = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#1f5fd0'; g.fillRect(0, 0, w, h); const q = rng(5); g.fillStyle = '#3fae5a'; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(q() * w, q() * h, 6 + q() * 20, 0, 7); g.fill(); } g.fillStyle = 'rgba(255,255,255,0.7)'; for (let i = 0; i < 50; i++) { g.beginPath(); g.ellipse(q() * w, q() * h, 10 + q() * 20, 3 + q() * 5, 0, 0, 7); g.fill(); } });
    const e = new THREE.Mesh(new THREE.SphereGeometry(190, 24, 16), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
    e.position.set(-900, 700, -1900); e.renderOrder = -8; scene.add(e);
    anim.push((dt) => { e.rotation.y += dt * 0.02; });
  }

  // lights
  scene.add(new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]));
  const sun = new THREE.DirectionalLight(th.sun.color, th.sun.int); sun.position.copy(sunDir).multiplyScalar(500); scene.add(sun);

  // terrain / ground
  let heightAt, terrain = null;
  if (th.terrain && !th.flatGround) {
    terrain = buildTerrain(track, th, noise); heightAt = terrain.heightAt; scene.add(terrain.mesh);
  } else if (th.flatGround) {
    heightAt = () => -0.6;
  } else {
    heightAt = () => -200;
  }
  // far ground / cloud floor so the horizon never shows void
  {
    const y = th.cloudFloor ?? (th.water ? th.water.y - 0.2 : (terrain ? -22 : -2));
    const farColor = th.cloudFloor != null ? 0xf0d8ff : (th.flatGround ? 0x0b0718 : th.fog[0]);
    if (!th.water) {
      let mat = new THREE.MeshBasicMaterial({ color: farColor });
      if (th.cloudFloor != null) {
        const tex = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#7a52d8'; g.fillRect(0, 0, w, h); const q = rng(4); for (let i = 0; i < 420; i++) { const x = q() * w, y = q() * h, rr = 14 + q() * 46; for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rr); const c = ['255,255,255', '255,190,240', '200,170,255'][i % 3]; gr.addColorStop(0, `rgba(${c},0.55)`); gr.addColorStop(1, `rgba(${c},0)`); g.fillStyle = gr; g.fillRect(x + ox - rr, y + oy - rr, rr * 2, rr * 2); } } }, { repeat: true });
        tex.repeat.set(45, 45); mat = new THREE.MeshBasicMaterial({ map: tex });
      }
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), mat);
      m.rotation.x = -Math.PI / 2; m.position.y = y; scene.add(m);
    }
  }
  let water = null;
  if (th.water) {
    const W = th.water;
    if (W.lava) {
      const tex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#c21a00'; g.fillRect(0, 0, w, h); const q = rng(9); for (let i = 0; i < 160; i++) { g.fillStyle = ['#ff5a00', '#ff9a1a', '#ffd23a', '#7a0d00'][i % 4]; g.globalAlpha = 0.5; g.beginPath(); g.ellipse(q() * w, q() * h, 4 + q() * 22, 3 + q() * 12, q() * 3, 0, 7); g.fill(); } }, { repeat: true });
      tex.repeat.set(220, 220);
      water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshBasicMaterial({ map: tex, color: 0xffb070 }));
      anim.push((dt, t) => { tex.offset.set(t * 0.004, t * 0.002); });
    } else {
      water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: W.color, transparent: true, opacity: W.opacity, roughness: 0.25, metalness: 0.1, envMapIntensity: 0.8 }));
    }
    water.rotation.x = -Math.PI / 2; water.position.y = W.y; scene.add(water);
  }

  // track visuals
  const tm = buildTrackMeshes(track, th, group, heightAt);

  // scenery context
  const bounds = track.bounds, cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const ctx = {
    track, th, group, r, noise, heightAt, wd: track.wallD, scene,
    place(geo, mat, list) { const im = instances(geo, mat, list); group.add(im); return im; },
    ring(n, radius, fn) {
      const list = [];
      const R0 = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
      for (let k = 0; k < n; k++) { const a = (k / n) * 6.28 + r() * 0.2; const o = fn(a); const rad = radius + R0 * 0.4 + r() * 80; list.push({ x: cx + Math.cos(a) * rad, z: cz + Math.sin(a) * rad, y: o.y, s: o.s, ry: r() * 6.28 }); }
      return list;
    },
    scatter(o, cb) {
      const out = [], tries = o.tries ?? o.count * 14, N = track.N, placed = [];
      for (let t = 0; t < tries && out.length < o.count; t++) {
        let x, z;
        if (o.wide) { x = cx + (r() - 0.5) * 2200; z = cz + (r() - 0.5) * 2200; }
        else {
          const i = (r() * N) | 0, a = r() * 6.28, d = o.minD + r() * (o.maxD - o.minD);
          x = track.px[i] + Math.cos(a) * d; z = track.pz[i] + Math.sin(a) * d;
        }
        const n = track.nearestSample(x, z, o.minD + 1);
        if (n && Math.sqrt(n.d2) < o.minD) continue;
        const h = heightAt(x, z);
        if (o.minH != null && h < o.minH) continue;
        if (o.maxH != null && h > o.maxH) continue;
        if (o.maxSlope != null) { const s = Math.max(Math.abs(heightAt(x + 4, z) - h), Math.abs(heightAt(x, z + 4) - h)) / 4; if (s > o.maxSlope) continue; }
        if (o.spacing && placed.some((q) => (q[0] - x) ** 2 + (q[1] - z) ** 2 < o.spacing * o.spacing)) continue;
        const item = cb(x, h, z);
        if (item) { out.push(item); placed.push([x, z]); }
      }
      return out;
    },
    clouds(n, color, op, low) {
      const puff = merge([part(sph(1, 7, 5), 0xffffff, { p: [0, 0, 0], s: [1.4, 0.7, 1] }), part(sph(0.8, 7, 5), 0xffffff, { p: [1.1, -0.1, 0.2], s: [1, 0.6, 0.9] }), part(sph(0.9, 7, 5), 0xffffff, { p: [-1.1, -0.1, -0.1], s: [1, 0.65, 0.9] })]);
      const list = [];
      for (let k = 0; k < n; k++) { const a = r() * 6.28, rad = 200 + r() * 1400; list.push({ x: cx + Math.cos(a) * rad, y: low ? -30 + r() * 80 : 130 + r() * 150, z: cz + Math.sin(a) * rad, ry: r() * 6.28, s: [60 + r() * 90, 40 + r() * 40, 60 + r() * 90] }); }
      const im = instances(puff, new THREE.MeshBasicMaterial({ vertexColors: true, color, transparent: true, opacity: op, depthWrite: false }), list);
      group.add(im); anim.push((dt, t) => { im.position.x = Math.sin(t * 0.01) * 60; });
    },
    aurora() {
      const tex = canvasTex(256, 64, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(60,255,160,0)'); gr.addColorStop(0.35, 'rgba(60,255,160,0.55)'); gr.addColorStop(0.7, 'rgba(150,90,255,0.35)'); gr.addColorStop(1, 'rgba(150,90,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
      for (let k = 0; k < 3; k++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1500, 300, 30, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        const a = (k / 3) * 6.28 + 1; m.position.set(cx + Math.cos(a) * 1300, 380 + k * 40, cz + Math.sin(a) * 1300); m.lookAt(cx, 300, cz); m.renderOrder = -7; scene.add(m);
        const p = m.geometry.attributes.position, base = Float32Array.from(p.array);
        anim.push((dt, t) => { for (let i = 0; i < p.count; i++) p.setY(i, base[i * 3 + 1] + Math.sin(base[i * 3] * 0.01 + t * 0.6 + k) * 30 * (base[i * 3 + 1] > 0 ? 1 : 0.2)); p.needsUpdate = true; });
      }
    },
    rainbow() {
      const cols = [0xff4d6d, 0xffa51f, 0xffe94d, 0x4dff88, 0x4dc9ff, 0x9b6dff];
      const g = new THREE.Group();
      cols.forEach((c, i) => { const t = new THREE.Mesh(new THREE.TorusGeometry(500 - i * 22, 11, 6, 40, Math.PI), new THREE.MeshBasicMaterial({ color: c, fog: true, transparent: true, opacity: 0.85 })); g.add(t); });
      g.position.set(cx - 200, -40, cz - 900); scene.add(g);
    },
    gridFloor(line, bg) {
      const t = canvasTex(128, 128, (g, w, h) => { g.fillStyle = css(bg); g.fillRect(0, 0, w, h); g.strokeStyle = css(line); g.lineWidth = 3; g.globalAlpha = 0.55; g.strokeRect(0, 0, w, h); }, { repeat: true });
      t.repeat.set(2400 / 24, 2400 / 24);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshBasicMaterial({ map: t }));
      m.rotation.x = -Math.PI / 2; m.position.set(cx, -0.62, cz); scene.add(m);
    },
    skyline(c1, c2) {
      const list = []; for (let k = 0; k < 90; k++) { const a = r() * 6.28, rad = 1000 + r() * 500; const w = 50 + r() * 90; list.push({ x: cx + Math.cos(a) * rad, y: -2, z: cz + Math.sin(a) * rad, ry: r() * 3, s: [w, 150 + r() * 330, w * (0.7 + r() * 0.8)], color: [0x2a1a66, 0x4b1d7a, 0x1b2a6e][k % 3] }); }
      const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
      group.add(instances(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), list));
    },
  };
  th.build(ctx);

  const weather = th.weather && th.weather !== 'none' ? new Weather(th.weather, scene) : null;

  return {
    scene, track, th, heightAt, tm, weather, levelDef,
    update(dt, t, camera) {
      sky.position.copy(camera.position); sunSpr.position.copy(sunDir).multiplyScalar(2300).add(camera.position);
      if (stars) stars.position.copy(camera.position);
      for (const f of anim) f(dt, t);
      for (const f of tm.anim) f(t);
      tm.updatePickups(t);
      if (weather) weather.update(dt, camera);
      if (water && !th.water.lava) { water.position.x = camera.position.x; water.position.z = camera.position.z; }
      else if (water) { water.position.x = camera.position.x; water.position.z = camera.position.z; }
    },
    dispose() {
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); });
      if (weather) weather.dispose();
    },
  };
}
