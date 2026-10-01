// 三國特色特效（docs/02、docs/07 §8）：火海、八陣圖、燃燒建築、武將光圈、技能／計策爆發圈、兵書與玉璽
import * as THREE from 'three';
import { scrollModel, sealModel } from '../models/resources';
import { BUILDING_DEFS, UNIT_DEFS } from '../sim/core/defs';
import { ONE } from '../sim/core/fixed';
import { S } from '../sim/core/world';
import type { Sim } from '../sim/sim';
import type { UnitRenderer } from './units';
import { WATER_Y, type Terrain } from './terrain';

const MAX_FLAMES = 600;
const MAX_RINGS = 160;
const MAX_DISCS = 32;

interface Burst {
  x: number;
  z: number;
  t0: number;
  dur: number;
  r0: number;
  r1: number;
  color: THREE.Color;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly flames: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly discs: THREE.InstancedMesh;
  private readonly scrolls: THREE.InstancedMesh;
  private readonly seal: THREE.Mesh;
  private readonly bursts: Burst[] = [];
  /** 戰役目標光柱 */
  private readonly pillars: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private static readonly FLAME_COLORS = [0xffb02a, 0xff7a1a, 0xffd04a, 0xff5a1a].map((x) => new THREE.Color(x));
  private static readonly GOLD = new THREE.Color(0xf0c040);
  private static readonly SLOW = new THREE.Color(0x6ab0ff);
  private static readonly FIRE_GROUND = new THREE.Color(0xff5a1a);

