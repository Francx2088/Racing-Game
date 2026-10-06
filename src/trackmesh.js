// Visual meshes for a course: road deck, barriers, lamps, pylons, start/finish gantries, boost pads,
// hazard zones, ramps and the moving obstacles.
import * as THREE from 'three';
import { canvasTex, css, part, merge, cyl, cone, box, ico, sph, tor, oct, litMat, instances } from './kit.js';
import { rng } from './util.js';
import { asphaltMaps, concreteTexture } from './sky.js';
import { HAMMER } from './race.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// A strip along the road between two lateral/vertical offsets ({d, dy}). With no s0/s1 it follows the
// whole course and leaves the jump gaps open.
export function strip(track, a, b, opts = {}) {
  if (opts.s0 == null && opts.s1 == null) {
    const parts = track.segments.map(([s0, s1]) => stripSpan(track, a, b, { ...opts, s0, s1 }));
    return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  }
  return stripSpan(track, a, b, opts);
}
function stripSpan(track, a, b, { s0 = 0, s1 = null, vTile = 20, lift = 0 } = {}) {
  const N = track.N, sp = track.spacing;
  const i0 = Math.max(0, Math.floor(s0 / sp)), i1 = s1 == null ? N - 1 : Math.min(N - 1, Math.ceil(s1 / sp));
  const cnt = i1 - i0 + 1;
  const pos = new Float32Array(cnt * 6), uv = new Float32Array(cnt * 4), idx = [];
  for (let k = 0; k < cnt; k++) {
    const i = i0 + k, tb = Math.tan(track.bank[i]), rx = track.rx[i], rz = track.rz[i];
    const put = (slot, o0) => {
      const o = typeof o0 === 'function' ? o0(i) : o0;
      const o3 = (k * 2 + slot) * 3;
      pos[o3] = track.px[i] + rx * o.d; pos[o3 + 1] = track.py[i] + tb * o.d + o.dy + lift; pos[o3 + 2] = track.pz[i] + rz * o.d;
    };
    put(0, a); put(1, b);
    const v = (i * sp) / vTile;
    uv[k * 4] = 0; uv[k * 4 + 1] = v; uv[k * 4 + 2] = 1; uv[k * 4 + 3] = v;
    if (k < cnt - 1) { const j = k * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Like strip(), but only where mask[i] is set (e.g. barriers on one side of the road).
function maskedStrip(track, a, b, mask, opts = {}) {
  const runs = []; let i0 = -1;
  for (let i = 0; i <= track.N; i++) {
    const on = i < track.N && mask[i] && track.plain(i * track.spacing);
    if (on && i0 < 0) i0 = i;
    else if (!on && i0 >= 0) { if (i - i0 > 1) runs.push([i0, i - 1]); i0 = -1; }
  }
  if (!runs.length) return null;
  const parts = runs.map(([x, y]) => stripSpan(track, a, b, { ...opts, s0: x * track.spacing, s1: y * track.spacing }));
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
}

const kerbTexture = (a, b) => canvasTex(16, 64, (g) => { g.fillStyle = css(a); g.fillRect(0, 0, 16, 32); g.fillStyle = css(b); g.fillRect(0, 32, 16, 32); }, { repeat: true });

const arrowTex = () => canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = 'rgba(40,28,0,0.6)'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,214,10,0.95)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = '#ffd60a'; g.shadowColor = '#ffb000'; g.shadowBlur = 12;
  for (let k = 0; k < 2; k++) { const y = k * 128; g.beginPath(); g.moveTo(w / 2, y + 10); g.lineTo(w - 14, y + 70); g.lineTo(w - 38, y + 70); g.lineTo(w / 2, y + 36); g.lineTo(38, y + 70); g.lineTo(14, y + 70); g.closePath(); g.fill(); }
}, { repeat: true });

