// M4 三國特色測試：勢力被動、武將技、謀士勸降、火攻、稱帝、奇觀、水軍、地圖類型、確定性
import { describe, expect, it } from 'vitest';
import { AIPlayer } from '../src/ai/ai';
import { BUILDING_INDEX, RK, UNIT_DEFS, UNIT_INDEX } from '../src/sim/core/defs';
import { FX_SHIFT, ONE } from '../src/sim/core/fixed';
import { S } from '../src/sim/core/world';
import { MapGrid, T } from '../src/sim/map/grid';
import { generateMap } from '../src/sim/map/generator';
import { Pathfinder } from '../src/sim/systems/pathfinding';
import { Sim } from '../src/sim/sim';

/** 平地測試場 */
function flat(factions = ['wei', 'shu'], w = 60, h = 40): Sim {
  const map = new MapGrid(w, h);
  map.starts = [{ x: 6, y: 20 }, { x: w - 7, y: 20 }];
  return new Sim({ seed: 7, map, factions });
}

function spawn(sim: Sim, player: number, unit: string, x: number, y: number, count = 1): number[] {
  const before = sim.world.high;
  sim.issue({ t: 'spawn', player, unit: UNIT_INDEX[unit], x: x * ONE, y: y * ONE, count });
  sim.step();
  const out: number[] = [];
  for (let id = 0; id < sim.world.high; id++) if (sim.world.alive[id] && sim.world.owner[id] === player && sim.world.utype[id] === UNIT_INDEX[unit] && (id >= before || out.length < count)) out.push(id);
  // 測試直接施放，不等開場冷卻
  for (const id of out) sim.world.skillReady[id] = 0;
  return out.slice(-count);
}

function run(sim: Sim, ticks: number): void {
  for (let t = 0; t < ticks; t++) sim.step();
}

describe('勢力被動', () => {
  it('魏騎兵 HP ＋10%、蜀武將成本 −25%、吳船隻成本 −15%', () => {
    const sim = flat(['wei', 'shu']);
    const wei = sim.players[0];
    const shu = sim.players[1];
    const lc = UNIT_INDEX.light_cav;
    expect(wei.uHp[lc]).toBe(Math.round((UNIT_DEFS[lc].hp * 110) / 100));
    expect(shu.uHp[lc]).toBe(UNIT_DEFS[lc].hp);
    const gy = UNIT_INDEX.hero_guanyu;
    const base = UNIT_DEFS[gy].cost.reduce((a, b) => a + b, 0);
    expect(shu.unitCost(gy).reduce((a, b) => a + b, 0)).toBeLessThan(base);
    const wu = flat(['wu', 'wei']).players[0];
    const gal = UNIT_INDEX.galley;
    expect(wu.unitCost(gal)[1]).toBeLessThan(UNIT_DEFS[gal].cost[1]);
  });

  it('他勢力的特殊兵種、武將不能生產', () => {
    const sim = flat(['wei', 'shu']);
    sim.players[0].age = 3;
    expect(sim.economy.trainBlocker(0, UNIT_INDEX.repeater)).not.toBe('');
    expect(sim.economy.trainBlocker(0, UNIT_INDEX.tiger_cav)).toBe('');
    expect(sim.economy.trainBlocker(0, UNIT_INDEX.hero_guanyu)).not.toBe('');
    expect(sim.economy.trainBlocker(0, UNIT_INDEX.hero_caocao)).toBe('');
  });
});

