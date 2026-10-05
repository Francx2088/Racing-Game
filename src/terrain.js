// Terrain: a heightfield that hugs the track (embankments) and fades into theme noise.
import * as THREE from 'three';
import { lerp, smooth } from './util.js';

export function buildTerrain(track, th, noise) {
  const T = th.terrain;
  const wd = track.wallD, inner = wd + 1.2, blend = T.blend ?? 38;
  const raw = (x, z) => T.height(x, z, noise);
  const heightAt = (x, z) => {
    const n = track.nearestSample(x, z, inner + blend);
    const nz = raw(x, z);
    if (!n) return nz;
    const i = n.i;
    const near = track.py[i] - 0.45 - Math.abs(Math.tan(track.bank[i])) * wd;
    return lerp(near, nz, smooth(inner, inner + blend, Math.sqrt(n.d2)));
  };

  const b = track.bounds, M = T.margin ?? 460;
  const minX = b.minX - M, maxX = b.maxX + M, minZ = b.minZ - M, maxZ = b.maxZ + M;
  const cell = Math.max(T.cell ?? 5, Math.max(maxX - minX, maxZ - minZ) / 230);
  const nx = Math.ceil((maxX - minX) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = minX + i * cell, z = minZ + j * cell;
    const h = heightAt(x, z);
    const k = (j * nx + i) * 3;
    pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
    const ns = noise.fbm(x * 0.02 + 40, z * 0.02 - 17, 3);
    const nn = track.nearestSample(x, z, inner + 14);
    const verge = nn ? 1 - smooth(inner, inner + 14, Math.sqrt(nn.d2)) : 0;
    c.set(T.color(h, ns, x, z, verge));
    col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, bb = a + 1, cc = a + nx, d = cc + 1;
    idx[q++] = a; idx[q++] = cc; idx[q++] = bb; idx[q++] = bb; idx[q++] = cc; idx[q++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: !!T.flat }));
  mesh.frustumCulled = false;
  return { mesh, heightAt, bounds: { minX, maxX, minZ, maxZ } };
}
