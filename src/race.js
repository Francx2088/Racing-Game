// Race simulation: arcade car physics, AI drivers, pickups, laps and standings (no rendering).
import { clamp, lerp, wrapAngle, rng } from './util.js';

const G_DEFAULT = 24;
const SURF = {
  ice: { grip: 0.1, vcap: 1 }, sand: { grip: 0.6, vcap: 0.72 }, oil: { grip: 0.08, vcap: 1 }, mud: { grip: 0.5, vcap: 0.6 },
  syrup: { grip: 0.45, vcap: 0.62 }, dust: { grip: 0.65, vcap: 0.85 }, leaves: { grip: 0.6, vcap: 0.95 },
};
const OFFROAD = { grip: 0.65, vcap: 0.66 };

export class RaceCar {
  constructor(o) {
    this.id = o.id; this.name = o.name; this.def = o.def; this.isPlayer = !!o.isPlayer; this.skill = o.skill ?? 1;
    this.lane = o.lane ?? 0; this.livery = o.livery; this.color = o.color ?? 0xffffff;
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vz = 0; this.vy = 0; this.h = 0;
    this.speed = 0; this.nitro = 30; this.boostT = 0; this.nitroOn = false;
    this.drifting = false; this.driftDir = 0; this.driftT = 0; this.driftLevel = 0;
    this.airborne = false; this.hint = -1; this.q = {}; this.prog = 0; this.maxProg = 0; this.lapIdx = 0;
    this.lapStart = 0; this.lapTimes = []; this.bestLap = Infinity; this.finished = false; this.finishTime = 0; this.place = 1;
    this.steerVis = 0; this.pitch = 0; this.roll = 0; this.slip = 0; this.prevS = 0; this.coins = 0; this.stuckT = 0;
    this.hitT = 0; this.wallT = 0; this.surface = 'road'; this.onRoad = true; this.landImpact = 0; this.lean = 0; this.steerState = 0;
    this.input = { steer: 0, throttle: 0, brake: 0, drift: false, nitro: false };
    this.aiLane = this.lane; this.aiPhase = Math.random() * 6; this.cruise = false; this.perfect = false;
  }
}

export class Race {
  constructor(world, setups, cb = {}) {
    this.world = world; this.track = world.track; this.def = world.levelDef; this.cb = cb;
    this.gravity = (this.def.gravity ?? 1) * G_DEFAULT;
    this.cars = setups.map((s) => new RaceCar(s));
    this.player = this.cars.find((c) => c.isPlayer);
    this.time = 0; this.state = 'countdown'; this.countdown = 3.4; this.lastCount = 4;
    this.laps = this.def.laps; this.finishedCount = 0; this.finishOrder = [];
    this.q = {}; this.rand = rng(this.def.seed + 17); this.stats = { coins: 0, overtakes: 0, drifts: 0, hits: 0, boosts: 0 };
    this.throttleSince = 0;
    this._place(setups);
  }

  _place(setups) {
    const T = this.track, L = T.length;
    this.cars.forEach((c, k) => {
      const row = k >> 1, side = k & 1 ? 1 : -1;
      const s = L - 7 - row * 9.5 - (side > 0 ? 3.5 : 0);
      const d = side * T.hw * 0.4;
      const p = T.pointAt(s, d);
      c.x = p.x; c.z = p.z; c.y = p.y; c.h = p.head; c.vx = c.vz = 0; c.hint = p.i;
      T.query(c.x, c.z, c.hint, c.q);
      c.prevS = c.q.s; c.prog = c.q.s - L; c.maxProg = c.prog; c.grid = k;
    });
    this._standings();
  }

  start() { this.state = 'racing'; this.time = 0; }

  update(dt, playerInput) {
    dt = Math.min(dt, 1 / 20);
    const steps = Math.ceil(dt / (1 / 90)), h = dt / steps;
    for (let i = 0; i < steps; i++) this._step(h, playerInput);
  }

