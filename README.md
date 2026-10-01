# 三國霸業（empiresGame）

三國題材的 Q 版 3D 即時戰略，玩法參考世紀帝國：採集、建造、升時代、兵種相剋，再加上武將技與計策。PC 和手機瀏覽器都能玩。

規劃文件放在 [`docs/`](docs/00-專案總覽.md)。

**線上試玩**（M0 完成後開放）：https://wenbatman33.github.io/empiresGame/（網址加 `?dev=1` 開啟 DEV 微調工具）

## 目前進度

- [x] 規劃書 `docs/00–09`
- [x] M0 技術驗證：地形、RTS 鏡頭、確定性模擬、VAT 兵種、選取移動尋路、DEV 工具（實機 fps 待上線後實測）
- [x] M1 經濟核心：採集四資源、建造放置、人口、生產佇列、集結點、自動回倉、農田重播、經濟機器人
- [x] M2 軍事核心：戰鬥與相剋、騎兵、攻擊移動／巡邏／姿態／陣型、箭塔與牆、血條、戰爭迷霧
- [x] M3 第一個可玩版本：主選單與開局設定、四時代與外觀演進、36 項科技、攻城器械、對戰 AI（簡單／普通／困難）、勝負與結算、存讀檔、音效（AI 節奏仍偏慢，見 docs/09）
- [x] M4 三國特色：魏蜀吳勢力被動與特殊兵種、13 名武將（主動技 ＋ 橫幅演出 ＋ 被動）、謀士勸降治療、兵書與玉璽稱帝、7 種計策、關隘、書院、市集、城門、奇觀、水軍 6 種船、長江／蜀道／赤壁地圖、瘋狂 AI、民夫分配助手
- [ ] M5 美術與音效打磨
- [ ] M6 戰役
- [ ] M7 多人連線與上架

## 開發

```bash
npm install
npm run dev      # http://localhost:5190
npm test         # 確定性與尋路測試
npm run build    # 模擬層檢查 ＋ 型別檢查 ＋ 建置
GAMES=30 npm run ai-arena   # 無頭 AI 對戰統計（勝率、對局時間、升時代時間）
GAMES=8 MT=chibi PAIRS=normal-normal npm run ai-arena   # 指定地圖類型（central／yangtze／shudao／chibi）
GAMES=20 FAC=wei-shu,wei-wu,shu-wu npm run ai-arena    # 勢力平衡（普通對普通、輪流換邊）
```

## 技術

Three.js ＋ Vite ＋ TypeScript；模擬層採確定性設計（固定 tick、定點數、種子亂數），之後可以直接加上 lockstep 多人連線。詳見 [`docs/07-技術架構與美術管線.md`](docs/07-技術架構與美術管線.md)。
