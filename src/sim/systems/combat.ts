// 戰鬥系統（docs/03）：索敵、追擊、近戰、投射物、傷害公式、防禦建築、死亡
import type { Command } from '../core/commands';
import { BUILDING_DEFS, TAG, UNIT_DEFS } from '../core/defs';
import { FX_SHIFT, ONE, isqrt } from '../core/fixed';
import { CAPACITY, ORDER, S, STANCE, TASK, TK } from '../core/world';
import type { Sim } from '../sim';

/** 近戰距離：攻擊者身體邊緣到目標邊緣 */
const MELEE_PAD = (ONE * 35) / 100;
/** 防守姿態最多追多遠 */
const LEASH = 8 * ONE;
/** 索敵桶大小（格） */
const CELL = 4;
/** 箭速（定點數／tick） */
const ARROW_SPEED = Math.round((ONE * 9) / 10);
/** 死亡後保留幾 tick 播倒地動畫 */
export const CORPSE_TICKS = 60;
/** 移動中的目標被遠程命中的機率（%） */
const MOVING_HIT = 80;

export class CombatSystem {
  private readonly cw: number;
  private readonly ch: number;
  private readonly head: Int32Array;
  private readonly next = new Int32Array(CAPACITY);
  /** 死亡時間 */
  private readonly deadAt = new Int32Array(CAPACITY);

  constructor(private sim: Sim) {
    this.cw = Math.ceil(sim.map.w / CELL);
    this.ch = Math.ceil(sim.map.h / CELL);
    this.head = new Int32Array(this.cw * this.ch);
  }

