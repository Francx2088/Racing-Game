// Visual themes for the 10 levels: palette, terrain shape/colour and scenery builders.
import * as THREE from 'three';
import { part, merge, cyl, cone, box, ico, sph, tor, oct, litMat, glowMat, instances, canvasTex, css } from './kit.js';
import { smooth, clamp, lerp } from './util.js';

const _a = new THREE.Color(), _b = new THREE.Color();
const mixHex = (a, b, t) => _a.set(a).lerp(_b.set(b), clamp(t, 0, 1)).getHex();
const gray = (v) => new THREE.Color(v, v, v).getHex();
const vary = (r, lo = 0.7) => gray(lo + (1 - lo) * r());

// Gate (arch/ring) over the track at distance s.
function gate(ctx, s, { kind = 'arch', color = 0x888888, glow = 0xffffff, height = 12 }) {
  const { track, group } = ctx;
  const p = track.pointAt(s, 0), wd = track.wallD + 2.2;
  const g = new THREE.Group();
  if (kind === 'ring') {
    const rad = wd + 1;
    const m = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.8, 8, 36), new THREE.MeshBasicMaterial({ color: glow }));
    m.position.y = rad * 0.8; g.add(m);
  } else {
    const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    for (const sg of [-1, 1]) { const pl = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.4, height, 7), mat); pl.position.set(sg * wd, height / 2 - 1, 0); g.add(pl); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(wd * 2 + 2.6, 2, 2.2), mat); beam.position.y = height; g.add(beam);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(wd * 2 + 2.8, 0.3, 2.4), new THREE.MeshBasicMaterial({ color: glow })); strip.position.y = height - 1.1; g.add(strip);
  }
  g.position.set(p.x, p.y, p.z); g.rotation.y = p.head;
  group.add(g);
}
const gatesEvery = (ctx, n, opts) => { for (let k = 0; k < n; k++) { const s = ((k + 0.5) / n) * ctx.track.length + 70; gate(ctx, s % ctx.track.length, opts); } };

// ---------- shared prop geometries ----------
const pine = (snow = false, dark = 0x1f7a3a, mid = 0x2a8f48, light = 0x35a357) => merge([
  part(cyl(0.35, 0.5, 2.2, 6), 0x5b3b22, { p: [0, 1.1, 0] }),
  part(cone(2.7, 4.2, 7), dark, { p: [0, 4.1, 0] }), part(cone(2.1, 3.6, 7), mid, { p: [0, 6.3, 0] }), part(cone(1.4, 3.0, 7), light, { p: [0, 8.3, 0] }),
  ...(snow ? [part(cone(2.0, 1.6, 7), 0xffffff, { p: [0, 5.55, 0] }), part(cone(1.5, 1.4, 7), 0xffffff, { p: [0, 7.6, 0] }), part(cone(0.9, 1.3, 7), 0xffffff, { p: [0, 9.35, 0] })] : []),
]);
const roundTree = (trunk, c1, c2) => merge([
  part(cyl(0.45, 0.65, 3.4, 6), trunk, { p: [0, 1.7, 0] }),
  part(ico(2.8, 1), c1, { p: [0, 5.2, 0], s: [1, 0.9, 1] }), part(ico(2.0, 1), c2, { p: [1.4, 6.6, 0.6] }), part(ico(1.8, 1), c2, { p: [-1.4, 6.2, -0.8] }),
]);
const palm = () => {
  const parts = [];
  for (let k = 0; k < 5; k++) parts.push(part(cyl(0.3 - k * 0.02, 0.36 - k * 0.02, 1.9, 6), 0x9a6b3d + k * 0x050505, { p: [k * 0.18, 0.95 + k * 1.8, 0], r: [0, 0, -0.1] }));
  for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; parts.push(part(cone(0.75, 4.2, 4), k % 2 ? 0x2f9e4a : 0x3fbf5a, { p: [0.9 + Math.cos(a) * 1.7, 9.2, Math.sin(a) * 1.7], r: [Math.sin(a) * 1.35, 0, -Math.cos(a) * 1.35], s: [1, 1, 0.35] })); }
  parts.push(part(sph(0.45, 6, 5), 0x7a4a24, { p: [0.95, 8.9, 0.2] }));
  return merge(parts);
};
const cactus = () => merge([
  part(cyl(0.7, 0.8, 6.5, 7), 0x3f9a46, { p: [0, 3.2, 0] }), part(sph(0.7, 7, 5), 0x3f9a46, { p: [0, 6.5, 0] }),
  part(cyl(0.4, 0.4, 2.2, 6), 0x3f9a46, { p: [1.6, 3.6, 0], r: [0, 0, Math.PI / 2] }), part(cyl(0.4, 0.4, 2.4, 6), 0x3f9a46, { p: [2.4, 4.6, 0] }),
  part(cyl(0.4, 0.4, 1.8, 6), 0x3f9a46, { p: [-1.4, 2.6, 0], r: [0, 0, Math.PI / 2] }), part(cyl(0.4, 0.4, 2.0, 6), 0x3f9a46, { p: [-2.2, 3.4, 0] }),
]);
const mesa = (c1, c2, c3) => merge([part(cyl(0.8, 1.0, 0.45, 8), c1, { p: [0, 0.22, 0] }), part(cyl(0.7, 0.8, 0.35, 8), c2, { p: [0, 0.62, 0] }), part(cyl(0.64, 0.7, 0.35, 8), c3, { p: [0, 0.97, 0] }), part(cyl(0.56, 0.64, 0.3, 8), c2, { p: [0, 1.3, 0] }), part(cyl(0.5, 0.56, 0.16, 8), c1, { p: [0, 1.52, 0] })]);
const rockG = (c = 0x777777, c2 = 0x999999) => merge([part(ico(1.5, 0), c, { p: [0, 0.8, 0], s: [1.2, 0.8, 1] }), part(ico(0.9, 0), c2, { p: [1.0, 0.5, 0.6] })]);
const mountain = (c, cap) => merge([part(cone(1.0, 1.0, 6), c, { p: [0, 0.5, 0] }), ...(cap ? [part(cone(0.36, 0.36, 6), cap, { p: [0, 0.82, 0] })] : [])]);

