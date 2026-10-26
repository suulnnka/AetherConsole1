/*
 * 卡带:MAGIC TOWER · 21 层魔塔(v1.0)
 * 颜色模式 A:32 色调色板;240×180 索引帧缓冲
 * 致敬 21 层魔塔(原作者已开放版权):战斗公式与前期怪物数值照搬原版风格,
 *   后期怪物按同一公式自行平衡;地图为本作原创排布
 * 战斗公式:每回合玩家先攻,怪物反击;N 回合 = 怪物生命 / (我方攻击-怪物防御);
 *   实损 = (N-1) × max(0, 怪物攻击-我方防御);魔法系怪物先攻(实损 = N × ...)
 * 输入:方向键 / WASD 移动(撞怪出战斗预测)· Z/J 确认战斗 · X/K 取消/楼梯上按
 *   X 飞行(取得 WARP WING 后可在已到达楼层间传送)· Enter 暂停
 * 系统:三色钥匙开门 · 红蓝宝石 · 四级剑盾 · 楼层商店(金币换属性)·
 *   仙子事件 · 自动存档(localStorage)· 战斗预测防失误
 */
const MagicTowerCart = (function () {
  'use strict';

  const W = 240, H = 180;
  const TILE = 16, MW = 11, MH = 11;      // 11×11 地图,tile 16px
  const OX = 0, OY = 2;                   // 地图绘制偏移(下方留 2px)
  const SIDEX = 178;                      // 侧栏

  // —— 调色板索引 ——
  const INK = 0, WALL = 1, WALL_LT = 2, FLOOR = 3, FLOOR_D = 4, WHITE = 5,
        LGRAY = 6, GRAY = 7, DGRAY = 8, RED = 9, DRED = 10, ORANGE = 11,
        YELLOW = 12, GOLD = 13, GREEN = 14, DGREEN = 15, CYAN = 16, BLUE = 17,
        DBLUE = 18, VIOLET = 19, PINK = 20, SKIN = 21, BROWN = 22,
        DBROWN = 23, STEEL = 24, SLATE = 25, TAN = 26, LIME = 27, TEAL = 28,
        MAGENTA = 29, PURPLE = 30, NAVY = 31;

  // —— 怪物表:hp/atk/def/gold,first=魔法先攻 ——
  // 前 12 种数值照搬 21 层魔塔原版;后期(guard 起)为同公式自制平衡
  const MON = {
    g: { n: 'SLIME',    hp: 35,   atk: 18,  def: 1,   gold: 1 },
    h: { n: 'R-SLIME',  hp: 45,   atk: 20,  def: 2,   gold: 2 },
    f: { n: 'BAT',      hp: 35,   atk: 38,  def: 3,   gold: 3 },
    F: { n: 'BIG BAT',  hp: 80,   atk: 90,  def: 10,  gold: 8 },
    n: { n: 'SKELETON', hp: 110,  atk: 25,  def: 5,   gold: 5 },
    m: { n: 'SKEL KN',  hp: 150,  atk: 40,  def: 20,  gold: 8 },
    c: { n: 'MAGE',     hp: 60,   atk: 35,  def: 3,   gold: 6,  first: true },
    C: { n: 'HI-MAGE',  hp: 100,  atk: 60,  def: 8,   gold: 10, first: true },
    t: { n: 'ROCK',     hp: 100,  atk: 68,  def: 30,  gold: 7 },
    o: { n: 'ORC',      hp: 320,  atk: 115, def: 10,  gold: 13 },
    O: { n: 'ORC KN',   hp: 345,  atk: 130, def: 30,  gold: 17 },
    v: { n: 'RED BAT',  hp: 130,  atk: 120, def: 15,  gold: 10 },
    w: { n: 'GUARD',    hp: 800,  atk: 160, def: 60,  gold: 30 },
    G: { n: 'SENTRY',   hp: 1500, atk: 340, def: 140, gold: 50, first: true },
    N: { n: 'PRIEST',   hp: 600,  atk: 260, def: 60,  gold: 60, first: true },
    D: { n: 'DRAGON',   hp: 3000, atk: 440, def: 140, gold: 0 },
    L: { n: 'DEVIL',    hp: 2600, atk: 480, def: 150, gold: 0 },
  };
  const MON_IDS = Object.keys(MON);

  // —— 地表物品 ——
  const ITEMS = {
    k: { msg: 'YELLOW KEY',  fn: s => s.keyY++ },
    j: { msg: 'BLUE KEY',    fn: s => s.keyB++ },
    i: { msg: 'RED KEY',     fn: s => s.keyR++ },
    u: { msg: 'HP +200',     fn: s => s.hp += 200 },
    p: { msg: 'HP +500',     fn: s => s.hp += 500 },
    U: { msg: 'HP +1000',    fn: s => s.hp += 1000 },
    P: { msg: 'HP +2000',    fn: s => s.hp += 2000 },
    a: { msg: 'ATK +2',      fn: s => s.atk += 2 },
    s: { msg: 'DEF +2',      fn: s => s.def += 2 },
    A: { msg: 'IRON SWORD +10',  fn: s => s.atk += 10 },
    Z: { msg: 'SILV SWORD +20',  fn: s => s.atk += 20 },
    Q: { msg: 'KNGT SWORD +40',  fn: s => s.atk += 40 },
    E: { msg: 'HOLY SWORD +100', fn: s => s.atk += 100 },
    S: { msg: 'IRON SHIELD +10',  fn: s => s.def += 10 },
    X: { msg: 'SILV SHIELD +20',  fn: s => s.def += 20 },
    W: { msg: 'KNGT SHIELD +40',  fn: s => s.def += 40 },
    R: { msg: 'HOLY SHIELD +100', fn: s => s.def += 100 },
  };
  const DOORS = { d: 'keyY', b: 'keyB', r: 'keyR' };
  const DOOR_CN = { d: 'YELLOW', b: 'BLUE', r: 'RED' };

  // —— 21 层地图(11×11 字符画)——
  // #:墙 .:地板 <:上楼 >:下楼 x:起点  d/b/r:黄/蓝/红门  k/j/i:黄/蓝/红钥匙
  // u/p/U/P:小中大巨大血瓶  a/s:攻/防宝石  A/Z/Q/E:剑  S/X/W/R:盾
  // g..L:怪物  y:仙子  $:商店
  const MAPS = [
    [ // F1 教学层
      '###########',
      '#<..#..k..#',
      '#...#.g.a.#',
      '#.###.....#',
      '#.#.###d###',
      '#.#.....#.#',
      '#.#..h..#.#',
      '#d####.##.#',
      '#x..k...u.#',
      '#....g....#',
      '###########',
    ],
    [ // F2 铁剑
      '###########',
      '#..f..n..<#',
      '#.#######.#',
      '#k#.....#k#',
      '#.#..A..#.#',
      '#.#.....#.#',
      '#.###d###.#',
      '#......f..#',
      '#.g.....u.#',
      '#>..g...u.#',
      '###########',
    ],
    [ // F3 铁盾 + 蓝门初见
      '###########',
      '#h.f#<#.S.#',
      '#.s.d.b..a#',
      '#...#k#m..#',
      '#...#.#...#',
      '#kjf.....j#',
      '#...#.#...#',
      '#...#j#h..#',
      '#c..ad.b.c#',
      '#...#>#.s.#',
      '###########',
    ],
    [ // F4 银剑(蓝门后)
      '###########',
      '#<....m..F#',
      '#.#######.#',
      '#u#a...s#u#',
      '#.#..Z..#.#',
      '#j#.....#j#',
      '#.###b###.#',
      '#F.v...m..#',
      '#p.......p#',
      '#>..a.s...#',
      '###########',
    ],
    [ // F5 仙子(+1000 HP)
      '###########',
      '#.n.#<#.f.#',
      '#..pd.b.c.#',
      '#...#k#...#',
      '#...#.#...#',
      '#kps.y..pj#',
      '#...#.#...#',
      '#...#j#..h#',
      '#.n.d.b.f.#',
      '#...#>#...#',
      '###########',
    ],
    [ // F6 银盾
      '###########',
      '#.n..#...<#',
      '#c...djm..#',
      '#....#....#',
      '#...k#U...#',
      '#.b..#..b.#',
      '#....#...n#',
      '#..m.#.t..#',
      '#.c..d..X.#',
      '#>...#j.n.#',
      '###########',
    ],
    [ // F7 兽人登场 + 红门初见
      '###########',
      '#.C..v...<#',
      '#..F...CP.#',
      '#j##...##.#',
      '#....F....#',
      '##d#####b##',
      '#....o.####',
      '#.i....#aa#',
      '#......r..#',
      '#>..k..#ss#',
      '###########',
    ],
    [ // F8 岩石阵
      '###########',
      '#u..j#k..<#',
      '#....#....#',
      '#.o..#..o.#',
      '#....d....#',
      '#tU..#..Ut#',
      '#....b....#',
      '#....#....#',
      '#.p..#..p.#',
      '#>...#...i#',
      '###########',
    ],
    [ // F9 仙子赠 WARP WING + 骑士剑
      '###########',
      '#v..y....<#',
      '#.#######.#',
      '#j#C...C#j#',
      '#.#..Q..#.#',
      '#.#.....#.#',
      '#.###r###.#',
      '#...o..P..#',
      '#k.......v#',
      '#>........#',
      '###########',
    ],
    [ // F10 卫兵初见(侧室)
      '###########',
      '#.O..#.o.<#',
      '#.........#',
      '#....#U...#',
      '#.k..#....#',
      '#.d..#..d.#',
      '#....#....#',
      '#..U.#...w#',
      '#.o..#....#',
      '#>...#j.i.#',
      '###########',
    ],
    [ // F11 商店 + 骑士盾
      '###########',
      '#.O...w..<#',
      '#.#######.#',
      '#.#a..s.#.#',
      '#d#..W..#d#',
      '#.#s..a.#.#',
      '#.###b###.#',
      '#..O...P..#',
      '#$.P......#',
      '#>..k..k.j#',
      '###########',
    ],
    [ // F12 蛇形迷宫(红门护送楼梯)
      '###########',
      '#O..U..i.<#',
      '#########r#',
      '#..w...OP.#',
      '#.#########',
      '#Pd.w...P.#',
      '########.##',
      '#..O.w....#',
      '#.#########',
      '#>.UO..k..#',
      '###########',
    ],
    [ // F13 十字重兵
      '###########',
      '#.w.#<#.O.#',
      '#.asd.b...#',
      '#...#k#C.P#',
      '#...#.#...#',
      '#.k..w.vj.#',
      '#...#.#...#',
      '#P.O#j#..w#',
      '#.v.d.b.C.#',
      '#...#>#...#',
      '###########',
    ],
    [ // F14 宝物层
      '###########',
      '#U.a.#.i.i#',
      '#.a..rP...#',
      '#s.w.#..aa#',
      '#...<#....#',
      '#....#..#.#',
      '#....#...P#',
      '#....#s...#',
      '#.k.Ud..w.#',
      '#>...#.s.s#',
      '###########',
    ],
    [ // F15 长廊关
      '###########',
      '#k......P<#',
      '#..w..O...#',
      '##d#####b##',
      '#k...w...j#',
      '#PO.....w.#',
      '#.........#',
      '##d#####d##',
      '#......P..#',
      '#>..O....k#',
      '###########',
    ],
    [ // F16 商店 + 红衣教主
      '###########',
      '#.N..w...<#',
      '#.#######.#',
      '#a#..s..#a#',
      '#.#.a.s.#.#',
      '#s#.....#P#',
      '#.###d###.#',
      '#..w.N....#',
      '#$.......P#',
      '#>.k......#',
      '###########',
    ],
    [ // F17 魔法警卫宝库
      '###########',
      '#.N.#<#.j.#',
      '#..Ud.b.N.#',
      '#k..#.#...#',
      '#...#.#...#',
      '#.k.......#',
      '#...#.#..P#',
      '#...#j#...#',
      '#.U.d.bPG.#',
      '#...#>#..P#',
      '###########',
    ],
    [ // F18 圣剑(卫兵×2 + 红门)
      '###########',
      '#....E...<#',
      '#..##r##..#',
      '#....w....#',
      '#.w.......#',
      '#..w...O..#',
      '#.P.......#',
      '####d######',
      '#.k...O.w.#',
      '#>..P....i#',
      '###########',
    ],
    [ // F19 圣盾(卫兵×3 + 蓝门)
      '###########',
      '#>.......<#',
      '#.........#',
      '#.N...w...#',
      '#.k....U..#',
      '#.......P.#',
      '####b######',
      '#w.......w#',
      '#.U..w...P#',
      '#....R...j#',
      '###########',
    ],
    [ // F20 红龙(红门)
      '###########',
      '#>.......<#',
      '#.O...G...#',
      '#...P.....#',
      '#.k...O...#',
      '#..w..P...#',
      '#####r#####',
      '#.........#',
      '#....D....#',
      '#.........#',
      '###########',
    ],
    [ // F21 魔王
      '###########',
      '#>........#',
      '#.........#',
      '#..#...#..#',
      '#.........#',
      '#....L....#',
      '#.........#',
      '#..#...#..#',
      '#.........#',
      '#.........#',
      '###########',
    ],
  ];

  // —— 怪物精灵(字符画)——
  const ART = {
    hero: {
      rows: ['....oooo....', '...osssso...', '..osssssso..', '..osksskso..',
             '..osssssso..', '...oooooo...', '..obbbbbbo..', '.obwbbbbwbo.',
             '.obbbbbbbbo.', '..obbbbbbo..', '...ob..bo...', '...oo..oo...',
             '..ooo..ooo..'],
      map: { o: DGRAY, s: SKIN, k: INK, b: BLUE, w: WHITE },
    },
    g: {
      rows: ['....dddd....', '..ddggggdd..', '.dggggggggd.', '.dggggggggd.',
             'dggwkggwkggd', 'dggggggggggd', 'dgggkkkkkggd', 'dggggggggggd',
             '.dggggggggd.', '..ddggggdd..', '....dddd....'],
      map: { d: DGREEN, g: GREEN, w: WHITE, k: INK },
    },
    h: {
      rows: ['....dddd....', '..ddggggdd..', '.dggggggggd.', '.dggggggggd.',
             'dggwkggwkggd', 'dggggggggggd', 'dgggkkkkkggd', 'dggggggggggd',
             '.dggggggggd.', '..ddggggdd..', '....dddd....'],
      map: { d: DRED, g: RED, w: WHITE, k: INK },
    },
    f: {
      rows: ['.v...vv...v.', '.vv.vvvv.vv.', '.vvvvvvvvvv.', '..vwkvvwkvv.',
             '..vvvvvvvv..', '...vvvvvv...', '....v..v....', '...vv..vv...'],
      map: { v: VIOLET, w: WHITE, k: INK },
    },
    F: {
      rows: ['.v...vv...v.', '.vv.vvvv.vv.', '.vvvvvvvvvv.', '..vwkvvwkvv.',
             '..vvvvvvvv..', '...vvvvvv...', '....v..v....', '...vv..vv...'],
      map: { v: DBLUE, w: WHITE, k: INK },
    },
    v: {
      rows: ['.v...vv...v.', '.vv.vvvv.vv.', '.vvvvvvvvvv.', '..vwkvvwkvv.',
             '..vvvvvvvv..', '...vvvvvv...', '....v..v....', '...vv..vv...'],
      map: { v: RED, w: WHITE, k: INK },
    },
    n: {
      rows: ['...wwwwww...', '..wwwwwwww..', '..wkwwwwkw..', '..wwwkkwww..',
             '...wwwwww...', '..w.wwww.w..', '..w.wwww.w..', '...w....w...',
             '..ww....ww..'],
      map: { w: LGRAY, k: INK },
    },
    m: {
      rows: ['...tttttt...', '..tttttttt..', '..wkwwwwkw..', '..wwwkkwww..',
             '...tttttt...', '..t.wwww.t..', '..w.wwww.w..', '...w....w...',
             '..ww....ww..'],
      map: { t: STEEL, w: LGRAY, k: INK },
    },
    c: {
      rows: ['....mmmm....', '..mmmmmmmm..', '.mmmmmmmmmm.', '...ssssss...',
             '..sksssks...', '...ssssss...', '..mmmmmmmm..', '.mmmmmmmmmm.',
             '.mmmmmmmmmm.', '..mmmmmmmm..'],
      map: { m: BLUE, s: SKIN, k: INK },
    },
    C: {
      rows: ['....mmmm....', '..mmmmmmmm..', '.mmmmmmmmmm.', '...ssssss...',
             '..sksssks...', '...ssssss...', '..mmmmmmmm..', '.mmmmmmmmmm.',
             '.mmmmmmmmmm.', '..mmmmmmmm..'],
      map: { m: PURPLE, s: SKIN, k: INK },
    },
    t: {
      rows: ['...dddddd...', '..dggggggd..', '.dggkgggggd.', '.dggggkkggd.',
             'dgggggggggd', 'dgkggggkggd', 'dgggggggggd', '.dggkkkggd..',
             '..dggggggd..', '...dddddd...'],
      map: { d: DGRAY, g: GRAY, k: INK },
    },
    o: {
      rows: ['...DDDDDD...', '..DGGGGGGD..', '.DGGkGGkGGD.', '.DGGGGGGGGD.',
             '..DGGwwGGD..', '..DbbbbbbD..', '.DbbbbbbbbD.', '..DGG..GGD..',
             '..DD....DD..'],
      map: { D: DGREEN, G: GREEN, k: RED, w: WHITE, b: BROWN },
    },
    O: {
      rows: ['...tttttt...', '..DGGGGGGD..', '.DGkGGGkGGD.', '.DGGGGGGGGD.',
             '..DGGwwGGD..', '..DttttttD..', '.DGttttttGD.', '..DGG..GGD..',
             '..DD....DD..'],
      map: { D: DGREEN, G: GREEN, k: RED, w: WHITE, t: STEEL },
    },
    w: {
      rows: ['....rrrr....', '...tttttt...', '..ttkttktt..', '..tttttttt..',
             '..t.tttt.t..', '..t.tttt.t..', '....tttt....', '....tttt....',
             '...tt..tt...', '...tt..tt...'],
      map: { t: STEEL, k: CYAN, r: RED },
    },
    G: {
      rows: ['....PPPP....', '..PPPPPPPP..', '.PPPPPPPPPP.', '.PPcPPPPcPP.',
             '.PPPPPPPPPP.', '..PPPPPPPP..', '..PPPPPPPP..', '...PPPPPP...',
             '....PPPP....'],
      map: { P: PURPLE, c: CYAN },
    },
    N: {
      rows: ['....RRRR....', '..RRRRRRRR..', '.RRRRRRRRRR.', '.RRkwkkwkRR.',
             '.RRRRRRRRRR.', '..RRyRRyRR..', '..RRRRRRRR..', '..RRRRRRRR..',
             '...RRRRRR...'],
      map: { R: MAGENTA, k: INK, w: WHITE, y: GOLD },
    },
    D: {
      rows: ['..dd......dd..', '..dRd....dRd..', '..dRRd..dRRd..',
             '...dRRddRRd...', '....RRRRRR....', '...RRkRRRRR...',
             '..RRRRRRRRRR..', '.dRRyyyyyyRRd.', '.dRRyyyyyyRRd.',
             '..dRRyyyyRRd..', '...dRRyyRRd...', '....dRRRRd....',
             '....dR..Rd....', '...ddd..ddd...'],
      map: { d: DRED, R: RED, y: GOLD, k: INK },
    },
    L: {
      rows: ['..V........V..', '..VV.VVVV.VV..', '..VVVVVVVVVV..',
             '..VVrVVVVrVV..', '..VVVkkkVVVV..', '...VVVVVVVV...',
             '..VVVVVVVVVV..', '.VVVVVVVVVVVV.', '.VVwVVVVVVwVV.',
             '..VV.VVVV.VV..', '..VV.VVVV.VV..', '.....V..V.....',
             '....VV..VV....', '...VVV..VVV...'],
      map: { V: VIOLET, r: RED, k: INK, w: WHITE },
    },
    y: {
      rows: ['....yyyy....', '..w..ss..w..', '..ww.ss.ww..', '...wsssssw..',
             '....skks....', '....ssss....', '..w.ssss.w..', '..ww....ww..',
             '...w....w...'],
      map: { y: GOLD, s: SKIN, k: INK, w: WHITE },
    },
  };
  ART.h.map = { d: DRED, g: PINK, w: WHITE, k: INK };  // 红史莱姆粉身红边

  // —— 状态 ——
  let scene;               // title/play/battle/shop/dialog/warp/fade/ending/pause
  let grids;               // 当前各层地图(可变)
  let floor, px, py;       // 楼层与玩家格坐标
  let st;                  // 玩家属性 {hp,atk,def,gold,keyY,keyB,keyR}
  let msg, msgT;
  let battle;              // {x,y,id,rounds,dmg,win,t}
  let shopSel, warpSel;
  let dlgLines, dlgIdx, dlgGrant;
  let fadeT, fadeDir, fadeTo;
  let holdDirs, holdT, lastMove;
  let fairy1, warpWing, maxFloor;
  let paused;

  const SAVE_KEY = 'ac_mt_save';

  function hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }

  function newState() {
    return { hp: 1000, atk: 10, def: 10, gold: 0, keyY: 0, keyB: 0, keyR: 0 };
  }

  function save() {
    if (scene === 'title' || scene === 'ending') return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        grids, floor, px, py, st, fairy1, warpWing, maxFloor,
      }));
    } catch (e) {}
  }

  function load() {
    try {
      const s = localStorage.getItem(SAVE_KEY);
      if (!s) return false;
      const d = JSON.parse(s);
      if (!d || !Array.isArray(d.grids) || d.grids.length !== 21) return false;
      grids = d.grids; floor = d.floor; px = d.px; py = d.py; st = d.st;
      fairy1 = !!d.fairy1; warpWing = !!d.warpWing;
      maxFloor = Math.max(floor, d.maxFloor || 0);
      return true;
    } catch (e) { return false; }
  }

  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  function tileAt(f, x, y) { return grids[f][y][x]; }
  function setTile(f, x, y, ch) {
    const row = grids[f][y];
    grids[f][y] = row.slice(0, x) + ch + row.slice(x + 1);
  }

  function say(text) { msg = text; msgT = 110; }

  // —— 战斗预测 ——
  function forecast(id) {
    const m = MON[id];
    const dmgPer = m.atk - st.def;
    if (st.atk - m.def <= 0) return { no: true, rounds: 0, dmg: Infinity };
    const rounds = Math.ceil(m.hp / (st.atk - m.def));
    const hits = m.first ? rounds : rounds - 1;
    const dmg = Math.max(0, hits * Math.max(0, dmgPer));
    return { no: false, rounds, dmg };
  }

  function findTile(f, ch) {
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++)
      if (grids[f][y][x] === ch) return [x, y];
    return null;
  }

  // —— 上下楼 ——
  function goFloor(to, viaChar) {
    fadeDir = 1; fadeT = 12;
    fadeTo = () => {
      floor = to;
      maxFloor = Math.max(maxFloor, to);
      const p = findTile(to, viaChar) || findTile(to, to === 21 ? '>' : '<');
      px = p[0]; py = p[1];
      say('FLOOR ' + to);
    };
    save();
  }

  function startRun(fresh) {
    if (fresh || !load()) {
      grids = MAPS.map(m => m.slice());
      floor = 0;
      const p = findTile(0, 'x') || [1, 8];
      px = p[0]; py = p[1];
      st = newState();
      fairy1 = false; warpWing = false;
      maxFloor = 0;
    }
    msg = ''; msgT = 0;
    battle = null; shopSel = 0; warpSel = 0; dlgLines = null;
    fadeT = 0; paused = false;
    holdT = 0; lastMove = -99;
    scene = 'play';
    say('FLOOR ' + (floor + 1));
    save();
  }

  // —— 绘制辅助 ——
  function spr(api, art, x, y) {
    const rows = art.rows, map = art.map;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ci = map[row[c]];
        if (ci !== undefined) api.px(x + c, y + r, ci);
      }
    }
  }

  function drawTileFloor(api, sx, sy) {
    api.rect(sx, sy, TILE, TILE, FLOOR);
    api.px(sx + 3, sy + 3, FLOOR_D); api.px(sx + 12, sy + 3, FLOOR_D);
    api.px(sx + 7, sy + 8, FLOOR_D); api.px(sx + 3, sy + 12, FLOOR_D);
    api.px(sx + 12, sy + 12, FLOOR_D);
  }

  function drawTileWall(api, sx, sy) {
    api.rect(sx, sy, TILE, TILE, WALL);
    api.rect(sx, sy, TILE, 3, WALL_LT);
    api.rect(sx, sy + 7, TILE, 1, INK);
    api.rect(sx, sy + 8, TILE, 2, WALL_LT);
    api.px(sx + 5, sy + 4, INK); api.px(sx + 6, sy + 4, INK);
    api.px(sx + 5, sy + 5, INK); api.px(sx + 6, sy + 5, INK);
  }

  function drawDoor(api, sx, sy, ch) {
    const ci = ch === 'd' ? GOLD : ch === 'b' ? CYAN : RED;
    const dk = ch === 'd' ? YELLOW : ch === 'b' ? BLUE : DRED;
    drawTileFloor(api, sx, sy);
    api.rect(sx + 2, sy + 1, 12, 14, dk);
    api.rect(sx + 3, sy + 2, 10, 12, ci);
    api.rect(sx + 3, sy + 2, 10, 1, WHITE);
    api.px(sx + 7, sy + 7, INK); api.px(sx + 8, sy + 7, INK);
    api.px(sx + 7, sy + 8, INK); api.px(sx + 8, sy + 8, INK);
  }

  function drawStairs(api, sx, sy, ch) {
    drawTileFloor(api, sx, sy);
    const ci = ch === '<' ? WHITE : LGRAY;
    for (let i = 0; i < 3; i++) {
      const yy = ch === '<' ? sy + 12 - i * 4 : sy + 4 + i * 4;
      api.rect(sx + 2 + i * 2, yy, 12 - i * 4, 3, i === 0 ? LGRAY : i === 1 ? GRAY : DGRAY);
    }
    const ay = ch === '<' ? sy + 2 : sy + 11;
    for (let i = 0; i < 5; i++)
      api.px(sx + 8 + (i - 2) * 0, ay + (ch === '<' ? i : 4 - i), ci);
    if (api.frame % 30 < 18) {
      api.px(sx + 8, ay, WHITE); api.px(sx + 7, ay + 1, WHITE);
      api.px(sx + 9, ay + 1, WHITE);
    }
  }

  function drawItem(api, ch, sx, sy) {
    const cx = sx + 8, cy = sy + 8;
    switch (ch) {
      case 'k': case 'j': case 'i': {
        const ci = ch === 'k' ? GOLD : ch === 'j' ? CYAN : RED;
        api.rect(cx - 1, cy - 5, 2, 6, ci);          // 钥匙柄
        api.px(cx - 3, cy - 5, ci); api.px(cx - 4, cy - 4, ci);
        api.px(cx - 3, cy - 4, ci); api.px(cx - 4, cy - 3, ci);
        api.px(cx + 1, cy - 2, ci); api.px(cx + 2, cy - 2, ci);
        api.px(cx + 1, cy, ci); api.px(cx + 2, cy, ci);
        api.px(cx + 3, cy - 1, ci);
        break;
      }
      case 'u': case 'p': case 'U': case 'P': {
        const big = ch === 'U' || ch === 'P';
        const ci = (ch === 'u' || ch === 'U') ? RED : BLUE;
        const bw = big ? 6 : 4, bh = big ? 8 : 6;
        api.rect(cx - bw / 2, cy - bh / 2, bw, bh, ci);
        api.rect(cx - 1, cy - bh / 2 - 2, 2, 2, LGRAY);
        api.px(cx - bw / 2 + 1, cy - bh / 2 + 1, WHITE);
        break;
      }
      case 'a': case 's': {
        const ci = ch === 'a' ? RED : BLUE;
        for (let i = 0; i < 4; i++) {
          api.px(cx + i - 2 + 1, cy - 2 + Math.abs(i - 1.5) * 0, ci);
        }
        // 菱形宝石
        api.px(cx, cy - 4, ci); api.px(cx - 1, cy - 3, ci); api.px(cx + 1, cy - 3, ci);
        api.px(cx - 2, cy - 2, ci); api.px(cx, cy - 2, WHITE);
        api.px(cx + 2, cy - 2, ci); api.px(cx - 1, cy - 1, ci); api.px(cx + 1, cy - 1, ci);
        api.px(cx, cy, ci); api.px(cx - 1, cy + 1, LGRAY); api.px(cx, cy + 1, ci);
        break;
      }
      case 'A': case 'Z': case 'Q': case 'E': {      // 剑
        const tier = { A: STEEL, Z: WHITE, Q: GOLD, E: YELLOW }[ch];
        api.rect(cx, cy - 6, 2, 9, tier);            // 剑身
        api.px(cx, cy - 6, WHITE);
        api.rect(cx - 2, cy + 3, 6, 2, GOLD);        // 护手
        api.rect(cx, cy + 5, 2, 3, BROWN);           // 剑柄
        break;
      }
      case 'S': case 'X': case 'W': case 'R': {      // 盾
        const tier = { S: STEEL, X: WHITE, W: GOLD, R: YELLOW }[ch];
        api.rect(cx - 4, cy - 5, 8, 7, tier);
        api.rect(cx - 3, cy + 2, 6, 2, tier);
        api.rect(cx - 2, cy + 4, 4, 1, tier);
        api.rect(cx - 1, cy - 4, 2, 5, tier === GOLD ? ORANGE : GRAY);
        break;
      }
      case '$': {
        api.rect(sx + 3, sy + 6, 10, 7, DBROWN);
        api.rect(sx + 4, sy + 4, 8, 3, BROWN);
        api.rect(sx + 4, sy + 7, 8, 1, GOLD);
        api.rect(sx + 5, sy + 5, 2, 2, GOLD);
        break;
      }
    }
  }

  function drawMap(api) {
    const g = grids[floor];
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const ch = g[y][x];
      const sx = OX + x * TILE, sy = OY + y * TILE;
      if (ch === '#') drawTileWall(api, sx, sy);
      else {
        drawTileFloor(api, sx, sy);
        if (ch === '<' || ch === '>') drawStairs(api, sx, sy, ch);
        else if (DOORS[ch]) drawDoor(api, sx, sy, ch);
        else if (MON[ch]) spr(api, ART[ch], sx + 2, sy + 2);
        else if (ch === 'y') spr(api, ART.y, sx + 2, sy + 3);
        else drawItem(api, ch, sx, sy);
      }
    }
    // 玩家
    spr(api, ART.hero, OX + px * TILE + 2, OY + py * TILE + 2);
  }

  function panel(api, x, y, w, h, border) {
    api.rect(x, y, w, h, INK);
    api.rect(x, y, w, 1, border); api.rect(x, y + h - 1, w, 1, border);
    api.rect(x, y, 1, h, border); api.rect(x + w - 1, y, 1, h, border);
  }

  function centerText(api, s, y, ci, scale) {
    api.text(s, (W - api.textWidth(s, scale)) / 2, y, ci, scale);
  }

  function drawSidebar(api) {
    api.rect(SIDEX, 0, W - SIDEX, H, INK);
    api.rect(SIDEX, 0, 1, H, WALL);
    const cx = SIDEX + 4;
    api.text('FLOOR', cx, 5, SLATE);
    api.text(String(floor + 1).padStart(2, '0'), cx, 12, WHITE, 2);
    api.text('HP', cx, 28, SLATE);
    api.text(String(st.hp), cx, 34, st.hp < 1000 ? RED : GREEN);
    api.text('ATK', cx, 44, SLATE);
    api.text(String(st.atk), cx, 50, RED);
    api.text('DEF', cx, 60, SLATE);
    api.text(String(st.def), cx, 66, BLUE);
    api.text('GOLD', cx, 76, SLATE);
    api.text(String(st.gold), cx, 82, GOLD);
    // 钥匙
    const ky = 94;
    drawItem(api, 'k', SIDEX + 1, ky);
    api.text('X' + st.keyY, SIDEX + 16, ky + 6, YELLOW);
    drawItem(api, 'j', SIDEX + 1, ky + 14);
    api.text('X' + st.keyB, SIDEX + 16, ky + 20, CYAN);
    drawItem(api, 'i', SIDEX + 1, ky + 28);
    api.text('X' + st.keyR, SIDEX + 16, ky + 34, RED);
    if (warpWing)
      api.text('WARP:X', cx, 150, VIOLET);
    api.text('ENTER', cx, 162, SLATE);
    api.text('PAUSE', cx, 168, SLATE);
  }

  function drawMsg(api) {
    if (msgT <= 0) return;
    if (msgT < 20 && api.frame % 4 < 2) return;
    const w = api.textWidth(msg) + 8;
    const x = (SIDEX - w) / 2;
    panel(api, x, 2, w, 11, YELLOW);
    api.text(msg, x + 4, 5, YELLOW);
  }

  function drawBattle(api) {
    const b = battle;
    const m = MON[b.id];
    panel(api, 14, 40, 148, 96, RED);
    api.text('VS ' + m.n, 22, 46, WHITE, 2);
    api.text('HP ' + m.hp + ' ATK ' + m.atk + ' DEF ' + m.def, 22, 62, LGRAY);
    if (m.first) api.text('MAGIC FIRST STRIKE', 22, 70, MAGENTA);
    if (b.anim > 0) {                          // 战斗演出
      spr(api, ART[b.id], 104 - 6, 78);
      const shakeX = (api.frame % 2) * 2 - 1;
      api.text('-' + b.dmg, 110 + shakeX, 82, RED, 2);
      if (b.anim < 16) api.text('WIN!', 60, 46, GOLD, 2);
      return;
    }
    if (b.fc.no) {
      api.text('CANT WIN!', 22, 80, RED, 2);
      api.text('ATK TOO LOW', 22, 96, SLATE);
    } else {
      api.text('ROUNDS ' + b.fc.rounds, 22, 80, CYAN);
      const fatal = b.fc.dmg >= st.hp;
      api.text('LOSE ' + b.fc.dmg + ' HP', 22, 90, fatal ? RED : b.fc.dmg > st.hp * 0.4 ? ORANGE : LGRAY, 2);
      if (fatal) api.text('FATAL! REFUSE', 22, 104, RED);
    }
    api.text('Z:FIGHT X:RUN', 66, 122, YELLOW);
  }

  function drawShop(api) {
    panel(api, 20, 34, 200, 108, GOLD);
    api.text('SHOP', 92, 40, GOLD, 2);
    api.text('GOLD ' + st.gold, 138, 44, YELLOW);
    const opts = ['HP +600', 'ATK +4', 'DEF +4'];
    for (let i = 0; i < 3; i++) {
      const on = i === shopSel;
      api.text((on ? '> ' : '  ') + opts[i] + ' : 100G', 52, 58 + i * 14, on ? WHITE : LGRAY);
    }
    api.text('BUY WITH Z - LEAVE WITH X', 30, 108, SLATE);
    api.text('NO REFUNDS', 84, 122, DGRAY);
  }

  function drawDialog(api) {
    panel(api, 8, 128, 224, 48, VIOLET);
    let y = 133;
    for (const line of dlgLines.slice(dlgIdx, dlgIdx + 3)) {
      centerText(api, line, y, WHITE);
      y += 10;
    }
    if (api.frame % 30 < 20) centerText(api, 'Z', 166, YELLOW);
  }

  function drawWarp(api) {
    panel(api, 40, 40, 160, 104, CYAN);
    api.text('WARP WING', 82, 46, CYAN, 2);
    const maxF = warpMax();
    for (let f = 0; f < maxF; f++) {
      const col = f % 5, row = (f / 5) | 0;
      const x = 76 + col * 22, y = 64 + row * 16;
      const on = f === warpSel;
      api.text(String(f + 1).padStart(2, '0'), x, y, on ? INK : CYAN);
      if (on) {
        api.rect(x - 3, y - 2, api.textWidth('00') + 6, 9, CYAN);
        api.text(String(f + 1).padStart(2, '0'), x, y, INK);
      }
    }
    api.text('Z:FLY X:STAY', 88, 130, YELLOW);
  }

  function warpMax() { return Math.max(1, Math.min(21, (maxFloor != null ? maxFloor : floor) + 1)); }

  function drawTitle(api) {
    api.cls(INK);
    // 塔剪影
    for (let i = 0; i < 5; i++) {
      const tw = 26 + i * 8, tx = 120 - tw / 2, ty = 150 - i * 22;
      api.rect(tx, ty, tw, 22, i === 4 ? WALL : SLATE);
      api.rect(tx, ty, tw, 2, WALL_LT);
      api.px(tx + 4, ty + 8, INK); api.px(tx + 5, ty + 8, INK);
      api.px(tx + 4, ty + 9, INK); api.px(tx + 5, ty + 9, INK);
    }
    for (let i = 0; i < 26; i++)
      api.px((i * 61 + api.frame * 0.1) % W, (i * 47) % 70, i % 3 ? SLATE : LGRAY);
    centerText(api, 'MAGIC', 14, YELLOW, 3);
    centerText(api, 'TOWER', 34, GOLD, 3);
    const hasSave = (() => { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } })();
    const opts = hasSave ? ['NEW GAME', 'CONTINUE'] : ['NEW GAME'];
    for (let i = 0; i < opts.length; i++) {
      const on = i === shopSel;
      centerText(api, (on ? '> ' : '') + opts[i], 66 + i * 12, on ? WHITE : SLATE);
    }
    centerText(api, '21 FLOORS OF MONSTER MATH', 104, SLATE);
    if (api.frame % 60 < 38) centerText(api, 'PRESS Z', 118, CYAN);
    centerText(api, 'ARROWS MOVE - Z FIGHT - X CANCEL', 138, DGRAY);
    centerText(api, 'X ON STAIRS: WARP BETWEEN FLOORS', 150, DGRAY);
  }

  function drawEnding(api) {
    api.cls(INK);
    for (let i = 0; i < 40; i++)
      api.px((i * 53 + api.frame * 0.3) % W, (i * 97) % H, i % 4 ? SLATE : GOLD);
    centerText(api, 'THE DEVIL IS DEAD', 22, RED, 2);
    centerText(api, 'PRINCESS: THANK YOU HERO', 48, PINK);
    spr(api, ART.y, 112, 60);
    api.text('HP ' + st.hp, 96, 84, GREEN);
    api.text('ATK ' + st.atk + ' DEF ' + st.def, 78, 96, LGRAY);
    centerText(api, 'TOWER CLEARED!', 112, GOLD, 2);
    if (api.frame % 60 < 38) centerText(api, 'PRESS START', 140, WHITE);
  }

  // —— 交互 ——
  function tryMove(api, dx, dy) {
    const nx = px + dx, ny = py + dy;
    if (nx < 0 || nx >= MW || ny < 0 || ny >= MH) return;
    const ch = tileAt(floor, nx, ny);
    if (ch === '#') return;
    if (DOORS[ch]) {
      const key = DOORS[ch];
      if (st[key] > 0) {
        st[key]--;
        setTile(floor, nx, ny, '.');
        say(DOOR_CN[ch] + ' DOOR OPEN');
      } else {
        say('NEED ' + DOOR_CN[ch] + ' KEY');
      }
      return;
    }
    if (MON[ch]) {
      const fc = forecast(ch);
      battle = { x: nx, y: ny, id: ch, fc, anim: 0 };
      scene = 'battle';
      return;
    }
    if (ch === 'y') {
      if (floor === 4 && !fairy1) {
        dlgLines = ['FAIRY: BRAVE HERO...', 'TAKE THIS BLESSING', 'HP +1000'];
        dlgGrant = 'fairy1';
      } else if (floor === 8 && !warpWing) {
        dlgLines = ['FAIRY: TAKE THE WARP WING', 'PRESS X ON STAIRS', 'TO FLY ANY FLOOR'];
        dlgGrant = 'warp';
      } else {
        dlgLines = ['FAIRY: THE DEVIL WAITS', 'ON THE 21ST FLOOR...'];
        dlgGrant = null;
      }
      dlgIdx = 0;
      scene = 'dialog';
      return;
    }
    if (ch === '$') { scene = 'shop'; shopSel = 0; return; }
    // 可走:移动并拾取
    px = nx; py = ny;
    if (ITEMS[ch]) {
      ITEMS[ch].fn(st);
      setTile(floor, nx, ny, '.');
      say(ITEMS[ch].msg);
    }
    if (ch === '<') { goFloor(floor + 1, '>'); return; }
    if (ch === '>') { goFloor(floor - 1, '<'); return; }
  }

  function resolveBattleWin() {
    const b = battle;
    const m = MON[b.id];
    st.hp -= b.fc.dmg;
    st.gold += m.gold;
    setTile(floor, b.x, b.y, '.');
    px = b.x; py = b.y;
    if (b.id === 'L') {
      clearSave();
      scene = 'ending';
      battle = null;
      return;
    }
    say(m.gold ? 'WIN  +' + m.gold + 'G' : 'WIN');
    save();
    battle = null;
    scene = 'play';
  }

  function updatePlay(api) {
    const jp = api.justPressed;
    // 移动:单击一步;按住 10 帧后每 6 帧连走
    let dx = 0, dy = 0;
    if (api.pressed('left')) dx = -1;
    else if (api.pressed('right')) dx = 1;
    if (api.pressed('up')) dy = -1;
    else if (api.pressed('down')) dy = 1;
    if (dx || dy) {
      holdT++;
      if (jp('left') || jp('right') || jp('up') || jp('down') || holdT > 10) {
        if (api.frame - lastMove >= (holdT > 10 ? 5 : 0)) {
          tryMove(api, dx || 0, dy || 0);
          lastMove = api.frame;
        }
      }
    } else holdT = 0;
    // 楼梯上按 X:飞行
    const here = tileAt(floor, px, py);
    if (warpWing && (here === '<' || here === '>') && jp('b')) {
      warpSel = 0;
      scene = 'warp';
    }
  }

  return {
    name: 'MAGIC TOWER',
    version: '1.0',
    filter: 'none',

    /* 0黑 1墙 2墙亮 3地板 4地板暗 5白 6浅灰 7灰 8深灰 9红 10暗红 11橙 12黄
       13金 14绿 15暗绿 16青 17蓝 18深蓝 19紫 20粉 21肤 22棕 23深棕 24钢
       25岩蓝 26沙 27柠檬 28水鸭 29洋红 30紫罗兰 31藏青 */
    palette: [
      0x0000, 0x5A8E, 0x8C15, 0x2947, 0x18E5, 0xFFFF, 0xADB8, 0x7C32,
      0x426B, 0xF800, 0xA0C3, 0xFC86, 0xFE87, 0xFE40, 0x2EED, 0x1B67,
      0x07FF, 0x3B7F, 0x2129, 0x8ADE, 0xE25A, 0xFE72, 0x8AC5, 0x59C3,
      0xC65A, 0x5B30, 0xAF7F, 0xB7EF, 0x05F7, 0xF81F, 0x601F, 0x1082,
    ],

    init() {
      scene = 'title';
      shopSel = 0;
      grids = MAPS.map(m => m.slice());
      st = newState();
      floor = 0; px = 1; py = 8;
      fairy1 = false; warpWing = false; maxFloor = 0;
      msg = ''; msgT = 0; paused = false;
      battle = null; dlgLines = null;
      fadeT = 0; holdT = 0; lastMove = -99;
    },

    update(api) {
      const jp = api.justPressed;
      if (msgT > 0) msgT--;

      if (scene === 'title') {
        const hasSave = (() => { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } })();
        const n = hasSave ? 2 : 1;
        if (jp('down')) shopSel = (shopSel + 1) % n;
        if (jp('up')) shopSel = (shopSel + n - 1) % n;
        if (jp('a') || jp('start')) startRun(!hasSave || shopSel === 0);
        return;
      }
      if (scene === 'ending') {
        if (jp('start') || jp('a')) { scene = 'title'; shopSel = 0; }
        return;
      }
      if (scene === 'fade') {
        if (--fadeT <= 0) {
          if (fadeDir === 1) { fadeTo(); fadeDir = 2; fadeT = 12; }
          else { scene = 'play'; fadeT = 0; }
        }
        return;
      }
      if (paused) {
        if (jp('start')) paused = false;
        return;
      }
      if (jp('start') && (scene === 'play')) { paused = true; return; }

      if (scene === 'play') { updatePlay(api); return; }

      if (scene === 'battle') {
        const b = battle;
        if (b.anim > 0) {
          b.anim--;
          if (b.anim === 0) resolveBattleWin();
          return;
        }
        if (jp('b') || jp('left') || jp('right') || jp('up') || jp('down')) {
          battle = null; scene = 'play'; return;
        }
        if (jp('a') && !b.fc.no && b.fc.dmg < st.hp) {
          b.anim = 26;
          api.shake(2);
        } else if (jp('a')) {
          say('CANT FIGHT THAT');
        }
        return;
      }

      if (scene === 'shop') {
        if (jp('up')) shopSel = (shopSel + 2) % 3;
        if (jp('down')) shopSel = (shopSel + 1) % 3;
        if (jp('b')) { scene = 'play'; save(); return; }
        if (jp('a')) {
          if (st.gold >= 100) {
            st.gold -= 100;
            if (shopSel === 0) { st.hp += 600; say('HP +600'); }
            else if (shopSel === 1) { st.atk += 4; say('ATK +4'); }
            else { st.def += 4; say('DEF +4'); }
          } else say('NOT ENOUGH GOLD');
        }
        return;
      }

      if (scene === 'dialog') {
        if (jp('a') || jp('b')) {
          if (dlgIdx + 3 < dlgLines.length) dlgIdx += 3;
          else {
            if (dlgGrant === 'fairy1') { fairy1 = true; st.hp += 1000; say('HP +1000'); }
            else if (dlgGrant === 'warp') { warpWing = true; say('GOT WARP WING'); }
            save();
            scene = 'play';
          }
        }
        return;
      }

      if (scene === 'warp') {
        const maxF = warpMax();
        if (jp('b')) { scene = 'play'; return; }
        if (jp('left')) warpSel = Math.max(0, warpSel - 1);
        if (jp('right')) warpSel = Math.min(maxF - 1, warpSel + 1);
        if (jp('up')) warpSel = Math.max(0, warpSel - 5);
        if (jp('down')) warpSel = Math.min(maxF - 1, warpSel + 5);
        if (jp('a') && warpSel !== floor) {
          const to = warpSel;
          fadeDir = 1; fadeT = 12;
          fadeTo = () => {
            floor = to;
            const p = findTile(to, '<') || findTile(to, '>');
            px = p[0]; py = p[1];
            say('FLOOR ' + (to + 1));
          };
          scene = 'fade';
          save();
        }
        return;
      }
    },

    draw(api) {
      if (scene === 'title') { drawTitle(api); return; }
      if (scene === 'ending') { drawEnding(api); return; }
      api.cls(INK);
      drawMap(api);
      drawSidebar(api);
      drawMsg(api);
      if (scene === 'battle' && battle) drawBattle(api);
      if (scene === 'shop') drawShop(api);
      if (scene === 'dialog') drawDialog(api);
      if (scene === 'warp') drawWarp(api);
      if (paused) {
        panel(api, 78, 76, 84, 28, WHITE);
        centerText(api, 'PAUSED', 84, WHITE, 2);
        centerText(api, 'ENTER:RESUME', 94, SLATE);
      }
      if (fadeT > 0) {                          // 楼层切换黑场
        const a = fadeDir === 1 ? 12 - fadeT : fadeT;
        const rows = Math.floor(a / 12 * 180);
        api.rect(0, 0, W, rows, INK);
        if (a > 5) centerText(api, 'FLOOR ' + (floor + 1), 86, YELLOW, 2);
      }
    },

    /* 供平衡校验脚本读取(不影响运行) */
    _data: { MAPS, MON, ITEMS, forecastStub: (id, st) => {
      const m = MON[id];
      if (st.atk - m.def <= 0) return { no: true, rounds: 0, dmg: Infinity };
      const rounds = Math.ceil(m.hp / (st.atk - m.def));
      const hits = m.first ? rounds : rounds - 1;
      return { no: false, rounds, dmg: Math.max(0, hits * Math.max(0, m.atk - st.def)) };
    } },
  };
})();
