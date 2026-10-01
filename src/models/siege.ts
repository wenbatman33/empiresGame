// 攻城器械模型（docs/03 §5）：衝車（木屋頂 ＋ 撞木）、霹靂車（配重投石機）
// 一樣用部件 ＋ 程式動畫，烘成 VAT
import * as THREE from 'three';
import type { AnimName, ModelGeometry, Pose } from './soldier';

const WOOD = 0x8a5a32;
const WOOD_D = 0x6a4224;
const IRON = 0x6f7780;
const ROPE = 0xd9c79a;
const PLANK = 0x9a6a3c;

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

/** 木牛流馬：木製機關牛（部件 0 身體、1 頭、3–6 腿），背上貨箱 */
export function buildCart(): ModelGeometry {
  const b = new B();
  b.add(box(0.36, 0.3, 0.8), WOOD, M(0, 0.5, 0));
  for (const z of [-0.3, 0, 0.3]) b.add(box(0.38, 0.04, 0.04), IRON, M(0, 0.62, z));
  // 貨箱 ＋ 隊伍色蓋布
  b.add(box(0.44, 0.26, 0.5), WOOD_D, M(0, 0.78, -0.05));
  b.add(box(0.48, 0.05, 0.54), 0xffffff, M(0, 0.93, -0.05), 0, 1);
  // 尾巴
  b.add(box(0.04, 0.2, 0.04), WOOD_D, M(0, 0.5, -0.45, 0.5));
  // 頭與角
  b.add(box(0.22, 0.22, 0.3), WOOD, M(0, 0.68, 0.5), 1);
  b.add(box(0.16, 0.12, 0.08), WOOD_D, M(0, 0.62, 0.66), 1);
  for (const x of [-0.12, 0.12]) b.add(new THREE.ConeGeometry(0.03, 0.16, 4), 0xe8dcb8, M(x, 0.85, 0.46, 0, 0, x > 0 ? -0.5 : 0.5), 1);
  // 腿
  const legs: [number, number][] = [[0.12, 0.28], [-0.12, 0.28], [0.12, -0.28], [-0.12, -0.28]];
  legs.forEach(([x, z], i) => b.add(box(0.09, 0.36, 0.09), WOOD_D, M(x, 0.18, z), 3 + i));
  const pivot: [number, number, number][] = [[0, 0, 0], [0, 0.62, 0.38], [0, 0, 0], ...legs.map(([x, z]) => [x, 0.36, z] as [number, number, number])];
  return finish(b, pivot, [-1, 0, 0, 0, 0, 0, 0]);
}

