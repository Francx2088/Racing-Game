// Course data: spline sampling, road frames, nearest-point queries and gameplay layout
// (boost pads, jumps, checkpoints, hazards, obstacles). No rendering here.
import * as THREE from 'three';
import { rng, clamp, wrapAngle, smooth as smoothstep } from './util.js';
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

    this.startS = 120;                      // start line
    this.finishS = this.length - 420;       // finish line; road continues as a run-off

    this._findSplits();

    // Barriers only where they matter: the outside of real curves, the start and the finish.
    // Everywhere else the edge is open, so a car pushed wide falls into the sky.
    const wl = new Uint8Array(N), wr = new Uint8Array(N), K0 = 1 / 380, pad = Math.round(45 / this.spacing);
    for (let i = 0; i < N; i++) {
      const k = this.kappa[i];
      if (k > K0) for (let j = Math.max(0, i - pad); j <= Math.min(N - 1, i + pad); j++) wl[j] = 1;
      if (k < -K0) for (let j = Math.max(0, i - pad); j <= Math.min(N - 1, i + pad); j++) wr[j] = 1;
    }
    for (let i = 0; i < N; i++) { const s = i * this.spacing; if (s < this.startS + 160 || s > this.finishS - 120) wl[i] = wr[i] = 1; }
    this.wallL = wl; this.wallR = wr;
    this._buildContent();
  }

  // Forks: on some long bends the road splits in two. The inside branch is narrow, unguarded and
  // shorter; the outside branch is wide, walled and carries boost pads. They rejoin after the bend.
  _findSplits() {
    const def = this.def, want = def.splits ?? 0, L = 480, RAMP = 150, sp = this.spacing;
    this.splits = [];
    if (!want) return;
    const cands = [];
    for (let s = this.startS + 600; s < this.finishS - 700 - L; s += 40) {
      if (this.gaps.some((g) => g.s0 < s + L + 220 && g.s1 > s - 220)) continue;
      const a = this.idxAtS(s), n = Math.round(L / sp); let sgn = 0, ok = true, sum = 0;
      for (let k = 0; k <= n && ok; k++) { const kk = this.kappa[a + k]; if (Math.abs(kk) > 1 / 140) ok = false; else if (Math.abs(kk) > 1 / 1200) { const g = Math.sign(kk); if (!sgn) sgn = g; else if (g !== sgn) ok = false; } sum += kk; }
      // gentle sections are fallbacks: the inside branch is only a little shorter there
      if (ok && sgn && Math.abs(sum / n) > 1 / 1400) cands.push({ s, side: sgn, k: Math.abs(sum / n) });
      else if (ok && Math.abs(sum / n) > 1 / 6000) cands.push({ s, side: Math.sign(sum), k: Math.abs(sum / n) * 0.01 });
    }
    const minGap = Math.min(1100, (this.finishS - this.startS) / (want + 1) * 0.5);
    cands.sort((x, y) => y.k - x.k);
    for (const c of cands) {
      if (this.splits.length >= want) break;
      if (this.splits.some((q) => Math.abs(q.s0 - c.s) < minGap)) continue;
      this.splits.push({ s0: c.s, s1: c.s + L, side: c.side, ramp: RAMP, S: def.hw + 9, wIn: def.hw * 0.75, wOut: def.hw });
    }
    this.splits.sort((x, y) => x.s0 - y.s0);
    // flatten the banking through forks so both branches sit level
    for (let i = 0; i < this.N; i++) {
      const s = i * sp; let f = 1;
      for (const q of this.splits) f = Math.min(f, 1 - smoothstep(q.s0 - 90, q.s0, s) * (1 - smoothstep(q.s1, q.s1 + 90, s)));
      this.bank[i] *= f;
    }
  }
  splitAt(s) { for (const q of this.splits) if (s >= q.s0 && s <= q.s1) return q; return null; }
  sepAt(q, s) { return q.S * smoothstep(q.s0, q.s0 + q.ramp, s) * (1 - smoothstep(q.s1 - q.ramp, q.s1, s)); }
  // branch k: 0 = inside (shortcut), 1 = outside
  branchCenter(q, k, s) { const sep = this.sepAt(q, s); return k === 0 ? q.side * sep : -q.side * sep; }
  // The drivable piece of deck under (s, d): its centre, half width to the edge, and which edges have barriers.
  deckAt(s, d, out = {}) {
    const q = this.splitAt(s);
    if (!q) { out.c = 0; out.half = this.wallD; out.wl = this.wallAt(s, -1); out.wr = this.wallAt(s, 1); out.branch = -1; return out; }
    const c0 = this.branchCenter(q, 0, s), c1 = this.branchCenter(q, 1, s);
    const e0 = Math.abs(d - c0) - q.wIn, e1 = Math.abs(d - c1) - q.wOut;
    const k = e0 < e1 ? 0 : 1;
    out.c = k ? c1 : c0; out.half = (k ? q.wOut : q.wIn) + this.shoulder; out.branch = k;
    // barriers: the outside branch's outer edge, and both inner edges once a void opens between them.
    // The shortcut's inner-curve edge stays open.
    const outer = k ? -q.side : q.side, inner = -outer, wallIn = this.forkGap(q, s) > 0;
    const wOuter = k === 1, left = (outer < 0 && wOuter) || (inner < 0 && wallIn), right = (outer > 0 && wOuter) || (inner > 0 && wallIn);
    out.wl = left ? 1 : 0; out.wr = right ? 1 : 0;
    return out;
  }
  plain(s) { return this.hasRoad(s) && !this.splitAt(s); }
  // width of the open void between the two branches
  forkGap(q, s) { return 2 * this.sepAt(q, s) - (q.wIn + q.wOut + 2 * this.shoulder); }

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
    const cuts = [...this.gaps.map((g) => [g.s0, g.s1]), ...this.splits.map((q) => [q.s0, q.s1])].sort((x, y) => x[0] - y[0]);
    const out = []; let s = 0;
    for (const [a, b] of cuts) { out.push([s, a]); s = b; }
    out.push([s, this.length]);
    return out;
  }
  // road pieces between jump gaps (forks included)
  get drivable() {
    const out = []; let s = 0;
    for (const g of this.gaps) { out.push([s, g.s0]); s = g.s1; }
    out.push([s, this.length]);
    return out;
  }

  _buildContent() {
    const def = this.def, r = rng(def.seed * 7 + 3), L = this.length, hw = def.hw;
    const used = [[0, this.startS + 140], [this.finishS - 80, L]];
    for (const g of this.gaps) used.push([g.s0 - 110, g.s1 + 70]);
    for (const q of this.splits) used.push([q.s0 - 60, q.s1 + 60]);
    for (const g of this.gaps) for (let s = g.s0; s < g.s1; s += this.spacing) { const i = this.idxAtS(s); this.wallL[i] = this.wallR[i] = 0; }
    const free = (s, len) => used.every(([a, b]) => s + len < a - 15 || s > b + 15);
    const place = (len, test = () => true, tries = 160) => {
      for (let t = 0; t < tries; t++) { const s = r.range(this.startS + 120, this.finishS - 80 - len); if (free(s, len) && test(s)) { used.push([s, s + len]); return s; } }
      return null;
    };
    const perKm = (n) => Math.round(n * (this.finishS - this.startS) / 1000);
    const gentle = (len) => (s) => { const a = this.idxAtS(s), n = Math.ceil(len / this.spacing); for (let k = 0; k < n; k++) if (this.absKappa[Math.min(a + k, this.N - 1)] > 1 / 260) return false; return true; };

    // jump ramps at every gap + a few kickers
    this.ramps = this.gaps.map((g) => ({ s: g.s0 - 22, len: 22, h: 3.2, w: this.wallD + 0.6, gap: true }));
    // kickers only where the road runs straight long enough to land at 400 km/h
    const straightFor = (len) => (s) => { const a = this.idxAtS(s), n = Math.ceil(len / this.spacing); for (let k = 0; k < n; k++) if (this.absKappa[Math.min(a + k, this.N - 1)] > 1 / 1500 || this.splitAt(s + k * this.spacing)) return false; return true; };
    for (let k = 0; k < (def.kickers ?? 1); k++) { const s = place(260, straightFor(260)); if (s != null) this.ramps.push({ s, len: 22, h: def.gravity ? 2.6 : 1.8, w: hw * 0.55 }); }

    // boost pads, often in chains of 2-3 down the same lane
    this.pads = [];
    const padW = Math.min(4.8, hw * 0.38);
    for (let k = 0; k < perKm(def.pads ?? 1.6); k++) {
      const chain = r() < 0.55 ? r.int(2, 3) : 1, len = chain * 46;
      const s = place(len, gentle(len)); if (s == null) continue;
      const lane = r.pick([-0.5, 0, 0.5]) * (hw - padW);
      for (let c = 0; c < chain; c++) this.pads.push({ s: s + c * 46, len: 12, d: lane, w: padW });
    }
    for (const g of this.gaps) this.pads.push({ s: g.s0 - 95, len: 12, d: 0, w: padW });
    for (const q of this.splits) {
        for (let c = 0; c < 3; c++) this.pads.push({ s: q.s0 + q.ramp + 20 + c * 60, len: 12, d: -q.side * q.S, w: padW });
    }

    // surface hazards + crosswinds
    this.zones = [];
    for (const hz of def.hazards) {
      for (let k = 0; k < hz.count; k++) {
        const wind = hz.type === 'wind', len = wind ? r.range(150, 260) : r.range(30, 50);
        const s = place(len + 120, gentle(len + 120), 120); if (s == null) continue;
        if (wind) { this.zones.push({ type: 'wind', s0: s, s1: s + len, d0: -this.wallD - 2, d1: this.wallD + 2, dir: r.sign(), force: hz.force ?? 14 }); continue; }
        // slippery patches get barriers on both sides, so they cost time rather than a fall
        for (let q = s - 30; q < s + len + 110; q += this.spacing) { const i = this.idxAtS(q); this.wallL[i] = this.wallR[i] = 1; }
        const half = r.range(0.4, 0.7) * hw, d0 = r() < 0.5 ? -hw : hw - half * 1.2;
        this.zones.push({ type: hz.type, s0: s, s1: s + len, d0, d1: d0 + half * 1.2 });
      }
    }
    this.coins = [];

    // obstacles: crate stacks (they fly when hit), sliding blocks, swinging hammers, rotating sweepers
    this.obstacles = [];
    const kinds = def.obstacles.kinds;
    for (let k = 0; k < perKm(def.obstacles.perKm); k++) {
      const kind = r.pick(kinds), s = place(kind === 'crates' ? 30 : 24, kind === 'sweeper' ? gentle(40) : () => true, 60);
      if (s == null) continue;
      if (kind === 'crates') {
        const lane = r.range(-0.7, 0.7) * hw, n = r.int(3, 6);
        for (let c = 0; c < n; c++) this.obstacles.push({ kind: 'crate', s: s + (c % 3) * 2.2 + r.range(-0.3, 0.3), d: lane + Math.floor(c / 3) * 2.2 - 1.1 + r.range(-0.3, 0.3), stack: c >= 3 ? 1 : 0 });
      } else if (kind === 'slider') {
        this.obstacles.push({ kind, s, d: 0, amp: hw * r.range(0.6, 0.8), freq: r.range(0.9, 1.6), phase: r() * 6.28 });
      } else if (kind === 'hammer') {
        this.obstacles.push({ kind, s, d: 0, amp: hw * 0.75, freq: r.range(1.1, 1.7), phase: r() * 6.28 });
      } else if (kind === 'sweeper') {
        this.obstacles.push({ kind, s, d: 0, len: hw * 0.92, freq: r.range(0.7, 1.2) * r.sign(), phase: r() * 6.28 });
      }
    }

    // a couple of crate stacks on each shortcut
    for (const q of this.splits) for (const cs of [q.s0 + (q.s1 - q.s0) * 0.42, q.s0 + (q.s1 - q.s0) * 0.62]) {
      const lane = q.side * q.S + r.range(-0.4, 0.4) * q.wIn;
      for (let c = 0; c < 4; c++) this.obstacles.push({ kind: 'crate', s: cs + (c % 2) * 2.2, d: lane + Math.floor(c / 2) * 2.2 - 1.1, stack: 0 });
    }

    // checkpoints: respawn points when a car falls
    this.checkpoints = [this.startS];
    for (let s = 900; s < this.finishS - 300; s += 900) if (this.hasRoad(s) && !this.gaps.some((g) => Math.abs(g.s0 - s) < 220) && !this.splits.some((q) => s > q.s0 - 80 && s < q.s1 + 40)) this.checkpoints.push(s);
    for (const g of this.gaps) this.checkpoints.push(g.s0 - 200);
    this.checkpoints.sort((a, b) => a - b);
  }

  // lateral position of a sliding obstacle at race time t
  obstacleD(o, t) { return o.amp ? Math.sin(t * o.freq + o.phase) * o.amp : o.d; }
  wallAt(s, side) { const i = this.idxAtS(s); return side < 0 ? this.wallL[i] : this.wallR[i]; }
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
