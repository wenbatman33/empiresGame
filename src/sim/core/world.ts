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
/** 戰鬥命令 */
export const ORDER = { None: 0, Move: 1, Attack: 2, AttackMove: 3, Patrol: 4 } as const;
/** 姿態（docs/03 §4）：進攻、防守（預設，追 8 格返回）、堅守、不還擊 */
export const STANCE = { Aggressive: 0, Defensive: 1, Stand: 2, Passive: 3 } as const;
/** 攻擊目標種類 */
export const TK = { None: 0, Unit: 1, Building: 2 } as const;

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

  // ── 戰鬥 ──
  readonly order = new Uint8Array(CAPACITY);
  readonly stance = new Uint8Array(CAPACITY);
  readonly tgtKind = new Uint8Array(CAPACITY);
  readonly tgt = new Int32Array(CAPACITY).fill(-1);
  readonly cooldown = new Uint16Array(CAPACITY);
  /** 攻擊移動的目的地、防守姿態的原點 */
  readonly destX = new Int32Array(CAPACITY);
  readonly destY = new Int32Array(CAPACITY);
  readonly homeX = new Int32Array(CAPACITY);
  readonly homeY = new Int32Array(CAPACITY);
  /** 最近一次出手的 tick（渲染對齊攻擊動畫） */
  readonly lastHit = new Int32Array(CAPACITY);
  readonly lastAttacker = new Int32Array(CAPACITY).fill(-1);
  readonly repath = new Uint16Array(CAPACITY);

  // ── M4：武將技、狀態效果、謀士、運兵 ──
  /** 主動技能可再用的 tick */
  readonly skillReady = new Int32Array(CAPACITY);
  /** 攻擊加成（%）與到期 tick */
  readonly atkPct = new Int16Array(CAPACITY);
  readonly atkUntil = new Int32Array(CAPACITY);
  /** 移速加成（%，負數＝緩速）與到期 */
  readonly spdPct = new Int16Array(CAPACITY);
  readonly spdUntil = new Int32Array(CAPACITY);
  /** 受到傷害減免（%）與到期 */
  readonly defPct = new Int16Array(CAPACITY);
  readonly defUntil = new Int32Array(CAPACITY);
  /** 恐懼：到期 tick（期間四散逃跑、不能攻擊） */
  readonly fearUntil = new Int32Array(CAPACITY);
  readonly invulnUntil = new Int32Array(CAPACITY);
  /** 隱形：敵人無法鎖定 */
  readonly stealthUntil = new Int32Array(CAPACITY);
  /** 下一擊 ×3（張遼八百破十萬） */
  readonly tripleUntil = new Int32Array(CAPACITY);
  /** 衝鋒預備（虎豹騎：休息一陣子後第一擊 ×2） */
  readonly calm = new Uint16Array(CAPACITY);
  /** 武將威名（擊殺數）與等級 1–3 */
  readonly renown = new Uint16Array(CAPACITY);
  readonly level = new Uint8Array(CAPACITY);
  /** 謀士勸降：累積 tick 與需要的 tick */
  readonly convertAcc = new Int32Array(CAPACITY);
  readonly convertNeed = new Int32Array(CAPACITY);
  /** 搬運中的物品（兵書、玉璽，-1 ＝ 沒有） */
  readonly item = new Int32Array(CAPACITY).fill(-1);
  /** 坐在哪艘運兵船上（-1 ＝ 沒有）；在船上的兵不畫、不打、不碰撞 */
  readonly aboard = new Int32Array(CAPACITY).fill(-1);
  /** 離間計：原本的主人與歸還 tick；疑兵：消失 tick */
  readonly origOwner = new Int16Array(CAPACITY).fill(-1);
  readonly revertAt = new Int32Array(CAPACITY);
  readonly expireAt = new Int32Array(CAPACITY);

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
    this.order[id] = 0;
    this.stance[id] = def.worker ? STANCE.Passive : STANCE.Defensive;
    this.tgtKind[id] = 0;
    this.tgt[id] = -1;
    this.cooldown[id] = 0;
    this.destX[id] = this.homeX[id] = x;
    this.destY[id] = this.homeY[id] = y;
    this.lastHit[id] = -1000;
    this.lastAttacker[id] = -1;
    this.repath[id] = 0;
    this.skillReady[id] = tick + 100;
    this.atkUntil[id] = this.spdUntil[id] = this.defUntil[id] = this.fearUntil[id] = 0;
    this.invulnUntil[id] = this.stealthUntil[id] = this.tripleUntil[id] = 0;
    this.calm[id] = 50;
    this.renown[id] = 0;
    this.level[id] = 1;
    this.convertAcc[id] = this.convertNeed[id] = 0;
    this.item[id] = -1;
    this.aboard[id] = -1;
    this.origOwner[id] = -1;
    this.revertAt[id] = 0;
    this.expireAt[id] = 0;
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
