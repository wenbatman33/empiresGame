// 劇本與觸發器（docs/08 §2）：在模擬層執行，所以戰役也是確定性的、可以存檔重播
// 觸發器 ＝ 條件（全部成立）→ 動作；對話、目標、鏡頭等 UI 相關的動作以事件送給畫面層
import { BUILDING_DEFS, BUILDING_INDEX, TAG, TECH_INDEX, UNIT_DEFS, UNIT_INDEX } from '../core/defs';
import { FX_SHIFT, ONE } from '../core/fixed';
import { S } from '../core/world';
import { T } from '../map/grid';
import type { Sim, SimEvent } from '../sim';

/** 位置：絕對格座標，或以錨點（A ＝ 玩家出生點、B ＝ 敵方出生點、C ＝ 地圖中心）加偏移 */
export type Pos = [number, number] | ['A' | 'B' | 'C', number, number];
/** 區域：中心 ＋ 半徑（格） */
export interface Area {
  at: Pos;
  r: number;
}
type Op = '>=' | '<=' | '==';

export type Cond =
  | { t: 'time'; sec: number }
  | { t: 'inArea'; player: number; area: Area; n?: number; unit?: string; tag?: string }
  | { t: 'units'; player: number; unit?: string; tag?: string; army?: boolean; op: Op; n: number }
  | { t: 'buildings'; player: number; building?: string; op: Op; n: number; complete?: boolean }
  | { t: 'gathered'; player: number; res: [number, number, number, number] }
  | { t: 'kills'; player: number; n: number }
  /** 損失的單位數（stats.lost） */
  | { t: 'lost'; player: number; op: Op; n: number }
  | { t: 'trained'; player: number; unit: string; n: number }
  | { t: 'age'; player: number; age: number }
  | { t: 'skill'; player: number; hero?: string }
  | { t: 'converted'; player: number; n: number }
  | { t: 'var'; name: string; op: Op; n: number }
  | { t: 'fired'; id: string }
  | { t: 'dead'; tag: string };

export type Act =
  | { t: 'dialog'; lines: { who: string; face?: string; text: string }[] }
  | { t: 'spawn'; player: number; unit: string; at: Pos; n?: number; tag?: string; attack?: Pos }
  | { t: 'building'; player: number; building: string; at: Pos; tag?: string }
  | { t: 'objective'; id: string; state: 'show' | 'done' | 'failed' }
  | { t: 'win' }
  | { t: 'lose'; why?: string }
  | { t: 'camera'; at: Pos }
  | { t: 'give'; player: number; res: [number, number, number, number] }
  | { t: 'setVar'; name: string; value?: number; add?: number }
  | { t: 'hint'; text: string }
  | { t: 'attack'; player: number; to: Pos; tag?: string }
  | { t: 'cutin'; hero: string; skill: string }
  | { t: 'beacon'; at: Pos; on: boolean; id: string }
  | { t: 'age'; player: number; age: number }
  /** 放火：在某處燒一片（火燒赤壁、苦肉連環） */
  | { t: 'fire'; player: number; at: Pos; r: number; sec: number }
  /** 借東風：某玩家火焰傷害加倍 */
  | { t: 'wind'; player: number; sec: number }
  /** 讓帶標籤的單位停在原地（堅守、錨泊） */
  | { t: 'hold'; tag: string }
  /** 追擊：帶標籤的單位攻擊移動到另一群標籤單位的中心（誘敵） */
  | { t: 'chase'; player: number; tag: string; target: string };

export interface Trigger {
  id: string;
  when: Cond[];
  then: Act[];
  /** 可重複觸發：間隔秒數（不填 ＝ 只觸發一次） */
  every?: number;
}

export interface Placement {
  player: number;
  unit?: string;
  building?: string;
  at: Pos;
  n?: number;
  tag?: string;
  /** 建築：蓋好的（預設）或地基 */
  complete?: boolean;
}

export interface ScenarioPlayer {
  name: string;
  faction: string;
  res?: [number, number, number, number];
  age?: number;
  /** 電腦 AI 難度；null ＝ 只照觸發器行動 */
  ai?: 'easy' | 'normal' | 'hard' | null;
}

