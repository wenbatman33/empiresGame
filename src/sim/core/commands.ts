// 指令（docs/07 §3）：玩家、電腦 AI、未來的網路玩家都只能透過指令改變世界
// 座標一律是定點數；tick 是預定執行的 tick

export type Command =
  | { t: 'spawn'; tick: number; player: number; unit: number; x: number; y: number; count: number }
  | { t: 'move'; tick: number; player: number; ids: number[]; x: number; y: number }
  | { t: 'stop'; tick: number; player: number; ids: number[] }
  | { t: 'clear'; tick: number }
  /** 民夫蓋建築（tx,ty 為左上角格） */
  | { t: 'build'; tick: number; player: number; ids: number[]; btype: number; tx: number; ty: number }
  /** 採集資源點 */
  | { t: 'gather'; tick: number; player: number; ids: number[]; res: number }
  /** 對自家建築工作：未完工就幫忙蓋、農田就去耕、存放點就交資源 */
  | { t: 'work'; tick: number; player: number; ids: number[]; building: number }
  | { t: 'train'; tick: number; player: number; building: number; unit: number; count: number }
  | { t: 'cancel'; tick: number; player: number; building: number; index: number }
  /** 集結點（res ≥ 0 表示集結在資源上） */
  | { t: 'rally'; tick: number; player: number; building: number; x: number; y: number; res: number }
  | { t: 'loop'; tick: number; player: number; building: number; on: boolean }
  | { t: 'reseed'; tick: number; player: number; on: boolean }
  | { t: 'destroy'; tick: number; player: number; building: number }
  /** DEV 作弊（也走指令，重播才一致） */
  | { t: 'cheat'; tick: number; player: number; kind: 'res' | 'build' };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandInput = DistributiveOmit<Command, 'tick'>;
