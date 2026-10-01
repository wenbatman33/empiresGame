// 確定性模擬層入口（docs/07 §3）
// 規則：只接受指令改變世界；每 tick 固定步驟；同種子 ＋ 同指令 → 同結果
import type { Command, CommandInput } from './core/commands';
import { FX_SHIFT, ONE, isqrt, tileCenter, toFx } from './core/fixed';
import { Hasher } from './core/hash';
import { Rng } from './core/rng';
import { NAV, S, UNIT_DEFS, World } from './core/world';
import { generateCentralPlains } from './map/generator';
import type { MapGrid } from './map/grid';
import { MovementSystem } from './systems/movement';
import { Pathfinder, type FlowField } from './systems/pathfinding';

export interface SimOptions {
  seed: number;
  mapSize?: number;
  /** 測試用：直接給地圖 */
  map?: MapGrid;
}

interface FlowEntry {
  field: FlowField;
  key: number;
  refs: number;
}

/** 這個數量以上的部隊共用一張 Flow Field，以下各自跑 A* */
const FLOW_MIN_GROUP = 8;

export class Sim {
  tick = 0;
  readonly seed: number;
  readonly map: MapGrid;
  readonly world = new World();
  readonly rng: Rng;
  readonly pf: Pathfinder;
  private readonly movement: MovementSystem;
  private readonly flows = new Map<number, FlowEntry>();
  private readonly flowByKey = new Map<number, number>();
  private nextFlow = 1;
  private readonly groups = new Map<number, number>();
  private nextGroup = 1;
  private pending: Command[] = [];
  /** 已執行的指令（含實際 tick），重播 ＝ 種子 ＋ 這份紀錄 */
  readonly history: Command[] = [];
  /** 最近一次建立的 Flow Field（DEV 疊加層顯示用） */
  lastFlow: FlowField | null = null;
  readonly stats = { flowBuilds: 0, paths: 0 };

  constructor(opts: SimOptions) {
    this.seed = opts.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.map = opts.map ?? generateCentralPlains(this.seed, opts.mapSize ?? 128);
    this.pf = new Pathfinder(this.map);
    this.movement = new MovementSystem(this);
  }

  /** 排程指令：預設在下一次 step 執行 */
  issue(input: CommandInput, delay = 0): Command {
    const cmd = { ...input, tick: this.tick + delay } as Command;
    this.pending.push(cmd);
    return cmd;
  }

  step(): void {
    if (this.pending.length) {
      const due: Command[] = [];
      const later: Command[] = [];
      for (const c of this.pending) (c.tick <= this.tick ? due : later).push(c);
      this.pending = later;
      for (const c of due) {
        c.tick = this.tick;
        this.history.push(c);
        this.apply(c);
      }
    }
    this.movement.step();
    this.tick++;
  }