export interface Scenario {
  id: string;
  chapter: number;
  title: string;
  subtitle: string;
  brief: string;
  map: { type: string; size: number; seed: number };
  players: ScenarioPlayer[];
  /** 開局清掉的森林、岩塊（方便擺放） */
  clear?: Area[];
  place: Placement[];
  objectives: { id: string; text: string; primary?: boolean; hidden?: boolean }[];
  triggers: Trigger[];
  /** 三星條件：幾秒內通關、哪個次要目標 */
  stars: { time: number; bonus?: string };
}

export type ObjectiveState = 'hidden' | 'active' | 'done' | 'failed';

export class ScenarioSystem {
  readonly vars = new Map<string, number>();
  readonly objectives = new Map<string, ObjectiveState>();
  readonly fired = new Set<string>();
  private lastFire = new Map<string, number>();
  private tags = new Map<string, number[]>();
  private skills: Map<string, number>[] = [];
  private converted: number[] = [];
  private trained: Map<number, number>[] = [];
  private evSeen = 0;
  /** 上次看到的最後一個事件（畫面層清空事件列表時用來判斷要從頭看） */
  private lastEv: SimEvent | null = null;
  /** 光柱標記（給畫面層） */
  readonly beacons = new Map<string, [number, number]>();

  constructor(
    private sim: Sim,
    readonly sc: Scenario,
  ) {
    for (let p = 0; p < sim.players.length; p++) {
      this.skills.push(new Map());
      this.converted.push(0);
      this.trained.push(new Map());
    }
    for (const o of sc.objectives) this.objectives.set(o.id, o.hidden ? 'hidden' : 'active');
  }

  /** 位置換成格座標 */
  tile(p: Pos): [number, number] {
    const m = this.sim.map;
    if (typeof p[0] === 'number') return [p[0], p[1] as number];
    const [a, dx, dy] = p as ['A' | 'B' | 'C', number, number];
    const base = a === 'A' ? m.starts[0] : a === 'B' ? m.starts[1] : { x: m.w >> 1, y: m.h >> 1 };
    return [Math.max(1, Math.min(m.w - 2, base.x + dx)), Math.max(1, Math.min(m.h - 2, base.y + dy))];
  }

  private fx(p: Pos): [number, number] {
    const [tx, ty] = this.tile(p);
    return [(tx << FX_SHIFT) + (ONE >> 1), (ty << FX_SHIFT) + (ONE >> 1)];
  }

  /** 開局：清空區域、擺放單位與建築、設定資源與時代 */
  setup(): void {
    const sim = this.sim;
    const m = sim.map;
    for (const a of this.sc.clear ?? []) {
      const [cx, cy] = this.tile(a.at);
      for (let y = cy - a.r; y <= cy + a.r; y++) {
        for (let x = cx - a.r; x <= cx + a.r; x++) {
          if (!m.inBounds(x, y) || (x - cx) * (x - cx) + (y - cy) * (y - cy) > a.r * a.r) continue;
          const t = m.tiles[m.idx(x, y)];
          if (t === T.Forest || t === T.Rock) m.setTile(x, y, T.Grass);
          const r = sim.resTile[m.idx(x, y)];
          if (r >= 0) sim.depleteResource(r);
          sim.refreshPass(m.idx(x, y));
        }
      }
      m.passVersion++;
    }
    this.sc.players.forEach((p, i) => {
      const pl = sim.players[i];
      if (!pl) return;
      if (p.res) for (let k = 0; k < 4; k++) pl.res[k] = p.res[k];
      if (p.age && p.age > 1) this.setAge(i, p.age);
    });
    for (const pl of this.sc.place) this.place(pl);
    // 開局放的單位不算「訓練」
    for (const pl of sim.players) pl.stats.trained = 0;
  }

  /** 直接升到某個時代：時代由科技推導，所以補上升時代科技再重算 */
  private setAge(player: number, age: number): void {
    const pl = this.sim.players[player];
    for (let a = 2; a <= Math.min(4, age); a++) pl.techs.add(TECH_INDEX[`age${a}`]);
    pl.recompute();
  }