  _step(dt, playerInput) {
    const T = this.track;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 0.4);
      if (n !== this.lastCount && n >= 0) { this.lastCount = n; this.cb.onCountdown && this.cb.onCountdown(n); }
      if (playerInput.throttle > 0.5) this.throttleSince += dt; else this.throttleSince = 0;
      if (this.countdown <= 0.4 && this.state === 'countdown') {
        this.state = 'racing'; this.time = 0;
        const p = this.player;
        if (p && this.throttleSince > 0 && this.throttleSince < 0.9) { p.boostT = 1.3; p.perfect = true; this.cb.onPerfectStart && this.cb.onPerfectStart(); }
        for (const c of this.cars) if (!c.isPlayer && this.rand() < 0.5) c.boostT = 0.6;
      }
      for (const c of this.cars) this._physics(c, dt, { steer: 0, throttle: 0, brake: 1, drift: false, nitro: false }, true);
      return;
    }
    this.time += dt;
    for (const c of this.cars) {
      let inp;
      if (c.isPlayer && !c.finished) inp = playerInput;
      else inp = this._ai(c, dt);
      this._physics(c, dt, inp, false);
    }
    this._collide(dt);
    this._pickups();
    this._standings();
  }

  // ---------- physics ----------
  _physics(c, dt, inp, frozen) {
    const T = this.track, ph = c.def.phys, q = c.q;
    T.query(c.x, c.z, c.hint, q); c.hint = q.i0;
    // surface
    let grip = 1, vcap = 1, surf = 'road';
    if (Math.abs(q.d) > T.hw + 0.3) { grip = OFFROAD.grip; vcap = OFFROAD.vcap; surf = 'offroad'; }
    const z = T.zoneAt(q.s, q.d);
    if (z) { const S = SURF[z.type]; grip = Math.min(grip, S.grip); vcap = Math.min(vcap, S.vcap); surf = z.type; }
    c.surface = surf; c.onRoad = surf === 'road';
    const air = c.airborne;

    const fx = Math.sin(c.h), fz = Math.cos(c.h), rx = -fz, rz = fx;
    if (frozen) { c.vx = c.vz = 0; }
    let vF = c.vx * fx + c.vz * fz, vR = c.vx * rx + c.vz * rz;
    const baseMax = ph.vmax * (c.isPlayer ? 1 : c.skill * (c.rubber ?? 1));
    let vmax = baseMax * vcap;
    // nitro
    c.nitroOn = false;
    if (!frozen && inp.nitro && c.nitro > 2 && !air) { c.nitroOn = true; c.nitro = Math.max(0, c.nitro - 30 * dt); }
    const boosting = c.nitroOn || c.boostT > 0;
    if (boosting) vmax = baseMax * 1.3;
    if (c.boostT > 0) c.boostT -= dt;

    // longitudinal
    let acc = 0;
    if (!air) {
      if (inp.throttle > 0) acc += 27 * ph.acc * inp.throttle * (1 - Math.pow(clamp(vF / vmax, 0, 1), 1.5));
      if (boosting) acc += 26;
      if (inp.brake > 0 && !frozen) acc -= (vF > 1 ? 52 : 16) * inp.brake;
      if (inp.throttle === 0 && inp.brake === 0) acc -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, 5);
      if (vF > vmax) acc -= (vF - vmax) * 2.2;
      if (vF < -14) acc += 20;
    } else acc -= vF * 0.02;
    vF += acc * dt;

    // steering
    const sp = clamp(Math.abs(vF) / ph.vmax, 0, 1);
    let wmax = (2.5 - 1.65 * sp) * ph.turn;
    // drift handling
    if (!frozen) {
      if (inp.drift && !c.drifting && Math.abs(inp.steer) > 0.3 && vF > 22 && !air && c.onRoad !== undefined) {
        c.drifting = true; c.driftDir = Math.sign(inp.steer); c.driftT = 0; c.driftLevel = 0; this.cb.onDriftStart && this.cb.onDriftStart(c);
      }
      if (c.drifting) {
        if (!inp.drift || vF < 14 || air) this._endDrift(c);
        else {
          c.driftT += dt * (0.65 + 0.35 * Math.abs(inp.steer)) * ph.drift;
          const lv = c.driftT > 3.0 ? 3 : c.driftT > 1.8 ? 2 : c.driftT > 0.8 ? 1 : 0;
          if (lv > c.driftLevel) { c.driftLevel = lv; this.cb.onDriftLevel && this.cb.onDriftLevel(c, lv); }
          c.nitro = Math.min(100, c.nitro + 6 * dt);
        }
      }
    }
    let yawIn = inp.steer;
    if (c.drifting) { yawIn = c.driftDir * (0.62 + 0.38 * inp.steer * c.driftDir); wmax *= 1.28; }
    const yawRate = -yawIn * wmax * clamp(Math.abs(vF) / 6, 0, 1) * Math.sign(vF || 1) * (air ? 0.25 : 1);
    c.h += yawRate * dt;
    c.steerState = lerp(c.steerState, inp.steer, 1 - Math.exp(-12 * dt));

    // lateral grip
    const gk = (c.drifting ? 2.3 : 8.5) * grip;
    const decay = air ? 0.1 : (1 - Math.exp(-gk * dt));
    c.slipLoss = Math.abs(vR) * decay;
    vF -= c.slipLoss * 0.12 * Math.sign(vF);
    vR -= vR * decay;
    // recompute with updated heading
    const nfx = Math.sin(c.h), nfz = Math.cos(c.h), nrx = -nfz, nrz = nfx;
    c.vx = nfx * vF + nrx * vR; c.vz = nfz * vF + nrz * vR;
    c.speed = vF; c.slip = Math.atan2(vR, Math.max(Math.abs(vF), 5));
    c.lean = lerp(c.lean, clamp(-yawRate * vF * 0.004, -0.14, 0.14), 1 - Math.exp(-8 * dt));

    c.x += c.vx * dt; c.z += c.vz * dt;

    // walls
    T.query(c.x, c.z, c.hint, q); c.hint = q.i0;
    const lim = T.wallD - 1.15;
    if (Math.abs(q.d) > lim) {
      const sg = Math.sign(q.d), over = Math.abs(q.d) - lim;
      const rrx = T.rx[q.i0], rrz = T.rz[q.i0];
      c.x -= sg * rrx * over; c.z -= sg * rrz * over;
      const vn = (c.vx * rrx + c.vz * rrz) * sg;     // outward velocity
      if (vn > 0) {
        c.vx -= sg * rrx * vn * 1.3; c.vz -= sg * rrz * vn * 1.3;
        const hit = vn / (Math.abs(vF) + 4);
        const scale = 1 - Math.min(0.4, hit * 0.6);
        c.vx *= scale; c.vz *= scale;
        // steer back along the wall
        const th = q.head; c.h += wrapAngle(th - c.h) * 0.22;
        if (vn > 3 && c.wallT <= 0) { c.wallT = 0.25; this.cb.onWall && this.cb.onWall(c, vn, sg); }
        if (c.drifting) this._endDrift(c, true);
      }
    }
    if (c.wallT > 0) c.wallT -= dt;
    if (c.hitT > 0) c.hitT -= dt;

    // vertical
    const gNow = q.surfaceY + T.rampAt(q.s, q.d);
    if (c.airborne) {
      c.vy -= this.gravity * dt; c.y += c.vy * dt;
      if (c.y <= gNow) { c.y = gNow; c.airborne = false; c.landImpact = Math.max(0, -c.vy); if (-c.vy > 6) { this.cb.onLand && this.cb.onLand(c, -c.vy); c.vx *= 0.985; c.vz *= 0.985; } c.vy = 0; }
    } else {
      const ballistic = c.y + (c.vy - this.gravity * dt) * dt;
      if (ballistic > gNow + 0.06 && c.vy > 0.5 && !frozen) { c.airborne = true; c.vy -= this.gravity * dt; c.y += c.vy * dt; this.cb.onLaunch && this.cb.onLaunch(c); }
      else { c.vy = clamp((gNow - c.y) / dt, -30, 30); c.y = gNow; }
    }
    // orientation targets
    const slopeAhead = q.slope + (T.rampAt(q.s + 1.5, q.d) - T.rampAt(q.s - 1.5, q.d)) / 3;
    const targetPitch = c.airborne ? Math.atan2(c.vy, Math.max(8, Math.abs(vF))) : Math.atan(slopeAhead * Math.cos(wrapAngle(c.h - q.head)));
    c.pitch = lerp(c.pitch, targetPitch, 1 - Math.exp(-(c.airborne ? 4 : 14) * dt));
    c.roll = lerp(c.roll, c.airborne ? 0 : q.bank, 1 - Math.exp(-10 * dt));

    // stuck recovery
    if (!frozen && this.state === 'racing' && !c.finished) {
      if (Math.abs(vF) < 3) c.stuckT += dt; else c.stuckT = 0;
      if (c.stuckT > 2.8) this._recover(c);
    }

    // laps / progress
    let ds = q.s - c.prevS; const L = T.length;
    if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
    c.prevS = q.s; c.prog += ds;
    if (c.prog > c.maxProg) {
      c.maxProg = c.prog;
      const li = Math.floor(c.prog / L);
      if (li > c.lapIdx && li >= 1 && this.state === 'racing') {
        c.lapIdx = li;
        const lt = this.time - c.lapStart; c.lapStart = this.time; c.lapTimes.push(lt);
        const best = lt < c.bestLap; if (best) c.bestLap = lt;
        this.cb.onLap && this.cb.onLap(c, li, lt, best);
        if (li >= this.laps && !c.finished) this._finish(c);
      }
    }
  }

  _endDrift(c, cancel = false) {
    if (!c.drifting) return;
    c.drifting = false;
    if (!cancel && c.driftLevel > 0) {
      const dur = [0, 0.7, 1.25, 1.9][c.driftLevel];
      c.boostT = Math.max(c.boostT, dur);
      c.vx *= 1.0; if (c.isPlayer) this.stats.drifts++;
      this.cb.onDriftBoost && this.cb.onDriftBoost(c, c.driftLevel);
    }
    c.driftLevel = 0; c.driftT = 0;
  }

  _recover(c) {
    const T = this.track, q = c.q;
    const p = T.pointAt(q.s + 6, 0);
    c.x = p.x; c.z = p.z; c.y = p.y; c.h = p.head; c.vx = c.vz = 0; c.vy = 0; c.airborne = false; c.stuckT = 0; c.drifting = false;
    c.hint = p.i; this.cb.onRecover && this.cb.onRecover(c);
  }

  _finish(c) {
    c.finished = true; c.finishTime = this.time; this.finishedCount++; this.finishOrder.push(c);
    c.place = this.finishOrder.length;
    this.cb.onFinish && this.cb.onFinish(c);
    if (this.cars.every((x) => x.finished)) this.state = 'done';
  }

  // ---------- AI ----------
  _ai(c, dt) {
    const T = this.track, q = c.q, ph = c.def.phys;
    c.aiPhase += dt;
    const speed = Math.max(c.speed, 8);
    // rubber banding relative to the player
    if (this.player) {
      const gap = c.prog - this.player.prog;
      c.rubber = clamp(1 - gap * 0.00045, 0.9, 1.07);
      if (c.finished) c.rubber = 0.7;
    }
    const look = 9 + speed * 0.5;
    // lane: personal offset plus avoidance
    let lane = c.aiLane * T.hw * 0.7 + Math.sin(c.aiPhase * 0.4 + c.grid) * T.hw * 0.12;
    for (const o of T.obstacles) {
      if (o.hit) continue;
      let ds = o.s - q.s; if (ds < -T.length / 2) ds += T.length; else if (ds > T.length / 2) ds -= T.length;
      if (ds > 0 && ds < 14 + speed * 0.5 && Math.abs(o.d - lane) < 3.6) lane = o.d + (o.d > 0 ? -1 : 1) * 4.2;
    }
    for (const o of this.cars) {
      if (o === c) continue;
      let ds = o.q.s - q.s; if (ds < -T.length / 2) ds += T.length; else if (ds > T.length / 2) ds -= T.length;
      if (ds > 1 && ds < 15 && Math.abs(o.q.d - q.d) < 3.2 && o.speed < c.speed + 6) lane = q.d + (o.q.d > q.d ? -1 : 1) * 4;
    }
    lane = clamp(lane, -T.hw * 0.85, T.hw * 0.85);
    const tp = T.pointAt(q.s + look, lane);
    const want = Math.atan2(tp.x - c.x, tp.z - c.z);
    const diff = wrapAngle(want - c.h);
    const steer = clamp(-diff * 2.4, -1, 1);
    // target speed from upcoming curvature
    const kap = T.curvAhead(q.i0, 18 + speed * 1.6);
    const latMax = 36 * (0.8 + 0.2 * c.skill) * (c.surface === 'road' ? 1 : 0.5);
    const vCorner = kap > 1e-4 ? Math.sqrt(latMax / kap) : 999;
    const target = Math.min(ph.vmax * c.skill * (c.rubber ?? 1), vCorner);
    let throttle = 1, brake = 0;
    if (c.speed > target * 1.04) { throttle = 0; brake = clamp((c.speed - target) / 12, 0, 1) * 0.9; }
    else if (c.speed > target) throttle = 0.3;
    const nitro = c.nitro > 55 && kap < 0.0012 && c.speed > ph.vmax * 0.7 && Math.sin(c.aiPhase * 0.9 + c.grid * 2) > 0.5;
    if (c.cruise || c.finished) { throttle = Math.min(throttle, 0.7); }
    return { steer, throttle, brake, drift: false, nitro };
  }

  // ---------- interactions ----------
  _collide(dt) {
    const cs = this.cars, T = this.track;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 > 14 || Math.abs(a.y - b.y) > 1.6) continue;
      const d = Math.sqrt(d2) || 0.01, nx = dx / d, nz = dz / d, pen = 3.7 - d;
      if (pen <= 0) continue;
      a.x -= nx * pen * 0.5; a.z -= nz * pen * 0.5; b.x += nx * pen * 0.5; b.z += nz * pen * 0.5;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const imp = -rv * 0.6;
        a.vx -= nx * imp; a.vz -= nz * imp; b.vx += nx * imp; b.vz += nz * imp;
        a.vx *= 0.99; a.vz *= 0.99; b.vx *= 0.99; b.vz *= 0.99;
        if (-rv > 3) this.cb.onBump && this.cb.onBump(a, b, -rv);
      }
    }
    // obstacles
    for (const c of cs) {
      const q = c.q;
      for (let k = 0; k < T.obstacles.length; k++) {
        const o = T.obstacles[k]; if (o.hit) continue;
        let ds = o.s - q.s; if (ds > T.length / 2) ds -= T.length; else if (ds < -T.length / 2) ds += T.length;
        if (Math.abs(ds) < 2.4 && Math.abs(o.d - q.d) < 2.6 && !c.airborne) {
          o.hit = true; c.vx *= 0.55; c.vz *= 0.55; c.h += (this.rand() - 0.5) * 0.7; c.hitT = 0.5; if (c.isPlayer) this.stats.hits++;
          if (c.drifting) this._endDrift(c, true);
          this.cb.onObstacle && this.cb.onObstacle(c, k, o);
        }
      }
    }
  }

  _pickups() {
    const T = this.track, c = this.player; if (!c || c.finished) return;
    const q = c.q, L = T.length;
    const sd = (s) => { let d = s - q.s; if (d > L / 2) d -= L; else if (d < -L / 2) d += L; return d; };
    for (let i = 0; i < T.coins.length; i++) {
      const k = T.coins[i]; if (k.taken) continue;
      if (Math.abs(sd(k.s)) < 2.6 && Math.abs(k.d - q.d) < 2.8 && !c.airborne) { k.taken = true; c.coins++; this.stats.coins++; c.nitro = Math.min(100, c.nitro + 1.2); this.cb.onCoin && this.cb.onCoin(c, i); }
    }
    for (let i = 0; i < T.nitros.length; i++) {
      const k = T.nitros[i]; if (k.taken) continue;
      if (Math.abs(sd(k.s)) < 3.2 && Math.abs(k.d - q.d) < 3.2) { k.taken = true; c.nitro = Math.min(100, c.nitro + 30); this.cb.onNitro && this.cb.onNitro(c, i); }
    }
    for (const car of this.cars) this._pads(car);
  }
  _pads(c) {
    const T = this.track, q = c.q;
    for (const p of T.pads) {
      let ds = q.s - p.s; if (ds > T.length / 2) ds -= T.length; else if (ds < -T.length / 2) ds += T.length;
      if (ds >= 0 && ds <= p.len && Math.abs(q.d - p.d) < p.w + 1 && !c.airborne) {
        if (c.padCool == null || this.time - c.padCool > 1) {
          c.padCool = this.time; c.boostT = Math.max(c.boostT, 1.7);
          const fx = Math.sin(c.h), fz = Math.cos(c.h); c.vx += fx * 5; c.vz += fz * 5;
          if (c.isPlayer) this.stats.boosts++;
          this.cb.onPad && this.cb.onPad(c);
        }
      }
    }
  }

  _standings() {
    const prev = this.order ? this.order.map((c) => c.id) : null;
    const sorted = [...this.cars].sort((a, b) => (a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.prog - a.prog));
    sorted.forEach((c, i) => { c.place = i + 1; });
    this.order = sorted;
    if (prev && this.player && this.state === 'racing') {
      const was = prev.indexOf(this.player.id), now = sorted.indexOf(this.player);
      if (now < was) { this.stats.overtakes++; this.cb.onOvertake && this.cb.onOvertake(now + 1); }
      else if (now > was) this.cb.onOvertaken && this.cb.onOvertaken(now + 1);
    }
  }

  resetPickups() {
    const T = this.track;
    T.coins.forEach((c) => (c.taken = false)); T.nitros.forEach((c) => (c.taken = false)); T.obstacles.forEach((o) => (o.hit = false));
  }
}
