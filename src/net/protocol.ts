// 連線協定（docs/08 §3）：所有訊息都是 JSON；伺服器只轉發，不看內容、不跑模擬
import type { Command, CommandInput } from '../sim/core/commands';
import type { GameSetup } from '../ui/menus';

export type Role = 'player' | 'observer';

export interface Member {
  /** 連線 id（每個分頁／連線一個，隨機產生） */
  id: string;
  name: string;
  role: Role;
  /** 玩家欄位（0、1…）；觀戰者為 -1 */
  slot: number;
  faction: string;
  ready: boolean;
}

export type NetMsg =
  // ───── 大廳 ─────
  /** 有人進房間（打招呼，房主回 room） */
  | { t: 'hello'; from: string; name: string; role: Role; rejoin?: boolean }
  /** 房主廣播房間狀態 */
  | { t: 'room'; from: string; host: string; members: Member[]; setup: GameSetup }
  /** 成員改自己的設定（勢力、準備） */
  | { t: 'member'; from: string; faction?: string; ready?: boolean }
  | { t: 'leave'; from: string }
  /** 房主宣布開戰：設定、欄位、回合延遲 */
  | { t: 'start'; from: string; setup: GameSetup; members: Member[]; delay: number; ais: { slot: number; ai: string }[] }
  // ───── 對戰 ─────
  /** 某玩家某回合的指令（空陣列也要送，代表「這回合我沒事」）；附帶狀態雜湊做不同步偵測 */
  | { t: 'turn'; from: string; player: number; turn: number; cmds: CommandInput[]; hash?: [number, number] }
  /** 延遲量測 */
  | { t: 'ping'; from: string; at: number }
  | { t: 'pong'; from: string; to: string; at: number }
  /** 斷線重連、中途觀戰：房主送完整紀錄，快轉追上 */
  | { t: 'sync'; from: string; to: string; setup: GameSetup; members: Member[]; delay: number; ais: { slot: number; ai: string }[]; tick: number; history: Command[]; turns: { player: number; turn: number; cmds: CommandInput[] }[] }
  /** 某玩家斷線太久、改由電腦接手（在指定回合生效，所有人一致） */
  | { t: 'takeover'; from: string; player: number; turn: number }
  | { t: 'desync'; from: string; turn: number; player: number }
  | { t: 'chat'; from: string; text: string };

/** 隨機連線 id（UI 層用，不進模擬） */
export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** 4 碼房間代碼（去掉易混淆字母） */
export function newRoomCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
