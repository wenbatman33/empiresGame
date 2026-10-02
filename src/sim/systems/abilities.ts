// 三國特色系統（docs/02）：武將技與光環、狀態效果、火海與八陣圖、謀士、兵書玉璽、計策、奇觀、運兵船、市集
import type { Command } from '../core/commands';
import { BUILDING_DEFS, BUILDING_INDEX, RK, TAG, UNIT_DEFS, UNIT_INDEX } from '../core/defs';
import { FX_SHIFT, ONE, isqrt } from '../core/fixed';
import { ORDER, S, TK } from '../core/world';
import type { Sim } from '../sim';

/** 武將主動技（docs/02 §3.2）：冷卻秒數、目標類型 */
export const SKILLS: Record<string, { name: string; cd: number; target: 'self' | 'point'; desc: string }> = {
  hero_liubei: { name: '桃園之誓', cd: 90, target: 'self', desc: '半徑 8 內友軍 10 秒攻擊 ＋20%；關羽或張飛在場時加倍' },
  hero_guanyu: { name: '青龍偃月斬', cd: 60, target: 'point', desc: '前方 120° 扇形、3 格內 80 傷害並擊退' },
  hero_zhangfei: { name: '長坂怒吼', cd: 75, target: 'self', desc: '半徑 7 內敵人恐懼 3 秒，四散逃跑' },
  hero_zhaoyun: { name: '七進七出', cd: 60, target: 'point', desc: '直線衝鋒 10 格，路上每名敵人 40 傷害，期間無敵' },
  hero_zhuge: { name: '八陣圖', cd: 90, target: 'point', desc: '半徑 6 區域 12 秒，敵人移速 −50%、攻擊 −20%' },
  hero_caocao: { name: '挾天子以令諸侯', cd: 120, target: 'self', desc: '全軍 15 秒攻擊 ＋15%、移速 ＋10%' },
  hero_xiahou: { name: '拔矢啖睛', cd: 90, target: 'self', desc: '立刻回復 50% HP，8 秒內攻擊 ＋30%' },
  hero_zhangliao: { name: '八百破十萬', cd: 75, target: 'self', desc: '半徑 6 內最多 8 名騎兵：移速 ＋30%，下一擊 ×3' },
  hero_simayi: { name: '堅壁', cd: 90, target: 'self', desc: '半徑 8 內友軍與建築 15 秒受傷 −40%' },
  hero_sunquan: { name: '江東之主', cd: 120, target: 'self', desc: '全體民夫 20 秒採集 ＋20%，並立即完成一個生產中的單位' },
  hero_zhouyu: { name: '火燒赤壁', cd: 90, target: 'point', desc: '半徑 5 區域燃燒 10 秒，每秒 20 傷害（建築、船 ×2），會延燒' },
  hero_luxun: { name: '火燒連營', cd: 90, target: 'point', desc: '點燃一座敵方建築，連鎖到 6 格內最多 5 座' },
  hero_ganning: { name: '百騎劫營', cd: 75, target: 'self', desc: '自身與半徑 5 內最多 10 名友軍隱形 10 秒' },
};

/** 計策（docs/02 §4.2、docs/06 §8）：成本（金、石）、冷卻、時代、勢力 */
export const STRATAGEMS: Record<string, { name: string; gold: number; stone: number; cd: number; age: number; faction: string; target: 'point' | 'none'; desc: string }> = {
  fire: { name: '火攻計', gold: 300, stone: 0, cd: 180, age: 3, faction: '', target: 'point', desc: '指定半徑 4 的區域燃燒 8 秒' },
  decoy: { name: '疑兵計', gold: 150, stone: 0, cd: 150, age: 3, faction: '', target: 'point', desc: '在指定地點產生 10 個幻影兵 30 秒' },
  fortify: { name: '堅壁清野', gold: 200, stone: 200, cd: 240, age: 3, faction: '', target: 'none', desc: '自家所有建築 20 秒內護甲 ＋5' },
  discord: { name: '離間計', gold: 400, stone: 0, cd: 240, age: 4, faction: '', target: 'point', desc: '指定地點最多 6 名敵兵倒戈 15 秒' },
  plum: { name: '望梅止渴', gold: 300, stone: 0, cd: 240, age: 4, faction: 'wei', target: 'none', desc: '全軍 20 秒攻速 ＋20%、移速 ＋15%' },
  empty_fort: { name: '空城計', gold: 300, stone: 0, cd: 300, age: 4, faction: 'shu', target: 'none', desc: '太守府半徑 12 內敵人恐懼 15 秒' },
  east_wind: { name: '借東風', gold: 300, stone: 0, cd: 300, age: 4, faction: 'wu', target: 'none', desc: '全軍火焰傷害 30 秒 ×2' },
};

interface Area {
  kind: 'fire' | 'slow';
  owner: number;
  x: number;
  y: number;
  r: number;
  until: number;
  dps: number;
}

interface Item {
  kind: 'scroll' | 'seal';
  x: number;
  y: number;
  carrier: number;
  academy: number;
  /** 放進書院的 tick（玉璽稱帝倒數） */
  since: number;
}

/** 燒建築：到期 tick、每秒傷害 */
interface Burn {
  until: number;
  dps: number;
  owner: number;
}

const SEC = 10;
/** 兵書、玉璽可以收進的建築 */
const STORES = new Set(['town_hall', 'academy']);
/** 單位碰到地上物品就自動撿起的距離 */
const GRAB_R = (ONE * 9) / 10;
const HERO_ZHOUYU = 1;
const HERO_ZHANGLIAO = 2;
const HERO_SUNQUAN = 4;

