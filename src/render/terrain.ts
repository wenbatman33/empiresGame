// 地形：高度圖切成 32×32 區塊、低多邊形平面著色、水面、地圖邊緣土層
// 地形材質預留一張疊加貼圖（DEV 通行格網，之後的戰爭迷霧也用它）
import * as THREE from 'three';
import { HEIGHT_UNIT, T, WATER_LEVEL, type MapGrid } from '../sim/map/grid';
import { withFog } from './fog';

const CHUNK = 32;
const TILE_COLOR: Record<number, number> = {
  [T.Grass]: 0x82b54b,
  [T.Dirt]: 0xbba06a,
  [T.Sand]: 0xe3cf93,
  [T.Shallow]: 0xc7b582,
  [T.Deep]: 0x4f6f72,
  [T.Forest]: 0x5f8f37,
  [T.Rock]: 0x8a8378,
};
/** 小地圖配色（sRGB） */
const MINIMAP_COLOR: Record<number, number> = {
  [T.Grass]: 0x8cbf55,
  [T.Dirt]: 0xc4a872,
  [T.Sand]: 0xe6d49c,
  [T.Shallow]: 0x6fb0dc,
  [T.Deep]: 0x3f7fbf,
  [T.Forest]: 0x3c7430,
  [T.Rock]: 0x7a746a,
};
export const WATER_Y = WATER_LEVEL / HEIGHT_UNIT;

function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 0xffff;
}

export class Terrain {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  readonly overlay: THREE.DataTexture;
  private readonly overlayData: Uint8Array;
  readonly uniforms = {
    uOverlay: { value: null as THREE.DataTexture | null },
    uOverlayOn: { value: 0 },
    uMapSize: { value: new THREE.Vector2() },
  };
  /** 小地圖用：每格顏色 */
  readonly tileRgb: Uint8Array;

