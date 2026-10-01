// 程式建模的佔位 Q 版兵（docs/07 §8.3）：步兵與騎兵（馬 ＋ 騎手）
// 部件組合 ＋ 程式關鍵影格動畫；載入時烘焙成 VAT
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

/** 部件：騎手 0–7，馬 8–13 */
export const P = { body: 0, head: 1, armL: 2, armR: 3, legL: 4, legR: 5, weapon: 6, offhand: 7, horse: 8, hHead: 9, legFL: 10, legFR: 11, legBL: 12, legBR: 13 } as const;
const PART_COUNT = 14;
/** 騎手坐在馬上的高度 */
const SADDLE = 0.36;

export type WeaponKind = 'sword' | 'spear' | 'bow' | 'tool' | 'fan' | 'ram' | 'trebuchet' | 'cart' | 'ship';
export type HatKind = 'helmet' | 'straw' | 'band' | 'crown' | 'scholar';

export interface SoldierSpec {
  kind: WeaponKind;
  hat: HatKind;
  cloth: number;
  trim: number;
  pants: number;
  shield?: boolean;
  pauldrons?: boolean;
  /** 騎兵：馬的毛色；barding ＝ 披甲戰馬 */
  horse?: number;
  barding?: boolean;
  /** 背旗（斥候） */
  backFlag?: boolean;
  /** 戟：槍頭旁加月牙刃 */
  halberd?: boolean;
  /** 頭盔紅纓改金色（精銳） */
  elite?: boolean;
  /** 武將：整體放大（docs/02 §3.3：一般兵的 1.3 倍） */
  scale?: number;
  /** 臉色（關羽紅臉、張飛黑臉） */
  face?: number;
  /** 鬍鬚：顏色與樣式（long 過胸長鬚、bushy 虯鬚） */
  beard?: number;
  beardStyle?: 'long' | 'bushy';
  /** 帽子／頭巾顏色 */
  hatColor?: number;
  /** 披風 */
  cape?: number;
  /** 雙手持兵（劉備雙股劍、甘寧雙刀） */
  dual?: boolean;
  /** 偃月刀：大月牙刃 */
  glaive?: boolean;
  /** 長袍（文官、謀士） */
  robe?: boolean;
  /** 獨眼眼罩（夏侯惇） */
  eyePatch?: boolean;
}

