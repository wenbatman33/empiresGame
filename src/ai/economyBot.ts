// 經濟機器人（docs/05 §6 經濟經理）：只讀模擬狀態、只下指令，確定性
// M1 用來跑「標準建造順序」驗證經濟節奏（docs/06 §10），M3 起當電腦 AI 的經濟模組
import { BUILDING_DEFS, BUILDING_INDEX, RK, UNIT_DEFS, UNIT_INDEX, type Cost } from '../sim/core/defs';
import { FX_SHIFT, ONE } from '../sim/core/fixed';
import { S, TASK } from '../sim/core/world';
import type { Sim } from '../sim/sim';

export interface EconomyPlan {
  /** 目標民夫數 */
  villagers: number;
  /** 前幾名民夫全部採糧 */
  earlyFood: number;
  /** 之後的分配比例（千分比）：糧、木、金、石 */
  ratio: [number, number, number, number];
  /** 開始採金石的民夫數門檻 */
  goldAfter: number;
}

export const DEFAULT_PLAN: EconomyPlan = {
  villagers: 40,
  earlyFood: 6,
  ratio: [540, 340, 90, 30],
  goldAfter: 16,
};

const FOOD_KINDS = [RK.berry, RK.deer, RK.boar];

export class EconomyBot {
  /** 每秒想一次；不同玩家錯開 tick */
  private readonly phase: number;

  constructor(
    private readonly sim: Sim,
    readonly player: number,
    public plan: EconomyPlan = { ...DEFAULT_PLAN },
  ) {
    this.phase = player % 10;
  }

  tick(): void {
    const sim = this.sim;
    if (sim.tick % 10 !== this.phase) return;
    const th = this.findOwn('town_hall');
    if (th < 0) return;
    this.reserved.clear();
    this.trainVillagers(th);
    this.staffFoundations();
    this.buildHouses(th);
    this.buildDropsites(th);
    this.assignIdle(th);
  }

  /** 這一輪已經派工的民夫（同一輪不重複下指令，否則後面的指令會蓋掉前面的） */
  private reserved = new Set<number>();

