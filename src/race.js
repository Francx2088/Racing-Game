// Race simulation: high-speed arcade physics, AI drivers, jumps, open edges, obstacles and standings.
// No rendering here: main.js reads car and obstacle state and draws it.
import { clamp, lerp, wrapAngle, rng } from './util.js';

const G_DEFAULT = 28;
const SURF = {
  ice: { grip: 0.18, vcap: 1 }, sand: { grip: 0.6, vcap: 0.78 }, oil: { grip: 0.12, vcap: 1 },
  wet: { grip: 0.55, vcap: 0.96 }, ash: { grip: 0.7, vcap: 0.9 },
};
const NO_INPUT = { steer: 0, throttle: 0, brake: 0, drift: false };
const CAR_R = 1.9;                     // collision radius of a car
export const HAMMER = { pivot: 17.5, arm: 16 };

export class RaceCar {
  constructor(o) {
    Object.assign(this, {
      id: o.id, name: o.name, def: o.def, isPlayer: !!o.isPlayer, skill: o.skill ?? 1, lane: o.lane ?? 0,
      livery: o.livery, color: o.color ?? 0xffffff, phys: o.phys || o.def.phys, boostMul: o.boostMul ?? 1,
      aggression: o.aggression ?? 0.5,
    });
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vz = 0; this.vy = 0; this.h = 0; this.speed = 0;
    this.boostT = 0; this.boostStack = 0; this.drifting = false; this.driftDir = 0; this.sliding = 0;
    this.airborne = false; this.falling = false; this.hint = -1; this.q = {}; this.prog = 0; this.maxS = 0;
    this.finished = false; this.finishTime = 0; this.place = 1;
    this.pitch = 0; this.roll = 0; this.slip = 0; this.lean = 0; this.steerState = 0;
    this.stuckT = 0; this.hitT = 0; this.pushT = 0; this.wallT = 0; this.respawnT = 0; this.surface = 'road'; this.onRoad = true; this.wind = 0;
    this.lastHitBy = null; this.lastHitT = -9;
    this.input = { ...NO_INPUT };
    this.aiPhase = Math.random() * 6; this.obstacleCool = new Map();
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
    this.stats = { overtakes: 0, hits: 0, boosts: 0, falls: 0, knockouts: 0, maxSpeed: 0 };
    // obstacle runtime state (crates are dynamic bodies)
    this.obs = this.track.obstacles.map((o) => {
      const p = this.track.pointAt(o.s, o.d);
      return { ...o, x: p.x, y: p.y + 0.8 + (o.stack ? 1.6 : 0), z: p.z, vx: 0, vy: 0, vz: 0, rx: 0, ry: Math.random() * 6, rz: 0, wx: 0, wy: 0, wz: 0, loose: false, gone: false };
    });
    this.cars.forEach((c, k) => this._grid(c, k));
    this._standings();
  }

  _grid(c, k) {
    const T = this.track, row = k >> 1, side = k & 1 ? 1 : -1;
    const s = T.startS - 10 - row * 13 - (side > 0 ? 5 : 0);
    const p = T.pointAt(s, side * T.hw * 0.4);
    c.x = p.x; c.z = p.z; c.y = p.y; c.h = p.head; c.vx = c.vz = c.vy = 0; c.hint = p.i; c.grid = k;
    c.airborne = false; c.falling = false; c.boostT = 0; c.boostStack = 0;
    T.query(c.x, c.z, c.hint, c.q); c.prog = c.q.s; c.maxS = c.q.s;
  }

  update(dt, playerInput = NO_INPUT) {
    dt = Math.min(dt, 1 / 20);
    const steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
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
    this._obstacles(dt);
    this._pads();
    this._standings();
    if (this.player) this.stats.maxSpeed = Math.max(this.stats.maxSpeed, this.player.speed);
    if (this.demo) for (const c of this.cars) if (c.q.s > this.track.finishS - 30) this._grid(c, c.grid);
  }