const ZONE = {
  ice: { c: '#7fe3ff', a: 0.92, noise: '#ffffff' }, sand: { c: '#d9b56a', a: 0.9, noise: '#f0d89a' }, oil: { c: '#101018', a: 0.9, noise: '#334' },
  mud: { c: '#5a3a1f', a: 0.92, noise: '#7a5330' }, syrup: { c: '#9b2d8f', a: 0.88, noise: '#d65bd0' }, dust: { c: '#8a8a92', a: 0.9, noise: '#bbbbc4' },
  leaves: { c: '#c8641a', a: 0.9, noise: '#f0a020' }, wet: { c: '#1c2a3a', a: 0.55, noise: '#4a6a8a' }, ash: { c: '#2a2a2e', a: 0.88, noise: '#55555c' },
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

export function buildTrackMeshes(track, th, group) {
  const R = th.road, hw = track.hw, wd = track.wallD, N = track.N;
  const out = { anim: [] };
  const mk = (geo, mat, order = 0, { cast = false, receive = true } = {}) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.renderOrder = order; m.frustumCulled = false; m.castShadow = cast; m.receiveShadow = receive; group.add(m); return m; };

  // ---- road surface (procedural PBR asphalt) ----
  const maps = asphaltMaps({ base: css(R.base), line: css(R.line), center: R.center !== false, centerColor: R.centerColor != null ? css(R.centerColor) : null, edgeGlow: R.edgeGlow != null ? css(R.edgeGlow) : null, wet: !!R.wet, seed: track.def.seed });
  const roadMat = new THREE.MeshStandardMaterial({ map: maps.map, normalMap: maps.normal, normalScale: new THREE.Vector2(0.45, 0.45), roughnessMap: maps.roughMap, roughness: 1, metalness: 0, envMapIntensity: R.env ?? 0.6, side: THREE.DoubleSide });
  mk(strip(track, { d: -hw, dy: 0 }, { d: hw, dy: 0 }, { vTile: 32 }), roadMat, 0, { receive: true });
  const roadMat2 = roadMat.clone(); roadMat2.polygonOffset = true; roadMat2.polygonOffsetFactor = -1; roadMat2.polygonOffsetUnits = -1;

  // ---- rumble kerbs ----
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(R.kerbA, R.kerbB), roughness: 0.7, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  for (const sgn of [-1, 1]) mk(strip(track, { d: sgn * (hw - 0.15), dy: 0.025 }, { d: sgn * (hw + 1.2), dy: 0.025 }, { vTile: 6 }), kerbMat, 1);

  // ---- paved shoulders (between kerb and barrier) ----
  const shMat = new THREE.MeshStandardMaterial({ color: R.shoulder, normalMap: maps.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  for (const sgn of [-1, 1]) mk(strip(track, { d: sgn * (hw + 1.2), dy: 0 }, { d: sgn * wd, dy: 0 }, { vTile: 6 }), shMat, 0);

  // ---- deck: concrete box-girder under the road, so it reads as a real elevated structure ----
  const conc = concreteTexture({ a: R.deck ?? 0x9a9a96 });
  const concMat = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.25 });
  const slab = [[-(wd + 0.7), -0.05], [-(wd + 0.7), -1.5], [-hw * 0.5, -3.6], [hw * 0.5, -3.6], [wd + 0.7, -1.5], [wd + 0.7, -0.05]];
  for (let i = 0; i < slab.length - 1; i++) mk(strip(track, { d: slab[i][0], dy: slab[i][1] }, { d: slab[i + 1][0], dy: slab[i + 1][1] }, { vTile: 10 }), concMat, 0, { cast: true });
  if (R.underglow != null) {
    const gm = new THREE.MeshBasicMaterial({ color: R.underglow, side: THREE.DoubleSide });
    for (const sgn of [-1, 1]) mk(strip(track, { d: sgn * (wd + 0.7), dy: -1.45 }, { d: sgn * (wd + 0.6), dy: -1.75 }, { vTile: 10 }), gm, 2, { receive: false });
    mk(strip(track, { d: -hw * 0.45, dy: -3.62 }, { d: hw * 0.45, dy: -3.62 }, { vTile: 10 }), gm, 2, { receive: false });
  }

  // ---- crash barriers ----
  const btype = R.barrier || 'jersey';
  const bandTex = concreteTexture({ a: 0xc8c8c4, bandA: R.wallA, bandB: R.wallB, seed: 3 });
  const barMat = new THREE.MeshStandardMaterial({ map: bandTex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xc7ccd2, metalness: 0.9, roughness: 0.32, side: THREE.DoubleSide, envMapIntensity: 1.1 });
  const edgeMat = new THREE.MeshBasicMaterial({ color: R.edge ?? th.accent, side: THREE.DoubleSide });
  const open = (m) => m.map((v) => (v ? 0 : 1));
  for (const sgn of [-1, 1]) {
    const mask = sgn < 0 ? track.wallL : track.wallR;
    const S = (a, b, o) => maskedStrip(track, a, b, mask, o);
    if (btype === 'rail') {
      const prof = [[0.05, 0.36], [0.02, 0.5], [0.07, 0.62], [0.02, 0.76], [0.05, 0.9]];
      for (let i = 0; i < prof.length - 1; i++) mk(S({ d: sgn * (wd + prof[i][0]), dy: prof[i][1] }, { d: sgn * (wd + prof[i + 1][0]), dy: prof[i + 1][1] }, { vTile: 8 }), metalMat, 0, { cast: true });
    } else if (btype === 'glass') {
      const gl = new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, envMapIntensity: 1.5, depthWrite: false });
      mk(S({ d: sgn * (wd + 0.1), dy: 0.45 }, { d: sgn * (wd + 0.1), dy: 1.3 }, { vTile: 8 }), gl, 3, { receive: false });
      const prof = [[0, 0], [0.12, 0.3], [0.2, 0.45], [0.5, 0.45], [0.5, -1.5]];
      for (let i = 0; i < prof.length - 1; i++) mk(S({ d: sgn * (wd + prof[i][0]), dy: prof[i][1] }, { d: sgn * (wd + prof[i + 1][0]), dy: prof[i + 1][1] }, { vTile: 16 }), barMat, 0, { cast: true });
      mk(S({ d: sgn * (wd + 0.1), dy: 1.3 }, { d: sgn * (wd + 0.1), dy: 1.35 }, { vTile: 8 }), metalMat, 0);
    } else {
      const prof = [[0, 0], [0.13, 0.3], [0.22, 0.88], [0.5, 0.95], [0.5, -1.5]];
      for (let i = 0; i < prof.length - 1; i++) mk(S({ d: sgn * (wd + prof[i][0]), dy: prof[i][1] }, { d: sgn * (wd + prof[i + 1][0]), dy: prof[i + 1][1] }, { vTile: 16 }), barMat, 0, { cast: true });
    }
    if (R.wallGlow != null) mk(S({ d: sgn * (wd - 0.02), dy: 0.55 }, { d: sgn * (wd - 0.02), dy: 0.62 }, { vTile: 8 }), new THREE.MeshBasicMaterial({ color: R.wallGlow, side: THREE.DoubleSide }), 2, { receive: false });
    // open edge: a glowing lip so the drop is readable at speed
    const om = open(mask);
    mk(maskedStrip(track, { d: sgn * (wd - 0.35), dy: 0.03 }, { d: sgn * (wd + 0.02), dy: 0.03 }, om, { vTile: 4 }), edgeMat, 4, { receive: false });
    mk(maskedStrip(track, { d: sgn * (wd + 0.02), dy: 0.03 }, { d: sgn * (wd + 0.02), dy: -0.6 }, om, { vTile: 4 }), edgeMat, 4, { receive: false });
  }
  if (btype === 'rail') {
    const post = instances(new THREE.BoxGeometry(0.14, 1.0, 0.14), new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.7, metalness: 0.4 }),
      (() => { const l = []; for (let s = 0; s < track.length; s += 4) for (const sg of [-1, 1]) { if (!track.plain(s) || !track.wallAt(s, sg)) continue; const p = track.pointAt(s, sg * (wd + 0.25)); l.push({ x: p.x, y: p.y + 0.35, z: p.z, ry: p.head }); } return l; })());
    post.castShadow = true; group.add(post);
  }
  // chevron boards on the outside of the sharp bends
  {
    const chev = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#12141c'; g.fillRect(0, 0, w, h); g.fillStyle = css(th.accent); g.beginPath(); g.moveTo(30, 14); g.lineTo(82, 64); g.lineTo(30, 114); g.lineTo(52, 114); g.lineTo(104, 64); g.lineTo(52, 14); g.closePath(); g.fill(); });
    const list = { [-1]: [], [1]: [] };
    for (let i = 0; i < N; i += 7) {
      const k = track.kappa[i]; if (Math.abs(k) < 1 / 150) continue;
      const side = k > 0 ? -1 : 1, s = i * track.spacing; if (!track.plain(s) || !track.wallAt(s, side)) continue;
      const p = track.pointAt(s, side * (wd + 0.6));
      list[side].push({ x: p.x, y: p.y + 2.1, z: p.z, ry: p.head + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
    }
    const pg = new THREE.PlaneGeometry(2.4, 2.4);
    for (const side of [-1, 1]) { const m = new THREE.MeshBasicMaterial({ map: chev, side: THREE.DoubleSide }); if (side < 0) { m.map = chev.clone(); m.map.repeat.x = -1; m.map.offset.x = 1; m.map.needsUpdate = true; } group.add(instances(pg, m, list[side])); }
    const legs = [...list[-1], ...list[1]].map((o) => ({ ...o, y: o.y - 1.6 }));
    group.add(instances(new THREE.BoxGeometry(0.15, 1.6, 0.15), new THREE.MeshStandardMaterial({ color: 0x30343c, metalness: 0.6, roughness: 0.5 }), legs));
  }

  // ---- forks: two branch roads that split apart through a bend and rejoin ----
  for (const q of track.splits) {
    const o = { s0: q.s0, s1: q.s1 };
    for (const k of [0, 1]) {
      const w = k ? q.wOut : q.wIn, sh = track.shoulder, outer = k ? -q.side : q.side;
      const at = (dd, dy = 0) => (i) => ({ d: track.branchCenter(q, k, i * track.spacing) + dd, dy });
      const rm = k ? roadMat : roadMat2;
      mk(stripSpan(track, at(-w), at(w), { ...o, vTile: 32 }), rm, k ? 0 : 1);
      for (const sg of [-1, 1]) {
        mk(stripSpan(track, at(sg * (w - 0.15), 0.025 + k * 0.01), at(sg * (w + 1.2), 0.025 + k * 0.01), { ...o, vTile: 6 }), kerbMat, 1);
        mk(stripSpan(track, at(sg * (w + 1.2)), at(sg * (w + sh)), { ...o, vTile: 6 }), shMat, 0);
        const edge = sg * (w + sh);
        const prof = [[0, 0], [0.13, 0.3], [0.22, 0.88], [0.5, 0.95], [0.5, -1.5]];
        const wall = (span) => { for (let i = 0; i < prof.length - 1; i++) mk(stripSpan(track, at(edge + sg * prof[i][0], prof[i][1]), at(edge + sg * prof[i + 1][0], prof[i + 1][1]), { ...span, vTile: 16 }), barMat, 0, { cast: true }); };
        if (k === 1 && sg === outer) wall(o);
        else if (sg === -outer) {
          // inner edges: walled wherever the void between the branches is open
          let a0 = null, a1 = null; for (let ss = q.s0; ss <= q.s1; ss += 2) if (track.forkGap(q, ss) > 0) { if (a0 == null) a0 = ss; a1 = ss; }
          if (a0 != null) wall({ s0: a0, s1: a1 });
        } else {
          mk(stripSpan(track, at(edge - sg * 0.35, 0.03), at(edge + sg * 0.02, 0.03), { ...o, vTile: 4 }), edgeMat, 4, { receive: false });
          mk(stripSpan(track, at(edge + sg * 0.02, 0.03), at(edge + sg * 0.02, -0.6), { ...o, vTile: 4 }), edgeMat, 4, { receive: false });
        }
      }
      const W = w + sh + 0.7, prof = [[-W, -0.05], [-W, -1.5], [-w * 0.5, -3.2], [w * 0.5, -3.2], [W, -1.5], [W, -0.05]];
      for (let i = 0; i < prof.length - 1; i++) mk(stripSpan(track, at(prof[i][0], prof[i][1]), at(prof[i + 1][0], prof[i + 1][1]), { ...o, vTile: 10 }), concMat, 0, { cast: true });
    }
    // fork signs: an arrow board for each branch where they part
    const sgn = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#12141c'; g.fillRect(0, 0, w, h); g.strokeStyle = css(th.accent); g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = '#fff'; g.font = 'italic 900 34px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('SHORTCUT', w / 2, h / 2);
    });
    const p = track.pointAt(q.s0 + q.ramp * 0.7, track.branchCenter(q, 0, q.s0 + q.ramp * 0.7));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: sgn, side: THREE.DoubleSide }));
    board.position.set(p.x, p.y + 7.5, p.z); board.rotation.y = p.head + Math.PI; group.add(board);
    const poles = new THREE.Mesh(new THREE.BoxGeometry(0.25, 7.5, 0.25), new THREE.MeshStandardMaterial({ color: 0x30343c, metalness: 0.6, roughness: 0.5 }));
    poles.position.set(p.x, p.y + 3.75, p.z); group.add(poles);
  }

  // ---- lamp posts (speed cues + night lighting) ----
  {
    const pole = merge([part(cyl(0.1, 0.16, 9, 8), 0x3a3f48, { p: [0, 4.5, 0] }), part(box(0.18, 0.18, 2.6), 0x3a3f48, { p: [0, 8.9, 1.2] }), part(box(0.5, 0.12, 0.9), 0xffffff, { p: [0, 8.78, 2.4] })]);
    const lamps = [], pools = [];
    for (let s = 30; s < track.length; s += 55) {
      if (!track.plain(s)) continue;
      const side = ((s / 55) | 0) % 2 ? 1 : -1; const p = track.pointAt(s, side * (wd + 0.5));
      lamps.push({ x: p.x, y: p.y, z: p.z, ry: p.head + (side > 0 ? Math.PI : 0) + Math.PI });
      const q = track.pointAt(s, side * (hw * 0.55)); pools.push({ x: q.x, y: q.y + 0.04, z: q.z, ry: p.head, s: [hw * 1.8, 1, hw * 1.8] });
    }
    // lamp arm points to the road: arm along local +z -> rotate so it faces the road centre
    const lm = instances(pole, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.0 }), lamps);
    lm.castShadow = false; group.add(lm);
    out.lampHeads = lamps;
    if (th.night) {
      const t = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,225,170,0.55)'); gr.addColorStop(1, 'rgba(255,225,170,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
      const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
      const pm = instances(pg, new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), pools);
      pm.renderOrder = 6; group.add(pm);
    }
  }

  // ---- pylons holding the deck up in the sky ----
  if (th.pylons !== 'none') {
    const pg = new THREE.CylinderGeometry(1.8, 3.2, 420, 10); pg.translate(0, -210, 0);
    const list = []; for (let s = 40; s < track.length; s += th.pylonGap ?? 120) {
      if (!track.hasRoad(s - 10) || !track.hasRoad(s + 10)) continue;
      const q = track.splitAt(s);
      for (const d of q ? [track.branchCenter(q, 0, s), track.branchCenter(q, 1, s)] : [0]) { const p = track.pointAt(s, d); list.push({ x: p.x, y: p.y - 3.5, z: p.z }); }
    }
    const pm = instances(pg, concMat, list); pm.castShadow = false; group.add(pm);
  }

  // hazard zones + crosswind bands
  const windTex = canvasTex(256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 6; g.lineCap = 'round';
    for (let k = 0; k < 4; k++) { const x = 30 + k * 64; g.beginPath(); g.moveTo(x - 14, 14); g.lineTo(x + 6, 32); g.lineTo(x - 14, 50); g.stroke(); }
  }, { repeat: true });
  windTex.wrapS = THREE.RepeatWrapping;
  for (const z of track.zones) {
    if (z.type === 'wind') {
      const t = windTex.clone(); t.needsUpdate = true; t.repeat.set(z.dir > 0 ? 1 : -1, 1);
      const g = strip(track, { d: -track.wallD, dy: 0.06 }, { d: track.wallD, dy: 0.06 }, { s0: z.s0, s1: z.s1, vTile: 8 });
      const m = mk(g, new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), 3, { receive: false });
      out.anim.push((tt) => { t.offset.x = -tt * 0.6; });
      continue;
    }
    const g = strip(track, { d: z.d0, dy: 0.02 }, { d: z.d1, dy: 0.02 }, { s0: z.s0, s1: z.s1, vTile: z.s1 - z.s0 });
    mk(g, new THREE.MeshStandardMaterial({ map: zoneTex(z.type), transparent: true, opacity: ZONE[z.type].a, roughness: ['ice', 'oil', 'wet'].includes(z.type) ? 0.08 : 0.9, metalness: ['ice', 'wet'].includes(z.type) ? 0.25 : 0, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 3);
  }

  // start + finish lines with gantries
  const ck = canvasTex(128, 32, (g) => { const q = 16; for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) & 1 ? '#fff' : '#111'; g.fillRect(x * q, y * q, q, q); } });
  const pillarMat = new THREE.MeshStandardMaterial({ color: R.gantry ?? 0x2c3038, roughness: 0.45, metalness: 0.8 });
  const gantry = (s, label) => {
    mk(strip(track, { d: -hw, dy: 0.04 }, { d: hw, dy: 0.04 }, { s0: s, s1: s + 4, vTile: 4 }), new THREE.MeshBasicMaterial({ map: ck, side: THREE.DoubleSide }), 4);
    const p = track.pointAt(s + 2, 0), i0 = p.i, P = (d, y) => new THREE.Vector3(track.px[i0] + track.rx[i0] * d, track.py[i0] + y, track.pz[i0] + track.rz[i0] * d);
    const grp = new THREE.Group(), pg = new THREE.CylinderGeometry(0.5, 0.7, 11, 12);
    for (const sg of [-1, 1]) { const m = new THREE.Mesh(pg, pillarMat); m.position.copy(P(sg * (wd + 0.2), 5.0)); m.castShadow = true; grp.add(m); }
    const banner = canvasTex(1024, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, css(th.accent)); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, css(th.accent));
      g.fillStyle = '#10131c'; g.fillRect(0, 0, w, h); g.fillStyle = gr; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
      g.font = 'italic 900 78px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w / 2, h / 2 + 4);
    });
    const bm = new THREE.Mesh(new THREE.BoxGeometry((wd + 0.2) * 2 + 1.6, 3.2, 1), [pillarMat, pillarMat, pillarMat, pillarMat, new THREE.MeshBasicMaterial({ map: banner }), new THREE.MeshBasicMaterial({ map: banner })]);
    bm.position.copy(P(0, 10.4)); bm.castShadow = true; bm.rotation.y = track.head[i0]; grp.add(bm);
    group.add(grp);
  };
  gantry(track.startS, 'START');
  gantry(track.finishS, 'FINISH');
  // end-of-road barrier
  {
    const p = track.pointAt(track.length - 1, 0);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wd * 2 + 1.4, 1.6, 1.2), new THREE.MeshStandardMaterial({ map: concreteTexture({ a: 0xc8c8c4, bandA: R.wallA, bandB: R.wallB, seed: 9 }), roughness: 0.85 }));
    wall.position.set(p.x, p.y + 0.8, p.z); wall.rotation.y = p.head; group.add(wall);
  }

  // boost pads (yellow)
  const at = arrowTex();
  const padMat = new THREE.MeshBasicMaterial({ map: at, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  for (const p of track.pads) mk(strip(track, { d: p.d - p.w, dy: 0.05 }, { d: p.d + p.w, dy: 0.05 }, { s0: p.s, s1: p.s + p.len, vTile: p.w * 2 }), padMat, 5, { receive: false });
  out.anim.push((t) => { at.offset.y = -t * 1.2; });

  // ramps (jump ramps span the whole deck, with a hazard-striped face)
  const stripeTex = canvasTex(64, 64, (g) => { g.fillStyle = '#ffcc22'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#222'; for (let i = -1; i < 3; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 48, 64); g.lineTo(i * 32 + 32, 64); g.fill(); } }, { repeat: true });
  const rampTexMat = new THREE.MeshStandardMaterial({ map: stripeTex, color: 0xb0b0b0, roughness: 0.7, side: THREE.DoubleSide });
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.8, side: THREE.DoubleSide });
  for (const q of track.ramps) {
    const n = 8, verts = [], uvs = [], ind = [];
    for (let k = 0; k <= n; k++) {
      const s = q.s + (q.len * k) / n, h = q.h * (k / n), pA = track.pointAt(s, -q.w), pB = track.pointAt(s, q.w);
      verts.push(pA.x, pA.y + h + 0.05, pA.z, pB.x, pB.y + h + 0.05, pB.z); uvs.push(0, k, q.w / 2, k);
      if (k < n) { const j = k * 2; ind.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(ind); g.computeVertexNormals();
    mk(g, rampTexMat, 2, { cast: true });
    const a = track.pointAt(q.s + q.len, -q.w), b = track.pointAt(q.s + q.len, q.w), a0 = track.pointAt(q.s, -q.w), b0 = track.pointAt(q.s, q.w);
    const bf = new THREE.BufferGeometry();
    bf.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y - 3.6, a.z, b.x, b.y - 3.6, b.z, a.x, a.y + q.h, a.z, b.x, b.y + q.h, b.z, a0.x, a0.y, a0.z, b0.x, b0.y, b0.z], 3));
    bf.setIndex([0, 1, 2, 1, 3, 2, 0, 2, 4, 1, 5, 3]); bf.computeVertexNormals();
    mk(bf, rampMat, 2);
  }

  // obstacles: crates are free bodies (race.obs), the rest are machines that move on the race clock
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(0, 0, 0, 'YXZ'), v3 = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), tmp = {};
  const byKind = (k) => track.obstacles.map((o, i) => [o, i]).filter(([o]) => o.kind === k);
  const kinds = {};
  for (const k of ['crate', 'slider', 'hammer', 'sweeper']) {
    const list = byKind(k); if (!list.length) continue;
    const og = obstacleGeo(k, th);
    const im = instances(og.geo, og.mat, list.map(() => ({ x: 0, y: 0, z: 0 }))); im.castShadow = true; im.frustumCulled = false; group.add(im);
    kinds[k] = { list, im };
    // static frames for the moving machines
    if (k === 'hammer' || k === 'sweeper') {
      const fg = frameGeo(k, wd);
      const fl = list.map(([o]) => { const p = track.pointAt(o.s, 0); return { x: p.x, y: p.y, z: p.z, ry: p.head }; });
      const fm = instances(fg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 }), fl); fm.castShadow = true; group.add(fm);
    }
  }
  out.updatePickups = (t, raceT = t, obs = null) => {
    for (const k in kinds) {
      const { list, im } = kinds[k];
      list.forEach(([o0, idx], j) => {
        const o = obs ? obs[idx] : o0;
        if (k === 'crate') {
          if (obs) { v3.set(o.x, o.y, o.z); ee.set(o.rx, o.ry, o.rz); sc.setScalar(o.gone ? 0.0001 : 1); }
          else { const p = track.pointAt(o.s, o.d, tmp); v3.set(p.x, p.y + 0.8 + (o.stack ? 1.6 : 0), p.z); ee.set(0, o.s, 0); sc.setScalar(1); }
        } else if (k === 'slider') {
          const p = track.pointAt(o.s, track.obstacleD(o, raceT), tmp); v3.set(p.x, p.y, p.z); ee.set(0, p.head, 0); sc.setScalar(1);
        } else if (k === 'hammer') {
          const d = track.obstacleD(o, raceT), p = track.pointAt(o.s, 0, tmp); v3.set(p.x, p.y + HAMMER.pivot, p.z);
          ee.set(0, p.head, -Math.asin(Math.max(-1, Math.min(1, d / HAMMER.arm)))); sc.setScalar(1);
        } else {
          const p = track.pointAt(o.s, 0, tmp); v3.set(p.x, p.y, p.z); ee.set(0, p.head + raceT * o.freq + o.phase, 0); sc.set(o.len / 13.5, 1, 1);
        }
        qq.setFromEuler(ee); m4.compose(v3, qq, sc); im.setMatrixAt(j, m4);
      });
      im.instanceMatrix.needsUpdate = true;
    }
  };
  out.updatePickups(0, 0);
  return out;
}

