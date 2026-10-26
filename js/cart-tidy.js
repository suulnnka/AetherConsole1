/*
 * 卡带:TIDY UP! · 双屏整理游戏(v1.0)
 * 颜色模式 A:24 色调色板;240×180 索引帧缓冲
 * 两个屏幕:X/B 键(或鼠标右键)手动切换
 *   屏 1 · 地板:物品散落在仓库地板上,走过去 Z(或鼠标点)捡起
 *   屏 2 · 货架:三排货架各归一类(红书 / 绿瓶 / 蓝盒),把手中物品放回对应货架
 * 规则:最多同时拿 5 件;拿到第 5 件自动切到货架屏;放空手自动切回地板屏;
 *   放错货架算失误(扣分);全部归位过关,按用时与失误评 S/A/B/C
 * 输入:方向键 / WASD 移动 · Z/J/左键 拿起 / 放置 · X/K/右键 或 B 切屏 ·
 *   Enter 开始 / 暂停;鼠标可直接点物品 / 点货架空位放置
 */
const TidyUpCart = (function () {
  'use strict';

  const W = 240, H = 180;
  const HUD_H = 15, TRAY_H = 17;                 // 顶部信息条 / 底部手持栏
  const FLOOR_TOP = HUD_H, FLOOR_BOT = H - TRAY_H;
  const MAX_HOLD = 5;
  const CATS = [
    { n: 'BOOK', ci: 9, dark: 10 },              // 红 · 书
    { n: 'BOTTLE', ci: 13, dark: 14 },           // 绿 · 瓶
    { n: 'BOX', ci: 16, dark: 17 },              // 蓝 · 盒
  ];
  const SLOTS = 6;                                // 每排货架 6 格

  // —— 调色板索引 ——
  const INK = 0, BG = 1, FLOORC = 2, FLOORD = 3, WALLC = 4, WALLD = 5,
        WHITE = 6, LGRAY = 7, GRAY = 8, RED = 9, DRED = 10, ORANGE = 11,
        YELLOW = 12, GREEN = 13, DGREEN = 14, DBLUE2 = 15, BLUE = 16,
        DBLUE = 17, SKIN = 18, BROWN = 19, CYAN = 20, PINK = 21, VIOLET = 22,
        SLATE = 23, DGRAY = 3;      // DGRAY 复用 FLOOR_D(深灰蓝)

  const rnd = (a, b) => a + Math.random() * (b - a);
  const irnd = (a, b) => (a + Math.random() * (b - a)) | 0;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // —— 状态 ——
  let scene;                 // title/play/clear/transition/pause
  let level, items, shelves, crates;
  let hold;                  // 手持物品类别数组
  let player;                // {x,y,face,walk}
  let screenMode;            // 'floor' | 'shelf'
  let timeF, score, mistakes, combo;
  let transT, transTo;
  let pops, parts;
  let clearT, rank;
  let blinkT;
  let paused;

  const SAVE_KEY = 'ac_tidy_best';

  function loadBest() {
    try { const s = localStorage.getItem(SAVE_KEY); if (s) return JSON.parse(s); } catch (e) {}
    return { lv: 0, sc: 0 };
  }
  function saveBest() {
    try {
      const b = loadBest();
      if (level > b.lv || (level === b.lv && score > b.sc))
        localStorage.setItem(SAVE_KEY, JSON.stringify({ lv: level, sc: score }));
    } catch (e) {}
  }

  function levelItemCount(lv) { return Math.min(18, 6 + (lv - 1) * 3); }

  function buildLevel(lv) {
    const n = levelItemCount(lv);
    items = [];
    // 均衡分配三类,每类最多 SLOTS 个
    const counts = [0, 0, 0];
    for (let i = 0; i < n; i++) counts[i % 3]++;
    for (let c = 0; c < 3; c++)
      for (let i = 0; i < counts[c]; i++)
        items.push({ x: 0, y: 0, cat: c, taken: false, bob: Math.random() * 6.28 });
    // 地板障碍(木箱):随关卡增多
    crates = [];
    const nCr = Math.min(5, 1 + ((lv - 1) / 2 | 0));
    for (let i = 0; i < nCr; i++) {
      let ok = false, x, y;
      for (let t = 0; t < 40 && !ok; t++) {
        x = irnd(14, 200); y = irnd(FLOOR_TOP + 8, FLOOR_BOT - 26);
        ok = crates.every(c => Math.abs(c.x - x) > 34 || Math.abs(c.y - y) > 26);
      }
      crates.push({ x, y, w: 22, h: 16 });
    }
    // 散落物品:避开障碍与玩家出生点
    for (const it of items) {
      let ok = false;
      for (let t = 0; t < 80 && !ok; t++) {
        it.x = rnd(12, 228); it.y = rnd(FLOOR_TOP + 8, FLOOR_BOT - 8);
        ok = crates.every(c => it.x < c.x - 6 || it.x > c.x + c.w + 6 ||
                               it.y < c.y - 6 || it.y > c.y + c.h + 6) &&
             Math.hypot(it.x - 120, it.y - (FLOOR_TOP + FLOOR_BOT) / 2) > 24;
      }
    }
    // 货架:三排,每排类别随机排列
    const order = [0, 1, 2];
    for (let i = order.length - 1; i > 0; i--) {
      const j = irnd(0, i + 1); const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    shelves = order.map((cat, r) => ({
      cat, y: 30 + r * 40, slots: Array(SLOTS).fill(null),
    }));
    hold = [];
    screenMode = 'floor';
    timeF = 0; combo = 0;
    player = { x: 120, y: (FLOOR_TOP + FLOOR_BOT) / 2, face: 1, walk: 0 };
    pops = []; parts = [];
    scene = 'play';
    transT = 0;
  }

  function startTransition(to) {
    if (scene !== 'play' || transT > 0) return;
    transTo = to; transT = 18;
    scene = 'transition';
  }

  function pop(t, x, y, ci) { pops.push({ t, x, y, ci, life: 40 }); }
  function burst(x, y, ci, n) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(0.4, 1.8);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6,
                   ci, life: irnd(14, 30) });
    }
  }

  // —— 手持栏绘制序:越后拿的显示越上 ——
  function pickup(it) {
    if (hold.length >= MAX_HOLD) return false;
    it.taken = true;
    hold.push(it.cat);
    burst(it.x, it.y, WHITE, 6);
    pop('+1', it.x, it.y - 6, WHITE);
    if (hold.length >= MAX_HOLD) startTransition('shelf');
    return true;
  }

  function placeAt(shelf, slotIdx) {
    const want = shelf.cat;
    const idx = hold.indexOf(want);
    if (idx < 0) return false;
    if (shelf.slots[slotIdx] != null) return false;
    hold.splice(idx, 1);
    shelf.slots[slotIdx] = want;
    const sx = slotX(slotIdx);
    combo++;
    const pts = 100 + (combo - 1) * 10;
    score += pts;
    burst(sx + 8, shelf.y + 8, CATS[want].ci, 10);
    pop('+' + pts, sx + 8, shelf.y - 2, YELLOW);
    if (hold.length === 0 && !levelDone()) startTransition('floor');
    return true;
  }

  function slotX(i) { return 18 + i * 36; }

  function mistakeAt(api, shelf, x, y) {
    mistakes++; combo = 0; score = Math.max(0, score - 50);
    pop('WRONG SHELF!', x, y, RED);
    api.shake(1.5);
    void shelf;
  }

  function shelfFull(s) { return s.slots.every(v => v != null); }

  function levelDone() {
    return items.every(i => i.taken) && hold.length === 0 &&
           shelves.every(s => s.slots.filter(v => v != null).length ===
                               items.filter(i => i.cat === s.cat).length);
  }

  function targetTime() { return 18 + items.length * 5; }

  function calcRank() {
    const t = timeF / 60;
    const tt = targetTime();
    if (mistakes === 0 && t <= tt) return 'S';
    if (t <= tt * 1.35 && mistakes <= 2) return 'A';
    if (t <= tt * 1.9) return 'B';
    return 'C';
  }

  // —— 移动 ——
  function tryMove(px, py, spd, solidCheck) {
    let nx = player.x + px * spd;
    let ny = player.y + py * spd;
    if (solidCheck && solidCheck(nx, player.y)) nx = player.x;
    if (solidCheck && solidCheck(player.x, ny)) ny = player.y;
    player.x = clamp(nx, 10, W - 10);
    player.y = clamp(ny, FLOOR_TOP + 8, FLOOR_BOT - 6);
    if (px) player.face = px > 0 ? 1 : -1;
    if (px || py) player.walk += 0.22;
  }

  function collideCrates(x, y) {
    for (const c of crates)
      if (x > c.x - 7 && x < c.x + c.w + 7 && y > c.y - 7 && y < c.y + c.h + 7)
        return true;
    return false;
  }

  // —— 绘制 ——
  function drawItemIcon(api, cat, x, y, bobOff) {
    const yy = y + (bobOff || 0);
    switch (cat) {
      case 0:                                      // 书
        api.rect(x - 5, yy - 4, 10, 9, DRED);
        api.rect(x - 4, yy - 4, 8, 8, RED);
        api.rect(x - 1, yy - 3, 1, 6, WHITE);
        api.px(x - 4, yy + 4, DRED); api.px(x + 3, yy + 4, DRED);
        break;
      case 1:                                      // 瓶
        api.rect(x - 3, yy - 3, 6, 8, GREEN);
        api.rect(x - 2, yy - 6, 4, 3, GREEN);
        api.px(x - 2, yy + 4, DGREEN); api.px(x - 1, yy + 4, DGREEN);
        api.px(x, yy + 4, DGREEN); api.px(x + 1, yy + 4, DGREEN);
        api.px(x - 2, yy - 2, LGRAY);
        break;
      case 2:                                      // 盒
        api.rect(x - 5, yy - 4, 10, 9, BLUE);
        api.rect(x - 5, yy - 1, 10, 2, DBLUE);
        api.rect(x - 1, yy - 4, 2, 9, DBLUE);
        api.px(x - 4, yy - 3, LGRAY);
        break;
    }
  }

  function drawRobot(api, x, y) {
    const bob = Math.sin(player.walk) * 1.2;
    const yy = y + bob;
    // 头顶货堆(最多 5 件,叠罗汉)
    for (let i = 0; i < hold.length; i++)
      drawItemIcon(api, hold[i], x, yy - 16 - i * 8, 0);
    // 身体
    api.rect(x - 7, yy - 9, 14, 13, LGRAY);
    api.rect(x - 7, yy - 9, 14, 2, WHITE);
    api.rect(x - 7, yy + 2, 14, 2, GRAY);
    // 眼
    api.px(x - 4, yy - 5, INK); api.px(x - 3, yy - 5, INK);
    api.px(x + 2, yy - 5, INK); api.px(x + 3, yy - 5, INK);
    if (blinkT % 180 < 6) {                        // 眨眼
      api.rect(x - 4, yy - 5, 2, 1, LGRAY);
      api.rect(x + 2, yy - 5, 2, 1, LGRAY);
    }
    // 天线
    api.px(x, yy - 11, GRAY); api.px(x, yy - 12, GRAY);
    api.px(x, yy - 13, RED);
    // 轮子
    const wr = Math.sin(player.walk * 2) * 1;
    api.rect(x - 5, yy + 4 + wr, 3, 3, DGRAY);
    api.rect(x + 2, yy + 4 - wr, 3, 3, DGRAY);
    // 手臂指向
    api.rect(x + (player.face > 0 ? 7 : -9), yy - 3, 2, 4, GRAY);
  }

  function drawFloorRoom(api) {
    api.cls(BG);
    api.rect(0, HUD_H, W, FLOOR_BOT - HUD_H, FLOORC);
    // 地板格纹
    for (let y = HUD_H; y < FLOOR_BOT; y += 16)
      for (let x = ((y / 16) % 2) * 8; x < W; x += 16)
        api.rect(x, y, 15, 15, FLOORD);
    // 墙裙
    api.rect(0, HUD_H, W, 3, WALLD);
    // 木箱
    for (const c of crates) {
      api.rect(c.x, c.y, c.w, c.h, BROWN);
      api.rect(c.x, c.y, c.w, 2, SKIN);
      api.rect(c.x, c.y + c.h - 2, c.w, 2, DBLUE2); // 深棕底(占位色修正见 palette)
      api.rect(c.x + c.w / 2 - 1, c.y, 2, c.h, SKIN);
      api.rect(c.x, c.y + c.h / 2 - 1, c.w, 2, SKIN);
    }
    // 散落物品
    for (const it of items) {
      if (it.taken) continue;
      it.bob += 0.05;
      drawItemIcon(api, it.cat, it.x, it.y, Math.sin(it.bob) * 1.2);
      // 影子
      api.rect(it.x - 3, it.y + 6, 6, 1, FLOORD);
    }
  }

  function drawShelfRoom(api) {
    api.cls(BG);
    api.rect(0, HUD_H, W, FLOOR_BOT - HUD_H, WALLC);
    // 后墙条纹
    for (let y = HUD_H + 4; y < FLOOR_BOT; y += 8)
      api.rect(0, y, W, 3, WALLD);
    // 三排货架
    for (const s of shelves) {
      const cat = CATS[s.cat];
      // 格位
      for (let i = 0; i < SLOTS; i++) {
        const x = slotX(i);
        api.rect(x, s.y - 2, 32, 16, WALLD);
        api.rect(x + 1, s.y - 1, 30, 14, BG);
        if (s.slots[i] != null) drawItemIcon(api, s.slots[i], x + 16, s.y + 5, 0);
      }
      // 层板 + 类别标签
      api.rect(14, s.y + 14, 208, 4, BROWN);
      api.rect(14, s.y + 14, 208, 1, SKIN);
      api.rect(16, s.y + 20, 14, 7, cat.ci);
      api.text(cat.n, 34, s.y + 21, cat.ci);
    }
    // 地面
    api.rect(0, FLOOR_BOT - 4, W, 4, WALLD);
  }

  function drawHud(api) {
    api.rect(0, 0, W, HUD_H, INK);
    api.rect(0, HUD_H - 1, W, 1, SLATE);
    const mm = (timeF / 60 / 60) | 0, ss = ((timeF / 60) | 0) % 60;
    api.text('LV' + level, 3, 5, WHITE);
    api.text(mm + ':' + String(ss).padStart(2, '0'), 40, 5, YELLOW);
    api.text(String(score).padStart(6, '0'), 82, 5, CYAN);
    api.text('MISS ' + mistakes, 130, 5, mistakes ? RED : SLATE);
    const sTxt = screenMode === 'floor' ? 'FLOOR' : 'SHELF';
    api.text(sTxt, W - 3 - api.textWidth(sTxt), 5, VIOLET);
    // 底部手持栏
    api.rect(0, FLOOR_BOT, W, TRAY_H, INK);
    api.rect(0, FLOOR_BOT, W, 1, SLATE);
    for (let i = 0; i < MAX_HOLD; i++) {
      const x = 108 + i * 22;
      api.rect(x, FLOOR_BOT + 2, 18, 13, hold[i] != null ? GRAY : DGRAY);
      api.rect(x + 1, FLOOR_BOT + 3, 16, 11, INK);
      if (hold[i] != null) drawItemIcon(api, hold[i], x + 9, FLOOR_BOT + 9, 0);
    }
    api.text('HOLD', 78, FLOOR_BOT + 6, SLATE);
    const left = items.filter(i => !i.taken).length;
    api.text('LEFT ' + left, 3, FLOOR_BOT + 6, LGRAY);
  }

  function drawFx(api) {
    for (const p of parts) {
      if (p.life < 8 && api.frame % 2) continue;
      api.px(p.x, p.y, p.ci);
    }
    for (const p of pops) {
      api.text(p.t, p.x - api.textWidth(p.t) / 2, p.y, p.ci);
    }
    // 鼠标光标
    const c = api.cursor();
    if (c.on && scene === 'play') {
      api.px(c.x, c.y, WHITE); api.px(c.x - 1, c.y - 1, LGRAY);
      api.px(c.x + 1, c.y - 1, LGRAY); api.px(c.x - 1, c.y + 1, LGRAY);
      api.px(c.x + 1, c.y + 1, LGRAY);
    }
  }

  function drawTitle(api) {
    api.cls(INK);
    for (let i = 0; i < 30; i++)
      api.px((i * 53 + api.frame * 0.2) % W, (i * 97) % H, i % 4 ? SLATE : GRAY);
    const bob = Math.sin(api.frame * 0.05) * 3;
    // 标题货架
    for (let r = 0; r < 2; r++) {
      api.rect(50, 34 + r * 26, 140, 3, BROWN);
      for (let i = 0; i < 4; i++)
        drawItemIcon(api, (i + r) % 3, 70 + i * 36, 30 + r * 26, 0);
    }
    api.text('TIDY UP!', (W - api.textWidth('TIDY UP!', 3)) / 2, 96 + bob, YELLOW, 3);
    api.text('PICK 5 - SORT THEM - RINSE REPEAT', 22, 118, LGRAY);
    const b = loadBest();
    if (b.lv) api.text('BEST LV' + b.lv + ' ' + b.sc, 88, 130, CYAN);
    if (api.frame % 60 < 38)
      api.text('PRESS START', (W - api.textWidth('PRESS START', 2)) / 2, 144, WHITE, 2);
    api.text('ARROWS/WASD MOVE - Z PICK/PLACE', 16, 162, SLATE);
    api.text('X SWITCH SCREEN - MOUSE OK', 30, 170, SLATE);
  }

  function drawClear(api) {
    panelC(api, 40, 44, 160, 92, YELLOW);
    api.text('LEVEL ' + level + ' CLEAR', (W - api.textWidth('LEVEL ' + level + ' CLEAR', 2)) / 2, 52, WHITE, 2);
    const t = (timeF / 60) | 0;
    api.text('TIME ' + t + 'S', 92, 70, LGRAY);
    api.text('SCORE ' + score, 88, 80, CYAN);
    api.text('MISS ' + mistakes, 92, 90, mistakes ? RED : GREEN);
    const rc = rank === 'S' ? YELLOW : rank === 'A' ? CYAN : rank === 'B' ? LGRAY : SLATE;
    api.text('RANK ' + rank, (W - api.textWidth('RANK ' + rank, 3)) / 2, 100, rc, 3);
    if (api.frame % 50 < 34)
      api.text('Z: NEXT LEVEL', (W - api.textWidth('Z: NEXT LEVEL')) / 2, 122, WHITE);
  }

  function panelC(api, x, y, w, h, border) {
    api.rect(x, y, w, h, INK);
    api.rect(x, y, w, 1, border); api.rect(x, y + h - 1, w, 1, border);
    api.rect(x, y, 1, h, border); api.rect(x + w - 1, y, 1, h, border);
  }

  function centerText(api, s, y, ci, scale) {
    api.text(s, (W - api.textWidth(s, scale)) / 2, y, ci, scale);
  }

  return {
    name: 'TIDY UP!',
    version: '1.0',
    filter: 'none',

    /* 0黑 1底 2地板 3地板暗 4墙 5墙暗 6白 7浅灰 8灰 9红 10暗红 11橙 12黄
       13绿 14暗绿 15深棕 16蓝 17深蓝 18肤 19棕 20青 21粉 22紫 23岩灰 */
    palette: [
      0x0000, 0x18C3, 0x39E3, 0x2126, 0x6B0D, 0x4A4A, 0xFFFF, 0xADB8,
      0x7C32, 0xF800, 0x9801, 0xFC86, 0xFE87, 0x2EED, 0x1B67, 0x5920,
      0x2BFF, 0x1082, 0xFE72, 0x8AC5, 0x07FF, 0xE25A, 0x8ADE, 0x5B30,
    ],

    init() {
      scene = 'title';
      level = 1; score = 0; mistakes = 0;
      items = []; shelves = []; crates = []; hold = [];
      player = { x: 120, y: 90, face: 1, walk: 0 };
      timeF = 0; combo = 0; transT = 0; blinkT = 0;
      pops = []; parts = []; paused = false;
    },

    update(api) {
      const jp = api.justPressed;
      blinkT++;

      if (scene === 'title') {
        if (jp('start') || jp('a')) {
          level = 1; score = 0; mistakes = 0;
          buildLevel(level);
        }
        return;
      }
      if (paused) {
        if (jp('start')) paused = false;
        return;
      }
      if (scene === 'clear') {
        if (jp('a') || jp('start')) {
          level++;
          mistakes = 0;
          buildLevel(level);
        }
        return;
      }
      if (scene === 'transition') {
        if (--transT <= 0) {
          screenMode = transTo;
          scene = 'play';
        }
        return;
      }

      // —— play ——
      timeF++;
      if (jp('start')) { paused = true; return; }

      // 切屏(X/B):双向都允许手动切
      if (jp('b')) {
        startTransition(screenMode === 'floor' ? 'shelf' : 'floor');
      }

      // 移动
      let dx = 0, dy = 0;
      if (api.pressed('left')) dx -= 1;
      if (api.pressed('right')) dx += 1;
      if (api.pressed('up')) dy -= 1;
      if (api.pressed('down')) dy += 1;
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        const spd = 1.5;
        const solid = screenMode === 'floor' ? collideCrates : null;
        tryMove(dx / len, dy / len, spd, solid);
      } else player.walk = 0;

      const c = api.cursor();
      const click = jp('a');

      if (screenMode === 'floor') {
        // 捡起:候选=玩家身边的物品;光标悬停某物品时优先捡它,否则捡最近
        if (click) {
          const near = items.filter(it => !it.taken &&
            Math.hypot(it.x - player.x, it.y - player.y) < 22);
          let best = null;
          if (c.on) {
            let bd = 14;
            for (const it of near) {
              const d = Math.hypot(it.x - c.x, it.y - c.y);
              if (d < bd) { bd = d; best = it; }
            }
          }
          if (!best && near.length) {
            let bd = 1e9;
            for (const it of near) {
              const d = Math.hypot(it.x - player.x, it.y - player.y);
              if (d < bd) { bd = d; best = it; }
            }
          }
          if (best) pickup(best);
          else if (hold.length >= MAX_HOLD) pop('FULL!', player.x, player.y - 14, RED);
          else if (c.on) pop('TOO FAR', c.x, c.y - 8, RED);
        }
      } else {
        // 货架屏:优先按光标点的格位放;否则放到最近一排的左起第一个空位
        let slotHit = null;
        if (c.on) {
          for (const s of shelves) {
            for (let i = 0; i < SLOTS; i++) {
              const x = slotX(i);
              if (c.x >= x && c.x < x + 32 && c.y >= s.y - 2 && c.y < s.y + 14)
                slotHit = { s, i };
            }
          }
        }
        if (click && hold.length > 0) {
          if (slotHit) {
            if (slotHit.s.slots[slotHit.i] == null) {
              if (hold.includes(slotHit.s.cat)) placeAt(slotHit.s, slotHit.i);
              else mistakeAt(api, slotHit.s, c.x, c.y - 6);
            }
          } else {
            let best = null, bd = 1e9;
            for (const s of shelves) {
              const d = Math.abs(s.y + 6 - player.y);
              if (d < bd) { bd = d; best = s; }
            }
            const want = best.cat;
            if (hold.includes(want)) {
              const idx = best.slots.indexOf(null);
              if (idx >= 0) placeAt(best, idx);
            } else mistakeAt(api, best, player.x, player.y - 14);
          }
        }
      }

      // 粒子 / 弹字
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.06;
        if (--p.life <= 0) parts.splice(i, 1);
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].y -= 0.4;
        if (--pops[i].life <= 0) pops.splice(i, 1);
      }

      // 过关判定
      if (levelDone() && transT <= 0) {
        rank = calcRank();
        saveBest();
        scene = 'clear';
        clearT = 0;
      }
    },

    draw(api) {
      if (scene === 'title') { drawTitle(api); return; }
      if (screenMode === 'shelf') drawShelfRoom(api);
      else drawFloorRoom(api);
      drawRobot(api, player.x, player.y);
      drawHud(api);
      drawFx(api);

      if (scene === 'clear') drawClear(api);
      if (paused) {
        panelC(api, 80, 76, 80, 28, WHITE);
        centerText(api, 'PAUSED', 84, WHITE, 2);
        centerText(api, 'ENTER:RESUME', 94, SLATE);
      }
      // 切屏转场:横向擦除
      if (scene === 'transition' || transT > 0) {
        const t = transT;
        const half = 9;
        let cover;
        if (t > half) cover = (t - half) / half;      // 关屏
        else cover = 1 - t / half;                     // 开屏
        const wpx = Math.round(W * cover);
        api.rect(0, 0, wpx, H, INK);
        if (cover > 0.4) {
          const s = transTo === 'shelf' ? 'SHELF' : 'FLOOR';
          api.text(s, (W - api.textWidth(s, 2)) / 2, 84, YELLOW, 2);
        }
      }
    },
    /* 调试探针(只读,不影响玩法) */
    _debug: () => ({ scene, screenMode, hold: hold.length,
                     left: items.filter(i => !i.taken).length,
                     placed: shelves.reduce((a, s) => a + s.slots.filter(v => v != null).length, 0),
                     shelves: shelves.map(s => s.cat),
                     player: { x: Math.round(player.x), y: Math.round(player.y) },
                     score, mistakes, time: timeF }),
  };
})();
