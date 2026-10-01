// 無頭 AI 對戰（docs/05 §8）：npm run ai-arena
// 環境變數 GAMES（每組幾場，預設 20）、MAP（地圖大小，預設 96）
import { it } from 'vitest';
import { AIPlayer, type Difficulty } from '../src/ai/ai';
import { Sim } from '../src/sim/sim';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const GAMES = Number(env.GAMES ?? 20);
const MAP = Number(env.MAP ?? 96);
const LIMIT = 45 * 600;

function play(seed: number, d0: Difficulty, d1: Difficulty) {
  const sim = new Sim({ seed, mapSize: MAP, handicap: [d0 === 'easy' ? 800 : 1000, d1 === 'easy' ? 800 : 1000] });
  const ais = [new AIPlayer(sim, 0, d0), new AIPlayer(sim, 1, d1)];
  const ages: number[][] = [[], []];
  while (sim.tick < LIMIT && sim.winner < 0) {
    for (const a of ais) a.tick();
    sim.step();
    for (const p of [0, 1]) if (sim.players[p].age > ages[p].length + 1) ages[p].push(sim.tick / 600);
  }
  return { winner: sim.winner, min: sim.tick / 600, first: ais.map((a) => (a.firstAttackTick < 0 ? NaN : a.firstAttackTick / 600)), ages };
}

const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const med = (a: number[]) => {
  if (!a.length) return NaN;
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
};

it('AI 對戰統計', () => {
  for (const [d0, d1] of [['normal', 'normal'], ['normal', 'easy'], ['hard', 'normal']] as [Difficulty, Difficulty][]) {
    const res = Array.from({ length: GAMES }, (_, k) => play(1000 + k * 7919, d0, d1));
    const done = res.filter((r) => r.winner >= 0);
    const firsts = res.flatMap((r) => r.first.filter((v) => !Number.isNaN(v)));
    const age2 = res.flatMap((r) => r.ages.map((a) => a[0]).filter((v) => v !== undefined));
    const age3 = res.flatMap((r) => r.ages.map((a) => a[1]).filter((v) => v !== undefined));
    console.log(
      `${d0} vs ${d1}｜${GAMES} 場、地圖 ${MAP}｜分出勝負 ${done.length}，P0 勝 ${done.filter((r) => r.winner === 0).length}、P1 勝 ${done.filter((r) => r.winner === 1).length}｜對局時間 平均 ${avg(done.map((r) => r.min)).toFixed(1)}、中位數 ${med(done.map((r) => r.min)).toFixed(1)} 分｜首波進攻 中位數 ${med(firsts).toFixed(1)} 分｜群雄割據 ${med(age2).toFixed(1)} 分、三分天下 ${med(age3).toFixed(1)} 分`,
    );
  }
});