describe('武將技', () => {
  it('關羽青龍偃月斬：前方敵人受傷，冷卻 60 秒', () => {
    const sim = flat(['shu', 'wei']);
    const [gy] = spawn(sim, 0, 'hero_guanyu', 20, 20);
    const foes = spawn(sim, 1, 'spearman', 22, 20, 3);
    for (const f of foes) sim.world.stance[f] = 3;
    const hp0 = foes.map((f) => sim.world.hp[f]);
    sim.issue({ t: 'skill', player: 0, id: gy, x: 24 * ONE, y: 20 * ONE });
    sim.step();
    const hurt = foes.filter((f, k) => sim.world.hp[f] < hp0[k] || sim.world.state[f] === S.Dead).length;
    expect(hurt).toBeGreaterThan(0);
    expect(sim.world.skillReady[gy]).toBeGreaterThan(sim.tick + 500);
  });

  it('張飛長坂怒吼：敵人恐懼逃跑', () => {
    const sim = flat(['shu', 'wei']);
    const [zf] = spawn(sim, 0, 'hero_zhangfei', 20, 20);
    const foes = spawn(sim, 1, 'swordsman', 23, 20, 4);
    sim.issue({ t: 'skill', player: 0, id: zf, x: 0, y: 0 });
    run(sim, 2);
    expect(foes.every((f) => sim.world.fearUntil[f] > sim.tick)).toBe(true);
    const x0 = foes.map((f) => sim.world.x[f]);
    run(sim, 20);
    expect(foes.filter((f, k) => sim.world.x[f] > x0[k]).length).toBeGreaterThan(1);
  });

  it('諸葛亮八陣圖：區域內敵人減速', () => {
    const sim = flat(['shu', 'wei']);
    const [zg] = spawn(sim, 0, 'hero_zhuge', 10, 20);
    const [foe] = spawn(sim, 1, 'light_cav', 30, 20);
    sim.issue({ t: 'skill', player: 0, id: zg, x: 30 * ONE, y: 20 * ONE });
    run(sim, 12);
    expect(sim.speedPct(foe)).toBe(50);
  });

  it('武將擊殺累積威名升級', () => {
    const sim = flat(['shu', 'wei']);
    const [gy] = spawn(sim, 0, 'hero_guanyu', 20, 20);
    for (let k = 0; k < 10; k++) sim.abilities.onKill(gy, false);
    expect(sim.world.level[gy]).toBe(2);
    expect(sim.abilities.maxHp(gy)).toBeGreaterThan(sim.players[0].uHp[UNIT_INDEX.hero_guanyu]);
  });
});

describe('謀士', () => {
  it('勸降：對敵兵持續遊說後倒戈；武將不可勸降', () => {
    const sim = flat(['wei', 'shu']);
    const [st] = spawn(sim, 0, 'strategist', 20, 20);
    const [foe] = spawn(sim, 1, 'swordsman', 26, 20);
    sim.world.stance[foe] = 3;
    sim.issue({ t: 'attack', player: 0, ids: [st], kind: 1, target: foe });
    run(sim, 120);
    expect(sim.world.owner[foe]).toBe(0);
    const [hero] = spawn(sim, 1, 'hero_zhaoyun', 26, 24);
    sim.world.stance[hero] = 3;
    sim.issue({ t: 'attack', player: 0, ids: [st], kind: 1, target: hero });
    run(sim, 120);
    expect(sim.world.owner[hero]).toBe(1);
  });

  it('治療：自動回復附近受傷友軍', () => {
    const sim = flat(['wei', 'shu']);
    spawn(sim, 0, 'strategist', 20, 20);
    const [sw] = spawn(sim, 0, 'swordsman', 21, 20);
    sim.world.hp[sw] = 10;
    run(sim, 50);
    expect(sim.world.hp[sw]).toBeGreaterThan(10);
  });
});

describe('計策與火焰', () => {
  it('火攻計：燒建築與單位、扣資源、進入冷卻', () => {
    const sim = flat(['wu', 'wei']);
    const pl = sim.players[0];
    pl.age = 3;
    sim.placeBuilding(BUILDING_INDEX.academy, 0, 4, 4, true);
    const house = sim.placeBuilding(BUILDING_INDEX.house, 1, 40, 20, true);
    const hp0 = sim.buildings.hp[house];
    const gold0 = pl.res[2] + 1000;
    pl.res[2] += 1000;
    sim.issue({ t: 'stratagem', player: 0, kind: 'fire', x: 41 * ONE, y: 21 * ONE });
    run(sim, 40);
    expect(pl.res[2]).toBe(gold0 - 300);
    expect(sim.buildings.hp[house]).toBeLessThan(hp0);
    expect(sim.abilities.stratagemBlocker(0, 'fire')).toContain('冷卻');
  });

  it('疑兵計：幻影兵 30 秒後消失', () => {
    const sim = flat(['wu', 'wei']);
    sim.players[0].age = 3;
    sim.players[0].res[2] += 1000;
    sim.placeBuilding(BUILDING_INDEX.academy, 0, 4, 4, true);
    sim.issue({ t: 'stratagem', player: 0, kind: 'decoy', x: 30 * ONE, y: 20 * ONE });
    run(sim, 2);
    const count = () => {
      let n = 0;
      for (let id = 0; id < sim.world.high; id++) if (sim.world.alive[id] && sim.world.utype[id] === UNIT_INDEX.phantom && sim.world.state[id] !== S.Dead) n++;
      return n;
    };
    expect(count()).toBe(10);
    run(sim, 310);
    expect(count()).toBe(0);
  });
});

