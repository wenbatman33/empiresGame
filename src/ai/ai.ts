// 電腦玩家（docs/05 §6、§7）：經濟機器人 ＋ 升時代 ＋ 建築 ＋ 研究 ＋ 軍事
// 規則：只讀模擬狀態（敵軍只看自己視野內的）、只下指令；確定性（多人連線時每台機器跑同一套 AI）
import { BUILDING_DEFS, BUILDING_INDEX, TAG, TECH_DEFS, TECH_INDEX, UNIT_DEFS, UNIT_INDEX, type Cost } from '../sim/core/defs';
import { FX_SHIFT, ONE } from '../sim/core/fixed';
import { ORDER, S } from '../sim/core/world';
import { Rng } from '../sim/core/rng';
import type { Sim } from '../sim/sim';
import { DEFAULT_PLAN, EconomyBot } from './economyBot';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Params {
  /** 採集倍率（由開局設定套到玩家身上，AI 自己不能改） */
  handicap: number;
  /** 第一波進攻最早時間（秒） */
  firstAttack: number;
  maxWaves: number;
  /** 各時代進攻需要的軍隊人數（II、III、IV） */
  armyMin: [number, number, number];
  /** 各時代目標民夫數 */
  villagers: [number, number, number, number];
  /** 幾 tick 想一次（反應速度） */
  thinkEvery: number;
}

export const AI_PARAMS: Record<Difficulty, Params> = {
  easy: { handicap: 800, firstAttack: 840, maxWaves: 2, armyMin: [10, 14, 18], villagers: [14, 24, 34, 42], thinkEvery: 30 },
  normal: { handicap: 1000, firstAttack: 480, maxWaves: 99, armyMin: [10, 16, 22], villagers: [15, 32, 46, 56], thinkEvery: 15 },
  hard: { handicap: 1000, firstAttack: 540, maxWaves: 99, armyMin: [14, 22, 30], villagers: [16, 34, 50, 62], thinkEvery: 5 },
};

/** 研究優先順序（能研究、付得起就研究） */
const RESEARCH_ORDER = [
  'loom', 'wheelbarrow', 'axe', 'plow', 'forge', 'fletch', 'inf1', 'cav1', 'arc1', 'pick',
  'up_halberd', 'up_crossbow', 'up_swift', 'handcart', 'saw', 'seeder', 'steel', 'ironhead', 'inf2', 'cav2', 'arc2', 'shaft', 'up_elite_sword',
  'up_iron', 'hundred', 'piercing', 'inf3', 'cav3', 'arc3', 'twoman', 'waterwheel', 'up_elite_ha',
];

/** 各時代採集比例（千分比）：糧、木、金、石 */
const AGE_RATIO: Record<number, [number, number, number, number]> = {
  1: [650, 350, 0, 0],
  2: [420, 400, 150, 30],
  3: [360, 330, 280, 30],
  4: [330, 320, 320, 30],
};

const AGE_BUILDINGS: Record<number, string[]> = {
  1: ['barracks', 'granary'],
  2: ['archery', 'stable', 'blacksmith'],
  3: ['workshop', 'workshop'],
};

export class AIPlayer {
  readonly eco: EconomyBot;
  readonly params: Params;
  private readonly phase: number;
  private attacking = false;
  /** 第一波進攻的 tick（統計用） */
  firstAttackTick = -1;
  private waveStart = 0;
  private waves = 0;
  private scouted = false;
  /** 看過的敵軍組成（步／騎／弓／攻城） */
  private seen = [0, 0, 0, 0];
  /** 個性：依種子決定（同一局每台機器都一樣），讓 AI 對 AI 不會完全對稱 */
  private readonly attackShift: number;
  private readonly armyShift: number;
  private readonly favor: number;

