// 經濟系統測試（docs/09 M1）
import { describe, expect, it } from 'vitest';
import { BUILDING_INDEX, RK, UNIT_INDEX } from '../src/sim/core/defs';
import { ONE } from '../src/sim/core/fixed';
import { S, TASK } from '../src/sim/core/world';
import { Sim } from '../src/sim/sim';

const run = (sim: Sim, sec: number) => {
  for (let t = 0; t < sec * 10; t++) sim.step();
};
const myVillagers = (sim: Sim, p = 0) => {
  const w = sim.world;
  const out: number[] = [];
  for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === p && w.utype[id] === UNIT_INDEX.villager) out.push(id);
  return out;
};
const nearestRes = (sim: Sim, kind: number, p = 0) => {
  const s = sim.map.starts[p];
  return sim.findResource([kind], s.x * ONE, s.y * ONE, 40, s.x * ONE, s.y * ONE);
};
const townHall = (sim: Sim, p = 0) => {
  const bs = sim.buildings;
  for (let b = 0; b < bs.high; b++) if (bs.alive[b] && bs.owner[b] === p && bs.btype[b] === BUILDING_INDEX.town_hall) return b;
  return -1;
};
/** 太守府附近找一塊能蓋的地 */
const spotNear = (sim: Sim, btype: number, p = 0): [number, number] => {
  const s = sim.map.starts[p];
  for (let r = 4; r < 20; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && sim.canPlace(btype, s.x + dx, s.y + dy)) return [s.x + dx, s.y + dy];
  throw new Error('找不到空地');
};

