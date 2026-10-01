// 程式產生地圖（docs/05 §3）：同一個種子永遠產生同一張地圖
// 只用整數雜湊與四則運算，不用三角函數，跨裝置一致
import { RK } from '../core/defs';
import { Rng } from '../core/rng';
import { MapGrid, T, WATER_LEVEL, type TileType } from './grid';

/** 整數雜湊 → 0..65535 */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h & 0xffff;
}

/** 數值雜訊：整數雙線性內插 ＋ smoothstep，回傳 0..65535 */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = Math.floor(((x - gx * cell) * 256) / cell);
  const fy = Math.floor(((y - gy * cell) * 256) / cell);
  const sx = (fx * fx * (768 - 2 * fx)) >> 16;
  const sy = (fy * fy * (768 - 2 * fy)) >> 16;
  const a = hash2(gx, gy, seed);
  const b = hash2(gx + 1, gy, seed);
  const c = hash2(gx, gy + 1, seed);
  const d = hash2(gx + 1, gy + 1, seed);
  const ab = a + (((b - a) * sx) >> 8);
  const cd = c + (((d - c) * sx) >> 8);
  return ab + (((cd - ab) * sy) >> 8);
}

/** 多層雜訊，回傳 0..65535 */
function fbm(x: number, y: number, seed: number, cells: number[], weights: number[]): number {
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < cells.length; i++) {
    sum += valueNoise(x, y, cells[i], seed + i * 101) * weights[i];
    wsum += weights[i];
  }
  return Math.trunc(sum / wsum);
}