export class AbilitySystem {
  readonly areas: Area[] = [];
  readonly items: Item[] = [];
  readonly burning = new Map<number, Burn>();
  /** 奇觀完工 tick（倒數 300 秒勝利） */
  readonly wonders = new Map<number, number>();
  /** 上船中：單位 → 船 */
  private boarding = new Map<number, number>();
  /** 要卸兵的船 → 卸兵點 */
  private unloading = new Map<number, [number, number]>();
  /** 玩家層級的增益到期 tick */
  readonly fortifyUntil: number[] = [];
  readonly plumUntil: number[] = [];
  readonly windUntil: number[] = [];
  readonly gatherBoostUntil: number[] = [];
  /** 每秒更新：各玩家有哪些武將在場（位元旗標）、載著甘寧的船 */
  readonly heroFlags: number[] = [];
  private ganningShips = new Set<number>();
  /** 計策特效（給渲染層） */
  readonly fx: { kind: string; x: number; y: number; r: number; tick: number; owner: number }[] = [];

  constructor(private sim: Sim) {
    for (let p = 0; p < sim.players.length; p++) {
      this.fortifyUntil.push(0);
      this.plumUntil.push(0);
      this.windUntil.push(0);
      this.gatherBoostUntil.push(0);
      this.heroFlags.push(0);
    }
    for (const it of sim.map.itemSpots) this.items.push({ kind: it.kind, x: (it.tx << FX_SHIFT) + (ONE >> 1), y: (it.ty << FX_SHIFT) + (ONE >> 1), carrier: -1, academy: -1, since: 0 });
  }

  private get tick(): number {
    return this.sim.tick;
  }

  // ───────── 給其他系統用的查詢 ─────────

  /** 攻擊力倍率（%）：增益、等級、張遼光環（敵方） */
  atkMul(id: number): number {
    const w = this.sim.world;
    let m = 100;
    if (w.atkUntil[id] > this.tick) m += w.atkPct[id];
    if (w.level[id] > 1) m += (w.level[id] - 1) * 10;
    // 被張遼威震：攻擊 −10%（先用每秒更新的旗標排除，大戰時省掉逐一搜尋）
    if (this.enemyHas(w.owner[id], HERO_ZHANGLIAO) && this.nearHero(id, 'hero_zhangliao', 8, true)) m -= 10;
    return Math.max(20, m);
  }

  /** 攻擊冷卻倍率（%）：張飛萬人敵、望梅止渴 */
  cooldownMul(id: number): number {
    const w = this.sim.world;
    let m = 100;
    if (this.plumUntil[w.owner[id]] > this.tick) m -= 20;
    if (w.utype[id] === UNIT_INDEX.hero_zhangfei) m -= Math.min(40, this.enemiesNear(id, 3 * ONE) * 5);
    return Math.max(40, m);
  }

  /** 移速倍率（%） */
  speedPct(id: number): number {
    const w = this.sim.world;
    let m = 100;
    if (w.spdUntil[id] > this.tick) m += w.spdPct[id];
    if (this.plumUntil[w.owner[id]] > this.tick) m += 15;
    if (w.fearUntil[id] > this.tick) m += 20;
    if (this.ganningShips.has(id)) m += 20;
    return Math.max(30, Math.min(250, m));
  }

  /** 受到的傷害倍率（%）：減傷、無敵、趙雲一身是膽 */
  damageTakenMul(id: number): number {
    const w = this.sim.world;
    if (w.invulnUntil[id] > this.tick) return 0;
    let m = 100;
    if (w.defUntil[id] > this.tick) m -= w.defPct[id];
    if (w.utype[id] === UNIT_INDEX.hero_zhaoyun && w.hp[id] * 10 < this.maxHp(id) * 3) m -= 50;
    if (UNIT_DEFS[w.utype[id]].tags & TAG.ship && this.heroFlags[w.owner[id]] & HERO_ZHOUYU) m -= 10;
    return Math.max(0, m);
  }

  /** 建築額外護甲（堅壁清野） */
  buildingArmorBonus(owner: number): number {
    return (this.fortifyUntil[owner] > this.tick ? 5 : 0) + this.sim.players[owner].buildingArmor;
  }

  /** 火焰傷害倍率（%）：吳 ＋25%、借東風 ×2 */
  fireMul(owner: number): number {
    let m = this.sim.players[owner]?.faction === 'wu' ? 125 : 100;
    if (this.windUntil[owner] > this.tick) m *= 2;
    return m;
  }

  /** 採集倍率（千分比）：孫權江東之主 */
  gatherBoost(owner: number): number {
    return this.gatherBoostUntil[owner] > this.tick ? 1200 : 1000;
  }

  private enemyHas(owner: number, flag: number): boolean {
    for (let p = 0; p < this.heroFlags.length; p++) if (p !== owner && this.heroFlags[p] & flag) return true;
    return false;
  }

