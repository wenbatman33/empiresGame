// 連線大廳（docs/08 §3.1）：建立／加入房間（4 碼代碼）、選勢力、準備、房主設定、開戰；觀戰、重新連線
import { newRoomCode } from '../net/protocol';
import { Room, REJOIN_KEY, type StartInfo } from '../net/session';
import { BroadcastTransport, WsTransport, type Transport } from '../net/transport';
import type { GameSetup } from './menus';

const NAME_KEY = 'empiresGame.netName';
const URL_KEY = 'empiresGame.relayUrl';

interface Rejoin {
  code: string;
  name: string;
  kind: 'local' | 'ws';
  url: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function load(k: string, d: string): string {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
}

export function saveRejoin(r: Rejoin): void {
  try {
    sessionStorage.setItem(REJOIN_KEY, JSON.stringify(r));
  } catch {
    /* 忽略 */
  }
}

function readRejoin(): Rejoin | null {
  try {
    return JSON.parse(sessionStorage.getItem(REJOIN_KEY) ?? 'null') as Rejoin | null;
  } catch {
    return null;
  }
}

/** 大廳入口：建立或加入房間；開戰時呼叫 onStart */
export function showLobby(root: HTMLElement, onStart: (room: Room, info: StartInfo, rj: Rejoin) => void, onBack: () => void): void {
  const d = document.createElement('div');
  d.className = 'menu-screen main-menu';
  const rejoin = readRejoin();
  d.innerHTML = `
    <div class="menu-card lobby">
      <div class="menu-title sm">連線對戰</div>
      <label>名字<input data-k="name" maxlength="12" value="${esc(load(NAME_KEY, `主公${Math.floor(Math.random() * 90 + 10)}`))}"></label>
      <label>連線方式<select data-k="kind"><option value="local">同一台電腦的分頁（不需伺服器）</option><option value="ws">中繼伺服器</option></select></label>
      <label class="url" hidden>伺服器<input data-k="url" value="${esc(load(URL_KEY, 'ws://localhost:8787'))}"></label>
      <div class="menu-row"><button class="menu-btn primary" data-act="create">🏯 建立房間</button></div>
      <label>房間代碼<input data-k="code" maxlength="6" placeholder="例如 K7QX" style="text-transform:uppercase"></label>
      <div class="menu-row">
        <button class="menu-btn" data-act="join">⚔ 加入</button>
        <button class="menu-btn" data-act="watch">👀 觀戰</button>
      </div>
      ${rejoin ? `<button class="menu-btn" data-act="rejoin">🔁 重新連線（房間 ${esc(rejoin.code)}）</button>` : ''}
      <div class="sub">提示：「同一台電腦的分頁」可以開兩個分頁自己對打測試；和朋友連線要先架中繼伺服器（npm run relay）。</div>
      <button class="menu-btn" data-act="back">← 返回</button>
    </div>`;
  root.appendChild(d);
  const get = (k: string) => (d.querySelector(`[data-k="${k}"]`) as HTMLInputElement).value.trim();
  const kindSel = d.querySelector<HTMLSelectElement>('[data-k="kind"]')!;
  kindSel.addEventListener('change', () => ((d.querySelector('.url') as HTMLElement).hidden = kindSel.value !== 'ws'));
  if (rejoin?.kind === 'ws') {
    kindSel.value = 'ws';
    (d.querySelector('.url') as HTMLElement).hidden = false;
  }
  const open = (kind: string, url: string, code: string): Transport => (kind === 'ws' ? new WsTransport(url, code) : new BroadcastTransport(code));
  d.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'back') {
      d.remove();
      onBack();
      return;
    }
    const name = get('name') || '主公';
    const kind = get('kind');
    const url = get('url');
    try {
      localStorage.setItem(NAME_KEY, name);
      localStorage.setItem(URL_KEY, url);
    } catch {
      /* 忽略 */
    }
    let room: Room;
    let code: string;
    if (act === 'create') {
      code = newRoomCode();
      room = new Room(open(kind, url, code), name, 'player', true, code);
    } else if (act === 'rejoin' && rejoin) {
      code = rejoin.code;
      room = new Room(open(rejoin.kind, rejoin.url, code), rejoin.name, 'player', false, code, true);
    } else {
      code = get('code').toUpperCase();
      if (!code) return;
      room = new Room(open(kind, url, code), name, act === 'watch' ? 'observer' : 'player', false, code);
    }
    d.remove();
    showRoom(root, room, (info) => onStart(room, info, { code, name: act === 'rejoin' && rejoin ? rejoin.name : name, kind: (act === 'rejoin' && rejoin ? rejoin.kind : kind) as 'local' | 'ws', url }), onBack);
  });
}

