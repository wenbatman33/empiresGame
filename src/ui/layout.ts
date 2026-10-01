// HUD 版面（docs/01 §8）：PC／Mobile／Tablet 分開設定，DEV 工具拖曳調整後匯出寫回這裡

export type Anchor = 'tl' | 'tc' | 'tr' | 'cl' | 'cr' | 'bl' | 'bc' | 'br';
export type HudKey = 'topbar' | 'minimap' | 'selection' | 'leftbar';
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
  topbar: box('tc', 0, 8, 720, 40, 17),
  minimap: box('bl', 12, 12, 220, 220, 12),
  selection: box('bc', 0, 12, 560, 96, 15),
  leftbar: box('cl', 10, 0, 52, 236, 13),
};

export const LAYOUT_MOBILE: Record<HudKey, HudBox> = {
  topbar: box('tc', 0, 4, 470, 30, 13),
  minimap: box('bl', 8, 8, 120, 120, 10),
  selection: box('bc', 0, 6, 300, 58, 12),
  leftbar: box('cl', 6, 0, 46, 214, 11),
};

export const LAYOUT_TABLET: Record<HudKey, HudBox> = {
  topbar: box('tc', 0, 8, 640, 38, 16),
  minimap: box('bl', 12, 12, 190, 190, 12),
  selection: box('bc', 0, 10, 480, 86, 14),
  leftbar: box('cl', 10, 0, 56, 250, 13),
};

export const LAYOUTS: Record<LayoutMode, Record<HudKey, HudBox>> = {
  pc: LAYOUT_PC,
  mobile: LAYOUT_MOBILE,
  tablet: LAYOUT_TABLET,
};

export const HUD_KEYS: HudKey[] = ['topbar', 'minimap', 'selection', 'leftbar'];
export const HUD_NAMES: Record<HudKey, string> = {
  topbar: '資源列',
  minimap: '小地圖',
  selection: '選取面板',
  leftbar: '左側按鈕',
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
  st.transform = `translate(${tx}, ${ty}) scale(${b.scale})`;
  st.transformOrigin = `${h === 'l' ? 'left' : h === 'r' ? 'right' : 'center'} ${v === 't' ? 'top' : v === 'b' ? 'bottom' : 'center'}`;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
