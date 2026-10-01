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

/** 地圖類型（docs/05 §2） */
export const MAP_TYPES = ['central', 'yangtze', 'shudao', 'chibi'] as const;
export const MAP_NAMES: Record<string, string> = { central: '中原', yangtze: '長江', shudao: '蜀道', chibi: '赤壁', random: '隨機' };

interface MapStyle {
  /** 河寬倍率（0 ＝ 沒有河） */
  river: number;
  /** 渡口位置（沿河比例）、陸橋（true ＝ 整片陸地，赤壁用） */
  fords: number[];
  bridge: boolean;
  /** 中央山脊（蜀道）與隘口位置 */
  ridge: boolean;
  passes: number[];
  forest: number;
  /** 每位玩家魚群數 */
  fish: number;
  /** 地形起伏 */
  relief: number;
}

function styleOf(type: string, size: number): MapStyle {
  switch (type) {
    case 'yangtze':
      return { river: 1.9, fords: [0.3, 0.5, 0.7], bridge: false, ridge: false, passes: [], forest: 0.1, fish: 4, relief: 128 };
    case 'chibi':
      return { river: size / 34, fords: [0.14, 0.86], bridge: true, ridge: false, passes: [], forest: 0.09, fish: 6, relief: 110 };
    case 'shudao':
      return { river: 0, fords: [], bridge: false, ridge: true, passes: [0.3, 0.5, 0.7], forest: 0.08, fish: 0, relief: 230 };
    default:
      return { river: 1, fords: [0.32, 0.5, 0.68], bridge: false, ridge: false, passes: [], forest: 0.11, fish: 0, relief: 128 };
  }
}

/** 中原地圖（相容舊呼叫） */
export function generateCentralPlains(seed: number, size = 128): MapGrid {
  return generateMap('central', seed, size);
}

/**
 * 依類型產生地圖：中原（細河 3 淺灘）、長江（大河 3 淺灘 ＋ 魚）、蜀道（中央山脊 2 隘口、高低落差大）、
 * 赤壁（整片江面，只有兩端角落有陸橋，要走水路或繞遠路）
 */
