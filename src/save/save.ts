// 存檔（docs/07 §10）：存「開局設定 ＋ 指令紀錄」，讀檔時重播；模擬是確定性的，所以結果完全一樣
import type { Command } from '../sim/core/commands';
import type { GameSetup } from '../ui/menus';

export interface SaveData {
  v: 1;
  setup: GameSetup;
  tick: number;
  history: Command[];
  savedAt: string;
}

export const SAVE_KEY = 'empiresGame.save';
export const AUTO_KEY = 'empiresGame.autosave';

export function writeSave(key: string, data: SaveData): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave(key: string): SaveData | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d.v === 1 && Array.isArray(d.history) ? d : null;
  } catch {
    return null;
  }
}

/** 取最新的存檔（手動或自動） */
export function latestSave(): { key: string; data: SaveData } | null {
  const a = readSave(SAVE_KEY);
  const b = readSave(AUTO_KEY);
  if (a && b) return a.savedAt >= b.savedAt ? { key: SAVE_KEY, data: a } : { key: AUTO_KEY, data: b };
  if (a) return { key: SAVE_KEY, data: a };
  if (b) return { key: AUTO_KEY, data: b };
  return null;
}
