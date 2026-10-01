// 程式建模的建築（docs/04 §3：黃巾亂世外觀 — 夯土台基、夯土牆、茅草屋頂、木樁）
// 原點在佔地中心、地面 y=0；隊伍色在旗幟、門簾
import * as THREE from 'three';
import { M, StaticBuilder, box, cone, cyl, gable, ico, pyramid } from './geo';

/** 依時代的建築樣式（docs/04 §3）：I 茅草夯土、II 木構灰瓦、III 磚石朱柱、IV 紅牆金飾 */
export interface Style {
  age: number;
  wall: number;
  wallDark: number;
  base: number;
  roof: number;
  roofDark: number;
  pillar: number;
  plank: number;
}
export const STYLES: Style[] = [
  { age: 1, wall: 0xd1b282, wallDark: 0xb39468, base: 0xa98d62, roof: 0xcaa35a, roofDark: 0xb38d48, pillar: 0x7a4a2a, plank: 0x8d6239 },
  { age: 2, wall: 0xd9c4a0, wallDark: 0xb8a07a, base: 0x9a948a, roof: 0x6e757c, roofDark: 0x5c6369, pillar: 0x6b3f22, plank: 0x9a6a3c },
  { age: 3, wall: 0xb9b0a2, wallDark: 0x9d9486, base: 0x8a857c, roof: 0x4a5058, roofDark: 0x3c4148, pillar: 0xa8322d, plank: 0x7a4a2a },
  { age: 4, wall: 0xb8392f, wallDark: 0x9a2e26, base: 0xd8d2c4, roof: 0x34383e, roofDark: 0x2a2d32, pillar: 0x8f2a24, plank: 0x7a4a2a },
];
const GOLD = 0xe0b040;
let EARTH = STYLES[0].wall;
let EARTH_DARK = STYLES[0].wallDark;
let BASE = STYLES[0].base;
let THATCH = STYLES[0].roof;
let THATCH_DARK = STYLES[0].roofDark;
let WOOD = STYLES[0].pillar;
let PLANK = STYLES[0].plank;
let AGE = 1;
const DOOR = 0x3a2618;
const TEAM = 0xffffff;

/** 切換目前建模用的樣式（建模函式讀這些變數） */
function useStyle(st: Style): void {
  EARTH = st.wall;
  EARTH_DARK = st.wallDark;
  BASE = st.base;
  THATCH = st.roof;
  THATCH_DARK = st.roofDark;
  WOOD = st.pillar;
  PLANK = st.plank;
  AGE = st.age;
}

/** 屋脊裝飾：三分天下起加正脊，天下一統加金色鴟吻 */
function ridge(b: StaticBuilder, x: number, y: number, z: number, len: number, alongX = true): void {
  if (AGE < 3) return;
  b.add(box(alongX ? len : 0.1, 0.1, alongX ? 0.1 : len), THATCH_DARK, M(x, y, z));
  if (AGE >= 4) {
    for (const k of [-1, 1]) b.add(cone(0.09, 0.26, 4), GOLD, M(x + (alongX ? (k * len) / 2 : 0), y + 0.12, z + (alongX ? 0 : (k * len) / 2)));
  }
}

/** 斗拱（三分天下起，簷下一排小方塊） */
function brackets(b: StaticBuilder, w: number, y: number, z: number): void {
  if (AGE < 3) return;
  const n = Math.max(2, Math.round(w / 0.45));
  for (let k = 0; k < n; k++) b.add(box(0.12, 0.1, 0.14), AGE >= 4 ? GOLD : 0x7a4a2a, M(-w / 2 + (w / (n - 1)) * k, y, z));
}

/** 旗杆 ＋ 隊伍色旗 */
function banner(b: StaticBuilder, x: number, z: number, h: number, size = 1): void {
  b.add(cyl(0.035 * size, 0.04 * size, h, 5), WOOD, M(x, h / 2, z));
  b.add(box(0.5 * size, 0.32 * size, 0.03), TEAM, M(x + 0.26 * size, h - 0.2 * size, z), 1);
  b.add(cone(0.06 * size, 0.12 * size, 5), 0xd9b13b, M(x, h + 0.06 * size, z));
}

/** 夯土台基（往下延伸，坡地也不會露空） */
function platform(b: StaticBuilder, w: number, d: number, top = 0.12): void {
  b.add(box(w, 0.8 + top, d), BASE, M(0, top - (0.8 + top) / 2, 0));
}

