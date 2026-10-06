// The 10 courses. Each is one long point-to-point road generated from `course`;
// `theme` picks the sky world (themes.js). `ai` scales rival top speed (1.0 = 65 m/s).
export const LEVELS = [
  {
    id: 'golden', name: 'Sunset Summit', tag: 'Golden hour above the clouds', theme: 'golden', seed: 11,
    course: { length: 4200, twist: 0.35, hills: 8, jumps: 1, hairpins: 0 },
    hw: 11, shoulder: 3.5, bank: 0.8, maxBank: 0.16, ai: 0.97,
    pads: 2.2, coins: 3, kickers: 1, obstacles: { kind: 'cone', perKm: 2, moving: 0 }, hazards: [],
  },
  {
    id: 'alps', name: 'Alpine Ridge', tag: 'Weaving between the peaks', theme: 'alps', seed: 44,
    course: { length: 4800, twist: 0.45, hills: 16, jumps: 1, hairpins: 1 },
    hw: 10.5, shoulder: 3.5, bank: 0.9, maxBank: 0.18, ai: 1.0,
    pads: 2.2, coins: 3, kickers: 1, obstacles: { kind: 'rock', perKm: 2.2, moving: 0 }, hazards: [{ type: 'ice', count: 4 }, { type: 'wind', count: 2, force: 8 }],
  },
  {
    id: 'storm', name: 'Thunderhead', tag: 'Racing the storm', theme: 'storm', seed: 22,
    course: { length: 5000, twist: 0.5, hills: 10, jumps: 2, hairpins: 1 },
    hw: 10, shoulder: 3.5, bank: 0.8, maxBank: 0.16, ai: 1.03,
    pads: 2.2, coins: 3, kickers: 1, obstacles: { kind: 'barrel', perKm: 2.4, moving: 0.1 }, hazards: [{ type: 'wet', count: 5 }, { type: 'wind', count: 3, force: 11 }],
  },
  {
    id: 'city', name: 'Midnight Metropolis', tag: 'High above the city lights', theme: 'city', seed: 33,
    course: { length: 5200, twist: 0.6, hills: 8, jumps: 2, hairpins: 2 },
    hw: 9.5, shoulder: 3, bank: 0.6, maxBank: 0.12, ai: 1.06,
    pads: 2.4, coins: 3, kickers: 1, obstacles: { kind: 'bollard', perKm: 2.6, moving: 0.2 }, hazards: [{ type: 'oil', count: 4 }],
  },
  {
    id: 'arctic', name: 'Aurora Drift', tag: 'Ice floes under the aurora', theme: 'arctic', seed: 55,
    course: { length: 5500, twist: 0.65, hills: 10, jumps: 2, hairpins: 2 },
    hw: 10, shoulder: 3, bank: 0.9, maxBank: 0.18, ai: 1.09,
    pads: 2.2, coins: 3, kickers: 1, obstacles: { kind: 'iceblock', perKm: 2.6, moving: 0.25 }, hazards: [{ type: 'ice', count: 6 }, { type: 'wind', count: 2, force: 9 }],
  },
  {
    id: 'ember', name: 'Ember Skies', tag: 'Volcanic sunset', theme: 'ember', seed: 66,
    course: { length: 5800, twist: 0.7, hills: 18, jumps: 3, hairpins: 2 },
    hw: 9.5, shoulder: 3, bank: 0.9, maxBank: 0.2, ai: 1.12,
    pads: 2.2, coins: 3, kickers: 1, obstacles: { kind: 'rock', perKm: 2.8, moving: 0.3 }, hazards: [{ type: 'ash', count: 5 }],
  },
  {
    id: 'isles', name: 'Paradise Isles', tag: 'Floating island paradise', theme: 'isles', seed: 77,
    course: { length: 6100, twist: 0.72, hills: 14, jumps: 3, hairpins: 2 },
    hw: 10, shoulder: 3, bank: 0.9, maxBank: 0.18, ai: 1.15,
    pads: 2.4, coins: 3, kickers: 2, obstacles: { kind: 'crate', perKm: 2.8, moving: 0.3 }, hazards: [{ type: 'wet', count: 4 }, { type: 'wind', count: 2, force: 10 }],
  },
  {
    id: 'stratos', name: 'Stratosphere', tag: 'The edge of space', theme: 'stratos', seed: 88,
    course: { length: 6400, twist: 0.75, hills: 14, jumps: 4, hairpins: 2 },
    hw: 10.5, shoulder: 3.5, bank: 0.8, maxBank: 0.16, ai: 1.18, gravity: 0.55,
    pads: 2.4, coins: 3, kickers: 2, obstacles: { kind: 'debris', perKm: 3, moving: 0.35 }, hazards: [{ type: 'ice', count: 3 }],
  },
  {
    id: 'mesa', name: 'Sandstone Spires', tag: 'Dawn over the floating spires', theme: 'mesa', seed: 99,
    course: { length: 6800, twist: 0.8, hills: 20, jumps: 4, hairpins: 3 },
    hw: 9.5, shoulder: 3, bank: 0.9, maxBank: 0.18, ai: 1.21,
    pads: 2.4, coins: 3, kickers: 2, obstacles: { kind: 'rock', perKm: 3, moving: 0.4 }, hazards: [{ type: 'sand', count: 5 }, { type: 'wind', count: 3, force: 12 }],
  },
  {
    id: 'heaven', name: 'Cloud Kingdom', tag: 'The ultimate skyway', theme: 'heaven', seed: 111,
    course: { length: 7400, twist: 0.85, hills: 18, jumps: 5, hairpins: 3 },
    hw: 11, shoulder: 3, bank: 1.0, maxBank: 0.24, ai: 1.24,
    pads: 2.6, coins: 3, kickers: 2, obstacles: { kind: 'cone', perKm: 3, moving: 0.45 }, hazards: [{ type: 'wet', count: 3 }, { type: 'wind', count: 4, force: 13 }],
  },
];
