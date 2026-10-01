// 建築、資源點、玩家狀態
import { BUILDING_DEFS, BUILDING_INDEX, ECONOMY, RESOURCE_KINDS, TAG, TECH_DEFS, UNIT_DEFS, UNIT_INDEX, type Cost } from './defs';
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
  /** 防禦建築射箭冷卻 */
  readonly cooldown = new Uint16Array(Buildings.CAP);
  /** 研究中的科技（-1 ＝ 沒有）與進度 tick */
  readonly research = new Int32Array(Buildings.CAP).fill(-1);
  readonly rProgress = new Int32Array(Buildings.CAP);
  readonly lastAttacker = new Int32Array(Buildings.CAP).fill(-1);
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
    this.cooldown[id] = 0;
    this.lastAttacker[id] = -1;
    this.research[id] = -1;
    this.rProgress[id] = 0;
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
  /** 難度倍率（千分比；簡單 AI 採集 ×0.8、瘋狂 ×1.3，docs/05 §7） */
  handicap = 1000;
  /** 統計：累計採集量 */
  gathered = [0, 0, 0, 0];
  defeated = false;
  /** 統計（結算畫面） */
  stats = { trained: 0, lost: 0, kills: 0, razed: 0, buildingsLost: 0, researched: 0 };

  // ── 科技 ──
  /** 已研究的科技 */
  readonly techs = new Set<number>();
  /** 農田採集倍率（千分比）、每塊農田額外糧食 */
  farmMul = 1000;
  farmFood = 0;
  /** 兵種升級：原本種類 → 目前種類 */
  readonly upgrade: number[] = UNIT_DEFS.map((_, i) => i);
  /** 依科技算出的兵種數值 */
  readonly uAtk = new Int32Array(UNIT_DEFS.length);
  readonly uArmM = new Int32Array(UNIT_DEFS.length);
  readonly uArmP = new Int32Array(UNIT_DEFS.length);
  readonly uHp = new Int32Array(UNIT_DEFS.length);
  readonly uRange = new Int32Array(UNIT_DEFS.length);
  readonly uSpeed = new Int32Array(UNIT_DEFS.length);
  /** 建築攻擊與射程加成 */
  readonly bAtk = new Int32Array(BUILDING_DEFS.length);
  readonly bRange = new Int32Array(BUILDING_DEFS.length);

  constructor(start: Cost) {
    this.res = [...start] as Cost;
    this.recompute();
  }

  /** 依已研究科技重算所有數值（科技數量少，直接從頭算，結果一定一致） */
  recompute(): void {
    UNIT_DEFS.forEach((d, i) => {
      this.uAtk[i] = d.attack;
      this.uArmM[i] = d.armor[0];
      this.uArmP[i] = d.armor[1];
      this.uHp[i] = d.hp;
      this.uRange[i] = d.rangeFx;
      this.uSpeed[i] = d.speedFx;
      this.upgrade[i] = i;
    });
    this.bAtk.fill(0);
    this.bRange.fill(0);
    this.gatherMul = [1000, 1000, 1000, 1000];
    this.farmMul = 1000;
    this.farmFood = 0;
    this.carryCap = ECONOMY.carry;
    this.age = 1;
    const ids = [...this.techs].sort((a, b) => a - b);
    for (const t of ids) {
      for (const e of TECH_DEFS[t].effects) {
        if (e.age) this.age = Math.max(this.age, e.age);
        if (e.upgrade) {
          const from = UNIT_INDEX[e.upgrade[0]];
          const to = UNIT_INDEX[e.upgrade[1]];
          for (let k = 0; k < this.upgrade.length; k++) if (this.upgrade[k] === from) this.upgrade[k] = to;
        }
        if (!e.target || !e.stat) continue;
        if (e.target === 'player') {
          const mul = Math.round((e.mul ?? 1) * 1000);
          if (e.stat === 'carry') this.carryCap += e.add ?? 0;
          else if (e.stat === 'farmFood') this.farmFood += e.add ?? 0;
          else if (e.stat === 'gather.farm') this.farmMul = Math.trunc((this.farmMul * mul) / 1000);
          else if (e.stat.startsWith('gather.')) {
            const k = ['food', 'wood', 'gold', 'stone'].indexOf(e.stat.slice(7));
            if (k >= 0) this.gatherMul[k] = Math.trunc((this.gatherMul[k] * mul) / 1000);
          }
          continue;
        }
        if (e.target.startsWith('building:')) {
          const b = BUILDING_INDEX[e.target.slice(9)];
          if (b === undefined) continue;
          if (e.stat === 'attack') this.bAtk[b] += e.add ?? 0;
          else if (e.stat === 'range') this.bRange[b] += (e.add ?? 0) << 10;
          continue;
        }
        UNIT_DEFS.forEach((d, i) => {
          if (!matches(e.target!, i)) return;
          const add = e.add ?? 0;
          const mul = e.mul ?? 1;
          switch (e.stat) {
            case 'attack':
              this.uAtk[i] += add;
              break;
            case 'armorM':
              this.uArmM[i] += add;
              break;
            case 'armorP':
              this.uArmP[i] += add;
              break;
            case 'hp':
              this.uHp[i] += add;
              break;
            case 'range':
              this.uRange[i] += d.rangeFx > 0 ? add << 10 : 0;
              break;
            case 'speed':
              this.uSpeed[i] = Math.round(this.uSpeed[i] * mul);
              break;
          }
        });
      }
    }
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

/** 投射物（箭、石）：起點 → 終點的直線飛行，渲染層自己加拋物線 */
export class Projectiles {
  static readonly CAP = 4096;
  readonly alive = new Uint8Array(Projectiles.CAP);
  readonly owner = new Uint8Array(Projectiles.CAP);
  readonly sx = new Int32Array(Projectiles.CAP);
  readonly sy = new Int32Array(Projectiles.CAP);
  readonly tx = new Int32Array(Projectiles.CAP);
  readonly ty = new Int32Array(Projectiles.CAP);
  /** 起點高度（高度單位：1 格 = 64；建築射出的箭比較高） */
  readonly h0 = new Int16Array(Projectiles.CAP);
  readonly t = new Uint16Array(Projectiles.CAP);
  readonly dur = new Uint16Array(Projectiles.CAP);
  readonly tgtKind = new Uint8Array(Projectiles.CAP);
  readonly tgt = new Int32Array(Projectiles.CAP);
  readonly dmg = new Int32Array(Projectiles.CAP);
  readonly hit = new Uint8Array(Projectiles.CAP);
  /** 射手（被打的一方用來反擊） */
  readonly from = new Int32Array(Projectiles.CAP);
  /** 範圍傷害半徑（定點數；0 ＝ 單體）、建築加成（範圍傷害打到建築時用） */
  readonly splash = new Int32Array(Projectiles.CAP);
  readonly bldBonus = new Int32Array(Projectiles.CAP);
  high = 0;
  count = 0;
  private free: number[] = [];

  add(): number {
    const id = this.free.length ? this.free.pop()! : this.high++;
    if (id >= Projectiles.CAP) return -1;
    this.alive[id] = 1;
    this.t[id] = 0;
    this.count++;
    return id;
  }

  remove(id: number): void {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.count--;
    this.free.push(id);
  }
}

/** 科技效果的對象是否包含這個兵種 */
function matches(target: string, u: number): boolean {
  const d = UNIT_DEFS[u];
  if (target === 'melee') return d.rangeFx === 0 && !d.worker && !(d.tags & TAG.siege);
  if (target === 'infantryNotArcher') return (d.tags & TAG.infantry) !== 0 && !(d.tags & TAG.archer) && !d.worker;
  if (target.startsWith('tag:')) return (d.tags & (TAG[target.slice(4)] ?? 0)) !== 0;
  if (target.startsWith('unit:')) return d.id === target.slice(5);
  return false;
}
