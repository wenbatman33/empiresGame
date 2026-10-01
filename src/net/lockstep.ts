// 確定性 lockstep（docs/08 §3.1，和世紀帝國 II 一樣）：
// 1 回合 ＝ 2 tick（200ms）；本地指令排在「目前回合 ＋ delay」執行；每個人每回合都要送一則 turn 訊息（沒指令就送空的）
// 所有人都收到某回合的訊息才執行那個回合，指令依玩家編號排序後注入模擬 → 每台機器的結果完全一樣
// 每 10 回合附上狀態雜湊，不一致就回報不同步
import type { CommandInput } from '../sim/core/commands';
import type { Sim } from '../sim/sim';
import type { NetMsg } from './protocol';
import type { Transport } from './transport';

export const TICKS_PER_TURN = 2;
const HASH_EVERY = 10;

export class Lockstep {
  /** 回合 → 玩家 → 指令 */
  private received = new Map<number, Map<number, CommandInput[]>>();
  private outbox: CommandInput[] = [];
  private sentUpTo: number;
  private myHashes = new Map<number, number>();
  private theirHashes = new Map<number, Map<number, number>>();
  /** 需要等誰的訊息（人類玩家；斷線後由 AI 接手的會在指定回合移除） */
  private required: Set<number>;
  private takeovers = new Map<number, number[]>();
  /** 不同步：第一次發現的回合與玩家 */
  desync: { turn: number; player: number } | null = null;
  onDesync: ((turn: number, player: number) => void) | null = null;
  /** 某玩家在某回合改由 AI 接手（Game 要在這時候加 AI） */
  onTakeover: ((player: number) => void) | null = null;
  /** 等待中（缺誰的訊息） */
  waitingFor: number[] = [];
  /** 最近一次有收到某玩家訊息的時間（ms，UI 用來判斷斷線） */
  readonly lastHeard = new Map<number, number>();

  constructor(
    private sim: Sim,
    private transport: Transport,
    /** 我的玩家欄位；觀戰者為 -1 */
    readonly me: number,
    players: number[],
    readonly delay = 2,
    private myId = '',
    /** 實際把指令放進模擬的方法（Game 會把 sim.issue 換成走網路的版本，所以要傳原本的進來） */
    private inject: (c: CommandInput) => void = (c) => sim.issue(c, 0),
  ) {
    this.required = new Set(players);
    this.sentUpTo = delay - 1;
    for (const p of players) this.lastHeard.set(p, Date.now());
  }

  /** 本地玩家下的指令：排進下一個要送出的回合 */
  issueLocal(c: CommandInput): void {
    if (this.me < 0) return;
    this.outbox.push(c);
  }

  /** 收到網路訊息 */
  receive(msg: NetMsg): void {
    if (msg.t === 'turn') {
      this.lastHeard.set(msg.player, Date.now());
      this.store(msg.turn, msg.player, msg.cmds);
      if (msg.hash) this.compare(msg.hash[0], msg.player, msg.hash[1]);
    } else if (msg.t === 'takeover') {
      const list = this.takeovers.get(msg.turn) ?? [];
      if (!list.includes(msg.player)) list.push(msg.player);
      this.takeovers.set(msg.turn, list);
    }
  }

  private store(turn: number, player: number, cmds: CommandInput[]): void {
    let m = this.received.get(turn);
    if (!m) {
      m = new Map();
      this.received.set(turn, m);
    }
    if (!m.has(player)) m.set(player, cmds);
  }

  private compare(turn: number, player: number, hash: number): void {
    const mine = this.myHashes.get(turn);
    if (mine === undefined) {
      let m = this.theirHashes.get(turn);
      if (!m) {
        m = new Map();
        this.theirHashes.set(turn, m);
      }
      m.set(player, hash);
      return;
    }
    if (mine !== hash && !this.desync) {
      this.desync = { turn, player };
      this.onDesync?.(turn, player);
    }
  }