  private place(p: Placement): void {
    const sim = this.sim;
    if (p.building) {
      const bt = BUILDING_INDEX[p.building];
      const d = BUILDING_DEFS[bt];
      const [cx, cy] = this.tile(p.at);
      // 找最近可以蓋的位置
      for (let r = 0; r < 12; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const tx = cx + dx - (d.w >> 1);
            const ty = cy + dy - (d.h >> 1);
            if (!sim.canPlace(bt, tx, ty)) continue;
            const b = sim.placeBuilding(bt, p.player, tx, ty, p.complete !== false);
            if (p.tag) this.addTag(p.tag, -2 - b);
            return;
          }
        }
      }
      return;
    }
    if (p.unit) this.spawn(p.player, p.unit, p.at, p.n ?? 1, p.tag);
  }

  private addTag(tag: string, id: number): void {
    const list = this.tags.get(tag) ?? [];
    list.push(id);
    this.tags.set(tag, list);
  }

  /** 生單位（照 cmdSpawn 的排法），回傳新單位 id */
  private spawn(player: number, unit: string, at: Pos, n: number, tag?: string): number[] {
    const sim = this.sim;
    const w = sim.world;
    const ut = UNIT_INDEX[unit];
    if (ut === undefined) return [];
    const [x, y] = this.fx(at);
    const pf = UNIT_DEFS[ut].naval ? sim.pfWater : sim.pf;
    const [ctx, cty] = pf.nearestWalkable(x >> FX_SHIFT, y >> FX_SHIFT);
    const out: number[] = [];
    const sp = (ONE * 7) / 10;
    for (let r = 0; out.length < n && r < 40; r++) {
      for (let j = -r; j <= r && out.length < n; j++) {
        for (let i = -r; i <= r && out.length < n; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const px = (ctx << FX_SHIFT) + (ONE >> 1) + i * sp;
          const py = (cty << FX_SHIFT) + (ONE >> 1) + j * sp;
          if (!pf.okFx(px, py)) continue;
          const id = sim.spawnUnit(ut, player, px, py);
          if (id < 0) return out;
          // 劇本裡的武將一出場就能放技
          w.skillReady[id] = 0;
          out.push(id);
          if (tag) this.addTag(tag, id);
        }
      }
    }
    return out;
  }

  private cmp(a: number, op: Op, b: number): boolean {
    return op === '>=' ? a >= b : op === '<=' ? a <= b : a === b;
  }

  /** 標籤裡還活著的單位（建築用 -2-b 存） */
  private tagged(tag: string): number[] {
    const sim = this.sim;
    const w = sim.world;
    return (this.tags.get(tag) ?? []).filter((id) => (id >= 0 ? w.alive[id] && w.state[id] !== S.Dead : sim.buildings.alive[-2 - id]));
  }

  private check(c: Cond): boolean {
    const sim = this.sim;
    const w = sim.world;
    switch (c.t) {
      case 'time':
        return sim.tick >= c.sec * 10;
      case 'inArea': {
        const [cx, cy] = this.tile(c.area.at);
        const r2 = c.area.r * c.area.r * ONE * ONE;
        const ids = c.tag ? this.tagged(c.tag).filter((id) => id >= 0) : null;
        let n = 0;
        const test = (id: number) => {
          if (!w.alive[id] || w.state[id] === S.Dead || w.owner[id] !== c.player) return;
          if (c.unit && UNIT_DEFS[w.utype[id]].id !== c.unit) return;
          const dx = w.x[id] - ((cx << FX_SHIFT) + (ONE >> 1));
          const dy = w.y[id] - ((cy << FX_SHIFT) + (ONE >> 1));
          if (dx * dx + dy * dy <= r2) n++;
        };
        if (ids) ids.forEach(test);
        else for (let id = 0; id < w.high; id++) test(id);
        return n >= (c.n ?? 1);
      }
      case 'units': {
        let n = 0;
        if (c.tag) n = this.tagged(c.tag).filter((id) => id >= 0 && w.owner[id] === c.player).length;
        else {
          for (let id = 0; id < w.high; id++) {
            if (!w.alive[id] || w.state[id] === S.Dead || w.owner[id] !== c.player) continue;
            const d = UNIT_DEFS[w.utype[id]];
            if (c.unit && d.id !== c.unit) continue;
            if (c.army && (d.worker || !d.attack || d.tags & TAG.ship)) continue;
            n++;
          }
        }
        return this.cmp(n, c.op, c.n);
      }
      case 'buildings': {
        const bs = sim.buildings;
        let n = 0;
        for (let b = 0; b < bs.high; b++) {
          if (!bs.alive[b] || bs.owner[b] !== c.player) continue;
          if (c.building && BUILDING_DEFS[bs.btype[b]].id !== c.building) continue;
          if (c.complete !== false && !bs.complete[b]) continue;
          n++;
        }
        return this.cmp(n, c.op, c.n);
      }
      case 'gathered': {
        const g = sim.players[c.player].gathered;
        return c.res.every((v, k) => g[k] >= v);
      }
      case 'kills':
        return sim.players[c.player].stats.kills >= c.n;
      case 'lost':
        return this.cmp(sim.players[c.player].stats.lost, c.op, c.n);
      case 'trained':
        return (this.trained[c.player].get(UNIT_INDEX[c.unit]) ?? 0) >= c.n;
      case 'age':
        return sim.players[c.player].age >= c.age;
      case 'skill': {
        const m = this.skills[c.player];
        if (c.hero) return (m.get(c.hero) ?? 0) > 0;
        for (const v of m.values()) if (v > 0) return true;
        return false;
      }
      case 'converted':
        return this.converted[c.player] >= c.n;
      case 'var':
        return this.cmp(this.vars.get(c.name) ?? 0, c.op, c.n);
      case 'fired':
        return this.fired.has(c.id);
      case 'dead':
        return this.tags.has(c.tag) && this.tagged(c.tag).length === 0;
    }
  }

  private run(a: Act): void {
    const sim = this.sim;
    const w = sim.world;
    switch (a.t) {
      case 'dialog':
        sim.events.push({ t: 'dialog', lines: a.lines });
        break;
      case 'spawn': {
        const ids = this.spawn(a.player, a.unit, a.at, a.n ?? 1, a.tag);
        if (a.attack && ids.length) {
          const [x, y] = this.fx(a.attack);
          sim.orderAttackMove(a.player, ids, x, y);
        }
        break;
      }
      case 'building':
        this.place({ player: a.player, building: a.building, at: a.at, tag: a.tag });
        break;
      case 'objective':
        this.objectives.set(a.id, a.state === 'show' ? 'active' : a.state);
        sim.events.push({ t: 'objective', id: a.id, state: a.state });
        break;
      case 'win':
        sim.declareWinner(0, 'scenario');
        break;
      case 'lose':
        sim.declareWinner(1, a.why ?? 'scenario');
        break;
      case 'camera':
        sim.events.push({ t: 'camera', x: this.tile(a.at)[0], y: this.tile(a.at)[1] });
        break;
      case 'give': {
        const pl = sim.players[a.player];
        // 可以給負數（斷糧），但不會扣到負的
        for (let k = 0; k < 4; k++) pl.res[k] = Math.max(0, pl.res[k] + a.res[k]);
        break;
      }
      case 'setVar':
        this.vars.set(a.name, a.value ?? (this.vars.get(a.name) ?? 0) + (a.add ?? 0));
        break;
      case 'hint':
        sim.events.push({ t: 'hint', text: a.text });
        break;
      case 'attack': {
        const ids: number[] = [];
        const src = a.tag ? this.tagged(a.tag).filter((id) => id >= 0) : null;
        if (src) ids.push(...src);
        else for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === a.player && w.state[id] !== S.Dead && UNIT_DEFS[w.utype[id]].attack > 0 && !UNIT_DEFS[w.utype[id]].worker) ids.push(id);
        const [x, y] = this.fx(a.to);
        if (ids.length) sim.orderAttackMove(a.player, ids, x, y);
        break;
      }
      case 'cutin':
        sim.events.push({ t: 'cutin', hero: a.hero, skill: a.skill });
        break;
      case 'beacon':
        if (a.on) this.beacons.set(a.id, this.tile(a.at));
        else this.beacons.delete(a.id);
        break;
      case 'age':
        this.setAge(a.player, a.age);
        break;
      case 'fire': {
        const [x, y] = this.fx(a.at);
        sim.abilities.areas.push({ kind: 'fire', owner: a.player, x, y, r: a.r * ONE, until: sim.tick + a.sec * 10, dps: 20 });
        break;
      }
      case 'wind':
        sim.abilities.windUntil[a.player] = sim.tick + a.sec * 10;
        break;
      case 'hold':
        for (const id of this.tagged(a.tag)) if (id >= 0) w.stance[id] = 2;
        break;
      case 'chase': {
        const tg = this.tagged(a.target).filter((id) => id >= 0);
        const ids = this.tagged(a.tag).filter((id) => id >= 0 && w.owner[id] === a.player);
        if (!tg.length || !ids.length) break;
        let sx = 0;
        let sy = 0;
        for (const id of tg) {
          sx += w.x[id];
          sy += w.y[id];
        }
        sim.orderAttackMove(a.player, ids, Math.trunc(sx / tg.length), Math.trunc(sy / tg.length));
        break;
      }
    }
  }

  /** 看這一 tick 新增的事件：武將技、勸降、訓練 */
  private scanEvents(): void {
    const sim = this.sim;
    const ev = sim.events;
    // 事件列表被畫面層清空過 → 全部都是新的
    if (ev.length < this.evSeen || (this.evSeen > 0 && ev[this.evSeen - 1] !== this.lastEv)) this.evSeen = 0;
    for (let i = this.evSeen; i < ev.length; i++) {
      const e = ev[i];
      if (e.t === 'skill') this.skills[e.player].set(e.skill, (this.skills[e.player].get(e.skill) ?? 0) + 1);
      else if (e.t === 'converted') this.converted[e.to]++;
      else if (e.t === 'trained') {
        const ut = sim.world.utype[e.id];
        this.trained[e.player].set(ut, (this.trained[e.player].get(ut) ?? 0) + 1);
      } else if (e.t === 'died') this.untag(e.id);
      else if (e.t === 'bDestroyed') this.untag(-2 - e.id);
    }
    this.markSeen();
  }

  private markSeen(): void {
    const ev = this.sim.events;
    this.evSeen = ev.length;
    this.lastEv = ev.length ? ev[ev.length - 1] : null;
  }

  /** 單位、建築死掉就從標籤移除（id 之後可能被新單位重複使用） */
  private untag(id: number): void {
    for (const list of this.tags.values()) {
      const k = list.indexOf(id);
      if (k >= 0) list.splice(k, 1);
    }
  }

  step(): void {
    const sim = this.sim;
    this.scanEvents();
    if (sim.winner >= 0 || sim.tick % 5 !== 0) return;
    for (const tr of this.sc.triggers) {
      if (this.fired.has(tr.id) && !tr.every) continue;
      if (tr.every && this.fired.has(tr.id) && sim.tick - (this.lastFire.get(tr.id) ?? 0) < tr.every * 10) continue;
      if (!tr.when.every((c) => this.check(c))) continue;
      this.fired.add(tr.id);
      this.lastFire.set(tr.id, sim.tick);
      for (const a of tr.then) this.run(a);
      this.markSeen();
      if (sim.winner >= 0) return;
    }
    // 保底：我方單位與建築全滅 → 失敗
    if (sim.tick % 50 === 0 && sim.tick > 50) {
      const w = sim.world;
      let alive = false;
      for (let id = 0; id < w.high && !alive; id++) if (w.alive[id] && w.owner[id] === 0 && w.state[id] !== S.Dead) alive = true;
      const bs = sim.buildings;
      for (let b = 0; b < bs.high && !alive; b++) if (bs.alive[b] && bs.owner[b] === 0) alive = true;
      if (!alive) sim.declareWinner(1, 'scenario');
    }
  }

  /** 目前時間（秒）、損失（星等用） */
  get seconds(): number {
    return Math.floor(this.sim.tick / 10);
  }
}

