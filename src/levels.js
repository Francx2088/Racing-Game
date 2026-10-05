// The 10 levels: layout (control points), road profile and gameplay tuning.
// Visual theme / scenery lives in themes.js (keyed by `theme`).

// Closed polar curve -> control points [x, z, y]
const polar = (r, y = () => 0, n = 44) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r(a);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr, y(a)]);
  }
  return pts;
};

// Rectilinear polygon with rounded corners (city blocks)
const roundedPoly = (corners, rad = 34) => {
  const out = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const p0 = corners[(i + n - 1) % n], p1 = corners[i], p2 = corners[(i + 1) % n];
    const d1 = [p1[0] - p0[0], p1[1] - p0[1]], l1 = Math.hypot(...d1);
    const d2 = [p2[0] - p1[0], p2[1] - p1[1]], l2 = Math.hypot(...d2);
    const a = [p1[0] - (d1[0] / l1) * rad, p1[1] - (d1[1] / l1) * rad];
    const b = [p1[0] + (d2[0] / l2) * rad, p1[1] + (d2[1] / l2) * rad];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * p1[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p1[1] + t * t * b[1], 0]);
    }
    // midpoint of the following straight keeps the spline tight
    out.push([(b[0] + (p2[0] - (d2[0] / l2) * rad)) / 2, (b[1] + (p2[1] - (d2[1] / l2) * rad)) / 2, 0]);
  }
  return out;
};

// Add a smooth altitude profile to flat control points (t = 0..1 around the loop)
const lift = (pts, f) => pts.map((p, i, a) => [p[0], p[1], f(i / a.length)]);
const TAU = Math.PI * 2;