function buildingGeo(w, h, d, base, litCol) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const uv = g.attributes.uv, nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const u = ny > 0.5 ? 0 : (nx > 0.5 ? d : w) / 5;
    const v = ny > 0.5 ? 0 : h / 6;
    uv.setXY(i, uv.getX(i) * Math.max(u, 0.01), uv.getY(i) * Math.max(v, 0.01));
  }
  g.translate(0, h / 2, 0);
  return g;
}
const windowTex = (palette) => canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#07061a'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const on = Math.random() < 0.6; g.fillStyle = on ? palette[(x * 3 + y * 7) % palette.length] : '#14122e'; g.fillRect(x * 16 + 3, y * 16 + 4, 10, 9); }
}, { repeat: true });
const signTex = (text, c1, c2) => canvasTex(256, 96, (g, w, h) => {
  g.fillStyle = '#0a0620'; g.fillRect(0, 0, w, h); g.strokeStyle = c1; g.lineWidth = 6; g.shadowColor = c1; g.shadowBlur = 14; g.strokeRect(6, 6, w - 12, h - 12);
  g.font = 'italic 900 52px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = c2; g.shadowColor = c2; g.fillText(text, w / 2, h / 2 + 3);
});

const THEMES = {};

// ============ 1. COAST ============
THEMES.coast = {
  accent: 0x00d4ff, bgm: { root: 196, scale: 'major', bpm: 118 },
  sky: [0x1f8fff, 0x7cd3ff, 0xfff1d6], fog: [0xbfe6ff, 140, 760], sun: { color: 0xfff0d0, int: 2.4, pos: [-300, 380, 220] }, hemi: [0xbfe3ff, 0xe8d5a0, 1.1], exposure: 1.0,
  road: { base: 0x40434c, speck: '255,255,255', line: 0xffffff, kerbA: 0xe53935, kerbB: 0xffffff, shoulder: 0xf0d9a4, wallA: 0xffffff, wallB: 0x1e88e5 },
  terrain: {
    height: (x, z, n) => 3 + n.fbm(x * 0.006, z * 0.006, 4) * 20 - 22 * smooth(-60, 260, x * 0.35 + z * 0.9 - 120) - 1.5 * n.fbm(x * 0.03, z * 0.03, 2),
    color: (h, ns, x, z, v) => (h < 0.6 ? mixHex(0xe9cf94, 0xf6e6b5, ns) : h < 2.0 ? mixHex(0xf0d9a4, 0xc9d68a, smooth(0.6, 2, h)) : mixHex(0x55bb55, 0x3f9b46, ns)),
  },
  water: { y: -1.4, color: 0x14a6d8, opacity: 0.88 },
  build(ctx) {
    const { r } = ctx;
    ctx.place(palm(), litMat(), ctx.scatter({ count: 160, minD: ctx.wd + 6, maxD: 90, minH: 0.7 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.9 + r() * 0.6, color: vary(r, 0.8) })));
    const umb = merge([part(cyl(0.08, 0.08, 2.6, 5), 0xeeeeee, { p: [0, 1.3, 0] }), part(cone(1.6, 0.7, 8), 0xff3b3b, { p: [0, 2.7, 0] }), part(cone(1.6, 0.7, 8), 0xffffff, { p: [0, 2.7, 0], r: [0, Math.PI / 8, 0], s: [0.9, 1.02, 0.9] })]);
    ctx.place(umb, litMat(), ctx.scatter({ count: 50, minD: ctx.wd + 5, maxD: 36, minH: 0.5, maxH: 2 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1 + r() * 0.3, color: vary(r, 0.85) })));
    ctx.place(rockG(0x8c8c88, 0xa8a8a0), litMat(), ctx.scatter({ count: 70, minD: ctx.wd + 6, maxD: 150 }, (x, y, z) => ({ x, y: y - 0.2, z, ry: r() * 6.28, s: 0.8 + r() * 2.2, color: vary(r, 0.7) })));
    const boat = merge([part(box(1.6, 0.9, 5.4), 0xffffff, { p: [0, 0.45, 0] }), part(box(1.62, 0.25, 5.2), 0xe53935, { p: [0, 0.85, 0] }), part(cyl(0.07, 0.07, 6.5, 5), 0xdddddd, { p: [0, 3.9, 0.3] }), part(cone(1.9, 5.4, 3), 0xffffff, { p: [0.0, 4.2, -0.2], r: [0, 0, 0], s: [0.04, 1, 1] })]);
    ctx.place(boat, litMat(), ctx.scatter({ count: 14, minD: 70, maxD: 700, maxH: -4, wide: true }, (x, y, z) => ({ x, y: -1.4, z, ry: r() * 6.28, s: 1.3 + r(), color: vary(r, 0.9) })));
    const lh = merge([part(cyl(2.2, 3.2, 18, 10), 0xffffff, { p: [0, 9, 0] }), part(cyl(2.25, 2.7, 4, 10), 0xe53935, { p: [0, 6, 0] }), part(cyl(2.25, 2.7, 4, 10), 0xe53935, { p: [0, 13, 0] }), part(cyl(2.4, 2.4, 2.2, 10), 0xffe066, { p: [0, 19.1, 0] }), part(cone(3, 2.5, 10), 0x2c3e50, { p: [0, 21.4, 0] })]);
    ctx.place(lh, glowMat(), ctx.scatter({ count: 3, minD: 90, maxD: 200, minH: 0.8, maxH: 6 }, (x, y, z) => ({ x, y, z, s: 1.4 })));
    ctx.place(mountain(0x6aa66a, 0xe0e8d0), litMat(), ctx.ring(26, 1050, (a) => ({ s: [260 + ctx.r() * 200, 100 + ctx.r() * 160, 260 + ctx.r() * 200], y: -4 })));
    gatesEvery(ctx, 3, { kind: 'arch', color: 0xf5f5f5, glow: 0x00d4ff });
    ctx.clouds(26, 0xffffff, 0.95);
  },
};

