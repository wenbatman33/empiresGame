// 地圖格網：地形種類、通行性、頂點高度
import { FX_SHIFT, ONE } from '../core/fixed';
import { Hasher } from '../core/hash';

/** 地形種類 */
export const T = {
  Grass: 0,
  Dirt: 1,
  Sand: 2,
  Shallow: 3,
  Deep: 4,
  Forest: 5,
  /** 山崖（蜀道），不可通行 */
  Rock: 6,
} as const;
export type TileType = (typeof T)[keyof typeof T];

/** 通行性：0 不可通行、1 陸地、2 淺灘（減速） */
export const PASS_BLOCKED = 0;
export const PASS_LAND = 1;
export const PASS_SHALLOW = 2;

/** 高度單位：1 格 = 64 */
export const HEIGHT_UNIT = 64;
/** 水面高度（高度單位） */
export const WATER_LEVEL = 40;

/** 地形本身的通行性（不含建築、資源） */
export function basePass(t: number): number {
  return t === T.Deep || t === T.Forest || t === T.Rock ? PASS_BLOCKED : t === T.Shallow ? PASS_SHALLOW : PASS_LAND;
}

/** 水面通行性：深水、淺灘可行船 */
export function baseWaterPass(t: number): number {
  return t === T.Deep || t === T.Shallow ? 1 : 0;
}

export class MapGrid {
  readonly tiles: Uint8Array;
  readonly pass: Uint8Array;
  /** 水面通行性（船用）：1 ＝ 可行船 */
  readonly wpass: Uint8Array;
  /** 地圖類型 */
  type = 'central';
  /** 兵書、傳國玉璽的位置 */
  itemSpots: { kind: 'scroll' | 'seal'; tx: number; ty: number }[] = [];
  /** (w+1)*(h+1) 個頂點高度 */
  readonly heights: Int16Array;
  /** 玩家起始點（格子座標） */
  starts: { x: number; y: number }[] = [];
  /** 地圖產生器放的資源點（樹木另由森林格產生） */
  resourceSpots: { kind: number; tx: number; ty: number }[] = [];
  /** 通行性改變時遞增（建築蓋好、樹被砍），讓尋路快取失效 */
  passVersion = 0;

  constructor(readonly w: number, readonly h: number) {
    this.tiles = new Uint8Array(w * h);
    this.pass = new Uint8Array(w * h).fill(PASS_LAND);
    this.wpass = new Uint8Array(w * h);
    this.heights = new Int16Array((w + 1) * (h + 1));
  }

  idx(tx: number, ty: number): number {
    return ty * this.w + tx;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  walkable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.pass[ty * this.w + tx] !== PASS_BLOCKED;
  }

  /** 定點數座標所在格是否可走 */
  walkableFx(x: number, y: number): boolean {
    return this.walkable(x >> FX_SHIFT, y >> FX_SHIFT);
  }

  setTile(tx: number, ty: number, t: TileType): void {
    const i = this.idx(tx, ty);
    this.tiles[i] = t;
    this.pass[i] = basePass(t);
    this.wpass[i] = baseWaterPass(t);
  }

  /** 該格移速倍率（十分比） */
  speedTenths(tx: number, ty: number): number {
    return this.pass[ty * this.w + tx] === PASS_SHALLOW ? 7 : 10;
  }

  /** 地圖總寬（定點數） */
  get widthFx(): number {
    return this.w * ONE;
  }

  get heightFx(): number {
    return this.h * ONE;
  }

  hash(): number {
    return new Hasher().add(this.w).add(this.h).addArray(this.tiles).addArray(this.heights).value();
  }
}
