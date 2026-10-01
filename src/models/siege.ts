// 攻城器械模型（docs/03 §5）：衝車（木屋頂 ＋ 撞木）、霹靂車（配重投石機）
// 一樣用部件 ＋ 程式動畫，烘成 VAT
import * as THREE from 'three';
import type { AnimName, ModelGeometry, Pose } from './soldier';

const WOOD = 0x8a5a32;
const WOOD_D = 0x6a4224;
const IRON = 0x6f7780;
const ROPE = 0xd9c79a;

/** 部件：0 車身、1 撞木／拋臂、2 配重、3–6 輪子 */
const PARTS = 7;

class B {
  pos: number[] = [];
  col: number[] = [];
  msk: number[] = [];
  prt: number[] = [];
  add(geo: THREE.BufferGeometry, color: number, m: THREE.Matrix4, part = 0, mask = 0): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(m);
    const p = g.getAttribute('position');
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.msk.push(mask);
      this.prt.push(part);
    }
  }
}

const q = new THREE.Quaternion();
const e = new THREE.Euler();
const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r: number, h: number, seg: number) => new THREE.CylinderGeometry(r, r, h, seg);

function finish(b: B, pivot: [number, number, number][], parent: number[]): ModelGeometry {
  return {
    position: Float32Array.from(b.pos),
    color: Float32Array.from(b.col),
    mask: Float32Array.from(b.msk),
    part: Uint8Array.from(b.prt),
    vertexCount: b.pos.length / 3,
    parent,
    pivot,
    rootPivot: [0, 0, 0],
    mounted: false,
  };
}

export function buildRam(): ModelGeometry {
  const b = new B();
  // 車架、立柱、三角屋頂（隊伍色屋簷）
  b.add(box(0.7, 0.12, 1.2), WOOD_D, M(0, 0.32, 0));
  for (const x of [-0.32, 0.32]) for (const z of [-0.5, 0.5]) b.add(box(0.07, 0.55, 0.07), WOOD, M(x, 0.64, z));
  const roof = new THREE.CylinderGeometry(0.5, 0.5, 1.3, 3, 1, false);
  roof.rotateX(Math.PI / 2);
  b.add(roof, WOOD, M(0, 1.02, 0));
  b.add(box(0.8, 0.06, 1.34), 0xffffff, M(0, 0.86, 0), 0, 1);
  // 撞木（部件 1，吊在屋頂下）
  b.add(cyl(0.11, 1.5, 7), WOOD, M(0, 0.58, 0.15, Math.PI / 2), 1);
  b.add(cyl(0.15, 0.18, 7), IRON, M(0, 0.58, 0.92, Math.PI / 2), 1);
  b.add(box(0.03, 0.3, 0.03), ROPE, M(0, 0.74, -0.2), 1);
  b.add(box(0.03, 0.3, 0.03), ROPE, M(0, 0.74, 0.5), 1);
  // 輪子（部件 3–6）
  const wheels: [number, number][] = [[-0.42, -0.38], [0.42, -0.38], [-0.42, 0.38], [0.42, 0.38]];
  wheels.forEach(([x, z], i) => b.add(cyl(0.2, 0.08, 8), WOOD_D, M(x, 0.2, z, 0, 0, Math.PI / 2), 3 + i));
  const pivot: [number, number, number][] = [[0, 0, 0], [0, 0.88, 0.15], [0, 0, 0], ...wheels.map(([x, z]) => [x, 0.2, z] as [number, number, number])];
  return finish(b, pivot, [-1, 0, 1, 0, 0, 0, 0]);
}

export function buildTrebuchet(): ModelGeometry {
  const b = new B();
  // 底座與 A 字架（隊伍色底布）
  b.add(box(0.9, 0.12, 1.4), WOOD_D, M(0, 0.12, 0));
  for (const x of [-0.32, 0.32]) {
    b.add(box(0.08, 1.25, 0.08), WOOD, M(x, 0.68, -0.22, 0.35));
    b.add(box(0.08, 1.25, 0.08), WOOD, M(x, 0.68, 0.22, -0.35));
  }
  b.add(box(0.75, 0.08, 0.08), IRON, M(0, 1.25, 0));
  b.add(box(0.94, 0.06, 0.3), 0xffffff, M(0, 0.2, 0.55), 0, 1);
  // 拋臂（部件 1）：長的一端在後、短的一端掛配重
  b.add(box(0.07, 0.07, 2.0), WOOD, M(0, 1.25, -0.35), 1);
  b.add(box(0.04, 0.04, 0.4), ROPE, M(0, 1.1, -1.4, 0.6), 1);
  // 配重（部件 2，掛在拋臂短端）
  b.add(box(0.36, 0.36, 0.36), IRON, M(0, 0.95, 0.55), 2);
  b.add(box(0.05, 0.3, 0.05), ROPE, M(0, 1.15, 0.55), 2);
  const pivot: [number, number, number][] = [[0, 0, 0], [0, 1.25, 0], [0, 1.25, 0.55], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  return finish(b, pivot, [-1, 0, 1, 0, 0, 0, 0]);
}

const TAU = Math.PI * 2;

export function siegePose(kind: 'ram' | 'trebuchet', anim: AnimName, t: number): Pose {
  const r: number[][] = Array.from({ length: Math.max(PARTS, 14) }, () => [0, 0, 0]);
  const root = { y: 0, z: 0, rx: 0, rz: 0 };
  if (kind === 'ram') {
    if (anim === 'walk') for (let k = 3; k <= 6; k++) r[k][0] = TAU * t;
    if (anim === 'attack') r[1][0] = t < 0.5 ? -0.5 * Math.sin(t * Math.PI * 2) : 0.35 * Math.sin((t - 0.5) * Math.PI * 2);
    if (anim === 'die') root.rz = 0.5 * Math.min(1, t * 2);
    if (anim === 'idle') root.y = 0;
  } else {
    // 拋臂：靜止時長臂朝後下；攻擊時甩過頭頂
    const rest = -0.55;
    let arm = rest;
    if (anim === 'attack') arm = t < 0.25 ? rest + (t / 0.25) * 2.6 : t < 0.5 ? rest + 2.6 : rest + 2.6 * (1 - (t - 0.5) / 0.5);
    r[1][0] = arm;
    r[2][0] = -arm;
    if (anim === 'walk') root.y = 0.02 * Math.abs(Math.sin(TAU * t));
    if (anim === 'die') root.rz = 0.6 * Math.min(1, t * 2);
  }
  return { r, root };
}