// Static gantry over a hammer / hub under a sweeper.
function frameGeo(kind, wd) {
  if (kind === 'hammer') {
    const H = HAMMER.pivot;
    return merge([
      part(box(1.2, H + 1, 1.2), 0x2b2f38, { p: [-(wd + 0.8), (H + 1) / 2, 0] }), part(box(1.2, H + 1, 1.2), 0x2b2f38, { p: [wd + 0.8, (H + 1) / 2, 0] }),
      part(box(wd * 2 + 2.8, 1.4, 1.6), 0x2b2f38, { p: [0, H + 0.6, 0] }), part(box(wd * 2 + 2.9, 0.3, 1.7), 0xffc414, { p: [0, H - 0.2, 0] }),
      part(cyl(0.9, 0.9, 2.2, 14), 0x8a909a, { p: [0, H, 0], r: [Math.PI / 2, 0, 0] }),
    ]);
  }
  return merge([part(cyl(1.25, 1.6, 0.5, 18), 0x2b2f38, { p: [0, 0.25, 0] }), part(cyl(0.85, 0.95, 2.6, 14), 0x8a909a, { p: [0, 1.3, 0] }), part(cyl(0.95, 0.95, 0.25, 14), 0xffc414, { p: [0, 2.0, 0] })]);
}

