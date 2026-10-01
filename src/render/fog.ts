// 戰爭迷霧渲染（docs/05 §5）：可視格網 → 貼圖，所有世界材質依貼圖調暗
// 未探索 ≈ 全黑、已探索 ≈ 半暗、可見 ＝ 原色；線性濾波讓邊緣柔和
import * as THREE from 'three';
import type { VisionSystem } from '../sim/systems/vision';

export const fogUniforms = {
  uFog: { value: null as THREE.DataTexture | null },
  uFogOn: { value: 1 },
  uFogMapSize: { value: new THREE.Vector2(128, 128) },
};

export class FogRenderer {
  readonly tex: THREE.DataTexture;
  private readonly data: Uint8Array;
  private version = -1;
  /** DEV：關掉迷霧（只影響畫面，不影響模擬） */
  enabled = true;

  constructor(private w: number, private h: number) {
    this.data = new Uint8Array(w * h);
    this.tex = new THREE.DataTexture(this.data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    fogUniforms.uFog.value = this.tex;
    fogUniforms.uFogMapSize.value.set(w, h);
  }

  update(vision: VisionSystem, player: number): void {
    fogUniforms.uFogOn.value = this.enabled ? 1 : 0;
    if (!this.enabled || vision.version === this.version) return;
    this.version = vision.version;
    const vis = vision.visible[player];
    const exp = vision.explored[player];
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] = vis[i] ? 255 : exp[i] ? 110 : 0;
    this.tex.needsUpdate = true;
  }

  /** 該格目前看得到嗎（關掉迷霧時一律看得到） */
  visible(vision: VisionSystem, player: number, tx: number, ty: number): boolean {
    if (!this.enabled) return true;
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return vision.visible[player][ty * this.w + tx] === 1;
  }

  explored(vision: VisionSystem, player: number, tx: number, ty: number): boolean {
    if (!this.enabled) return true;
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return vision.explored[player][ty * this.w + tx] === 1;
  }
}

/** 給材質加上迷霧（保留原本的 onBeforeCompile） */
export function withFog<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, fogUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uFogMapSize;\nvarying vec2 vFogUv;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vec4 fogWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fogWp = instanceMatrix * fogWp;
  #endif
  fogWp = modelMatrix * fogWp;
  vFogUv = fogWp.xz / uFogMapSize;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFog;\nuniform float uFogOn;\nvarying vec2 vFogUv;')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
  if (uFogOn > 0.5) {
    float fogV = texture2D(uFog, vFogUv).r;
    float fogK = fogV < 0.43 ? mix(0.05, 0.5, fogV / 0.43) : mix(0.5, 1.0, (fogV - 0.43) / 0.57);
    gl_FragColor.rgb *= fogK;
  }`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey()}|fog`;
  mat.needsUpdate = true;
  return mat;
}
