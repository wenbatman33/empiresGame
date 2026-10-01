// 房間（大廳）：房主管理成員、欄位與開局設定；開戰後把對戰訊息交給 lockstep
// 房主也負責斷線重連與中途觀戰的同步（送設定 ＋ 指令紀錄）
import type { Command, CommandInput } from '../sim/core/commands';
import { DEFAULT_SETUP, type GameSetup } from '../ui/menus';
import { newId, type Member, type NetMsg, type Role } from './protocol';
import type { Transport } from './transport';

export interface StartInfo {
  setup: GameSetup;
  members: Member[];
  delay: number;
  ais: { slot: number; ai: string }[];
  /** 斷線重連／中途觀戰：要先快轉到這個 tick */
  sync?: { tick: number; history: Command[]; turns: { player: number; turn: number; cmds: CommandInput[] }[] };
}

export class Room {
  readonly id = newId();
  members: Member[] = [];
  host = '';
  setup: GameSetup;
  started = false;
  /** 量到的來回延遲（ms，對房主） */
  rtt = 0;
  private rtts = new Map<string, number>();
  private pingTimer = 0;
  onChange: (() => void) | null = null;
  onStart: ((info: StartInfo) => void) | null = null;
  /** 開戰後的訊息（turn、takeover…）交給遊戲 */
  onGameMsg: ((msg: NetMsg) => void) | null = null;
  /** 房主：有人要求同步時，遊戲提供目前的紀錄 */
  getSync: (() => StartInfo['sync']) | null = null;
  /** AI 補位（房主設定） */
  ais: { slot: number; ai: string }[] = [];

  constructor(
    readonly transport: Transport,
    readonly name: string,
    readonly role: Role,
    readonly isHost: boolean,
    readonly code: string,
    /** 斷線重連：用原本的名字回到原本的欄位 */
    rejoin = false,
  ) {
    this.setup = { ...DEFAULT_SETUP, seed: (Math.random() * 1e9) | 0, faction: 'random', aiFaction: 'random' };
    transport.onMessage = (m) => this.receive(m);
    if (isHost) {
      this.host = this.id;
      this.members = [{ id: this.id, name, role: 'player', slot: 0, faction: 'random', ready: true }];
    } else {
      transport.send({ t: 'hello', from: this.id, name, role, rejoin });
    }
    this.pingTimer = window.setInterval(() => {
      if (!this.isHost) transport.send({ t: 'ping', from: this.id, at: performance.now() });
    }, 2000);
  }

  get me(): Member | undefined {
    return this.members.find((m) => m.id === this.id);
  }

  private broadcastRoom(): void {
    if (!this.isHost) return;
    this.transport.send({ t: 'room', from: this.id, host: this.id, members: this.members, setup: this.setup });
    this.onChange?.();
  }

