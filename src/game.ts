// 遊戲主體：串起模擬層、渲染、輸入、HUD；固定 tick 模擬 ＋ 每幀內插渲染（docs/07 §3）
import * as THREE from 'three';
import { EconomyBot } from './ai/economyBot';
import { CAMERA, type Quality } from './config';
import { Controls } from './input/controls';
import { RtsCamera } from './input/camera';
import { BuildingRenderer } from './render/buildings';
import { FogRenderer } from './render/fog';
import { ProjectileRenderer } from './render/projectiles';
import { Markers } from './render/markers';
import { ResourceRenderer } from './render/resources';
import { Stage } from './render/stage';
import { Terrain } from './render/terrain';
import { Trees } from './render/trees';
import { UnitRenderer } from './render/units';
import { BUILDING_DEFS, RESOURCE_KINDS, RK, UNIT_DEFS, UNIT_INDEX } from './sim/core/defs';
import { ONE, TICK_MS } from './sim/core/fixed';
import { S, TK } from './sim/core/world';
import { Sim } from './sim/sim';
import { Hud } from './ui/hud';
import { detectLayout, type LayoutMode } from './ui/layout';

export interface GameOptions {
  seed: number;
  quality: Quality;
  layout?: LayoutMode;
}

export interface Placing {
  btype: number;
  tx: number;
  ty: number;
  valid: boolean;
  /** 牆：第一下點的起點 */
  lineStart?: [number, number];
}

export class Game {
  readonly sim: Sim;
  readonly stage: Stage;
  readonly terrain: Terrain;
  readonly trees: Trees;
  readonly units: UnitRenderer;
  readonly buildingsR: BuildingRenderer;
  readonly resourcesR: ResourceRenderer;
  readonly markers: Markers;
  readonly fog: FogRenderer;
  readonly projectilesR: ProjectileRenderer;
  readonly cam: RtsCamera;
  readonly hud: Hud;
  readonly controls: Controls;
  readonly myPlayer = 0;
  /** 選取：單位（可多選）、或一棟建築、或一個資源點 */
  readonly selected = new Set<number>();
  selBuilding = -1;
  selResource = -1;
  placing: Placing | null = null;
  rallyMode = false;
  /** 攻擊移動模式：下一次點地面是攻擊移動 */
  attackMoveMode = false;
  /** 巡邏模式：下一次點地面是巡邏終點 */
  patrolMode = false;
  /** 陣型：散開 */
  spread = false;
  layoutMode: LayoutMode;
  /** DEV 手動指定版面後，不再隨視窗自動切換 */
  layoutLocked = false;
  speed = 1;
  paused = false;
  /** 電腦玩家（M1：敵方先只有經濟機器人） */
  readonly bots: EconomyBot[] = [];
  /** 動畫時間（秒，跟著遊戲速度與暫停） */
  time = 0;
  readonly stats = { fps: 0, frameMs: 0, simMs: 0, ticks: 0 };
  /** 每幀結束時呼叫（DEV 工具掛這裡） */
  readonly onFrame: ((dt: number) => void)[] = [];
  private acc = 0;
  private last = 0;
  private afterStep: (() => void)[] = [];
  private groups = new Map<number, number[]>();
  private idleCursor = 0;
  private wasHoused = false;
  private lastAlert = -1e9;
  private statAcc = { frames: 0, time: 0, simMs: 0, frameMs: 0, ticks: 0 };
  private readonly v = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();

