// 電腦 AI（docs/05 §6、§7）：能打完一局、確定性
import { describe, expect, it } from 'vitest';
import { AIPlayer } from '../src/ai/ai';
import { Sim } from '../src/sim/sim';

function play(seed: number, minutes: number) {
  const sim = new Sim({ seed, mapSize: 96, handicap: [1000, 800] });
  const ais = [new AIPlayer(sim, 0, 'normal'), new AIPlayer(sim, 1, 'easy')];
  while (sim.tick < minutes * 600 && sim.winner < 0) {
    for (const a of ais) a.tick();
    sim.step();
  }
  return { sim, ais };
}

describe('電腦 AI', () => {
  it('普通 AI 對簡單 AI：會升時代、會進攻、45 分鐘內分出勝負', () => {
    const { sim, ais } = play(1001, 45);
    expect(sim.players[0].age).toBeGreaterThanOrEqual(3);
    expect(ais[0].firstAttackTick).toBeGreaterThan(0);
    expect(sim.winner).toBeGreaterThanOrEqual(0);
  });

  it('AI 對戰是確定性的（多人連線時每台機器跑同一套 AI）', () => {
    expect(play(77, 6).sim.hash()).toBe(play(77, 6).sim.hash());
  });
});
