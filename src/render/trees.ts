// 樹木：兩種低多邊形樹（闊葉、松），InstancedMesh ＋ 風吹搖擺
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { T, type MapGrid } from '../sim/map/grid';
import type { Terrain } from './terrain';
import { vatTime } from './vat';
import { STUMP } from '../models/resources';

function colored(geo: THREE.BufferGeometry, hex: number, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m);
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));

function broadleaf(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.07, 0.11, 0.6, 5), 0x6e4a2c, at(0, 0.3, 0)),
    colored(new THREE.IcosahedronGeometry(0.55, 0), 0x4f9135, at(0, 1.05, 0, 1, 0.85, 1)),
    colored(new THREE.IcosahedronGeometry(0.36, 0), 0x63a443, at(0.22, 1.38, 0.08)),
    colored(new THREE.IcosahedronGeometry(0.3, 0), 0x5a9b3c, at(-0.25, 1.25, -0.12)),
  ])!;
}

function pine(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.06, 0.1, 0.5, 5), 0x6a4528, at(0, 0.25, 0)),
    colored(new THREE.ConeGeometry(0.58, 0.7, 7), 0x3b7a3d, at(0, 0.75, 0)),
    colored(new THREE.ConeGeometry(0.45, 0.6, 7), 0x438544, at(0, 1.12, 0)),
    colored(new THREE.ConeGeometry(0.3, 0.5, 7), 0x4b904b, at(0, 1.45, 0)),
  ])!;
}

function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 0xffff;
}

export class Trees {
  readonly group = new THREE.Group();
  count = 0;
  /** 格子 → 哪個實例（砍完時隱藏） */
  private byTile = new Map<number, { mesh: THREE.InstancedMesh; i: number; x: number; z: number }>();
  private stumps: THREE.InstancedMesh;
  private readonly mapW: number;

  constructor(map: MapGrid, terrain: Terrain) {
    this.mapW = map.w;
    const spots: { x: number; z: number; v: number; s: number; r: number; tile: number }[] = [];
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (map.tiles[ty * map.w + tx] !== T.Forest) continue;
        spots.push({
          x: tx + 0.5 + (hash(tx, ty, 1) - 0.5) * 0.4,
          z: ty + 0.5 + (hash(tx, ty, 2) - 0.5) * 0.4,
          v: hash(tx, ty, 3) < 0.45 ? 1 : 0,
          s: 0.85 + hash(tx, ty, 4) * 0.4,
          r: hash(tx, ty, 5) * Math.PI * 2,
          tile: ty * map.w + tx,
        });
      }
    }
    this.count = spots.length;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = vatTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  float sway = sin(uTime * 1.6 + instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.45) * 0.045 * max(0.0, position.y - 0.45);
  transformed.x += sway;
  transformed.z += sway * 0.5;`,
        );
    };
    mat.customProgramCacheKey = () => 'tree-sway';
    const geos = [broadleaf(), pine()];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tint = new THREE.Color();
    const CH = 32;
    // 依 32×32 區塊分組，每塊每種樹一個 InstancedMesh，畫面外的區塊整塊略過
    for (let cy = 0; cy < map.h; cy += CH) {
      for (let cx = 0; cx < map.w; cx += CH) {
        for (let v = 0; v < 2; v++) {
          const list = spots.filter((s) => s.v === v && s.x >= cx && s.x < cx + CH && s.z >= cy && s.z < cy + CH);
          if (!list.length) continue;
          const mesh = new THREE.InstancedMesh(geos[v], mat, list.length);
          list.forEach((s, i) => {
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.r);
            m.compose(new THREE.Vector3(s.x, terrain.heightAt(s.x, s.z) - 0.05, s.z), q, new THREE.Vector3(s.s, s.s * (0.9 + (s.r % 0.3)), s.s));
            mesh.setMatrixAt(i, m);
            const k = 0.88 + ((s.r * 7.3) % 0.24);
            mesh.setColorAt(i, tint.setRGB(k, k, k));
            this.byTile.set(s.tile, { mesh, i, x: s.x, z: s.z });
          });
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.computeBoundingSphere();
          this.group.add(mesh);
        }
      }
    }
    this.stumps = new THREE.InstancedMesh(STUMP(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 4096);
    this.stumps.count = 0;
    this.stumps.frustumCulled = false;
    this.stumps.receiveShadow = true;
    this.group.add(this.stumps);
    this.terrainRef = terrain;
  }

  private terrainRef: Terrain;

  /** 樹砍完：隱藏該棵樹、留下樹樁 */
  remove(tx: number, ty: number): void {
    const key = ty * this.mapW + tx;
    const t = this.byTile.get(key);
    if (!t) return;
    this.byTile.delete(key);
    t.mesh.setMatrixAt(t.i, new THREE.Matrix4().makeScale(0, 0, 0));
    t.mesh.instanceMatrix.needsUpdate = true;
    if (this.stumps.count < 4096) {
      this.stumps.setMatrixAt(this.stumps.count++, new THREE.Matrix4().makeTranslation(t.x, this.terrainRef.heightAt(t.x, t.z) - 0.02, t.z));
      this.stumps.instanceMatrix.needsUpdate = true;
    }
    this.count--;
  }
}