// ============ 2. DESERT ============
THEMES.desert = {
  accent: 0xffa726, bgm: { root: 165, scale: 'phrygian', bpm: 126 },
  sky: [0x2f7fd8, 0xf2b46d, 0xffe0a8], fog: [0xf0c48c, 120, 700], sun: { color: 0xffd9a0, int: 2.6, pos: [320, 300, -260] }, hemi: [0xffe0b0, 0xc27a3a, 1.0], exposure: 1.05,
  road: { base: 0x4a4540, speck: '255,220,170', line: 0xffe9b0, kerbA: 0xd84315, kerbB: 0xfff3e0, shoulder: 0xd9a35a, wallA: 0xc2703a, wallB: 0xe6a066 },
  terrain: {
    height: (x, z, n) => 2 + 16 * Math.abs(n.fbm(x * 0.005 + 9, z * 0.005, 3) - 0.5) * 2 + 3 * n.fbm(x * 0.04, z * 0.04, 2),
    color: (h, ns, x, z, v) => mixHex(mixHex(0xe3a85a, 0xcf8a3f, ns), 0xf2c981, smooth(6, 18, h)),
  },
  build(ctx) {
    const { r } = ctx;
    const mesas = [mesa(0xb5532c, 0xd8743f, 0xc4622f), mesa(0xa0452a, 0xc9683a, 0xb55a30)];
    mesas.forEach((m, k) => ctx.place(m, litMat(), ctx.scatter({ count: 16, minD: ctx.wd + 105, maxD: 560, tries: 6000 }, (x, y, z) => { const s = 40 + r() * 60; return { x, y: y - 2, z, ry: r() * 6.28, s: [s, s * (0.9 + r() * 0.8), s], color: vary(r, 0.8) }; })));
    ctx.place(cactus(), litMat(), ctx.scatter({ count: 140, minD: ctx.wd + 6, maxD: 120 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.7 + r() * 0.9, color: vary(r, 0.8) })));
    ctx.place(rockG(0xa65c36, 0xc7794a), litMat(), ctx.scatter({ count: 160, minD: ctx.wd + 6, maxD: 220 }, (x, y, z) => ({ x, y: y - 0.2, z, ry: r() * 6.28, s: 0.7 + r() * 2.5, color: vary(r, 0.7) })));
    const derrick = merge([part(cone(1.6, 12, 4), 0x333333, { p: [0, 6, 0], r: [0, Math.PI / 4, 0] }), part(box(5, 0.5, 1), 0x8a2b1c, { p: [0, 11, 0] })]);
    ctx.place(derrick, litMat(), ctx.scatter({ count: 6, minD: ctx.wd + 30, maxD: 200 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1.2 })));
    ctx.place(mountain(0xb5653a, 0xd89060), litMat(), ctx.ring(22, 1000, () => ({ s: [280 + r() * 160, 90 + r() * 110, 280 + r() * 160], y: -3 })));
    gatesEvery(ctx, 4, { kind: 'arch', color: 0xb5532c, glow: 0xffd180, height: 15 });
    ctx.dustMotes = true;
    ctx.clouds(10, 0xfff0d8, 0.7);
  },
  weather: 'dust',
};

// ============ 3. NEON ============
THEMES.neon = {
  accent: 0xff2bd6, bgm: { root: 146.8, scale: 'minor', bpm: 134 }, stars: true,
  sky: [0x03000f, 0x2b0a60, 0xff2bd6], fog: [0x1b0640, 80, 560], sun: { color: 0xb070ff, int: 0.9, pos: [100, 200, -300] }, hemi: [0x6a4cff, 0x200840, 1.0], exposure: 1.1,
  road: { base: 0x1b1a26, speck: '120,100,255', line: 0x00f0ff, glow: true, centerColor: 0xff2bd6, kerbA: 0xff2bd6, kerbB: 0x00f0ff, shoulder: 0x14102a, wallA: 0x2a2450, wallB: 0x3a2f70, wallGlow: 0x00f0ff, emissive: 0x2a2a60, emissiveInt: 0.25 },
  flatGround: true,
  terrain: { height: () => -0.6, color: () => 0x0b0718, margin: 520, cell: 16 },
  build(ctx) {
    const { r } = ctx;
    const pal = [['#00f0ff', '#ff2bd6', '#ffe14d'], ['#ff2bd6', '#7c4dff', '#ffffff'], ['#33ff99', '#00f0ff', '#ffffff'], ['#ffb300', '#ff5e00', '#ffe14d']];
    const mats = pal.map((p) => new THREE.MeshBasicMaterial({ map: windowTex(p), color: 0xffffff }));
    const sizes = [[16, 50, 16], [22, 90, 22], [14, 70, 14], [26, 40, 20], [18, 120, 18], [20, 60, 30]];
    sizes.forEach(([w, h, d], k) => {
      const geo = buildingGeo(w, h, d); const mat = mats[k % mats.length];
      const list = ctx.scatter({ count: 34, minD: ctx.wd + 14 + w * 0.6, maxD: 330, tries: 6000, spacing: w * 0.9 }, (x, y, z) => ({ x, y: -0.6, z, ry: r() < 0.5 ? 0 : Math.PI / 2, s: [1, 0.8 + r() * 0.8, 1] }));
      ctx.place(geo, mat, list);
    });
    // rooftop neon trims via sign boards
    const words = [['TURBO', '#00f0ff', '#ffffff'], ['NEON', '#ff2bd6', '#ffd6f8'], ['RACE', '#ffe14d', '#fff7c4'], ['DRIFT', '#33ff99', '#ccffe6'], ['GO!', '#ff5e00', '#ffd2b0']];
    words.forEach(([t, c1, c2]) => {
      const m = new THREE.MeshBasicMaterial({ map: signTex(t, c1, c2) });
      const geo = new THREE.PlaneGeometry(22, 8.25);
      const list = ctx.scatter({ count: 8, minD: ctx.wd + 6, maxD: 60, tries: 3000, spacing: 30 }, (x, y, z) => ({ x, y: 14 + r() * 24, z, ry: r() * 6.28 }));
      const im = instances(geo, m, list); ctx.group.add(im);
    });
    // street lamps
    const lamp = merge([part(cyl(0.18, 0.25, 9, 6), 0x2a2d3a, { p: [0, 4.5, 0] }), part(box(2.6, 0.25, 0.4), 0x2a2d3a, { p: [-1.2, 9, 0] }), part(box(1.2, 0.15, 0.6), 0xfff2c4, { p: [-2.2, 8.85, 0] })]);
    const lamps = []; for (let s = 0; s < ctx.track.length; s += 46) { const side = ((s / 46) | 0) % 2 ? 1 : -1; const p = ctx.track.pointAt(s, side * (ctx.wd + 1.6)); lamps.push({ x: p.x, y: p.y, z: p.z, ry: p.head + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.PI }); }
    ctx.place(lamp, glowMat(), lamps);
    gatesEvery(ctx, 6, { kind: 'arch', color: 0x2a2450, glow: 0xff2bd6, height: 16 });
    ctx.gridFloor(0x00f0ff, 0x07041a);
    ctx.skyline(0x120a30, 0x2b0a60);
  },
  weather: 'rain',
};

