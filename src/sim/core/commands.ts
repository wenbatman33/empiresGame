// 指令（docs/07 §3）：玩家、電腦 AI、未來的網路玩家都只能透過指令改變世界
// 座標一律是定點數；tick 是預定執行的 tick

export type Command =
  | { t: 'spawn'; tick: number; player: number; unit: number; x: number; y: number; count: number }
  | { t: 'move'; tick: number; player: number; ids: number[]; x: number; y: number }
  | { t: 'stop'; tick: number; player: number; ids: number[] }
  | { t: 'clear'; tick: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandInput = DistributiveOmit<Command, 'tick'>;
