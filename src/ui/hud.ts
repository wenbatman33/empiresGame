// HUD：資源列、小地圖、選取面板、左側按鈕、框選框、提示訊息
// 版面數值來自 layout.ts，DEV 工具可直接拖曳
import { PLAYER_COLORS } from '../config';
import { UNIT_DEFS } from '../sim/core/world';
import type { Game } from '../game';
import { applyBox, HUD_KEYS, LAYOUTS, type HudKey } from './layout';

const AGE_NAMES = ['黃巾亂世', '群雄割據', '三分天下', '天下一統'];

export class Hud {
  readonly root: HTMLElement;
  readonly els = {} as Record<HudKey, HTMLElement>;
  private boxEl: HTMLElement;
  private toastEl: HTMLElement;
  private topText: HTMLElement;
  private selBody: HTMLElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private miniTerrain: HTMLCanvasElement;
  private miniTimer = 0;
  private selSig = '';
  private toastTimer = 0;
  private boxBtn: HTMLButtonElement;

  constructor(container: HTMLElement, private game: Game) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    container.appendChild(this.root);

    // 資源列
    const top = this.panel('topbar');
    this.topText = document.createElement('div');
    this.topText.className = 'top-row';
    top.appendChild(this.topText);

    // 小地圖
    const mm = this.panel('minimap');
    this.mini = document.createElement('canvas');
    mm.appendChild(this.mini);
    this.miniCtx = this.mini.getContext('2d')!;
    this.miniTerrain = this.buildMiniTerrain();
    this.bindMinimap();

    // 選取面板
    const sel = this.panel('selection');
    this.selBody = document.createElement('div');
    this.selBody.className = 'sel-body';
    sel.appendChild(this.selBody);

    // 左側按鈕
    const lb = this.panel('leftbar');
    this.boxBtn = this.button(lb, '框選', '框選模式：單指拖曳就是框選', () => {
      game.controls.boxToggle = !game.controls.boxToggle;
      this.boxBtn.classList.toggle('on', game.controls.boxToggle);
    });
    this.button(lb, '閒置', '選取閒置的民夫（PC：. 鍵）', () => game.selectIdleVillager());
    this.button(lb, '全軍', '選取所有我方軍隊', () => game.selectArmy());
    this.button(lb, '回城', '鏡頭回到起始點（PC：H 鍵）', () => game.goHome());
    this.button(lb, '取消', '取消選取（PC：Esc）', () => game.clearSelection());

    this.boxEl = document.createElement('div');
    this.boxEl.className = 'sel-box';
    this.root.appendChild(this.boxEl);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.root.appendChild(this.toastEl);

    const rot = document.createElement('div');
    rot.className = 'rotate-hint';
    rot.innerHTML = '<div>📱↻</div><div>請把手機轉成橫向</div>';
    this.root.appendChild(rot);

