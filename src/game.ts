// 遊戲主體：串起模擬層、渲染、輸入、HUD；固定 tick 模擬 ＋ 每幀內插渲染（docs/07 §3）
import * as THREE from 'three';
import { AI_PARAMS, AIPlayer } from './ai/ai';
import { sfx } from './audio/sfx';
import { AUTO_KEY, SAVE_KEY, writeSave, type SaveData } from './save/save';
import { showAgeBanner, showGameOver, showLoading, showPauseMenu, showSettings, setupQuery, type GameSetup } from './ui/menus';
import { CAMERA, type Quality } from './config';
import { Controls } from './input/controls';
import { RtsCamera } from './input/camera';
import { BuildingRenderer } from './render/buildings';
import { Effects } from './render/effects';
import { Particles } from './render/particles';
import { Advisor } from './ui/advisor';
import { SKILLS, STRATAGEMS } from './sim/systems/abilities';
import { FogRenderer } from './render/fog';
import { ProjectileRenderer } from './render/projectiles';
import { Markers } from './render/markers';
import { ResourceRenderer } from './render/resources';
import { Stage } from './render/stage';
import { Terrain } from './render/terrain';
import { Trees } from './render/trees';
import { UnitRenderer } from './render/units';
import { BUILDING_DEFS, RESOURCE_KINDS, RES_NAMES, RK, TAG, TECH_DEFS, UNIT_DEFS, UNIT_INDEX, WONDER_NAMES } from './sim/core/defs';
import type { Command } from './sim/core/commands';
import { ONE, TICK_MS } from './sim/core/fixed';
import { S, TK } from './sim/core/world';
import { Sim } from './sim/sim';
import { Hud } from './ui/hud';
import { detectLayout, type LayoutMode } from './ui/layout';

