// Visual meshes for a Track: road, kerbs, shoulders, walls, start gantry, boost pads, hazard zones, ramps,
// plus instanced coins / nitro cells / obstacles.
import * as THREE from 'three';
import { canvasTex, css, part, merge, cyl, cone, box, ico, sph, tor, oct, litMat, instances } from './kit.js';
import { rng } from './util.js';

// Build a strip along the track between two lateral/vertical offsets.
// a/b: {d, dy}. s0/s1 limit by arc length (null = whole loop). Returns BufferGeometry.
export function strip(track, a, b, { s0 = 0, s1 = null, vTile = 20, color = null, lift = 0 } = {}) {
  const N = track.N, sp = track.spacing;
  const i0 = Math.floor(s0 / sp), i1 = s1 == null ? N : Math.ceil(s1 / sp);
  const cnt = i1 - i0 + 1;
  const pos = new Float32Array(cnt * 6), uv = new Float32Array(cnt * 4), col = color ? new Float32Array(cnt * 6) : null;
  const idx = [];
  const c = new THREE.Color();
  for (let k = 0; k < cnt; k++) {
    const i = (i0 + k) % N;
    const tb = Math.tan(track.bank[i]);
    const rx = track.rx[i], rz = track.rz[i];
    const put = (slot, o) => {
      const o3 = (k * 2 + slot) * 3;
      pos[o3] = track.px[i] + rx * o.d;
      pos[o3 + 1] = track.py[i] + tb * o.d + o.dy + lift;
      pos[o3 + 2] = track.pz[i] + rz * o.d;
    };
    put(0, a); put(1, b);
    const v = ((i0 + k) * sp) / vTile;
    uv[k * 4] = 0; uv[k * 4 + 1] = v; uv[k * 4 + 2] = 1; uv[k * 4 + 3] = v;
    if (col) { c.set(color(i0 + k)); col.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6); }
    if (k < cnt - 1) { const j = k * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function roadTexture(th) {
  const R = th.road;
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = css(R.base); g.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${R.speck},${0.05 + r() * 0.1})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    if (R.style === 'rainbow') {
      const cols = ['#ff4d6d', '#ff9f1c', '#ffe94d', '#4dff88', '#4dc9ff', '#9b6dff'];
      const bw = (w - 40) / cols.length;
      cols.forEach((c, i) => { g.fillStyle = c; g.globalAlpha = 0.9; g.fillRect(20 + i * bw, 0, bw + 1, h); });
      g.globalAlpha = 1;
      for (let i = 0; i < 80; i++) { g.fillStyle = 'rgba(255,255,255,0.7)'; const s = 1 + r() * 2; g.fillRect(r() * w, r() * h, s, s); }
    }
    if (R.style === 'cracks') {
      g.strokeStyle = 'rgba(255,120,20,0.8)'; g.lineWidth = 2;
      for (let i = 0; i < 14; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 60; y += (r() - 0.2) * 50; g.lineTo(x, y); } g.stroke(); }
    }
    // edge lines + dashed centre
    g.fillStyle = css(R.line); g.shadowColor = R.glow ? css(R.line) : 'transparent'; g.shadowBlur = R.glow ? 10 : 0;
    g.fillRect(10, 0, 8, h); g.fillRect(w - 18, 0, 8, h);
    if (R.center !== false) { g.fillStyle = css(R.centerColor ?? R.line); for (let y = 0; y < h; y += 128) g.fillRect(w / 2 - 4, y + 16, 8, 64); }
  }, { repeat: true });
}
const kerbTexture = (a, b) => canvasTex(16, 64, (g) => { g.fillStyle = css(a); g.fillRect(0, 0, 16, 32); g.fillStyle = css(b); g.fillRect(0, 32, 16, 32); }, { repeat: true });

const arrowTex = () => canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = 'rgba(0,28,20,0.62)'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(24,255,176,0.9)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = '#18ffb0'; g.shadowColor = '#18ffb0'; g.shadowBlur = 12;
  for (let k = 0; k < 2; k++) { const y = k * 128; g.beginPath(); g.moveTo(w / 2, y + 10); g.lineTo(w - 14, y + 70); g.lineTo(w - 38, y + 70); g.lineTo(w / 2, y + 36); g.lineTo(38, y + 70); g.lineTo(14, y + 70); g.closePath(); g.fill(); }
}, { repeat: true });

