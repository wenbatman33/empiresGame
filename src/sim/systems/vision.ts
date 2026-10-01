// 視野（docs/05 §5）：每位玩家一張可視格網，每 2 tick 更新
// 0 ＝ 未探索、explored ＝ 看過、visible ＝ 現在看得到；電腦 AI 也只能用這張圖（不作弊）
import { BUILDING_DEFS, UNIT_DEFS } from '../core/defs';
import { FX_SHIFT } from '../core/fixed';
import { S } from '../core/world';
import type { Sim } from '../sim';

export class VisionSystem {
  readonly visible: Uint8Array[] = [];
  readonly explored: Uint8Array[] = [];
  /** 半徑 → 圓形印章的 (dx, dy) */
  private stamps = new Map<number, Int8Array>();
  /** 每次更新後遞增（渲染層用來決定要不要重畫迷霧） */
  version = 0;

  constructor(private sim: Sim) {
    const n = sim.map.w * sim.map.h;
    for (let p = 0; p < sim.players.length; p++) {
      this.visible.push(new Uint8Array(n));
      this.explored.push(new Uint8Array(n));
    }
  }

  private stamp(r: number): Int8Array {
    let s = this.stamps.get(r);
    if (s) return s;
    const pts: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) pts.push(dx, dy);
    s = Int8Array.from(pts);
    this.stamps.set(r, s);
    return s;
  }

  private mark(p: number, tx: number, ty: number, r: number): void {
    const m = this.sim.map;
    const vis = this.visible[p];
    const exp = this.explored[p];
    const s = this.stamp(r);
    for (let k = 0; k < s.length; k += 2) {
      const x = tx + s[k];
      const y = ty + s[k + 1];
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const i = y * m.w + x;
      vis[i] = 1;
      exp[i] = 1;
    }
  }

  private readonly zhuge = UNIT_DEFS.findIndex((u) => u.id === 'hero_zhuge');
  private readonly simayi = UNIT_DEFS.findIndex((u) => u.id === 'hero_simayi');

  step(): void {
    const sim = this.sim;
    if (sim.tick % 2 !== 0) return;
    for (const v of this.visible) v.fill(0);
    const w = sim.world;
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.state[id] === S.Dead) continue;
      if (w.aboard[id] >= 0) continue;
      // 諸葛亮臥龍：視野 ＋4；司馬懿鷹視狼顧：半徑 12 永遠可見
      const ut = w.utype[id];
      const sight = ut === this.zhuge ? UNIT_DEFS[ut].sight + 4 : ut === this.simayi ? Math.max(12, UNIT_DEFS[ut].sight) : UNIT_DEFS[ut].sight;
      this.mark(w.owner[id], w.x[id] >> FX_SHIFT, w.y[id] >> FX_SHIFT, sight);
    }
    const bs = sim.buildings;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b]) continue;
      const def = BUILDING_DEFS[bs.btype[b]];
      this.mark(bs.owner[b], bs.tx[b] + (def.w >> 1), bs.ty[b] + (def.h >> 1), bs.complete[b] ? def.sight + (def.w >> 1) : 2);
    }
    this.version++;
  }

  isVisible(p: number, tx: number, ty: number): boolean {
    return this.visible[p][ty * this.sim.map.w + tx] === 1;
  }

  isExplored(p: number, tx: number, ty: number): boolean {
    return this.explored[p][ty * this.sim.map.w + tx] === 1;
  }
}
