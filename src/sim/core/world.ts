// 世界狀態：單位用結構陣列（SoA）存放，id 就是陣列索引
import { UNIT_DEFS } from './defs';

export { UNIT_DEFS, UNIT_INDEX } from './defs';

export const CAPACITY = 4096;

/** 單位狀態 */
export const S = { Idle: 0, Move: 1, Attack: 2, Dead: 3, Work: 4 } as const;
/** 導航方式 */
export const NAV = { None: 0, Path: 1, Flow: 2, Direct: 3 } as const;
/** 工作任務（民夫） */
export const TASK = { None: 0, Gather: 1, Farm: 2, Return: 3, Build: 4 } as const;

export class World {
  readonly alive = new Uint8Array(CAPACITY);
  readonly owner = new Uint8Array(CAPACITY);
  readonly utype = new Uint8Array(CAPACITY);
  readonly state = new Uint8Array(CAPACITY);
  readonly nav = new Uint8Array(CAPACITY);
  /** 目前位置與上一個 tick 的位置（渲染層用來內插） */
  readonly x = new Int32Array(CAPACITY);
  readonly y = new Int32Array(CAPACITY);
  readonly px = new Int32Array(CAPACITY);
  readonly py = new Int32Array(CAPACITY);
  /** 面向（未正規化的方向向量） */
  readonly fx = new Int32Array(CAPACITY);
  readonly fy = new Int32Array(CAPACITY);
  readonly speed = new Int32Array(CAPACITY);
  readonly radius = new Int32Array(CAPACITY);
  readonly hp = new Int32Array(CAPACITY);
  readonly goalX = new Int32Array(CAPACITY);
  readonly goalY = new Int32Array(CAPACITY);
  readonly flow = new Int32Array(CAPACITY).fill(-1);
  readonly pathIdx = new Int32Array(CAPACITY);
  readonly group = new Int32Array(CAPACITY);
  readonly stuck = new Uint16Array(CAPACITY);
  /** 進入目前狀態的 tick（渲染層對齊動畫用） */
  readonly stateTick = new Int32Array(CAPACITY);
  /** A* 路徑：[x0, y0, x1, y1, ...] 定點數 */
  readonly paths: (Int32Array | null)[] = new Array(CAPACITY).fill(null);

  // ── 民夫工作 ──
  readonly task = new Uint8Array(CAPACITY);
  /** 任務目標：資源 id 或建築 id */
  readonly target = new Int32Array(CAPACITY).fill(-1);
  /** 身上帶的資源種類與數量 */
  readonly carryRes = new Uint8Array(CAPACITY);
  readonly carry = new Int32Array(CAPACITY);
  /** 採集累積（千分之一單位） */
  readonly gatherAcc = new Int32Array(CAPACITY);
  /** 上次採的資源類別與位置（採完自動找下一個） */
  readonly lastKind = new Int8Array(CAPACITY).fill(-1);
  readonly lastX = new Int32Array(CAPACITY);
  readonly lastY = new Int32Array(CAPACITY);
  readonly attempts = new Uint8Array(CAPACITY);
  /** 回倉前的工作目標（交完資源回去繼續） */
  readonly prevTask = new Uint8Array(CAPACITY);
  readonly prevTarget = new Int32Array(CAPACITY).fill(-1);

  /** 曾經用過的最大 id ＋ 1；遍歷時只需掃到這裡 */
  high = 0;
  count = 0;
  private free: number[] = [];

  spawn(utype: number, owner: number, x: number, y: number, tick: number): number {
    const id = this.free.length ? this.free.pop()! : this.high++;
    if (id >= CAPACITY) throw new Error('單位數超過上限');
    const def = UNIT_DEFS[utype];
    this.alive[id] = 1;
    this.owner[id] = owner;
    this.utype[id] = utype;
    this.state[id] = S.Idle;
    this.nav[id] = NAV.None;
    this.x[id] = this.px[id] = x;
    this.y[id] = this.py[id] = y;
    this.fx[id] = 0;
    this.fy[id] = owner === 0 ? 1 : -1;
    this.speed[id] = def.speedFx;
    this.radius[id] = def.radiusFx;
    this.hp[id] = def.hp;
    this.goalX[id] = x;
    this.goalY[id] = y;
    this.flow[id] = -1;
    this.pathIdx[id] = 0;
    this.group[id] = 0;
    this.stuck[id] = 0;
    this.stateTick[id] = tick;
    this.paths[id] = null;
    this.task[id] = 0;
    this.target[id] = -1;
    this.carryRes[id] = 0;
    this.carry[id] = 0;
    this.gatherAcc[id] = 0;
    this.lastKind[id] = -1;
    this.attempts[id] = 0;
    this.prevTask[id] = 0;
    this.prevTarget[id] = -1;
    this.count++;
    return id;
  }

  remove(id: number): void {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.paths[id] = null;
    this.flow[id] = -1;
    this.count--;
    this.free.push(id);
  }

  clear(): void {
    this.alive.fill(0);
    this.paths.fill(null);
    this.flow.fill(-1);
    this.high = 0;
    this.count = 0;
    this.free = [];
  }
}