/** 各兵種外觀（docs/03 §5 剪影重點） */
export const SOLDIER_SPECS: Record<string, SoldierSpec> = {
  villager: { kind: 'tool', hat: 'straw', cloth: 0xb9a27a, trim: 0x8a7350, pants: 0x6b5a45 },
  swordsman: { kind: 'sword', hat: 'helmet', cloth: 0x8a5a3b, trim: 0x6f7780, pants: 0x4a3a2c, shield: true, pauldrons: true },
  spearman: { kind: 'spear', hat: 'helmet', cloth: 0x6d5236, trim: 0x8b6b45, pants: 0x3f352a, pauldrons: true },
  archer: { kind: 'bow', hat: 'band', cloth: 0x5f7a3a, trim: 0x7a6a40, pants: 0x46402e },
  scout: { kind: 'sword', hat: 'band', cloth: 0x9a7a4a, trim: 0x7a6040, pants: 0x4a3a2c, horse: 0xb08850, backFlag: true },
  light_cav: { kind: 'spear', hat: 'helmet', cloth: 0x7a5a3a, trim: 0x8b6b45, pants: 0x3f352a, horse: 0x8a5a32 },
  heavy_cav: { kind: 'sword', hat: 'helmet', cloth: 0x5a5f66, trim: 0x6f7780, pants: 0x3a3a3a, horse: 0x4a3a30, barding: true, pauldrons: true, shield: true },
  horse_archer: { kind: 'bow', hat: 'band', cloth: 0x6a7a3a, trim: 0x7a6a40, pants: 0x46402e, horse: 0xa0703f },
  elite_swordsman: { kind: 'sword', hat: 'helmet', cloth: 0x6a2f24, trim: 0xb8952f, pants: 0x3a2a20, shield: true, pauldrons: true, elite: true },
  halberdier: { kind: 'spear', hat: 'helmet', cloth: 0x5a4430, trim: 0x8b6b45, pants: 0x3f352a, pauldrons: true, halberd: true },
  crossbowman: { kind: 'bow', hat: 'helmet', cloth: 0x45602e, trim: 0x6f7780, pants: 0x3a3a2a, pauldrons: true },
  swift_cav: { kind: 'spear', hat: 'helmet', cloth: 0x8a3a2a, trim: 0xb8952f, pants: 0x3f352a, horse: 0xc9b896, elite: true },
  iron_cav: { kind: 'sword', hat: 'helmet', cloth: 0x3c4148, trim: 0x2a2d32, pants: 0x2a2a2a, horse: 0x2a2420, barding: true, pauldrons: true, shield: true, elite: true },
  // 勢力特殊兵種
  tiger_cav: { kind: 'spear', hat: 'helmet', cloth: 0x3a3226, trim: 0xd08a2a, pants: 0x2a2420, horse: 0x2a2420, barding: true, pauldrons: true, elite: true, glaive: true },
  repeater: { kind: 'bow', hat: 'helmet', cloth: 0x3f6a3a, trim: 0x8b6b45, pants: 0x3a3a2a, pauldrons: true },
  danyang: { kind: 'sword', hat: 'helmet', cloth: 0x2f4f7a, trim: 0x6f7780, pants: 0x2a3040, shield: true, pauldrons: true, elite: true },
  strategist: { kind: 'fan', hat: 'scholar', cloth: 0xe8e0c8, trim: 0x2a2d32, pants: 0x4a4a4a, robe: true, hatColor: 0x2a2d32 },
  phantom: { kind: 'sword', hat: 'helmet', cloth: 0xcfd6dc, trim: 0xe4e8ec, pants: 0xb8c0c8, shield: true },
  // 武將（docs/02 §3.3 剪影與配色）
  hero_liubei: { kind: 'sword', hat: 'crown', cloth: 0x3f7a46, trim: 0xd9b13b, pants: 0x2f4a32, horse: 0xd8d0c0, dual: true, cape: 0x2f6a3a, beard: 0x2b211c, beardStyle: 'long', hatColor: 0x2a2018, scale: 1.3 },
  hero_guanyu: { kind: 'spear', hat: 'band', cloth: 0x2f6a3a, trim: 0xd9b13b, pants: 0x24402a, horse: 0xa8321f, face: 0xc8463a, beard: 0x1a1210, beardStyle: 'long', hatColor: 0x2f6a3a, glaive: true, cape: 0x2f6a3a, scale: 1.3 },
  hero_zhangfei: { kind: 'spear', hat: 'helmet', cloth: 0x3a3a46, trim: 0x6f7780, pants: 0x2a2a30, face: 0x6a5240, beard: 0x111111, beardStyle: 'bushy', pauldrons: true, elite: true, scale: 1.3 },
  hero_zhaoyun: { kind: 'spear', hat: 'helmet', cloth: 0xeeeef2, trim: 0xc8ccd2, pants: 0xb8bcc4, horse: 0xf2f0ea, pauldrons: true, elite: true, cape: 0xf4f4f8, scale: 1.3 },
  hero_zhuge: { kind: 'fan', hat: 'scholar', cloth: 0xeeeae0, trim: 0x2a2d32, pants: 0x3a3a3a, robe: true, hatColor: 0x2a2d32, beard: 0x2b211c, beardStyle: 'long', scale: 1.3 },
  hero_caocao: { kind: 'sword', hat: 'crown', cloth: 0x2a2d3a, trim: 0xd9b13b, pants: 0x1e2028, horse: 0x2a2420, cape: 0xa8322d, beard: 0x2b211c, beardStyle: 'long', hatColor: 0x1a1a1a, scale: 1.3 },
  hero_xiahou: { kind: 'spear', hat: 'helmet', cloth: 0x3c4148, trim: 0x2a2d32, pants: 0x2a2a2a, pauldrons: true, elite: true, eyePatch: true, beard: 0x2b211c, beardStyle: 'bushy', scale: 1.3 },
  hero_zhangliao: { kind: 'spear', hat: 'helmet', cloth: 0x5a5f66, trim: 0x2a2d32, pants: 0x3a3a3a, horse: 0x6a4a30, barding: true, glaive: true, elite: true, cape: 0x2a2d3a, scale: 1.3 },
  hero_simayi: { kind: 'fan', hat: 'scholar', cloth: 0x3a3f5a, trim: 0xd9b13b, pants: 0x2a2a3a, robe: true, hatColor: 0x1a1a1a, beard: 0x2b211c, beardStyle: 'long', scale: 1.3 },
  hero_sunquan: { kind: 'sword', hat: 'crown', cloth: 0x8a2f2a, trim: 0xd9b13b, pants: 0x4a2a24, horse: 0xa0703f, cape: 0xd9b13b, beard: 0x7a3a2a, beardStyle: 'long', hatColor: 0x2a2018, scale: 1.3 },
  hero_zhouyu: { kind: 'bow', hat: 'band', cloth: 0xc0402f, trim: 0xf0e0c0, pants: 0x5a2a24, robe: true, hatColor: 0xf0e0c0, cape: 0xf0e0c0, scale: 1.3 },
  hero_luxun: { kind: 'fan', hat: 'scholar', cloth: 0x4a6a8a, trim: 0xe8e0c8, pants: 0x2a3a4a, robe: true, hatColor: 0x2a3a4a, scale: 1.3 },
  hero_ganning: { kind: 'sword', hat: 'band', cloth: 0x2f5a6a, trim: 0xd9b13b, pants: 0x24343a, dual: true, hatColor: 0xa8322d, beard: 0x2b211c, beardStyle: 'bushy', scale: 1.3 },
};
/** 攻城器械、車船用另外的建模（siege.ts） */
export const SIEGE_KINDS: Record<string, 'ram' | 'trebuchet' | 'cart' | 'ship'> = {
  ram: 'ram',
  trebuchet: 'trebuchet',
  ox_cart: 'cart',
  fishing_boat: 'ship',
  transport: 'ship',
  galley: 'ship',
  mengchong: 'ship',
  louchuan: 'ship',
  fire_ship: 'ship',
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
  root: { y: number; z: number; rx: number; rz: number };
}

