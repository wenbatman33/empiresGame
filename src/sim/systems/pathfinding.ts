// 尋路（docs/07 §4）：A*、Flow Field、視線檢查
// 全部整數成本與固定的鄰居順序，結果跨裝置一致
import { FX_SHIFT, ONE, isqrt, tileCenter } from '../core/fixed';
import { PASS_BLOCKED, PASS_SHALLOW, type MapGrid } from '../map/grid';

/** 8 方向：N E S W NE SE SW NW（固定順序，影響同分時的選擇） */
export const DX = [0, 1, 0, -1, 1, 1, -1, -1];
export const DY = [-1, 0, 1, 0, -1, 1, 1, -1];
const COST = [10, 10, 10, 10, 14, 14, 14, 14];
const INF = 0x3fffffff;

export interface FlowField {
  goal: number;
  dist: Int32Array;
  dir: Int8Array;
}

/** 二元最小堆（節點 id，依 f、h、id 排序） */
class Heap {
  items: number[] = [];
  constructor(private f: Int32Array, private h: Int32Array) {}
  private less(a: number, b: number): boolean {
    const fa = this.f[a];
    const fb = this.f[b];
    if (fa !== fb) return fa < fb;
    const ha = this.h[a];
    const hb = this.h[b];
    if (ha !== hb) return ha < hb;
    return a < b;
  }
  push(n: number): void {
    const it = this.items;
    it.push(n);
    let i = it.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(it[i], it[p])) break;
      [it[i], it[p]] = [it[p], it[i]];
      i = p;
    }
  }
  pop(): number {
    const it = this.items;
    const top = it[0];
    const last = it.pop()!;
    if (it.length) {
      it[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < it.length && this.less(it[l], it[m])) m = l;
        if (r < it.length && this.less(it[r], it[m])) m = r;
        if (m === i) break;
        [it[i], it[m]] = [it[m], it[i]];
        i = m;
      }
    }
    return top;
  }
  get size(): number {
    return this.items.length;
  }
  clear(): void {
    this.items.length = 0;
  }
}

export class Pathfinder {
  private readonly n: number;
  /** 這個尋路器用的通行格網（陸地 map.pass、水面 map.wpass） */
  private readonly pass: Uint8Array;
  private readonly g: Int32Array;
  private readonly f: Int32Array;
  private readonly hh: Int32Array;
  private readonly parent: Int32Array;
  private readonly open: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  private readonly heap: Heap;
  /** 統計：累計展開的節點數（DEV 面板顯示） */
  nodesExpanded = 0;

  constructor(
    private readonly map: MapGrid,
    readonly water = false,
  ) {
    this.pass = water ? map.wpass : map.pass;
    this.n = map.w * map.h;
    this.g = new Int32Array(this.n);
    this.f = new Int32Array(this.n);
    this.hh = new Int32Array(this.n);
    this.parent = new Int32Array(this.n);
    this.open = new Uint32Array(this.n);
    this.closed = new Uint32Array(this.n);
    this.heap = new Heap(this.f, this.hh);
  }

  /** 該格可走嗎（依領域） */
  ok(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.map.w && y < this.map.h && this.pass[y * this.map.w + x] !== PASS_BLOCKED;
  }

  okFx(x: number, y: number): boolean {
    return this.ok(x >> FX_SHIFT, y >> FX_SHIFT);
  }

  /** 走到該格的成本倍率（陸地的淺灘 1.5 倍） */
  private stepCost(dirIdx: number, toIdx: number): number {
    const c = COST[dirIdx];
    return !this.water && this.pass[toIdx] === PASS_SHALLOW ? c + (c >> 1) : c;
  }

  /** 從 (x,y) 往 d 方向走一格是否合法（斜走不能切牆角） */
  canStep(x: number, y: number, d: number): boolean {
    const nx = x + DX[d];
    const ny = y + DY[d];
    if (!this.ok(nx, ny)) return false;
    if (d >= 4 && (!this.ok(x + DX[d], y) || !this.ok(x, y + DY[d]))) return false;
    return true;
  }

  private octile(ax: number, ay: number, bx: number, by: number): number {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
  }

