// M6 戰役測試：每一關都能載入、觸發器會動、確定性；教學關照劇本走得完
import { describe, expect, it } from 'vitest';
import { AIPlayer } from '../src/ai/ai';
import { SCENARIOS, SCENARIO_BY_ID } from '../src/data/campaigns';
import { RK, UNIT_INDEX } from '../src/sim/core/defs';
import { ONE } from '../src/sim/core/fixed';
import { S } from '../src/sim/core/world';
import { Sim } from '../src/sim/sim';

function load(id: string): Sim {
  return new Sim({ seed: 1, scenario: SCENARIO_BY_ID.get(id)! });
}

function run(sim: Sim, ticks: number, ais: AIPlayer[] = []): void {
  for (let t = 0; t < ticks && sim.winner < 0; t++) {
    for (const a of ais) a.tick();
    sim.step();
  }
}

function units(sim: Sim, p: number, id?: string): number[] {
  const w = sim.world;
  const out: number[] = [];
  for (let k = 0; k < w.high; k++) if (w.alive[k] && w.owner[k] === p && w.state[k] !== S.Dead && (!id || w.utype[k] === UNIT_INDEX[id])) out.push(k);
  return out;
}

describe('戰役劇本', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.id} ${sc.title}：載入、擺放、跑 3 分鐘不出錯，玩家不操作不會自己過關`, () => {
      const sim = load(sc.id);
      expect(units(sim, 0).length).toBeGreaterThan(0);
      sc.players.forEach((p, i) => expect(sim.players[i].age, `${sc.id} 玩家 ${i} 時代`).toBe(p.age ?? 1));
      for (const p of sc.place) {
        if (p.unit) expect(units(sim, p.player, p.unit).length, `${sc.id} ${p.unit}`).toBeGreaterThan(0);
      }
      const ais = sc.players.map((p, i) => (p.ai ? new AIPlayer(sim, i, p.ai) : null)).filter((a): a is AIPlayer => !!a);
      run(sim, 1800, ais);
      // 開場對話一定有
      expect(sim.scenario!.fired.has('intro')).toBe(true);
      expect(sim.winner).not.toBe(0);
    });
  }

  it('1-1 桃園結義：照教學走完會過關', () => {
    const sim = load('1-1');
    run(sim, 5);
    const [lb] = units(sim, 0, 'hero_liubei');
    const [tx, ty] = sim.scenario!.tile(['A', 8, 8]);
    sim.issue({ t: 'move', player: 0, ids: [lb], x: tx * ONE + 512, y: ty * ONE + 512 });
    run(sim, 300);
    expect(sim.scenario!.objectives.get('move')).toBe('done');
    // 民夫：採野果與木頭、蓋民居
    const vils = units(sim, 0, 'villager');
    let berry = -1;
    let tree = -1;
    const s0 = sim.map.starts[0];
    let bd = Infinity;
    let td = Infinity;
    for (let r = 0; r < sim.res.high; r++) {
      if (!sim.res.alive[r]) continue;
      const d = (sim.res.tx[r] - s0.x) ** 2 + (sim.res.ty[r] - s0.y) ** 2;
      if (sim.res.kind[r] === RK.berry && d < bd) [bd, berry] = [d, r];
      if (sim.res.kind[r] === RK.tree && d < td) [td, tree] = [d, r];
    }
    sim.issue({ t: 'gather', player: 0, ids: [vils[0], vils[1]], res: berry });
    sim.issue({ t: 'gather', player: 0, ids: [vils[2]], res: tree });
    run(sim, 600);
    // 找空地蓋民居
    let spot: [number, number] | null = null;
    for (let r = 4; r < 12 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) if (sim.canPlace(1, s0.x + dx, s0.y + dy)) spot = [s0.x + dx, s0.y + dy];
    sim.issue({ t: 'build', player: 0, ids: [vils[2]], btype: 1, tx: spot![0], ty: spot![1] });
    run(sim, 400);
    // 蓋完回去伐木
    sim.issue({ t: 'gather', player: 0, ids: [vils[2]], res: tree });
    run(sim, 6000);
    expect(sim.scenario!.objectives.get('house')).toBe('done');
    expect(sim.scenario!.objectives.get('gather')).toBe('done');
    expect(sim.winner).toBe(0);
  });

  it('1-3 涿郡之戰：劉備陣亡就失敗', () => {
    const sim = load('1-3');
    run(sim, 5);
    const [lb] = units(sim, 0, 'hero_liubei');
    sim.combat.applyDamage(1, lb, 99999, -1);
    run(sim, 20);
    expect(sim.winner).toBe(1);
  });

  it('戰役是確定性的（存檔重播靠這個）', () => {
    const play = () => {
      const sim = load('3-4');
      const ais = [new AIPlayer(sim, 1, 'easy')];
      run(sim, 2500, ais);
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