// All tracks are roads floating in the sky; `theme` selects the atmosphere/scenery in themes.js.
export const LEVELS = [
  {
    id: 'golden', name: 'Sunset Summit', tag: 'Golden hour above the clouds', theme: 'golden', seed: 11,
    pts: lift([[0,0],[130,-20],[270,-10],[390,50],[430,170],[370,285],[250,310],[150,250],[50,265],[-70,340],[-200,320],[-275,210],[-235,90],[-120,40]], (t) => 11 * Math.sin(TAU * t * 2) + 5 * Math.sin(TAU * t * 3 + 1)),
    hw: 11, shoulder: 3.5, bank: 0.8, maxBank: 0.16, laps: 3, ai: 0.80,
    pads: 6, coins: 7, ramps: 0, nitros: 4, obstacles: { kind: 'cone', count: 14 }, hazards: [],
  },
  {
    id: 'alps', name: 'Alpine Ridge', tag: 'Weaving between the peaks', theme: 'alps', seed: 44,
    pts: lift([[0,0],[180,-20],[330,-110],[400,-250],[330,-380],[170,-410],[60,-320],[-60,-255],[-190,-305],[-335,-265],[-385,-130],[-300,-20],[-150,40]], (t) => 18 * Math.sin(TAU * t) + 6 * Math.sin(TAU * t * 3)),
    hw: 11, shoulder: 3.5, bank: 0.9, maxBank: 0.18, laps: 3, ai: 0.84,
    pads: 6, coins: 8, ramps: 1, nitros: 5, obstacles: { kind: 'rock', count: 14 }, hazards: [{ type: 'ice', count: 4 }],
  },
  {
    id: 'storm', name: 'Thunderhead', tag: 'Racing the storm', theme: 'storm', seed: 22,
    pts: lift([[-380,0],[-120,5],[160,-5],[360,-40],[430,-140],[360,-235],[220,-250],[120,-210],[40,-260],[-60,-330],[-180,-330],[-260,-280],[-390,-240],[-470,-140],[-460,-50]], (t) => 8 * Math.sin(TAU * t * 2 + 0.5) + 6 * Math.sin(TAU * t * 3)),
    hw: 10, shoulder: 3.5, bank: 0.8, maxBank: 0.16, laps: 3, ai: 0.88,
    pads: 7, coins: 8, ramps: 1, nitros: 5, obstacles: { kind: 'barrel', count: 16 }, hazards: [{ type: 'wet', count: 5 }],
  },
  {
    id: 'city', name: 'Midnight Metropolis', tag: 'High above the city lights', theme: 'city', seed: 33,
    pts: lift(roundedPoly([[-260,-150],[30,-150],[30,-50],[160,-50],[160,-170],[300,-170],[300,130],[100,130],[100,50],[-70,50],[-70,130],[-260,130]], 32), (t) => 7 * Math.sin(TAU * t * 2 + 1)),
    hw: 9, shoulder: 3, bank: 0, maxBank: 0, laps: 3, ai: 0.90,
    pads: 8, coins: 8, ramps: 0, nitros: 5, obstacles: { kind: 'bollard', count: 18 }, hazards: [{ type: 'oil', count: 3 }],
  },
  {
    id: 'arctic', name: 'Aurora Drift', tag: 'Ice floes under the aurora', theme: 'arctic', seed: 55,
    pts: polar((a) => 235 + 55 * Math.sin(3 * a + 0.4) + 30 * Math.sin(5 * a + 1.3) + 14 * Math.sin(7 * a), (a) => 9 * Math.sin(2 * a) + 4 * Math.sin(3 * a), 52),
    hw: 10, shoulder: 3, bank: 0.9, maxBank: 0.18, laps: 3, ai: 0.92,
    pads: 6, coins: 9, ramps: 1, nitros: 5, obstacles: { kind: 'iceblock', count: 16 }, hazards: [{ type: 'ice', count: 5 }],
  },
  {
    id: 'ember', name: 'Ember Skies', tag: 'Volcanic sunset', theme: 'ember', seed: 66,
    pts: polar((a) => 250 + 60 * Math.sin(2 * a + 0.5) + 28 * Math.sin(5 * a + 2), (a) => 12 + 11 * Math.sin(3 * a) + 7 * Math.sin(2 * a + 1), 52),
    hw: 9, shoulder: 3, bank: 0.9, maxBank: 0.2, laps: 3, ai: 0.94,
    pads: 7, coins: 9, ramps: 2, nitros: 5, obstacles: { kind: 'rock', count: 14 }, hazards: [{ type: 'ash', count: 4 }],
  },
  {
    id: 'isles', name: 'Paradise Isles', tag: 'Floating island paradise', theme: 'isles', seed: 77,
    pts: polar((a) => 235 + 70 * Math.cos(4 * a) + 18 * Math.sin(7 * a), (a) => 7 * Math.sin(2 * a) + 4 * Math.sin(5 * a), 56),
    hw: 10, shoulder: 3, bank: 0.9, maxBank: 0.18, laps: 3, ai: 0.96,
    pads: 8, coins: 10, ramps: 3, nitros: 6, obstacles: { kind: 'crate', count: 14 }, hazards: [{ type: 'wet', count: 3 }],
  },
  {
    id: 'stratos', name: 'Stratosphere', tag: 'The edge of space', theme: 'stratos', seed: 88,
    pts: lift([[0,0],[200,0],[380,60],[470,190],[420,320],[280,375],[165,300],[40,330],[-100,415],[-250,385],[-325,250],[-255,120],[-120,60]], (t) => 10 * Math.sin(TAU * t * 2) + 4 * Math.sin(TAU * t * 5)),
    hw: 11, shoulder: 3.5, bank: 0.8, maxBank: 0.16, laps: 3, ai: 0.98, gravity: 0.5,
    pads: 7, coins: 10, ramps: 4, nitros: 6, obstacles: { kind: 'debris', count: 14 }, hazards: [{ type: 'ice', count: 3 }],
  },
  {
    id: 'mesa', name: 'Sandstone Spires', tag: 'Dawn over the floating spires', theme: 'mesa', seed: 99,
    pts: polar((a) => 285 + 80 * Math.sin(a + 0.6) + 34 * Math.sin(3 * a + 1) + 14 * Math.sin(6 * a), (a) => 24 + 20 * Math.sin(a + 2) + 6 * Math.sin(2 * a), 56),
    hw: 9.5, shoulder: 3, bank: 0.9, maxBank: 0.18, laps: 3, ai: 1.0,
    pads: 7, coins: 10, ramps: 2, nitros: 6, obstacles: { kind: 'rock', count: 16 }, hazards: [{ type: 'sand', count: 4 }],
  },
  {
    id: 'heaven', name: 'Cloud Kingdom', tag: 'The ultimate skyway', theme: 'heaven', seed: 111,
    pts: polar((a) => 300 + 95 * Math.cos(2 * a) + 28 * Math.sin(3 * a + 1), (a) => 11 * Math.sin(2 * a + 1) + 6 * Math.sin(3 * a), 60),
    hw: 12, shoulder: 3, bank: 1.0, maxBank: 0.24, laps: 3, ai: 1.02,
    pads: 10, coins: 12, ramps: 3, nitros: 6, obstacles: { kind: 'cone', count: 12 }, hazards: [{ type: 'wet', count: 3 }],
  },
];
