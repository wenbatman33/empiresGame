// DEV 微調工具（docs/07 §9；全域開發準則：可拖曳、即時生效、可匯出）
// 開啟：網址加 ?dev=1，按 ` 或 F2，或點右下角齒輪
import GUI, { type Controller } from 'lil-gui';
import * as THREE from 'three';
import { CAMERA, LIGHT, UNIT_LOOK, type Quality } from '../config';
import type { Game } from '../game';
import type { AnimName } from '../models/soldier';
import { ONE } from '../sim/core/fixed';
import { NAV, UNIT_DEFS } from '../sim/core/world';
import { PASS_BLOCKED, PASS_SHALLOW } from '../sim/map/grid';
import { Sim } from '../sim/sim';
import { EconomyBot } from '../ai/economyBot';
import { applyBox, detectLayout, HUD_KEYS, HUD_NAMES, LAYOUTS, type Anchor, type HudBox, type HudKey, type LayoutMode } from '../ui/layout';

const STORE = 'empiresGame.dev';

interface Persisted {
  v?: number;
  camera?: Partial<typeof CAMERA>;
  light?: Partial<typeof LIGHT>;
  unitLook?: Partial<typeof UNIT_LOOK>;
  layouts?: Partial<Record<LayoutMode, Partial<Record<HudKey, Partial<HudBox>>>>>;
  quality?: Quality;
  layoutMode?: LayoutMode | 'auto';
}

export class DevTools {
  private gui: GUI;
  private saveTimer = 0;
  private fpsEl: HTMLElement;
  private perf = { fps: 0, 幀時間ms: 0, 模擬每tickMs: 0, 每秒tick: 0, 單位數: 0, drawCalls: 0, 三角形: 0, 樹木: 0, 尋路節點: 0, flowField數: 0, 解析度倍率: 0 };
  private view = {
    quality: 'high' as Quality,
    layoutMode: 'auto' as LayoutMode | 'auto',
    editLayout: 'pc' as LayoutMode,
    hudKey: 'topbar' as HudKey,
    drag: false,
    anim: 'auto' as AnimName | 'auto',
    spawnType: 'spearman',
    spawnPlayer: 0,
    spawnCount: 50,
    passOverlay: false,
    flowArrows: false,
    paths: false,
  };
  private hudFolder: GUI;
  private flowLines: THREE.LineSegments | null = null;
  private flowRef: unknown = null;
  private pathLines: THREE.LineSegments;
  private pathTimer = 0;
  private lastNodes = 0;

  /** 在建立 Game 之前套用上次存下的微調 */
  static applyPersisted(): Persisted {
    let p: Persisted = {};
    try {
      p = JSON.parse(localStorage.getItem(STORE) || '{}');
    } catch {
      /* 忽略壞掉的存檔 */
    }
    if (p.camera) Object.assign(CAMERA, p.camera);
    if (p.light) Object.assign(LIGHT, p.light);
    if (p.unitLook) Object.assign(UNIT_LOOK, p.unitLook);
    if (p.layouts) {
      for (const mode of Object.keys(p.layouts) as LayoutMode[]) {
        for (const key of HUD_KEYS) {
          const src = p.layouts[mode]?.[key];
          if (src) Object.assign(LAYOUTS[mode][key], src);
        }
      }
    }
    return p;
  }

