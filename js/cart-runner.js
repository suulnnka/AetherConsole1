/*
 * 卡带:PIXEL DASH · 横版无尽跑酷(v1.0)
 * 颜色模式 A:24 色调色板;240×180 索引帧缓冲
 * 输入:Z / J / ↑ / W 跳(按住跳更高,空中再按=二段跳)· ↓ / S 滑铲(空中=快落)
 *   · Enter 开始/暂停
 * 玩法:自动向右奔跑,越过深坑 / 尖刺 / 箱堆 / 高墙,钻过低杠,吃金币;
 *   距离即分数,速度随距离提升,每 600M 有 SPEED UP 里程碑;
 *   落点中心判定 / 擦险加分 / 金币连击;最佳成绩记入 localStorage
 * 打击感:土狼时间 + 跳跃缓冲 · 落地 squash + 尘爆 + 微震 ·
 *   二段跳气环 · 滑铲尘尾 · 金币闪光弹字 · 死亡命中停顿 + 红闪 + 爆炸 ·
 *   视差山丘 / 云层 / 地面滚动纹理
 */
const PixelDashCart = (function () {
  'use strict';

  const W = 240, H = 180;
  const GY = 150;                  // 地面顶
  const GRAV = 0.24, JUMP_V = -3.9, DJUMP_V = -3.45;
  const TAU = Math.PI * 2;

  // —— 调色板索引 ——
  const BG = 0, INK = 1, SKY1 = 2, SKY2 = 3, SKY3 = 4, WHITE = 5, LGRAY = 6,
        MTF = 7, MTN = 8, HILL = 9, GRASS = 10, GRASSD = 11, DIRT = 12,
        DIRTD = 13, ORANGE = 14, RED = 15, GOLD = 16, YELLOW = 17, CYAN = 18,
        SLATE = 19, VIOLET = 20, PINK = 21, ICE = 22, GREEN = 23;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const irnd = (a, b) => (a + Math.random() * (b - a)) | 0;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // —— 状态 ——
  let scene, paused, frame, freeze, flashT;
  let wx, py, vy, v, jumps, coyote, jbuf, sliding, grounded, groundT, sy;
  let pits, obst, plats, coins, parts, rings, pops;
  let genX, dist, nextMile, coinCt, combo, comboT, deathT, overT, best;
  let scarf, clouds, shakeNext;

  function loadBest() {
    try { const s = localStorage.getItem('ac_rd_best'); if (s) return +s || 0; } catch (e) {}
    return 0;
  }
  function saveBest() {
    if (score() > best) { best = score(); try { localStorage.setItem('ac_rd_best', String(best)); } catch (e) {} }
  }
  const score = () => (dist + coinCt * 15) | 0;

  function burst(x, y, n, ci, sp, life, g) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), s = rnd(sp * 0.25, sp);
      const m = irnd(life * 0.6, life);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.8,
                   ci, life: m, max: m, g: g || 0.1 });
    }
  }
  function pop(t, x, y, ci) { pops.push({ t, x, y, ci, life: 40 }); }

  // —— 地形查询 ——
  const camX = () => wx - 52;
  function inPit(x) {
    for (const p of pits) if (x > p.x0 + 2 && x < p.x1 - 2) return p;
    return null;
  }

  // —— 关卡生成:按速度与距离投放特征,保证可通过 ——
  function genNext() {
    const d = clamp(dist / 120, 0, 10);                    // 难度 0..10
    const r = Math.random();
    if (r < 0.2 && d > 0.5) {                              // 深坑
      const w = clamp(irnd(26, 34 + d * 4), 26, 62);
      pits.push({ x0: genX, x1: genX + w });
      const n = irnd(3, 5);                                // 坑上金币弧线
      for (let i = 0; i < n; i++)
        coins.push({ x: genX + (w * i) / (n - 1), y: GY - 26 - Math.sin((i / (n - 1)) * Math.PI) * 22, t: 0 });
      genX += w;
    } else if (r < 0.38) {                                 // 尖刺
      const w = irnd(10, 14 + d * 2);
      obst.push({ kind: 'spike', x: genX, y: GY, w, h: 7 });
      genX += w;
    } else if (r < 0.55) {                                 // 箱堆(1-2 层)
      const st = irnd(1, d > 3 ? 3 : 2);
      obst.push({ kind: 'crate', x: genX, y: GY, w: 13, h: 13 * st });
      genX += 13;
    } else if (r < 0.68 && d > 1.5) {                      // 高墙(要二段跳)
      obst.push({ kind: 'wall', x: genX, y: GY, w: 10, h: irnd(28, 30 + d * 2) });
      genX += 10;
    } else if (r < 0.82 && d > 1) {                        // 低杠(要滑铲)
      obst.push({ kind: 'bar', x: genX, y0: GY - 26, y1: GY - 12, w: irnd(34, 52) });
      coins.push({ x: genX + 17, y: GY - 7, t: 0 });
      genX += irnd(34, 52);
    } else if (r < 0.92) {                                 // 浮台 + 金币
      const len = irnd(44, 72), py2 = irnd(104, 128);
      plats.push({ x: genX, y: py2, w: len });
      for (let i = 0; i < 4; i++)
        coins.push({ x: genX + 8 + i * (len - 16) / 3, y: py2 - 16, t: 0 });
      genX += len + irnd(0, 20);
    } else {                                               // 平地金币列
      const n = irnd(4, 7);
      for (let i = 0; i < n; i++)
        coins.push({ x: genX + i * 12, y: GY - 12 - (i % 2) * 5, t: 0 });
      genX += n * 12;
    }
    genX += Math.max(30, 46 + v * 9 - d * 2);              // 特征间隔随速度放大
  }
  function ensureGen() {
    while (genX < camX() + W + 140) genNext();
    const cut = camX() - 60;
    pits = pits.filter(p => p.x1 > cut);
    obst = obst.filter(o => o.x + o.w > cut);
    plats = plats.filter(p => p.x + p.w > cut);
    coins = coins.filter(c => c.x > cut && !c.taken);
  }

  function resetRun() {
    scene = 'play'; paused = false;
    wx = 60; py = GY; vy = 0; v = 2.3; jumps = 0;
    coyote = 0; jbuf = 0; sliding = false; grounded = true; groundT = 0; sy = 1;
    pits = []; obst = []; plats = []; coins = []; parts = []; rings = []; pops = [];
    genX = 220;
    dist = 0; nextMile = 400; coinCt = 0; combo = 0; comboT = 0;
    freeze = 0; flashT = 0; deathT = 0; overT = 0;
    scarf = [];
    ensureGen();
  }

  function doDeath(api) {
    scene = 'dying';
    deathT = 0;
    freeze = 10;
    flashT = 6;
    api.shake(5);
    burst(wx, py - 6, 30, ORANGE, 3.2, 36);
    burst(wx, py - 6, 16, WHITE, 2.4, 26);
    burst(wx, py - 6, 10, RED, 2, 30);
    rings.push({ x: wx, y: py - 6, r: 3, ci: WHITE, spd: 1.6 });
  }

  function updatePlay(api) {
    frame++;
    if (flashT > 0) flashT--;
    if (comboT > 0 && --comboT <= 0) combo = 0;
    updateParts();
    if (freeze > 0) { freeze--; return; }                  // 命中停顿

    // —— 速度成长 ——
    v = Math.min(4.8, v + 0.00035);
    dist += v / 10;
    if (dist >= nextMile) {                                // 里程碑
      nextMile += 500;
      v = Math.min(4.8, v + 0.12);
      flashT = 2;
      api.shake(1.2);
      pop('SPEED UP!', 96, 60, CYAN);
      burst(52, py - 14, 12, CYAN, 2.2, 18, 0);
    }

    const prevY = py;
    wx += v;
    ensureGen();

    // —— 输入 ——
    const jp = api.justPressed;
    const onGroundInput = api.pressed('down');
    if (grounded || coyote > 0) {
      if (onGroundInput && !sliding) {                     // 起滑
        sliding = true;
        burst(wx, py, 6, LGRAY, 1.4, 12);
      }
      if (!onGroundInput) sliding = false;
    }
    if (jp('a') || jp('up')) jbuf = 7;
    if (jbuf > 0) jbuf--;
    if (coyote > 0) coyote--;

    // —— 跳跃(土狼 + 缓冲 + 可变高度)——
    if (jbuf > 0 && (grounded || coyote > 0 || jumps < 2)) {
      const canGround = grounded || coyote > 0;
      if (canGround) {
        vy = JUMP_V; jumps = 1;
        burst(wx, py, 5, LGRAY, 1.2, 10);
      } else if (jumps < 2) {
        vy = DJUMP_V; jumps = 2;
        sy = 1.35;
        rings.push({ x: wx, y: py - 8, r: 2, ci: ICE, spd: 1.3 });
        burst(wx, py - 4, 7, ICE, 1.6, 14, 0);
      }
      jbuf = 0; coyote = 0; grounded = false; sliding = false;
      sy = 1.3;
    }
    if (!api.pressed('a') && !api.pressed('up') && vy < -1.5) vy += 0.34;  // 松键截断

    // —— 纵向 ——
    vy += GRAV;
    if (!grounded && onGroundInput) vy += 0.22;            // 空中快落
    vy = Math.min(vy, 5.2);
    py += vy;

    // —— 落地检测 ——
    const wasGrounded = grounded;
    const impact = vy;
    grounded = false;
    if (vy >= 0) {
      for (const p of plats) {                             // 浮台(单向)
        if (wx > p.x - 4 && wx < p.x + p.w + 4 && prevY <= p.y + 0.01 && py >= p.y) {
          py = p.y; land(api, wasGrounded, impact); break;
        }
      }
      if (!grounded && py >= GY && !inPit(wx)) {           // 地面
        py = GY; land(api, wasGrounded, impact);
      }
    }
    if (wasGrounded && !grounded) {                        // 走出边缘:土狼时间
      coyote = 6;
      jumps = Math.max(jumps, 1);                          // 地面跳只能在土狼期内用
    }

    // —— 掉坑 ——
    if (py > H + 12) { doDeath(api); return; }

    // —— 跑步 / 滑铲尘土 ——
    if (grounded) {
      groundT++;
      const rate = sliding ? 3 : 6;
      if (groundT % rate === 0)
        parts.push({ x: wx - 5, y: py - (sliding ? 2 : 0), vx: -v * 0.5 + rnd(-0.3, 0.3),
                     vy: rnd(-0.6, -0.1), ci: LGRAY, life: 10, max: 10, g: 0.04 });
    }
    sy += (1 - sy) * 0.18;                                 // squash 恢复

    // —— 碰撞:障碍 ——
    const top = py - (sliding ? 7 : 13);
    for (const o of obst) {
      if (o.kind === 'bar') {
        if (wx + 4 > o.x && wx - 4 < o.x + o.w && top < o.y1 && py > o.y0) { doDeath(api); return; }
      } else if (o.kind === 'spike') {
        if (wx + 3 > o.x + 1 && wx - 3 < o.x + o.w - 1 && py > o.y - 5) { doDeath(api); return; }
      } else {
        if (wx + 3 > o.x + 1 && wx - 3 < o.x + o.w - 1 && top < o.y && py > o.y - o.h) { doDeath(api); return; }
      }
    }

    // —— 金币 ——
    for (const c of coins) {
      c.t++;
      if (!c.taken && Math.abs(c.x - wx) < 9 && Math.abs(c.y - (py - 7)) < 12) {
        c.taken = true;
        coinCt++;
        combo++; comboT = 100;
        burst(c.x, c.y, 7, GOLD, 1.6, 14, 0);
        if (combo > 0 && combo % 10 === 0) {
          pop('COIN X' + combo + '!', c.x - 16, c.y - 14, YELLOW);
          api.shake(1);
        }
      }
    }

    // 围巾轨迹
    scarf.unshift([wx - 4, py - 10]);
    if (scarf.length > 6) scarf.pop();
  }

  function land(api, wasGrounded, impact) {
    grounded = true; jumps = 0; vy = 0; coyote = 0;
    if (!wasGrounded) {
      sy = clamp(1 - impact * 0.075, 0.55, 0.92);          // 落地压缩
      burst(wx, py, 4 + (impact * 2.4 | 0), LGRAY, 1.2 + impact * 0.25, 12);
      if (impact > 3.4) api.shake(1);
    }
  }

  function updateParts() {
    for (const c of clouds) {                              // 云随镜头漂移
      c.x -= v * 0.16 + 0.05;
      if (c.x < -40) { c.x = W + rnd(10, 80); c.y = irnd(12, 70); }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy; p.vy += p.g;
      if (--p.life <= 0) parts.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += r.spd;
      if (r.r > 26) rings.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      pops[i].y -= 0.4;
      if (--pops[i].life <= 0) pops.splice(i, 1);
    }
  }

  // —— 绘制 ——
  const ridgeF = (x) => 22 + 14 * Math.sin(x * 0.013) + 8 * Math.sin(x * 0.037 + 1.3);
  const ridgeN = (x) => 12 + 9 * Math.sin(x * 0.021 + 2.1) + 5 * Math.sin(x * 0.053 + 0.7);

  function drawBg(api) {
    api.cls(SKY1);
    api.rect(0, 30, W, 50, SKY2);
    api.rect(0, 80, W, 40, SKY3);
    const sx = 190, sy2 = 34;                              // 太阳
    api.rect(sx - 4, sy2, 9, 9, YELLOW);
    api.rect(sx - 2, sy2 - 2, 5, 13, YELLOW);
    api.rect(sx - 6, sy2 + 2, 13, 5, YELLOW);
    for (const c of clouds) {                              // 云
      api.rect(c.x, c.y, 22, 4, WHITE);
      api.rect(c.x + 4, c.y - 3, 12, 3, WHITE);
    }
    const ox = camX();
    for (let x = 0; x < W; x++) {                          // 远山
      const h = Math.max(3, ridgeF(x + ox * 0.12) | 0);
      api.rect(x, 122 - h, 1, h, MTF);
    }
    for (let x = 0; x < W; x++) {                          // 近丘
      const h = Math.max(2, ridgeN(x + ox * 0.3) | 0);
      api.rect(x, 130 - h, 1, h, MTN);
    }
    api.rect(0, 122, W, 28, HILL);                         // 丘陵地带
    for (let x = 0; x < W; x += 3)                         // 丘纹
      if (((x + (ox * 0.3 | 0)) % 17) < 3) api.rect(x, 124, 2, 1, HILL);
  }

  function drawGround(api) {
    const ox = camX();
    for (let x = 0; x < W; x++) {
      const wxq = ox + x;
      if (inPit(wxq)) {                                    // 深坑:黑暗深渊 + 内壁
        api.rect(x, GY - 2, 1, H - GY + 2, INK);
        continue;
      }
      api.px(x, GY, GRASS);
      api.rect(x, GY + 1, 1, 2, GRASSD);
      api.rect(x, GY + 3, 1, H - GY - 3, DIRT);
      const ph = (wxq / 16) | 0;                           // 土壤竖纹
      if (ph % 2 === 0) api.rect(x, GY + 5, 1, 2, DIRTD);
      if ((ph % 3) === 0 && (wxq % 8) < 3) api.px(x, GY + 10, DIRTD);
    }
    // 坑口沿
    for (const p of pits) {
      const x0 = p.x0 - ox, x1 = p.x1 - ox;
      if (x1 < 0 || x0 > W) continue;
      api.rect(x0 - 1, GY - 1, 3, 1, GRASSD);
      api.rect(x0 - 1, GY + 1, 2, 4, DIRTD);
      api.rect(x1 - 2, GY - 1, 3, 1, GRASSD);
      api.rect(x1, GY + 1, 2, 4, DIRTD);
    }
  }

  function drawWorld(api) {
    const ox = camX();
    for (const o of obst) {
      const x = (o.x - ox) | 0;
      if (x + o.w < -4 || x > W + 4) continue;
      if (o.kind === 'spike') {
        for (let i = 0; i < o.w - 4; i += 5) {             // 尖刺(上尖)
          api.px(x + i + 2, GY - 5, WHITE);
          api.rect(x + i + 1, GY - 4, 3, 1, LGRAY);
          api.rect(x + i + 1, GY - 3, 3, 1, SLATE);
          api.rect(x + i, GY - 2, 5, 2, SLATE);
        }
        api.rect(x, GY - 1, o.w, 1, SLATE);
      } else if (o.kind === 'crate') {
        for (let row = 0; row < o.h / 13; row++) {
          const y = GY - 13 * (row + 1);
          api.rect(x, y, 13, 13, DIRT);
          api.rect(x + 1, y + 1, 11, 11, DIRTD);
          api.rect(x + 2, y + 2, 9, 1, DIRT);
          api.rect(x + 2, y + 10, 9, 1, DIRT);
          api.px(x + 6, y + 6, GOLD);
        }
      } else if (o.kind === 'wall') {
        api.rect(x, GY - o.h, o.w, o.h, LGRAY);
        api.rect(x, GY - o.h, o.w, 1, WHITE);
        for (let y = GY - o.h + 3; y < GY; y += 5)
          api.rect(x + 1, y, o.w - 2, 1, SLATE);
        api.rect(x + 1, GY - 3, o.w - 2, 3, SLATE);
      } else {                                             // 低杠:警示条纹
        api.rect(x, o.y0, o.w, o.y1 - o.y0, LGRAY);
        for (let i = 0; i < o.w; i += 6)
          api.rect(x + i, o.y0 + 2, 3, 2, RED),
          api.rect(x + i + 3, o.y1 - 4, 3, 2, YELLOW);
        api.rect(x, o.y0, o.w, 1, WHITE);
      }
    }
    for (const p of plats) {
      const x = (p.x - ox) | 0;
      if (x + p.w < -4 || x > W + 4) continue;
      api.rect(x, p.y, p.w, 3, DIRT);
      api.rect(x, p.y, p.w, 1, GRASS);
      api.rect(x, p.y + 3, p.w, 2, DIRTD);
      api.rect(x + 2, p.y + 5, 2, 3, DIRTD);
      api.rect(x + p.w - 4, p.y + 5, 2, 3, DIRTD);
    }
    for (const c of coins) {                               // 金币
      if (c.taken) continue;
      const x = (c.x - ox) | 0, y = (c.y + Math.sin(c.t * 0.12) * 2) | 0;
      if (x < -4 || x > W + 4) continue;
      const ph = c.t % 24;
      if (ph < 4) api.rect(x, y - 3, 1, 6, GOLD);          // 旋转窄面
      else {
        api.rect(x - 2, y - 3, 5, 6, GOLD);
        api.rect(x - 1, y - 2, 3, 4, YELLOW);
        api.px(x, y - 2, WHITE);
      }
    }
  }

  function drawPlayer(api) {
    const ox = camX();
    const sxp = 52, syp = py | 0;
    const hgt = (sliding ? 7 : 13) * sy;
    const wid = 9 * (2 - sy);
    for (let i = scarf.length - 1; i > 0; i--) {           // 围巾尾迹
      const s = scarf[i];
      api.px(s[0] - ox, s[1] + i * 0.5, RED);
    }
    if (sliding) {                                         // 滑铲姿态
      api.rect(sxp - 6, syp - 6, 12, 5, ORANGE);
      api.rect(sxp + 4, syp - 7, 4, 4, ORANGE);
      api.px(sxp + 6, syp - 6, WHITE);
      api.rect(sxp - 7, syp - 2, 3, 2, INK);
      api.rect(sxp - 3, syp - 1, 6, 1, RED);
      return;
    }
    const top = (syp - hgt) | 0;
    api.rect(sxp - 4, top, 8, hgt * 0.55, ORANGE);         // 身体
    api.rect(sxp - 3, top - 5, 6, 5, ORANGE);              // 头
    api.rect(sxp + 1, top - 4, 2, 2, WHITE);               // 眼
    api.px(sxp + 2, top - 4, INK);
    api.rect(sxp - 4, top - 6, 6, 2, RED);                 // 头带
    api.rect(sxp - 6, top - 1, 3, 2, RED);                 // 围巾
    if (grounded) {                                        // 腿部动画
      const ph = frame >> 2 & 1;
      api.rect(sxp - 3, syp - 4, 2, 4, INK);
      api.rect(sxp + 1, syp - 4, 2, 4, ph ? INK : SLATE);
      api.rect(sxp - 3, syp - (ph ? 1 : 2), 2, 2, ph ? SLATE : INK);
    } else {
      api.rect(sxp - 3, syp - 4, 2, 3, INK);               // 收腿
      api.rect(sxp + 1, syp - 5, 2, 3, SLATE);
    }
  }

  function drawFx(api) {
    const ox = camX();
    for (const p of parts) {
      if (p.life < p.max * 0.3 && api.frame % 2) continue;
      api.px(p.x - ox, p.y, p.ci);
    }
    for (const r of rings) {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = i * TAU / n;
        api.px(r.x - ox + Math.cos(a) * r.r, r.y + Math.sin(a) * r.r * 0.6, r.ci);
      }
    }
    for (const p of pops) {
      if (p.life < 12 && api.frame % 4 >= 2) continue;
      api.text(p.t, p.x - ox, p.y, INK);
      api.text(p.t, p.x - ox - 1, p.y - 1, p.ci);
    }
    if (flashT > 0) api.rect(0, 0, W, H, RED);
  }

  function drawHud(api) {
    api.text(String(score()) + 'M', 3, 3, WHITE);
    api.text('HI ' + Math.max(best, score()) + 'M', 3, 11, ICE);
    api.text(String(v.toFixed(1)), W - 3 - api.textWidth(String(v.toFixed(1))), 3, CYAN);
    // 金币计数(带闪光)
    const pul = api.frame % 20 < 10;
    api.rect(4, 20, 5, 8, pul ? GOLD : YELLOW);
    api.rect(5, 21, 3, 6, YELLOW);
    if (pul) api.px(5, 22, WHITE);
    api.text('X' + coinCt, 12, 21, YELLOW);
    if (combo >= 5 && comboT > 0) api.text('COMBO ' + combo, 12, 29, GOLD);
    if (!grounded && jumps === 2) {                        // 二段跳指示
      api.text('DJ', 46, py - 26 | 0, ICE);
    }
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
    drawBg(api);
    api.rect(0, GY, W, H - GY, DIRT);
    api.rect(0, GY, W, 1, GRASS);
    for (let x = 0; x < W; x += 16)
      if (((x / 16) | 0) % 2 === 0) api.rect(x, GY + 5, 3, 2, DIRTD);
    // 标题主角起跳
    const hop = Math.abs(Math.sin(api.frame * 0.05)) * 24;
    const py2 = GY - hop;
    api.rect(116, py2 - 12, 8, 8, ORANGE);
    api.rect(117, py2 - 17, 6, 5, ORANGE);
    api.rect(119, py2 - 16, 2, 2, WHITE);
    api.rect(116, py2 - 18, 6, 2, RED);
    centerShadow(api, 'PIXEL DASH', 16, ORANGE, 3);
    centerText(api, 'ENDLESS RUNNER', 38, CYAN);
    if (best > 0) centerText(api, 'BEST ' + best + 'M', 50, YELLOW);
    if (api.frame % 60 < 38) centerShadow(api, 'PRESS START', 92, WHITE);
    centerText(api, 'Z OR UP - JUMP  X2 IN AIR', 110, LGRAY);
    centerText(api, 'DOWN - SLIDE OR FAST FALL', 120, LGRAY);
    centerText(api, 'MIND THE SPIKES AND PITS', 130, SLATE);
  }

  return {
    name: 'PIXEL DASH',
    version: '1.0',
    filter: 'none',

    /* RGB565(24 色):0黑 1深蓝 2-4 天空三段 5白 6浅灰 7远山 8近山 9丘陵
       10/11 草地 12/13 泥土 14橙 15红 16金 17黄 18青 19岩灰 20紫 21粉 22冰 23绿 */
    palette: [
      0x0000, 0x1082, 0x651F, 0x963F, 0xC73F, 0xFFFF, 0xADB8,
      0x6C77, 0x4B73, 0x340C, 0x5E2D, 0x450A, 0xA3C9, 0x7AC6,
      0xFC86, 0xF800, 0xFE40, 0xFE87, 0x07FF, 0x5B30, 0x8ADE,
      0xE25A, 0xAF7F, 0x2EED,
    ],

    init() {
      scene = 'title'; paused = false;
      frame = 0; freeze = 0; flashT = 0;
      wx = 60; py = GY; vy = 0; v = 2.3; jumps = 0;
      coyote = 0; jbuf = 0; sliding = false; grounded = true; sy = 1;
      pits = []; obst = []; plats = []; coins = []; parts = []; rings = []; pops = [];
      genX = 220; dist = 0; nextMile = 400; coinCt = 0; combo = 0; comboT = 0;
      deathT = 0; overT = 0;
      scarf = [];
      clouds = [];
      for (let i = 0; i < 5; i++) clouds.push({ x: rnd(0, W), y: irnd(12, 70) });
      best = loadBest();
      shakeNext = 0;
    },

    update(api) {
      frame++;
      const jp = api.justPressed;
      if (scene === 'title') {
        for (const c of clouds) {
          c.x -= 0.2;
          if (c.x < -40) { c.x = W + rnd(10, 80); c.y = irnd(12, 70); }
        }
        if (jp('start') || jp('a')) resetRun();
        return;
      }
      if (scene === 'dying') {                             // 死亡演出 → 结算
        deathT++;
        updateParts();
        if (deathT > 55) { saveBest(); scene = 'over'; overT = 0; }
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
      drawBg(api);
      drawGround(api);
      drawWorld(api);
      if (scene !== 'dying' || deathT > 14) drawPlayer(api);
      drawFx(api);
      drawHud(api);
      if (scene === 'over') {
        api.rect(36, 50, 168, 80, INK);
        api.rect(36, 50, 168, 1, RED); api.rect(36, 129, 168, 1, RED);
        api.rect(36, 50, 1, 80, RED); api.rect(203, 50, 1, 80, RED);
        centerShadow(api, 'YOU DIED', 58, RED, 2);
        centerText(api, 'SCORE ' + score() + 'M', 82, WHITE);
        centerText(api, 'COINS ' + coinCt, 94, YELLOW);
        centerText(api, 'BEST ' + best + 'M', 106, GOLD);
        if (overT > 30 && api.frame % 60 < 38) centerShadow(api, 'PRESS START', 118, WHITE);
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