function townHall(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  platform(b, 3.9, 3.9, 0.18);
  // 前方台階
  b.add(box(1.2, 0.12, 0.35), BASE, M(0, 0.06, 1.95));
  // 正廳
  b.add(box(2.8, 1.05, 2.0), EARTH, M(0, 0.18 + 0.525, -0.35));
  b.add(box(2.9, 0.12, 2.1), EARTH_DARK, M(0, 0.24, -0.35));
  // 簷柱
  for (const x of [-1.25, -0.45, 0.45, 1.25]) b.add(cyl(0.07, 0.08, 1.05, 6), WOOD, M(x, 0.18 + 0.525, 0.78));
  b.add(box(2.9, 0.1, 0.12), WOOD, M(0, 1.2, 0.78));
  // 大門與門簾
  b.add(box(0.7, 0.75, 0.05), DOOR, M(0, 0.55, 0.66));
  b.add(box(0.6, 0.3, 0.03), TEAM, M(0, 0.8, 0.7), 1);
  // 四坡茅草頂 ＋ 頂層
  brackets(b, 2.8, 1.17, 0.78);
  b.add(pyramid(3.7, 1.0, 3.0), THATCH, M(0, 1.22, -0.1));
  b.add(box(0.9, 0.35, 0.6), EARTH, M(0, 2.0, -0.1));
  b.add(pyramid(1.4, 0.55, 1.1), THATCH_DARK, M(0, 2.15, -0.1));
  ridge(b, 0, 2.72, -0.1, 0.6);
  if (AGE >= 2) b.add(box(3.0, 0.08, 0.5), BASE, M(0, 0.2, 1.3));
  // 側邊倉房
  b.add(box(0.9, 0.7, 0.9), EARTH, M(-1.35, 0.53, 1.35));
  b.add(pyramid(1.15, 0.45, 1.15), THATCH, M(-1.35, 0.88, 1.35));
  // 柴堆與水缸
  b.add(cyl(0.18, 0.15, 0.3, 7), 0x6f6a62, M(1.45, 0.33, 1.45));
  banner(b, 1.7, -1.6, 2.4, 1.2);
  banner(b, -1.7, -1.6, 2.0);
  return b.build();
}

function house(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  platform(b, 1.85, 1.85);
  b.add(box(1.3, 0.72, 1.05), EARTH, M(0, 0.12 + 0.36, 0));
  b.add(gable(1.6, 0.6, 1.45), THATCH, M(0, 0.84, 0));
  ridge(b, 0, 1.46, 0, 1.6);
  b.add(box(0.36, 0.5, 0.04), DOOR, M(0.2, 0.37, 0.53));
  b.add(box(0.32, 0.22, 0.03), TEAM, M(0.2, 0.52, 0.56), 1);
  b.add(box(0.22, 0.16, 0.04), DOOR, M(-0.32, 0.55, 0.53));
  // 陶甕
  b.add(cyl(0.11, 0.08, 0.22, 6), 0x9a6a44, M(-0.62, 0.23, 0.68));
  return b.build();
}

function granary(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  platform(b, 1.85, 1.85);
  b.add(cyl(0.6, 0.62, 0.85, 9), EARTH, M(0, 0.12 + 0.425, -0.1));
  b.add(cone(0.82, 0.62, 9), THATCH, M(0, 0.97 + 0.31, -0.1));
  b.add(box(0.3, 0.45, 0.05), DOOR, M(0, 0.35, 0.5));
  // 糧袋
  for (const [x, z] of [[0.55, 0.6], [0.7, 0.35], [0.4, 0.75]]) b.add(ico(0.14), 0xe2cf9e, M(x, 0.24, z, 0, 0, 0, 1, 0.8, 1));
  banner(b, -0.75, 0.7, 1.4, 0.8);
  return b.build();
}

/** 開放式棚子（伐木場、礦場共用） */
function shed(b: StaticBuilder): void {
  platform(b, 1.85, 1.85, 0.08);
  for (const [x, z] of [[-0.7, -0.6], [0.7, -0.6], [-0.7, 0.2], [0.7, 0.2]]) b.add(cyl(0.05, 0.06, z < 0 ? 1.0 : 0.82, 5), WOOD, M(x, (z < 0 ? 1.0 : 0.82) / 2 + 0.08, z));
  b.add(box(1.7, 0.07, 1.15), PLANK, M(0, 1.0, -0.2, 0.18));
  b.add(box(1.5, 0.5, 0.06), PLANK, M(0, 0.33, -0.62));
}

function lumberCamp(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  shed(b);
  // 原木堆
  for (const [y, z, x] of [[0.2, 0.55, 0], [0.2, 0.75, 0], [0.38, 0.65, 0.05]]) b.add(cyl(0.1, 0.1, 1.2, 6), 0x8a5a32, M(x, y, z, 0, 0, Math.PI / 2));
  // 木樁與斧頭
  b.add(cyl(0.16, 0.18, 0.22, 7), 0x6e4a2c, M(-0.4, 0.19, -0.2));
  b.add(box(0.04, 0.4, 0.04), WOOD, M(-0.4, 0.42, -0.2, 0, 0, 0.5));
  b.add(box(0.12, 0.08, 0.03), 0x9aa3ab, M(-0.5, 0.58, -0.2));
  banner(b, 0.78, 0.7, 1.3, 0.8);
  return b.build();
}

function mineCamp(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  shed(b);
  // 礦車
  b.add(box(0.55, 0.25, 0.35), PLANK, M(0.25, 0.3, 0.6));
  for (const x of [0.05, 0.45]) for (const z of [0.42, 0.78]) b.add(cyl(0.08, 0.08, 0.04, 6), 0x3a3a3a, M(x, 0.16, z, Math.PI / 2, 0, Math.PI / 2));
  b.add(ico(0.16), 0xe3b93a, M(0.2, 0.47, 0.6));
  b.add(ico(0.13), 0x9c9c9c, M(0.35, 0.45, 0.62));
  // 礦石堆
  b.add(ico(0.22), 0x8f8f8f, M(-0.4, 0.2, 0.55, 0, 0, 0, 1, 0.7, 1));
  b.add(ico(0.16), 0xe3b93a, M(-0.55, 0.2, 0.3, 0, 0, 0, 1, 0.7, 1));
  banner(b, -0.78, 0.75, 1.3, 0.8);
  return b.build();
}

