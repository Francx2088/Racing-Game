// DOM user interface: menus, HUD, overlays and touch controls.
import { CARS, PAINTS } from './cars.js';
import { LEVELS } from './levels.js';
import THEMES from './themes.js';
import { Track } from './track.js';
import { fmtTime, ordinal, hex } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);
const hexStr = (n) => '#' + n.toString(16).padStart(6, '0');

export class UI {
  constructor(root, h) {
    this.root = root; this.h = h; this.touch = { left: false, right: false, nitro: false, drift: false, brake: false };
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (this.isTouch) document.body.classList.add('is-touch');
    root.innerHTML = `
      <div id="loading"><div class="logo"><span class="t1">TURBO</span><span class="t2">RAC<b>I</b>NG</span></div><div class="loadbar"><i></i></div><div class="tagline" id="loadtxt">Warming up engines…</div></div>
      <section class="screen hidden" id="screen-title"></section>
      <section class="screen hidden" id="screen-garage"></section>
      <section class="screen hidden" id="screen-levels"></section>
      <div id="hud" class="hidden"></div>
      <section class="screen overlay hidden" id="screen-pause"></section>
      <section class="screen hidden" id="screen-results"></section>`;
    this.screens = { title: $('#screen-title'), garage: $('#screen-garage'), levels: $('#screen-levels'), pause: $('#screen-pause'), results: $('#screen-results') };
    this.hud = $('#hud');
    this._buildHud();
    this.thumbs = LEVELS.map((L) => { const t = new Track(L); return this._outline(t); });
  }

