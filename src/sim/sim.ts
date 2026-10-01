// 確定性模擬層入口（docs/07 §3）
// 規則：只接受指令改變世界；每 tick 固定步驟；同種子 ＋ 同指令 → 同結果
import type { Command, CommandInput } from './core/commands';
import { BUILDING_DEFS, BUILDING_INDEX, ECONOMY, RESOURCE_KINDS, RK, UNIT_DEFS, UNIT_INDEX } from './core/defs';
import { Buildings, Player, Projectiles, Resources } from './core/entities';
import { FX_SHIFT, ONE, isqrt, tileCenter, toFx } from './core/fixed';
import { Hasher } from './core/hash';
import { Rng } from './core/rng';
import { NAV, ORDER, S, TASK, World } from './core/world';
import { generateCentralPlains } from './map/generator';
import { PASS_BLOCKED, T, basePass, type MapGrid } from './map/grid';
import { CombatSystem } from './systems/combat';
import { EconomySystem } from './systems/economy';
import { MovementSystem } from './systems/movement';
import { Pathfinder, type FlowField } from './systems/pathfinding';
import { VisionSystem } from './systems/vision';

export interface SimOptions {
  seed: number;
  mapSize?: number;
  /** 測試用：直接給地圖 */
  map?: MapGrid;
  /** standard：每位玩家一座太守府 ＋ 民夫；empty：空地圖 */
  start?: 'standard' | 'empty';
}

/** 給渲染與 UI 的事件（不影響模擬狀態，不算進雜湊） */
export type SimEvent =
  | { t: 'trained'; id: number; player: number }
  | { t: 'resGone'; id: number; kind: number; tx: number; ty: number }
  | { t: 'bPlaced'; id: number }
  | { t: 'bComplete'; id: number }
  | { t: 'bRemoved'; id: number; btype: number; tx: number; ty: number; owner: number }
  | { t: 'bDestroyed'; id: number; btype: number; tx: number; ty: number; w: number; h: number }
  | { t: 'died'; id: number; player: number; utype: number };

interface FlowEntry {
  field: FlowField;
  key: number;
  refs: number;
}

/** 這個數量以上的部隊共用一張 Flow Field，以下各自跑 A* */
const FLOW_MIN_GROUP = 8;

export class Sim {
  tick = 0;
  readonly seed: number;
  readonly map: MapGrid;
  readonly world = new World();
  readonly buildings = new Buildings();
  readonly res = new Resources();
  readonly projectiles = new Projectiles();
  readonly players: Player[] = [];
  readonly rng: Rng;
  readonly pf: Pathfinder;
  /** 每格上的資源點／建築 id（-1 ＝ 沒有） */
  readonly resTile: Int32Array;
  readonly bldTile: Int32Array;
  /** 動物（不佔格的資源點） */
  private readonly animals: number[] = [];
  private readonly movement: MovementSystem;
  readonly economy: EconomySystem;
  readonly combat: CombatSystem;
  readonly vision: VisionSystem;
  private readonly flows = new Map<number, FlowEntry>();
  private readonly flowByKey = new Map<number, number>();
  private nextFlow = 1;
  private readonly groups = new Map<number, number>();
  private nextGroup = 1;
  private pending: Command[] = [];
  /** 已執行的指令（含實際 tick），重播 ＝ 種子 ＋ 這份紀錄 */
  readonly history: Command[] = [];
  /** 渲染與 UI 讀完要自己清空 */
  readonly events: SimEvent[] = [];
  /** 最近一次建立的 Flow Field（DEV 疊加層顯示用） */
  lastFlow: FlowField | null = null;
  readonly stats = { flowBuilds: 0, paths: 0 };

  constructor(opts: SimOptions) {
    this.seed = opts.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.map = opts.map ?? generateCentralPlains(this.seed, opts.mapSize ?? 128);
    this.pf = new Pathfinder(this.map);
    this.resTile = new Int32Array(this.map.w * this.map.h).fill(-1);
    this.bldTile = new Int32Array(this.map.w * this.map.h).fill(-1);
    this.movement = new MovementSystem(this);
    this.economy = new EconomySystem(this);
    this.combat = new CombatSystem(this);
    const nPlayers = Math.max(2, this.map.starts.length);
    for (let p = 0; p < nPlayers; p++) this.players.push(new Player(ECONOMY.start));
    this.vision = new VisionSystem(this);
    this.createResources();
    if ((opts.start ?? (opts.map ? 'empty' : 'standard')) === 'standard') this.standardStart();
  }

