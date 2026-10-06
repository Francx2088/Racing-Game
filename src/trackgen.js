// Procedural sky-course builder.
// A turtle lays control points every STEP metres while it plays a "script" of high-speed pieces:
// banked sweepers, S-chains, tight bowls, dives, climbs and jumps over open gaps. The road may
// cross over itself, but only with plenty of height between the two decks.
import { rng, clamp } from './util.js';

const STEP = 40;

export function generateCourse(opts) {
  const o = { seed: 1, length: 9000, twist: 0.5, hills: 40, jumps: 2, bowls: 1, heading: 0, ...opts };
  const r = rng(o.seed);
  const pts = [], gaps = [];
  let x = 0, z = 0, y = 0, h = o.heading, dist = 0, yTarget = 0;
  const h0 = h;

  const clear = (nx, nz, ny) => {
    for (let i = 0; i < pts.length - 10; i++) {
      const p = pts[i], d2 = (p[0] - nx) ** 2 + (p[1] - nz) ** 2;
      if (d2 < 120 * 120 && Math.abs(p[2] - ny) < 45) return false;
    }
    return true;
  };
  const simulate = (turns, dys) => {
    let sx = x, sz = z, sy = y, sh = h;
    for (let k = 0; k < turns.length; k++) {
      sh += turns[k];
      if (Math.abs(sh - h0) > Math.PI * 0.95) return false;
      sx += Math.sin(sh) * STEP; sz += Math.cos(sh) * STEP; sy += dys ? dys[k] : 0;
      if (!clear(sx, sz, sy)) return false;
    }
    return true;
  };
  const put = () => pts.push([x, z, y]);
  const advance = (dh, dy = null) => {
    h += dh; x += Math.sin(h) * STEP; z += Math.cos(h) * STEP; dist += STEP;
    if (dy != null) y += clamp(dy, -4.4, 4.4);
    else y += clamp(yTarget - y, -0.12 * STEP, 0.12 * STEP) * 0.45;
    put();
  };
  const straight = (len) => Array(Math.max(1, Math.round(len / STEP))).fill(0);
  const arc = (angle, radius) => { const n = Math.max(2, Math.round(Math.abs(angle) * radius / STEP)); return Array(n).fill(angle / n); };
  const run = (turns, dys) => turns.forEach((t, k) => advance(t, dys ? dys[k] : null));
  const tryRun = (turns, dys) => { if (simulate(turns, dys)) { run(turns, dys); return true; } return false; };

  put();
  run(straight(320));                                   // grid + launch straight
  const jumpEvery = o.length / (o.jumps + 1);
  let nextJump = jumpEvery, jumpsLeft = o.jumps, bowlsLeft = o.bowls;
  const tw = o.twist;

  while (dist < o.length - 600) {
    if (r() < 0.45) yTarget = clamp(yTarget + (r() - 0.5) * o.hills * 2.2, -o.hills * 1.4, o.hills * 1.4);

    if (jumpsLeft > 0 && dist > nextJump) {
      const lead = straight(240), len = 60 + r() * 30, n = Math.ceil(len / STEP) + 1, drop = Math.min(12 + r() * 10, n * 4.4);
      const fly = Array(n).fill(0), dys = [...lead.map(() => 0), ...Array(n).fill(-drop / n)];
      if (simulate([...lead, ...fly], dys)) {
        run(lead, lead.map(() => 0));
        gaps.push({ k: pts.length - 1, len });
        run(fly, Array(n).fill(-drop / n));
        yTarget = y; run(straight(160), straight(160).map(() => 0));
        jumpsLeft--; nextJump += jumpEvery;
        continue;
      }
      nextJump += 300;
    }

    const side = r() < 0.5 ? -1 : 1, kind = r();
    let piece, dys = null;
    if (bowlsLeft > 0 && kind < 0.1) {                 // tight, heavily banked bowl
      piece = arc(side * Math.PI * (0.75 + r() * 0.2), 120 + (1 - tw) * 40); bowlsLeft--;
    } else if (kind < 0.18) {                          // short blast
      piece = straight(160 + r() * 220 * (1.2 - tw));
    } else if (kind < 0.46) {                          // big banked sweeper
      piece = arc(side * (0.7 + r() * 1.0) * (0.75 + tw * 0.5), 170 + (1 - tw) * 150 + r() * 60);
    } else if (kind < 0.74) {                          // S-chain
      const n = 2 + Math.floor(r() * (2 + tw * 2)), a = (0.5 + r() * 0.45) * (0.8 + tw * 0.4), R = 140 + (1 - tw) * 90;
      piece = []; for (let k = 0; k < n; k++) piece.push(...arc((k % 2 ? -side : side) * a, R));
    } else if (kind < 0.87) {                          // dive or climb through a curve
      const up = r() < 0.4 ? 1 : -1, a = side * (0.5 + r() * 0.6);
      piece = arc(a, 200 + r() * 80); const total = up * (35 + r() * 40);
      dys = piece.map(() => total / piece.length); yTarget = y + total;
    } else {                                           // corkscrew: S-chain while dropping
      const a = 0.55 * (0.8 + tw * 0.4), R = 150;
      piece = [...arc(side * a, R), ...arc(-side * a, R), ...arc(side * a, R)];
      const total = -(30 + r() * 30); dys = piece.map(() => total / piece.length); yTarget = y + total;
    }
    if (tryRun(piece, dys)) continue;
    if (tryRun(piece.map((d) => -d), dys)) continue;
    const back = Math.sign(h0 - h) * 0.1;
    if (!tryRun([back, back, back, back])) run(straight(80));
  }
  yTarget = y;
  run(straight(560), straight(560).map(() => 0));       // finish straight + run-off
  return { pts, gaps };
}