describe('經濟', () => {
  it('標準開局：每位玩家一座太守府、4 名民夫、人口 4/10、起始資源', () => {
    const sim = new Sim({ seed: 11 });
    expect(townHall(sim, 0)).toBeGreaterThanOrEqual(0);
    expect(townHall(sim, 1)).toBeGreaterThanOrEqual(0);
    expect(myVillagers(sim).length).toBe(4);
    expect(sim.players[0].pop).toBe(4);
    expect(sim.players[0].popCap).toBe(10);
    expect(sim.players[0].res).toEqual([200, 200, 100, 150]);
    // 雙方起始資源點數量相同（對稱放置）
    const count = (p: number) => sim.map.resourceSpots.filter((r) => Math.abs(r.tx - sim.map.starts[p].x) + Math.abs(r.ty - sim.map.starts[p].y) < 40).length;
    expect(count(0)).toBe(count(1));
    expect(count(0)).toBeGreaterThanOrEqual(20);
  });

  it('採野果：民夫採滿 10 個自動回太守府交貨，再回去繼續', () => {
    const sim = new Sim({ seed: 11 });
    const vs = myVillagers(sim);
    const berry = nearestRes(sim, RK.berry);
    expect(berry).toBeGreaterThanOrEqual(0);
    sim.issue({ t: 'gather', player: 0, ids: vs, res: berry });
    run(sim, 90);
    expect(sim.players[0].res[0]).toBeGreaterThan(200 + 60);
    expect(sim.players[0].gathered[0]).toBeGreaterThan(60);
    for (const id of vs) expect([TASK.Gather, TASK.Return]).toContain(sim.world.task[id]);
  });

  it('蓋民居：完工後人口上限 +5；兩人一起蓋比較快', () => {
    const sim = new Sim({ seed: 11 });
    const vs = myVillagers(sim);
    const [tx, ty] = spotNear(sim, BUILDING_INDEX.house);
    sim.issue({ t: 'build', player: 0, ids: vs.slice(0, 2), btype: BUILDING_INDEX.house, tx, ty });
    run(sim, 1);
    expect(sim.players[0].res[1]).toBe(175);
    run(sim, 30);
    expect(sim.players[0].popCap).toBe(15);
  });

  it('太守府生民夫：18 秒一個、扣 50 糧、人口滿了會卡住', () => {
    const sim = new Sim({ seed: 11 });
    const th = townHall(sim);
    sim.issue({ t: 'train', player: 0, building: th, unit: UNIT_INDEX.villager, count: 3 });
    run(sim, 1);
    expect(sim.players[0].res[0]).toBe(50);
    run(sim, 18 * 3 + 2);
    expect(myVillagers(sim).length).toBe(7);
    // 人口上限 10：再排 4 個只會生 3 個
    sim.players[0].res[0] = 1000;
    sim.issue({ t: 'train', player: 0, building: th, unit: UNIT_INDEX.villager, count: 4 });
    run(sim, 18 * 4 + 5);
    expect(sim.players[0].pop).toBe(10);
    expect(sim.players[0].housed).toBe(true);
  });

  it('伐木場：蓋好後民夫自動砍附近的樹，木材增加', () => {
    const sim = new Sim({ seed: 11 });
    const vs = myVillagers(sim);
    const tree = nearestRes(sim, RK.tree);
    const tx = sim.res.tx[tree];
    const ty = sim.res.ty[tree];
    // 在樹旁找空地
    let spot: [number, number] | null = null;
    for (let r = 1; r < 8 && !spot; r++)
      for (let dy = -r; dy <= r && !spot; dy++)
        for (let dx = -r; dx <= r && !spot; dx++) if (sim.canPlace(BUILDING_INDEX.lumber_camp, tx + dx, ty + dy)) spot = [tx + dx, ty + dy];
    expect(spot).not.toBeNull();
    sim.issue({ t: 'build', player: 0, ids: vs.slice(0, 2), btype: BUILDING_INDEX.lumber_camp, tx: spot![0], ty: spot![1] });
    run(sim, 120);
    expect(sim.players[0].gathered[1]).toBeGreaterThan(40);
    expect(sim.world.task[vs[0]] === TASK.Gather || sim.world.task[vs[0]] === TASK.Return).toBe(true);
  });

  it('農田：蓋好的人直接去耕；耗盡後自動重播扣 60 木', () => {
    const sim = new Sim({ seed: 11 });
    const vs = myVillagers(sim);
    const [tx, ty] = spotNear(sim, BUILDING_INDEX.farm);
    sim.issue({ t: 'build', player: 0, ids: [vs[0]], btype: BUILDING_INDEX.farm, tx, ty });
    run(sim, 20);
    expect(sim.world.task[vs[0]]).toBe(TASK.Farm);
    run(sim, 40);
    expect(sim.players[0].gathered[0]).toBeGreaterThan(5);
    const farm = sim.bldTile[sim.map.idx(tx, ty)];
    sim.buildings.food[farm] = 1;
    const wood = sim.players[0].res[1];
    run(sim, 30);
    expect(sim.players[0].res[1]).toBe(wood - 60);
    expect(sim.buildings.alive[farm]).toBe(1);
  });

  it('移動指令會取消工作；樹砍完會變成可通行', () => {
    const sim = new Sim({ seed: 11 });
    const vs = myVillagers(sim);
    const tree = nearestRes(sim, RK.tree);
    sim.issue({ t: 'gather', player: 0, ids: [vs[0]], res: tree });
    run(sim, 20);
    sim.issue({ t: 'move', player: 0, ids: [vs[0]], x: sim.map.starts[0].x * ONE, y: sim.map.starts[0].y * ONE });
    run(sim, 1);
    expect(sim.world.task[vs[0]]).toBe(TASK.None);
    const i = sim.map.idx(sim.res.tx[tree], sim.res.ty[tree]);
    expect(sim.map.walkable(sim.res.tx[tree], sim.res.ty[tree])).toBe(false);
    sim.depleteResource(tree);
    expect(sim.resTile[i]).toBe(-1);
    expect(sim.map.walkable(sim.res.tx[tree], sim.res.ty[tree])).toBe(true);
    expect(sim.world.state[vs[0]]).not.toBe(S.Dead);
  });
});
