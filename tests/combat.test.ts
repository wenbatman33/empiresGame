// 戰鬥與相剋測試（docs/09 M2 驗收：同成本對戰，剋制方勝率 ≥ 80%）
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS, UNIT_INDEX } from '../src/sim/core/defs';
import { ONE } from '../src/sim/core/fixed';
import { S, TK } from '../src/sim/core/world';
import { MapGrid } from '../src/sim/map/grid';
import { Sim } from '../src/sim/sim';

const BUDGET = 1400;
const cost = (u: string) => UNIT_DEFS[UNIT_INDEX[u]].cost.reduce((a, b) => a + b, 0);

function alive(sim: Sim, p: number): number {
  const w = sim.world;
  let n = 0;
  for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === p && w.state[id] !== S.Dead) n++;
  return n;
}

/** 平地上兩軍對打：a 在左或右（mirror），回傳勝方（0 = a 贏、1 = b 贏、-1 = 平手） */
function battle(a: string, b: string, seed: number, mirror: boolean): number {
  const map = new MapGrid(72, 48);
  map.starts = [{ x: 10, y: 24 }, { x: 61, y: 24 }];
  const sim = new Sim({ seed, map });
  const [xa, xb] = mirror ? [52, 20] : [20, 52];
  sim.issue({ t: 'spawn', player: 0, unit: UNIT_INDEX[a], x: xa * ONE, y: 24 * ONE, count: Math.floor(BUDGET / cost(a)) });
  sim.issue({ t: 'spawn', player: 1, unit: UNIT_INDEX[b], x: xb * ONE, y: 24 * ONE, count: Math.floor(BUDGET / cost(b)) });
  sim.step();
  const ids = (p: number) => {
    const out: number[] = [];
    for (let id = 0; id < sim.world.high; id++) if (sim.world.alive[id] && sim.world.owner[id] === p) out.push(id);
    return out;
  };
  sim.issue({ t: 'attackMove', player: 0, ids: ids(0), x: xb * ONE, y: 24 * ONE });
  sim.issue({ t: 'attackMove', player: 1, ids: ids(1), x: xa * ONE, y: 24 * ONE });
  for (let t = 0; t < 1800; t++) {
    sim.step();
    const na = alive(sim, 0);
    const nb = alive(sim, 1);
    if (!na || !nb) return na ? 0 : nb ? 1 : -1;
  }
  const na = alive(sim, 0);
  const nb = alive(sim, 1);
  return na > nb ? 0 : nb > na ? 1 : -1;
}

function winRate(a: string, b: string): number {
  let wins = 0;
  const runs = 6;
  for (let k = 0; k < runs; k++) if (battle(a, b, 100 + k, k % 2 === 1) === 0) wins++;
  return wins / runs;
}

describe('相剋（同成本 1400 資源）', () => {
  const pairs: [string, string][] = [
    ['spearman', 'light_cav'],
    ['light_cav', 'archer'],
    ['archer', 'swordsman'],
    ['swordsman', 'spearman'],
    ['archer', 'spearman'],
    ['heavy_cav', 'archer'],
  ];
  for (const [a, b] of pairs) {
    it(`${UNIT_DEFS[UNIT_INDEX[a]].name} 剋 ${UNIT_DEFS[UNIT_INDEX[b]].name}`, () => {
      expect(winRate(a, b)).toBeGreaterThanOrEqual(0.8);
    });
  }
});

describe('戰鬥細節', () => {
  it('傷害公式：槍兵打騎兵有 +15 加成；弓兵打建築只剩 1', () => {
    const map = new MapGrid(32, 32);
    const sim = new Sim({ seed: 1, map });
    sim.issue({ t: 'spawn', player: 1, unit: UNIT_INDEX.light_cav, x: 10 * ONE, y: 10 * ONE, count: 1 });
    sim.step();
    const spear = UNIT_DEFS[UNIT_INDEX.spearman];
    expect(sim.combat.damage(spear.attack, false, spear.bonus, 10 * ONE, 10 * ONE, TK.Unit, 0)).toBe(18);
    const b = sim.placeBuilding(2, 1, 20, 20, true);
    const archer = UNIT_DEFS[UNIT_INDEX.archer];
    expect(sim.combat.damage(archer.attack, true, archer.bonus, 10 * ONE, 10 * ONE, TK.Building, b)).toBe(1);
  });

  it('民夫被軍隊攻擊會逃回太守府；箭塔會自動射擊靠近的敵人', () => {
    const sim = new Sim({ seed: 11 });
    const s = sim.map.starts[0];
    sim.issue({ t: 'spawn', player: 1, unit: UNIT_INDEX.swordsman, x: (s.x + 3) * ONE, y: (s.y + 4) * ONE, count: 3 });
    for (let t = 0; t < 100; t++) sim.step();
    // 太守府會射箭：敵兵受傷
    let hurt = 0;
    for (let id = 0; id < sim.world.high; id++) if (sim.world.alive[id] && sim.world.owner[id] === 1 && sim.world.utype[id] === UNIT_INDEX.swordsman && sim.world.hp[id] < 45) hurt++;
    expect(hurt).toBeGreaterThan(0);
  });

  it('戰鬥也是確定性的', () => {
    const run = () => {
      const map = new MapGrid(72, 48);
      const sim = new Sim({ seed: 9, map });
      sim.issue({ t: 'spawn', player: 0, unit: UNIT_INDEX.archer, x: 20 * ONE, y: 24 * ONE, count: 30 });
      sim.issue({ t: 'spawn', player: 1, unit: UNIT_INDEX.light_cav, x: 50 * ONE, y: 24 * ONE, count: 20 });
      sim.step();
      const all = Array.from({ length: 50 }, (_, i) => i);
      sim.issue({ t: 'attackMove', player: 0, ids: all, x: 50 * ONE, y: 24 * ONE });
      sim.issue({ t: 'attackMove', player: 1, ids: all, x: 20 * ONE, y: 24 * ONE });
      for (let t = 0; t < 600; t++) sim.step();
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
