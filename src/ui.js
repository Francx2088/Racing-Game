// DOM layer: boot/race loading screens, home, track select, garage, HUD, pause and results.
import { CARS, PAINTS } from './cars.js';
import { LEVELS } from './levels.js';
import THEMES from './themes.js';
import { UPGRADES, MAX_UPGRADE, upgradesFor, upgradeCost, ratings } from './progress.js';
import { fmtTime, ordinal } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const SVG = {
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  tri: '<svg viewBox="0 0 24 24"><path d="M16 4L6 12l10 8z"/></svg>',
};
const TIPS = [
  'Yellow pads are the only way to boost. Line up early and hit them dead centre.',
  'Every gap has a boost pad before it. Take it, or you will drop into the clouds.',
  'Fall off and you restart from the last checkpoint gate, so keep your speed up.',
  'Crosswind zones push you sideways: steer into the wind before you reach them.',
  'Full lock at speed swings the tail out: lift off in the tight bends and power out.',
  'Coins come from how you drive: podiums, overtakes, knockouts, pads and clean runs.',
  'Shove a rival off an open edge for a knockout bonus. They can do the same to you.',
  'Pads in a row stack: every pad you chain adds more boost.',
  'Hammers swing high at the ends of their arc. Sweepers spin: time your gap.',
  'Rivals get faster on every track. Spend coins in the Garage on Engine and Turbo.',
];
const stars = (n) => [1, 2, 3].map((k) => `<i class="${n >= k ? '' : 'off'}"></i>`).join('');

// phone: swipe steering · tablet: on-screen buttons · desktop: keyboard / gamepad. ?device= overrides.
export function detectDevice() {
  const q = new URLSearchParams(location.search).get('device');
  if (['phone', 'tablet', 'desktop'].includes(q)) return q;
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const coarse = matchMedia('(pointer: coarse)').matches, mouse = matchMedia('(any-pointer: fine)').matches && matchMedia('(any-hover: hover)').matches;
  if (!touch || (!coarse && mouse)) return 'desktop';
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet';
}

export class UI {
  constructor(root, h) {
    this.root = root; this.h = h; this.touch = { left: false, right: false, brake: false, steer: null };
    this.setDevice(detectDevice());
    root.innerHTML = `
      <div class="loader" id="boot"><div class="inner">
        <div class="brand"><span class="mark">TURBO <b>RACING</b></span><span class="sub">SKY CIRCUIT</span></div>
        <div class="loadbar"><i></i></div><div class="tip" id="boot-tip">Loading cars…</div></div></div>
      <div class="loader race-load hidden" id="raceload"></div>
      <section class="screen hidden" id="home"></section>
      <section class="screen hidden" id="tracks"></section>
      <section class="screen hidden" id="garage"></section>
      <div id="hud" class="hidden"></div>
      <div id="pause" class="overlay hidden"></div>
      <section class="screen hidden" id="results"></section>
      <div class="toasts-global" id="gtoasts"></div>`;
    this.screens = ['home', 'tracks', 'garage', 'results'].reduce((o, k) => ((o[k] = $('#' + k)), o), {});
    this.hud = $('#hud');
    this._buildHud();
  }

  // ---------- loading ----------
  setBoot(p, text) { $('#boot .loadbar i').style.width = Math.round(p * 100) + '%'; if (text) $('#boot-tip').textContent = text; }
  hideBoot() { const b = $('#boot'); b.classList.add('done'); setTimeout(() => b.classList.add('hidden'), 520); }
  setThumbs(paths) { this.routes = paths; }

