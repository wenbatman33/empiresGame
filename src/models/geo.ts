// 靜態模型的幾何工具：部件合併成一個 BufferGeometry（頂點色 ＋ 隊伍色遮罩）
import * as THREE from 'three';

export class StaticBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private msk: number[] = [];

  /** 加入一個部件；mask = 1 的部分會換成隊伍色 */
  add(geo: THREE.BufferGeometry, color: number, m?: THREE.Matrix4, mask = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (m) g.applyMatrix4(m);
    const p = g.getAttribute('position');
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.msk.push(mask);
    }
    geo.dispose();
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(this.msk, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
export function M(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg: number, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const cone = (r: number, h: number, seg: number) => new THREE.ConeGeometry(r, h, seg);
export const ico = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail);

/** 四角錐屋頂（底面 w×d，高 h，底面在 y=0） */
export function pyramid(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, true);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  g.scale(w, h, d);
  return g;
}

/** 懸山屋頂（屋脊沿 x，寬 w、深 d、高 h，簷口在 y=0） */
export function gable(w: number, h: number, d: number): THREE.BufferGeometry {
  const x = w / 2;
  const z = d / 2;
  const p = [
    // 前坡
    -x, 0, z, x, 0, z, x, h, 0, -x, 0, z, x, h, 0, -x, h, 0,
    // 後坡
    x, 0, -z, -x, 0, -z, -x, h, 0, x, 0, -z, -x, h, 0, x, h, 0,
    // 山牆
    -x, 0, -z, -x, 0, z, -x, h, 0, x, 0, z, x, 0, -z, x, h, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return g;
}

/** 隊伍色材質：Lambert 平面著色，aMask = 1 的頂點換成實例的 aTeam 顏色 */
export function makeTeamMaterial(opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...opts });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTeam;\nattribute float aMask;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb = mix(vColor.rgb, aTeam, aMask);');
  };
  mat.customProgramCacheKey = () => `team-lambert-${opts.transparent ? 't' : 'o'}`;
  return mat;
}