export interface GameOptions {
  setup: GameSetup;
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
  readonly effects: Effects;
  readonly particles: Particles;
  readonly advisor: Advisor;
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
  /** 等待點選目標地點的技能／計策（武將 id 或計策名稱） */
  targeting: { kind: 'skill'; id: number } | { kind: 'stratagem'; name: string } | { kind: 'unload'; ship: number } | null = null;
  /** 巡邏模式：下一次點地面是巡邏終點 */
  patrolMode = false;
  /** 陣型：散開 */
  spread = false;
  layoutMode: LayoutMode;
  /** DEV 手動指定版面後，不再隨視窗自動切換 */
  layoutLocked = false;
  speed = 1;
  paused = false;
  /** 電腦玩家 */
  readonly ais: AIPlayer[] = [];
  readonly setup: GameSetup;
  /** 讀檔重播中：不跑 AI、不自動存檔 */
  replaying = false;
  replayCheck: { tick: number; hash: number } | null = null;
  private menuClose: (() => void) | null = null;
  private lastAutosave = 0;
  private over = false;
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
    this.setup = opts.setup;
    const st = opts.setup;
    const fac = (f?: string) => (f && f !== 'random' ? f : '');
    this.sim = new Sim({
      seed: st.seed,
      mapSize: st.map,
      mapType: st.mapType ?? 'central',
      factions: [fac(st.faction), fac(st.aiFaction)],
      seal: st.seal !== false,
      bonusRes: st.res,
      popLimit: st.pop,
      handicap: [1000, AI_PARAMS[st.ai].handicap],
    });
    this.speed = st.speed;
    this.stage = new Stage(container, opts.quality);
    this.terrain = new Terrain(this.sim.map);
    this.trees = new Trees(this.sim.map, this.terrain);
    this.units = new UnitRenderer(this.terrain);
    this.buildingsR = new BuildingRenderer(this.terrain);
    this.resourcesR = new ResourceRenderer(this.sim, this.terrain);
    this.markers = new Markers();
    this.fog = new FogRenderer(this.sim.map.w, this.sim.map.h);
    this.projectilesR = new ProjectileRenderer(this.terrain);
    this.effects = new Effects(this.terrain);
    this.particles = new Particles();
    this.particles.density = { low: 0.4, medium: 0.7, high: 1 }[opts.quality] ?? 0.7;
    this.stage.scene.add(this.terrain.group, this.trees.group, this.resourcesR.group, this.buildingsR.group, this.units.group, this.markers.group, this.projectilesR.mesh, this.effects.group, this.particles.group);
    this.applyShadowMode();
    const startDist = this.layoutMode === 'mobile' ? CAMERA.startDistMobile : CAMERA.startDistPc;
    this.cam = new RtsCamera(this.stage.camera, this.terrain, this.sim.map.w, this.sim.map.h, startDist);
    this.controls = new Controls(this, this.stage.renderer.domElement);
    this.hud = new Hud(container, this);
    this.advisor = new Advisor(container, this);
    this.ais.push(new AIPlayer(this.sim, 1, st.ai));
    this.fog.enabled = !st.reveal;
    this.goHome();
    this.addMenuButton(container);
    window.addEventListener('resize', () => {
      const next = detectLayout();
      if (next !== this.layoutMode && !this.layoutLocked) this.setLayout(next);
    });
  }

  /** 單位語音：依選取／指令的代表單位（武將 > 軍隊 > 民夫）挑台詞 */
  private voiceFor(ids: number[], kind: 'sel' | 'cmd' | 'atk'): void {
    const w = this.sim.world;
    let hero = false;
    let army = false;
    let vil = false;
    for (const id of ids) {
      if (!w.alive[id] || w.owner[id] !== this.myPlayer) continue;
      const d = UNIT_DEFS[w.utype[id]];
      if (d.hero) hero = true;
      else if (d.worker) vil = true;
      else if (d.attack > 0) army = true;
    }
    if (hero) sfx.voice(kind === 'sel' ? 'sel_hero' : 'cmd_hero', kind === 'sel' ? 2 : 1);
    else if (army) sfx.voice(`${kind}_soldier`, 3);
    else if (vil) sfx.voice(kind === 'sel' ? 'sel_villager' : 'cmd_villager', 2);
  }

  private lastSelVoice = '';

  start(): void {
    sfx.setMusic('peace');
    sfx.preloadVoices(['sel_soldier_1', 'cmd_soldier_1', 'atk_soldier_1', 'sel_villager_1', 'cmd_villager_1']);
    // 玩家下的指令：播語音回應（AI、重播不播）
    const issue = this.sim.issue.bind(this.sim);
    this.sim.issue = (input, delay) => {
      const c = issue(input, delay);
      if (!this.replaying && 'player' in c && c.player === this.myPlayer && 'ids' in c && Math.random() < 0.7) {
        const kind = c.t === 'attack' || c.t === 'attackMove' ? 'atk' : c.t === 'move' || c.t === 'patrol' || c.t === 'gather' || c.t === 'work' || c.t === 'build' || c.t === 'buildLine' ? 'cmd' : null;
        if (kind) this.voiceFor(c.ids, kind);
      }
      return c;
    };
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
    this.particles.density = { low: 0.4, medium: 0.7, high: 1 }[q] ?? 0.7;
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
        if (!this.replaying) for (const a of this.ais) a.tick();
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
    if (!this.replaying && !this.over && this.sim.tick - this.lastAutosave >= 600) {
      this.lastAutosave = this.sim.tick;
      writeSave(AUTO_KEY, this.saveData());
    }
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
    const selKey = this.selected.size ? `${this.selected.size}:${[...this.selected][0]}` : '';
    if (selKey !== this.lastSelVoice) {
      if (selKey && !this.replaying) this.voiceFor([...this.selected], 'sel');
      this.lastSelVoice = selKey;
    }
    this.updateMusic(dt);
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
    this.effects.update(this.sim, this.units, this.time, this.myPlayer, vis, exp);
    this.ambientParticles(dt, ticks > 0);
    this.particles.update(this.time);
    this.battleSounds();
    this.resourcesR.update(dt);
    if (this.placing) {
      const pl = this.placing;
      this.buildingsR.setGhost(pl.btype, pl.tx, pl.ty, pl.valid, this.sim.players[this.myPlayer].age, this.sim.players[this.myPlayer].faction);
      this.buildingsR.setLineGhost(pl.lineStart ? this.lineTiles(pl.lineStart[0], pl.lineStart[1], pl.tx, pl.ty).map(([x, y]) => [x, y, this.sim.canPlace(pl.btype, x, y)]) : []);
    } else {
      this.buildingsR.setGhost(-1, 0, 0, false);
      this.buildingsR.setLineGhost([]);
    }
    this.hud.update(dt);
    this.advisor.update(dt * this.speed);
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
      if (e.t === 'died' && this.units.seen[e.id]) {
        sfx.play('die', 0.15);
        const naval = UNIT_DEFS[e.utype].naval;
        this.particles.emit(naval ? 'splash' : 'dust', this.units.wx[e.id], this.units.wy[e.id], this.units.wz[e.id], this.time, naval ? 1.5 : 1);
      }
      if (e.t === 'trained' && e.player === this.myPlayer && !this.replaying) sfx.play('train', 0.3);
      if (e.t === 'research' && !this.replaying) {
        const t = TECH_DEFS[e.tech];
        if (e.player === this.myPlayer) {
          if (t.ageUp) {
            showAgeBanner(document.body, t.name, ['', '', '解鎖弓營、馬廄、鐵匠鋪、箭塔、石牆', '解鎖工坊、衝車、重騎與兵種升級', '解鎖霹靂車、鐵騎與最終科技'][this.sim.players[this.myPlayer].age] ?? '');
            sfx.play('age');
          } else {
            this.hud.toast(`研究完成：${t.name}`);
            sfx.play('done');
          }
        } else if (t.ageUp && this.sim.players[e.player]) {
          this.hud.toast(`⚠ 敵軍進入「${t.name}」`, 2500);
        }
      }
      if (e.t === 'gameOver' && !this.over) this.gameOver(e.winner === this.myPlayer, e.reason);
      if (!this.replaying) this.featureEvent(e);
      if (e.t === 'bDestroyed') {
        if (this.selBuilding === e.id) this.selBuilding = -1;
        // 建築崩塌：大片塵土 ＋ 碎屑
        const cx = e.tx + e.w / 2;
        const cz = e.ty + e.h / 2;
        if (this.isExplored(Math.floor(cx), Math.floor(cz))) {
          const y = this.terrain.heightAt(cx, cz);
          this.particles.emit('bigDust', cx, y, cz, this.time, Math.max(1, e.w / 2));
          this.particles.emit('debris', cx, y, cz, this.time, Math.max(1, e.w / 2));
          sfx.play('collapse', 0.3);
        }
        this.resourcesR.dirty();
      }
      if (e.t === 'resGone') {
        if (e.kind === RK.tree) {
          this.trees.remove(e.tx, e.ty);
          this.hud.clearMiniTile(e.tx, e.ty);
        }
        this.resourcesR.dirty();
      } else if (e.t === 'bComplete' && this.sim.buildings.owner[e.id] === this.myPlayer && this.sim.tick > 1 && !this.replaying) {
        this.hud.toast(`${BUILDING_DEFS[this.sim.buildings.btype[e.id]].name}完工`);
        sfx.play('done', 0.5);
      }
    }
    ev.length = 0;
    const housed = this.sim.players[this.myPlayer].housed;
    if (housed && !this.wasHoused) this.hud.toast('人口已滿：請蓋民居', 2500);
    this.wasHoused = housed;
  }

  private smokeTimer = 0;
  private battleHold = 0;

  /** 配樂：畫面上（或我方附近）有大規模交戰就切戰鼓，停戰 10 秒後回到平時 */
  private updateMusic(dt: number): void {
    const w = this.sim.world;
    let fighting = 0;
    for (let id = 0; id < w.high; id++) {
      if (w.alive[id] && w.state[id] === S.Attack && (w.owner[id] === this.myPlayer || this.units.seen[id])) fighting++;
      if (fighting >= 8) break;
    }
    if (fighting >= 8) this.battleHold = 10;
    else this.battleHold = Math.max(0, this.battleHold - dt);
    sfx.setMusic(this.over ? 'peace' : this.battleHold > 0 ? 'battle' : 'peace');
  }

  /** 持續性粒子：燃燒建築冒煙、火海煙與火星、受擊星星、騎兵揚塵 */
  private ambientParticles(dt: number, newTick: boolean): void {
    const sim = this.sim;
    const now = this.time;
    const w = sim.world;
    if (newTick) {
      const t = sim.tick - 1;
      for (let id = 0; id < w.high; id++) {
        if (!w.alive[id] || !this.units.seen[id]) continue;
        // 受擊星星：近戰命中才冒（遠程太多會很吵）
        if (w.hurtAt[id] === t && w.lastAttacker[id] >= 0 && UNIT_DEFS[w.utype[w.lastAttacker[id]]]?.rangeFx === 0 && ((id + t) & 1) === 0) this.particles.emit('star', this.units.wx[id], this.units.wy[id], this.units.wz[id], now);
        // 騎兵、攻城器械移動揚塵
        if (w.state[id] === S.Move && UNIT_DEFS[w.utype[id]].tags & (TAG.cavalry | TAG.siege) && (id * 7 + t) % 9 === 0) this.particles.emit('dust', this.units.wx[id], this.units.wy[id], this.units.wz[id], now, 0.6);
      }
    }
    this.smokeTimer -= dt;
    if (this.smokeTimer > 0) return;
    this.smokeTimer = 0.18;
    const bs = sim.buildings;
    for (const [b] of sim.abilities.burning) {
      if (!bs.alive[b]) continue;
      const d = BUILDING_DEFS[bs.btype[b]];
      const x = bs.tx[b] + d.w / 2;
      const z = bs.ty[b] + d.h / 2;
      if (!this.isExplored(Math.floor(x), Math.floor(z))) continue;
      const y = this.terrain.heightAt(x, z) + this.buildingsR.heightOf(bs.btype[b]) * 0.8;
      this.particles.emit('smoke', x, y, z, now, Math.min(2, d.w * 0.5));
      this.particles.emit('ember', x, y, z, now);
    }
    // 受損嚴重的建築冒煙（HP < 40%）
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b] || !bs.complete[b]) continue;
      const d = BUILDING_DEFS[bs.btype[b]];
      if (bs.hp[b] * 10 >= d.hp * 4 || d.wall || (b + Math.floor(now * 5)) % 3) continue;
      const x = bs.tx[b] + d.w / 2;
      const z = bs.ty[b] + d.h / 2;
      if (!this.isVisible(Math.floor(x), Math.floor(z))) continue;
      this.particles.emit('smoke', x, this.terrain.heightAt(x, z) + this.buildingsR.heightOf(bs.btype[b]) * 0.7, z, now, 0.8);
    }
    for (const a of sim.abilities.areas) {
      if (a.kind !== 'fire') continue;
      const x = a.x / ONE;
      const z = a.y / ONE;
      if (!this.isVisible(Math.floor(x), Math.floor(z))) continue;
      const r = a.r / ONE;
      const ang = now * 7.3;
      const px = x + Math.cos(ang) * r * 0.6;
      const pz = z + Math.sin(ang) * r * 0.6;
      this.particles.emit('smoke', px, this.terrain.heightAt(px, pz) + 0.8, pz, now, 1.2);
      this.particles.emit('ember', px, this.terrain.heightAt(px, pz) + 0.4, pz, now);
    }
  }

  /** 三國特色事件：武將技演出、計策、倒戈、兵書玉璽、奇觀 */
  private featureEvent(e: (typeof this.sim.events)[number]): void {
    const sim = this.sim;
    const me = this.myPlayer;
    switch (e.t) {
      case 'skill': {
        const sk = SKILLS[e.skill];
        const w = sim.world;
        const x = (sk?.target === 'point' ? e.x : w.x[e.id]) / ONE;
        const z = (sk?.target === 'point' ? e.y : w.y[e.id]) / ONE;
        const seen = e.player === me || this.isVisible(Math.floor(x), Math.floor(z));
        if (!seen) return;
        this.effects.burst(x, z, sk?.target === 'point' ? 5 : 7, e.player === me ? 0xf0c040 : 0xff5a4a, this.time, 1.2);
        this.hud.cutIn(UNIT_DEFS[w.utype[e.id]].name, sk?.name ?? '', e.player === me, e.skill);
        sfx.play('skill', 0.5);
        break;
      }
      case 'stratagem': {
        const st = STRATAGEMS[e.kind];
        if (st?.target === 'point') this.effects.burst(e.x / ONE, e.y / ONE, 4, 0xff8a2a, this.time, 1.5);
        this.hud.toast(e.player === me ? `施放計策：${st?.name}` : `⚠ 敵方施放計策「${st?.name}」！`, 2500);
        sfx.play('skill', 0.5);
        break;
      }
      case 'converted':
        if (this.units.seen[e.id]) this.effects.burst(this.units.wx[e.id], this.units.wz[e.id], 1.2, 0xb08aff, this.time);
        if (e.to === me) this.hud.toast('謀士勸降成功！');
        else if (e.from === me) this.hud.toast('⚠ 我軍被敵方謀士勸降了');
        break;
      case 'levelUp':
        if (sim.world.owner[e.id] === me) this.hud.toast(`${UNIT_DEFS[sim.world.utype[e.id]].name} 威名提升，升到 ${e.level} 級！`);
        break;
      case 'itemPicked': {
        const it = sim.abilities.items[e.item];
        const name = it.kind === 'seal' ? '傳國玉璽' : '兵書';
        this.hud.toast(e.player === me ? `謀士拿到${name}了，送回書院！` : `⚠ 敵方謀士拿走了${name}`, 2500);
        break;
      }
      case 'itemStored': {
        const it = sim.abilities.items[e.item];
        if (it.kind === 'seal') this.hud.toast(e.player === me ? '玉璽入庫！守住書院 5 分鐘即可稱帝' : '⚠ 敵方得到傳國玉璽！5 分鐘內必須摧毀其書院', 4000);
        else if (e.player === me) this.hud.toast('兵書入庫：持續產出金');
        sfx.play(e.player === me ? 'done' : 'alert', 1);
        break;
      }
      case 'wonder': {
        const name = WONDER_NAMES[sim.players[e.player].faction] ?? '奇觀';
        this.hud.toast(e.player === me ? `${name}落成！守住 5 分鐘即可勝利` : `⚠ 敵方建成${name}！5 分鐘內必須摧毀`, 4000);
        sfx.play(e.player === me ? 'age' : 'alert', 1);
        break;
      }
    }
  }

  /** 我方遭到攻擊：提示 ＋ 小地圖閃紅點（10 秒內只提示一次） */
  alert(x: number, z: number): void {
    this.hud.ping(x, z);
    if (this.time - this.lastAlert < 10) return;
    this.lastAlert = this.time;
    this.hud.toast('⚠ 我軍遭到攻擊！（空白鍵跳過去）', 2500);
    this.advisor.say('attack');
    sfx.play('alert', 5);
    this.lastAlertPos = [x, z];
  }

  lastAlertPos: [number, number] | null = null;

  jumpToAlert(): void {
    if (this.lastAlertPos) this.cam.lookAt(this.lastAlertPos[0], this.lastAlertPos[1]);
  }

  /** 畫面附近有兵出手就播刀劍／箭聲（有冷卻，不會太吵） */
  private battleSounds(): void {
    if (this.replaying) return;
    const w = this.sim.world;
    const t = this.sim.tick - 1;
    let melee = false;
    let ranged = false;
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.lastHit[id] !== t || !this.units.seen[id]) continue;
      if (UNIT_DEFS[w.utype[id]].rangeFx > 0) ranged = true;
      else melee = true;
      if (melee && ranged) break;
    }
    if (melee) sfx.play('hit', 0.12);
    if (ranged) sfx.play('arrow', 0.2);
  }

  // ───────── 選單、存讀檔、結算 ─────────

  private addMenuButton(container: HTMLElement): void {
    const b = document.createElement('button');
    b.id = 'menu-btn';
    b.textContent = '☰';
    b.title = '選單（Esc）';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openMenu();
    });
    container.appendChild(b);
  }

  private devQuery(prefix: string): string {
    return new URLSearchParams(location.search).has('dev') ? `${prefix}dev=1` : '';
  }

  openMenu(): void {
    if (this.menuClose) {
      this.closeMenu();
      return;
    }
    this.paused = true;
    sfx.play('click');
    this.menuClose = showPauseMenu(document.body, {
      resume: () => this.closeMenu(),
      save: () => {
        this.hud.toast(writeSave(SAVE_KEY, this.saveData()) ? '已存檔' : '存檔失敗（瀏覽器不允許寫入）');
        this.closeMenu();
      },
      load: () => {
        location.href = `${location.pathname}?load=1${this.devQuery('&')}`;
      },
      settings: () => {
        showSettings(
          document.body,
          { vol: sfx.vol, quality: this.stage.quality, advisor: this.advisor.enabled },
          {
            volume: (k, v) => sfx.setVolume(k, v),
            quality: (q) => {
              this.setQuality(q as Quality);
              try {
                localStorage.setItem('empiresGame.quality', q);
              } catch {
                /* 忽略 */
              }
            },
            advisor: (on) => this.advisor.setEnabled(on),
            close: () => {},
          },
        );
      },
      resign: () => {
        if (!window.confirm('確定要投降嗎？')) return;
        this.closeMenu();
        this.sim.issue({ t: 'resign', player: this.myPlayer });
      },
      menu: () => {
        location.href = `${location.pathname}${this.devQuery('?')}`;
      },
    });
  }

  closeMenu(): void {
    this.menuClose?.();
    this.menuClose = null;
    this.paused = false;
  }

  get menuOpen(): boolean {
    return this.menuClose !== null;
  }

  saveData(): SaveData {
    return { v: 1, setup: this.setup, tick: this.sim.tick, history: this.sim.history, savedAt: new Date().toISOString() };
  }

  /** 讀檔：把指令紀錄重播到存檔時的 tick（分批跑，不卡畫面） */
  async replay(history: Command[], tick: number): Promise<void> {
    this.replaying = true;
    for (const c of history) this.sim.issue(structuredClone(c), c.tick - this.sim.tick);
    const ld = showLoading(document.body, '讀取戰局中…');
    while (this.sim.tick < tick) {
      const end = Math.min(tick, this.sim.tick + 400);
      while (this.sim.tick < end) this.sim.step();
      ld.set(`讀取戰局中… ${Math.floor((this.sim.tick / Math.max(1, tick)) * 100)}%`);
      await new Promise((r) => setTimeout(r, 0));
    }
    this.sim.events.length = 0;
    this.lastAutosave = this.sim.tick;
    // 讀檔驗證用：重播結束當下的 tick 與狀態雜湊
    this.replayCheck = { tick: this.sim.tick, hash: this.sim.hash() };
    ld.close();
    this.replaying = false;
    this.goHome();
  }

  /** DEV：預覽結算畫面（不結束遊戲） */
  previewGameOver(win: boolean, reason: string): void {
    this.gameOver(win, reason, true);
  }

  private gameOver(win: boolean, reason = 'conquest', preview = false): void {
    if (!preview) this.over = true;
    sfx.play(win ? 'win' : 'lose');
    const me = this.sim.players[this.myPlayer];
    const en = this.sim.players[1];
    const ages = ['', '黃巾亂世', '群雄割據', '三分天下', '天下一統'];
    const sec = Math.floor(this.sim.tick / 10);
    const rows: [string, string, string][] = [
      ['時間', `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`, ''],
      ['時代', ages[me.age], ages[en.age]],
      ['訓練單位', String(me.stats.trained), String(en.stats.trained)],
      ['擊殺', String(me.stats.kills), String(en.stats.kills)],
      ['損失', String(me.stats.lost), String(en.stats.lost)],
      ['摧毀建築', String(me.stats.razed), String(en.stats.razed)],
      ['研究科技', String(me.stats.researched), String(en.stats.researched)],
      ...me.gathered.map((v, k) => [`採集${RES_NAMES[k]}`, String(v), String(en.gathered[k])] as [string, string, string]),
    ];
    showGameOver(document.body, win, rows, {
      again: () => {
        location.href = `${location.pathname}${setupQuery({ ...this.setup, seed: (Math.random() * 1e9) | 0 })}`;
      },
      menu: () => {
        location.href = `${location.pathname}${this.devQuery('?')}`;
      },
      watch: () => {},
    }, reason);
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
    this.targeting = null;
    this.hud.card.reset();
  }

  selectAt(sx: number, sy: number, additive: boolean): void {
    if (this.placing) return;
    const id = this.pickUnit(sx, sy, 18);
    const w = this.sim.world;
    if (id >= 0) sfx.play('select');
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
    if (this.targeting) {
      this.commandAt(sx, sy, false);
      return;
    }
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
    const sim = this.sim;
    if (this.targeting) {
      const tg = this.targeting;
      this.targeting = null;
      const p = this.cam.groundAt(sx, sy);
      if (!p) return;
      const x = Math.round(p.x * ONE);
      const y = Math.round(p.z * ONE);
      if (tg.kind === 'skill') sim.issue({ t: 'skill', player: this.myPlayer, id: tg.id, x, y });
      else if (tg.kind === 'stratagem') sim.issue({ t: 'stratagem', player: this.myPlayer, kind: tg.name, x, y });
      else sim.issue({ t: 'unload', player: this.myPlayer, ship: tg.ship, x, y });
      this.markers.ping(p.x, p.y, p.z, 0xf0c040);
      return;
    }
    const ids = this.ownSelected();
    if (!ids.length) return;
    const p = this.cam.groundAt(sx, sy);
    if (!p) return;
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
    if (u >= 0 && sim.world.owner[u] === this.myPlayer && UNIT_DEFS[sim.world.utype[u]].capacity && !ids.includes(u)) {
      sim.issue({ t: 'board', player: this.myPlayer, ids, ship: u });
      this.markers.ping(this.units.wx[u], this.units.wy[u], this.units.wz[u], 0x5ab4ff);
      return;
    }
    const item = this.pickItem(p.x, p.z);
    if (item >= 0 && ids.some((id) => sim.world.utype[id] === UNIT_INDEX.strategist)) {
      sim.issue({ t: 'pickup', player: this.myPlayer, ids, item });
      this.markers.ping(p.x, p.y, p.z, 0xf0c040);
      return;
    }
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

  /** 地上的兵書／玉璽（點選半徑 1.2 格） */
  pickItem(x: number, z: number): number {
    const items = this.sim.abilities.items;
    let best = -1;
    let bestD = 1.44;
    items.forEach((it, k) => {
      if (it.carrier >= 0 || it.academy >= 0) return;
      const dx = it.x / ONE - x;
      const dz = it.y / ONE - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  }

  /** 武將技：自身範圍的直接放，指定地點的進入選點模式 */
  castSkill(id: number): void {
    const sk = SKILLS[UNIT_DEFS[this.sim.world.utype[id]].id];
    if (!sk) return;
    if (sk.target === 'self') {
      this.sim.issue({ t: 'skill', player: this.myPlayer, id, x: this.sim.world.x[id], y: this.sim.world.y[id] });
      return;
    }
    this.targeting = { kind: 'skill', id };
    this.hud.toast(`${sk.name}：點選目標地點`);
  }

  castStratagem(name: string): void {
    const st = STRATAGEMS[name];
    if (!st) return;
    if (st.target === 'none') {
      this.sim.issue({ t: 'stratagem', player: this.myPlayer, kind: name, x: 0, y: 0 });
      return;
    }
    this.targeting = { kind: 'stratagem', name };
    this.hud.toast(`${st.name}：點選地點`);
  }

  unloadShip(ship: number): void {
    this.targeting = { kind: 'unload', ship };
    this.hud.toast('卸兵：點選要靠岸的地點');
  }

  /** 民夫分配助手：各資源的民夫人數 [糧, 木, 金, 石, 建造, 閒置] */
  villagerCounts(): number[] {
    const sim = this.sim;
    const w = sim.world;
    const out = [0, 0, 0, 0, 0, 0];
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.owner[id] !== this.myPlayer || w.state[id] === S.Dead || !UNIT_DEFS[w.utype[id]].worker) continue;
      const k = this.villagerJob(id);
      out[k]++;
    }
    return out;
  }

  private villagerJob(id: number): number {
    const sim = this.sim;
    const w = sim.world;
    switch (w.task[id]) {
      case 1:
        return sim.res.alive[w.target[id]] ? RESOURCE_KINDS[sim.res.kind[w.target[id]]].res : 5;
      case 2:
        return 0;
      case 3:
        return w.carryRes[id];
      case 4:
        return 4;
      default:
        return 5;
    }
  }

  /** 派一名民夫去採某種資源：先找閒置的，否則從人最多的資源抽一個 */
  assignVillager(res: number): void {
    const sim = this.sim;
    const w = sim.world;
    const counts = this.villagerCounts();
    let from = 5;
    if (!counts[5]) {
      let most = -1;
      for (let k = 0; k < 4; k++) if (k !== res && counts[k] > most) {
        most = counts[k];
        from = k;
      }
      if (most <= 0) return this.hud.toast('沒有可以調動的民夫');
    }
    let vid = -1;
    for (let id = 0; id < w.high && vid < 0; id++) {
      if (w.alive[id] && w.owner[id] === this.myPlayer && w.state[id] !== S.Dead && UNIT_DEFS[w.utype[id]].worker && this.villagerJob(id) === from) vid = id;
    }
    if (vid < 0) return;
    const bs = sim.buildings;
    // 糧：先找空的農田
    if (res === 0) {
      let best = -1;
      let bd = Infinity;
      for (let b = 0; b < bs.high; b++) {
        if (!bs.alive[b] || !bs.complete[b] || bs.owner[b] !== this.myPlayer || BUILDING_DEFS[bs.btype[b]].id !== 'farm' || bs.farmer[b] >= 0) continue;
        const d = (bs.centerX(b) - w.x[vid]) ** 2 + (bs.centerY(b) - w.y[vid]) ** 2;
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (best >= 0) {
        sim.issue({ t: 'work', player: this.myPlayer, ids: [vid], building: best });
        this.hud.toast(`派 1 名民夫去耕田（糧 ${counts[0] + 1}）`);
        return;
      }
    }
    const kinds = res === 0 ? [RK.berry, RK.deer, RK.boar] : res === 1 ? [RK.tree] : res === 2 ? [RK.gold] : [RK.stone];
    const drop = sim.nearestDrop(this.myPlayer, res, w.x[vid], w.y[vid]);
    const cx = drop >= 0 ? bs.centerX(drop) : w.x[vid];
    const cy = drop >= 0 ? bs.centerY(drop) : w.y[vid];
    let r = sim.findResource(kinds, cx, cy, 14, w.x[vid], w.y[vid]);
    if (r < 0) r = sim.findResource(kinds, cx, cy, 40, w.x[vid], w.y[vid]);
    if (r < 0) return this.hud.toast(`附近找不到${RES_NAMES[res]}${res === 0 ? '（請蓋農田）' : ''}`);
    sim.issue({ t: 'gather', player: this.myPlayer, ids: [vid], res: r });
    this.hud.toast(`派 1 名民夫去採${RES_NAMES[res]}（${counts[res] + 1} 人）`);
  }

  trade(res: number, buy: boolean): void {
    this.sim.issue({ t: 'trade', player: this.myPlayer, res, buy });
    sfx.play('click');
  }

  issueMove(x: number, z: number): void {
    const ids = this.ownSelected();
    if (!ids.length) return;
    sfx.play('command');
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

  research(b: number, tech: number): void {
    this.sim.issue({ t: 'research', player: this.myPlayer, building: b, tech });
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
    if (!pl.valid && this.sim.players[this.myPlayer].canAfford(this.sim.players[this.myPlayer].buildingCost(btype))) {
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
    pl.valid = (this.sim.canPlace(pl.btype, pl.tx, pl.ty) || !!pl.lineStart) && this.sim.players[this.myPlayer].canAfford(this.sim.players[this.myPlayer].buildingCost(pl.btype));
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
      this.hud.toast(this.sim.players[this.myPlayer].canAfford(this.sim.players[this.myPlayer].buildingCost(pl.btype)) ? '這裡不能蓋' : '資源不足');
      return;
    }
    const ids = this.ownSelected().filter((id) => UNIT_DEFS[this.sim.world.utype[id]].worker);
    this.sim.issue({ t: 'build', player: this.myPlayer, ids, btype: pl.btype, tx: pl.tx, ty: pl.ty });
    sfx.play('build');
    const def = BUILDING_DEFS[pl.btype];
    this.markers.ping(pl.tx + def.w / 2, this.terrain.heightAt(pl.tx + def.w / 2, pl.ty + def.h / 2), pl.ty + def.h / 2, 0xffe14a);
    const bc = this.sim.players[this.myPlayer].buildingCost(pl.btype);
    if (keep && this.sim.players[this.myPlayer].canAfford([bc[0] * 2, bc[1] * 2, bc[2] * 2, bc[3] * 2])) {
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