function farm(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(box(2.9, 0.5, 2.9), 0x8b6a43, M(0, -0.18, 0));
  for (let k = 0; k < 5; k++) b.add(box(2.6, 0.08, 0.22), 0x6f5130, M(0, 0.1, -1.0 + k * 0.5));
  // 田邊木樁
  for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) b.add(cyl(0.035, 0.04, 0.35, 4), WOOD, M(x, 0.2, z));
  b.add(box(0.3, 0.2, 0.03), TEAM, M(1.4, 0.4, 1.42), 1);
  return b.build();
}

/** 農田上的作物（另一個網格，依剩餘糧食調整高度） */
export function farmCrops(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  for (let k = 0; k < 5; k++) {
    for (let j = 0; j < 7; j++) {
      const x = -1.15 + j * 0.38;
      const z = -1.0 + k * 0.5;
      b.add(cone(0.13, 0.4, 4), (j + k) % 2 ? 0x8fbf3c : 0x9fcd46, M(x, 0.33, z));
    }
  }
  return b.build();
}

function barracks(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  platform(b, 2.9, 2.9);
  b.add(box(2.4, 0.85, 1.25), EARTH, M(0, 0.12 + 0.425, -0.7));
  b.add(gable(2.7, 0.75, 1.75), THATCH, M(0, 0.97, -0.7));
  ridge(b, 0, 1.74, -0.7, 2.7);
  brackets(b, 2.4, 0.92, -0.06);
  b.add(box(0.5, 0.6, 0.05), DOOR, M(0, 0.42, -0.06));
  b.add(box(0.44, 0.3, 0.03), TEAM, M(0, 0.62, -0.03), 1);
  // 木柵圍出的校場
  for (let k = 0; k <= 6; k++) {
    b.add(cyl(0.04, 0.05, 0.5, 4), WOOD, M(-1.35 + k * 0.45, 0.37, 1.35));
  }
  b.add(box(2.75, 0.05, 0.05), WOOD, M(0, 0.5, 1.35));
  // 兵器架
  b.add(box(0.06, 0.7, 0.06), WOOD, M(0.9, 0.47, 0.25));
  b.add(box(0.06, 0.7, 0.06), WOOD, M(1.3, 0.47, 0.25));
  b.add(box(0.5, 0.05, 0.05), WOOD, M(1.1, 0.7, 0.25));
  for (const x of [0.97, 1.1, 1.23]) {
    b.add(cyl(0.015, 0.015, 1.1, 4), PLANK, M(x, 0.65, 0.3, -0.12));
    b.add(cone(0.03, 0.1, 4), 0xd8dee5, M(x, 1.22, 0.37, -0.12));
  }
  // 草人靶
  b.add(cyl(0.03, 0.03, 0.7, 4), WOOD, M(-0.8, 0.47, 0.6));
  b.add(cyl(0.12, 0.14, 0.32, 6), 0xd8b45f, M(-0.8, 0.6, 0.6));
  b.add(box(0.5, 0.05, 0.05), WOOD, M(-0.8, 0.66, 0.6));
  banner(b, 1.3, -1.35, 2.2, 1.1);
  return b.build();
}

function archery(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  platform(b, 2.9, 2.9);
  b.add(box(2.3, 0.8, 1.2), EARTH, M(0, 0.12 + 0.4, -0.75));
  b.add(gable(2.6, 0.7, 1.7), THATCH, M(0, 0.92, -0.75));
  ridge(b, 0, 1.64, -0.75, 2.6);
  b.add(box(0.5, 0.6, 0.05), DOOR, M(-0.5, 0.42, -0.14));
  b.add(box(0.44, 0.3, 0.03), TEAM, M(-0.5, 0.62, -0.11), 1);
  // 箭靶
  for (const x of [-0.6, 0.6]) {
    b.add(cyl(0.03, 0.03, 0.7, 4), WOOD, M(x, 0.45, 1.05));
    b.add(cyl(0.28, 0.28, 0.06, 10), 0xe8d9b0, M(x, 0.75, 1.0, Math.PI / 2));
    b.add(cyl(0.17, 0.17, 0.07, 10), 0xc8463c, M(x, 0.75, 1.0, Math.PI / 2));
    b.add(cyl(0.07, 0.07, 0.08, 8), 0xe8d9b0, M(x, 0.75, 1.0, Math.PI / 2));
  }
  // 弓架
  b.add(box(0.06, 0.6, 0.06), WOOD, M(0.9, 0.42, 0.1));
  b.add(box(0.06, 0.6, 0.06), WOOD, M(1.25, 0.42, 0.1));
  b.add(box(0.45, 0.05, 0.05), WOOD, M(1.07, 0.6, 0.1));
  banner(b, 1.3, -1.35, 2.1, 1.0);
  return b.build();
}

