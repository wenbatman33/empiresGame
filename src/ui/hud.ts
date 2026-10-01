// HUD：資源列、小地圖、選取面板、左側按鈕、指令卡、放置確認列、框選框、提示訊息
// 版面數值來自 layout.ts，DEV 工具可直接拖曳
import { PLAYER_COLORS } from '../config';
import { BUILDING_DEFS, FACTION_NAMES, RESOURCE_KINDS, RES_NAMES, TECH_DEFS, UNIT_DEFS, WONDER_NAMES } from '../sim/core/defs';
import { SKILLS } from '../sim/systems/abilities';
import { S, TASK } from '../sim/core/world';
import type { Game } from '../game';
import { CommandCard } from './commandCard';
import { ASSET, iconHtml, icons, unitIcon } from './icons';
import { applyBox, HUD_KEYS, LAYOUTS, type HudKey } from './layout';

const AGE_NAMES = ['', '黃巾亂世', '群雄割據', '三分天下', '天下一統'];
const RES_ICONS = ['🌾', '🪵', '🪙', '🪨'];
const MINI_RES: Record<string, string> = { gold: '#ffd43b', stone: '#c9c5bd', berry: '#e0405a', deer: '#c98b4e', boar: '#5a463a', fish: '#9fd8ff' };

export class Hud {
  readonly root: HTMLElement;
  readonly els = {} as Record<HudKey, HTMLElement>;
  readonly card: CommandCard;
  private boxEl: HTMLElement;
  private toastEl: HTMLElement;
  private topText: HTMLElement;
  private selBody: HTMLElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private miniTerrain: HTMLCanvasElement;
  private miniTimer = 0;
  private selSig = '';
  private topSig = '';
  private toastTimer = 0;
  private boxBtn: HTMLButtonElement;
  private idleBtn: HTMLButtonElement;

  constructor(container: HTMLElement, private game: Game) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    container.appendChild(this.root);

    const top = this.panel('topbar');
    this.topText = document.createElement('div');
    this.topText.className = 'top-row';
    top.appendChild(this.topText);

    const mm = this.panel('minimap');
    this.mini = document.createElement('canvas');
    mm.appendChild(this.mini);
    this.miniCtx = this.mini.getContext('2d')!;
    this.miniTerrain = this.buildMiniTerrain();
    this.bindMinimap();

    const sel = this.panel('selection');
    this.selBody = document.createElement('div');
    this.selBody.className = 'sel-body';
    sel.appendChild(this.selBody);

    const lb = this.panel('leftbar');
    this.boxBtn = this.button(lb, '框選', '框選模式：單指拖曳就是框選', () => {
      game.controls.boxToggle = !game.controls.boxToggle;
      this.boxBtn.classList.toggle('on', game.controls.boxToggle);
    });
    this.idleBtn = this.button(lb, '閒置', '選取閒置的民夫（PC：. 鍵）', () => game.selectIdleVillager());
    this.button(lb, '全軍', '選取所有我方軍隊', () => game.selectArmy());
    this.button(lb, '回城', '鏡頭回到太守府（PC：H 鍵）', () => game.goHome());
    this.button(lb, '取消', '取消選取（PC：Esc）', () => game.clearSelection());

    const cards = this.panel('cards');
    cards.classList.add('cards');
    this.card = new CommandCard(cards, game);

    const pb = this.panel('placebar');
    pb.classList.add('placebar');
    this.button(pb, '✔ 蓋這裡', '確定放置', () => game.confirmPlacing(false)).classList.add('ok');
    this.button(pb, '✕', '取消放置', () => game.cancelPlacing());

    this.boxEl = document.createElement('div');
    this.boxEl.className = 'sel-box';
    this.root.appendChild(this.boxEl);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.root.appendChild(this.toastEl);

    const rot = document.createElement('div');
    rot.className = 'rotate-hint';
    rot.innerHTML = '<div>📱↻</div><div>請把手機轉成橫向</div>';
    this.root.appendChild(rot);

