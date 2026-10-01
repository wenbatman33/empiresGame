#!/usr/bin/env node
// 素材瘦身（docs/07 §6：首次載入 ≤ 5 MB）：
// 原圖先備份到 art/originals/（不進 git、不會刪），再把 public/assets/ 換成縮小 ＋ 壓縮過的版本
// 背景圖 → JPEG；有透明的圖 → 縮小後 pngquant
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'scripts/asset_manifest.json'), 'utf-8'));
/** 遊戲裡實際用的尺寸 */
const SHIP = { ui: 0, faction: 256, hero: 256, icon: 128 };
const width = (f) => Number(/pixelWidth: (\d+)/.exec(execFileSync('sips', ['-g', 'pixelWidth', f]).toString())?.[1] ?? 0);
let n = 0;
for (const it of manifest.items) {
  const src = path.join(ROOT, 'public/assets', it.cat, `${it.id}.png`);
  const orig = path.join(ROOT, 'art/originals', it.cat, `${it.id}.png`);
  if (existsSync(src) && !existsSync(orig)) {
    mkdirSync(path.dirname(orig), { recursive: true });
    copyFileSync(src, orig);
  }
  if (!existsSync(orig)) continue;
  // 概念圖只給建模參考，不放進遊戲
  if (it.cat === 'concept') {
    if (existsSync(src)) rmSync(src);
    continue;
  }
  // App 圖示：輸出 512、192 兩種 PNG
  if (it.id === 'app_icon') {
    for (const px of [512, 192]) {
      const out = path.join(ROOT, 'public/assets/ui', `icon-${px}.png`);
      if (existsSync(out)) continue;
      copyFileSync(orig, out);
      execFileSync('sips', ['-z', String(px), String(px), out], { stdio: 'ignore' });
      try {
        execFileSync('pngquant', ['--force', '--skip-if-larger', '--quality', '70-90', '--output', out, out], { stdio: 'ignore' });
      } catch {
        /* 保留 */
      }
    }
    if (existsSync(src)) rmSync(src);
    n++;
    continue;
  }
  if (!it.alpha) {
    // 背景：JPEG 品質 72
    const out = path.join(ROOT, 'public/assets', it.cat, `${it.id}.jpg`);
    if (existsSync(out)) continue;
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', orig, '--out', out], { stdio: 'ignore' });
    // 原圖已備份，public 裡的大 PNG 換成 JPEG
    if (existsSync(src)) rmSync(src);
  } else {
    const px = SHIP[it.cat] ?? 0;
    // 已經縮到目標寬度就跳過
    if (existsSync(src) && width(src) <= (px || 1024) && statSync(src).size < 400_000) continue;
    copyFileSync(orig, src);
    if (px) execFileSync('sips', ['-Z', String(px), src], { stdio: 'ignore' });
    else execFileSync('sips', ['-Z', '1024', src], { stdio: 'ignore' });
    try {
      execFileSync('pngquant', ['--force', '--skip-if-larger', '--quality', '60-85', '--output', src, src], { stdio: 'ignore' });
    } catch {
      /* 壓不下去就保留縮小後的 PNG */
    }
  }
  n++;
}
console.log(`處理 ${n} 張`);
