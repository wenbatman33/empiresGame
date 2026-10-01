// 粒子特效（docs/07 §8.2）：塵土、煙、受擊星星、碎屑
// CPU 模擬、單一 InstancedMesh 畫完；淡出用縮小代替透明度（每個實例不能各自調透明度）
import * as THREE from 'three';

const MAX = 900;

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 出生時間、壽命（秒） */
  t0: number;
  life: number;
  size: number;
  /** 長大倍率（煙會慢慢變大） */
  grow: number;
  gravity: number;
  color: THREE.Color;
  spin: number;
  /** 半透明的軟粒子（煙、塵雲） */
  soft: boolean;
}

export type Burst = 'dust' | 'bigDust' | 'smoke' | 'star' | 'splash' | 'ember' | 'debris';

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  /** 煙、塵雲：不受光、半透明 */
  readonly softMesh: THREE.InstancedMesh;
  readonly group = new THREE.Group();
  private ps: P[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  /** 低畫質時減量 */
  density = 1;
  private seed = 1;

  constructor() {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true, transparent: true, opacity: 0.85, depthWrite: false }), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 4;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.softMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.38, depthWrite: false }), MAX);
    this.softMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.softMesh.frustumCulled = false;
    this.softMesh.count = 0;
    this.softMesh.renderOrder = 5;
    this.softMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(this.mesh, this.softMesh);
  }

  /** 畫面用的亂數（不影響模擬） */
  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  emit(kind: Burst, x: number, y: number, z: number, now: number, scale = 1): void {
    const r = () => this.rnd();
    const soft = kind === 'smoke' || kind === 'bigDust';
    const add = (n: number, f: () => Omit<P, 't0' | 'soft'>) => {
      const cnt = Math.max(1, Math.round(n * this.density));
      for (let k = 0; k < cnt; k++) {
        if (this.ps.length >= MAX * 2) this.ps.shift();
        this.ps.push({ ...f(), t0: now, soft });
      }
    };
    switch (kind) {
      case 'dust':
        add(4 * scale, () => ({ x: x + (r() - 0.5) * 0.4, y: y + 0.05, z: z + (r() - 0.5) * 0.4, vx: (r() - 0.5) * 0.8, vy: 0.4 + r() * 0.4, vz: (r() - 0.5) * 0.8, life: 0.7 + r() * 0.4, size: 0.12 * scale, grow: 2.2, gravity: 0.3, color: new THREE.Color(0xc9b08a), spin: r() * 3 }));
        break;
      case 'bigDust':
        add(22 * scale, () => {
          const a = r() * Math.PI * 2;
          const sp = 0.6 + r() * 1.4;
          return { x: x + Math.cos(a) * r() * scale, y: y + 0.2, z: z + Math.sin(a) * r() * scale, vx: Math.cos(a) * sp, vy: 0.6 + r() * 1.2, vz: Math.sin(a) * sp, life: 1.4 + r() * 0.8, size: 0.25 + r() * 0.2, grow: 2.6, gravity: 0.25, color: new THREE.Color(r() < 0.5 ? 0xb8a284 : 0x9a8a72), spin: r() * 3 };
        });
        break;
      case 'debris':
        add(10 * scale, () => {
          const a = r() * Math.PI * 2;
          return { x, y: y + 0.4, z, vx: Math.cos(a) * (1 + r() * 2), vy: 2 + r() * 2.5, vz: Math.sin(a) * (1 + r() * 2), life: 0.9 + r() * 0.4, size: 0.08 + r() * 0.06, grow: 0.6, gravity: 9, color: new THREE.Color(r() < 0.5 ? 0x7a4a2a : 0x8a8378), spin: 8 };
        });
        break;
      case 'smoke':
        add(1, () => ({ x: x + (r() - 0.5) * 0.5 * scale, y, z: z + (r() - 0.5) * 0.5 * scale, vx: 0.15 + (r() - 0.5) * 0.2, vy: 0.8 + r() * 0.5, vz: (r() - 0.5) * 0.2, life: 2 + r(), size: 0.12 * Math.sqrt(scale), grow: 2.6, gravity: -0.05, color: new THREE.Color(r() < 0.5 ? 0x8f8880 : 0xa39c93), spin: r() }));
        break;
      case 'ember':
        add(2 * scale, () => ({ x: x + (r() - 0.5) * 0.6, y, z: z + (r() - 0.5) * 0.6, vx: (r() - 0.5) * 0.6, vy: 1.2 + r(), vz: (r() - 0.5) * 0.6, life: 0.8 + r() * 0.5, size: 0.045, grow: 0.4, gravity: -0.2, color: new THREE.Color(r() < 0.5 ? 0xffb02a : 0xff6a1a), spin: 6 }));
        break;
      case 'star':
        // 受擊星星（Q 版不見血）
        add(2, () => ({ x: x + (r() - 0.5) * 0.3, y: y + 0.6 + r() * 0.2, z: z + (r() - 0.5) * 0.3, vx: (r() - 0.5) * 1.4, vy: 1.4 + r(), vz: (r() - 0.5) * 1.4, life: 0.45, size: 0.06, grow: 0.5, gravity: 5, color: new THREE.Color(r() < 0.5 ? 0xffe46a : 0xffffff), spin: 10 }));
        break;
      case 'splash':
        add(8 * scale, () => {
          const a = r() * Math.PI * 2;
          return { x, y: y + 0.05, z, vx: Math.cos(a) * (0.6 + r()), vy: 1.6 + r() * 1.5, vz: Math.sin(a) * (0.6 + r()), life: 0.7, size: 0.07, grow: 0.8, gravity: 7, color: new THREE.Color(0xd8eef8), spin: 2 };
        });
        break;
    }
  }

  update(now: number): void {
    const ps = this.ps;
    let n = 0;
    let ns = 0;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const t = now - p.t0;
      if (t >= p.life || t < 0) continue;
      ps[w++] = p;
      const k = t / p.life;
      const x = p.x + p.vx * t;
      const y = p.y + p.vy * t - 0.5 * p.gravity * t * t;
      const z = p.z + p.vz * t;
      // 先長大、最後 40% 縮小消失
      const sz = p.size * (1 + (p.grow - 1) * k) * (k > 0.6 ? (1 - k) / 0.4 : 1);
      this.e.set(p.spin * t, p.spin * t * 0.7, 0);
      this.v.set(x, y, z);
      this.s.set(sz, sz, sz);
      this.m.compose(this.v, this.q.setFromEuler(this.e), this.s);
      if (p.soft) {
        if (ns >= MAX) continue;
        this.softMesh.setMatrixAt(ns, this.m);
        this.softMesh.setColorAt(ns, p.color);
        ns++;
      } else {
        if (n >= MAX) continue;
        this.mesh.setMatrixAt(n, this.m);
        this.mesh.setColorAt(n, p.color);
        n++;
      }
    }
    ps.length = w;
    for (const [mesh, c] of [[this.mesh, n], [this.softMesh, ns]] as const) {
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