function stable(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  platform(b, 2.9, 2.9);
  // 長形馬房：前面開放
  b.add(box(2.6, 0.7, 0.12), PLANK, M(0, 0.47, -1.2));
  b.add(box(0.12, 0.7, 1.2), PLANK, M(-1.25, 0.47, -0.65));
  b.add(box(0.12, 0.7, 1.2), PLANK, M(1.25, 0.47, -0.65));
  for (const x of [-0.42, 0.42]) b.add(box(0.08, 0.5, 1.0), PLANK, M(x, 0.37, -0.7));
  b.add(gable(2.8, 0.6, 1.6), THATCH, M(0, 0.82, -0.65));
  ridge(b, 0, 1.44, -0.65, 2.8);
  for (const x of [-1.2, 0, 1.2]) b.add(cyl(0.05, 0.06, 0.7, 5), WOOD, M(x, 0.47, -0.05));
  // 馬槽與草料
  b.add(box(1.2, 0.18, 0.25), PLANK, M(0.3, 0.21, 0.55));
  b.add(ico(0.22), 0xd9b96a, M(-0.8, 0.25, 0.75, 0, 0, 0, 1.2, 0.8, 1));
  b.add(ico(0.18), 0xcaa35a, M(-0.5, 0.22, 0.95, 0, 0, 0, 1.1, 0.8, 1));
  banner(b, 1.3, 1.25, 2.0, 1.0);
  return b.build();
}

function blacksmith(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  platform(b, 2.9, 2.9);
  b.add(box(1.9, 0.85, 1.3), EARTH_DARK, M(-0.2, 0.12 + 0.425, -0.55));
  b.add(gable(2.2, 0.65, 1.8), AGE >= 2 ? THATCH : 0x7b6a58, M(-0.2, 0.97, -0.55));
  ridge(b, -0.2, 1.64, -0.55, 2.2);
  // 煙囪與火爐
  b.add(box(0.35, 1.1, 0.35), 0x8a7a68, M(0.75, 1.0, -0.9));
  b.add(box(0.6, 0.45, 0.5), 0x8a7a68, M(0.75, 0.35, 0.35));
  b.add(box(0.3, 0.15, 0.05), 0xff8a3a, M(0.75, 0.35, 0.61));
  // 鐵砧
  b.add(box(0.35, 0.15, 0.18), 0x4a4f55, M(-0.3, 0.42, 0.6));
  b.add(box(0.15, 0.22, 0.12), 0x4a4f55, M(-0.3, 0.26, 0.6));
  b.add(box(0.34, 0.25, 0.03), TEAM, M(-0.2, 0.62, 0.11), 1);
  banner(b, -1.3, 1.25, 1.8, 0.9);
  return b.build();
}

function tower(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(box(0.95, 0.9, 0.95), BASE, M(0, -0.3, 0));
  b.add(box(0.75, 1.5, 0.75), 0xa39684, M(0, 0.9, 0));
  for (const y of [0.45, 1.05]) b.add(box(0.78, 0.06, 0.78), 0x8a7d6c, M(0, y, 0));
  // 望樓
  b.add(box(0.95, 0.12, 0.95), PLANK, M(0, 1.7, 0));
  for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) b.add(cyl(0.035, 0.035, 0.5, 4), WOOD, M(x, 2.0, z));
  b.add(box(0.95, 0.18, 0.04), PLANK, M(0, 1.85, 0.46));
  b.add(box(0.95, 0.18, 0.04), PLANK, M(0, 1.85, -0.46));
  b.add(pyramid(1.15, 0.5, 1.15), THATCH, M(0, 2.25, 0));
  ridge(b, 0, 2.78, 0, 0.2);
  b.add(box(0.2, 0.3, 0.04), DOOR, M(0, 0.3, 0.38));
  banner(b, 0, 0, 3.1, 0.7);
  return b.build();
}

function palisade(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0, 0]]) b.add(cyl(0.11, 0.12, 1.0, 5), 0x8a5a32, M(x, 0.4, z));
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0, 0]]) b.add(cone(0.11, 0.18, 5), 0x7a4a2a, M(x, 0.99, z));
  return b.build();
}

function wall(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(box(1.02, 1.6, 1.02), 0xa39684, M(0, 0.2, 0));
  b.add(box(1.04, 0.08, 1.04), 0x8a7d6c, M(0, 0.6, 0));
  // 雉堞
  for (const [x, z] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) b.add(box(0.26, 0.22, 0.26), 0x9a8d7b, M(x, 1.11, z));
  return b.build();
}