    this.applyLayout();
    window.addEventListener('resize', () => this.applyLayout());
  }

  private panel(key: HudKey): HTMLElement {
    const el = document.createElement('div');
    el.className = `hud-panel hud-${key}`;
    el.dataset.hud = key;
    this.root.appendChild(el);
    this.els[key] = el;
    return el;
  }

  private button(parent: HTMLElement, label: string, title: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'hud-btn';
    b.innerHTML = `<span>${label}</span>`;
    b.title = title;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    parent.appendChild(b);
    return b;
  }

  applyLayout(): void {
    const L = LAYOUTS[this.game.layoutMode];
    for (const k of HUD_KEYS) applyBox(this.els[k], L[k]);
    this.root.dataset.layout = this.game.layoutMode;
    this.boxBtn.style.display = this.game.layoutMode === 'pc' ? 'none' : '';
    this.resizeMinimap();
    this.selSig = '';
    this.topSig = '';
    this.card.reset();
  }

  private resizeMinimap(): void {
    const b = LAYOUTS[this.game.layoutMode].minimap;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.mini.width = Math.round(b.w * dpr);
    this.mini.height = Math.round(b.h * dpr);
  }

  showBox(x0: number, y0: number, x1: number, y1: number): void {
    const s = this.boxEl.style;
    s.display = 'block';
    s.left = `${Math.min(x0, x1)}px`;
    s.top = `${Math.min(y0, y1)}px`;
    s.width = `${Math.abs(x1 - x0)}px`;
    s.height = `${Math.abs(y1 - y0)}px`;
  }

  hideBox(): void {
    this.boxEl.style.display = 'none';
  }

  /** 武將技演出：橫幅滑入「武將名 ── 技能名」 */
  cutIn(hero: string, skill: string, mine: boolean, heroId = ''): void {
    const el = document.createElement('div');
    el.className = `cutin${mine ? '' : ' enemy'}`;
    // 武將 AI 頭像（docs/07 §8.2 技能特寫）
    const face = heroId ? `<img class="face" src="${ASSET(`hero/${heroId}.png`)}" alt="" onerror="this.remove()">` : '';
    el.innerHTML = `${face}<span class="who">${hero}</span><span class="what">${skill}</span>`;
    this.root.appendChild(el);
    window.setTimeout(() => el.remove(), 1700);
  }

  toast(msg: string, ms = 1800): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  update(dt: number): void {
    this.updateTop();
    this.updateSelection();
    this.card.update();
    // 放置確認列：觸控版面才需要（PC 直接點地面）
    const pb = this.els.placebar;
    const showPb = !!this.game.placing && this.game.layoutMode !== 'pc' && LAYOUTS[this.game.layoutMode].placebar.visible;
    pb.style.display = showPb ? '' : 'none';
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 0.2;
      this.drawMinimap();
    }
  }

  private updateTop(): void {
    const g = this.game;
    const sim = g.sim;
    const pl = sim.players[g.myPlayer];
    const sec = Math.floor(sim.tick / 10);
    const time = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    const w = sim.world;
    let idle = 0;
    for (let id = 0; id < w.high; id++) {
      if (w.alive[id] && w.owner[id] === g.myPlayer && UNIT_DEFS[w.utype[id]].worker && w.task[id] === TASK.None && w.state[id] === S.Idle) idle++;
    }
    // 特殊勝利倒數（奇觀、玉璽）
    const vic = victoryTimer(sim);
    const sig = `${pl.res.join(',')}|${pl.pop}/${pl.popCap}|${pl.housed}|${pl.age}|${time}|${g.paused}|${g.layoutMode}|${idle}|${vic}`;
    if (sig === this.topSig) return;
    this.topSig = sig;
    const compact = g.layoutMode === 'mobile';
    const popCls = pl.housed ? ' class="warn"' : '';
    this.topText.innerHTML = [
      ...pl.res.map((v, i) => `<span>${RES_ICONS[i]}${compact ? '' : ` ${RES_NAMES[i]}`} ${v}</span>`),
      `<span${popCls}>👥 ${pl.pop}/${pl.popCap}</span>`,
      `<span class="fac fac-${pl.faction}"><img src="${ASSET(`faction/emblem_${pl.faction}.png`)}" alt="" onerror="this.remove()">${FACTION_NAMES[pl.faction] ?? ''}</span>`,
      `<span class="age">${AGE_NAMES[pl.age]}</span>`,
      `<span>⏱ ${time}</span>`,
      vic ? `<span class="warn">${vic}</span>` : '',
      g.paused ? '<span class="warn">暫停</span>' : '',
    ].join('');
    this.idleBtn.innerHTML = `<span>閒置</span>${idle ? `<b class="badge">${idle}</b>` : ''}`;
    this.idleBtn.classList.toggle('blink', idle > 0);
  }

  private updateSelection(): void {
    const g = this.game;
    const sim = g.sim;
    const w = sim.world;
    const bs = sim.buildings;
    const rs = sim.res;
    let html = '';
    let sig = `${g.layoutMode}|`;
    if (g.placing) {
      const def = BUILDING_DEFS[g.placing.btype];
      sig += `place${g.placing.btype}${g.placing.valid}`;
      if (sig === this.selSig) return;
      html = `<div class="sel-one"><span class="big">${iconHtml(icons.building(def.id, Math.max(def.age, g.sim.players[g.myPlayer].age)))}</span><div><b>放置${def.name}</b><div class="sub">${g.placing.valid ? (g.layoutMode === 'pc' ? '左鍵放置 · Shift 連續放 · 右鍵取消' : '點地面移動位置，再按「蓋這裡」') : '這裡不能蓋'}</div></div></div>`;
    } else if (g.targeting) {
      sig += `target${g.targeting.kind}`;
      if (sig === this.selSig) return;
      html = `<div class="hint">✨ ${g.targeting.kind === 'unload' ? '點選要靠岸卸兵的地點' : '點選施放地點'}（Esc 或「取消」鈕取消）</div>`;
    } else if (g.rallyMode || g.attackMoveMode || g.patrolMode) {
      sig += `mode${g.rallyMode}${g.attackMoveMode}${g.patrolMode}`;
      if (sig === this.selSig) return;
      html = `<div class="hint">${g.rallyMode ? '點地面或資源設定集結點' : g.attackMoveMode ? '⚔ 點地面：攻擊移動（沿路遇敵就打）' : '🔄 點地面：巡邏終點'}</div>`;
    } else if (g.selected.size) {
      const counts = new Map<number, number>();
      let owner = -1;
      let single = -1;
      for (const id of g.selected) {
        counts.set(w.utype[id], (counts.get(w.utype[id]) ?? 0) + 1);
        owner = w.owner[id];
        single = id;
      }
      const color = PLAYER_COLORS[owner] ?? '#fff';
      if (g.selected.size === 1) {
        const def = UNIT_DEFS[w.utype[single]];
        const maxHp = sim.abilities.maxHp(single);
        const pct = Math.max(0, Math.min(100, (w.hp[single] / maxHp) * 100));
        const task = w.task[single];
        let doing = w.carry[single] > 0 ? `帶著 ${w.carry[single]} ${RES_NAMES[w.carryRes[single]]}` : task === TASK.Build ? '建造中' : task === TASK.Farm ? '耕田中' : task === TASK.Gather ? '採集中' : w.state[single] === S.Move ? '移動中' : '閒置';
        if (w.item[single] >= 0) doing = `攜帶${sim.abilities.items[w.item[single]]?.kind === 'seal' ? '傳國玉璽' : '兵書'}（送回書院）`;
        if (w.fearUntil[single] > sim.tick) doing = '恐懼中';
        if (def.capacity) {
          let n = 0;
          for (let j = 0; j < w.high; j++) if (w.alive[j] && w.aboard[j] === single) n += UNIT_DEFS[w.utype[j]].pop;
          doing = `載兵 ${n}/${def.capacity}`;
        }
        let extra = '';
        if (def.hero) {
          const sk = SKILLS[def.id];
          const cd = Math.max(0, Math.ceil((w.skillReady[single] - sim.tick) / 10));
          extra = `<div class="sub">${'★'.repeat(w.level[single])} 威名 ${w.renown[single]} · ${sk ? `${sk.name}${cd ? `（${cd} 秒）` : '（可施放）'}` : ''}</div>`;
        }
        sig += `one${single}|${w.hp[single]}|${doing}|${extra}`;
        if (sig === this.selSig) return;
        html = `<div class="sel-one"><span class="big">${iconHtml(unitIcon(def.id))}</span><div class="grow"><div><span class="dot" style="background:${color}"></span> <b>${def.name}</b> <span class="sub">${doing}</span></div><div class="hpline"><span class="hp"><i style="width:${pct}%"></i></span><span>${w.hp[single]}/${maxHp}</span></div>${extra}</div></div>`;
      } else {
        const list = [...counts].sort((a, b) => a[0] - b[0]);
        sig += `many${g.selected.size}|${list.join(',')}`;
        if (sig === this.selSig) return;
        const chips = list.map(([t, n]) => `<button class="chip" data-type="${t}">${iconHtml(unitIcon(UNIT_DEFS[t].id), 'sm')}${UNIT_DEFS[t].name} ×${n}</button>`).join('');
        html = `<div class="sel-many"><span class="dot" style="background:${color}"></span><b>${g.selected.size} 名</b>${chips}</div>`;
      }
    } else if (g.selBuilding >= 0 && bs.alive[g.selBuilding]) {
      const b = g.selBuilding;
      const def = BUILDING_DEFS[bs.btype[b]];
      const color = PLAYER_COLORS[bs.owner[b]];
      const pct = Math.round((bs.hp[b] / def.hp) * 100);
      const prog = bs.complete[b] ? 100 : Math.floor((bs.progress[b] / (def.buildTicks * 3)) * 100);
      const q = bs.queue[b];
      const qp = q.length ? Math.floor((bs.qProgress[b] / sim.players[bs.owner[b]].trainTicks(q[0])) * 100) : 0;
      const pl = sim.players[bs.owner[b]];
      const rt = bs.research[b];
      const rp = rt >= 0 ? Math.floor((bs.rProgress[b] / TECH_DEFS[rt].ticks) * 100) : 0;
      sig += `b${b}|${bs.hp[b]}|${prog}|${q.join(',')}|${qp}|${bs.food[b]}|${pl.housed}|${rt}|${rp}|${pl.price.join(',')}|${def.wonder ? sim.tick : ''}`;
      if (sig === this.selSig) return;
      let extra = '';
      if (!bs.complete[b]) extra = `<div class="sub">建造中 ${prog}%</div>`;
      else if (def.id === 'farm') extra = `<div class="sub">剩餘 ${bs.food[b]} 糧${bs.farmer[b] >= 0 ? ' · 有人耕作' : ' · 沒人耕作'}</div>`;
      else if (def.id === 'academy') {
        const items = sim.abilities.items.filter((it) => it.academy === b);
        extra = `<div class="sub">${items.length ? `收藏：${items.map((it) => (it.kind === 'seal' ? '傳國玉璽' : '兵書')).join('、')}` : '謀士可把地圖上的兵書、玉璽送來這裡'}</div>`;
      } else if (def.id === 'market') {
        extra = `<div class="sub">行情（每 100 單位）：糧 ${pl.price[0]} · 木 ${pl.price[1]} · 石 ${pl.price[3]} 金</div>`;
      } else if (def.wonder && sim.abilities.wonders.has(b)) {
        const left = Math.max(0, 300 - Math.floor((sim.tick - sim.abilities.wonders.get(b)!) / 10));
        extra = `<div class="sub">勝利倒數 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</div>`;
      } else if (def.pop) extra = `<div class="sub">人口上限 ＋${def.pop}</div>`;
      const queue = q.length
        ? `<div class="queue">${q
            .map((ut, i) => `<button class="qi" data-i="${i}" title="點一下取消">${iconHtml(unitIcon(UNIT_DEFS[ut].id), 'sm')}${i === 0 ? `<i style="width:${qp}%"></i>` : ''}</button>`)
            .join('')}${pl.housed && bs.owner[b] === g.myPlayer ? '<span class="warn">人口已滿</span>' : ''}</div>`
        : '';
      const research = rt >= 0 ? `<div class="research"><span>📘 研究「${TECH_DEFS[rt].name}」</span><span class="hp prog"><i style="width:${rp}%"></i></span><button class="qi cancel-r" title="取消研究（退費）">✕</button></div>` : '';
      const iconId = def.wonder ? `wonder_${sim.players[bs.owner[b]].faction}` : def.id;
      const bname = def.wonder ? WONDER_NAMES[sim.players[bs.owner[b]].faction] ?? def.name : def.name;
      html = `<div class="sel-one"><span class="big">${iconHtml(icons.building(iconId, sim.players[bs.owner[b]].age))}</span><div class="grow"><div><span class="dot" style="background:${color}"></span> <b>${bname}</b></div><div class="hpline"><span class="hp"><i style="width:${pct}%"></i></span><span>${bs.hp[b]}/${def.hp}</span></div>${extra}${research}${queue}</div></div>`;
    } else if (g.selResource >= 0 && rs.alive[g.selResource]) {
      const r = g.selResource;
      const kd = RESOURCE_KINDS[rs.kind[r]];
      sig += `r${r}|${rs.amount[r]}`;
      if (sig === this.selSig) return;
      html = `<div class="sel-one"><span class="big">${RES_ICONS[kd.res]}</span><div><b>${kd.name}</b><div class="sub">剩餘 ${rs.amount[r]} ${RES_NAMES[kd.res]}</div></div></div>`;
    } else {
      sig += 'none';
      if (sig === this.selSig) return;
      html =
        g.layoutMode === 'pc'
          ? '<div class="hint">左鍵選取／拖曳框選 · 右鍵：移動、採集、建造 · 雙擊選同類 · WASD 捲動 · 滾輪縮放</div>'
          : '<div class="hint">點兵選取 · 長按拖曳框選 · 點地面或資源下指令 · 雙指縮放</div>';
    }
    this.selSig = sig;
    this.selBody.innerHTML = html;
    this.selBody.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        g.keepOnlyType(Number(b.dataset.type));
      }),
    );
    this.selBody.querySelector<HTMLButtonElement>('.cancel-r')?.addEventListener('click', (e) => {
      e.stopPropagation();
      g.sim.issue({ t: 'cancelResearch', player: g.myPlayer, building: g.selBuilding });
    });
    this.selBody.querySelectorAll<HTMLButtonElement>('.qi:not(.cancel-r)').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        g.cancelTrain(g.selBuilding, Number(b.dataset.i));
      }),
    );
  }

  // ───────── 小地圖 ─────────

  private buildMiniTerrain(): HTMLCanvasElement {
    const map = this.game.sim.map;
    const c = document.createElement('canvas');
    c.width = map.w;
    c.height = map.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(map.w, map.h);
    const rgb = this.game.terrain.tileRgb;
    for (let i = 0; i < map.w * map.h; i++) {
      img.data[i * 4] = rgb[i * 3];
      img.data[i * 4 + 1] = rgb[i * 3 + 1];
      img.data[i * 4 + 2] = rgb[i * 3 + 2];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private pings: { x: number; z: number; t: number }[] = [];
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogVersion = -1;

  /** 小地圖上閃紅圈（遭到攻擊） */
  ping(x: number, z: number): void {
    if (this.pings.length > 8) this.pings.shift();
    this.pings.push({ x, z, t: performance.now() });
  }

  /** 樹被砍掉時，小地圖那一格改成草地色 */
  clearMiniTile(tx: number, ty: number): void {
    const ctx = this.miniTerrain.getContext('2d')!;
    ctx.fillStyle = '#8cbf55';
    ctx.fillRect(tx, ty, 1, 1);
  }

  private drawMinimap(): void {
    const g = this.game;
    const ctx = this.miniCtx;
    const W = this.mini.width;
    const H = this.mini.height;
    const sim = g.sim;
    const map = sim.map;
    const sx = W / map.w;
    const sy = H / map.h;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniTerrain, 0, 0, W, H);
    const me = g.myPlayer;
    const rs = sim.res;
    const rdot = Math.max(2, Math.round(W / 110));
    for (let r = 0; r < rs.high; r++) {
      if (!rs.alive[r]) continue;
      const col = MINI_RES[RESOURCE_KINDS[rs.kind[r]].id];
      if (!col || !g.isExplored(rs.tx[r], rs.ty[r])) continue;
      ctx.fillStyle = col;
      ctx.fillRect((rs.x[r] / 1024) * sx - rdot / 2, (rs.y[r] / 1024) * sy - rdot / 2, rdot, rdot);
    }
    const bs = sim.buildings;
    for (let b = 0; b < bs.high; b++) {
      if (!bs.alive[b]) continue;
      const def = BUILDING_DEFS[bs.btype[b]];
      if (bs.owner[b] !== me && !g.isExplored(bs.tx[b], bs.ty[b])) continue;
      ctx.fillStyle = PLAYER_COLORS[bs.owner[b]];
      ctx.globalAlpha = bs.complete[b] ? 1 : 0.5;
      ctx.fillRect(bs.tx[b] * sx, bs.ty[b] * sy, Math.max(2, def.w * sx), Math.max(2, def.h * sy));
      ctx.globalAlpha = 1;
      if (b === g.selBuilding) {
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(bs.tx[b] * sx, bs.ty[b] * sy, def.w * sx, def.h * sy);
      }
    }
    const w = sim.world;
    const dot = Math.max(2, Math.round(W / 90));
    // 迷霧：未探索全黑、已探索半暗
    if (g.fog.enabled) {
      if (!this.fogCanvas) {
        this.fogCanvas = document.createElement('canvas');
        this.fogCanvas.width = map.w;
        this.fogCanvas.height = map.h;
      }
      if (this.fogVersion !== sim.vision.version) {
        this.fogVersion = sim.vision.version;
        const fctx = this.fogCanvas.getContext('2d')!;
        const img = fctx.createImageData(map.w, map.h);
        const vis = sim.vision.visible[me];
        const exp = sim.vision.explored[me];
        for (let i = 0; i < vis.length; i++) img.data[i * 4 + 3] = vis[i] ? 0 : exp[i] ? 110 : 235;
        fctx.putImageData(img, 0, 0);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCanvas, 0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
    }
    for (let id = 0; id < w.high; id++) {
      if (!w.alive[id] || w.state[id] === 3) continue;
      if (w.owner[id] !== me && !g.units.seen[id]) continue;
      if (w.aboard[id] >= 0) continue;
      ctx.fillStyle = g.selected.has(id) ? '#ffffff' : PLAYER_COLORS[w.owner[id]];
      ctx.fillRect(g.units.wx[id] * sx - dot / 2, g.units.wz[id] * sy - dot / 2, dot, dot);
    }
    // 兵書（白）與玉璽（金，大一點）
    for (const it of sim.abilities.items) {
      if (it.carrier >= 0 || it.academy >= 0) continue;
      const tx = it.x / 1024;
      const tz = it.y / 1024;
      if (!g.isExplored(Math.floor(tx), Math.floor(tz))) continue;
      const r = it.kind === 'seal' ? dot * 1.6 : dot;
      ctx.fillStyle = it.kind === 'seal' ? '#ffd23a' : '#f4ecd8';
      ctx.strokeStyle = '#3a2a10';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(tx * sx, tz * sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // 鏡頭視野四邊形
    const rect = g.stage.renderer.domElement.getBoundingClientRect();
    const corners = [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.right, rect.bottom],
      [rect.left, rect.bottom],
    ].map(([x, y]) => g.cam.groundAt(x, y));
    // 遭到攻擊的紅圈
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.t < 3000);
    for (const p of this.pings) {
      const k = (now - p.t) / 3000;
      ctx.strokeStyle = `rgba(255,60,50,${1 - k})`;
      ctx.lineWidth = Math.max(2, W / 80);
      ctx.beginPath();
      ctx.arc(p.x * sx, p.z * sy, (4 + k * 14) * (W / 128), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (corners.every((p) => p)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, W / 120);
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p!.x * sx, p!.z * sy) : ctx.moveTo(p!.x * sx, p!.z * sy)));
      ctx.closePath();
      ctx.stroke();
    }
  }

  private bindMinimap(): void {
    let dragging = false;
    const toWorld = (e: PointerEvent): [number, number] => {
      const r = this.mini.getBoundingClientRect();
      const map = this.game.sim.map;
      return [((e.clientX - r.left) / r.width) * map.w, ((e.clientY - r.top) / r.height) * map.h];
    };
    this.mini.addEventListener('contextmenu', (e) => e.preventDefault());
    this.mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const [x, z] = toWorld(e);
      if (e.button === 2) {
        this.game.issueMove(x, z);
        return;
      }
      dragging = true;
      try {
        this.mini.setPointerCapture(e.pointerId);
      } catch {
        /* 略過 */
      }
      this.game.cam.lookAt(x, z);
    });
    this.mini.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const [x, z] = toWorld(e);
      this.game.cam.lookAt(x, z);
    });
    const end = () => (dragging = false);
    this.mini.addEventListener('pointerup', end);
    this.mini.addEventListener('pointercancel', end);
  }
}

/** 頂列的特殊勝利倒數文字（奇觀、玉璽） */
function victoryTimer(sim: Game['sim']): string {
  const ab = sim.abilities;
  let best = Infinity;
  let who = -1;
  let kind = '';
  for (const [b, t0] of ab.wonders) {
    if (!sim.buildings.alive[b]) continue;
    const left = 3000 - (sim.tick - t0);
    if (left < best) {
      best = left;
      who = sim.buildings.owner[b];
      kind = WONDER_NAMES[sim.players[sim.buildings.owner[b]].faction] ?? '奇觀';
    }
  }
  if (sim.sealVictory) {
    for (const it of ab.items) {
      if (it.kind !== 'seal' || it.academy < 0 || !sim.buildings.alive[it.academy]) continue;
      const left = 3000 - (sim.tick - it.since);
      if (left < best) {
        best = left;
        who = sim.buildings.owner[it.academy];
        kind = '稱帝';
      }
    }
  }
  if (who < 0) return '';
  const sec = Math.max(0, Math.ceil(best / 10));
  return `${who === 0 ? '我方' : '敵方'}${kind} ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
