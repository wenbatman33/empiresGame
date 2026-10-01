// 資源點渲染：野果、金、石、鹿、野豬（樹在 trees.ts）；剩越少縮越小，動物被採時倒在地上
import * as THREE from 'three';
import { RESOURCE_MODELS } from '../models/resources';
import { RESOURCE_KINDS, RK } from '../sim/core/defs';
import type { Sim } from '../sim/sim';
import type { Terrain } from './terrain';
import { withFog } from './fog';

export class ResourceRenderer {
  readonly group = new THREE.Group();
  private meshes: (THREE.InstancedMesh | null)[] = [];
  private timer = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(private sim: Sim, private terrain: Terrain) {
    const mat = withFog(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const counts = new Int32Array(RESOURCE_KINDS.length);
    for (let r = 0; r < sim.res.high; r++) if (sim.res.alive[r]) counts[sim.res.kind[r]]++;
    RESOURCE_KINDS.forEach((k, i) => {
      if (i === RK.tree || !counts[i]) {
        this.meshes.push(null);
        return;
      }
      const mesh = new THREE.InstancedMesh(RESOURCE_MODELS[k.id](), mat, counts[i]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.meshes.push(mesh);
    });
    this.rebuild();
  }

  /** 標記需要重建（資源被採、被採完） */
  dirty(): void {
    this.timer = 0;
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    this.rebuild();
  }

  private rebuild(): void {
    const rs = this.sim.res;
    const n = new Int32Array(RESOURCE_KINDS.length);
    for (let r = 0; r < rs.high; r++) {
      if (!rs.alive[r]) continue;
      const k = rs.kind[r];
      const mesh = this.meshes[k];
      if (!mesh) continue;
      const def = RESOURCE_KINDS[k];
      const x = rs.x[r] / 1024;
      const z = rs.y[r] / 1024;
      const yaw = ((r * 2654435761) % 628) / 100;
      const animal = !def.blocks;
      const touched = rs.amount[r] < def.amount;
      const frac = rs.amount[r] / def.amount;
      const sc = animal ? 1 : 0.55 + 0.45 * frac;
      // 動物開始被採就倒下
      this.e.set(0, yaw, animal && touched ? Math.PI / 2 : 0);
      this.q.setFromEuler(this.e);
      this.v.set(x, this.terrain.heightAt(x, z) + (animal && touched ? 0.12 : 0), z);
      this.s.set(sc, sc, sc);
      this.m.compose(this.v, this.q, this.s);
      mesh.setMatrixAt(n[k]++, this.m);
    }
    this.meshes.forEach((mesh, k) => {
      if (!mesh) return;
      mesh.count = n[k];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }
}