function workshop(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  platform(b, 3.9, 3.9);
  // 大棚：高柱 ＋ 懸山頂，裡面看得到半成品的撞木
  for (const x of [-1.6, 1.6]) for (const z of [-1.5, 0.3]) b.add(cyl(0.08, 0.09, 1.6, 6), WOOD, M(x, 0.92, z));
  b.add(gable(3.6, 0.8, 2.4), THATCH, M(0, 1.72, -0.6));
  ridge(b, 0, 2.54, -0.6, 3.6);
  b.add(box(3.3, 1.1, 0.1), PLANK, M(0, 0.7, -1.55));
  b.add(cyl(0.18, 0.18, 2.2, 8), 0x8a5a32, M(0, 0.5, -0.6, 0, 0, Math.PI / 2));
  b.add(box(0.5, 0.5, 0.5), 0x9a9a9a, M(1.15, 0.37, -0.6));
  // 木料堆、齒輪
  for (const [y, z] of [[0.22, 1.2], [0.22, 1.45], [0.4, 1.32]]) b.add(cyl(0.11, 0.11, 1.4, 6), 0x9a6a3c, M(-0.8, y, z, 0, 0, Math.PI / 2));
  b.add(cyl(0.35, 0.35, 0.08, 10), PLANK, M(1.1, 0.5, 1.2, Math.PI / 2));
  banner(b, 1.75, 1.6, 2.4, 1.1);
  return b.build();
}


/** 關隘（4×4）：高台城樓、兩側城牆、正面城門洞、三面旗 */
function fortress(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(box(3.95, 1.0, 3.95), 0x8f8676, M(0, -0.3, 0));
  // 城台：下寬上窄
  b.add(box(3.7, 1.3, 3.2), 0xa39684, M(0, 0.65, -0.2));
  b.add(box(3.8, 0.1, 3.3), 0x8a7d6c, M(0, 1.32, -0.2));
  for (let k = 0; k < 7; k++) b.add(box(0.32, 0.26, 0.26), 0x9a8d7b, M(-1.65 + k * 0.55, 1.5, 1.3));
  for (let k = 0; k < 6; k++) for (const x of [-1.75, 1.75]) b.add(box(0.26, 0.26, 0.3), 0x9a8d7b, M(x, 1.5, -1.6 + k * 0.55));
  // 城門洞
  b.add(box(0.95, 0.85, 0.12), DOOR, M(0, 0.43, 1.42));
  b.add(cyl(0.48, 0.48, 0.12, 10, false), DOOR, M(0, 0.85, 1.42, Math.PI / 2));
  // 城樓：兩層歇山
  b.add(box(2.2, 0.75, 1.5), EARTH, M(0, 1.75, -0.35));
  for (const x of [-1.0, -0.35, 0.35, 1.0]) b.add(cyl(0.06, 0.07, 0.75, 6), 0xa8322d, M(x, 1.75, 0.45));
  brackets(b, 2.2, 2.12, 0.45);
  b.add(pyramid(2.9, 0.65, 2.2), THATCH, M(0, 2.15, -0.35));
  b.add(box(1.2, 0.4, 0.8), EARTH, M(0, 2.85, -0.35));
  b.add(pyramid(1.7, 0.5, 1.3), THATCH_DARK, M(0, 3.0, -0.35));
  ridge(b, 0, 3.5, -0.35, 0.5);
  b.add(box(0.9, 0.28, 0.04), 0x2a2018, M(0, 2.42, 0.42));
  b.add(box(0.8, 0.2, 0.03), GOLD, M(0, 2.42, 0.45));
  banner(b, 1.65, 1.15, 2.7, 1.2);
  banner(b, -1.65, 1.15, 2.7, 1.2);
  banner(b, 0, -1.65, 3.6, 1.3);
  return b.build();
}

/** 書院（3×3）：白牆青瓦、竹林、書卷架 */
function academy(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  platform(b, 2.9, 2.9, 0.16);
  b.add(box(2.2, 0.9, 1.5), 0xeee6d6, M(0, 0.61, -0.4));
  for (const x of [-0.95, -0.32, 0.32, 0.95]) b.add(cyl(0.06, 0.06, 0.9, 6), WOOD, M(x, 0.61, 0.42));
  brackets(b, 2.2, 1.02, 0.42);
  b.add(gable(2.7, 0.7, 2.1), 0x4f5862, M(0, 1.06, -0.3));
  ridge(b, 0, 1.78, -0.3, 2.7);
  b.add(box(0.5, 0.6, 0.04), DOOR, M(0, 0.46, 0.36));
  // 匾額
  b.add(box(0.7, 0.18, 0.04), 0x2a2018, M(0, 1.0, 0.45));
  b.add(box(0.6, 0.1, 0.03), GOLD, M(0, 1.0, 0.48));
  // 竹叢
  for (const [x, z] of [[-1.15, 0.9], [-1.0, 1.15], [-1.25, 1.2]]) {
    b.add(cyl(0.025, 0.03, 1.2, 4), 0x6d9a3c, M(x, 0.75, z));
    b.add(cone(0.14, 0.4, 5), 0x5d8a34, M(x, 1.3, z));
  }
  // 書卷架、石桌
  b.add(box(0.5, 0.5, 0.2), PLANK, M(1.0, 0.41, 0.95));
  for (let k = 0; k < 3; k++) b.add(cyl(0.05, 0.05, 0.4, 6), 0xe8dcb8, M(1.0, 0.3 + k * 0.13, 0.95, 0, 0, Math.PI / 2));
  b.add(cyl(0.22, 0.25, 0.3, 8), 0x9a948a, M(0.2, 0.31, 1.0));
  banner(b, -1.2, -1.2, 2.0, 0.9);
  return b.build();
}