export function generateMap(type: string, seed: number, size = 128): MapGrid {
  if (type === 'random' || !MAP_TYPES.includes(type as (typeof MAP_TYPES)[number])) type = MAP_TYPES[new Rng(seed ^ 0x2545f491).int(MAP_TYPES.length)];
  const st = styleOf(type, size);
  const map = new MapGrid(size, size);
  map.type = type;
  const rng = new Rng(seed);
  const S = size;
  const K = st.river || 1;

  // 1. 玩家起始點：左上與右下
  const m = Math.round(S * 0.2);
  map.starts = [
    { x: m, y: m },
    { x: S - 1 - m, y: S - 1 - m },
  ];

  // 2. 河流／山脊：沿反對角線（左下 → 右上），控制點左右擺動；對地圖中心點對稱，兩邊地形一樣公平
  const line: number[][] = [];
  const N = 6;
  const wob = st.river > 2 ? 4 : 9;
  const offs: number[] = [];
  for (let i = 0; i <= N; i++) {
    if (i === 0 || i === N || i * 2 === N) offs.push(0);
    else if (i * 2 < N) offs.push(rng.range(-wob, wob));
    else offs.push(-offs[N - i]);
  }
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    line.push([-8 + (S + 16) * t + offs[i], S + 8 - (S + 16) * t + offs[i]]);
  }
  /** 沿線位置加亂數偏移，左右成對鏡像 */
  const symmetric = (fs: number[], jitter: number): number[] => {
    const shift = new Map<string, number>();
    return fs.map((f) => {
      if (!jitter || f === 0.5) return f;
      const key = Math.min(f, 1 - f).toFixed(3);
      if (!shift.has(key)) shift.set(key, (rng.int(jitter * 2 + 1) - jitter) / 100);
      return f < 0.5 ? f + shift.get(key)! : f - shift.get(key)!;
    });
  };
  const fords = symmetric(st.fords, st.bridge ? 0 : 4).map((f) => pointAlong(line, f));
  const passes = symmetric(st.passes, 3).map((f) => pointAlong(line, f));
  const centerDist = (x: number, y: number): number => Math.sqrt((x - S / 2) * (x - S / 2) + (y - S / 2) * (y - S / 2));
  const nearest = (pts: number[][], x: number, y: number): number => {
    let best = 1e9;
    for (const [fx, fy] of pts) {
      const d2 = (x - fx) * (x - fx) + (y - fy) * (y - fy);
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };
  const fordDist = (x: number, y: number): number => nearest(fords, x, y);
  const passDist = (x: number, y: number): number => nearest(passes, x, y);
  const fordR = st.bridge ? 2.2 * K + 3 : 3.5 * Math.min(K, 1.6);

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
      let h = 64 + ((fbm(vx, vy, seed, [32, 16, 8], [4, 2, 1]) * st.relief) >> 16);
      const sd = startDist(vx, vy);
      if (st.ridge) {
        // 山脊隆起，隘口保持低平
        const d = distToPolyline(vx, vy, line);
        const pd = passDist(vx, vy);
        if (d < 6 && pd > 3) h += Math.trunc((6 - d) * 22 * Math.min(1, (pd - 3) / 3));
        h = Math.max(h, WATER_LEVEL + 14);
      } else if (st.river) {
        const d = distToPolyline(vx, vy, line);
        const fd = fordDist(vx, vy);
        if (st.bridge && (fd < fordR || centerDist(vx, vy) < 3.2)) {
          // 陸橋、江心小島：保持在水面上
          h = Math.max(h, WATER_LEVEL + 12);
        } else {
          h = Math.min(h, Math.trunc(riverProfile(d / K)));
          // 淺灘渡口：河床墊高
          if (!st.bridge && fd < 4 * Math.min(K, 1.6) && h < WATER_LEVEL - 12) h = Math.max(h, Math.trunc(WATER_LEVEL - 12 - (fd > 2.5 ? (fd - 2.5) * 16 : 0)));
        }
      }
      // 起始點附近整平，方便之後蓋城
      if (sd < 10) h = Math.trunc(h + ((88 - h) * (10 - sd)) / 10);
      map.heights[vy * (S + 1) + vx] = h;
    }
  }

  mirrorHeights(map);

  // 4. 地形種類
  const lineD = new Float64Array(S * S);
  for (let ty = 0; ty < S; ty++) {
    for (let tx = 0; tx < S; tx++) {
      const cx = tx + 0.5;
      const cy = ty + 0.5;
      const d = distToPolyline(cx, cy, line);
      lineD[ty * S + tx] = d;
      let t: TileType = T.Grass;
      if (st.ridge) {
        if (d < 3 && passDist(cx, cy) > 2.6) t = T.Rock;
        else if (startDist(cx, cy) > 14 && passDist(cx, cy) > 6 && fbm(tx, ty, seed + 77, [9, 4], [2, 1]) > 47500) t = T.Rock;
        else if (fbm(tx, ty, seed + 31, [10, 5], [2, 1]) > 42000) t = T.Dirt;
      } else {
        const fd = fordDist(cx, cy);
        const cd = centerDist(cx, cy);
        const land = st.bridge && (fd < fordR - 1 || cd < 2.6);
        const dk = d / K;
        if (!land && dk < 2.2) t = !st.bridge && fd < 3.5 * Math.min(K, 1.6) ? T.Shallow : T.Deep;
        else if (!land && dk < 3.2) t = T.Shallow;
        else if (!land && dk < 4.4) t = T.Sand;
        else if (st.bridge && cd < 2.6) t = T.Sand;
        else if (fbm(tx, ty, seed + 31, [10, 5], [2, 1]) > 44000) t = T.Dirt;
      }
      if (t === T.Grass && startDist(cx, cy) < 5) t = T.Dirt;
      map.setTile(tx, ty, t);
    }
  }

  // 5. 森林：依雜訊排序取前 N% 的可種格，數量穩定
  const eligible: number[] = [];
  const values = new Int32Array(S * S);
  const keep = st.ridge ? 3.5 : 4.4 * K + 1.1;
  for (let ty = 0; ty < S; ty++) {
    for (let tx = 0; tx < S; tx++) {
      const i = ty * S + tx;
      const tt = map.tiles[i];
      if (tt !== T.Grass && tt !== T.Dirt) continue;
      const cx = tx + 0.5;
      const cy = ty + 0.5;
      if (startDist(cx, cy) < 9 || lineD[i] < keep || (fords.length && fordDist(cx, cy) < 7) || (passes.length && passDist(cx, cy) < 6)) continue;
      values[i] = fbm(tx, ty, seed + 57, [14, 7, 3], [4, 2, 1]) + (hash2(tx, ty, seed + 3) >> 4);
      eligible.push(i);
    }
  }
  eligible.sort((a, b) => values[b] - values[a] || a - b);
  const target = Math.min(eligible.length, Math.round(S * S * st.forest));
  for (let k = 0; k < target; k++) {
    const i = eligible[k];
    map.setTile(i % S, Math.floor(i / S), T.Forest);
  }
  // 每位玩家保證一片主森林（距起始點約 12 格），兩邊鏡像
  {
    const s = map.starts[0];
    let fx = s.x;
    let fy = s.y;
    for (let tries = 0; tries < 8; tries++) {
      const [dx, dy] = DIR8[rng.int(8)];
      fx = s.x + dx * 12;
      fy = s.y + dy * 12;
      const t0 = map.tiles[map.idx(Math.max(0, Math.min(S - 1, fx)), Math.max(0, Math.min(S - 1, fy)))];
      if (t0 !== T.Deep && t0 !== T.Shallow && t0 !== T.Rock) break;
    }
    for (let y = fy - 5; y <= fy + 5; y++) {
      for (let x = fx - 5; x <= fx + 5; x++) {
        const r2 = (x - fx) * (x - fx) + (y - fy) * (y - fy);
        if (r2 > 14 + (hash2(x, y, seed + 9) & 7)) continue;
        for (const [px, py] of [[x, y], [S - 1 - x, S - 1 - y]]) {
          if (!map.inBounds(px, py)) continue;
          const tt = map.tiles[map.idx(px, py)];
          if ((tt === T.Grass || tt === T.Dirt) && startDist(px + 0.5, py + 0.5) >= 8) map.setTile(px, py, T.Forest);
        }
      }
    }
  }

  // 森林、岩塊也鏡像：兩位玩家附近的地形完全相同
  mirrorTiles(map);

  // 6. 起始資源：以地圖中心點對稱放置，兩位玩家完全公平（docs/05 §4）
  const used = placeStartResources(map, rng);
  if (st.fish) placeFish(map, rng, st.fish, used);
  placeItems(map, used);
  ensureResourcesReachable(map);

  // 7. 連通性驗證：兩個起始點一定要走得到；走不到就沿直線開路
  if (!reachable(map, map.starts[0], map.starts[1])) carve(map, map.starts[0], map.starts[1]);

  return map;
}

