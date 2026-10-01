// 軍師提示（docs/09 M5）：諸葛亮頭像 ＋ 一句建議 ＋ 語音；每種提示有冷卻，不會一直唸
import { sfx } from '../audio/sfx';
import { BUILDING_DEFS, TECH_DEFS, TECH_INDEX, UNIT_DEFS } from '../sim/core/defs';
import { S, TASK } from '../sim/core/world';
import type { Game } from '../game';
import { ASSET } from './icons';

const KEY = 'empiresGame.advisor';

interface Hint {
  id: string;
  text: string;
  /** 冷卻（秒，遊戲時間）；0 ＝ 一局只提示一次 */
  cd: number;
}

const HINTS: Record<string, Hint> = {
  house: { id: 'adv_house', text: '主公，民居不足，請速建民居。', cd: 60 },
  idle: { id: 'adv_idle', text: '主公，有民夫閒置。（按「閒置」鈕或 . 鍵選取）', cd: 90 },
  attack: { id: 'adv_attack', text: '主公，我軍遭到攻擊！（空白鍵跳過去）', cd: 45 },
  age: { id: 'adv_age', text: '主公，資源已足，可以到太守府升時代了。', cd: 150 },
  army: { id: 'adv_army', text: '主公，敵軍將至，宜早建兵營練兵。', cd: 0 },
  seal: { id: 'adv_seal', text: '主公，傳國玉璽就在地圖中央，派謀士取之、送回書院即可稱帝。', cd: 0 },
  enemySeal: { id: 'adv_enemy_seal', text: '主公，敵方得了玉璽！務必攻破其書院。', cd: 0 },
  wonder: { id: 'adv_wonder', text: '主公，敵方正在建造奇觀！', cd: 0 },
};

export class Advisor {
  enabled = true;
  private el: HTMLElement;
  private last = new Map<string, number>();
  private timer = 0;
  private hideTimer = 0;
  private idleSince = -1;

  constructor(root: HTMLElement, private game: Game) {
    try {
      this.enabled = localStorage.getItem(KEY) !== '0';
    } catch {
      /* 忽略 */
    }
    this.el = document.createElement('div');
    this.el.className = 'advisor';
    this.el.hidden = true;
    this.el.addEventListener('click', () => (this.el.hidden = true));
    root.appendChild(this.el);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* 忽略 */
    }
    if (!on) this.el.hidden = true;
  }

  /** 顯示一則提示（冷卻中就略過） */
  say(key: keyof typeof HINTS): void {
    if (!this.enabled) return;
    const h = HINTS[key];
    const t = this.game.sim.tick / 10;
    const prev = this.last.get(key);
    if (prev !== undefined && (h.cd === 0 || t - prev < h.cd)) return;
    this.last.set(key, t);
    this.el.innerHTML = `<img src="${ASSET('hero/hero_zhuge.png')}" alt="" onerror="this.remove()"><div><b>軍師</b><span>${h.text}</span></div>`;
    this.el.hidden = false;
    sfx.voice(h.id);
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => (this.el.hidden = true), 6000);
  }

  /** 每 2 秒檢查一次局勢 */
  update(dt: number): void {
    if (!this.enabled || this.game.replaying) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 2;
    const g = this.game;
    const sim = g.sim;
    const me = g.myPlayer;
    const pl = sim.players[me];
    const t = sim.tick / 10;
    if (pl.housed) this.say('house');
    // 閒置民夫 ≥ 3 持續 10 秒
    const w = sim.world;
    let idle = 0;
    for (let id = 0; id < w.high; id++) if (w.alive[id] && w.owner[id] === me && UNIT_DEFS[w.utype[id]].worker && w.task[id] === TASK.None && w.state[id] === S.Idle) idle++;
    if (idle >= 3) {
      if (this.idleSince < 0) this.idleSince = t;
      else if (t - this.idleSince >= 10) this.say('idle');
    } else this.idleSince = -1;
    // 升時代：付得起而且太守府沒在研究
    if (pl.age < 4) {
      const tech = TECH_INDEX[`age${pl.age + 1}`];
      const bs = sim.buildings;
      for (let b = 0; b < bs.high; b++) {
        if (!bs.alive[b] || bs.owner[b] !== me || !bs.complete[b] || BUILDING_DEFS[bs.btype[b]].id !== 'town_hall') continue;
        if (bs.research[b] < 0 && !sim.economy.researchBlocker(me, b, tech) && pl.canAfford(TECH_DEFS[tech].cost)) this.say('age');
        break;
      }
    }
    // 6 分鐘還沒有軍事建築
    if (t > 360) {
      const bs = sim.buildings;
      let mil = false;
      for (let b = 0; b < bs.high && !mil; b++) if (bs.alive[b] && bs.owner[b] === me && ['barracks', 'archery', 'stable'].includes(BUILDING_DEFS[bs.btype[b]].id)) mil = true;
      if (!mil) this.say('army');
    }
    // 玉璽、奇觀
    const ab = sim.abilities;
    for (const it of ab.items) {
      if (it.kind !== 'seal' || !sim.sealVictory) continue;
      if (it.academy >= 0 && sim.buildings.alive[it.academy] && sim.buildings.owner[it.academy] !== me) this.say('enemySeal');
      else if (it.carrier < 0 && it.academy < 0 && pl.age >= 3) this.say('seal');
    }
    const bs = sim.buildings;
    for (let b = 0; b < bs.high; b++) {
      if (bs.alive[b] && bs.owner[b] !== me && BUILDING_DEFS[bs.btype[b]].wonder && g.isExplored(bs.tx[b], bs.ty[b])) this.say('wonder');
    }
  }
}