/** 點到折線的最短距離（格） */
function distToPolyline(px: number, py: number, pts: number[][]): number {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = ((px - ax) * vx + (py - ay) * vy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + vx * t);
    const dy = py - (ay + vy * t);
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** 折線上依比例取點 */
function pointAlong(pts: number[][], f: number): number[] {
  const segs = pts.length - 1;
  const pos = f * segs;
  const i = Math.min(segs - 1, Math.floor(pos));
  const t = pos - i;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
}

/** 河道剖面：離河心 d 格時的河床高度 */
function riverProfile(d: number): number {
  const W = WATER_LEVEL;
  if (d < 2) return W - 40 + d * 6;
  if (d < 3) return W - 28 + (d - 2) * 18;
  if (d < 4.5) return W - 10 + ((d - 3) * 20) / 1.5;
  return W + 10 + (d - 4.5) * 24;
}

const DIR8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** 中原地圖：平原丘陵、斜貫地圖的河流與 3 處淺灘、成片森林 */
export function generateCentralPlains(seed: number, size = 128): MapGrid {
  const map = new MapGrid(size, size);
  const rng = new Rng(seed);
  const S = size;

  // 1. 玩家起始點：左上與右下
  const m = Math.round(S * 0.2);
  map.starts = [
    { x: m, y: m },
    { x: S - 1 - m, y: S - 1 - m },
  ];

  // 2. 河流：沿反對角線（左下 → 右上），控制點左右擺動
  const river: number[][] = [];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const off = i === 0 || i === N ? 0 : rng.range(-9, 9);
    river.push([-8 + (S + 16) * t + off, S + 8 - (S + 16) * t + off]);
  }
  const fords = [0.32, 0.5, 0.68].map((f) => pointAlong(river, f + (rng.int(9) - 4) / 100));
  const fordDist = (x: number, y: number): number => {
    let best = 1e9;
    for (const [fx, fy] of fords) {
      const d2 = (x - fx) * (x - fx) + (y - fy) * (y - fy);
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };

  // 3. 頂點高度
  const startDist = (x: number, y: number): number => {
    let best = 1e9;
    for (const s of map.starts) {
      const d2 = (x - s.x - 0.5) * (x - s.x - 0.5) + (y - s.y - 0.5) * (y - s.y - 0.5);
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };
  for (let vy = 0; vy <= S; vy++) {
    for (let vx = 0; vx <= S; vx++) {
      let h = 64 + ((fbm(vx, vy, seed, [32, 16, 8], [4, 2, 1]) * 128) >> 16);
      // 起始點附近整平，方便之後蓋城
      const sd = startDist(vx, vy);
      if (sd < 10) h = Math.trunc(h + ((88 - h) * (10 - sd)) / 10);
      // 河道
      const d = distToPolyline(vx, vy, river);
      h = Math.min(h, Math.trunc(riverProfile(d)));
      // 淺灘渡口：河床墊高
      const fd = fordDist(vx, vy);
      if (fd < 4 && h < WATER_LEVEL - 12) h = Math.max(h, Math.trunc(WATER_LEVEL - 12 - (fd > 2.5 ? (fd - 2.5) * 16 : 0)));
      map.heights[vy * (S + 1) + vx] = h;
    }
  }

  // 4. 地形種類
  const riverD = new Float64Array(S * S);
  for (let ty = 0; ty < S; ty++) {
    for (let tx = 0; tx < S; tx++) {
      const cx = tx + 0.5;
      const cy = ty + 0.5;
      const d = distToPolyline(cx, cy, river);
      riverD[ty * S + tx] = d;
      const fd = fordDist(cx, cy);
      let t: TileType = T.Grass;
      if (d < 2.2) t = fd < 3.5 ? T.Shallow : T.Deep;
      else if (d < 3.2) t = T.Shallow;
      else if (d < 4.4) t = T.Sand;
      else if (fbm(tx, ty, seed + 31, [10, 5], [2, 1]) > 44000) t = T.Dirt;
      if (t === T.Grass && startDist(cx, cy) < 5) t = T.Dirt;
      map.setTile(tx, ty, t);
    }
  }

  // 5. 森林：依雜訊排序取前 11% 的可種格，數量穩定
  const eligible: number[] = [];
  const values = new Int32Array(S * S);
  for (let ty = 0; ty < S; ty++) {
    for (let tx = 0; tx < S; tx++) {
      const i = ty * S + tx;
      const tt = map.tiles[i];
      if (tt !== T.Grass && tt !== T.Dirt) continue;
      const cx = tx + 0.5;
      const cy = ty + 0.5;
      if (startDist(cx, cy) < 9 || riverD[i] < 5.5 || fordDist(cx, cy) < 7) continue;
      values[i] = fbm(tx, ty, seed + 57, [14, 7, 3], [4, 2, 1]) + (hash2(tx, ty, seed + 3) >> 4);
      eligible.push(i);
    }
  }
  eligible.sort((a, b) => values[b] - values[a] || a - b);
  const target = Math.min(eligible.length, Math.round(S * S * 0.11));
  for (let k = 0; k < target; k++) {
    const i = eligible[k];
    map.setTile(i % S, Math.floor(i / S), T.Forest);
  }
  // 每位玩家保證一片主森林（距起始點約 12 格）
  for (const s of map.starts) {
    const [dx, dy] = DIR8[rng.int(8)];
    const fx = s.x + dx * 12;
    const fy = s.y + dy * 12;
    for (let y = fy - 5; y <= fy + 5; y++) {
      for (let x = fx - 5; x <= fx + 5; x++) {
        if (!map.inBounds(x, y)) continue;
        const r2 = (x - fx) * (x - fx) + (y - fy) * (y - fy);
        if (r2 > 14 + (hash2(x, y, seed + 9) & 7)) continue;
        const tt = map.tiles[map.idx(x, y)];
        if ((tt === T.Grass || tt === T.Dirt) && startDist(x + 0.5, y + 0.5) >= 8) map.setTile(x, y, T.Forest);
      }
    }
  }

  // 6. 起始資源：以地圖中心點對稱放置，兩位玩家完全公平（docs/05 §4）
  placeStartResources(map, rng);

  // 7. 連通性驗證：兩個起始點一定要走得到；走不到就沿直線開路
  if (!reachable(map, map.starts[0], map.starts[1])) carve(map, map.starts[0], map.starts[1]);

  return map;
}

/** 16 方向單位向量 ×1000（不用三角函數） */
const DIR16 = [
  [1000, 0], [924, 383], [707, 707], [383, 924], [0, 1000], [-383, 924], [-707, 707], [-924, 383],
  [-1000, 0], [-924, -383], [-707, -707], [-383, -924], [0, -1000], [383, -924], [707, -707], [924, -383],
];
/** 資源堆形狀（相對格） */
const BLOB = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [2, 1], [1, 2], [-1, 1]];
const BERRY = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]];

