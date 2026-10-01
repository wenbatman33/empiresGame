// 程式建模的佔位 Q 版兵（docs/07 §8.3）
// 部件組合（頭、身、四肢、兵器）＋ 程式關鍵影格動畫；載入時烘焙成 VAT
import * as THREE from 'three';

export type AnimName = 'idle' | 'walk' | 'attack' | 'die' | 'work';
export interface AnimSpec {
  frames: number;
  dur: number;
  loop: boolean;
}
export const ANIMS: Record<AnimName, AnimSpec> = {
  idle: { frames: 12, dur: 2.4, loop: true },
  walk: { frames: 12, dur: 0.72, loop: true },
  attack: { frames: 14, dur: 1.0, loop: true },
  die: { frames: 12, dur: 1.1, loop: false },
  work: { frames: 12, dur: 1.0, loop: true },
};
export const ANIM_ORDER: AnimName[] = ['idle', 'walk', 'attack', 'die', 'work'];

/** 部件 */
export const P = { body: 0, head: 1, armL: 2, armR: 3, legL: 4, legR: 5, weapon: 6, offhand: 7 } as const;
const PART_COUNT = 8;
/** 父部件（-1 ＝ 根） */
export const PARENT = [-1, P.body, P.body, P.body, -1, -1, P.armR, P.armL];
/** 關節位置（靜止姿勢的模型空間） */
export const PIVOT: [number, number, number][] = [
  [0, 0.2, 0], // 身體：髖
  [0, 0.45, 0], // 頭：脖子
  [0.17, 0.41, 0], // 左肩（角色面向 +z，左手在 +x）
  [-0.17, 0.41, 0], // 右肩
  [0.065, 0.2, 0], // 左髖
  [-0.065, 0.2, 0], // 右髖
  [-0.17, 0.2, 0.02], // 右手握點
  [0.17, 0.2, 0.02], // 左手握點
];
/** 根部轉軸（倒地時以腳跟為支點） */
export const ROOT_PIVOT: [number, number, number] = [0, 0, -0.12];

export type WeaponKind = 'sword' | 'spear' | 'bow' | 'tool';
export type HatKind = 'helmet' | 'straw' | 'band';

export interface SoldierSpec {
  kind: WeaponKind;
  hat: HatKind;
  cloth: number;
  trim: number;
  pants: number;
  shield?: boolean;
  pauldrons?: boolean;
}

/** 各兵種外觀（docs/03 §5 剪影重點） */
export const SOLDIER_SPECS: Record<string, SoldierSpec> = {
  villager: { kind: 'tool', hat: 'straw', cloth: 0xb9a27a, trim: 0x8a7350, pants: 0x6b5a45 },
  swordsman: { kind: 'sword', hat: 'helmet', cloth: 0x8a5a3b, trim: 0x6f7780, pants: 0x4a3a2c, shield: true, pauldrons: true },
  spearman: { kind: 'spear', hat: 'helmet', cloth: 0x6d5236, trim: 0x8b6b45, pants: 0x3f352a, pauldrons: true },
  archer: { kind: 'bow', hat: 'band', cloth: 0x5f7a3a, trim: 0x7a6a40, pants: 0x46402e },
};

const SKIN = 0xf3c9a0;
const HAIR = 0x2b211c;
const IRON = 0x7f8a94;
const STEEL = 0xd8dee5;
const WOOD = 0x8b5a2b;
const DARK = 0x1c1714;

/** 動畫姿勢：每個部件的 [rx, ry, rz]，加上根部位移與傾倒 */
export interface Pose {
  r: number[][];
  root: { y: number; z: number; rx: number };
}

// ───────── 幾何 ─────────

export interface ModelGeometry {
  position: Float32Array;
  color: Float32Array;
  mask: Float32Array;
  part: Uint8Array;
  vertexCount: number;
}

class Builder {
  private pos: number[] = [];
  private col: number[] = [];
  private msk: number[] = [];
  private prt: number[] = [];

  add(geo: THREE.BufferGeometry, part: number, color: number, mask: number, m: THREE.Matrix4): void {
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
    geo.dispose();
  }

