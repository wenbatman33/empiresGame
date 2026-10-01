// 輸入（docs/01 §4、§5）：滑鼠鍵盤與觸控手勢統一處理
import * as THREE from 'three';
import { CAMERA } from '../config';
import type { Game } from '../game';

interface Ptr {
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
  type: string;
}

type Mode = 'none' | 'pending' | 'box' | 'pan' | 'pinch' | 'rotate' | 'ignore';

const TAP_MOVE = 10;
const LONG_PRESS_MS = 300;
const DOUBLE_MS = 320;

export class Controls {
  /** 手機框選模式（左側按鈕切換）：開啟時單指拖曳＝框選 */
  boxToggle = false;
  private pointers = new Map<number, Ptr>();
  private mode: Mode = 'none';
  private longTimer = 0;
  private lastTap = { t: 0, x: 0, y: 0 };
  private lastClick = { t: 0, x: 0, y: 0 };
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };
  private keys = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false };
  private groupTap = { key: '', t: 0 };
  private readonly g0 = new THREE.Vector3();
  private readonly g1 = new THREE.Vector3();

  constructor(private game: Game, private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.inside = true;
    });
    document.addEventListener('mouseleave', () => (this.mouse.inside = false));
  }

  /** 每幀：鍵盤平移與邊緣捲動 */
  update(): void {
    const cam = this.game.cam;
    const k = this.keys;
    cam.keyPan.set(
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0),
    );
    cam.edgePan.set(0, 0);
    if (CAMERA.edgeScroll && this.mouse.inside && this.mode === 'none' && document.hasFocus() && this.game.layoutMode === 'pc') {
      const e = CAMERA.edgePx;
      const { x, y } = this.mouse;
      if (x >= 0 && x < e) cam.edgePan.x = -1;
      else if (x > window.innerWidth - e) cam.edgePan.x = 1;
      if (y >= 0 && y < e) cam.edgePan.y = -1;
      else if (y > window.innerHeight - e) cam.edgePan.y = 1;
    }
  }

  // ───────── 指標 ─────────

  private onDown = (e: PointerEvent): void => {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件沒有真的指標，略過 */
    }
    const p: Ptr = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), type: e.pointerType };
    this.pointers.set(e.pointerId, p);
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mode = 'pending';
      else if (e.button === 2) this.game.commandAt(e.clientX, e.clientY, e.shiftKey);
      else if (e.button === 1 && CAMERA.rotate) {
        this.mode = 'rotate';
        this.game.cam.rotating = true;
      }
      return;
    }
    // 觸控
    if (this.pointers.size === 1) {
      if (this.boxToggle) {
        this.mode = 'box';
      } else {
        this.mode = 'pending';
        window.clearTimeout(this.longTimer);
        this.longTimer = window.setTimeout(() => {
          if (this.mode !== 'pending') return;
          this.mode = 'box';
          navigator.vibrate?.(12);
          this.game.hud.showBox(p.sx, p.sy, p.x, p.y);
        }, LONG_PRESS_MS);
      }
    } else if (this.pointers.size === 2) {
      window.clearTimeout(this.longTimer);
      this.game.hud.hideBox();
      this.mode = 'pinch';
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else {
      this.mode = 'ignore';
    }
  };

  private onMove = (e: PointerEvent): void => {
    // 放置建築：滑鼠移動時預覽跟著走
    if (e.pointerType === 'mouse' && this.game.placing) this.game.updatePlacing(e.clientX, e.clientY);
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const px = p.x;
    const py = p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const moved = Math.hypot(p.x - p.sx, p.y - p.sy);
    const cam = this.game.cam;

    if (this.mode === 'rotate') {
      cam.yaw = THREE.MathUtils.clamp(cam.yaw + (p.x - px) * 0.3, -CAMERA.rotateLimit, CAMERA.rotateLimit);
      return;
    }
    if (this.mode === 'pending' && moved > (p.type === 'mouse' ? 6 : TAP_MOVE)) {
      window.clearTimeout(this.longTimer);
      this.mode = p.type === 'mouse' ? 'box' : 'pan';
    }
    if (this.mode === 'box') {
      this.game.hud.showBox(p.sx, p.sy, p.x, p.y);
    } else if (this.mode === 'pan') {
      // 抓地拖曳：手指下的地面點跟著手指走
      if (cam.groundAt(px, py, this.g0) && cam.groundAt(p.x, p.y, this.g1)) cam.shift(this.g0.x - this.g1.x, this.g0.z - this.g1.z);
    } else if (this.mode === 'pinch' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (d > 10 && this.pinchDist > 10) cam.zoomBy(this.pinchDist / d);
      if (cam.groundAt(this.pinchMid.x, this.pinchMid.y, this.g0) && cam.groundAt(mid.x, mid.y, this.g1)) cam.shift(this.g0.x - this.g1.x, this.g0.z - this.g1.z);
      this.pinchDist = d;
      this.pinchMid = mid;
    }
  };

  private onUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    window.clearTimeout(this.longTimer);
    if (!p) return;
    const g = this.game;
    if (this.mode === 'rotate') {
      g.cam.rotating = false;
      this.mode = 'none';
      return;
    }
    if (p.type === 'mouse' && e.button !== 0) return;
    if (this.mode === 'box') {
      g.hud.hideBox();
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 4) g.selectBox(p.sx, p.sy, p.x, p.y, e.shiftKey);
      this.mode = 'none';
      return;
    }
    if (this.mode === 'pending') {
      this.mode = 'none';
      const now = performance.now();
      if (p.type === 'mouse') {
        if (g.placing) {
          g.updatePlacing(p.x, p.y);
          g.confirmPlacing(e.shiftKey);
          return;
        }
        if (g.rallyMode) {
          g.setRallyAt(p.x, p.y);
          return;
        }
        const dbl = now - this.lastClick.t < DOUBLE_MS && Math.hypot(p.x - this.lastClick.x, p.y - this.lastClick.y) < 8;
        this.lastClick = { t: now, x: p.x, y: p.y };
        if (dbl) g.selectSameType(p.x, p.y);
        else g.selectAt(p.x, p.y, e.shiftKey);
      } else {
        const dbl = now - this.lastTap.t < DOUBLE_MS && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 24;
        this.lastTap = { t: now, x: p.x, y: p.y };
        if (dbl && g.pickUnit(p.x, p.y, 26) >= 0) g.selectSameType(p.x, p.y);
        else g.tapAt(p.x, p.y);
      }
      return;
    }
    if (this.pointers.size === 0) this.mode = 'none';
    else if (this.mode === 'pinch') this.mode = 'ignore';
  };

  private onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    window.clearTimeout(this.longTimer);
    this.game.hud.hideBox();
    this.game.cam.rotating = false;
    if (this.pointers.size === 0) this.mode = 'none';
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.game.cam.zoomBy(Math.exp(THREE.MathUtils.clamp(e.deltaY, -200, 200) * 0.0015));
  };

  // ───────── 鍵盤 ─────────

  private onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    this.keys.add(e.code);
    const g = this.game;
    if (!e.ctrlKey && !e.metaKey && !e.altKey && g.hud.card.handleKey(e.code)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape') g.clearSelection();
    else if (e.code === 'Delete') g.destroySelectedBuilding();
    else if (e.code === 'KeyH') g.goHome();
    else if (e.code === 'Period') g.selectIdleVillager();
    else if (e.code === 'KeyP') g.togglePause();
    else if (/^Digit[1-5]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        g.setGroup(n);
      } else {
        const now = performance.now();
        const again = this.groupTap.key === e.code && now - this.groupTap.t < 400;
        this.groupTap = { key: e.code, t: now };
        g.recallGroup(n, again);
      }
    }
  };
}
