// 資料表載入（docs/06）：JSON → 模擬層用的整數表
import buildingsData from '../../data/buildings.json';
import economyData from '../../data/economy.json';
import unitsData from '../../data/units.json';
import { TICK_HZ, speedPerTick, toFx } from './fixed';

/** 資源種類：糧、木、金、石 */
export const RES = { food: 0, wood: 1, gold: 2, stone: 3 } as const;
export const RES_KEYS = ['food', 'wood', 'gold', 'stone'] as const;
export const RES_NAMES = ['糧', '木', '金', '石'];
export type ResKey = (typeof RES_KEYS)[number];
/** 成本：[糧, 木, 金, 石] */
export type Cost = [number, number, number, number];

const toCost = (c: Partial<Record<ResKey, number>> | undefined): Cost => [c?.food ?? 0, c?.wood ?? 0, c?.gold ?? 0, c?.stone ?? 0];
/** 每秒速率 → 每 tick 千分之一單位 */
const milliPerTick = (perSec: number): number => Math.round((perSec * 1000) / TICK_HZ);

export interface UnitDef {
  id: string;
  name: string;
  hp: number;
  speedFx: number;
  radiusFx: number;
  sight: number;
  cost: Cost;
  trainTicks: number;
  pop: number;
  worker: boolean;
  age: number;
}

export const UNIT_DEFS: UnitDef[] = unitsData.map((u) => ({
  id: u.id,
  name: u.name,
  hp: u.hp,
  speedFx: speedPerTick(u.speed),
  radiusFx: toFx(u.radius),
  sight: u.sight,
  cost: toCost(u.cost),
  trainTicks: Math.round(u.train * TICK_HZ),
  pop: u.pop,
  worker: !!(u as { worker?: boolean }).worker,
  age: u.age,
}));
export const UNIT_INDEX: Record<string, number> = Object.fromEntries(UNIT_DEFS.map((u, i) => [u.id, i]));

export interface BuildingDef {
  id: string;
  name: string;
  w: number;
  h: number;
  hp: number;
  cost: Cost;
  buildTicks: number;
  pop: number;
  /** 收哪些資源（存放點） */
  drop: boolean[];
  trains: number[];
  walkable: boolean;
  food: number;
  age: number;
}

export const BUILDING_DEFS: BuildingDef[] = buildingsData.map((b) => {
  const raw = b as typeof b & { pop?: number; drop?: string[]; trains?: string[]; walkable?: boolean; food?: number };
  return {
    id: b.id,
    name: b.name,
    w: b.w,
    h: b.h,
    hp: b.hp,
    cost: toCost(b.cost),
    buildTicks: Math.round(b.build * TICK_HZ),
    pop: raw.pop ?? 0,
    drop: RES_KEYS.map((k) => !!raw.drop?.includes(k)),
    trains: (raw.trains ?? []).map((t) => UNIT_INDEX[t]),
    walkable: !!raw.walkable,
    food: raw.food ?? 0,
    age: b.age,
  };
});
export const BUILDING_INDEX: Record<string, number> = Object.fromEntries(BUILDING_DEFS.map((b, i) => [b.id, i]));

export interface ResourceKindDef {
  id: string;
  name: string;
  res: number;
  amount: number;
  rateMilli: number;
  blocks: boolean;
}

export const RESOURCE_KINDS: ResourceKindDef[] = economyData.resources.map((r) => ({
  id: r.id,
  name: r.name,
  res: RES[r.res as ResKey],
  amount: r.amount,
  rateMilli: milliPerTick(r.rate),
  blocks: r.blocks,
}));
export const RK: Record<string, number> = Object.fromEntries(RESOURCE_KINDS.map((r, i) => [r.id, i]));

export const ECONOMY = {
  start: toCost(economyData.start),
  startVillagers: economyData.startVillagers,
  popLimit: economyData.popLimit,
  carry: economyData.carry,
  queueMax: economyData.queueMax,
  farmReseedWood: economyData.farmReseedWood,
  farmRateMilli: milliPerTick(economyData.farmRate),
};
