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
  /** 地圖類型：central、yangtze、shudao、chibi、random */
  mapType?: string;
  /** 玩家與電腦的勢力（wei／shu／wu；random ＝ 依種子隨機） */
  faction?: string;
  aiFaction?: string;
  /** 玉璽稱帝勝利 */
  seal?: boolean;
}

export const DEFAULT_SETUP: GameSetup = { ai: 'normal', map: 96, seed: 0, res: 0, pop: 125, speed: 1, reveal: false, mapType: 'central', faction: 'random', aiFaction: 'random', seal: true };

const MAP_TYPE_KEYS = ['central', 'yangtze', 'shudao', 'chibi', 'random'];
const FACTION_KEYS = ['wei', 'shu', 'wu', 'random'];

export function readSetup(p: URLSearchParams): GameSetup {
  const ai = p.get('ai');
  const pick = (k: string, list: string[], def: string) => (list.includes(p.get(k) ?? '') ? p.get(k)! : def);
  return {
    ai: ai === 'easy' || ai === 'hard' || ai === 'insane' ? ai : 'normal',
    mapType: pick('mt', MAP_TYPE_KEYS, 'central'),
    faction: pick('f', FACTION_KEYS, 'random'),
    aiFaction: pick('af', FACTION_KEYS, 'random'),
    seal: p.get('seal') !== '0',
    map: Number(p.get('map')) === 128 ? 128 : 96,
    seed: Number(p.get('seed')) || 20261001,
    res: [0, 500, 2000].includes(Number(p.get('res'))) ? Number(p.get('res')) : 0,
    pop: [75, 125, 200].includes(Number(p.get('pop'))) ? Number(p.get('pop')) : 125,
    speed: [0.75, 1, 1.5].includes(Number(p.get('speed'))) ? Number(p.get('speed')) : 1,
    reveal: p.get('reveal') === '1',
  };
}

export function setupQuery(s: GameSetup): string {
  const q = new URLSearchParams({
    play: '1',
    ai: s.ai,
    map: String(s.map),
    mt: s.mapType ?? 'central',
    f: s.faction ?? 'random',
    af: s.aiFaction ?? 'random',
    seal: s.seal === false ? '0' : '1',
    seed: String(s.seed),
    res: String(s.res),
    pop: String(s.pop),
    speed: String(s.speed),
    reveal: s.reveal ? '1' : '0',
  });
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
          <label>我的勢力<select data-k="faction"><option value="random" selected>隨機</option><option value="wei">魏（騎兵、屯田）</option><option value="shu">蜀（武將、高地）</option><option value="wu">吳（水軍、火攻）</option></select></label>
          <label>對手勢力<select data-k="aiFaction"><option value="random" selected>隨機</option><option value="wei">魏</option><option value="shu">蜀</option><option value="wu">吳</option></select></label>
          <label>對手難度<select data-k="ai"><option value="easy">簡單</option><option value="normal" selected>普通</option><option value="hard">困難</option><option value="insane">瘋狂（作弊）</option></select></label>
          <label>地圖<select data-k="mapType"><option value="central" selected>中原（陸戰）</option><option value="yangtze">長江（渡河、水軍）</option><option value="shudao">蜀道（山地隘口）</option><option value="chibi">赤壁（水戰）</option><option value="random">隨機</option></select></label>
          <label>地圖大小<select data-k="map"><option value="96" selected>小（1v1，建議手機）</option><option value="128">中</option></select></label>
          <label>起始資源<select data-k="res"><option value="0" selected>標準</option><option value="500">充足</option><option value="2000">豐厚</option></select></label>
          <label>人口上限<select data-k="pop"><option value="75">75</option><option value="125" selected>125</option><option value="200">200</option></select></label>
          <label>遊戲速度<select data-k="speed"><option value="0.75">慢</option><option value="1" selected>標準</option><option value="1.5">快</option></select></label>
          <label>玉璽稱帝<select data-k="seal"><option value="1" selected>開啟</option><option value="0">關閉</option></select></label>
          <label>揭露地圖<select data-k="reveal"><option value="0" selected>否（戰爭迷霧）</option><option value="1">是</option></select></label>
          <label>地圖種子<input data-k="seed" type="number" value="${s.seed}"></label>
          <div class="menu-row">
            <button class="menu-btn" data-act="back">← 返回</button>
            <button class="menu-btn primary" data-act="go">開戰！</button>
          </div>
        </div>
        <div class="menu-help" hidden>
          <p><b>目標</b>：摧毀敵方太守府與關隘並消滅所有民夫；或建成奇觀（魏銅雀台、蜀劍閣、吳黃鶴樓）守住 5 分鐘；或讓謀士把傳國玉璽送回書院守住 5 分鐘（稱帝）。</p>
          <p><b>三國特色</b>：關隘可招募武將（每位武將有主動技，選取後按 Q 或點 ✨ 技能鈕施放）、勢力特殊兵種；書院可施放計策、研究謀士科技；謀士可勸降敵兵與治療友軍。</p>
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
        mapType: get('mapType'),
        faction: get('faction'),
        aiFaction: get('aiFaction'),
        seal: get('seal') === '1',
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
const WIN_TEXT: Record<string, [string, string]> = {
  conquest: ['天下歸心，霸業可成！', '勝敗乃兵家常事，請重整旗鼓。'],
  seal: ['傳國玉璽在手，登基稱帝！', '敵方挾玉璽稱帝，天命已失……'],
  wonder: ['奇觀巍然屹立，四海賓服！', '敵方奇觀落成，大勢已去……'],
  resign: ['敵軍棄城投降！', '我軍已投降。'],
};

export function showGameOver(root: HTMLElement, win: boolean, rows: [string, string, string][], acts: { again: () => void; menu: () => void; watch: () => void }, reason = 'conquest'): void {
  const table = rows.map(([k, a, b]) => `<tr><th>${k}</th><td>${a}</td><td>${b}</td></tr>`).join('');
  const m = el(`
    <div class="menu-screen dim">
      <div class="menu-card">
        <div class="menu-title ${win ? 'win' : 'lose'}">${win ? '勝 利' : '戰 敗'}</div>
        <div class="menu-sub">${(WIN_TEXT[reason] ?? WIN_TEXT.conquest)[win ? 0 : 1]}</div>
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
