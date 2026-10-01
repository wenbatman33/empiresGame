// 資源點模型：野果叢、金礦、石礦、鹿、野豬、樹樁；搬運中的資源
import * as THREE from 'three';
import { M, StaticBuilder, box, cone, cyl, ico } from './geo';

function berryBush(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(ico(0.42, 0), 0x3f8a3a, M(0, 0.32, 0, 0, 0, 0, 1, 0.8, 1));
  b.add(ico(0.3, 0), 0x4c9a42, M(0.2, 0.42, 0.12));
  const berries: [number, number, number][] = [
    [0.25, 0.45, 0.3], [-0.2, 0.5, 0.28], [0.05, 0.62, 0.22], [-0.33, 0.35, 0.05], [0.36, 0.33, -0.12], [0.1, 0.55, -0.28], [-0.15, 0.42, -0.3],
  ];
  for (const [x, y, z] of berries) b.add(ico(0.07, 0), 0xd63b4a, M(x, y, z));
  return b.build();
}

function rockPile(color: number, accent: number): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(ico(0.36, 0), 0x77736c, M(0, 0.18, 0, 0.3, 0.5, 0, 1.1, 0.7, 1));
  b.add(ico(0.26, 0), color, M(0.18, 0.32, 0.1, 0.8, 0.2, 0));
  b.add(ico(0.22, 0), accent, M(-0.2, 0.28, -0.08, 0.1, 1.2, 0.4));
  b.add(ico(0.16, 0), color, M(0.02, 0.45, -0.15, 0.6, 0.3, 0.2));
  return b.build();
}

function deer(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  const fur = 0xa8743f;
  b.add(box(0.22, 0.2, 0.5), fur, M(0, 0.42, 0));
  b.add(box(0.12, 0.25, 0.12), fur, M(0, 0.6, 0.24, -0.5));
  b.add(box(0.13, 0.13, 0.22), fur, M(0, 0.74, 0.35));
  b.add(box(0.05, 0.05, 0.05), 0x2a1d14, M(0, 0.72, 0.47));
  for (const x of [-0.07, 0.07]) {
    b.add(cyl(0.012, 0.012, 0.22, 3), 0xe8dcc0, M(x, 0.9, 0.3, 0, 0, x * 4));
    b.add(cyl(0.012, 0.012, 0.12, 3), 0xe8dcc0, M(x * 1.6, 0.95, 0.33, 0.6, 0, x * 6));
  }
  for (const x of [-0.08, 0.08]) for (const z of [-0.18, 0.18]) b.add(box(0.05, 0.32, 0.05), 0x8a5c30, M(x, 0.16, z));
  b.add(box(0.1, 0.06, 0.06), 0xf0e6d2, M(0, 0.48, -0.27));
  return b.build();
}

function boar(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  const hide = 0x4a3a30;
  b.add(box(0.32, 0.3, 0.58), hide, M(0, 0.35, 0));
  b.add(box(0.26, 0.22, 0.22), hide, M(0, 0.36, 0.36));
  b.add(box(0.12, 0.1, 0.08), 0x6a5040, M(0, 0.32, 0.5));
  for (const x of [-0.07, 0.07]) b.add(cone(0.02, 0.1, 3), 0xf0e6d2, M(x, 0.36, 0.52, -1.2));
  b.add(box(0.06, 0.12, 0.4), 0x2c221c, M(0, 0.54, 0.05));
  for (const x of [-0.11, 0.11]) for (const z of [-0.2, 0.2]) b.add(box(0.07, 0.2, 0.07), 0x3a2e26, M(x, 0.1, z));
  return b.build();
}

function stump(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(cyl(0.11, 0.14, 0.16, 6), 0x7a5232, M(0, 0.08, 0));
  b.add(cyl(0.1, 0.1, 0.02, 6), 0xd9b98a, M(0, 0.165, 0));
  return b.build();
}

/** 魚群：水面漣漪 ＋ 躍出水面的魚 */
function fish(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(new THREE.RingGeometry(0.25, 0.32, 10).rotateX(-Math.PI / 2), 0xcfe8f0, M(0, 0.02, 0));
  b.add(new THREE.RingGeometry(0.45, 0.5, 12).rotateX(-Math.PI / 2), 0xb8dce8, M(0.05, 0.02, 0.05));
  for (const [x, z, ry] of [[0.12, 0.05, 0.4], [-0.15, -0.1, 2.2], [0.02, -0.2, 4.0]]) {
    b.add(new THREE.IcosahedronGeometry(0.09, 0), 0x7a9ab0, M(x, 0.06, z, 0, ry, 0, 1.6, 0.7, 0.8));
    b.add(cone(0.05, 0.08, 3), 0x6a8aa0, M(x - Math.cos(ry) * 0.15, 0.06, z + Math.sin(ry) * 0.15, 0, ry, Math.PI / 2));
  }
  return b.build();
}

/** 兵書（捲軸）與傳國玉璽（方形玉印 ＋ 金色光圈） */
export function scrollModel(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(cyl(0.09, 0.09, 0.4, 8), 0xe8dcb8, M(0, 0.12, 0, 0, 0, Math.PI / 2));
  for (const x of [-0.22, 0.22]) b.add(cyl(0.05, 0.05, 0.06, 6), 0x7a4a2a, M(x, 0.12, 0, 0, 0, Math.PI / 2));
  b.add(box(0.2, 0.01, 0.12), 0xa8322d, M(0, 0.21, 0.02));
  return b.build();
}

export function sealModel(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(box(0.26, 0.18, 0.26), 0x7fd0a0, M(0, 0.1, 0));
  b.add(box(0.12, 0.1, 0.18), 0x6ab88a, M(0, 0.24, 0));
  b.add(new THREE.RingGeometry(0.35, 0.42, 16).rotateX(-Math.PI / 2), 0xf0d060, M(0, 0.02, 0));
  return b.build();
}

/** 民夫背上的資源（木頭、糧籃、金塊、石塊），用實例色區分 */
export function carryBundle(): THREE.BufferGeometry {
  const b = new StaticBuilder();
  b.add(box(0.18, 0.16, 0.12), 0xffffff, M(0, 0, 0));
  return b.build();
}

export const RESOURCE_MODELS: Record<string, () => THREE.BufferGeometry> = {
  tree: stump,
  berry: berryBush,
  gold: () => rockPile(0xf0c53a, 0xd9a52a),
  stone: () => rockPile(0xb3b0aa, 0x9a968f),
  deer,
  boar,
  fish,
};
export const STUMP = stump;