describe('特殊勝利', () => {
  it('奇觀完工守住 300 秒 → 勝利', () => {
    const sim = flat(['wei', 'shu'], 60, 40);
    sim.placeBuilding(BUILDING_INDEX.town_hall, 0, 4, 18, true);
    sim.placeBuilding(BUILDING_INDEX.town_hall, 1, 52, 18, true);
    spawn(sim, 1, 'villager', 54, 24);
    sim.placeBuilding(BUILDING_INDEX.wonder, 0, 10, 10, true);
    run(sim, 3020);
    expect(sim.winner).toBe(0);
    expect(sim.winReason).toBe('wonder');
  });

  it('謀士把玉璽送回書院守住 300 秒 → 稱帝', () => {
    const map = new MapGrid(60, 40);
    map.starts = [{ x: 6, y: 20 }, { x: 53, y: 20 }];
    map.itemSpots = [{ kind: 'seal', tx: 30, ty: 20 }];
    const sim = new Sim({ seed: 3, map, factions: ['shu', 'wu'] });
    sim.placeBuilding(BUILDING_INDEX.town_hall, 0, 4, 18, true);
    sim.placeBuilding(BUILDING_INDEX.town_hall, 1, 52, 18, true);
    spawn(sim, 1, 'villager', 54, 24);
    sim.placeBuilding(BUILDING_INDEX.academy, 0, 12, 19, true);
    const [st] = spawn(sim, 0, 'strategist', 20, 20);
    sim.issue({ t: 'pickup', player: 0, ids: [st], item: 0 });
    run(sim, 300);
    expect(sim.abilities.items[0].carrier).toBe(st);
    sim.issue({ t: 'move', player: 0, ids: [st], x: 15 * ONE + (ONE >> 1), y: 20 * ONE + (ONE >> 1) });
    run(sim, 400);
    expect(sim.abilities.items[0].academy).toBeGreaterThanOrEqual(0);
    run(sim, 3010);
    expect(sim.winner).toBe(0);
    expect(sim.winReason).toBe('seal');
  });
});

describe('水軍', () => {
  /** 中間一條 8 格寬的深水 */
  function strait(): Sim {
    const map = new MapGrid(60, 40);
    map.starts = [{ x: 6, y: 20 }, { x: 53, y: 20 }];
    for (let y = 0; y < 40; y++) for (let x = 26; x < 34; x++) map.setTile(x, y, x === 26 || x === 33 ? T.Shallow : T.Deep);
    map.resourceSpots.push({ kind: RK.fish, tx: 29, ty: 10 });
    const sim = new Sim({ seed: 5, map, factions: ['wu', 'wei'] });
    sim.placeBuilding(BUILDING_INDEX.town_hall, 0, 4, 18, true);
    sim.placeBuilding(BUILDING_INDEX.town_hall, 1, 52, 18, true);
    return sim;
  }

  it('船塢只能蓋在岸邊；漁船捕魚交到船塢', () => {
    const sim = strait();
    expect(sim.canPlace(BUILDING_INDEX.dock, 10, 10)).toBe(false);
    let spot = -1;
    for (let x = 22; x < 30 && spot < 0; x++) if (sim.canPlace(BUILDING_INDEX.dock, x, 12)) spot = x;
    expect(spot).toBeGreaterThan(0);
    const dock = sim.placeBuilding(BUILDING_INDEX.dock, 0, spot, 12, true);
    sim.issue({ t: 'train', player: 0, building: dock, unit: UNIT_INDEX.fishing_boat, count: 1 });
    run(sim, 320);
    let boat = -1;
    for (let id = 0; id < sim.world.high; id++) if (sim.world.alive[id] && sim.world.utype[id] === UNIT_INDEX.fishing_boat) boat = id;
    expect(boat).toBeGreaterThanOrEqual(0);
    const t = sim.map.tiles[sim.map.idx(sim.world.x[boat] >> FX_SHIFT, sim.world.y[boat] >> FX_SHIFT)];
    expect(t === T.Deep || t === T.Shallow).toBe(true);
    let fish = -1;
    for (let r = 0; r < sim.res.high; r++) if (sim.res.alive[r] && sim.res.kind[r] === RK.fish) fish = r;
    const food0 = sim.players[0].res[0];
    sim.issue({ t: 'gather', player: 0, ids: [boat], res: fish });
    run(sim, 900);
    expect(sim.players[0].res[0]).toBeGreaterThan(food0);
  });

  it('運兵船載兵渡江、卸到對岸', () => {
    const sim = strait();
    const [ship] = spawn(sim, 0, 'transport', 28, 20);
    const troops = spawn(sim, 0, 'swordsman', 23, 20, 4);
    sim.issue({ t: 'board', player: 0, ids: troops, ship });
    run(sim, 150);
    expect(troops.filter((id) => sim.world.aboard[id] === ship).length).toBe(4);
    sim.issue({ t: 'unload', player: 0, ship, x: 32 * ONE, y: 20 * ONE });
    run(sim, 200);
    expect(troops.every((id) => sim.world.aboard[id] < 0 && sim.world.x[id] >> FX_SHIFT >= 33)).toBe(true);
  });

  it('火船自爆：重創敵船、自己沉沒', () => {
    const sim = strait();
    const [fire] = spawn(sim, 0, 'fire_ship', 29, 15);
    const foes = spawn(sim, 1, 'galley', 29, 22, 3);
    for (const f of foes) sim.world.stance[f] = 3;
    sim.issue({ t: 'attack', player: 0, ids: [fire], kind: 1, target: foes[0] });
    run(sim, 120);
    expect(sim.world.state[fire] === S.Dead || !sim.world.alive[fire]).toBe(true);
    expect(foes.filter((f) => !sim.world.alive[f] || sim.world.state[f] === S.Dead || sim.world.hp[f] < sim.players[1].uHp[UNIT_INDEX.galley]).length).toBeGreaterThan(1);
  });
});

