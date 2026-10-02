#!/bin/bash
# 單位語音（docs/07 §8.2 佔位版）：macOS `say` → ffmpeg 調音高 → AAC (.m4a)
# 注意：macOS 的 Eloquence 系列聲音（Grandpa、Rocko、Eddy…）用 -o 輸出成檔案會是空的，
#       只有美佳（Meijia）能正常輸出，所以一律用美佳，男聲靠 ffmpeg 降音高（保持語速）
# 用法：bash scripts/gen_voice.sh [--force]（不加 --force 時，已存在的檔案會跳過）
set -e
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/assets/voice"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
FORCE=0
[ "$1" = "--force" ] && FORCE=1
gen() { # id 音高倍率（<1 越低沉） 語速 台詞
  local id="$1" pitch="$2" rate="$3" text="$4"
  [ -f "$OUT/$id.m4a" ] && [ $FORCE = 0 ] && return
  say -v Meijia -r "$rate" -o "$TMP/$id.aiff" "$text"
  # 降音高但不改速度：先改取樣率（音高與速度一起變），再用 atempo 把速度拉回來
  ffmpeg -loglevel error -y -i "$TMP/$id.aiff" -af "asetrate=22050*${pitch},aresample=22050,atempo=$(echo "1/${pitch}" | bc -l | cut -c1-6),volume=1.4" -c:a aac -b:a 48k "$OUT/$id.m4a"
  echo "✓ $id"
}
# 士兵：選取（低沉男聲）
gen sel_soldier_1 0.68 200 "在！"
gen sel_soldier_2 0.72 190 "末將在此！"
gen sel_soldier_3 0.70 190 "請下令！"
# 士兵：移動、攻擊
gen cmd_soldier_1 0.68 210 "遵命！"
gen cmd_soldier_2 0.72 210 "得令！"
gen cmd_soldier_3 0.70 200 "是！"
gen atk_soldier_1 0.68 220 "殺！"
gen atk_soldier_2 0.72 220 "衝啊！"
gen atk_soldier_3 0.70 210 "跟我上！"
# 民夫（原聲）
gen sel_villager_1 1.0 190 "要做什麼呢？"
gen sel_villager_2 1.05 190 "在這裡！"
gen cmd_villager_1 1.0 200 "好的！"
gen cmd_villager_2 1.05 200 "這就去！"
# 武將（更低沉）
gen sel_hero_1 0.64 170 "誰敢與我一戰！"
gen sel_hero_2 0.66 170 "大丈夫當建功立業！"
gen cmd_hero_1 0.64 190 "看我的！"
# 軍師（沉穩男聲）
gen adv_house 0.78 175 "主公，民居不足，請速建民居。"
gen adv_idle 0.78 175 "主公，有民夫閒置。"
gen adv_attack 0.78 185 "主公，我軍遭到攻擊！"
gen adv_age 0.78 175 "主公，資源已足，可以升時代了。"
gen adv_army 0.78 175 "主公，敵軍將至，宜早練兵。"
gen adv_seal 0.78 175 "主公，傳國玉璽就在地圖中央，派人取來、送回太守府。"
gen adv_enemy_seal 0.78 185 "主公，敵方得了玉璽！務必攻破收藏它的建築。"
gen adv_wonder 0.78 175 "主公，敵方正在建造奇觀！"
rm -f "$TMP"/*.aiff
rmdir "$TMP"
