// Track geometry data: spline sampling, frames, and car/track queries (no rendering here).
import * as THREE from 'three';
import { rng, clamp, wrapAngle } from './util.js';

const SPACING = 2;

export class Track {
  constructor(def) {
    this.def = def;
    this.hw = def.hw;
    this.shoulder = def.shoulder;
    this.wallD = def.hw + def.shoulder;        // lateral distance of the wall
    const pts = def.pts.map((p) => new THREE.Vector3(p[0], p[2] || 0, p[1]));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = 6000;
    const total = curve.getLength();
    const N = Math.round(total / SPACING);
    this.N = N;
    this.length = total;
    this.spacing = total / N;
    const sp = curve.getSpacedPoints(N);       // N+1 points, last == first
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    for (let i = 0; i < N; i++) { px[i] = sp[i].x; py[i] = sp[i].y; pz[i] = sp[i].z; }
    this.px = px; this.py = py; this.pz = pz;

    const tx = new Float32Array(N), tz = new Float32Array(N), head = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i + 1) % N, b = (i + N - 1) % N;
      const dx = px[a] - px[b], dz = pz[a] - pz[b];
      const l = Math.hypot(dx, dz) || 1;
      tx[i] = dx / l; tz[i] = dz / l;
      head[i] = Math.atan2(tx[i], tz[i]);
    }
    this.tx = tx; this.tz = tz; this.head = head;
    // right vector (driver's right hand when facing the tangent)
    this.rx = new Float32Array(N); this.rz = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.rx[i] = -tz[i]; this.rz[i] = tx[i]; }

    // signed curvature, positive = turning right. Smoothed.
    const kap = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i + 1) % N;
      kap[i] = -wrapAngle(head[a] - head[i]) / this.spacing;
    }
    this.kappa = smoothArr(kap, 6);
    this.absKappa = new Float32Array(N);
    for (let i = 0; i < N; i++) this.absKappa[i] = Math.abs(this.kappa[i]);
    // lateral bank angle (positive raises the right side): inside of a corner is lower
    const bank = new Float32Array(N);
    for (let i = 0; i < N; i++) bank[i] = clamp(-this.kappa[i] * def.bank * 60, -def.maxBank, def.maxBank);
    this.bank = smoothArr(bank, 10);
    // slope (rise per metre)
    this.slope = new Float32Array(N);
    for (let i = 0; i < N; i++) this.slope[i] = (py[(i + 1) % N] - py[(i + N - 1) % N]) / (2 * this.spacing);

    // rotate so sample 0 (start/finish line) sits on the straightest, flattest stretch
    {
      const back = Math.ceil(70 / this.spacing), fwd = Math.ceil(90 / this.spacing);
      let bestK = 0, bestV = 1e9;
      for (let k = 0; k < N; k++) {
        let v = 0;
        for (let j = -back; j <= fwd; j += 2) {
          const i = (k + j + N) % N;
          v = Math.max(v, this.absKappa[i] * 1000 + Math.abs(this.bank[i]) * 4 + Math.abs(this.slope[i]) * 3);
        }
        if (v < bestV) { bestV = v; bestK = k; }
      }
      for (const key of ['px', 'py', 'pz', 'tx', 'tz', 'head', 'rx', 'rz', 'kappa', 'absKappa', 'bank', 'slope']) {
        const a = this[key], b = new Float32Array(N);
        for (let i = 0; i < N; i++) b[i] = a[(i + bestK) % N];
        this[key] = b;
      }
    }
    const { px: _px, py: _py, pz: _pz } = this;

    // spatial hash of samples for terrain/scenery distance lookups
    this.cell = 24;
    this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const k = this._key(Math.floor(_px[i] / this.cell), Math.floor(_pz[i] / this.cell));
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(i);
    }
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i++) { minX = Math.min(minX, _px[i]); maxX = Math.max(maxX, _px[i]); minZ = Math.min(minZ, _pz[i]); maxZ = Math.max(maxZ, _pz[i]); }
    this.bounds = { minX, maxX, minZ, maxZ };

    this._buildContent();
  }

  _key(a, b) { return a * 73856093 ^ b * 19349663; }

  // Nearest sample to (x,z) from the hash. Returns { i, d2 } (d2 = squared horizontal distance) or null.
  nearestSample(x, z, maxR = 96) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const rr = Math.ceil(maxR / this.cell);
    let best = -1, bd = maxR * maxR;
    for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) {
      const arr = this.grid.get(this._key(cx + a, cz + b));
      if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const i = arr[k];
        const dx = this.px[i] - x, dz = this.pz[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = i; }
      }
    }
    return best < 0 ? null : { i: best, d2: bd };
  }

  // Locate a world position on the track. `hint` = previous index (fast local search); out: reused object.
  query(x, z, hint, out) {
    const N = this.N;
    let best = 0, bd = 1e12;
    if (hint == null || hint < 0) {
      const n = this.nearestSample(x, z, 4000);
      best = n ? n.i : 0;
    } else {
      for (let k = -14; k <= 14; k++) {
        const i = (hint + k + N) % N;
        const dx = this.px[i] - x, dz = this.pz[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = i; }
      }
      // lost (teleport / huge jump): fall back to global search
      if (bd > 60 * 60) { const n = this.nearestSample(x, z, 4000); if (n) best = n.i; }
    }
    // refine: project on the segment to the neighbour that is closer along the tangent
    const i = best;
    const dx = x - this.px[i], dz = z - this.pz[i];
    let along = dx * this.tx[i] + dz * this.tz[i];
    let i0 = i, frac;
    if (along >= 0) { i0 = i; frac = clamp(along / this.spacing, 0, 1); }
    else { i0 = (i + N - 1) % N; frac = clamp(1 + along / this.spacing, 0, 1); }
    const i1 = (i0 + 1) % N;
    const cx = this.px[i0] + (this.px[i1] - this.px[i0]) * frac;
    const cz = this.pz[i0] + (this.pz[i1] - this.pz[i0]) * frac;
    const rx = this.rx[i0] + (this.rx[i1] - this.rx[i0]) * frac;
    const rz = this.rz[i0] + (this.rz[i1] - this.rz[i0]) * frac;
    const rl = Math.hypot(rx, rz) || 1;
    const d = ((x - cx) * rx + (z - cz) * rz) / rl;
    const bank = this.bank[i0] + (this.bank[i1] - this.bank[i0]) * frac;
    const y0 = this.py[i0] + (this.py[i1] - this.py[i0]) * frac;
    out.idx = along >= 0 ? i0 : i0;
    out.i0 = i0; out.frac = frac;
    out.s = (i0 + frac) * this.spacing;
    out.d = d;
    out.bank = bank;
    out.y = y0;                                      // centre-line height
    out.surfaceY = y0 + Math.tan(bank) * d;          // height at lateral offset
    out.slope = this.slope[i0];
    out.head = this.head[i0];
    return out;
  }

  // Helpers by arc-length
  idxAtS(s) { return ((Math.round(s / this.spacing) % this.N) + this.N) % this.N; }
  // World position at track distance s and lateral offset d: {x,y,z}
  pointAt(s, d, out = {}) {
    const i0 = this.idxAtS(s);
    out.x = this.px[i0] + this.rx[i0] * d;
    out.z = this.pz[i0] + this.rz[i0] * d;
    out.y = this.py[i0] + Math.tan(this.bank[i0]) * d;
    out.head = this.head[i0];
    out.i = i0;
    return out;
  }
  // Maximum |curvature| over the next `dist` metres from sample i
  curvAhead(i, dist) {
    const n = Math.ceil(dist / this.spacing);
    let m = 0;
    for (let k = 0; k < n; k += 2) m = Math.max(m, this.absKappa[(i + k) % this.N]);
    return m;
  }

  // Procedurally placed gameplay content, seeded per level.
  _buildContent() {
    const def = this.def, r = rng(def.seed * 7 + 3), L = this.length;
    const straightish = (s0, len, maxK = 0.003) => {
      const a = this.idxAtS(s0), n = Math.ceil(len / this.spacing);
      for (let k = 0; k < n; k++) if (this.absKappa[(a + k) % this.N] > maxK) return false;
      return true;
    };
    const used = [];                       // s-intervals already taken
    const free = (s, len) => used.every(([a, b]) => s + len < a - 12 || s > b + 12);
    const take = (s, len) => used.push([s, s + len]);
    const place = (len, maxK, tries = 80) => {
      for (let t = 0; t < tries; t++) {
        const s = r.range(L * 0.07, L * 0.98 - len);
        if (free(s, len) && straightish(s, len, maxK)) { take(s, len); return s; }
      }
      return null;
    };
    const gridEnd = 40;
    this.pads = [];
    for (let k = 0; k < def.pads; k++) {
      const s = place(10, 0.0045); if (s == null) continue;
      const w = Math.min(4.6, def.hw * 0.42);
      const lane = r.pick([-0.55, 0, 0.55, 0]);
      this.pads.push({ s, len: 10, d: lane * (def.hw - w), w });
    }
    // ramps (only where fairly straight & flat enough)
    this.ramps = [];
    for (let k = 0; k < def.ramps; k++) {
      const len = 16; const s = place(len + 40, 0.005, 300); if (s == null) continue;
      this.ramps.push({ s, len, h: def.gravity ? 4.2 : 2.6, w: def.hw * 0.62 });
    }
    // surface hazards
    this.zones = [];
    for (const hz of def.hazards) {
      for (let k = 0; k < hz.count; k++) {
        const len = r.range(22, 38); const s = place(len, 0.02, 60); if (s == null) continue;
        const half = r.range(0.45, 0.8) * def.hw; const side = r.sign();
        const d0 = r() < 0.4 ? -def.hw : (side > 0 ? def.hw - half * 1.2 : -def.hw);
        this.zones.push({ type: hz.type, s0: s, s1: s + len, d0, d1: d0 + half * 1.2 });
      }
    }
    // coin lines
    this.coins = [];
    for (let k = 0; k < def.coins; k++) {
      const s = r.range(L * 0.06, L * 0.97 - 60);
      const lane = r.range(-0.6, 0.6) * def.hw;
      const n = r.int(5, 8);
      for (let c = 0; c < n; c++) this.coins.push({ s: s + c * 7, d: lane, taken: false });
    }
    // nitro cells
    this.nitros = [];
    for (let k = 0; k < def.nitros; k++) {
      const s = (k + r.range(0.2, 0.8)) * L / def.nitros;
      this.nitros.push({ s: Math.max(s, gridEnd + 20), d: r.range(-0.6, 0.6) * def.hw, taken: false });
    }
    // obstacles
    this.obstacles = [];
    const oc = def.obstacles;
    for (let k = 0; k < oc.count; k++) {
      const s = r.range(L * 0.1, L * 0.97);
      if (this.ramps.some((q) => Math.abs(q.s - s) < 30) || this.pads.some((q) => Math.abs(q.s - s) < 18)) continue;
      this.obstacles.push({ s, d: r.range(-0.78, 0.78) * def.hw, kind: oc.kind, hit: false, rot: r() * 6.28 });
    }
  }

  zoneAt(s, d) {
    for (const z of this.zones) if (s >= z.s0 && s <= z.s1 && d >= z.d0 && d <= z.d1) return z;
    return null;
  }
  // Extra height (ramp wedge) at track distance s, lateral d
  rampAt(s, d) {
    for (const q of this.ramps) {
      if (s >= q.s && s <= q.s + q.len && Math.abs(d) <= q.w) return q.h * (s - q.s) / q.len;
    }
    return 0;
  }
}

function smoothArr(a, passes) {
  const n = a.length; let cur = Float32Array.from(a);
  for (let p = 0; p < passes; p++) {
    const nxt = new Float32Array(n);
    for (let i = 0; i < n; i++) nxt[i] = (cur[(i + n - 2) % n] + 2 * cur[(i + n - 1) % n] + 3 * cur[i] + 2 * cur[(i + 1) % n] + cur[(i + 2) % n]) / 9;
    cur = nxt;
  }
  return cur;
}
