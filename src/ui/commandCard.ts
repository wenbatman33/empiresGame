// 指令卡（docs/01 §4、§8）：依選取內容顯示建造／生產／集結等按鈕
// PC 快捷鍵避開 WASD（鏡頭）、H（回城）、P（暫停）
import { BUILDING_DEFS, BUILDING_INDEX, RES_NAMES, TECH_DEFS, UNIT_DEFS, type Cost, type TechDef } from '../sim/core/defs';
import { SKILLS, STRATAGEMS } from '../sim/systems/abilities';
import type { Game } from '../game';

export interface CardButton {
  id: string;
  icon: string;
  label: string;
  tip: string;
  cost?: Cost;
  enabled: boolean;
  active?: boolean;
  badge?: string;
  danger?: boolean;
  action: () => void;
}

export const HOTKEYS = ['Q', 'E', 'R', 'T', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'];
const AGE_NAMES = ['', '黃巾亂世', '群雄割據', '三分天下', '天下一統'];

export const BUILD_ICONS: Record<string, string> = {
  house: '🏠',
  farm: '🌾',
  lumber_camp: '🪓',
  mine_camp: '⛏️',
  granary: '🏚️',
  barracks: '⚔️',
  town_hall: '🏯',
  archery: '🎯',
  stable: '🐎',
  blacksmith: '⚒️',
  tower: '🗼',
  palisade: '🪵',
  wall: '🧱',
};
export const UNIT_ICONS: Record<string, string> = {
  villager: '👷',
  swordsman: '🛡️',
  spearman: '🔱',
  archer: '🏹',
  scout: '🐴',
  light_cav: '🐎',
  heavy_cav: '🏇',
  horse_archer: '🎠',
  elite_swordsman: '🛡️',
  halberdier: '🔱',
  crossbowman: '🏹',
  swift_cav: '🐎',
  iron_cav: '🏇',
  ram: '🪵',
  trebuchet: '☄️',
};
BUILD_ICONS.workshop = '🛠️';
Object.assign(BUILD_ICONS, { market: '🏪', dock: '⚓', gate: '🚪', fortress: '🏰', academy: '📚', wonder: '🏛️' });
Object.assign(UNIT_ICONS, {
  tiger_cav: '🐯',
  repeater: '🎯',
  danyang: '🗡️',
  ox_cart: '🐂',
  strategist: '📜',
  fishing_boat: '🛶',
  transport: '⛴️',
  galley: '🚣',
  mengchong: '🛳️',
  louchuan: '🚢',
  fire_ship: '🔥',
  phantom: '👻',
});
for (const u of UNIT_DEFS) if (u.hero) UNIT_ICONS[u.id] = '🌟';
const STRATAGEM_ICONS: Record<string, string> = { fire: '🔥', decoy: '👻', fortify: '🧱', discord: '🗣️', plum: '🍑', empty_fort: '🏯', east_wind: '🌬️' };

const TECH_ICONS: Record<string, string> = {
  age2: '📜', age3: '📜', age4: '📜', loom: '🧵', wheelbarrow: '🛞', handcart: '🛒', plow: '🌱', seeder: '🌾', waterwheel: '💧',
  axe: '🪓', saw: '🪚', twoman: '🪚', pick: '⛏️', stonecut: '🪨', shaft: '⛏️', forge: '⚔️', steel: '⚔️', hundred: '⚔️',
  fletch: '🏹', ironhead: '🏹', piercing: '🏹', inf1: '🥋', inf2: '🥋', inf3: '🥋', cav1: '🐴', cav2: '🐴', cav3: '🐴',
  arc1: '🦺', arc2: '🦺', arc3: '🦺', up_elite_sword: '⬆️', up_halberd: '⬆️', up_crossbow: '⬆️', up_elite_ha: '⬆️', up_swift: '⬆️', up_iron: '⬆️',
  masonry: '🧱', medicine: '💊', persuasion: '🗣️', crossbow_mech: '⚙️', mohist: '🛡️', thunder: '💥', wuzhu: '🪙', shipwright: '⚓',
  tuntian: '🌾', tiger_elite: '🐯', five_tigers: '🐅', repeater_up: '🎯', jiangdong: '⛵', fire_arrows: '🔥',
};
const TARGET_NAMES: Record<string, string> = {
  melee: '近戰兵',
  infantryNotArcher: '步兵',
  'tag:archer': '弓兵類',
  'tag:cavalry': '騎兵',
  'unit:villager': '民夫',
  'unit:horse_archer': '弓騎',
  'building:tower': '箭塔',
  'building:town_hall': '太守府',
};
const STAT_NAMES: Record<string, string> = { attack: '攻擊', armorM: '近甲', armorP: '遠甲', hp: 'HP', range: '射程', speed: '移速', carry: '攜帶量', farmFood: '每塊農田糧食' };
const GATHER_NAMES: Record<string, string> = { 'gather.farm': '農田採集', 'gather.wood': '伐木', 'gather.gold': '採金', 'gather.stone': '採石' };

/** 科技效果的一句話說明 */
export function techSummary(t: TechDef): string {
  const parts: string[] = [];
  for (const e of t.effects) {
    if (e.age) parts.push(`進入「${AGE_NAMES[e.age]}」：解鎖新建築與兵種，所有建築換新外觀`);
    else if (e.upgrade) parts.push(`${UNIT_DEFS.find((u) => u.id === e.upgrade![0])?.name} 升級為 ${UNIT_DEFS.find((u) => u.id === e.upgrade![1])?.name}（場上的也一起升級）`);
    else if (e.stat && GATHER_NAMES[e.stat]) parts.push(`${GATHER_NAMES[e.stat]} ＋${Math.round(((e.mul ?? 1) - 1) * 100)}%`);
    else if (e.stat) {
      const who = e.target === 'player' ? '' : TARGET_NAMES[e.target ?? ''] ?? '';
      const val = e.mul ? `＋${Math.round((e.mul - 1) * 100)}%` : `＋${e.add}`;
      parts.push(`${who}${STAT_NAMES[e.stat] ?? e.stat} ${val}`);
    }
  }
  return [...new Set(parts)].join('、');
}
/** 民夫建造選單：第一頁經濟、第二頁軍事與防禦 */
const BUILD_ORDER = ['house', 'farm', 'lumber_camp', 'mine_camp', 'granary', 'dock', 'barracks', 'archery', 'stable', 'blacksmith', 'market', 'tower', 'palisade', 'wall', 'gate', 'workshop', 'fortress', 'academy', 'town_hall', 'wonder'];
const STANCE_NAMES = ['進攻', '防守', '堅守', '不還擊'];

export function costText(c: Cost): string {
  return c
    .map((v, i) => (v ? `${RES_NAMES[i]}${v}` : ''))
    .filter(Boolean)
    .join(' ');
}

export class CommandCard {
  private sig = '';
  private buttons: CardButton[] = [];
  private page = 0;

  constructor(private el: HTMLElement, private game: Game) {}

  /** 依目前選取組出按鈕 */
  private compute(): CardButton[] {
    const g = this.game;
    const sim = g.sim;
    const pl = sim.players[g.myPlayer];
    const out: CardButton[] = [];
    const own = g.ownSelected();
    const w = sim.world;
    if (g.placing) {
      out.push({ id: 'cancel', icon: '✕', label: '取消', tip: '取消放置（Esc／右鍵）', enabled: true, action: () => g.cancelPlacing() });
      return out;
    }
    if (g.rallyMode) {
      out.push({ id: 'cancel', icon: '✕', label: '取消', tip: '取消設定集結點', enabled: true, action: () => (g.rallyMode = false) });
      return out;
    }
    if (g.attackMoveMode || g.patrolMode) {
      out.push({ id: 'cancel', icon: '✕', label: '取消', tip: '取消', enabled: true, action: () => (g.attackMoveMode = g.patrolMode = false) });
      return out;
    }
    if (g.targeting) {
      out.push({ id: 'cancel', icon: '✕', label: '取消', tip: '取消施放', enabled: true, action: () => (g.targeting = null) });
      return out;
    }
    if (own.length) {
      // 武將技排第一個（PC 快捷鍵 Q）
      for (const id of own.filter((i) => UNIT_DEFS[w.utype[i]].hero).slice(0, 2)) {
        const u = UNIT_DEFS[w.utype[id]];
        const sk = SKILLS[u.id];
        if (!sk) continue;
        const cd = Math.max(0, Math.ceil((w.skillReady[id] - sim.tick) / 10));
        out.push({
          id: `skill:${id}`,
          icon: '✨',
          label: sk.name,
          tip: `${u.name}「${sk.name}」：${sk.desc}（冷卻 ${sk.cd} 秒）${cd ? `\n冷卻中，還要 ${cd} 秒` : ''}`,
          enabled: cd === 0,
          badge: cd ? String(cd) : undefined,
          action: () => g.castSkill(id),
        });
      }
      // 運兵船：卸兵
      const ship = own.find((i) => UNIT_DEFS[w.utype[i]].capacity);
      if (ship !== undefined) {
        let n = 0;
        for (let j = 0; j < w.high; j++) if (w.alive[j] && w.aboard[j] === ship) n++;
        out.push({ id: 'unload', icon: '⚓', label: '卸兵', tip: '卸兵：點選要靠岸的地點（上船：選兵後點自家運兵船）', enabled: n > 0, badge: n ? String(n) : undefined, action: () => g.unloadShip(ship) });
      }
      const workers = own.some((id) => UNIT_DEFS[w.utype[id]].worker);
      if (workers) {
        for (const id of BUILD_ORDER) {
          const bt = BUILDING_INDEX[id];
          const def = BUILDING_DEFS[bt];
          const locked = def.age > pl.age;
          out.push({
            id: `build:${id}`,
            icon: BUILD_ICONS[id] ?? '🏠',
            label: def.name,
            tip: locked ? `${def.name}：需要「${AGE_NAMES[def.age]}」時代` : `蓋${def.name}（${costText(pl.buildingCost(bt))}）`,
            cost: pl.buildingCost(bt),
            enabled: !locked && pl.canAfford(pl.buildingCost(bt)),
            action: () => g.startPlacing(bt),
          });
        }
      }
      const army = own.some((id) => !UNIT_DEFS[w.utype[id]].worker);
      if (army) {
        out.push({ id: 'amove', icon: '⚔️', label: '攻擊移動', tip: '攻擊移動：點地面，沿路遇敵就打', enabled: true, active: g.attackMoveMode, action: () => (g.attackMoveMode = !g.attackMoveMode) });
        const st = w.stance[own.find((id) => !UNIT_DEFS[w.utype[id]].worker)!];
        out.push({ id: 'stance', icon: ['🔥', '🛡️', '🚩', '🕊️'][st], label: STANCE_NAMES[st], tip: '切換姿態：進攻（追擊）→ 防守（追 8 格返回）→ 堅守（不移動）→ 不還擊', enabled: true, action: () => g.cycleStance() });
        out.push({ id: 'spread', icon: g.spread ? '⁘' : '▦', label: g.spread ? '散開' : '方陣', tip: '陣型：方陣（預設）／散開（間距加倍，防範圍傷害）', enabled: true, active: g.spread, action: () => (g.spread = !g.spread) });
        out.push({ id: 'patrol', icon: '🔄', label: '巡邏', tip: '巡邏：點地面，在目前位置與該點之間來回，遇敵就打', enabled: true, active: g.patrolMode, action: () => (g.patrolMode = !g.patrolMode) });
      }
      out.push({ id: 'stop', icon: '✋', label: '停止', tip: '停止目前的動作', enabled: true, action: () => g.stopSelected() });
      return out;
    }
    const b = g.selBuilding;
    const bs = sim.buildings;
    if (b >= 0 && bs.alive[b] && bs.owner[b] === g.myPlayer) {
      const def = BUILDING_DEFS[bs.btype[b]];
      if (bs.complete[b]) {
        // 研究（升時代排第一）
        const techs = TECH_DEFS.map((t, i) => [t, i] as const).filter(([t, i]) => t.building === bs.btype[b] && !pl.techs.has(i) && (t.ageUp ? t.age === pl.age : t.age <= pl.age + 1));
        techs.sort((a, c) => Number(c[0].ageUp) - Number(a[0].ageUp) || a[0].age - c[0].age);
        const researching = bs.research[b] >= 0;
        for (const [t, i] of techs) {
          if (bs.research[b] === i) continue;
          const block = g.sim.economy.researchBlocker(g.myPlayer, b, i);
          // 前置科技沒研究的先不顯示，免得按鈕太多
          if (t.req && !pl.techs.has(TECH_DEFS.findIndex((x) => x.id === t.req))) continue;
          out.push({
            id: `tech:${t.id}`,
            icon: TECH_ICONS[t.id] ?? '📘',
            label: t.name,
            tip: `${t.name}：${techSummary(t)}（${costText(t.cost)}，${t.ticks / 10} 秒）${block ? `\n⚠ ${block}` : ''}`,
            cost: t.cost,
            enabled: !block && pl.canAfford(t.cost) && !researching,
            action: () => g.research(b, i),
          });
        }
        for (const base of def.trains) {
          const ut = pl.upgrade[base];
          const u = UNIT_DEFS[ut];
          // 其他勢力的專屬兵種、武將不顯示
          if (u.faction && u.faction !== pl.faction) continue;
          const block = g.sim.economy.trainBlocker(g.myPlayer, ut);
          const locked = UNIT_DEFS[base].age > pl.age;
          const queued = bs.queue[b].filter((q) => q === ut).length;
          out.push({
            id: `train:${u.id}`,
            icon: UNIT_ICONS[u.id] ?? '👤',
            label: u.name,
            tip: locked ? `${u.name}：需要「${AGE_NAMES[u.age]}」時代` : `訓練${u.name}（${costText(pl.unitCost(ut))}，${Math.round(pl.trainTicks(ut) / 10)} 秒）${block ? `\n⚠ ${block}` : ''}`,
            cost: pl.unitCost(ut),
            enabled: !locked && !block && pl.canAfford(pl.unitCost(ut)) && !researching,
            badge: queued ? String(queued) : undefined,
            action: () => g.train(b, ut),
          });
        }
        if (def.trains.length) {
          out.push({ id: 'rally', icon: '🚩', label: '集結點', tip: '設定集結點：點地面或資源（PC 也可直接右鍵）', enabled: true, action: () => (g.rallyMode = true) });
          out.push({ id: 'loop', icon: '🔁', label: '循環', tip: '循環生產：有資源就一直生', enabled: true, active: !!bs.loop[b], action: () => g.toggleLoop(b) });
        }
        if (def.id === 'farm') {
          out.push({ id: 'reseed', icon: '♻️', label: '自動重播', tip: '農田耗盡時自動重播（60 木）', enabled: true, active: pl.autoReseed, action: () => g.toggleReseed() });
        }
        if (def.id === 'town_hall') {
          // 民夫分配助手：點一下就調一名民夫（閒置的優先）去採該資源
          const cnt = g.villagerCounts();
          const icons = ['🌾', '🪵', '🪙', '🪨'];
          for (let k = 0; k < 4; k++) {
            out.push({ id: `assign:${k}`, icon: icons[k], label: `＋${RES_NAMES[k]}`, tip: `民夫分配：派 1 名民夫去採${RES_NAMES[k]}（閒置的優先，否則從人最多的資源調）\n目前 糧${cnt[0]} 木${cnt[1]} 金${cnt[2]} 石${cnt[3]} 建造${cnt[4]} 閒置${cnt[5]}`, enabled: true, badge: String(cnt[k]), action: () => g.assignVillager(k) });
          }
        }
        if (def.id === 'academy') {
          for (const [key, st] of Object.entries(STRATAGEMS)) {
            if (st.faction && st.faction !== pl.faction) continue;
            const block = sim.abilities.stratagemBlocker(g.myPlayer, key);
            const ready = pl.stratagemReady.get(key) ?? 0;
            const cd = Math.max(0, Math.ceil((ready - sim.tick) / 10));
            out.push({
              id: `strat:${key}`,
              icon: STRATAGEM_ICONS[key] ?? '📜',
              label: st.name,
              tip: `計策「${st.name}」：${st.desc}（${costText([0, 0, st.gold, st.stone])}，冷卻 ${st.cd} 秒）${block ? `\n⚠ ${block}` : ''}`,
              cost: [0, 0, st.gold, st.stone],
              enabled: !block,
              badge: cd ? String(cd) : undefined,
              action: () => g.castStratagem(key),
            });
          }
        }
        if (def.id === 'market') {
          for (const [k, name] of [[0, '糧'], [1, '木'], [3, '石']] as const) {
            const price = pl.price[k];
            out.push({ id: `buy:${k}`, icon: '🛒', label: `買${name}`, tip: `用 ${Math.trunc((price * (100 + pl.tradeFee)) / 100)} 金買 100 ${name}`, enabled: pl.res[2] >= Math.trunc((price * (100 + pl.tradeFee)) / 100), action: () => g.trade(k, true) });
            out.push({ id: `sell:${k}`, icon: '💰', label: `賣${name}`, tip: `賣 100 ${name}換 ${Math.trunc((price * (100 - pl.tradeFee)) / 100)} 金`, enabled: pl.res[k] >= 100, action: () => g.trade(k, false) });
          }
        }
      }
      out.push({ id: 'destroy', icon: '🗑️', label: '拆除', tip: '拆除這棟建築（不退費；未開工的地基全額退費）', enabled: true, danger: true, action: () => g.destroySelectedBuilding() });
    }
    return out;
  }

  private perPage(): number {
    return this.game.layoutMode === 'mobile' ? 8 : 10;
  }

  update(): void {
    const g = this.game;
    this.buttons = this.compute();
    const pl = g.sim.players[g.myPlayer];
    const sig = `${g.layoutMode}|${this.page}|${pl.res.join(',')}|${this.buttons.map((b) => `${b.id}${b.enabled ? 1 : 0}${b.active ? 1 : 0}${b.badge ?? ''}`).join(';')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const per = this.perPage();
    const pages = Math.max(1, Math.ceil(this.buttons.length / (per - (this.buttons.length > per ? 1 : 0))));
    if (this.page >= pages) this.page = 0;
    const show = this.buttons.length > per ? per - 1 : per;
    const slice = this.buttons.slice(this.page * show, this.page * show + show);
    this.el.innerHTML = '';
    this.el.style.display = this.buttons.length ? '' : 'none';
    const pc = g.layoutMode === 'pc';
    slice.forEach((btn, i) => {
      const e = document.createElement('button');
      e.className = `card-btn${btn.enabled ? '' : ' off'}${btn.active ? ' on' : ''}${btn.danger ? ' danger' : ''}`;
      e.title = btn.tip + (pc && HOTKEYS[i] ? `（${HOTKEYS[i]}）` : '');
      const cost = btn.cost ? `<span class="cost">${costText(btn.cost)}</span>` : '';
      e.innerHTML = `<span class="ico">${btn.icon}</span><span class="lbl">${btn.label}</span>${cost}${btn.badge ? `<span class="badge">${btn.badge}</span>` : ''}${pc && HOTKEYS[i] ? `<span class="hk">${HOTKEYS[i]}</span>` : ''}`;
      e.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (btn.enabled) btn.action();
        else g.hud.toast(btn.tip);
      });
      this.el.appendChild(e);
    });
    if (this.buttons.length > per) {
      const more = document.createElement('button');
      more.className = 'card-btn more';
      more.innerHTML = `<span class="ico">⋯</span><span class="lbl">${this.page + 1}/${pages}</span>`;
      more.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.page = (this.page + 1) % pages;
        this.sig = '';
      });
      this.el.appendChild(more);
    }
  }

  /** PC 快捷鍵 */
  handleKey(code: string): boolean {
    if (!code.startsWith('Key')) return false;
    const k = code.slice(3);
    const i = HOTKEYS.indexOf(k);
    if (i < 0) return false;
    const per = this.perPage();
    const show = this.buttons.length > per ? per - 1 : per;
    const btn = this.buttons[this.page * show + i];
    if (!btn) return false;
    if (btn.enabled) btn.action();
    else this.game.hud.toast(btn.tip);
    return true;
  }

  reset(): void {
    this.page = 0;
    this.sig = '';
  }
}