  showRaceLoading(i, info) {
    const L = LEVELS[i], th = THEMES[L.theme], el = $('#raceload');
    el.classList.remove('hidden', 'done');
    el.innerHTML = `<div class="art" style="background:linear-gradient(160deg, ${hex(th.card[0])}, ${hex(th.card[1])} 55%, ${hex(th.card[2])})">${this.routes?.[i] || ''}</div>
      <div class="inner"><span class="eyebrow">Track ${i + 1} of ${LEVELS.length}</span><h2 class="title">${L.name}</h2>
      <div class="facts"><div>${(info.length / 1000).toFixed(1)} km <span>to the finish</span></div><div>${info.jumps} <span>${info.jumps === 1 ? 'jump' : 'jumps'}</span></div><div>${info.checkpoints} <span>checkpoints</span></div></div>
      <div class="loadbar"><i></i></div><div class="tip">${TIPS[(i + (Date.now() / 1000 | 0)) % TIPS.length]}</div></div>`;
    this.setRaceLoading(0.15);
  }
  setRaceLoading(p) { const b = $('#raceload .loadbar i'); if (b) b.style.width = Math.round(p * 100) + '%'; }
  hideRaceLoading() { const el = $('#raceload'); el.classList.add('done'); setTimeout(() => el.classList.add('hidden'), 520); }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
    this.hud.classList.toggle('hidden', name !== 'hud');
    if (name !== 'hud') $('#pause').classList.add('hidden');
    this.current = name;
  }
  soundIcon(save) { return save.sfx || save.music ? SVG.sound : SVG.mute; }

  // ---------- home ----------
  renderHome(save, i, info) {
    const L = LEVELS[i], el = this.screens.home;
    el.innerHTML = `
      <div class="bar"><div class="brand"><span class="mark">TURBO <b>RACING</b></span><span class="sub">SKY CIRCUIT</span></div>
        <div class="bar"><div class="chip"><i class="coin"></i>${save.coins}</div><button class="icon ${save.sfx || save.music ? '' : 'off'}" id="hm-snd" aria-label="Sound">${this.soundIcon(save)}</button></div></div>
      <div class="home-foot">
        <div class="next"><span class="eyebrow">Track ${i + 1} · ${L.tag}</span><h2 class="title">${L.name}</h2>
          <div class="meta">${(info.length / 1000).toFixed(1)} km · ${info.jumps} ${info.jumps === 1 ? 'jump' : 'jumps'} · 5 rivals</div></div>
        <div class="actions"><button class="btn go big" id="hm-play">Race</button><button class="btn" id="hm-garage">Garage</button><button class="btn" id="hm-tracks">Tracks</button></div>
      </div>`;
    $('#hm-play', el).onclick = () => this.h.play();
    $('#hm-garage', el).onclick = () => this.h.garage();
    $('#hm-tracks', el).onclick = () => this.h.tracks();
    $('#hm-snd', el).onclick = () => this.h.toggleSound();
  }

  // ---------- tracks ----------
  renderTracks(save, i, info, unlocked) {
    const L = LEVELS[i], th = THEMES[L.theme], rec = save.levels[L.id] || {}, el = this.screens.tracks;
    el.innerHTML = `
      <div class="bar"><button class="btn" id="tr-back">${'Back'}</button><span class="eyebrow">Choose a track</span><div class="chip"><i class="coin"></i>${save.coins}</div></div>
      <div class="carousel">
        <button class="icon arrow" id="tr-prev" aria-label="Previous track">${SVG.left}</button>
        <div class="card ${unlocked ? '' : 'locked'}">
          <div class="bg" style="background:linear-gradient(160deg, ${hex(th.card[0])}, ${hex(th.card[1])} 55%, ${hex(th.card[2])})"></div>
          ${this.routes?.[i] || ''}<span class="num">${String(i + 1).padStart(2, '0')} / ${LEVELS.length}</span>
          <span class="eyebrow">${L.tag}</span><h2 class="title">${L.name}</h2>
          <div class="stats"><span><b>${(info.length / 1000).toFixed(1)}</b> km</span><span><b>${info.jumps}</b> jumps</span><span><b>${info.checkpoints}</b> checkpoints</span>${rec.best ? `<span>Best <b>${fmtTime(rec.best)}</b></span>` : ''}</div>
          ${unlocked ? `<span class="stars">${stars(rec.stars || 0)}</span>` : '<span class="lockmsg">Finish the previous track in the top 3 to unlock</span>'}
        </div>
        <button class="icon arrow" id="tr-next" aria-label="Next track">${SVG.right}</button>
      </div>
      <div class="tracks-foot"><div class="dots">${LEVELS.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
        <button class="btn go big" id="tr-go" ${unlocked ? '' : 'disabled'}>Race</button></div>`;
    $('#tr-back', el).onclick = () => this.h.home();
    $('#tr-prev', el).onclick = () => this.h.trackPick(-1);
    $('#tr-next', el).onclick = () => this.h.trackPick(1);
    $('#tr-go', el).onclick = () => this.h.race(i);
  }

  // ---------- garage ----------
  renderGarage(save, ci, paintIdx, tab, baseHue) {
    const def = CARS[ci], owned = !!save.cars[def.id], el = this.screens.garage;
    const r = ratings(def), u = upgradesFor(def.id);
    const swatch = (p, k) => p.stock ? `<button class="sw ${k === paintIdx ? 'sel' : ''}" data-i="${k}" style="background:conic-gradient(#e33,#fd3,#3d6,#3cf,#a5f,#e33)" title="Factory colours"></button>`
      : `<button class="sw ${k === paintIdx ? 'sel' : ''}" data-i="${k}" style="background:hsl(${Math.round(p.hue * 360)} 80% 52%)" title="${p.name}"></button>`;
    const bar = (label, v) => `<span>${label}</span><span class="bar"><i style="width:${Math.min(100, v * 100).toFixed(0)}%"></i></span><span class="v">${Math.round(v * 100)}</span>`;
    const ups = UPGRADES.map((up) => {
      const cost = upgradeCost(def.id, up.id), lvl = u[up.id];
      return `<div class="up"><div class="name">${up.name}<span>${up.what}</span></div>
        <div class="pips">${Array.from({ length: MAX_UPGRADE }, (_, k) => `<i class="${k < lvl ? 'on' : ''}"></i>`).join('')}</div>
        <button class="btn" data-up="${up.id}" ${!owned || cost == null || save.coins < cost ? 'disabled' : ''}>${cost == null ? 'Maxed' : `<i class="coin"></i>${cost}`}</button></div>`;
    }).join('');
    el.innerHTML = `
      <div class="bar"><button class="btn" id="gr-back">Back</button><div class="chip"><i class="coin"></i>${save.coins}</div></div>
      <div class="garage-mid"><button class="icon arrow" id="gr-prev" aria-label="Previous car">${SVG.left}</button><button class="icon arrow" id="gr-next" aria-label="Next car">${SVG.right}</button></div>
      <div class="garage-panel">
        <div class="garage-head"><div><span class="eyebrow">${owned ? (save.car === def.id ? 'Your car' : 'Owned') : 'Locked'}</span><h2 class="title">${def.name}</h2></div>
          <div class="tabs"><button class="${tab === 'paint' ? 'on' : ''}" data-tab="paint">Paint</button><button class="${tab === 'tune' ? 'on' : ''}" data-tab="tune">Upgrades</button></div></div>
        ${tab === 'paint'
          ? `<div class="swatches">${PAINTS.map(swatch).join('')}</div>`
          : `<div class="ups">${ups}</div>`}
        <div class="statline">${bar('Speed', r.speed)}${bar('Accel', r.accel)}${bar('Handling', r.handling)}${bar('Boost', r.boost)}</div>
        <div class="garage-actions">${owned
          ? `<button class="btn go" id="gr-use" ${save.car === def.id ? 'disabled' : ''}>${save.car === def.id ? 'Selected' : 'Use this car'}</button>`
          : `<button class="btn go" id="gr-buy" ${save.coins < def.price ? 'disabled' : ''}><i class="coin"></i>${def.price} Unlock</button>`}</div>
      </div>`;
    $('#gr-back', el).onclick = () => this.h.home();
    $('#gr-prev', el).onclick = () => this.h.garageCar(-1);
    $('#gr-next', el).onclick = () => this.h.garageCar(1);
    el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => this.h.garageTab(b.dataset.tab)));
    el.querySelectorAll('.sw').forEach((b) => (b.onclick = () => this.h.garagePaint(+b.dataset.i)));
    el.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => this.h.garageUpgrade(b.dataset.up)));
    const use = $('#gr-use', el); if (use) use.onclick = () => this.h.garageSelect();
    const buy = $('#gr-buy', el); if (buy) buy.onclick = () => this.h.garageBuy();
  }

  setDevice(d) {
    this.device = d; this.isTouch = d !== 'desktop';
    document.body.classList.toggle('is-touch', this.isTouch); document.body.classList.toggle('is-phone', d === 'phone');
  }

  // ---------- HUD ----------
  _buildHud() {
    this.hud.innerHTML = `
      <div class="swipe" id="swipe"></div>
      <div class="hud-pos"><div class="p"><span id="h-pos">6</span><sup id="h-suf">th</sup><small id="h-total">/6</small></div><div class="t" id="h-time">0:00.00</div></div>
      <div class="hud-progress"><div class="rail"></div><div class="fill" id="h-fill"></div><div id="h-marks"></div><div class="flag"></div></div>
      <div class="hud-right"><canvas id="h-map" width="160" height="160"></canvas><button class="icon" id="h-pause" aria-label="Pause">${SVG.pause}</button></div>
      <div class="hud-msg" id="h-msg"></div>
      <div class="hud-toasts" id="h-toasts"></div>
      <div class="hud-wrong hidden" id="h-wrong">WRONG WAY</div>
      <div class="hint hidden" id="h-hint"></div>
      <div class="hud-speed"><div class="v" id="h-speed">0</div><div class="u">KM/H</div><div class="boost"><i id="h-boost"></i></div></div>
      <div class="touchui">
        <div class="steer" id="steer"><div class="zone l"><svg viewBox="0 0 24 24"><path d="M16 4L6 12l10 8z"/></svg></div><div class="zone r"><svg viewBox="0 0 24 24"><path d="M8 4l10 8-10 8z"/></svg></div></div>
        <div class="swipe-ind"><span>◀</span><i id="swipe-knob"></i><span>▶</span></div>
        <div class="tbtn brake" data-k="brake">BRAKE</div>
      </div>`;
    this.el = { pos: $('#h-pos'), suf: $('#h-suf'), total: $('#h-total'), time: $('#h-time'), fill: $('#h-fill'), marks: $('#h-marks'), speed: $('#h-speed'), boost: $('#h-boost'), msg: $('#h-msg'), toasts: $('#h-toasts'), wrong: $('#h-wrong'), hint: $('#h-hint'), map: $('#h-map') };
    this.mapCtx = this.el.map.getContext('2d');
    $('#h-pause').onclick = () => this.h.pause();
    this.hud.querySelectorAll('[data-k]').forEach((n) => {
      const k = n.dataset.k;
      const on = (e) => { e.preventDefault(); n.setPointerCapture?.(e.pointerId); this.touch[k] = true; n.classList.add('on'); };
      const off = () => { this.touch[k] = false; n.classList.remove('on'); };
      n.addEventListener('pointerdown', on); n.addEventListener('pointerup', off); n.addEventListener('pointercancel', off); n.addEventListener('lostpointercapture', off);
    });
    const steer = $('#steer'), zl = steer.children[0], zr = steer.children[1];
    const set = (e) => { const r = steer.getBoundingClientRect(), left = e.clientX < r.left + r.width / 2; this.touch.left = left; this.touch.right = !left; zl.classList.toggle('active', left); zr.classList.toggle('active', !left); };
    const clear = () => { this.touch.left = this.touch.right = false; zl.classList.remove('active'); zr.classList.remove('active'); };
    steer.addEventListener('pointerdown', (e) => { e.preventDefault(); steer.setPointerCapture(e.pointerId); set(e); });
    steer.addEventListener('pointermove', (e) => { if (steer.hasPointerCapture(e.pointerId)) set(e); });
    steer.addEventListener('pointerup', clear); steer.addEventListener('pointercancel', clear); steer.addEventListener('lostpointercapture', clear);
    // phone: put a finger anywhere and slide it left/right; the further you slide the harder you steer
    const sw = $('#swipe'), knob = $('#swipe-knob'); let id = null, x0 = 0;
    const range = () => Math.min(innerWidth * 0.16, 120);
    const show = (v) => { knob.style.transform = `translateX(${(v * 46).toFixed(1)}px)`; knob.classList.toggle('on', v !== 0); };
    sw.addEventListener('pointerdown', (e) => { e.preventDefault(); sw.setPointerCapture?.(e.pointerId); if (id != null) { this.touch.brake2 = true; return; } id = e.pointerId; x0 = e.clientX; this.touch.steer = 0; show(0); });
    sw.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const R = range(); let dx = e.clientX - x0;
      if (Math.abs(dx) > R) { x0 = e.clientX - Math.sign(dx) * R; dx = Math.sign(dx) * R; }
      this.touch.steer = dx / R; show(this.touch.steer);
    });
    const up = (e) => { if (e.pointerId === id) { id = null; this.touch.steer = null; show(0); } else this.touch.brake2 = false; };
    addEventListener('pointerup', up); addEventListener('pointercancel', up); sw.addEventListener('lostpointercapture', up);
  }

  initHud(track, cars) {
    this._last = {}; this.el.toasts.innerHTML = ''; this.el.msg.innerHTML = '';
    this.el.total.textContent = '/' + cars.length;
    this.track = track;
    const span = track.finishS - track.startS;
    this.el.marks.innerHTML = track.checkpoints.slice(1).map((s) => `<i class="cp" style="left:${(((s - track.startS) / span) * 100).toFixed(1)}%"></i>`).join('')
      + cars.map((c) => `<i class="car ${c.isPlayer ? 'me' : ''}" data-id="${c.id}" style="background:${hex(c.color)}"></i>`).join('');
    this.carDots = new Map([...this.el.marks.querySelectorAll('.car')].map((n) => [n.dataset.id, n]));
    // minimap base
    const b = track.bounds, w = b.maxX - b.minX, h = b.maxZ - b.minZ, S = 140 / Math.max(w, h), ox = (160 - w * S) / 2, oy = (160 - h * S) / 2;
    this.mm = { b, S, ox, oy };
    const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d');
    g.lineJoin = g.lineCap = 'round';
    for (const [s0, s1] of track.segments) {
      const path = () => { g.beginPath(); for (let i = track.idxAtS(s0); i <= track.idxAtS(s1); i += 3) { const x = ox + (track.px[i] - b.minX) * S, y = oy + (track.pz[i] - b.minZ) * S; i === track.idxAtS(s0) ? g.moveTo(x, y) : g.lineTo(x, y); } };
      g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 7; path(); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3.5; path(); g.stroke();
    }
    const end = track.pointAt(track.finishS, 0); g.fillStyle = '#ffd60a'; g.fillRect(ox + (end.x - b.minX) * S - 4, oy + (end.z - b.minZ) * S - 4, 8, 8);
    this.mmBase = c;
  }

  updateHud(s) {
    const e = this.el, L = this._last;
    if (L.pos !== s.pos) { e.pos.textContent = s.pos; e.suf.textContent = ordinal(s.pos).slice(String(s.pos).length); L.pos = s.pos; }
    e.time.textContent = fmtTime(s.time);
    const sp = Math.round(s.speed); if (L.speed !== sp) { e.speed.textContent = sp; L.speed = sp; }
    e.boost.style.width = Math.round(s.boost * 100) + '%';
    e.wrong.classList.toggle('hidden', !s.wrongWay);
    const T = this.track, span = T.finishS - T.startS, pct = (v) => Math.max(0, Math.min(100, ((v - T.startS) / span) * 100)).toFixed(1) + '%';
    for (const c of s.cars) { const n = this.carDots.get(c.id); if (n) n.style.left = pct(c.prog); if (c.me) e.fill.style.width = pct(c.prog); }
    const g = this.mapCtx; g.clearRect(0, 0, 160, 160); g.drawImage(this.mmBase, 0, 0);
    const { b, S, ox, oy } = this.mm;
    for (const c of s.cars) {
      const x = ox + (c.x - b.minX) * S, y = oy + (c.z - b.minZ) * S;
      g.beginPath(); g.fillStyle = c.me ? '#fff' : hex(c.color); g.arc(x, y, c.me ? 5.5 : 3.5, 0, 7); g.fill();
      if (c.me) { g.strokeStyle = '#ffd60a'; g.lineWidth = 2.5; g.stroke(); }
    }
  }
  setMsg(text, cls = '') { this.el.msg.innerHTML = text ? `<div class="count ${cls}">${text}</div>` : ''; }
  toast(text, cls = 'y') {
    const host = this.current === 'hud' ? this.el.toasts : $('#gtoasts');
    const t = document.createElement('div'); t.className = 'toast ' + cls; t.textContent = text; host.appendChild(t);
    while (host.children.length > 3) host.firstChild.remove();
    setTimeout(() => t.remove(), 1500);
  }
  setHint(html) { this.el.hint.classList.toggle('hidden', !html); if (html) this.el.hint.innerHTML = html; }

  // ---------- pause ----------
  showPause(save) {
    const el = $('#pause'); el.classList.remove('hidden');
    el.innerHTML = `<div class="dialog"><h2 class="title">Paused</h2>
      <button class="btn go" id="p-resume">Resume</button><button class="btn" id="p-restart">Restart race</button><button class="btn" id="p-quit">Quit to menu</button>
      <div class="row"><button class="btn ${save.music ? '' : 'off'}" id="p-music">Music ${save.music ? 'on' : 'off'}</button><button class="btn" id="p-sfx">Sound ${save.sfx ? 'on' : 'off'}</button></div></div>`;
    $('#p-resume', el).onclick = () => this.h.resume(); $('#p-restart', el).onclick = () => this.h.restart(); $('#p-quit', el).onclick = () => this.h.quit();
    $('#p-music', el).onclick = () => { this.h.toggleMusic(); this.showPause(save); };
    $('#p-sfx', el).onclick = () => { this.h.toggleSfx(); this.showPause(save); };
  }
  hidePause() { $('#pause').classList.add('hidden'); }

  // ---------- results ----------
  showResults(r) {
    const el = this.screens.results; this.show('results');
    const list = r.order.map((c, k) => `<div class="${c.isPlayer ? 'me' : ''}"><span>${k + 1}. ${c.name}</span><span>${c.finished ? fmtTime(c.finishTime) : 'DNF'}</span></div>`).join('');
    const rew = r.rewards.rows.map(([a, b]) => `<div><span>${a}</span><span>+${b}</span></div>`).join('');
    const suf = ordinal(r.place).slice(String(r.place).length);
    el.innerHTML = `<div class="res">
      <div class="res-top"><div><span class="eyebrow">${r.level.name}</span><div class="place">${r.place}<sup>${suf}</sup></div><span class="stars">${stars(r.rewards.stars)}</span></div>
        <div class="meta">Time <b style="color:var(--text)">${fmtTime(r.time)}</b>${r.newRecord ? ' · <span class="note">New best</span>' : ''}</div></div>
      <div class="res-grid"><div class="box rows">${list}</div><div class="box rows">${rew}<div class="total"><span>Total</span><span><i class="coin" style="display:inline-block;vertical-align:-2px"></i> +${r.rewards.total}</span></div></div></div>
      ${r.note ? `<div class="note">${r.note}</div>` : ''}
      <div class="res-actions"><button class="btn" id="r-menu">Menu</button><button class="btn" id="r-garage">Garage</button><button class="btn" id="r-retry">Retry</button>${r.hasNext ? '<button class="btn go big" id="r-next">Next track</button>' : ''}</div></div>`;
    $('#r-menu', el).onclick = () => this.h.quit(); $('#r-retry', el).onclick = () => this.h.restart(); $('#r-garage', el).onclick = () => this.h.garage();
    const n = $('#r-next', el); if (n) n.onclick = () => this.h.next();
  }
}
