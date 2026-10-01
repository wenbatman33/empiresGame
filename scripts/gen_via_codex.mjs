#!/usr/bin/env node
// 素材生圖（docs/07 §8.4）：逐項呼叫 codex exec 內建 image_gen，不需要 API key
// 用法：node scripts/gen_via_codex.mjs            # 全跑（已存在的跳過，可中斷續跑）
//       node scripts/gen_via_codex.mjs hero icon  # 只跑指定分類
//       node scripts/gen_via_codex.mjs --only logo menu_bg
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'scripts/asset_manifest.json'), 'utf-8'));
const LOG = path.join(ROOT, 'scripts/gen_via_codex.log');
const args = process.argv.slice(2);
const only = new Set();
const cats = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--only') while (args[i + 1] && !args[i + 1].startsWith('--')) only.add(args[++i]);
  else cats.add(args[i]);
}
const items = manifest.items.filter((it) => (!only.size || only.has(it.id)) && (!cats.size || cats.has(it.cat)));
// codex 的 image_gen 會把圖存在 ~/.codex/generated_images/<session>/；沙盒可能不讓它寫進專案，所以由這支腳本自己去撿
const GEN_DIR = path.join(os.homedir(), '.codex/generated_images');
function newestImageSince(t0) {
  let best = null;
  let bestT = t0;
  if (!existsSync(GEN_DIR)) return null;
  for (const d of readdirSync(GEN_DIR)) {
    const dir = path.join(GEN_DIR, d);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory() || st.mtimeMs < t0) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.png')) continue;
      const fp = path.join(dir, f);
      const m = statSync(fp).mtimeMs;
      if (m >= bestT) {
        bestT = m;
        best = fp;
      }
    }
  }
  return best;
}

const log = (m) => {
  console.log(m);
  appendFileSync(LOG, m + '\n');
};
log(`\n=== ${new Date().toISOString()} ${items.length} 項 ===`);
let ok = 0;
let fail = 0;
for (const [k, it] of items.entries()) {
  const dir = path.join(ROOT, 'public/assets', it.cat);
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${it.id}.png`);
  // 已產生過（含已瘦身成 JPEG、或原圖已備份到 art/originals）就跳過
  if (existsSync(out) || existsSync(out.replace(/\.png$/, '.jpg')) || existsSync(path.join(ROOT, 'art/originals', it.cat, `${it.id}.png`))) {
    log(`⏭ [${k + 1}/${items.length}] ${it.id}（已存在）`);
    continue;
  }
  const [fw, fh] = it.final.split('x');
  const bg = it.alpha ? '透明背景（純色背景生成後去背，輸出 RGBA PNG），單一主體置中、無多餘文字、無邊框陰影' : '滿版畫面、不要文字';
  const prompt = `請用內建 image_gen 工具產一張 ${it.size} PNG。\n\n主題：${it.prompt}。\n\n風格：${manifest.style}。${bg}。\n\n完成後把產出複製到絕對路徑 ${out}，並用 sips 縮放到 ${fw}x${fh}（sips -z ${fh} ${fw}）。回報 OK 即可。`;
  const t0 = Date.now();
  log(`▶ [${k + 1}/${items.length}] ${it.id}`);
  try {
    execFileSync('codex', ['exec', '--skip-git-repo-check', prompt], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 420_000 });
  } catch (e) {
    log(`  ✗ ${String(e.message).slice(0, 120)}`);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  if (!existsSync(out)) {
    const img = newestImageSince(t0);
    if (img) {
      copyFileSync(img, out);
      try {
        execFileSync('sips', ['-z', fh, fw, out], { stdio: 'ignore' });
      } catch {
        /* 縮放失敗就保留原尺寸 */
      }
    }
  }
  if (existsSync(out)) {
    ok++;
    log(`  ✓ ${it.id} ${dt}s`);
  } else {
    fail++;
    log(`  ✗ ${it.id} ${dt}s（沒有產出檔案）`);
  }
}
log(`=== 完成：成功 ${ok}、失敗 ${fail} ===`);