  // ---------- physics ----------
  _physics(c, dt, inp, frozen) {
    const T = this.track, ph = c.phys, q = c.q;
    T.query(c.x, c.z, c.hint, q); c.hint = q.i0;
    if (frozen) { c.vx = c.vz = 0; c.y = q.surfaceY; return; }
    if (c.respawnT > 0) c.respawnT -= dt;

    let grip = 1, vcap = 1, surf = 'road';
    const z = T.zoneAt(q.s, q.d);
    c.wind = 0;
    if (z) {
      if (z.type === 'wind') c.wind = z.dir * z.force;
      else { const S = SURF[z.type]; grip = S.grip; vcap = S.vcap; surf = z.type; }
    }
    c.surface = surf; c.onRoad = surf === 'road';
    const air = c.airborne;

    const fx = Math.sin(c.h), fz = Math.cos(c.h), rx = -fz, rz = fx;
    let vF = c.vx * fx + c.vz * fz, vR = c.vx * rx + c.vz * rz;
    const baseMax = ph.vmax * (c.isPlayer ? 1 : c.skill * (c.rubber ?? 1));
    let vmax = baseMax * vcap;
    if (c.boostT > 0) { vmax = baseMax * (1.32 + 0.08 * c.boostStack) * (1 + (c.boostMul - 1) * 0.5); c.boostT -= dt; if (c.boostT <= 0) c.boostStack = 0; }

    let acc = 0;
    if (!air) {
      if (inp.throttle > 0) acc += 46 * ph.acc * inp.throttle * (1 - Math.pow(clamp(vF / vmax, 0, 1), 1.6));
      if (c.boostT > 0) acc += 38 * c.boostMul;
      if (inp.brake > 0) acc -= (vF > 1 ? 70 : 20) * inp.brake;
      if (inp.throttle === 0 && inp.brake === 0) acc -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, 7);
      if (vF > vmax) acc -= (vF - vmax) * 1.6;
      if (vF < -18) acc += 24;
    } else acc -= vF * 0.01;
    vF += acc * dt;

    // steering: full lock at speed swings the tail out into a power slide
    const sp = clamp(Math.abs(vF) / ph.vmax, 0, 1.3);
    let wmax = (1.95 - 1.25 * Math.min(sp, 1)) * ph.turn;
    if (inp.drift && !c.drifting && Math.abs(inp.steer) > 0.3 && vF > 25 && !air) { c.drifting = true; c.driftDir = Math.sign(inp.steer); }
    if (c.drifting && (!inp.drift || vF < 15 || air)) c.drifting = false;
    const hardTurn = !air && Math.abs(inp.steer) > 0.72 && sp > 0.55;
    c.sliding = lerp(c.sliding, c.drifting || hardTurn ? 1 : 0, 1 - Math.exp(-(hardTurn ? 4 : 6) * dt));
    let yawIn = inp.steer;
    if (c.drifting) { yawIn = c.driftDir * (0.62 + 0.38 * inp.steer * c.driftDir); wmax *= 1.3; }
    wmax *= 1 + 0.16 * c.sliding;
    const yawRate = -yawIn * wmax * clamp(Math.abs(vF) / 8, 0, 1) * Math.sign(vF || 1) * (air ? 0.3 : 1);
    c.h += yawRate * dt;
    c.steerState = lerp(c.steerState, inp.steer, 1 - Math.exp(-12 * dt));

    if (c.pushT > 0) c.pushT -= dt;
    const gk = lerp(9, 3.2, c.sliding) * grip * (ph.grip ?? 1) * (c.pushT > 0 ? 0.22 : 1);
    const decay = air ? 0.05 : 1 - Math.exp(-gk * dt);
    vF -= Math.abs(vR) * decay * 0.08 * Math.sign(vF);
    vR -= vR * decay;
    const nfx = Math.sin(c.h), nfz = Math.cos(c.h), nrx = -nfz, nrz = nfx;
    c.vx = nfx * vF + nrx * vR; c.vz = nfz * vF + nrz * vR;
    if (c.wind) { c.vx += T.rx[q.i0] * c.wind * dt; c.vz += T.rz[q.i0] * c.wind * dt; }
    c.speed = vF; c.slip = Math.atan2(vR, Math.max(Math.abs(vF), 6));
    c.lean = lerp(c.lean, clamp(-yawRate * vF * 0.003, -0.16, 0.16), 1 - Math.exp(-8 * dt));