  constructor(container: HTMLElement, opts: GameOptions) {
    this.layoutMode = opts.layout ?? detectLayout();
    this.sim = new Sim({ seed: opts.seed, mapSize: 128 });
    this.stage = new Stage(container, opts.quality);
    this.terrain = new Terrain(this.sim.map);
    this.trees = new Trees(this.sim.map, this.terrain);
    this.units = new UnitRenderer(this.terrain);
    this.buildingsR = new BuildingRenderer(this.terrain);
    this.resourcesR = new ResourceRenderer(this.sim, this.terrain);
    this.markers = new Markers();
    this.fog = new FogRenderer(this.sim.map.w, this.sim.map.h);
    this.projectilesR = new ProjectileRenderer(this.terrain);
    this.stage.scene.add(this.terrain.group, this.trees.group, this.resourcesR.group, this.buildingsR.group, this.units.group, this.markers.group, this.projectilesR.mesh);
    this.applyShadowMode();
    const startDist = this.layoutMode === 'mobile' ? CAMERA.startDistMobile : CAMERA.startDistPc;
    this.cam = new RtsCamera(this.stage.camera, this.terrain, this.sim.map.w, this.sim.map.h, startDist);
    this.controls = new Controls(this, this.stage.renderer.domElement);
    this.hud = new Hud(container, this);
    this.bots.push(new EconomyBot(this.sim, 1));
    this.goHome();
    window.addEventListener('resize', () => {
      const next = detectLayout();
      if (next !== this.layoutMode && !this.layoutLocked) this.setLayout(next);
    });
  }

  start(): void {
    this.last = performance.now();
    this.stage.renderer.setAnimationLoop((now) => this.frame(now));
  }

  setLayout(mode: LayoutMode): void {
    this.layoutMode = mode;
    this.hud.applyLayout();
  }

  setQuality(q: Quality): void {
    this.stage.applyQuality(q);
    this.applyShadowMode();
  }

  /** 高畫質：兵種投射真陰影；中低畫質：兵種改用圓形假陰影（省一半頂點），樹木照常投影 */
  private applyShadowMode(): void {
    const real = this.stage.quality === 'high' && this.stage.renderer.shadowMap.enabled;
    this.units.setShadows(real);
    this.markers.blobShadows = !real;
  }

  /** 目前畫面看到的地面範圍（外擴 margin），算不出來時回傳 null */
  viewBounds(margin = 3): [number, number, number, number] | null {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const [sx, sy] of [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]) {
      const p = this.cam.groundAt(sx, sy, this.v);
      if (!p) return null;
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    return [x0 - margin, z0 - margin, x1 + margin, z1 + margin];
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    let simMs = 0;
    let ticks = 0;
    if (!this.paused) {
      this.acc += dt * 1000 * this.speed;
      while (this.acc >= TICK_MS && ticks < 16) {
        const s0 = performance.now();
        for (const b of this.bots) b.tick();
        this.sim.step();
        simMs += performance.now() - s0;
        this.acc -= TICK_MS;
        ticks++;
        const fns = this.afterStep;
        this.afterStep = [];
        for (const f of fns) f();
      }
      if (ticks === 16) this.acc = 0;
      this.time += dt * this.speed;
    }
    this.processEvents();
    const alpha = this.paused ? 1 : Math.min(1, this.acc / TICK_MS);

    this.controls.update();
    this.cam.update(dt);
    this.stage.followTarget(this.cam.target, this.cam.dist);
    this.fog.update(this.sim.vision, this.myPlayer);
    const vis = this.isVisible;
    const exp = this.isExplored;
    this.units.update(this.sim, alpha, this.time, dt * this.speed, this.viewBounds(), this.myPlayer, vis);
    const w = this.sim.world;
    for (const id of this.selected) if (!w.alive[id] || w.state[id] === S.Dead || !this.units.seen[id]) this.selected.delete(id);
    if (this.selBuilding >= 0 && !this.sim.buildings.alive[this.selBuilding]) this.selBuilding = -1;
    if (this.selResource >= 0 && !this.sim.res.alive[this.selResource]) this.selResource = -1;
    this.markers.update(this.units, this.selected, w, this.myPlayer, dt, {
      sim: this.sim,
      camera: this.stage.camera,
      selBuilding: this.selBuilding,
      buildingHeight: (bt) => this.buildingsR.heightOf(bt),
      explored: exp,
    });
    this.buildingsR.update(this.sim, this.selBuilding, this.myPlayer, exp);
    this.projectilesR.update(this.sim, alpha, vis);
    this.resourcesR.update(dt);
    if (this.placing) {
      const pl = this.placing;
      this.buildingsR.setGhost(pl.btype, pl.tx, pl.ty, pl.valid);
      this.buildingsR.setLineGhost(pl.lineStart ? this.lineTiles(pl.lineStart[0], pl.lineStart[1], pl.tx, pl.ty).map(([x, y]) => [x, y, this.sim.canPlace(pl.btype, x, y)]) : []);
    } else {
      this.buildingsR.setGhost(-1, 0, 0, false);
      this.buildingsR.setLineGhost([]);
    }
    this.hud.update(dt);
    this.stage.render();
    for (const f of this.onFrame) f(dt);

    const st = this.statAcc;
    st.frames++;
    st.time += dt;
    st.simMs += simMs;
    st.ticks += ticks;
    st.frameMs += performance.now() - t0;
    if (st.time >= 0.5) {
      this.stats.fps = Math.round(st.frames / st.time);
      this.stats.frameMs = +(st.frameMs / st.frames).toFixed(2);
      this.stats.simMs = st.ticks ? +(st.simMs / st.ticks).toFixed(2) : 0;
      this.stats.ticks = Math.round(st.ticks / st.time);
      Object.assign(st, { frames: 0, time: 0, simMs: 0, frameMs: 0, ticks: 0 });
    }
  }