/** 以地圖中心點對稱：左上半邊（含反對角線的一半）複製到右下半邊 */
function mirrorTiles(map: MapGrid): void {
  const S = map.w;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const mx = S - 1 - x;
      const my = S - 1 - y;
      if (x + y < S - 1 || (x + y === S - 1 && x < mx)) map.setTile(mx, my, map.tiles[map.idx(x, y)] as TileType);
    }
  }
}

function mirrorHeights(map: MapGrid): void {
  const S = map.w;
  const W = S + 1;
  for (let vy = 0; vy <= S; vy++) {
    for (let vx = 0; vx <= S; vx++) {
      if (vx + vy < S || (vx + vy === S && vx < S - vx)) map.heights[(S - vy) * W + (S - vx)] = map.heights[vy * W + vx];
    }
  }
}

/** 魚群：深水格、靠近自家岸邊（3 格內有陸地）、距起始點 8–30 格，鏡像放置 */
function placeFish(map: MapGrid, rng: Rng, n: number, used: Uint8Array): void {
  const S = map.w;
  const s0 = map.starts[0];
  const water = (x: number, y: number) => map.inBounds(x, y) && (map.tiles[map.idx(x, y)] === T.Deep || map.tiles[map.idx(x, y)] === T.Shallow);
  const shore = (x: number, y: number): boolean => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (map.inBounds(x + dx, y + dy) && !water(x + dx, y + dy)) return true;
    return false;
  };
  const cand: number[] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (map.tiles[map.idx(x, y)] !== T.Deep || !shore(x, y)) continue;
      const d = Math.max(Math.abs(x - s0.x), Math.abs(y - s0.y));
      if (d < 6 || d > 34) continue;
      // 要比較靠近自己（鏡像那格歸對手）
      const dm = Math.max(Math.abs(S - 1 - x - s0.x), Math.abs(S - 1 - y - s0.y));
      if (dm <= d) continue;
      if (map.tiles[map.idx(S - 1 - x, S - 1 - y)] !== T.Deep) continue;
      cand.push(map.idx(x, y));
    }
  }
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < n && cand.length; tries++) {
    const i = cand[rng.int(cand.length)];
    const x = i % S;
    const y = Math.floor(i / S);
    const [mx, my] = [S - 1 - x, S - 1 - y];
    let clash = false;
    for (let dy = -2; dy <= 2 && !clash; dy++) for (let dx = -2; dx <= 2; dx++) if (map.inBounds(x + dx, y + dy) && used[map.idx(x + dx, y + dy)]) clash = true;
    if (clash) continue;
    used[i] = 1;
    used[map.idx(mx, my)] = 1;
    map.resourceSpots.push({ kind: RK.fish, tx: x, ty: y }, { kind: RK.fish, tx: mx, ty: my });
    placed++;
  }
}

