// 建築、資源點、玩家狀態
import { BUILDING_DEFS, ECONOMY, RESOURCE_KINDS, type Cost } from './defs';
import { tileCenter } from './fixed';

/** 建築表 */
export class Buildings {
  static readonly CAP = 1024;
  readonly alive = new Uint8Array(Buildings.CAP);
  readonly owner = new Uint8Array(Buildings.CAP);
  readonly btype = new Uint8Array(Buildings.CAP);
  /** 左上角格子 */
  readonly tx = new Int16Array(Buildings.CAP);
  readonly ty = new Int16Array(Buildings.CAP);
  readonly hp = new Int32Array(Buildings.CAP);
  /** 施工進度（單位：1/3 tick；需要 buildTicks × 3） */
  readonly progress = new Int32Array(Buildings.CAP);
  readonly complete = new Uint8Array(Buildings.CAP);
  /** 農田剩餘糧食與耕作中的民夫 */
  readonly food = new Int32Array(Buildings.CAP);
  readonly farmer = new Int32Array(Buildings.CAP).fill(-1);
  /** 生產佇列（單位種類）與目前進度（tick） */
  readonly queue: number[][] = Array.from({ length: Buildings.CAP }, () => []);
  readonly qProgress = new Int32Array(Buildings.CAP);
  readonly loop = new Uint8Array(Buildings.CAP);
  /** 集結點：定點數座標（-1 ＝ 沒設）與資源目標 */
  readonly rallyX = new Int32Array(Buildings.CAP).fill(-1);
  readonly rallyY = new Int32Array(Buildings.CAP).fill(-1);
  readonly rallyRes = new Int32Array(Buildings.CAP).fill(-1);
  readonly createdTick = new Int32Array(Buildings.CAP);
  high = 0;
  count = 0;
  private free: number[] = [];

  add(btype: number, owner: number, tx: number, ty: number, complete: boolean, tick: number): number {
    const id = this.free.length ? this.free.pop()! : this.high++;
    if (id >= Buildings.CAP) throw new Error('建築數超過上限');
    const def = BUILDING_DEFS[btype];
    this.alive[id] = 1;
    this.owner[id] = owner;
    this.btype[id] = btype;
    this.tx[id] = tx;
    this.ty[id] = ty;
    this.complete[id] = complete ? 1 : 0;
    this.progress[id] = complete ? def.buildTicks * 3 : 0;
    this.hp[id] = complete ? def.hp : 1;
    this.food[id] = def.food;
    this.farmer[id] = -1;
    this.queue[id] = [];
    this.qProgress[id] = 0;
    this.loop[id] = 0;
    this.rallyX[id] = -1;
    this.rallyY[id] = -1;
    this.rallyRes[id] = -1;
    this.createdTick[id] = tick;
    this.count++;
    return id;
  }

  remove(id: number): void {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.queue[id] = [];
    this.count--;
    this.free.push(id);
  }

  /** 中心點（定點數） */
  centerX(id: number): number {
    return (this.tx[id] << 10) + ((BUILDING_DEFS[this.btype[id]].w << 10) >> 1);
  }

  centerY(id: number): number {
    return (this.ty[id] << 10) + ((BUILDING_DEFS[this.btype[id]].h << 10) >> 1);
  }
}

/** 資源點表（樹、野果、金、石、鹿、野豬） */
export class Resources {
  static readonly CAP = 16384;
  readonly alive = new Uint8Array(Resources.CAP);
  readonly kind = new Uint8Array(Resources.CAP);
  readonly tx = new Int16Array(Resources.CAP);
  readonly ty = new Int16Array(Resources.CAP);
  /** 中心點（定點數） */
  readonly x = new Int32Array(Resources.CAP);
  readonly y = new Int32Array(Resources.CAP);
  readonly amount = new Int32Array(Resources.CAP);
  high = 0;
  count = 0;

  add(kind: number, tx: number, ty: number): number {
    const id = this.high++;
    if (id >= Resources.CAP) throw new Error('資源點超過上限');
    this.alive[id] = 1;
    this.kind[id] = kind;
    this.tx[id] = tx;
    this.ty[id] = ty;
    this.x[id] = tileCenter(tx);
    this.y[id] = tileCenter(ty);
    this.amount[id] = RESOURCE_KINDS[kind].amount;
    this.count++;
    return id;
  }

  remove(id: number): void {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.count--;
  }
}

/** 玩家狀態 */
export class Player {
  res: Cost;
  pop = 0;
  popCap = 0;
  age = 1;
  /** 各資源採集倍率（千分比，科技加成用） */
  gatherMul = [1000, 1000, 1000, 1000];
  carryCap = ECONOMY.carry;
  /** 人口滿了、生產卡住 */
  housed = false;
  /** 農田耗盡時自動重播 */
  autoReseed = true;
  /** 統計：累計採集量 */
  gathered = [0, 0, 0, 0];
  defeated = false;

  constructor(start: Cost) {
    this.res = [...start] as Cost;
  }

  canAfford(c: Cost): boolean {
    return this.res[0] >= c[0] && this.res[1] >= c[1] && this.res[2] >= c[2] && this.res[3] >= c[3];
  }

  pay(c: Cost): void {
    for (let i = 0; i < 4; i++) this.res[i] -= c[i];
  }

  refund(c: Cost): void {
    for (let i = 0; i < 4; i++) this.res[i] += c[i];
  }
}
