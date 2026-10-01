// 遊戲主體：串起模擬層、渲染、輸入、HUD；固定 tick 模擬 ＋ 每幀內插渲染（docs/07 §3）
import * as THREE from 'three';
import { CAMERA, type Quality } from './config';
import { Controls } from './input/controls';
import { RtsCamera } from './input/camera';
import { Markers } from './render/markers';
import { Stage } from './render/stage';
import { Terrain } from './render/terrain';
import { Trees } from './render/trees';
import { UnitRenderer } from './render/units';
import { ONE, TICK_MS, tileCenter } from './sim/core/fixed';
import { S, UNIT_INDEX } from './sim/core/world';
import { Sim } from './sim/sim';
import { Hud } from './ui/hud';
import { detectLayout, type LayoutMode } from './ui/layout';

export interface GameOptions {
  seed: number;
  quality: Quality;
  layout?: LayoutMode;
}

export class Game {
  readonly sim: Sim;
  readonly stage: Stage;
  readonly terrain: Terrain;
  readonly trees: Trees;
  readonly units: UnitRenderer;
  readonly markers: Markers;
  readonly cam: RtsCamera;
  readonly hud: Hud;
  readonly controls: Controls;
  readonly myPlayer = 0;
  readonly selected = new Set<number>();
  layoutMode: LayoutMode;
  speed = 1;
  paused = false;
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
  private statAcc = { frames: 0, time: 0, simMs: 0, frameMs: 0, ticks: 0 };
  private readonly v = new THREE.Vector3();

  constructor(container: HTMLElement, opts: GameOptions) {
    this.layoutMode = opts.layout ?? detectLayout();
    this.sim = new Sim({ seed: opts.seed, mapSize: 128 });
    this.stage = new Stage(container, opts.quality);
    this.terrain = new Terrain(this.sim.map);
    this.trees = new Trees(this.sim.map, this.terrain);
    this.units = new UnitRenderer(this.terrain);
    this.markers = new Markers();
    this.stage.scene.add(this.terrain.group, this.trees.group, this.units.group, this.markers.group);
    this.applyShadowMode();
    const startDist = this.layoutMode === 'mobile' ? CAMERA.startDistMobile : CAMERA.startDistPc;
    this.cam = new RtsCamera(this.stage.camera, this.terrain, this.sim.map.w, this.sim.map.h, startDist);
    this.controls = new Controls(this, this.stage.renderer.domElement);
    this.hud = new Hud(container, this);
    this.setupStartingArmies();
    this.goHome();
    window.addEventListener('resize', () => {
      const next = detectLayout();
      if (next !== this.layoutMode && !this.layoutLocked) this.setLayout(next);
    });
  }

  /** DEV 手動指定版面後，不再隨視窗自動切換 */
  layoutLocked = false;

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

