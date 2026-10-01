// 尋路與群體移動測試（docs/09 M0 驗收）
import { describe, expect, it } from 'vitest';
import { FX_SHIFT, ONE, tileCenter } from '../src/sim/core/fixed';
import { S } from '../src/sim/core/world';
import { MapGrid, T } from '../src/sim/map/grid';
import { Sim } from '../src/sim/sim';

/** 平地中間一道森林牆，牆上開一個 gap 格寬的缺口 */
function wallMap(size: number, gap: number): MapGrid {
  const m = new MapGrid(size, size);
  const wx = size >> 1;
  const g0 = (size >> 1) - (gap >> 1);
  for (let y = 0; y < size; y++) {
    if (y >= g0 && y < g0 + gap) continue;
    m.setTile(wx, y, T.Forest);
    m.setTile(wx + 1, y, T.Forest);
  }
  m.starts = [{ x: 8, y: size >> 1 }, { x: size - 9, y: size >> 1 }];
  return m;
}

describe('尋路', () => {
  it('A* 繞過森林牆，路徑點都在可走格上', () => {
    const map = wallMap(48, 2);
    const sim = new Sim({ seed: 1, map });
    const path = sim.pf.findPath(tileCenter(5), tileCenter(5), tileCenter(40), tileCenter(5));
    expect(path.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < path.length; i += 2) expect(map.walkableFx(path[i], path[i + 1])).toBe(true);
    expect(path[path.length - 2]).toBe(tileCenter(40));
  });

  it('Flow Field 從任何可達格都能一路走到目標', () => {
    const map = wallMap(48, 3);
    const sim = new Sim({ seed: 1, map });
    const field = sim.pf.flowField(40, 24);
    for (const [sx, sy] of [[2, 2], [5, 45], [20, 24]]) {
      let x = sx;
      let y = sy;
      for (let k = 0; k < 500 && field.dir[y * 48 + x] >= 0; k++) {
        const d = field.dir[y * 48 + x];
        x += [0, 1, 0, -1, 1, 1, -1, -1][d];
        y += [-1, 0, 1, 0, -1, 1, 1, -1][d];
      }
      expect([x, y]).toEqual([40, 24]);
    }
  });

  it('300 名士兵穿過 6 格寬的森林缺口、走約 60 格，100 秒內 ≥ 95% 抵達對岸並停下', () => {
    const map = wallMap(96, 6);
    const sim = new Sim({ seed: 3, map });
    sim.issue({ t: 'spawn', player: 0, unit: 2, x: tileCenter(20), y: tileCenter(48), count: 300 });
    sim.step();
    sim.issue({ t: 'move', player: 0, ids: Array.from({ length: 300 }, (_, i) => i), x: 76 * ONE, y: 48 * ONE });
    for (let t = 0; t < 1000; t++) sim.step();
    const w = sim.world;
    let arrived = 0;
    for (let id = 0; id < 300; id++) if (w.state[id] === S.Idle && w.x[id] >> FX_SHIFT > 50) arrived++;
    expect(arrived / 300).toBeGreaterThanOrEqual(0.95);
  });
});