const ZONE = {
  ice: { c: '#bfe9ff', a: 0.85, noise: '#ffffff' }, sand: { c: '#d9b56a', a: 0.9, noise: '#f0d89a' }, oil: { c: '#101018', a: 0.9, noise: '#334' },
  mud: { c: '#5a3a1f', a: 0.92, noise: '#7a5330' }, syrup: { c: '#9b2d8f', a: 0.88, noise: '#d65bd0' }, dust: { c: '#8a8a92', a: 0.9, noise: '#bbbbc4' },
  leaves: { c: '#c8641a', a: 0.9, noise: '#f0a020' },
};
function zoneTex(type) {
  const z = ZONE[type]; const r = rng(type.length * 31);
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = z.c; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { g.fillStyle = z.noise; g.globalAlpha = 0.25; g.beginPath(); g.arc(r() * w, r() * h, 2 + r() * 8, 0, 7); g.fill(); }
    g.globalAlpha = 1;
    // feather edges via destination-out gradient
    g.globalCompositeOperation = 'destination-out';
    const f = (x0, y0, x1, y1) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; };
    f(0, 0, 22, 0); g.fillRect(0, 0, 22, h); f(w, 0, w - 22, 0); g.fillRect(w - 22, 0, 22, h);
    f(0, 0, 0, 22); g.fillRect(0, 0, w, 22); f(0, h, 0, h - 22); g.fillRect(0, h - 22, w, 22);
  });
}

