// 單位渲染：每個兵種一個 InstancedMesh ＋ VAT
// 每幀從模擬層讀位置（前後兩個 tick 內插）、算朝向、決定動畫，寫進實例屬性
import * as THREE from 'three';
import { PLAYER_COLORS, UNIT_LOOK } from '../config';
import { buildSoldier, SOLDIER_SPECS, type AnimName } from '../models/soldier';
import { CAPACITY, S, UNIT_DEFS } from '../sim/core/world';
import { ONE } from '../sim/core/fixed';
import type { Sim } from '../sim/sim';
import type { Terrain } from './terrain';
import { bakeVat, makeVatDepthMaterial, makeVatMaterial, vatTime, type BakedModel } from './vat';

const MAX_PER_TYPE = 2048;

interface TypeMesh {
  baked: BakedModel;
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  team: THREE.InstancedBufferAttribute;
}

export class UnitRenderer {
  readonly group = new THREE.Group();
  private types: TypeMesh[] = [];
  /** 每個單位內插後的世界座標（點選判定、選取圈、小地圖共用） */
  readonly wx = new Float32Array(CAPACITY);
  readonly wy = new Float32Array(CAPACITY);
  readonly wz = new Float32Array(CAPACITY);
  readonly yaw = new Float32Array(CAPACITY);
  private readonly curAnim = new Int8Array(CAPACITY).fill(-1);
  private readonly animStart = new Float32Array(CAPACITY);
  private readonly teamRgb = PLAYER_COLORS.map((c) => new THREE.Color(c));
  /** DEV：強制所有單位播某個動畫 */
  forceAnim: AnimName | null = null;
  shadows = true;

  constructor(private terrain: Terrain) {
    for (const def of UNIT_DEFS) {
      const spec = SOLDIER_SPECS[def.id];
      const baked = bakeVat(buildSoldier(spec), spec.kind);
      const mesh = new THREE.InstancedMesh(baked.geometry, makeVatMaterial(baked.texture), MAX_PER_TYPE);
      mesh.customDepthMaterial = makeVatDepthMaterial(baked.texture);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_TYPE * 4), 4);
      const team = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_TYPE * 3), 3);
      anim.setUsage(THREE.DynamicDrawUsage);
      team.setUsage(THREE.DynamicDrawUsage);
      baked.geometry.setAttribute('aAnim', anim);
      baked.geometry.setAttribute('aTeam', team);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      this.types.push({ baked, mesh, anim, team });
    }
  }

  /** 每個兵種的三角形數（DEV 顯示） */
  get trianglesPerType(): number[] {
    return this.types.map((t) => t.baked.vertexCount / 3);
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    for (const t of this.types) t.mesh.castShadow = on;
  }

  /** bounds：畫面看得到的地面範圍 [x0,z0,x1,z1]，範圍外的單位不送進 GPU */
  update(sim: Sim, alpha: number, time: number, dt: number, bounds: [number, number, number, number] | null): void {
    vatTime.value = time;
    const w = sim.world;
    const counts = new Int32Array(this.types.length);
    const turn = UNIT_LOOK.turnSpeed * dt;
    const k = UNIT_LOOK.scale;
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id]) {
        this.curAnim[id] = -1;
        continue;
      }
      const x = (w.px[id] + (w.x[id] - w.px[id]) * alpha) / ONE;
      const z = (w.py[id] + (w.y[id] - w.py[id]) * alpha) / ONE;
      const y = this.terrain.heightAt(x, z);
      this.wx[id] = x;
      this.wy[id] = y;
      this.wz[id] = z;

      // 朝向平滑轉動
      if (w.fx[id] !== 0 || w.fy[id] !== 0) {
        const target = Math.atan2(w.fx[id], w.fy[id]);
        let d = target - this.yaw[id];
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw[id] += Math.max(-turn, Math.min(turn, d));
      }
      if (this.curAnim[id] === -1) this.yaw[id] = Math.atan2(w.fx[id], w.fy[id]);

      // 動畫
      const st = w.state[id];
      const name: AnimName = this.forceAnim ?? (st === S.Move ? 'walk' : st === S.Dead ? 'die' : st === S.Work ? 'work' : 'idle');
      const tm = this.types[w.utype[id]];
      const row = tm.baked.anims[name];
      const animIdx = row.row;
      if (this.curAnim[id] !== animIdx) {
        this.curAnim[id] = animIdx;
        // 待機動畫錯開相位，整隊才不會同步呼吸
        this.animStart[id] = name === 'idle' ? time - ((id * 0.618) % 1) * row.dur : time;
      }

      if (bounds && (x < bounds[0] || z < bounds[1] || x > bounds[2] || z > bounds[3])) continue;
      const n = counts[w.utype[id]]++;
      const m = tm.mesh.instanceMatrix.array as Float32Array;
      const c = Math.cos(this.yaw[id]) * k;
      const s = Math.sin(this.yaw[id]) * k;
      const o = n * 16;
      m[o] = c;
      m[o + 1] = 0;
      m[o + 2] = -s;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = k;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = s;
      m[o + 9] = 0;
      m[o + 10] = c;
      m[o + 11] = 0;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;
      m[o + 15] = 1;
      const a = tm.anim.array as Float32Array;
      a[n * 4] = row.row;
      a[n * 4 + 1] = row.frames;
      a[n * 4 + 2] = this.animStart[id];
      a[n * 4 + 3] = row.loop ? row.dur : -row.dur;
      const col = this.teamRgb[w.owner[id] % this.teamRgb.length];
      const ta = tm.team.array as Float32Array;
      ta[n * 3] = col.r;
      ta[n * 3 + 1] = col.g;
      ta[n * 3 + 2] = col.b;
    }
    for (let t = 0; t < this.types.length; t++) {
      const tm = this.types[t];
      const n = counts[t];
      tm.mesh.count = n;
      if (!n) continue;
      tm.mesh.instanceMatrix.clearUpdateRanges();
      tm.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      tm.mesh.instanceMatrix.needsUpdate = true;
      tm.anim.clearUpdateRanges();
      tm.anim.addUpdateRange(0, n * 4);
      tm.anim.needsUpdate = true;
      tm.team.clearUpdateRanges();
      tm.team.addUpdateRange(0, n * 3);
      tm.team.needsUpdate = true;
    }
  }
}
