// 可用 DEV 工具即時調整的設定；調好後由 DEV 匯出 JSON，鎖定時寫回這裡

export type Quality = 'low' | 'medium' | 'high';

/** 鏡頭（docs/01 §7） */
export const CAMERA = {
  pitch: 55,
  fov: 40,
  minDist: 12,
  maxDist: 70,
  startDistPc: 34,
  startDistMobile: 22,
  /** 平移速度（每秒畫面高度的比例） */
  panSpeed: 1.1,
  edgeScroll: true,
  edgePx: 10,
  rotate: true,
  rotateLimit: 45,
};

/** 光影 */
export const LIGHT = {
  sunAzimuth: 145,
  sunElevation: 52,
  sunIntensity: 2.4,
  sunColor: '#fff1d6',
  hemiIntensity: 1.25,
  skyColor: '#d4e9ff',
  groundColor: '#7a6a48',
  fogColor: '#c9dcea',
  fogNear: 70,
  fogFar: 170,
  exposure: 1.0,
};

/** 畫質分級（docs/07 §5） */
export const QUALITY_PRESETS: Record<Quality, { dpr: number; shadows: boolean; shadowMap: number; antialias: boolean }> = {
  low: { dpr: 1, shadows: false, shadowMap: 512, antialias: false },
  medium: { dpr: 1.5, shadows: true, shadowMap: 1024, antialias: false },
  high: { dpr: 2, shadows: true, shadowMap: 2048, antialias: true },
};

/** 單位外觀 */
export const UNIT_LOOK = {
  scale: 1.15,
  turnSpeed: 9,
};

/** 玩家隊伍色（docs/02 §1：多人時 8 色，M0 先用 4 色） */
export const PLAYER_COLORS = ['#2f6fdb', '#d63a3a', '#2e9b57', '#d9a520'];
export const PLAYER_NAMES = ['我軍', '敵軍', '友軍', '中立'];