const crateTex = () => canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#a8743c'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 5; y++) { g.fillStyle = y % 2 ? '#9a6a34' : '#b07c42'; g.fillRect(10, 10 + y * 22, w - 20, 20); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(10, 29 + y * 22, w - 20, 2); }
  g.fillStyle = '#6b4520'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10); g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
  g.save(); g.translate(w / 2, h / 2); g.rotate(Math.atan2(h, w)); g.fillRect(-w * 0.7, -6, w * 1.4, 12); g.restore();
  g.fillStyle = 'rgba(20,10,0,0.55)'; g.font = '900 20px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.fillText('FRAGILE', w / 2, h / 2 - 14);
});

function obstacleGeo(kind, th) {
  if (kind === 'crate') {
    const g = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    return { geo: g, mat: new THREE.MeshStandardMaterial({ map: crateTex(), roughness: 0.85, metalness: 0 }) };
  }
  const acc = th.accent, mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6, emissive: 0x000000 });
  if (kind === 'slider') {
    return { geo: merge([
      part(box(4.6, 2.2, 2.2), 0x262a33, { p: [0, 1.2, 0] }), part(box(4.7, 0.5, 2.3), 0xffc414, { p: [0, 1.6, 0] }), part(box(4.7, 0.5, 2.3), 0x111318, { p: [0, 0.6, 0] }),
      part(box(4.8, 0.14, 2.4), acc, { p: [0, 2.35, 0] }), part(box(4.2, 0.2, 1.8), 0x15171c, { p: [0, 0.1, 0] }),
    ]), mat };
  }
  if (kind === 'hammer') {
    const L = HAMMER.arm;
    return { geo: merge([
      part(box(0.7, L - 1.5, 0.7), 0x8a909a, { p: [0, -(L - 1.5) / 2, 0] }),
      part(cyl(1.7, 1.7, 3.6, 16), 0x262a33, { p: [0, -L, 0], r: [Math.PI / 2, 0, 0] }), part(cyl(1.75, 1.75, 0.6, 16), 0xffc414, { p: [0, -L, 0], r: [Math.PI / 2, 0, 0] }),
      part(cyl(1.2, 1.2, 3.8, 16), acc, { p: [0, -L, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 1] }),
    ]), mat };
  }
  // sweeper: a long arm on a spinning hub
  return { geo: merge([
    part(box(2 * 13.5, 0.9, 1.0), 0x262a33, { p: [0, 1.15, 0] }), part(box(2 * 13.5, 0.22, 1.05), 0xffc414, { p: [0, 1.15, 0] }),
    part(box(2 * 13.5 + 0.4, 0.12, 1.1), acc, { p: [0, 1.65, 0] }), part(cyl(1.1, 1.1, 1.2, 16), 0x3a3f4a, { p: [0, 1.2, 0] }),
  ]), mat };
}
