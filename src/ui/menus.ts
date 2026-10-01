// 主選單、開局設定、暫停選單、結算畫面、升時代演出（docs/01 §3、§9）
import type { Difficulty } from '../ai/ai';

export interface GameSetup {
  ai: Difficulty;
  map: number;
  seed: number;
  /** 起始資源加成：0 標準、500 充足、2000 豐厚 */
  res: number;
  pop: number;
  speed: number;
  reveal: boolean;
}

export const DEFAULT_SETUP: GameSetup = { ai: 'normal', map: 96, seed: 0, res: 0, pop: 125, speed: 1, reveal: false };

export function readSetup(p: URLSearchParams): GameSetup {
  const ai = p.get('ai');
  return {
    ai: ai === 'easy' || ai === 'hard' ? ai : 'normal',
    map: Number(p.get('map')) === 128 ? 128 : 96,
    seed: Number(p.get('seed')) || 20261001,
    res: [0, 500, 2000].includes(Number(p.get('res'))) ? Number(p.get('res')) : 0,
    pop: [75, 125, 200].includes(Number(p.get('pop'))) ? Number(p.get('pop')) : 125,
    speed: [0.75, 1, 1.5].includes(Number(p.get('speed'))) ? Number(p.get('speed')) : 1,
    reveal: p.get('reveal') === '1',
  };
}

export function setupQuery(s: GameSetup): string {
  const q = new URLSearchParams({ play: '1', ai: s.ai, map: String(s.map), seed: String(s.seed), res: String(s.res), pop: String(s.pop), speed: String(s.speed), reveal: s.reveal ? '1' : '0' });
  const dev = new URLSearchParams(location.search).get('dev');
  if (dev !== null) q.set('dev', dev);
  return `?${q.toString()}`;
}

function el(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
}

/** 主選單 */
export function showMainMenu(root: HTMLElement, opts: { hasSave: boolean; onStart: (s: GameSetup) => void; onLoad: () => void }): void {
  const s: GameSetup = { ...DEFAULT_SETUP, seed: (Math.random() * 1e9) | 0 };
  const m = el(`
    <div class="menu-screen">
      <div class="menu-card">
        <div class="menu-title">三國霸業</div>
        <div class="menu-sub">Q 版三國即時戰略</div>
        <div class="menu-main">
          <button class="menu-btn primary" data-act="setup">⚔ 開始遊戲</button>
          ${opts.hasSave ? '<button class="menu-btn" data-act="load">📜 繼續上次</button>' : ''}
          <button class="menu-btn" data-act="help">❓ 操作說明</button>
        </div>
        <div class="menu-setup" hidden>
          <label>對手難度<select data-k="ai"><option value="easy">簡單</option><option value="normal" selected>普通</option><option value="hard">困難</option></select></label>
          <label>地圖大小<select data-k="map"><option value="96" selected>小（1v1，建議手機）</option><option value="128">中</option></select></label>
          <label>起始資源<select data-k="res"><option value="0" selected>標準</option><option value="500">充足</option><option value="2000">豐厚</option></select></label>
          <label>人口上限<select data-k="pop"><option value="75">75</option><option value="125" selected>125</option><option value="200">200</option></select></label>
          <label>遊戲速度<select data-k="speed"><option value="0.75">慢</option><option value="1" selected>標準</option><option value="1.5">快</option></select></label>
          <label>揭露地圖<select data-k="reveal"><option value="0" selected>否（戰爭迷霧）</option><option value="1">是</option></select></label>
          <label>地圖種子<input data-k="seed" type="number" value="${s.seed}"></label>
          <div class="menu-row">
            <button class="menu-btn" data-act="back">← 返回</button>
            <button class="menu-btn primary" data-act="go">開戰！</button>
          </div>
        </div>
        <div class="menu-help" hidden>
          <p><b>目標</b>：摧毀敵方太守府並消滅所有民夫。</p>
          <p><b>PC</b>：左鍵選取／拖曳框選、右鍵移動／採集／建造／攻擊、雙擊選同類、WASD 或滑鼠碰邊緣捲動、滾輪縮放、空白鍵跳到交戰處、Ctrl＋數字編隊。指令卡快捷鍵 Q E R T F G Z X C V。</p>
          <p><b>手機</b>：點兵選取、長按拖曳框選、點地面或資源下指令、雙指縮放、單指拖曳捲動。</p>
          <p><b>經濟</b>：民夫採集糧木金石，蓋民居加人口，太守府升時代解鎖新兵種。<b>相剋</b>：槍剋騎、騎剋弓、弓剋步、刀盾剋槍、攻城剋建築。</p>
          <button class="menu-btn" data-act="back">← 返回</button>
        </div>
      </div>
    </div>`);
  root.appendChild(m);
  const main = m.querySelector<HTMLElement>('.menu-main')!;
  const setup = m.querySelector<HTMLElement>('.menu-setup')!;
  const help = m.querySelector<HTMLElement>('.menu-help')!;
  m.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    main.hidden = act !== 'back';
    setup.hidden = act !== 'setup';
    help.hidden = act !== 'help';
    if (act === 'load') opts.onLoad();
    if (act === 'go') {
      const get = (k: string) => (m.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement).value;
      opts.onStart({
        ai: get('ai') as Difficulty,
        map: Number(get('map')),
        res: Number(get('res')),
        pop: Number(get('pop')),
        speed: Number(get('speed')),
        reveal: get('reveal') === '1',
        seed: Number(get('seed')) || (Math.random() * 1e9) | 0,
      });
    }
  });
}

