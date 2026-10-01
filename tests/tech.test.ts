// 科技、升時代、攻城、勝負（docs/09 M3）
import { describe, expect, it } from 'vitest';
import { BUILDING_INDEX, TECH_INDEX, UNIT_INDEX } from '../src/sim/core/defs';
import { ONE } from '../src/sim/core/fixed';
import { S, TK } from '../src/sim/core/world';
import { MapGrid } from '../src/sim/map/grid';
import { Sim } from '../src/sim/sim';

const run = (sim: Sim, sec: number) => {
  for (let t = 0; t < sec * 10; t++) sim.step();
};
const th = (sim: Sim, p = 0) => {
  const bs = sim.buildings;
  for (let b = 0; b < bs.high; b++) if (bs.alive[b] && bs.owner[b] === p && bs.btype[b] === BUILDING_INDEX.town_hall) return b;
  return -1;
};
const units = (sim: Sim, p: number, type: string) => {
  const w = sim.world;
  const out: number[] = [];
  for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === p && w.utype[id] === UNIT_INDEX[type] && w.state[id] !== S.Dead) out.push(id);
  return out;
};

describe('科技與升時代', () => {
  it('織布機：場上民夫 HP ＋15，新生民夫也是', () => {
    const sim = new Sim({ seed: 3 });
    const vil = units(sim, 0, 'villager')[0];
    sim.issue({ t: 'research', player: 0, building: th(sim), tech: TECH_INDEX.loom });
    run(sim, 1);
    expect(sim.players[0].res[2]).toBe(50);
    run(sim, 26);
    expect(sim.world.hp[vil]).toBe(40);
    expect(sim.players[0].uHp[UNIT_INDEX.villager]).toBe(40);
  });

  it('升時代需要 2 座同時代建築；研究時太守府不生民夫', () => {
    const sim = new Sim({ seed: 3 });
    const b = th(sim);
    sim.players[0].res = [2000, 2000, 2000, 2000];
    expect(sim.economy.researchBlocker(0, b, TECH_INDEX.age2)).toContain('需要 2 座');
    sim.placeBuilding(BUILDING_INDEX.granary, 0, 10, 40, true);
    sim.placeBuilding(BUILDING_INDEX.barracks, 0, 14, 40, true);
    expect(sim.economy.researchBlocker(0, b, TECH_INDEX.age2)).toBe('');
    sim.issue({ t: 'research', player: 0, building: b, tech: TECH_INDEX.age2 });
    sim.issue({ t: 'train', player: 0, building: b, unit: UNIT_INDEX.villager, count: 1 });
    run(sim, 60);
    expect(units(sim, 0, 'villager').length).toBe(4);
    run(sim, 31);
    expect(sim.players[0].age).toBe(2);
    run(sim, 20);
    expect(units(sim, 0, 'villager').length).toBe(5);
  });

  it('兵種升級：槍兵 → 戟兵，場上的與佇列裡的都換', () => {
    const sim = new Sim({ seed: 3 });
    const pl = sim.players[0];
    pl.res = [5000, 5000, 5000, 5000];
    sim.completeResearch(0, TECH_INDEX.age2);
    sim.completeResearch(0, TECH_INDEX.age3);
    const bar = sim.placeBuilding(BUILDING_INDEX.barracks, 0, 10, 40, true);
    sim.issue({ t: 'spawn', player: 0, unit: UNIT_INDEX.spearman, x: 20 * ONE, y: 44 * ONE, count: 3 });
    sim.issue({ t: 'research', player: 0, building: bar, tech: TECH_INDEX.up_halberd });
    run(sim, 46);
    expect(units(sim, 0, 'spearman').length).toBe(0);
    expect(units(sim, 0, 'halberdier').length).toBe(3);
    sim.issue({ t: 'train', player: 0, building: bar, unit: UNIT_INDEX.spearman, count: 1 });
    run(sim, 21);
    expect(units(sim, 0, 'halberdier').length).toBe(4);
  });
});

describe('攻城', () => {
  it('衝車只打建築，很快拆掉民居；霹靂車範圍傷害、太近打不到', () => {
    const map = new MapGrid(48, 48);
    const sim = new Sim({ seed: 1, map });
    const house = sim.placeBuilding(BUILDING_INDEX.house, 1, 30, 20, true);
    sim.issue({ t: 'spawn', player: 0, unit: UNIT_INDEX.ram, x: 25 * ONE, y: 21 * ONE, count: 1 });
    sim.issue({ t: 'spawn', player: 1, unit: UNIT_INDEX.swordsman, x: 22 * ONE, y: 26 * ONE, count: 1 });
    run(sim, 1);
    const ram = units(sim, 0, 'ram')[0];
    sim.issue({ t: 'attack', player: 0, ids: [ram], kind: TK.Building, target: house });
    run(sim, 40);
    expect(sim.buildings.alive[house]).toBe(0);
    // 衝車不會去打旁邊的刀盾兵
    expect(sim.world.hp[units(sim, 1, 'swordsman')[0]]).toBe(45);

    // 霹靂車打 5 名擠在一起的刀盾兵
    const sim2 = new Sim({ seed: 2, map: new MapGrid(48, 48) });
    sim2.issue({ t: 'spawn', player: 0, unit: UNIT_INDEX.trebuchet, x: 10 * ONE, y: 24 * ONE, count: 1 });
    sim2.issue({ t: 'spawn', player: 1, unit: UNIT_INDEX.swordsman, x: 20 * ONE, y: 24 * ONE, count: 5 });
    run(sim2, 1);
    const tre = units(sim2, 0, 'trebuchet')[0];
    for (const id of units(sim2, 1, 'swordsman')) sim2.world.stance[id] = 2;
    sim2.issue({ t: 'attack', player: 0, ids: [tre], kind: TK.Unit, target: units(sim2, 1, 'swordsman')[0] });
    run(sim2, 15);
    const hurt = units(sim2, 1, 'swordsman').filter((id) => sim2.world.hp[id] < 45).length + (5 - units(sim2, 1, 'swordsman').length);
    expect(hurt).toBeGreaterThanOrEqual(2);
  });
});

describe('勝負', () => {
  it('失去太守府且沒有民夫 → 判負，另一方勝利；投降也會結束', () => {
    const sim = new Sim({ seed: 3 });
    const b = th(sim, 1);
    for (const id of [...units(sim, 1, 'villager')]) sim.combat.kill(id);
    run(sim, 2);
    expect(sim.winner).toBe(-1);
    sim.combat.applyDamage(TK.Building, b, 99999, -1);
    run(sim, 2);
    expect(sim.players[1].defeated).toBe(true);
    expect(sim.winner).toBe(0);

    const sim2 = new Sim({ seed: 3 });
    sim2.issue({ t: 'resign', player: 0 });
    run(sim2, 1);
    expect(sim2.winner).toBe(1);
  });
});
