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

export const LEVELS = [
  {
    id: 'coast', name: 'Sunset Bay', tag: 'Beach cruise', theme: 'coast', seed: 11,
    pts: [[0,0,0],[130,-20,0],[270,-10,0],[390,50,0],[430,170,0],[370,285,0],[250,310,0],[150,250,0],[50,265,0],[-70,340,0],[-200,320,0],[-275,210,0],[-235,90,0],[-120,40,0]],
    hw: 11, shoulder: 3.5, bank: 0.5, maxBank: 0.1, laps: 3, ai: 0.80,
    pads: 6, coins: 7, ramps: 0, nitros: 4, obstacles: { kind: 'cone', count: 14 }, hazards: [],
  },
  {
    id: 'desert', name: 'Dust Canyon', tag: 'Hairpins & straights', theme: 'desert', seed: 22,
    pts: [[-380,0,0],[-120,5,0],[160,-5,0],[360,-40,0],[430,-140,0],[360,-235,0],[220,-250,0],[120,-210,0],[40,-260,0],[-60,-330,0],[-180,-330,0],[-260,-280,0],[-390,-240,0],[-470,-140,0],[-460,-50,0]],
    hw: 10, shoulder: 3.5, bank: 0.6, maxBank: 0.1, laps: 3, ai: 0.84,
    pads: 7, coins: 8, ramps: 1, nitros: 5, obstacles: { kind: 'barrel', count: 16 }, hazards: [{ type: 'sand', count: 3 }],
  },
  {
    id: 'neon', name: 'Neon Grid', tag: 'Downtown night', theme: 'neon', seed: 33,
    pts: roundedPoly([[-260,-150],[30,-150],[30,-50],[160,-50],[160,-170],[300,-170],[300,130],[100,130],[100,50],[-70,50],[-70,130],[-260,130]], 32),
    hw: 8.5, shoulder: 3, bank: 0, maxBank: 0, laps: 3, ai: 0.88,
    pads: 8, coins: 8, ramps: 0, nitros: 5, obstacles: { kind: 'bollard', count: 18 }, hazards: [{ type: 'oil', count: 3 }],
  },
  {
    id: 'frost', name: 'Frostbite Peak', tag: 'Slippery ice', theme: 'frost', seed: 44,
    pts: [[0,0,0],[180,-20,2],[330,-110,6],[400,-250,10],[330,-380,12],[170,-410,10],[60,-320,6],[-60,-255,4],[-190,-305,6],[-335,-265,4],[-385,-130,2],[-300,-20,0],[-150,40,0]],
    hw: 12, shoulder: 4, bank: 0.6, maxBank: 0.12, laps: 3, ai: 0.90,
    pads: 6, coins: 8, ramps: 1, nitros: 5, obstacles: { kind: 'iceblock', count: 14 }, hazards: [{ type: 'ice', count: 5 }],
  },
  {
    id: 'jungle', name: 'Jungle Twist', tag: 'Tight & muddy', theme: 'jungle', seed: 55,
    pts: polar((a) => 235 + 55 * Math.sin(3 * a + 0.4) + 30 * Math.sin(5 * a + 1.3) + 14 * Math.sin(7 * a), (a) => 4 * Math.sin(2 * a), 52),
    hw: 9, shoulder: 3, bank: 0.7, maxBank: 0.12, laps: 3, ai: 0.92,
    pads: 6, coins: 9, ramps: 1, nitros: 5, obstacles: { kind: 'log', count: 16 }, hazards: [{ type: 'mud', count: 5 }],
  },
  {
    id: 'volcano', name: 'Magma Run', tag: 'Over the lava', theme: 'volcano', seed: 66,
    pts: polar((a) => 250 + 60 * Math.sin(2 * a + 0.5) + 28 * Math.sin(5 * a + 2), (a) => 12 + 11 * Math.sin(3 * a) + 8 * Math.sin(2 * a + 1), 52),
    hw: 8.5, shoulder: 3, bank: 0.7, maxBank: 0.14, laps: 3, ai: 0.94,
    pads: 7, coins: 9, ramps: 2, nitros: 5, obstacles: { kind: 'rock', count: 14 }, hazards: [],
  },
  {
    id: 'candy', name: 'Sugar Rush', tag: 'Sweet jumps', theme: 'candy', seed: 77,
    pts: polar((a) => 235 + 70 * Math.cos(4 * a) + 18 * Math.sin(7 * a), (a) => 7 * Math.sin(2 * a) + 5 * Math.sin(5 * a), 56),
    hw: 10, shoulder: 3, bank: 0.7, maxBank: 0.14, laps: 3, ai: 0.96,
    pads: 8, coins: 10, ramps: 3, nitros: 6, obstacles: { kind: 'gumdrop', count: 14 }, hazards: [{ type: 'syrup', count: 4 }],
  },
  {
    id: 'moon', name: 'Lunar Leap', tag: 'Low gravity', theme: 'moon', seed: 88,
    pts: [[0,0,0],[200,0,0],[380,60,0],[470,190,0],[420,320,0],[280,375,0],[165,300,0],[40,330,0],[-100,415,0],[-250,385,0],[-325,250,0],[-255,120,0],[-120,60,0]],
    hw: 11, shoulder: 3.5, bank: 0.5, maxBank: 0.1, laps: 3, ai: 0.98, gravity: 0.42,
    pads: 7, coins: 10, ramps: 4, nitros: 6, obstacles: { kind: 'moonrock', count: 14 }, hazards: [{ type: 'dust', count: 3 }],
  },
  {
    id: 'autumn', name: 'Highland Pass', tag: 'Big hills', theme: 'autumn', seed: 99,
    pts: polar((a) => 285 + 80 * Math.sin(a + 0.6) + 34 * Math.sin(3 * a + 1) + 14 * Math.sin(6 * a), (a) => 32 + 30 * Math.sin(a + 2) + 10 * Math.sin(2 * a), 56),
    hw: 9.5, shoulder: 3, bank: 0.7, maxBank: 0.14, laps: 3, ai: 1.0,
    pads: 7, coins: 10, ramps: 2, nitros: 6, obstacles: { kind: 'haybale', count: 16 }, hazards: [{ type: 'leaves', count: 4 }],
  },
  {
    id: 'sky', name: 'Rainbow Skyway', tag: 'Above the clouds', theme: 'sky', seed: 111,
    pts: polar((a) => 300 + 95 * Math.cos(2 * a) + 28 * Math.sin(3 * a + 1), (a) => 13 * Math.sin(2 * a + 1) + 7 * Math.sin(3 * a), 60),
    hw: 13, shoulder: 0.5, bank: 1.0, maxBank: 0.3, laps: 3, ai: 1.02,
    pads: 10, coins: 12, ramps: 3, nitros: 6, obstacles: { kind: 'star', count: 12 }, hazards: [],
  },
];