    c.x += c.vx * dt; c.z += c.vz * dt;

    // barriers exist only on some edges; elsewhere the deck simply ends
    T.query(c.x, c.z, c.hint, q); c.hint = q.i0;
    const road = T.hasRoad(q.s), side = Math.sign(q.d), lim = T.wallD - 1.2;
    if (road && !c.falling && Math.abs(q.d) > lim && T.wallAt(q.s, side)) {
      const over = Math.abs(q.d) - lim, wrx = T.rx[q.i0], wrz = T.rz[q.i0];
      c.x -= side * wrx * over; c.z -= side * wrz * over;
      const vn = (c.vx * wrx + c.vz * wrz) * side;
      if (vn > 0) {
        c.vx -= side * wrx * vn * 1.35; c.vz -= side * wrz * vn * 1.35;
        const scale = 1 - Math.min(0.35, (vn / (Math.abs(vF) + 5)) * 0.5);
        c.vx *= scale; c.vz *= scale; c.h += wrapAngle(q.head - c.h) * 0.25;
        if (vn > 4 && c.wallT <= 0) { c.wallT = 0.25; this.cb.onWall?.(c, vn, side); }
        c.drifting = false;
      }
    }
    if (c.wallT > 0) c.wallT -= dt;
    if (c.hitT > 0) c.hitT -= dt;

    // vertical: ride the deck, launch off crests and ramps, fall off open edges and into gaps
    const onDeck = road && Math.abs(q.d) < T.wallD + 0.8 && !c.falling;
    const gNow = onDeck ? q.surfaceY + T.rampAt(q.s, q.d) : -1e4;
    if (c.airborne) {
      c.vy -= this.gravity * dt; c.y += c.vy * dt;
      if (c.y <= gNow && c.y > gNow - 1.8) { c.y = gNow; c.airborne = false; if (-c.vy > 7) { this.cb.onLand?.(c, -c.vy); c.vx *= 0.99; c.vz *= 0.99; } c.vy = 0; }
      else if (c.y < gNow - 1.8 || !onDeck) { if (!onDeck && c.y < q.y - 4) c.falling = true; }
    } else {
      const ballistic = c.y + (c.vy - this.gravity * dt) * dt;
      if (ballistic > gNow + 0.08) { c.airborne = true; c.vy -= this.gravity * dt; c.y += c.vy * dt; this.cb.onLaunch?.(c); }
      else { c.vy = clamp((gNow - c.y) / dt, -40, 40); c.y = gNow; }
    }
    if (c.falling || c.y < q.y - 50) { if (c.y < q.y - 50) this._respawn(c, true); }

    const slopeAhead = q.slope + (T.rampAt(q.s + 1.5, q.d) - T.rampAt(q.s - 1.5, q.d)) / 3;
    const targetPitch = c.airborne ? Math.atan2(c.vy, Math.max(10, Math.abs(vF))) : Math.atan(slopeAhead * Math.cos(wrapAngle(c.h - q.head)));
    c.pitch = lerp(c.pitch, targetPitch, 1 - Math.exp(-(c.airborne ? 3 : 14) * dt));
    c.roll = lerp(c.roll, c.airborne ? c.roll * 0.98 : q.bank, 1 - Math.exp(-10 * dt));

    if (this.state === 'racing' && !c.finished && !this.demo) {
      if (Math.abs(vF) < 4 && !c.airborne) c.stuckT += dt; else c.stuckT = 0;
      if (c.stuckT > 2.5) this._respawn(c, false);
    }