  build(): ModelGeometry {
    return {
      position: Float32Array.from(this.pos),
      color: Float32Array.from(this.col),
      mask: Float32Array.from(this.msk),
      part: Uint8Array.from(this.prt),
      vertexCount: this.pos.length / 3,
    };
  }
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
function M(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg: number, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const ico = (r: number, detail: number) => new THREE.IcosahedronGeometry(r, detail);
const cone = (r: number, h: number, seg: number) => new THREE.ConeGeometry(r, h, seg);

export function buildSoldier(spec: SoldierSpec): ModelGeometry {
  const b = new Builder();
  // 腿與鞋
  for (const [part, sx] of [[P.legL, 0.065], [P.legR, -0.065]] as const) {
    b.add(box(0.1, 0.17, 0.11), part, spec.pants, 0, M(sx, 0.115, 0));
    b.add(box(0.11, 0.05, 0.15), part, DARK, 0, M(sx, 0.025, 0.02));
  }
  // 身體：上衣、下擺、隊伍色腰帶
  b.add(cyl(0.13, 0.15, 0.24, 7, true), P.body, spec.cloth, 0, M(0, 0.33, 0));
  b.add(cyl(0.15, 0.175, 0.09, 7, true), P.body, spec.trim, 0, M(0, 0.225, 0));
  b.add(cyl(0.142, 0.142, 0.045, 7, true), P.body, 0xffffff, 1, M(0, 0.29, 0));
  if (spec.pauldrons) {
    b.add(box(0.1, 0.05, 0.13), P.body, 0xffffff, 1, M(0.15, 0.435, 0, 0, 0, -0.35));
    b.add(box(0.1, 0.05, 0.13), P.body, 0xffffff, 1, M(-0.15, 0.435, 0, 0, 0, 0.35));
  }
  if (spec.kind === 'bow') {
    // 背上箭筒與箭羽
    b.add(cyl(0.045, 0.045, 0.28, 6), P.body, WOOD, 0, M(0.05, 0.38, -0.17, 0.25, 0, -0.35));
    b.add(cone(0.05, 0.08, 5), P.body, 0xf4efe2, 0, M(0.1, 0.54, -0.21, 0.25, 0, -0.35));
  }
  // 頭：大頭、頭髮、眼睛
  b.add(ico(0.165, 1), P.head, SKIN, 0, M(0, 0.6, 0));
  b.add(new THREE.SphereGeometry(0.172, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.62), P.head, HAIR, 0, M(0, 0.62, -0.03, -0.35, 0, 0, 1, 0.95, 1));
  b.add(box(0.032, 0.05, 0.012), P.head, DARK, 0, M(0.058, 0.6, 0.158));
  b.add(box(0.032, 0.05, 0.012), P.head, DARK, 0, M(-0.058, 0.6, 0.158));
  if (spec.hat === 'helmet') {
    b.add(new THREE.SphereGeometry(0.182, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), P.head, IRON, 0, M(0, 0.63, -0.01));
    b.add(cyl(0.188, 0.188, 0.03, 8, true), P.head, IRON, 0, M(0, 0.63, -0.01));
    b.add(cone(0.04, 0.13, 5), P.head, 0xffffff, 1, M(0, 0.86, -0.01));
  } else if (spec.hat === 'straw') {
    b.add(cone(0.3, 0.13, 9), P.head, 0xd9b96a, 0, M(0, 0.78, 0));
  } else {
    b.add(cyl(0.172, 0.172, 0.055, 8, true), P.head, 0xffffff, 1, M(0, 0.67, -0.01));
    b.add(ico(0.065, 0), P.head, HAIR, 0, M(0, 0.79, -0.05));
  }
  // 手臂與手
  b.add(box(0.075, 0.2, 0.08), P.armL, spec.cloth, 0, M(0.17, 0.31, 0));
  b.add(box(0.075, 0.2, 0.08), P.armR, spec.cloth, 0, M(-0.17, 0.31, 0));
  b.add(box(0.07, 0.07, 0.07), P.armL, SKIN, 0, M(0.17, 0.195, 0.01));
  b.add(box(0.07, 0.07, 0.07), P.armR, SKIN, 0, M(-0.17, 0.195, 0.01));

  // 兵器（放大 1.5 倍以利辨識，docs/07 §8.1）
  const hx = -0.17;
  const hy = 0.2;
  const hz = 0.03;
  if (spec.kind === 'sword') {
    // 刀身指向前上方
    const a = 1.15;
    const dy = Math.cos(a);
    const dz = Math.sin(a);
    b.add(box(0.04, 0.36, 0.014), P.weapon, STEEL, 0, M(hx, hy + dy * 0.22, hz + dz * 0.22, a));
    b.add(box(0.11, 0.025, 0.035), P.weapon, 0x9a7a2a, 0, M(hx, hy + dy * 0.04, hz + dz * 0.04, a));
  } else if (spec.kind === 'spear') {
    b.add(cyl(0.017, 0.017, 1.45, 5), P.weapon, WOOD, 0, M(hx, hy + 0.47, hz));
    b.add(cone(0.042, 0.17, 5), P.weapon, STEEL, 0, M(hx, hy + 1.28, hz));
    b.add(cone(0.055, 0.08, 6), P.weapon, 0xffffff, 1, M(hx, hy + 1.16, hz, Math.PI));
  } else if (spec.kind === 'tool') {
    b.add(cyl(0.016, 0.016, 0.62, 5), P.weapon, WOOD, 0, M(hx, hy + 0.2, hz));
    b.add(box(0.05, 0.04, 0.14), P.weapon, IRON, 0, M(hx, hy + 0.5, hz + 0.06));
  }
  if (spec.shield) {
    b.add(cyl(0.155, 0.155, 0.03, 8), P.offhand, WOOD, 0, M(0.21, 0.27, 0.1, Math.PI / 2, 0, Math.PI / 8));
    b.add(new THREE.CircleGeometry(0.115, 8), P.offhand, 0xffffff, 1, M(0.21, 0.27, 0.117, 0, 0, Math.PI / 8));
    b.add(cone(0.04, 0.05, 5), P.offhand, IRON, 0, M(0.21, 0.27, 0.13, Math.PI / 2));
  }
  if (spec.kind === 'bow') {
    // 弓身朝前彎，弓弦在後
    const R = 0.32;
    const bowGeo = new THREE.TorusGeometry(R, 0.017, 3, 8, Math.PI * 0.8);
    bowGeo.rotateZ(-Math.PI * 0.4);
    bowGeo.rotateY(-Math.PI / 2);
    b.add(bowGeo, P.offhand, WOOD, 0, M(0.17, 0.2, 0.05 - R));
    b.add(box(0.006, 0.6, 0.006), P.offhand, 0xf4efe2, 0, M(0.17, 0.2, 0.05 - R + R * Math.cos(Math.PI * 0.4)));
  }
  return b.build();
}

// ───────── 動畫姿勢 ─────────

const TAU = Math.PI * 2;
const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 依時間軸 [t0, v0, t1, v1, ...] 平滑內插 */
function track(t: number, keys: number[]): number {
  if (t <= keys[0]) return keys[1];
  for (let i = 2; i < keys.length; i += 2) {
    if (t <= keys[i]) {
      const k = (t - keys[i - 2]) / (keys[i] - keys[i - 2]);
      return lerp(keys[i - 1], keys[i + 1], ease(k));
    }
  }
  return keys[keys.length - 1];
}

export function poseAt(kind: WeaponKind, anim: AnimName, t: number): Pose {
  const r: number[][] = Array.from({ length: PART_COUNT }, () => [0, 0, 0]);
  const root = { y: 0, z: 0, rx: 0 };
  const baseR = kind === 'spear' ? -0.25 : kind === 'sword' ? -0.15 : kind === 'tool' ? -0.2 : 0;
  const baseL = kind === 'bow' ? -0.25 : kind === 'sword' ? -0.35 : 0;
  r[P.armR][0] = baseR;
  r[P.armL][0] = baseL;

  if (anim === 'idle') {
    const s = Math.sin(TAU * t);
    r[P.body][0] = 0.03 * s;
    r[P.head][1] = 0.2 * Math.sin(TAU * t + 1);
    r[P.armL][0] = baseL + 0.06 * s;
    r[P.armR][0] = baseR - 0.06 * s;
    root.y = 0.006 * Math.sin(TAU * t * 2);
  } else if (anim === 'walk') {
    const s = Math.sin(TAU * t);
    r[P.legL][0] = -0.65 * s;
    r[P.legR][0] = 0.65 * s;
    r[P.armL][0] = baseL + 0.5 * s;
    r[P.armR][0] = baseR - 0.5 * s * (kind === 'spear' ? 0.3 : 1);
    r[P.body][0] = 0.1;
    r[P.body][1] = 0.08 * s;
    r[P.head][0] = -0.06;
    root.y = 0.035 * Math.abs(Math.cos(TAU * t));
  } else if (anim === 'attack' && kind === 'sword') {
    // 舉刀過頭 → 劈下 → 回位
    r[P.armR][0] = track(t, [0, baseR, 0.42, -3.0, 0.56, 0.25, 0.8, 0.25, 1, baseR]);
    r[P.body][1] = track(t, [0, 0, 0.42, -0.3, 0.56, 0.35, 1, 0]);
    r[P.body][0] = track(t, [0, 0, 0.56, 0.2, 1, 0]);
    r[P.armL][0] = -0.6;
    r[P.legL][0] = -0.3;
    r[P.legR][0] = 0.25;
  } else if (anim === 'attack' && kind === 'spear') {
    // 槍平舉 → 後收 → 突刺
    const arm = track(t, [0, -0.85, 0.35, -0.7, 0.5, -1.2, 0.7, -1.2, 1, -0.85]);
    r[P.armR][0] = arm;
    r[P.weapon][0] = 1.55 - arm;
    r[P.armL][0] = track(t, [0, -0.9, 0.35, -0.8, 0.5, -1.2, 1, -0.9]);
    root.z = track(t, [0, 0, 0.35, -0.05, 0.5, 0.13, 0.7, 0.13, 1, 0]);
    r[P.body][0] = track(t, [0, 0.1, 0.5, 0.3, 1, 0.1]);
    r[P.legL][0] = -0.35;
    r[P.legR][0] = 0.3;
  } else if (anim === 'attack' && kind === 'bow') {
    // 側身舉弓 → 拉弦 → 放箭
    r[P.armL][0] = -1.5;
    r[P.offhand][0] = 1.5;
    r[P.armR][0] = track(t, [0, -1.0, 0.6, -1.55, 0.66, -1.2, 1, -1.0]);
    r[P.armR][2] = track(t, [0, 0, 0.6, -0.15, 0.66, -0.45, 1, 0]);
    r[P.body][1] = track(t, [0, -0.15, 0.6, -0.4, 1, -0.15]);
    r[P.head][1] = 0.3;
  } else if (anim === 'work' || anim === 'attack') {
    // 雙手舉工具過頭 → 往下鋤
    const arm = track(t, [0, -0.6, 0.45, -2.7, 0.6, -0.5, 0.8, -0.5, 1, -0.6]);
    r[P.armR][0] = arm;
    r[P.armL][0] = arm;
    r[P.armL][2] = -0.25;
    r[P.armR][2] = 0.1;
    r[P.weapon][0] = 0.5;
    r[P.body][0] = track(t, [0, 0.05, 0.45, -0.05, 0.6, 0.35, 1, 0.05]);
    r[P.legL][0] = -0.25;
    r[P.legR][0] = 0.2;
  } else if (anim === 'die') {
    const e = 1 - Math.pow(1 - Math.min(1, t / 0.75), 3);
    root.rx = -1.45 * e;
    root.z = -0.12 * e;
    root.y = 0.03 * Math.sin(Math.min(1, t / 0.75) * Math.PI);
    r[P.armL][2] = 0.9 * e;
    r[P.armR][2] = -0.9 * e;
    r[P.armL][0] = baseL - 0.6 * e;
    r[P.armR][0] = baseR - 0.6 * e;
    r[P.legL][0] = -0.4 * e;
    r[P.head][0] = -0.3 * e;
  }
  return { r, root };
}
