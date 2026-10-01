// 投射物渲染：箭矢沿拋物線飛，方向跟著速度轉
import * as THREE from 'three';
import { HEIGHT_UNIT } from '../sim/map/grid';
import type { Sim } from '../sim/sim';
import type { Terrain } from './terrain';

export class ProjectileRenderer {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly dir = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(private terrain: Terrain) {
    const shaft = new THREE.BoxGeometry(0.025, 0.025, 0.42);
    const tip = new THREE.ConeGeometry(0.03, 0.08, 4).rotateX(Math.PI / 2).translate(0, 0, 0.24);
    const geo = new THREE.BufferGeometry();
    const a = shaft.toNonIndexed();
    const b = tip.toNonIndexed();
    const pa = a.getAttribute('position').array as Float32Array;
    const pb = b.getAttribute('position').array as Float32Array;
    const pos = new Float32Array(pa.length + pb.length);
    pos.set(pa);
    pos.set(pb, pa.length);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x5a3b22 }), 4096);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /** visible：該格看得到才畫（迷霧） */
  update(sim: Sim, alpha: number, visible: (tx: number, ty: number) => boolean): void {
    const p = sim.projectiles;
    let n = 0;
    for (let i = 0; i < p.high; i++) {
      if (!p.alive[i]) continue;
      const f0 = Math.min(1, (p.t[i] + alpha) / p.dur[i]);
      const sx = p.sx[i] / 1024;
      const sz = p.sy[i] / 1024;
      const ex = p.tx[i] / 1024;
      const ez = p.ty[i] / 1024;
      const x = sx + (ex - sx) * f0;
      const z = sz + (ez - sz) * f0;
      if (!visible(Math.floor(x), Math.floor(z))) continue;
      const dist = Math.hypot(ex - sx, ez - sz);
      const y0 = this.terrain.heightAt(sx, sz) + p.h0[i] / HEIGHT_UNIT;
      const y1 = this.terrain.heightAt(ex, ez) + 0.4;
      const arc = dist * 0.18;
      const y = y0 + (y1 - y0) * f0 + 4 * arc * f0 * (1 - f0);
      // 切線方向
      const dy = (y1 - y0) + 4 * arc * (1 - 2 * f0);
      this.dir.set(ex - sx, dy, ez - sz).normalize();
      this.q.setFromUnitVectors(this.fwd, this.dir);
      this.pos.set(x, y, z);
      this.m.compose(this.pos, this.q, this.one);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