  constructor(
    private readonly sim: Sim,
    readonly player: number,
    readonly difficulty: Difficulty = 'normal',
  ) {
    this.params = AI_PARAMS[difficulty];
    this.eco = new EconomyBot(sim, player, { ...DEFAULT_PLAN, villagers: this.params.villagers[0] });
    this.phase = (player * 7) % this.params.thinkEvery;
    const rng = new Rng((sim.seed ^ Math.imul(player + 1, 0x9e3779b1)) >>> 0);
    this.attackShift = rng.range(-90, 120);
    this.armyShift = rng.range(-4, 4);
    this.favor = rng.int(3);
  }

  tick(): void {
    const sim = this.sim;
    if (sim.players[this.player].defeated || sim.winner >= 0) return;
    this.eco.tick();
    if (sim.tick % this.params.thinkEvery !== this.phase) return;
    const th = this.eco.findOwn('town_hall', true);
    this.observe();
    if (this.considerResign()) return;
    this.ageUp(th);
    this.buildMilitary(th);
    this.train();
    this.research();
    this.command(th);
  }

  private get pl() {
    return this.sim.players[this.player];
  }

  /** 存錢升時代時保留的資源 */
  private reserve: Cost = [0, 0, 0, 0];

  /** 扣掉保留額後付得起嗎（只檢查這筆花費用得到的資源） */
  private canSpend(c: Cost): boolean {
    const r = this.pl.res;
    for (let k = 0; k < 4; k++) if (c[k] > 0 && r[k] - this.reserve[k] < c[k]) return false;
    return true;
  }

  // ───────── 情報 ─────────

