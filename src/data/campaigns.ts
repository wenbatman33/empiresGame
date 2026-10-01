// 戰役劇本（docs/08 §1）：第一章黃巾之亂（教學）、第三章赤壁之戰
// 位置用錨點：A ＝ 玩家出生點、B ＝ 敵方出生點、C ＝ 地圖中心（地圖由種子產生，錨點附近會先清空）
import type { Scenario } from '../sim/systems/scenario';

const YELLOW = { name: '黃巾軍', faction: 'wei', ai: null } as const;
const CAO = { name: '曹軍', faction: 'wei', ai: null } as const;
const YUAN = { name: '袁紹軍', faction: 'shu', ai: null } as const;
const LIUBEI = { name: '蜀軍', faction: 'shu', ai: null } as const;

/** 共用：倒數計時器（某觸發器發動後，每秒 ＋1） */
function countdown(id: string, after: string): Scenario['triggers'][number] {
  return { id, when: [{ t: 'fired', id: after }], then: [{ t: 'setVar', name: id, add: 1 }], every: 1 };
}

export const CHAPTERS = [
  { id: 1, title: '第一章 黃巾之亂', side: '蜀', desc: '劉關張桃園結義，討伐黃巾。從這裡學會所有基本操作。' },
  { id: 2, title: '第二章 官渡之戰', side: '魏', desc: '曹操以寡擊眾，奇襲烏巢斷袁紹糧草。' },
  { id: 3, title: '第三章 赤壁之戰', side: '吳蜀聯軍', desc: '孫劉聯手，借東風、火燒赤壁，以少勝多。' },
  { id: 4, title: '第四章 夷陵之戰', side: '吳', desc: '陸遜堅守待機，一把火燒盡劉備連營七百里。' },
];

