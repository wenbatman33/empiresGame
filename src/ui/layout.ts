// HUD 版面（docs/01 §8）：PC／Mobile／Tablet 分開設定，DEV 工具拖曳調整後匯出寫回這裡

export type Anchor = 'tl' | 'tc' | 'tr' | 'cl' | 'cr' | 'bl' | 'bc' | 'br';
export type HudKey = 'topbar' | 'minimap' | 'selection' | 'leftbar' | 'cards' | 'placebar';
export type LayoutMode = 'pc' | 'mobile' | 'tablet';

export interface HudBox {
  anchor: Anchor;
  /** 距離錨點的內縮距離（px，正值往畫面內） */
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  fontSize: number;
  color: string;
  bg: string;
  opacity: number;
  z: number;
  visible: boolean;
}

const box = (anchor: Anchor, x: number, y: number, w: number, h: number, fontSize: number, extra: Partial<HudBox> = {}): HudBox => ({
  anchor,
  x,
  y,
  w,
  h,
  scale: 1,
  fontSize,
  color: '#fff6e0',
  bg: '#2a1f16',
  opacity: 0.88,
  z: 10,
  visible: true,
  ...extra,
});

export const LAYOUT_PC: Record<HudKey, HudBox> = {
  topbar: box('tc', 0, 8, 760, 40, 17),
  minimap: box('bl', 12, 12, 220, 220, 12),
  selection: box('bc', -40, 12, 520, 104, 15),
  leftbar: box('cl', 10, 0, 52, 236, 13),
  cards: box('br', 12, 12, 340, 140, 12, { bg: '#2a1f16', opacity: 0 }),
  placebar: box('bc', 0, 128, 220, 50, 16, { opacity: 0 }),
};

export const LAYOUT_MOBILE: Record<HudKey, HudBox> = {
  topbar: box('tc', 0, 4, 480, 30, 13),
  minimap: box('bl', 8, 8, 120, 120, 10),
  selection: box('bc', -70, 6, 250, 62, 12),
  leftbar: box('cl', 6, 0, 46, 214, 11),
  cards: box('br', 8, 8, 236, 122, 10, { opacity: 0 }),
  placebar: box('bc', -70, 76, 200, 48, 15, { opacity: 0 }),
};

export const LAYOUT_TABLET: Record<HudKey, HudBox> = {
  topbar: box('tc', 0, 8, 680, 38, 16),
  minimap: box('bl', 12, 12, 190, 190, 12),
  selection: box('bc', -60, 10, 440, 92, 14),
  leftbar: box('cl', 10, 0, 56, 250, 13),
  cards: box('br', 12, 12, 320, 136, 12, { opacity: 0 }),
  placebar: box('bc', -60, 112, 220, 52, 16, { opacity: 0 }),
};

export const LAYOUTS: Record<LayoutMode, Record<HudKey, HudBox>> = {
  pc: LAYOUT_PC,
  mobile: LAYOUT_MOBILE,
  tablet: LAYOUT_TABLET,
};

export const HUD_KEYS: HudKey[] = ['topbar', 'minimap', 'selection', 'leftbar', 'cards', 'placebar'];
export const HUD_NAMES: Record<HudKey, string> = {
  topbar: '資源列',
  minimap: '小地圖',
  selection: '選取面板',
  leftbar: '左側按鈕',
  cards: '指令卡',
  placebar: '放置確認列',
};

/** 依裝置判斷版面：滑鼠且視窗夠寬 → PC；短邊 < 600 → 手機；其他 → 平板（窄的桌機視窗也套手機版面） */
export function detectLayout(): LayoutMode {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (!coarse && window.innerWidth >= 900 && window.innerHeight >= 560) return 'pc';
  return Math.min(window.innerWidth, window.innerHeight) < 600 ? 'mobile' : 'tablet';
}

/** 把版面套到元素上 */
export function applyBox(el: HTMLElement, b: HudBox): void {
  const st = el.style;
  st.display = b.visible ? '' : 'none';
  st.width = `${b.w}px`;
  st.height = `${b.h}px`;
  st.fontSize = `${b.fontSize}px`;
  st.color = b.color;
  st.setProperty('--hud-bg', hexA(b.bg, b.opacity));
  st.zIndex = String(b.z);
  st.left = st.right = st.top = st.bottom = '';
  const h = b.anchor[1];
  const v = b.anchor[0];
  const tx = h === 'c' ? '-50%' : '0';
  const ty = v === 'c' ? '-50%' : '0';
  if (h === 'l') st.left = `calc(${b.x}px + env(safe-area-inset-left))`;
  else if (h === 'r') st.right = `calc(${b.x}px + env(safe-area-inset-right))`;
  else st.left = `calc(50% + ${b.x}px)`;
  if (v === 't') st.top = `calc(${b.y}px + env(safe-area-inset-top))`;
  else if (v === 'b') st.bottom = `calc(${b.y}px + env(safe-area-inset-bottom))`;
  else st.top = `calc(50% + ${b.y}px)`;
  // 視窗比元件窄時自動縮小，避免超出畫面
  const fit = Math.min(1, (window.innerWidth - 12) / Math.max(1, b.w), (window.innerHeight - 12) / Math.max(1, b.h));
  st.transform = `translate(${tx}, ${ty}) scale(${b.scale * fit})`;
  st.transformOrigin = `${h === 'l' ? 'left' : h === 'r' ? 'right' : 'center'} ${v === 't' ? 'top' : v === 'b' ? 'bottom' : 'center'}`;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