  /** 世界狀態雜湊（確定性測試、未來多人不同步偵測） */
  hash(): number {
    const w = this.world;
    const h = new Hasher().add(this.tick).add(w.high).add(w.count);
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id]) continue;
      h.add(id).add(w.owner[id]).add(w.utype[id]).add(w.state[id]).add(w.x[id]).add(w.y[id]).add(w.hp[id]);
    }
    h.addArray(this.rng.getState());
    return h.value();
  }

  // ───────── 指令 ─────────

  private apply(c: Command): void {
    switch (c.t) {
      case 'spawn':
        this.cmdSpawn(c.player, c.unit, c.x, c.y, c.count);
        break;
      case 'move':
        this.cmdMove(c.player, c.ids, c.x, c.y);
        break;
      case 'stop':
        for (const id of this.ownedIds(c.player, c.ids)) this.arrive(id);
        break;
      case 'clear':
        for (let id = 0; id < this.world.high; id++) if (this.world.alive[id]) this.releaseNav(id);
        this.world.clear();
        this.groups.clear();
        break;
    }
  }

  private ownedIds(player: number, ids: number[]): number[] {
    const w = this.world;
    const out = ids.filter((id) => id >= 0 && id < w.high && w.alive[id] && w.owner[id] === player && w.state[id] !== S.Dead);
    out.sort((a, b) => a - b);
    return out.filter((id, i) => i === 0 || out[i - 1] !== id);
  }

  /** 在 (x,y) 附近以 0.7 格間距由內往外排開 */
  private cmdSpawn(player: number, unit: number, x: number, y: number, count: number): void {
    if (unit < 0 || unit >= UNIT_DEFS.length) return;
    const [ctx, cty] = this.pf.nearestWalkable(x >> FX_SHIFT, y >> FX_SHIFT);
    const cx = tileCenter(ctx);
    const cy = tileCenter(cty);
    const sp = toFx(0.7);
    let placed = 0;
    for (let r = 0; placed < count && r < 80; r++) {
      for (let j = -r; j <= r && placed < count; j++) {
        for (let i = -r; i <= r && placed < count; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const px = cx + i * sp;
          const py = cy + j * sp;
          if (px < 0 || py < 0 || px >= this.map.widthFx || py >= this.map.heightFx || !this.map.walkableFx(px, py)) continue;
          this.world.spawn(unit, player, px, py, this.tick);
          placed++;
        }
      }
    }
  }

  private cmdMove(player: number, rawIds: number[], x: number, y: number): void {
    const w = this.world;
    const ids = this.ownedIds(player, rawIds);
    if (!ids.length) return;
    const exact = this.map.walkableFx(x, y);
    const [gtx, gty] = this.pf.nearestWalkable(x >> FX_SHIFT, y >> FX_SHIFT);
    const gx = exact ? x : tileCenter(gtx);
    const gy = exact ? y : tileCenter(gty);
    const group = this.nextGroup++;
    this.groups.set(group, ids.length);
    const slots = this.formationSlots(ids, gx, gy);
    const flowId = ids.length >= FLOW_MIN_GROUP ? this.acquireFlow(gtx, gty) : -1;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      this.releaseNav(id);
      const sx = slots[k * 2];
      const sy = slots[k * 2 + 1];
      w.goalX[id] = sx;
      w.goalY[id] = sy;
      w.group[id] = group;
      w.stuck[id] = 0;
      if (w.state[id] !== S.Move) {
        w.state[id] = S.Move;
        w.stateTick[id] = this.tick;
      }
      const dx = sx - w.x[id];
      const dy = sy - w.y[id];
      if (dx * dx + dy * dy < 16 * ONE * ONE && this.pf.los(w.x[id], w.y[id], sx, sy)) {
        w.nav[id] = NAV.Direct;
      } else if (flowId >= 0) {
        w.nav[id] = NAV.Flow;
        w.flow[id] = flowId;
        this.flows.get(flowId)!.refs++;
      } else {
        this.setPath(id, this.pf.findPath(w.x[id], w.y[id], sx, sy));
      }
    }
    if (flowId >= 0 && this.flows.get(flowId)!.refs === 0) this.dropFlow(flowId);
  }

  /**
   * 陣型站位：以移動方向為前方排成方陣
   * 離目標最近的單位排前排，同一排依左右位置排序，減少交叉
   */
  private formationSlots(ids: number[], gx: number, gy: number): Int32Array {
    const w = this.world;
    const n = ids.length;
    const out = new Int32Array(n * 2);
    if (n === 1) {
      out[0] = gx;
      out[1] = gy;
      return out;
    }
    let sx = 0;
    let sy = 0;
    let maxR = 0;
    for (const id of ids) {
      sx += w.x[id];
      sy += w.y[id];
      maxR = Math.max(maxR, w.radius[id]);
    }
    const cx = Math.trunc(sx / n);
    const cy = Math.trunc(sy / n);
    let fx = gx - cx;
    let fy = gy - cy;
    const len = isqrt(fx * fx + fy * fy);
    if (len < ONE >> 2) {
      fx = 0;
      fy = ONE;
    } else {
      fx = Math.trunc((fx * ONE) / len);
      fy = Math.trunc((fy * ONE) / len);
    }
    const lx = -fy;
    const ly = fx;
    const spacing = maxR * 2 + (ONE >> 3);
    const cols = isqrt(n - 1) + 1;
    const rows = Math.ceil(n / cols);
    const order = ids.map((id, k) => ({
      k,
      p: (w.x[id] - cx) * fx + (w.y[id] - cy) * fy,
      q: (w.x[id] - cx) * lx + (w.y[id] - cy) * ly,
      id,
    }));
    order.sort((a, b) => b.p - a.p || a.id - b.id);
    for (let r = 0; r < rows; r++) {
      const row = order.slice(r * cols, (r + 1) * cols);
      row.sort((a, b) => a.q - b.q || a.id - b.id);
      const rowOff = Math.trunc((((rows - 1) - 2 * r) * spacing) / 2);
      for (let c = 0; c < row.length; c++) {
        const colOff = Math.trunc(((2 * c - (row.length - 1)) * spacing) / 2);
        let px = gx + Math.trunc((lx * colOff + fx * rowOff) / ONE);
        let py = gy + Math.trunc((ly * colOff + fy * rowOff) / ONE);
        px = Math.max(0, Math.min(this.map.widthFx - 1, px));
        py = Math.max(0, Math.min(this.map.heightFx - 1, py));
        if (!this.map.walkableFx(px, py)) {
          const [tx, ty] = this.pf.nearestWalkable(px >> FX_SHIFT, py >> FX_SHIFT);
          px = tileCenter(tx);
          py = tileCenter(ty);
        }
        out[row[c].k * 2] = px;
        out[row[c].k * 2 + 1] = py;
      }
    }
    return out;
  }

  // ───────── 導航狀態（移動系統也會呼叫） ─────────

  setPath(id: number, path: Int32Array): void {
    const w = this.world;
    this.releaseFlow(id);
    this.stats.paths++;
    w.paths[id] = path;
    w.pathIdx[id] = 0;
    w.nav[id] = NAV.Path;
    // 走不到原目標時，目標改成路徑終點
    w.goalX[id] = path[path.length - 2];
    w.goalY[id] = path[path.length - 1];
  }

  arrive(id: number): void {
    const w = this.world;
    this.releaseNav(id);
    if (w.state[id] !== S.Idle) {
      w.state[id] = S.Idle;
      w.stateTick[id] = this.tick;
    }
    w.stuck[id] = 0;
  }

  private releaseNav(id: number): void {
    const w = this.world;
    this.releaseFlow(id);
    w.paths[id] = null;
    w.nav[id] = NAV.None;
  }

  releaseFlow(id: number): void {
    const w = this.world;
    const f = w.flow[id];
    if (f < 0) return;
    w.flow[id] = -1;
    const e = this.flows.get(f);
    if (e && --e.refs <= 0) this.dropFlow(f);
  }

  flowFieldOf(flowId: number): FlowField {
    return this.flows.get(flowId)!.field;
  }

  groupSize(group: number): number {
    return this.groups.get(group) ?? 1;
  }

  private acquireFlow(gtx: number, gty: number): number {
    const key = (this.map.passVersion * this.map.h + gty) * this.map.w + gtx;
    const existing = this.flowByKey.get(key);
    if (existing !== undefined) return existing;
    const field = this.pf.flowField(gtx, gty);
    this.stats.flowBuilds++;
    this.lastFlow = field;
    const id = this.nextFlow++;
    this.flows.set(id, { field, key, refs: 0 });
    this.flowByKey.set(key, id);
    return id;
  }

  private dropFlow(flowId: number): void {
    const e = this.flows.get(flowId);
    if (!e) return;
    this.flows.delete(flowId);
    this.flowByKey.delete(e.key);
  }

  get activeFlows(): number {
    return this.flows.size;
  }
}