/** 房間畫面：成員、勢力、準備、房主設定 */
function showRoom(root: HTMLElement, room: Room, onStart: (info: StartInfo) => void, onBack: () => void): void {
  const d = document.createElement('div');
  d.className = 'menu-screen main-menu';
  root.appendChild(d);
  const FAC = [['random', '隨機'], ['wei', '魏'], ['shu', '蜀'], ['wu', '吳']];
  const sel = (k: string, opts: string[][], v: string, dis = false) => `<select data-k="${k}"${dis ? ' disabled' : ''}>${opts.map(([val, n]) => `<option value="${val}"${val === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  const render = () => {
    const me = room.me;
    const host = room.isHost;
    const s = room.setup;
    const ai1 = room.ais.find((a) => a.slot === 1)?.ai ?? 'none';
    const players = room.members.filter((m) => m.role === 'player');
    const rows = room.members
      .map((m) => `<tr><td>${m.role === 'player' ? `玩家 ${m.slot + 1}` : '觀戰'}</td><td>${esc(m.name)}${m.id === room.host ? ' 👑' : ''}${m.id === room.id ? '（你）' : ''}</td><td>${m.role === 'player' ? (FAC.find((f) => f[0] === m.faction)?.[1] ?? '隨機') : ''}</td><td>${m.role === 'player' ? (m.ready ? '✅ 準備' : '…') : ''}</td></tr>`)
      .join('');
    d.innerHTML = `
      <div class="menu-card lobby">
        <div class="menu-title sm">房間 <span class="code">${esc(room.code)}</span></div>
        <div class="sub">${room.transport.kind}${room.rtt ? `・延遲 ${room.rtt} ms` : ''}・把房間代碼告訴朋友${room.members.length ? '' : '（連線中…找不到房主時請確認代碼）'}</div>
        <table class="stats members"><tr><th>欄位</th><th>名字</th><th>勢力</th><th></th></tr>${rows}</table>
        ${me && me.role === 'player' ? `<label>我的勢力${sel('faction', FAC, me.faction)}</label>` : ''}
        <label>地圖${sel('mapType', [['central', '中原'], ['yangtze', '長江'], ['shudao', '蜀道'], ['chibi', '赤壁'], ['random', '隨機']], s.mapType ?? 'central', !host)}</label>
        <label>地圖大小${sel('map', [['96', '小'], ['128', '中']], String(s.map), !host)}</label>
        <label>起始資源${sel('res', [['0', '標準'], ['500', '充足'], ['2000', '豐厚']], String(s.res), !host)}</label>
        <label>空位由電腦補${sel('ai1', [['none', '不補（要 2 名玩家）'], ['easy', '簡單'], ['normal', '普通'], ['hard', '困難']], players.length >= 2 ? 'none' : ai1, !host || players.length >= 2)}</label>
        <div class="menu-row">
          ${me && me.role === 'player' && !host ? `<button class="menu-btn${me.ready ? '' : ' primary'}" data-act="ready">${me.ready ? '取消準備' : '準備'}</button>` : ''}
          ${host ? `<button class="menu-btn primary" data-act="start"${room.canStart ? '' : ' disabled'}>開戰！</button>` : ''}
          <button class="menu-btn" data-act="leave">離開</button>
        </div>
      </div>`;
  };
  room.onChange = render;
  room.onStart = (info) => {
    d.remove();
    onStart(info);
  };
  render();
  d.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    const k = t.dataset.k;
    if (k === 'faction') room.updateMe({ faction: t.value });
    else if (k === 'ai1') {
      room.ais = t.value === 'none' ? [] : [{ slot: 1, ai: t.value }];
      room.updateSetup({});
    } else if (k === 'mapType') room.updateSetup({ mapType: t.value });
    else if (k === 'map' || k === 'res') room.updateSetup({ [k]: Number(t.value) } as Partial<GameSetup>);
    render();
  });
  d.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'ready') room.updateMe({ ready: !room.me?.ready });
    else if (act === 'start') room.start();
    else if (act === 'leave') {
      room.leave();
      d.remove();
      onBack();
    }
  });
}
