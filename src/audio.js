// Procedural audio (WebAudio): engine, tyres, wind, SFX and a small generative soundtrack. No audio files.
const SCALES = {
  major: [0, 2, 4, 7, 9, 12, 14, 16], minor: [0, 3, 5, 7, 10, 12, 15, 17], pent: [0, 3, 5, 7, 10, 12, 15, 19],
  phrygian: [0, 1, 4, 5, 7, 8, 11, 12],
};

class AudioEngine {
  constructor() { this.ctx = null; this.enabled = true; this.musicOn = true; this.sfxOn = true; this.running = false; this.bgm = null; this._timer = null; this.step = 0; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? 0.8 : 0; this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxOn ? 1 : 0; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.musicOn ? 0.35 : 0; this.music.connect(this.master);
    // noise buffer
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // engine
    this.eng = { o1: ctx.createOscillator(), o2: ctx.createOscillator(), g: ctx.createGain(), f: ctx.createBiquadFilter() };
    this.eng.o1.type = 'sawtooth'; this.eng.o2.type = 'square'; this.eng.f.type = 'lowpass'; this.eng.f.frequency.value = 600; this.eng.g.gain.value = 0;
    this.eng.o1.connect(this.eng.f); this.eng.o2.connect(this.eng.f); this.eng.f.connect(this.eng.g); this.eng.g.connect(this.sfx);
    this.eng.o1.start(); this.eng.o2.start();
    // tyre squeal + wind
    this.tire = this._noiseLoop('bandpass', 1500, 4); this.wind = this._noiseLoop('lowpass', 600, 0.7);
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.bgm && this.musicOn) this._startMusic();
  }
  _noiseLoop(type, freq, Q) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = ctx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfx); s.start();
    return { g, f };
  }
  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.value = on ? 0.8 : 0; }
  setMusic(on) { this.musicOn = on; if (this.music) this.music.gain.value = on ? 0.35 : 0; if (on && this.ctx && this.bgm) this._startMusic(); }
  setSfx(on) { this.sfxOn = on; if (this.sfx) this.sfx.gain.value = on ? 1 : 0; }

  // speed01: 0..1+, throttle 0..1
  engine(speed01, throttle, boost, active) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    if (!active) { this.eng.g.gain.setTargetAtTime(0, t, 0.05); this.tire.g.gain.setTargetAtTime(0, t, 0.05); this.wind.g.gain.setTargetAtTime(0, t, 0.1); return; }
    const gears = 5, gs = clamp01(speed01) * gears, gear = Math.min(gears - 1, Math.floor(gs)), rpm = gs - gear;
    const base = 52 + gear * 3 + rpm * (90 + gear * 8);
    const f = base * (boost ? 1.08 : 1);
    this.eng.o1.frequency.setTargetAtTime(f, t, 0.03); this.eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.eng.f.frequency.setTargetAtTime(380 + rpm * 900 + throttle * 500, t, 0.05);
    this.eng.g.gain.setTargetAtTime(0.05 + throttle * 0.07, t, 0.05);
    this.wind.g.gain.setTargetAtTime(Math.min(0.2, speed01 * 0.16 + (boost ? 0.06 : 0)), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(400 + speed01 * 1400, t, 0.1);
  }
  skid(level) { if (!this.ctx) return; this.tire.g.gain.setTargetAtTime(level * 0.1, this.ctx.currentTime, 0.04); this.tire.f.frequency.setTargetAtTime(1100 + level * 900, this.ctx.currentTime, 0.05); }

  _tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, when = 0, dest = null) {
    if (!this.ctx) return; const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(dur, freq, vol = 0.2, type = 'bandpass', slideTo = null, dest = null) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  coin() { this._tone(988, 0.08, 'square', 0.08); this._tone(1319, 0.14, 'square', 0.08, null, 0.07); }
  nitroPickup() { this._tone(300, 0.3, 'sawtooth', 0.12, 900); this._tone(900, 0.2, 'sine', 0.1, null, 0.15); }
  pad() { this._noise(0.7, 500, 0.35, 'bandpass', 3000); this._tone(220, 0.5, 'sawtooth', 0.1, 880); }
  boost() { this._noise(0.9, 800, 0.4, 'bandpass', 3500); }
  bump(v = 1) { this._noise(0.18, 220, 0.3 * Math.min(1, v / 8), 'lowpass'); this._tone(90, 0.15, 'sine', 0.2, 40); }
  scrape() { this._noise(0.25, 2400, 0.12, 'bandpass'); }
  land() { this._noise(0.22, 160, 0.4, 'lowpass'); this._tone(70, 0.25, 'sine', 0.3, 35); }
  beep(go) { this._tone(go ? 880 : 440, go ? 0.55 : 0.18, 'square', 0.12); }
  driftLevel(l) { this._tone(500 + l * 200, 0.12, 'triangle', 0.14); }
  lap() { [523, 659, 784].forEach((f, i) => this._tone(f, 0.18, 'triangle', 0.14, null, i * 0.08)); }
  finish(win) { const n = win ? [523, 659, 784, 1047, 784, 1047] : [392, 330, 294]; n.forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.16, null, i * 0.12)); }
  click() { this._tone(660, 0.06, 'triangle', 0.1); }
  overtake() { this._tone(700, 0.08, 'triangle', 0.1); this._tone(1000, 0.12, 'triangle', 0.1, null, 0.06); }
  unlock_() { [660, 880, 1320].forEach((f, i) => this._tone(f, 0.15, 'square', 0.1, null, i * 0.07)); }

  // ---- music ----
  playMusic(bgm) { this.bgm = bgm; this.step = 0; if (this.ctx && this.musicOn) this._startMusic(); }
  stopMusic() { this.bgm = null; if (this._timer) { clearInterval(this._timer); this._timer = null; } }
  _startMusic() {
    if (this._timer) clearInterval(this._timer);
    const b = this.bgm; if (!b || !this.ctx) return;
    const beat = 60 / b.bpm / 2; let next = this.ctx.currentTime + 0.1; const scale = SCALES[b.scale] || SCALES.major;
    const patt = [0, 2, 4, 2, 5, 4, 2, 1, 0, 3, 5, 3, 6, 5, 3, 2];
    this._timer = setInterval(() => {
      if (!this.ctx) return;
      while (next < this.ctx.currentTime + 0.25) {
        const i = this.step++, bar = (i / 16) | 0, chord = [0, 3, 4, 2][bar % 4];
        const t = next - this.ctx.currentTime;
        const root = b.root * Math.pow(2, scale[chord % scale.length] / 12) / 2;
        if (i % 4 === 0) this._tone(root, beat * 3, 'triangle', 0.22, null, t, this.music);
        if (i % 2 === 0) this._tone(root * 2, beat * 0.8, 'sine', 0.1, null, t, this.music);
        const n = scale[(patt[i % 16] + chord) % scale.length];
        this._tone(b.root * 2 * Math.pow(2, n / 12), beat * 1.5, 'square', 0.04, null, t, this.music);
        if (i % 2 === 1) { // hat
          const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
          const g = this.ctx.createGain(); g.gain.setValueAtTime(0.05, this.ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + t + 0.05);
          s.connect(f); f.connect(g); g.connect(this.music); s.start(this.ctx.currentTime + t, Math.random()); s.stop(this.ctx.currentTime + t + 0.08);
        }
        if (i % 8 === 0 || i % 8 === 5) { this._tone(110, 0.15, 'sine', 0.3, 40, t, this.music); }
        next += beat;
      }
    }, 80);
  }
  pause() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
export default new AudioEngine();
