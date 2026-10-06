// Race simulation: arcade car physics, AI drivers, jumps and checkpoints, hazards and standings.
// No rendering here: main.js reads car state and draws it.
import { clamp, lerp, wrapAngle, rng } from './util.js';

const G_DEFAULT = 24;
const SURF = {
  ice: { grip: 0.12, vcap: 1 }, sand: { grip: 0.6, vcap: 0.72 }, oil: { grip: 0.08, vcap: 1 },
  wet: { grip: 0.5, vcap: 0.95 }, ash: { grip: 0.7, vcap: 0.88 },
};
const OFFROAD = { grip: 0.65, vcap: 0.7 };
const NO_INPUT = { steer: 0, throttle: 0, brake: 0, drift: false };

export class RaceCar {
  constructor(o) {
    Object.assign(this, {
      id: o.id, name: o.name, def: o.def, isPlayer: !!o.isPlayer, skill: o.skill ?? 1, lane: o.lane ?? 0,
      livery: o.livery, color: o.color ?? 0xffffff, phys: o.phys || o.def.phys, boostMul: o.boostMul ?? 1,
    });
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vz = 0; this.vy = 0; this.h = 0; this.speed = 0;
    this.boostT = 0; this.drifting = false; this.driftDir = 0;
    this.airborne = false; this.airT = 0; this.hint = -1; this.q = {}; this.prog = 0; this.maxS = 0;
    this.finished = false; this.finishTime = 0; this.place = 1; this.coins = 0;
    this.pitch = 0; this.roll = 0; this.slip = 0; this.lean = 0; this.steerState = 0;
    this.stuckT = 0; this.hitT = 0; this.wallT = 0; this.respawnT = 0; this.surface = 'road'; this.onRoad = true; this.wind = 0;
    this.input = { ...NO_INPUT };
    this.aiPhase = Math.random() * 6; this.cruise = false; this.obstacleCool = new Map();
  }
}

export class Race {
  // opts.demo: no player, no countdown, cars loop back to the start (menu background)
  constructor(world, setups, cb = {}, opts = {}) {
    this.world = world; this.track = world.track; this.def = world.levelDef; this.cb = cb; this.demo = !!opts.demo;
    this.gravity = (this.def.gravity ?? 1) * G_DEFAULT;
    this.cars = setups.map((s) => new RaceCar(s));
    this.player = this.cars.find((c) => c.isPlayer) || null;
    this.time = 0; this.state = this.demo ? 'racing' : 'countdown'; this.countdown = 3.4; this.lastCount = 4;
    this.finishOrder = [];
    this.rand = rng(this.def.seed + 17);
    this.stats = { coins: 0, overtakes: 0, hits: 0, boosts: 0, falls: 0 };
    this.cars.forEach((c, k) => this._grid(c, k));
    this._standings();
  }

  _grid(c, k) {
    const T = this.track, row = k >> 1, side = k & 1 ? 1 : -1;
    const s = T.startS - 8 - row * 10 - (side > 0 ? 4 : 0);
    const p = T.pointAt(s, side * T.hw * 0.42);
    c.x = p.x; c.z = p.z; c.y = p.y; c.h = p.head; c.vx = c.vz = c.vy = 0; c.hint = p.i; c.grid = k;
    c.airborne = false; c.boostT = 0;
    T.query(c.x, c.z, c.hint, c.q); c.prog = c.q.s; c.maxS = c.q.s;
  }

  update(dt, playerInput = NO_INPUT) {
    dt = Math.min(dt, 1 / 20);
    const steps = Math.ceil(dt / (1 / 90)), h = dt / steps;
    for (let i = 0; i < steps; i++) this._step(h, playerInput);
  }

