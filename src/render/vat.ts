// VAT（頂點動畫貼圖，docs/07 §5）：把每個動畫每一格的頂點位置烘成浮點貼圖
// vertex shader 依實例屬性（動畫列、格數、起始時間、長度）取樣，一個兵種一次 draw call 畫完
import * as THREE from 'three';
import { siegePose } from '../models/siege';
import { ANIMS, ANIM_ORDER, poseAt, type AnimName, type ModelGeometry, type WeaponKind } from '../models/soldier';

export interface AnimRow {
  row: number;
  frames: number;
  dur: number;
  loop: boolean;
}

export interface BakedModel {
  geometry: THREE.BufferGeometry;
  texture: THREE.DataTexture;
  anims: Record<AnimName, AnimRow>;
  vertexCount: number;
}

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export function bakeVat(model: ModelGeometry, kind: WeaponKind): BakedModel {
  const n = model.vertexCount;
  const anims = {} as Record<AnimName, AnimRow>;
  let rows = 0;
  for (const a of ANIM_ORDER) {
    anims[a] = { row: rows, frames: ANIMS[a].frames, dur: ANIMS[a].dur, loop: ANIMS[a].loop };
    rows += ANIMS[a].frames;
  }
  const data = new Float32Array(n * rows * 4);
  const PARENT = model.parent;
  const PIVOT = model.pivot;
  const ROOT_PIVOT = model.rootPivot;
  const partM = Array.from({ length: PARENT.length }, () => new THREE.Matrix4());
  const rootM = new THREE.Matrix4();
  const v = new THREE.Vector3();

  for (const a of ANIM_ORDER) {
    const spec = anims[a];
    for (let f = 0; f < spec.frames; f++) {
      const t = spec.loop ? f / spec.frames : f / (spec.frames - 1);
      const pose = kind === 'ram' || kind === 'trebuchet' || kind === 'cart' || kind === 'ship' ? siegePose(kind, a, t) : poseAt(kind, a, t, model.mounted);
      // 根：位移 ＋ 以腳跟為軸傾倒
      rootM.makeTranslation(0, pose.root.y, pose.root.z);
      rootM.multiply(_t.makeTranslation(ROOT_PIVOT[0], ROOT_PIVOT[1], ROOT_PIVOT[2]));
      rootM.multiply(_t.makeRotationX(pose.root.rx));
      rootM.multiply(_t.makeRotationZ(pose.root.rz));
      rootM.multiply(_t.makeTranslation(-ROOT_PIVOT[0], -ROOT_PIVOT[1], -ROOT_PIVOT[2]));
      // 部件：父矩陣 × 以關節為軸旋轉
      for (let p = 0; p < PARENT.length; p++) {
        const [px, py, pz] = PIVOT[p];
        const [rx, ry, rz] = pose.r[p];
        _m.copy(PARENT[p] >= 0 ? partM[PARENT[p]] : rootM);
        _m.multiply(_t.makeTranslation(px, py, pz));
        _m.multiply(_t.makeRotationFromQuaternion(_q.setFromEuler(_e.set(rx, ry, rz))));
        _m.multiply(_t.makeTranslation(-px, -py, -pz));
        partM[p].copy(_m);
      }
      const base = (spec.row + f) * n * 4;
      for (let i = 0; i < n; i++) {
        v.set(model.position[i * 3], model.position[i * 3 + 1], model.position[i * 3 + 2]).applyMatrix4(partM[model.part[i]]);
        data[base + i * 4] = v.x;
        data[base + i * 4 + 1] = v.y;
        data[base + i * 4 + 2] = v.z;
        data[base + i * 4 + 3] = 1;
      }
    }
  }

  const texture = new THREE.DataTexture(data, n, rows, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(model.position, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(model.color, 3));
  geometry.setAttribute('aMask', new THREE.BufferAttribute(model.mask, 1));
  geometry.computeVertexNormals();
  return { geometry, texture, anims, vertexCount: n };
}

/** 共用的動畫時間（秒） */
export const vatTime = { value: 0 };

const VAT_DECL = /* glsl */ `
uniform highp sampler2D uVat;
uniform float uTime;
attribute vec4 aAnim;
vec3 vatPosition() {
  float frames = aAnim.y;
  float dur = abs(aAnim.w);
  float p = (uTime - aAnim.z) / dur;
  float f;
  float f1;
  if (aAnim.w > 0.0) {
    f = fract(p) * frames;
    f1 = mod(floor(f) + 1.0, frames);
  } else {
    f = clamp(p, 0.0, 1.0) * (frames - 1.0);
    f1 = min(floor(f) + 1.0, frames - 1.0);
  }
  float f0 = floor(f);
  vec3 p0 = texelFetch(uVat, ivec2(gl_VertexID, int(aAnim.x + f0)), 0).xyz;
  vec3 p1 = texelFetch(uVat, ivec2(gl_VertexID, int(aAnim.x + f1)), 0).xyz;
  return mix(p0, p1, f - f0);
}
`;

/** 兵種材質：Lambert 平面著色 ＋ VAT ＋ 隊伍色遮罩 */
export function makeVatMaterial(tex: THREE.DataTexture): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uVat = { value: tex };
    shader.uniforms.uTime = vatTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VAT_DECL}\nattribute vec3 aTeam;\nattribute float aMask;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vatPosition();')
      .replace('#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb = mix(vColor.rgb, aTeam, aMask);');
  };
  mat.customProgramCacheKey = () => 'vat-lambert';
  return mat;
}

/** 陰影用的深度材質（同樣套 VAT，影子才會跟著動） */
export function makeVatDepthMaterial(tex: THREE.DataTexture): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uVat = { value: tex };
    shader.uniforms.uTime = vatTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VAT_DECL}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vatPosition();');
  };
  mat.customProgramCacheKey = () => 'vat-depth';
  return mat;
}
