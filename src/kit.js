// Low-poly prop kit: merged vertex-coloured geometries + instanced scattering.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const tmpC = new THREE.Color();

// Create a coloured part. geo: THREE geometry. opts: {p:[x,y,z], r:[rx,ry,rz], s:[sx,sy,sz]|n, flat}
export function part(geo, color, opts = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(opts.r || [0, 0, 0])));
  const s = opts.s == null ? [1, 1, 1] : typeof opts.s === 'number' ? [opts.s, opts.s, opts.s] : opts.s;
  m.compose(new THREE.Vector3(...(opts.p || [0, 0, 0])), q, new THREE.Vector3(...s));
  g.applyMatrix4(m);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  tmpC.set(color);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  // slight vertical shading baked into colour for depth
  for (let i = 0; i < n; i++) { col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
export const merge = (parts) => mergeGeometries(parts.map((p) => { const g = p.clone(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; }), false);

export const cyl = (rt, rb, h, seg = 7) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
export const cone = (r, h, seg = 7) => new THREE.ConeGeometry(r, h, seg, 1);
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
export const sph = (r, a = 8, b = 6) => new THREE.SphereGeometry(r, a, b);
export const tor = (r, t, a = 6, b = 12, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, a, b, arc);
export const oct = (r) => new THREE.OctahedronGeometry(r, 0);

export const litMat = (extra = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...extra });
export const glowMat = (extra = {}) => new THREE.MeshBasicMaterial({ vertexColors: true, ...extra });

// Instanced mesh from list of {x,y,z,ry,s,color?}
export function instances(geo, mat, list, { tilt = 0 } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  list.forEach((o, i) => {
    e.set(o.rx || 0, o.ry || 0, o.rz || 0);
    q.setFromEuler(e);
    const sc = o.s ?? 1;
    if (Array.isArray(sc)) s.set(sc[0], sc[1], sc[2]); else s.set(sc, o.sy ? sc * o.sy : sc, sc);
    p.set(o.x, o.y, o.z);
    m.compose(p, q, s);
    im.setMatrixAt(i, m);
    if (o.color != null) { tmpC.set(o.color); im.setColorAt(i, tmpC); }
  });
  if (!list.length) im.count = 0;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.frustumCulled = false;
  return im;
}

// Canvas helpers
export function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
export const css = (n) => '#' + n.toString(16).padStart(6, '0');
