// The 10 sky courses. Each is one long point-to-point road generated from `course`;
// `theme` picks the world (themes.js). `ai` scales rival top speed (1.0 = 100 m/s = 360 km/h).
export const LEVELS = [
  {
    id: 'dawn', name: 'Dawn Ascent', tag: 'First light over the cloud sea', theme: 'dawn', seed: 101,
    course: { length: 8000, twist: 0.34, hills: 35, jumps: 1, bowls: 0 },
    hw: 10.5, shoulder: 2.5, bank: 1, maxBank: 0.22, ai: 0.92,
    splits: 1, pads: 1.4, kickers: 1, obstacles: { kinds: ['crates'], perKm: 1.1 }, hazards: [],
  },
  {
    id: 'glacier', name: 'Glacier Spires', tag: 'Ice needles and cold sun', theme: 'glacier', seed: 202,
    course: { length: 8600, twist: 0.41, hills: 45, jumps: 1, bowls: 1 },
    hw: 10.5, shoulder: 2.5, bank: 1, maxBank: 0.23, ai: 0.96,
    splits: 2, pads: 1.5, kickers: 1, obstacles: { kinds: ['crates', 'slider'], perKm: 1.3 }, hazards: [{ type: 'ice', count: 4 }, { type: 'wind', count: 2, force: 13 }],
  },
  {
    id: 'storm', name: 'Storm Runner', tag: 'Lightning, rain and airships', theme: 'storm', seed: 303,
    course: { length: 9100, twist: 0.45, hills: 40, jumps: 2, bowls: 1 },
    hw: 10, shoulder: 2.5, bank: 1, maxBank: 0.24, ai: 1.0,
    splits: 2, pads: 1.5, kickers: 1, obstacles: { kinds: ['crates', 'slider', 'hammer'], perKm: 1.5 }, hazards: [{ type: 'wet', count: 5 }, { type: 'wind', count: 3, force: 16 }],
  },
  {
    id: 'neon', name: 'Neon Skyline', tag: 'Night run above the towers', theme: 'neon', seed: 404,
    course: { length: 9600, twist: 0.49, hills: 35, jumps: 2, bowls: 2 },
    hw: 10, shoulder: 2.5, bank: 1, maxBank: 0.25, ai: 1.03,
    splits: 2, pads: 1.7, kickers: 1, obstacles: { kinds: ['slider', 'sweeper', 'crates'], perKm: 1.6 }, hazards: [{ type: 'oil', count: 3 }],
  },
  {
    id: 'coral', name: 'Coral Heights', tag: 'Floating reefs at sunset', theme: 'coral', seed: 505,
    course: { length: 10100, twist: 0.52, hills: 50, jumps: 2, bowls: 1 },
    hw: 10, shoulder: 2.5, bank: 1, maxBank: 0.26, ai: 1.06,
    splits: 3, pads: 1.6, kickers: 2, obstacles: { kinds: ['crates', 'hammer', 'slider'], perKm: 1.7 }, hazards: [{ type: 'wet', count: 3 }, { type: 'wind', count: 2, force: 15 }],
  },
  {
    id: 'magma', name: 'Magma Drift', tag: 'Molten rocks in orbit', theme: 'magma', seed: 606,
    course: { length: 10600, twist: 0.54, hills: 60, jumps: 3, bowls: 2 },
    hw: 9.5, shoulder: 2.5, bank: 1, maxBank: 0.27, ai: 1.1,
    splits: 3, pads: 1.6, kickers: 2, obstacles: { kinds: ['sweeper', 'hammer', 'crates'], perKm: 1.8 }, hazards: [{ type: 'ash', count: 4 }],
  },
  {
    id: 'aurora', name: 'Aurora Rift', tag: 'Polar night, crystal rings', theme: 'aurora', seed: 707,
    course: { length: 11100, twist: 0.56, hills: 50, jumps: 3, bowls: 2 },
    hw: 9.5, shoulder: 2.5, bank: 1, maxBank: 0.27, ai: 1.13,
    splits: 3, pads: 1.7, kickers: 2, obstacles: { kinds: ['slider', 'sweeper', 'crates'], perKm: 1.9 }, hazards: [{ type: 'ice', count: 5 }, { type: 'wind', count: 2, force: 15 }],
  },
  {
    id: 'orbit', name: 'Orbital Highway', tag: 'The edge of space', theme: 'orbit', seed: 808,
    course: { length: 11600, twist: 0.58, hills: 55, jumps: 4, bowls: 2 },
    hw: 10, shoulder: 2.5, bank: 1, maxBank: 0.28, ai: 1.16, gravity: 0.6,
    splits: 3, pads: 1.7, kickers: 3, obstacles: { kinds: ['sweeper', 'slider', 'hammer', 'crates'], perKm: 2 }, hazards: [{ type: 'ice', count: 3 }],
  },
  {
    id: 'dune', name: 'Sandstorm Mesa', tag: 'Gliders over the red spires', theme: 'dune', seed: 909,
    course: { length: 12100, twist: 0.61, hills: 65, jumps: 4, bowls: 3 },
    hw: 9.5, shoulder: 2.5, bank: 1, maxBank: 0.29, ai: 1.19,
    splits: 4, pads: 1.8, kickers: 3, obstacles: { kinds: ['hammer', 'sweeper', 'slider', 'crates'], perKm: 2.1 }, hazards: [{ type: 'sand', count: 4 }, { type: 'wind', count: 4, force: 18 }],
  },
  {
    id: 'crown', name: 'Celestial Crown', tag: 'The final skyway', theme: 'crown', seed: 1010,
    course: { length: 13000, twist: 0.66, hills: 70, jumps: 5, bowls: 3 },
    hw: 10, shoulder: 2.5, bank: 1, maxBank: 0.30, ai: 1.22,
    splits: 4, pads: 1.9, kickers: 3, obstacles: { kinds: ['sweeper', 'hammer', 'slider', 'crates'], perKm: 2.3 }, hazards: [{ type: 'wet', count: 3 }, { type: 'wind', count: 4, force: 18 }],
  },
];