export function buildTrackMeshes(track, th, group, heightAt) {
  const R = th.road, hw = track.hw, wd = track.wallD, N = track.N;
  const out = { anim: [], update: null };
  const mk = (geo, mat, order = 0) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; m.frustumCulled = false; group.add(m); return m; };
  const dbl = { side: THREE.DoubleSide };

  // road
  const roadTex = roadTexture(th);
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: R.rough ?? 0.85, metalness: R.metal ?? 0, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  if (R.emissive) { roadMat.emissive = new THREE.Color(R.emissive); roadMat.emissiveMap = roadTex; roadMat.emissiveIntensity = R.emissiveInt ?? 0.6; }
  const road = strip(track, { d: -hw, dy: 0 }, { d: hw, dy: 0 }, { vTile: 32 });
  mk(road, roadMat);
  // map aspect: texture is 256x512 for 32m along => repeat handled by uv v; set wrapping
  // kerbs
  const kt = kerbTexture(R.kerbA, R.kerbB);
  const kerbMat = new THREE.MeshLambertMaterial({ map: kt, side: THREE.DoubleSide });
  for (const sgn of [-1, 1]) {
    const g = strip(track, { d: sgn * (hw - 0.2), dy: 0.03 }, { d: sgn * (hw + 1.3), dy: 0.03 }, { vTile: 6 });
    mk(g, kerbMat, 1);
  }
  // shoulders
  const sh = new THREE.Color(R.shoulder), r1 = rng(5);
  const vari = Array.from({ length: N + 2 }, () => 0.9 + r1() * 0.2);
  if (track.shoulder > 1) {
    for (const sgn of [-1, 1]) {
      const g = strip(track, { d: sgn * (hw + 1.3), dy: 0.0 }, { d: sgn * wd, dy: -0.05 }, { color: (i) => sh.clone().multiplyScalar(vari[i % N]).getHex() });
      mk(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    }
  }
  // walls
  const wallH = R.wallH ?? 0.95;
  const wallTex = canvasTex(8, 64, (g) => { g.fillStyle = css(R.wallA); g.fillRect(0, 0, 8, 32); g.fillStyle = css(R.wallB); g.fillRect(0, 32, 8, 32); }, { repeat: true });
  wallTex.magFilter = wallTex.minFilter = THREE.NearestFilter; wallTex.generateMipmaps = false;
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide });
  for (const sgn of [-1, 1]) {
    const geos = [
      strip(track, { d: sgn * wd, dy: -3 }, { d: sgn * wd, dy: wallH }, { vTile: 16 }),
      strip(track, { d: sgn * wd, dy: wallH }, { d: sgn * (wd + 0.7), dy: wallH }, { vTile: 16 }),
      strip(track, { d: sgn * (wd + 0.7), dy: wallH }, { d: sgn * (wd + 0.7), dy: -3 }, { vTile: 16 }),
    ];
    for (const g of geos) mk(g, wallMat);
    if (R.wallGlow) {
      const g = strip(track, { d: sgn * (wd - 0.05), dy: wallH * 0.55 }, { d: sgn * (wd - 0.05), dy: wallH * 0.8 }, { color: () => R.wallGlow });
      mk(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), 2);
    }
  }

  // hazard zones
  for (const z of track.zones) {
    const g = strip(track, { d: z.d0, dy: 0.02 }, { d: z.d1, dy: 0.02 }, { s0: z.s0, s1: z.s1, vTile: z.s1 - z.s0 });
    const m = mk(g, new THREE.MeshStandardMaterial({ map: zoneTex(z.type), transparent: true, opacity: ZONE[z.type].a, roughness: z.type === 'ice' || z.type === 'oil' ? 0.15 : 0.9, metalness: z.type === 'ice' ? 0.2 : 0, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 3);
  }

  // start / finish line
  {
    const ck = canvasTex(128, 32, (g, w, h) => { const s = 16; for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) & 1 ? '#fff' : '#111'; g.fillRect(x * s, y * s, s, s); } }, { repeat: false });
    const g = strip(track, { d: -hw, dy: 0.04 }, { d: hw, dy: 0.04 }, { s0: 0, s1: 4, vTile: 4 });
    mk(g, new THREE.MeshBasicMaterial({ map: ck, side: THREE.DoubleSide }), 4);
    // gantry
    const i0 = 1, P = (d, y) => new THREE.Vector3(track.px[i0] + track.rx[i0] * d, track.py[i0] + y, track.pz[i0] + track.rz[i0] * d);
    const gantry = new THREE.Group();
    const pillarMat = new THREE.MeshLambertMaterial({ color: R.gantry ?? 0x2a2f3a });
    const pg = new THREE.CylinderGeometry(0.6, 0.8, 11, 8);
    for (const s of [-1, 1]) { const p = new THREE.Mesh(pg, pillarMat); p.position.copy(P(s * (wd + 1.4), 5.5)); gantry.add(p); }
    const banner = canvasTex(1024, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, css(th.accent)); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, css(th.accent));
      g.fillStyle = '#10131c'; g.fillRect(0, 0, w, h);
      g.fillStyle = gr; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
      g.font = 'italic 900 78px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = gr; g.fillText('TURBO RACING', w / 2, h / 2 + 4);
    });
    const bm = new THREE.Mesh(new THREE.BoxGeometry((wd + 1.4) * 2 + 1.6, 3.2, 1), [pillarMat, pillarMat, pillarMat, pillarMat, new THREE.MeshBasicMaterial({ map: banner }), new THREE.MeshBasicMaterial({ map: banner })]);
    bm.position.copy(P(0, 11.2)); bm.rotation.y = track.head[i0]; gantry.add(bm);
    group.add(gantry);
  }

  // boost pads
  const at = arrowTex();
  const padMat = new THREE.MeshBasicMaterial({ map: at, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  for (const p of track.pads) {
    const g = strip(track, { d: p.d - p.w, dy: 0.05 }, { d: p.d + p.w, dy: 0.05 }, { s0: p.s, s1: p.s + p.len, vTile: p.w * 2 });
    mk(g, padMat, 5);
  }
  out.anim.push((t) => { at.offset.y = -t * 1.2; });

  // ramps
  const rampMat = new THREE.MeshLambertMaterial({ color: R.ramp ?? 0xffb020, side: THREE.DoubleSide });
  const stripeTex = canvasTex(64, 64, (g) => { g.fillStyle = '#ffcc22'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#222'; for (let i = -1; i < 3; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 48, 64); g.lineTo(i * 32 + 32, 64); g.fill(); } }, { repeat: true });
  const rampTexMat = new THREE.MeshLambertMaterial({ map: stripeTex, side: THREE.DoubleSide });
  for (const q of track.ramps) {
    const n = 8, verts = [], uvs = [], ind = [];
    for (let k = 0; k <= n; k++) {
      const s = q.s + (q.len * k) / n, h = q.h * (k / n);
      const pA = track.pointAt(s, -q.w), pB = track.pointAt(s, q.w);
      verts.push(pA.x, pA.y + h + 0.05, pA.z, pB.x, pB.y + h + 0.05, pB.z);
      uvs.push(0, k, 1, k);
      if (k < n) { const j = k * 2; ind.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(ind); g.computeVertexNormals();
    mk(g, rampTexMat, 2);
    // back face + sides
    const e = track.pointAt(q.s + q.len, 0), a = track.pointAt(q.s + q.len, -q.w), b = track.pointAt(q.s + q.len, q.w), a0 = track.pointAt(q.s, -q.w), b0 = track.pointAt(q.s, q.w);
    const bf = new THREE.BufferGeometry();
    bf.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y + 0.05, a.z, b.x, b.y + 0.05, b.z, a.x, a.y + q.h, a.z, b.x, b.y + q.h, b.z, a0.x, a0.y, a0.z, b0.x, b0.y, b0.z], 3));
    bf.setIndex([0, 1, 2, 1, 3, 2, 0, 2, 4, 1, 5, 3]); bf.computeVertexNormals();
    mk(bf, rampMat, 2);
  }

  // coins / nitro / obstacles
  const coinGeo = merge([part(cyl(0.7, 0.7, 0.14, 14), 0xffc61a, { r: [Math.PI / 2, 0, 0] }), part(cyl(0.45, 0.45, 0.18, 14), 0xfff0a0, { r: [Math.PI / 2, 0, 0] })]);
  const coinMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const coinsIM = instances(coinGeo, coinMat, track.coins.map(() => ({ x: 0, y: 0, z: 0 })));
  group.add(coinsIM);
  const nitroGeo = merge([part(oct(0.95), 0x2ad4ff), part(oct(0.55), 0xd9f8ff, { r: [0, 0.7, 0] })]);
  const nitroIM = instances(nitroGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), track.nitros.map(() => ({ x: 0, y: 0, z: 0 })));
  group.add(nitroIM);
  const cp = track.coins.map((c) => track.pointAt(c.s, c.d)); const np = track.nitros.map((c) => track.pointAt(c.s, c.d));
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  out.updatePickups = (t) => {
    track.coins.forEach((c, i) => {
      const p = cp[i]; const s = c.taken ? 0.0001 : 1;
      ee.set(0, t * 2.5 + i * 0.4, 0); qq.setFromEuler(ee); v3.set(p.x, p.y + 1.15 + Math.sin(t * 3 + i) * 0.12, p.z); sc.setScalar(s);
      m4.compose(v3, qq, sc); coinsIM.setMatrixAt(i, m4);
    });
    coinsIM.instanceMatrix.needsUpdate = true;
    track.nitros.forEach((c, i) => {
      const p = np[i]; const s = c.taken ? 0.0001 : 1;
      ee.set(0, t * 1.8, 0.3 * Math.sin(t * 2)); qq.setFromEuler(ee); v3.set(p.x, p.y + 1.6 + Math.sin(t * 2.2 + i) * 0.25, p.z); sc.setScalar(s);
      m4.compose(v3, qq, sc); nitroIM.setMatrixAt(i, m4);
    });
    nitroIM.instanceMatrix.needsUpdate = true;
  };

  // obstacles (static instances, hidden when hit)
  const og = obstacleGeo(track.def.obstacles.kind, th);
  const obsPos = track.obstacles.map((o) => ({ p: track.pointAt(o.s, o.d), rot: o.rot }));
  const obsIM = instances(og.geo, og.mat, obsPos.map((o) => ({ x: o.p.x, y: o.p.y, z: o.p.z, ry: o.rot })));
  group.add(obsIM);
  out.obstacleIM = obsIM;
  out.obstacleRadius = og.radius;
  out.hideObstacle = (i) => { obsIM.getMatrixAt(i, m4); m4.scale(new THREE.Vector3(0.0001, 0.0001, 0.0001)); obsIM.setMatrixAt(i, m4); obsIM.instanceMatrix.needsUpdate = true; };
  out.showObstacles = () => { track.obstacles.forEach((o, i) => { const p = obsPos[i].p; ee.set(0, obsPos[i].rot, 0); qq.setFromEuler(ee); m4.compose(v3.set(p.x, p.y, p.z), qq, sc.setScalar(1)); obsIM.setMatrixAt(i, m4); }); obsIM.instanceMatrix.needsUpdate = true; };
  return out;
}

function obstacleGeo(kind, th) {
  const lit = litMat();
  const K = {
    cone: () => ({ g: merge([part(cone(0.55, 1.5, 8), 0xff6a13, { p: [0, 0.85, 0] }), part(cyl(0.58, 0.58, 0.12, 8), 0xffffff, { p: [0, 0.55, 0], s: [0.9, 1, 0.9] }), part(box(1.2, 0.12, 1.2), 0x222222, { p: [0, 0.06, 0] })]), r: 0.9 }),
    barrel: () => ({ g: merge([part(cyl(0.7, 0.7, 1.4, 10), 0xc8321c, { p: [0, 0.7, 0] }), part(cyl(0.72, 0.72, 0.18, 10), 0xeeeeee, { p: [0, 0.7, 0] }), part(cyl(0.72, 0.72, 0.1, 10), 0x333333, { p: [0, 1.38, 0] })]), r: 1.0 }),
    bollard: () => ({ g: merge([part(cyl(0.4, 0.5, 1.6, 8), 0x2a2d3a, { p: [0, 0.8, 0] }), part(cyl(0.42, 0.42, 0.25, 8), 0xff2bd6, { p: [0, 1.5, 0] }), part(cyl(0.52, 0.52, 0.2, 8), 0x00f0ff, { p: [0, 0.3, 0] })]), r: 0.9, basic: true }),
    iceblock: () => ({ g: merge([part(box(2.0, 1.6, 2.0), 0xa6e3ff, { p: [0, 0.8, 0], r: [0, 0.4, 0] }), part(box(1.2, 2.3, 1.2), 0xd6f4ff, { p: [0.3, 1.1, 0.2], r: [0, 0.9, 0] })]), r: 1.5 }),
    log: () => ({ g: merge([part(cyl(0.6, 0.6, 3.6, 8), 0x7a4a24, { p: [0, 0.6, 0], r: [0, 0, Math.PI / 2] }), part(cyl(0.45, 0.45, 3.7, 8), 0x9a6a3c, { p: [0, 0.6, 0], r: [0, 0, Math.PI / 2] })]), r: 1.6 }),
    rock: () => ({ g: merge([part(ico(1.3, 0), 0x3b3340, { p: [0, 0.9, 0], s: [1.2, 0.9, 1] }), part(ico(0.8, 0), 0xff5a1f, { p: [0.7, 0.4, 0.4], s: 0.6 })]), r: 1.3 }),
    gumdrop: () => ({ g: merge([part(sph(1.1, 10, 7), 0xff4fa3, { p: [0, 0.6, 0], s: [1, 0.85, 1] }), part(cyl(1.15, 1.15, 0.3, 10), 0xffffff, { p: [0, 0.15, 0] })]), r: 1.15 }),
    moonrock: () => ({ g: merge([part(ico(1.2, 0), 0x8d8d99, { p: [0, 0.7, 0], s: [1.2, 0.8, 1] }), part(ico(0.6, 0), 0xb4b4c0, { p: [0.8, 0.35, 0.5] })]), r: 1.3 }),
    haybale: () => ({ g: merge([part(cyl(0.9, 0.9, 1.5, 12), 0xe0b43c, { p: [0, 0.9, 0], r: [0, 0, Math.PI / 2] }), part(cyl(0.93, 0.93, 0.12, 12), 0xb88a22, { p: [0, 0.9, 0], r: [0, 0, Math.PI / 2] })]), r: 1.2 }),
    star: () => ({ g: merge([part(oct(1.3), 0xffe94d, { p: [0, 1.4, 0], s: [1, 1.2, 1] }), part(oct(0.8), 0xff8a1f, { p: [0, 1.4, 0], r: [0.6, 0.6, 0], s: 1 })]), r: 1.2, basic: true }),
  };
  const o = K[kind]();
  return { geo: o.g, mat: o.basic ? new THREE.MeshBasicMaterial({ vertexColors: true }) : lit, radius: o.r };
}
