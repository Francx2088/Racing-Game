// The 10 sky worlds: physically based sky, cloud layers, lighting, road look, scenery, weather
// and the things that move in the sky around the course.
import * as THREE from 'three';
import { part, merge, cyl, cone, box, ico, sph, tor, oct, litMat, glowMat, instances, canvasTex, css } from './kit.js';
import { islandGeometry, peakGeometry } from './sky.js';
import { smooth, clamp, rng, makeNoise3 } from './util.js';

const gray = (v) => new THREE.Color(v, v, v).getHex();
const vary = (r, lo = 0.75) => gray(lo + (1 - lo) * r());
const rockMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, envMapIntensity: 0.5 });
const stdMat = (o = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, ...o });

// ---------- shared prop geometries ----------
const pine = (snow = false, dark = 0x1d5a34, mid = 0x25703f, light = 0x2f8a4d) => merge([
  part(cyl(0.35, 0.5, 2.2, 7), 0x5b3b22, { p: [0, 1.1, 0] }),
  part(cone(2.7, 4.2, 9), dark, { p: [0, 4.1, 0] }), part(cone(2.1, 3.6, 9), mid, { p: [0, 6.3, 0] }), part(cone(1.4, 3.0, 9), light, { p: [0, 8.3, 0] }),
  ...(snow ? [part(cone(2.0, 1.6, 9), 0xffffff, { p: [0, 5.55, 0] }), part(cone(1.5, 1.4, 9), 0xffffff, { p: [0, 7.6, 0] })] : []),
]);
const palm = () => {
  const parts = [];
  for (let k = 0; k < 5; k++) parts.push(part(cyl(0.3 - k * 0.02, 0.36 - k * 0.02, 1.9, 7), 0x9a6b3d + k * 0x050505, { p: [k * 0.18, 0.95 + k * 1.8, 0], r: [0, 0, -0.1] }));
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; parts.push(part(cone(0.75, 4.4, 4), k % 2 ? 0x2f9e4a : 0x3fbf5a, { p: [0.9 + Math.cos(a) * 1.8, 9.2, Math.sin(a) * 1.8], r: [Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3], s: [1, 1, 0.3] })); }
  return merge(parts);
};
const roundTree = (trunk, c1, c2) => merge([part(cyl(0.45, 0.65, 3.4, 7), trunk, { p: [0, 1.7, 0] }), part(ico(2.8, 1), c1, { p: [0, 5.2, 0], s: [1, 0.9, 1] }), part(ico(2.0, 1), c2, { p: [1.4, 6.6, 0.6] }), part(ico(1.8, 1), c2, { p: [-1.4, 6.2, -0.8] })]);
const column = (c = 0xf2eee4) => merge([part(cyl(1.1, 1.3, 0.6, 14), c, { p: [0, 0.3, 0] }), part(cyl(0.85, 0.95, 9, 14), c, { p: [0, 5.1, 0] }), part(cyl(1.2, 1.0, 0.6, 14), c, { p: [0, 9.8, 0] })]);

function buildingGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv, nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) { const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)); const u = ny > 0.5 ? 0 : (nx > 0.5 ? d : w) / 5, v = ny > 0.5 ? 0 : h / 6; uv.setXY(i, uv.getX(i) * Math.max(u, 0.01), uv.getY(i) * Math.max(v, 0.01)); }
  g.translate(0, h / 2, 0); return g;
}
const windowTex = (palette, seed = 1) => { const q = rng(seed); return canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#05050f'; g.fillRect(0, 0, w, h); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const on = q() < 0.6; g.fillStyle = on ? palette[(x * 3 + y * 7) % palette.length] : '#101024'; g.fillRect(x * 16 + 3, y * 16 + 4, 10, 9); } }, { repeat: true }); };
const signTex = (text, c1, c2) => canvasTex(256, 96, (g, w, h) => { g.fillStyle = '#0a0620'; g.fillRect(0, 0, w, h); g.strokeStyle = c1; g.lineWidth = 6; g.shadowColor = c1; g.shadowBlur = 14; g.strokeRect(6, 6, w - 12, h - 12); g.font = 'italic 900 52px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = c2; g.shadowColor = c2; g.fillText(text, w / 2, h / 2 + 3); });

// Gate (arch/ring) over the track at distance s.
function gate(ctx, s, { kind = 'arch', color = 0x888888, glow = 0xffffff, height = 13, metal = false }) {
  const { track, group } = ctx; const p = track.pointAt(s, 0), wd = track.wallD + 0.3; const g = new THREE.Group();
  if (kind === 'ring') {
    const rad = wd + 3; const m = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.55, 10, 48), new THREE.MeshBasicMaterial({ color: glow })); m.position.y = rad * 0.75; g.add(m);
  } else {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: metal ? 0.35 : 0.85, metalness: metal ? 0.85 : 0, flatShading: !metal });
    for (const sg of [-1, 1]) { const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, height, 10), mat); pl.position.set(sg * wd, height / 2 - 1, 0); pl.castShadow = true; g.add(pl); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(wd * 2 + 2.2, 1.8, 2), mat); beam.position.y = height; beam.castShadow = true; g.add(beam);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(wd * 2 + 2.4, 0.25, 2.1), new THREE.MeshBasicMaterial({ color: glow })); strip.position.y = height - 1.0; g.add(strip);
  }
  g.position.set(p.x, p.y, p.z); g.rotation.y = p.head; group.add(g);
}
// checkpoint gates (the first checkpoint is the start gantry)
const gatesEvery = (ctx, n, opts) => { for (const s of ctx.track.checkpoints.slice(1)) gate(ctx, s, opts); };

// Scatter floating islands; returns [{x,y,z,R}] and places the instanced rock.
function islands(ctx, { count, variants = 3, minD = 70, maxD = 520, minY = -90, maxY = 60, size = [25, 80], flatY = 1, geo = {}, seed = 1, spacing = 120, depth = 1.5 }) {
  const { r } = ctx; const geos = Array.from({ length: variants }, (_, k) => islandGeometry(seed * 17 + k, { depth, ...geo }));
  const buckets = geos.map(() => []); const info = [];
  ctx.volume({ count, minD, maxD, minY, maxY, spacing, tries: count * 60 }, (x, y, z) => {
    const R = size[0] + r() * (size[1] - size[0]); const k = (r() * variants) | 0;
    buckets[k].push({ x, y, z, ry: r() * 6.28, s: [R, R * flatY, R] }); info.push({ x, y, z, R, ry: 0, k }); return { ok: 1 };
  });
  const mat = rockMat(); geos.forEach((g, k) => ctx.place(g, mat, buckets[k]));
  return info;
}
// Put props on top of islands
function onIslands(ctx, info, geo, mat, { per = 6, spread = 0.65, scale = [0.8, 1.3], topY = 0.13, tint = 0.85 }) {
  const { r } = ctx, list = [];
  for (const i of info) for (let k = 0; k < per; k++) { const a = r() * 6.28, d = Math.sqrt(r()) * spread * i.R; const sc = i.R / 40; list.push({ x: i.x + Math.cos(a) * d, y: i.y + topY * i.R, z: i.z + Math.sin(a) * d, ry: r() * 6.28, s: Math.max(0.5, sc) * (scale[0] + r() * (scale[1] - scale[0])), color: vary(r, tint) }); }
  ctx.place(geo, mat, list);
}
function peaks(ctx, { count, minD, maxD, baseY, w = [120, 260], h = [180, 420], seed = 5, variants = 4, geo = {}, ring = 0, ringR = 1100 }) {
  const { r } = ctx; const geos = Array.from({ length: variants }, (_, k) => peakGeometry(seed * 11 + k, geo)); const buckets = geos.map(() => []);
  const add = (x, z, k) => { const W = w[0] + r() * (w[1] - w[0]), H = h[0] + r() * (h[1] - h[0]); buckets[k].push({ x, y: baseY, z, ry: r() * 6.28, s: [W, H, W] }); return true; };
  ctx.volume({ count, minD, maxD, minY: 0, maxY: 0, spacing: w[1] * 0.9, tries: count * 80 }, (x, y, z) => add(x, z, (r() * variants) | 0) ? { ok: 1 } : null);
  for (let k = 0; k < ring; k++) { const a = (k / ring) * 6.28 + r() * 0.3, rad = ringR + r() * 250; add(ctx.cx + Math.cos(a) * rad, ctx.cz + Math.sin(a) * rad, (r() * variants) | 0); }
  const mat = rockMat(); geos.forEach((g, k) => ctx.place(g, mat, buckets[k]));
}
function cumulusField(ctx, { count, minD = 110, maxD = 800, minY = -60, maxY = 120, size = [60, 160], tint, shade, opacity = 0.92, sy = 0.62 }) {
  const { r } = ctx; const list = ctx.volume({ count, minD, maxD, minY, maxY, spacing: 30 }, (x, y, z) => ({ x, y, z, s: size[0] + r() * (size[1] - size[0]), sy: sy * (0.8 + r() * 0.5) }));
  ctx.cumulus(list, { tint, shade, opacity, seed: 3 });
}


