// Sky-world building blocks: cloud sea shader, billboard cumulus, rock islands, mountain peaks,
// waterfalls and the procedural PBR textures (asphalt, concrete).
import * as THREE from 'three';
import { makeNoise, makeNoise3, rng, clamp, smooth, lerp } from './util.js';

const GLSL_NOISE = `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.7); a*=.5; } return s; }
`;

// A huge animated cloud layer ("sea of clouds") lit from the sun direction.
export function cloudSea({ y, color, shade, fog, scale = 0.0016, density = 0.5, alpha = 0.95, speed = 1, sunDir, soft = 0.25, glow = null, glowAmt = 0 }) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uShade: { value: new THREE.Color(shade) }, uFog: { value: new THREE.Color(fog[0]) },
      uTime: { value: 0 }, uScale: { value: scale }, uDensity: { value: density }, uAlpha: { value: alpha }, uSoft: { value: soft },
      uFogNear: { value: fog[1] }, uFogFar: { value: fog[2] }, uSun: { value: sunDir.clone() }, uCam: { value: new THREE.Vector3() },
      uGlow: { value: new THREE.Color(glow ?? 0x000000) }, uGlowAmt: { value: glowAmt }, uSpeed: { value: speed },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform vec3 uColor,uShade,uFog,uSun,uCam,uGlow; uniform float uTime,uScale,uDensity,uAlpha,uFogNear,uFogFar,uSoft,uGlowAmt,uSpeed; varying vec3 vW;
      ${GLSL_NOISE}
      void main(){
        vec2 p = vW.xz*uScale + vec2(uTime*0.012, uTime*0.006)*uSpeed;
        float n = fbm(p) * 0.78 + fbm(p*2.9+3.1) * 0.32;
        float dens = smoothstep(uDensity-uSoft, uDensity+uSoft, n);
        vec2 sd = normalize(uSun.xz + 1e-4) * 0.06;
        float nl = fbm(p+sd)*0.78 + fbm((p+sd)*2.9+3.1)*0.32;
        float lit = clamp(0.55 + (n-nl)*9.0, 0., 1.);
        float top = smoothstep(uDensity, uDensity+0.35, n);
        vec3 col = mix(uShade, uColor, clamp(lit*0.6 + top*0.5, 0., 1.));
        col = mix(col, uGlow, uGlowAmt * (1.0-dens*0.6));
        float d = distance(vW, uCam);
        float f = smoothstep(uFogNear, uFogFar, d);
        col = mix(col, uFog, f);
        gl_FragColor = vec4(col, dens*uAlpha*(1.0-0.5*smoothstep(uFogFar*0.6,uFogFar*1.6,d)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000, 1, 1), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = -5; m.frustumCulled = false;
  m.userData.cloud = true;
  return m;
}

function cumulusTexture(seed = 3) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const r = rng(seed);
  const blobs = []; for (let i = 0; i < 26; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * 0.55; blobs.push([0.5 + Math.cos(a) * d * 0.9, 0.55 + Math.sin(a) * d * 0.45, 0.12 + r() * 0.14]); }
  for (const [x, y, rad] of blobs) {
    const gr = g.createRadialGradient(x * 256, y * 256, 0, x * 256, y * 256, rad * 256);
    // lit from the top: bright core, soft shaded rim
    const sh = 0.55 + 0.45 * (1 - y);
    gr.addColorStop(0, `rgba(${255 * sh | 0},${255 * sh | 0},${255 * sh | 0},0.95)`); gr.addColorStop(0.55, `rgba(${230 * sh | 0},${232 * sh | 0},${240 * sh | 0},0.65)`); gr.addColorStop(1, 'rgba(200,205,220,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Instanced camera-facing cumulus puffs. list: [{x,y,z,s,sy?}]
export function cloudPuffs(list, { tint = 0xffffff, shade = 0x8890a8, fog, opacity = 0.9, seed = 3 }) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uMap: { value: cumulusTexture(seed) }, uTint: { value: new THREE.Color(tint) }, uShade: { value: new THREE.Color(shade) }, uFog: { value: new THREE.Color(fog[0]) }, uFogNear: { value: fog[1] }, uFogFar: { value: fog[2] }, uOp: { value: opacity } },
    vertexShader: `varying vec2 vUv; varying float vD;
      void main(){ vUv=uv; vec4 c = modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
        float sx=length(vec3(instanceMatrix[0])), sy=length(vec3(instanceMatrix[1])); c.xy += position.xy*vec2(sx,sy); vD=-c.z; gl_Position=projectionMatrix*c; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uTint,uShade,uFog; uniform float uFogNear,uFogFar,uOp; varying vec2 vUv; varying float vD;
      void main(){ vec4 t = texture2D(uMap, vUv); vec3 col = mix(uShade, uTint, t.r); float f = smoothstep(uFogNear,uFogFar,vD); col = mix(col,uFog,f*0.85);
        float near = smoothstep(8.,60.,vD); gl_FragColor = vec4(col, t.a*uOp*near*(1.-0.35*f));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  list.forEach((o, i) => { p.set(o.x, o.y, o.z); s.set(o.s, o.s * (o.sy ?? 0.6), 1); m.compose(p, q, s); im.setMatrixAt(i, m); });
  im.count = list.length; im.frustumCulled = false; im.renderOrder = -4;
  return im;
}

// ---------- rock islands / icebergs ----------
export function islandGeometry(seed, { grass = [0x4f8f3a, 0x6aa84a], rock = [0x6b5a4a, 0x8a7560, 0x4e4238], depth = 1.5, flat = 0.14, snow = false, emissiveCracks = false } = {}) {
  const n3 = makeNoise3(seed), geo = new THREE.SphereGeometry(1, 64, 44);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r0 = Math.hypot(v.x, v.z), ang = Math.atan2(v.z, v.x);
    const wob = 1 + (n3.fbm(Math.cos(ang) * 1.4 + 5, Math.sin(ang) * 1.4 + 5, 0.5, 3) - 0.5) * 0.55;
    if (v.y >= 0) {
      const bump = (n3.fbm(v.x * 2.4, 3.3, v.z * 2.4, 3) - 0.5) * 0.12;
      v.y = (v.y * flat + bump * smooth(0, 0.4, v.y)) * (1.0); v.x *= wob; v.z *= wob;
    } else {
      const t = -v.y, k = 1 - 0.8 * Math.pow(t, 1.15);
      const nn = n3.fbm(v.x * 2.2 + 9, v.y * 2.6, v.z * 2.2 + 3, 4);
      v.x *= k * wob * (0.85 + nn * 0.4); v.z *= k * wob * (0.85 + nn * 0.4);
      v.y = -Math.pow(t, 0.85) * depth * (0.8 + nn * 0.5);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const col = new Float32Array(pos.count * 3), nrm = geo.attributes.normal, c = new THREE.Color(), c2 = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ny = nrm.getY(i), nz = n3.fbm(v.x * 3, v.y * 3, v.z * 3, 3);
    if (ny > 0.55 && v.y > -0.1 * depth) {
      c.set(grass[0]).lerp(c2.set(grass[1]), nz);
      if (snow) c.set(0xf4f8ff).lerp(c2.set(0xcfe3f5), nz * 0.6);
    } else {
      const strata = Math.sin(v.y * 14 + nz * 5) * 0.5 + 0.5;
      c.set(rock[0]).lerp(c2.set(rock[1]), strata).lerp(c2.set(rock[2]), nz * 0.5);
      if (snow) c.lerp(c2.set(0x9fc4e6), 0.5);
    }
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// ---------- mountain peaks (ridged noise, snow line) ----------
export function peakGeometry(seed, { rock = [0x57514d, 0x7c726a], snowLine = 0.55, snowColor = 0xf4f8ff, grass = null, steep = 1 } = {}) {
  const n = makeNoise(seed), geo = new THREE.PlaneGeometry(2, 2, 110, 110);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    const edge = 1 + (n.fbm(Math.cos(ang) * 1.6 + 7, Math.sin(ang) * 1.6 + 7, 3) - 0.5) * 0.5;
    const rr = r / edge;
    let h = Math.pow(clamp(1 - rr, 0, 1), 1.0 + 0.15 * steep);
    const ridge = 1 - Math.abs(2 * n.fbm(x * 2.6 + seed, z * 2.6, 4) - 1);
    const ridge2 = 1 - Math.abs(2 * n.fbm(x * 6 + 3, z * 6 + seed, 3) - 1);
    h *= 0.55 + 0.6 * ridge + 0.22 * ridge2;
    h = rr > 1 ? -0.3 * clamp((rr - 1) * 3, 0, 1) : h - 0.02;
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  const col = new Float32Array(pos.count * 3), nrm = geo.attributes.normal, c = new THREE.Color(), c2 = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), ny = nrm.getY(i), x = pos.getX(i), z = pos.getZ(i);
    const nz = n.fbm(x * 9 + 11, z * 9, 3);
    c.set(rock[0]).lerp(c2.set(rock[1]), nz);
    if (grass && y < 0.28 && ny > 0.6) c.lerp(c2.set(grass), 0.7);
    const snowAmt = smooth(snowLine - 0.06, snowLine + 0.06, y + (nz - 0.5) * 0.18) * smooth(0.35, 0.65, ny);
    c.lerp(c2.set(snowColor), snowAmt);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// falling water sheet
export function waterfall(w, h) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime; ${GLSL_NOISE}
      void main(){ float s = vnoise(vec2(vUv.x*14., vUv.y*3. + uTime*2.2)) * 0.6 + vnoise(vec2(vUv.x*30.+3., vUv.y*8. + uTime*3.4))*0.4;
        float edge = smoothstep(0.0,0.15,vUv.x)*smoothstep(1.0,0.85,vUv.x); float fade = smoothstep(0.0,0.25,vUv.y)*smoothstep(1.0,0.45,vUv.y) ;
        gl_FragColor = vec4(vec3(0.86,0.94,1.0), s*edge*fade*0.75);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.userData.waterfall = true; return m;
}

// ---------- procedural PBR road textures ----------
function prng(seed) { return rng(seed); }
export function asphaltMaps({ base = '#3b3c40', line = '#e8e8e8', center = true, centerColor = null, edgeGlow = null, wet = false, seed = 5, W = 512, H = 1024 }) {
  const r = prng(seed);
  const col = document.createElement('canvas'); col.width = W; col.height = H; const g = col.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  // low-frequency mottling
  for (let i = 0; i < 420; i++) { const x = r() * W, y = r() * H, rad = 20 + r() * 70; const gr = g.createRadialGradient(x, y, 0, x, y, rad); const l = r() < 0.5 ? '255,255,255' : '0,0,0'; gr.addColorStop(0, `rgba(${l},${0.035 + r() * 0.04})`); gr.addColorStop(1, `rgba(${l},0)`); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
  // aggregate grain
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const hgt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { const n = (r() - 0.5); const m2 = (r() < 0.04 ? (r() - 0.3) * 1.6 : 0); const v = n * 9 + m2 * 16; d[i * 4] += v; d[i * 4 + 1] += v; d[i * 4 + 2] += v * 1.02; hgt[i] = n + m2; }
  g.putImageData(img, 0, 0);
  // tyre wear: darker, polished lanes
  const lanes = [0.27, 0.73, 0.5];
  for (const lx of lanes) { const x0 = lx * W, wd = W * 0.075; const gr = g.createLinearGradient(x0 - wd, 0, x0 + wd, 0); const a = lx === 0.5 ? 0.06 : 0.17; gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x0 - wd, 0, wd * 2, H); }
  // transverse seams + cracks
  g.strokeStyle = 'rgba(8,8,10,0.55)'; g.lineWidth = 2;
  for (const y of [H * 0.12, H * 0.63]) { g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 32) g.lineTo(x, y + (r() - 0.5) * 3); g.stroke(); }
  g.strokeStyle = 'rgba(10,10,12,0.4)'; g.lineWidth = 1.2;
  for (let k = 0; k < 9; k++) { let x = r() * W, y = r() * H; g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 14; s++) { x += (r() - 0.5) * 26; y += r() * 20; g.lineTo(x, y); } g.stroke(); }
  // rubber skid marks
  g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 9;
  for (let k = 0; k < 3; k++) { let x = (0.2 + r() * 0.6) * W, y = r() * H; g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 8; s++) { x += (r() - 0.5) * 18; y += 36; g.lineTo(x, y); } g.stroke(); }
  // markings
  const draw = (fn) => { g.save(); fn(); g.restore(); };
  g.fillStyle = line; g.globalAlpha = 0.92;
  g.fillRect(W * 0.035, 0, W * 0.022, H); g.fillRect(W * 0.943, 0, W * 0.022, H);
  if (center) { g.fillStyle = centerColor || line; for (let y = 0; y < H; y += 256) g.fillRect(W * 0.5 - W * 0.012, y + 40, W * 0.024, 128); }
  g.globalAlpha = 1;
  // wear the paint away
  g.globalCompositeOperation = 'destination-out';
  // (destination-out would erase road too, so instead redraw road speckle over paint)
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 9000; i++) { const x = r() * W, y = r() * H; g.fillStyle = `rgba(${40 + r() * 20 | 0},${40 + r() * 20 | 0},${44 + r() * 20 | 0},${0.35 + r() * 0.4})`; if ((x < W * 0.07) || (x > W * 0.93) || (Math.abs(x - W * 0.5) < W * 0.02)) g.fillRect(x, y, 1 + r() * 3, 1 + r() * 3); }
  if (edgeGlow) { g.fillStyle = edgeGlow; g.globalAlpha = 0.9; g.shadowColor = edgeGlow; g.shadowBlur = 14; g.fillRect(W * 0.055, 0, W * 0.008, H); g.fillRect(W * 0.937, 0, W * 0.008, H); g.shadowBlur = 0; g.globalAlpha = 1; }
  const map = new THREE.CanvasTexture(col); map.colorSpace = THREE.SRGBColorSpace;

  // normal map from the height field (+ seams/cracks)
  const nc = document.createElement('canvas'); nc.width = W; nc.height = H; const ng = nc.getContext('2d'); const nimg = ng.createImageData(W, H), nd = nimg.data;
  const sx = 1.1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = hgt[y * W + ((x + W - 1) % W)], rr = hgt[y * W + ((x + 1) % W)], u = hgt[((y + H - 1) % H) * W + x], dn = hgt[((y + 1) % H) * W + x];
    let nx = (l - rr) * sx, ny = (u - dn) * sx, nz = 1; const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * W + x) * 4; nd[i] = (nx * 0.5 + 0.5) * 255; nd[i + 1] = (ny * 0.5 + 0.5) * 255; nd[i + 2] = (nz * 0.5 + 0.5) * 255; nd[i + 3] = 255;
  }
  ng.putImageData(nimg, 0, 0);
  const normal = new THREE.CanvasTexture(nc);
  // roughness: polished wear lanes, rough elsewhere
  const rc = document.createElement('canvas'); rc.width = 64; rc.height = 8; const rg = rc.getContext('2d');
  const grad = rg.createLinearGradient(0, 0, 64, 0); const rough = wet ? 0.35 : 0.88, polished = wet ? 0.18 : 0.62;
  const gv = (v) => `rgb(${v * 255 | 0},${v * 255 | 0},${v * 255 | 0})`;
  grad.addColorStop(0, gv(rough)); grad.addColorStop(0.2, gv(rough)); grad.addColorStop(0.27, gv(polished)); grad.addColorStop(0.34, gv(rough)); grad.addColorStop(0.46, gv(rough)); grad.addColorStop(0.5, gv(rough * 0.92)); grad.addColorStop(0.54, gv(rough)); grad.addColorStop(0.66, gv(rough)); grad.addColorStop(0.73, gv(polished)); grad.addColorStop(0.8, gv(rough)); grad.addColorStop(1, gv(rough));
  rg.fillStyle = grad; rg.fillRect(0, 0, 64, 8);
  const roughMap = new THREE.CanvasTexture(rc);
  for (const t of [map, normal, roughMap]) { t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return { map, normal, roughMap };
}

export function concreteTexture({ a = 0xb9b9b4, b = 0x8f8f8a, bandA = null, bandB = null, seed = 8 }) {
  const r = rng(seed), c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  const hx = (n) => '#' + n.toString(16).padStart(6, '0');
  g.fillStyle = hx(a); g.fillRect(0, 0, 64, 256);
  if (bandA != null) { g.fillStyle = hx(bandA); g.fillRect(0, 0, 64, 128); g.fillStyle = hx(bandB); g.fillRect(0, 128, 64, 128); }
  const img = g.getImageData(0, 0, 64, 256), d = img.data; for (let i = 0; i < 64 * 256; i++) { const v = (r() - 0.5) * 22; d[i * 4] += v; d[i * 4 + 1] += v; d[i * 4 + 2] += v; } g.putImageData(img, 0, 0);
  for (let i = 0; i < 80; i++) { g.fillStyle = `rgba(30,30,30,${r() * 0.12})`; g.fillRect(r() * 64, r() * 256, 2 + r() * 8, 2 + r() * 20); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