  /** 孫權（坐斷東南）在 (x,y) 半徑 10 內嗎 */
  sunquanNear(owner: number, x: number, y: number): boolean {
    if (!(this.heroFlags[owner] & HERO_SUNQUAN)) return false;
    const w = this.sim.world;
    const ut = UNIT_INDEX.hero_sunquan;
    const r = 10 * ONE;
    for (let j = 0; j < w.high; j++) {
      if (!w.alive[j] || w.utype[j] !== ut || w.owner[j] !== owner || w.state[j] === S.Dead) continue;
      const dx = w.x[j] - x;
      const dy = w.y[j] - y;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  maxHp(id: number): number {
    const w = this.sim.world;
    const base = this.sim.players[w.owner[id]].uHp[w.utype[id]];
    return Math.trunc((base * (100 + (w.level[id] - 1) * 10)) / 100);
  }

  /** 敵人看得到、打得到嗎（隱形、在船上的不行） */
  targetable(id: number): boolean {
    const w = this.sim.world;
    return w.stealthUntil[id] <= this.tick && w.aboard[id] < 0;
  }

  private enemiesNear(id: number, r: number): number {
    const w = this.sim.world;
    let n = 0;
    for (let j = 0; j < w.high; j++) {
      if (!w.alive[j] || w.owner[j] === w.owner[id] || w.state[j] === S.Dead) continue;
      const dx = w.x[j] - w.x[id];
      const dy = w.y[j] - w.y[id];
      if (dx * dx + dy * dy <= r * r) n++;
    }
    return n;
  }

  /** 附近（r 格）有沒有某位武將；enemy＝找敵方的 */
  private nearHero(id: number, hero: string, r: number, enemy: boolean): boolean {
    const w = this.sim.world;
    const ut = UNIT_INDEX[hero];
    const rr = r * ONE;
    for (let j = 0; j < w.high; j++) {
      if (!w.alive[j] || w.utype[j] !== ut || w.state[j] === S.Dead) continue;
      if ((w.owner[j] !== w.owner[id]) !== enemy) continue;
      const dx = w.x[j] - w.x[id];
      const dy = w.y[j] - w.y[id];
      if (dx * dx + dy * dy <= rr * rr) return true;
    }
    return false;
  }

  /** 對範圍內的單位做事（依 id 順序，確定性） */
  private eachInRadius(x: number, y: number, r: number, fn: (j: number) => void): void {
    const w = this.sim.world;
    for (let j = 0; j < w.high; j++) {
      if (!w.alive[j] || w.state[j] === S.Dead || w.aboard[j] >= 0) continue;
      const dx = w.x[j] - x;
      const dy = w.y[j] - y;
      if (dx * dx + dy * dy <= r * r) fn(j);
    }
  }

  // ───────── 每 tick ─────────

  step(): void {
    const sim = this.sim;
    const w = sim.world;
    const t = this.tick;
    // 疑兵消失、離間計歸還
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.state[id] === S.Dead) continue;
      if (w.expireAt[id] && t >= w.expireAt[id]) sim.combat.kill(id);
      else if (w.origOwner[id] >= 0 && t >= w.revertAt[id]) {
        w.owner[id] = w.origOwner[id];
        w.origOwner[id] = -1;
        sim.combat.clearTarget(id);
        w.order[id] = ORDER.None;
      }
      // 衝鋒預備：沒在打仗就慢慢蓄力
      if (w.state[id] !== S.Attack && w.calm[id] < 60) w.calm[id]++;
    }
    if (t % SEC === 0) {
      this.auras();
      this.tickAreas();
      this.tickBurning();
      this.tickStrategists();
      this.tickItems();
      this.tickWonders();
      this.tickMarket();
    }
    this.tickTransports();
  }

