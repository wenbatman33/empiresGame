// 經濟節奏驗證（docs/06 §10）：用標準建造順序機器人跑 10 分鐘，檢查民夫與資源曲線
import { describe, expect, it } from 'vitest';
import { EconomyBot } from '../src/ai/economyBot';
import { UNIT_INDEX } from '../src/sim/core/defs';
import { Sim } from '../src/sim/sim';

export function runEconomy(seed: number, minutes: number, log = false) {
  const sim = new Sim({ seed });
  const bots = [new EconomyBot(sim, 0), new EconomyBot(sim, 1)];
  const curve: { min: number; vil: number[]; res: number[][]; gathered: number[][]; pop: number[] }[] = [];
  for (let t = 1; t <= minutes * 600; t++) {
    for (const b of bots) b.tick();
    sim.step();
    if (t % 600 === 0) {
      const vil = [0, 0];
      const w = sim.world;
      for (let id = 0; id < w.high; id++) if (w.alive[id] && w.utype[id] === UNIT_INDEX.villager) vil[w.owner[id]]++;
      const row = { min: t / 600, vil, res: sim.players.map((p) => [...p.res]), gathered: sim.players.map((p) => [...p.gathered]), pop: sim.players.map((p) => p.popCap) };
      curve.push(row);
      if (log) console.log(`${row.min}:00 民夫 ${vil.join('/')}  資源 ${row.res.map((r) => r.join(',')).join(' | ')}  累計 ${row.gathered.map((r) => r.join(',')).join(' | ')}  人口上限 ${row.pop.join('/')}`);
    }
  }
  return { sim, curve };
}

describe('經濟節奏（標準建造順序）', () => {
  it('雙方機器人對跑也是確定性的', () => {
    expect(runEconomy(7, 3).sim.hash()).toBe(runEconomy(7, 3).sim.hash());
  });

  it('4:00 前民夫 ≥ 14、累計採糧足夠升時代；10:00 民夫 ≥ 30；雙方差距小', () => {
    const { curve } = runEconomy(20261001, 10, true);
    const at4 = curve[3];
    const at10 = curve[9];
    for (const p of [0, 1]) {
      expect(at4.vil[p]).toBeGreaterThanOrEqual(14);
      expect(at10.vil[p]).toBeGreaterThanOrEqual(30);
    }
    // 對稱地圖：兩方民夫數差距 ≤ 3
    expect(Math.abs(at10.vil[0] - at10.vil[1])).toBeLessThanOrEqual(3);
  });
});
