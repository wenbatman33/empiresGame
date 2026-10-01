// 移動系統（docs/07 §4）：沿路徑／Flow Field 前進、局部避碰、抵達判定
import { FX_SHIFT, ONE, isqrt, tileCenter } from '../core/fixed';
import { CAPACITY, NAV, S } from '../core/world';
import type { Sim } from '../sim';
import { DX, DY, FLOW_INF } from './pathfinding';

/** 距離目標多近、且有視線時改成直走 */
const NEAR = 4 * ONE;
/** 路徑點抵達半徑 */
const WAYPOINT_R = (ONE * 4) / 10;
/** 每 tick 避碰修正上限 */
const MAX_PUSH = ONE >> 2;
/** 重疊時的固定推開方向（8 方向單位向量，定點數） */
const PUSH_X = [1024, 724, 0, -724, -1024, -724, 0, 724];
const PUSH_Y = [0, 724, 1024, 724, 0, -724, -1024, -724];

export class MovementSystem {
  private readonly cellHead: Int32Array;
  private readonly next = new Int32Array(CAPACITY);
  private readonly cx = new Int32Array(CAPACITY);
  private readonly cy = new Int32Array(CAPACITY);
  private readonly touched = new Uint8Array(CAPACITY);

  constructor(private readonly sim: Sim) {
    this.cellHead = new Int32Array(sim.map.w * sim.map.h);
  }

  step(): void {
    const sim = this.sim;
    const w = sim.world;
    const m = sim.map;
    const pf = sim.pf;
    const high = w.high;

    for (let id = 0; id < high; id++) {
      if (!w.alive[id]) continue;
      w.px[id] = w.x[id];
      w.py[id] = w.y[id];
    }

    // 1. 依導航方式決定這個 tick 往哪走
    for (let id = 0; id < high; id++) {
      if (!w.alive[id] || w.state[id] !== S.Move) continue;
      const x = w.x[id];
      const y = w.y[id];
      const gx = w.goalX[id];
      const gy = w.goalY[id];
      let tx = gx;
      let ty = gy;

      if (w.nav[id] === NAV.Flow) {
        const ddx = gx - x;
        const ddy = gy - y;
        if (ddx * ddx + ddy * ddy < NEAR * NEAR && pf.los(x, y, gx, gy)) {
          sim.releaseFlow(id);
          w.nav[id] = NAV.Direct;
        } else {
          const field = sim.flowFieldOf(w.flow[id]);
          const ti = m.idx(x >> FX_SHIFT, y >> FX_SHIFT);
          const d = field.dir[ti];
          if (d < 0) {
            sim.releaseFlow(id);
            if (field.dist[ti] >= FLOW_INF) sim.setPath(id, pf.findPath(x, y, gx, gy));
            else w.nav[id] = NAV.Direct;
          } else {
            // 往下一格中心走；若看得到下下格就直接瞄準下下格，路線比較順
            const t1x = (x >> FX_SHIFT) + DX[d];
            const t1y = (y >> FX_SHIFT) + DY[d];
            tx = tileCenter(t1x);
            ty = tileCenter(t1y);
            const d2 = field.dir[m.idx(t1x, t1y)];
            if (d2 >= 0) {
              const c2x = tileCenter(t1x + DX[d2]);
              const c2y = tileCenter(t1y + DY[d2]);
              if (pf.los(x, y, c2x, c2y)) {
                tx = c2x;
                ty = c2y;
              }
            }
          }
        }
      }

      if (w.nav[id] === NAV.Path) {
        const path = w.paths[id]!;
        const last = path.length / 2 - 1;
        let k = w.pathIdx[id];
        while (k < last) {
          const ex = path[k * 2] - x;
          const ey = path[k * 2 + 1] - y;
          if (ex * ex + ey * ey < WAYPOINT_R * WAYPOINT_R) k++;
          else break;
        }
        w.pathIdx[id] = k;
        tx = path[k * 2];
        ty = path[k * 2 + 1];
      }

      const step = Math.trunc((w.speed[id] * m.speedTenths(x >> FX_SHIFT, y >> FX_SHIFT)) / 10);
      const gdx = gx - x;
      const gdy = gy - y;
      if (gdx * gdx + gdy * gdy <= step * step) {
        this.place(id, gx, gy);
        sim.arrive(id);
        continue;
      }
      const vx = tx - x;
      const vy = ty - y;
      const len = isqrt(vx * vx + vy * vy);
      if (len === 0) continue;
      const mvx = Math.trunc((vx * step) / len);
      const mvy = Math.trunc((vy * step) / len);
      w.fx[id] = mvx;
      w.fy[id] = mvy;
      this.slide(id, x + mvx, y + mvy);
    }

    // 2. 局部避碰
    this.separate(high);

    // 3. 抵達與卡住判定
    for (let id = 0; id < high; id++) {
      if (!w.alive[id] || w.state[id] !== S.Move) continue;
      const gdx = w.goalX[id] - w.x[id];
      const gdy = w.goalY[id] - w.y[id];
      const gd2 = gdx * gdx + gdy * gdy;
      // 碰到同一批已抵達的友軍、且離目標不遠 → 就地停下（大部隊自然聚成一團）
      if (this.touched[id] && gd2 < 9 * ONE * ONE) {
        sim.arrive(id);
        continue;
      }
      const ax = w.x[id] - w.px[id];
      const ay = w.y[id] - w.py[id];
      const sp = w.speed[id];
      if ((ax * ax + ay * ay) * 16 < sp * sp) w.stuck[id]++;
      else w.stuck[id] = 0;
      const n = sim.groupSize(w.group[id]);
      const arriveR = ONE + Math.trunc((isqrt(n) * ONE * 35) / 100);
      if (w.stuck[id] >= 4 && gd2 < arriveR * arriveR) {
        sim.arrive(id);
      } else if (w.stuck[id] >= 30) {
        // 卡太久：直走或路徑模式就重新尋路；Flow 模式通常是隘口塞車，繼續等
        if (w.nav[id] !== NAV.Flow) sim.setPath(id, pf.findPath(w.x[id], w.y[id], w.goalX[id], w.goalY[id]));
        w.stuck[id] = 0;
      }
    }
  }

