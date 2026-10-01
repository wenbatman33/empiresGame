// 戰役介面（docs/08 §2）：對話框（立繪 ＋ 名牌 ＋ 打字機效果，可跳過）、目標面板、戰役選單、進度與星等
import { sfx } from '../audio/sfx';
import { SCENARIOS, CHAPTERS } from '../data/campaigns';
import type { ObjectiveState, Scenario } from '../sim/systems/scenario';
import { ASSET } from './icons';

const PROGRESS_KEY = 'empiresGame.campaign';

export function readProgress(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/** 記錄星等（只會往上更新） */
export function saveStars(id: string, stars: number): void {
  const p = readProgress();
  p[id] = Math.max(p[id] ?? 0, stars);
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* 忽略 */
  }
}

/** 解鎖規則：每章第一關一開始就能玩，之後要過前一關 */
export function unlocked(sc: Scenario): boolean {
  const list = SCENARIOS.filter((s) => s.chapter === sc.chapter);
  const i = list.indexOf(sc);
  return i <= 0 || (readProgress()[list[i - 1].id] ?? 0) > 0;
}

/** 對話框：一句一句播，點一下顯示整句／下一句；全部播完呼叫 done */
export class DialogBox {
  private el: HTMLElement;
  private queue: { who: string; face?: string; text: string }[] = [];
  private typing = 0;
  private shown = 0;
  private full = '';
  private onDone: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dialog';
    this.el.hidden = true;
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest('.skip')) {
        this.queue.length = 0;
        this.finish();
        return;
      }
      this.next();
    });
    root.appendChild(this.el);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  play(lines: { who: string; face?: string; text: string }[], done: () => void): void {
    this.queue.push(...lines);
    this.onDone = done;
    if (this.el.hidden) this.show();
  }

  private show(): void {
    const line = this.queue.shift();
    if (!line) {
      this.finish();
      return;
    }
    this.el.hidden = false;
    const face = line.face ? `<img class="face" src="${ASSET(`hero/${line.face}.png`)}" alt="" onerror="this.remove()">` : '';
    this.el.innerHTML = `${face}<div class="box"><div class="who">${line.who}</div><div class="text"></div><div class="more">點一下繼續 ▸</div></div><button class="skip">跳過 ⏭</button>`;
    this.full = line.text;
    this.shown = 0;
    window.clearInterval(this.typing);
    // 打字機效果
    this.typing = window.setInterval(() => {
      this.shown = Math.min(this.full.length, this.shown + 1);
      const t = this.el.querySelector('.text');
      if (t) t.textContent = this.full.slice(0, this.shown);
      if (this.shown >= this.full.length) window.clearInterval(this.typing);
    }, 28);
    sfx.play('click', 0.1);
  }

  private next(): void {
    if (this.shown < this.full.length) {
      // 先把整句顯示出來
      window.clearInterval(this.typing);
      this.shown = this.full.length;
      const t = this.el.querySelector('.text');
      if (t) t.textContent = this.full;
      return;
    }
    this.show();
  }

  private finish(): void {
    window.clearInterval(this.typing);
    this.el.hidden = true;
    const f = this.onDone;
    this.onDone = null;
    f?.();
  }
}

/** 目標面板（左上角，可收合） */
export class ObjectivePanel {
  private el: HTMLElement;
  private sig = '';
  private collapsed = false;

  constructor(root: HTMLElement, private sc: Scenario) {
    this.el = document.createElement('div');
    this.el.className = 'objectives';
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.collapsed = !this.collapsed;
      this.sig = '';
    });
    root.appendChild(this.el);
  }

  update(states: Map<string, ObjectiveState>): void {
    const rows = this.sc.objectives.filter((o) => states.get(o.id) !== 'hidden');
    const sig = `${this.collapsed}|${rows.map((o) => `${o.id}:${states.get(o.id)}`).join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const icon = (s?: ObjectiveState) => (s === 'done' ? '✅' : s === 'failed' ? '❌' : '◻️');
    this.el.innerHTML = `<div class="title">📜 ${this.sc.title}${this.collapsed ? ' ▸' : ' ▾'}</div>${this.collapsed ? '' : rows.map((o) => `<div class="obj ${states.get(o.id)} ${o.primary ? 'main' : 'side'}">${icon(states.get(o.id))} ${o.text}</div>`).join('')}`;
  }
}

/** 戰役選單：章節 → 關卡（顯示星等、鎖定狀態） */
export function showCampaignMenu(root: HTMLElement, onPick: (id: string) => void, onBack: () => void): void {
  const prog = readProgress();
  const star = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const html = CHAPTERS.map((c) => {
    const levels = SCENARIOS.filter((s) => s.chapter === c.id)
      .map((s) => {
        const open = unlocked(s);
        return `<button class="level${open ? '' : ' locked'}" data-id="${s.id}" ${open ? '' : 'disabled'}><b>${s.id} ${s.title}</b><span class="sub">${s.subtitle}</span><span class="stars">${open ? star(prog[s.id] ?? 0) : '🔒'}</span></button>`;
      })
      .join('');
    return `<div class="chapter"><div class="ch-title">${c.title}<span class="sub">（${c.side}）</span></div><div class="ch-desc">${c.desc}</div><div class="levels">${levels}</div></div>`;
  }).join('');
  const d = document.createElement('div');
  d.className = 'menu-screen main-menu';
  d.innerHTML = `<div class="menu-card campaign"><div class="menu-title sm">戰役</div>${html}<button class="menu-btn" data-act="back">← 返回</button></div>`;
  root.appendChild(d);
  d.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const lv = t.closest<HTMLElement>('.level');
    if (lv && !lv.classList.contains('locked')) {
      d.remove();
      onPick(lv.dataset.id!);
      return;
    }
    if (t.closest('[data-act="back"]')) {
      d.remove();
      onBack();
    }
  });
}

/** 關卡簡報（開戰前） */
export function showBriefing(root: HTMLElement, sc: Scenario, onGo: () => void): void {
  const d = document.createElement('div');
  d.className = 'menu-screen dim';
  d.innerHTML = `<div class="menu-card"><div class="menu-title sm">${sc.id} ${sc.title}</div><div class="menu-sub">${sc.subtitle}</div><p class="brief">${sc.brief}</p><div class="obj-list">${sc.objectives
    .filter((o) => !o.hidden)
    .map((o) => `<div>${o.primary ? '◆' : '◇'} ${o.text}</div>`)
    .join('')}</div><button class="menu-btn primary" data-act="go">出征！</button></div>`;
  root.appendChild(d);
  d.querySelector('[data-act="go"]')!.addEventListener('click', () => {
    d.remove();
    onGo();
  });
}

export { SCENARIOS };