function placeStartResources(map: MapGrid, rng: Rng): void {
  const S = map.w;
  const s0 = map.starts[0];
  const mirror = (x: number, y: number): [number, number] => [S - 1 - x, S - 1 - y];
  const used = new Uint8Array(S * S);
  const clusters: [number, number, number, number, number[][]][] = [
    // 種類、數量、最近、最遠、形狀
    [RK.berry, 6, 6, 9, BERRY],
    [RK.gold, 7, 10, 14, BLOB],
    [RK.stone, 5, 12, 16, BLOB],
    [RK.gold, 4, 18, 24, BLOB],
    [RK.stone, 4, 18, 24, BLOB],
    [RK.deer, 1, 10, 16, [[0, 0]]],
    [RK.deer, 1, 10, 16, [[0, 0]]],
    [RK.deer, 1, 10, 16, [[0, 0]]],
    [RK.deer, 1, 10, 16, [[0, 0]]],
    [RK.boar, 1, 12, 18, [[0, 0]]],
    [RK.boar, 1, 12, 18, [[0, 0]]],
  ];
  const ok = (x: number, y: number): boolean => {
    if (!map.inBounds(x, y) || used[y * S + x]) return false;
    const t = map.tiles[y * S + x];
    if (t !== T.Grass && t !== T.Dirt && t !== T.Forest) return false;
    // 離太守府（4×4）至少 4 格
    for (const s of map.starts) if (Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) < 5) return false;
    return true;
  };
  for (const [kind, n, dMin, dMax, shape] of clusters) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const [dx, dy] = DIR16[rng.int(16)];
      const dist = rng.range(dMin, dMax);
      const cx = s0.x + Math.round((dx * dist) / 1000);
      const cy = s0.y + Math.round((dy * dist) / 1000);
      const tiles = shape.slice(0, n).map(([ox, oy]) => [cx + ox, cy + oy]);
      // 自己和鏡像位置都要合法，周圍一圈也不能是水
      const all = tiles.flatMap(([x, y]) => [[x, y], mirror(x, y)]);
      if (!all.every(([x, y]) => ok(x, y))) continue;
      for (const [x, y] of all) {
        used[y * S + x] = 1;
        if (map.tiles[y * S + x] === T.Forest) map.setTile(x, y, T.Grass);
        map.resourceSpots.push({ kind, tx: x, ty: y });
      }
      break;
    }
  }
}

function reachable(map: MapGrid, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const seen = new Uint8Array(map.w * map.h);
  const q = [map.idx(a.x, a.y)];
  seen[q[0]] = 1;
  const goal = map.idx(b.x, b.y);
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    if (i === goal) return true;
    const x = i % map.w;
    const y = Math.floor(i / map.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.walkable(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (seen[ni]) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return false;
}

function carve(map: MapGrid, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let k = 0; k <= steps; k++) {
    const x = Math.round(a.x + ((b.x - a.x) * k) / steps);
    const y = Math.round(a.y + ((b.y - a.y) * k) / steps);
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
      if (!map.inBounds(x + ox, y + oy)) continue;
      const t = map.tiles[map.idx(x + ox, y + oy)];
      if (t === T.Forest) map.setTile(x + ox, y + oy, T.Grass);
      else if (t === T.Deep) map.setTile(x + ox, y + oy, T.Shallow);
    }
  }
}