/** 兵書 4 卷（兩組鏡像）＋ 傳國玉璽 1 枚（地圖正中央附近） */
function placeItems(map: MapGrid, used: Uint8Array): void {
  const S = map.w;
  const land = (x: number, y: number): boolean => {
    if (!map.inBounds(x, y) || used[map.idx(x, y)]) return false;
    const t = map.tiles[map.idx(x, y)];
    return t === T.Grass || t === T.Dirt || t === T.Sand || t === T.Shallow;
  };
  /** 從 (x,y) 往外找最近的空地；要求鏡像位置也合法 */
  const find = (x: number, y: number, mirror: boolean): [number, number] | null => {
    for (let r = 0; r < S / 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const px = x + dx;
          const py = y + dy;
          if (!land(px, py)) continue;
          if (mirror && !land(S - 1 - px, S - 1 - py)) continue;
          return [px, py];
        }
      }
    }
    return null;
  };
  const c = Math.floor(S / 2);
  const seal = find(c, c, false);
  if (seal) {
    map.itemSpots.push({ kind: 'seal', tx: seal[0], ty: seal[1] });
    used[map.idx(seal[0], seal[1])] = 1;
  }
  for (const [fx, fy] of [[0.22, 0.78], [0.45, 0.16]]) {
    const p = find(Math.round(S * fx), Math.round(S * fy), true);
    if (!p) continue;
    for (const [x, y] of [p, [S - 1 - p[0], S - 1 - p[1]]]) {
      map.itemSpots.push({ kind: 'scroll', tx: x, ty: y });
      used[map.idx(x, y)] = 1;
    }
  }
}

/** 16 方向單位向量 ×1000（不用三角函數） */
const DIR16 = [
  [1000, 0], [924, 383], [707, 707], [383, 924], [0, 1000], [-383, 924], [-707, 707], [-924, 383],
  [-1000, 0], [-924, -383], [-707, -707], [-383, -924], [0, -1000], [383, -924], [707, -707], [924, -383],
];
/** 資源堆形狀（相對格） */
const BLOB = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [2, 1], [1, 2], [-1, 1]];
const BERRY = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]];

function placeStartResources(map: MapGrid, rng: Rng): Uint8Array {
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
    // 動物、野果放在空地上（不然會被樹包住）
    if (t === T.Forest && !mineral) return false;
    // 離太守府（4×4）至少 4 格
    for (const s of map.starts) if (Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) < 5) return false;
    return true;
  };
  let mineral = false;
  for (const [kind, n, dMin, dMax, shape] of clusters) {
    mineral = kind === RK.gold || kind === RK.stone;
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
  return used;
}

/** 起始資源一定要走得到：被森林／山崖包住的就沿直線往出生點開路 */
function ensureResourcesReachable(map: MapGrid): void {
  const S = map.w;
  const blocking = new Uint8Array(S * S);
  for (const r of map.resourceSpots) if (r.kind !== RK.deer && r.kind !== RK.boar && r.kind !== RK.fish) blocking[r.ty * S + r.tx] = 1;
  const open = (x: number, y: number) => map.walkable(x, y) && !blocking[y * S + x];
  const reach = new Uint8Array(S * S);
  const flood = () => {
    reach.fill(0);
    const q: number[] = [];
    for (const s of map.starts) {
      const i = s.y * S + s.x;
      if (open(s.x, s.y) && !reach[i]) {
        reach[i] = 1;
        q.push(i);
      }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const x = q[qi] % S;
      const y = Math.floor(q[qi] / S);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!open(nx, ny) || reach[ny * S + nx]) continue;
        reach[ny * S + nx] = 1;
        q.push(ny * S + nx);
      }
    }
  };
  flood();
  let changed = false;
  for (const r of map.resourceSpots) {
    if (r.kind === RK.fish) continue;
    let ok = false;
    for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++) if (map.inBounds(r.tx + dx, r.ty + dy) && reach[(r.ty + dy) * S + r.tx + dx]) ok = true;
    if (ok) continue;
    // 往最近的出生點開一條 1 格寬的路，直到接上可到達區域
    let best = map.starts[0];
    for (const s of map.starts) if (Math.abs(s.x - r.tx) + Math.abs(s.y - r.ty) < Math.abs(best.x - r.tx) + Math.abs(best.y - r.ty)) best = s;
    const steps = Math.max(Math.abs(best.x - r.tx), Math.abs(best.y - r.ty));
    for (let k = 1; k <= steps; k++) {
      const x = Math.round(r.tx + ((best.x - r.tx) * k) / steps);
      const y = Math.round(r.ty + ((best.y - r.ty) * k) / steps);
      if (reach[y * S + x]) break;
      const t = map.tiles[y * S + x];
      if (t === T.Forest || t === T.Rock) map.setTile(x, y, T.Grass);
      else if (t === T.Deep) map.setTile(x, y, T.Shallow);
    }
    changed = true;
  }
  if (changed) flood();
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
      if (t === T.Forest || t === T.Rock) map.setTile(x + ox, y + oy, T.Grass);
      else if (t === T.Deep) map.setTile(x + ox, y + oy, T.Shallow);
    }
  }
}
