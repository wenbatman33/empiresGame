// 指令（docs/07 §3）：玩家、電腦 AI、未來的網路玩家都只能透過指令改變世界
// 座標一律是定點數；tick 是預定執行的 tick

export type Command =
  | { t: 'spawn'; tick: number; player: number; unit: number; x: number; y: number; count: number }
  | { t: 'move'; tick: number; player: number; ids: number[]; x: number; y: number; spread?: boolean }
  /** 攻擊單位（kind 1）或建築（kind 2） */
  | { t: 'attack'; tick: number; player: number; ids: number[]; kind: number; target: number }
  /** 攻擊移動：沿路遇敵就打 */
  | { t: 'attackMove'; tick: number; player: number; ids: number[]; x: number; y: number; spread?: boolean }
  | { t: 'stance'; tick: number; player: number; ids: number[]; stance: number }
  /** 巡邏：在目前位置與目標點之間來回，沿路遇敵就打 */
  | { t: 'patrol'; tick: number; player: number; ids: number[]; x: number; y: number }
  /** 牆：從 (x0,y0) 到 (x1,y1) 一整列（格子座標） */
  | { t: 'buildLine'; tick: number; player: number; ids: number[]; btype: number; x0: number; y0: number; x1: number; y1: number }
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
  | { t: 'cheat'; tick: number; player: number; kind: 'res' | 'build' | 'age' }
  /** 研究科技（含升時代） */
  | { t: 'research'; tick: number; player: number; building: number; tech: number }
  | { t: 'cancelResearch'; tick: number; player: number; building: number }
  /** 投降 */
  | { t: 'resign'; tick: number; player: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandInput = DistributiveOmit<Command, 'tick'>;