/** 遊戲內選單（暫停） */
export function showPauseMenu(root: HTMLElement, acts: Record<string, () => void>, extra = ''): () => void {
  const m = el(`
    <div class="menu-screen dim">
      <div class="menu-card small">
        <div class="menu-title sm">暫停</div>
        <button class="menu-btn primary" data-act="resume">▶ 繼續</button>
        <button class="menu-btn" data-act="save">💾 存檔</button>
        <button class="menu-btn" data-act="load">📜 讀檔</button>
        <button class="menu-btn" data-act="sound">🔊 音效開關</button>
        <button class="menu-btn" data-act="quality">🖥 切換畫質</button>
        <button class="menu-btn danger" data-act="resign">🏳 投降</button>
        <button class="menu-btn" data-act="menu">🏠 回主選單</button>
        ${extra}
      </div>
    </div>`);
  root.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    acts[act]?.();
  });
  return close;
}

/** 結算畫面 */
export function showGameOver(root: HTMLElement, win: boolean, rows: [string, string, string][], acts: { again: () => void; menu: () => void; watch: () => void }): void {
  const table = rows.map(([k, a, b]) => `<tr><th>${k}</th><td>${a}</td><td>${b}</td></tr>`).join('');
  const m = el(`
    <div class="menu-screen dim">
      <div class="menu-card">
        <div class="menu-title ${win ? 'win' : 'lose'}">${win ? '勝 利' : '戰 敗'}</div>
        <div class="menu-sub">${win ? '天下歸心，霸業可成！' : '勝敗乃兵家常事，請重整旗鼓。'}</div>
        <table class="stats"><tr><th></th><td>我軍</td><td>敵軍</td></tr>${table}</table>
        <div class="menu-row">
          <button class="menu-btn" data-act="watch">👀 看戰場</button>
          <button class="menu-btn primary" data-act="again">⚔ 再來一局</button>
          <button class="menu-btn" data-act="menu">🏠 主選單</button>
        </div>
      </div>
    </div>`);
  root.appendChild(m);
  m.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act as keyof typeof acts | undefined;
    if (!act) return;
    if (act === 'watch') m.remove();
    acts[act]();
  });
}

/** 升時代：卷軸展開書法大字 */
export function showAgeBanner(root: HTMLElement, name: string, sub: string): void {
  const m = el(`<div class="age-banner"><div class="scroll"><div class="age-name">${name}</div><div class="age-sub">${sub}</div></div></div>`);
  root.appendChild(m);
  window.setTimeout(() => m.classList.add('out'), 2600);
  window.setTimeout(() => m.remove(), 3300);
}

/** 讀檔進度 */
export function showLoading(root: HTMLElement, text: string): { set: (t: string) => void; close: () => void } {
  const m = el(`<div class="menu-screen dim"><div class="menu-card small"><div class="menu-sub">${text}</div></div></div>`);
  root.appendChild(m);
  const sub = m.querySelector<HTMLElement>('.menu-sub')!;
  return { set: (t) => (sub.textContent = t), close: () => m.remove() };
}