  /** 森林格 → 樹；地圖產生器的資源點 → 野果、金、石、動物 */
  private createResources(): void {
    const m = this.map;
    for (let i = 0; i < m.w * m.h; i++) if (m.tiles[i] === T.Forest) this.addResource(RK.tree, i % m.w, Math.floor(i / m.w));
    for (const s of m.resourceSpots) this.addResource(s.kind, s.tx, s.ty);
  }

  private addResource(kind: number, tx: number, ty: number): number {
    const r = this.res.add(kind, tx, ty);
    if (RESOURCE_KINDS[kind].blocks) {
      const i = this.map.idx(tx, ty);
      this.resTile[i] = r;
      this.refreshPass(i);
    } else {
      this.animals.push(r);
    }
    return r;
  }

  private standardStart(): void {
    const th = BUILDING_INDEX.town_hall;
    this.map.starts.forEach((s, p) => {
      const b = this.placeBuilding(th, p, s.x - 2, s.y - 2, true);
      for (let k = 0; k < ECONOMY.startVillagers; k++) this.spawnFromBuilding(b, UNIT_INDEX.villager);
      this.spawnFromBuilding(b, UNIT_INDEX.scout);
    });
    this.economy.step();
    this.vision.step();
  }

  /** 排程指令：預設在下一次 step 執行 */
  issue(input: CommandInput, delay = 0): Command {
    const cmd = { ...input, tick: this.tick + delay } as Command;
    this.pending.push(cmd);
    return cmd;
  }

  step(): void {
    if (this.pending.length) {
      const due: Command[] = [];
      const later: Command[] = [];
      for (const c of this.pending) (c.tick <= this.tick ? due : later).push(c);
      this.pending = later;
      for (const c of due) {
        c.tick = this.tick;
        this.history.push(c);
        this.apply(c);
      }
    }
    this.economy.step();
    this.combat.step();
    this.movement.step();
    this.vision.step();
    this.tick++;
  }

  /** 某點的地面高度（高度單位：1 格 = 64），高低差修正用 */
  heightAt(x: number, y: number): number {
    const m = this.map;
    const tx = Math.max(0, Math.min(m.w, (x + (ONE >> 1)) >> FX_SHIFT));
    const ty = Math.max(0, Math.min(m.h, (y + (ONE >> 1)) >> FX_SHIFT));
    return m.heights[ty * (m.w + 1) + tx];
  }