// ============ 4. FROST ============
THEMES.frost = {
  accent: 0x7fe0ff, bgm: { root: 220, scale: 'major', bpm: 112 },
  sky: [0x234a96, 0x7db6ea, 0xeaf6ff], fog: [0xd8eaf8, 100, 620], sun: { color: 0xe8f4ff, int: 2.0, pos: [-250, 280, -300] }, hemi: [0xcfe6ff, 0x9fb8d0, 1.25], exposure: 1.05,
  road: { base: 0x4d5a6e, speck: '220,240,255', line: 0xffffff, kerbA: 0x1e88e5, kerbB: 0xffffff, shoulder: 0xe6f4ff, wallA: 0xcfeaff, wallB: 0x8ec9ef, rough: 0.5 },
  terrain: {
    height: (x, z, n) => 3 + 22 * n.fbm(x * 0.005, z * 0.005, 4) + 2 * n.fbm(x * 0.05, z * 0.05, 2),
    color: (h, ns, x, z, v) => mixHex(mixHex(0xf2f9ff, 0xd5e8f7, ns), 0xffffff, smooth(8, 20, h)),
  },
  build(ctx) {
    const { r } = ctx;
    ctx.place(pine(true), litMat(), ctx.scatter({ count: 420, minD: ctx.wd + 7, maxD: 160, tries: 9000 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.7 + r() * 0.9, color: vary(r, 0.85) })));
    const crystal = merge([part(oct(1.0), 0x9fe3ff, { p: [0, 1.6, 0], s: [0.7, 2.0, 0.7] }), part(oct(0.7), 0xd8f6ff, { p: [1.0, 1.0, 0.4], s: [0.6, 1.4, 0.6], r: [0, 0, 0.3] }), part(oct(0.6), 0xbdeeff, { p: [-0.9, 0.8, -0.3], s: [0.5, 1.2, 0.5], r: [0, 0, -0.3] })]);
    ctx.place(crystal, glowMat(), ctx.scatter({ count: 90, minD: ctx.wd + 5, maxD: 140 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1 + r() * 2.2 })));
    const snowman = merge([part(sph(1.4, 9, 7), 0xffffff, { p: [0, 1.3, 0] }), part(sph(1.0, 9, 7), 0xffffff, { p: [0, 3.0, 0] }), part(sph(0.7, 9, 7), 0xffffff, { p: [0, 4.2, 0] }), part(cone(0.12, 0.8, 5), 0xff7a1a, { p: [0, 4.2, 0.8], r: [Math.PI / 2, 0, 0] }), part(cyl(0.5, 0.5, 0.5, 7), 0x222222, { p: [0, 5.1, 0] }), part(sph(0.1, 4, 3), 0x111111, { p: [0.25, 4.4, 0.62] }), part(sph(0.1, 4, 3), 0x111111, { p: [-0.25, 4.4, 0.62] })]);
    ctx.place(snowman, litMat(), ctx.scatter({ count: 16, minD: ctx.wd + 6, maxD: 70 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1 + r() * 0.5 })));
    const igloo = merge([part(sph(4, 12, 8), 0xf4fbff, { p: [0, 0, 0], s: [1, 0.85, 1] }), part(cyl(1.4, 1.4, 3, 8), 0xf4fbff, { p: [0, 1.4, 3.6], r: [Math.PI / 2, 0, 0] }), part(cyl(1.0, 1.0, 0.4, 8), 0x223344, { p: [0, 1.2, 5.2], r: [Math.PI / 2, 0, 0] })]);
    ctx.place(igloo, litMat(), ctx.scatter({ count: 5, minD: ctx.wd + 18, maxD: 120 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1.1 })));
    ctx.place(mountain(0x9db8d8, 0xffffff), litMat(), ctx.ring(22, 980, () => ({ s: [300 + r() * 200, 160 + r() * 200, 300 + r() * 200], y: -5 })));
    ctx.aurora();
    gatesEvery(ctx, 3, { kind: 'arch', color: 0xcfeaff, glow: 0x7fe0ff, height: 13 });
    ctx.clouds(18, 0xffffff, 0.8);
  },
  weather: 'snow',
};