  /** 這個 tick 可以執行嗎（回合開頭要等齊所有人的訊息） */
  canStep(tick: number): boolean {
    if (tick % TICKS_PER_TURN !== 0) return true;
    const turn = tick / TICKS_PER_TURN;
    this.applyTakeovers(turn);
    if (turn < this.delay) {
      this.waitingFor = [];
      return true;
    }
    const m = this.received.get(turn);
    this.waitingFor = [...this.required].filter((p) => p !== this.me && !m?.has(p));
    return this.waitingFor.length === 0;
  }

  /** 每個 tick 執行前呼叫：回合開頭送出本地指令、注入本回合所有人的指令 */
  beforeStep(tick: number): void {
    if (tick % TICKS_PER_TURN !== 0) return;
    const turn = tick / TICKS_PER_TURN;
    this.applyTakeovers(turn);
    // 雜湊：回合開頭、注入指令前
    let hash: [number, number] | undefined;
    if (turn % HASH_EVERY === 0) {
      const h = this.sim.hash();
      this.myHashes.set(turn, h);
      hash = [turn, h];
      const theirs = this.theirHashes.get(turn);
      if (theirs) for (const [p, v] of theirs) this.compare(turn, p, v);
      this.theirHashes.delete(turn);
      // 只留最近的雜湊
      this.myHashes.delete(turn - HASH_EVERY * 20);
    }
    // 送出「目前回合 ＋ delay」的本地指令
    const target = turn + this.delay;
    if (this.me >= 0 && this.required.has(this.me) && target > this.sentUpTo) {
      // 中間如果有跳過的回合（例如重連），補送空回合
      for (let t = this.sentUpTo + 1; t < target; t++) this.send(t, []);
      this.send(target, this.outbox.splice(0), hash);
      this.sentUpTo = target;
    }
    // 執行本回合：依玩家編號排序注入
    const m = this.received.get(turn);
    if (m) {
      for (const p of [...m.keys()].sort((a, b) => a - b)) for (const c of m.get(p)!) this.inject(c);
      this.received.delete(turn);
    }
  }

  /** 斷線玩家在這個回合起改由 AI 接手（不再等他的訊息） */
  private applyTakeovers(turn: number): void {
    const tk = this.takeovers.get(turn);
    if (!tk) return;
    this.takeovers.delete(turn);
    for (const p of tk) {
      this.required.delete(p);
      this.onTakeover?.(p);
    }
  }

  private send(turn: number, cmds: CommandInput[], hash?: [number, number]): void {
    this.store(turn, this.me, cmds);
    this.transport.send({ t: 'turn', from: this.myId, player: this.me, turn, cmds, hash });
  }

  /** 房主宣布某玩家由 AI 接手（在幾個回合後生效，讓所有人都收得到） */
  announceTakeover(player: number, currentTick: number): void {
    // 大家都卡在同一個回合開頭等他，就從這個回合生效
    const turn = Math.ceil(currentTick / TICKS_PER_TURN);
    const msg: NetMsg = { t: 'takeover', from: this.myId, player, turn };
    this.receive(msg);
    this.transport.send(msg);
  }

  /** 給斷線重連／中途觀戰的人：還沒執行的回合訊息 */
  pendingTurns(): { player: number; turn: number; cmds: CommandInput[] }[] {
    const out: { player: number; turn: number; cmds: CommandInput[] }[] = [];
    for (const [turn, m] of [...this.received].sort((a, b) => a[0] - b[0])) for (const [player, cmds] of m) out.push({ player, turn, cmds });
    return out;
  }

  /** 重連後：載入房主給的未執行回合、從目前回合接著送 */
  resume(tick: number, turns: { player: number; turn: number; cmds: CommandInput[] }[]): void {
    for (const t of turns) this.store(t.turn, t.player, t.cmds);
    // 從目前回合開始補送（之前的回合房主已經收過或已執行）
    const turn = Math.floor(tick / TICKS_PER_TURN);
    let mine = turn - 1;
    for (const t of turns) if (t.player === this.me) mine = Math.max(mine, t.turn);
    this.sentUpTo = mine;
  }

  get pendingLocal(): number {
    return this.outbox.length;
  }
}