  constructor(private game: Game, persisted: Persisted) {
    this.view.quality = game.stage.quality;
    if (persisted.layoutMode && persisted.layoutMode !== 'auto') {
      this.view.layoutMode = persisted.layoutMode;
      game.layoutLocked = true;
      game.setLayout(persisted.layoutMode);
    }
    this.view.editLayout = game.layoutMode;

    this.gui = new GUI({ title: '🛠 DEV 微調工具（` 或 F2 開關）' });
    this.gui.domElement.classList.add('dev-gui');
    this.gui.hide();

    this.buildPerf();
    this.buildStress();
    this.buildSim();
    this.buildCamera();
    this.buildLight();
    this.buildAnim();
    this.buildOverlays();
    this.hudFolder = this.gui.addFolder('HUD 版面（可直接拖曳）');
    this.buildHud();
    this.gui.add({ 匯出: () => this.export() }, '匯出').name('💾 匯出 JSON（下載＋複製）');
    this.gui.add({ 重設: () => this.reset() }, '重設').name('↺ 重設所有微調');

    // 角落 FPS 與齒輪
    this.fpsEl = document.createElement('div');
    this.fpsEl.id = 'dev-fps';
    document.body.appendChild(this.fpsEl);
    const gear = document.createElement('button');
    gear.id = 'dev-gear';
    gear.textContent = '⚙';
    gear.title = 'DEV 微調工具';
    gear.addEventListener('click', () => this.toggle());
    document.body.appendChild(gear);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' || e.code === 'F2') {
        e.preventDefault();
        this.toggle();
      }
    });

    this.pathLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x00e5ff, depthTest: false, transparent: true }));
    this.pathLines.renderOrder = 5;
    this.pathLines.frustumCulled = false;
    game.stage.scene.add(this.pathLines);
    this.bindHudDrag();
    game.onFrame.push((dt) => this.tick(dt));
  }

  private shown = false;

  private toggle(): void {
    this.shown = !this.shown;
    this.gui.show(this.shown);
  }

  // ───────── 面板 ─────────

  private buildPerf(): void {
    const f = this.gui.addFolder('效能');
    for (const k of Object.keys(this.perf)) f.add(this.perf, k as keyof typeof this.perf).listen().disable();
  }

  private buildStress(): void {
    const g = this.game;
    const f = this.gui.addFolder('壓測與生兵');
    for (const n of [100, 300, 600, 800]) f.add({ go: () => g.stressBattle(n) }, 'go').name(`⚔ 兩軍對衝 ${n} 人`);
    f.add(this.view, 'spawnType', Object.fromEntries(UNIT_DEFS.map((u) => [u.name, u.id]))).name('兵種');
    f.add(this.view, 'spawnPlayer', { 我軍: 0, 敵軍: 1 }).name('陣營');
    f.add(this.view, 'spawnCount', 1, 300, 1).name('數量');
    f.add({ go: () => g.spawnAtCamera(this.view.spawnPlayer, UNIT_DEFS.findIndex((u) => u.id === this.view.spawnType), this.view.spawnCount) }, 'go').name('＋ 在鏡頭中心生成');
    f.add({ go: () => g.selectArmy() }, 'go').name('選取我方全軍');
    f.add({ go: () => g.sim.issue({ t: 'cheat', player: g.myPlayer, kind: 'res' }) }, 'go').name('💰 我方資源各 ＋1000');
    f.add({ go: () => g.sim.issue({ t: 'cheat', player: g.myPlayer, kind: 'build' }) }, 'go').name('⚡ 我方工地瞬間完工');
    f.add({ on: g.bots.length > 0 }, 'on').name('敵方經濟 AI').onChange((on: boolean) => {
      g.bots.length = 0;
      if (on) g.bots.push(new EconomyBot(g.sim, 1));
    });
    f.add({ go: () => g.sim.issue({ t: 'clear' }) }, 'go').name('🗑 清除全部單位');
  }

  private buildSim(): void {
    const g = this.game;
    const f = this.gui.addFolder('模擬');
    f.add(g, 'speed', 0.25, 8, 0.25).name('遊戲速度');
    f.add(g, 'paused').name('暫停').listen();
    f.add({ go: () => { g.paused = true; g.sim.step(); } }, 'go').name('單步 1 tick');
    f.add({ go: () => this.checkDeterminism() }, 'go').name('✔ 確定性檢查（重播比對）');
    f.add({ seed: g.sim.seed }, 'seed').name('地圖種子').disable();
    f.add({ go: () => { const u = new URL(location.href); u.searchParams.set('seed', String((Math.random() * 1e9) | 0)); location.href = u.toString(); } }, 'go').name('🎲 換一張地圖');
  }

  private buildCamera(): void {
    const f = this.gui.addFolder('鏡頭');
    f.close();
    const save = () => this.save();
    f.add(CAMERA, 'pitch', 30, 85, 1).name('俯角').onChange(save);
    f.add(CAMERA, 'fov', 20, 70, 1).name('FOV').onChange(save);
    f.add(CAMERA, 'minDist', 5, 40, 1).name('最近距離').onChange(save);
    f.add(CAMERA, 'maxDist', 30, 140, 1).name('最遠距離').onChange(save);
    f.add(CAMERA, 'startDistPc', 10, 80, 1).name('PC 初始距離').onChange(save);
    f.add(CAMERA, 'startDistMobile', 8, 60, 1).name('手機初始距離').onChange(save);
    f.add(CAMERA, 'panSpeed', 0.2, 3, 0.05).name('平移速度').onChange(save);
    f.add(CAMERA, 'edgeScroll').name('邊緣捲動').onChange(save);
    f.add(CAMERA, 'edgePx', 2, 40, 1).name('邊緣寬度 px').onChange(save);
    f.add(CAMERA, 'rotate').name('中鍵旋轉').onChange(save);
  }

  private buildLight(): void {
    const g = this.game;
    const f = this.gui.addFolder('光影與畫質');
    f.close();
    const apply = () => {
      g.stage.applyLight();
      this.save();
    };
    f.add(this.view, 'quality', { 低: 'low', 中: 'medium', 高: 'high' }).name('畫質').onChange((q: Quality) => {
      g.setQuality(q);
      this.save();
    });
    f.add(LIGHT, 'sunAzimuth', 0, 360, 1).name('太陽方位').onChange(apply);
    f.add(LIGHT, 'sunElevation', 10, 89, 1).name('太陽高度').onChange(apply);
    f.add(LIGHT, 'sunIntensity', 0, 6, 0.05).name('太陽強度').onChange(apply);
    f.addColor(LIGHT, 'sunColor').name('陽光顏色').onChange(apply);
    f.add(LIGHT, 'hemiIntensity', 0, 4, 0.05).name('環境光').onChange(apply);
    f.addColor(LIGHT, 'skyColor').name('天空色').onChange(apply);
    f.addColor(LIGHT, 'groundColor').name('地面反光').onChange(apply);
    f.addColor(LIGHT, 'fogColor').name('霧色').onChange(apply);
    f.add(LIGHT, 'fogNear', 10, 200, 1).name('霧起點').onChange(apply);
    f.add(LIGHT, 'fogFar', 50, 400, 1).name('霧終點').onChange(apply);
    f.add(LIGHT, 'exposure', 0.3, 2.5, 0.05).name('曝光').onChange(apply);
  }

  private buildAnim(): void {
    const f = this.gui.addFolder('單位動畫（VAT）');
    f.close();
    f.add(this.view, 'anim', { 自動: 'auto', 待機: 'idle', 走路: 'walk', 攻擊: 'attack', 倒地: 'die', 工作: 'work' })
      .name('強制播放')
      .onChange((a: AnimName | 'auto') => (this.game.units.forceAnim = a === 'auto' ? null : a));
    f.add(UNIT_LOOK, 'scale', 0.6, 2, 0.05).name('單位縮放').onChange(() => this.save());
    f.add(UNIT_LOOK, 'turnSpeed', 1, 30, 0.5).name('轉身速度').onChange(() => this.save());
  }

  private buildOverlays(): void {
    const g = this.game;
    const f = this.gui.addFolder('除錯疊加層');
    f.close();
    f.add(this.view, 'passOverlay').name('通行格網（紅＝擋、藍＝淺灘）').onChange((on: boolean) => {
      if (on) {
        const m = g.sim.map;
        g.terrain.paintOverlay((x, y) => {
          const p = m.pass[m.idx(x, y)];
          return p === PASS_BLOCKED ? [230, 50, 50, 150] : p === PASS_SHALLOW ? [60, 130, 255, 120] : null;
        });
      }
      g.terrain.setOverlayVisible(on);
    });
    f.add(this.view, 'flowArrows').name('最近的 Flow Field');
    f.add(this.view, 'paths').name('選取單位的路徑');
  }

  private buildHud(): void {
    const f = this.hudFolder;
    for (const c of [...f.controllers]) c.destroy();
    const g = this.game;
    f.add(this.view, 'layoutMode', { 自動: 'auto', PC: 'pc', 手機: 'mobile', 平板: 'tablet' })
      .name('目前版面')
      .onChange((m: LayoutMode | 'auto') => {
        g.layoutLocked = m !== 'auto';
        g.setLayout(m === 'auto' ? detectLayout() : m);
        this.view.editLayout = g.layoutMode;
        this.save();
        this.buildHud();
      });
    f.add(this.view, 'drag').name('拖曳模式（拖元件、拖右下角縮放）').onChange((on: boolean) => g.hud.root.classList.toggle('dev-drag', on));
    f.add(this.view, 'hudKey', Object.fromEntries(HUD_KEYS.map((k) => [HUD_NAMES[k], k]))).name('元件').onChange(() => this.buildHud());
    const b = LAYOUTS[g.layoutMode][this.view.hudKey];
    const apply = () => {
      applyBox(g.hud.els[this.view.hudKey], b);
      g.hud.applyLayout();
      this.save();
    };
    const anchors: Anchor[] = ['tl', 'tc', 'tr', 'cl', 'cr', 'bl', 'bc', 'br'];
    const ctrls: Controller[] = [
      f.add(b, 'anchor', anchors).name('錨點'),
      f.add(b, 'x', -800, 800, 1).name('x'),
      f.add(b, 'y', -600, 600, 1).name('y'),
      f.add(b, 'w', 20, 1400, 1).name('寬'),
      f.add(b, 'h', 16, 900, 1).name('高'),
      f.add(b, 'scale', 0.4, 2.5, 0.05).name('縮放'),
      f.add(b, 'fontSize', 8, 40, 1).name('字級'),
      f.addColor(b, 'color').name('文字色'),
      f.addColor(b, 'bg').name('底色'),
      f.add(b, 'opacity', 0, 1, 0.01).name('底色透明度'),
      f.add(b, 'z', 0, 100, 1).name('深度 z-index'),
      f.add(b, 'visible').name('顯示'),
    ];
    for (const c of ctrls) c.onChange(apply).listen();
    f.add({ t: `正在編輯：${g.layoutMode}` }, 't').name('版面').disable();
  }

  // ───────── HUD 拖曳 ─────────

  private bindHudDrag(): void {
    const g = this.game;
    let drag: { key: HudKey; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; resize: boolean } | null = null;
    g.hud.root.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.view.drag) return;
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-hud]');
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        const key = el.dataset.hud as HudKey;
        const b = LAYOUTS[g.layoutMode][key];
        const r = el.getBoundingClientRect();
        const resize = e.clientX > r.right - 18 && e.clientY > r.bottom - 18;
        drag = { key, sx: e.clientX, sy: e.clientY, ox: b.x, oy: b.y, ow: b.w, oh: b.h, resize };
        if (this.view.hudKey !== key) {
          this.view.hudKey = key;
          this.buildHud();
        }
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* 略過 */
        }
      },
      true,
    );
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const b = LAYOUTS[g.layoutMode][drag.key];
      const dx = (e.clientX - drag.sx) / b.scale;
      const dy = (e.clientY - drag.sy) / b.scale;
      if (drag.resize) {
        b.w = Math.max(20, Math.round(drag.ow + dx));
        b.h = Math.max(16, Math.round(drag.oh + dy));
      } else {
        const ddx = e.clientX - drag.sx;
        const ddy = e.clientY - drag.sy;
        b.x = Math.round(drag.ox + (b.anchor[1] === 'r' ? -ddx : ddx));
        b.y = Math.round(drag.oy + (b.anchor[0] === 'b' ? -ddy : ddy));
      }
      g.hud.applyLayout();
    });
    window.addEventListener('pointerup', () => {
      if (drag) this.save();
      drag = null;
    });
    // 拖曳模式下攔截點擊，避免誤按 HUD 按鈕
    g.hud.root.addEventListener('click', (e) => this.view.drag && e.stopPropagation(), true);
  }

  // ───────── 每幀 ─────────

  private tick(dt: number): void {
    const g = this.game;
    const info = g.stage.renderer.info;
    const p = this.perf;
    p.fps = g.stats.fps;
    p.幀時間ms = g.stats.frameMs;
    p.模擬每tickMs = g.stats.simMs;
    p.每秒tick = g.stats.ticks;
    p.單位數 = g.sim.world.count;
    p.drawCalls = info.render.calls;
    p.三角形 = info.render.triangles;
    p.樹木 = g.trees.count;
    p.flowField數 = g.sim.activeFlows;
    p.解析度倍率 = +g.stage.renderer.getPixelRatio().toFixed(2);
    this.pathTimer -= dt;
    if (this.pathTimer <= 0) {
      p.尋路節點 = g.sim.pf.nodesExpanded - this.lastNodes;
      this.lastNodes = g.sim.pf.nodesExpanded;
      this.pathTimer = 0.25;
      this.updatePaths();
    }
    this.fpsEl.textContent = `${p.fps} fps · ${p.單位數} 兵 · ${p.drawCalls} dc · 模擬 ${p.模擬每tickMs}ms`;
    this.updateFlowArrows();
  }

  private updateFlowArrows(): void {
    const g = this.game;
    const field = g.sim.lastFlow;
    if (!this.view.flowArrows || !field) {
      if (this.flowLines) this.flowLines.visible = false;
      return;
    }
    if (this.flowRef !== field) {
      this.flowRef = field;
      const m = g.sim.map;
      const DX = [0, 1, 0, -1, 1, 1, -1, -1];
      const DY = [-1, 0, 1, 0, -1, 1, 1, -1];
      const pts: number[] = [];
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const d = field.dir[y * m.w + x];
          if (d < 0) continue;
          const cx = x + 0.5;
          const cz = y + 0.5;
          const h = g.terrain.heightAt(cx, cz) + 0.08;
          const ex = cx + DX[d] * 0.42;
          const ez = cz + DY[d] * 0.42;
          pts.push(cx, h, cz, ex, h, ez);
        }
      }
      if (this.flowLines) {
        this.flowLines.geometry.dispose();
        g.stage.scene.remove(this.flowLines);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.flowLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.8 }));
      this.flowLines.frustumCulled = false;
      g.stage.scene.add(this.flowLines);
    }
    this.flowLines!.visible = true;
  }

  private updatePaths(): void {
    const g = this.game;
    const w = g.sim.world;
    const pts: number[] = [];
    if (this.view.paths) {
      let n = 0;
      for (const id of g.selected) {
        if (n++ > 60) break;
        let x = g.units.wx[id];
        let z = g.units.wz[id];
        const seg = (nx: number, nz: number) => {
          pts.push(x, g.terrain.heightAt(x, z) + 0.15, z, nx, g.terrain.heightAt(nx, nz) + 0.15, nz);
          x = nx;
          z = nz;
        };
        const path = w.paths[id];
        if (w.nav[id] === NAV.Path && path) for (let k = w.pathIdx[id]; k < path.length / 2; k++) seg(path[k * 2] / ONE, path[k * 2 + 1] / ONE);
        else if (w.nav[id] !== NAV.None) seg(w.goalX[id] / ONE, w.goalY[id] / ONE);
      }
    }
    this.pathLines.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.pathLines.geometry = geo;
  }

  // ───────── 確定性、存檔、匯出 ─────────

  private checkDeterminism(): void {
    const g = this.game;
    const target = g.sim.tick;
    const t0 = performance.now();
    const replay = new Sim({ seed: g.sim.seed, mapSize: g.sim.map.w });
    for (const c of g.sim.history) replay.issue(structuredClone(c), c.tick);
    while (replay.tick < target) replay.step();
    const ok = replay.hash() === g.sim.hash();
    const ms = Math.round(performance.now() - t0);
    const msg = ok ? `✔ 確定性 OK：重播 ${target} tick，雜湊一致（${ms}ms）` : `✘ 不一致！重播 ${replay.hash()} ≠ 目前 ${g.sim.hash()}`;
    g.hud.toast(msg, 3500);
    console.log(msg);
  }

  private snapshot(): Persisted {
    return {
      v: 1,
      camera: { ...CAMERA },
      light: { ...LIGHT },
      unitLook: { ...UNIT_LOOK },
      layouts: JSON.parse(JSON.stringify(LAYOUTS)),
      quality: this.view.quality,
      layoutMode: this.view.layoutMode,
    };
  }

  private save(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(this.snapshot()));
      } catch {
        /* 私密模式等情況寫不進去就算了 */
      }
    }, 300);
  }

  private export(): void {
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), ...this.snapshot() }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `empiresGame-dev-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    navigator.clipboard?.writeText(json).then(
      () => this.game.hud.toast('已下載並複製到剪貼簿，貼給 Claude 說「鎖定」即可'),
      () => this.game.hud.toast('已下載 JSON（剪貼簿無法寫入）'),
    );
  }

  private reset(): void {
    try {
      localStorage.removeItem(STORE);
    } catch {
      /* 忽略 */
    }
    location.reload();
  }
}
