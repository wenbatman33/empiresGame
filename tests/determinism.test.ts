// 確定性測試（docs/07 §3）：同種子 ＋ 同指令 → 每個 tick 的狀態雜湊完全一致
import { describe, expect, it } from 'vitest';
import { ONE, tileCenter } from '../src/sim/core/fixed';
import { Sim } from '../src/sim/sim';

function runScenario(seed: number): number[] {
  const sim = new Sim({ seed });
  const [a, b] = sim.map.starts;
  sim.issue({ t: 'spawn', player: 0, unit: 2, x: tileCenter(a.x), y: tileCenter(a.y), count: 120 });
  sim.issue({ t: 'spawn', player: 1, unit: 3, x: tileCenter(b.x), y: tileCenter(b.y), count: 120 });
  sim.issue({ t: 'spawn', player: 0, unit: 0, x: tileCenter(a.x + 3), y: tileCenter(a.y), count: 5 });
  const hashes: number[] = [];
  for (let t = 0; t < 400; t++) {
    if (t === 2) {
      // 兩軍對衝到地圖中央，再各派小隊（A* 路徑）
      sim.issue({ t: 'move', player: 0, ids: range(0, 120), x: 64 * ONE, y: 64 * ONE });
      sim.issue({ t: 'move', player: 1, ids: range(120, 240), x: 64 * ONE, y: 60 * ONE });
      sim.issue({ t: 'move', player: 0, ids: range(240, 245), x: tileCenter(a.x + 10), y: tileCenter(a.y + 2) });
    }
    if (t === 150) sim.issue({ t: 'move', player: 1, ids: range(120, 240), x: tileCenter(b.x), y: tileCenter(b.y) });
    if (t === 200) sim.issue({ t: 'stop', player: 0, ids: range(0, 60) });
    sim.step();
    hashes.push(sim.hash());
  }
  return hashes;
}

const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);

describe('確定性', () => {
  it('同種子同指令跑兩次，每個 tick 的雜湊都一樣', () => {
    const h1 = runScenario(20261001);
    const h2 = runScenario(20261001);
    expect(h2).toEqual(h1);
  });

  it('同種子產生同一張地圖，不同種子產生不同地圖', () => {
    expect(new Sim({ seed: 7 }).map.hash()).toBe(new Sim({ seed: 7 }).map.hash());
    expect(new Sim({ seed: 7 }).map.hash()).not.toBe(new Sim({ seed: 8 }).map.hash());
  });

  it('重播：用指令紀錄重跑，結果和原本一致', () => {
    const sim = new Sim({ seed: 42 });
    const [a] = sim.map.starts;
    sim.issue({ t: 'spawn', player: 0, unit: 1, x: tileCenter(a.x), y: tileCenter(a.y), count: 50 });
    for (let t = 0; t < 300; t++) {
      if (t === 5) sim.issue({ t: 'move', player: 0, ids: range(0, 50), x: 70 * ONE, y: 50 * ONE });
      if (t === 120) sim.issue({ t: 'move', player: 0, ids: range(0, 25), x: 30 * ONE, y: 90 * ONE });
      sim.step();
    }
    const replay = new Sim({ seed: 42 });
    for (const c of sim.history) replay.issue({ ...c }, c.tick - replay.tick);
    for (let t = 0; t < 300; t++) replay.step();
    expect(replay.hash()).toBe(sim.hash());
  });
});