  constructor(private terrain: Terrain) {
    const flameGeo = new THREE.ConeGeometry(0.16, 0.55, 5);
    flameGeo.translate(0, 0.27, 0);
    this.flames = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), MAX_FLAMES);
    const ringGeo = new THREE.RingGeometry(0.86, 1, 28).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }), MAX_RINGS);
    const discGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
    this.discs = new THREE.InstancedMesh(discGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false }), MAX_DISCS);
    for (const im of [this.flames, this.rings, this.discs]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      im.renderOrder = 3;
      // 先設一次顏色，建立 instanceColor
      im.setColorAt(0, Effects.GOLD);
    }
    const itemMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.scrolls = new THREE.InstancedMesh(scrollModel(), itemMat, 8);
    this.scrolls.frustumCulled = false;
    this.scrolls.count = 0;
    this.seal = new THREE.Mesh(sealModel(), itemMat);
    this.seal.visible = false;
    const pillarGeo = new THREE.CylinderGeometry(0.35, 0.6, 7, 10, 1, true);
    pillarGeo.translate(0, 3.5, 0);
    this.pillars = new THREE.InstancedMesh(pillarGeo, new THREE.MeshBasicMaterial({ color: 0xffd860, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }), 16);
    this.pillars.count = 0;
    this.pillars.frustumCulled = false;
    this.group.add(this.discs, this.rings, this.flames, this.scrolls, this.seal, this.pillars);
  }

  /** 技能、計策、倒戈等的爆發圈 */
  burst(x: number, z: number, r: number, color: number, now: number, dur = 0.8): void {
    if (this.bursts.length > 40) this.bursts.shift();
    this.bursts.push({ x, z, t0: now, dur, r0: r * 0.2, r1: r, color: new THREE.Color(color) });
  }

  update(sim: Sim, units: UnitRenderer, now: number, myPlayer: number, visible: (tx: number, ty: number) => boolean, explored: (tx: number, ty: number) => boolean): void {
    const ab = sim.abilities;
    let nf = 0;
    let nr = 0;
    let nd = 0;
    const flame = (x: number, y: number, z: number, k: number, size: number) => {
      if (nf >= MAX_FLAMES) return;
      const fl = 0.75 + 0.35 * Math.sin(now * 13 + k * 1.7);
      this.e.set(0, k, 0.12 * Math.sin(now * 7 + k));
      this.q.setFromEuler(this.e);
      this.v.set(x, y, z);
      this.s.set(size * (0.8 + 0.2 * fl), size * fl * 1.3, size * (0.8 + 0.2 * fl));
      this.m.compose(this.v, this.q, this.s);
      this.flames.setMatrixAt(nf, this.m);
      this.flames.setColorAt(nf, Effects.FLAME_COLORS[k & 3]);
      nf++;
    };
    const ring = (x: number, z: number, r: number, col: THREE.Color, yOff = 0.06) => {
      if (nr >= MAX_RINGS) return;
      this.v.set(x, this.groundY(x, z) + yOff, z);
      this.s.set(r, 1, r);
      this.m.compose(this.v, this.q.identity(), this.s);
      this.rings.setMatrixAt(nr, this.m);
      this.rings.setColorAt(nr, col);
      nr++;
    };
    const disc = (x: number, z: number, r: number, col: THREE.Color) => {
      if (nd >= MAX_DISCS) return;
      this.v.set(x, this.groundY(x, z) + 0.04, z);
      this.s.set(r, 1, r);
      this.m.compose(this.v, this.q.identity(), this.s);
      this.discs.setMatrixAt(nd, this.m);
      this.discs.setColorAt(nd, col);
      nd++;
    };

    // 火海、八陣圖
    ab.areas.forEach((a, ai) => {
      const x = a.x / ONE;
      const z = a.y / ONE;
      const r = a.r / ONE;
      if (!visible(Math.floor(x), Math.floor(z))) return;
      if (a.kind === 'slow') {
        disc(x, z, r, Effects.SLOW);
        // 八陣圖：兩圈反向旋轉的陣紋
        ring(x, z, r, Effects.SLOW);
        ring(x, z, r * (0.62 + 0.04 * Math.sin(now * 2)), Effects.SLOW, 0.07);
        return;
      }
      disc(x, z, r, Effects.FIRE_GROUND);
      const n = Math.min(64, Math.round(r * r * 2.4));
      for (let k = 0; k < n; k++) {
        // 黃金角分布，固定位置 ＋ 閃爍
        const ang = k * 2.399963 + ai;
        const rr = r * Math.sqrt((k + 0.5) / n);
        const fx = x + Math.cos(ang) * rr;
        const fz = z + Math.sin(ang) * rr;
        flame(fx, this.groundY(fx, fz), fz, k + ai * 7, 1.15);
      }
    });

    // 燃燒中的建築
    const bs = sim.buildings;
    for (const [b] of ab.burning) {
      if (!bs.alive[b]) continue;
      const d = BUILDING_DEFS[bs.btype[b]];
      const cx = bs.tx[b] + d.w / 2;
      const cz = bs.ty[b] + d.h / 2;
      if (!explored(Math.floor(cx), Math.floor(cz))) continue;
      const y = this.terrain.heightAt(cx, cz);
      for (let k = 0; k < 3 + d.w; k++) {
        const ang = k * 2.399963 + b;
        const rr = (d.w / 2) * 0.7 * Math.sqrt((k + 0.5) / (3 + d.w));
        flame(cx + Math.cos(ang) * rr, y + 0.6 + (k % 3) * 0.35, cz + Math.sin(ang) * rr, k + b, 1.1);
      }
    }

    // 武將腳下金色光圈；火船船頭火盆
    const w = sim.world;
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.state[id] === S.Dead || !units.seen[id]) continue;
      const d = UNIT_DEFS[w.utype[id]];
      if (d.hero) ring(units.wx[id], units.wz[id], 0.55 + 0.03 * Math.sin(now * 3 + id), Effects.GOLD);
      else if (d.explodeFx) flame(units.wx[id] + Math.sin(units.yaw[id]) * 0.38, WATER_Y + 0.3, units.wz[id] + Math.cos(units.yaw[id]) * 0.38, id, 0.5);
      // 被減速、恐懼的單位：小藍圈
      if (w.fearUntil[id] > sim.tick) ring(units.wx[id], units.wz[id], 0.35, Effects.SLOW);
    }

    // 爆發圈
    for (let k = this.bursts.length - 1; k >= 0; k--) {
      const bu = this.bursts[k];
      const t = (now - bu.t0) / bu.dur;
      if (t >= 1 || t < 0) {
        if (t >= 1) this.bursts.splice(k, 1);
        continue;
      }
      this.c.copy(bu.color).multiplyScalar(1 - t * 0.6);
      ring(bu.x, bu.z, bu.r0 + (bu.r1 - bu.r0) * Math.sqrt(t), this.c, 0.1);
    }

    // 兵書、玉璽
    let ns = 0;
    this.seal.visible = false;
    for (const it of ab.items) {
      let x = it.x / ONE;
      let z = it.y / ONE;
      let y: number;
      const spin = now * 1.5;
      if (it.carrier >= 0) {
        if (!units.seen[it.carrier]) continue;
        x = units.wx[it.carrier];
        z = units.wz[it.carrier];
        y = units.wy[it.carrier] + 1.25;
      } else if (it.academy >= 0 && bs.alive[it.academy]) {
        const d = BUILDING_DEFS[bs.btype[it.academy]];
        x = bs.tx[it.academy] + d.w / 2;
        z = bs.ty[it.academy] + d.h / 2;
        if (!explored(Math.floor(x), Math.floor(z)) && bs.owner[it.academy] !== myPlayer) continue;
        y = this.terrain.heightAt(x, z) + 2.3 + 0.1 * Math.sin(now * 2);
      } else {
        if (!explored(Math.floor(x), Math.floor(z))) continue;
        y = this.terrain.heightAt(x, z) + 0.05 + 0.06 * Math.sin(now * 2.5);
      }
      if (it.kind === 'seal') {
        this.seal.visible = true;
        this.seal.position.set(x, y, z);
        this.seal.rotation.y = spin;
        this.seal.scale.setScalar(1.3);
        if (it.carrier < 0 && it.academy < 0) ring(x, z, 0.8 + 0.1 * Math.sin(now * 3), Effects.GOLD);
      } else if (ns < 8) {
        this.e.set(0, spin, 0);
        this.v.set(x, y, z);
        this.s.set(1.3, 1.3, 1.3);
        this.m.compose(this.v, this.q.setFromEuler(this.e), this.s);
        this.scrolls.setMatrixAt(ns++, this.m);
      }
    }

    this.flames.count = nf;
    this.rings.count = nr;
    this.discs.count = nd;
    this.scrolls.count = ns;
    for (const im of [this.flames, this.rings, this.discs, this.scrolls]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** 戰役目標：發光光柱 ＋ 地面金圈 */
  beacons(list: Map<string, [number, number]>, now: number): void {
    let n = 0;
    for (const [, [tx, ty]] of list) {
      if (n >= 16) break;
      const x = tx + 0.5;
      const z = ty + 0.5;
      const pulse = 1 + 0.12 * Math.sin(now * 3 + n);
      this.v.set(x, this.groundY(x, z), z);
      this.s.set(pulse, 1, pulse);
      this.m.compose(this.v, this.q.identity(), this.s);
      this.pillars.setMatrixAt(n++, this.m);
      this.burstRing(x, z, now);
    }
    this.pillars.count = n;
    this.pillars.instanceMatrix.needsUpdate = true;
  }

  private ringT = 0;
  private burstRing(x: number, z: number, now: number): void {
    if (now - this.ringT < 0.9) return;
    this.ringT = now;
    this.burst(x, z, 2.2, 0xffd860, now, 1.2);
  }

  private groundY(x: number, z: number): number {
    return Math.max(this.terrain.heightAt(x, z), WATER_Y + 0.02);
  }
}
