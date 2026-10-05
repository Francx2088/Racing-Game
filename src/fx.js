// Particle effects (sparks, smoke, flames, pickups) and ambient weather.
import * as THREE from 'three';

const VERT = `
attribute vec4 aColor; attribute float aSize; varying vec4 vColor; uniform float uScale;
void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`;
const FRAG = `
varying vec4 vColor;
void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.15, d) * vColor.a; if (a < 0.01) discard; gl_FragColor = vec4(vColor.rgb, a); }`;

export class Particles {
  constructor(scene, max = 1200, additive = true) {
    this.max = max; this.n = 0; this.head = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.grow = new Float32Array(max); this.baseA = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 600 } } });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 10;
    scene.add(this.points); this.geo = g;
    for (let i = 0; i < max; i++) { this.pos[i * 3 + 1] = -9999; }
  }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a = 1, grow = 0, drag = 0, grav = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = size; this.grow[i] = grow; this.size[i] = size;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a; this.baseA[i] = a; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt, scale) {
    this.mat.uniforms.uScale.value = scale;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; } continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + this.grow[i] * (1 - k);
      this.col[i * 4 + 3] = this.baseA[i] * k;
      if (this.life[i] <= 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; }
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aColor.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.size.fill(0); this.col.fill(0); this.geo.attributes.aColor.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true; }
}

let softTex;
const soft = () => softTex || (softTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })());

const WEATHER = {
  wisps: { n: 70, size: 20, color: 0xffffff, fall: 0, drift: 0, opacity: 0.14, additive: false, world: true, range: 130 },
  snowdust: { n: 260, size: 0.35, color: 0xffffff, fall: -1.2, drift: 5, opacity: 0.8, additive: false },
  snow: { n: 700, size: 0.55, color: 0xffffff, fall: -5.5, drift: 1.5, opacity: 0.95, additive: false },
  dust: { n: 260, size: 0.5, color: 0xf3cf9a, fall: -0.2, drift: 9, opacity: 0.4, additive: false },
  embers: { n: 420, size: 0.5, color: 0xff7a2a, fall: 5, drift: 2, opacity: 1, additive: true },
  fireflies: { n: 220, size: 0.7, color: 0xd8ff5a, fall: 0.2, drift: 1.2, opacity: 1, additive: true, wander: true },
  leaves: { n: 260, size: 0.75, color: 0xff8a1f, fall: -2.0, drift: 3.5, opacity: 0.95, additive: false, sway: true },
  sparkle: { n: 320, size: 0.8, color: 0xffffff, fall: 0.6, drift: 1, opacity: 1, additive: true, wander: true, rainbow: true },
};

export class Weather {
  constructor(kind, scene) {
    this.kind = kind; this.scene = scene; this.obj = null; this.t = 0;
    if (kind === 'rain') {
      const n = 520; this.n = n;
      this.p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { this.p[i * 3] = (Math.random() - 0.5) * 80; this.p[i * 3 + 1] = Math.random() * 40; this.p[i * 3 + 2] = (Math.random() - 0.5) * 80; }
      const g = new THREE.BufferGeometry(); this.pos = new Float32Array(n * 6); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb8c8ff, transparent: true, opacity: 0.45, depthWrite: false }));
    } else if (WEATHER[kind]) {
      const W = this.W = WEATHER[kind]; const n = this.n = W.n;
      this.p = new Float32Array(n * 3); this.ph = new Float32Array(n);
      for (let i = 0; i < n; i++) { this.p[i * 3] = (Math.random() - 0.5) * 90; this.p[i * 3 + 1] = Math.random() * 40; this.p[i * 3 + 2] = (Math.random() - 0.5) * 90; this.ph[i] = Math.random() * 6.28; }
      const g = new THREE.BufferGeometry(); this.pos = new Float32Array(n * 3); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      if (W.rainbow) { const c = new Float32Array(n * 3); const t = new THREE.Color(); for (let i = 0; i < n; i++) { t.setHSL(Math.random(), 1, 0.7); c.set([t.r, t.g, t.b], i * 3); } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
      this.obj = new THREE.Points(g, new THREE.PointsMaterial({ size: W.size, map: soft(), color: W.rainbow ? 0xffffff : W.color, vertexColors: !!W.rainbow, transparent: true, opacity: W.opacity, depthWrite: false, blending: W.additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true }));
    }
    if (this.obj) { this.obj.frustumCulled = false; scene.add(this.obj); }
  }
  update(dt, cam, speed = 0) {
    if (!this.obj) return;
    this.t += dt;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    if (this.kind === 'rain') {
      for (let i = 0; i < this.n; i++) {
        let y = this.p[i * 3 + 1] - 55 * dt; if (y < -4) { y += 40; this.p[i * 3] = (Math.random() - 0.5) * 80; this.p[i * 3 + 2] = (Math.random() - 0.5) * 80; }
        this.p[i * 3 + 1] = y;
        const x = this.p[i * 3] + cx, z = this.p[i * 3 + 2] + cz, yy = y + cy - 12;
        this.pos.set([x, yy, z, x - 0.12, yy + 1.5, z - 0.1], i * 6);
      }
      this.obj.geometry.attributes.position.needsUpdate = true; return;
    }
    const W = this.W;
    for (let i = 0; i < this.n; i++) {
      let x = this.p[i * 3], y = this.p[i * 3 + 1], z = this.p[i * 3 + 2];
      const ph = this.ph[i];
      if (W.wander) { x += Math.sin(this.t * 0.7 + ph) * W.drift * dt; z += Math.cos(this.t * 0.6 + ph * 1.3) * W.drift * dt; }
      else { x += (W.drift * (0.6 + Math.sin(ph))) * dt + (W.sway ? Math.sin(this.t * 1.6 + ph) * 2 * dt : 0); z += Math.sin(this.t * 0.5 + ph) * W.drift * 0.4 * dt; }
      y += W.fall * dt * (W.wander ? Math.sin(this.t + ph) : 1);
      if (W.world) {
        // world-fixed puffs that wrap around the camera: streaming past gives a strong sense of speed
        const R = W.range;
        if (!this.init) { this.p[i * 3] = cx + (Math.random() - 0.5) * R * 2; this.p[i * 3 + 1] = cy + (Math.random() - 0.5) * 70; this.p[i * 3 + 2] = cz + (Math.random() - 0.5) * R * 2; x = this.p[i * 3]; y = this.p[i * 3 + 1]; z = this.p[i * 3 + 2]; }
        if (x - cx > R) x -= R * 2; else if (x - cx < -R) x += R * 2; if (z - cz > R) z -= R * 2; else if (z - cz < -R) z += R * 2; if (y - cy > 40) y -= 80; else if (y - cy < -40) y += 80;
        this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; continue;
      }
      if (y < -2) y += 40; else if (y > 38) y -= 40;
      if (x > 45) x -= 90; else if (x < -45) x += 90; if (z > 45) z -= 90; else if (z < -45) z += 90;
      this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
      this.pos[i * 3] = x + cx + fwd.x * 25; this.pos[i * 3 + 1] = y + cy - 10; this.pos[i * 3 + 2] = z + cz + fwd.z * 25;
    }
    this.init = true;
    this.obj.geometry.attributes.position.needsUpdate = true;
  }
  dispose() { if (this.obj) { this.scene.remove(this.obj); this.obj.geometry.dispose(); this.obj.material.dispose(); } }
}
