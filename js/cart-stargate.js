/*
 * 卡带:GATE RUNNER · 3D 穿门飞行(v1.0)
 * 颜色模式 A:16 色调色板;游戏自算 3D 透视投影(点到 240×180 索引帧缓冲,
 * 无三方库),摄像机即玩家:屏幕中央的光点就是你,世界向你涌来
 * 输入:鼠标(光标偏离屏幕中心的方向即转向,鼠标视图)/ ←→↑↓ / WASD 转向;
 *   飞船自动前进;Enter 开始/暂停
 * 玩法:穿过正方形门洞;碰门框(或错过门洞)即坠毁,扣一条命并重飞本关;
 *   从门洞正中穿过得 PERFECT 连击加分;8 关后进入 RANK 循环增强;
 *   最佳成绩记入 localStorage
 */
const GateRunnerCart = (function () {
  'use strict';

  const W = 240, H = 180, CX = 120, CY = 90;
  const F = 100;            // 透视焦距
  const PR = 0.42;          // 玩家碰撞半径(世界单位)
  const MAXV = 0.062;       // 横向最大速度(每帧)

  // —— 调色板索引 ——
  const BGC = 0, INK = 1, DEEP = 2, GRID = 3, CYAN = 4, WHITE = 5, GOLD = 6,
        YELLOW = 7, RED = 8, ORANGE = 9, VIOLET = 10, PINK = 11, LGRAY = 12,
        SLATE = 13, GREEN = 14, ICE = 15;
  const GATE_CI = [GOLD, CYAN, VIOLET, PINK];

  // —— 关卡表:motion 0静止 1横移 2纵移 3双向;pair 双门连锁 ——
  const LEVELS = [
    { name: 'FIRST FLIGHT',   n: 8,  speed: 1.15, h: 3.6, gap: 150, motion: 0 },
    { name: 'CROSSWIND',      n: 10, speed: 1.25, h: 3.3, gap: 150, motion: 1 },
    { name: 'AIRBOUND',       n: 10, speed: 1.30, h: 3.2, gap: 145, motion: 2 },
    { name: 'THE NARROWS',    n: 12, speed: 1.35, h: 2.7, gap: 140, motion: 0 },
    { name: 'DOUBLE TROUBLE', n: 10, speed: 1.40, h: 3.0, gap: 150, motion: 1, pair: true },
    { name: 'SPIN DRIFT',     n: 12, speed: 1.50, h: 2.9, gap: 140, motion: 3 },
    { name: 'THE GAUNTLET',   n: 14, speed: 1.55, h: 2.5, gap: 135, motion: 3 },
    { name: 'HYPERSPEED',     n: 12, speed: 1.90, h: 2.8, gap: 160, motion: 0 },
  ];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // —— 状态 ——
  let scene, paused;
  let px, py, pz, vx, vy, speed, roll, cosR, sinR, useMouse;
  let gates, nextG, passCount, levelNum, cfg, score, lives, combo;
  let stars, parts, pops;
  let bannerT, clearT, crashT, flashT, best;

  function loadBest() {
    try { const s = localStorage.getItem('ac_gr_best'); if (s) return JSON.parse(s); } catch (e) {}
    return null;
  }
  function saveBest() {
    if (!best || score > (best.s || 0)) {
      best = { s: score, l: levelNum };
      try { localStorage.setItem('ac_gr_best', JSON.stringify(best)); } catch (e) {}
    }
  }

  function levelCfg(n) {
    if (n <= LEVELS.length) return LEVELS[n - 1];
    const r = n - LEVELS.length;
    const base = LEVELS[LEVELS.length - 1];
    return { name: 'RANK ' + r,
             n: base.n + 2 * r,
             speed: Math.min(2.6, base.speed + 0.12 * r),
             h: Math.max(2.0, base.h - 0.12 * r),
             gap: base.gap, motion: n % 4, pair: n % 2 === 0 };
  }

  function makeGate(z, h, motion, near) {
    const xr = 4.3 - h, yr = 3.4 - h;                 // 开口中心可达范围
    let bx, by;
    if (near) {                                       // 双门:第二道贴着第一道,只做小偏移
      bx = clamp(near.bx + rnd(-0.9, 0.9), -xr, xr);
      by = clamp(near.by + rnd(-0.5, 0.5), -yr, yr);
    } else {
      bx = (gates.length % 2 ? -1 : 1) * rnd(0.3, 1) * xr;
      by = rnd(-1, 1) * yr;
    }
    const mx = (motion & 1) ? Math.max(0, Math.min(rnd(0.7, 1.6), xr - Math.abs(bx))) : 0;
    const my = (motion & 2) ? Math.max(0, Math.min(rnd(0.4, 1.0), yr - Math.abs(by))) : 0;
    const g = { z, bx, by, h, mx, my, mf: rnd(0.006, 0.012), mp: rnd(0, 6.28),
                passed: false, pt: 0, ci: GATE_CI[gates.length % 4] };
    gates.push(g);
    return g;
  }

  function buildLevel(n) {
    cfg = levelCfg(n);
    gates = [];
    let z = 170;
    for (let i = 0; i < cfg.n; i++) {
      const g1 = makeGate(z, cfg.h - i * 0.02, cfg.motion);
      if (cfg.pair) makeGate(z + 40, cfg.h - 0.15 - i * 0.02, cfg.motion, g1);
      z += cfg.gap;
    }
    nextG = 0;
    passCount = 0;
    pz = 0; px = 0; py = 0; vx = 0; vy = 0; roll = 0;
  }

  function gx(g, fr) { return g.bx + (g.mx ? Math.sin(fr * g.mf + g.mp) * g.mx : 0); }
  function gy(g, fr) { return g.by + (g.my ? Math.sin(fr * g.mp + g.mf) * g.my : 0); }

  function resetRun() {
    levelNum = 1;
    score = 0; lives = 3; combo = 0;
    buildLevel(1);
    bannerT = 110;
    crashT = 0; clearT = 0; flashT = 0;
    scene = 'play'; paused = false;
  }

  function doCrash(api) {
    scene = 'crash';
    crashT = 70;
    lives--;
    flashT = 9;
    combo = 0;
    api.shake(5);
    for (let i = 0; i < 46; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(0.4, 3.2), max = irnd2(24, 50);
      parts.push({ x: CX, y: CY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                   ci: pick2([WHITE, ORANGE, RED, YELLOW]), life: max, max });
    }
  }

  const irnd2 = (a, b) => (a + Math.random() * (b - a)) | 0;
  const pick2 = (arr) => arr[(Math.random() * arr.length) | 0];

  function updateParts() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.94; p.vy *= 0.94;
      if (--p.life <= 0) parts.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) if (--pops[i].life <= 0) pops.splice(i, 1);
    if (flashT > 0) flashT--;
  }

  // —— 投影:世界点 → 屏幕坐标(带滚转),过近返回 null ——
  function proj(x, y, z) {
    const dz = z - pz;
    if (dz < 1.5) return null;
    const sx = (x - px) * F / dz, sy = -(y - py) * F / dz;
    return [CX + sx * cosR - sy * sinR, CY + sx * sinR + sy * cosR];
  }

  function line(api, x0, y0, x1, y1, ci) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      api.px(x0, y0, ci);                             // px 自带屏内裁剪
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function square(api, cxw, cyw, z, s, ci) {
    const a = proj(cxw - s, cyw - s, z), b = proj(cxw + s, cyw - s, z),
          c = proj(cxw + s, cyw + s, z), d = proj(cxw - s, cyw + s, z);
    if (!a || !b || !c || !d) return;
    line(api, a[0], a[1], b[0], b[1], ci);
    line(api, b[0], b[1], c[0], c[1], ci);
    line(api, c[0], c[1], d[0], d[1], ci);
    line(api, d[0], d[1], a[0], a[1], ci);
  }

  // —— 绘制 ——
  function drawSpace(api) {
    for (const s of stars) {
      const p = proj(s.x, s.y, s.z);
      if (!p) continue;
      const dz = s.z - pz;
      if (dz < 26) api.rect(p[0] - 1, p[1] - 1, 2, 2, WHITE);
      else if (dz < 90) api.px(p[0], p[1], LGRAY);
      else api.px(p[0], p[1], DEEP);
    }
    // 地面网格:纵向线(沿 z 直线,屏幕投影仍为直线,连两端即可)
    for (let wx = -12; wx <= 12; wx += 6) {
      const a = proj(wx, -7.5, pz + 3), b = proj(wx, -7.5, pz + 220);
      if (a && b) line(api, a[0], a[1], b[0], b[1], GRID);
    }
    // 横向格:每 22 单位一道
    for (let wz = Math.ceil((pz + 6) / 22) * 22; wz < pz + 200; wz += 22) {
      const a = proj(-12, -7.5, wz), b = proj(12, -7.5, wz);
      if (a && b) line(api, a[0], a[1], b[0], b[1], wz - pz < 60 ? GRID : INK);
    }
  }

  function drawGates(api, fr) {
    for (let i = gates.length - 1; i >= 0; i--) {     // 远的先画
      const g = gates[i];
      const dz = g.z - pz;
      if (dz < 1.5 || dz > 230) continue;
      if (g.pt > 0) g.pt--;
      const cxw = gx(g, fr), cyw = gy(g, fr);
      if (g.pt > 0) {                                 // 刚穿过:白色闪边
        square(api, cxw, cyw, g.z, g.h, WHITE);
        square(api, cxw, cyw, g.z, g.h + 1.05, WHITE);
        continue;
      }
      square(api, cxw, cyw, g.z, g.h + 1.05, g.ci);
      square(api, cxw, cyw, g.z, g.h, dz < 70 ? WHITE : LGRAY);
      if (dz < 30) square(api, cxw, cyw, g.z, g.h + 1.3, g.ci);   // 近处加粗门框
    }
  }

  function drawGuide(api, fr) {
    const g = gates[nextG];
    if (!g) return;
    const p = proj(gx(g, fr), gy(g, fr), g.z);
    if (!p) return;
    const x = p[0] | 0, y = p[1] | 0;
    if (api.frame % 10 < 7) {
      api.px(x, y - 3, GOLD); api.px(x, y + 3, GOLD);
      api.px(x - 3, y, GOLD); api.px(x + 3, y, GOLD);
    }
    api.px(x, y, YELLOW);
  }

  function drawShip(api) {
    api.rect(CX - 1, CY - 1, 3, 3, WHITE);
    api.px(CX, CY, CYAN);
    // 滚转地平线刻度(倾斜感)
    const c = Math.cos(roll), s = Math.sin(roll);
    for (const side of [-1, 1]) {
      const x0 = CX + side * 22 * c, y0 = CY + side * 22 * s;
      const x1 = CX + side * 30 * c, y1 = CY + side * 30 * s;
      line(api, x0, y0, x1, y1, SLATE);
    }
    if (api.frame % 14 < 7) {                         // 待机外圈
      api.px(CX - 5, CY, CYAN); api.px(CX + 5, CY, CYAN);
      api.px(CX, CY - 5, CYAN); api.px(CX, CY + 5, CYAN);
    }
  }

  function drawFx(api) {
    for (const p of parts) {
      if (p.life < p.max * 0.3 && api.frame % 2) continue;
      api.px(p.x, p.y, p.ci);
    }
    for (const p of pops) {
      if (p.life > 12 || api.frame % 4 < 2) {
        const x = (W - api.textWidth(p.t)) / 2;
        api.text(p.t, x + 1, p.y + 1, INK);
        api.text(p.t, x, p.y, p.ci);
      }
    }
    if (flashT > 0) {                                 // 坠毁红闪边框
      const t = 6 - Math.min(6, flashT);
      api.rect(0, 0, W, t, RED); api.rect(0, H - t, W, t, RED);
      api.rect(0, 0, t, H, RED); api.rect(W - t, 0, t, H, RED);
    }
  }

  function drawHud(api) {
    api.text('LV' + levelNum, 3, 3, WHITE);
    const gTxt = passCount + '/' + gates.length;
    api.text(gTxt, (W - api.textWidth(gTxt)) / 2, 3, LGRAY);
    const sTxt = String(score).padStart(6, '0');
    api.text(sTxt, W - 3 - api.textWidth(sTxt), 3, GOLD);
    for (let i = 0; i < lives; i++) {                 // 命数:小箭头
      const x = 3 + i * 6;
      api.rect(x, 10, 3, 1, CYAN); api.rect(x + 1, 11, 1, 1, CYAN);
    }
    // 速度条
    api.rect(90, 174, 60, 3, INK);
    api.rect(91, 175, Math.round(58 * clamp(speed / 2.4, 0, 1)), 1, speed > 1.8 ? RED : CYAN);
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
    api.cls(0);
    for (let i = 0; i < 40; i++) {
      const x = (i * 53 + api.frame * 0.12) % W, y = (i * 97) % H;
      api.px(x, y, i % 4 ? DEEP : SLATE);
    }
    // 隧道方环
    for (let k = 0; k < 5; k++) {
      const t = (api.frame * 0.006 + k / 5) % 1;
      const s = 5 + t * 62;
      const ci = t < 0.25 ? WHITE : t < 0.5 ? LGRAY : GATE_CI[k % 4];
      const x0 = 120 - s, y0 = 78 - s;
      for (let x = x0; x <= x0 + 2 * s; x += 2) { api.px(x, y0, ci); api.px(x, y0 + 2 * s, ci); }
      for (let y = y0; y <= y0 + 2 * s; y += 2) { api.px(x0, y, ci); api.px(x0 + 2 * s, y, ci); }
    }
    api.rect(119, 77, 3, 3, WHITE);
    centerShadow(api, 'GATE', 22, GOLD, 3);
    centerShadow(api, 'RUNNER', 44, CYAN, 3);
    if (best) centerText(api, 'BEST ' + best.s + '  LV' + best.l, 66, YELLOW);
    if (api.frame % 60 < 36) centerShadow(api, 'PRESS START', 92, WHITE);
    centerText(api, 'MOUSE OR ARROWS TO STEER', 112, LGRAY);
    centerText(api, 'YOU FLY FORWARD AUTOMATICALLY', 122, SLATE);
    centerText(api, 'THREAD THE SQUARE GATES', 132, SLATE);
    centerText(api, 'TOUCH A FRAME AND YOU CRASH', 142, SLATE);
  }

  return {
    name: 'GATE RUNNER',
    version: '1.0',
    filter: 'none',

    /* RGB565:0黑 1深蓝 2暗蓝 3网格蓝 4青 5白 6金 7黄 8红 9橙 10紫 11粉 12浅灰 13岩灰 14绿 15冰 */
    palette: [
      0x0000, 0x1082, 0x2129, 0x32A4, 0x07FF, 0xFFFF, 0xFE40,
      0xFE87, 0xF800, 0xFC86, 0x8ADE, 0xE25A, 0xADB8, 0x5B30,
      0x2EED, 0xAF7F,
    ],

    init() {
      scene = 'title';
      paused = false;
      parts = [];
      pops = [];
      best = loadBest();
      stars = [];
      for (let i = 0; i < 90; i++)
        stars.push({ x: rnd(-30, 30), y: rnd(-20, 20), z: rnd(2, 220) });
      px = py = pz = vx = vy = 0;
      roll = 0; cosR = 1; sinR = 0;
      gates = []; nextG = 0; passCount = 0;
      levelNum = 1; score = 0; lives = 3; combo = 0;
      cfg = levelCfg(1);
      bannerT = 0; clearT = 0; crashT = 0; flashT = 0;
      useMouse = false;
    },

    update(api) {
      const jp = api.justPressed;
      if (scene === 'title') {
        if (jp('start') || jp('a')) resetRun();
        return;
      }
      if (scene === 'over') {
        if (jp('start') || jp('a')) { saveBest(); scene = 'title'; }
        return;
      }
      if (jp('start')) paused = !paused;
      if (paused) return;

      if (scene === 'clear') {
        updateParts();
        if (--clearT <= 0) {
          levelNum++;
          buildLevel(levelNum);
          bannerT = 100;
          scene = 'play';
        }
        return;
      }
      if (scene === 'crash') {
        updateParts();
        if (--crashT <= 0) {
          if (lives <= 0) { saveBest(); scene = 'over'; }
          else { buildLevel(levelNum); bannerT = 80; scene = 'play'; }
        }
        return;
      }

      // —— play ——
      if (bannerT > 0) bannerT--;

      // 转向:鼠标 / 键盘,最近使用者优先
      const c = api.cursor();
      if (c.on && (c.dx || c.dy)) useMouse = true;
      const kbL = api.pressed('left'), kbR = api.pressed('right'),
            kbU = api.pressed('up'), kbD = api.pressed('down');
      if (kbL || kbR || kbU || kbD) useMouse = false;
      if (useMouse && c.on) {
        let tx = clamp((c.x - CX) / CX, -1, 1), ty = clamp((c.y - CY) / CY, -1, 1);
        if (Math.abs(tx) < 0.07) tx = 0;
        if (Math.abs(ty) < 0.07) ty = 0;
        vx += (tx * MAXV - vx) * 0.3;
        vy += (ty * MAXV * 0.8 - vy) * 0.3;
      } else {
        const ax = 0.0055, ay = 0.005;
        if (kbL) vx -= ax;
        if (kbR) vx += ax;
        if (kbU) vy += ay;
        if (kbD) vy -= ay;
        if (!kbL && !kbR) vx *= 0.9;
        if (!kbU && !kbD) vy *= 0.9;
        vx = clamp(vx, -MAXV, MAXV);
        vy = clamp(vy, -MAXV * 0.8, MAXV * 0.8);
      }

      px = clamp(px + vx, -8.5, 8.5);
      py = clamp(py + vy, -5.5, 5.5);
      speed = cfg.speed * (1 + passCount * 0.01);
      pz += speed;
      roll += (-vx / MAXV * 0.25 - roll) * 0.15;
      cosR = Math.cos(roll); sinR = Math.sin(roll);

      // 过门判定:越过门所在的 z 平面瞬间,必须在开口内
      for (const g of gates) {
        if (g.passed) continue;
        if (pz >= g.z) {
          const dx = Math.abs(px - gx(g, api.frame));
          const dy = Math.abs(py - gy(g, api.frame));
          if (dx > g.h - PR || dy > g.h - PR) { doCrash(api); return; }
          g.passed = true;
          g.pt = 14;
          passCount++;
          let pts = 100;
          if (Math.max(dx, dy) < (g.h - PR) * 0.32) {
            combo++;
            pts += 50 * combo;
            pops.push({ t: combo > 1 ? 'PERFECT X' + combo : 'PERFECT',
                        y: 56, ci: GOLD, life: 46 });
          } else combo = 0;
          score += pts;
        } else break;                                  // 门按 z 升序
      }
      while (nextG < gates.length && gates[nextG].passed) nextG++;
      if (passCount >= gates.length) {
        scene = 'clear';
        clearT = 140;
        score += 250;
        pops.push({ t: 'CLEAR 250', y: 64, ci: CYAN, life: 120 });
        return;
      }

      for (const s of stars) {
        if (s.z < pz + 1.5) {
          s.z = pz + rnd(180, 240);
          s.x = rnd(-30, 30); s.y = rnd(-20, 20);
        }
      }
      updateParts();
    },

    draw(api) {
      if (scene === 'title') { drawTitle(api); return; }
      api.cls(0);
      drawSpace(api);
      drawGates(api, api.frame);
      drawGuide(api, api.frame);
      drawShip(api);
      drawFx(api);
      drawHud(api);

      if (scene === 'crash' && api.frame % 8 < 5)
        centerShadow(api, 'CRASH', 66, RED, 2);
      if (scene === 'clear')
        centerShadow(api, 'LEVEL CLEAR', 58, CYAN, 2);
      if (scene === 'over') {
        api.rect(34, 48, 172, 84, DEEP);
        api.rect(34, 48, 172, 1, RED); api.rect(34, 131, 172, 1, RED);
        api.rect(34, 48, 1, 84, RED); api.rect(205, 48, 1, 84, RED);
        centerShadow(api, 'GAME OVER', 56, RED, 2);
        centerText(api, 'SCORE ' + score, 80, WHITE);
        centerText(api, 'REACHED LEVEL ' + levelNum, 92, LGRAY);
        if (best) centerText(api, 'BEST ' + best.s + '  LV' + best.l, 104, YELLOW);
        if (api.frame % 60 < 36) centerShadow(api, 'PRESS START', 116, WHITE);
      }
      if (bannerT > 0 && (bannerT > 20 || api.frame % 4 < 2)) {
        centerShadow(api, 'LEVEL ' + levelNum, 44, WHITE);
        centerShadow(api, cfg.name, 58, GOLD, 2);
        if (useMouse) centerText(api, 'MOUSE STEER', 78, SLATE);
      }
      if (paused) {
        api.rect(86, 76, 68, 26, DEEP);
        api.rect(86, 76, 68, 1, WHITE); api.rect(86, 101, 68, 1, WHITE);
        api.rect(86, 76, 1, 26, WHITE); api.rect(153, 76, 1, 26, WHITE);
        centerShadow(api, 'PAUSED', 84, WHITE, 2);
      }
    },
  };
})();
