// M7 lockstep 測試：兩台（或三台含觀戰）模擬透過假網路互傳指令，延遲、抖動、亂序下狀態仍完全一致
import { describe, expect, it } from 'vitest';
import { AIPlayer } from '../src/ai/ai';
import { Lockstep, TICKS_PER_TURN } from '../src/net/lockstep';
import { LoopbackHub } from '../src/net/transport';
import type { CommandInput } from '../src/sim/core/commands';
import { Sim } from '../src/sim/sim';

/** 一個「客戶端」：自己的模擬 ＋ lockstep；AI 產生的指令改走網路（模擬真人下指令） */
function client(hub: LoopbackHub, me: number, players: number[], delay: number, seed = 99) {
  const sim = new Sim({ seed, mapSize: 96, factions: ['wei', 'shu'] });
  const raw = sim.issue.bind(sim);
  const t = hub.connect();
  const ls = new Lockstep(sim, t, me, players, delay, `c${me}`, (c) => raw(c, 0));
  t.onMessage = (m) => ls.receive(m);
  // 這台的「真人」用 AI 代打：它下的指令都經過網路
  sim.issue = ((input: CommandInput, d = 0) => {
    if ('player' in input && input.player === me) {
      ls.issueLocal(input);
      return { ...input, tick: -1 } as never;
    }
    return raw(input, d);
  }) as typeof sim.issue;
  const ai = me >= 0 ? new AIPlayer(sim, me, 'normal') : null;
  return { sim, ls, ai, stalls: 0 };
}

type Client = ReturnType<typeof client>;

/** 跑到每台都到 targetTick；每「毫秒步」推進網路，能走的客戶端就走一個 tick */
function runAll(hub: LoopbackHub, cs: Client[], targetTick: number, msPerStep = 25): void {
  let now = 0;
  for (let guard = 0; guard < targetTick * 400 && cs.some((c) => c.sim.tick < targetTick); guard++) {
    now += msPerStep;
    hub.flush(now);
    for (const c of cs) {
      if (c.sim.tick >= targetTick) continue;
      if (!c.ls.canStep(c.sim.tick)) {
        c.stalls++;
        continue;
      }
      c.ls.beforeStep(c.sim.tick);
      c.ai?.tick();
      c.sim.step();
    }
  }
}

describe('lockstep 多人同步', () => {
  it('兩名玩家（AI 代打、指令走網路）在 80ms 延遲 ＋ 抖動下狀態完全一致', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const hub = new LoopbackHub(80, 60, rnd);
    const a = client(hub, 0, [0, 1], 2);
    const b = client(hub, 1, [0, 1], 2);
    runAll(hub, [a, b], 3000);
    expect(a.sim.tick).toBe(3000);
    expect(b.sim.tick).toBe(3000);
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(a.ls.desync).toBeNull();
    // 真的有在對戰（雙方都有下指令、有生兵）
    expect(a.sim.history.length).toBeGreaterThan(50);
    expect(a.sim.players[1].stats.trained).toBeGreaterThan(5);
  });

  it('觀戰者只收不送，也能保持同步、不會拖慢玩家', () => {
    const hub = new LoopbackHub(30, 20);
    const a = client(hub, 0, [0, 1], 2);
    const b = client(hub, 1, [0, 1], 2);
    const o = client(hub, -1, [0, 1], 2);
    runAll(hub, [a, b, o], 1500);
    expect(o.sim.hash()).toBe(a.sim.hash());
    expect(b.sim.hash()).toBe(a.sim.hash());
  });

  it('有人狀態被竄改 → 雜湊比對抓得到不同步', () => {
    const hub = new LoopbackHub(20, 0);
    const a = client(hub, 0, [0, 1], 2);
    const b = client(hub, 1, [0, 1], 2);
    runAll(hub, [a, b], 300);
    b.sim.players[1].res[0] += 999; // 作弊或程式錯誤
    runAll(hub, [a, b], 600);
    expect(a.ls.desync ?? b.ls.desync).not.toBeNull();
  });

  it('某人斷線：其他人停下來等，不會自己往前跑；接手後繼續', () => {
    const hub = new LoopbackHub(20, 0);
    const a = client(hub, 0, [0, 1], 2);
    const b = client(hub, 1, [0, 1], 2);
    runAll(hub, [a, b], 200);
    // b 斷線：只有 a 在跑
    runAll(hub, [a], 400);
    expect(a.sim.tick).toBeLessThanOrEqual(200 + 2 * TICKS_PER_TURN + 2);
    expect(a.ls.waitingFor).toEqual([1]);
    // 房主宣布 b 由 AI 接手
    let took = -1;
    a.ls.onTakeover = (p) => (took = p);
    a.ls.announceTakeover(1, a.sim.tick);
    runAll(hub, [a], 400);
    expect(took).toBe(1);
    expect(a.sim.tick).toBe(400);
  });

  it('斷線重連：用指令紀錄快轉追上，之後繼續同步', () => {
    const hub = new LoopbackHub(20, 0);
    const a = client(hub, 0, [0, 1], 2);
    let b = client(hub, 1, [0, 1], 2);
    runAll(hub, [a, b], 600);
    // b 掉線（關掉連線），a 等在原地
    hub['ends'].splice(hub['ends'].indexOf(b.ls['transport'] as never), 1);
    runAll(hub, [a], 700);
    const tick = a.sim.tick;
    // b 重連：新模擬 → 重播 a 的紀錄 → 載入未執行回合
    b = client(hub, 1, [0, 1], 2);
    const history = JSON.parse(JSON.stringify(a.sim.history));
    // 重播（AI 跟著跑但指令丟掉，紀錄裡已經有）
    const realIssue = b.sim.issue;
    for (const c of history) Sim.prototype.issue.call(b.sim, c, c.tick - b.sim.tick);
    b.sim.issue = (() => ({}) as never) as typeof b.sim.issue;
    while (b.sim.tick < tick) {
      b.ai?.tick();
      b.sim.step();
    }
    b.sim.issue = realIssue;
    expect(b.sim.hash()).toBe(a.sim.hash());
    b.ls.resume(tick, a.ls.pendingTurns());
    runAll(hub, [a, b], 1500);
    expect(a.sim.tick).toBe(1500);
    expect(b.sim.hash()).toBe(a.sim.hash());
  });
});
