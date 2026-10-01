// 無頭 AI 對戰（docs/05 §8）：npm run ai-arena
// 環境變數 GAMES（每組幾場，預設 20）、MAP（地圖大小，預設 96）、MT（地圖類型，預設 central）、PAIRS（例如 normal-normal,hard-normal）
// FAC（勢力對戰，例如 wei-shu,wei-wu,shu-wu：同難度普通 AI、雙方輪流換邊）
import { it } from 'vitest';
import { AIPlayer, type Difficulty } from '../src/ai/ai';
import { Sim } from '../src/sim/sim';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const GAMES = Number(env.GAMES ?? 20);
const MAP = Number(env.MAP ?? 96);
const MT = env.MT ?? 'central';
const PAIRS = (env.PAIRS ?? 'normal-normal,normal-easy,hard-normal').split(',').map((p) => p.split('-') as [Difficulty, Difficulty]);
const FAC = env.FAC ? env.FAC.split(',').map((p) => p.split('-')) : null;
const LIMIT = 45 * 600;

function play(seed: number, d0: Difficulty, d1: Difficulty, factions?: string[]) {
  const sim = new Sim({ seed, mapSize: MAP, mapType: MT, factions, handicap: [d0 === 'easy' ? 800 : 1000, d1 === 'easy' ? 800 : 1000] });
  const ais = [new AIPlayer(sim, 0, d0), new AIPlayer(sim, 1, d1)];
  const ages: number[][] = [[], []];
  while (sim.tick < LIMIT && sim.winner < 0) {
    for (const a of ais) a.tick();
    sim.step();
    for (const p of [0, 1]) if (sim.players[p].age > ages[p].length + 1) ages[p].push(sim.tick / 600);
  }
  return { winner: sim.winner, reason: sim.winReason, factions: sim.players.map((p) => p.faction), min: sim.tick / 600, first: ais.map((a) => (a.firstAttackTick < 0 ? NaN : a.firstAttackTick / 600)), ages };
}

const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const med = (a: number[]) => {
  if (!a.length) return NaN;
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
};

it('AI 對戰統計', () => {
  if (FAC) {
    // 勢力平衡：普通對普通，雙方輪流換邊
    for (const [a, b] of FAC) {
      let wa = 0;
      let wb = 0;
      const mins: number[] = [];
      for (let k = 0; k < GAMES; k++) {
        const swap = k % 2 === 1;
        const r = play(5000 + k * 7919, 'normal', 'normal', swap ? [b, a] : [a, b]);
        if (r.winner < 0) continue;
        mins.push(r.min);
        if (r.factions[r.winner] === a) wa++;
        else wb++;
      }
      console.log(`${a} vs ${b}｜${GAMES} 場、地圖 ${MT} ${MAP}｜${a} ${wa} 勝、${b} ${wb} 勝（${a} 勝率 ${((wa / Math.max(1, wa + wb)) * 100).toFixed(0)}%）｜平均 ${avg(mins).toFixed(1)} 分`);
    }
    return;
  }
  const facWins: Record<string, [number, number]> = { wei: [0, 0], shu: [0, 0], wu: [0, 0] };
  for (const [d0, d1] of PAIRS) {
    const res = Array.from({ length: GAMES }, (_, k) => play(1000 + k * 7919, d0, d1));
    const done = res.filter((r) => r.winner >= 0);
    // 勢力勝率：只算同難度對戰、不同勢力的場次
    if (d0 === d1) {
      for (const r of done) {
        if (r.factions[0] === r.factions[1]) continue;
        facWins[r.factions[r.winner]][0]++;
        for (const f of r.factions) facWins[f][1]++;
      }
    }
    const firsts = res.flatMap((r) => r.first.filter((v) => !Number.isNaN(v)));
    const age2 = res.flatMap((r) => r.ages.map((a) => a[0]).filter((v) => v !== undefined));
    const age3 = res.flatMap((r) => r.ages.map((a) => a[1]).filter((v) => v !== undefined));
    console.log(
      `${d0} vs ${d1}｜${GAMES} 場、地圖 ${MT} ${MAP}｜分出勝負 ${done.length}，P0 勝 ${done.filter((r) => r.winner === 0).length}、P1 勝 ${done.filter((r) => r.winner === 1).length}｜對局時間 平均 ${avg(done.map((r) => r.min)).toFixed(1)}、中位數 ${med(done.map((r) => r.min)).toFixed(1)} 分｜首波進攻 中位數 ${med(firsts).toFixed(1)} 分｜群雄割據 ${med(age2).toFixed(1)} 分、三分天下 ${med(age3).toFixed(1)} 分`,
    );
  }
  console.log(`勢力勝率（同難度、不同勢力）：${Object.entries(facWins).map(([f, [w, n]]) => `${f} ${w}/${n}`).join('、')}`);
});