// ============ 5. JUNGLE ============
THEMES.jungle = {
  accent: 0x7cff3a, bgm: { root: 185, scale: 'pent', bpm: 124 },
  sky: [0x2b8a63, 0x7ed8a4, 0xe8ffd0], fog: [0x72c493, 40, 420], sun: { color: 0xfff6c0, int: 2.0, pos: [200, 300, 150] }, hemi: [0xb9ffd0, 0x2f6a3a, 1.1], exposure: 1.0,
  road: { base: 0x5a3f28, speck: '255,200,140', line: 0xf3e2b5, center: false, kerbA: 0x2e7d32, kerbB: 0xe8f5e9, shoulder: 0x3d6b2f, wallA: 0x6d4c2f, wallB: 0x8a6a3f, rough: 1 },
  terrain: {
    height: (x, z, n) => 2 + 15 * n.fbm(x * 0.006, z * 0.006, 4) + 2.5 * n.fbm(x * 0.05, z * 0.05, 2),
    color: (h, ns, x, z, v) => mixHex(mixHex(0x2d7d3a, 0x1d5a2a, ns), 0x3c9a46, v * 0.3),
  },
  build(ctx) {
    const { r } = ctx;
    const big = roundTree(0x6b4423, 0x1d7a35, 0x2f9e45), big2 = roundTree(0x5a3a1e, 0x168a45, 0x39b552);
    [big, big2].forEach((g) => ctx.place(g, litMat(), ctx.scatter({ count: 260, minD: ctx.wd + 6, maxD: 150, tries: 9000 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1.0 + r() * 1.4, color: vary(r, 0.8) }))));
    ctx.place(palm(), litMat(), ctx.scatter({ count: 120, minD: ctx.wd + 5, maxD: 90 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.8 + r() * 0.8, color: vary(r, 0.85) })));
    const fern = merge([0, 1, 2, 3, 4, 5].map((k) => part(cone(0.5, 3.4, 4), k % 2 ? 0x37b34f : 0x2a9a42, { p: [Math.cos(k) * 0.9, 1.3, Math.sin(k) * 0.9], r: [Math.sin(k) * 0.9, 0, -Math.cos(k) * 0.9], s: [1, 1, 0.3] })));
    ctx.place(fern, litMat(), ctx.scatter({ count: 220, minD: ctx.wd + 4, maxD: 60 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.8 + r() * 1.2, color: vary(r, 0.8) })));
    const mush = merge([part(cyl(0.4, 0.55, 2.2, 7), 0xf3e9d2, { p: [0, 1.1, 0] }), part(sph(1.8, 10, 6), 0x7cff3a, { p: [0, 2.3, 0], s: [1, 0.55, 1] })]);
    ctx.place(mush, glowMat(), ctx.scatter({ count: 50, minD: ctx.wd + 5, maxD: 70 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.8 + r() * 1.4, color: vary(r, 0.7) })));
    const ruin = merge([part(box(5, 1.2, 5), 0x7a7a6a, { p: [0, 0.6, 0] }), part(box(4, 1.2, 4), 0x8a8a78, { p: [0, 1.8, 0] }), part(box(3, 1.2, 3), 0x7a7a6a, { p: [0, 3.0, 0] }), part(cyl(0.5, 0.6, 5, 6), 0x909080, { p: [2.7, 2.5, 2.7] }), part(cyl(0.5, 0.6, 3.4, 6), 0x909080, { p: [-2.7, 1.7, 2.7] }), part(box(2, 0.4, 2), 0x2f7a3a, { p: [0, 3.8, 0] })]);
    ctx.place(ruin, litMat(), ctx.scatter({ count: 9, minD: ctx.wd + 14, maxD: 130 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1.4 + r() * 1.4 })));
    ctx.place(rockG(0x5a6a54, 0x7a8a70), litMat(), ctx.scatter({ count: 70, minD: ctx.wd + 5, maxD: 100 }, (x, y, z) => ({ x, y: y - 0.3, z, ry: r() * 6.28, s: 0.8 + r() * 2 })));
    ctx.place(mountain(0x2a7a4a, 0x7fe0a0), litMat(), ctx.ring(22, 900, () => ({ s: [240 + r() * 160, 120 + r() * 120, 240 + r() * 160], y: -5 })));
    gatesEvery(ctx, 3, { kind: 'arch', color: 0x6d4c2f, glow: 0x7cff3a, height: 12 });
  },
  weather: 'fireflies',
};

// ============ 6. VOLCANO ============
THEMES.volcano = {
  accent: 0xff5a1f, bgm: { root: 123.5, scale: 'phrygian', bpm: 138 },
  sky: [0x14040a, 0x7a1a10, 0xff6a1a], fog: [0x5a1408, 60, 520], sun: { color: 0xff8a50, int: 1.6, pos: [-200, 160, -300] }, hemi: [0xff8a5a, 0x2a0a08, 1.0], exposure: 1.1,
  road: { base: 0x2c2628, speck: '255,140,60', line: 0xffc477, style: 'cracks', kerbA: 0xff5a1f, kerbB: 0x2a2024, shoulder: 0x1d1618, wallA: 0x3a3034, wallB: 0x55383a, wallGlow: 0xff6a1a, emissive: 0x501000, emissiveInt: 0.3 },
  terrain: {
    height: (x, z, n) => -10 + 7 * n.fbm(x * 0.012, z * 0.012, 3) + 14 * smooth(0.62, 0.8, n.fbm(x * 0.007 + 5, z * 0.007, 3)),
    color: (h, ns, x, z, v) => mixHex(mixHex(0x211a1c, 0x3b2d30, ns), 0xff5a1f, smooth(-7, -9.5, h) * 0.7),
    flat: true, blend: 30,
  },
  water: { y: -6.5, color: 0xff4d0a, opacity: 1, lava: true },
  build(ctx) {
    const { r } = ctx;
    const spire = merge([part(cone(2.6, 14, 6), 0x2a2124, { p: [0, 7, 0] }), part(cone(1.4, 8, 5), 0x3e3034, { p: [2.4, 4, 1], r: [0, 0, -0.2] }), part(cone(0.5, 3, 5), 0xff5a1f, { p: [0, 14.5, 0] })]);
    ctx.place(spire, litMat(), ctx.scatter({ count: 80, minD: ctx.wd + 8, maxD: 200, tries: 7000 }, (x, y, z) => ({ x, y: y - 1, z, ry: r() * 6.28, s: 0.7 + r() * 1.6, color: vary(r, 0.8) })));
    const crystal = merge([part(oct(1.0), 0xff7a2a, { p: [0, 1.6, 0], s: [0.7, 2.2, 0.7] }), part(oct(0.7), 0xffd27a, { p: [1.0, 1.0, 0.4], s: [0.6, 1.5, 0.6], r: [0, 0, 0.3] })]);
    ctx.place(crystal, glowMat(), ctx.scatter({ count: 70, minD: ctx.wd + 5, maxD: 110 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.8 + r() * 1.8 })));
    ctx.place(rockG(0x2e2528, 0x4a3a3e), litMat(), ctx.scatter({ count: 120, minD: ctx.wd + 5, maxD: 160 }, (x, y, z) => ({ x, y: y - 0.3, z, ry: r() * 6.28, s: 0.8 + r() * 2.4 })));
    // giant volcano
    const volc = merge([part(cone(1, 1, 14), 0x2a2024, { p: [0, 0.5, 0] }), part(cyl(0.3, 0.34, 0.06, 14), 0xff6a1a, { p: [0, 0.98, 0] }), part(cone(0.09, 0.18, 8), 0xff9a3a, { p: [0.0, 1.05, 0] })]);
    const b = ctx.track.bounds;
    ctx.place(volc, glowMat({ fog: true }), [{ x: (b.minX + b.maxX) / 2 + 40, y: -12, z: b.minZ - 520, s: [700, 420, 700] }]);
    ctx.place(mountain(0x2a2024, null), litMat(), ctx.ring(18, 980, () => ({ s: [260 + r() * 200, 120 + r() * 160, 260 + r() * 200], y: -12 })));
    gatesEvery(ctx, 3, { kind: 'arch', color: 0x2a2124, glow: 0xff6a1a, height: 14 });
  },
  weather: 'embers',
};