  /** 沒有人在蓋的地基：派最近的工人過去 */
  private staffFoundations(): void {
    const sim = this.sim;
    const bs = sim.buildings;
    const w = sim.world;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || bs.owner[b] !== this.player || bs.complete[b]) continue;
      let staffed = false;
      for (let id = 0; id < w.high && !staffed; id++) if (w.alive[id] && w.task[id] === TASK.Build && w.target[id] === b) staffed = true;
      if (staffed) continue;
      const worker = this.pickWorker(bs.centerX(b), bs.centerY(b));
      if (worker < 0) continue;
      this.reserved.add(worker);
      sim.issue({ t: 'work', player: this.player, ids: [worker], building: b });
    }
  }

  // ───────── 查詢 ─────────

  private findOwn(id: string, completeOnly = false): number {
    const bs = this.sim.buildings;
    const t = BUILDING_INDEX[id];
    for (let b = 0; b < bs.high; b++) if (bs.alive[b] && bs.owner[b] === this.player && bs.btype[b] === t && (!completeOnly || bs.complete[b])) return b;
    return -1;
  }

  private countOwn(id: string): { done: number; building: number } {
    const bs = this.sim.buildings;
    const t = BUILDING_INDEX[id];
    let done = 0;
    let building = 0;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || bs.owner[b] !== this.player || bs.btype[b] !== t) continue;
      if (bs.complete[b]) done++;
      else building++;
    }
    return { done, building };
  }

  private villagers(): number[] {
    const w = this.sim.world;
    const out: number[] = [];
    for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === this.player && w.utype[id] === UNIT_INDEX.villager && w.state[id] !== S.Dead) out.push(id);
    return out;
  }

  /** 每位民夫目前在做哪種資源（-1 ＝ 沒有、4 ＝ 建造） */
  private jobOf(id: number): number {
    const sim = this.sim;
    const w = sim.world;
    switch (w.task[id]) {
      case TASK.Gather: {
        const r = w.target[id];
        if (r < 0 || !sim.res.alive[r]) return -1;
        const k = sim.res.kind[r];
        return FOOD_KINDS.includes(k) ? 0 : k === RK.tree ? 1 : k === RK.gold ? 2 : 3;
      }
      case TASK.Farm:
        return 0;
      case TASK.Return:
        return w.carryRes[id];
      case TASK.Build:
        return 4;
    }
    return -1;
  }

  private queued(): number {
    const bs = this.sim.buildings;
    let n = 0;
    for (let b = 0; b < bs.high; b++) if (bs.alive[b] && bs.owner[b] === this.player) n += bs.queue[b].length;
    return n;
  }

  private afford(c: Cost, reserveWood = 0): boolean {
    const r = this.sim.players[this.player].res;
    return r[0] >= c[0] && r[1] >= c[1] + reserveWood && r[2] >= c[2] && r[3] >= c[3];
  }

  /** 挑一個工人：優先閒置、其次採木或採糧中且身上沒帶東西、離 (x,y) 近的 */
  private pickWorker(x: number, y: number, prefer: number[] = [1, 0]): number {
    const w = this.sim.world;
    let best = -1;
    let bestScore = Infinity;
    for (const id of this.villagers()) {
      if (this.reserved.has(id)) continue;
      const job = this.jobOf(id);
      let score: number;
      if (w.task[id] === TASK.None) score = 0;
      else if (prefer.includes(job) && w.task[id] !== TASK.Return) score = 1 + prefer.indexOf(job);
      else continue;
      const dx = (w.x[id] - x) >> FX_SHIFT;
      const dy = (w.y[id] - y) >> FX_SHIFT;
      const s = score * 10000 + dx * dx + dy * dy;
      if (s < bestScore) {
        bestScore = s;
        best = id;
      }
    }
    return best;
  }

  /** 以 (cx,cy) 格為中心，由內往外找能蓋的位置；margin 格內要留通道 */
  findSpot(btype: number, cx: number, cy: number, rMin: number, rMax: number, margin = 1): [number, number] | null {
    const sim = this.sim;
    const m = sim.map;
    const def = BUILDING_DEFS[btype];
    for (let r = rMin; r <= rMax; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx - (def.w >> 1);
          const ty = cy + dy - (def.h >> 1);
          if (!sim.canPlace(btype, tx, ty)) continue;
          let ok = true;
          for (let y = ty - margin; y < ty + def.h + margin && ok; y++) {
            for (let x = tx - margin; x < tx + def.w + margin && ok; x++) {
              if (x >= tx && x < tx + def.w && y >= ty && y < ty + def.h) continue;
              if (!m.inBounds(x, y)) continue;
              const i = m.idx(x, y);
              if (sim.bldTile[i] >= 0 || (sim.resTile[i] >= 0 && margin > 0 && def.id !== 'lumber_camp' && def.id !== 'mine_camp' && def.id !== 'granary')) ok = false;
            }
          }
          if (ok) return [tx, ty];
        }
      }
    }
    return null;
  }

  private build(btypeId: string, spot: [number, number] | null, worker: number): boolean {
    if (!spot || worker < 0) return false;
    const bt = BUILDING_INDEX[btypeId];
    if (!this.afford(BUILDING_DEFS[bt].cost)) return false;
    this.reserved.add(worker);
    this.sim.issue({ t: 'build', player: this.player, ids: [worker], btype: bt, tx: spot[0], ty: spot[1] });
    return true;
  }

  // ───────── 決策 ─────────

  private trainVillagers(th: number): void {
    const bs = this.sim.buildings;
    const vil = this.villagers().length + bs.queue[th].length;
    if (vil >= this.plan.villagers || bs.queue[th].length >= 2) return;
    if (this.afford(UNIT_DEFS[UNIT_INDEX.villager].cost)) this.sim.issue({ t: 'train', player: this.player, building: th, unit: UNIT_INDEX.villager, count: 1 });
  }

  private buildHouses(th: number): void {
    const sim = this.sim;
    const pl = sim.players[this.player];
    if (pl.popCap >= 125) return;
    const houses = this.countOwn('house');
    const margin = pl.pop >= 20 ? 5 : 3;
    if (houses.building > (pl.pop >= 30 ? 1 : 0) || pl.popCap - (pl.pop + this.queued()) > margin) return;
    const bs = sim.buildings;
    const spot = this.findSpot(BUILDING_INDEX.house, bs.tx[th] + 2, bs.ty[th] + 2, 4, 16, 1);
    this.build('house', spot, this.pickWorker(bs.centerX(th), bs.centerY(th)));
  }

  private buildDropsites(th: number): void {
    const sim = this.sim;
    const bs = sim.buildings;
    const vil = this.villagers();
    const cx = bs.centerX(th);
    const cy = bs.centerY(th);
    const houseReserve = sim.players[this.player].popCap - sim.players[this.player].pop <= 2 ? 25 : 0;
    // 伐木場：離太守府最近的森林旁
    if (vil.length >= this.plan.earlyFood && this.countOwn('lumber_camp').done + this.countOwn('lumber_camp').building === 0 && this.afford(BUILDING_DEFS[BUILDING_INDEX.lumber_camp].cost, houseReserve)) {
      const tree = sim.findResource([RK.tree], cx, cy, 30, cx, cy);
      if (tree >= 0) {
        const spot = this.findSpot(BUILDING_INDEX.lumber_camp, sim.res.tx[tree], sim.res.ty[tree], 1, 4, 0);
        this.build('lumber_camp', spot, this.pickWorker(sim.res.x[tree], sim.res.y[tree], [0, 1]));
        return;
      }
    }
    // 糧倉：野果離太守府超過 5 格就在野果旁蓋
    if (vil.length >= 8 && this.countOwn('granary').done + this.countOwn('granary').building === 0 && this.afford(BUILDING_DEFS[BUILDING_INDEX.granary].cost, houseReserve)) {
      const berry = sim.findResource([RK.berry], cx, cy, 14, cx, cy);
      if (berry >= 0 && Math.max(Math.abs(sim.res.x[berry] - cx), Math.abs(sim.res.y[berry] - cy)) > 5 * ONE) {
        const spot = this.findSpot(BUILDING_INDEX.granary, sim.res.tx[berry], sim.res.ty[berry], 1, 4, 0);
        this.build('granary', spot, this.pickWorker(sim.res.x[berry], sim.res.y[berry], [0]));
        return;
      }
    }
    // 礦場：開始採金後，金礦離最近存放點超過 5 格就蓋
    if (vil.length >= this.plan.goldAfter && this.countOwn('mine_camp').done + this.countOwn('mine_camp').building === 0 && this.afford(BUILDING_DEFS[BUILDING_INDEX.mine_camp].cost, houseReserve)) {
      const gold = sim.findResource([RK.gold], cx, cy, 30, cx, cy);
      if (gold >= 0 && Math.max(Math.abs(sim.res.x[gold] - cx), Math.abs(sim.res.y[gold] - cy)) > 5 * ONE) {
        const spot = this.findSpot(BUILDING_INDEX.mine_camp, sim.res.tx[gold], sim.res.ty[gold], 1, 4, 0);
        this.build('mine_camp', spot, this.pickWorker(sim.res.x[gold], sim.res.y[gold], [1, 0]));
      }
    }
  }

  /** 目前各資源想要幾個人 */
  private desired(total: number): number[] {
    const p = this.plan;
    if (total <= p.earlyFood) return [total, 0, 0, 0];
    const rest = total - p.earlyFood;
    const ratio = total >= p.goldAfter ? p.ratio : ([p.ratio[0], p.ratio[1] + p.ratio[2] + p.ratio[3], 0, 0] as const);
    const sum = ratio[0] + ratio[1] + ratio[2] + ratio[3];
    const out = [p.earlyFood, 0, 0, 0];
    let given = 0;
    for (let k = 1; k < 4; k++) {
      const n = Math.floor((rest * ratio[k]) / sum);
      out[k] = n;
      given += n;
    }
    out[0] += rest - given;
    return out;
  }

  private assignIdle(th: number): void {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    const vil = this.villagers();
    const counts = [0, 0, 0, 0];
    const idle: number[] = [];
    for (const id of vil) {
      const job = this.jobOf(id);
      if (job >= 0 && job < 4) counts[job]++;
      else if (job < 0 && w.state[id] !== S.Move && !this.reserved.has(id)) idle.push(id);
    }
    const want = this.desired(vil.length);
    this.claimed.clear();
    const cx = bs.centerX(th);
    const cy = bs.centerY(th);
    for (const id of idle) {
      // 缺最多的資源
      let k = 0;
      let deficit = -Infinity;
      for (let r = 0; r < 4; r++) {
        if (want[r] - counts[r] > deficit) {
          deficit = want[r] - counts[r];
          k = r;
        }
      }
      this.reserved.add(id);
      if (this.sendTo(id, k, cx, cy)) counts[k]++;
      else if (k !== 1 && this.sendTo(id, 1, cx, cy)) counts[1]++;
    }
  }

  /** 這一輪已經派人的農田（避免兩個人搶同一塊；AI 不能直接改模擬狀態） */
  private claimed = new Set<number>();

  private sendTo(id: number, k: number, cx: number, cy: number): boolean {
    const sim = this.sim;
    if (k === 0) {
      // 糧：空農田 → 野果／獵物 → 蓋新農田
      const bs = sim.buildings;
      for (let b = 0; b < bs.high; b++) {
        if (bs.alive[b] && bs.owner[b] === this.player && bs.complete[b] && BUILDING_DEFS[bs.btype[b]].id === 'farm' && bs.farmer[b] < 0 && !this.claimed.has(b)) {
          sim.issue({ t: 'work', player: this.player, ids: [id], building: b });
          this.claimed.add(b);
          return true;
        }
      }
      const food = sim.findResource(FOOD_KINDS, cx, cy, 16, cx, cy);
      if (food >= 0) {
        sim.issue({ t: 'gather', player: this.player, ids: [id], res: food });
        return true;
      }
      const spot = this.findSpot(BUILDING_INDEX.farm, cx >> FX_SHIFT, cy >> FX_SHIFT, 3, 12, 0);
      return this.build('farm', spot, id);
    }
    const kind = k === 1 ? RK.tree : k === 2 ? RK.gold : RK.stone;
    const from = k === 1 ? this.findOwn('lumber_camp', true) : k >= 2 ? this.findOwn('mine_camp', true) : -1;
    const fx = from >= 0 ? sim.buildings.centerX(from) : cx;
    const fy = from >= 0 ? sim.buildings.centerY(from) : cy;
    const r = sim.findResource([kind], fx, fy, 30, sim.world.x[id], sim.world.y[id]);
    if (r < 0) return false;
    sim.issue({ t: 'gather', player: this.player, ids: [id], res: r });
    return true;
  }
}
