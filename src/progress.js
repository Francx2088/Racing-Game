// Player progress: save data, track unlocking, car upgrades and race rewards.
import platform from './platform.js';
import { CARS } from './cars.js';
import { LEVELS } from './levels.js';

// While the game is being play-tested every track is open. Set to false to unlock tracks by
// finishing on the podium of the previous one.
export const ALL_TRACKS_OPEN = true;

export const UPGRADES = [
  { id: 'engine', name: 'Engine', what: 'Top speed', step: 0.045 },
  { id: 'turbo', name: 'Turbo', what: 'Acceleration', step: 0.07 },
  { id: 'tyres', name: 'Tyres', what: 'Grip and steering', step: 0.05 },
  { id: 'boost', name: 'Boost', what: 'Boost pad power', step: 0.15 },
];
export const MAX_UPGRADE = 5;
const BASE_COST = [150, 300, 550, 850, 1300];
const TIER = { gr86: 1, gt4: 1.3, r35: 1.6, z06: 2 };

const defaults = () => ({ v: 2, coins: 300, cars: { gr86: true }, car: 'gr86', paints: {}, ups: {}, levels: {}, sfx: true, music: true, runs: 0 });

export const save = Object.assign(defaults(), platform.loadSave() || {});
if (!save.v || save.v < 2) { save.v = 2; save.ups = save.ups || {}; }
export const persist = () => platform.saveData(save);

export const isUnlocked = (i) => ALL_TRACKS_OPEN || i === 0 || (save.levels[LEVELS[i - 1].id]?.stars || 0) >= 1;
export const nextLevelIndex = () => { let i = 0; while (i < LEVELS.length - 1 && (save.levels[LEVELS[i].id]?.stars || 0) >= 1) i++; return i; };

export const upgradesFor = (carId) => (save.ups[carId] = save.ups[carId] || { engine: 0, turbo: 0, tyres: 0, boost: 0 });
export const upgradeCost = (carId, upId) => { const lvl = upgradesFor(carId)[upId]; return lvl >= MAX_UPGRADE ? null : Math.round(BASE_COST[lvl] * (TIER[carId] || 1) / 10) * 10; };
export function buyUpgrade(carId, upId) {
  const cost = upgradeCost(carId, upId);
  if (cost == null || save.coins < cost) return false;
  save.coins -= cost; upgradesFor(carId)[upId]++; persist();
  return true;
}

// Effective physics for a car with its upgrades applied.
export function carSetup(def) {
  const u = upgradesFor(def.id), p = def.phys;
  return {
    phys: { ...p, vmax: p.vmax * (1 + 0.045 * u.engine), acc: p.acc * (1 + 0.07 * u.turbo), turn: p.turn * (1 + 0.04 * u.tyres), grip: 1 + 0.06 * u.tyres },
    boostMul: 1 + 0.15 * u.boost,
  };
}
// 0..1 ratings for the garage bars (normalised against the fastest possible car)
export function ratings(def) {
  const { phys, boostMul } = carSetup(def);
  return { speed: (phys.vmax - 80) / 80, accel: phys.acc / 1.55, handling: phys.turn * phys.grip / 1.55, boost: boostMul / 1.75 };
}

// Coins are earned from how the race was driven, not picked up on the road.
export function raceRewards(race, levelIndex) {
  const p = race.player, place = p.place, st = race.stats, k = 1 + levelIndex * 0.18;
  const bonus = Math.round(([0, 320, 220, 160, 110, 80, 60][place] || 60) * k);
  const kmh = Math.round(st.maxSpeed * 3.6);
  const rows = [[`Finished ${place}${['th', 'st', 'nd', 'rd'][place < 4 ? place : 0]}`, bonus]];
  if (st.overtakes) rows.push([`Overtakes (${st.overtakes})`, Math.min(st.overtakes, 20) * 8]);
  if (st.knockouts) rows.push([`Knockouts (${st.knockouts})`, st.knockouts * 40]);
  if (st.boosts) rows.push([`Boost pads (${st.boosts})`, st.boosts * 4]);
  if (kmh > 380) rows.push([`Top speed ${kmh} km/h`, Math.round((kmh - 380) / 2)]);
  if (st.falls === 0) rows.push(['No falls', 60]);
  if (st.hits === 0) rows.push(['No obstacle hits', 40]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  return { rows, total, stars: place === 1 ? 3 : place === 2 ? 2 : place === 3 ? 1 : 0 };
}

export { CARS };