/** 市集（4×4）：攤位棚子、貨物、牌坊 */
function market(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  platform(b, 3.9, 3.9, 0.08);
  // 牌坊
  for (const x of [-1.0, 1.0]) b.add(cyl(0.08, 0.09, 1.8, 6), 0xa8322d, M(x, 0.98, 1.7));
  b.add(box(2.6, 0.16, 0.2), 0xa8322d, M(0, 1.8, 1.7));
  b.add(gable(2.8, 0.3, 0.45), THATCH_DARK, M(0, 1.88, 1.7));
  b.add(box(0.9, 0.24, 0.04), GOLD, M(0, 1.55, 1.72));
  // 攤位：四個小棚，隊伍色布篷
  for (const [x, z] of [[-1.15, -1.1], [1.15, -1.1], [-1.15, 0.35], [1.15, 0.35]]) {
    for (const [dx, dz] of [[-0.45, -0.35], [0.45, -0.35], [-0.45, 0.35], [0.45, 0.35]]) b.add(cyl(0.035, 0.035, 0.9, 4), WOOD, M(x + dx, 0.53, z + dz));
    b.add(gable(1.1, 0.3, 0.9), TEAM, M(x, 0.98, z), 1);
    b.add(box(0.9, 0.35, 0.6), PLANK, M(x, 0.26, z));
    b.add(ico(0.12, 0), [0xd9b13b, 0x8ab24a, 0xc0522f, 0x9a6a44][(Math.round(x + z * 3) + 8) % 4], M(x - 0.2, 0.5, z));
    b.add(cyl(0.12, 0.1, 0.22, 6), 0x9a6a44, M(x + 0.22, 0.54, z));
  }
  // 糧袋、木箱
  for (const [x, z] of [[0, -0.4], [0.25, -0.2], [-0.2, -0.15]]) b.add(ico(0.18, 0), 0xd9c79a, M(x, 0.25, z));
  b.add(box(0.4, 0.4, 0.4), PLANK, M(0, 0.28, 0.6));
  return b.build();
}

/** 船塢（3×3，蓋在岸邊）：木棧橋、船棚、吊杆 */
function dock(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  // 木樁（往下伸進水裡）
  for (const x of [-1.3, -0.45, 0.45, 1.3]) for (const z of [-1.3, -0.45, 0.45, 1.3]) b.add(cyl(0.07, 0.07, 1.6, 5), 0x5a3a20, M(x, -0.6, z));
  b.add(box(2.95, 0.12, 2.95), PLANK, M(0, 0.12, 0));
  for (let k = 0; k < 7; k++) b.add(box(2.95, 0.02, 0.05), 0x6a4224, M(0, 0.19, -1.35 + k * 0.45));
  // 船棚
  for (const x of [-1.1, 1.1]) for (const z of [-1.1, 0.2]) b.add(cyl(0.06, 0.06, 1.3, 5), WOOD, M(x, 0.83, z));
  b.add(gable(2.7, 0.55, 1.9), THATCH, M(0, 1.45, -0.45));
  ridge(b, 0, 2.0, -0.45, 2.7);
  // 小船骨架
  b.add(box(0.5, 0.2, 1.4), 0x8a5a32, M(0.3, 0.3, -0.45));
  // 吊杆
  b.add(cyl(0.04, 0.05, 1.6, 5), WOOD, M(-1.2, 0.98, 1.15));
  b.add(cyl(0.025, 0.025, 1.0, 4), WOOD, M(-0.85, 1.7, 1.15, 0, 0, -1.1));
  b.add(box(0.03, 0.4, 0.03), 0xd9c79a, M(-0.45, 1.5, 1.15));
  // 漁網、木桶
  b.add(box(0.6, 0.04, 0.5), 0xb8a87a, M(0.8, 0.22, 1.0));
  b.add(cyl(0.14, 0.12, 0.3, 7), 0x7a4a2a, M(1.15, 0.33, 0.6));
  banner(b, 1.3, 1.3, 2.0, 0.9);
  return b.build();
}

/** 城門（1×1）：城牆段 ＋ 門洞 ＋ 門樓 */
function gate(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(box(1.02, 0.6, 1.02), 0xa39684, M(0, -0.1, 0));
  for (const x of [-0.4, 0.4]) b.add(box(0.22, 1.3, 1.02), 0xa39684, M(x, 0.65, 0));
  b.add(box(1.02, 0.3, 1.02), 0xa39684, M(0, 1.15, 0));
  b.add(box(0.58, 0.95, 0.06), 0x5a3a20, M(0, 0.48, 0.3));
  b.add(box(0.58, 0.95, 0.06), 0x5a3a20, M(0, 0.48, -0.3));
  for (const y of [0.25, 0.7]) b.add(box(0.6, 0.05, 0.08), IRON_DARK, M(0, y, 0.33));
  b.add(pyramid(1.2, 0.4, 1.2), THATCH, M(0, 1.3, 0));
  b.add(box(0.3, 0.16, 0.03), TEAM, M(0, 1.15, 0.53), 1);
  return b.build();
}
const IRON_DARK = 0x4a4f55;