  /** 世界狀態雜湊（確定性測試、未來多人不同步偵測） */
  hash(): number {
    const w = this.world;
    const h = new Hasher().add(this.tick).add(w.high).add(w.count);
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id]) continue;
      h.add(id).add(w.owner[id]).add(w.utype[id]).add(w.state[id]).add(w.x[id]).add(w.y[id]).add(w.hp[id]).add(w.task[id]).add(w.carry[id]);
    }
    const bs = this.buildings;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b]) continue;
      h.add(b).add(bs.owner[b]).add(bs.btype[b]).add(bs.hp[b]).add(bs.progress[b]).add(bs.queue[b].length).add(bs.food[b]);
    }
    const rs = this.res;
    for (let r = 0; r < rs.high; r++) if (rs.alive[r]) h.add(r).add(rs.amount[r]);
    for (const p of this.players) h.addArray(p.res).add(p.pop).add(p.popCap);
    h.add(this.projectiles.count);
    h.addArray(this.rng.getState());
    return h.value();
  }

  // ───────── 指令 ─────────

  private apply(c: Command): void {
    switch (c.t) {
      case 'spawn':
        this.cmdSpawn(c.player, c.unit, c.x, c.y, c.count);
        break;
      case 'move':
      case 'attackMove':
      case 'patrol':
        for (const id of this.ownedIds(c.player, c.ids)) {
          this.economy.clearTask(id);
          this.combat.clearTarget(id);
          // 巡邏的另一端 ＝ 出發點
          this.world.homeX[id] = this.world.x[id];
          this.world.homeY[id] = this.world.y[id];
        }
        this.cmdMove(c.player, c.ids, c.x, c.y, c.t === 'move' ? ORDER.Move : c.t === 'patrol' ? ORDER.Patrol : ORDER.AttackMove, 'spread' in c && !!c.spread);
        break;
      case 'stop':
        for (const id of this.ownedIds(c.player, c.ids)) {
          this.economy.clearTask(id);
          this.combat.clearTarget(id);
          this.world.order[id] = ORDER.None;
          this.arrive(id);
        }
        break;
      case 'attack':
      case 'stance':
        this.combat.apply(c);
        break;
      case 'buildLine':
        this.cmdBuildLine(c.player, c.ids, c.btype, c.x0, c.y0, c.x1, c.y1);
        break;
      case 'clear':
        for (let id = 0; id < this.world.high; id++) if (this.world.alive[id]) this.releaseNav(id);
        this.world.clear();
        this.groups.clear();
        break;
      default:
        // 派去工作的單位不再打仗
        if ('ids' in c) {
          for (const id of this.ownedIds(c.player, c.ids)) {
            this.combat.clearTarget(id);
            this.world.order[id] = ORDER.None;
          }
        }
        this.economy.apply(c);
    }
  }

  /** 牆：沿直線（4 連通，不留斜角縫）放一排地基，付得起幾格就放幾格 */
  private cmdBuildLine(player: number, ids: number[], btype: number, x0: number, y0: number, x1: number, y1: number): void {
    const def = BUILDING_DEFS[btype];
    const pl = this.players[player];
    if (!def || !def.wall || !pl || def.age > pl.age) return;
    const workers = this.ownedIds(player, ids).filter((id) => UNIT_DEFS[this.world.utype[id]].worker);
    if (!workers.length) return;
    const tiles: [number, number][] = [];
    let x = x0;
    let y = y0;
    tiles.push([x, y]);
    for (let k = 0; k < 64 && (x !== x1 || y !== y1); k++) {
      const dx = x1 - x;
      const dy = y1 - y;
      if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx);
      else y += Math.sign(dy);
      tiles.push([x, y]);
    }
    let first = -1;
    for (const [tx, ty] of tiles) {
      if (!pl.canAfford(def.cost) || !this.canPlace(btype, tx, ty)) continue;
      pl.pay(def.cost);
      const b = this.placeBuilding(btype, player, tx, ty, false);
      if (first < 0) first = b;
    }
    if (first < 0) return;
    for (const id of workers) {
      this.combat.clearTarget(id);
      this.world.order[id] = ORDER.None;
      this.economy.setTask(id, TASK.Build, first);
    }
  }

  ownedIds(player: number, ids: number[]): number[] {
    const w = this.world;
    const out = ids.filter((id) => id >= 0 && id < w.high && w.alive[id] && w.owner[id] === player && w.state[id] !== S.Dead);
    out.sort((a, b) => a - b);
    return out.filter((id, i) => i === 0 || out[i - 1] !== id);
  }

  /** 在 (x,y) 附近以 0.7 格間距由內往外排開 */
  private cmdSpawn(player: number, unit: number, x: number, y: number, count: number): void {
    if (unit < 0 || unit >= UNIT_DEFS.length || player < 0 || player >= this.players.length) return;
    const [ctx, cty] = this.pf.nearestWalkable(x >> FX_SHIFT, y >> FX_SHIFT);
    const cx = tileCenter(ctx);
    const cy = tileCenter(cty);
    const sp = toFx(0.7);
    let placed = 0;
    for (let r = 0; placed < count && r < 80; r++) {
      for (let j = -r; j <= r && placed < count; j++) {
        for (let i = -r; i <= r && placed < count; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const px = cx + i * sp;
          const py = cy + j * sp;
          if (px < 0 || py < 0 || px >= this.map.widthFx || py >= this.map.heightFx || !this.map.walkableFx(px, py)) continue;
          this.world.spawn(unit, player, px, py, this.tick);
          placed++;
        }
      }
    }
  }

  private cmdMove(player: number, rawIds: number[], x: number, y: number, order: number, spread: boolean): void {
    const w = this.world;
    const ids = this.ownedIds(player, rawIds);
    if (!ids.length) return;
    x = Math.max(0, Math.min(this.map.widthFx - 1, x));
    y = Math.max(0, Math.min(this.map.heightFx - 1, y));
    const exact = this.map.walkableFx(x, y);
    const [gtx, gty] = this.pf.nearestWalkable(x >> FX_SHIFT, y >> FX_SHIFT);
    const gx = exact ? x : tileCenter(gtx);
    const gy = exact ? y : tileCenter(gty);
    const group = this.nextGroup++;
    this.groups.set(group, ids.length);
    const slots = this.formationSlots(ids, gx, gy, spread);
    const flowId = ids.length >= FLOW_MIN_GROUP ? this.acquireFlow(gtx, gty) : -1;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      this.releaseNav(id);
      const sx = slots[k * 2];
      const sy = slots[k * 2 + 1];
      w.goalX[id] = sx;
      w.goalY[id] = sy;
      w.destX[id] = sx;
      w.destY[id] = sy;
      w.order[id] = order;
      w.group[id] = group;
      w.stuck[id] = 0;
      this.setState(id, S.Move);
      const dx = sx - w.x[id];
      const dy = sy - w.y[id];
      if (dx * dx + dy * dy < 16 * ONE * ONE && this.pf.los(w.x[id], w.y[id], sx, sy)) {
        w.nav[id] = NAV.Direct;
      } else if (flowId >= 0) {
        w.nav[id] = NAV.Flow;
        w.flow[id] = flowId;
        this.flows.get(flowId)!.refs++;
      } else {
        this.setPath(id, this.pf.findPath(w.x[id], w.y[id], sx, sy));
      }
    }
    if (flowId >= 0 && this.flows.get(flowId)!.refs === 0) this.dropFlow(flowId);
  }

  /**
   * 陣型站位：以移動方向為前方排成方陣
   * 離目標最近的單位排前排，同一排依左右位置排序，減少交叉
   */
  private formationSlots(ids: number[], gx: number, gy: number, spread = false): Int32Array {
    const w = this.world;
    const n = ids.length;
    const out = new Int32Array(n * 2);
    if (n === 1) {
      out[0] = gx;
      out[1] = gy;
      return out;
    }
    let sx = 0;
    let sy = 0;
    let maxR = 0;
    for (const id of ids) {
      sx += w.x[id];
      sy += w.y[id];
      maxR = Math.max(maxR, w.radius[id]);
    }
    const cx = Math.trunc(sx / n);
    const cy = Math.trunc(sy / n);
    let fx = gx - cx;
    let fy = gy - cy;
    const len = isqrt(fx * fx + fy * fy);
    if (len < ONE >> 2) {
      fx = 0;
      fy = ONE;
    } else {
      fx = Math.trunc((fx * ONE) / len);
      fy = Math.trunc((fy * ONE) / len);
    }
    const lx = -fy;
    const ly = fx;
    // 散開陣型：間距加倍（防範圍傷害，docs/03 §4）
    const spacing = (maxR * 2 + (ONE >> 3)) * (spread ? 2 : 1);
    const cols = isqrt(n - 1) + 1;
    const rows = Math.ceil(n / cols);
    const order = ids.map((id, k) => ({
      k,
      p: (w.x[id] - cx) * fx + (w.y[id] - cy) * fy,
      q: (w.x[id] - cx) * lx + (w.y[id] - cy) * ly,
      id,
    }));
    order.sort((a, b) => b.p - a.p || a.id - b.id);
    for (let r = 0; r < rows; r++) {
      const row = order.slice(r * cols, (r + 1) * cols);
      row.sort((a, b) => a.q - b.q || a.id - b.id);
      const rowOff = Math.trunc((((rows - 1) - 2 * r) * spacing) / 2);
      for (let c = 0; c < row.length; c++) {
        const colOff = Math.trunc(((2 * c - (row.length - 1)) * spacing) / 2);
        let px = gx + Math.trunc((lx * colOff + fx * rowOff) / ONE);
        let py = gy + Math.trunc((ly * colOff + fy * rowOff) / ONE);
        px = Math.max(0, Math.min(this.map.widthFx - 1, px));
        py = Math.max(0, Math.min(this.map.heightFx - 1, py));
        if (!this.map.walkableFx(px, py)) {
          const [tx, ty] = this.pf.nearestWalkable(px >> FX_SHIFT, py >> FX_SHIFT);
          px = tileCenter(tx);
          py = tileCenter(ty);
        }
        out[row[c].k * 2] = px;
        out[row[c].k * 2 + 1] = py;
      }
    }
    return out;
  }

  // ───────── 單位導航（經濟系統也會呼叫） ─────────

  private setState(id: number, st: number): void {
    const w = this.world;
    if (w.state[id] !== st) {
      w.state[id] = st;
      w.stateTick[id] = this.tick;
    }
  }

  /** 單一單位走到 (x,y)，保留工作任務 */
  moveUnit(id: number, x: number, y: number): void {
    const w = this.world;
    this.releaseNav(id);
    x = Math.max(0, Math.min(this.map.widthFx - 1, x));
    y = Math.max(0, Math.min(this.map.heightFx - 1, y));
    w.goalX[id] = x;
    w.goalY[id] = y;
    // 每個單位自己一組，不會被別人「碰到就停」
    w.group[id] = -1 - id;
    w.stuck[id] = 0;
    this.setState(id, S.Move);
    const dx = x - w.x[id];
    const dy = y - w.y[id];
    if (dx * dx + dy * dy < 16 * ONE * ONE && this.pf.los(w.x[id], w.y[id], x, y)) w.nav[id] = NAV.Direct;
    else this.setPath(id, this.pf.findPath(w.x[id], w.y[id], x, y));
  }

  stopMoving(id: number): void {
    this.releaseNav(id);
    if (this.world.state[id] === S.Move) this.setState(id, S.Idle);
  }

  setPath(id: number, path: Int32Array): void {
    const w = this.world;
    this.releaseFlow(id);
    this.stats.paths++;
    w.paths[id] = path;
    w.pathIdx[id] = 0;
    w.nav[id] = NAV.Path;
    // 走不到原目標時，目標改成路徑終點
    w.goalX[id] = path[path.length - 2];
    w.goalY[id] = path[path.length - 1];
  }

  arrive(id: number): void {
    const w = this.world;
    this.releaseNav(id);
    if (w.state[id] !== S.Idle && w.state[id] !== S.Work) this.setState(id, S.Idle);
    w.stuck[id] = 0;
  }

  private releaseNav(id: number): void {
    const w = this.world;
    this.releaseFlow(id);
    w.paths[id] = null;
    w.nav[id] = NAV.None;
  }

  releaseFlow(id: number): void {
    const w = this.world;
    const f = w.flow[id];
    if (f < 0) return;
    w.flow[id] = -1;
    const e = this.flows.get(f);
    if (e && --e.refs <= 0) this.dropFlow(f);
  }

  flowFieldOf(flowId: number): FlowField {
    return this.flows.get(flowId)!.field;
  }

  groupSize(group: number): number {
    return this.groups.get(group) ?? 1;
  }

  private acquireFlow(gtx: number, gty: number): number {
    const key = (this.map.passVersion * this.map.h + gty) * this.map.w + gtx;
    const existing = this.flowByKey.get(key);
    if (existing !== undefined) return existing;
    const field = this.pf.flowField(gtx, gty);
    this.stats.flowBuilds++;
    this.lastFlow = field;
    const id = this.nextFlow++;
    this.flows.set(id, { field, key, refs: 0 });
    this.flowByKey.set(key, id);
    return id;
  }

  private dropFlow(flowId: number): void {
    const e = this.flows.get(flowId);
    if (!e) return;
    this.flows.delete(flowId);
    this.flowByKey.delete(e.key);
  }

  get activeFlows(): number {
    return this.flows.size;
  }

  // ───────── 地圖佔用 ─────────

  /** 依地形、建築、資源重算一格的通行性 */
  refreshPass(i: number): void {
    let p = basePass(this.map.tiles[i]);
    const b = this.bldTile[i];
    if (b >= 0 && !BUILDING_DEFS[this.buildings.btype[b]].walkable) p = PASS_BLOCKED;
    if (this.resTile[i] >= 0) p = PASS_BLOCKED;
    this.map.pass[i] = p;
  }

  /** 能不能在 (tx,ty) 放這種建築（左上角） */
  canPlace(btype: number, tx: number, ty: number): boolean {
    const def = BUILDING_DEFS[btype];
    if (!def) return false;
    const m = this.map;
    for (let y = ty; y < ty + def.h; y++) {
      for (let x = tx; x < tx + def.w; x++) {
        if (!m.inBounds(x, y)) return false;
        const i = m.idx(x, y);
        const t = m.tiles[i];
        if (t !== T.Grass && t !== T.Dirt && t !== T.Sand) return false;
        if (this.resTile[i] >= 0 || this.bldTile[i] >= 0) return false;
      }
    }
    return true;
  }

  placeBuilding(btype: number, owner: number, tx: number, ty: number, complete: boolean): number {
    const def = BUILDING_DEFS[btype];
    const b = this.buildings.add(btype, owner, tx, ty, complete, this.tick);
    const m = this.map;
    for (let y = ty; y < ty + def.h; y++) {
      for (let x = tx; x < tx + def.w; x++) {
        const i = m.idx(x, y);
        this.bldTile[i] = b;
        this.refreshPass(i);
      }
    }
    if (!def.walkable) {
      m.passVersion++;
      // 站在地基上的單位推到旁邊
      const w = this.world;
      for (let id = 0; id < w.high; id++) {
        if (!w.alive[id] || m.walkableFx(w.x[id], w.y[id])) continue;
        const [nx, ny] = this.pf.nearestWalkable(w.x[id] >> FX_SHIFT, w.y[id] >> FX_SHIFT);
        w.x[id] = w.px[id] = tileCenter(nx);
        w.y[id] = w.py[id] = tileCenter(ny);
      }
    }
    this.events.push({ t: 'bPlaced', id: b });
    if (complete) this.events.push({ t: 'bComplete', id: b });
    return b;
  }

  completeBuilding(b: number): void {
    const bs = this.buildings;
    bs.complete[b] = 1;
    this.events.push({ t: 'bComplete', id: b });
    const w = this.world;
    for (let id = 0; id < w.high; id++) {
      if (w.alive[id] && w.task[id] === TASK.Build && w.target[id] === b) this.economy.afterBuilt(id, b);
    }
  }

  removeBuilding(b: number): void {
    const bs = this.buildings;
    if (!bs.alive[b]) return;
    const def = BUILDING_DEFS[bs.btype[b]];
    const m = this.map;
    const tx = bs.tx[b];
    const ty = bs.ty[b];
    for (let y = ty; y < ty + def.h; y++) {
      for (let x = tx; x < tx + def.w; x++) {
        const i = m.idx(x, y);
        if (this.bldTile[i] === b) this.bldTile[i] = -1;
        this.refreshPass(i);
      }
    }
    if (!def.walkable) m.passVersion++;
    this.events.push({ t: 'bRemoved', id: b, btype: bs.btype[b], tx, ty, owner: bs.owner[b] });
    bs.farmer[b] = -1;
    bs.remove(b);
  }

  /** 農田耗盡：自動重播（付木材），付不起就消失 */
  exhaustFarm(b: number): void {
    const bs = this.buildings;
    const pl = this.players[bs.owner[b]];
    const wood = ECONOMY.farmReseedWood;
    if (pl.autoReseed && pl.res[1] >= wood) {
      pl.res[1] -= wood;
      bs.food[b] = BUILDING_DEFS[bs.btype[b]].food;
    } else {
      this.removeBuilding(b);
    }
  }

  depleteResource(r: number): void {
    const rs = this.res;
    if (!rs.alive[r]) return;
    const kind = rs.kind[r];
    const tx = rs.tx[r];
    const ty = rs.ty[r];
    if (RESOURCE_KINDS[kind].blocks) {
      const i = this.map.idx(tx, ty);
      if (this.resTile[i] === r) this.resTile[i] = -1;
      if (this.map.tiles[i] === T.Forest) this.map.tiles[i] = T.Grass;
      this.refreshPass(i);
      this.map.passVersion++;
    } else {
      const k = this.animals.indexOf(r);
      if (k >= 0) this.animals.splice(k, 1);
    }
    rs.remove(r);
    this.events.push({ t: 'resGone', id: r, kind, tx, ty });
  }

  /** 找最近的存放點（收這種資源、已完工、自己的） */
  nearestDrop(player: number, resType: number, x: number, y: number, exclude = -1): number {
    const bs = this.buildings;
    let best = -1;
    let bestD = Infinity;
    for (let b = 0; b < bs.high; b++) {
      if (b === exclude || !bs.alive[b] || !bs.complete[b] || bs.owner[b] !== player) continue;
      if (!BUILDING_DEFS[bs.btype[b]].drop[resType]) continue;
      const dx = bs.centerX(b) - x;
      const dy = bs.centerY(b) - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** 以 (cx,cy) 為中心找指定種類的資源，回傳離單位 (ux,uy) 最近的；樹要「露在外面」才算 */
  findResource(kinds: number[], cx: number, cy: number, radius: number, ux: number, uy: number, exclude = -1): number {
    const m = this.map;
    const rs = this.res;
    const ctx = cx >> FX_SHIFT;
    const cty = cy >> FX_SHIFT;
    let best = -1;
    let bestD = Infinity;
    const consider = (r: number) => {
      const dx = rs.x[r] - ux;
      const dy = rs.y[r] - uy;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && r < best)) {
        bestD = d;
        best = r;
      }
    };
    for (let rr = 0; rr <= radius && best < 0; rr++) {
      for (let y = cty - rr; y <= cty + rr; y++) {
        for (let x = ctx - rr; x <= ctx + rr; x++) {
          if (Math.max(Math.abs(x - ctx), Math.abs(y - cty)) !== rr || !m.inBounds(x, y)) continue;
          const r = this.resTile[m.idx(x, y)];
          if (r < 0 || r === exclude || !kinds.includes(rs.kind[r])) continue;
          if (!m.walkable(x + 1, y) && !m.walkable(x - 1, y) && !m.walkable(x, y + 1) && !m.walkable(x, y - 1)) continue;
          consider(r);
        }
      }
    }
    const lim = radius * ONE;
    for (const r of this.animals) {
      if (r === exclude || !rs.alive[r] || !kinds.includes(rs.kind[r])) continue;
      const dx = rs.x[r] - cx;
      const dy = rs.y[r] - cy;
      if (dx * dx + dy * dy <= lim * lim) consider(r);
    }
    return best;
  }

  /** 從建築旁生出單位，並依集結點派工 */
  spawnFromBuilding(b: number, utype: number): number {
    const bs = this.buildings;
    const def = BUILDING_DEFS[bs.btype[b]];
    const m = this.map;
    const tx = bs.tx[b];
    const ty = bs.ty[b];
    // 目標：集結點，沒有就朝地圖中心
    const gx = bs.rallyX[b] >= 0 ? bs.rallyX[b] : m.widthFx >> 1;
    const gy = bs.rallyY[b] >= 0 ? bs.rallyY[b] : m.heightFx >> 1;
    let best = -1;
    let bestD = Infinity;
    for (let y = ty - 1; y <= ty + def.h; y++) {
      for (let x = tx - 1; x <= tx + def.w; x++) {
        if (x >= tx && x < tx + def.w && y >= ty && y < ty + def.h) continue;
        if (!m.walkable(x, y)) continue;
        const dx = tileCenter(x) - gx;
        const dy = tileCenter(y) - gy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = m.idx(x, y);
        }
      }
    }
    let sx: number;
    let sy: number;
    if (best >= 0) {
      sx = tileCenter(best % m.w);
      sy = tileCenter(Math.floor(best / m.w));
    } else {
      const [nx, ny] = this.pf.nearestWalkable(tx + (def.w >> 1), ty + def.h);
      sx = tileCenter(nx);
      sy = tileCenter(ny);
    }
    const owner = bs.owner[b];
    const id = this.world.spawn(utype, owner, sx, sy, this.tick);
    const w = this.world;
    w.fx[id] = gx - sx;
    w.fy[id] = gy - sy;
    const rr = bs.rallyRes[b];
    if (rr >= 0 && this.res.alive[rr] && UNIT_DEFS[utype].worker) {
      this.economy.setTask(id, TASK.Gather, rr);
      w.lastKind[id] = this.res.kind[rr];
      w.lastX[id] = this.res.x[rr];
      w.lastY[id] = this.res.y[rr];
    } else if (bs.rallyX[b] >= 0) {
      this.moveUnit(id, bs.rallyX[b], bs.rallyY[b]);
    }
    return id;
  }
}
