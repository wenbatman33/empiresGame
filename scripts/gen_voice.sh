#!/bin/bash
# 單位語音（docs/07 §8.2 佔位版）：macOS `say` 台灣中文語音 → AAC (.m4a)
# 用法：bash scripts/gen_voice.sh（已存在的檔案會跳過）
set -e
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/assets/voice"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
gen() { # id 聲音 語速 台詞
  local id="$1" voice="$2" rate="$3" text="$4"
  [ -f "$OUT/$id.m4a" ] && return
  say -v "$voice" -r "$rate" -o "$TMP/$id.aiff" "$text"
  afconvert -f m4af -d aac -b 48000 "$TMP/$id.aiff" "$OUT/$id.m4a"
  echo "✓ $id"
}
# 士兵：選取
gen sel_soldier_1 Rocko 200 "在！"
gen sel_soldier_2 Eddy 190 "末將在此！"
gen sel_soldier_3 Reed 190 "請下令！"
# 士兵：移動、攻擊
gen cmd_soldier_1 Rocko 210 "遵命！"
gen cmd_soldier_2 Eddy 210 "得令！"
gen cmd_soldier_3 Reed 200 "是！"
gen atk_soldier_1 Rocko 220 "殺！"
gen atk_soldier_2 Eddy 220 "衝啊！"
gen atk_soldier_3 Reed 210 "跟我上！"
# 民夫
gen sel_villager_1 Meijia 190 "要做什麼呢？"
gen sel_villager_2 Flo 190 "在這裡！"
gen cmd_villager_1 Meijia 200 "好的！"
gen cmd_villager_2 Flo 200 "這就去！"
# 武將
gen sel_hero_1 Reed 170 "誰敢與我一戰！"
gen sel_hero_2 Rocko 170 "大丈夫當建功立業！"
gen cmd_hero_1 Reed 190 "看我的！"
# 軍師提示
gen adv_house Grandpa 175 "主公，民居不足，請速建民居。"
gen adv_idle Grandpa 175 "主公，有民夫閒置。"
gen adv_attack Grandpa 180 "主公，我軍遭到攻擊！"
gen adv_age Grandpa 175 "主公，資源已足，可以升時代了。"
gen adv_army Grandpa 175 "主公，敵軍將至，宜早練兵。"
gen adv_seal Grandpa 175 "主公，傳國玉璽就在地圖中央，派謀士取之。"
gen adv_enemy_seal Grandpa 180 "主公，敵方得了玉璽！務必攻破其書院。"
gen adv_wonder Grandpa 175 "主公，敵方正在建造奇觀！"
rm -rf "$TMP"