  setLoading(p, text) { $('.loadbar i', this.root).style.width = Math.round(p * 100) + '%'; if (text) $('#loadtxt').textContent = text; }
  hideLoading() { const l = $('#loading'); l.classList.add('done'); setTimeout(() => (l.style.display = 'none'), 450); }
  showBusy(text) { const l = $('#loading'); l.style.display = 'flex'; l.classList.remove('done'); $('#loadtxt').textContent = text || 'Loading…'; $('.loadbar i').style.width = '60%'; }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) { if (k === 'pause') continue; el.classList.toggle('hidden', k !== name); }
    this.hud.classList.toggle('hidden', name !== 'hud');
    if (name !== 'hud') { this.screens.pause.classList.add('hidden'); }
    this.current = name;
  }

  // ---------- TITLE ----------
  renderTitle(save, nextLevel) {
    const el = this.screens.title;
    el.innerHTML = `
      <div class="topbar"><div class="pill"><i class="coin"></i><b id="t-coins">${save.coins}</b></div><div class="row"><button class="iconbtn" id="t-snd" title="Sound">${save.sfx || save.music ? '🔊' : '🔇'}</button></div></div>
      <div class="logo"><span class="t1">TURBO</span><span class="t2">RAC<b>I</b>NG</span></div>
      <div class="menu-bottom">
        <button class="btn primary big pulse" id="t-play"><span>▶ Tap to Race</span></button>
        <div class="row"><button class="btn cyan" id="t-garage"><span>🚗 Garage</span></button><button class="btn" id="t-levels"><span>🏁 Tracks</span></button></div>
        <div class="tagline">${LEVELS[nextLevel].name} · Track ${nextLevel + 1} of ${LEVELS.length}</div>
      </div>`;
    $('#t-play', el).onclick = () => this.h.play();
    $('#t-garage', el).onclick = () => this.h.garage();
    $('#t-levels', el).onclick = () => this.h.levels();
    $('#t-snd', el).onclick = () => this.h.toggleSound();
  }

  // ---------- GARAGE ----------
  renderGarage(save, idx, paintIdx) {
    const el = this.screens.garage, def = CARS[idx], owned = !!save.cars[def.id];
    const st = def.stats;
    const bar = (n) => `<div class="bar"><i style="width:${n * 20}%"></i></div>`;
    const sw = PAINTS.map((p, i) => p.stock ? `<div class="sw stock ${i === paintIdx ? 'sel' : ''}" data-i="${i}" title="Stock">★</div>` : `<div class="sw ${i === paintIdx ? 'sel' : ''}" data-i="${i}" style="background:linear-gradient(135deg, ${hexStr(p.c1)} 55%, ${hexStr(p.c2)} 55%)" title="${p.name}"></div>`).join('');
    el.innerHTML = `
      <div class="topbar"><button class="btn small" id="g-back"><span>◀ Back</span></button><div class="pill"><i class="coin"></i><b>${save.coins}</b></div></div>
      <div class="garage-mid"><button class="iconbtn arrow" id="g-prev">◀</button><button class="iconbtn arrow" id="g-next">▶</button></div>
      <div class="panel car-info">
        <div class="car-name">${def.name}</div>
        <div class="stats"><span>SPEED</span>${bar(st.speed)}<span>ACCEL</span>${bar(st.accel)}<span>HANDLING</span>${bar(st.handling)}<span>DRIFT</span>${bar(st.drift)}</div>
        <div class="swatches">${sw}</div>
        <div class="row" style="justify-content:center">
          <button class="btn small" id="g-rand"><span>🎲 Surprise paint</span></button>
          ${owned ? `<button class="btn primary" id="g-race"><span>${save.car === def.id ? '✔ Selected' : 'Select'}</span></button>` : `<button class="btn gold" id="g-buy" ${save.coins < def.price ? 'disabled' : ''}><span>Unlock · ${def.price} <i class="coin"></i></span></button>`}
        </div>
      </div>`;
    $('#g-back', el).onclick = () => this.h.back();
    $('#g-prev', el).onclick = () => this.h.garageCar(-1);
    $('#g-next', el).onclick = () => this.h.garageCar(1);
    $('#g-rand', el).onclick = () => this.h.garagePaint(-1);
    el.querySelectorAll('.sw').forEach((s) => (s.onclick = () => this.h.garagePaint(+s.dataset.i)));
    const race = $('#g-race', el); if (race) race.onclick = () => this.h.garageSelect();
    const buy = $('#g-buy', el); if (buy) buy.onclick = () => this.h.garageBuy();
  }

  // ---------- LEVELS ----------
  renderLevels(save) {
    const el = this.screens.levels;
    const cards = LEVELS.map((L, i) => {
      const th = THEMES[L.theme], rec = save.levels[L.id] || {}, unlocked = this.h.isUnlocked(i);
      const g = `linear-gradient(135deg, ${hexStr(th.card[0])}, ${hexStr(th.card[1])} 55%, ${hexStr(th.card[2])})`;
      const stars = [1, 2, 3].map((n) => `<span class="${(rec.stars || 0) >= n ? '' : 'off'}">★</span>`).join('');
      return `<div class="card ${unlocked ? '' : 'locked'}" data-i="${i}" style="background:${g}">
        ${this.thumbs[i]}
        <div><div class="num">${String(i + 1).padStart(2, '0')}</div></div>
        <div><div class="nm">${L.name}</div><div class="tg">${L.tag}</div><div class="stars">${stars}</div><div class="best">${rec.best ? '⏱ ' + fmtTime(rec.best) : ''}</div></div>
        ${unlocked ? '' : '<div class="lock">🔒</div>'}</div>`;
    }).join('');
    el.innerHTML = `
      <div class="topbar"><button class="btn small" id="l-back"><span>◀ Back</span></button><div class="levels-title">Choose Your Track</div><div class="pill"><i class="coin"></i><b>${save.coins}</b></div></div>
      <div class="level-grid">${cards}</div>`;
    $('#l-back', el).onclick = () => this.h.back();
    el.querySelectorAll('.card').forEach((c) => (c.onclick = () => { const i = +c.dataset.i; if (this.h.isUnlocked(i)) this.h.race(i); else this.toast('Finish the previous track in the top 3 to unlock!', 'red'); }));
  }
  _outline(t) {
    const b = t.bounds, w = b.maxX - b.minX, hh = b.maxZ - b.minZ, S = 100 / Math.max(w, hh), ox = (100 - w * S) / 2, oy = (100 - hh * S) / 2;
    let d = ''; for (let i = 0; i < t.N; i += 5) d += (i ? 'L' : 'M') + (ox + (t.px[i] - b.minX) * S).toFixed(1) + ' ' + (oy + (t.pz[i] - b.minZ) * S).toFixed(1);
    return `<svg viewBox="0 0 100 100"><path d="${d}Z" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="7" stroke-linejoin="round"/><path d="${d}Z" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/></svg>`;
  }

  // ---------- HUD ----------
  _buildHud() {
    this.hud.innerHTML = `
      <div class="hud-pos"><div class="p"><span id="h-pos">6</span><small>/6</small></div><div class="l">LAP <b id="h-lap">1/3</b></div></div>
      <div class="hud-board" id="h-board"></div>
      <div class="hud-time"><div class="big" id="h-time">0:00.00</div><div class="sm"><span id="h-best">BEST --:--.--</span> &nbsp;·&nbsp; <i class="coin"></i> <b id="h-coins">0</b></div></div>
      <div class="hud-right"><canvas id="h-map" width="170" height="170"></canvas><button class="iconbtn" id="h-pause">❚❚</button></div>
      <div class="hud-msg" id="h-msg"></div>
      <div class="hud-toasts" id="h-toasts"></div>
      <div class="hud-wrong hidden" id="h-wrong">⟲ WRONG WAY</div>
      <div class="hint hidden" id="h-hint"></div>
      <div class="hud-speed"><div class="drift-meter" id="h-drift"><i></i><i></i><i></i></div><div class="v"><span id="h-speed">0</span></div><div class="u">KM/H</div><div class="meter" id="h-nitro"><i></i></div></div>
      <div class="touchui" id="touch">
        <div class="steer" id="steer"><div class="zone l">◀</div><div class="zone r">▶</div></div>
        <div class="tbtn nitro" data-k="nitro"><span>NITRO</span></div><div class="tbtn drift" data-k="drift"><span>DRIFT</span></div><div class="tbtn brake" data-k="brake"><span>BRAKE</span></div>
      </div>`;
    this.el = { pos: $('#h-pos'), total: $('.hud-pos small'), lap: $('#h-lap'), time: $('#h-time'), best: $('#h-best'), coins: $('#h-coins'), speed: $('#h-speed'), nitro: $('#h-nitro'), drift: $('#h-drift'), board: $('#h-board'), msg: $('#h-msg'), toasts: $('#h-toasts'), wrong: $('#h-wrong'), hint: $('#h-hint'), map: $('#h-map') };
    this.mapCtx = this.el.map.getContext('2d');
    $('#h-pause').onclick = () => this.h.pause();
    // touch handling
    const press = (k, v) => { this.touch[k] = v; };
    this.hud.querySelectorAll('#touch [data-k]').forEach((n) => {
      const k = n.dataset.k;
      const on = (e) => { e.preventDefault(); n.setPointerCapture && n.setPointerCapture(e.pointerId); press(k, true); n.classList.add('on'); };
      const off = () => { press(k, false); n.classList.remove('on'); };
      n.addEventListener('pointerdown', on); n.addEventListener('pointerup', off); n.addEventListener('pointercancel', off); n.addEventListener('lostpointercapture', off);
    });
    // steering pad: slide between left/right without lifting the thumb
    const steer = $('#steer'), zl = steer.children[0], zr = steer.children[1];
    const setSteer = (e) => { const r = steer.getBoundingClientRect(), left = e.clientX < r.left + r.width / 2; this.touch.left = left; this.touch.right = !left; zl.classList.toggle('active', left); zr.classList.toggle('active', !left); };
    const clear = () => { this.touch.left = this.touch.right = false; zl.classList.remove('active'); zr.classList.remove('active'); };
    steer.addEventListener('pointerdown', (e) => { e.preventDefault(); steer.setPointerCapture(e.pointerId); setSteer(e); });
    steer.addEventListener('pointermove', (e) => { if (steer.hasPointerCapture(e.pointerId)) setSteer(e); });
    steer.addEventListener('pointerup', clear); steer.addEventListener('pointercancel', clear); steer.addEventListener('lostpointercapture', clear);
  }
  initHud(track, total, lapsTotal, cars) {
    this.el.total.textContent = '/' + total; this.lapsTotal = lapsTotal; this._hudLast = {}; this.el.toasts.innerHTML = ''; this.el.msg.innerHTML = '';
    // minimap base
    const b = track.bounds, w = b.maxX - b.minX, h = b.maxZ - b.minZ, S = 150 / Math.max(w, h), ox = (170 - w * S) / 2, oy = (170 - h * S) / 2;
    this.mm = { b, S, ox, oy };
    const c = document.createElement('canvas'); c.width = c.height = 170; const g = c.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); for (let i = 0; i <= track.N; i += 3) { const j = i % track.N; const x = ox + (track.px[j] - b.minX) * S, y = oy + (track.pz[j] - b.minZ) * S; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 9; path(); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 5; path(); g.stroke();
    const sx = ox + (track.px[0] - b.minX) * S, sy = oy + (track.pz[0] - b.minZ) * S; g.fillStyle = '#34ff9a'; g.beginPath(); g.arc(sx, sy, 4.5, 0, 7); g.fill();
    this.mmBase = c;
    this.el.board.innerHTML = '';
    this.cars = cars;
  }
  updateHud(s) {
    const e = this.el, L = this._hudLast;
    if (L.pos !== s.pos) { e.pos.textContent = s.pos; L.pos = s.pos; }
    const lapTxt = Math.min(s.lap, s.laps) + '/' + s.laps; if (L.lap !== lapTxt) { e.lap.textContent = lapTxt; L.lap = lapTxt; }
    e.time.textContent = fmtTime(s.time);
    const bt = 'BEST ' + fmtTime(s.best); if (L.best !== bt) { e.best.textContent = bt; L.best = bt; }
    if (L.coins !== s.coins) { e.coins.textContent = s.coins; L.coins = s.coins; }
    const sp = Math.round(s.speed); if (L.speed !== sp) { e.speed.textContent = sp; L.speed = sp; }
    e.nitro.firstElementChild.style.width = s.nitro + '%'; e.nitro.classList.toggle('ready', s.nitro > 99);
    e.drift.classList.toggle('on', s.drifting);
    [...e.drift.children].forEach((n, i) => { n.className = s.driftLevel > i ? 'l' + (i + 1) : ''; });
    e.wrong.classList.toggle('hidden', !s.wrongWay);
    // board
    const key = s.board.map((b) => b.name).join('|'); 
    if (L.board !== key) { L.board = key; e.board.innerHTML = s.board.map((b) => `<div class="${b.me ? 'me' : ''}"><i style="background:${b.color}"></i>${b.place}. ${b.name}</div>`).join(''); }
    // minimap
    const g = this.mapCtx; g.clearRect(0, 0, 170, 170); g.drawImage(this.mmBase, 0, 0);
    const { b, S, ox, oy } = this.mm;
    for (const c of s.cars) {
      const x = ox + (c.x - b.minX) * S, y = oy + (c.z - b.minZ) * S;
      g.beginPath(); g.fillStyle = c.me ? '#fff' : c.color; g.arc(x, y, c.me ? 6 : 4, 0, 7); g.fill();
      if (c.me) { g.strokeStyle = '#ff2bd6'; g.lineWidth = 2.5; g.stroke(); }
    }
  }
  setMsg(html, cls = '') { this.el.msg.innerHTML = html ? `<div class="count ${cls}" style="animation-name:pop">${html}</div>` : ''; }
  toast(text, cls = 'gold') {
    const host = this.current === 'hud' ? this.el.toasts : this._tmpToasts || (this._tmpToasts = Object.assign(document.createElement('div'), { className: 'hud-toasts' }), this.root.appendChild(this._tmpToasts), this._tmpToasts);
    const t = document.createElement('div'); t.className = 'toast ' + cls; t.textContent = text; host.appendChild(t);
    while (host.children.length > 3) host.firstChild.remove();
    setTimeout(() => t.remove(), 1400);
  }
  setHint(text) { this.el.hint.classList.toggle('hidden', !text); if (text) this.el.hint.innerHTML = text; }

  // ---------- PAUSE ----------
  showPause(save) {
    const el = this.screens.pause; el.classList.remove('hidden');
    el.innerHTML = `<div class="panel dialog"><h2>Paused</h2>
      <button class="btn primary" id="p-resume"><span>▶ Resume</span></button>
      <button class="btn cyan" id="p-restart"><span>↻ Restart</span></button>
      <button class="btn" id="p-quit"><span>✕ Quit to menu</span></button>
      <div class="toggles"><button class="btn small ${save.music ? '' : 'off'}" id="p-music"><span>♪ Music</span></button><button class="btn small ${save.sfx ? '' : 'off'}" id="p-sfx"><span>🔊 SFX</span></button></div></div>`;
    $('#p-resume', el).onclick = () => this.h.resume(); $('#p-restart', el).onclick = () => this.h.restart(); $('#p-quit', el).onclick = () => this.h.quit();
    $('#p-music', el).onclick = (e) => { this.h.toggleMusic(); e.currentTarget.classList.toggle('off'); }; $('#p-sfx', el).onclick = (e) => { this.h.toggleSfx(); e.currentTarget.classList.toggle('off'); };
  }
  hidePause() { this.screens.pause.classList.add('hidden'); }

  // ---------- RESULTS ----------
  showResults(r) {
    const el = this.screens.results; this.show('results');
    const list = r.order.map((c, i) => `<div class="${c.isPlayer ? 'me' : ''}"><span>${i + 1}. ${c.name}</span><span>${c.finished ? fmtTime(c.finishTime) : '—'}</span></div>`).join('');
    const rew = r.rewards.map((x) => `<div><span>${x[0]}</span><span>${x[1]}</span></div>`).join('');
    const stars = [1, 2, 3].map((n) => `<span class="${r.stars >= n ? '' : 'off'}">★</span>`).join('');
    el.innerHTML = `<div class="res">
      <div class="sub">${r.level.name.toUpperCase()}</div>
      <div class="place">${ordinal(r.place)}</div>
      <div class="stars" style="font-size:clamp(26px,5vh,44px)">${stars}</div>
      <div class="res-grid"><div class="panel"><div class="res-list">${list}</div></div>
        <div class="panel"><div class="rewards">${rew}<div class="total"><span>TOTAL</span><span>+${r.total} <i class="coin"></i></span></div></div>
        <div class="rewards" style="margin-top:8px"><div><span>Best lap</span><span>${fmtTime(r.bestLap)}</span></div>${r.newRecord ? '<div style="color:var(--green)"><span>NEW RECORD!</span><span>🏆</span></div>' : ''}</div></div></div>
      ${r.unlock ? `<div class="unlock-note">🔓 ${r.unlock}</div>` : ''}
      <div class="row" style="flex-wrap:wrap;justify-content:center">
        ${r.hasNext ? '<button class="btn primary big" id="r-next"><span>Next race ▶</span></button>' : ''}
        <button class="btn cyan" id="r-retry"><span>↻ Retry</span></button><button class="btn" id="r-menu"><span>Menu</span></button></div></div>`;
    const n = $('#r-next', el); if (n) n.onclick = () => this.h.next();
    $('#r-retry', el).onclick = () => this.h.restart(); $('#r-menu', el).onclick = () => this.h.quit();
    if (r.place <= 3) this.confetti();
  }
  confetti() {
    const cols = ['#ff2bd6', '#00e5ff', '#ffd21f', '#34ff9a', '#ff8a1f', '#fff'];
    for (let i = 0; i < 70; i++) { const c = document.createElement('i'); c.className = 'confetti'; c.style.left = Math.random() * 100 + 'vw'; c.style.background = cols[i % cols.length]; c.style.animationDuration = 2 + Math.random() * 2.5 + 's'; c.style.animationDelay = Math.random() * 0.8 + 's'; document.body.appendChild(c); setTimeout(() => c.remove(), 5500); }
  }
}
