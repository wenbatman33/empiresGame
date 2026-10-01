// 建築渲染：每種建築一個 InstancedMesh（隊伍色遮罩），施工中依進度長高；農田作物依剩餘糧食變矮
// 另含建造放置的預覽（綠＝可蓋、紅＝不可蓋）與選取框
import * as THREE from 'three';
import { PLAYER_COLORS } from '../config';
import { BUILDING_HEIGHT, BUILDING_MODELS, farmCrops } from '../models/buildings';
import { makeTeamMaterial } from '../models/geo';
import { BUILDING_DEFS } from '../sim/core/defs';
import type { Sim } from '../sim/sim';
import type { Terrain } from './terrain';

const CAP = 256;

interface TypeMesh {
  mesh: THREE.InstancedMesh;
  team: THREE.InstancedBufferAttribute;
}

export class BuildingRenderer {
  readonly group = new THREE.Group();
  private types: TypeMesh[] = [];
  private crops: THREE.InstancedMesh;
  private foundations: THREE.InstancedMesh;
  private ghost: THREE.Mesh | null = null;
  private ghostType = -1;
  private ghostMat = new THREE.MeshLambertMaterial({ color: 0x7dff8a, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true });
  private ghostGrid: THREE.Mesh;
  private selFrame: THREE.Mesh;
  private readonly teamRgb = PLAYER_COLORS.map((c) => new THREE.Color(c));
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly geos: THREE.BufferGeometry[] = [];

  constructor(private terrain: Terrain) {
    const mat = makeTeamMaterial();
    for (const def of BUILDING_DEFS) {
      const geo = (BUILDING_MODELS[def.id] ?? BUILDING_MODELS.house)();
      this.geos.push(geo);
      const team = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
      team.setUsage(THREE.DynamicDrawUsage);
      const g = geo.clone();
      g.setAttribute('aTeam', team);
      const mesh = new THREE.InstancedMesh(g, mat, CAP);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.types.push({ mesh, team });
    }
    this.crops = new THREE.InstancedMesh(farmCrops(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), CAP);
    this.crops.count = 0;
    this.crops.castShadow = true;
    this.crops.frustumCulled = false;
    this.group.add(this.crops);

    // 地基：淡色方塊，標出施工範圍
    this.foundations = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 1), new THREE.MeshLambertMaterial({ color: 0xd8c08a }), CAP);
    this.foundations.count = 0;
    this.foundations.frustumCulled = false;
    this.group.add(this.foundations);

    // 放置預覽的格線
    this.ghostGrid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 0.3, depthWrite: false }));
    this.ghostGrid.visible = false;
    this.ghostGrid.renderOrder = 4;
    this.group.add(this.ghostGrid);

    // 選取框
    const frame = new THREE.Shape();
    frame.moveTo(-0.5, -0.5);
    frame.lineTo(0.5, -0.5);
    frame.lineTo(0.5, 0.5);
    frame.lineTo(-0.5, 0.5);
    const hole = new THREE.Path();
    hole.moveTo(-0.46, -0.46);
    hole.lineTo(-0.46, 0.46);
    hole.lineTo(0.46, 0.46);
    hole.lineTo(0.46, -0.46);
    frame.holes.push(hole);
    this.selFrame = new THREE.Mesh(new THREE.ShapeGeometry(frame).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9dff7a, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }));
    this.selFrame.visible = false;
    this.selFrame.renderOrder = 5;
    this.group.add(this.selFrame);
  }

  /** 建築底座的高度：取四角與中心的平均 */
  groundY(tx: number, ty: number, w: number, h: number): number {
    const t = this.terrain;
    return (t.heightAt(tx, ty) + t.heightAt(tx + w, ty) + t.heightAt(tx, ty + h) + t.heightAt(tx + w, ty + h) + t.heightAt(tx + w / 2, ty + h / 2)) / 5;
  }

  update(sim: Sim, selected: number): void {
    const bs = sim.buildings;
    const counts = new Int32Array(this.types.length);
    let crops = 0;
    let found = 0;
    this.selFrame.visible = false;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b]) continue;
      const bt = bs.btype[b];
      const def = BUILDING_DEFS[bt];
      const cx = bs.tx[b] + def.w / 2;
      const cz = bs.ty[b] + def.h / 2;
      const y = this.groundY(bs.tx[b], bs.ty[b], def.w, def.h);
      const need = def.buildTicks * 3;
      const p = bs.complete[b] ? 1 : bs.progress[b] / need;
      const tm = this.types[bt];
      const n = counts[bt]++;
      const sy = bs.complete[b] ? 1 : 0.08 + 0.92 * p;
      this.v.set(cx, y, cz);
      this.s.set(1, sy, 1);
      this.m.compose(this.v, this.q, this.s);
      tm.mesh.setMatrixAt(n, this.m);
      const col = this.teamRgb[bs.owner[b] % this.teamRgb.length];
      tm.team.setXYZ(n, col.r, col.g, col.b);
      if (!bs.complete[b]) {
        this.s.set(def.w - 0.1, 1, def.h - 0.1);
        this.v.set(cx, y + 0.02, cz);
        this.m.compose(this.v, this.q, this.s);
        this.foundations.setMatrixAt(found++, this.m);
      }
      if (def.id === 'farm' && bs.complete[b]) {
        this.s.set(1, 0.12 + 0.88 * Math.min(1, bs.food[b] / def.food), 1);
        this.v.set(cx, y, cz);
        this.m.compose(this.v, this.q, this.s);
        this.crops.setMatrixAt(crops++, this.m);
      }
      if (b === selected) {
        this.selFrame.visible = true;
        this.selFrame.position.set(cx, y + 0.08, cz);
        this.selFrame.scale.set(def.w + 0.3, 1, def.h + 0.3);
      }
    }
    for (let t = 0; t < this.types.length; t++) {
      const tm = this.types[t];
      tm.mesh.count = counts[t];
      tm.mesh.instanceMatrix.needsUpdate = true;
      tm.team.needsUpdate = true;
    }
    this.crops.count = crops;
    this.crops.instanceMatrix.needsUpdate = true;
    this.foundations.count = found;
    this.foundations.instanceMatrix.needsUpdate = true;
  }

  /** 放置預覽；btype < 0 隱藏 */
  setGhost(btype: number, tx: number, ty: number, valid: boolean): void {
    if (btype < 0) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostGrid.visible = false;
      return;
    }
    if (btype !== this.ghostType) {
      if (this.ghost) this.group.remove(this.ghost);
      this.ghost = new THREE.Mesh(this.geos[btype], this.ghostMat);
      this.ghost.renderOrder = 6;
      this.group.add(this.ghost);
      this.ghostType = btype;
    }
    const def = BUILDING_DEFS[btype];
    const y = this.groundY(tx, ty, def.w, def.h);
    this.ghost!.visible = true;
    this.ghost!.position.set(tx + def.w / 2, y, ty + def.h / 2);
    const color = valid ? 0x7dff8a : 0xff5a4a;
    this.ghostMat.color.setHex(color);
    (this.ghostGrid.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.ghostGrid.visible = true;
    this.ghostGrid.position.set(tx + def.w / 2, y + 0.15, ty + def.h / 2);
    this.ghostGrid.scale.set(def.w, 1, def.h);
  }

  heightOf(btype: number): number {
    return BUILDING_HEIGHT[BUILDING_DEFS[btype].id] ?? 1.5;
  }
}