// ============ 7. CANDY ============
THEMES.candy = {
  accent: 0xff4fa3, bgm: { root: 261.6, scale: 'major', bpm: 128 },
  sky: [0xff6cc4, 0xffb2de, 0xfff0c8], fog: [0xffbfe2, 220, 1200], sun: { color: 0xfff0e0, int: 1.4, pos: [200, 340, 120] }, hemi: [0xffe6f6, 0xffa8d8, 0.7], exposure: 0.95,
  road: { base: 0x6b3b3a, speck: '255,220,230', line: 0xffffff, centerColor: 0xff7ab8, kerbA: 0xff4fa3, kerbB: 0xffffff, shoulder: 0xfff0f8, wallA: 0xff4fa3, wallB: 0xffffff, rough: 0.6 },
  terrain: {
    height: (x, z, n) => 2 + 14 * n.fbm(x * 0.006, z * 0.006, 3) + 3 * n.fbm(x * 0.04, z * 0.04, 2),
    color: (h, ns, x, z, v) => { const band = Math.sin(x * 0.03 + z * 0.021 + ns * 6) > 0.2; return band ? mixHex(0x6fe8c0, 0x55d8b0, ns) : mixHex(0xff8cc8, 0xff6fb8, ns); },
  },
  build(ctx) {
    const { r } = ctx;
    const colors = [0xff4fa3, 0x4dd0ff, 0xffd84d, 0x8f5bff, 0x4dff9c];
    const lolli = (c) => merge([part(cyl(0.22, 0.22, 7, 6), 0xffffff, { p: [0, 3.5, 0] }), part(cyl(2.6, 2.6, 0.5, 14), c, { p: [0, 8, 0], r: [Math.PI / 2, 0, 0] }), part(cyl(1.9, 1.9, 0.56, 14), 0xffffff, { p: [0, 8, 0], r: [Math.PI / 2, 0, 0] }), part(cyl(1.3, 1.3, 0.62, 14), c, { p: [0, 8, 0], r: [Math.PI / 2, 0, 0] }), part(cyl(0.7, 0.7, 0.68, 14), 0xffffff, { p: [0, 8, 0], r: [Math.PI / 2, 0, 0] })]);
    colors.forEach((c) => ctx.place(lolli(c), litMat(), ctx.scatter({ count: 24, minD: ctx.wd + 6, maxD: 130 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.8 + r() * 1.2, color: vary(r, 0.9) }))));
    const cane = (() => { const p = []; for (let k = 0; k < 8; k++) p.push(part(cyl(0.45, 0.45, 1.1, 8), k % 2 ? 0xff3355 : 0xffffff, { p: [0, 0.55 + k * 1.0, 0] })); p.push(part(tor(1.1, 0.45, 8, 12, Math.PI), 0xff3355, { p: [1.1, 8.2, 0] })); return merge(p); })();
    ctx.place(cane, litMat(), ctx.scatter({ count: 60, minD: ctx.wd + 5, maxD: 100 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.9 + r() * 1.0 })));
    const donut = merge([part(tor(3, 1.4, 8, 16), 0xe8a96a, { p: [0, 4.4, 0], r: [Math.PI / 2 - 0.3, 0, 0] }), part(tor(3, 1.15, 8, 16), 0xff5fb0, { p: [0, 4.75, 0], r: [Math.PI / 2 - 0.3, 0, 0], s: [1, 1, 0.9] })]);
    ctx.place(donut, litMat(), ctx.scatter({ count: 22, minD: ctx.wd + 8, maxD: 120 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.8 + r() * 1.0, color: vary(r, 0.9) })));
    const cup = merge([part(cone(2.2, 3, 12), 0xf3d29a, { p: [0, 1.5, 0], r: [Math.PI, 0, 0] }), part(sph(2.5, 10, 7), 0xff7ab8, { p: [0, 4.2, 0], s: [1, 0.9, 1] }), part(sph(1.6, 9, 6), 0xff9acb, { p: [0, 6.3, 0] }), part(sph(0.5, 6, 5), 0xe5122d, { p: [0, 8, 0] })]);
    ctx.place(cup, litMat(), ctx.scatter({ count: 24, minD: ctx.wd + 8, maxD: 120 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.8 + r() * 1.0 })));
    const cone2 = merge([part(cone(1.8, 5, 8), 0xe3a45a, { p: [0, 2.5, 0], r: [Math.PI, 0, 0] }), part(sph(2.3, 9, 7), 0xfff0d0, { p: [0, 6, 0] }), part(sph(1.7, 9, 7), 0x7ad8ff, { p: [0, 8.2, 0] })]);
    ctx.place(cone2, litMat(), ctx.scatter({ count: 24, minD: ctx.wd + 8, maxD: 120 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.9 + r() * 0.9 })));
    ctx.place(merge([part(sph(1, 10, 6), 0xffffff, { s: [1, 0.8, 1] })]), litMat(), ctx.scatter({ count: 50, minD: ctx.wd + 6, maxD: 110 }, (x, y, z) => ({ x, y: y + 0.2, z, s: 1.2 + r() * 2, color: [0xff4fa3, 0x4dd0ff, 0xffd84d, 0x8f5bff][(r() * 4) | 0] })));
    ctx.rainbow();
    gatesEvery(ctx, 4, { kind: 'arch', color: 0xff4fa3, glow: 0xffe14d, height: 14 });
    ctx.clouds(30, 0xfff0fa, 0.9);
  },
  weather: 'sparkle',
};

