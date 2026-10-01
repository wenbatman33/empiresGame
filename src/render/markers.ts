// 選取圈、圓形假陰影、移動指令標記（全部實例化，不用 DOM）
import * as THREE from 'three';
import { UNIT_LOOK } from '../config';
import { carryBundle } from '../models/resources';
import { BUILDING_DEFS, UNIT_DEFS } from '../sim/core/defs';
import { CAPACITY, S, type World } from '../sim/core/world';
import type { Sim } from '../sim/sim';
import type { UnitRenderer } from './units';

export interface MarkerContext {
  sim: Sim;
  camera: THREE.Camera;
  selBuilding: number;
  buildingHeight: (btype: number) => number;
  /** 敵方建築是否在探索過的地方 */
  explored: (tx: number, ty: number) => boolean;
}

/** 搬運中的資源顏色：糧、木、金、石 */
const CARRY_COLORS = [0xd9a441, 0x8a5a32, 0xf0c53a, 0xa9a6a0].map((c) => new THREE.Color(c));

export class Markers {
  readonly group = new THREE.Group();
  private rings: THREE.InstancedMesh;
  private blobs: THREE.InstancedMesh;
  private pings: { mesh: THREE.Mesh; t: number }[] = [];
  private carry: THREE.InstancedMesh;
  private hpBg: THREE.InstancedMesh;
  private hpFg: THREE.InstancedMesh;
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
    this.carry = new THREE.InstancedMesh(carryBundle(), new THREE.MeshLambertMaterial({ flatShading: true }), CAPACITY);
    this.carry.count = 0;
    this.carry.frustumCulled = false;
    this.carry.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carry.setColorAt(0, new THREE.Color());
    // 血條（面向鏡頭的扁平長條）
    const bar = new THREE.PlaneGeometry(1, 1);
    this.hpBg = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: 0x1a0f0a, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false, toneMapped: false }), CAPACITY);
    this.hpFg = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false }), CAPACITY);
    for (const m of [this.hpBg, this.hpFg]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.hpBg.renderOrder = 8;
    this.hpFg.renderOrder = 9;
    this.hpFg.setColorAt(0, new THREE.Color());
    this.group.add(this.blobs, this.rings, this.carry, this.hpBg, this.hpFg);
  }

  private bars = 0;
  private readonly bq = new THREE.Quaternion();
  private readonly right = new THREE.Vector3();
  private readonly bp = new THREE.Vector3();
  private readonly bs = new THREE.Vector3();
  private readonly bm = new THREE.Matrix4();
  private readonly bc = new THREE.Color();

  /** 畫一條血條：中心 (x,y,z)、寬 width、比例 ratio */
  private bar(x: number, y: number, z: number, width: number, ratio: number, own: boolean): void {
    const n = this.bars++;
    const h = 0.06 + width * 0.015;
    this.bp.set(x, y, z);
    this.bs.set(width + 0.04, h + 0.04, 1);
    this.bm.compose(this.bp, this.bq, this.bs);
    this.hpBg.setMatrixAt(n, this.bm);
    const r = Math.max(0, Math.min(1, ratio));
    this.bp.set(x, y, z).addScaledVector(this.right, -((1 - r) * width) / 2);
    this.bs.set(Math.max(0.001, width * r), h, 1);
    this.bm.compose(this.bp, this.bq, this.bs);
    this.hpFg.setMatrixAt(n, this.bm);
    if (own) this.bc.setHSL(0.33 * r, 0.9, 0.55);
    else this.bc.setHSL(0.0, 0.9, 0.55);
    this.hpFg.setColorAt(n, this.bc);
  }

  /** 在地面點一個波紋（下移動指令時） */
  ping(x: number, y: number, z: number, color = 0x7dff8a): void {
    const p = this.pings.reduce((a, b) => (a.t > b.t ? a : b));
    p.t = 0;
    p.mesh.position.set(x, y + 0.05, z);
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    p.mesh.visible = true;
  }

  update(units: UnitRenderer, selected: Set<number>, world: World, myPlayer: number, dt: number, ctx: MarkerContext): void {
    const owners = world.owner;
    const alive = world.alive;
    const high = world.high;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    // 血條：選取中或受傷的單位、選取中或受損的建築
    this.bars = 0;
    this.bq.copy(ctx.camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.bq);
    const sc = UNIT_LOOK.scale;
    for (let id = 0; id < high; id++) {
      if (!alive[id] || world.state[id] === S.Dead || !units.seen[id]) continue;
      const def = UNIT_DEFS[world.utype[id]];
      if (world.hp[id] >= def.hp && !selected.has(id)) continue;
      const tall = def.tags & 2 ? 1.45 : 1.15;
      this.bar(units.wx[id], units.wy[id] + tall * sc, units.wz[id], 0.55, world.hp[id] / def.hp, owners[id] === myPlayer);
    }
    const bs = ctx.sim.buildings;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b]) continue;
      const def = BUILDING_DEFS[bs.btype[b]];
      if (bs.hp[b] >= def.hp && b !== ctx.selBuilding) continue;
      if (!bs.complete[b] && b !== ctx.selBuilding) continue;
      const cx = bs.tx[b] + def.w / 2;
      const cz = bs.ty[b] + def.h / 2;
      if (bs.owner[b] !== myPlayer && !ctx.explored(Math.floor(cx), Math.floor(cz))) continue;
      const y = units.groundAt(cx, cz) + ctx.buildingHeight(bs.btype[b]) + 0.35;
      this.bar(cx, y, cz, Math.max(0.8, def.w * 0.7), bs.hp[b] / def.hp, bs.owner[b] === myPlayer);
    }
    this.hpBg.count = this.bars;
    this.hpFg.count = this.bars;
    this.hpBg.instanceMatrix.needsUpdate = true;
    this.hpFg.instanceMatrix.needsUpdate = true;
    if (this.hpFg.instanceColor) this.hpFg.instanceColor.needsUpdate = true;
    // 背上的資源
    let k = 0;
    for (let id = 0; id < high; id++) {
      if (!alive[id] || world.carry[id] <= 0 || world.state[id] === S.Dead) continue;
      const yaw = units.yaw[id];
      const bx = units.wx[id] - Math.sin(yaw) * 0.17 * sc;
      const bz = units.wz[id] - Math.cos(yaw) * 0.17 * sc;
      const s = (0.6 + Math.min(1, world.carry[id] / 10) * 0.6) * sc;
      m.makeRotationY(yaw).scale(new THREE.Vector3(s, s, s)).setPosition(bx, units.wy[id] + 0.42 * sc, bz);
      this.carry.setMatrixAt(k, m);
      this.carry.setColorAt(k, CARRY_COLORS[world.carryRes[id]]);
      k++;
    }
    this.carry.count = k;
    this.carry.instanceMatrix.needsUpdate = true;
    if (this.carry.instanceColor) this.carry.instanceColor.needsUpdate = true;
    let n = 0;
    for (const id of selected) {
      if (!units.seen[id]) continue;
      const big = UNIT_DEFS[world.utype[id]].radiusFx > 320 ? 1.3 : 1;
      m.makeTranslation(units.wx[id], units.wy[id] + 0.03, units.wz[id]).scale(new THREE.Vector3(big, 1, big));
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
        if (!alive[id] || !units.seen[id]) continue;
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
