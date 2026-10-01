// 指令卡（docs/01 §4、§8）：依選取內容顯示建造／生產／集結等按鈕
// PC 快捷鍵避開 WASD（鏡頭）、H（回城）、P（暫停）
import { BUILDING_DEFS, BUILDING_INDEX, RES_NAMES, UNIT_DEFS, type Cost } from '../sim/core/defs';
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
};
/** 民夫建造選單：第一頁經濟、第二頁軍事與防禦 */
const BUILD_ORDER = ['house', 'farm', 'lumber_camp', 'mine_camp', 'granary', 'barracks', 'archery', 'stable', 'blacksmith', 'tower', 'palisade', 'wall', 'town_hall'];
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
    if (own.length) {
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
            tip: locked ? `${def.name}：需要「${AGE_NAMES[def.age]}」時代` : `蓋${def.name}（${costText(def.cost)}）`,
            cost: def.cost,
            enabled: !locked && pl.canAfford(def.cost),
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
        for (const ut of def.trains) {
          const u = UNIT_DEFS[ut];
          const locked = u.age > pl.age;
          const queued = bs.queue[b].filter((q) => q === ut).length;
          out.push({
            id: `train:${u.id}`,
            icon: UNIT_ICONS[u.id] ?? '👤',
            label: u.name,
            tip: locked ? `${u.name}：需要「${AGE_NAMES[u.age]}」時代` : `訓練${u.name}（${costText(u.cost)}，${u.trainTicks / 10} 秒）`,
            cost: u.cost,
            enabled: !locked && pl.canAfford(u.cost),
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