  _step(dt, playerInput) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 0.4);
      if (n !== this.lastCount && n >= 0) { this.lastCount = n; this.cb.onCountdown?.(n); }
      if (this.countdown <= 0.4) { this.state = 'racing'; this.time = 0; }
      for (const c of this.cars) this._physics(c, dt, NO_INPUT, true);
      return;
    }
    this.time += dt;
    for (const c of this.cars) this._physics(c, dt, c.isPlayer && !c.finished ? playerInput : this._ai(c, dt), false);
    this._collide();
    this._obstacles();
    this._pickups();
    this._standings();
    if (this.demo) for (const c of this.cars) if (c.q.s > this.track.finishS - 20) this._grid(c, c.grid);
  }

  // ---------- physics ----------
  _physics(c, dt, inp, frozen) {
    const T = this.track, ph = c.phys, q = c.q;
    T.query(c.x, c.z, c.hint, q); c.hint = q.i0;
    if (frozen) { c.vx = c.vz = 0; c.y = q.surfaceY; return; }
    if (c.respawnT > 0) c.respawnT -= dt;

    const road = T.hasRoad(q.s);
    let grip = 1, vcap = 1, surf = 'road';
    if (Math.abs(q.d) > T.hw + 0.3) { grip = OFFROAD.grip; vcap = OFFROAD.vcap; surf = 'offroad'; }
    const z = T.zoneAt(q.s, q.d);
    c.wind = 0;
    if (z) {
      if (z.type === 'wind') c.wind = z.dir * z.force;
      else { const S = SURF[z.type]; grip = Math.min(grip, S.grip); vcap = Math.min(vcap, S.vcap); surf = z.type; }
    }
    c.surface = surf; c.onRoad = surf === 'road';
    const air = c.airborne;

    const fx = Math.sin(c.h), fz = Math.cos(c.h), rx = -fz, rz = fx;
    let vF = c.vx * fx + c.vz * fz, vR = c.vx * rx + c.vz * rz;
    const baseMax = ph.vmax * (c.isPlayer ? 1 : c.skill * (c.rubber ?? 1));
    let vmax = baseMax * vcap;
    const boosting = c.boostT > 0;
    if (boosting) { vmax = baseMax * (1.28 + 0.06 * (c.boostMul - 1) / 0.15); c.boostT -= dt; }

    let acc = 0;
    if (!air) {
      if (inp.throttle > 0) acc += 27 * ph.acc * inp.throttle * (1 - Math.pow(clamp(vF / vmax, 0, 1), 1.5));
      if (boosting) acc += 24 * c.boostMul;
      if (inp.brake > 0) acc -= (vF > 1 ? 52 : 16) * inp.brake;
      if (inp.throttle === 0 && inp.brake === 0) acc -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, 5);
      if (vF > vmax) acc -= (vF - vmax) * 2.2;
      if (vF < -14) acc += 20;
    } else acc -= vF * 0.02;
    vF += acc * dt;

    // steering (drift = tighter, slidier turn; it no longer charges a boost)
    const sp = clamp(Math.abs(vF) / ph.vmax, 0, 1);
    let wmax = (2.5 - 1.65 * sp) * ph.turn;
    if (inp.drift && !c.drifting && Math.abs(inp.steer) > 0.3 && vF > 20 && !air) { c.drifting = true; c.driftDir = Math.sign(inp.steer); }
    if (c.drifting && (!inp.drift || vF < 12 || air)) c.drifting = false;
    let yawIn = inp.steer;
    if (c.drifting) { yawIn = c.driftDir * (0.62 + 0.38 * inp.steer * c.driftDir); wmax *= 1.3; }
    const yawRate = -yawIn * wmax * clamp(Math.abs(vF) / 6, 0, 1) * Math.sign(vF || 1) * (air ? 0.25 : 1);
    c.h += yawRate * dt;
    c.steerState = lerp(c.steerState, inp.steer, 1 - Math.exp(-12 * dt));

    const gk = (c.drifting ? 2.3 : 8.5) * grip * (ph.grip ?? 1);
    const decay = air ? 0.1 : 1 - Math.exp(-gk * dt);
    vF -= Math.abs(vR) * decay * 0.12 * Math.sign(vF);
    vR -= vR * decay;
    const nfx = Math.sin(c.h), nfz = Math.cos(c.h), nrx = -nfz, nrz = nfx;
    c.vx = nfx * vF + nrx * vR; c.vz = nfz * vF + nrz * vR;
    // crosswind pushes across the road
    if (c.wind) { const trx = T.rx[q.i0], trz = T.rz[q.i0]; c.vx += trx * c.wind * dt; c.vz += trz * c.wind * dt; }
    c.speed = vF; c.slip = Math.atan2(vR, Math.max(Math.abs(vF), 5));
    c.lean = lerp(c.lean, clamp(-yawRate * vF * 0.004, -0.14, 0.14), 1 - Math.exp(-8 * dt));

    c.x += c.vx * dt; c.z += c.vz * dt;

    // barriers (there are none over the gaps)
    T.query(c.x, c.z, c.hint, q); c.hint = q.i0;
    const lim = T.wallD - 1.15;
    if (road && !(c.airborne && c.y < q.y - 1.5) && Math.abs(q.d) > lim) {
      const sg = Math.sign(q.d), over = Math.abs(q.d) - lim, wrx = T.rx[q.i0], wrz = T.rz[q.i0];
      c.x -= sg * wrx * over; c.z -= sg * wrz * over;
      const vn = (c.vx * wrx + c.vz * wrz) * sg;
      if (vn > 0) {
        c.vx -= sg * wrx * vn * 1.3; c.vz -= sg * wrz * vn * 1.3;
        const scale = 1 - Math.min(0.4, (vn / (Math.abs(vF) + 4)) * 0.6);
        c.vx *= scale; c.vz *= scale;
        c.h += wrapAngle(q.head - c.h) * 0.22;
        if (vn > 3 && c.wallT <= 0) { c.wallT = 0.25; this.cb.onWall?.(c, vn, sg); }
        c.drifting = false;
      }
    }
    if (c.wallT > 0) c.wallT -= dt;
    if (c.hitT > 0) c.hitT -= dt;

    // vertical: follow the deck, launch off crests and ramps, fall through gaps
    const onDeck = T.hasRoad(q.s) && Math.abs(q.d) < T.wallD + 1;
    const gNow = onDeck ? q.surfaceY + T.rampAt(q.s, q.d) : -1e4;
    if (c.airborne) {
      c.airT += dt;
      c.vy -= this.gravity * dt; c.y += c.vy * dt;
      // land only from above: a car that dropped below the deck keeps falling
      if (c.y <= gNow && c.y > gNow - 1.6) { c.y = gNow; c.airborne = false; if (-c.vy > 6) { this.cb.onLand?.(c, -c.vy); c.vx *= 0.985; c.vz *= 0.985; } c.vy = 0; }
    } else {
      const ballistic = c.y + (c.vy - this.gravity * dt) * dt;
      if (ballistic > gNow + 0.06) { c.airborne = true; c.airT = 0; c.vy -= this.gravity * dt; c.y += c.vy * dt; this.cb.onLaunch?.(c); }
      else { c.vy = clamp((gNow - c.y) / dt, -30, 30); c.y = gNow; }
    }
    if (c.y < q.y - 35) this._respawn(c, true);

    const slopeAhead = q.slope + (T.rampAt(q.s + 1.5, q.d) - T.rampAt(q.s - 1.5, q.d)) / 3;
    const targetPitch = c.airborne ? Math.atan2(c.vy, Math.max(8, Math.abs(vF))) : Math.atan(slopeAhead * Math.cos(wrapAngle(c.h - q.head)));
    c.pitch = lerp(c.pitch, targetPitch, 1 - Math.exp(-(c.airborne ? 4 : 14) * dt));
    c.roll = lerp(c.roll, c.airborne ? 0 : q.bank, 1 - Math.exp(-10 * dt));

    if (this.state === 'racing' && !c.finished && !this.demo) {
      if (Math.abs(vF) < 3 && !c.airborne) c.stuckT += dt; else c.stuckT = 0;
      if (c.stuckT > 2.8) this._respawn(c, false);
    }

    c.prog = q.s; if (!c.airborne) c.maxS = Math.max(c.maxS, q.s);
    if (!c.finished && !this.demo && this.state === 'racing' && q.s >= T.finishS && !c.airborne) this._finish(c);
  }

  _respawn(c, fell) {
    const T = this.track, s = T.lastCheckpoint(c.maxS);
    const p = T.pointAt(s + 4, 0);
    c.x = p.x; c.z = p.z; c.y = p.y + 0.5; c.h = p.head; c.hint = p.i;
    const v = 26; c.vx = Math.sin(c.h) * v; c.vz = Math.cos(c.h) * v; c.vy = 0;
    c.airborne = false; c.drifting = false; c.stuckT = 0; c.respawnT = 1.5; c.boostT = 0;
    T.query(c.x, c.z, c.hint, c.q);
    if (fell && c.isPlayer) this.stats.falls++;
    this.cb.onRespawn?.(c, fell);
  }

  _finish(c) {
    c.finished = true; c.finishTime = this.time; this.finishOrder.push(c); c.place = this.finishOrder.length;
    this.cb.onFinish?.(c);
    if (this.cars.every((x) => x.finished)) this.state = 'done';
  }

  // ---------- AI ----------
  _ai(c, dt) {
    const T = this.track, q = c.q, ph = c.phys;
    c.aiPhase += dt;
    const speed = Math.max(c.speed, 8);
    if (this.player && !this.demo) {
      const gap = c.prog - this.player.prog;
      c.rubber = clamp(1 - gap * 0.0004, 0.92, 1.08);
    } else c.rubber = 1;
    const look = 10 + speed * 0.5;
    let lane = c.lane * T.hw * 0.6 + Math.sin(c.aiPhase * 0.35 + c.grid) * T.hw * 0.12;
    const gapNear = T.gapAhead(q.s, 160);
    if (gapNear) lane *= 0.2;                       // line up for the jump
    for (const o of T.obstacles) {
      const ds = o.s - q.s, od = T.obstacleD(o, this.time + ds / Math.max(speed, 10));
      if (ds > 0 && ds < 16 + speed * 0.55 && Math.abs(od - lane) < 3.8) lane = od + (od > 0 ? -1 : 1) * 4.4;
    }
    for (const o of this.cars) {
      if (o === c) continue;
      const ds = o.q.s - q.s;
      if (ds > 1 && ds < 15 && Math.abs(o.q.d - q.d) < 3.2 && o.speed < c.speed + 6) lane = q.d + (o.q.d > q.d ? -1 : 1) * 4;
    }
    // drift towards the nearest pad when one is coming up
    for (const p of T.pads) { const ds = p.s - q.s; if (ds > 0 && ds < 70 && !gapNear && Math.abs(p.d - lane) < 6) { lane = p.d; break; } }
    lane = clamp(lane, -T.hw * 0.85, T.hw * 0.85);
    const tp = T.pointAt(q.s + look, lane);
    const diff = wrapAngle(Math.atan2(tp.x - c.x, tp.z - c.z) - c.h);
    const steer = clamp(-diff * 2.4, -1, 1);
    const kap = T.curvAhead(q.i0, 18 + speed * 1.6);
    const latMax = 38 * (0.8 + 0.2 * c.skill) * (c.surface === 'road' ? 1 : 0.5);
    const vCorner = kap > 1e-4 ? Math.sqrt(latMax / kap) : 999;
    let target = Math.min(ph.vmax * c.skill * c.rubber, vCorner);
    if (gapNear) target = Math.max(target, 50);
    if (c.finished) target = 14;
    let throttle = 1, brake = 0;
    if (c.speed > target * 1.04) { throttle = 0; brake = clamp((c.speed - target) / 12, 0, 1) * 0.9; }
    else if (c.speed > target) throttle = 0.3;
    return { steer, throttle, brake, drift: false };
  }

  // ---------- interactions ----------
  _collide() {
    const cs = this.cars;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      if (a.respawnT > 0 || b.respawnT > 0) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 > 14 || Math.abs(a.y - b.y) > 1.6) continue;
      const d = Math.sqrt(d2) || 0.01, nx = dx / d, nz = dz / d, pen = 3.7 - d;
      if (pen <= 0) continue;
      a.x -= nx * pen * 0.5; a.z -= nz * pen * 0.5; b.x += nx * pen * 0.5; b.z += nz * pen * 0.5;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const imp = -rv * 0.6;
        a.vx -= nx * imp; a.vz -= nz * imp; b.vx += nx * imp; b.vz += nz * imp;
        if (-rv > 3) this.cb.onBump?.(a, b, -rv);
      }
    }
  }

  // Obstacles stay put (or slide); hitting one costs speed and knocks the car aside.
  _obstacles() {
    const T = this.track, t = this.time, tmp = {};
    for (let k = 0; k < T.obstacles.length; k++) {
      const o = T.obstacles[k];
      T.pointAt(o.s, T.obstacleD(o, t), tmp);
      const R = (this.world.tm?.obstacleRadius ?? 1.2) + 1.1;
      for (const c of this.cars) {
        if (c.airborne || Math.abs(c.q.s - o.s) > 6) continue;
        const dx = c.x - tmp.x, dz = c.z - tmp.z, d = Math.hypot(dx, dz);
        if (d >= R) continue;
        const nx = dx / (d || 1), nz = dz / (d || 1);
        c.x = tmp.x + nx * R; c.z = tmp.z + nz * R;
        const last = c.obstacleCool.get(k) ?? -9;
        if (t - last > 0.8) {
          c.obstacleCool.set(k, t);
          const vn = c.vx * nx + c.vz * nz;
          if (vn < 0) { c.vx -= nx * vn * 1.4; c.vz -= nz * vn * 1.4; }
          c.vx *= 0.58; c.vz *= 0.58; c.h += (this.rand() - 0.5) * 0.35; c.hitT = 0.5; c.drifting = false;
          if (c.isPlayer) this.stats.hits++;
          this.cb.onObstacle?.(c, k, o);
        }
      }
    }
  }

  _pickups() {
    const T = this.track;
    for (const c of this.cars) {
      const q = c.q;
      for (const p of T.pads) {
        const ds = q.s - p.s;
        if (ds >= 0 && ds <= p.len && Math.abs(q.d - p.d) < p.w + 1 && !c.airborne && (c.padCool == null || this.time - c.padCool > 1)) {
          c.padCool = this.time; c.boostT = Math.max(c.boostT, 1.8 * c.boostMul);
          c.vx += Math.sin(c.h) * 5 * c.boostMul; c.vz += Math.cos(c.h) * 5 * c.boostMul;
          if (c.isPlayer) this.stats.boosts++;
          this.cb.onPad?.(c);
        }
      }
    }
    const c = this.player; if (!c || c.finished) return;
    for (let i = 0; i < T.coins.length; i++) {
      const k = T.coins[i]; if (k.taken) continue;
      if (Math.abs(k.s - c.q.s) < 2.6 && Math.abs(k.d - c.q.d) < 2.8 && !c.airborne) { k.taken = true; c.coins++; this.stats.coins++; this.cb.onCoin?.(c, i); }
    }
  }

  _standings() {
    const prev = this.order ? this.order.map((c) => c.id) : null;
    const sorted = [...this.cars].sort((a, b) => (a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.prog - a.prog));
    sorted.forEach((c, i) => { if (!c.finished) c.place = i + 1; });
    this.order = sorted;
    if (prev && this.player && this.state === 'racing') {
      const was = prev.indexOf(this.player.id), now = sorted.indexOf(this.player);
      if (now < was) { this.stats.overtakes++; this.cb.onOvertake?.(now + 1); }
    }
  }
}