  /** 迷霧：該格現在看得到嗎（箭頭函式，方便直接傳給渲染層） */
  readonly isVisible = (tx: number, ty: number): boolean => this.fog.visible(this.sim.vision, this.myPlayer, tx, ty);
  readonly isExplored = (tx: number, ty: number): boolean => this.fog.explored(this.sim.vision, this.myPlayer, tx, ty);

  /** 模擬層事件 → 畫面更新、提示 */
  private processEvents(): void {
    const ev = this.sim.events;
    for (const e of ev) {
      if (e.t === 'died' && e.player === this.myPlayer) this.alert(this.sim.world.x[e.id] / ONE, this.sim.world.y[e.id] / ONE);
      if (e.t === 'bDestroyed') {
        if (this.selBuilding === e.id) this.selBuilding = -1;
        this.resourcesR.dirty();
      }
      if (e.t === 'resGone') {
        if (e.kind === RK.tree) {
          this.trees.remove(e.tx, e.ty);
          this.hud.clearMiniTile(e.tx, e.ty);
        }
        this.resourcesR.dirty();
      } else if (e.t === 'bComplete' && this.sim.buildings.owner[e.id] === this.myPlayer && this.sim.tick > 1) {
        this.hud.toast(`${BUILDING_DEFS[this.sim.buildings.btype[e.id]].name}完工`);
      }
    }
    ev.length = 0;
    const housed = this.sim.players[this.myPlayer].housed;
    if (housed && !this.wasHoused) this.hud.toast('人口已滿：請蓋民居', 2500);
    this.wasHoused = housed;
  }

  /** 我方遭到攻擊：提示 ＋ 小地圖閃紅點（10 秒內只提示一次） */
  alert(x: number, z: number): void {
    this.hud.ping(x, z);
    if (this.time - this.lastAlert < 10) return;
    this.lastAlert = this.time;
    this.hud.toast('⚠ 我軍遭到攻擊！（空白鍵跳過去）', 2500);
    this.lastAlertPos = [x, z];
  }

  lastAlertPos: [number, number] | null = null;

  jumpToAlert(): void {
    if (this.lastAlertPos) this.cam.lookAt(this.lastAlertPos[0], this.lastAlertPos[1]);
  }

  // ───────── 點選 ─────────

  /** 單位在螢幕上的位置（身體中段） */
  screenPos(id: number, rect: DOMRect): [number, number] | null {
    this.v.set(this.units.wx[id], this.units.wy[id] + 0.45, this.units.wz[id]).project(this.stage.camera);
    if (this.v.z > 1) return null;
    return [rect.left + ((this.v.x + 1) / 2) * rect.width, rect.top + ((1 - this.v.y) / 2) * rect.height];
  }

