// 渲染舞台：renderer、場景、相機、光照、畫質分級
import * as THREE from 'three';
import { LIGHT, QUALITY_PRESETS, type Quality } from '../config';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun = new THREE.DirectionalLight();
  readonly hemi = new THREE.HemisphereLight();
  quality: Quality;
  private shadowSpan = 30;

  constructor(private container: HTMLElement, quality: Quality) {
    this.quality = quality;
    const preset = QUALITY_PRESETS[quality];
    this.renderer = new THREE.WebGLRenderer({ antialias: preset.antialias, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'game-canvas';

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
    this.scene.add(this.camera);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.applyLight();
    this.applyQuality(quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  applyLight(): void {
    const L = LIGHT;
    this.sun.color.set(L.sunColor);
    this.sun.intensity = L.sunIntensity;
    this.hemi.color.set(L.skyColor);
    this.hemi.groundColor.set(L.groundColor);
    this.hemi.intensity = L.hemiIntensity;
    this.scene.background = new THREE.Color(L.fogColor);
    this.scene.fog = new THREE.Fog(L.fogColor, L.fogNear, L.fogFar);
    this.renderer.toneMappingExposure = L.exposure;
  }

  applyQuality(q: Quality): void {
    this.quality = q;
    const p = QUALITY_PRESETS[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.dpr));
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    if (this.sun.shadow.mapSize.x !== p.shadowMap) {
      this.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // 開關陰影需要重新編譯材質
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
    });
    this.resize();
  }

  /** 讓太陽與陰影範圍跟著鏡頭目標走 */
  followTarget(target: THREE.Vector3, viewDist: number): void {
    const az = THREE.MathUtils.degToRad(LIGHT.sunAzimuth);
    const el = THREE.MathUtils.degToRad(LIGHT.sunElevation);
    const d = 80;
    // 陰影貼圖對齊格點，鏡頭移動時影子邊緣才不會閃爍
    const span = Math.ceil(viewDist * 0.95);
    const texel = (span * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    this.sun.position.set(tx + Math.cos(el) * Math.sin(az) * d, target.y + Math.sin(el) * d, tz + Math.cos(el) * Math.cos(az) * d);
    this.sun.target.position.set(tx, target.y, tz);
    if (span !== this.shadowSpan) {
      this.shadowSpan = span;
      const cam = this.sun.shadow.camera;
      cam.left = -span;
      cam.right = span;
      cam.top = span;
      cam.bottom = -span;
      cam.near = 10;
      cam.far = 200;
      cam.updateProjectionMatrix();
    }
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

/** 依裝置猜初始畫質：觸控裝置用中、桌機用高（第一次啟動跑基準測試留到 M5） */
export function autoQuality(): Quality {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  return coarse ? 'medium' : 'high';
}