// ============ 8. MOON ============
THEMES.moon = {
  accent: 0xa0b4ff, bgm: { root: 130.8, scale: 'pent', bpm: 108 }, stars: true, earth: true,
  sky: [0x000004, 0x05050f, 0x0c0c22], fog: [0x070712, 300, 1700], sun: { color: 0xffffff, int: 1.8, pos: [250, 180, 300] }, hemi: [0x6f7fff, 0x303040, 0.5], exposure: 1.1,
  road: { base: 0x3c3d4a, speck: '200,200,230', line: 0xe0e6ff, kerbA: 0x6f7fff, kerbB: 0xffffff, shoulder: 0x8a8a98, wallA: 0xc8cde0, wallB: 0x7d86b8, rough: 0.9 },
  terrain: {
    height: (x, z, n) => {
      let h = 2 + 6 * n.fbm(x * 0.008, z * 0.008, 4);
      // craters
      for (let k = 0; k < 24; k++) {
        const cx = Math.sin(k * 91.7) * 700, cz = Math.cos(k * 53.3) * 700, rad = 50 + ((k * 37) % 70);
        const d = Math.hypot(x - cx, z - cz) / rad;
        if (d < 1.6) h += -9 * (1 - smooth(0.0, 1.0, d)) + 5 * Math.exp(-Math.pow((d - 1.05) * 4, 2));
      }
      return h;
    },
    color: (h, ns, x, z, v) => mixHex(mixHex(0x6a6a76, 0x80808c, ns), 0x4e4e5a, smooth(2, -6, h)),
    flat: true,
  },
  build(ctx) {
    const { r } = ctx;
    ctx.place(rockG(0x7e7e8a, 0xa0a0ae), litMat(), ctx.scatter({ count: 240, minD: ctx.wd + 6, maxD: 260 }, (x, y, z) => ({ x, y: y - 0.2, z, ry: r() * 6.28, s: 0.7 + r() * 3, color: vary(r, 0.75) })));
    const dome = merge([part(sph(7, 14, 8), 0xdfe8ff, { p: [0, 0, 0], s: [1, 0.7, 1] }), part(cyl(7.2, 7.4, 1.4, 14), 0x6b7088, { p: [0, 0.6, 0] }), part(box(4, 3, 4), 0x9aa2c0, { p: [8, 1.5, 0] }), part(cyl(0.2, 0.2, 9, 5), 0xcccccc, { p: [-5, 6, 0] }), part(sph(0.5, 6, 5), 0xff3355, { p: [-5, 10.6, 0] })]);
    ctx.place(dome, litMat(), ctx.scatter({ count: 7, minD: ctx.wd + 25, maxD: 160 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1.2 })));
    const dish = merge([part(cyl(0.4, 0.5, 5, 6), 0xcfd5e8, { p: [0, 2.5, 0] }), part(sph(3.2, 12, 6, 0), 0xf0f4ff, { p: [0.6, 6, 0], s: [1, 0.35, 1], r: [0, 0, 0.6] })]);
    ctx.place(dish, litMat(), ctx.scatter({ count: 14, minD: ctx.wd + 10, maxD: 150 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1 + r() * 0.8 })));
    const panels = merge([part(cyl(0.2, 0.2, 2.4, 5), 0x8890a8, { p: [0, 1.2, 0] }), part(box(7, 0.2, 3.4), 0x1f3a8a, { p: [0, 2.8, 0], r: [-0.5, 0, 0] }), part(box(6.6, 0.22, 0.3), 0x6f8fff, { p: [0, 2.9, 0], r: [-0.5, 0, 0] })]);
    ctx.place(panels, litMat(), ctx.scatter({ count: 20, minD: ctx.wd + 8, maxD: 140 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1 + r() * 0.6 })));
    const flag = merge([part(cyl(0.08, 0.08, 6, 5), 0xdddddd, { p: [0, 3, 0] }), part(box(2.4, 1.5, 0.05), 0xff3355, { p: [1.2, 5.2, 0] })]);
    ctx.place(flag, glowMat(), ctx.scatter({ count: 10, minD: ctx.wd + 4, maxD: 60 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1 })));
    ctx.place(mountain(0x6a6a78, 0xb0b0bc), litMat(), ctx.ring(22, 1500, () => ({ s: [340 + r() * 220, 100 + r() * 160, 340 + r() * 220], y: -20 })));
    gatesEvery(ctx, 4, { kind: 'ring', glow: 0x6f9bff });
  },
  weather: 'none',
};

