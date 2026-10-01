// 選取圈、圓形假陰影、移動指令標記（全部實例化，不用 DOM）
import * as THREE from 'three';
import { CAPACITY } from '../sim/core/world';
import type { UnitRenderer } from './units';

export class Markers {
  readonly group = new THREE.Group();
  private rings: THREE.InstancedMesh;
  private blobs: THREE.InstancedMesh;
  private pings: { mesh: THREE.Mesh; t: number }[] = [];
  blobShadows = false;

  constructor() {
    const ringGeo = new THREE.RingGeometry(0.3, 0.36, 24).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.rings = new THREE.InstancedMesh(ringGeo, ringMat, CAPACITY);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 2;
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings.setColorAt(0, new THREE.Color());

    const blobGeo = new THREE.CircleGeometry(0.3, 12).rotateX(-Math.PI / 2);
    const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.blobs = new THREE.InstancedMesh(blobGeo, blobMat, CAPACITY);
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.62, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, depthWrite: false, depthTest: false }),
      );
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.pings.push({ mesh, t: 1 });
      this.group.add(mesh);
    }
    this.group.add(this.blobs, this.rings);
  }

  /** 在地面點一個波紋（下移動指令時） */
  ping(x: number, y: number, z: number, color = 0x7dff8a): void {
    const p = this.pings.reduce((a, b) => (a.t > b.t ? a : b));
    p.t = 0;
    p.mesh.position.set(x, y + 0.05, z);
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    p.mesh.visible = true;
  }

  update(units: UnitRenderer, selected: Iterable<number>, owners: Uint8Array, alive: Uint8Array, high: number, myPlayer: number, dt: number): void {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let n = 0;
    for (const id of selected) {
      m.makeTranslation(units.wx[id], units.wy[id] + 0.03, units.wz[id]);
      this.rings.setMatrixAt(n, m);
      this.rings.setColorAt(n, c.setHex(owners[id] === myPlayer ? 0x9dff7a : 0xff6a5a));
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;

    let b = 0;
    if (this.blobShadows) {
      for (let id = 0; id < high; id++) {
        if (!alive[id]) continue;
        m.makeTranslation(units.wx[id], units.wy[id] + 0.02, units.wz[id]);
        this.blobs.setMatrixAt(b++, m);
      }
    }
    this.blobs.count = b;
    this.blobs.instanceMatrix.needsUpdate = true;

    for (const p of this.pings) {
      if (!p.mesh.visible) continue;
      p.t += dt / 0.6;
      if (p.t >= 1) {
        p.mesh.visible = false;
        continue;
      }
      const s = 0.6 + p.t * 0.9;
      p.mesh.scale.set(s, 1, s);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p.t;
    }
  }
}