  /** 找螢幕座標附近最近的單位；沒有回傳 -1 */
  pickUnit(sx: number, sy: number, radiusPx: number): number {
    const w = this.sim.world;
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    const r = radiusPx * Math.max(0.7, Math.min(1.4, 34 / this.cam.dist));
    let best = -1;
    let bestD = r * r;
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.state[id] === S.Dead || !this.units.seen[id]) continue;
      const p = this.screenPos(id, rect);
      if (!p) continue;
      const d = (p[0] - sx) ** 2 + (p[1] - sy) ** 2;
      // 我方單位優先
      const bias = w.owner[id] === this.myPlayer ? 0.7 : 1;
      if (d * bias < bestD) {
        bestD = d * bias;
        best = id;
      }
    }
    return best;
  }

  /** 螢幕射線打到高度 h 的水平面，回傳世界座標 */
  private rayAtHeight(sx: number, sy: number, h: number): THREE.Vector3 | null {
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.stage.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    if (d.y >= -1e-4) return null;
    const t = (h - o.y) / d.y;
    return new THREE.Vector3(o.x + d.x * t, h, o.z + d.z * t);
  }

  /** 點到哪棟建築（考慮建築高度：點到屋頂也算） */
  pickBuilding(sx: number, sy: number): number {
    const sim = this.sim;
    const g = this.cam.groundAt(sx, sy);
    if (!g) return -1;
    for (const h of [1.6, 1.0, 0.5]) {
      const p = this.rayAtHeight(sx, sy, g.y + h);
      if (!p) continue;
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.z);
      if (!sim.map.inBounds(tx, ty)) continue;
      const b = sim.bldTile[sim.map.idx(tx, ty)];
      if (b >= 0 && this.buildingsR.heightOf(sim.buildings.btype[b]) >= h && (sim.buildings.owner[b] === this.myPlayer || this.isExplored(tx, ty))) return b;
    }
    const tx = Math.floor(g.x);
    const ty = Math.floor(g.z);
    if (!sim.map.inBounds(tx, ty)) return -1;
    const b = sim.bldTile[sim.map.idx(tx, ty)];
    return b >= 0 && (sim.buildings.owner[b] === this.myPlayer || this.isExplored(tx, ty)) ? b : -1;
  }

  /** 點到哪個資源點（樹、礦、野果用格子；動物用螢幕距離） */
  pickResource(sx: number, sy: number): number {
    const sim = this.sim;
    const rs = sim.res;
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    let best = -1;
    let bestD = 26 * 26;
    for (let r = 0; r < rs.high; r++) {
      if (!rs.alive[r] || RESOURCE_KINDS[rs.kind[r]].blocks) continue;
      const x = rs.x[r] / ONE;
      const z = rs.y[r] / ONE;
      this.v.set(x, this.terrain.heightAt(x, z) + 0.3, z).project(this.stage.camera);
      const px = rect.left + ((this.v.x + 1) / 2) * rect.width;
      const py = rect.top + ((1 - this.v.y) / 2) * rect.height;
      const d = (px - sx) ** 2 + (py - sy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best >= 0) return best;
    const g = this.cam.groundAt(sx, sy);
    if (!g) return -1;
    for (const h of [0.9, 0.4, 0]) {
      const p = h ? this.rayAtHeight(sx, sy, g.y + h) : g;
      if (!p) continue;
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.z);
      if (!sim.map.inBounds(tx, ty)) continue;
      const r = sim.resTile[sim.map.idx(tx, ty)];
      if (r >= 0) return r;
    }
    return -1;
  }

  private clearAll(): void {
    this.selected.clear();
    this.selBuilding = -1;
    this.selResource = -1;
    this.rallyMode = false;
    this.attackMoveMode = false;
    this.patrolMode = false;
    this.hud.card.reset();
  }

  selectAt(sx: number, sy: number, additive: boolean): void {
    if (this.placing) return;
    const id = this.pickUnit(sx, sy, 18);
    const w = this.sim.world;
    if (id >= 0) {
      if (additive && w.owner[id] === this.myPlayer) {
        this.selBuilding = -1;
        this.selResource = -1;
        for (const s of this.selected) if (w.owner[s] !== this.myPlayer) this.selected.delete(s);
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
        return;
      }
      this.clearAll();
      this.selected.add(id);
      return;
    }
    const b = this.pickBuilding(sx, sy);
    if (b >= 0) {
      this.clearAll();
      this.selBuilding = b;
      return;
    }
    const r = this.pickResource(sx, sy);
    if (r >= 0) {
      this.clearAll();
      this.selResource = r;
      return;
    }
    if (!additive) this.clearAll();
  }

  /** 觸控點一下：放置中 → 移動預覽；設集結點 → 設定；點到兵 → 選；有選我軍 → 下指令；否則選建築／資源 */
  tapAt(sx: number, sy: number): void {
    if (this.placing) {
      this.updatePlacing(sx, sy);
      return;
    }
    if (this.rallyMode) {
      this.setRallyAt(sx, sy);
      return;
    }
    if (this.attackMoveMode || this.patrolMode) {
      this.commandAt(sx, sy, false);
      return;
    }
    const id = this.pickUnit(sx, sy, 26);
    // 有選我軍時點到敵人 → 攻擊
    if (id >= 0 && this.sim.world.owner[id] !== this.myPlayer && this.ownSelected().length) {
      this.commandAt(sx, sy, false);
      return;
    }
    if (id >= 0) {
      this.clearAll();
      this.selected.add(id);
      return;
    }
    if (this.ownSelected().length) {
      this.commandAt(sx, sy, false);
      return;
    }
    if (this.selBuilding >= 0 && this.ownsProducer(this.selBuilding)) {
      this.setRallyAt(sx, sy);
      return;
    }
    this.selectAt(sx, sy, false);
  }

  selectBox(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const w = this.sim.world;
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    if (!additive) this.clearAll();
    this.selBuilding = -1;
    this.selResource = -1;
    for (const s of this.selected) if (w.owner[s] !== this.myPlayer) this.selected.delete(s);
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.owner[id] !== this.myPlayer || w.state[id] === S.Dead) continue;
      const p = this.screenPos(id, rect);
      if (p && p[0] >= ax && p[0] <= bx && p[1] >= ay && p[1] <= by) this.selected.add(id);
    }
  }

  /** 雙擊：選取畫面內所有同類我軍 */
  selectSameType(sx: number, sy: number): void {
    const id = this.pickUnit(sx, sy, 26);
    if (id < 0) return;
    const w = this.sim.world;
    this.clearAll();
    if (w.owner[id] !== this.myPlayer) {
      this.selected.add(id);
      return;
    }
    const type = w.utype[id];
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    for (let j = 0; j < w.high; j++) {
      if (!w.alive[j] || w.owner[j] !== this.myPlayer || w.utype[j] !== type) continue;
      const p = this.screenPos(j, rect);
      if (p && p[0] >= rect.left && p[0] <= rect.right && p[1] >= rect.top && p[1] <= rect.bottom) this.selected.add(j);
    }
  }

  keepOnlyType(type: number): void {
    const w = this.sim.world;
    for (const id of [...this.selected]) if (w.utype[id] !== type) this.selected.delete(id);
  }

  clearSelection(): void {
    if (this.placing) {
      this.cancelPlacing();
      return;
    }
    this.clearAll();
  }

  ownSelected(): number[] {
    const w = this.sim.world;
    return [...this.selected].filter((id) => w.owner[id] === this.myPlayer);
  }

  private ownsProducer(b: number): boolean {
    const bs = this.sim.buildings;
    return bs.alive[b] === 1 && bs.owner[b] === this.myPlayer && BUILDING_DEFS[bs.btype[b]].trains.length > 0;
  }

  selectIdleVillager(): void {
    const w = this.sim.world;
    const vid = UNIT_INDEX.villager;
    const n = Math.max(1, w.high);
    for (let k = 0; k < n; k++) {
      const id = (this.idleCursor + 1 + k) % n;
      if (w.alive[id] && w.owner[id] === this.myPlayer && w.utype[id] === vid && w.state[id] === S.Idle && w.task[id] === 0) {
        this.idleCursor = id;
        this.clearAll();
        this.selected.add(id);
        this.cam.lookAt(this.units.wx[id], this.units.wz[id]);
        return;
      }
    }
    this.hud.toast('沒有閒置的民夫');
  }

  selectArmy(): void {
    const w = this.sim.world;
    this.clearAll();
    for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === this.myPlayer && !UNIT_DEFS[w.utype[id]].worker) this.selected.add(id);
    if (!this.selected.size) this.hud.toast('沒有軍隊');
  }

  goHome(): void {
    const bs = this.sim.buildings;
    for (let b = 0; b < bs.high; b++) {
      if (bs.alive[b] && bs.owner[b] === this.myPlayer && BUILDING_DEFS[bs.btype[b]].id === 'town_hall') {
        this.cam.lookAt(bs.centerX(b) / ONE, bs.centerY(b) / ONE + 2);
        return;
      }
    }
    const s = this.sim.map.starts[this.myPlayer];
    this.cam.lookAt(s.x + 0.5, s.y + 0.5);
  }

  setGroup(n: number): void {
    const ids = this.ownSelected();
    this.groups.set(n, ids);
    this.hud.toast(`第 ${n} 隊：${ids.length} 名`);
  }

  recallGroup(n: number, jump: boolean): void {
    const w = this.sim.world;
    const ids = (this.groups.get(n) ?? []).filter((id) => w.alive[id]);
    if (!ids.length) return;
    this.clearAll();
    for (const id of ids) this.selected.add(id);
    if (jump) {
      let x = 0;
      let z = 0;
      for (const id of ids) {
        x += this.units.wx[id];
        z += this.units.wz[id];
      }
      this.cam.lookAt(x / ids.length, z / ids.length);
    }
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  // ───────── 指令 ─────────

  /** 右鍵／點地面：依目標決定移動、採集、建造、耕田、集結點 */
  commandAt(sx: number, sy: number, _queue: boolean): void {
    if (this.placing) {
      this.cancelPlacing();
      return;
    }
    if (this.rallyMode || (this.selBuilding >= 0 && this.ownsProducer(this.selBuilding) && !this.selected.size)) {
      this.setRallyAt(sx, sy);
      return;
    }
    const ids = this.ownSelected();
    if (!ids.length) return;
    const p = this.cam.groundAt(sx, sy);
    if (!p) return;
    const sim = this.sim;
    if (this.attackMoveMode) {
      this.attackMoveMode = false;
      sim.issue({ t: 'attackMove', player: this.myPlayer, ids, x: Math.round(p.x * ONE), y: Math.round(p.z * ONE), spread: this.spread });
      this.markers.ping(p.x, p.y, p.z, 0xff5a4a);
      return;
    }
    if (this.patrolMode) {
      this.patrolMode = false;
      sim.issue({ t: 'patrol', player: this.myPlayer, ids, x: Math.round(p.x * ONE), y: Math.round(p.z * ONE) });
      this.markers.ping(p.x, p.y, p.z, 0x5ab4ff);
      return;
    }
    // 敵方單位 → 攻擊
    const u = this.pickUnit(sx, sy, 22);
    if (u >= 0 && sim.world.owner[u] !== this.myPlayer) {
      sim.issue({ t: 'attack', player: this.myPlayer, ids, kind: TK.Unit, target: u });
      this.markers.ping(this.units.wx[u], this.units.wy[u], this.units.wz[u], 0xff5a4a);
      return;
    }
    const b = this.pickBuilding(sx, sy);
    if (b >= 0 && sim.buildings.owner[b] !== this.myPlayer) {
      sim.issue({ t: 'attack', player: this.myPlayer, ids, kind: TK.Building, target: b });
      this.markers.ping(sim.buildings.centerX(b) / ONE, p.y, sim.buildings.centerY(b) / ONE, 0xff5a4a);
      return;
    }
    if (b >= 0 && sim.buildings.owner[b] === this.myPlayer) {
      sim.issue({ t: 'work', player: this.myPlayer, ids, building: b });
      this.markers.ping(sim.buildings.centerX(b) / ONE, p.y, sim.buildings.centerY(b) / ONE, 0xffe14a);
      return;
    }
    const r = this.pickResource(sx, sy);
    if (r >= 0) {
      sim.issue({ t: 'gather', player: this.myPlayer, ids, res: r });
      const x = sim.res.x[r] / ONE;
      const z = sim.res.y[r] / ONE;
      this.markers.ping(x, this.terrain.heightAt(x, z), z, 0xffe14a);
      return;
    }
    this.issueMove(p.x, p.z);
  }

  issueMove(x: number, z: number): void {
    const ids = this.ownSelected();
    if (!ids.length) return;
    this.sim.issue({ t: 'move', player: this.myPlayer, ids, x: Math.round(x * ONE), y: Math.round(z * ONE), spread: this.spread });
    this.markers.ping(x, this.terrain.heightAt(x, z), z);
  }

  /** 切換姿態：進攻 → 防守 → 堅守 → 不還擊 */
  cycleStance(): void {
    const ids = this.ownSelected().filter((id) => !UNIT_DEFS[this.sim.world.utype[id]].worker);
    if (!ids.length) return;
    const next = (this.sim.world.stance[ids[0]] + 1) % 4;
    this.sim.issue({ t: 'stance', player: this.myPlayer, ids, stance: next });
    this.hud.toast(`姿態：${['進攻', '防守', '堅守', '不還擊'][next]}`);
  }

  stopSelected(): void {
    const ids = this.ownSelected();
    if (ids.length) this.sim.issue({ t: 'stop', player: this.myPlayer, ids });
  }

  setRallyAt(sx: number, sy: number): void {
    this.rallyMode = false;
    const b = this.selBuilding;
    if (b < 0 || !this.ownsProducer(b)) return;
    const p = this.cam.groundAt(sx, sy);
    if (!p) return;
    const r = this.pickResource(sx, sy);
    this.sim.issue({ t: 'rally', player: this.myPlayer, building: b, x: Math.round(p.x * ONE), y: Math.round(p.z * ONE), res: r });
    this.markers.ping(p.x, p.y, p.z, 0xffffff);
    this.hud.toast(r >= 0 ? '集結點：新民夫會直接去採集' : '已設定集結點');
  }

  train(b: number, unit: number): void {
    this.sim.issue({ t: 'train', player: this.myPlayer, building: b, unit, count: 1 });
  }

  cancelTrain(b: number, index: number): void {
    if (b >= 0) this.sim.issue({ t: 'cancel', player: this.myPlayer, building: b, index });
  }

  toggleLoop(b: number): void {
    this.sim.issue({ t: 'loop', player: this.myPlayer, building: b, on: !this.sim.buildings.loop[b] });
  }

  toggleReseed(): void {
    this.sim.issue({ t: 'reseed', player: this.myPlayer, on: !this.sim.players[this.myPlayer].autoReseed });
  }

  destroySelectedBuilding(): void {
    const b = this.selBuilding;
    if (b < 0) return;
    if (!window.confirm(`確定要拆除${BUILDING_DEFS[this.sim.buildings.btype[b]].name}？`)) return;
    this.sim.issue({ t: 'destroy', player: this.myPlayer, building: b });
    this.selBuilding = -1;
  }

  // ───────── 建造放置 ─────────

  startPlacing(btype: number): void {
    const workers = this.ownSelected().filter((id) => UNIT_DEFS[this.sim.world.utype[id]].worker);
    if (!workers.length) return;
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.placing = { btype, tx: 0, ty: 0, valid: false };
    this.updatePlacing(r.left + r.width / 2, r.top + r.height / 2);
    // 畫面中央不能蓋時，往外找最近的空地（手機上少點一次）
    const pl = this.placing;
    if (!pl.valid && this.sim.players[this.myPlayer].canAfford(BUILDING_DEFS[btype].cost)) {
      for (let rr = 1; rr <= 8 && !pl.valid; rr++) {
        for (let dy = -rr; dy <= rr && !pl.valid; dy++) {
          for (let dx = -rr; dx <= rr && !pl.valid; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr || !this.sim.canPlace(btype, pl.tx + dx, pl.ty + dy)) continue;
            pl.tx += dx;
            pl.ty += dy;
            pl.valid = true;
          }
        }
      }
    }
  }

  /** 讓預覽中心對到螢幕座標 */
  updatePlacing(sx: number, sy: number): void {
    const pl = this.placing;
    if (!pl) return;
    const p = this.cam.groundAt(sx, sy);
    if (!p) return;
    const def = BUILDING_DEFS[pl.btype];
    pl.tx = Math.round(p.x - def.w / 2);
    pl.ty = Math.round(p.z - def.h / 2);
    pl.valid = (this.sim.canPlace(pl.btype, pl.tx, pl.ty) || !!pl.lineStart) && this.sim.players[this.myPlayer].canAfford(def.cost);
  }

  /** 牆的格子（4 連通直線，跟模擬層一致） */
  lineTiles(x0: number, y0: number, x1: number, y1: number): [number, number][] {
    const out: [number, number][] = [[x0, y0]];
    let x = x0;
    let y = y0;
    for (let k = 0; k < 64 && (x !== x1 || y !== y1); k++) {
      const dx = x1 - x;
      const dy = y1 - y;
      if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx);
      else y += Math.sign(dy);
      out.push([x, y]);
    }
    return out;
  }

  confirmPlacing(keep: boolean): void {
    const pl = this.placing;
    if (!pl) return;
    // 牆：第一下定起點，第二下定終點
    if (BUILDING_DEFS[pl.btype].wall) {
      if (!pl.lineStart) {
        pl.lineStart = [pl.tx, pl.ty];
        this.hud.toast('再點一下終點，拉出一整排牆');
        return;
      }
      const ids = this.ownSelected().filter((id) => UNIT_DEFS[this.sim.world.utype[id]].worker);
      this.sim.issue({ t: 'buildLine', player: this.myPlayer, ids, btype: pl.btype, x0: pl.lineStart[0], y0: pl.lineStart[1], x1: pl.tx, y1: pl.ty });
      this.placing = null;
      return;
    }
    if (!pl.valid) {
      this.hud.toast(this.sim.players[this.myPlayer].canAfford(BUILDING_DEFS[pl.btype].cost) ? '這裡不能蓋' : '資源不足');
      return;
    }
    const ids = this.ownSelected().filter((id) => UNIT_DEFS[this.sim.world.utype[id]].worker);
    this.sim.issue({ t: 'build', player: this.myPlayer, ids, btype: pl.btype, tx: pl.tx, ty: pl.ty });
    const def = BUILDING_DEFS[pl.btype];
    this.markers.ping(pl.tx + def.w / 2, this.terrain.heightAt(pl.tx + def.w / 2, pl.ty + def.h / 2), pl.ty + def.h / 2, 0xffe14a);
    if (keep && this.sim.players[this.myPlayer].canAfford([def.cost[0] * 2, def.cost[1] * 2, def.cost[2] * 2, def.cost[3] * 2])) {
      // Shift 連續放：下一個預覽先標成無效，滑鼠一動就重算
      pl.valid = false;
    } else {
      this.placing = null;
    }
  }

  cancelPlacing(): void {
    this.placing = null;
  }

  /** 下一個 tick 執行完後呼叫（剛生成的單位才有 id） */
  runAfterStep(fn: () => void): void {
    this.afterStep.push(fn);
  }

  /** DEV 壓測：清場後雙方各生 n/2 名混編部隊，互相衝到對方起始點 */
  stressBattle(n: number): void {
    this.clearAll();
    this.sim.issue({ t: 'clear' });
    const [a, b] = this.sim.map.starts;
    const types = [UNIT_INDEX.swordsman, UNIT_INDEX.spearman, UNIT_INDEX.archer, UNIT_INDEX.light_cav];
    const half = Math.floor(n / 2);
    for (const [p, s] of [[0, a], [1, b]] as const) {
      types.forEach((t, i) => {
        const cnt = Math.floor(half / 4) + (i < half % 4 ? 1 : 0);
        this.sim.issue({ t: 'spawn', player: p, unit: t, x: (s.x + 0.5) * ONE, y: (s.y + 6.5) * ONE, count: cnt });
      });
    }
    this.runAfterStep(() => {
      const w = this.sim.world;
      for (const [p, target] of [[0, b], [1, a]] as const) {
        const ids: number[] = [];
        for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === p) ids.push(id);
        this.sim.issue({ t: 'attackMove', player: p, ids, x: (target.x + 0.5) * ONE, y: (target.y + 6.5) * ONE });
      }
    });
  }

  /** DEV：在鏡頭中心生成單位 */
  spawnAtCamera(player: number, unit: number, count: number): void {
    this.sim.issue({ t: 'spawn', player, unit, x: Math.round(this.cam.target.x * ONE), y: Math.round(this.cam.target.z * ONE), count });
  }
}