export interface ModelGeometry {
  position: Float32Array;
  color: Float32Array;
  mask: Float32Array;
  part: Uint8Array;
  vertexCount: number;
  parent: number[];
  pivot: [number, number, number][];
  rootPivot: [number, number, number];
  mounted: boolean;
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

  build(): Pick<ModelGeometry, 'position' | 'color' | 'mask' | 'part' | 'vertexCount'> {
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
  const mounted = spec.horse !== undefined;
  // 騎手的部件整個抬到馬背上
  const lift = mounted ? new THREE.Matrix4().makeTranslation(0, SADDLE, -0.03) : new THREE.Matrix4();
  const add = (geo: THREE.BufferGeometry, part: number, color: number, mask: number, m: THREE.Matrix4) => b.add(geo, part, color, mask, part < P.horse ? lift.clone().multiply(m) : m);

  // 腿與鞋
  for (const [part, sx] of [[P.legL, 0.065], [P.legR, -0.065]] as const) {
    add(box(0.1, 0.17, 0.11), part, spec.pants, 0, M(sx, 0.115, 0));
    add(box(0.11, 0.05, 0.15), part, DARK, 0, M(sx, 0.025, 0.02));
  }
  // 身體：上衣、下擺、隊伍色腰帶
  add(cyl(0.13, 0.15, 0.24, 7, true), P.body, spec.cloth, 0, M(0, 0.33, 0));
  add(cyl(0.15, 0.175, 0.09, 7, true), P.body, spec.trim, 0, M(0, 0.225, 0));
  if (spec.robe) {
    // 長袍下擺蓋到腳踝
    add(cyl(0.17, 0.21, 0.2, 8, true), P.body, spec.cloth, 0, M(0, 0.12, 0));
    add(cyl(0.212, 0.212, 0.03, 8, true), P.body, spec.trim, 0, M(0, 0.03, 0));
  }
  if (spec.cape !== undefined) add(box(0.3, 0.36, 0.03), P.body, spec.cape, 0, M(0, 0.3, -0.16, 0.12));
  add(cyl(0.142, 0.142, 0.045, 7, true), P.body, 0xffffff, 1, M(0, 0.29, 0));
  if (spec.pauldrons) {
    add(box(0.1, 0.05, 0.13), P.body, 0xffffff, 1, M(0.15, 0.435, 0, 0, 0, -0.35));
    add(box(0.1, 0.05, 0.13), P.body, 0xffffff, 1, M(-0.15, 0.435, 0, 0, 0, 0.35));
  }
  if (spec.kind === 'bow') {
    add(cyl(0.045, 0.045, 0.28, 6), P.body, WOOD, 0, M(0.05, 0.38, -0.17, 0.25, 0, -0.35));
    add(cone(0.05, 0.08, 5), P.body, 0xf4efe2, 0, M(0.1, 0.54, -0.21, 0.25, 0, -0.35));
  }
  if (spec.backFlag) {
    add(cyl(0.012, 0.012, 0.5, 4), P.body, WOOD, 0, M(-0.06, 0.6, -0.15));
    add(box(0.02, 0.18, 0.14), P.body, 0xffffff, 1, M(-0.06, 0.76, -0.22));
  }
  // 頭：大頭、頭髮、眼睛
  add(ico(0.165, 1), P.head, spec.face ?? SKIN, 0, M(0, 0.6, 0));
  if (spec.beard !== undefined) {
    if (spec.beardStyle === 'bushy') add(ico(0.11, 0), P.head, spec.beard, 0, M(0, 0.49, 0.1, 0, 0, 0, 1.3, 0.8, 0.8));
    else add(cone(0.075, 0.3, 5), P.head, spec.beard, 0, M(0, 0.4, 0.12, Math.PI + 0.25));
  }
  if (spec.eyePatch) {
    add(box(0.06, 0.06, 0.02), P.head, DARK, 0, M(0.058, 0.6, 0.165));
    add(box(0.34, 0.02, 0.33), P.head, DARK, 0, M(0, 0.63, 0, 0.15));
  }
  add(new THREE.SphereGeometry(0.172, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.62), P.head, HAIR, 0, M(0, 0.62, -0.03, -0.35, 0, 0, 1, 0.95, 1));
  add(box(0.032, 0.05, 0.012), P.head, DARK, 0, M(0.058, 0.6, 0.158));
  add(box(0.032, 0.05, 0.012), P.head, DARK, 0, M(-0.058, 0.6, 0.158));
  if (spec.hat === 'helmet') {
    add(new THREE.SphereGeometry(0.182, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), P.head, IRON, 0, M(0, 0.63, -0.01));
    add(cyl(0.188, 0.188, 0.03, 8, true), P.head, IRON, 0, M(0, 0.63, -0.01));
    add(cone(0.04, 0.13, 5), P.head, spec.elite ? 0xe0b040 : 0xffffff, spec.elite ? 0 : 1, M(0, 0.86, -0.01));
  } else if (spec.hat === 'straw') {
    add(cone(0.3, 0.13, 9), P.head, 0xd9b96a, 0, M(0, 0.78, 0));
  } else if (spec.hat === 'crown') {
    // 冕冠：髮冠 ＋ 冕板 ＋ 垂旒
    const hc = spec.hatColor ?? 0x2a2018;
    add(cyl(0.07, 0.08, 0.12, 6), P.head, hc, 0, M(0, 0.8, -0.02));
    add(box(0.3, 0.025, 0.2), P.head, hc, 0, M(0, 0.87, 0, 0.1));
    add(box(0.26, 0.012, 0.02), P.head, 0xd9b13b, 0, M(0, 0.86, 0.1));
    for (const x of [-0.1, -0.03, 0.03, 0.1]) add(box(0.012, 0.08, 0.012), P.head, 0xe8dcb8, 0, M(x, 0.81, 0.11));
  } else if (spec.hat === 'scholar') {
    // 綸巾
    const hc = spec.hatColor ?? 0x2a2d32;
    add(box(0.22, 0.16, 0.22), P.head, hc, 0, M(0, 0.79, -0.02, -0.1));
    add(box(0.04, 0.22, 0.02), P.head, hc, 0, M(0.05, 0.66, -0.17, 0.2));
    add(box(0.04, 0.22, 0.02), P.head, hc, 0, M(-0.05, 0.66, -0.17, 0.2));
  } else {
    add(cyl(0.172, 0.172, 0.055, 8, true), P.head, spec.hatColor ?? 0xffffff, spec.hatColor !== undefined ? 0 : 1, M(0, 0.67, -0.01));
    add(ico(0.065, 0), P.head, HAIR, 0, M(0, 0.79, -0.05));
  }
  // 手臂與手
  add(box(0.075, 0.2, 0.08), P.armL, spec.cloth, 0, M(0.17, 0.31, 0));
  add(box(0.075, 0.2, 0.08), P.armR, spec.cloth, 0, M(-0.17, 0.31, 0));
  add(box(0.07, 0.07, 0.07), P.armL, SKIN, 0, M(0.17, 0.195, 0.01));
  add(box(0.07, 0.07, 0.07), P.armR, SKIN, 0, M(-0.17, 0.195, 0.01));

  // 兵器（放大 1.5 倍以利辨識，docs/07 §8.1）
  const hx = -0.17;
  const hy = 0.2;
  const hz = 0.03;
  if (spec.kind === 'sword') {
    const a = 1.15;
    const dy = Math.cos(a);
    const dz = Math.sin(a);
    add(box(0.04, 0.36, 0.014), P.weapon, STEEL, 0, M(hx, hy + dy * 0.22, hz + dz * 0.22, a));
    add(box(0.11, 0.025, 0.035), P.weapon, 0x9a7a2a, 0, M(hx, hy + dy * 0.04, hz + dz * 0.04, a));
    if (spec.dual) {
      // 左手也拿一把
      add(box(0.04, 0.32, 0.014), P.offhand, STEEL, 0, M(-hx, hy + dy * 0.2, hz + dz * 0.2, a));
      add(box(0.1, 0.025, 0.035), P.offhand, 0x9a7a2a, 0, M(-hx, hy + dy * 0.04, hz + dz * 0.04, a));
    }
  } else if (spec.kind === 'spear') {
    add(cyl(0.017, 0.017, 1.45, 5), P.weapon, WOOD, 0, M(hx, hy + 0.47, hz));
    add(cone(0.042, 0.17, 5), P.weapon, STEEL, 0, M(hx, hy + 1.28, hz));
    add(cone(0.055, 0.08, 6), P.weapon, 0xffffff, 1, M(hx, hy + 1.16, hz, Math.PI));
    if (spec.halberd) add(box(0.02, 0.2, 0.14), P.weapon, STEEL, 0, M(hx, hy + 1.22, hz + 0.08));
    if (spec.glaive) {
      // 偃月刀：大月牙刃 ＋ 紅纓
      add(box(0.025, 0.36, 0.17), P.weapon, STEEL, 0, M(hx, hy + 1.2, hz + 0.09, 0.15));
      add(cone(0.06, 0.1, 5), P.weapon, 0xc0302a, 0, M(hx, hy + 0.98, hz, Math.PI));
    }
  } else if (spec.kind === 'fan') {
    // 羽扇
    add(cyl(0.012, 0.012, 0.16, 4), P.weapon, WOOD, 0, M(hx, hy + 0.05, hz + 0.02));
    const fan = new THREE.CircleGeometry(0.12, 7);
    add(fan, P.weapon, 0xf8f6ee, 0, M(hx, hy + 0.2, hz + 0.03, 0, Math.PI / 2, 0, 1, 1.3, 1));
  } else if (spec.kind === 'tool') {
    add(cyl(0.016, 0.016, 0.62, 5), P.weapon, WOOD, 0, M(hx, hy + 0.2, hz));
    add(box(0.05, 0.04, 0.14), P.weapon, IRON, 0, M(hx, hy + 0.5, hz + 0.06));
  }
  if (spec.shield) {
    add(cyl(0.155, 0.155, 0.03, 8), P.offhand, WOOD, 0, M(0.21, 0.27, 0.1, Math.PI / 2, 0, Math.PI / 8));
    add(new THREE.CircleGeometry(0.115, 8), P.offhand, 0xffffff, 1, M(0.21, 0.27, 0.117, 0, 0, Math.PI / 8));
    add(cone(0.04, 0.05, 5), P.offhand, IRON, 0, M(0.21, 0.27, 0.13, Math.PI / 2));
  }
  if (spec.kind === 'bow') {
    const R = 0.32;
    const bowGeo = new THREE.TorusGeometry(R, 0.017, 3, 8, Math.PI * 0.8);
    bowGeo.rotateZ(-Math.PI * 0.4);
    bowGeo.rotateY(-Math.PI / 2);
    add(bowGeo, P.offhand, WOOD, 0, M(0.17, 0.2, 0.05 - R));
    add(box(0.006, 0.6, 0.006), P.offhand, 0xf4efe2, 0, M(0.17, 0.2, 0.05 - R + R * Math.cos(Math.PI * 0.4)));
  }

  // 馬
  if (mounted) {
    const hc = spec.horse!;
    b.add(box(0.27, 0.26, 0.7), P.horse, hc, 0, M(0, 0.44, 0));
    b.add(box(0.05, 0.22, 0.05), P.horse, DARK, 0, M(0, 0.44, -0.39, -0.5));
    b.add(box(0.32, 0.06, 0.3), P.horse, 0xffffff, 1, M(0, 0.585, -0.03));
    if (spec.barding) {
      b.add(box(0.31, 0.2, 0.62), P.horse, IRON, 0, M(0, 0.4, 0.02));
      b.add(box(0.33, 0.07, 0.5), P.horse, 0xffffff, 1, M(0, 0.33, 0.02));
    }
    b.add(box(0.13, 0.32, 0.14), P.hHead, hc, 0, M(0, 0.62, 0.36, 0.55));
    b.add(box(0.12, 0.13, 0.28), P.hHead, hc, 0, M(0, 0.76, 0.5, 0.2));
    b.add(box(0.03, 0.2, 0.12), P.hHead, DARK, 0, M(0, 0.7, 0.32, 0.55));
    for (const x of [-0.04, 0.04]) b.add(cone(0.025, 0.07, 3), P.hHead, hc, 0, M(x, 0.86, 0.43));
    if (spec.barding) b.add(box(0.13, 0.1, 0.2), P.hHead, IRON, 0, M(0, 0.79, 0.52, 0.2));
    for (const [part, x, z] of [[P.legFL, 0.09, 0.24], [P.legFR, -0.09, 0.24], [P.legBL, 0.09, -0.24], [P.legBR, -0.09, -0.24]] as const) {
      b.add(box(0.07, 0.32, 0.07), part, hc, 0, M(x, 0.16, z));
      b.add(box(0.075, 0.05, 0.08), part, DARK, 0, M(x, 0.025, z));
    }
  }

  const parent = Array.from({ length: PART_COUNT }, () => -1);
  parent[P.head] = P.body;
  parent[P.armL] = P.body;
  parent[P.armR] = P.body;
  parent[P.weapon] = P.armR;
  parent[P.offhand] = P.armL;
  parent[P.hHead] = P.horse;
  if (mounted) {
    parent[P.body] = P.horse;
    parent[P.legL] = P.horse;
    parent[P.legR] = P.horse;
    for (const l of [P.legFL, P.legFR, P.legBL, P.legBR]) parent[l] = P.horse;
  }
  const ry = mounted ? SADDLE : 0;
  const rz = mounted ? -0.03 : 0;
  const pivot: [number, number, number][] = [
    [0, 0.2 + ry, rz],
    [0, 0.45 + ry, rz],
    [0.17, 0.41 + ry, rz],
    [-0.17, 0.41 + ry, rz],
    [0.065, 0.2 + ry, rz],
    [-0.065, 0.2 + ry, rz],
    [-0.17, 0.2 + ry, 0.02 + rz],
    [0.17, 0.2 + ry, 0.02 + rz],
    [0, 0.44, 0],
    [0, 0.55, 0.3],
    [0.09, 0.32, 0.24],
    [-0.09, 0.32, 0.24],
    [0.09, 0.32, -0.24],
    [-0.09, 0.32, -0.24],
  ];
  const out: ModelGeometry = { ...b.build(), parent, pivot, rootPivot: mounted ? [0.15, 0, 0] : [0, 0, -0.12], mounted };
  // 武將放大
  const sc = spec.scale ?? 1;
  if (sc !== 1) {
    for (let i = 0; i < out.position.length; i++) out.position[i] *= sc;
    out.pivot = out.pivot.map(([x, y, z]) => [x * sc, y * sc, z * sc] as [number, number, number]);
    out.rootPivot = [out.rootPivot[0] * sc, out.rootPivot[1] * sc, out.rootPivot[2] * sc];
  }
  return out;
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

export function poseAt(kind: WeaponKind, anim: AnimName, t: number, mounted = false): Pose {
  const r: number[][] = Array.from({ length: PART_COUNT }, () => [0, 0, 0]);
  const root = { y: 0, z: 0, rx: 0, rz: 0 };
  const baseR = kind === 'spear' ? -0.25 : kind === 'sword' ? -0.15 : kind === 'tool' ? -0.2 : 0;
  const baseL = kind === 'bow' ? -0.25 : kind === 'sword' ? -0.35 : 0;
  r[P.armR][0] = baseR;
  r[P.armL][0] = baseL;
  if (mounted) {
    // 騎坐：腿往前、往外張
    r[P.legL][0] = -1.1;
    r[P.legR][0] = -1.1;
    r[P.legL][2] = 0.35;
    r[P.legR][2] = -0.35;
  }

  if (anim === 'idle') {
    const s = Math.sin(TAU * t);
    r[P.body][0] = 0.03 * s;
    r[P.head][1] = 0.2 * Math.sin(TAU * t + 1);
    r[P.armL][0] = baseL + 0.06 * s;
    r[P.armR][0] = baseR - 0.06 * s;
    if (mounted) r[P.hHead][0] = 0.12 * Math.sin(TAU * t) + 0.08;
    else root.y = 0.006 * Math.sin(TAU * t * 2);
  } else if (anim === 'walk') {
    const s = Math.sin(TAU * t);
    if (mounted) {
      // 小跑：對角腿同步
      r[P.legFL][0] = -0.6 * s;
      r[P.legBR][0] = -0.6 * s;
      r[P.legFR][0] = 0.6 * s;
      r[P.legBL][0] = 0.6 * s;
      r[P.hHead][0] = 0.1 * Math.sin(TAU * t * 2);
      r[P.horse][0] = 0.04 * Math.sin(TAU * t * 2);
      root.y = 0.04 * Math.abs(Math.cos(TAU * t));
      r[P.body][0] = 0.12;
      r[P.armL][0] = baseL - 0.2;
    } else {
      r[P.legL][0] = -0.65 * s;
      r[P.legR][0] = 0.65 * s;
      r[P.armL][0] = baseL + 0.5 * s;
      r[P.armR][0] = baseR - 0.5 * s * (kind === 'spear' ? 0.3 : 1);
      r[P.body][0] = 0.1;
      r[P.body][1] = 0.08 * s;
      r[P.head][0] = -0.06;
      root.y = 0.035 * Math.abs(Math.cos(TAU * t));
    }
  } else if (anim === 'attack' && kind === 'sword') {
    r[P.armR][0] = track(t, [0, baseR, 0.42, -3.0, 0.56, 0.25, 0.8, 0.25, 1, baseR]);
    r[P.body][1] = track(t, [0, 0, 0.42, -0.3, 0.56, 0.35, 1, 0]);
    r[P.body][0] = track(t, [0, 0, 0.56, 0.2, 1, 0]);
    r[P.armL][0] = -0.6;
    if (!mounted) {
      r[P.legL][0] = -0.3;
      r[P.legR][0] = 0.25;
    } else {
      r[P.horse][0] = track(t, [0, 0, 0.42, -0.08, 0.6, 0.04, 1, 0]);
    }
  } else if (anim === 'attack' && kind === 'spear') {
    const arm = track(t, [0, -0.85, 0.35, -0.7, 0.5, -1.2, 0.7, -1.2, 1, -0.85]);
    r[P.armR][0] = arm;
    r[P.weapon][0] = 1.55 - arm;
    r[P.armL][0] = track(t, [0, -0.9, 0.35, -0.8, 0.5, -1.2, 1, -0.9]);
    root.z = track(t, [0, 0, 0.35, -0.05, 0.5, 0.13, 0.7, 0.13, 1, 0]);
    r[P.body][0] = track(t, [0, 0.1, 0.5, 0.3, 1, 0.1]);
    if (!mounted) {
      r[P.legL][0] = -0.35;
      r[P.legR][0] = 0.3;
    }
  } else if (anim === 'attack' && kind === 'fan') {
    // 揮扇施法
    r[P.armR][0] = track(t, [0, -0.3, 0.35, -1.7, 0.55, -1.2, 0.75, -1.7, 1, -0.3]);
    r[P.armR][2] = track(t, [0, 0, 0.35, 0.3, 0.75, -0.2, 1, 0]);
    r[P.body][0] = track(t, [0, 0, 0.35, -0.08, 1, 0]);
    r[P.head][0] = -0.1;
  } else if (anim === 'attack' && kind === 'bow') {
    r[P.armL][0] = -1.5;
    r[P.offhand][0] = 1.5;
    r[P.armR][0] = track(t, [0, -1.0, 0.6, -1.55, 0.66, -1.2, 1, -1.0]);
    r[P.armR][2] = track(t, [0, 0, 0.6, -0.15, 0.66, -0.45, 1, 0]);
    r[P.body][1] = track(t, [0, -0.15, 0.6, -0.4, 1, -0.15]);
    r[P.head][1] = 0.3;
  } else if (anim === 'work' || anim === 'attack') {
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
    if (mounted) {
      // 連人帶馬側倒
      root.rz = 1.45 * e;
      r[P.legFL][0] = -0.5 * e;
      r[P.legBL][0] = 0.5 * e;
      r[P.hHead][0] = 0.4 * e;
      r[P.armL][2] = 0.6 * e;
      r[P.armR][2] = -0.9 * e;
    } else {
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
  }
  return { r, root };
}
