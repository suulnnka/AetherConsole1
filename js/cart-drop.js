/*
 * 卡带:DEEP DROP · 是男人就下 100 层(v1.0)
 * 颜色模式 A:16 色调色板;240×180 索引帧缓冲
 * 输入:←→ / A D 移动 · Z / J / ↑ 跳 · ↓ 快落 / 按住下穿过平台落下
 *   · Enter 开始/暂停
 * 玩法:竖版下落闯关——洞顶尖刺不断逼近,只能不停往下跳;
 *   平台 5 种:岩石(常规)/ 冰移(左右滑动)/ 龟裂(踩上即碎)/ 尖刺(致命)/
 *   弹簧(高高弹起);落点越靠平台中心越有 PERFECT 加分连击;
 *   每 10 层提示一次,100 层达成"真汉子"庆祝后继续无尽;
 *   最佳层数记入 localStorage
 * 打击感:落地 squash + 尘爆 + 平台下陷 · 弹簧拉伸 + 气环 ·
 *   龟裂平台抖动碎裂 · 尖刺死亡命中停顿 + 红闪 · 快落速度线 ·
 *   洞壁火把光晕 / 视差浮尘
 */
const DeepDropCart = (function () {
  'use strict';

  const W = 240, H = 180;
  const GRAV = 0.24, TERM = 3.6, TERM_FAST = 4.8;
  const TAU = Math.PI * 2;

  // —— 调色板索引 ——
  const BG = 0, INK = 1, WALL = 2, ROCK = 3, LGRAY = 4, WHITE = 5, RED = 6,
        ORANGE = 7, YELLOW = 8, GOLD = 9, GREEN = 10, CYAN = 11, VIOLET = 12,
        PINK = 13, ICE = 14, SLATE = 15;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const irnd = (a, b) => (a + Math.random() * (b - a)) | 0;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // —— 状态 ——
  let scene, paused, frame, freeze, flashT;
  let px, py, vx, vy, grounded, dropT, sy, perfectCt, perfectCombo;
  let plats, parts, rings, pops, camY, lastGenY, nextId, floors, bestY, platId;
  let bannerT, bannerA, bannerB, deathT, overT, best, dust;
  let mileNext, celebrateT, milestoneFlash;

  function loadBest() {
    try { const s = localStorage.getItem('ac_dp_best'); if (s) return +s || 0; } catch (e) {}
    return 0;
  }
  function saveBest() {
    if (floors > best) { best = floors; try { localStorage.setItem('ac_dp_best', String(best)); } catch (e) {} }
  }

  function burst(x, y, n, ci, sp, life, g) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), s = rnd(sp * 0.25, sp);
      const m = irnd(life * 0.6, life);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.8,
                   ci, life: m, max: m, g: g === undefined ? 0.12 : g });
    }
  }
  function pop(t, x, y, ci) { pops.push({ t, x, y, ci, life: 42 }); }

  // —— 平台生成:行距 26-38,宽度随深度收窄,深水区组合概率上升 ——
  function genRow() {
    const y = lastGenY + irnd(26, 38);
    lastGenY = y;
    const d = floors;
    const wMax = Math.max(38, 74 - d * 0.4);
    const wMin = Math.max(30, wMax - 26);
    const roll = Math.random();
    let type = 'N';
    if (d > 2) {
      if (roll < 0.16) type = 'M';
      else if (roll < 0.3) type = 'C';
      else if (roll < 0.42) type = 'S';
      else if (roll < 0.5) type = 'B';
    }
    const w = irnd(wMin, wMax);
    const p = { id: nextId++, x: irnd(16, W - 16 - w), y, w, type,
                vx: 0, crumbleT: -1, broken: false, bump: 0 };
    if (type === 'M') p.vx = rnd(0.45, 0.85) * (irnd(0, 2) ? 1 : -1);
    plats.push(p);
    // 深水区偶尔补第二块(不重叠、不出界),路线更多变
    if (d > 6 && Math.random() < 0.3 && type !== 'M') {
      const w2 = irnd(30, Math.max(31, wMax - 10));
      let x2;
      if (p.x > W / 2) x2 = irnd(16, Math.max(17, p.x - 12 - w2));
      else {
        const lo = Math.min(p.x + p.w + 12, W - 16 - w2);
        x2 = irnd(lo, W - 16 - w2);
      }
      if (x2 >= 16 && x2 + w2 <= W - 16)
        plats.push({ id: nextId++, x: x2, y, w: w2,
                     type: Math.random() < 0.3 ? 'S' : 'N',
                     vx: 0, crumbleT: -1, broken: false, bump: 0 });
    }
  }
  function ensureGen() {
    while (lastGenY < camY + H + 60) genRow();
    while (plats.length && plats[0].y < camY - 80) plats.shift();
  }

  function resetRun() {
    scene = 'play'; paused = false;
    px = W / 2; py = 60; vx = 0; vy = 0;
    grounded = false; dropT = 0; sy = 1;
    plats = []; parts = []; rings = []; pops = [];
    camY = 0; lastGenY = 14;
    nextId = 1; floors = 0; bestY = 0; platId = 0;
    perfectCt = 0; perfectCombo = 0;
    // 开局:一块起步平台
    plats.push({ id: nextId++, x: W / 2 - 30, y: 76, w: 60, type: 'N',
                 vx: 0, crumbleT: -1, broken: false, bump: 0 });
    lastGenY = 76;
    py = 60; vy = 0;
    ensureGen();
    bannerT = 100; bannerA = 'DROP!'; bannerB = 'DO NOT STOP';
    freeze = 0; flashT = 0; deathT = 0; overT = 0;
    mileNext = 10; celebrateT = 0; milestoneFlash = 0;
  }

  function doDeath(api, why) {
    scene = 'dying';
    deathT = 0;
    freeze = 9;
    flashT = 6;
    api.shake(5);
    burst(px, py, 26, why === 'spike' ? RED : WHITE, 3, 34);
    burst(px, py, 14, ORANGE, 2.2, 26);
    rings.push({ x: px, y: py, r: 3, ci: RED, spd: 1.4 });
    saveBest();
  }

  function landOn(api, p, impact) {
    if (p.type === 'S') { doDeath(api, 'spike'); return; }  // 尖刺平台
    grounded = true;
    platId = p.id;
    py = p.y;
    vy = 0;
    sy = clamp(1 - impact * 0.06, 0.55, 0.9);               // squash
    p.bump = 4;
    burst(px, py, 3 + (impact * 1.6 | 0), LGRAY, 1 + impact * 0.2, 10);
    if (impact > 3.2) api.shake(0.9);
    if (p.type === 'C' && p.crumbleT < 0) p.crumbleT = 26;  // 龟裂开始
    // 层数:必须落在比以往更深的新平台上
    if (p.y > bestY) {
      bestY = p.y;
      floors++;
      const off = Math.abs(px - (p.x + p.w / 2));
      if (off < p.w * 0.15) {                              // 中心落点
        perfectCt++;
        perfectCombo++;
        pop(perfectCombo > 1 ? 'PERFECT X' + perfectCombo : 'PERFECT',
            px - 14, p.y - 14, CYAN);
        api.shake(0.8);
      } else perfectCombo = 0;
      if (floors >= mileNext) {                            // 每 10 层
        mileNext += 10;
        milestoneFlash = 3;
        pop(floors + ' FLOORS!', 84, camY + 44, YELLOW);
        if (floors === 100) {                              // 真汉子!
          bannerT = 160; bannerA = 'REAL MAN!'; bannerB = '100 FLOORS DOWN';
          celebrateT = 120;
          flashT = 4;
          api.shake(3);
          for (let i = 0; i < 44; i++)
            burst(rnd(20, W - 20), camY + rnd(0, 60), 1,
                  [GOLD, CYAN, PINK, GREEN, YELLOW][irnd(0, 5)], 2.2, 60, 0.06);
        }
      }
    }
    if (p.type === 'B') {                                   // 弹簧(计数后弹起)
      vy = -5.7;
      grounded = false;
      sy = 1.5;
      api.shake(1.6);
      rings.push({ x: px, y: p.y - 2, r: 2, ci: GOLD, spd: 1.5 });
      burst(px, p.y, 10, YELLOW, 2, 16, 0.06);
      pop('BOING!', px - 10, p.y - 16, YELLOW);
    }
  }

  function updatePlay(api) {
    frame++;
    if (flashT > 0) flashT--;
    if (bannerT > 0) bannerT--;
    if (milestoneFlash > 0) milestoneFlash--;
    updateParts();
    if (freeze > 0) { freeze--; return; }                  // 命中停顿
    if (celebrateT > 0) celebrateT--;

    // —— 镜头:固定下压速度 + 追赶快落 ——
    const spd = Math.min(2.2, 0.45 + floors * 0.009);
    camY += spd;
    if (py - camY > 118) camY = py - 118;
    ensureGen();

    // —— 输入 ——
    const jp = api.justPressed;
    const down = api.pressed('down');
    if (api.pressed('left')) vx -= 0.35;
    if (api.pressed('right')) vx += 0.35;
    if (!api.pressed('left') && !api.pressed('right')) vx *= 0.82;
    vx = clamp(vx, -1.75, 1.75);

    if (grounded && (jp('a') || jp('up'))) {               // 跳
      vy = -3.1;
      grounded = false;
      sy = 1.3;
      burst(px, py, 4, LGRAY, 1, 9);
    }
    if (down && grounded) {                                // 按住下:穿落
      grounded = false;
      vy = Math.max(vy, 0.8);
      dropT = 9;
    }

    // —— 纵向 ——
    const prevBottom = py;
    vy += GRAV;
    if (!grounded && down) vy += 0.22;                     // 空中快落
    vy = Math.min(vy, down ? TERM_FAST : TERM);
    py += vy;
    if (dropT > 0) dropT--;
    px = clamp(px + vx, 14, W - 14);

    // —— 落平台 ——
    const wasGrounded = grounded;
    const impact = vy;
    grounded = false;
    if (vy >= 0 && dropT <= 0) {
      for (const p of plats) {
        if (p.broken) continue;
        if (px + 3 > p.x && px - 3 < p.x + p.w &&
            prevBottom <= p.y + 0.01 && py >= p.y) {
          landOn(api, p, impact);
          break;
        }
      }
    }
    if (scene !== 'play') return;                          // 尖刺致死后收手
    if (!grounded && wasGrounded) sy = Math.max(sy, 1.05); // 离台微拉伸
    sy += (1 - sy) * 0.16;

    // —— 平台行为 ——
    for (const p of plats) {
      if (p.bump > 0) p.bump--;
      if (p.type === 'M' && !p.broken) {
        p.x += p.vx;
        if (p.x < 16) { p.x = 16; p.vx = Math.abs(p.vx); }
        if (p.x + p.w > W - 16) { p.x = W - 16 - p.w; p.vx = -Math.abs(p.vx); }
        if (grounded && platId === p.id) px = clamp(px + p.vx, 14, W - 14);  // 带着玩家走
      }
      if (p.type === 'C' && p.crumbleT > 0) {
        p.crumbleT--;
        if (p.crumbleT === 0) {                            // 碎裂
          p.broken = true;
          if (grounded && platId === p.id) { grounded = false; vy = 0.4; }
          for (let i = 0; i < 10; i++)
            parts.push({ x: p.x + rnd(2, p.w - 2), y: p.y + rnd(0, 3),
                         vx: rnd(-0.5, 0.5), vy: rnd(0.5, 1.6),
                         ci: i % 2 ? LGRAY : SLATE, life: irnd(14, 26),
                         max: 26, g: 0.1 });
          api.shake(0.8);
        }
      }
    }

    // —— 顶刺(被追上即死)——
    if (py - camY < 12) { doDeath(api, 'crush'); return; }
    // —— 落到画面外(理论上不会,保险)——
    if (py - camY > H + 20) { doDeath(api, 'crush'); return; }

    // —— 快落速度线 ——
    if (vy > 3.8 && frame % 2 === 0)
      parts.push({ x: px + rnd(-6, 6), y: py - 14, vx: 0, vy: -2.4,
                   ci: ICE, life: 6, max: 6, g: 0 });
    // —— 浮尘(下坠感:尘自屏幕下缘向上飘)——
    if (frame % 5 === 0)
      dust.push({ x: rnd(20, W - 20), y: H + 2, v: rnd(0.6, 1.4) });
  }

  function updateParts() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy; p.vy += p.g;
      if (--p.life <= 0) parts.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += r.spd;
      if (r.r > 30) rings.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      pops[i].y -= 0.4;
      if (--pops[i].life <= 0) pops.splice(i, 1);
    }
    for (let i = dust.length - 1; i >= 0; i--) {
      dust[i].y -= dust[i].v;
      if (dust[i].y < -2) dust.splice(i, 1);
    }
  }

  // —— 绘制 ——
  function drawCave(api) {
    api.cls(BG);
    for (const d of dust)                                   // 浮尘(屏幕空间)
      api.px(d.x, d.y | 0, d.v > 1 ? SLATE : WALL);
    // 左右洞壁
    for (let y = 0; y < H; y++) {
      const wy = (camY + y) | 0;
      api.rect(0, y, 12, 1, WALL);
      api.rect(W - 12, y, 12, 1, WALL);
      if (wy % 7 === 0) { api.px(3 + (wy % 11), y, ROCK); api.px(6 + (wy % 5), y, SLATE); }
      if (wy % 9 === 0) { api.px(W - 4 - (wy % 9), y, ROCK); api.px(W - 8 - (wy % 4), y, SLATE); }
    }
    // 火把:每 64 世界像素一对,摇曳光晕
    for (let ty = Math.floor(camY / 64) * 64; ty < camY + H + 64; ty += 64) {
      const y = (ty - camY) | 0;
      if (y < -4 || y > H + 4) continue;
      for (const tx of [9, W - 9]) {
        api.rect(tx - 1, y, 2, 5, SLATE);
        const fl = api.frame % 10 < 5;
        api.rect(tx - 1, y - 3, 2, 3, fl ? ORANGE : YELLOW);
        api.px(tx, y - 4, fl ? YELLOW : ORANGE);
        api.px(tx - 2, y - 3, INK); api.px(tx + 1, y - 3, INK);   // 光晕暗环
        api.px(tx, y - 6, INK);
      }
    }
    // 顶部尖刺(死亡线)
    const jit = api.frame % 14 < 7 ? 0 : 1;
    api.rect(0, 0, W, 5, WALL);
    for (let x = 0; x < W; x += 6) {
      api.px(x + 2 + jit, 5, WHITE);
      api.rect(x + 1 + jit, 6, 3, 1, LGRAY);
      api.rect(x + 1 + jit, 7, 3, 2, RED);
    }
    api.rect(0, 9, W, 1, INK);
  }

  function drawPlat(api, p) {
    const y = ((p.y - camY) | 0) + (p.bump > 0 ? 1 : 0);
    const x = p.x | 0;
    if (y < -8 || y > H + 8) return;
    let jit = 0;
    if (p.type === 'C' && p.crumbleT > 0) jit = (api.frame % 2) ? 1 : -1;   // 龟裂抖动
    const yy = y + jit;
    if (p.type === 'S') {                                   // 尖刺平台
      api.rect(x, yy + 3, p.w, 3, ROCK);
      for (let i = 0; i < p.w - 4; i += 5) {
        api.px(x + i + 2, yy, WHITE);
        api.rect(x + i + 1, yy + 1, 3, 1, LGRAY);
        api.rect(x + i + 1, yy + 2, 3, 1, RED);
      }
      return;
    }
    if (p.type === 'B') {                                   // 弹簧平台
      const c = api.frame % 12 < 6;
      api.rect(x + 2, yy, p.w - 4, 2, c ? YELLOW : GOLD);   // 簧圈
      api.rect(x, yy + 2, p.w, 4, GOLD);
      api.rect(x, yy + 5, p.w, 1, ORANGE);
      return;
    }
    if (p.type === 'M') {                                   // 冰移平台
      api.rect(x, yy, p.w, 4, ICE);
      api.rect(x, yy, p.w, 1, WHITE);
      const d = p.vx > 0 ? 1 : -1;
      api.rect(d > 0 ? x + p.w - 3 : x + 1, yy + 2, 2, 1, CYAN);
      return;
    }
    if (p.type === 'C') {                                   // 龟裂平台
      const ci = p.crumbleT > 0 && api.frame % 4 < 2 ? WHITE : LGRAY;
      api.rect(x, yy, p.w, 4, ci);
      api.rect(x, yy + 3, p.w, 1, SLATE);
      for (let i = 6; i < p.w - 3; i += 9) {
        api.px(x + i, yy + 1, SLATE); api.px(x + i + 1, yy + 1, SLATE);
        api.px(x + i + 2, yy + 2, SLATE);
      }
      return;
    }
    api.rect(x, yy, p.w, 4, ROCK);                          // 岩石平台
    api.rect(x, yy, p.w, 1, GREEN);                         // 苔顶
    api.rect(x, yy + 3, p.w, 1, SLATE);
    api.px(x, yy + 1, SLATE); api.px(x + p.w - 1, yy + 1, SLATE);
  }

  function drawPlayer(api) {
    const x = px | 0, y = py | 0;
    const hgt = 12 * sy, wid = 8 * (2 - sy);
    const top = (y - hgt) | 0;
    const halfW = (wid / 2) | 0;
    const dead = scene === 'dying';
    api.rect(x - halfW, top + 3, wid, hgt - 3, CYAN);       // 身体
    api.rect(x - halfW + 1, top + 5, 2, 2, INK);            // 背带
    api.rect(x - halfW + (halfW - 2), top + 5, 2, 2, INK);
    api.rect(x - 3, top, 6, 4, PINK);                       // 脸
    if (dead) {                                             // 死亡 X 眼
      api.px(x - 2, top + 1, INK); api.px(x, top + 3, INK);
      api.px(x, top + 1, INK); api.px(x - 2, top + 3, INK);
    } else api.rect(x - 1, top + 1, 2, 2, INK);             // 眼睛
    api.rect(x - 4, top - 2, 8, 3, YELLOW);                 // 安全帽
    api.rect(x - 4, top, 8, 1, ORANGE);
    api.px(x + (vx > 0.3 ? 4 : -4), top - 1, WHITE);        // 头灯
    if (vy < -1) api.rect(x - halfW + 1, top + hgt, 2, 2, INK);   // 收腿
  }

  function drawFx(api) {
    for (const p of parts) {
      if (p.life < p.max * 0.3 && api.frame % 2) continue;
      api.px(p.x, p.y - camY, p.ci);
    }
    for (const r of rings) {
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = i * TAU / n;
        api.px(r.x + Math.cos(a) * r.r, r.y - camY + Math.sin(a) * r.r * 0.6, r.ci);
      }
    }
    for (const p of pops) {
      if (p.life < 12 && api.frame % 4 >= 2) continue;
      api.text(p.t, p.x | 0, (p.y - camY) | 0, INK);
      api.text(p.t, (p.x - 1) | 0, (p.y - camY - 1) | 0, p.ci);
    }
    if (milestoneFlash > 0 || celebrateT > 0) {             // 层数达成闪光边框
      const t = 3;
      api.rect(0, 0, W, t, YELLOW); api.rect(0, H - t, W, t, YELLOW);
      api.rect(0, 0, t, H, YELLOW); api.rect(W - t, 0, t, H, YELLOW);
    }
    if (flashT > 0) api.rect(0, 0, W, H, RED);
    // 顶刺迫近警示
    const gap = py - camY - 12;
    if (gap < 40 && api.frame % 10 < 5) {
      api.rect(0, 10, W, 2, RED);
    }
  }

  function drawHud(api) {
    const fTxt = String(floors);
    api.text(fTxt, (W - api.textWidth(fTxt, 3)) / 2, 14, WHITE, 3);
    api.text('FLOOR', (W - api.textWidth('FLOOR')) / 2, 30, LGRAY);
    api.text('BEST ' + Math.max(best, floors), 3, 14, GOLD);
    api.text('PERFECT ' + perfectCt, 3, 22, CYAN);
    if (perfectCombo >= 2) api.text('X' + perfectCombo, 3, 30, YELLOW);
  }

  function centerText(api, s, y, ci, scale) {
    api.text(s, (W - api.textWidth(s, scale)) / 2, y, ci, scale);
  }
  function centerShadow(api, s, y, ci, scale) {
    const x = (W - api.textWidth(s, scale)) / 2;
    api.text(s, x + 1, y + 1, INK, scale);
    api.text(s, x, y, ci, scale);
  }

  function drawTitle(api) {
    api.cls(BG);
    // 演示:平台匀速上移
    const camDemo = api.frame * 1.1;
    for (let i = 0; i < 8; i++) {
      const y = ((i * 46 + 30 - camDemo) % 368 + 368) % 368 - 40;
      if (y < -10 || y > H + 10) continue;
      const w = 50 + (i * 13) % 26;
      const x = 20 + (i * 71) % (W - 60 - w);
      api.rect(x, y, w, 4, ROCK);
      api.rect(x, y, w, 1, GREEN);
      api.rect(x, y + 3, w, 1, SLATE);
    }
    for (let i = 0; i < 30; i++)                            // 浮尘
      api.px((i * 61 + 13) % W, (i * 47 + api.frame * ((i % 3) + 1) * 0.4) % H,
             i % 3 ? WALL : SLATE);
    centerShadow(api, 'DEEP DROP', 16, CYAN, 3);
    centerText(api, 'FALL 100 FLOORS', 38, YELLOW);
    if (best > 0) centerText(api, 'BEST ' + best + ' FLOORS', 50, GOLD);
    if (api.frame % 60 < 38) centerShadow(api, 'PRESS START', 96, WHITE);
    centerText(api, 'LEFT RIGHT - MOVE', 114, LGRAY);
    centerText(api, 'Z - JUMP  DOWN - DROP', 124, LGRAY);
    centerText(api, 'DO NOT TOUCH THE CEILING', 134, SLATE);
    centerText(api, 'SPIKED PLATFORMS KILL', 144, SLATE);
  }

  return {
    name: 'DEEP DROP',
    version: '1.0',
    filter: 'none',

    /* RGB565(16 色):0黑 1深蓝 2洞壁 3岩 4浅灰 5白 6红 7橙 8黄 9金
       10绿(苔) 11青 12紫 13粉 14冰 15岩灰 */
    palette: [
      0x0000, 0x1082, 0x2129, 0x3A28, 0xADB8, 0xFFFF, 0xF800,
      0xFC86, 0xFE87, 0xFE40, 0x2EED, 0x07FF, 0x8ADE, 0xE25A,
      0xAF7F, 0x5B30,
    ],

    init() {
      scene = 'title'; paused = false;
      frame = 0; freeze = 0; flashT = 0;
      px = W / 2; py = 60; vx = 0; vy = 0;
      grounded = false; dropT = 0; sy = 1;
      plats = []; parts = []; rings = []; pops = []; dust = [];
      camY = 0; lastGenY = 0; nextId = 1;
      floors = 0; bestY = 0; platId = 0;
      perfectCt = 0; perfectCombo = 0;
      bannerT = 0; deathT = 0; overT = 0;
      mileNext = 10; celebrateT = 0; milestoneFlash = 0;
      best = loadBest();
    },

    update(api) {
      frame++;
      const jp = api.justPressed;
      if (scene === 'title') {
        if (jp('start') || jp('a')) resetRun();
        return;
      }
      if (scene === 'dying') {
        deathT++;
        updateParts();
        if (deathT > 55) { scene = 'over'; overT = 0; }
        return;
      }
      if (scene === 'over') {
        overT++;
        updateParts();
        if (overT > 30 && (jp('start') || jp('a'))) scene = 'title';
        return;
      }
      if (jp('start')) paused = !paused;
      if (paused) return;
      updatePlay(api);
    },

    draw(api) {
      if (scene === 'title') { drawTitle(api); return; }
      drawCave(api);
      for (const p of plats) drawPlat(api, p);
      if (!(scene === 'dying' && deathT <= 12)) drawPlayer(api);
      drawFx(api);
      drawHud(api);

      if (bannerT > 0 && (bannerT > 16 || api.frame % 4 < 2)) {
        centerShadow(api, bannerA, 62, WHITE, 2);
        if (bannerB) centerText(api, bannerB, 80, YELLOW);
      }
      if (scene === 'over') {
        api.rect(36, 50, 168, 84, INK);
        api.rect(36, 50, 168, 1, RED); api.rect(36, 133, 168, 1, RED);
        api.rect(36, 50, 1, 84, RED); api.rect(203, 50, 1, 84, RED);
        if (floors >= 100) {
          centerShadow(api, 'REAL MAN!', 56, GOLD, 2);
        } else {
          centerShadow(api, 'GAME OVER', 56, RED, 2);
        }
        centerText(api, floors + ' FLOORS DOWN', 82, WHITE);
        centerText(api, 'PERFECT ' + perfectCt, 94, CYAN);
        centerText(api, 'BEST ' + best + ' FLOORS', 106, YELLOW);
        if (overT > 30 && api.frame % 60 < 38) centerShadow(api, 'PRESS START', 120, WHITE);
      }
      if (paused) {
        api.rect(86, 78, 68, 22, INK);
        api.rect(86, 78, 68, 1, WHITE); api.rect(86, 99, 68, 1, WHITE);
        api.rect(86, 78, 1, 22, WHITE); api.rect(153, 78, 1, 22, WHITE);
        centerShadow(api, 'PAUSED', 84, WHITE, 2);
      }
    },
  };
})();
