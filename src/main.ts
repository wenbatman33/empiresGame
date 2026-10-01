import { Game } from './game';
import { autoQuality } from './render/stage';
import './style.css';

// DEV 工具只在開發模式或網址加 ?dev=1 時載入（一般玩家不會下載）
const params = new URLSearchParams(location.search);
const devEnabled = import.meta.env.DEV || params.has('dev');
const seed = Number(params.get('seed')) || 20261001;

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  let game: Game;
  if (devEnabled) {
    const { DevTools } = await import('./dev/devtools');
    const persisted = DevTools.applyPersisted();
    game = new Game(app, { seed, quality: persisted.quality ?? autoQuality() });
    new DevTools(game, persisted);
  } else {
    game = new Game(app, { seed, quality: autoQuality() });
  }
  (window as unknown as { game: Game }).game = game;
  game.start();
  const ld = document.getElementById('loading');
  ld?.classList.add('done');
  window.setTimeout(() => ld?.remove(), 600);
}

boot().catch((e) => {
  console.error(e);
  const ld = document.getElementById('loading');
  if (ld) ld.innerHTML = `<div class="ld-card">載入失敗：${String(e?.message ?? e)}</div>`;
});
