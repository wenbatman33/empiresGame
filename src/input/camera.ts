// RTS 鏡頭（docs/01 §7）：目標點 ＋ 距離 ＋ 俯角 ＋ 可回彈的旋轉
import * as THREE from 'three';
import { CAMERA } from '../config';
import type { Terrain } from '../render/terrain';

export class RtsCamera {
  readonly target = new THREE.Vector3();
  dist: number;
  distGoal: number;
  /** 水平旋轉（度），放開後回彈到 0 */
  yaw = 0;
  rotating = false;
  /** 鍵盤平移方向（-1..1） */
  readonly keyPan = new THREE.Vector2();
  /** 滑鼠在畫面邊緣時的平移方向 */
  readonly edgePan = new THREE.Vector2();
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private terrain: Terrain,
    private mapW: number,
    private mapH: number,
    startDist: number,
  ) {
    this.dist = this.distGoal = startDist;
  }

  lookAt(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.clamp();
  }

  /** 以畫面方向平移（世界單位） */
  panWorld(dx: number, dz: number): void {
    const a = THREE.MathUtils.degToRad(this.yaw);
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.target.x += dx * c + dz * s;
    this.target.z += -dx * s + dz * c;
    this.clamp();
  }

  /** 直接位移目標點（觸控抓地拖曳用） */
  shift(dx: number, dz: number): void {
    this.target.x += dx;
    this.target.z += dz;
    this.clamp();
  }

  zoomBy(factor: number): void {
    this.distGoal = THREE.MathUtils.clamp(this.distGoal * factor, CAMERA.minDist, CAMERA.maxDist);
  }

  private clamp(): void {
    const m = 2;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -m, this.mapW + m);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -m, this.mapH + m);
  }

  update(dt: number): void {
    // 鍵盤與邊緣捲動：速度隨縮放距離變化
    const viewH = 2 * this.dist * Math.tan(THREE.MathUtils.degToRad(CAMERA.fov / 2));
    const speed = viewH * CAMERA.panSpeed * dt;
    const px = THREE.MathUtils.clamp(this.keyPan.x + this.edgePan.x, -1, 1);
    const pz = THREE.MathUtils.clamp(this.keyPan.y + this.edgePan.y, -1, 1);
    if (px || pz) this.panWorld(px * speed, pz * speed);
    this.dist += (this.distGoal - this.dist) * Math.min(1, dt * 10);
    if (!this.rotating && this.yaw !== 0) {
      this.yaw += (0 - this.yaw) * Math.min(1, dt * 6);
      if (Math.abs(this.yaw) < 0.05) this.yaw = 0;
    }
    this.target.y = this.terrain.heightAt(this.target.x, this.target.z);
    const p = THREE.MathUtils.degToRad(CAMERA.pitch);
    const a = THREE.MathUtils.degToRad(this.yaw);
    const horiz = Math.cos(p) * this.dist;
    this.camera.position.set(this.target.x + Math.sin(a) * horiz, this.target.y + Math.sin(p) * this.dist, this.target.z + Math.cos(a) * horiz);
    if (this.camera.fov !== CAMERA.fov) {
      this.camera.fov = CAMERA.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.target);
  }

  /** 螢幕座標 → 地面點（先打水平面，再用地形高度修正幾次） */
  groundAt(sx: number, sy: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const el = document.getElementById('game-canvas')!;
    const r = el.getBoundingClientRect();
    this.ndc.set(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    if (d.y >= -1e-4) return null;
    let h = this.target.y;
    for (let i = 0; i < 4; i++) {
      const t = (h - o.y) / d.y;
      out.set(o.x + d.x * t, h, o.z + d.z * t);
      h = this.terrain.heightAt(out.x, out.z);
    }
    out.y = h;
    return out;
  }
}