  constructor(private map: MapGrid) {
    const { w, h } = map;
    this.overlayData = new Uint8Array(w * h * 4);
    this.overlay = new THREE.DataTexture(this.overlayData, w, h, THREE.RGBAFormat);
    this.overlay.magFilter = THREE.NearestFilter;
    this.overlay.needsUpdate = true;
    this.uniforms.uOverlay.value = this.overlay;
    this.uniforms.uMapSize.value.set(w, h);

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uMapSize;\nvarying vec2 vMapUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vMapUv = position.xz / uMapSize;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uOverlay;\nuniform float uOverlayOn;\nvarying vec2 vMapUv;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n  if (uOverlayOn > 0.5) { vec4 ov = texture2D(uOverlay, vMapUv); diffuseColor.rgb = mix(diffuseColor.rgb, ov.rgb, ov.a); }',
        );
    };
    this.material.customProgramCacheKey = () => 'terrain';
    withFog(this.material);

    this.tileRgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const hex = MINIMAP_COLOR[map.tiles[i]];
      this.tileRgb[i * 3] = (hex >> 16) & 255;
      this.tileRgb[i * 3 + 1] = (hex >> 8) & 255;
      this.tileRgb[i * 3 + 2] = hex & 255;
    }

    for (let cy = 0; cy < h; cy += CHUNK) {
      for (let cx = 0; cx < w; cx += CHUNK) {
        const mesh = new THREE.Mesh(this.buildChunk(cx, cy, Math.min(CHUNK, w - cx), Math.min(CHUNK, h - cy)), this.material);
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
    this.group.add(this.buildSkirt());
    const rocks = this.buildRocks();
    if (rocks) this.group.add(rocks);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(w / 2, WATER_Y, h / 2),
      withFog(new THREE.MeshPhongMaterial({ color: 0x3f86c2, transparent: true, opacity: 0.78, shininess: 40, specular: 0x4a6a80 })),
    );
    water.receiveShadow = true;
    water.renderOrder = 1;
    this.group.add(water);
  }

  /** 山崖格（蜀道）：每格 1–2 塊岩石，讓山脊有立體感 */
  private buildRocks(): THREE.InstancedMesh | null {
    const m = this.map;
    const cells: number[] = [];
    for (let i = 0; i < m.w * m.h; i++) if (m.tiles[i] === T.Rock) cells.push(i);
    if (!cells.length) return null;
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, withFog(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })), cells.length * 2);
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    for (const i of cells) {
      const tx = i % m.w;
      const ty = Math.floor(i / m.w);
      // 固定的偽亂數（同一張地圖每次長得一樣）
      const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
      for (let k = 0; k < 1 + (h & 1); k++) {
        const r = ((h >>> (k * 8)) & 255) / 255;
        const x = tx + 0.3 + r * 0.4;
        const z = ty + 0.3 + (((h >>> (k * 8 + 4)) & 15) / 15) * 0.4;
        e.set(r * 3, r * 6, 0);
        v.set(x, this.heightAt(x, z) + 0.15, z);
        const s0 = 0.7 + r * 0.4;
        sc.set(s0, s0 * (0.9 + r), s0);
        mat.compose(v, q.setFromEuler(e), sc);
        mesh.setMatrixAt(n, mat);
        mesh.setColorAt(n, col.setHex(r > 0.5 ? 0xb3ab9c : 0x978f80));
        n++;
      }
    }
    mesh.count = n;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** 頂點高度（世界單位） */
  vh(vx: number, vy: number): number {
    const W = this.map.w + 1;
    vx = Math.max(0, Math.min(this.map.w, vx));
    vy = Math.max(0, Math.min(this.map.h, vy));
    return this.map.heights[vy * W + vx] / HEIGHT_UNIT;
  }

  /** 任意位置的地表高度（雙線性內插）；水面以下的單位踩在水面略下 */
  heightAt(x: number, z: number): number {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fz = z - z0;
    const h00 = this.vh(x0, z0);
    const h10 = this.vh(x0 + 1, z0);
    const h01 = this.vh(x0, z0 + 1);
    const h11 = this.vh(x0 + 1, z0 + 1);
    const hgt = (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
    return Math.max(hgt, WATER_Y - 0.28);
  }

  private buildChunk(cx: number, cy: number, cw: number, chh: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const map = this.map;
    for (let ty = cy; ty < cy + chh; ty++) {
      for (let tx = cx; tx < cx + cw; tx++) {
        const t = map.tiles[ty * map.w + tx];
        const h00 = this.vh(tx, ty);
        const h10 = this.vh(tx + 1, ty);
        const h01 = this.vh(tx, ty + 1);
        const h11 = this.vh(tx + 1, ty + 1);
        // 對角線交錯，低多邊形感比較自然
        const flip = ((tx + ty) & 1) === 0;
        const tris = flip
          ? [[tx, h00, ty, tx, h01, ty + 1, tx + 1, h11, ty + 1], [tx, h00, ty, tx + 1, h11, ty + 1, tx + 1, h10, ty]]
          : [[tx, h00, ty, tx, h01, ty + 1, tx + 1, h10, ty], [tx + 1, h10, ty, tx, h01, ty + 1, tx + 1, h11, ty + 1]];
        for (let k = 0; k < 2; k++) {
          c.setHex(TILE_COLOR[t]);
          const v = 0.93 + hash(tx, ty, k) * 0.12;
          c.multiplyScalar(v);
          const tri = tris[k];
          for (let j = 0; j < 9; j += 3) {
            pos.push(tri[j], tri[j + 1], tri[j + 2]);
            col.push(c.r, c.g, c.b);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /** 地圖四周的土層，讓地圖像一塊沙盤 */
  private buildSkirt(): THREE.Mesh {
    const { w, h } = this.map;
    const pos: number[] = [];
    const bottom = -2.5;
    const edge = (x0: number, z0: number, x1: number, z1: number, h0: number, h1: number) => {
      pos.push(x0, h0, z0, x0, bottom, z0, x1, bottom, z1, x0, h0, z0, x1, bottom, z1, x1, h1, z1);
    };
    for (let x = 0; x < w; x++) {
      edge(x + 1, 0, x, 0, this.vh(x + 1, 0), this.vh(x, 0));
      edge(x, h, x + 1, h, this.vh(x, h), this.vh(x + 1, h));
    }
    for (let z = 0; z < h; z++) {
      edge(0, z, 0, z + 1, this.vh(0, z), this.vh(0, z + 1));
      edge(w, z + 1, w, z, this.vh(w, z + 1), this.vh(w, z));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, withFog(new THREE.MeshLambertMaterial({ color: 0x6b5236, flatShading: true })));
  }

  /** DEV：設定疊加層（null ＝ 透明） */
  paintOverlay(fn: (tx: number, ty: number) => [number, number, number, number] | null): void {
    const { w, h } = this.map;
    const d = this.overlayData;
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const i = (ty * w + tx) * 4;
        const v = fn(tx, ty);
        d[i] = v ? v[0] : 0;
        d[i + 1] = v ? v[1] : 0;
        d[i + 2] = v ? v[2] : 0;
        d[i + 3] = v ? v[3] : 0;
      }
    }
    this.overlay.needsUpdate = true;
  }

  setOverlayVisible(on: boolean): void {
    this.uniforms.uOverlayOn.value = on ? 1 : 0;
  }
}