export const SCENARIOS: Scenario[] = [
  // ───────── 1-1 桃園結義：移動、選取、採集、蓋民居 ─────────
  {
    id: '1-1',
    chapter: 1,
    title: '桃園結義',
    subtitle: '教學：移動、採集、建造',
    brief: '黃巾四起，劉備在涿郡招兵買馬。先學會指揮部下：移動、採集糧食與木材、蓋民居。',
    map: { type: 'central', size: 96, seed: 101 },
    players: [
      { name: '劉備軍', faction: 'shu', res: [50, 60, 0, 0] },
      { ...YELLOW },
    ],
    clear: [{ at: ['A', 0, 0], r: 7 }],
    place: [
      { player: 0, building: 'town_hall', at: ['A', 0, 0] },
      { player: 0, unit: 'hero_liubei', at: ['A', 3, 4], tag: 'liubei' },
      { player: 0, unit: 'villager', at: ['A', -3, 4], n: 3 },
    ],
    objectives: [
      { id: 'move', text: '選取劉備，移動到發光的旗幟處', primary: true },
      { id: 'gather', text: '採集 200 糧、100 木', primary: true, hidden: true },
      { id: 'house', text: '用民夫蓋一間民居', primary: true, hidden: true },
      { id: 'bonus', text: '（次要）在太守府訓練 2 名民夫', hidden: true },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '劉備', face: 'hero_liubei', text: '黃巾賊四處作亂，百姓流離失所。我劉備雖是一介布衣，也要為天下盡一份心力！' },
            { who: '旁白', text: '【操作】點一下劉備選取他（PC 也可以拖曳框選），再點地面上發光的旗幟，就能移動過去。' },
          ] },
          { t: 'beacon', id: 'flag', at: ['A', 8, 8], on: true },
          { t: 'camera', at: ['A', 4, 4] },
        ],
      },
      {
        id: 'moved',
        when: [{ t: 'inArea', player: 0, unit: 'hero_liubei', area: { at: ['A', 8, 8], r: 2 } }],
        then: [
          { t: 'objective', id: 'move', state: 'done' },
          { t: 'beacon', id: 'flag', at: ['A', 8, 8], on: false },
          { t: 'dialog', lines: [
            { who: '劉備', face: 'hero_liubei', text: '很好。要招兵買馬，先得有糧草。' },
            { who: '旁白', text: '【採集】選取民夫，點野果叢採糧、點樹木伐木。民夫會自己把資源搬回太守府。' },
          ] },
          { t: 'objective', id: 'gather', state: 'show' },
          { t: 'objective', id: 'house', state: 'show' },
          { t: 'objective', id: 'bonus', state: 'show' },
        ],
      },
      {
        id: 'houseHint',
        when: [{ t: 'fired', id: 'moved' }, { t: 'time', sec: 50 }],
        then: [{ t: 'hint', text: '【建造】選民夫 → 指令卡「民居」→ 點地面放下。民居增加人口上限。' }],
      },
      { id: 'house', when: [{ t: 'buildings', player: 0, building: 'house', op: '>=', n: 1 }], then: [{ t: 'objective', id: 'house', state: 'done' }] },
      { id: 'gather', when: [{ t: 'gathered', player: 0, res: [200, 100, 0, 0] }], then: [{ t: 'objective', id: 'gather', state: 'done' }] },
      { id: 'bonus', when: [{ t: 'trained', player: 0, unit: 'villager', n: 2 }], then: [{ t: 'objective', id: 'bonus', state: 'done' }] },
      {
        id: 'oath',
        when: [{ t: 'fired', id: 'house' }, { t: 'fired', id: 'gather' }],
        then: [
          { t: 'spawn', player: 0, unit: 'hero_guanyu', at: ['A', 6, 2] },
          { t: 'spawn', player: 0, unit: 'hero_zhangfei', at: ['A', 6, 4] },
          { t: 'dialog', lines: [
            { who: '關羽', face: 'hero_guanyu', text: '在下關羽，字雲長。聽聞玄德公招募義勇，特來相投！' },
            { who: '張飛', face: 'hero_zhangfei', text: '俺張飛也來！咱們三人就在這桃園結為兄弟，同心協力、救困扶危！' },
            { who: '劉備', face: 'hero_liubei', text: '不求同年同月同日生，但願同年同月同日死！' },
          ] },
        ],
      },
      countdown('endTimer', 'oath'),
      { id: 'win', when: [{ t: 'var', name: 'endTimer', op: '>=', n: 5 }], then: [{ t: 'win' }] },
    ],
    stars: { time: 480, bonus: 'bonus' },
  },

  // ───────── 1-2 招募鄉勇：經濟循環、兵營、刀盾兵、防守 ─────────
  {
    id: '1-2',
    chapter: 1,
    title: '招募鄉勇',
    subtitle: '教學：生產與防守',
    brief: '黃巾小隊即將來襲。擴充經濟、蓋兵營、訓練刀盾兵，擊退三波敵軍。',
    map: { type: 'central', size: 96, seed: 102 },
    players: [
      { name: '劉備軍', faction: 'shu', res: [300, 300, 100, 0] },
      { ...YELLOW },
    ],
    clear: [{ at: ['A', 0, 0], r: 8 }],
    place: [
      { player: 0, building: 'town_hall', at: ['A', 0, 0], tag: 'th' },
      { player: 0, building: 'house', at: ['A', -4, 4] },
      { player: 0, unit: 'hero_liubei', at: ['A', 4, 4] },
      { player: 0, unit: 'villager', at: ['A', -2, 4], n: 6 },
    ],
    objectives: [
      { id: 'barracks', text: '蓋一座兵營', primary: true },
      { id: 'train', text: '訓練 5 名刀盾兵', primary: true },
      { id: 'waves', text: '擊退 3 波黃巾軍', primary: true },
      { id: 'keep', text: '（次要）太守府不被摧毀' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '劉備', face: 'hero_liubei', text: '探子回報，黃巾賊三日內必來劫掠。我們得盡快招募鄉勇。' },
            { who: '旁白', text: '【生產】選太守府可以訓練民夫；「＋糧／＋木」按鈕能快速分配民夫。蓋好兵營後，選兵營訓練刀盾兵。' },
          ] },
        ],
      },
      { id: 'barracks', when: [{ t: 'buildings', player: 0, building: 'barracks', op: '>=', n: 1 }], then: [{ t: 'objective', id: 'barracks', state: 'done' }, { t: 'hint', text: '兵營蓋好了！選取兵營 → 訓練「刀盾兵」。' }] },
      { id: 'train', when: [{ t: 'trained', player: 0, unit: 'swordsman', n: 5 }], then: [{ t: 'objective', id: 'train', state: 'done' }] },
      {
        id: 'w1',
        when: [{ t: 'time', sec: 180 }],
        then: [
          { t: 'dialog', lines: [{ who: '旁白', text: '第一波黃巾軍來了！選取軍隊，右鍵（手機點）敵人即可攻擊。' }] },
          { t: 'spawn', player: 1, unit: 'swordsman', at: ['B', 0, 0], n: 4, tag: 'wave', attack: ['A', 0, 0] },
          { t: 'spawn', player: 1, unit: 'spearman', at: ['B', 0, 0], n: 2, tag: 'wave', attack: ['A', 0, 0] },
        ],
      },
      {
        id: 'w2',
        when: [{ t: 'time', sec: 330 }],
        then: [
          { t: 'hint', text: '第二波黃巾軍逼近！' },
          { t: 'spawn', player: 1, unit: 'swordsman', at: ['B', 0, 0], n: 6, tag: 'wave', attack: ['A', 0, 0] },
          { t: 'spawn', player: 1, unit: 'archer', at: ['B', 0, 0], n: 4, tag: 'wave', attack: ['A', 0, 0] },
        ],
      },
      {
        id: 'w3',
        when: [{ t: 'time', sec: 480 }],
        then: [
          { t: 'dialog', lines: [{ who: '劉備', face: 'hero_liubei', text: '黃巾主力來了！兄弟們，守住涿郡！' }] },
          { t: 'spawn', player: 1, unit: 'swordsman', at: ['B', 0, 0], n: 8, tag: 'wave', attack: ['A', 0, 0] },
          { t: 'spawn', player: 1, unit: 'spearman', at: ['B', 0, 0], n: 4, tag: 'wave', attack: ['A', 0, 0] },
          { t: 'spawn', player: 1, unit: 'light_cav', at: ['B', 0, 0], n: 2, tag: 'wave', attack: ['A', 0, 0] },
        ],
      },
      { id: 'lostTh', when: [{ t: 'dead', tag: 'th' }], then: [{ t: 'objective', id: 'keep', state: 'failed' }] },
      { id: 'cleared', when: [{ t: 'fired', id: 'w3' }, { t: 'units', player: 1, op: '<=', n: 0 }], then: [{ t: 'objective', id: 'waves', state: 'done' }] },
      { id: 'keep', when: [{ t: 'fired', id: 'cleared' }, { t: 'buildings', player: 0, building: 'town_hall', op: '>=', n: 1 }], then: [{ t: 'objective', id: 'keep', state: 'done' }] },
      { id: 'win', when: [{ t: 'fired', id: 'cleared' }, { t: 'fired', id: 'barracks' }], then: [{ t: 'win' }] },
    ],
    stars: { time: 720, bonus: 'keep' },
  },

  // ───────── 1-3 涿郡之戰：相剋、武將技 ─────────
  {
    id: '1-3',
    chapter: 1,
    title: '涿郡之戰',
    subtitle: '教學：兵種相剋與武將技',
    brief: '黃巾騎兵來勢洶洶。用槍戟兵擋騎兵、弓兵射步兵，關羽、張飛的武將技能扭轉戰局。保護劉備！',
    map: { type: 'central', size: 96, seed: 103 },
    players: [
      { name: '劉備軍', faction: 'shu', res: [200, 200, 100, 0], age: 3 },
      { ...YELLOW },
    ],
    clear: [{ at: ['A', 4, 4], r: 8 }],
    place: [
      { player: 0, unit: 'hero_liubei', at: ['A', 2, 2], tag: 'liubei' },
      { player: 0, unit: 'hero_guanyu', at: ['A', 5, 3] },
      { player: 0, unit: 'hero_zhangfei', at: ['A', 3, 5] },
      { player: 0, unit: 'spearman', at: ['A', 7, 6], n: 10 },
      { player: 0, unit: 'swordsman', at: ['A', 5, 8], n: 6 },
      { player: 0, unit: 'archer', at: ['A', 2, 7], n: 6 },
    ],
    objectives: [
      { id: 'kill', text: '擊敗黃巾軍（擊殺 40 名）', primary: true },
      { id: 'liubei', text: '劉備不能陣亡', primary: true },
      { id: 'skill', text: '（次要）讓關羽施放「青龍偃月斬」' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '張飛', face: 'hero_zhangfei', text: '大哥！黃巾賊騎著馬殺過來了！' },
            { who: '劉備', face: 'hero_liubei', text: '槍戟兵在前擋住騎兵，弓兵在後放箭！' },
            { who: '旁白', text: '【相剋】槍剋騎、騎剋弓、弓剋步、刀盾剋槍。【武將技】選取武將，按 Q 或點 ✨ 鈕施放；指定範圍的技能要再點一下地面。' },
          ] },
          { t: 'camera', at: ['A', 6, 6] },
        ],
      },
      {
        id: 'w1',
        when: [{ t: 'time', sec: 25 }],
        then: [
          { t: 'spawn', player: 1, unit: 'light_cav', at: ['C', 0, 0], n: 8, attack: ['A', 4, 4] },
          { t: 'spawn', player: 1, unit: 'swordsman', at: ['C', 0, 0], n: 6, attack: ['A', 4, 4] },
        ],
      },
      {
        id: 'w2',
        when: [{ t: 'time', sec: 110 }],
        then: [
          { t: 'hint', text: '黃巾弓兵來了：派騎兵或刀盾兵衝上去！' },
          { t: 'spawn', player: 1, unit: 'archer', at: ['C', 0, 0], n: 8, attack: ['A', 4, 4] },
          { t: 'spawn', player: 1, unit: 'spearman', at: ['C', 0, 0], n: 6, attack: ['A', 4, 4] },
        ],
      },
      {
        id: 'w3',
        when: [{ t: 'time', sec: 200 }],
        then: [
          { t: 'dialog', lines: [{ who: '關羽', face: 'hero_guanyu', text: '黃巾主力在此。大哥退後，看我青龍偃月刀！' }] },
          { t: 'spawn', player: 1, unit: 'light_cav', at: ['C', 0, 0], n: 8, attack: ['A', 4, 4] },
          { t: 'spawn', player: 1, unit: 'swordsman', at: ['C', 0, 0], n: 8, attack: ['A', 4, 4] },
          { t: 'spawn', player: 1, unit: 'archer', at: ['C', 0, 0], n: 6, attack: ['A', 4, 4] },
        ],
      },
      { id: 'skill', when: [{ t: 'skill', player: 0, hero: 'hero_guanyu' }], then: [{ t: 'objective', id: 'skill', state: 'done' }] },
      { id: 'lose', when: [{ t: 'dead', tag: 'liubei' }], then: [{ t: 'objective', id: 'liubei', state: 'failed' }, { t: 'lose' }] },
      { id: 'win', when: [{ t: 'kills', player: 0, n: 40 }], then: [{ t: 'objective', id: 'kill', state: 'done' }, { t: 'objective', id: 'liubei', state: 'done' }, { t: 'win' }] },
    ],
    stars: { time: 360, bonus: 'skill' },
  },

  // ───────── 1-4 廣宗決戰：升時代、攻城 ─────────
  {
    id: '1-4',
    chapter: 1,
    title: '廣宗決戰',
    subtitle: '教學：升時代與攻城',
    brief: '張角據守廣宗，城寨有箭塔與城牆。升到三分天下、蓋工坊造衝車，攻破張角的太守府。',
    map: { type: 'central', size: 96, seed: 104 },
    players: [
      { name: '劉備軍', faction: 'shu', res: [800, 800, 400, 200], age: 2 },
      { name: '張角', faction: 'wei', res: [600, 600, 300, 300], age: 2, ai: 'easy' },
    ],
    clear: [{ at: ['A', 0, 0], r: 8 }, { at: ['B', 0, 0], r: 9 }],
    place: [
      { player: 0, building: 'town_hall', at: ['A', 0, 0] },
      { player: 0, building: 'house', at: ['A', -5, 3] },
      { player: 0, building: 'house', at: ['A', -5, -2] },
      { player: 0, building: 'barracks', at: ['A', 5, -4] },
      { player: 0, building: 'blacksmith', at: ['A', 5, 4] },
      { player: 0, unit: 'villager', at: ['A', -2, 5], n: 14 },
      { player: 0, unit: 'hero_liubei', at: ['A', 6, 6] },
      { player: 0, unit: 'swordsman', at: ['A', 7, 7], n: 8 },
      { player: 1, building: 'town_hall', at: ['B', 0, 0], tag: 'zhangjiao' },
      { player: 1, building: 'house', at: ['B', 4, 4] },
      { player: 1, building: 'house', at: ['B', -4, 4] },
      { player: 1, building: 'barracks', at: ['B', 4, -4] },
      { player: 1, building: 'archery', at: ['B', -4, -4] },
      { player: 1, building: 'tower', at: ['B', -6, -6] },
      { player: 1, building: 'tower', at: ['B', -7, 0] },
      { player: 1, building: 'tower', at: ['B', 0, -7] },
      { player: 1, unit: 'villager', at: ['B', 2, 5], n: 10 },
      { player: 1, unit: 'spearman', at: ['B', -5, -2], n: 6 },
      { player: 1, unit: 'archer', at: ['B', -2, -5], n: 6 },
    ],
    objectives: [
      { id: 'zhangjiao', text: '摧毀張角的太守府', primary: true },
      { id: 'age3', text: '升到「三分天下」', primary: true },
      { id: 'ram', text: '（次要）造出衝車' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '劉備', face: 'hero_liubei', text: '張角躲在廣宗城寨裡，箭塔林立，強攻只會徒增傷亡。' },
            { who: '旁白', text: '【升時代】蓋好兩座本時代建築後，選太守府研究「三分天下」。之後蓋工坊造衝車——衝車專打建築，箭塔射不太動它。' },
          ] },
        ],
      },
      { id: 'age3', when: [{ t: 'age', player: 0, age: 3 }], then: [{ t: 'objective', id: 'age3', state: 'done' }, { t: 'hint', text: '升上三分天下！現在可以蓋工坊、造衝車了。' }] },
      { id: 'ram', when: [{ t: 'trained', player: 0, unit: 'ram', n: 1 }], then: [{ t: 'objective', id: 'ram', state: 'done' }] },
      { id: 'win', when: [{ t: 'dead', tag: 'zhangjiao' }], then: [
        { t: 'objective', id: 'zhangjiao', state: 'done' },
        { t: 'dialog', lines: [{ who: '劉備', face: 'hero_liubei', text: '黃巾之亂平定了。但天下，才剛要開始動盪……' }] },
        { t: 'win' },
      ] },
    ],
    stars: { time: 1500, bonus: 'ram' },
  },

  // ───────── 2-1 白馬之圍：限時斬將 ─────────
  {
    id: '2-1',
    chapter: 2,
    title: '白馬之圍',
    subtitle: '限時斬將',
    brief: '袁紹大將顏良圍攻白馬。暫屬曹營的關羽請戰——6 分鐘內衝破護衛、斬殺顏良（敵方鐵騎將領）。',
    map: { type: 'central', size: 96, seed: 201 },
    players: [
      { name: '曹軍', faction: 'wei', res: [200, 200, 100, 0], age: 3 },
      { ...YUAN },
    ],
    clear: [{ at: ['A', 3, 3], r: 6 }, { at: ['C', 4, 4], r: 6 }],
    place: [
      { player: 0, unit: 'hero_guanyu', at: ['A', 3, 3], tag: 'guanyu' },
      { player: 0, unit: 'hero_caocao', at: ['A', 1, 4] },
      { player: 0, unit: 'heavy_cav', at: ['A', 5, 5], n: 6 },
      { player: 0, unit: 'archer', at: ['A', 2, 7], n: 6 },
      { player: 1, unit: 'iron_cav', at: ['C', 6, 6], tag: 'yanliang' },
      { player: 1, unit: 'spearman', at: ['C', 4, 4], n: 8 },
      { player: 1, unit: 'archer', at: ['C', 7, 3], n: 6 },
      { player: 1, unit: 'swordsman', at: ['C', 3, 8], n: 6 },
    ],
    objectives: [
      { id: 'yan', text: '6 分鐘內斬殺顏良（敵方鐵騎將領）', primary: true },
      { id: 'guanyu', text: '關羽不能陣亡', primary: true },
      { id: 'bonus', text: '（次要）2 分鐘內斬殺顏良' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '曹操', face: 'hero_caocao', text: '顏良勇冠三軍，連斬我兩員大將……雲長，可有把握？' },
            { who: '關羽', face: 'hero_guanyu', text: '吾觀顏良，如插標賣首耳！' },
            { who: '旁白', text: '顏良在地圖中央，身邊有槍兵護衛。用弓兵與騎兵引開槍兵，關羽的「青龍偃月斬」能一次掃倒前方敵人。' },
          ] },
          { t: 'beacon', id: 'yan', at: ['C', 6, 6], on: true },
          { t: 'hold', tag: 'yanliang' },
        ],
      },
      { id: 'bonus', when: [{ t: 'dead', tag: 'yanliang' }, { t: 'units', player: 0, tag: 'guanyu', op: '>=', n: 1 }, { t: 'var', name: 'late', op: '<=', n: 0 }], then: [{ t: 'objective', id: 'bonus', state: 'done' }] },
      { id: 'late', when: [{ t: 'time', sec: 120 }], then: [{ t: 'setVar', name: 'late', value: 1 }] },
      { id: 'lose', when: [{ t: 'dead', tag: 'guanyu' }], then: [{ t: 'objective', id: 'guanyu', state: 'failed' }, { t: 'lose' }] },
      { id: 'timeout', when: [{ t: 'time', sec: 360 }, { t: 'units', player: 1, tag: 'yanliang', op: '>=', n: 1 }], then: [{ t: 'objective', id: 'yan', state: 'failed' }, { t: 'lose' }] },
      {
        id: 'win',
        when: [{ t: 'dead', tag: 'yanliang' }],
        then: [
          { t: 'objective', id: 'yan', state: 'done' },
          { t: 'objective', id: 'guanyu', state: 'done' },
          { t: 'beacon', id: 'yan', at: ['C', 6, 6], on: false },
          { t: 'dialog', lines: [{ who: '關羽', face: 'hero_guanyu', text: '顏良首級在此！此恩已報，關某告辭。' }] },
          { t: 'win' },
        ],
      },
    ],
    stars: { time: 240, bonus: 'bonus' },
  },

  // ───────── 2-2 延津誘敵：誘入伏擊圈 ─────────
  {
    id: '2-2',
    chapter: 2,
    title: '延津誘敵',
    subtitle: '誘敵與伏擊',
    brief: '文醜率騎兵追擊。曹操以輜重車為餌，把敵軍引進山谷伏擊圈，再四面殺出。',
    map: { type: 'central', size: 96, seed: 202 },
    players: [
      { name: '曹軍', faction: 'wei', res: [200, 200, 100, 0], age: 3 },
      { ...YUAN },
    ],
    clear: [{ at: ['A', 4, 4], r: 7 }, { at: ['A', 14, 14], r: 6 }],
    place: [
      { player: 0, unit: 'hero_caocao', at: ['A', 2, 2], tag: 'caocao' },
      { player: 0, unit: 'ox_cart', at: ['A', 16, 16], n: 4, tag: 'bait' },
      { player: 0, unit: 'swordsman', at: ['A', 3, 5], n: 4 },
      { player: 1, unit: 'light_cav', at: ['B', 0, 0], n: 10, tag: 'chasers' },
      { player: 1, unit: 'heavy_cav', at: ['B', 2, 2], n: 4, tag: 'chasers' },
      { player: 1, unit: 'archer', at: ['B', -2, 2], n: 6, tag: 'chasers' },
    ],
    objectives: [
      { id: 'lure', text: '把輜重車拉回伏擊圈（發光處），引敵軍進來', primary: true },
      { id: 'kill', text: '殲滅追兵（擊殺 18 名）', primary: true },
      { id: 'bonus', text: '（次要）至少保住 2 輛輜重車' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '曹操', face: 'hero_caocao', text: '文醜貪功，見了輜重必定搶奪。把車隊慢慢拉回營地，伏兵就藏在兩側。' },
            { who: '旁白', text: '選取遠方的輜重車（木牛流馬）往發光處移動。敵軍會追著車隊進入伏擊圈。' },
          ] },
          { t: 'beacon', id: 'ambush', at: ['A', 4, 4], on: true },
          { t: 'camera', at: ['A', 14, 14] },
        ],
      },
      // 追兵每 6 秒朝輜重車隊的位置追過去
      { id: 'chase', when: [{ t: 'time', sec: 20 }], then: [{ t: 'chase', player: 1, tag: 'chasers', target: 'bait' }], every: 6 },
      { id: 'baitLost', when: [{ t: 'dead', tag: 'bait' }, { t: 'units', player: 1, tag: 'chasers', op: '>=', n: 12 }], then: [{ t: 'objective', id: 'lure', state: 'failed' }, { t: 'lose', why: 'scenario' }] },
      {
        id: 'ambush',
        when: [{ t: 'inArea', player: 1, area: { at: ['A', 4, 4], r: 9 }, n: 6 }],
        then: [
          { t: 'objective', id: 'lure', state: 'done' },
          { t: 'beacon', id: 'ambush', at: ['A', 4, 4], on: false },
          { t: 'cutin', hero: 'hero_caocao', skill: '伏兵四起' },
          { t: 'spawn', player: 0, unit: 'heavy_cav', at: ['A', -2, 10], n: 6, attack: ['A', 4, 4] },
          { t: 'spawn', player: 0, unit: 'spearman', at: ['A', 10, -2], n: 8, attack: ['A', 4, 4] },
          { t: 'spawn', player: 0, unit: 'crossbowman', at: ['A', 0, 0], n: 6, attack: ['A', 4, 4] },
        ],
      },
      { id: 'lose', when: [{ t: 'dead', tag: 'caocao' }], then: [{ t: 'lose' }] },
      { id: 'bonus', when: [{ t: 'kills', player: 0, n: 18 }, { t: 'units', player: 0, tag: 'bait', op: '>=', n: 2 }], then: [{ t: 'objective', id: 'bonus', state: 'done' }] },
      { id: 'win', when: [{ t: 'kills', player: 0, n: 18 }], then: [{ t: 'objective', id: 'kill', state: 'done' }, { t: 'dialog', lines: [{ who: '曹操', face: 'hero_caocao', text: '文醜已誅，袁紹折了兩員大將！' }] }, { t: 'win' }] },
    ],
    stars: { time: 300, bonus: 'bonus' },
  },

  // ───────── 2-3 火燒烏巢：奇襲糧倉 ─────────
  {
    id: '2-3',
    chapter: 2,
    title: '火燒烏巢',
    subtitle: '奇襲',
    brief: '許攸來投，獻計夜襲烏巢。率輕騎燒掉袁軍 5 座糧倉——在援軍趕到前完成。',
    map: { type: 'central', size: 96, seed: 203 },
    players: [
      { name: '曹軍', faction: 'wei', res: [0, 0, 300, 0], age: 3 },
      { ...YUAN },
    ],
    clear: [{ at: ['A', 2, 2], r: 5 }, { at: ['B', 0, 0], r: 10 }],
    place: [
      { player: 0, unit: 'hero_caocao', at: ['A', 2, 2], tag: 'caocao' },
      { player: 0, unit: 'tiger_cav', at: ['A', 4, 4], n: 8 },
      { player: 0, unit: 'light_cav', at: ['A', 2, 5], n: 6 },
      { player: 1, building: 'granary', at: ['B', -5, -5], tag: 'grain' },
      { player: 1, building: 'granary', at: ['B', 0, -6], tag: 'grain' },
      { player: 1, building: 'granary', at: ['B', -6, 0], tag: 'grain' },
      { player: 1, building: 'granary', at: ['B', 4, 4], tag: 'grain' },
      { player: 1, building: 'granary', at: ['B', 0, 6], tag: 'grain' },
      { player: 1, building: 'tower', at: ['B', 0, 0] },
      { player: 1, unit: 'spearman', at: ['B', -3, -3], n: 5, tag: 'guard' },
      { player: 1, unit: 'archer', at: ['B', 2, 2], n: 5, tag: 'guard' },
    ],
    objectives: [
      { id: 'grain', text: '燒毀烏巢 5 座糧倉', primary: true },
      { id: 'caocao', text: '曹操不能陣亡', primary: true },
      { id: 'bonus', text: '（次要）在袁軍援軍抵達前（4 分鐘）完成' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '曹操', face: 'hero_caocao', text: '烏巢存著袁紹全軍的糧草。燒了它，袁軍不戰自潰！' },
            { who: '旁白', text: '虎豹騎脫戰後的第一擊傷害加倍——先拉開、再衝鋒。選騎兵點糧倉即可攻擊建築。' },
          ] },
          { t: 'hold', tag: 'guard' },
        ],
      },
      { id: 'relief', when: [{ t: 'time', sec: 240 }], then: [
        { t: 'hint', text: '袁紹援軍趕到了！' },
        { t: 'spawn', player: 1, unit: 'heavy_cav', at: ['C', 0, 0], n: 6, attack: ['B', 0, 0] },
        { t: 'spawn', player: 1, unit: 'spearman', at: ['C', 0, 0], n: 8, attack: ['B', 0, 0] },
      ] },
      { id: 'bonus', when: [{ t: 'dead', tag: 'grain' }, { t: 'var', name: 'late', op: '<=', n: 0 }], then: [{ t: 'objective', id: 'bonus', state: 'done' }] },
      { id: 'late', when: [{ t: 'time', sec: 240 }], then: [{ t: 'setVar', name: 'late', value: 1 }] },
      { id: 'lose', when: [{ t: 'dead', tag: 'caocao' }], then: [{ t: 'objective', id: 'caocao', state: 'failed' }, { t: 'lose' }] },
      { id: 'win', when: [{ t: 'dead', tag: 'grain' }], then: [{ t: 'objective', id: 'grain', state: 'done' }, { t: 'objective', id: 'caocao', state: 'done' }, { t: 'dialog', lines: [{ who: '曹操', face: 'hero_caocao', text: '烏巢火起，袁紹敗局已定！' }] }, { t: 'win' }] },
    ],
    stars: { time: 300, bonus: 'bonus' },
  },

  // ───────── 2-4 官渡決戰：斷糧後的總攻 ─────────
  {
    id: '2-4',
    chapter: 2,
    title: '官渡決戰',
    subtitle: '正面決戰',
    brief: '烏巢已燒，袁軍糧草日減（每 30 秒損失 150 糧）。整軍出擊，攻破袁紹大營。',
    map: { type: 'central', size: 96, seed: 204 },
    players: [
      { name: '曹軍', faction: 'wei', res: [1000, 1000, 600, 300], age: 3 },
      { name: '袁紹', faction: 'shu', res: [1500, 1200, 800, 400], age: 3, ai: 'normal' },
    ],
    clear: [{ at: ['A', 0, 0], r: 8 }, { at: ['B', 0, 0], r: 8 }],
    place: [
      { player: 0, building: 'town_hall', at: ['A', 0, 0] },
      { player: 0, building: 'house', at: ['A', -5, 3] },
      { player: 0, building: 'house', at: ['A', -5, -2] },
      { player: 0, building: 'barracks', at: ['A', 5, -4] },
      { player: 0, building: 'stable', at: ['A', 5, 4] },
      { player: 0, unit: 'villager', at: ['A', -2, 5], n: 18 },
      { player: 0, unit: 'hero_caocao', at: ['A', 7, 7], tag: 'caocao' },
      { player: 0, unit: 'heavy_cav', at: ['A', 8, 8], n: 6 },
      { player: 0, unit: 'crossbowman', at: ['A', 6, 9], n: 8 },
      { player: 1, building: 'town_hall', at: ['B', 0, 0], tag: 'yuan' },
      { player: 1, building: 'house', at: ['B', 4, 4] },
      { player: 1, building: 'house', at: ['B', -4, 4] },
      { player: 1, building: 'barracks', at: ['B', 4, -4] },
      { player: 1, building: 'archery', at: ['B', -4, -4] },
      { player: 1, unit: 'villager', at: ['B', 2, 5], n: 16 },
      { player: 1, unit: 'spearman', at: ['B', -6, -2], n: 8 },
      { player: 1, unit: 'archer', at: ['B', -2, -6], n: 8 },
    ],
    objectives: [
      { id: 'yuan', text: '攻破袁紹大營（太守府）', primary: true },
      { id: 'caocao', text: '曹操不能陣亡', primary: true },
      { id: 'bonus', text: '（次要）20 分鐘內攻破' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [{ t: 'dialog', lines: [{ who: '曹操', face: 'hero_caocao', text: '袁本初坐擁十萬大軍，如今糧草斷絕，軍心已散。諸將，隨我破敵！' }] }],
      },
      { id: 'starve', when: [{ t: 'time', sec: 30 }], then: [{ t: 'give', player: 1, res: [-150, 0, 0, 0] }], every: 30 },
      { id: 'lose', when: [{ t: 'dead', tag: 'caocao' }], then: [{ t: 'objective', id: 'caocao', state: 'failed' }, { t: 'lose' }] },
      { id: 'late', when: [{ t: 'time', sec: 1200 }], then: [{ t: 'setVar', name: 'late', value: 1 }] },
      { id: 'bonus', when: [{ t: 'dead', tag: 'yuan' }, { t: 'var', name: 'late', op: '<=', n: 0 }], then: [{ t: 'objective', id: 'bonus', state: 'done' }] },
      { id: 'win', when: [{ t: 'dead', tag: 'yuan' }], then: [{ t: 'objective', id: 'yuan', state: 'done' }, { t: 'objective', id: 'caocao', state: 'done' }, { t: 'dialog', lines: [{ who: '曹操', face: 'hero_caocao', text: '官渡一戰，北方大局已定！' }] }, { t: 'win' }] },
    ],
    stars: { time: 1200, bonus: 'bonus' },
  },

  // ───────── 3-1 舌戰群儒：護送諸葛亮、勸降 ─────────
  {
    id: '3-1',
    chapter: 3,
    title: '舌戰群儒',
    subtitle: '護送與勸降',
    brief: '諸葛亮要前往柴桑說服孫權聯合抗曹。一路上有曹軍斥候攔截——護送他平安抵達，並用謀士勸降敵兵。',
    map: { type: 'central', size: 96, seed: 301 },
    players: [
      { name: '孫劉聯軍', faction: 'shu', res: [200, 200, 200, 0], age: 3 },
      { ...CAO },
    ],
    clear: [{ at: ['A', 2, 2], r: 6 }, { at: ['B', 0, 0], r: 6 }],
    place: [
      { player: 0, unit: 'hero_zhuge', at: ['A', 2, 2], tag: 'zhuge' },
      { player: 0, unit: 'strategist', at: ['A', 0, 4], n: 3 },
      { player: 0, unit: 'swordsman', at: ['A', 4, 4], n: 6 },
      { player: 0, unit: 'archer', at: ['A', 2, 6], n: 4 },
      { player: 1, unit: 'swordsman', at: ['C', -6, -6], n: 5 },
      { player: 1, unit: 'archer', at: ['C', -4, -8], n: 3 },
      { player: 1, unit: 'light_cav', at: ['C', 0, 0], n: 4 },
      { player: 1, unit: 'spearman', at: ['C', 8, 8], n: 6 },
      { player: 1, unit: 'archer', at: ['B', -8, -4], n: 4 },
    ],
    objectives: [
      { id: 'reach', text: '護送諸葛亮到柴桑（發光的旗幟）', primary: true },
      { id: 'zhuge', text: '諸葛亮不能陣亡', primary: true },
      { id: 'convert', text: '（次要）用謀士勸降 3 名曹兵' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '諸葛亮', face: 'hero_zhuge', text: '曹操八十萬大軍南下，唯有孫劉聯手才有勝算。亮這就前往柴桑。' },
            { who: '旁白', text: '【謀士】選取謀士，點敵兵即可勸降（持續遊說數秒）；謀士也會自動治療附近的友軍。' },
          ] },
          { t: 'beacon', id: 'chaisang', at: ['B', 0, 0], on: true },
        ],
      },
      { id: 'convert', when: [{ t: 'converted', player: 0, n: 3 }], then: [{ t: 'objective', id: 'convert', state: 'done' }] },
      { id: 'lose', when: [{ t: 'dead', tag: 'zhuge' }], then: [{ t: 'objective', id: 'zhuge', state: 'failed' }, { t: 'lose' }] },
      {
        id: 'win',
        when: [{ t: 'inArea', player: 0, unit: 'hero_zhuge', area: { at: ['B', 0, 0], r: 4 } }],
        then: [
          { t: 'objective', id: 'reach', state: 'done' },
          { t: 'objective', id: 'zhuge', state: 'done' },
          { t: 'dialog', lines: [{ who: '諸葛亮', face: 'hero_zhuge', text: '吳侯，曹操雖眾，卻是遠來疲憊之師，又不習水戰——此戰必勝！' }, { who: '孫權', face: 'hero_sunquan', text: '好！孤意已決，與劉豫州共抗曹賊！' }] },
          { t: 'win' },
        ],
      },
    ],
    stars: { time: 420, bonus: 'convert' },
  },

  // ───────── 3-2 草船借箭：在曹營江面撐住 ─────────
  {
    id: '3-2',
    chapter: 3,
    title: '草船借箭',
    subtitle: '堅持與走位',
    brief: '大霧瀰漫，諸葛亮派草船駛近曹營江面「借箭」。讓至少 3 艘草船在曹營外的江面撐滿 60 秒。',
    map: { type: 'yangtze', size: 96, seed: 302 },
    players: [
      { name: '孫劉聯軍', faction: 'wu', res: [100, 100, 100, 0], age: 3 },
      { ...CAO },
    ],
    clear: [{ at: ['B', -10, -10], r: 4 }],
    place: [
      { player: 0, unit: 'transport', at: ['C', -6, -6], n: 6 },
      { player: 0, unit: 'hero_zhuge', at: ['A', 4, 4], tag: 'zhuge' },
      { player: 1, unit: 'archer', at: ['C', 7, 7], n: 10 },
      { player: 1, unit: 'archer', at: ['C', 10, 4], n: 6 },
      { player: 1, unit: 'archer', at: ['C', 4, 10], n: 6 },
      { player: 1, building: 'tower', at: ['C', 9, 9] },
    ],
    objectives: [
      { id: 'hold', text: '讓 3 艘以上草船在曹營江面撐滿 60 秒', primary: true },
      { id: 'ships', text: '草船少於 3 艘就失敗', primary: true },
      { id: 'bonus', text: '（次要）一艘草船都不損失' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '諸葛亮', face: 'hero_zhuge', text: '今夜大霧，曹操必不敢出戰，只會放箭。我們的草船靠過去，箭自然就送上門了。' },
            { who: '旁白', text: '選取草船（運兵船），開到發光的江面上。船身吸箭會受損，受損的船可以暫時退出射程再回來。' },
          ] },
          { t: 'beacon', id: 'river', at: ['C', 2, 2], on: true },
          { t: 'camera', at: ['C', 0, 0] },
        ],
      },
      { id: 'tick', when: [{ t: 'inArea', player: 0, unit: 'transport', area: { at: ['C', 2, 2], r: 6 }, n: 3 }], then: [{ t: 'setVar', name: 'held', add: 1 }], every: 1 },
      { id: 'lose', when: [{ t: 'units', player: 0, unit: 'transport', op: '<=', n: 2 }], then: [{ t: 'objective', id: 'ships', state: 'failed' }, { t: 'lose' }] },
      { id: 'bonus', when: [{ t: 'var', name: 'held', op: '>=', n: 60 }, { t: 'units', player: 0, unit: 'transport', op: '>=', n: 6 }], then: [{ t: 'objective', id: 'bonus', state: 'done' }] },
      {
        id: 'win',
        when: [{ t: 'var', name: 'held', op: '>=', n: 60 }],
        then: [
          { t: 'objective', id: 'hold', state: 'done' },
          { t: 'objective', id: 'ships', state: 'done' },
          { t: 'dialog', lines: [{ who: '諸葛亮', face: 'hero_zhuge', text: '謝丞相箭！十萬支箭，足夠破曹了。' }] },
          { t: 'win' },
        ],
      },
    ],
    stars: { time: 240, bonus: 'bonus' },
  },

  // ───────── 3-3 苦肉連環：甘寧潛入放火種 ─────────
  {
    id: '3-3',
    chapter: 3,
    title: '苦肉連環',
    subtitle: '潛行與破壞',
    brief: '黃蓋詐降、龐統獻連環計。甘寧率精兵夜襲曹營，在三處營地放下火種。善用「百騎劫營」的隱形。',
    map: { type: 'central', size: 96, seed: 303 },
    players: [
      { name: '孫劉聯軍', faction: 'wu', res: [100, 100, 100, 0], age: 3 },
      { ...CAO },
    ],
    clear: [{ at: ['A', 2, 2], r: 5 }, { at: ['B', 0, 0], r: 10 }],
    place: [
      { player: 0, unit: 'hero_ganning', at: ['A', 2, 2], tag: 'ganning' },
      { player: 0, unit: 'danyang', at: ['A', 4, 4], n: 8 },
      { player: 1, building: 'barracks', at: ['B', -6, 0], tag: 'camp1' },
      { player: 1, building: 'stable', at: ['B', 0, -6], tag: 'camp2' },
      { player: 1, building: 'archery', at: ['B', 5, 5], tag: 'camp3' },
      { player: 1, building: 'tower', at: ['B', -3, -3] },
      { player: 1, unit: 'spearman', at: ['B', -8, -8], n: 6, tag: 'guard' },
      { player: 1, unit: 'archer', at: ['B', -2, 2], n: 6, tag: 'guard' },
      { player: 1, unit: 'swordsman', at: ['C', 0, 0], n: 6 },
      { player: 1, unit: 'heavy_cav', at: ['B', 2, -2], n: 4, tag: 'guard' },
    ],
    objectives: [
      { id: 'fire1', text: '在曹營兵營放火種', primary: true },
      { id: 'fire2', text: '在曹營馬廄放火種', primary: true },
      { id: 'fire3', text: '在曹營弓營放火種', primary: true },
      { id: 'ganning', text: '甘寧不能陣亡', primary: true },
      { id: 'bonus', text: '（次要）三座營地全部燒毀' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '甘寧', face: 'hero_ganning', text: '百騎足矣！今夜就讓曹賊嚐嚐錦帆賊的厲害。' },
            { who: '旁白', text: '帶甘寧走到三座曹營建築旁（發光處）即可放下火種。甘寧的「百騎劫營」能讓附近友軍隱形 10 秒，攻擊就會現形。' },
          ] },
          { t: 'beacon', id: 'b1', at: ['B', -6, 0], on: true },
          { t: 'beacon', id: 'b2', at: ['B', 0, -6], on: true },
          { t: 'beacon', id: 'b3', at: ['B', 5, 5], on: true },
          { t: 'hold', tag: 'guard' },
        ],
      },
      { id: 'fire1', when: [{ t: 'inArea', player: 0, tag: 'ganning', area: { at: ['B', -6, 0], r: 3 } }], then: [{ t: 'fire', player: 0, at: ['B', -6, 0], r: 3, sec: 20 }, { t: 'beacon', id: 'b1', at: ['B', -6, 0], on: false }, { t: 'objective', id: 'fire1', state: 'done' }] },
      { id: 'fire2', when: [{ t: 'inArea', player: 0, tag: 'ganning', area: { at: ['B', 0, -6], r: 3 } }], then: [{ t: 'fire', player: 0, at: ['B', 0, -6], r: 3, sec: 20 }, { t: 'beacon', id: 'b2', at: ['B', 0, -6], on: false }, { t: 'objective', id: 'fire2', state: 'done' }] },
      { id: 'fire3', when: [{ t: 'inArea', player: 0, tag: 'ganning', area: { at: ['B', 5, 5], r: 3 } }], then: [{ t: 'fire', player: 0, at: ['B', 5, 5], r: 3, sec: 20 }, { t: 'beacon', id: 'b3', at: ['B', 5, 5], on: false }, { t: 'objective', id: 'fire3', state: 'done' }] },
      { id: 'alarm', when: [{ t: 'fired', id: 'fire1' }], then: [{ t: 'hint', text: '曹營起火，守軍驚醒了！' }, { t: 'attack', player: 1, tag: 'guard', to: ['B', -6, 0] }] },
      { id: 'lose', when: [{ t: 'dead', tag: 'ganning' }], then: [{ t: 'objective', id: 'ganning', state: 'failed' }, { t: 'lose' }] },
      { id: 'bonus', when: [{ t: 'dead', tag: 'camp1' }, { t: 'dead', tag: 'camp2' }, { t: 'dead', tag: 'camp3' }], then: [{ t: 'objective', id: 'bonus', state: 'done' }] },
      countdown('endTimer', 'allFires'),
      { id: 'allFires', when: [{ t: 'fired', id: 'fire1' }, { t: 'fired', id: 'fire2' }, { t: 'fired', id: 'fire3' }], then: [{ t: 'objective', id: 'ganning', state: 'done' }, { t: 'dialog', lines: [{ who: '甘寧', face: 'hero_ganning', text: '火種已經放好，撤！' }] }] },
      { id: 'win', when: [{ t: 'var', name: 'endTimer', op: '>=', n: 12 }], then: [{ t: 'win' }] },
    ],
    stars: { time: 360, bonus: 'bonus' },
  },

  // ───────── 3-4 火燒赤壁：守住 → 東風起 → 火船衝陣 → 攻破曹營 ─────────
  {
    id: '3-4',
    chapter: 3,
    title: '火燒赤壁',
    subtitle: '水戰決勝',
    brief: '曹操的連環船隊橫江而來。先守住江岸，等東風一起，火船衝陣、燒盡曹軍艦隊，再登岸攻破曹營。',
    map: { type: 'chibi', size: 96, seed: 304 },
    players: [
      { name: '孫劉聯軍', faction: 'wu', res: [600, 800, 400, 200], age: 3 },
      { name: '曹操', faction: 'wei', res: [1000, 1000, 600, 400], age: 3, ai: 'easy' },
    ],
    clear: [{ at: ['A', 0, 0], r: 8 }, { at: ['B', 0, 0], r: 8 }],
    place: [
      { player: 0, building: 'town_hall', at: ['A', 0, 0] },
      { player: 0, building: 'house', at: ['A', -5, 3] },
      { player: 0, building: 'house', at: ['A', -5, -2] },
      { player: 0, building: 'barracks', at: ['A', 4, -5] },
      { player: 0, unit: 'villager', at: ['A', -2, 5], n: 12 },
      { player: 0, unit: 'hero_zhouyu', at: ['A', 6, 6], tag: 'zhouyu' },
      { player: 0, unit: 'archer', at: ['A', 7, 7], n: 10 },
      { player: 0, unit: 'galley', at: ['C', -8, -8], n: 6 },
      { player: 1, building: 'town_hall', at: ['B', 0, 0], tag: 'caoying' },
      { player: 1, building: 'house', at: ['B', 4, 4] },
      { player: 1, building: 'barracks', at: ['B', -5, 4] },
      { player: 1, building: 'tower', at: ['B', -6, -6] },
      { player: 1, unit: 'villager', at: ['B', 2, 5], n: 10 },
      { player: 1, unit: 'galley', at: ['C', 5, 5], n: 8, tag: 'fleet' },
      { player: 1, unit: 'mengchong', at: ['C', 7, 3], n: 3, tag: 'fleet' },
      { player: 1, unit: 'louchuan', at: ['C', 3, 7], n: 2, tag: 'fleet' },
      { player: 1, unit: 'spearman', at: ['B', -4, -2], n: 8 },
      { player: 1, unit: 'archer', at: ['B', -2, -4], n: 8 },
    ],
    objectives: [
      { id: 'hold', text: '守住江岸，等待東風（3 分鐘）', primary: true },
      { id: 'fleet', text: '燒毀曹軍艦隊', primary: true, hidden: true },
      { id: 'caoying', text: '攻破曹營太守府', primary: true, hidden: true },
      { id: 'zhouyu', text: '（次要）周瑜存活到最後' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [
          { t: 'dialog', lines: [
            { who: '周瑜', face: 'hero_zhouyu', text: '曹賊把戰船連成一片，正是火攻的好時機……只可惜，現在吹的是西北風。' },
            { who: '諸葛亮', face: 'hero_zhuge', text: '都督莫急。三分鐘後，東南風自來。' },
          ] },
          { t: 'hold', tag: 'fleet' },
        ],
      },
      { id: 'probe', when: [{ t: 'time', sec: 60 }], then: [{ t: 'spawn', player: 1, unit: 'galley', at: ['C', 4, 4], n: 4, attack: ['A', 4, 4] }] },
      { id: 'probe2', when: [{ t: 'time', sec: 120 }], then: [{ t: 'spawn', player: 1, unit: 'galley', at: ['C', 4, 4], n: 4, attack: ['A', 4, 4] }, { t: 'spawn', player: 1, unit: 'transport', at: ['C', 4, 4], n: 1 }] },
      {
        id: 'wind',
        when: [{ t: 'time', sec: 180 }],
        then: [
          { t: 'objective', id: 'hold', state: 'done' },
          { t: 'cutin', hero: 'hero_zhuge', skill: '借東風' },
          { t: 'dialog', lines: [
            { who: '諸葛亮', face: 'hero_zhuge', text: '東風起了！' },
            { who: '周瑜', face: 'hero_zhouyu', text: '火船出擊！把曹賊的連環船燒個乾淨！' },
            { who: '旁白', text: '火船衝進敵艦會自爆並留下火海。東風期間火焰傷害加倍；周瑜的「火燒赤壁」也能點燃一大片江面。' },
          ] },
          { t: 'wind', player: 0, sec: 120 },
          { t: 'spawn', player: 0, unit: 'fire_ship', at: ['C', -6, -6], n: 8 },
          { t: 'objective', id: 'fleet', state: 'show' },
        ],
      },
      {
        id: 'fleetGone',
        when: [{ t: 'fired', id: 'wind' }, { t: 'units', player: 1, tag: 'fleet', op: '<=', n: 0 }],
        then: [
          { t: 'objective', id: 'fleet', state: 'done' },
          { t: 'objective', id: 'caoying', state: 'show' },
          { t: 'dialog', lines: [{ who: '周瑜', face: 'hero_zhouyu', text: '曹軍水師已滅！全軍登岸，直取曹營！' }] },
          { t: 'give', player: 0, res: [400, 400, 300, 0] },
          { t: 'spawn', player: 0, unit: 'transport', at: ['C', -6, -6], n: 3 },
        ],
      },
      { id: 'zhouyuDead', when: [{ t: 'dead', tag: 'zhouyu' }], then: [{ t: 'objective', id: 'zhouyu', state: 'failed' }] },
      { id: 'zhouyuOk', when: [{ t: 'dead', tag: 'caoying' }, { t: 'units', player: 0, tag: 'zhouyu', op: '>=', n: 1 }], then: [{ t: 'objective', id: 'zhouyu', state: 'done' }] },
      {
        id: 'win',
        when: [{ t: 'dead', tag: 'caoying' }],
        then: [
          { t: 'objective', id: 'caoying', state: 'done' },
          { t: 'dialog', lines: [{ who: '周瑜', face: 'hero_zhouyu', text: '赤壁一戰，天下三分之勢已成！' }] },
          { t: 'win' },
        ],
      },
    ],
    stars: { time: 1200, bonus: 'zhouyu' },
  },

  // ───────── 4-1 堅守：防守波次 ─────────
  {
    id: '4-1',
    chapter: 4,
    title: '堅守',
    subtitle: '防守待機',
    brief: '劉備傾國來攻，聲勢浩大。陸遜下令堅守不出——擋住 4 波蜀軍，守住營地 8 分鐘。',
    map: { type: 'shudao', size: 96, seed: 401 },
    players: [
      { name: '吳軍', faction: 'wu', res: [600, 800, 300, 400], age: 3 },
      { ...LIUBEI },
    ],
    clear: [{ at: ['A', 0, 0], r: 8 }],
    place: [
      { player: 0, building: 'town_hall', at: ['A', 0, 0], tag: 'th' },
      { player: 0, building: 'house', at: ['A', -5, 3] },
      { player: 0, building: 'house', at: ['A', -5, -2] },
      { player: 0, building: 'barracks', at: ['A', 4, -5] },
      { player: 0, building: 'archery', at: ['A', -2, -6] },
      { player: 0, building: 'tower', at: ['A', 7, 7] },
      { player: 0, unit: 'villager', at: ['A', -2, 5], n: 12 },
      { player: 0, unit: 'hero_luxun', at: ['A', 4, 4] },
      { player: 0, unit: 'crossbowman', at: ['A', 6, 5], n: 8 },
      { player: 0, unit: 'spearman', at: ['A', 5, 7], n: 6 },
    ],
    objectives: [
      { id: 'hold', text: '守住 8 分鐘', primary: true },
      { id: 'th', text: '太守府不能被摧毀', primary: true },
      { id: 'bonus', text: '（次要）損失少於 20 名單位' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [{ t: 'dialog', lines: [
          { who: '陸遜', face: 'hero_luxun', text: '蜀軍新勝，銳氣正盛。此時出戰正中其下懷——傳令諸將，堅守不出！' },
          { who: '旁白', text: '多蓋箭塔、城牆，讓弩兵在後方輸出。蜀道的隘口很窄，是最好的防線。' },
        ] }],
      },
      { id: 'w1', when: [{ t: 'time', sec: 60 }], then: [{ t: 'spawn', player: 1, unit: 'swordsman', at: ['B', 0, 0], n: 8, attack: ['A', 0, 0] }, { t: 'spawn', player: 1, unit: 'archer', at: ['B', 0, 0], n: 4, attack: ['A', 0, 0] }] },
      { id: 'w2', when: [{ t: 'time', sec: 180 }], then: [{ t: 'spawn', player: 1, unit: 'spearman', at: ['B', 0, 0], n: 8, attack: ['A', 0, 0] }, { t: 'spawn', player: 1, unit: 'repeater', at: ['B', 0, 0], n: 6, attack: ['A', 0, 0] }] },
      { id: 'w3', when: [{ t: 'time', sec: 300 }], then: [{ t: 'spawn', player: 1, unit: 'heavy_cav', at: ['B', 0, 0], n: 6, attack: ['A', 0, 0] }, { t: 'spawn', player: 1, unit: 'swordsman', at: ['B', 0, 0], n: 10, attack: ['A', 0, 0] }] },
      { id: 'w4', when: [{ t: 'time', sec: 400 }], then: [
        { t: 'dialog', lines: [{ who: '旁白', text: '蜀軍最後一波猛攻，張飛之後的猛將親自上陣！' }] },
        { t: 'spawn', player: 1, unit: 'ram', at: ['B', 0, 0], n: 2, attack: ['A', 0, 0] },
        { t: 'spawn', player: 1, unit: 'halberdier', at: ['B', 0, 0], n: 10, attack: ['A', 0, 0] },
        { t: 'spawn', player: 1, unit: 'repeater', at: ['B', 0, 0], n: 8, attack: ['A', 0, 0] },
      ] },
      { id: 'lose', when: [{ t: 'dead', tag: 'th' }], then: [{ t: 'objective', id: 'th', state: 'failed' }, { t: 'lose' }] },
      { id: 'bonus', when: [{ t: 'time', sec: 480 }, { t: 'lost', player: 0, op: '<=', n: 19 }], then: [{ t: 'objective', id: 'bonus', state: 'done' }] },
      { id: 'win', when: [{ t: 'time', sec: 480 }], then: [{ t: 'objective', id: 'hold', state: 'done' }, { t: 'objective', id: 'th', state: 'done' }, { t: 'dialog', lines: [{ who: '陸遜', face: 'hero_luxun', text: '蜀軍久攻不下，已顯疲態。時機快到了。' }] }, { t: 'win' }] },
    ],
    stars: { time: 480, bonus: 'bonus' },
  },

  // ───────── 4-2 疲敵：襲擾補給 ─────────
  {
    id: '4-2',
    chapter: 4,
    title: '疲敵',
    subtitle: '襲擾補給線',
    brief: '蜀軍連營數百里，補給全靠幾座伐木場與礦場。派輕兵襲擾，摧毀 4 處補給據點。',
    map: { type: 'shudao', size: 96, seed: 402 },
    players: [
      { name: '吳軍', faction: 'wu', res: [300, 300, 300, 0], age: 3 },
      { ...LIUBEI },
    ],
    clear: [{ at: ['A', 2, 2], r: 6 }, { at: ['B', -10, 0], r: 4 }, { at: ['B', 0, -10], r: 4 }, { at: ['B', -14, -14], r: 4 }, { at: ['C', 6, 6], r: 4 }],
    place: [
      { player: 0, unit: 'hero_ganning', at: ['A', 2, 2], tag: 'ganning' },
      { player: 0, unit: 'swift_cav', at: ['A', 4, 4], n: 8 },
      { player: 0, unit: 'danyang', at: ['A', 2, 5], n: 6 },
      { player: 1, building: 'lumber_camp', at: ['B', -10, 0], tag: 'supply' },
      { player: 1, building: 'mine_camp', at: ['B', 0, -10], tag: 'supply' },
      { player: 1, building: 'lumber_camp', at: ['B', -14, -14], tag: 'supply' },
      { player: 1, building: 'granary', at: ['C', 6, 6], tag: 'supply' },
      { player: 1, unit: 'spearman', at: ['B', -10, 2], n: 4 },
      { player: 1, unit: 'archer', at: ['B', 2, -10], n: 4 },
      { player: 1, unit: 'spearman', at: ['C', 8, 8], n: 5 },
      { player: 1, unit: 'heavy_cav', at: ['B', 0, 0], n: 6, tag: 'hunters' },
    ],
    objectives: [
      { id: 'supply', text: '摧毀 4 處蜀軍補給據點', primary: true },
      { id: 'ganning', text: '甘寧不能陣亡', primary: true },
      { id: 'bonus', text: '（次要）9 分鐘內完成' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [{ t: 'dialog', lines: [{ who: '陸遜', face: 'hero_luxun', text: '興霸，蜀軍補給線拉得太長了。去燒他們的伐木場與礦場，讓他們疲於奔命。' }, { who: '甘寧', face: 'hero_ganning', text: '這活兒我最拿手！' }] }],
      },
      { id: 'hunt', when: [{ t: 'time', sec: 150 }], then: [{ t: 'hint', text: '蜀軍騎兵出營追捕你們了！' }, { t: 'attack', player: 1, tag: 'hunters', to: ['A', 4, 4] }] },
      { id: 'lose', when: [{ t: 'dead', tag: 'ganning' }], then: [{ t: 'objective', id: 'ganning', state: 'failed' }, { t: 'lose' }] },
      { id: 'late', when: [{ t: 'time', sec: 540 }], then: [{ t: 'setVar', name: 'late', value: 1 }] },
      { id: 'bonus', when: [{ t: 'dead', tag: 'supply' }, { t: 'var', name: 'late', op: '<=', n: 0 }], then: [{ t: 'objective', id: 'bonus', state: 'done' }] },
      { id: 'win', when: [{ t: 'dead', tag: 'supply' }], then: [{ t: 'objective', id: 'supply', state: 'done' }, { t: 'objective', id: 'ganning', state: 'done' }, { t: 'win' }] },
    ],
    stars: { time: 540, bonus: 'bonus' },
  },

  // ───────── 4-3 火燒連營：連鎖大火 ─────────
  {
    id: '4-3',
    chapter: 4,
    title: '火燒連營',
    subtitle: '火攻決勝',
    brief: '時機已到！陸遜下令火攻：蜀軍營寨首尾相連，一把火就能連鎖延燒。燒毀 12 座營寨。',
    map: { type: 'central', size: 96, seed: 403 },
    players: [
      { name: '吳軍', faction: 'wu', res: [600, 600, 1200, 400], age: 4 },
      { ...LIUBEI },
    ],
    clear: [{ at: ['A', 2, 2], r: 6 }, { at: ['B', -6, -6], r: 12 }],
    place: [
      { player: 0, unit: 'hero_luxun', at: ['A', 2, 2], tag: 'luxun' },
      { player: 0, unit: 'hero_zhouyu', at: ['A', 0, 4] },
      { player: 0, unit: 'crossbowman', at: ['A', 4, 4], n: 10 },
      { player: 0, unit: 'danyang', at: ['A', 4, 6], n: 8 },
      { player: 0, building: 'academy', at: ['A', -4, -4] },
      { player: 1, building: 'house', at: ['B', -12, -12], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -10, -12], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -8, -12], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -12, -10], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -10, -9], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -7, -9], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -12, -7], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -9, -6], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -6, -6], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -4, -8], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -6, -3], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -3, -5], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -2, -2], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -4, 0], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', 0, -4], tag: 'camp' },
      { player: 1, building: 'house', at: ['B', -14, -4], tag: 'camp' },
      { player: 1, unit: 'hero_liubei', at: ['B', 0, 0], tag: 'liubei' },
      { player: 1, unit: 'swordsman', at: ['B', -8, -8], n: 10 },
      { player: 1, unit: 'archer', at: ['B', -5, -10], n: 8 },
      { player: 1, unit: 'spearman', at: ['B', -10, -5], n: 8 },
    ],
    objectives: [
      { id: 'camps', text: '燒毀 12 座蜀軍營寨', primary: true },
      { id: 'luxun', text: '陸遜不能陣亡', primary: true },
      { id: 'bonus', text: '（次要）擊敗劉備' },
    ],
    triggers: [
      {
        id: 'intro',
        when: [{ t: 'time', sec: 0 }],
        then: [{ t: 'dialog', lines: [
          { who: '陸遜', face: 'hero_luxun', text: '劉備連營七百里，營寨皆以木柵相連——正是火攻之時！' },
          { who: '旁白', text: '陸遜的「火燒連營」會從一座營寨延燒到附近 5 座；書院的「火攻計」也能補刀。燒毀營寨會累積陸遜的威名。' },
        ] }],
      },
      { id: 'bonus', when: [{ t: 'dead', tag: 'liubei' }], then: [{ t: 'objective', id: 'bonus', state: 'done' }] },
      { id: 'lose', when: [{ t: 'dead', tag: 'luxun' }], then: [{ t: 'objective', id: 'luxun', state: 'failed' }, { t: 'lose' }] },
      { id: 'win', when: [{ t: 'buildings', player: 1, building: 'house', op: '<=', n: 4 }], then: [{ t: 'objective', id: 'camps', state: 'done' }, { t: 'objective', id: 'luxun', state: 'done' }, { t: 'dialog', lines: [{ who: '陸遜', face: 'hero_luxun', text: '火燒連營七百里，蜀軍大敗！' }] }, { t: 'win' }] },
    ],
    stars: { time: 600, bonus: 'bonus' },
  },
];

export const SCENARIO_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));
