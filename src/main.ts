import { Game } from './game';
import { autoQuality } from './render/stage';
import { latestSave } from './save/save';
import { sfx } from './audio/sfx';
import type { Quality } from './config';
import { readSetup, setupQuery, showMainMenu, showSettings, type GameSetup } from './ui/menus';
import { showCampaignMenu } from './ui/story';
import './style.css';

// DEV 工具只在開發模式或網址加 ?dev=1 時載入（一般玩家不會下載）
const params = new URLSearchParams(location.search);
const devEnabled = import.meta.env.DEV || params.has('dev');

/** 載入畫面的軍師小提示 */
const TIPS = [
  '槍兵剋騎兵、騎兵剋弓兵、弓兵剋步兵、刀盾剋槍兵。',
  '民夫被攻擊會自己逃回太守府；選太守府可以用「＋糧／＋木」快速分配民夫。',
  '傳國玉璽在地圖正中央：派謀士撿起、送回書院守 5 分鐘就能稱帝。',
  '武將出場 10 秒後才能放技能，選取武將按 Q 或點 ✨ 施放。',
  '赤壁地圖的江心小島只有運兵船到得了。',
  '蜀道的隘口易守難攻，高地攻擊有加成（蜀更高）。',
  '魏的騎兵更耐打、吳的弓兵射程更遠、蜀的武將更強。',
  '火攻計能燒樹林與建築，借東風讓火勢加倍。',
];

function showTip(): void {
  const el = document.querySelector('#loading .ld-tip');
  if (el) el.textContent = `💡 ${TIPS[Math.floor(Math.random() * TIPS.length)]}`;
}

async function start(setup: GameSetup, load: boolean): Promise<void> {
  showTip();
  const app = document.getElementById('app')!;
  let game: Game;
  const save = load ? latestSave() : null;
  const st = save ? save.data.setup : setup;
  if (devEnabled) {
    const { DevTools } = await import('./dev/devtools');
    const persisted = DevTools.applyPersisted();
    game = new Game(app, { setup: st, quality: persisted.quality ?? autoQuality() });
    new DevTools(game, persisted);
  } else {
    game = new Game(app, { setup: st, quality: savedQuality() ?? autoQuality() });
  }
  (window as unknown as { game: Game }).game = game;
  // 讀檔：不顯示戰役簡報（重播完直接接著玩）
  if (save) game.replaying = true;
  game.start();
  hideLoading();
  if (save) await game.replay(save.data.history, save.data.tick);
}

/** 玩家在設定頁選過的畫質 */
function savedQuality(): Quality | null {
  try {
    const q = localStorage.getItem('empiresGame.quality');
    return q === 'low' || q === 'medium' || q === 'high' ? q : null;
  } catch {
    return null;
  }
}

function hideLoading(): void {
  const ld = document.getElementById('loading');
  ld?.classList.add('done');
  window.setTimeout(() => ld?.remove(), 600);
}

function boot(): void {
  if (params.has('play') || params.has('load')) {
    start(readSetup(params), params.has('load')).catch(fail);
    return;
  }
  hideLoading();
  sfx.setMusic('peace');
  showMainMenu(document.body, {
    hasSave: !!latestSave(),
    onCampaign: () =>
      showCampaignMenu(
        document.body,
        (id) => {
          location.href = `${location.pathname}?play=1&campaign=${id}${devEnabled && params.has('dev') ? '&dev=1' : ''}`;
        },
        () => {},
      ),
    onSettings: () =>
      showSettings(
        document.body,
        { vol: sfx.vol, quality: savedQuality() ?? autoQuality() },
        {
          volume: (k, v) => sfx.setVolume(k, v),
          quality: (q) => {
            try {
              localStorage.setItem('empiresGame.quality', q);
            } catch {
              /* 忽略 */
            }
          },
          close: () => {},
        },
      ),
    onStart: (s) => {
      location.href = `${location.pathname}${setupQuery(s)}`;
    },
    onLoad: () => {
      location.href = `${location.pathname}?load=1${devEnabled && params.has('dev') ? '&dev=1' : ''}`;
    },
  });
}

function fail(e: unknown): void {
  console.error(e);
  const ld = document.getElementById('loading');
  if (ld) ld.innerHTML = `<div class="ld-card">載入失敗：${String((e as Error)?.message ?? e)}</div>`;
}

boot();

// PWA：正式版註冊離線快取（開發模式不註冊，免得快取干擾熱更新）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