  /** 往 (nx,ny) 移動；撞牆時沿軸滑動 */
  private slide(id: number, nx: number, ny: number): void {
    const w = this.sim.world;
    const m = this.sim.map;
    const r = w.radius[id];
    nx = Math.max(r, Math.min(m.widthFx - r - 1, nx));
    ny = Math.max(r, Math.min(m.heightFx - r - 1, ny));
    const x = w.x[id];
    const y = w.y[id];
    if (m.walkableFx(nx, ny)) this.place(id, nx, ny);
    else if (m.walkableFx(nx, y)) this.place(id, nx, y);
    else if (m.walkableFx(x, ny)) this.place(id, x, ny);
  }

  /** 放到 (x,y)，並把身體推離相鄰的牆 */
  private place(id: number, x: number, y: number): void {
    const w = this.sim.world;
    const m = this.sim.map;
    const r = w.radius[id];
    const tx = x >> FX_SHIFT;
    const ty = y >> FX_SHIFT;
    const lx = x - (tx << FX_SHIFT);
    const ly = y - (ty << FX_SHIFT);
    if (lx < r && !m.walkable(tx - 1, ty)) x = (tx << FX_SHIFT) + r;
    else if (lx > ONE - r && !m.walkable(tx + 1, ty)) x = ((tx + 1) << FX_SHIFT) - r;
    if (ly < r && !m.walkable(tx, ty - 1)) y = (ty << FX_SHIFT) + r;
    else if (ly > ONE - r && !m.walkable(tx, ty + 1)) y = ((ty + 1) << FX_SHIFT) - r;
    w.x[id] = x;
    w.y[id] = y;
  }

  /** 空間雜湊（每格一桶）找重疊的單位，互相推開；移動中的單位會把閒置的推開 */
  private separate(high: number): void {
    const w = this.sim.world;
    const m = this.sim.map;
    const W = m.w;
    const H = m.h;
    const head = this.cellHead;
    const next = this.next;
    const cx = this.cx;
    const cy = this.cy;
    head.fill(-1);
    for (let id = 0; id < high; id++) {
      cx[id] = 0;
      cy[id] = 0;
      this.touched[id] = 0;
      if (!w.alive[id]) continue;
      const c = (w.y[id] >> FX_SHIFT) * W + (w.x[id] >> FX_SHIFT);
      next[id] = head[c];
      head[c] = id;
    }
    for (let i = 0; i < high; i++) {
      if (!w.alive[i]) continue;
      const xi = w.x[i];
      const yi = w.y[i];
      const ri = w.radius[i];
      const mi = w.state[i] === S.Move;
      const tx = xi >> FX_SHIFT;
      const ty = yi >> FX_SHIFT;
      for (let oy = -1; oy <= 1; oy++) {
        const cyy = ty + oy;
        if (cyy < 0 || cyy >= H) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const cxx = tx + ox;
          if (cxx < 0 || cxx >= W) continue;
          for (let j = head[cyy * W + cxx]; j !== -1; j = next[j]) {
            if (j <= i) continue;
            const dx = w.x[j] - xi;
            const dy = w.y[j] - yi;
            const rr = ri + w.radius[j];
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) continue;
            const d = isqrt(d2);
            let nx: number;
            let ny: number;
            if (d === 0) {
              const k = (i * 31 + j * 17) & 7;
              nx = PUSH_X[k];
              ny = PUSH_Y[k];
            } else {
              nx = Math.trunc((dx * ONE) / d);
              ny = Math.trunc((dy * ONE) / d);
            }
            const overlap = rr - d;
            const mj = w.state[j] === S.Move;
            let wi = 5;
            let wj = 5;
            if (mi && !mj) {
              wi = 2;
              wj = 8;
              if (w.group[i] === w.group[j]) this.touched[i] = 1;
            } else if (!mi && mj) {
              wi = 8;
              wj = 2;
              if (w.group[i] === w.group[j]) this.touched[j] = 1;
            }
            const px = Math.trunc((nx * overlap) / ONE);
            const py = Math.trunc((ny * overlap) / ONE);
            cx[i] -= Math.trunc((px * wi) / 10);
            cy[i] -= Math.trunc((py * wi) / 10);
            cx[j] += Math.trunc((px * wj) / 10);
            cy[j] += Math.trunc((py * wj) / 10);
          }
        }
      }
    }
    for (let id = 0; id < high; id++) {
      if (!w.alive[id] || (cx[id] === 0 && cy[id] === 0)) continue;
      const dx = Math.max(-MAX_PUSH, Math.min(MAX_PUSH, cx[id]));
      const dy = Math.max(-MAX_PUSH, Math.min(MAX_PUSH, cy[id]));
      this.slide(id, w.x[id] + dx, w.y[id] + dy);
    }
  }
}