  /** 最近的可走格（由內往外一圈圈找） */
  nearestWalkable(tx: number, ty: number): [number, number] {
    const m = this.map;
    tx = Math.max(0, Math.min(m.w - 1, tx));
    ty = Math.max(0, Math.min(m.h - 1, ty));
    if (this.ok(tx, ty)) return [tx, ty];
    for (let r = 1; r < 48; r++) {
      let best = -1;
      let bestD = INF;
      for (let y = ty - r; y <= ty + r; y++) {
        for (let x = tx - r; x <= tx + r; x++) {
          if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r || !this.ok(x, y)) continue;
          const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
          if (d < bestD) {
            bestD = d;
            best = m.idx(x, y);
          }
        }
      }
      if (best >= 0) return [best % m.w, Math.floor(best / m.w)];
    }
    return [tx, ty];
  }

  /**
   * A*：回傳拉直後的路徑點（定點數 [x0,y0,x1,y1,...]），最後一點是 (gx,gy)
   * 走不到時回傳到「最接近目標的可達格」的路徑
   */
  findPath(sx: number, sy: number, gx: number, gy: number): Int32Array {
    const m = this.map;
    const W = m.w;
    const stx = sx >> FX_SHIFT;
    const sty = sy >> FX_SHIFT;
    let [gtx, gty] = this.nearestWalkable(gx >> FX_SHIFT, gy >> FX_SHIFT);
    const goalExact = this.okFx(gx, gy);
    const start = m.idx(stx, sty);
    const goal = m.idx(gtx, gty);
    const gen = ++this.gen;
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.hh[start] = this.octile(stx, sty, gtx, gty);
    this.f[start] = this.hh[start];
    this.parent[start] = -1;
    this.open[start] = gen;
    heap.push(start);
    let best = start;
    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      this.nodesExpanded++;
      if (this.hh[cur] < this.hh[best]) best = cur;
      if (cur === goal) {
        found = true;
        break;
      }
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (let d = 0; d < 8; d++) {
        if (!this.canStep(cx, cy, d)) continue;
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        const ni = ny * W + nx;
        if (this.closed[ni] === gen) continue;
        const ng = this.g[cur] + this.stepCost(d, ni);
        if (this.open[ni] === gen && ng >= this.g[ni]) continue;
        this.open[ni] = gen;
        this.g[ni] = ng;
        this.hh[ni] = this.octile(nx, ny, gtx, gty);
        this.f[ni] = ng + this.hh[ni];
        this.parent[ni] = cur;
        heap.push(ni);
      }
    }
    const end = found ? goal : best;
    // 回溯格子序列
    const tiles: number[] = [];
    for (let c = end; c !== -1; c = this.parent[c]) tiles.push(c);
    tiles.reverse();
    // 終點座標：走得到就用精確目標，否則用該格中心
    const ex = found && goalExact ? gx : tileCenter(end % W);
    const ey = found && goalExact ? gy : tileCenter(Math.floor(end / W));
    return this.smooth(sx, sy, tiles, ex, ey);
  }

  /** 拉直路徑：從目前點盡量往遠處有視線的點直走 */
  private smooth(sx: number, sy: number, tiles: number[], ex: number, ey: number): Int32Array {
    const W = this.map.w;
    const pts: number[] = [];
    for (let i = 1; i < tiles.length - 1; i++) pts.push(tileCenter(tiles[i] % W), tileCenter(Math.floor(tiles[i] / W)));
    pts.push(ex, ey);
    const out: number[] = [];
    let ax = sx;
    let ay = sy;
    let i = 0;
    const n = pts.length / 2;
    while (i < n) {
      // 找最遠的可直達點
      let j = n - 1;
      while (j > i && !this.los(ax, ay, pts[j * 2], pts[j * 2 + 1])) j--;
      out.push(pts[j * 2], pts[j * 2 + 1]);
      ax = pts[j * 2];
      ay = pts[j * 2 + 1];
      i = j + 1;
    }
    return Int32Array.from(out);
  }

  /** 視線檢查：兩點間每 1/4 格取樣，經過的格都要可走，且不能斜切牆角 */
  los(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const len = isqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(len / (ONE >> 2)));
    let ptx = ax >> FX_SHIFT;
    let pty = ay >> FX_SHIFT;
    for (let k = 1; k <= steps; k++) {
      const x = ax + Math.trunc((dx * k) / steps);
      const y = ay + Math.trunc((dy * k) / steps);
      const tx = x >> FX_SHIFT;
      const ty = y >> FX_SHIFT;
      if (tx === ptx && ty === pty) continue;
      if (!this.ok(tx, ty)) return false;
      if (tx !== ptx && ty !== pty && (!this.ok(tx, pty) || !this.ok(ptx, ty))) return false;
      ptx = tx;
      pty = ty;
    }
    return true;
  }

  /** Flow Field：以目標格為源跑 Dijkstra，每格記下往目標走的方向 */
  flowField(gtx: number, gty: number): FlowField {
    const m = this.map;
    const W = m.w;
    const dist = new Int32Array(this.n).fill(INF);
    const dir = new Int8Array(this.n).fill(-1);
    const goal = m.idx(gtx, gty);
    const gen = ++this.gen;
    const heap = this.heap;
    heap.clear();
    // 借用 f 當作距離鍵，hh 清零讓排序只看距離
    dist[goal] = 0;
    this.f[goal] = 0;
    this.hh[goal] = 0;
    heap.push(goal);
    while (heap.size) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      this.nodesExpanded++;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (let d = 0; d < 8; d++) {
        // 反向搜尋：鄰居 → cur，需要鄰居能合法走到 cur
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (!this.ok(nx, ny)) continue;
        const back = d < 4 ? (d + 2) % 4 : 4 + ((d - 4 + 2) % 4);
        if (!this.canStep(nx, ny, back)) continue;
        const ni = ny * W + nx;
        if (this.closed[ni] === gen) continue;
        const nd = dist[cur] + this.stepCost(d, cur);
        if (nd >= dist[ni]) continue;
        dist[ni] = nd;
        this.f[ni] = nd;
        this.hh[ni] = 0;
        heap.push(ni);
      }
    }
    // 每格選距離最小的鄰居當方向
    for (let i = 0; i < this.n; i++) {
      if (dist[i] === INF || i === goal) continue;
      const x = i % W;
      const y = (i - x) / W;
      let bestD = dist[i];
      let bestDir = -1;
      for (let d = 0; d < 8; d++) {
        if (!this.canStep(x, y, d)) continue;
        const nd = dist[(y + DY[d]) * W + x + DX[d]];
        if (nd < bestD) {
          bestD = nd;
          bestDir = d;
        }
      }
      dir[i] = bestDir;
    }
    return { goal, dist, dir };
  }
}

/** Flow Field 的「不可達」距離 */
export const FLOW_INF = INF;
