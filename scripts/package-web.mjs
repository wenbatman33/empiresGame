#!/usr/bin/env node
// 上架打包（docs/08 §4）：建置後把 dist/ 壓成 zip，直接上傳 itch.io（HTML 遊戲）或任何靜態主機
// 用法：npm run package（輸出到 release/empiresGame-web-<版本>.zip）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
const out = path.join(ROOT, 'release');
mkdirSync(out, { recursive: true });
const zip = path.join(out, `empiresGame-web-${pkg.version}.zip`);
// 只覆蓋同版本的舊壓縮檔
if (existsSync(zip)) rmSync(zip);
execFileSync('zip', ['-qr', zip, '.'], { cwd: path.join(ROOT, 'dist') });
console.log(`✓ ${path.relative(ROOT, zip)}（${(statSync(zip).size / 1024 / 1024).toFixed(2)} MB）`);
console.log('itch.io：建立 HTML 專案 → 上傳這個 zip → 勾選「This file will be played in the browser」，建議視窗 1280×720、勾選全螢幕按鈕。');