    this.applyLayout();
  }

  private panel(key: HudKey): HTMLElement {
    const el = document.createElement('div');
    el.className = `hud-panel hud-${key}`;
    el.dataset.hud = key;
    this.root.appendChild(el);
    this.els[key] = el;
    return el;
  }

  private button(parent: HTMLElement, label: string, title: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'hud-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    parent.appendChild(b);
    return b;
  }

  applyLayout(): void {
    const L = LAYOUTS[this.game.layoutMode];
    for (const k of HUD_KEYS) applyBox(this.els[k], L[k]);
    this.root.dataset.layout = this.game.layoutMode;
    this.boxBtn.style.display = this.game.layoutMode === 'pc' ? 'none' : '';
    this.resizeMinimap();
    this.selSig = '';
  }

  private resizeMinimap(): void {
    const b = LAYOUTS[this.game.layoutMode].minimap;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.mini.width = Math.round(b.w * dpr);
    this.mini.height = Math.round(b.h * dpr);
  }

  showBox(x0: number, y0: number, x1: number, y1: number): void {
    const s = this.boxEl.style;
    s.display = 'block';
    s.left = `${Math.min(x0, x1)}px`;
    s.top = `${Math.min(y0, y1)}px`;
    s.width = `${Math.abs(x1 - x0)}px`;
    s.height = `${Math.abs(y1 - y0)}px`;
  }

  hideBox(): void {
    this.boxEl.style.display = 'none';
  }

  toast(msg: string, ms = 1800): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  update(dt: number): void {
    const g = this.game;
    const sim = g.sim;
    const w = sim.world;
    let pop = 0;
    for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === g.myPlayer) pop++;
    const sec = Math.floor(sim.tick / 10);
    const time = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    const compact = g.layoutMode === 'mobile';
    this.topText.innerHTML = [
      `<span>🌾${compact ? '' : ' 糧'} 200</span>`,
      `<span>🪵${compact ? '' : ' 木'} 200</span>`,
      `<span>🪙${compact ? '' : ' 金'} 100</span>`,
      `<span>🪨${compact ? '' : ' 石'} 150</span>`,
      `<span>👥 ${pop}/125</span>`,
      `<span class="age">${AGE_NAMES[0]}</span>`,
      `<span>⏱ ${time}</span>`,
      g.paused ? '<span class="paused">暫停</span>' : '',
    ].join('');

    this.updateSelection();
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 0.2;
      this.drawMinimap();
    }
  }

  private updateSelection(): void {
    const g = this.game;
    const w = g.sim.world;
    const counts = new Map<number, number>();
    let owner = -1;
    let single = -1;
    for (const id of g.selected) {
      counts.set(w.utype[id], (counts.get(w.utype[id]) ?? 0) + 1);
      owner = w.owner[id];
      single = id;
    }
    const sig = `${g.selected.size}|${[...counts].join(',')}|${single >= 0 ? w.hp[single] : ''}|${g.layoutMode}`;
    if (sig === this.selSig) return;
    this.selSig = sig;
    if (!g.selected.size) {
      this.selBody.innerHTML =
        g.layoutMode === 'pc'
          ? '<div class="hint">左鍵點選或拖曳框選 · 右鍵移動 · 雙擊選同類 · WASD／邊緣捲動 · 滾輪縮放</div>'
          : '<div class="hint">點兵選取 · 長按拖曳框選 · 點地面移動 · 雙指縮放</div>';
      return;
    }
    const color = PLAYER_COLORS[owner] ?? '#fff';
    if (g.selected.size === 1) {
      const def = UNIT_DEFS[w.utype[single]];
      const pct = Math.max(0, Math.min(100, (w.hp[single] / def.hp) * 100));
      this.selBody.innerHTML = `<div class="sel-one"><span class="dot" style="background:${color}"></span><b>${def.name}</b><span class="hp"><i style="width:${pct}%"></i></span><span>${w.hp[single]}/${def.hp}</span></div>`;
      return;
    }
    const chips = [...counts]
      .sort((a, b) => a[0] - b[0])
      .map(([t, n]) => `<button class="chip" data-type="${t}">${UNIT_DEFS[t].name} ×${n}</button>`)
      .join('');
    this.selBody.innerHTML = `<div class="sel-many"><span class="dot" style="background:${color}"></span><b>${g.selected.size} 名</b>${chips}</div>`;
    this.selBody.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        g.keepOnlyType(Number(b.dataset.type));
      }),
    );
  }

  // ───────── 小地圖 ─────────

  private buildMiniTerrain(): HTMLCanvasElement {
    const map = this.game.sim.map;
    const c = document.createElement('canvas');
    c.width = map.w;
    c.height = map.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(map.w, map.h);
    const rgb = this.game.terrain.tileRgb;
    for (let i = 0; i < map.w * map.h; i++) {
      img.data[i * 4] = rgb[i * 3];
      img.data[i * 4 + 1] = rgb[i * 3 + 1];
      img.data[i * 4 + 2] = rgb[i * 3 + 2];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private drawMinimap(): void {
    const g = this.game;
    const ctx = this.miniCtx;
    const W = this.mini.width;
    const H = this.mini.height;
    const map = g.sim.map;
    const sx = W / map.w;
    const sy = H / map.h;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniTerrain, 0, 0, W, H);
    const w = g.sim.world;
    const dot = Math.max(2, Math.round(W / 90));
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id]) continue;
      ctx.fillStyle = g.selected.has(id) ? '#ffffff' : PLAYER_COLORS[w.owner[id]];
      ctx.fillRect(g.units.wx[id] * sx - dot / 2, g.units.wz[id] * sy - dot / 2, dot, dot);
    }
    // 鏡頭視野四邊形
    const r = g.stage.renderer.domElement.getBoundingClientRect();
    const corners = [
      [r.left, r.top],
      [r.right, r.top],
      [r.right, r.bottom],
      [r.left, r.bottom],
    ].map(([x, y]) => g.cam.groundAt(x, y));
    if (corners.every((p) => p)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, W / 120);
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p!.x * sx, p!.z * sy) : ctx.moveTo(p!.x * sx, p!.z * sy)));
      ctx.closePath();
      ctx.stroke();
    }
  }

  private bindMinimap(): void {
    let dragging = false;
    const toWorld = (e: PointerEvent): [number, number] => {
      const r = this.mini.getBoundingClientRect();
      const map = this.game.sim.map;
      return [((e.clientX - r.left) / r.width) * map.w, ((e.clientY - r.top) / r.height) * map.h];
    };
    this.mini.addEventListener('contextmenu', (e) => e.preventDefault());
    this.mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const [x, z] = toWorld(e);
      if (e.button === 2) {
        this.game.issueMove(x, z);
        return;
      }
      dragging = true;
      try {
        this.mini.setPointerCapture(e.pointerId);
      } catch {
        /* 略過 */
      }
      this.game.cam.lookAt(x, z);
    });
    this.mini.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const [x, z] = toWorld(e);
      this.game.cam.lookAt(x, z);
    });
    const end = () => (dragging = false);
    this.mini.addEventListener('pointerup', end);
    this.mini.addEventListener('pointercancel', end);
  }
}
