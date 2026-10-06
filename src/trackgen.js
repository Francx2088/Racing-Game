// Procedural point-to-point course builder.
// A "turtle" lays down control points every STEP metres: straights, sweepers, S-bends, hairpins,
// hills and jumps over open gaps. It keeps the road from crossing itself by bounding the overall
// heading and rejecting pieces that come too close to road already laid.
import { rng, clamp } from './util.js';

const STEP = 30;

export function generateCourse(opts) {
  const o = {
    seed: 1, length: 6000, twist: 0.5, hills: 10, jumps: 2, hairpins: 0, maxSlope: 0.08, heading: 0, ...opts,
  };
  const r = rng(o.seed);
  const pts = [];          // [x, z, y]
  const gaps = [];         // { k: control index where the gap starts, len: metres }
  let x = 0, z = 0, y = 0, h = o.heading, dist = 0;
  const h0 = h;
  let yTarget = 0;

  const tooClose = (nx, nz) => {
    for (let i = 0; i < pts.length - 14; i++) {
      const p = pts[i];
      if ((p[0] - nx) ** 2 + (p[1] - nz) ** 2 < 75 * 75) return true;
    }
    return false;
  };
  const put = () => { pts.push([x, z, y]); };
  // simulate a piece first; commit only if it keeps clear of the existing road
  const tryPiece = (turns) => {
    let sx = x, sz = z, sh = h;
    for (const dh of turns) {
      sh += dh;
      if (Math.abs(sh - h0) > Math.PI * 0.72) return false;
      sx += Math.sin(sh) * STEP; sz += Math.cos(sh) * STEP;
      if (tooClose(sx, sz)) return false;
    }
    return true;
  };
  const advance = (dh) => {
    h += dh;
    x += Math.sin(h) * STEP; z += Math.cos(h) * STEP; dist += STEP;
    // elevation: ease towards a wandering target, slope-limited
    const dy = clamp(yTarget - y, -o.maxSlope * STEP, o.maxSlope * STEP);
    y += dy * 0.5;
    put();
  };
  const runPiece = (turns) => { for (const dh of turns) advance(dh); };

  const straight = (len) => Array(Math.max(1, Math.round(len / STEP))).fill(0);
  const arc = (angle, radius) => {
    const n = Math.max(2, Math.round((Math.abs(angle) * radius) / STEP));
    return Array(n).fill(angle / n);
  };

  put();
  runPiece(straight(210));            // start straight / grid

  const hairpinBudget = { n: o.hairpins };
  let jumpsLeft = o.jumps;
  const jumpEvery = o.length / (o.jumps + 1);
  let nextJump = jumpEvery;

  while (dist < o.length - 300) {
    // new altitude target every so often
    if (r() < 0.35) yTarget = clamp(yTarget + (r() - 0.5) * o.hills * 2.4, -o.hills * 1.5, o.hills * 1.5);

    if (jumpsLeft > 0 && dist > nextJump) {
      const run = straight(150);
      if (tryPiece([...run, 0, 0, 0, 0])) {
        runPiece(run);
        const len = 28 + r() * 14;
        gaps.push({ k: pts.length - 1, len });
        // fly across: the landing side sits a little lower
        const drop = 3 + r() * 5;
        const n = Math.ceil(len / STEP) + 1;
        for (let i = 0; i < n; i++) { x += Math.sin(h) * STEP; z += Math.cos(h) * STEP; dist += STEP; y -= drop / n; put(); }
        yTarget = y;
        runPiece(straight(90));
        jumpsLeft--; nextJump += jumpEvery;
        continue;
      }
    }

    const side = r() < 0.5 ? -1 : 1;
    const tight = o.twist;
    const kind = r();
    let piece;
    if (hairpinBudget.n > 0 && kind < 0.12) {
      piece = arc(side * (Math.PI * (0.8 + r() * 0.15)), 55 + (1 - tight) * 25);
      hairpinBudget.n--;
    } else if (kind < 0.22) {
      piece = straight(80 + r() * 150 * (1.2 - tight));
    } else if (kind < 0.62) {
      piece = arc(side * (0.5 + r() * 1.0) * (0.7 + tight * 0.6), 65 + (1 - tight) * 110 + r() * 40);
    } else {
      const a = (0.4 + r() * 0.55) * (0.7 + tight * 0.5), R = 60 + (1 - tight) * 90;
      piece = [...arc(side * a, R), ...arc(-side * a, R)];
    }
    // prefer the planned piece, then its mirror, then a gentle straight
    const mirror = piece.map((d) => -d);
    if (tryPiece(piece)) runPiece(piece);
    else if (tryPiece(mirror)) runPiece(mirror);
    else {
      // steer back towards the overall course direction
      const back = Math.sign(h0 - h) * 0.12;
      runPiece(tryPiece([back, back, back]) ? [back, back, back] : straight(60));
    }
  }
  yTarget = y;
  runPiece(straight(330));            // finish straight + run-off
  return { pts, gaps };
}
