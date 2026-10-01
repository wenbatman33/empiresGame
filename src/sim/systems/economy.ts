// 經濟系統（docs/04、docs/06）：民夫採集／回倉／建造／耕田、施工進度、生產佇列、人口
import type { Command } from '../core/commands';
import { BUILDING_DEFS, ECONOMY, RESOURCE_KINDS, RK, UNIT_DEFS, type Cost } from '../core/defs';
import { FX_SHIFT, ONE, isqrt } from '../core/fixed';
import { S, TASK } from '../core/world';
import type { Sim } from '../sim';

/** 開始工作的距離（單位邊緣到目標邊緣） */
const REACH = (ONE * 45) / 100;
/** 工作中被推開多遠還算在範圍內 */
const REACH_KEEP = (ONE * 90) / 100;
/** 沿目標周邊錯開站位（格的千分比）：0、右、左、更右、更左… */
const SPREAD = [0, 800, -800, 1600, -1600, 2400, -2400];
const MAX_ATTEMPTS = 6;
/** 採完後自動找下一個資源的搜尋半徑（格） */
const SEARCH_R = 10;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class EconomySystem {
  /** 本 tick 每棟建築的施工人數 */
  private builders = new Int32Array(1024);

  constructor(private sim: Sim) {}

  step(): void {
    const sim = this.sim;
    const w = sim.world;
    this.builders.fill(0, 0, sim.buildings.high);
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.task[id] === TASK.None || w.state[id] === S.Dead) continue;
      switch (w.task[id]) {
        case TASK.Gather:
          this.gatherTask(id);
          break;
        case TASK.Farm:
          this.farmTask(id);
          break;
        case TASK.Return:
          this.returnTask(id);
          break;
        case TASK.Build:
          this.buildTask(id);
          break;
      }
    }
    this.construction();
    this.population();
    this.production();
  }

  // ───────── 幾何 ─────────

  resRect(r: number): Rect {
    const res = this.sim.res;
    const x0 = res.tx[r] << FX_SHIFT;
    const y0 = res.ty[r] << FX_SHIFT;
    if (!RESOURCE_KINDS[res.kind[r]].blocks) {
      // 動物：以中心點為準的小方框
      const h = ONE >> 2;
      return { x0: res.x[r] - h, y0: res.y[r] - h, x1: res.x[r] + h, y1: res.y[r] + h };
    }
    return { x0, y0, x1: x0 + ONE, y1: y0 + ONE };
  }

  bRect(b: number): Rect {
    const bs = this.sim.buildings;
    const def = BUILDING_DEFS[bs.btype[b]];
    const x0 = bs.tx[b] << FX_SHIFT;
    const y0 = bs.ty[b] << FX_SHIFT;
    return { x0, y0, x1: x0 + (def.w << FX_SHIFT), y1: y0 + (def.h << FX_SHIFT) };
  }

  /** 單位邊緣到方框的距離 */
  private gap(id: number, r: Rect): number {
    const w = this.sim.world;
    const x = w.x[id];
    const y = w.y[id];
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dy = Math.max(r.y0 - y, 0, y - r.y1);
    return isqrt(dx * dx + dy * dy) - w.radius[id];
  }

  /**
   * 走到方框旁邊：取周邊上離自己最近的點，再依 slot 沿周邊錯開（多人同時工作才不會擠在同一點），往外推一個身位
   */
  private approach(id: number, r: Rect, slot = this.sim.world.attempts[id]): void {
    const w = this.sim.world;
    const x = w.x[id];
    const y = w.y[id];
    if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) {
      // 站在方框裡（例如農田）：走向中心
      this.sim.moveUnit(id, (r.x0 + r.x1) >> 1, (r.y0 + r.y1) >> 1);
      return;
    }
    const W = r.x1 - r.x0;
    const H = r.y1 - r.y0;
    const P = 2 * (W + H);
    const cx = Math.max(r.x0, Math.min(r.x1, x));
    const cy = Math.max(r.y0, Math.min(r.y1, y));
    // 周邊參數：上（左→右）、右（上→下）、下（右→左）、左（下→上）
    let s: number;
    if (cy === r.y0) s = cx - r.x0;
    else if (cx === r.x1) s = W + (cy - r.y0);
    else if (cy === r.y1) s = W + H + (r.x1 - cx);
    else s = 2 * W + H + (r.y1 - cy);
    s = (((s + Math.trunc((SPREAD[slot % SPREAD.length] * ONE) / 1000)) % P) + P) % P;
    const pad = w.radius[id] + (REACH >> 1);
    let ax: number;
    let ay: number;
    if (s < W) [ax, ay] = [r.x0 + s, r.y0 - pad];
    else if (s < W + H) [ax, ay] = [r.x1 + pad, r.y0 + (s - W)];
    else if (s < 2 * W + H) [ax, ay] = [r.x1 - (s - W - H), r.y1 + pad];
    else [ax, ay] = [r.x0 - pad, r.y1 - (s - 2 * W - H)];
    this.sim.moveUnit(id, ax, ay);
  }

  private face(id: number, tx: number, ty: number): void {
    const w = this.sim.world;
    const dx = tx - w.x[id];
    const dy = ty - w.y[id];
    if (dx || dy) {
      w.fx[id] = dx;
      w.fy[id] = dy;
    }
  }

  private startWork(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    sim.stopMoving(id);
    if (w.state[id] !== S.Work) {
      w.state[id] = S.Work;
      w.stateTick[id] = sim.tick;
    }
    w.attempts[id] = 0;
  }

  /** 到不了：重試幾次，還是不行就放棄 */
  private retry(id: number, r: Rect): boolean {
    const w = this.sim.world;
    if (w.state[id] === S.Move) return true;
    if (++w.attempts[id] > MAX_ATTEMPTS) return false;
    this.approach(id, r);
    return true;
  }

  // ───────── 任務 ─────────

  setTask(id: number, task: number, target: number): void {
    const w = this.sim.world;
    this.releaseFarm(id);
    w.task[id] = task;
    w.target[id] = target;
    w.attempts[id] = 0;
    if (task === TASK.Farm) this.sim.buildings.farmer[target] = id;
  }

  clearTask(id: number): void {
    const w = this.sim.world;
    this.releaseFarm(id);
    w.task[id] = TASK.None;
    w.target[id] = -1;
    if (w.state[id] === S.Work) {
      w.state[id] = S.Idle;
      w.stateTick[id] = this.sim.tick;
    }
  }

  private releaseFarm(id: number): void {
    const w = this.sim.world;
    const bs = this.sim.buildings;
    for (const b of [w.task[id] === TASK.Farm ? w.target[id] : -1, w.prevTask[id] === TASK.Farm ? w.prevTarget[id] : -1]) {
      if (b >= 0 && bs.alive[b] && bs.farmer[b] === id) bs.farmer[b] = -1;
    }
  }

  private idle(id: number): void {
    this.clearTask(id);
    this.sim.world.prevTask[id] = TASK.None;
    this.sim.world.prevTarget[id] = -1;
  }

  private gatherTask(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    const res = sim.res;
    const r = w.target[id];
    const pl = sim.players[w.owner[id]];
    if (r < 0 || !res.alive[r]) {
      if (w.carry[id] > 0) this.startReturn(id);
      else if (!this.findNext(id, -1)) this.idle(id);
      return;
    }
    const kd = RESOURCE_KINDS[res.kind[r]];
    if (w.carry[id] > 0 && (w.carryRes[id] !== kd.res || w.carry[id] >= pl.carryCap)) {
      this.startReturn(id);
      return;
    }
    const rect = this.resRect(r);
    const g = this.gap(id, rect);
    if (w.state[id] === S.Work) {
      if (g > REACH_KEEP) {
        this.approach(id, rect);
        return;
      }
      this.face(id, res.x[r], res.y[r]);
      w.carryRes[id] = kd.res;
      w.gatherAcc[id] += Math.trunc((kd.rateMilli * pl.gatherMul[kd.res]) / 1000);
      while (w.gatherAcc[id] >= 1000 && res.amount[r] > 0 && w.carry[id] < pl.carryCap) {
        w.gatherAcc[id] -= 1000;
        w.carry[id]++;
        res.amount[r]--;
      }
      if (w.carry[id] >= pl.carryCap) w.gatherAcc[id] = 0;
      if (res.amount[r] <= 0) sim.depleteResource(r);
      return;
    }
    if (g <= REACH) {
      this.startWork(id);
      w.lastKind[id] = res.kind[r];
      w.lastX[id] = res.x[r];
      w.lastY[id] = res.y[r];
    } else if (!this.retry(id, rect) && !this.findNext(id, r)) {
      this.idle(id);
    }
  }

  private farmTask(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    const b = w.target[id];
    const pl = sim.players[w.owner[id]];
    if (b < 0 || !bs.alive[b] || !bs.complete[b] || (bs.farmer[b] !== id && bs.farmer[b] >= 0)) {
      if (w.carry[id] > 0) this.startReturn(id);
      else if (!this.findFreeFarm(id)) this.idle(id);
      return;
    }
    bs.farmer[b] = id;
    if (w.carry[id] > 0 && (w.carryRes[id] !== 0 || w.carry[id] >= pl.carryCap)) {
      this.startReturn(id);
      return;
    }
    const rect = this.bRect(b);
    const cx = (rect.x0 + rect.x1) >> 1;
    const cy = (rect.y0 + rect.y1) >> 1;
    const dx = w.x[id] - cx;
    const dy = w.y[id] - cy;
    const nr = (ONE * 7) / 10;
    const near = dx * dx + dy * dy <= nr * nr;
    if (w.state[id] === S.Work) {
      if (!near) {
        sim.moveUnit(id, cx, cy);
        return;
      }
      w.carryRes[id] = 0;
      w.gatherAcc[id] += Math.trunc((ECONOMY.farmRateMilli * pl.gatherMul[0]) / 1000);
      while (w.gatherAcc[id] >= 1000 && bs.food[b] > 0 && w.carry[id] < pl.carryCap) {
        w.gatherAcc[id] -= 1000;
        w.carry[id]++;
        bs.food[b]--;
      }
      if (w.carry[id] >= pl.carryCap) w.gatherAcc[id] = 0;
      if (bs.food[b] <= 0) sim.exhaustFarm(b);
      return;
    }
    if (near) {
      this.startWork(id);
      w.fx[id] = 0;
      w.fy[id] = ONE;
    } else if (w.state[id] !== S.Move) {
      if (++w.attempts[id] > 4) this.idle(id);
      else sim.moveUnit(id, cx, cy);
    }
  }

  private startReturn(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    if (w.task[id] !== TASK.Return) {
      w.prevTask[id] = w.task[id];
      w.prevTarget[id] = w.target[id];
    }
    const drop = sim.nearestDrop(w.owner[id], w.carryRes[id], w.x[id], w.y[id]);
    if (drop < 0) {
      // 沒有存放點：原地閒置，帶著資源
      w.task[id] = TASK.None;
      w.target[id] = -1;
      if (w.state[id] === S.Work) {
        w.state[id] = S.Idle;
        w.stateTick[id] = sim.tick;
      }
      return;
    }
    w.task[id] = TASK.Return;
    w.target[id] = drop;
    w.attempts[id] = 0;
    this.approach(id, this.bRect(drop));
  }

  private returnTask(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    const b = w.target[id];
    if (b < 0 || !bs.alive[b] || !bs.complete[b] || !BUILDING_DEFS[bs.btype[b]].drop[w.carryRes[id]]) {
      this.startReturn(id);
      return;
    }
    const rect = this.bRect(b);
    if (this.gap(id, rect) <= REACH) {
      // 交貨
      const pl = sim.players[w.owner[id]];
      pl.res[w.carryRes[id]] += w.carry[id];
      pl.gathered[w.carryRes[id]] += w.carry[id];
      w.carry[id] = 0;
      w.gatherAcc[id] = 0;
      sim.stopMoving(id);
      // 回去繼續原本的工作
      const pt = w.prevTask[id];
      const ptg = w.prevTarget[id];
      w.prevTask[id] = TASK.None;
      w.prevTarget[id] = -1;
      if (pt === TASK.Farm && ptg >= 0 && bs.alive[ptg]) {
        this.setTask(id, TASK.Farm, ptg);
        sim.moveUnit(id, (this.bRect(ptg).x0 + this.bRect(ptg).x1) >> 1, (this.bRect(ptg).y0 + this.bRect(ptg).y1) >> 1);
      } else if (pt === TASK.Gather && ptg >= 0 && sim.res.alive[ptg]) {
        this.setTask(id, TASK.Gather, ptg);
        this.approach(id, this.resRect(ptg));
      } else if (!this.findNext(id, -1)) {
        this.idle(id);
      }
      return;
    }
    if (!this.retry(id, rect)) {
      // 這個存放點到不了，換最近的另一個
      w.attempts[id] = 0;
      const other = sim.nearestDrop(w.owner[id], w.carryRes[id], w.x[id], w.y[id], b);
      if (other < 0) this.idle(id);
      else {
        w.target[id] = other;
        this.approach(id, this.bRect(other));
      }
    }
  }

  private buildTask(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    const b = w.target[id];
    if (b < 0 || !bs.alive[b]) {
      if (!this.findConstruction(id)) this.idle(id);
      return;
    }
    if (bs.complete[b]) {
      this.afterBuilt(id, b);
      return;
    }
    const rect = this.bRect(b);
    const g = this.gap(id, rect);
    if (w.state[id] === S.Work) {
      if (g > REACH_KEEP && !BUILDING_DEFS[bs.btype[b]].walkable) {
        this.approach(id, rect);
        return;
      }
      this.face(id, bs.centerX(b), bs.centerY(b));
      this.builders[b]++;
      return;
    }
    if (g <= REACH) this.startWork(id);
    else if (!this.retry(id, rect)) this.idle(id);
  }

  /** 蓋好之後：存放點 → 自動採附近資源；農田 → 第一個人去耕；其他 → 找附近工地 */
  afterBuilt(id: number, b: number): void {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    const def = BUILDING_DEFS[bs.btype[b]];
    if (def.id === 'farm' && (bs.farmer[b] < 0 || bs.farmer[b] === id)) {
      this.setTask(id, TASK.Farm, b);
      return;
    }
    const kinds = def.id === 'lumber_camp' ? [RK.tree] : def.id === 'mine_camp' ? [RK.gold, RK.stone] : def.id === 'granary' ? [RK.berry, RK.deer] : [];
    if (kinds.length) {
      const r = sim.findResource(kinds, bs.centerX(b), bs.centerY(b), SEARCH_R, w.x[id], w.y[id]);
      if (r >= 0) {
        this.setTask(id, TASK.Gather, r);
        this.approach(id, this.resRect(r));
        return;
      }
    }
    if (!this.findConstruction(id)) this.idle(id);
  }

  private findConstruction(id: number): boolean {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    let best = -1;
    let bestD = 100 * ONE * ONE;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || bs.complete[b] || bs.owner[b] !== w.owner[id]) continue;
      const dx = bs.centerX(b) - w.x[id];
      const dy = bs.centerY(b) - w.y[id];
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best < 0) return false;
    this.setTask(id, TASK.Build, best);
    this.approach(id, this.bRect(best));
    return true;
  }

  private findFreeFarm(id: number): boolean {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    let best = -1;
    let bestD = 144 * ONE * ONE;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || !bs.complete[b] || bs.owner[b] !== w.owner[id] || BUILDING_DEFS[bs.btype[b]].id !== 'farm') continue;
      if (bs.farmer[b] >= 0 && bs.farmer[b] !== id) continue;
      const dx = bs.centerX(b) - w.x[id];
      const dy = bs.centerY(b) - w.y[id];
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best < 0) return false;
    this.setTask(id, TASK.Farm, best);
    sim.moveUnit(id, bs.centerX(best), bs.centerY(best));
    return true;
  }

  /** 採完了：在原本位置附近找同類資源 */
  private findNext(id: number, exclude: number): boolean {
    const sim = this.sim;
    const w = sim.world;
    const kind = w.lastKind[id];
    if (kind < 0) return false;
    const kinds = kind === RK.deer || kind === RK.boar ? [RK.deer, RK.boar, RK.berry] : [kind];
    const r = sim.findResource(kinds, w.lastX[id], w.lastY[id], SEARCH_R, w.x[id], w.y[id], exclude);
    if (r < 0) return false;
    this.setTask(id, TASK.Gather, r);
    this.approach(id, this.resRect(r));
    return true;
  }

  // ───────── 施工、人口、生產 ─────────

  private construction(): void {
    const sim = this.sim;
    const bs = sim.buildings;
    for (let b = 0; b < bs.high; b++) {
      const n = this.builders[b];
      if (!n || !bs.alive[b] || bs.complete[b]) continue;
      const def = BUILDING_DEFS[bs.btype[b]];
      const need = def.buildTicks * 3;
      const before = bs.progress[b];
      bs.progress[b] = Math.min(need, before + n + 2);
      bs.hp[b] = Math.min(def.hp, bs.hp[b] + Math.trunc((def.hp * bs.progress[b]) / need) - Math.trunc((def.hp * before) / need));
      if (bs.progress[b] >= need) sim.completeBuilding(b);
    }
  }

  private population(): void {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    for (const p of sim.players) {
      p.pop = 0;
      p.popCap = 0;
    }
    for (let id = 0; id < w.high; id++) if (w.alive[id] && w.state[id] !== S.Dead) sim.players[w.owner[id]].pop += UNIT_DEFS[w.utype[id]].pop;
    for (let b = 0; b < bs.high; b++) if (bs.alive[b] && bs.complete[b]) sim.players[bs.owner[b]].popCap += BUILDING_DEFS[bs.btype[b]].pop;
    for (const p of sim.players) p.popCap = Math.min(p.popCap, ECONOMY.popLimit);
  }

  private production(): void {
    const sim = this.sim;
    const bs = sim.buildings;
    for (const p of sim.players) p.housed = false;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || !bs.complete[b] || !bs.queue[b].length) continue;
      const pl = sim.players[bs.owner[b]];
      const ut = bs.queue[b][0];
      const def = UNIT_DEFS[ut];
      if (pl.pop + def.pop > pl.popCap) {
        pl.housed = true;
        continue;
      }
      if (++bs.qProgress[b] < def.trainTicks) continue;
      bs.qProgress[b] = 0;
      bs.queue[b].shift();
      pl.pop += def.pop;
      const id = sim.spawnFromBuilding(b, ut);
      sim.events.push({ t: 'trained', id, player: bs.owner[b] });
      if (bs.loop[b] && !bs.queue[b].length && pl.canAfford(def.cost)) {
        pl.pay(def.cost);
        bs.queue[b].push(ut);
      }
    }
  }

  // ───────── 指令 ─────────

  apply(c: Command): void {
    const sim = this.sim;
    const bs = sim.buildings;
    switch (c.t) {
      case 'build': {
        const def = BUILDING_DEFS[c.btype];
        const pl = sim.players[c.player];
        if (!def || !pl || def.age > pl.age || !pl.canAfford(def.cost) || !sim.canPlace(c.btype, c.tx, c.ty)) return;
        const workers = sim.ownedIds(c.player, c.ids).filter((id) => UNIT_DEFS[sim.world.utype[id]].worker);
        if (!workers.length) return;
        pl.pay(def.cost);
        const b = sim.placeBuilding(c.btype, c.player, c.tx, c.ty, false);
        workers.forEach((id, k) => {
          this.setTask(id, TASK.Build, b);
          this.approach(id, this.bRect(b), k);
        });
        break;
      }
      case 'gather': {
        const res = sim.res;
        if (c.res < 0 || c.res >= res.high || !res.alive[c.res]) return;
        sim.ownedIds(c.player, c.ids).forEach((id, k) => {
          if (!UNIT_DEFS[sim.world.utype[id]].worker) {
            sim.moveUnit(id, res.x[c.res], res.y[c.res]);
            return;
          }
          sim.world.prevTask[id] = TASK.None;
          this.setTask(id, TASK.Gather, c.res);
          sim.world.lastKind[id] = res.kind[c.res];
          sim.world.lastX[id] = res.x[c.res];
          sim.world.lastY[id] = res.y[c.res];
          this.approach(id, this.resRect(c.res), k);
        });
        break;
      }
      case 'work': {
        const b = c.building;
        if (b < 0 || b >= bs.high || !bs.alive[b] || bs.owner[b] !== c.player) return;
        const def = BUILDING_DEFS[bs.btype[b]];
        for (const id of sim.ownedIds(c.player, c.ids)) {
          const w = sim.world;
          if (!UNIT_DEFS[w.utype[id]].worker) {
            sim.moveUnit(id, bs.centerX(b), bs.centerY(b) + ((def.h * ONE) >> 1) + ONE);
            continue;
          }
          w.prevTask[id] = TASK.None;
          if (!bs.complete[b]) {
            this.setTask(id, TASK.Build, b);
            this.approach(id, this.bRect(b));
          } else if (def.id === 'farm' && (bs.farmer[b] < 0 || bs.farmer[b] === id)) {
            this.setTask(id, TASK.Farm, b);
            sim.moveUnit(id, bs.centerX(b), bs.centerY(b));
          } else if (w.carry[id] > 0 && def.drop[w.carryRes[id]]) {
            this.clearTask(id);
            w.task[id] = TASK.Return;
            w.target[id] = b;
            this.approach(id, this.bRect(b));
          } else {
            this.clearTask(id);
            this.approach(id, this.bRect(b));
          }
        }
        break;
      }
      case 'train': {
        const b = c.building;
        if (b < 0 || b >= bs.high || !bs.alive[b] || bs.owner[b] !== c.player || !bs.complete[b]) return;
        const def = BUILDING_DEFS[bs.btype[b]];
        const pl = sim.players[c.player];
        if (!def.trains.includes(c.unit) || UNIT_DEFS[c.unit].age > pl.age) return;
        const cost: Cost = UNIT_DEFS[c.unit].cost;
        for (let k = 0; k < c.count && bs.queue[b].length < ECONOMY.queueMax && pl.canAfford(cost); k++) {
          pl.pay(cost);
          bs.queue[b].push(c.unit);
        }
        break;
      }
      case 'cancel': {
        const b = c.building;
        if (b < 0 || b >= bs.high || !bs.alive[b] || bs.owner[b] !== c.player) return;
        const q = bs.queue[b];
        if (c.index < 0 || c.index >= q.length) return;
        sim.players[c.player].refund(UNIT_DEFS[q[c.index]].cost);
        q.splice(c.index, 1);
        if (c.index === 0) bs.qProgress[b] = 0;
        break;
      }
      case 'rally': {
        const b = c.building;
        if (b < 0 || b >= bs.high || !bs.alive[b] || bs.owner[b] !== c.player) return;
        bs.rallyX[b] = c.x;
        bs.rallyY[b] = c.y;
        bs.rallyRes[b] = c.res >= 0 && c.res < sim.res.high && sim.res.alive[c.res] ? c.res : -1;
        break;
      }
      case 'loop': {
        const b = c.building;
        if (b < 0 || b >= bs.high || !bs.alive[b] || bs.owner[b] !== c.player) return;
        bs.loop[b] = c.on ? 1 : 0;
        break;
      }
      case 'cheat': {
        const pl = sim.players[c.player];
        if (!pl) return;
        if (c.kind === 'res') for (let k = 0; k < 4; k++) pl.res[k] += 1000;
        else
          for (let b = 0; b < bs.high; b++) {
            if (!bs.alive[b] || bs.owner[b] !== c.player || bs.complete[b]) continue;
            bs.progress[b] = BUILDING_DEFS[bs.btype[b]].buildTicks * 3;
            bs.hp[b] = BUILDING_DEFS[bs.btype[b]].hp;
            sim.completeBuilding(b);
          }
        break;
      }
      case 'reseed':
        if (sim.players[c.player]) sim.players[c.player].autoReseed = c.on;
        break;
      case 'destroy': {
        const b = c.building;
        if (b < 0 || b >= bs.high || !bs.alive[b] || bs.owner[b] !== c.player) return;
        // 還沒開工的地基全額退費
        if (!bs.complete[b] && bs.progress[b] === 0) sim.players[c.player].refund(BUILDING_DEFS[bs.btype[b]].cost);
        for (const ut of bs.queue[b]) sim.players[c.player].refund(UNIT_DEFS[ut].cost);
        sim.removeBuilding(b);
        break;
      }
    }
  }
}