    c.prog = q.s; if (!c.airborne) c.maxS = Math.max(c.maxS, q.s);
    if (!c.finished && !this.demo && this.state === 'racing' && q.s >= T.finishS && !c.airborne) this._finish(c);
  }

  _respawn(c, fell) {
    const T = this.track, s = T.lastCheckpoint(c.maxS);
    const p = T.pointAt(s + 4, 0);
    c.x = p.x; c.z = p.z; c.y = p.y + 0.5; c.h = p.head; c.hint = p.i;
    const v = 45; c.vx = Math.sin(c.h) * v; c.vz = Math.cos(c.h) * v; c.vy = 0;
    c.airborne = false; c.falling = false; c.drifting = false; c.stuckT = 0; c.respawnT = 1.6; c.boostT = 0; c.boostStack = 0;
    T.query(c.x, c.z, c.hint, c.q);
    if (fell && c.isPlayer) this.stats.falls++;
    // the player gets the knockout if they were the last one to hit this car
    if (fell && !c.isPlayer && c.lastHitBy === this.player && this.time - c.lastHitT < 3.5) { this.stats.knockouts++; this.cb.onKnockout?.(c); }
    this.cb.onRespawn?.(c, fell);
  }

  _finish(c) {
    c.finished = true; c.finishTime = this.time; this.finishOrder.push(c); c.place = this.finishOrder.length;
    this.cb.onFinish?.(c);
    if (this.cars.every((x) => x.finished)) this.state = 'done';
  }

  // ---------- AI ----------
  _ai(c, dt) {
    const T = this.track, q = c.q, ph = c.phys, t = this.time;
    c.aiPhase += dt;
    const speed = Math.max(c.speed, 10);
    if (this.player && !this.demo) c.rubber = clamp(1 - (c.prog - this.player.prog) * 0.00025, 0.92, 1.1);
    else c.rubber = 1;
    const look = 14 + speed * 0.45;
    let lane = c.lane * T.hw * 0.5 + Math.sin(c.aiPhase * 0.3 + c.grid) * T.hw * 0.12;
    const gapNear = T.gapAhead(q.s, 220);
    if (gapNear) lane *= 0.15;
    // stay away from open edges a little more than walled ones
    // dodge obstacles (predicting where sliders will be when we arrive)
    for (const o of this.obs) {
      if (o.gone) continue;
      const ds = o.s - q.s; if (ds < 0 || ds > 20 + speed * 0.7) continue;
      const tArr = t + ds / Math.max(speed, 10);
      let od;
      if (o.kind === 'crate') od = o.d;
      else if (o.kind === 'sweeper') od = Math.cos(tArr * o.freq + o.phase) * o.len * 0.5;
      else od = T.obstacleD(o, tArr);
      if (Math.abs(od - lane) < 4.5) lane = od + (od > 0 ? -1 : 1) * 5.5;
    }
    for (const o of this.cars) {
      if (o === c || o.respawnT > 0) continue;
      const ds = o.q.s - q.s;
      if (ds > 1 && ds < 20 && Math.abs(o.q.d - q.d) < 3.6 && o.speed < c.speed + 8) lane = q.d + (o.q.d > q.d ? -1 : 1) * 5;
      // aggressive drivers lean on the player when alongside
      if (o.isPlayer && Math.abs(ds) < 5 && Math.abs(o.q.d - q.d) < 7 && c.aggression > 0.6 && !gapNear) lane = o.q.d;
    }
    for (const p of T.pads) { const ds = p.s - q.s; if (ds > 0 && ds < 90 && !gapNear && Math.abs(p.d - lane) < 7) { lane = p.d; break; } }
    lane = clamp(lane, -T.hw * 0.78, T.hw * 0.78);
    const tp = T.pointAt(q.s + look, lane);
    const diff = wrapAngle(Math.atan2(tp.x - c.x, tp.z - c.z) - c.h);
    const steer = clamp(-diff * 2.6, -1, 1);
    const kap = T.curvAhead(q.i0, 30 + speed * 1.8);
    const latMax = 66 * (0.85 + 0.15 * c.skill) * (c.surface === 'road' ? 1 : 0.55);
    let vCorner = kap > 1e-4 ? Math.sqrt(latMax / kap) : 999;
    // and no faster than the steering can turn: yaw rate shrinks with speed
    if (kap > 1e-4) { let v = vCorner; for (let k = 0; k < 3; k++) v = Math.min(vCorner, (1.95 - 1.25 * Math.min(v / ph.vmax, 1)) * ph.turn * 0.95 / kap); vCorner = v; }
    let target = Math.min(ph.vmax * c.skill * c.rubber, vCorner);
    if (gapNear) target = Math.max(target, 75);
    if (c.finished) target = 20;
    let throttle = 1, brake = 0;
    if (c.speed > target * 1.04) { throttle = 0; brake = clamp((c.speed - target) / 18, 0, 1) * 0.9; }
    else if (c.speed > target) throttle = 0.35;
    return { steer: clamp(steer, -1, 1), throttle, brake, drift: false };
  }

  // ---------- car vs car: real shoving ----------
  _collide() {
    const cs = this.cars, D = CAR_R * 2;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      if (a.respawnT > 0 || b.respawnT > 0 || a.falling || b.falling) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 > D * D || Math.abs(a.y - b.y) > 2) continue;
      const d = Math.sqrt(d2) || 0.01, nx = dx / d, nz = dz / d, pen = D - d;
      a.x -= nx * pen * 0.5; a.z -= nz * pen * 0.5; b.x += nx * pen * 0.5; b.z += nz * pen * 0.5;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        // the side shove is stronger than the head-on part, so cars can bully each other wide
        const imp = -rv * 0.85 + 4;
        a.vx -= nx * imp; a.vz -= nz * imp; b.vx += nx * imp; b.vz += nz * imp;
        a.lastHitBy = b; a.lastHitT = this.time; b.lastHitBy = a; b.lastHitT = this.time;
        if (-rv > 2) { a.pushT = b.pushT = 0.45; }
        if (-rv > 3) this.cb.onBump?.(a, b, -rv);
      }
    }
  }

  // ---------- obstacles ----------
  _obstacles(dt) {
    const T = this.track, t = this.time, G = this.gravity, tmp = {};
    for (let k = 0; k < this.obs.length; k++) {
      const o = this.obs[k]; if (o.gone) continue;
      if (o.kind === 'crate') {
        if (o.loose) {
          o.vy -= G * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
          o.rx += o.wx * dt; o.ry += o.wy * dt; o.rz += o.wz * dt;
          const n = T.query(o.x, o.z, T.idxAtS(o.s), tmp);
          if (Math.abs(n.d) < T.wallD + 0.5 && T.hasRoad(n.s) && o.y < n.surfaceY + 0.8 && o.y > n.surfaceY - 2) {
            o.y = n.surfaceY + 0.8; if (o.vy < 0) o.vy *= -0.3;
            o.vx *= 0.96; o.vz *= 0.96; o.wx *= 0.95; o.wy *= 0.95; o.wz *= 0.95;
          }
          o.s = n.s;
          if (o.y < n.y - 400) o.gone = true;
        }
        for (const c of this.cars) {
          if (c.respawnT > 0 || Math.abs(c.q.s - o.s) > 8) continue;
          const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz);
          if (d > CAR_R + 1.0 || Math.abs(o.y - 0.8 - c.y) > 2.2) continue;
          // knock the crate flying, lose some speed
          const nx = dx / (d || 1), nz = dz / (d || 1), sp = Math.hypot(c.vx, c.vz);
          o.loose = true; o.vx = c.vx * 0.85 + nx * 8; o.vz = c.vz * 0.85 + nz * 8; o.vy = 7 + Math.random() * 7;
          o.wx = (Math.random() - 0.5) * 12; o.wy = (Math.random() - 0.5) * 12; o.wz = (Math.random() - 0.5) * 12;
          c.vx *= 0.8; c.vz *= 0.8; c.hitT = 0.3;
          if (c.isPlayer) this.stats.hits++;
          this.cb.onObstacle?.(c, k, o, sp);
        }
        continue;
      }
      // moving solid obstacles
      let segs;
      if (o.kind === 'sweeper') {
        const p = T.pointAt(o.s, 0, tmp), a = t * o.freq + o.phase, i = p.i;
        const ux = T.rx[i] * Math.cos(a) + T.tx[i] * Math.sin(a), uz = T.rz[i] * Math.cos(a) + T.tz[i] * Math.sin(a);
        o.x = p.x; o.z = p.z; o.y = p.y; o.ang = a;
        segs = { ax: p.x - ux * o.len, az: p.z - uz * o.len, bx: p.x + ux * o.len, bz: p.z + uz * o.len, r: 1.0 };
      } else {
        const p = T.pointAt(o.s, T.obstacleD(o, t), tmp); o.x = p.x; o.z = p.z; o.y = p.y;
        o.vd = Math.cos(t * o.freq + o.phase) * o.freq * o.amp;
        segs = { ax: p.x, az: p.z, bx: p.x, bz: p.z, r: o.kind === 'hammer' ? 2.2 : 2.6 };
        // a swinging hammer head rises at the ends of its arc, so cars can slip underneath there
        if (o.kind === 'hammer') { const dd = T.obstacleD(o, t); o.headY = HAMMER.pivot - Math.sqrt(HAMMER.arm ** 2 - dd * dd); if (o.headY > 2.6) continue; }
      }
      for (const c of this.cars) {
        if (c.respawnT > 0 || c.airborne && c.y > o.y + 3 || Math.abs(c.q.s - o.s) > 30) continue;
        // closest point on the segment
        const ex = segs.bx - segs.ax, ez = segs.bz - segs.az, L2 = ex * ex + ez * ez || 1;
        const u = clamp(((c.x - segs.ax) * ex + (c.z - segs.az) * ez) / L2, 0, 1);
        const px = segs.ax + ex * u, pz = segs.az + ez * u, dx = c.x - px, dz = c.z - pz, d = Math.hypot(dx, dz), R = segs.r + CAR_R;
        if (d >= R) continue;
        const nx = dx / (d || 1), nz = dz / (d || 1);
        c.x = px + nx * R; c.z = pz + nz * R;
        const last = c.obstacleCool.get(k) ?? -9;
        if (t - last > 0.7) {
          c.obstacleCool.set(k, t);
          // a hit costs speed and a nudge, not a launch into the void
          const vn = c.vx * nx + c.vz * nz;
          if (vn < 0) { c.vx -= nx * vn; c.vz -= nz * vn; }
          c.vx = c.vx * 0.5 + nx * 5; c.vz = c.vz * 0.5 + nz * 5;
          c.h += (this.rand() - 0.5) * 0.15; c.hitT = 0.5; c.drifting = false;
          if (c.isPlayer) this.stats.hits++;
          this.cb.onObstacle?.(c, k, o, 30);
        }
      }
    }
  }

  // boost pads: each pad in a chain adds to the boost
  _pads() {
    const T = this.track;
    for (const c of this.cars) {
      const q = c.q;
      for (let k = 0; k < T.pads.length; k++) {
        const p = T.pads[k], ds = q.s - p.s;
        if (ds >= 0 && ds <= p.len && Math.abs(q.d - p.d) < p.w + 1.2 && !c.airborne && c.lastPad !== k) {
          c.lastPad = k;
          c.boostStack = c.boostT > 0 ? Math.min(c.boostStack + 1, 3) : 0;
          c.boostT = (2.0 + 0.4 * c.boostStack) * c.boostMul;
          c.vx += Math.sin(c.h) * 8 * c.boostMul; c.vz += Math.cos(c.h) * 8 * c.boostMul;
          if (c.isPlayer) this.stats.boosts++;
          this.cb.onPad?.(c, c.boostStack);
        }
      }
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
