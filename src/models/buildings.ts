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
};

/** 依時代建模（同一棟建築四個時代外觀不同） */
export function buildingModel(id: string, age: number): THREE.BufferGeometry {
  useStyle(STYLES[Math.max(0, Math.min(3, age - 1))]);
  const geo = (BUILDING_MODELS[id] ?? BUILDING_MODELS.house)();
  useStyle(STYLES[0]);
  return geo;
}
