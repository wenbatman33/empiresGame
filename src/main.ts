import { Game } from './game';
import { autoQuality } from './render/stage';
import { latestSave } from './save/save';
import { readSetup, setupQuery, showMainMenu, type GameSetup } from './ui/menus';
import './style.css';

// DEV 工具只在開發模式或網址加 ?dev=1 時載入（一般玩家不會下載）
const params = new URLSearchParams(location.search);
const devEnabled = import.meta.env.DEV || params.has('dev');

async function start(setup: GameSetup, load: boolean): Promise<void> {
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
    game = new Game(app, { setup: st, quality: autoQuality() });
  }
  (window as unknown as { game: Game }).game = game;
  game.start();
  hideLoading();
  if (save) await game.replay(save.data.history, save.data.tick);
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
  showMainMenu(document.body, {
    hasSave: !!latestSave(),
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
