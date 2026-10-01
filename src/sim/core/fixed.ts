// 定點數工具（docs/07 §3）：模擬層的位置、速度一律用整數，1 格 = ONE
// JS 的數字在 2^53 內做整數加減乘是精確的；除法統一走 idiv，平方根走 isqrt，跨裝置結果一致

export const FX_SHIFT = 10;
export const ONE = 1 << FX_SHIFT; // 1 格 = 1024
export const HALF = ONE >> 1;
export const TICK_HZ = 10; // 每秒 10 tick
export const TICK_MS = 1000 / TICK_HZ;

/** 資料表（格、格/秒）轉定點數；只在載入資料時用 */
export const toFx = (tiles: number): number => Math.round(tiles * ONE);
/** 每秒速度（格/秒）轉每 tick 位移（定點數） */
export const speedPerTick = (tilesPerSec: number): number => Math.round((tilesPerSec * ONE) / TICK_HZ);

/** 整數除法（向零取整） */
export const idiv = (a: number, b: number): number => Math.trunc(a / b);

/** 整數平方根（向下取整），先用 sqrt 估再修正，保證結果精確 */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** 定點數座標 → 格子座標 */
export const tileOf = (v: number): number => v >> FX_SHIFT;
/** 格子座標 → 該格中心的定點數座標 */
export const tileCenter = (t: number): number => (t << FX_SHIFT) + HALF;