// ---------- moving sky props ----------
const wing = (side, len, w, color) => part(box(len, 0.08, w), color, { p: [side * len / 2, 0, 0] });
// A flock of flapping birds (body + two wings, all instanced).
function birds(ctx, { count, color = 0x2a2a30, size = 1, minY = 10, maxY = 90, minD = 40, maxD = 380, speed = 14, flap = 9 }) {
  const { r } = ctx;
  const list = ctx.volume({ count, minD, maxD, minY, maxY }, (x, y, z) => ({ x, y, z, R: 25 + r() * 60, w: (speed / 50) * (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.6), ph: r() * 6.28, s: size * (0.7 + r() * 0.6) }));
  const pose = (it, t, o) => { const a = it.ph + t * it.w; o.x = it.x + Math.cos(a) * it.R; o.z = it.z + Math.sin(a) * it.R; o.y = it.y + Math.sin(t * 0.7 + it.ph) * 3; o.ry = -a + (it.w > 0 ? 0 : Math.PI); };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  ctx.movers(merge([part(cone(0.25, 1.6, 5), color, { r: [Math.PI / 2, 0, 0] })]), mat, list, pose);
  for (const sd of [-1, 1]) ctx.movers(merge([wing(sd, 1.6, 0.7, color)]), mat, list, (it, t, o) => { pose(it, t, o); o.rz = sd * Math.sin(t * flap + it.ph) * 0.7; });
}
// Hot-air balloons that drift and bob.
function balloons(ctx, { count, colors }) {
  const { r } = ctx;
  colors.forEach((c, k) => {
    const geo = merge([
      part(sph(1, 14, 10), c[0], { p: [0, 7.5, 0], s: [6, 7, 6] }), part(cyl(6.05, 6.05, 1.4, 14), c[1], { p: [0, 7.8, 0] }), part(cyl(4.6, 4.6, 1.0, 14), c[1], { p: [0, 3.2, 0] }),
      part(cone(3.1, 3.4, 12), c[0], { p: [0, 1.2, 0], r: [Math.PI, 0, 0] }), part(box(1.6, 1.2, 1.6), 0x7a5230, { p: [0, -2.4, 0] }),
      ...[[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].map(([a, b]) => part(cyl(0.04, 0.04, 2.6, 3), 0x2a2a2a, { p: [a, -0.6, b] })),
    ]);
    const list = ctx.volume({ count, minD: 60, maxD: 520, minY: -30, maxY: 110, spacing: 60 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28, vx: (r() - 0.5) * 3, vz: (r() - 0.5) * 3, s: 0.8 + r() * 0.7 }));
    ctx.movers(geo, stdMat({ roughness: 0.75 }), list, (it, t, o) => { o.x = it.x + Math.sin(t * 0.05 + it.ph) * 40 + it.vx * Math.sin(t * 0.02) * 30; o.z = it.z + Math.cos(t * 0.04 + it.ph) * 40; o.y = it.y + Math.sin(t * 0.25 + it.ph) * 6; o.ry = t * 0.05 + it.ph; });
  });
}
// Airships with spinning props and blinking lights.
function airships(ctx, { count, hull = 0xc8c2b4, trim = 0x8a2a2a, speed = 9 }) {
  const { r } = ctx;
  const list = ctx.volume({ count, minD: 90, maxD: 600, minY: 10, maxY: 150, spacing: 160 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28, R: 150 + r() * 200, w: (speed / 200) * (r() < 0.5 ? -1 : 1), s: 1.6 + r() * 1.4 }));
  const pose = (it, t, o) => { const a = it.ph + t * it.w; o.x = it.x + Math.cos(a) * it.R; o.z = it.z + Math.sin(a) * it.R; o.y = it.y + Math.sin(t * 0.2 + it.ph) * 3; o.ry = -a + (it.w > 0 ? 0 : Math.PI); };
  ctx.movers(merge([
    part(sph(1, 18, 12), hull, { s: [5, 5, 20] }), part(cyl(5.05, 5.05, 2, 18), trim, { r: [Math.PI / 2, 0, 0], p: [0, 0, 4] }),
    part(box(2.4, 2, 7), 0x3a3a40, { p: [0, -5.6, 1] }), part(box(0.3, 7, 4), trim, { p: [0, 4, -17] }), part(box(7, 0.3, 4), trim, { p: [0, 0, -17] }),
  ]), stdMat({ roughness: 0.55, metalness: 0.1 }), list, pose);
  ctx.movers(merge([part(box(0.25, 5, 0.6), 0x222222, {}), part(box(5, 0.25, 0.6), 0x222222, {})]), stdMat(), list, (it, t, o) => { pose(it, t, o); const a = o.ry; o.x -= Math.sin(a) * 21 * it.s; o.z -= Math.cos(a) * 21 * it.s; o.rz = t * 9; });
  const blink = ctx.movers(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshBasicMaterial({ color: 0xff3030, fog: false }), list, (it, t, o) => { pose(it, t, o); o.y -= 7 * it.s; o.sx = o.sy = o.sz = ((t + it.ph) % 1.2) < 0.25 ? 1 : 0.001; });
  return blink;
}
// Big creatures swimming slow circles through the sky (mantas or whales).
function skyCreatures(ctx, { count, kind = 'manta', color = 0x3a4a7a, belly = 0xd8e0f0, glow = null }) {
  const { r } = ctx;
  const list = ctx.volume({ count, minD: 80, maxD: 520, minY: -20, maxY: 120, spacing: 120 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28, R: 60 + r() * 120, w: (r() < 0.5 ? -1 : 1) * (0.05 + r() * 0.05), s: kind === 'whale' ? 2.4 + r() * 1.6 : 1.5 + r() * 1.2 }));
  const pose = (it, t, o) => { const a = it.ph + t * it.w; o.x = it.x + Math.cos(a) * it.R; o.z = it.z + Math.sin(a) * it.R; o.y = it.y + Math.sin(t * 0.3 + it.ph) * 6; o.ry = -a + (it.w > 0 ? 0 : Math.PI); o.rx = Math.cos(t * 0.3 + it.ph) * 0.12; };
  const mat = stdMat({ roughness: 0.6, side: THREE.DoubleSide });
  if (kind === 'whale') {
    ctx.movers(merge([part(sph(1, 16, 10), color, { s: [3.2, 3, 9] }), part(sph(1, 12, 8), belly, { s: [2.6, 1.6, 7.5], p: [0, -1.5, 0.5] }), part(box(5, 0.3, 1.6), color, { p: [-3.4, -1, 2], r: [0, 0.4, -0.3] }), part(box(5, 0.3, 1.6), color, { p: [3.4, -1, 2], r: [0, -0.4, 0.3] })]), mat, list, pose);
    ctx.movers(merge([part(box(7, 0.3, 2.6), color, { p: [0, 0, -1.3] })]), mat, list, (it, t, o) => { pose(it, t, o); o.x -= Math.sin(o.ry) * 8.5 * it.s; o.z -= Math.cos(o.ry) * 8.5 * it.s; o.rx += Math.sin(t * 1.6 + it.ph) * 0.4; });
  } else {
    ctx.movers(merge([part(sph(1, 12, 8), color, { s: [2.2, 0.8, 3.6] }), part(box(0.25, 0.25, 7), color, { p: [0, 0, -6] }), part(box(0.6, 0.4, 1), belly, { p: [-1.1, -0.3, 3.4] }), part(box(0.6, 0.4, 1), belly, { p: [1.1, -0.3, 3.4] })]), mat, list, pose);
    for (const sd of [-1, 1]) ctx.movers(merge([part(new THREE.ConeGeometry(4.5, 7, 3), color, { p: [sd * 3.6, 0, 0], r: [Math.PI / 2, 0, sd * Math.PI / 2], s: [1, 1, 0.12] })]), mat, list, (it, t, o) => { pose(it, t, o); o.rz = sd * Math.sin(t * 1.2 + it.ph) * 0.45; });
  }
  if (glow != null) ctx.movers(merge([part(box(0.4, 0.4, 7), glow, { p: [0, 0.6 * (kind === 'whale' ? 4 : 1), 0] })]), new THREE.MeshBasicMaterial({ vertexColors: true }), list, pose);
}
// Glowing jellyfish that pulse and rise.
function jellyfish(ctx, { count, colors }) {
  const { r } = ctx;
  const geo = merge([part(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, {}), ...[0, 1, 2, 3, 4, 5].map((k) => part(cyl(0.05, 0.12, 4, 3), 0xffffff, { p: [Math.cos(k) * 0.6, -2, Math.sin(k) * 0.6] }))]);
  const list = ctx.volume({ count, minD: 30, maxD: 300, minY: -30, maxY: 70 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28, s: 1.5 + r() * 2.5, color: colors[(r() * colors.length) | 0] }));
  ctx.movers(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), list, (it, t, o) => { const p = Math.sin(t * 1.8 + it.ph); o.y = it.y + ((t * 1.5 + it.ph * 10) % 60) - 30; o.sx = o.sz = 1 + p * 0.15; o.sy = 1 - p * 0.15; o.ry = t * 0.2; });
}
// Flying traffic: glowing craft in long straight lanes.
function traffic(ctx, { lanes, colors, speed = 60 }) {
  const { r } = ctx, list = [];
  ctx.volume({ count: lanes, minD: 60, maxD: 420, minY: 15, maxY: 90 }, (x, y, z) => {
    const a = r() * 6.28, dx = Math.cos(a), dz = Math.sin(a), L = 1400, n = 10, v = speed * (0.7 + r() * 0.6) * (r() < 0.5 ? 1 : -1), col = colors[(r() * colors.length) | 0];
    for (let k = 0; k < n; k++) list.push({ x, y: y + (k % 2) * 3, z, dx, dz, L, off: (k / n) * L + r() * 40, v, ry: Math.atan2(dx, dz) + (v < 0 ? Math.PI : 0), color: col });
    return { ok: 1 };
  });
  const pose = (it, t, o) => { const u = ((((t * it.v + it.off) % it.L) + it.L) % it.L) - it.L / 2; o.x = it.x + it.dx * u; o.z = it.z + it.dz * u; };
  ctx.movers(merge([part(box(2.2, 0.8, 4.6), 0x1a1c24, {}), part(box(1.8, 0.6, 2.2), 0x2a3040, { p: [0, 0.6, -0.2] })]), stdMat({ roughness: 0.3, metalness: 0.7 }), list, pose);
  ctx.movers(merge([part(box(2.3, 0.15, 4.7), 0xffffff, { p: [0, -0.45, 0] }), part(box(1.6, 0.3, 0.1), 0xffffff, { p: [0, 0, -2.35] })]), new THREE.MeshBasicMaterial({ vertexColors: true }), list, pose);
}
// Rings that circle the road and spin (built from three arcs so the spin reads).
function roadRings(ctx, { every = 420, color, radius = 0, spin = 0.8, glow = true, start = 300 }) {
  const { track } = ctx, list = [], R = radius || track.wallD + 7;
  for (let s = start; s < track.finishS - 100; s += every) { if (!track.hasRoad(s)) continue; const p = track.pointAt(s, 0); list.push({ x: p.x, y: p.y + R * 0.42, z: p.z, ry: p.head, ph: s * 0.01 }); }
  const arcs = merge([0, 1, 2].map((k) => part(tor(R, 0.7, 6, 40, Math.PI * 0.5), 0xffffff, { r: [0, 0, (k * Math.PI * 2) / 3] })));
  const mat = glow ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.25 });
  ctx.movers(arcs, mat, list, (it, t, o) => { o.rz = t * spin + it.ph; });
}
// Things that orbit a centre: rocks round a molten core, satellites round a station.
function orbiters(ctx, { centres, geo, mat, per = 8, R = [40, 90], speed = 0.2, tumble = 1, scale = [1, 3] }) {
  const { r } = ctx, list = [];
  for (const c of centres) for (let k = 0; k < per; k++) list.push({ cx: c.x, cy: c.y, cz: c.z, R: R[0] + r() * (R[1] - R[0]), ph: r() * 6.28, w: speed * (0.6 + r() * 0.8), tilt: (r() - 0.5) * 0.8, s: scale[0] + r() * (scale[1] - scale[0]), x: 0, y: 0, z: 0 });
  return ctx.movers(geo, mat, list, (it, t, o) => { const a = it.ph + t * it.w; o.x = it.cx + Math.cos(a) * it.R; o.z = it.cz + Math.sin(a) * it.R; o.y = it.cy + Math.sin(a) * it.R * it.tilt; o.rx = t * tumble + it.ph; o.ry = t * tumble * 0.7; });
}
// Slowly spinning floating crystals.
function crystals(ctx, { count, colors, minD = 40, maxD = 420, size = [3, 9], glow = true }) {
  const { r } = ctx;
  const list = ctx.volume({ count, minD, maxD, minY: -40, maxY: 90 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28, s: size[0] + r() * (size[1] - size[0]), color: colors[(r() * colors.length) | 0] }));
  const geo = merge([part(oct(1), 0xffffff, { s: [0.55, 1.6, 0.55] })]);
  const mat = glow ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 });
  ctx.movers(geo, mat, list, (it, t, o) => { o.ry = t * 0.5 + it.ph; o.y = it.y + Math.sin(t * 0.6 + it.ph) * 4; o.rz = Math.sin(t * 0.3 + it.ph) * 0.3; });
}
// Meteors streaking across the far sky.
function meteors(ctx, { count, color = 0xffa040 }) {
  const { r } = ctx, list = [];
  for (let k = 0; k < count; k++) list.push({ x: 0, y: 0, z: 0, always: true, a: r() * 6.28, ph: r() * 10, T: 5 + r() * 6 });
  const geo = merge([part(box(1.4, 1.4, 60), color, { p: [0, 0, 30] }), part(ico(2.2, 1), 0xffffff, {})]);
  ctx.movers(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), list, (it, t, o) => {
    const u = ((t + it.ph) % it.T) / it.T, cam = ctx.camPos;
    const dx = Math.cos(it.a), dz = Math.sin(it.a);
    o.x = cam.x + Math.cos(it.a + 1.2) * 900 + dx * (u - 0.5) * 1400; o.z = cam.z + Math.sin(it.a + 1.2) * 900 + dz * (u - 0.5) * 1400; o.y = cam.y + 500 - u * 600;
    o.ry = Math.atan2(-dx, -dz); o.rx = -0.4; o.s = u < 0.95 ? 1 : 0.001;
  });
}
// Rotating wind turbines standing on islands.
function turbines(ctx, info, { color = 0xe8e8ec }) {
  const { r } = ctx, list = info.map((i) => ({ x: i.x + (r() - 0.5) * i.R * 0.5, y: i.y + 0.12 * i.R, z: i.z + (r() - 0.5) * i.R * 0.5, ry: r() * 6.28, s: Math.max(1, i.R / 30) }));
  ctx.place(merge([part(cyl(0.6, 1.1, 30, 8), color, { p: [0, 15, 0] }), part(box(1.6, 1.6, 3.4), color, { p: [0, 30.5, 0.6] })]), stdMat({ roughness: 0.5 }), list);
  ctx.movers(merge([0, 1, 2].map((k) => part(box(1.0, 14, 0.25), color, { p: [Math.sin(k * 2.094) * 7, Math.cos(k * 2.094) * 7, 0], r: [0, 0, -k * 2.094] }))), stdMat({ roughness: 0.5 }), list, (it, t, o) => {
    o.y = it.y + 30.5 * it.s; o.x = it.x + Math.sin(it.ry) * 2.4 * it.s; o.z = it.z + Math.cos(it.ry) * 2.4 * it.s; o.rz = t * 1.4 + it.ry;
  });
}
// Swaying searchlight beams.
function searchlights(ctx, { count, color = 0xbfd8ff }) {
  const { r } = ctx;
  const g = new THREE.CylinderGeometry(9, 1.2, 600, 16, 1, true); g.translate(0, 300, 0);
  const list = ctx.volume({ count, minD: 120, maxD: 600, minY: -160, maxY: -100 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28 }));
  ctx.movers(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }), list, (it, t, o) => { o.rx = Math.sin(t * 0.3 + it.ph) * 0.45; o.rz = Math.cos(t * 0.23 + it.ph) * 0.45; });
}
// Gliders that circle on thermals.
function gliders(ctx, { count, colors }) {
  const { r } = ctx;
  const list = ctx.volume({ count, minD: 50, maxD: 450, minY: 10, maxY: 110 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28, R: 40 + r() * 70, w: (r() < 0.5 ? -1 : 1) * (0.15 + r() * 0.1), s: 1.2 + r() * 0.6, color: colors[(r() * colors.length) | 0] }));
  ctx.movers(merge([part(box(16, 0.18, 1.4), 0xffffff, {}), part(cone(0.5, 7, 6), 0xffffff, { r: [Math.PI / 2, 0, 0], p: [0, 0, -1] }), part(box(4, 0.15, 0.8), 0xffffff, { p: [0, 0, -4.5] }), part(box(0.15, 1.5, 0.8), 0xffffff, { p: [0, 0.7, -4.5] })]),
    stdMat({ roughness: 0.4 }), list, (it, t, o) => { const a = it.ph + t * it.w; o.x = it.x + Math.cos(a) * it.R; o.z = it.z + Math.sin(a) * it.R; o.y = it.y + ((t * 0.8 + it.ph * 9) % 40); o.ry = -a + (it.w > 0 ? 0 : Math.PI); o.rz = it.w > 0 ? 0.35 : -0.35; });
}
// Spinning dust devils.
function vortices(ctx, { count, color }) {
  const { r } = ctx;
  const g = new THREE.CylinderGeometry(22, 4, 220, 18, 8, true); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), a = (y / 220) * 3; const x = p.getX(i), z = p.getZ(i); p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a) + Math.sin(y * 0.03) * 5, y + 110, x * Math.sin(a) + z * Math.cos(a)); }
  g.computeVertexNormals();
  const tex = canvasTex(64, 128, (c, w, h) => { for (let k = 0; k < 40; k++) { c.fillStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.3})`; c.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 10, 2 + Math.random() * 30); } }, { repeat: true });
  const list = ctx.volume({ count, minD: 120, maxD: 600, minY: -160, maxY: -100, spacing: 200 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28, s: 0.8 + r() * 0.8 }));
  ctx.movers(g, new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }), list, (it, t, o) => { o.ry = -t * 1.5 + it.ph; o.x = it.x + Math.sin(t * 0.1 + it.ph) * 60; });
}
// Islands that drift and bob (bare rock, so nothing on top needs to follow them).
function driftRocks(ctx, { count, size = [6, 20], geo = {}, seed = 9, amp = 5 }) {
  const { r } = ctx, g = islandGeometry(seed, { depth: 1.4, ...geo });
  const list = ctx.volume({ count, minD: 40, maxD: 360, minY: -50, maxY: 80, spacing: 50 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28, s: size[0] + r() * (size[1] - size[0]) }));
  ctx.movers(g, rockMat(), list, (it, t, o) => { o.y = it.y + Math.sin(t * 0.35 + it.ph) * amp; o.ry = it.ph + t * 0.04; o.rz = Math.sin(t * 0.2 + it.ph) * 0.05; });
}

const THEMES = {};

// ============ 1. DAWN ASCENT ============
THEMES.dawn = {
  accent: 0xffb347, bgm: { root: 196, scale: 'major', bpm: 128 }, card: [0xff9a4a, 0xffd08a, 0x7a4a9a],
  sky: { turb: 7, ray: 2.0, mie: 0.006, mieG: 0.88, elev: 6, azim: 215 },
  fog: [0xf0bf98, 160, 1500], sun: { color: 0xffc58a, int: 2.3 }, hemi: [0xffd7b0, 0x8a6a86, 0.55], exposure: 0.5, envInt: 1.0, glare: 0.9,
  clouds: [{ y: -75, color: 0xfff1de, shade: 0xa8688a, density: 0.5, alpha: 0.97, scale: 0.0015, glow: 0xff9a5a, glowAmt: 0.08 }, { y: -180, color: 0xe9b190, shade: 0x6a4670, density: 0.44, alpha: 0.95, scale: 0.0011, speed: 0.7 }],
  road: { base: 0x3a3b40, line: 0xeeeeee, kerbA: 0xd32f2f, kerbB: 0xf2f2f2, shoulder: 0x55565a, wallA: 0xd8d4cc, wallB: 0xb23a2a, barrier: 'jersey', deck: 0xa6a29a, env: 0.7, edge: 0xffb347 },
  weather: ['wisps'],
  build(ctx) {
    cumulusField(ctx, { count: 50, size: [70, 190], tint: 0xffe2c2, shade: 0x9a6486, minY: -70, maxY: 150 });
    const inf = islands(ctx, { count: 7, size: [28, 70], geo: { grass: [0x5b8f3a, 0x7aa84a] }, seed: 1, maxD: 560 });
    onIslands(ctx, inf, pine(false), stdMat({ roughness: 0.85 }), { per: 7 });
    driftRocks(ctx, { count: 8, geo: { grass: [0x5b8f3a, 0x7aa84a] }, seed: 21 });
    balloons(ctx, { count: 3, colors: [[0xff5a3a, 0xffd23a], [0x3a8aff, 0xffffff], [0xffd23a, 0x8a3aff], [0x2ec27e, 0xff7a2a]] });
    birds(ctx, { count: 14, color: 0x3a2c30 });
    peaks(ctx, { count: 0, ring: 14, ringR: 1000, baseY: -170, w: [200, 420], h: [260, 520], geo: { rock: [0x4a3f4a, 0x75606a], snowLine: 0.6 } });
    gatesEvery(ctx, 3, { kind: 'arch', color: 0xe8e4dc, glow: 0xffb347, metal: false });
  },
};

// ============ 2. GLACIER SPIRES ============
THEMES.glacier = {
  accent: 0x7fd4ff, bgm: { root: 220, scale: 'major', bpm: 130 }, card: [0x2f7fd8, 0x9bd0ff, 0xffffff],
  sky: { turb: 2.2, ray: 1.6, mie: 0.004, mieG: 0.8, elev: 40, azim: 140 },
  fog: [0x9cc4ea, 300, 2200], sun: { color: 0xfff4e0, int: 2.4 }, hemi: [0x9cc4ff, 0xaab8c8, 0.45], exposure: 0.42, envInt: 1.0, glare: 0.5,
  clouds: [{ y: -125, color: 0xffffff, shade: 0xaabbd2, density: 0.55, alpha: 0.98, scale: 0.0014 }, { y: -240, color: 0xeaf1fa, shade: 0x8aa0c0, density: 0.5, alpha: 0.95, scale: 0.001, speed: 0.6 }],
  road: { base: 0x3d3f45, line: 0xf4f4f4, kerbA: 0x1565c0, kerbB: 0xf5f5f5, shoulder: 0x6a6d72, wallA: 0xc8cdd2, wallB: 0xc8cdd2, barrier: 'rail', deck: 0xb5b7b8, env: 0.7, edge: 0x5fd8ff },
  weather: ['wisps', 'snowdust'],
  build(ctx) {
    peaks(ctx, { count: 22, minD: 85, maxD: 640, baseY: -190, w: [110, 260], h: [230, 470], seed: 2, variants: 5, geo: { rock: [0x59534e, 0x847a70], snowLine: 0.5 }, ring: 18, ringR: 900 });
    cumulusField(ctx, { count: 30, minD: 140, minY: -130, maxY: -50, size: [60, 150], tint: 0xffffff, shade: 0x9fb3cc });
    crystals(ctx, { count: 26, colors: [0xbfeaff, 0x8fd8ff, 0xe8fbff], size: [4, 12], glow: false });
    driftRocks(ctx, { count: 10, geo: { snow: true, grass: [0xf4f8ff, 0xd9e8f6], rock: [0x7fa6c6, 0xb4d6ee, 0x5a80a0] }, seed: 33, size: [8, 22] });
    birds(ctx, { count: 8, color: 0x3a3330, size: 2.2, speed: 10, flap: 4 });
    gatesEvery(ctx, 3, { kind: 'arch', color: 0xcfd4da, glow: 0x7fd4ff, metal: true });
  },
};

// ============ 3. STORM RUNNER ============
THEMES.storm = {
  accent: 0x9ab8ff, bgm: { root: 146.8, scale: 'minor', bpm: 138 }, card: [0x2b3442, 0x5a6678, 0x8a96a8],
  sky: { turb: 24, ray: 0.7, mie: 0.02, mieG: 0.6, elev: 14, azim: 250 },
  fog: [0x4f5967, 60, 900], sun: { color: 0xcdd7e6, int: 1.2 }, hemi: [0x8794a8, 0x2a313c, 0.55], exposure: 0.55, envInt: 0.9, glare: 0.15,
  clouds: [{ y: -35, color: 0x7f8aa0, shade: 0x262d38, density: 0.42, alpha: 0.98, scale: 0.0018, soft: 0.2 }, { y: -150, color: 0x5d6678, shade: 0x1c212b, density: 0.4, alpha: 0.98, scale: 0.0012, speed: 1.3 }],
  road: { base: 0x34363b, line: 0xe4e4e4, kerbA: 0xc62828, kerbB: 0xeeeeee, shoulder: 0x45484f, wallA: 0x9aa0a8, wallB: 0xe0b030, barrier: 'jersey', deck: 0x8a8d90, wet: true, env: 1.2, edge: 0xffc414 },
  weather: ['rain', 'wisps'],
  build(ctx) {
    const { r } = ctx;
    cumulusField(ctx, { count: 60, minD: 70, maxD: 750, minY: -60, maxY: 260, size: [110, 260], tint: 0x6b7587, shade: 0x1d232d, opacity: 0.95, sy: 0.9 });
    const inf = islands(ctx, { count: 6, size: [26, 60], geo: { grass: [0x3e5a3a, 0x50704a], rock: [0x3a3c44, 0x56585e] }, seed: 13, maxD: 420 });
    turbines(ctx, inf, { color: 0xd8dce2 });
    airships(ctx, { count: 3, hull: 0xb8b2a4, trim: 0x8a2a2a });
    peaks(ctx, { count: 0, ring: 10, ringR: 1000, baseY: -150, w: [200, 380], h: [200, 380], geo: { rock: [0x2c2f36, 0x4a4f5a], snowLine: 0.8 } });
    // lightning
    const mat = new THREE.LineBasicMaterial({ color: 0xdde8ff, transparent: true, opacity: 0, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = []; let x = 0, z = 0; for (let y = 140; y > -160; y -= 14) { x += (r() - 0.5) * 22; z += (r() - 0.5) * 22; pts.push(new THREE.Vector3(x, y, z)); }
    const bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat); ctx.scene.add(bolt); bolt.visible = false; let nextT = 3, flash = 0;
    const base = ctx.hemi.intensity;
    ctx.anim.push((dt, t, cam) => {
      if (t > nextT) { nextT = t + 2.5 + r() * 6; flash = 1; const a = r() * 6.28, d = 160 + r() * 250; bolt.position.set(cam.position.x + Math.cos(a) * d, cam.position.y, cam.position.z + Math.sin(a) * d); bolt.rotation.y = r() * 6; bolt.visible = true; mat.opacity = 1; if (ctx.events.thunder) ctx.events.thunder(bolt.position.distanceTo(cam.position)); }
      flash = Math.max(0, flash - dt * 4); const f = flash > 0.55 ? 1 : flash > 0.3 ? 0.2 : flash > 0.15 ? 0.7 : 0;
      ctx.hemi.intensity = base + f * 0.7; mat.opacity = f; if (flash <= 0) bolt.visible = false;
    });
    gatesEvery(ctx, 3, { kind: 'arch', color: 0x555b66, glow: 0x9ab8ff, metal: true });
  },
};

// ============ 4. NEON SKYLINE (night) ============
THEMES.neon = {
  accent: 0xff2bd6, bgm: { root: 146.8, scale: 'minor', bpm: 140 }, night: true, stars: 0.7, card: [0x05010f, 0x2b0a60, 0xff2bd6],
  sky: { turb: 4, ray: 0.35, mie: 0.004, mieG: 0.7, elev: -7, azim: 200 }, light: { elev: 38, azim: 30 },
  fog: [0x150b30, 90, 1300], sun: { color: 0x7a8cff, int: 0.9 }, hemi: [0x4a4cc0, 0x1a1030, 0.7], exposure: 0.75, envInt: 0.7, glare: 0,
  clouds: [{ y: -110, color: 0x6a5a8a, shade: 0x1a1230, density: 0.55, alpha: 0.85, scale: 0.0014, glow: 0xff7a3a, glowAmt: 0.5 }],
  road: { base: 0x2c2d34, line: 0xe6e6f0, kerbA: 0xd0d0d8, kerbB: 0x30303a, shoulder: 0x3a3b44, wallA: 0x6a6a78, wallB: 0x3a3a48, barrier: 'glass', deck: 0x5a5a66, env: 0.9, wallGlow: 0x00e5ff, underglow: 0xff2bd6, edgeGlow: 0x00e5ff, edge: 0x00e5ff },
  weather: [],
  build(ctx) {
    const { r } = ctx;
    const pal = [['#00f0ff', '#ff2bd6', '#ffe14d'], ['#ff2bd6', '#7c4dff', '#ffffff'], ['#33ff99', '#00f0ff', '#ffffff'], ['#ffb300', '#ff5e00', '#ffe14d']];
    const mats = pal.map((p, i) => new THREE.MeshBasicMaterial({ map: windowTex(p, i + 2) }));
    const BASE = -330, sizes = [[18, 300], [24, 380], [16, 340], [28, 290], [20, 420], [22, 350]];
    sizes.forEach(([w, h], k) => {
      const geo = buildingGeo(w, h, w * (0.8 + (k % 3) * 0.2)), mat = mats[k % mats.length];
      const list = ctx.volume({ count: 30, minD: ctx.wd + 14 + w * 0.7, maxD: 560, minY: 0, maxY: 0, spacing: w * 1.1, tries: 5000 }, (x, y, z) => ({ x, y: BASE + (r() * 60 - 30), z, ry: r() < 0.5 ? 0 : Math.PI / 2, s: [1, 0.78 + r() * 0.42, 1] }));
      ctx.place(geo, mat, list);
    });
    [['TURBO', '#00f0ff', '#fff'], ['SKY', '#ff2bd6', '#ffd6f8'], ['RACE', '#ffe14d', '#fff7c4'], ['NEON', '#33ff99', '#ccffe6']].forEach(([t, c1, c2]) => {
      const list = ctx.volume({ count: 5, minD: ctx.wd + 20, maxD: 150, minY: -40, maxY: 40, spacing: 40 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28 }));
      ctx.group.add(instances(new THREE.PlaneGeometry(26, 9.75), new THREE.MeshBasicMaterial({ map: signTex(t, c1, c2), side: THREE.DoubleSide }), list));
    });
    traffic(ctx, { lanes: 5, colors: [0x00f0ff, 0xff2bd6, 0xffe14d, 0x33ff99] });
    searchlights(ctx, { count: 8, color: 0xa8c8ff });
    roadRings(ctx, { every: 520, color: 0xff2bd6, spin: 1.2 });
    const beacons = ctx.volume({ count: 40, minD: 40, maxD: 700, minY: -120, maxY: 120 }, (x, y, z) => ({ x, y, z, s: 1.2 + r() * 1.5 }));
    const bm = instances(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xff3030 }), beacons); ctx.group.add(bm);
    ctx.anim.push((dt, t) => { bm.visible = ((t * 1.4) % 1) < 0.5; });
    ctx.floor(-520, 0x0a0618);
    gatesEvery(ctx, 6, { kind: 'arch', color: 0x2a2a38, glow: 0xff2bd6, metal: true });
  },
};

// ============ 5. CORAL HEIGHTS (sunset reef) ============
THEMES.coral = {
  accent: 0xff5c8a, bgm: { root: 261.6, scale: 'major', bpm: 132 }, card: [0xff7aa0, 0xffc07a, 0x3a9ab8],
  sky: { turb: 4, ray: 3.0, mie: 0.005, mieG: 0.82, elev: 9, azim: 250 },
  fog: [0xe8a0b4, 170, 1600], sun: { color: 0xffc0a0, int: 2.1 }, hemi: [0xffc4d6, 0x4a7aa0, 0.6], exposure: 0.4, envInt: 1.0, glare: 0.3,
  clouds: [{ y: -90, color: 0xffe0e6, shade: 0x8a5a9a, density: 0.5, alpha: 0.97, scale: 0.0015, glow: 0xff7a8a, glowAmt: 0.15 }, { y: -210, color: 0xffb0b8, shade: 0x5a4a8a, density: 0.45, alpha: 0.95, scale: 0.001, speed: 0.6 }],
  road: { base: 0x404247, line: 0xffffff, kerbA: 0xff5c8a, kerbB: 0xffffff, shoulder: 0x62666b, wallA: 0xf4f0e8, wallB: 0x26a69a, barrier: 'rail', deck: 0xc4c2b8, env: 0.8, edge: 0x2ee6c6 },
  weather: ['wisps'],
  build(ctx) {
    const { r } = ctx;
    const coralGeo = merge([part(cyl(0.6, 1.0, 6, 6), 0xff6a8a, { p: [0, 3, 0] }), part(cyl(0.4, 0.6, 4, 6), 0xff8aa0, { p: [1.6, 4.5, 0], r: [0, 0, -0.6] }), part(cyl(0.4, 0.6, 4, 6), 0xffa070, { p: [-1.4, 5, 0.6], r: [0.3, 0, 0.6] }), part(sph(1.1, 8, 6), 0xffd06a, { p: [0, 6.4, 0] }), part(sph(0.8, 8, 6), 0xff9ad0, { p: [2.8, 6.2, 0] })]);
    const inf = islands(ctx, { count: 10, variants: 4, size: [40, 110], depth: 1.7, geo: { grass: [0xe8c89a, 0xf2d8a8], rock: [0xc86a6a, 0xe89a8a, 0x8a4a5a] }, seed: 5, minD: 90, maxD: 640, minY: -70, maxY: 50, spacing: 160 });
    onIslands(ctx, inf, coralGeo, stdMat({ roughness: 0.7 }), { per: 7, scale: [0.8, 1.6], spread: 0.7, tint: 0.8 });
    onIslands(ctx, inf, palm(), stdMat({ roughness: 0.85 }), { per: 3, scale: [0.7, 1.1], spread: 0.6 });
    for (const i of inf) if (r() < 0.7) ctx.waterfall(i.x + Math.cos(i.ry + 1) * i.R * 0.85, i.y + 4, i.z + Math.sin(i.ry + 1) * i.R * 0.85, i.R * 0.18, 260, r() * 6.28);
    skyCreatures(ctx, { count: 4, kind: 'whale', color: 0x3a5a8a, belly: 0xe8d8e0 });
    skyCreatures(ctx, { count: 6, kind: 'manta', color: 0x2a3a6a, belly: 0xf0d0e0, glow: 0x6af0ff });
    jellyfish(ctx, { count: 14, colors: [0xff7ad0, 0x7af0ff, 0xffd07a] });
    gatesEvery(ctx, 3, { kind: 'arch', color: 0xf4f0e8, glow: 0xff5c8a });
  },
};

// ============ 6. MAGMA DRIFT ============
THEMES.magma = {
  accent: 0xff5a1f, bgm: { root: 123.5, scale: 'phrygian', bpm: 144 }, card: [0x2a0808, 0xa0301a, 0xff8a2a],
  sky: { turb: 10, ray: 1.2, mie: 0.006, mieG: 0.75, elev: 3, azim: 160 },
  fog: [0x6a2a1c, 80, 1100], sun: { color: 0xff8a50, int: 2.2 }, hemi: [0xff8a5a, 0x2a0a08, 0.5], exposure: 0.42, envInt: 0.9, glare: 0.3,
  clouds: [{ y: -60, color: 0xb86a4a, shade: 0x2a1410, density: 0.46, alpha: 0.97, scale: 0.0015, glow: 0xff5a10, glowAmt: 0.25 }, { y: -170, color: 0xff7a2a, shade: 0x7a1e08, density: 0.38, alpha: 1, scale: 0.0011, glow: 0xff6a10, glowAmt: 0.7, speed: 1.4 }],
  road: { base: 0x2f2d30, line: 0xffd9a0, kerbA: 0xff5a1f, kerbB: 0x2a2024, shoulder: 0x3a3436, wallA: 0x4a4044, wallB: 0x6a3a2a, barrier: 'jersey', deck: 0x5a4a46, env: 0.8, wallGlow: 0xff6a1a, underglow: 0xff5a1f, edge: 0xff6a1a },
  weather: ['embers', 'wisps'],
  build(ctx) {
    const { r } = ctx;
    const inf = islands(ctx, { count: 10, variants: 4, size: [22, 70], depth: 1.7, geo: { grass: [0x3a3236, 0x4e4448], rock: [0x2b2326, 0x4a3a3a, 0x1c1618] }, seed: 4, maxD: 560 });
    ctx.place(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff5a10 }), inf.map((i) => ({ x: i.x, y: i.y - i.R * 0.9, z: i.z, s: i.R * 0.35 + 6 })));
    for (const i of inf) if (r() < 0.6) ctx.waterfall(i.x + Math.cos(i.ry) * i.R * 0.8, i.y + 2, i.z + Math.sin(i.ry) * i.R * 0.8, i.R * 0.16, 220, r() * 6.28, 0xff6a1a, true);
    const spire = merge([part(cone(2.6, 14, 7), 0x1f1a1c, { p: [0, 7, 0] }), part(cone(1.4, 8, 6), 0x2c2426, { p: [2.4, 4, 1], r: [0, 0, -0.2] })]);
    onIslands(ctx, inf, spire, stdMat({ roughness: 0.95 }), { per: 3, scale: [0.5, 1.1], spread: 0.6 });
    // molten cores with rocks in orbit
    const cores = ctx.volume({ count: 3, minD: 160, maxD: 420, minY: -10, maxY: 90, spacing: 400 }, (x, y, z) => ({ x, y, z, s: 18 + r() * 14 }));
    ctx.place(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xff7a20 }), cores);
    orbiters(ctx, { centres: cores, per: 10, R: [45, 110], speed: 0.25, geo: merge([part(ico(1, 0), 0x2a2224, { s: [1.3, 1, 1] }), part(ico(0.5, 0), 0xff5a10, { p: [0.7, 0.2, 0.3] })]), mat: stdMat({ roughness: 0.9, flatShading: true }), scale: [3, 9] });
    meteors(ctx, { count: 5, color: 0xff8a30 });
    peaks(ctx, { count: 0, ring: 9, ringR: 950, baseY: -190, w: [260, 460], h: [300, 520], geo: { rock: [0x231c1e, 0x3e3033], snowLine: 2, steep: 1.4 } });
    const smoke = ctx.volume({ count: 30, minD: 200, maxD: 800, minY: 0, maxY: 260, spacing: 50 }, (x, y, z) => ({ x, y, z, s: 120 + r() * 160, sy: 1.1 }));
    ctx.cumulus(smoke, { tint: 0x5a4036, shade: 0x1a100e, opacity: 0.8 });
    gatesEvery(ctx, 3, { kind: 'arch', color: 0x2a2224, glow: 0xff6a1a, metal: true });
  },
};

// ============ 7. AURORA RIFT ============
THEMES.aurora = {
  accent: 0x5ff0c8, bgm: { root: 233, scale: 'pent', bpm: 134 }, night: true, stars: true, card: [0x07163a, 0x1c6a8a, 0x66ffd0],
  sky: { turb: 2, ray: 0.4, mie: 0.003, mieG: 0.7, elev: -10, azim: 120 }, light: { elev: 30, azim: 300 },
  fog: [0x0d1c3a, 120, 1500], sun: { color: 0xa8c8ff, int: 1.4 }, hemi: [0x5a86d8, 0x1a2a50, 0.75], exposure: 0.8, envInt: 0.8, glare: 0,
  clouds: [{ y: -110, color: 0x7a9acb, shade: 0x1a2a4c, density: 0.58, alpha: 0.8, scale: 0.0012, glow: 0x3aff9a, glowAmt: 0.08 }],
  road: { base: 0x3c4552, line: 0xeaf6ff, kerbA: 0x00acc1, kerbB: 0xf0fbff, shoulder: 0x56606e, wallA: 0xcfe9f6, wallB: 0x8ec9e6, barrier: 'jersey', deck: 0x9fb4c4, env: 1.0, wallGlow: 0x5ff0ff, edge: 0x5ff0c8 },
  weather: ['snow', 'wisps'],
  build(ctx) {
    const inf = islands(ctx, { count: 12, variants: 4, size: [30, 90], depth: 1.9, flatY: 0.9, geo: { snow: true, grass: [0xf4f8ff, 0xd9e8f6], rock: [0x7fa6c6, 0xb4d6ee, 0x5a80a0] }, seed: 3, maxD: 600, spacing: 110 });
    onIslands(ctx, inf, pine(true, 0x2a5a48, 0x347060, 0x44887a), stdMat({ roughness: 0.8 }), { per: 4, spread: 0.55, scale: [0.6, 1.0] });
    ctx.aurora();
    crystals(ctx, { count: 30, colors: [0x5ff0c8, 0x8a7aff, 0x5fd8ff], size: [3, 10] });
    roadRings(ctx, { every: 460, color: 0x5ff0c8, spin: 0.9 });
    peaks(ctx, { count: 0, ring: 12, ringR: 1050, baseY: -170, w: [220, 400], h: [240, 420], geo: { rock: [0x586a82, 0x8aa0bc], snowLine: 0.4 } });
    gatesEvery(ctx, 3, { kind: 'arch', color: 0xa6c8de, glow: 0x5ff0ff, metal: true });
  },
};

// ============ 8. ORBITAL HIGHWAY ============
THEMES.orbit = {
  accent: 0x6f9bff, bgm: { root: 130.8, scale: 'pent', bpm: 136 }, stars: true, card: [0x000008, 0x0a1a4a, 0x4a8aff],
  sky: { turb: 2, ray: 0.5, mie: 0.002, mieG: 0.7, elev: -3, azim: 60 }, light: { elev: 24, azim: 60 }, glareSun: true,
  fog: [0x16306a, 400, 3000], sun: { color: 0xffffff, int: 4.0 }, hemi: [0x5a7aff, 0x203060, 0.45], exposure: 0.7, envInt: 0.9, glare: 1.0, envFloor: 0.5,
  clouds: [{ y: -330, color: 0xdfe8ff, shade: 0x5f78b8, density: 0.5, alpha: 0.9, scale: 0.0007, speed: 0.4 }],
  road: { base: 0x30323a, line: 0xe8ecff, kerbA: 0x3d6bff, kerbB: 0xffffff, shoulder: 0x42454e, wallA: 0xd8deea, wallB: 0x3d6bff, barrier: 'glass', deck: 0xb8bfd0, env: 1.3, wallGlow: 0x6f9bff, underglow: 0x3d6bff, edge: 0x6f9bff },
  pylons: 'none',
  weather: [],
  build(ctx) {
    const { r } = ctx;
    const earthMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: ctx.lightDir.clone() } },
      vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix)*normal); vP=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }',
      fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        void main(){ vec3 V = normalize(cameraPosition - vP); float fres = pow(1.0 - max(dot(V, vN), 0.0), 3.0);
          vec2 uv = vP.xz*0.0012; float c = n(uv)*0.55+n(uv*2.3)*0.3+n(uv*5.1)*0.15; float land = smoothstep(0.5,0.58,n(uv*0.35+4.));
          vec3 ocean = vec3(0.03,0.12,0.38), ground = vec3(0.16,0.3,0.14); vec3 base = mix(ocean, ground, land);
          float cl = smoothstep(0.52,0.78,c); base = mix(base, vec3(0.95), cl*0.85);
          float lit = clamp(dot(vN, uSun)*0.9+0.25, 0.05, 1.0); vec3 col = base*lit + vec3(0.25,0.5,1.0)*fres*1.2;
          gl_FragColor = vec4(col,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(9000, 96, 64), earthMat); earth.position.set(ctx.cx, -9400, ctx.cz); earth.renderOrder = -7; ctx.scene.add(earth);
    const atm = new THREE.Mesh(new THREE.SphereGeometry(9250, 64, 48), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN=normalize(mat3(modelMatrix)*normal); vP=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }',
      fragmentShader: 'varying vec3 vN; varying vec3 vP; void main(){ vec3 V=normalize(cameraPosition-vP); float f=pow(1.0-abs(dot(V,vN)),5.0); gl_FragColor=vec4(vec3(0.3,0.55,1.0)*f*0.9, f*0.8);\n #include <tonemapping_fragment>\n #include <colorspace_fragment>\n }' }));
    atm.position.copy(earth.position); atm.renderOrder = -6; ctx.scene.add(atm);
    // stations with satellites in orbit around them
    const hubs = ctx.volume({ count: 3, minD: 160, maxD: 500, minY: 0, maxY: 120, spacing: 500 }, (x, y, z) => ({ x, y, z, s: 1 }));
    const stationGeo = merge([part(tor(40, 4, 10, 48), 0xd0d6e2, {}), part(cyl(5, 5, 80, 12), 0xb8c0cc, { r: [Math.PI / 2, 0, 0] }), part(box(4, 4, 80), 0x8a94a4, { r: [0, 0, 0] }), part(box(80, 4, 4), 0x8a94a4, {}), part(sph(9, 14, 10), 0xe4e8f0, {})]);
    ctx.movers(stationGeo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.8, roughness: 0.35 }), hubs, (it, t, o) => { o.rx = 1.2; o.rz = t * 0.12; });
    const sat = merge([part(box(3, 2, 3), 0xd0a040, {}), part(box(12, 0.15, 3.2), 0x1a3a9a, { p: [-8, 0, 0] }), part(box(12, 0.15, 3.2), 0x1a3a9a, { p: [8, 0, 0] }), part(cyl(0.15, 0.15, 5, 6), 0xcccccc, { p: [0, 3.5, 0] }), part(sph(1.2, 10, 6), 0xdddddd, { p: [0, 6.2, 0] })]);
    orbiters(ctx, { centres: hubs, per: 5, R: [70, 140], speed: 0.18, tumble: 0.15, geo: sat, mat: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.8, roughness: 0.35 }), scale: [0.8, 1.6] });
    // tumbling asteroids drifting past
    const rocks = ctx.volume({ count: 40, minD: 30, maxD: 600, minY: -80, maxY: 140 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28, s: 1.5 + r() * 5, color: vary(r, 0.5) }));
    ctx.movers(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x8a8a96, roughness: 0.9, flatShading: true }), rocks, (it, t, o) => { o.rx = t * 0.3 + it.ph; o.ry = t * 0.2; o.x = it.x + Math.sin(t * 0.05 + it.ph) * 20; o.sx = 1.3; });
    roadRings(ctx, { every: 560, color: 0x6f9bff, spin: -0.7 });
    meteors(ctx, { count: 4, color: 0x9ab8ff });
    gatesEvery(ctx, 5, { kind: 'ring', glow: 0x6f9bff });
  },
};

// ============ 9. SANDSTORM MESA ============
THEMES.dune = {
  accent: 0xffa040, bgm: { root: 165, scale: 'phrygian', bpm: 140 }, card: [0x3a2a6a, 0xff9a5a, 0xffe0a0],
  sky: { turb: 9, ray: 1.4, mie: 0.01, mieG: 0.9, elev: 7, azim: 90 },
  fog: [0xeaba98, 130, 1400], sun: { color: 0xffd0a0, int: 3.2 }, hemi: [0xffd8b8, 0xa86a50, 0.5], exposure: 0.42, envInt: 1.0, glare: 0.5,
  clouds: [{ y: -95, color: 0xffd8c0, shade: 0xb06a74, density: 0.56, alpha: 0.9, scale: 0.0014, soft: 0.3 }],
  road: { base: 0x3e3c3c, line: 0xf0e0c8, kerbA: 0xc2511f, kerbB: 0xf2e6d4, shoulder: 0x6a5a50, wallA: 0xcfa27a, wallB: 0xa6623a, barrier: 'jersey', deck: 0xa8826a, env: 0.7, edge: 0xffa040 },
  weather: ['dust', 'wisps'],
  build(ctx) {
    const { r } = ctx;
    const geos = [0, 1, 2, 3].map((k) => islandGeometry(30 + k, { depth: 4.2, flat: 0.06, grass: [0xc7955a, 0xd9a86a], rock: [0xb5532c, 0xe0a070, 0x8f3a1e] }));
    const bk = geos.map(() => []);
    ctx.volume({ count: 26, minD: 70, maxD: 640, minY: -120, maxY: 90, spacing: 70, tries: 3000 }, (x, y, z) => { const W = 14 + r() * 34, H = W * (1.6 + r() * 1.8); bk[(r() * 4) | 0].push({ x, y, z, ry: r() * 6.28, s: [W, H * 0.5, W] }); return { ok: 1 }; });
    const mat = rockMat(); geos.forEach((g, k) => ctx.place(g, mat, bk[k]));
    ctx.floor(-520, 0xc98a5a);
    gliders(ctx, { count: 10, colors: [0xffffff, 0xff6a3a, 0x3a8aff, 0xffd23a] });
    vortices(ctx, { count: 4, color: 0xe8b888 });
    airships(ctx, { count: 2, hull: 0xe8d8c0, trim: 0x3a6a9a, speed: 7 });
    driftRocks(ctx, { count: 10, geo: { grass: [0xc7955a, 0xd9a86a], rock: [0xb5532c, 0xe0a070, 0x8f3a1e] }, seed: 44, size: [6, 16] });
    gatesEvery(ctx, 4, { kind: 'arch', color: 0xb5532c, glow: 0xffa040 });
    cumulusField(ctx, { count: 26, minY: -90, maxY: 60, size: [70, 150], tint: 0xffddc8, shade: 0xa86a80 });
  },
};

// ============ 10. CELESTIAL CROWN ============
THEMES.crown = {
  accent: 0xffd45a, bgm: { root: 233, scale: 'major', bpm: 146 }, card: [0x6aa8ff, 0xfff0c8, 0xffd27a],
  sky: { turb: 4, ray: 1.8, mie: 0.005, mieG: 0.86, elev: 22, azim: 200 },
  fog: [0xcfe4fa, 220, 1800], sun: { color: 0xfff0d0, int: 3.4 }, hemi: [0xdfeeff, 0xf0e0b8, 0.55], exposure: 0.36, envInt: 1.0, glare: 0.7,
  clouds: [{ y: -90, color: 0xffffff, shade: 0xb0c4e4, density: 0.5, alpha: 0.98, scale: 0.0014 }, { y: -200, color: 0xfff1d4, shade: 0xb2a2c2, density: 0.46, alpha: 0.96, scale: 0.001, speed: 0.6 }],
  road: { base: 0x46484e, line: 0xffffff, kerbA: 0xd4a017, kerbB: 0xffffff, shoulder: 0x70747a, wallA: 0xfaf6ea, wallB: 0xd4a017, barrier: 'glass', deck: 0xe6e0d0, env: 1.0, wallGlow: 0xffd45a, edge: 0xffd45a },
  weather: ['wisps', 'sparkle'],
  build(ctx) {
    const { r } = ctx;
    cumulusField(ctx, { count: 70, minD: 60, maxD: 900, minY: -80, maxY: 220, size: [80, 220], tint: 0xffffff, shade: 0xaec2e2, opacity: 0.95 });
    const inf = islands(ctx, { count: 8, size: [40, 100], depth: 1.4, flatY: 0.9, geo: { grass: [0xf4efe2, 0xe2dccb], rock: [0xdcd6c6, 0xc9c2b0, 0xb0a890] }, seed: 7, minD: 90, maxD: 640, minY: -60, maxY: 80, spacing: 150 });
    onIslands(ctx, inf, column(), stdMat({ roughness: 0.55 }), { per: 6, spread: 0.6, scale: [0.9, 1.4], tint: 0.95 });
    roadRings(ctx, { every: 380, color: 0xffd45a, spin: 0.7, glow: false });
    // great golden halos turning slowly in the distance
    const halos = ctx.volume({ count: 3, minD: 200, maxD: 600, minY: 40, maxY: 160, spacing: 400 }, (x, y, z) => ({ x, y, z, ph: r() * 6.28, s: 60 + r() * 50 }));
    ctx.movers(merge([part(tor(1, 0.04, 8, 64), 0xffd45a, {}), part(tor(0.8, 0.02, 6, 64), 0xfff0b0, { r: [Math.PI / 2, 0, 0] })]), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.2 }), halos, (it, t, o) => { o.ry = t * 0.15 + it.ph; o.rx = t * 0.1; });
    birds(ctx, { count: 12, color: 0xfaf8f0, size: 1.2 });
    crystals(ctx, { count: 18, colors: [0xffe08a, 0xfff6d0, 0xffc04a], size: [2, 6] });
    const cols = [0xff4d6d, 0xffa51f, 0xffe94d, 0x4dff88, 0x4dc9ff, 0x9b6dff];
    const g = new THREE.Group(); cols.forEach((c, i) => g.add(new THREE.Mesh(new THREE.TorusGeometry(620 - i * 9, 5, 6, 80, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.32, fog: true, depthWrite: false }))));
    g.position.set(ctx.cx - 300, -120, ctx.cz - 1000); g.rotation.y = 0.4; ctx.scene.add(g);
    const t = canvasTex(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(0.5, 'rgba(255,240,200,0.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
    for (let k = 0; k < 7; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(70 + r() * 90, 900), new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0.55 })); const a = r() * 6.28, d = 150 + r() * 600; m.position.set(ctx.cx + Math.cos(a) * d, 100, ctx.cz + Math.sin(a) * d); m.rotation.set(0, r() * 3.14, 0.35); ctx.scene.add(m); }
    const cols2 = [0xffe08a, 0xffd45a, 0xfff0b0];
    ctx.track.checkpoints.slice(1).forEach((s, k) => gate(ctx, s, { kind: 'ring', glow: cols2[k % 3] }));
  },
};

export default THEMES;
