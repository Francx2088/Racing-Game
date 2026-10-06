// Procedural audio built on WebAudio: engine, tyres, wind, ambience, SFX and a small
// generative soundtrack. Everything is synthesised at runtime, so the game ships no audio files.

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pent: [0, 3, 5, 7, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};
// chord roots (scale degrees) for a 4-bar loop
const PROGRESSIONS = {
  major: [0, 5, 3, 4],
  minor: [0, 5, 2, 6],
  pent: [0, 3, 1, 2],
  phrygian: [0, 1, 0, 5],
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this.sfxOn = true;
    this.bgm = null;
    this._timer = null;
    this.step = 0;
    this.gear = 0;
    this.lastThrottle = 0;
    this.rpm = 0;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    // master chain: bus -> compressor -> output
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.comp.connect(this.master).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 1 : 0;
    this.sfx.connect(this.comp);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.32 : 0;
    this.music.connect(this.comp);

    // shared buffers
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // a short reverb impulse for the music
    const rl = ctx.sampleRate * 1.6;
    this.irBuf = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const c = this.irBuf.getChannelData(ch);
      for (let i = 0; i < rl; i++) c[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.irBuf;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    this.reverb.connect(wet).connect(this.music);

    this._buildEngine();
    this.tire = this._noiseLoop('bandpass', 1800, 6);
    this.wind = this._noiseLoop('lowpass', 500, 0.7);
    this.rain = this._noiseLoop('highpass', 2500, 0.5);
    this.pack = this._buildPack();

    if (ctx.state === 'suspended') ctx.resume();
    if (this.bgm && this.musicOn) this._startMusic();
  }

  // Player engine: two detuned saws + a sub, through a soft-clip waveshaper and a throttle-driven
  // low-pass, plus a faint turbo whine. The firing-rate "rumble" comes from AM by a low sine.
  _buildEngine() {
    const ctx = this.ctx;
    const e = (this.eng = {});
    e.o1 = ctx.createOscillator(); e.o1.type = 'sawtooth';
    e.o2 = ctx.createOscillator(); e.o2.type = 'sawtooth'; e.o2.detune.value = 9;
    e.sub = ctx.createOscillator(); e.sub.type = 'square';
    e.mix = ctx.createGain(); e.mix.gain.value = 0.5;
    const subG = ctx.createGain(); subG.gain.value = 0.55;
    e.o1.connect(e.mix); e.o2.connect(e.mix); e.sub.connect(subG).connect(e.mix);
    // amplitude modulation for the "lumpy" combustion feel
    e.am = ctx.createGain(); e.am.gain.value = 0.75;
    e.lfo = ctx.createOscillator(); e.lfo.type = 'sine';
    e.lfoG = ctx.createGain(); e.lfoG.gain.value = 0.25;
    e.lfo.connect(e.lfoG).connect(e.am.gain);
    e.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.4); }
    e.shaper.curve = curve; e.shaper.oversample = '2x';
    e.f = ctx.createBiquadFilter(); e.f.type = 'lowpass'; e.f.Q.value = 1.2;
    e.body = ctx.createBiquadFilter(); e.body.type = 'peaking'; e.body.frequency.value = 180; e.body.gain.value = 6; e.body.Q.value = 0.8;
    e.g = ctx.createGain(); e.g.gain.value = 0;
    e.mix.connect(e.am).connect(e.shaper).connect(e.f).connect(e.body).connect(e.g).connect(this.sfx);
    // turbo whine
    e.turbo = ctx.createOscillator(); e.turbo.type = 'sine';
    e.turboG = ctx.createGain(); e.turboG.gain.value = 0;
    e.turbo.connect(e.turboG).connect(this.sfx);
    for (const o of [e.o1, e.o2, e.sub, e.lfo, e.turbo]) o.start();
  }

  // Opponents: one shared, quieter engine voice driven by the nearest rival.
  _buildPack() {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.connect(f).connect(g);
    if (pan) g.connect(pan).connect(this.sfx); else g.connect(this.sfx);
    o.start();
    return { o, f, g, pan };
  }

  _noiseLoop(type, freq, Q) {
    const ctx = this.ctx, s = ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(f).connect(g).connect(this.sfx);
    s.start();
    return { g, f };
  }

  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.value = on ? 0.9 : 0; }
  setMusic(on) { this.musicOn = on; if (this.music) this.music.gain.value = on ? 0.32 : 0; if (on && this.ctx && this.bgm) this._startMusic(); }
  setSfx(on) { this.sfxOn = on; if (this.sfx) this.sfx.gain.value = on ? 1 : 0; }

  // speed01: 0..1 of top speed, throttle 0..1
  engine(speed01, throttle, boost, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, e = this.eng;
    if (!active) {
      e.g.gain.setTargetAtTime(0, t, 0.05); e.turboG.gain.setTargetAtTime(0, t, 0.05);
      this.tire.g.gain.setTargetAtTime(0, t, 0.05); this.wind.g.gain.setTargetAtTime(0, t, 0.1);
      this.pack.g.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    // simple 6-speed gearbox with a short rev drop on each upshift
    const gears = 6, s = clamp01(speed01);
    const gs = Math.pow(s, 0.85) * gears;
    const gear = Math.min(gears - 1, Math.floor(gs));
    if (gear > this.gear && throttle > 0.5) this._shift();
    this.gear = gear;
    const target = 0.18 + (gs - gear) * 0.82;
    this.rpm += (target - this.rpm) * 0.25;
    const rpm = this.rpm;
    const f = (34 + gear * 4) * (1 + rpm * 2.6) * (boost ? 1.05 : 1);
    e.o1.frequency.setTargetAtTime(f, t, 0.03);
    e.o2.frequency.setTargetAtTime(f * 1.003, t, 0.03);
    e.sub.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    e.lfo.frequency.setTargetAtTime(f * 0.25, t, 0.03);
    e.f.frequency.setTargetAtTime(320 + rpm * 1400 + throttle * 900, t, 0.05);
    e.g.gain.setTargetAtTime(0.06 + throttle * 0.06 + rpm * 0.03, t, 0.05);
    e.turbo.frequency.setTargetAtTime(1800 + rpm * 2600, t, 0.08);
    e.turboG.gain.setTargetAtTime(throttle * rpm * 0.012 + (boost ? 0.01 : 0), t, 0.1);
    // lifting off at high revs: blow-off valve
    if (this.lastThrottle > 0.6 && throttle < 0.2 && rpm > 0.55) this._noise(0.35, 2600, 0.12, 'bandpass', 900);
    this.lastThrottle = throttle;
    this.wind.g.gain.setTargetAtTime(Math.min(0.22, s * 0.17 + (boost ? 0.06 : 0)), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + s * 1500, t, 0.1);
  }

  _shift() {
    if (!this.ctx) return;
    this.rpm *= 0.55;
    // exhaust crackle on the upshift
    for (let i = 0; i < 3; i++) this._noise(0.05, 300 + Math.random() * 300, 0.18, 'bandpass', null, null, i * 0.045 + Math.random() * 0.02);
  }

  // nearest rival: distance in metres, pan -1..1, its speed 0..1
  rival(dist, pan, speed01) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, p = this.pack;
    const vol = dist < 60 ? (1 - dist / 60) * 0.05 : 0;
    p.g.gain.setTargetAtTime(vol, t, 0.1);
    p.o.frequency.setTargetAtTime(45 + speed01 * 110, t, 0.05);
    if (p.pan) p.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
  }

  skid(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tire.g.gain.setTargetAtTime(level * 0.09, t, 0.04);
    this.tire.f.frequency.setTargetAtTime(1400 + level * 700 + Math.random() * 120, t, 0.03);
  }

  ambience(kind) {
    if (!this.ctx) return;
    this.rain.g.gain.setTargetAtTime(kind === 'rain' ? 0.05 : 0, this.ctx.currentTime, 0.5);
  }

  _tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, when = 0, dest = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
    return g;
  }
  _noise(dur, freq, vol = 0.2, type = 'bandpass', slideTo = null, dest = null, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest || this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  coin() { this._tone(1175, 0.07, 'triangle', 0.09); this._tone(1568, 0.16, 'triangle', 0.09, null, 0.06); }
  nitroPickup() { this._tone(320, 0.3, 'sawtooth', 0.08, 960); this._noise(0.3, 1200, 0.12, 'bandpass', 4000); }
  pad() { this._noise(0.8, 400, 0.3, 'bandpass', 3200); this._tone(180, 0.6, 'sawtooth', 0.07, 720); }
  boost() { this._noise(1.0, 700, 0.35, 'bandpass', 3800); this._noise(0.25, 160, 0.3, 'lowpass'); }
  bump(v = 1) { const k = Math.min(1, v / 8); this._noise(0.2, 240, 0.35 * k, 'lowpass'); this._tone(85, 0.18, 'sine', 0.25 * k, 40); this._noise(0.12, 3200, 0.08 * k, 'bandpass'); }
  scrape() { this._noise(0.3, 2800, 0.1, 'bandpass', 1800); this._noise(0.2, 5200, 0.05, 'highpass'); }
  land() { this._noise(0.25, 140, 0.45, 'lowpass'); this._tone(65, 0.25, 'sine', 0.3, 32); }
  thunder() { this._noise(2.6, 120, 0.5, 'lowpass', 40); this._noise(0.5, 900, 0.15, 'bandpass', 200); }
  beep(go) { this._tone(go ? 880 : 440, go ? 0.6 : 0.2, 'square', 0.1); if (go) this._tone(1760, 0.5, 'sine', 0.05); }
  driftLevel(l) { this._tone(520 + l * 220, 0.12, 'triangle', 0.13); this._tone(780 + l * 330, 0.1, 'sine', 0.06, null, 0.04); }
  lap() { [523, 659, 784].forEach((f, i) => this._tone(f, 0.18, 'triangle', 0.13, null, i * 0.08)); }
  finish(win) { const n = win ? [523, 659, 784, 1047, 784, 1047] : [392, 330, 294]; n.forEach((f, i) => this._tone(f, 0.24, 'triangle', 0.15, null, i * 0.12)); }
  click() { this._tone(700, 0.05, 'triangle', 0.08); }
  overtake() { this._tone(740, 0.08, 'triangle', 0.1); this._tone(1110, 0.12, 'triangle', 0.1, null, 0.06); }
  unlock_() { [660, 880, 1320].forEach((f, i) => this._tone(f, 0.15, 'square', 0.08, null, i * 0.07)); }

  // ---------- music ----------
  playMusic(bgm) { this.bgm = bgm; this.step = 0; if (this.ctx && this.musicOn) this._startMusic(); }
  stopMusic() { this.bgm = null; if (this._timer) { clearInterval(this._timer); this._timer = null; } }

  _startMusic() {
    if (this._timer) clearInterval(this._timer);
    const b = this.bgm;
    if (!b || !this.ctx) return;
    const ctx = this.ctx;
    const scale = SCALES[b.scale] || SCALES.major;
    const prog = PROGRESSIONS[b.scale] || PROGRESSIONS.major;
    const rootNote = Math.round(12 * Math.log2(b.root / 440) + 69) - 12;
    const sixteenth = 60 / b.bpm / 4;
    const deg = (d, oct = 0) => rootNote + 12 * (oct + Math.floor(d / scale.length)) + scale[((d % scale.length) + scale.length) % scale.length];
    const arp = [0, 2, 4, 7, 4, 2, 0, 4];
    let next = ctx.currentTime + 0.1;
    this._timer = setInterval(() => {
      if (!this.ctx || !this.bgm) return;
      while (next < ctx.currentTime + 0.3) {
        const i = this.step++, bar = (i >> 4) % 4, s16 = i % 16, when = next - ctx.currentTime;
        const chord = prog[bar];
        // kick on the beat, snare on 2 and 4, hats on the off-sixteenths
        if (s16 % 4 === 0) this._kick(when);
        if (s16 === 4 || s16 === 12) this._snare(when);
        if (s16 % 2 === 1) this._hat(when, s16 % 4 === 3 ? 0.05 : 0.03);
        // bass: root on 8ths with an octave jump
        if (s16 % 2 === 0) this._tone(midi(deg(chord, -1) + (s16 % 8 === 6 ? 12 : 0)), sixteenth * 1.8, 'sawtooth', 0.09, null, when, this._bassBus());
        // pad: new chord each bar
        if (s16 === 0) for (const k of [0, 2, 4]) this._pad(midi(deg(chord + k, 1)), sixteenth * 16, when);
        // arpeggio lead
        if (s16 % 2 === 0 && bar !== 3) {
          const g = this._tone(midi(deg(chord + arp[(s16 >> 1) % 8], 2)), sixteenth * 1.6, 'square', 0.025, null, when, this.music);
          if (g) g.connect(this.reverb);
        }
        next += sixteenth;
      }
    }, 60);
  }
  _bassBus() {
    if (this._bass) return this._bass;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 4;
    f.connect(this.music);
    return (this._bass = f);
  }
  _kick(when) {
    const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.3);
  }
  _snare(when) { this._noise(0.16, 1800, 0.22, 'bandpass', null, this.music, when); this._tone(190, 0.08, 'triangle', 0.1, null, when, this.music); }
  _hat(when, v) { this._noise(0.04, 8000, v, 'highpass', null, this.music, when); }
  _pad(freq, dur, when) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const det of [-7, 7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
    f.connect(g); g.connect(this.music); g.connect(this.reverb);
  }

  pause() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}

export default new AudioEngine();