describe('木牛流馬', () => {
  it('民夫把資源交給附近的木牛流馬', () => {
    const map = new MapGrid(70, 40);
    map.starts = [{ x: 6, y: 20 }, { x: 63, y: 20 }];
    for (let y = 10; y < 30; y++) for (let x = 55; x < 58; x++) map.setTile(x, y, T.Forest);
    const fresh = new Sim({ seed: 9, map, factions: ['shu', 'wei'] });
    fresh.placeBuilding(BUILDING_INDEX.town_hall, 0, 2, 18, true);
    spawn(fresh, 0, 'ox_cart', 52, 20);
    const [v] = spawn(fresh, 0, 'villager', 53, 21);
    let tree = -1;
    for (let r = 0; r < fresh.res.high; r++) if (fresh.res.alive[r] && fresh.res.kind[r] === RK.tree && fresh.res.tx[r] === 55 && fresh.res.ty[r] === 20) tree = r;
    fresh.issue({ t: 'gather', player: 0, ids: [v], res: tree });
    const wood0 = fresh.players[0].res[1];
    run(fresh, 700);
    // 往返太守府要 90 格以上，700 tick 內交了 2 趟以上表示交給了木牛流馬
    expect(fresh.players[0].res[1]).toBeGreaterThanOrEqual(wood0 + 20);
  });
});

describe('地圖類型', () => {
  for (const type of ['central', 'yangtze', 'shudao', 'chibi']) {
    it(`${type}：起始點互通、兵書玉璽 5 件、水圖有魚`, () => {
      const m = generateMap(type, 1234, 96);
      expect(m.type).toBe(type);
      expect(m.itemSpots.length).toBe(5);
      const sim = new Sim({ seed: 1234, map: m, start: 'standard' });
      const pf = new Pathfinder(sim.map);
      const [a, b] = sim.map.starts;
      const [ax, ay] = pf.nearestWalkable(a.x + 3, a.y + 3);
      const [bx, by] = pf.nearestWalkable(b.x - 3, b.y - 3);
      const path = pf.findPath(ax, ay, bx, by);
      expect(path.length).toBeGreaterThan(0);
      const fish = m.resourceSpots.filter((r) => r.kind === RK.fish).length;
      if (type === 'yangtze' || type === 'chibi') expect(fish).toBeGreaterThanOrEqual(6);
      else expect(fish).toBe(0);
    });
  }

  it('同種子產生同一張地圖', () => {
    const a = generateMap('shudao', 77, 96);
    const b = generateMap('shudao', 77, 96);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
  });
});

describe('確定性（含三國特色）', () => {
  it('赤壁 AI 對 AI 跑兩次雜湊一致', () => {
    const play = () => {
      const sim = new Sim({ seed: 4242, mapSize: 96, mapType: 'chibi', factions: ['wu', 'wei'] });
      const ais = [new AIPlayer(sim, 0, 'hard'), new AIPlayer(sim, 1, 'hard')];
      for (let t = 0; t < 4000; t++) {
        for (const ai of ais) ai.tick();
        sim.step();
      }
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
