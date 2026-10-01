// 圖示（docs/07 §8.2）：兵種、建築圖示「從遊戲內 3D 模型算圖」，風格和畫面完全一致；
// 武將用 AI 生成的頭像、計策用 AI 生成的圖示（public/assets/）。第一次用到才算，算完存成 data URL。
import * as THREE from 'three';
import { PLAYER_COLORS } from '../config';
import { buildingModel } from '../models/buildings';
import { buildSiege } from '../models/siege';
import { buildSoldier, SIEGE_KINDS, SOLDIER_SPECS } from '../models/soldier';
import { UNIT_DEFS } from '../sim/core/defs';

const SIZE = 96;
/** 素材路徑（GitHub Pages 有子路徑，用 Vite 的 BASE_URL） */
export const ASSET = (p: string): string => `${import.meta.env.BASE_URL}assets/${p}`;

class IconFactory {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  private cache = new Map<string, string>();
  private disposeTimer = 0;

  constructor() {
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x6a5a48, 1.6);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(hemi, sun);
  }

  private ensure(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(SIZE, SIZE, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      this.renderer = null;
    }
    return this.renderer;
  }

  /** 一陣子沒用就釋放 WebGL context（瀏覽器的 context 數量有限） */
  private scheduleDispose(): void {
    window.clearTimeout(this.disposeTimer);
    this.disposeTimer = window.setTimeout(() => {
      this.renderer?.dispose();
      this.renderer?.forceContextLoss();
      this.renderer = null;
    }, 4000);
  }

  private shoot(geo: THREE.BufferGeometry, yaw: number, pitch: number): string {
    const r = this.ensure();
    if (!r) return '';
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);
    // 依包圍盒自動取景
    const box = new THREE.Box3().setFromObject(mesh);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const rad = Math.max(size.x, size.y, size.z) * 0.62;
    const dist = rad / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.position.set(c.x, c.y + Math.sin(pitch) * dist, c.z + Math.cos(pitch) * dist);
    this.camera.lookAt(c);
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    this.scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    this.scheduleDispose();
    return url;
  }

  unit(id: string): string {
    const key = `u:${id}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const team = new THREE.Color(PLAYER_COLORS[0]);
    const siege = SIEGE_KINDS[id];
    const m = siege ? buildSiege(id, siege) : buildSoldier(SOLDIER_SPECS[id] ?? SOLDIER_SPECS.swordsman);
    const col = new Float32Array(m.color.length);
    for (let i = 0; i < m.vertexCount; i++) {
      const k = m.mask[i];
      col[i * 3] = m.color[i * 3] * (1 - k) + team.r * k;
      col[i * 3 + 1] = m.color[i * 3 + 1] * (1 - k) + team.g * k;
      col[i * 3 + 2] = m.color[i * 3 + 2] * (1 - k) + team.b * k;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.position.slice(), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const url = this.shoot(geo, siege === 'ship' ? 2.3 : 0.5, siege ? 0.6 : 0.25);
    this.cache.set(key, url);
    return url;
  }

  building(id: string, age: number): string {
    const key = `b:${id}:${age}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const team = new THREE.Color(PLAYER_COLORS[0]);
    const geo = buildingModel(id, age);
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const mask = geo.getAttribute('aMask') as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) {
      const k = mask.getX(i);
      col.setXYZ(i, col.getX(i) * (1 - k) + team.r * k, col.getY(i) * (1 - k) + team.g * k, col.getZ(i) * (1 - k) + team.b * k);
    }
    // 台基往地下延伸的部分不要入鏡
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.05) pos.setY(i, -0.05);
    const url = this.shoot(geo, 0.6, 0.55);
    this.cache.set(key, url);
    return url;
  }
}

export const icons = new IconFactory();

/** 兵種圖示：武將用 AI 頭像，其他從 3D 模型算圖 */
export function unitIcon(id: string): string {
  if (UNIT_DEFS.find((u) => u.id === id)?.hero) return ASSET(`hero/${id}.png`);
  return icons.unit(id);
}

/** 圖示 HTML：圖片網址或 data URL 就用 <img>，否則當文字（emoji） */
export function iconHtml(icon: string, cls = ''): string {
  if (icon.startsWith('data:') || icon.includes('/')) return `<img class="icon-img ${cls}" src="${icon}" alt="" draggable="false" onerror="this.replaceWith('🌟')">`;
  return icon;
}