  step(): void {
    const sim = this.sim;
    const w = sim.world;
    this.buildGrid();
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id]) continue;
      if (w.state[id] === S.Dead) {
        if (sim.tick - this.deadAt[id] >= CORPSE_TICKS) w.remove(id);
        continue;
      }
      this.tickUnit(id);
    }
    this.buildingAttacks();
    this.stepProjectiles();
  }

  private buildGrid(): void {
    const w = this.sim.world;
    this.head.fill(-1);
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.state[id] === S.Dead) continue;
      const c = Math.floor((w.y[id] >> FX_SHIFT) / CELL) * this.cw + Math.floor((w.x[id] >> FX_SHIFT) / CELL);
      this.next[id] = this.head[c];
      this.head[c] = id;
    }
  }

  // ───────── 目標 ─────────

  private targetValid(id: number): boolean {
    const sim = this.sim;
    const w = sim.world;
    const t = w.tgt[id];
    if (w.tgtKind[id] === TK.Unit) return t >= 0 && t < w.high && w.alive[t] === 1 && w.state[t] !== S.Dead && w.owner[t] !== w.owner[id];
    if (w.tgtKind[id] === TK.Building) return t >= 0 && sim.buildings.alive[t] === 1 && sim.buildings.owner[t] !== w.owner[id];
    return false;
  }

  setTarget(id: number, kind: number, t: number): void {
    const w = this.sim.world;
    w.tgtKind[id] = kind;
    w.tgt[id] = t;
    w.repath[id] = 0;
  }

  clearTarget(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    w.tgtKind[id] = TK.None;
    w.tgt[id] = -1;
    if (w.state[id] === S.Attack) {
      w.state[id] = S.Idle;
      w.stateTick[id] = sim.tick;
    }
  }

  /** 找視野內最近的敵人；軍隊優先，其次民夫，最後建築 */
  private findEnemy(id: number, radius: number, buildings: boolean): [number, number] {
    const sim = this.sim;
    const w = sim.world;
    const me = w.owner[id];
    const x = w.x[id];
    const y = w.y[id];
    const r = radius + ONE;
    const cx0 = Math.max(0, Math.floor(((x - r) >> FX_SHIFT) / CELL));
    const cx1 = Math.min(this.cw - 1, Math.floor(((x + r) >> FX_SHIFT) / CELL));
    const cy0 = Math.max(0, Math.floor(((y - r) >> FX_SHIFT) / CELL));
    const cy1 = Math.min(this.ch - 1, Math.floor(((y + r) >> FX_SHIFT) / CELL));
    let best = -1;
    let bestScore = Infinity;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let j = this.head[cy * this.cw + cx]; j !== -1; j = this.next[j]) {
          if (w.owner[j] === me) continue;
          const dx = w.x[j] - x;
          const dy = w.y[j] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r) continue;
          // 民夫的優先順序排在軍隊後面（等同遠 3 格）
          const pen = UNIT_DEFS[w.utype[j]].worker ? 3 * ONE : 0;
          const score = isqrt(d2) + pen;
          if (score < bestScore || (score === bestScore && j < best)) {
            bestScore = score;
            best = j;
          }
        }
      }
    }
    if (best >= 0) return [TK.Unit, best];
    if (!buildings) return [TK.None, -1];
    const bs = sim.buildings;
    let bb = -1;
    let bd = Infinity;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || bs.owner[b] === me || BUILDING_DEFS[bs.btype[b]].wall) continue;
      const g = this.gapToBuilding(id, b);
      if (g <= radius && g < bd) {
        bd = g;
        bb = b;
      }
    }
    return bb >= 0 ? [TK.Building, bb] : [TK.None, -1];
  }

  private gapToBuilding(id: number, b: number): number {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    const def = BUILDING_DEFS[bs.btype[b]];
    const x0 = bs.tx[b] << FX_SHIFT;
    const y0 = bs.ty[b] << FX_SHIFT;
    const dx = Math.max(x0 - w.x[id], 0, w.x[id] - (x0 + (def.w << FX_SHIFT)));
    const dy = Math.max(y0 - w.y[id], 0, w.y[id] - (y0 + (def.h << FX_SHIFT)));
    return isqrt(dx * dx + dy * dy) - w.radius[id];
  }

  // ───────── 每個單位 ─────────

  private tickUnit(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    const def = UNIT_DEFS[w.utype[id]];
    if (w.cooldown[id] > 0) w.cooldown[id]--;
    if (def.attack <= 0) return;
    if (w.order[id] === ORDER.Move && w.state[id] !== S.Move) w.order[id] = ORDER.None;
    if (w.tgtKind[id] !== TK.None && !this.targetValid(id)) {
      this.clearTarget(id);
      if (w.order[id] === ORDER.Attack) w.order[id] = ORDER.None;
      // 攻擊移動：打完繼續往目的地走
      if (w.order[id] === ORDER.AttackMove || w.order[id] === ORDER.Patrol) sim.moveUnit(id, w.destX[id], w.destY[id]);
    }
    const busy = w.task[id] !== TASK.None;
    if (w.tgtKind[id] === TK.None) {
      if (w.order[id] === ORDER.Patrol && w.state[id] === S.Idle) {
        // 巡邏到端點：換方向
        const dx = w.destX[id] - w.x[id];
        const dy = w.destY[id] - w.y[id];
        if (dx * dx + dy * dy <= 4 * ONE * ONE) {
          const hx = w.homeX[id];
          const hy = w.homeY[id];
          w.homeX[id] = w.destX[id];
          w.homeY[id] = w.destY[id];
          w.destX[id] = hx;
          w.destY[id] = hy;
        }
        sim.moveUnit(id, w.destX[id], w.destY[id]);
      }
      if (w.order[id] === ORDER.None && w.state[id] === S.Idle && !busy) {
        w.homeX[id] = w.x[id];
        w.homeY[id] = w.y[id];
      }
      if (w.order[id] === ORDER.Move || busy) return;
      const stance = w.stance[id];
      // 被打了先反擊
      const atk = w.lastAttacker[id];
      if (atk >= 0 && stance !== STANCE.Passive && w.alive[atk] && w.state[atk] !== S.Dead && w.owner[atk] !== w.owner[id]) {
        this.setTarget(id, TK.Unit, atk);
      } else if (w.order[id] === ORDER.AttackMove || w.order[id] === ORDER.Patrol || (stance !== STANCE.Passive && w.state[id] !== S.Move)) {
        if ((sim.tick + id) % 5 !== 0) return;
        const roaming = w.order[id] === ORDER.AttackMove || w.order[id] === ORDER.Patrol;
        const radius = stance === STANCE.Stand && !roaming ? Math.max(def.rangeFx, MELEE_PAD + w.radius[id]) : def.sight * ONE;
        const [k, t] = this.findEnemy(id, radius, roaming || stance === STANCE.Aggressive);
        if (k === TK.None) {
          if (w.order[id] === ORDER.AttackMove && w.state[id] === S.Idle) {
            const dx = w.destX[id] - w.x[id];
            const dy = w.destY[id] - w.y[id];
            if (dx * dx + dy * dy > 4 * ONE * ONE) sim.moveUnit(id, w.destX[id], w.destY[id]);
            else w.order[id] = ORDER.None;
          }
          return;
        }
        this.setTarget(id, k, t);
      } else {
        return;
      }
    }
    w.lastAttacker[id] = -1;
    this.engage(id);
  }

  private engage(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    const def = UNIT_DEFS[w.utype[id]];
    const t = w.tgt[id];
    let gap: number;
    let tx: number;
    let ty: number;
    if (w.tgtKind[id] === TK.Unit) {
      tx = w.x[t];
      ty = w.y[t];
      const dx = tx - w.x[id];
      const dy = ty - w.y[id];
      gap = isqrt(dx * dx + dy * dy) - w.radius[id] - w.radius[t];
    } else {
      const bs = sim.buildings;
      tx = bs.centerX(t);
      ty = bs.centerY(t);
      gap = this.gapToBuilding(id, t);
    }
    const reach = def.rangeFx > 0 ? def.rangeFx : MELEE_PAD;
    if (gap <= reach) {
      if (w.state[id] === S.Move) sim.stopMoving(id);
      if (w.state[id] !== S.Attack) {
        w.state[id] = S.Attack;
        w.stateTick[id] = sim.tick;
      }
      w.fx[id] = tx - w.x[id];
      w.fy[id] = ty - w.y[id];
      if (w.cooldown[id] === 0) {
        this.fire(id);
        w.cooldown[id] = def.cooldownTicks;
      }
      return;
    }
    // 追擊
    if (w.stance[id] === STANCE.Stand && w.order[id] !== ORDER.Attack) {
      this.clearTarget(id);
      return;
    }
    if (w.stance[id] === STANCE.Defensive && w.order[id] === ORDER.None) {
      // 防守姿態：追太遠就回原位
      const hx = w.x[id] - w.homeX[id];
      const hy = w.y[id] - w.homeY[id];
      if (hx * hx + hy * hy > LEASH * LEASH) {
        this.clearTarget(id);
        sim.moveUnit(id, w.homeX[id], w.homeY[id]);
        w.order[id] = ORDER.Move;
        return;
      }
    }
    if (w.state[id] === S.Attack) {
      w.state[id] = S.Idle;
      w.stateTick[id] = sim.tick;
    }
    if (w.state[id] !== S.Move || w.repath[id] === 0) {
      if (w.tgtKind[id] === TK.Building) {
        const bs = sim.buildings;
        const bd = BUILDING_DEFS[bs.btype[t]];
        const x0 = bs.tx[t] << FX_SHIFT;
        const y0 = bs.ty[t] << FX_SHIFT;
        tx = Math.max(x0 - w.radius[id], Math.min(x0 + (bd.w << FX_SHIFT) + w.radius[id], w.x[id]));
        ty = Math.max(y0 - w.radius[id], Math.min(y0 + (bd.h << FX_SHIFT) + w.radius[id], w.y[id]));
      }
      sim.moveUnit(id, tx, ty);
      w.repath[id] = 8;
    } else {
      w.repath[id]--;
    }
  }

  // ───────── 傷害 ─────────

  /** 傷害 ＝ max(1, 攻擊 − 對應護甲 ＋ Σ 標籤加成) × 高低差修正（docs/03 §3） */
  damage(attack: number, ranged: boolean, bonus: [number, number][], fromX: number, fromY: number, kind: number, t: number): number {
    const sim = this.sim;
    let armor: number;
    let tags: number;
    let tx: number;
    let ty: number;
    if (kind === TK.Unit) {
      const w = sim.world;
      const d = UNIT_DEFS[w.utype[t]];
      armor = d.armor[ranged ? 1 : 0];
      tags = d.tags;
      tx = w.x[t];
      ty = w.y[t];
    } else {
      const bs = sim.buildings;
      const d = BUILDING_DEFS[bs.btype[t]];
      armor = d.armor[ranged ? 1 : 0];
      tags = TAG.building;
      tx = bs.centerX(t);
      ty = bs.centerY(t);
    }
    let dmg = attack - armor;
    for (const [tag, v] of bonus) if (tags & tag) dmg += v;
    dmg = Math.max(1, dmg);
    const dh = sim.heightAt(fromX, fromY) - sim.heightAt(tx, ty);
    if (dh >= 24) dmg = Math.trunc((dmg * 125) / 100);
    else if (dh <= -24) dmg = Math.max(1, Math.trunc((dmg * 75) / 100));
    return dmg;
  }

  private fire(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    const def = UNIT_DEFS[w.utype[id]];
    const kind = w.tgtKind[id];
    const t = w.tgt[id];
    const ranged = def.rangeFx > 0;
    const dmg = this.damage(def.attack, ranged, def.bonus, w.x[id], w.y[id], kind, t);
    w.lastHit[id] = sim.tick;
    if (!ranged) {
      this.applyDamage(kind, t, dmg, id);
      return;
    }
    const moving = kind === TK.Unit && w.state[t] === S.Move;
    const hit = !moving || sim.rng.int(100) < MOVING_HIT;
    const tx = kind === TK.Unit ? w.x[t] : sim.buildings.centerX(t);
    const ty = kind === TK.Unit ? w.y[t] : sim.buildings.centerY(t);
    this.launch(w.owner[id], w.x[id], w.y[id], 40, tx, ty, kind, t, dmg, hit, id);
  }

  private launch(owner: number, sx: number, sy: number, h0: number, tx: number, ty: number, kind: number, t: number, dmg: number, hit: boolean, from: number): void {
    const p = this.sim.projectiles;
    const i = p.add();
    if (i < 0) return;
    p.owner[i] = owner;
    p.sx[i] = sx;
    p.sy[i] = sy;
    p.h0[i] = h0;
    // 沒射中：落點偏一點
    const miss = hit ? 0 : ONE >> 1;
    p.tx[i] = tx + ((this.sim.tick & 1) === 0 ? miss : -miss);
    p.ty[i] = ty + miss;
    const dx = tx - sx;
    const dy = ty - sy;
    p.dur[i] = Math.max(2, Math.ceil(isqrt(dx * dx + dy * dy) / ARROW_SPEED));
    p.tgtKind[i] = kind;
    p.tgt[i] = t;
    p.dmg[i] = dmg;
    p.hit[i] = hit ? 1 : 0;
    p.from[i] = from;
  }

  private stepProjectiles(): void {
    const p = this.sim.projectiles;
    for (let i = 0; i < p.high; i++) {
      if (!p.alive[i]) continue;
      if (++p.t[i] < p.dur[i]) continue;
      if (p.hit[i]) this.applyDamage(p.tgtKind[i], p.tgt[i], p.dmg[i], p.from[i]);
      p.remove(i);
    }
  }

  applyDamage(kind: number, t: number, dmg: number, from: number): void {
    const sim = this.sim;
    if (kind === TK.Unit) {
      const w = sim.world;
      if (!w.alive[t] || w.state[t] === S.Dead) return;
      w.hp[t] -= dmg;
      if (from >= 0 && from < w.high && w.alive[from]) w.lastAttacker[t] = from;
      if (w.hp[t] <= 0) {
        this.kill(t);
        return;
      }
      // 民夫被軍隊攻擊：放下工作逃回太守府（docs/03 §4）
      if (UNIT_DEFS[w.utype[t]].worker && from >= 0 && w.alive[from] && !UNIT_DEFS[w.utype[from]].worker && w.order[t] === ORDER.None) {
        const th = sim.nearestDrop(w.owner[t], 0, w.x[t], w.y[t]);
        if (th >= 0) {
          sim.economy.clearTask(t);
          sim.moveUnit(t, sim.buildings.centerX(th), sim.buildings.centerY(th));
          w.order[t] = ORDER.Move;
        }
      }
    } else if (kind === TK.Building) {
      const bs = sim.buildings;
      if (!bs.alive[t]) return;
      bs.hp[t] -= dmg;
      bs.lastAttacker[t] = from;
      if (bs.hp[t] <= 0) {
        const def = BUILDING_DEFS[bs.btype[t]];
        sim.events.push({ t: 'bDestroyed', id: t, btype: bs.btype[t], tx: bs.tx[t], ty: bs.ty[t], w: def.w, h: def.h });
        sim.removeBuilding(t);
      }
    }
  }

  kill(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    sim.economy.clearTask(id);
    sim.stopMoving(id);
    w.state[id] = S.Dead;
    w.stateTick[id] = sim.tick;
    w.hp[id] = 0;
    w.tgtKind[id] = TK.None;
    w.tgt[id] = -1;
    w.order[id] = ORDER.None;
    this.deadAt[id] = sim.tick;
    sim.events.push({ t: 'died', id, player: w.owner[id], utype: w.utype[id] });
  }

  /** 太守府、箭塔對範圍內的敵人射箭 */
  private buildingAttacks(): void {
    const sim = this.sim;
    const bs = sim.buildings;
    const w = sim.world;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || !bs.complete[b]) continue;
      const def = BUILDING_DEFS[bs.btype[b]];
      if (def.attack <= 0) continue;
      if (bs.cooldown[b] > 0) {
        bs.cooldown[b]--;
        continue;
      }
      const cx = bs.centerX(b);
      const cy = bs.centerY(b);
      const reach = def.rangeFx + ((Math.max(def.w, def.h) << FX_SHIFT) >> 1);
      const me = bs.owner[b];
      let best = -1;
      let bestD = reach * reach;
      const c0x = Math.max(0, Math.floor(((cx - reach) >> FX_SHIFT) / CELL));
      const c1x = Math.min(this.cw - 1, Math.floor(((cx + reach) >> FX_SHIFT) / CELL));
      const c0y = Math.max(0, Math.floor(((cy - reach) >> FX_SHIFT) / CELL));
      const c1y = Math.min(this.ch - 1, Math.floor(((cy + reach) >> FX_SHIFT) / CELL));
      for (let gy = c0y; gy <= c1y; gy++) {
        for (let gx = c0x; gx <= c1x; gx++) {
          for (let j = this.head[gy * this.cw + gx]; j !== -1; j = this.next[j]) {
            if (w.owner[j] === me || w.state[j] === S.Dead) continue;
            const dx = w.x[j] - cx;
            const dy = w.y[j] - cy;
            const d = dx * dx + dy * dy;
            if (d < bestD || (d === bestD && j < best)) {
              bestD = d;
              best = j;
            }
          }
        }
      }
      if (best < 0) continue;
      const dmg = this.damage(def.attack, true, [], cx, cy, TK.Unit, best);
      const moving = w.state[best] === S.Move;
      const hit = !moving || sim.rng.int(100) < MOVING_HIT;
      this.launch(me, cx, cy, def.id === 'tower' ? 150 : 110, w.x[best], w.y[best], TK.Unit, best, dmg, hit, -1);
      bs.cooldown[b] = def.cooldownTicks;
    }
  }

  // ───────── 指令 ─────────

  apply(c: Command): void {
    const sim = this.sim;
    const w = sim.world;
    switch (c.t) {
      case 'attack': {
        const valid =
          c.kind === TK.Unit
            ? c.target >= 0 && c.target < w.high && w.alive[c.target] && w.owner[c.target] !== c.player
            : c.kind === TK.Building && c.target >= 0 && sim.buildings.alive[c.target] && sim.buildings.owner[c.target] !== c.player;
        if (!valid) return;
        for (const id of sim.ownedIds(c.player, c.ids)) {
          if (UNIT_DEFS[w.utype[id]].attack <= 0) continue;
          sim.economy.clearTask(id);
          w.order[id] = ORDER.Attack;
          this.setTarget(id, c.kind, c.target);
        }
        break;
      }
      case 'stance':
        for (const id of sim.ownedIds(c.player, c.ids)) w.stance[id] = c.stance;
        break;
    }
  }
}