/** 奇觀「銅雀台」（5×5）：三層高台、主殿、銅雀、四角闕樓 */
function wonder(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(box(4.95, 1.0, 4.95), 0xd8d2c4, M(0, -0.3, 0));
  // 三層台基
  b.add(box(4.6, 0.5, 4.6), 0xd8d2c4, M(0, 0.45, 0));
  b.add(box(3.6, 0.5, 3.6), 0xcfc8b8, M(0, 0.95, 0));
  b.add(box(2.6, 0.45, 2.6), 0xc4bca8, M(0, 1.42, 0));
  for (const s of [4.62, 3.62, 2.62]) b.add(box(s, 0.06, s), 0xa8322d, M(0, s === 4.62 ? 0.72 : s === 3.62 ? 1.22 : 1.66, 0));
  // 正面大台階
  b.add(box(0.9, 0.08, 1.4), 0xbab2a0, M(0, 0.82, 2.0, -0.6));
  // 主殿
  b.add(box(1.9, 1.1, 1.5), 0xb8392f, M(0, 2.2, 0));
  for (const x of [-0.85, -0.3, 0.3, 0.85]) b.add(cyl(0.07, 0.08, 1.1, 6), 0x8f2a24, M(x, 2.2, 0.8));
  brackets(b, 2.0, 2.75, 0.8);
  b.add(pyramid(2.7, 0.75, 2.3), 0x34383e, M(0, 2.78, 0));
  b.add(box(1.0, 0.5, 0.8), 0xb8392f, M(0, 3.7, 0));
  b.add(pyramid(1.5, 0.6, 1.2), 0x34383e, M(0, 3.92, 0));
  // 銅雀（屋頂上展翅的金鳥）
  b.add(ico(0.16, 0), GOLD, M(0, 4.62, 0));
  b.add(cone(0.08, 0.3, 4), GOLD, M(0, 4.6, 0.22, Math.PI / 2));
  for (const k of [-1, 1]) b.add(box(0.5, 0.04, 0.2), GOLD, M(k * 0.3, 4.68, 0, 0, 0, k * 0.4));
  b.add(cone(0.1, 0.25, 4), GOLD, M(0, 4.65, -0.22, -Math.PI / 2));
  // 四角闕樓
  for (const [x, z] of [[-2.0, -2.0], [2.0, -2.0], [-2.0, 2.0], [2.0, 2.0]]) {
    b.add(box(0.55, 1.2, 0.55), 0xb8392f, M(x, 1.3, z));
    b.add(pyramid(0.8, 0.4, 0.8), 0x34383e, M(x, 1.9, z));
    b.add(cone(0.06, 0.2, 4), GOLD, M(x, 2.38, z));
  }
  banner(b, -1.5, 1.5, 3.0, 1.1);
  banner(b, 1.5, 1.5, 3.0, 1.1);
  return b.build();
}

/** 蜀奇觀「劍閣」（5×5）：兩側陡峭山崖夾著雄關，棧道沿崖壁 */
function jiange(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  const ROCK = 0x8a8072;
  const ROCK_D = 0x6f675b;
  b.add(box(4.95, 1.0, 4.95), 0x8f8676, M(0, -0.3, 0));
  // 兩側山崖：堆疊的多面體岩塊，越高越窄
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const y = 0.5 + k * 0.85;
      const r = 1.05 - k * 0.18;
      b.add(ico(r, 0), k % 2 ? ROCK : ROCK_D, M(sx * (1.75 - k * 0.08), y, -0.2 + (k % 2) * 0.3, k, k * 0.7, 0, 1, 1.15, 1.1));
    }
    b.add(cone(0.55, 1.2, 5), ROCK, M(sx * 1.6, 3.9, -0.1));
    // 崖上小樹
    b.add(cone(0.22, 0.5, 5), 0x4c7a34, M(sx * 1.4, 4.1, 0.5));
    // 棧道：木板 ＋ 支架
    for (let k = 0; k < 4; k++) {
      b.add(box(0.5, 0.06, 0.5), PLANK, M(sx * (1.15 + (k % 2) * 0.25), 0.9 + k * 0.6, 1.2 - k * 0.45));
      b.add(cyl(0.025, 0.025, 0.5, 4), WOOD, M(sx * (1.15 + (k % 2) * 0.25), 0.65 + k * 0.6, 1.35 - k * 0.45, 0.6));
    }
  }
  // 中間雄關：石台 ＋ 門洞 ＋ 兩層城樓
  b.add(box(1.9, 1.5, 1.6), 0xa39684, M(0, 0.75, 0));
  b.add(box(0.8, 0.95, 0.1), DOOR, M(0, 0.48, 0.81));
  b.add(cyl(0.4, 0.4, 0.1, 10), DOOR, M(0, 0.95, 0.81, Math.PI / 2));
  for (let k = 0; k < 4; k++) b.add(box(0.3, 0.24, 0.24), 0x9a8d7b, M(-0.72 + k * 0.48, 1.62, 0.7));
  b.add(box(1.5, 0.7, 1.1), 0xb8392f, M(0, 2.1, -0.1));
  for (const x of [-0.6, -0.2, 0.2, 0.6]) b.add(cyl(0.05, 0.06, 0.7, 6), 0x8f2a24, M(x, 2.1, 0.47));
  brackets(b, 1.5, 2.45, 0.47);
  b.add(pyramid(2.1, 0.55, 1.6), 0x34383e, M(0, 2.48, -0.1));
  b.add(box(0.8, 0.4, 0.6), 0xb8392f, M(0, 3.1, -0.1));
  b.add(pyramid(1.2, 0.45, 0.95), 0x34383e, M(0, 3.3, -0.1));
  b.add(cone(0.06, 0.22, 4), GOLD, M(0, 3.82, -0.1));
  // 匾額「劍閣」
  b.add(box(0.7, 0.2, 0.04), 0x2a2018, M(0, 1.3, 0.83));
  b.add(box(0.6, 0.12, 0.03), GOLD, M(0, 1.3, 0.86));
  banner(b, -0.8, 0.6, 3.0, 1.0);
  banner(b, 0.8, 0.6, 3.0, 1.0);
  return b.build();
}