  /** 被動光環（每秒） */
  private auras(): void {
    const sim = this.sim;
    const w = sim.world;
    this.heroFlags.fill(0);
    this.ganningShips.clear();
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.state[id] === S.Dead) continue;
      if (w.utype[id] === UNIT_INDEX.hero_zhouyu) this.heroFlags[w.owner[id]] |= HERO_ZHOUYU;
      if (w.utype[id] === UNIT_INDEX.hero_zhangliao) this.heroFlags[w.owner[id]] |= HERO_ZHANGLIAO;
      if (w.utype[id] === UNIT_INDEX.hero_sunquan) this.heroFlags[w.owner[id]] |= HERO_SUNQUAN;
      if (w.utype[id] === UNIT_INDEX.hero_ganning && w.aboard[id] >= 0) this.ganningShips.add(w.aboard[id]);
    }
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.state[id] === S.Dead || !UNIT_DEFS[w.utype[id]].hero) continue;
      const id0 = UNIT_DEFS[w.utype[id]].id;
      if (id0 === 'hero_liubei') {
        // 仁德：半徑 6 內友軍每秒回 1 HP
        this.eachInRadius(w.x[id], w.y[id], 6 * ONE, (j) => {
          if (w.owner[j] === w.owner[id] && w.hp[j] < this.maxHp(j)) w.hp[j]++;
        });
      }
    }
  }

  /** 火海、八陣圖 */
  private tickAreas(): void {
    const sim = this.sim;
    const w = sim.world;
    for (let k = this.areas.length - 1; k >= 0; k--) {
      const a = this.areas[k];
      if (this.tick >= a.until) {
        this.areas.splice(k, 1);
        continue;
      }
      if (a.kind === 'slow') {
        this.eachInRadius(a.x, a.y, a.r, (j) => {
          if (w.owner[j] === a.owner) return;
          w.spdPct[j] = -50;
          w.spdUntil[j] = this.tick + SEC + 1;
          w.atkPct[j] = -20;
          w.atkUntil[j] = this.tick + SEC + 1;
        });
        continue;
      }
      // 火：燒單位、建築、樹林
      const mul = this.fireMul(a.owner);
      this.eachInRadius(a.x, a.y, a.r, (j) => {
        if (w.owner[j] === a.owner) return;
        const ship = UNIT_DEFS[w.utype[j]].tags & TAG.ship ? 2 : 1;
        sim.combat.applyDamage(TK.Unit, j, Math.trunc((a.dps * ship * mul) / 100), -1);
      });
      const bs = sim.buildings;
      for (let b = 0; b < bs.high; b++) {
        if (!bs.alive[b] || bs.owner[b] === a.owner) continue;
        if (this.gapToRect(a.x, a.y, b) <= a.r) this.ignite(b, a.owner, 10, a.dps);
      }
      // 樹林延燒：範圍內每棵樹每秒 15% 燒掉
      const r = a.r >> FX_SHIFT;
      const cx = a.x >> FX_SHIFT;
      const cy = a.y >> FX_SHIFT;
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (!sim.map.inBounds(x, y)) continue;
          const rid = sim.resTile[sim.map.idx(x, y)];
          if (rid >= 0 && sim.res.kind[rid] === RK.tree && sim.rng.int(100) < 15) sim.depleteResource(rid);
        }
      }
    }
  }

  private gapToRect(x: number, y: number, b: number): number {
    const bs = this.sim.buildings;
    const d = BUILDING_DEFS[bs.btype[b]];
    const x0 = bs.tx[b] << FX_SHIFT;
    const y0 = bs.ty[b] << FX_SHIFT;
    const dx = Math.max(x0 - x, 0, x - (x0 + (d.w << FX_SHIFT)));
    const dy = Math.max(y0 - y, 0, y - (y0 + (d.h << FX_SHIFT)));
    return isqrt(dx * dx + dy * dy);
  }

  /** 點燃建築 sec 秒 */
  ignite(b: number, owner: number, sec: number, dps: number): void {
    const cur = this.burning.get(b);
    const until = this.tick + sec * SEC;
    if (!cur || cur.until < until) this.burning.set(b, { until, dps: Math.max(dps, cur?.dps ?? 0), owner });
  }

  private tickBurning(): void {
    const sim = this.sim;
    const bs = sim.buildings;
    const keys = [...this.burning.keys()].sort((a, b) => a - b);
    for (const b of keys) {
      const f = this.burning.get(b)!;
      if (!bs.alive[b] || this.tick >= f.until) {
        this.burning.delete(b);
        continue;
      }
      // 火焰對建築 ×2，無視護甲
      sim.combat.applyDamage(TK.Building, b, Math.trunc((f.dps * 2 * this.fireMul(f.owner)) / 100), -1);
    }
  }

  /** 謀士：自動治療；勸降進度在戰鬥系統累積 */
  private tickStrategists(): void {
    const sim = this.sim;
    const w = sim.world;
    const st = UNIT_INDEX.strategist;
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.utype[id] !== st || w.state[id] === S.Dead || w.aboard[id] >= 0) continue;
      const heal = Math.max(1, Math.trunc(sim.players[w.owner[id]].healMul / 1000));
      let healed = 0;
      this.eachInRadius(w.x[id], w.y[id], 4 * ONE, (j) => {
        if (healed >= 3 || w.owner[j] !== w.owner[id] || j === id || UNIT_DEFS[w.utype[j]].tags & TAG.ship) return;
        if (w.hp[j] < this.maxHp(j)) {
          w.hp[j] = Math.min(this.maxHp(j), w.hp[j] + heal);
          healed++;
        }
      });
    }
  }

  /** 謀士勸降：每 tick 呼叫，回傳是否完成 */
  channelConvert(id: number, t: number): void {
    const sim = this.sim;
    const w = sim.world;
    if (UNIT_DEFS[w.utype[t]].hero) return;
    if (w.convertNeed[id] === 0 || w.tgt[id] !== t) {
      // 4–8 秒（種子亂數），遊說科技加快
      const base = 40 + sim.rng.int(41);
      w.convertNeed[id] = Math.max(15, Math.trunc((base * 1000) / sim.players[w.owner[id]].convertMul));
      w.convertAcc[id] = 0;
    }
    if (++w.convertAcc[id] < w.convertNeed[id]) return;
    w.convertAcc[id] = 0;
    w.convertNeed[id] = 0;
    // 倒戈
    const from = w.owner[t];
    w.owner[t] = w.owner[id];
    sim.economy.clearTask(t);
    sim.combat.clearTarget(t);
    w.order[t] = ORDER.None;
    sim.stopMoving(t);
    sim.combat.clearTarget(id);
    w.order[id] = ORDER.None;
    sim.events.push({ t: 'converted', id: t, from, to: w.owner[id] });
  }

  /** 兵書、玉璽：跟著撿起來的單位走、送回自家太守府或書院產金、玉璽 300 秒稱帝 */
  private tickItems(): void {
    const sim = this.sim;
    const w = sim.world;
    const bs = sim.buildings;
    this.items.forEach((it, k) => {
      if (it.carrier >= 0) {
        const c = it.carrier;
        if (!w.alive[c] || w.state[c] === S.Dead) {
          it.carrier = -1;
          return;
        }
        it.x = w.x[c];
        it.y = w.y[c];
        // 走到自家太守府或書院旁就收進去
        for (let b = 0; b < bs.high; b++) {
          if (!bs.alive[b] || !bs.complete[b] || bs.owner[b] !== w.owner[c] || !STORES.has(BUILDING_DEFS[bs.btype[b]].id)) continue;
          if (this.gapToRect(w.x[c], w.y[c], b) <= ONE) {
            it.carrier = -1;
            it.academy = b;
            it.since = this.tick;
            w.item[c] = -1;
            sim.events.push({ t: 'itemStored', item: k, player: bs.owner[b] });
            break;
          }
        }
        return;
      }
      if (it.academy >= 0) {
        const b = it.academy;
        if (!bs.alive[b]) {
          it.academy = -1;
          return;
        }
        const pl = sim.players[bs.owner[b]];
        // 兵書每 4 秒 ＋1 金、玉璽每 2 秒 ＋1 金（任何部隊都能撿，開局就可能拿到，所以產量不能太高）
        if (it.kind === 'seal' ? this.tick % 20 === 0 : this.tick % 40 === 0) pl.res[2] += 1;
        // 稱帝：要到「天下一統」才開始倒數（玉璽開局就搶得到，太早倒數會變成誰先撿到誰贏）
        if (it.kind === 'seal' && pl.age < 4) it.since = this.tick;
        if (it.kind === 'seal' && sim.sealVictory && this.tick - it.since >= 3000) sim.declareWinner(bs.owner[b], 'seal');
      }
    });
  }

  private tickWonders(): void {
    const sim = this.sim;
    const keys = [...this.wonders.keys()].sort((a, b) => a - b);
    for (const b of keys) {
      if (!sim.buildings.alive[b]) {
        this.wonders.delete(b);
        continue;
      }
      if (this.tick - this.wonders.get(b)! >= 3000) sim.declareWinner(sim.buildings.owner[b], 'wonder');
    }
  }

  /** 市集價格每分鐘往 100 回歸 1 */
  private tickMarket(): void {
    if (this.tick % 600 !== 0) return;
    for (const pl of this.sim.players) for (let k = 0; k < 4; k++) pl.price[k] += pl.price[k] < 100 ? 1 : pl.price[k] > 100 ? -1 : 0;
  }

  /** 上船、卸兵、坐船的兵跟著船走 */
  private tickTransports(): void {
    const sim = this.sim;
    const w = sim.world;
    for (const [u, ship] of [...this.boarding]) {
      if (!w.alive[u] || !w.alive[ship] || w.state[u] === S.Dead || w.state[ship] === S.Dead) {
        this.boarding.delete(u);
        continue;
      }
      const dx = w.x[u] - w.x[ship];
      const dy = w.y[u] - w.y[ship];
      const reach = w.radius[u] + w.radius[ship] + ((ONE * 15) / 10);
      if (dx * dx + dy * dy <= reach * reach) {
        let load = 0;
        for (let j = 0; j < w.high; j++) if (w.alive[j] && w.aboard[j] === ship) load += UNIT_DEFS[w.utype[j]].pop;
        if (load + UNIT_DEFS[w.utype[u]].pop <= UNIT_DEFS[w.utype[ship]].capacity) {
          sim.stopMoving(u);
          w.aboard[u] = ship;
          w.state[u] = S.Idle;
        }
        this.boarding.delete(u);
      } else if (w.state[u] !== S.Move) {
        this.boarding.delete(u);
      }
    }
    for (let j = 0; j < w.high; j++) {
      if (!w.alive[j] || w.aboard[j] < 0) continue;
      const ship = w.aboard[j];
      if (!w.alive[ship] || w.state[ship] === S.Dead) {
        sim.combat.kill(j);
        w.aboard[j] = -1;
        continue;
      }
      w.x[j] = w.px[j] = w.x[ship];
      w.y[j] = w.py[j] = w.y[ship];
    }
    for (const [ship, [x, y]] of [...this.unloading]) {
      if (!w.alive[ship] || w.state[ship] === S.Dead) {
        this.unloading.delete(ship);
        continue;
      }
      // 船到了卸兵點附近（或停下來了），找離目標最近的岸邊卸兵
      const ddx = w.x[ship] - x;
      const ddy = w.y[ship] - y;
      if (w.state[ship] === S.Move && ddx * ddx + ddy * ddy > ((ONE * 3) >> 1) * ((ONE * 3) >> 1)) continue;
      const tx = w.x[ship] >> FX_SHIFT;
      const ty = w.y[ship] >> FX_SHIFT;
      const gx = x >> FX_SHIFT;
      const gy = y >> FX_SHIFT;
      let shore: [number, number] | null = null;
      let best = Infinity;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (!sim.pf.ok(tx + dx, ty + dy)) continue;
          const d = (tx + dx - gx) * (tx + dx - gx) + (ty + dy - gy) * (ty + dy - gy);
          if (d < best) {
            best = d;
            shore = [tx + dx, ty + dy];
          }
        }
      }
      if (!shore) {
        if (w.state[ship] !== S.Move) this.unloading.delete(ship);
        continue;
      }
      let k = 0;
      for (let j = 0; j < w.high; j++) {
        if (!w.alive[j] || w.aboard[j] !== ship) continue;
        const [lx, ly] = sim.pf.nearestWalkable(shore[0] + (k % 3) - 1, shore[1] + Math.floor(k / 3) - 1);
        w.aboard[j] = -1;
        w.x[j] = w.px[j] = (lx << FX_SHIFT) + (ONE >> 1);
        w.y[j] = w.py[j] = (ly << FX_SHIFT) + (ONE >> 1);
        k++;
      }
      this.unloading.delete(ship);
    }
  }

  /** 武將陣亡：記錄（半價復活）；曹操奸雄：附近友軍陣亡回血 */
  onDeath(id: number): void {
    const sim = this.sim;
    const w = sim.world;
    const d = UNIT_DEFS[w.utype[id]];
    if (d.hero) sim.players[w.owner[id]].heroDeath.set(w.utype[id], this.tick);
    const cao = UNIT_INDEX.hero_caocao;
    this.eachInRadius(w.x[id], w.y[id], 8 * ONE, (j) => {
      if (w.utype[j] === cao && w.owner[j] === w.owner[id] && j !== id) w.hp[j] = Math.min(this.maxHp(j), w.hp[j] + 20);
    });
    for (const it of this.items) if (it.carrier === id) it.carrier = -1;
  }

  /** 武將擊殺：累積威名升級（建築算 3，陸遜加倍） */
  onKill(killer: number, building: boolean): void {
    const w = this.sim.world;
    if (killer < 0 || !w.alive[killer] || !UNIT_DEFS[w.utype[killer]].hero) return;
    let add = building ? 3 : 1;
    if (building && w.utype[killer] === UNIT_INDEX.hero_luxun) add *= 2;
    w.renown[killer] += add;
    const lv = w.renown[killer] >= 25 ? 3 : w.renown[killer] >= 10 ? 2 : 1;
    if (lv > w.level[killer]) {
      const before = this.maxHp(killer);
      w.level[killer] = lv;
      w.hp[killer] += this.maxHp(killer) - before;
      this.sim.events.push({ t: 'levelUp', id: killer, level: lv });
    }
  }

  // ───────── 武將主動技 ─────────

  cast(id: number, x: number, y: number): boolean {
    const sim = this.sim;
    const w = sim.world;
    const key = UNIT_DEFS[w.utype[id]].id;
    const sk = SKILLS[key];
    if (!sk || w.skillReady[id] > this.tick || w.state[id] === S.Dead) return false;
    const me = w.owner[id];
    const t = this.tick;
    const hx = w.x[id];
    const hy = w.y[id];
    const ally = (j: number) => w.owner[j] === me;
    switch (key) {
      case 'hero_liubei': {
        let pct = 20;
        for (let j = 0; j < w.high; j++) if (w.alive[j] && w.owner[j] === me && (w.utype[j] === UNIT_INDEX.hero_guanyu || w.utype[j] === UNIT_INDEX.hero_zhangfei)) pct = 40;
        this.eachInRadius(hx, hy, 8 * ONE, (j) => {
          if (!ally(j)) return;
          w.atkPct[j] = pct;
          w.atkUntil[j] = t + 10 * SEC;
        });
        break;
      }
      case 'hero_guanyu': {
        // 前方 120° 扇形：與朝向向量夾角 cos ≥ 0.5
        let fx = x - hx;
        let fy = y - hy;
        if (!fx && !fy) {
          fx = w.fx[id];
          fy = w.fy[id];
        }
        const fl = Math.max(1, isqrt(fx * fx + fy * fy));
        this.eachInRadius(hx, hy, 3 * ONE + w.radius[id], (j) => {
          if (ally(j)) return;
          const dx = w.x[j] - hx;
          const dy = w.y[j] - hy;
          const dl = Math.max(1, isqrt(dx * dx + dy * dy));
          if ((dx * fx + dy * fy) * 2 < dl * fl) return;
          sim.combat.applyDamage(TK.Unit, j, 80, id);
          // 擊退 1 格
          const nx = w.x[j] + Math.trunc((dx * ONE) / dl);
          const ny = w.y[j] + Math.trunc((dy * ONE) / dl);
          if (w.alive[j] && sim.canStand(j, nx, ny)) {
            w.x[j] = nx;
            w.y[j] = ny;
          }
        });
        w.fx[id] = fx;
        w.fy[id] = fy;
        break;
      }
      case 'hero_zhangfei':
        this.eachInRadius(hx, hy, 7 * ONE, (j) => {
          if (ally(j) || UNIT_DEFS[w.utype[j]].tags & TAG.ship) return;
          this.fear(j, hx, hy, 3 * SEC);
        });
        break;
      case 'hero_zhaoyun': {
        // 衝鋒：瞬間移到目標方向 10 格內（沿線取可站的最遠點），路上敵人受傷
        let dx = x - hx;
        let dy = y - hy;
        const len = Math.max(1, isqrt(dx * dx + dy * dy));
        const dist = Math.min(len, 10 * ONE);
        dx = Math.trunc((dx * dist) / len);
        dy = Math.trunc((dy * dist) / len);
        const steps = Math.max(1, Math.trunc(dist / (ONE >> 1)));
        let ex = hx;
        let ey = hy;
        const hit = new Set<number>();
        for (let s = 1; s <= steps; s++) {
          const px = hx + Math.trunc((dx * s) / steps);
          const py = hy + Math.trunc((dy * s) / steps);
          if (!sim.canStand(id, px, py)) break;
          ex = px;
          ey = py;
          this.eachInRadius(px, py, (ONE * 8) / 10, (j) => {
            if (!ally(j)) hit.add(j);
          });
        }
        for (const j of [...hit].sort((a, b) => a - b)) sim.combat.applyDamage(TK.Unit, j, 40, id);
        sim.stopMoving(id);
        w.x[id] = ex;
        w.y[id] = ey;
        w.fx[id] = dx;
        w.fy[id] = dy;
        w.invulnUntil[id] = t + 2 * SEC;
        break;
      }
      case 'hero_zhuge':
        this.areas.push({ kind: 'slow', owner: me, x, y, r: 6 * ONE, until: t + 12 * SEC, dps: 0 });
        break;
      case 'hero_caocao':
        for (let j = 0; j < w.high; j++) {
          if (!w.alive[j] || !ally(j) || w.state[j] === S.Dead) continue;
          w.atkPct[j] = 15;
          w.atkUntil[j] = t + 15 * SEC;
          w.spdPct[j] = 10;
          w.spdUntil[j] = t + 15 * SEC;
        }
        break;
      case 'hero_xiahou':
        w.hp[id] = Math.min(this.maxHp(id), w.hp[id] + Math.trunc(this.maxHp(id) / 2));
        w.atkPct[id] = 30;
        w.atkUntil[id] = t + 8 * SEC;
        break;
      case 'hero_zhangliao': {
        let n = 0;
        this.eachInRadius(hx, hy, 6 * ONE, (j) => {
          if (!ally(j) || !(UNIT_DEFS[w.utype[j]].tags & TAG.cavalry) || n >= 9) return;
          n++;
          w.tripleUntil[j] = t + 10 * SEC;
          w.spdPct[j] = 30;
          w.spdUntil[j] = t + 5 * SEC;
        });
        break;
      }
      case 'hero_simayi':
        this.eachInRadius(hx, hy, 8 * ONE, (j) => {
          if (!ally(j)) return;
          w.defPct[j] = 40;
          w.defUntil[j] = t + 15 * SEC;
        });
        this.fortifyUntil[me] = Math.max(this.fortifyUntil[me], t + 15 * SEC);
        break;
      case 'hero_sunquan': {
        this.gatherBoostUntil[me] = t + 20 * SEC;
        const bs = sim.buildings;
        for (let b = 0; b < bs.high; b++) {
          if (bs.alive[b] && bs.owner[b] === me && bs.queue[b].length && bs.research[b] < 0) {
            bs.qProgress[b] = 1 << 20;
            break;
          }
        }
        break;
      }
      case 'hero_zhouyu':
        this.areas.push({ kind: 'fire', owner: me, x, y, r: 5 * ONE, until: t + 10 * SEC, dps: 20 });
        break;
      case 'hero_luxun': {
        const bs = sim.buildings;
        let first = -1;
        let best = 4 * ONE;
        for (let b = 0; b < bs.high; b++) {
          if (!bs.alive[b] || bs.owner[b] === me) continue;
          const g = this.gapToRect(x, y, b);
          if (g < best) {
            best = g;
            first = b;
          }
        }
        if (first < 0) return false;
        this.ignite(first, me, 10, 25);
        let chained = 0;
        for (let b = 0; b < bs.high && chained < 5; b++) {
          if (b === first || !bs.alive[b] || bs.owner[b] !== bs.owner[first]) continue;
          if (this.gapToRect(bs.centerX(first), bs.centerY(first), b) <= 6 * ONE) {
            this.ignite(b, me, 10, 25);
            chained++;
          }
        }
        break;
      }
      case 'hero_ganning': {
        let n = 0;
        this.eachInRadius(hx, hy, 5 * ONE, (j) => {
          if (!ally(j) || n >= 11) return;
          n++;
          w.stealthUntil[j] = t + 10 * SEC;
        });
        break;
      }
    }
    w.skillReady[id] = t + sk.cd * SEC;
    sim.events.push({ t: 'skill', id, player: me, skill: key, x, y });
    return true;
  }

  /** 恐懼：往遠離 (fx,fy) 的方向逃 */
  fear(j: number, fx: number, fy: number, ticks: number): void {
    const sim = this.sim;
    const w = sim.world;
    if (UNIT_DEFS[w.utype[j]].hero) ticks >>= 1;
    w.fearUntil[j] = this.tick + ticks;
    sim.combat.clearTarget(j);
    sim.economy.clearTask(j);
    let dx = w.x[j] - fx;
    let dy = w.y[j] - fy;
    const len = Math.max(1, isqrt(dx * dx + dy * dy));
    dx = Math.trunc((dx * 5 * ONE) / len);
    dy = Math.trunc((dy * 5 * ONE) / len);
    sim.moveUnit(j, w.x[j] + dx, w.y[j] + dy);
    w.order[j] = ORDER.Move;
  }

  // ───────── 指令 ─────────

  apply(c: Command): void {
    const sim = this.sim;
    const w = sim.world;
    switch (c.t) {
      case 'skill':
        if (c.id >= 0 && c.id < w.high && w.alive[c.id] && w.owner[c.id] === c.player) this.cast(c.id, c.x, c.y);
        break;
      case 'stratagem':
        this.stratagem(c.player, c.kind, c.x, c.y);
        break;
      case 'pickup': {
        const it = this.items[c.item];
        if (!it || it.carrier >= 0 || it.academy >= 0) return;
        // 任何陸上單位都能去撿（挑第一個還沒拿東西的）
        for (const id of sim.ownedIds(c.player, c.ids)) {
          if (UNIT_DEFS[w.utype[id]].naval || w.item[id] >= 0 || w.expireAt[id]) continue;
          sim.economy.clearTask(id);
          sim.moveUnit(id, it.x, it.y);
          this.pickups.set(id, c.item);
          break;
        }
        break;
      }
      case 'board': {
        const ship = c.ship;
        if (ship < 0 || ship >= w.high || !w.alive[ship] || w.owner[ship] !== c.player || !UNIT_DEFS[w.utype[ship]].capacity) return;
        for (const id of sim.ownedIds(c.player, c.ids)) {
          if (UNIT_DEFS[w.utype[id]].naval) continue;
          sim.economy.clearTask(id);
          const [lx, ly] = sim.pf.nearestWalkable(w.x[ship] >> FX_SHIFT, w.y[ship] >> FX_SHIFT);
          sim.moveUnit(id, (lx << FX_SHIFT) + (ONE >> 1), (ly << FX_SHIFT) + (ONE >> 1));
          this.boarding.set(id, ship);
        }
        break;
      }
      case 'unload':
        if (c.ship >= 0 && c.ship < w.high && w.alive[c.ship] && w.owner[c.ship] === c.player) {
          this.unloading.set(c.ship, [c.x, c.y]);
          sim.moveUnit(c.ship, c.x, c.y);
        }
        break;
      case 'trade':
        this.trade(c.player, c.res, c.buy);
        break;
    }
  }

  /** 被指派去撿物品的單位：走到旁邊就拿起來 */
  private pickups = new Map<number, number>();

  private grab(id: number, k: number): void {
    const w = this.sim.world;
    const it = this.items[k];
    it.carrier = id;
    it.x = w.x[id];
    it.y = w.y[id];
    w.item[id] = k;
    this.pickups.delete(id);
    this.sim.events.push({ t: 'itemPicked', item: k, player: w.owner[id], id });
  }

  /** 每 tick：指派的撿拾、以及「任何陸上單位碰到就自動撿起」 */
  stepPickups(): void {
    const w = this.sim.world;
    for (const [id, k] of [...this.pickups]) {
      const it = this.items[k];
      if (!w.alive[id] || w.state[id] === S.Dead || it.carrier >= 0 || it.academy >= 0) {
        this.pickups.delete(id);
        continue;
      }
      const dx = w.x[id] - it.x;
      const dy = w.y[id] - it.y;
      if (dx * dx + dy * dy <= ONE * ONE) {
        this.grab(id, k);
        this.sim.stopMoving(id);
      } else if (w.state[id] !== S.Move) {
        this.pickups.delete(id);
      }
    }
    if (this.tick % 2 !== 0) return;
    this.items.forEach((it, k) => {
      if (it.carrier >= 0 || it.academy >= 0) return;
      // id 小的優先（確定性）
      for (let id = 0; id < w.high; id++) {
        if (!w.alive[id] || w.state[id] === S.Dead || w.aboard[id] >= 0 || w.item[id] >= 0 || w.expireAt[id]) continue;
        if (UNIT_DEFS[w.utype[id]].naval) continue;
        const dx = w.x[id] - it.x;
        const dy = w.y[id] - it.y;
        if (dx * dx + dy * dy > GRAB_R * GRAB_R) continue;
        this.grab(id, k);
        return;
      }
    });
  }

  stratagemBlocker(player: number, kind: string): string {
    const sim = this.sim;
    const s = STRATAGEMS[kind];
    const pl = sim.players[player];
    if (!s) return '沒有這個計策';
    if (s.faction && s.faction !== pl.faction) return '其他勢力專屬';
    if (pl.age < s.age) return `需要「${['', '', '群雄割據', '三分天下', '天下一統'][s.age]}」`;
    let academy = false;
    const bs = sim.buildings;
    for (let b = 0; b < bs.high; b++) if (bs.alive[b] && bs.complete[b] && bs.owner[b] === player && BUILDING_DEFS[bs.btype[b]].id === 'academy') academy = true;
    if (!academy) return '需要書院';
    const ready = pl.stratagemReady.get(kind) ?? 0;
    if (ready > this.tick) return `冷卻中（${Math.ceil((ready - this.tick) / SEC)} 秒）`;
    if (pl.res[2] < s.gold || pl.res[3] < s.stone) return '資源不足';
    return '';
  }

  private stratagem(player: number, kind: string, x: number, y: number): void {
    const sim = this.sim;
    const w = sim.world;
    if (this.stratagemBlocker(player, kind)) return;
    const s = STRATAGEMS[kind];
    const pl = sim.players[player];
    pl.res[2] -= s.gold;
    pl.res[3] -= s.stone;
    pl.stratagemReady.set(kind, this.tick + s.cd * SEC);
    const t = this.tick;
    switch (kind) {
      case 'fire':
        this.areas.push({ kind: 'fire', owner: player, x, y, r: 4 * ONE, until: t + 8 * SEC, dps: 20 });
        break;
      case 'decoy': {
        const tx = x >> FX_SHIFT;
        const ty = y >> FX_SHIFT;
        for (let k = 0; k < 10; k++) {
          const [lx, ly] = sim.pf.nearestWalkable(tx + (k % 4) - 1, ty + (k >> 2) - 1);
          const id = sim.spawnUnit(UNIT_INDEX.phantom, player, (lx << FX_SHIFT) + (ONE >> 1), (ly << FX_SHIFT) + (ONE >> 1));
          if (id >= 0) w.expireAt[id] = t + 30 * SEC;
        }
        break;
      }
      case 'fortify':
        this.fortifyUntil[player] = t + 20 * SEC;
        break;
      case 'discord': {
        let n = 0;
        this.eachInRadius(x, y, 3 * ONE, (j) => {
          if (n >= 6 || w.owner[j] === player || UNIT_DEFS[w.utype[j]].hero || w.origOwner[j] >= 0) return;
          n++;
          w.origOwner[j] = w.owner[j];
          w.revertAt[j] = t + 15 * SEC;
          w.owner[j] = player;
          sim.combat.clearTarget(j);
          sim.economy.clearTask(j);
          w.order[j] = ORDER.None;
        });
        break;
      }
      case 'plum':
        this.plumUntil[player] = t + 20 * SEC;
        break;
      case 'empty_fort': {
        const bs = sim.buildings;
        for (let b = 0; b < bs.high; b++) {
          if (!bs.alive[b] || bs.owner[b] !== player || BUILDING_DEFS[bs.btype[b]].id !== 'town_hall') continue;
          this.eachInRadius(bs.centerX(b), bs.centerY(b), 12 * ONE, (j) => {
            if (w.owner[j] !== player) this.fear(j, bs.centerX(b), bs.centerY(b), 15 * SEC);
          });
        }
        break;
      }
      case 'east_wind':
        this.windUntil[player] = t + 30 * SEC;
        break;
    }
    this.fx.push({ kind, x, y, r: 4 * ONE, tick: t, owner: player });
    sim.events.push({ t: 'stratagem', player, kind, x, y });
  }

  private trade(player: number, res: number, buy: boolean): void {
    const sim = this.sim;
    const pl = sim.players[player];
    if (res === 2 || res < 0 || res > 3) return;
    let market = false;
    const bs = sim.buildings;
    for (let b = 0; b < bs.high; b++) if (bs.alive[b] && bs.complete[b] && bs.owner[b] === player && bs.btype[b] === BUILDING_INDEX.market) market = true;
    if (!market) return;
    const p = pl.price[res];
    if (buy) {
      const gold = Math.trunc((p * (100 + pl.tradeFee)) / 100);
      if (pl.res[2] < gold) return;
      pl.res[2] -= gold;
      pl.res[res] += 100;
      pl.price[res] = Math.min(300, p + 3);
    } else {
      if (pl.res[res] < 100) return;
      pl.res[res] -= 100;
      pl.res[2] += Math.trunc((p * (100 - pl.tradeFee)) / 100);
      pl.price[res] = Math.max(20, p - 3);
    }
  }

  /** 地圖上還在地上的物品（渲染、AI 用） */
  itemsOnGround(): number[] {
    return this.items.map((it, k) => (it.carrier < 0 && it.academy < 0 ? k : -1)).filter((k) => k >= 0);
  }

}