// ============ 9. AUTUMN ============
THEMES.autumn = {
  accent: 0xff8a1f, bgm: { root: 174.6, scale: 'minor', bpm: 120 },
  sky: [0x3f6ec0, 0xffb286, 0xffe3ba], fog: [0xf2c9a2, 130, 760], sun: { color: 0xffd2a0, int: 2.3, pos: [-300, 160, -260] }, hemi: [0xffe0c0, 0x8a5a2a, 1.05], exposure: 1.05,
  road: { base: 0x45424a, speck: '255,225,190', line: 0xffffff, kerbA: 0xe65100, kerbB: 0xfff3e0, shoulder: 0xb08a40, wallA: 0xa05a2c, wallB: 0xd9a066 },
  terrain: {
    height: (x, z, n) => 6 + 52 * n.fbm(x * 0.0042, z * 0.0042, 4) + 3 * n.fbm(x * 0.04, z * 0.04, 2),
    color: (h, ns, x, z, v) => mixHex(mixHex(0x9aab3f, 0xc99a34, ns), 0xd8c070, smooth(30, 60, h)),
  },
  build(ctx) {
    const { r } = ctx;
    const trees = [roundTree(0x5a3a1e, 0xe5731a, 0xf2a21f), roundTree(0x5a3a1e, 0xc4301a, 0xe5731a), roundTree(0x5a3a1e, 0xf2c21f, 0xf7dd5a)];
    trees.forEach((g) => ctx.place(g, litMat(), ctx.scatter({ count: 150, minD: ctx.wd + 6, maxD: 150, tries: 9000 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.9 + r() * 1.0, color: vary(r, 0.82) }))));
    ctx.place(pine(false, 0x1e5a34, 0x25703f, 0x2f8a4d), litMat(), ctx.scatter({ count: 160, minD: ctx.wd + 6, maxD: 160, tries: 9000 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.8 + r() * 1.0, color: vary(r, 0.8) })));
    const barn = merge([part(box(10, 6, 14), 0xb53a22, { p: [0, 3, 0] }), part(box(10.4, 0.5, 14.4), 0xf2e6d0, { p: [0, 6.2, 0] }), part(cone(8, 4.5, 4), 0x6b4a32, { p: [0, 8.4, 0], r: [0, Math.PI / 4, 0], s: [1.0, 1, 1.45] }), part(box(4, 4.2, 0.2), 0xf2e6d0, { p: [0, 2.1, 7.05] }), part(cyl(2.4, 2.4, 11, 10), 0xcfcfcf, { p: [8, 5.5, 0] }), part(cone(2.8, 2.4, 10), 0x6b4a32, { p: [8, 12.1, 0] })]);
    ctx.place(barn, litMat(), ctx.scatter({ count: 6, minD: ctx.wd + 14, maxD: 100, maxSlope: 0.25 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 1 })));
    const hay = merge([part(cyl(1.0, 1.0, 1.6, 10), 0xe0b43c, { p: [0, 1, 0], r: [0, 0, Math.PI / 2] })]);
    ctx.place(hay, litMat(), ctx.scatter({ count: 50, minD: ctx.wd + 5, maxD: 60 }, (x, y, z) => ({ x, y, z, ry: r() * 6.28, s: 0.9 + r() * 0.5 })));
    const fenceList = []; for (let s = 0; s < ctx.track.length; s += 9) for (const sg of [-1, 1]) { if (((s / 9) | 0) % 5 === 0) continue; const p = ctx.track.pointAt(s, sg * (ctx.wd + 3.5)); fenceList.push({ x: p.x, y: p.y, z: p.z, ry: p.head }); }
    const fence = merge([part(box(0.3, 1.8, 0.3), 0x7a5230, { p: [0, 0.9, 0] }), part(box(0.15, 0.2, 9.4), 0xa8764a, { p: [0, 1.5, 4.5] }), part(box(0.15, 0.2, 9.4), 0xa8764a, { p: [0, 0.9, 4.5] })]);
    ctx.place(fence, litMat(), fenceList);
    ctx.place(mountain(0x8a6a58, 0xf4f0ee), litMat(), ctx.ring(22, 1100, () => ({ s: [320 + r() * 200, 200 + r() * 200, 320 + r() * 200], y: -10 })));
    gatesEvery(ctx, 3, { kind: 'arch', color: 0xa05a2c, glow: 0xffb347, height: 13 });
    ctx.clouds(16, 0xfff0e0, 0.75);
  },
  weather: 'leaves',
};

// ============ 10. SKY ============
THEMES.sky = {
  accent: 0xb06bff, bgm: { root: 233, scale: 'major', bpm: 140 }, stars: true,
  sky: [0x140a48, 0x6a3fd0, 0xff9de0], fog: [0xa779ee, 180, 1100], sun: { color: 0xffd6f0, int: 1.0, pos: [200, 260, -300] }, hemi: [0xd9b8ff, 0x6a3fd0, 0.7], exposure: 1.1,
  road: { base: 0x1b1038, speck: '255,255,255', line: 0xffffff, style: 'rainbow', center: false, kerbA: 0xffffff, kerbB: 0xb06bff, shoulder: 0x2a1a60, wallA: 0xc9b8ff, wallB: 0x8a4bff, wallGlow: 0xff7ad9, emissive: 0x6a40c0, emissiveInt: 0.1, wallH: 0.6, rough: 0.4, metal: 0.2 },
  terrain: null,
  cloudFloor: -70,
  build(ctx) {
    const { r } = ctx;
    const isl = merge([part(cone(9, 18, 8), 0x7a5a48, { p: [0, -8, 0], r: [Math.PI, 0, 0] }), part(cyl(9.4, 9.4, 1.6, 12), 0x5fd36a, { p: [0, 0.2, 0] }), part(cone(1.6, 5, 7), 0x2fa04a, { p: [2, 3.4, 1] }), part(cone(1.2, 4, 7), 0x3fc060, { p: [-2.4, 2.9, -1.2] }), part(sph(1.1, 7, 5), 0xff7ad9, { p: [0, 1.7, -3] })]);
    const b = ctx.track.bounds;
    const list = []; for (let k = 0; k < 46; k++) { const a = r() * 6.28, rad = 120 + r() * 600; const x = (b.minX + b.maxX) / 2 + Math.cos(a) * rad, z = (b.minZ + b.maxZ) / 2 + Math.sin(a) * rad; const n = ctx.track.nearestSample(x, z, 60); if (n) continue; list.push({ x, y: -25 + r() * 90, z, ry: r() * 6.28, s: 1 + r() * 2.4 }); }
    ctx.place(isl, litMat(), list);
    // balloons
    const balloon = merge([part(sph(3, 9, 7), 0xff5a8a, { p: [0, 6, 0], s: [1, 1.15, 1] }), part(cyl(0.05, 0.05, 3, 4), 0x333333, { p: [0, 1.6, 0] }), part(box(1, 0.8, 1), 0x8a5a2a, { p: [0, 0.6, 0] })]);
    ctx.place(balloon, litMat(), Array.from({ length: 14 }, () => { const a = r() * 6.28, rad = 100 + r() * 500; return { x: (b.minX + b.maxX) / 2 + Math.cos(a) * rad, y: 20 + r() * 80, z: (b.minZ + b.maxZ) / 2 + Math.sin(a) * rad, ry: r() * 6.28, s: 1 + r() * 1.2, color: vary(r, 0.9) }; }));
    // planets
    const planet = merge([part(sph(1, 16, 12), 0xff9a5a), part(tor(1.7, 0.08, 4, 40), 0xffe0b0, { r: [1.3, 0, 0.2], s: [1, 1, 0.3] })]);
    ctx.place(planet, litMat({ fog: false }), [{ x: -700, y: 330, z: -900, s: 90 }, { x: 900, y: 240, z: 500, s: 55, color: 0x9a9aff }]);
    // rainbow rings
    const cols = [0xff4d6d, 0xffa51f, 0xffe94d, 0x4dff88, 0x4dc9ff, 0x9b6dff];
    for (let k = 0; k < 8; k++) gate(ctx, ((k + 0.5) / 8) * ctx.track.length + 70, { kind: 'ring', glow: cols[k % cols.length] });
    ctx.clouds(40, 0xffffff, 0.85, true);
  },
  weather: 'sparkle',
};

export default THEMES;
