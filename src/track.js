// Course data: spline sampling, road frames, nearest-point queries and gameplay layout
// (boost pads, jumps, checkpoints, hazards, obstacles). No rendering here.
import * as THREE from 'three';
import { rng, clamp, wrapAngle } from './util.js';
import { generateCourse } from './trackgen.js';

const SPACING = 2;

export class Track {
  constructor(def) {
    this.def = def;
    this.hw = def.hw;
    this.shoulder = def.shoulder;
    this.wallD = def.hw + def.shoulder;
    const course = generateCourse({ seed: def.seed, ...def.course });
    const pts = course.pts.map((p) => new THREE.Vector3(p[0], p[2], p[1]));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    curve.arcLengthDivisions = 12000;
    const total = curve.getLength();
    const N = Math.round(total / SPACING) + 1;
    this.N = N;
    this.length = total;
    this.spacing = total / (N - 1);
    const sp = curve.getSpacedPoints(N - 1);
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    for (let i = 0; i < N; i++) { px[i] = sp[i].x; py[i] = sp[i].y; pz[i] = sp[i].z; }
    this.px = px; this.py = py; this.pz = pz;

    const c = (i) => clamp(i, 0, N - 1);
    this.c = c;
    const tx = new Float32Array(N), tz = new Float32Array(N), head = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = c(i + 1), b = c(i - 1);
      const dx = px[a] - px[b], dz = pz[a] - pz[b], l = Math.hypot(dx, dz) || 1;
      tx[i] = dx / l; tz[i] = dz / l; head[i] = Math.atan2(tx[i], tz[i]);
    }
    this.tx = tx; this.tz = tz; this.head = head;
    this.rx = new Float32Array(N); this.rz = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.rx[i] = -tz[i]; this.rz[i] = tx[i]; }

    // signed curvature (positive = turning right), smoothed
    const kap = new Float32Array(N);
    for (let i = 0; i < N - 1; i++) kap[i] = -wrapAngle(head[i + 1] - head[i]) / this.spacing;
    this.kappa = smoothArr(kap, 6);
    this.absKappa = this.kappa.map(Math.abs);
    const bank = new Float32Array(N);
    for (let i = 0; i < N; i++) bank[i] = clamp(-this.kappa[i] * def.bank * 60, -def.maxBank, def.maxBank);
    this.bank = smoothArr(bank, 10);
    this.slope = new Float32Array(N);
    for (let i = 0; i < N; i++) this.slope[i] = (py[c(i + 1)] - py[c(i - 1)]) / (2 * this.spacing);

    // open gaps in the road (jumps); arc-length positions of the generator's control points
    this.gaps = course.gaps.map((g) => {
      const p = course.pts[g.k];
      let best = 0, bd = 1e12;
      for (let i = 0; i < N; i++) { const d = (px[i] - p[0]) ** 2 + (pz[i] - p[1]) ** 2; if (d < bd) { bd = d; best = i; } }
      const s0 = best * this.spacing;
      return { s0, s1: s0 + g.len };
    });

    this.cell = 24;
    this.grid = new Map();
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i++) {
      const k = this._key(Math.floor(px[i] / this.cell), Math.floor(pz[i] / this.cell));
      let arr = this.grid.get(k); if (!arr) this.grid.set(k, (arr = [])); arr.push(i);
      minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]); minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };

    this.startS = 90;                       // start line
    this.finishS = this.length - 190;       // finish line; road continues as a run-off
    this._buildContent();
  }

  _key(a, b) { return a * 73856093 ^ b * 19349663; }

  nearestSample(x, z, maxR = 96) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell), rr = Math.ceil(maxR / this.cell);
    let best = -1, bd = maxR * maxR;
    for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) {
      const arr = this.grid.get(this._key(cx + a, cz + b)); if (!arr) continue;
      for (const i of arr) { const dx = this.px[i] - x, dz = this.pz[i] - z, d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = i; } }
    }
    return best < 0 ? null : { i: best, d2: bd };
  }

  // Locate a world position on the road. `hint` = previous index for a fast local search.
  query(x, z, hint, out) {
    const N = this.N;
    let best = 0, bd = 1e12;
    if (hint == null || hint < 0) {
      const n = this.nearestSample(x, z, 600); best = n ? n.i : 0;
    } else {
      for (let k = -16; k <= 16; k++) {
        const i = hint + k; if (i < 0 || i >= N) continue;
        const dx = this.px[i] - x, dz = this.pz[i] - z, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = i; }
      }
    }
    const i = best, sp = this.spacing;
    const along = (x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i];
    let i0, frac;
    if (along >= 0) { i0 = Math.min(i, N - 2); frac = (i - i0) + along / sp; }
    else { i0 = Math.max(i - 1, 0); frac = (i - i0) + along / sp; }
    frac = clamp(frac, 0, 1);
    const i1 = i0 + 1;
    const cx = this.px[i0] + (this.px[i1] - this.px[i0]) * frac, cz = this.pz[i0] + (this.pz[i1] - this.pz[i0]) * frac;
    const rx = this.rx[i0] + (this.rx[i1] - this.rx[i0]) * frac, rz = this.rz[i0] + (this.rz[i1] - this.rz[i0]) * frac;
    const rl = Math.hypot(rx, rz) || 1;
    const d = ((x - cx) * rx + (z - cz) * rz) / rl;
    const bank = this.bank[i0] + (this.bank[i1] - this.bank[i0]) * frac;
    const y0 = this.py[i0] + (this.py[i1] - this.py[i0]) * frac;
    out.i0 = i0; out.frac = frac;
    out.s = (i0 + frac) * this.spacing;
    out.d = d; out.bank = bank; out.y = y0;
    out.surfaceY = y0 + Math.tan(bank) * d;
    out.slope = this.slope[i0];
    out.head = this.head[i0];
    return out;
  }

  idxAtS(s) { return clamp(Math.round(s / this.spacing), 0, this.N - 1); }
  pointAt(s, d, out = {}) {
    const i = this.idxAtS(s);
    out.x = this.px[i] + this.rx[i] * d; out.z = this.pz[i] + this.rz[i] * d;
    out.y = this.py[i] + Math.tan(this.bank[i]) * d; out.head = this.head[i]; out.i = i;
    return out;
  }
  curvAhead(i, dist) {
    const n = Math.ceil(dist / this.spacing); let m = 0;
    for (let k = 0; k < n; k += 2) m = Math.max(m, this.absKappa[Math.min(i + k, this.N - 1)]);
    return m;
  }
  hasRoad(s) { for (const g of this.gaps) if (s > g.s0 && s < g.s1) return false; return s >= 0 && s <= this.length; }
  gapAhead(s, dist) { for (const g of this.gaps) if (g.s0 > s && g.s0 - s < dist) return g; return null; }
  // road pieces between gaps, as [s0, s1]
  get segments() {
    const out = []; let s = 0;
    for (const g of this.gaps) { out.push([s, g.s0]); s = g.s1; }
    out.push([s, this.length]);
    return out;
  }

  _buildContent() {
    const def = this.def, r = rng(def.seed * 7 + 3), L = this.length;
    const used = [[0, this.startS + 60], [this.finishS - 40, L]];
    for (const g of this.gaps) used.push([g.s0 - 70, g.s1 + 50]);
    const free = (s, len) => used.every(([a, b]) => s + len < a - 12 || s > b + 12);
    const straightish = (s0, len, maxK) => { const a = this.idxAtS(s0), n = Math.ceil(len / this.spacing); for (let k = 0; k < n; k++) if (this.absKappa[Math.min(a + k, this.N - 1)] > maxK) return false; return true; };
    const place = (len, maxK, tries = 120) => {
      for (let t = 0; t < tries; t++) { const s = r.range(this.startS + 80, this.finishS - 60 - len); if (free(s, len) && straightish(s, len, maxK)) { used.push([s, s + len]); return s; } }
      return null;
    };
    const perKm = (n) => Math.round(n * L / 1000);

    // jump ramps: one at every gap, plus a few kickers on straights
    this.ramps = this.gaps.map((g) => ({ s: g.s0 - 18, len: 18, h: 2.8, w: this.wallD, gap: true }));
    for (let k = 0; k < (def.kickers ?? 1); k++) { const s = place(60, 0.004); if (s != null) this.ramps.push({ s, len: 16, h: def.gravity ? 4 : 2.4, w: def.hw * 0.62 }); }

    // boost pads: the only way to boost
    this.pads = [];
    for (let k = 0; k < perKm(def.pads ?? 2); k++) {
      const s = place(12, 0.006); if (s == null) continue;
      const w = Math.min(4.4, def.hw * 0.42), lane = r.pick([-0.55, 0, 0.55]);
      this.pads.push({ s, len: 10, d: lane * (def.hw - w), w });
    }
    // a pad right before each jump so the gap can always be cleared
    for (const g of this.gaps) this.pads.push({ s: g.s0 - 70, len: 10, d: 0, w: Math.min(4.4, def.hw * 0.42) });

    // surface hazards + crosswinds
    this.zones = [];
    for (const hz of def.hazards) {
      for (let k = 0; k < hz.count; k++) {
        const len = hz.type === 'wind' ? r.range(90, 160) : r.range(22, 38);
        const s = place(len, hz.type === 'wind' ? 0.01 : 0.02, 80); if (s == null) continue;
        if (hz.type === 'wind') { this.zones.push({ type: 'wind', s0: s, s1: s + len, d0: -this.wallD, d1: this.wallD, dir: r.sign(), force: hz.force ?? 9 }); continue; }
        const half = r.range(0.45, 0.8) * def.hw, side = r.sign();
        const d0 = r() < 0.4 ? -def.hw : (side > 0 ? def.hw - half * 1.2 : -def.hw);
        this.zones.push({ type: hz.type, s0: s, s1: s + len, d0, d1: d0 + half * 1.2 });
      }
    }

    // coins (spent on upgrades)
    this.coins = [];
    for (let k = 0; k < perKm(def.coins ?? 2.5); k++) {
      const s = r.range(this.startS + 60, this.finishS - 80); if (!this.hasRoad(s) || !this.hasRoad(s + 50)) continue;
      const lane = r.range(-0.6, 0.6) * def.hw, n = r.int(5, 8);
      for (let c = 0; c < n; c++) this.coins.push({ s: s + c * 7, d: lane, taken: false });
    }

    // obstacles stay on the road; some slide side to side on later levels
    this.obstacles = [];
    const oc = def.obstacles;
    for (let k = 0; k < perKm(oc.perKm); k++) {
      const s = r.range(this.startS + 120, this.finishS - 60);
      if (used.some(([a, b]) => s > a - 15 && s < b + 15)) continue;
      const moving = r() < (oc.moving ?? 0);
      this.obstacles.push({ s, d: r.range(-0.75, 0.75) * def.hw, kind: oc.kind, rot: r() * 6.28, amp: moving ? def.hw * r.range(0.35, 0.6) : 0, freq: r.range(0.5, 1.1), phase: r() * 6.28 });
    }

    // checkpoints: respawn points when a car falls off
    this.checkpoints = [this.startS];
    for (let s = 700; s < this.finishS - 200; s += 700) if (this.hasRoad(s) && !this.gaps.some((g) => Math.abs(g.s0 - s) < 160)) this.checkpoints.push(s);
    for (const g of this.gaps) this.checkpoints.push(g.s0 - 140);
    this.checkpoints.sort((a, b) => a - b);
  }

  obstacleD(o, t) { return o.amp ? o.d + Math.sin(t * o.freq + o.phase) * o.amp * (o.d > 0 ? -1 : 1) : o.d; }
  zoneAt(s, d) { for (const z of this.zones) if (s >= z.s0 && s <= z.s1 && d >= z.d0 && d <= z.d1) return z; return null; }
  rampAt(s, d) { for (const q of this.ramps) if (s >= q.s && s <= q.s + q.len && Math.abs(d) <= q.w) return q.h * (s - q.s) / q.len; return 0; }
  lastCheckpoint(s) { let c = this.checkpoints[0]; for (const k of this.checkpoints) if (k <= s) c = k; return c; }
}

function smoothArr(a, passes) {
  const n = a.length; let cur = Float32Array.from(a);
  const at = (i) => cur[clamp(i, 0, n - 1)];
  for (let p = 0; p < passes; p++) {
    const nxt = new Float32Array(n);
    for (let i = 0; i < n; i++) nxt[i] = (at(i - 2) + 2 * at(i - 1) + 3 * at(i) + 2 * at(i + 1) + at(i + 2)) / 9;
    cur = nxt;
  }
  return cur;
}
