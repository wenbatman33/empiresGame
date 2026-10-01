// 資料表載入（docs/06）：JSON → 模擬層用的整數表
import buildingsData from '../../data/buildings.json';
import economyData from '../../data/economy.json';
import techsData from '../../data/techs.json';
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

/** 兵種標籤（傷害加成依標籤計算，docs/03 §2） */
export const TAGS = ['infantry', 'cavalry', 'archer', 'spear', 'siege', 'building', 'ship', 'hero', 'strategist', 'villager'] as const;
export const TAG: Record<string, number> = Object.fromEntries(TAGS.map((t, i) => [t, 1 << i]));
const toTags = (list: string[] | undefined): number => (list ?? []).reduce((m, t) => m | (TAG[t] ?? 0), 0);
const toBonus = (b: Record<string, number> | undefined): [number, number][] => Object.entries(b ?? {}).map(([t, v]) => [TAG[t] ?? 0, v]);

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
  attack: number;
  cooldownTicks: number;
  /** [近甲, 遠甲] */
  armor: [number, number];
  /** 射程（定點數）；0 ＝ 近戰 */
  rangeFx: number;
  tags: number;
  bonus: [number, number][];
  /** 最短射程（霹靂車） */
  minRangeFx: number;
  /** 範圍傷害半徑（定點數；0 ＝ 單體） */
  splashFx: number;
  /** 架設時間（tick） */
  setupTicks: number;
  /** 只打建築（衝車） */
  buildingsOnly: boolean;
}

export const UNIT_DEFS: UnitDef[] = unitsData.map((u) => {
  const raw = u as typeof u & { worker?: boolean; bonus?: Record<string, number>; minRange?: number; splash?: number; setup?: number; buildingsOnly?: boolean };
  return {
    id: u.id,
    name: u.name,
    hp: u.hp,
    speedFx: speedPerTick(u.speed),
    radiusFx: toFx(u.radius),
    sight: u.sight,
    cost: toCost(u.cost),
    trainTicks: Math.round(u.train * TICK_HZ),
    pop: u.pop,
    worker: !!raw.worker,
    age: u.age,
    attack: u.attack,
    cooldownTicks: Math.round(u.cooldown * TICK_HZ),
    armor: [u.armor[0], u.armor[1]],
    rangeFx: toFx(u.range),
    tags: toTags(u.tags),
    bonus: toBonus(raw.bonus),
    minRangeFx: toFx(raw.minRange ?? 0),
    splashFx: toFx(raw.splash ?? 0),
    setupTicks: Math.round((raw.setup ?? 0) * TICK_HZ),
    buildingsOnly: !!raw.buildingsOnly,
  };
});
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
  armor: [number, number];
  sight: number;
  /** 防禦攻擊（0 ＝ 不會射箭） */
  attack: number;
  rangeFx: number;
  cooldownTicks: number;
  /** 牆（拖曳成一列放置） */
  wall: boolean;
}

export const BUILDING_DEFS: BuildingDef[] = buildingsData.map((b) => {
  const raw = b as typeof b & { pop?: number; drop?: string[]; trains?: string[]; walkable?: boolean; food?: number; attack?: number; range?: number; cooldown?: number; wall?: boolean };
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
    armor: [b.armor[0], b.armor[1]],
    sight: b.sight,
    attack: raw.attack ?? 0,
    rangeFx: toFx(raw.range ?? 0),
    cooldownTicks: Math.round((raw.cooldown ?? 2) * TICK_HZ),
    wall: !!raw.wall,
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

// ───────── 科技（docs/04 §5、docs/06 §7） ─────────

export interface TechEffect {
  /** 'player'、'melee'、'infantryNotArcher'、'tag:xxx'、'unit:xxx'、'building:xxx' */
  target?: string;
  stat?: string;
  add?: number;
  mul?: number;
  age?: number;
  upgrade?: [string, string];
}

export interface TechDef {
  id: string;
  name: string;
  building: number;
  age: number;
  cost: Cost;
  ticks: number;
  effects: TechEffect[];
  req: string;
  ageUp: boolean;
}

export const TECH_DEFS: TechDef[] = techsData.map((t) => {
  const raw = t as typeof t & { req?: string; ageUp?: boolean };
  return {
    id: t.id,
    name: t.name,
    building: BUILDING_INDEX[t.building],
    age: t.age,
    cost: toCost(t.cost),
    ticks: Math.round(t.time * TICK_HZ),
    effects: t.effects as TechEffect[],
    req: raw.req ?? '',
    ageUp: !!raw.ageUp,
  };
});
export const TECH_INDEX: Record<string, number> = Object.fromEntries(TECH_DEFS.map((t, i) => [t.id, i]));
/** 升時代的前置：不算這些建築 */
export const AGE_EXCLUDE = new Set(['house', 'farm', 'palisade', 'wall', 'town_hall', 'tower']);