  private receive(m: NetMsg): void {
    switch (m.t) {
      case 'hello': {
        if (!this.isHost) return;
        const old = this.members.find((x) => x.name === m.name && m.rejoin);
        if (this.started) {
          // 開戰後：同名玩家重連，或新的觀戰者 → 送同步資料
          if (old) old.id = m.from;
          else this.members.push({ id: m.from, name: m.name, role: 'observer', slot: -1, faction: '', ready: true });
          const sync = this.getSync?.();
          if (sync) this.transport.send({ t: 'sync', from: this.id, to: m.from, setup: this.setup, members: this.members, delay: this.startDelay, ais: this.ais, ...sync });
          return;
        }
        if (this.members.some((x) => x.id === m.from)) return;
        const used = new Set(this.members.map((x) => x.slot));
        let slot = -1;
        if (m.role === 'player') for (let s = 0; s < 4 && slot < 0; s++) if (!used.has(s)) slot = s;
        this.members.push({ id: m.from, name: m.name, role: slot >= 0 ? 'player' : 'observer', slot, faction: 'random', ready: false });
        this.broadcastRoom();
        break;
      }
      case 'room':
        if (this.isHost) return;
        this.host = m.host;
        this.members = m.members;
        this.setup = m.setup;
        this.onChange?.();
        break;
      case 'member': {
        if (!this.isHost) return;
        const x = this.members.find((y) => y.id === m.from);
        if (!x) return;
        if (m.faction !== undefined) x.faction = m.faction;
        if (m.ready !== undefined) x.ready = m.ready;
        this.broadcastRoom();
        break;
      }
      case 'leave':
        if (this.isHost && !this.started) {
          this.members = this.members.filter((x) => x.id !== m.from);
          this.broadcastRoom();
        } else if (!this.isHost && m.from === this.host && !this.started) {
          this.members = [];
          this.onChange?.();
        }
        break;
      case 'ping':
        if (this.isHost) this.transport.send({ t: 'pong', from: this.id, to: m.from, at: m.at });
        break;
      case 'pong':
        if (m.to === this.id) {
          this.rtt = Math.round(performance.now() - m.at);
          this.transport.send({ t: 'chat', from: this.id, text: `__rtt:${this.rtt}` });
          this.onChange?.();
        }
        break;
      case 'chat':
        if (m.text.startsWith('__rtt:')) this.rtts.set(m.from, Number(m.text.slice(6)));
        break;
      case 'start':
        if (this.isHost || this.started) return;
        this.started = true;
        this.startDelay = m.delay;
        this.setup = m.setup;
        this.members = m.members;
        this.ais = m.ais;
        this.onStart?.({ setup: m.setup, members: m.members, delay: m.delay, ais: m.ais });
        break;
      case 'sync':
        if (m.to !== this.id || this.started) return;
        this.started = true;
        this.setup = m.setup;
        this.members = m.members;
        this.ais = m.ais;
        this.onStart?.({ setup: m.setup, members: m.members, delay: m.delay, ais: m.ais, sync: { tick: m.tick, history: m.history, turns: m.turns } });
        break;
      default:
        if (this.started) this.onGameMsg?.(m);
    }
  }

  /** 改自己的勢力／準備狀態 */
  updateMe(p: { faction?: string; ready?: boolean }): void {
    const me = this.me;
    if (!me) return;
    Object.assign(me, p);
    if (this.isHost) this.broadcastRoom();
    else this.transport.send({ t: 'member', from: this.id, ...p });
  }

  /** 房主改開局設定 */
  updateSetup(p: Partial<GameSetup>): void {
    if (!this.isHost) return;
    Object.assign(this.setup, p);
    this.broadcastRoom();
  }

  /** 回合延遲：依量到的最大來回延遲決定（本機 1 回合、一般網路 2–3 回合） */
  get delay(): number {
    const worst = Math.max(this.rtt, ...this.rtts.values(), 0);
    return Math.max(1, Math.min(5, Math.ceil((worst + 60) / 200)));
  }

  get canStart(): boolean {
    const players = this.members.filter((m) => m.role === 'player');
    return this.isHost && players.length + this.ais.length >= 2 && players.every((m) => m.ready);
  }

  /** 開戰時決定的回合延遲（之後重連、觀戰沿用同一個值） */
  startDelay = 2;

  /** 房主開戰 */
  start(): void {
    if (!this.canStart) return;
    this.started = true;
    this.startDelay = this.delay;
    const info: StartInfo = { setup: { ...this.setup }, members: this.members, delay: this.startDelay, ais: this.ais };
    this.transport.send({ t: 'start', from: this.id, ...info });
    this.onStart?.(info);
  }

  leave(): void {
    window.clearInterval(this.pingTimer);
    this.transport.send({ t: 'leave', from: this.id });
    this.transport.close();
  }
}

/** 重連用：記住上次的房間（同一個名字回到同一個欄位） */
export const REJOIN_KEY = 'empiresGame.rejoin';