  private observe(): void {
    const sim = this.sim;
    const w = sim.world;
    const vis = sim.vision.visible[this.player];
    const cnt = [0, 0, 0, 0];
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.owner[id] === this.player || w.state[id] === S.Dead) continue;
      if (!vis[(w.y[id] >> FX_SHIFT) * sim.map.w + (w.x[id] >> FX_SHIFT)]) continue;
      const d = UNIT_DEFS[w.utype[id]];
      if (d.worker) continue;
      if (d.tags & TAG.siege) cnt[3]++;
      else if (d.tags & TAG.archer) cnt[2]++;
      else if (d.tags & TAG.cavalry) cnt[1]++;
      else cnt[0]++;
    }
    // 慢慢遺忘，最近看到的比較重要
    for (let k = 0; k < 4; k++) this.seen[k] = Math.max(cnt[k], Math.trunc((this.seen[k] * 9) / 10));
  }

  // ───────── 投降 ─────────

  private hopeless = 0;
  /** 打不贏就投降：軍隊所剩無幾、民夫 < 8、看得到的敵軍 > 20，持續 30 秒 */
  private considerResign(): boolean {
    const vil = this.eco.villagers().length;
    const army = this.army().length;
    const enemy = this.seen[0] + this.seen[1] + this.seen[2] + this.seen[3];
    const noTh = this.eco.findOwn('town_hall', true) < 0;
    const bad = this.sim.tick > 6000 && ((noTh && vil < 15 && army < 10) || (army < 5 && vil < 12 && enemy > 15));
    this.hopeless = bad ? this.hopeless + this.params.thinkEvery : 0;
    if (this.hopeless >= 300) {
      this.sim.issue({ t: 'resign', player: this.player });
      return true;
    }
    return false;
  }

  // ───────── 升時代 ─────────

  private ageUp(th: number): void {
    const pl = this.pl;
    const age = pl.age;
    const vil = this.eco.villagers().length;
    this.eco.plan.villagers = this.params.villagers[age - 1];
    this.reserve = [0, 0, 0, 0];
    this.eco.plan.hold = false;
    // 採集比例：依時代，再依庫存調整（囤太多的少採、見底的多採）
    const ratio = [...AGE_RATIO[age]] as [number, number, number, number];
    for (let k = 0; k < 4; k++) {
      if (pl.res[k] > 1500) ratio[k] = Math.trunc(ratio[k] / 3);
      else if (pl.res[k] > 800) ratio[k] = Math.trunc(ratio[k] / 2);
      else if (pl.res[k] < 100 && ratio[k] > 0) ratio[k] = Math.trunc((ratio[k] * 13) / 10);
    }
    this.eco.plan.ratio = ratio;
    this.eco.plan.goldAfter = 12;
    if (age >= 4 || th < 0) return;
    const tech = TECH_INDEX[`age${age + 1}`];
    const bs = this.sim.buildings;
    if (bs.research[th] === tech) return;
    // 升時代的前置建築
    for (const id of AGE_BUILDINGS[age] ?? []) {
      const need = (AGE_BUILDINGS[age] ?? []).filter((x) => x === id).length;
      const c = this.eco.countOwn(id);
      if (c.done + c.building < need && vil >= (age === 1 ? 11 : 20)) this.placeNear(th, id);
    }
    if (vil < this.params.villagers[age - 1] - 1) return;
    const blocker = this.sim.economy.researchBlocker(this.player, th, tech);
    if (blocker) return;
    const cost = TECH_DEFS[tech].cost;
    if (pl.canAfford(cost)) {
      this.sim.issue({ t: 'research', player: this.player, building: th, tech });
    } else {
      // 存錢：停生民夫、保留資源（家裡被打時不保留，先顧防守）
      this.eco.plan.hold = true;
      if (!this.threat()) this.reserve = cost;
    }
  }

  // ───────── 建築 ─────────

  private placeNear(th: number, id: string): boolean {
    if (th < 0) return false;
    const bs = this.sim.buildings;
    const bt = BUILDING_INDEX[id];
    if (BUILDING_DEFS[bt].age > this.pl.age || !this.canSpend(BUILDING_DEFS[bt].cost)) return false;
    // 已經有一棟還沒蓋好就先等
    if (this.eco.countOwn(id).building > 0) return false;
    const spot = this.eco.findSpot(bt, bs.tx[th] + 2, bs.ty[th] + 2, 5, 20, 1);
    return this.eco.build(id, spot, this.eco.pickWorker(bs.centerX(th), bs.centerY(th)));
  }

  private buildMilitary(th: number): void {
    const age = this.pl.age;
    const vil = this.eco.villagers().length;
    if (age >= 2 && vil >= 16) {
      for (const id of ['archery', 'stable', 'blacksmith']) if (this.eco.countOwn(id).done + this.eco.countOwn(id).building === 0 && this.placeNear(th, id)) return;
    }
    if (age >= 2 && vil >= 30 && this.eco.countOwn('barracks').done < 2 && this.placeNear(th, 'barracks')) return;
    if (age >= 3 && vil >= 30) {
      if (this.eco.countOwn('workshop').done + this.eco.countOwn('workshop').building === 0 && this.placeNear(th, 'workshop')) return;
      for (const id of ['archery', 'stable']) if (this.eco.countOwn(id).done < 2 && this.placeNear(th, id)) return;
    }
  }

  // ───────── 研究 ─────────

  private research(): void {
    const sim = this.sim;
    const bs = sim.buildings;
    if (this.eco.villagers().length < 10) return;
    const armySize = this.army().length;
    for (const id of RESEARCH_ORDER) {
      const tech = TECH_INDEX[id];
      const t = TECH_DEFS[tech];
      // 軍事科技（鐵匠鋪、兵種升級）等有一定兵力再研究，資源先拿去出兵
      const military = BUILDING_DEFS[t.building].id !== 'town_hall' && !['granary', 'lumber_camp', 'mine_camp'].includes(BUILDING_DEFS[t.building].id);
      if (military && armySize < 10) continue;
      if (this.pl.techs.has(tech) || t.age > this.pl.age || !this.canSpend(t.cost)) continue;
      for (let b = 0; b < bs.high; b++) {
        if (!bs.alive[b] || bs.owner[b] !== this.player || bs.btype[b] !== t.building || !bs.complete[b]) continue;
        if (bs.research[b] >= 0 || bs.queue[b].length > 0) continue;
        if (sim.economy.researchBlocker(this.player, b, tech)) continue;
        sim.issue({ t: 'research', player: this.player, building: b, tech });
        return;
      }
    }
  }

  // ───────── 生產軍隊 ─────────

  /** 想要的兵種比例（基本組合 ＋ 依看到的敵軍調整） */
  private wanted(): Map<number, number> {
    const age = this.pl.age;
    const m = new Map<number, number>();
    const add = (id: string, v: number) => m.set(UNIT_INDEX[id], (m.get(UNIT_INDEX[id]) ?? 0) + v);
    if (age === 1) {
      add('swordsman', 10);
      return m;
    }
    add('spearman', 3 + (this.favor === 0 ? 2 : 0));
    add('archer', 4 + (this.favor === 1 ? 2 : 0));
    add('light_cav', 3 + (this.favor === 2 ? 2 : 0));
    if (age >= 3) {
      add('heavy_cav', 4 + (this.favor === 2 ? 2 : 0));
      add('ram', 4);
    }
    if (age >= 4) add('trebuchet', 2);
    // 反制：敵騎多 → 槍；敵弓多 → 騎；敵步兵多 → 弓
    const [inf, cav, arc] = this.seen;
    const total = inf + cav + arc + 1;
    add('spearman', (cav / total) * 8);
    add('light_cav', (arc / total) * 5);
    if (age >= 3) add('heavy_cav', (arc / total) * 5);
    add('archer', (inf / total) * 7);
    return m;
  }

  private train(): void {
    const sim = this.sim;
    const bs = sim.buildings;
    const w = sim.world;
    const age = this.pl.age;
    if (this.eco.villagers().length < (age === 1 ? 99 : 14)) return;
    if (this.pl.popCap - this.pl.pop <= 0) return;
    const want = this.wanted();
    const have = new Map<number, number>();
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.owner[id] !== this.player || w.state[id] === S.Dead || UNIT_DEFS[w.utype[id]].worker) continue;
      have.set(w.utype[id], (have.get(w.utype[id]) ?? 0) + 1);
    }
    const siegeCount = (have.get(UNIT_INDEX.ram) ?? 0) + (have.get(UNIT_INDEX.trebuchet) ?? 0);
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || bs.owner[b] !== this.player || !bs.complete[b] || bs.research[b] >= 0) continue;
      const def = BUILDING_DEFS[bs.btype[b]];
      if (def.id === 'town_hall' || !def.trains.length || bs.queue[b].length >= 2) continue;
      // 這棟能生的兵種裡，缺最多、而且付得起的
      let best = -1;
      let bestScore = -Infinity;
      for (const base of def.trains) {
        const ut = this.pl.upgrade[base];
        const ud = UNIT_DEFS[ut];
        if (UNIT_DEFS[base].age > age) continue;
        if ((ud.tags & TAG.siege) && siegeCount >= 4) continue;
        if (!this.canSpend(ud.cost)) continue;
        const wv = (want.get(base) ?? 0) + (want.get(ut) ?? 0);
        if (wv <= 0) continue;
        const score = wv - ((have.get(ut) ?? 0) + (have.get(base) ?? 0)) / 3;
        if (score > bestScore) {
          bestScore = score;
          best = ut;
        }
      }
      if (best < 0) continue;
      sim.issue({ t: 'train', player: this.player, building: b, unit: best, count: 1 });
    }
  }

  // ───────── 指揮 ─────────

  private army(): number[] {
    const w = this.sim.world;
    const out: number[] = [];
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.owner[id] !== this.player || w.state[id] === S.Dead) continue;
      const d = UNIT_DEFS[w.utype[id]];
      if (d.worker || w.utype[id] === UNIT_INDEX.scout) continue;
      out.push(id);
    }
    return out;
  }

  /** 我方建築附近（20 格內）看得到的敵軍中心 */
  private threat(): [number, number] | null {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    const vis = sim.vision.visible[this.player];
    let sx = 0;
    let sy = 0;
    let n = 0;
    const r2 = 20 * 20 * ONE * ONE;
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.owner[id] === this.player || w.state[id] === S.Dead || UNIT_DEFS[w.utype[id]].worker) continue;
      if (!vis[(w.y[id] >> FX_SHIFT) * sim.map.w + (w.x[id] >> FX_SHIFT)]) continue;
      let near = false;
      for (let b = 0; b < bs.high && !near; b++) {
        if (!bs.alive[b] || bs.owner[b] !== this.player) continue;
        const dx = bs.centerX(b) - w.x[id];
        const dy = bs.centerY(b) - w.y[id];
        if (dx * dx + dy * dy < r2) near = true;
      }
      if (!near) continue;
      sx += w.x[id];
      sy += w.y[id];
      n++;
    }
    return n ? [Math.trunc(sx / n), Math.trunc(sy / n)] : null;
  }

  /** 進攻目標：看過（探索過）的敵方建築，太守府優先，其次最近的 */
  private target(fromX: number, fromY: number): [number, number] | null {
    const sim = this.sim;
    const bs = sim.buildings;
    const exp = sim.vision.explored[this.player];
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || bs.owner[b] === this.player || sim.players[bs.owner[b]].defeated) continue;
      const def = BUILDING_DEFS[bs.btype[b]];
      if (def.wall || !exp[(bs.ty[b] + (def.h >> 1)) * sim.map.w + bs.tx[b] + (def.w >> 1)]) continue;
      const dx = bs.centerX(b) - fromX;
      const dy = bs.centerY(b) - fromY;
      const d = (dx * dx + dy * dy) / (ONE * ONE) - (def.id === 'town_hall' ? 400 : 0);
      if (d < bestD) {
        bestD = d;
        best = [bs.centerX(b), bs.centerY(b)];
      }
    }
    if (best) return best;
    // 沒有已知的敵方建築：先去敵人出生點，再分區掃蕩（找躲起來的民夫）
    for (let p = 0; p < sim.players.length; p++) {
      if (p === this.player || sim.players[p].defeated) continue;
      const s = sim.map.starts[p];
      if (!s) continue;
      const sx = (s.x << FX_SHIFT) + (ONE >> 1);
      const sy = (s.y << FX_SHIFT) + (ONE >> 1);
      if (!sim.vision.explored[this.player][s.y * sim.map.w + s.x]) return [sx, sy];
      return this.sweepPoint();
    }
    return null;
  }

  private sweep = 0;
  /** 掃蕩點：地圖切 5×5 區，依序走訪 */
  private sweepPoint(): [number, number] {
    const m = this.sim.map;
    const k = this.sweep++ % 25;
    const gx = k % 5;
    const gy = Math.floor(k / 5);
    return [Math.trunc(((gx * 2 + 1) * m.widthFx) / 10), Math.trunc(((gy * 2 + 1) * m.heightFx) / 10)];
  }

  private command(th: number): void {
    const sim = this.sim;
    const w = sim.world;
    const t = sim.tick / 10;
    // 斥候：開局去看敵人家
    if (!this.scouted && t > 15) {
      this.scouted = true;
      for (let id = 0; id < w.high; id++) {
        if (w.alive[id] && w.owner[id] === this.player && w.utype[id] === UNIT_INDEX.scout) {
          const tg = this.target(w.x[id], w.y[id]);
          if (tg) sim.issue({ t: 'move', player: this.player, ids: [id], x: tg[0], y: tg[1] + 6 * ONE });
        }
      }
    }
    const army = this.army();
    if (!army.length) {
      this.attacking = false;
      return;
    }
    let cx = 0;
    let cy = 0;
    for (const id of army) {
      cx += w.x[id];
      cy += w.y[id];
    }
    cx = Math.trunc(cx / army.length);
    cy = Math.trunc(cy / army.length);
    // 防守優先
    const threat = this.threat();
    if (threat && !this.attacking) {
      const idle = army.filter((id) => w.order[id] !== ORDER.AttackMove || w.state[id] === S.Idle);
      if (idle.length) sim.issue({ t: 'attackMove', player: this.player, ids: idle, x: threat[0], y: threat[1] });
      return;
    }
    const age = this.pl.age;
    const need = age >= 2 ? Math.max(6, this.params.armyMin[Math.min(2, age - 2)] + this.armyShift) : 999;
    if (!this.attacking) {
      // 兵力要比看到的敵軍多三成才出擊（docs/05 §6），人口滿了也出擊
      const enemySeen = this.seen[0] + this.seen[1] + this.seen[2] + this.seen[3];
      const strong = army.length >= (this.waves === 0 ? need : Math.max(need, Math.ceil(enemySeen * 1.3)));
      if (t >= this.params.firstAttack + this.attackShift && this.waves < this.params.maxWaves && (strong || this.pl.pop >= this.pl.popCap - 2)) {
        const tg = this.target(cx, cy);
        if (!tg) return;
        this.attacking = true;
        this.waveStart = army.length;
        this.waves++;
        if (this.firstAttackTick < 0) this.firstAttackTick = sim.tick;
        sim.issue({ t: 'attackMove', player: this.player, ids: army, x: tg[0], y: tg[1] });
        return;
      }
      // 集結：太守府往地圖中央 8 格
      if (th >= 0 && sim.tick % 300 === this.phase) {
        const bs = sim.buildings;
        const mx = sim.map.widthFx >> 1;
        const my = sim.map.heightFx >> 1;
        const hx = bs.centerX(th);
        const hy = bs.centerY(th);
        const dx = mx - hx;
        const dy = my - hy;
        const len = Math.max(1, Math.abs(dx) + Math.abs(dy));
        const rx = hx + Math.trunc((dx * 10 * ONE) / len);
        const ry = hy + Math.trunc((dy * 10 * ONE) / len);
        const idle = army.filter((id) => w.state[id] === S.Idle && w.order[id] !== ORDER.AttackMove);
        if (idle.length) sim.issue({ t: 'move', player: this.player, ids: idle, x: rx, y: ry });
      }
      return;
    }
    // 進攻中：剩不到三成就撤退；否則每 10 秒把閒下來的兵派往下一個目標
    if (army.length < Math.max(3, Math.trunc(this.waveStart * 0.3))) {
      this.attacking = false;
      if (th >= 0) sim.issue({ t: 'move', player: this.player, ids: army, x: sim.buildings.centerX(th), y: sim.buildings.centerY(th) + 6 * ONE });
      return;
    }
    if (sim.tick % 100 < this.params.thinkEvery) {
      const idle = army.filter((id) => w.state[id] === S.Idle && w.order[id] !== ORDER.Attack);
      const tg = this.target(cx, cy);
      if (idle.length && tg) sim.issue({ t: 'attackMove', player: this.player, ids: idle, x: tg[0], y: tg[1] });
    }
    // 援軍：新生的兵也加入
    const fresh = army.filter((id) => w.order[id] === ORDER.None && w.state[id] === S.Idle);
    if (fresh.length >= 5) {
      const tg = this.target(cx, cy);
      if (tg) sim.issue({ t: 'attackMove', player: this.player, ids: fresh, x: tg[0], y: tg[1] });
    }
    // 接近敵方太守府：衝車直接打太守府（不被民居分心）；其他兵照樣攻擊移動、遇敵就打
    const eth = this.enemyTownHallNear(cx, cy, 16);
    if (eth >= 0 && sim.tick % 50 < this.params.thinkEvery) {
      const hitters = army.filter((id) => w.order[id] !== ORDER.Attack && UNIT_DEFS[w.utype[id]].buildingsOnly);
      if (hitters.length) sim.issue({ t: 'attack', player: this.player, ids: hitters, kind: 2, target: eth });
    }
  }

  /** 部隊附近（r 格內）、看過的敵方太守府 */
  private enemyTownHallNear(x: number, y: number, r: number): number {
    const sim = this.sim;
    const bs = sim.buildings;
    const exp = sim.vision.explored[this.player];
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || bs.owner[b] === this.player || BUILDING_DEFS[bs.btype[b]].id !== 'town_hall') continue;
      if (!exp[bs.ty[b] * sim.map.w + bs.tx[b]]) continue;
      const dx = (bs.centerX(b) - x) >> FX_SHIFT;
      const dy = (bs.centerY(b) - y) >> FX_SHIFT;
      if (dx * dx + dy * dy <= r * r) return b;
    }
    return -1;
  }
}
