// 模擬層確定性檢查（docs/07 §3）：src/sim/ 不得使用會讓各裝置結果不同的 API
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src/sim/', import.meta.url).pathname;
const RULES = [
  [/\bMath\.(random|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt)\b/, '禁用不確定的 Math 函式，改用整數查表或 fixed.ts'],
  [/\*\*/, '禁用 ** 次方運算，改用乘法'],
  [/\b(Date\.now|new Date|performance\.now)\b/, '禁用真實時間，模擬層只能用 tick'],
  [/from\s+['"](three|three\/.*)['"]/, '模擬層不得 import three'],
  [/from\s+['"]\.\.\/\.\.\/(render|ui|input|dev)\//, '模擬層不得 import 渲染、UI、輸入、DEV'],
  [/\b(window|document|localStorage)\./, '模擬層不得使用 DOM'],
];

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
})(ROOT);

let bad = 0;
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    // 去掉註解（// 行尾註解、/* */ 區塊註解與 JSDoc 的 * 開頭行）
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('/*')) return;
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '');
    for (const [re, msg] of RULES) {
      if (re.test(code)) { console.error(`✗ ${f.replace(ROOT, 'src/sim/')}:${i + 1}  ${msg}\n    ${line.trim()}`); bad++; }
    }
  });
}
if (bad) { console.error(`\n模擬層確定性檢查失敗：${bad} 處`); process.exit(1); }
console.log(`✓ 模擬層確定性檢查通過（${files.length} 個檔案）`);