/** 船（docs/03 §5）：部件 0 船身、1 帆／樓、2 左槳、3 右槳 */
export function buildShip(id: string): ModelGeometry {
  const b = new B();
  const spec: Record<string, { L: number; W: number; oars: number; hull: number }> = {
    fishing_boat: { L: 1.0, W: 0.42, oars: 0, hull: 0x9a6a3c },
    transport: { L: 1.5, W: 0.72, oars: 3, hull: 0x8a5a32 },
    galley: { L: 1.35, W: 0.5, oars: 4, hull: 0x7a4a2a },
    mengchong: { L: 1.5, W: 0.6, oars: 4, hull: 0x5a3a24 },
    louchuan: { L: 2.2, W: 0.9, oars: 5, hull: 0x6a4224 },
    fire_ship: { L: 1.1, W: 0.48, oars: 2, hull: 0x7a4a2a },
  };
  const sp = spec[id] ?? spec.galley;
  const { L, W } = sp;
  // 船身：底窄上寬 ＋ 船頭尖
  b.add(new THREE.CylinderGeometry(W / 2, W / 2.6, L * 0.8, 6, 1).rotateX(Math.PI / 2).scale(1, 0.55, 1), sp.hull, M(0, 0.14, -L * 0.05));
  b.add(new THREE.ConeGeometry(W / 2, L * 0.3, 6).rotateX(Math.PI / 2).scale(1, 0.55, 1), sp.hull, M(0, 0.14, L * 0.5));
  b.add(box(W * 0.95, 0.04, L * 0.78), PLANK, M(0, 0.28, -L * 0.05));
  b.add(box(W * 1.02, 0.05, L * 0.8), 0xffffff, M(0, 0.24, -L * 0.05), 0, 1);
  // 船尾舵
  b.add(box(0.04, 0.22, 0.14), WOOD_D, M(0, 0.18, -L * 0.48));
  const mast = (h: number, sail: number) => {
    b.add(cyl(0.025, h, 5), WOOD, M(0, 0.3 + h / 2, 0), 1);
    b.add(box(sail, h * 0.6, 0.02), 0xffffff, M(0, 0.3 + h * 0.55, 0.02), 1, 1);
  };
  if (id === 'fishing_boat') {
    mast(0.6, 0.32);
    b.add(box(0.3, 0.05, 0.3), 0xb8a87a, M(0, 0.32, -0.3));
  } else if (id === 'transport') {
    b.add(box(0.5, 0.3, 0.5), PLANK, M(0, 0.45, -0.35));
    b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.55, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), WOOD_D, M(0, 0.65, -0.35));
    mast(0.8, 0.5);
  } else if (id === 'galley') {
    mast(0.75, 0.42);
    b.add(box(0.36, 0.12, 0.3), PLANK, M(0, 0.36, 0.35));
  } else if (id === 'mengchong') {
    // 生牛皮蓋頂 ＋ 鐵衝角
    b.add(new THREE.CylinderGeometry(W * 0.48, W * 0.48, L * 0.7, 6, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), 0x6a5038, M(0, 0.3, -0.05));
    b.add(new THREE.ConeGeometry(0.07, 0.35, 5).rotateX(Math.PI / 2), IRON, M(0, 0.16, L * 0.72));
    b.add(box(0.2, 0.12, 0.02), 0xffffff, M(0, 0.48, L * 0.3), 0, 1);
  } else if (id === 'louchuan') {
    // 三層樓
    b.add(box(W * 0.85, 0.32, L * 0.55), 0xb8392f, M(0, 0.46, -0.1), 1);
    b.add(box(W * 0.95, 0.04, L * 0.6), PLANK, M(0, 0.64, -0.1), 1);
    b.add(box(W * 0.65, 0.28, L * 0.38), 0xb8392f, M(0, 0.8, -0.1), 1);
    b.add(box(W * 0.75, 0.04, L * 0.42), PLANK, M(0, 0.96, -0.1), 1);
    b.add(box(W * 0.42, 0.24, L * 0.2), 0xb8392f, M(0, 1.1, -0.1), 1);
    b.add(new THREE.ConeGeometry(W * 0.4, 0.22, 4).rotateY(Math.PI / 4), 0x34383e, M(0, 1.33, -0.1), 1);
    for (const z of [-L * 0.35, L * 0.2]) {
      b.add(cyl(0.02, 0.9, 4), WOOD, M(W * 0.4, 0.75, z), 1);
      b.add(box(0.02, 0.26, 0.24), 0xffffff, M(W * 0.4, 1.05, z + 0.13), 1, 1);
    }
  } else if (id === 'fire_ship') {
    // 滿載柴草 ＋ 船頭火盆
    for (const [x, z] of [[-0.1, -0.2], [0.1, -0.05], [-0.08, 0.12], [0.1, -0.32]]) b.add(new THREE.IcosahedronGeometry(0.13, 0), 0xd9b96a, M(x, 0.38, z));
    b.add(cyl(0.08, 0.1, 6), IRON, M(0, 0.36, L * 0.35));
    b.add(new THREE.ConeGeometry(0.08, 0.2, 5), 0xff8a2a, M(0, 0.5, L * 0.35));
    b.add(box(0.2, 0.14, 0.02), 0xffffff, M(0, 0.6, -0.4), 0, 1);
  }
  // 槳（部件 2 左、3 右）
  for (let k = 0; k < sp.oars; k++) {
    const z = -L * 0.3 + (k * L * 0.55) / Math.max(1, sp.oars - 1);
    b.add(box(0.36, 0.02, 0.04), WOOD, M(W / 2 + 0.16, 0.2, z, 0, 0, -0.35), 2);
    b.add(box(0.36, 0.02, 0.04), WOOD, M(-W / 2 - 0.16, 0.2, z, 0, 0, 0.35), 3);
  }
  const pivot: [number, number, number][] = [[0, 0, 0], [0, 0.3, 0], [W / 2, 0.26, 0], [-W / 2, 0.26, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  return finish(b, pivot, [-1, 0, 0, 0, 0, 0, 0]);
}

/** 依單位 id 建車船模型 */
export function buildSiege(id: string, kind: 'ram' | 'trebuchet' | 'cart' | 'ship'): ModelGeometry {
  if (kind === 'ram') return buildRam();
  if (kind === 'trebuchet') return buildTrebuchet();
  if (kind === 'cart') return buildCart();
  return buildShip(id);
}

const TAU = Math.PI * 2;

export function siegePose(kind: 'ram' | 'trebuchet' | 'cart' | 'ship', anim: AnimName, t: number): Pose {
  const r: number[][] = Array.from({ length: Math.max(PARTS, 14) }, () => [0, 0, 0]);
  const root = { y: 0, z: 0, rx: 0, rz: 0 };
  if (kind === 'ship') {
    // 船：隨波起伏；划槳；沉沒
    root.y = 0.025 * Math.sin(TAU * t);
    root.rz = 0.035 * Math.sin(TAU * t + 1);
    if (anim === 'walk') {
      r[2][1] = 0.5 * Math.sin(TAU * t);
      r[3][1] = -0.5 * Math.sin(TAU * t);
      root.rx = -0.03;
    }
    if (anim === 'attack') root.rx = 0.05 * Math.sin(TAU * t);
    if (anim === 'die') {
      const e2 = Math.min(1, t * 1.2);
      root.y = -0.7 * e2;
      root.rx = 0.45 * e2;
      root.rz = 0.2 * e2;
    }
    return { r, root };
  }
  if (kind === 'cart') {
    if (anim === 'walk') {
      const s2 = Math.sin(TAU * t);
      r[3][0] = 0.5 * s2;
      r[6][0] = 0.5 * s2;
      r[4][0] = -0.5 * s2;
      r[5][0] = -0.5 * s2;
      r[1][0] = 0.08 * Math.sin(TAU * t * 2);
      root.y = 0.015 * Math.abs(Math.cos(TAU * t));
    }
    if (anim === 'idle') r[1][0] = 0.06 * Math.sin(TAU * t);
    if (anim === 'die') root.rz = 1.3 * Math.min(1, t * 1.5);
    return { r, root };
  }
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