/** 吳奇觀「黃鶴樓」（5×5）：臨江高台上的四層樓閣，金瓦飛簷，旁有黃鶴 */
function huanghe(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  const GOLD_ROOF = 0xd9a83a;
  b.add(box(4.95, 1.0, 4.95), 0xd8d2c4, M(0, -0.3, 0));
  b.add(box(4.4, 0.4, 4.4), 0xcfc8b8, M(0, 0.4, 0));
  b.add(box(4.5, 0.06, 4.5), 0xa8322d, M(0, 0.62, 0));
  // 四層樓閣：每層縮小，紅柱 ＋ 金色四坡飛簷
  const tiers = [
    [2.6, 0.85, 0.65],
    [2.15, 0.75, 1.75],
    [1.75, 0.7, 2.75],
    [1.35, 0.6, 3.65],
  ];
  for (const [w, h, y] of tiers) {
    b.add(box(w * 0.82, h, w * 0.82), 0xb8392f, M(0, y + h / 2, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.add(cyl(0.05, 0.06, h, 6), 0x8f2a24, M(x * w * 0.42, y + h / 2, z * w * 0.42));
    b.add(pyramid(w * 1.25, 0.32, w * 1.25), GOLD_ROOF, M(0, y + h, 0));
    // 飛簷翹角
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.add(cone(0.07, 0.3, 4), GOLD_ROOF, M(x * w * 0.6, y + h + 0.06, z * w * 0.6, z * 0.9, 0, -x * 0.9));
    brackets(b, w * 0.8, y + h - 0.06, w * 0.42);
  }
  b.add(cone(0.12, 0.55, 6), GOLD, M(0, 4.85, 0));
  b.add(ico(0.1, 0), GOLD, M(0, 5.15, 0));
  // 黃鶴：身體、長頸、展開的翅膀
  const CRANE = 0xf0d070;
  b.add(ico(0.18, 0), CRANE, M(1.7, 1.25, 1.5, 0, 0, 0, 1.5, 0.8, 0.9));
  b.add(cyl(0.03, 0.04, 0.45, 4), CRANE, M(1.95, 1.48, 1.5, 0, 0, -0.6));
  b.add(cone(0.05, 0.14, 4), 0xc0302a, M(2.12, 1.66, 1.5, 0, 0, -1.4));
  for (const z of [-1, 1]) b.add(box(0.5, 0.03, 0.22), CRANE, M(1.65, 1.38, 1.5 + z * 0.28, z * 0.5, 0, 0.2));
  b.add(cyl(0.015, 0.015, 0.6, 3), 0x5a4a30, M(1.65, 0.9, 1.5));
  banner(b, -1.9, 1.9, 2.4, 1.0);
  banner(b, 1.9, -1.9, 2.4, 1.0);
  return b.build();
}

export const BUILDING_MODELS: Record<string, () => THREE.BufferGeometry> = {
  workshop,
  archery,
  stable,
  blacksmith,
  tower,
  palisade,
  wall,
  town_hall: townHall,
  house,
  granary,
  lumber_camp: lumberCamp,
  mine_camp: mineCamp,
  farm,
  barracks,
  fortress,
  academy,
  market,
  dock,
  gate,
  wonder,
  wonder_wei: wonder,
  wonder_shu: jiange,
  wonder_wu: huanghe,
};

/** 模型高度（建造中的縮放、點選判定用） */
export const BUILDING_HEIGHT: Record<string, number> = {
  town_hall: 2.7,
  house: 1.5,
  granary: 1.6,
  lumber_camp: 1.2,
  mine_camp: 1.2,
  farm: 0.4,
  barracks: 2.0,
  archery: 1.9,
  stable: 1.6,
  blacksmith: 2.0,
  tower: 3.0,
  palisade: 1.1,
  wall: 1.3,
  workshop: 2.6,
  fortress: 3.6,
  academy: 1.9,
  market: 2.0,
  dock: 2.0,
  gate: 1.6,
  wonder: 4.8,
  wonder_wei: 4.8,
  wonder_shu: 4.3,
  wonder_wu: 5.2,
};

/** 依時代建模（同一棟建築四個時代外觀不同） */
export function buildingModel(id: string, age: number): THREE.BufferGeometry {
  useStyle(STYLES[Math.max(0, Math.min(3, age - 1))]);
  const geo = (BUILDING_MODELS[id] ?? BUILDING_MODELS.house)();
  useStyle(STYLES[0]);
  return geo;
}