  /** 開局：雙方各一支示範部隊（走指令，重播才完整） */
  private setupStartingArmies(): void {
    const [a, b] = this.sim.map.starts;
    const lineup: [string, number, number][] = [
      ['villager', 6, 0],
      ['swordsman', 8, 3],
      ['spearman', 8, 5],
      ['archer', 8, 7],
    ];
    for (const [p, s, dir] of [[0, a, 1], [1, b, -1]] as const) {
      for (const [id, n, off] of lineup) {
        this.sim.issue({ t: 'spawn', player: p, unit: UNIT_INDEX[id], x: tileCenter(s.x + off * dir), y: tileCenter(s.y + 2 * dir), count: n });
      }
    }
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
    const alpha = this.paused ? 1 : Math.min(1, this.acc / TICK_MS);

    this.controls.update();
    this.cam.update(dt);
    this.stage.followTarget(this.cam.target, this.cam.dist);
    this.units.update(this.sim, alpha, this.time, dt * this.speed, this.viewBounds());
    const w = this.sim.world;
    for (const id of this.selected) if (!w.alive[id] || w.state[id] === S.Dead) this.selected.delete(id);
    this.markers.update(this.units, this.selected, w.owner, w.alive, w.high, this.myPlayer, dt);
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
      if (!w.alive[id] || w.state[id] === S.Dead) continue;
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

  selectAt(sx: number, sy: number, additive: boolean): void {
    const id = this.pickUnit(sx, sy, 18);
    if (id < 0) {
      if (!additive) this.clearSelection();
      return;
    }
    const w = this.sim.world;
    if (additive && w.owner[id] === this.myPlayer) {
      if (this.selected.has(id)) this.selected.delete(id);
      else {
        for (const s of this.selected) if (w.owner[s] !== this.myPlayer) this.selected.delete(s);
        this.selected.add(id);
      }
      return;
    }
    this.selected.clear();
    this.selected.add(id);
  }

  /** 觸控點一下：點到兵就選；點到地面且有選我軍就移動 */
  tapAt(sx: number, sy: number): void {
    const id = this.pickUnit(sx, sy, 26);
    if (id >= 0) {
      this.selected.clear();
      this.selected.add(id);
      return;
    }
    if (this.ownSelected().length) this.commandAt(sx, sy, false);
  }

  selectBox(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const w = this.sim.world;
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    if (!additive) this.selected.clear();
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
    if (w.owner[id] !== this.myPlayer) {
      this.selected.clear();
      this.selected.add(id);
      return;
    }
    const type = w.utype[id];
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    this.selected.clear();
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
    this.selected.clear();
  }

  ownSelected(): number[] {
    const w = this.sim.world;
    return [...this.selected].filter((id) => w.owner[id] === this.myPlayer);
  }

  selectIdleVillager(): void {
    const w = this.sim.world;
    const vid = UNIT_INDEX.villager;
    for (let k = 0; k < w.high; k++) {
      const id = (this.idleCursor + 1 + k) % Math.max(1, w.high);
      if (w.alive[id] && w.owner[id] === this.myPlayer && w.utype[id] === vid && w.state[id] === S.Idle) {
        this.idleCursor = id;
        this.selected.clear();
        this.selected.add(id);
        this.cam.lookAt(this.units.wx[id], this.units.wz[id]);
        return;
      }
    }
    this.hud.toast('沒有閒置的民夫');
  }

  selectArmy(): void {
    const w = this.sim.world;
    this.selected.clear();
    for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === this.myPlayer && w.utype[id] !== UNIT_INDEX.villager) this.selected.add(id);
    if (!this.selected.size) this.hud.toast('沒有軍隊');
  }

  goHome(): void {
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
    this.selected.clear();
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

  commandAt(sx: number, sy: number, _queue: boolean): void {
    const p = this.cam.groundAt(sx, sy);
    if (p) this.issueMove(p.x, p.z);
  }

  issueMove(x: number, z: number): void {
    const ids = this.ownSelected();
    if (!ids.length) return;
    this.sim.issue({ t: 'move', player: this.myPlayer, ids, x: Math.round(x * ONE), y: Math.round(z * ONE) });
    this.markers.ping(x, this.terrain.heightAt(x, z), z);
  }

  /** 下一個 tick 執行完後呼叫（剛生成的單位才有 id） */
  runAfterStep(fn: () => void): void {
    this.afterStep.push(fn);
  }

  /** DEV 壓測：清場後雙方各生 n/2 名混編部隊，互相衝到對方起始點 */
  stressBattle(n: number): void {
    this.selected.clear();
    this.sim.issue({ t: 'clear' });
    const [a, b] = this.sim.map.starts;
    const types = [UNIT_INDEX.swordsman, UNIT_INDEX.spearman, UNIT_INDEX.archer];
    const half = Math.floor(n / 2);
    for (const [p, s] of [[0, a], [1, b]] as const) {
      types.forEach((t, i) => {
        const cnt = Math.floor(half / 3) + (i < half % 3 ? 1 : 0);
        this.sim.issue({ t: 'spawn', player: p, unit: t, x: tileCenter(s.x), y: tileCenter(s.y), count: cnt });
      });
    }
    this.runAfterStep(() => {
      const w = this.sim.world;
      for (const [p, target] of [[0, b], [1, a]] as const) {
        const ids: number[] = [];
        for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === p) ids.push(id);
        this.sim.issue({ t: 'move', player: p, ids, x: tileCenter(target.x), y: tileCenter(target.y) });
      }
    });
  }

  /** DEV：在鏡頭中心生成單位 */
  spawnAtCamera(player: number, unit: number, count: number): void {
    this.sim.issue({ t: 'spawn', player, unit, x: Math.round(this.cam.target.x * ONE), y: Math.round(this.cam.target.z * ONE), count });
  }
}
