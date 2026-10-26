/*
 * 卡带:打砖块 · 阶段一验收 demo(v0.8 入场特效 + 果冻砖 + 糖果色)
 * 颜色模式 A:16 色调色板;砖墙统一霓红单色(青),彩色额度仍归特效
 * 输入(手柄视图):←→/AD 移动,Z/J 发球,Enter 开始/暂停;壳 1-4 切滤镜
 * 入场编排(新开局/过关):
 *   砖块逐个弹性弹出(backOut)→ HUD 从顶滑入 → 挡板弹出 → READY/GO!
 * 果冻变形:
 *   被击中的砖挤压回弹(正弦×指数衰减),四邻连锁晃动(整墙果冻感)
 * 速度动力学 / 打击感全家桶 / 彗尾 / 连击 / 滤镜:同 v0.7
 */
const BreakoutCart = (function () {
  'use strict';

  const W = 240, H = 180;
  const TOP = 14;
  const BEZEL = 24;                       // 左右 UI 边框宽(收窄横向场地)
  const FX0 = BEZEL, FX1 = W - BEZEL;     // 场地横向边界(球/挡板活动范围)
  const BR = { cols: 8, rows: 5, w: 20, h: 8, gx: 2, gy: 2 };  // 8 列 × 5 行 = 40 块
  const START_LIVES = 3;
  const PADDLE = { w: 32, h: 4, y: H - 10, speed: 3 };
  const BALL = 3;

  // —— 速度动力学参数 ——
  const SPEED_LAUNCH = 1.5;
  const SPEED_MIN = 1.2;
  const SPEED_ACCEL = 0.006;
  const SPEED_WALL_HIT = 0.12;
  const SPEED_BRICK_HIT = 0.22;
  const SPEED_PAD_HIT = 0.15;
  const maxSpeed = () => Math.min(3.4, 1.8 + 0.25 * (level - 1));

  // —— 入场编排 ——
  const INTRO_LEN = 52;    // 砖块入场总帧数(= 最大延迟 + 单砖弹出)
  const backOut = (t) => t >= 1 ? 1 : 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

  // —— 调色板索引 ——
  const BG = 0, NAVY = 1, SLATE = 2, LGRAY = 3, WHITE = 4;
  const RED = 5, ORANGE = 6, YELLOW = 7, GREEN = 8, CYAN = 9, PINK = 10,
        MAGENTA = 11, VIOLET = 12, LIME = 13, PCYAN = 14, CREAM = 15;

  // 砖墙统一色:霓虹青(单色,但不沉闷;碎屑/碎块继承此色)
  const BRICK_CI = CYAN;
  const HUES = [RED, ORANGE, YELLOW, GREEN, CYAN, PINK,
                MAGENTA, VIOLET, LIME, PCYAN, CREAM];
  const SPARKS = [PCYAN, CREAM, WHITE];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const sgn = (v) => v > 0 ? 1 : -1;

  let scene, score, lives, level, bricks, brickCount, timer, paused;
  let pad, ball, combo, comboTimer;
  let introT = 0;          // 进入 serve 后的帧数(入场编排时钟)
  let introMode = false;   // true = 砖块重新弹出(新局/过关);false = 丢球快速复位
  let goT = 0;             // GO! 剩余帧

  // —— 特效状态 ——
  let particles = [], chunks = [], hitSparks = [], popups = [], flashes = [],
      rings = [], stars = [], trail = [];
  let padSquash = 0, hitStop = 0, ballSq = 0, ballSqAxis = 'y';

  function applySp() {
    const m = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = ball.vx / m * ball.sp;
    ball.vy = ball.vy / m * ball.sp;
  }

  function centerText(api, s, y, ci, scale) {
    api.text(s, (W - api.textWidth(s, scale)) / 2, y, ci, scale);
  }
  function centerShadow(api, s, y, ci, scale) {
    const x = (W - api.textWidth(s, scale)) / 2;
    api.text(s, x + 1, y + 1, NAVY, scale);
    api.text(s, x, y, ci, scale);
  }

  function resetBricks() {
    bricks = [];
    const bx0 = FX0 + ((FX1 - FX0) - (BR.cols * (BR.w + BR.gx) - BR.gx)) / 2;
    for (let r = 0; r < BR.rows; r++) {
      for (let c = 0; c < BR.cols; c++) {
        bricks.push({
          x: bx0 + c * (BR.w + BR.gx), y: TOP + 6 + r * (BR.h + BR.gy),
          row: r, col: c, alive: true,
          hp: r < 2 ? 2 : 1, maxHp: r < 2 ? 2 : 1,
          ci: BRICK_CI,                             // 统一单色
          delay: r * 5 + c * 1.5,              // 入场逐个弹出延迟
          wobA: 0, wobF: -999,                 // 果冻晃动
        });
      }
    }
    brickCount = bricks.length;
  }

  function stickBall() {
    ball = { x: 0, y: 0, vx: 0, vy: 0, sp: SPEED_LAUNCH, stuck: true };
    trail = [];
  }

  function launch() {
    const a = Math.PI / 2 + (Math.random() * 0.6 - 0.3);
    ball.sp = SPEED_LAUNCH;
    ball.vx = Math.cos(a) * ball.sp;
    ball.vy = -Math.sin(a) * ball.sp;
    ball.stuck = false;
    combo = 0; comboTimer = 0;
    ring(ball.x + 1, ball.y + 1, 2);
    sparkFan(ball.x + 1, ball.y, 5, 0.7);
  }

  /* —— 粒子与打击特效 —— */
  function wake() {
    const m = Math.hypot(ball.vx, ball.vy) || 1;
    const dx = -ball.vx / m, dy = -ball.vy / m;
    const fast = ball.sp > maxSpeed() * 0.8;
    const n = fast ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const max = rnd(10, 20) | 0;
      particles.push({
        x: ball.x + 1 + rnd(-1, 1), y: ball.y + 1 + rnd(-1, 1),
        vx: dx * rnd(0.05, 0.35) + rnd(-0.08, 0.08),
        vy: dy * rnd(0.05, 0.35) + rnd(-0.08, 0.08),
        ci: fast && Math.random() < 0.4 ? WHITE : pick(HUES),
        life: max, max, kind: 'wake',
      });
    }
    // 彗星侧喷:随机从尾迹某点沿运动法向(左右两侧)溅出火花
    if (trail.length > 2 && Math.random() < 0.35) {
      const t = trail[(Math.random() * Math.min(trail.length, 8)) | 0];
      const side = Math.random() < 0.5 ? 1 : -1;
      const sp = rnd(0.3, 1.0), max = rnd(8, 16) | 0;
      particles.push({
        x: t.x + 1, y: t.y + 1,
        vx: -dy * side * sp + dx * 0.2,
        vy: dx * side * sp + dy * 0.2,
        ci: pick(HUES), life: max, max, kind: 'spark',
      });
    }
  }
  function brickChunks(b) {
    const qw = BR.w / 2, qh = BR.h / 2;
    const parts = [
      { x: b.x, y: b.y, sx: -1, sy: -1 }, { x: b.x + qw, y: b.y, sx: 1, sy: -1 },
      { x: b.x, y: b.y + qh, sx: -1, sy: 1 }, { x: b.x + qw, y: b.y + qh, sx: 1, sy: 1 },
    ];
    for (const p of parts) {
      const max = rnd(22, 34) | 0;
      chunks.push({ x: p.x + qw / 2, y: p.y + qh / 2, w: qw, h: qh,
                    vx: p.sx * rnd(0.5, 1.5), vy: p.sy * rnd(0.3, 1.0) - 0.5,
                    ci: Math.random() < 0.6 ? b.ci : LGRAY,
                    life: max, max });
    }
  }
  function hitSpark(x, y, big) {
    hitSparks.push({ x: x | 0, y: y | 0, life: big ? 6 : 4, max: big ? 6 : 4, big });
  }
  function screenFlash(life) {
    flashes.push({ x: FX0, y: TOP, w: FX1 - FX0, h: H - TOP, life, dither: true });
  }
  function burstDebris(x, y, dirX, dirY, nDebris, nSpark, baseCi) {
    const a0 = Math.atan2(dirY, dirX);
    for (let i = 0; i < nDebris; i++) {
      const a = a0 + rnd(-1.6, 1.6), sp = rnd(0.5, 2.6), max = rnd(20, 40) | 0;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                       ci: Math.random() < 0.4 ? baseCi : pick(HUES),
                       life: max, max, kind: 'debris' });
    }
    for (let i = 0; i < nSpark; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(0.3, 1.8), max = rnd(16, 28) | 0;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                       ci: pick(SPARKS), life: max, max, kind: 'spark' });
    }
  }
  function sparkFan(x, y, n, pow) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(0.2, pow + 0.5), max = rnd(10, 20) | 0;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                       ci: pick(HUES), life: max, max, kind: 'spark' });
    }
  }
  function confetti() {
    for (let i = 0; i < 2; i++) {
      const max = rnd(50, 80) | 0;
      particles.push({ x: rnd(FX0 + 4, FX1 - 4), y: TOP + rnd(0, 6),
                       vx: rnd(-0.3, 0.3), vy: rnd(0.4, 0.9),
                       ci: pick(HUES), life: max, max, kind: 'confetti' });
    }
  }
  function ember() {
    const max = rnd(50, 90) | 0;
    particles.push({ x: rnd(FX0 + 4, FX1 - 4), y: rnd(134, 174),
                     vx: rnd(-0.12, 0.12), vy: rnd(-0.55, -0.25),
                     ci: pick(HUES), life: max, max, kind: 'spark' });
  }
  function ring(x, y, size) { rings.push({ x, y, r: 2, life: size * 5, max: size * 5 }); }
  function popup(x, y, text, ci) { popups.push({ x, y, text, ci, life: 40 }); }

  /* 果冻:四邻连锁晃动(带 2 帧延迟) */
  function jiggleNeighbors(b, api, amp) {
    const tryN = (r, c) => {
      if (r < 0 || r >= BR.rows || c < 0 || c >= BR.cols) return;
      const n = bricks[r * BR.cols + c];
      if (n.alive) { n.wobA = amp; n.wobF = api.frame + 2; }
    };
    tryN(b.row - 1, b.col); tryN(b.row + 1, b.col);
    tryN(b.row, b.col - 1); tryN(b.row, b.col + 1);
  }

  function updateFx() {
    for (const s of stars) {
      s.y += s.v;
      if (s.y >= H) { s.y = 0; s.x = rnd(0, W); }
    }
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.kind === 'debris') p.vy += 0.06;
      else if (p.kind === 'wake') { p.vx *= 0.9; p.vy *= 0.9; }
      else if (p.kind === 'spark') { p.vx *= 0.95; p.vy = p.vy * 0.95 - 0.01; }
      else { p.vy += 0.02; p.vx *= 0.99; }
      p.life--;
    }
    particles = particles.filter(p => p.life > 0);
    for (const c of chunks) {
      c.x += c.vx; c.y += c.vy; c.vy += 0.08; c.vx *= 0.99; c.life--;
    }
    chunks = chunks.filter(c => c.life > 0);
    for (const s of hitSparks) s.life--;
    hitSparks = hitSparks.filter(s => s.life > 0);
    for (const p of popups) { p.y -= 0.4; p.life--; }
    popups = popups.filter(p => p.life > 0);
    for (const f of flashes) f.life--;
    flashes = flashes.filter(f => f.life > 0);
    for (const r of rings) { r.r += 1.1; r.life--; }
    rings = rings.filter(r => r.life > 0);
    if (padSquash > 0) padSquash--;
    if (ballSq > 0) ballSq--;
    if (comboTimer > 0) comboTimer--;
    if (goT > 0) goT--;
    if (scene !== 'play' && trail.length) trail.pop();
  }

  function crackBrick(api, b, axis) {          // 未击碎:裂纹 + 果冻大晃
    score += 5;
    combo++; comboTimer = 55;
    b.wobA = 0.3; b.wobF = api.frame;
    jiggleNeighbors(b, api, 0.13);
    hitSpark(ball.x + 1, ball.y + 1, false);
    burstDebris(b.x + BR.w / 2, b.y + BR.h / 2, sgn(ball.vx), sgn(ball.vy), 6, 4, b.ci);
    flashes.push({ x: b.x + 2, y: b.y + 1, w: BR.w - 4, h: BR.h - 2, life: 2 });
    popup(b.x + BR.w / 2 - api.textWidth('+5') / 2, b.y - 4, '+5', b.ci);
    ring(b.x + BR.w / 2, b.y + BR.h / 2, 1);
    api.shake(0.9);
    hitStop = 1;
    ballSq = 3; ballSqAxis = axis;
  }

  function killBrick(api, b, axis) {           // 击碎:全家桶 + 邻居果冻
    b.alive = false; brickCount--;
    const pts = (BR.rows - b.row) * 10;
    score += pts;
    combo++; comboTimer = 55;
    jiggleNeighbors(b, api, 0.13);
    brickChunks(b);
    hitSpark(ball.x + 1, ball.y + 1, true);
    burstDebris(b.x + BR.w / 2, b.y + BR.h / 2, sgn(ball.vx), sgn(ball.vy), 22, 14, b.ci);
    flashes.push({ x: b.x, y: b.y, w: BR.w, h: BR.h, life: 3 });
    popup(b.x + BR.w / 2 - api.textWidth('+' + pts) / 2, b.y - 4, '+' + pts, b.ci);
    ring(b.x + BR.w / 2, b.y + BR.h / 2, 2);
    api.shake(2.2);
    hitStop = 3;
    ballSq = 4; ballSqAxis = axis;
    if (brickCount === 0) {
      score += 100;
      scene = 'clear'; timer = 120;
      flashes.push({ x: FX0, y: TOP, w: FX1 - FX0, h: H - TOP, life: 3 });
      burstDebris(W / 2, 56, 0, -1, 26, 16, YELLOW);
      api.shake(3.5);
      hitStop = 5;
    }
  }

  function bounceFx(api, x, y, axis) {
    ballSq = 4; ballSqAxis = axis;
    ring(x, y, 1);
    sparkFan(x, y, 8, 0.7);
    api.shake(0.3);
  }

  /* —— 绘制小件 —— */
  /* 裂纹像素(相对砖左上角) */
  const CRACKS = [[5, 1], [6, 2], [7, 2], [7, 3], [8, 4], [8, 5], [9, 6],
                  [6, 3], [12, 2], [13, 3], [14, 3]];

  /* 果冻缩放:入场弹出 × 晃动(正弦×指数衰减) */
  function brickScale(b, api) {
    let s = 1;
    if (introMode && scene === 'serve' && introT < INTRO_LEN + 14) {
      s = backOut(Math.min(1, Math.max(0, (introT - b.delay) / 14)));
      if (s <= 0.01) return null;              // 还没轮到它出场
    }
    const dt = api.frame - b.wobF;
    let sx = s, sy = s;
    if (dt >= 0 && dt < 26) {
      const osc = Math.sin(dt * 0.55) * Math.exp(-dt * 0.13) * b.wobA;
      sx = s * (1 + osc);
      sy = s * (1 - osc);
    }
    return { sx, sy };
  }

  function drawBrick(api, b) {
    const sc = brickScale(b, api);
    if (!sc) return;
    const w = Math.max(1, Math.round(BR.w * sc.sx));
    const h = Math.max(1, Math.round(BR.h * sc.sy));
    const x = Math.round(b.x + (BR.w - w) / 2);
    const y = Math.round(b.y + (BR.h - h) / 2);
    api.rect(x, y, w, h, b.ci);
    if (w > 2 && h > 2) {
      api.rect(x, y, w, 1, WHITE);              // 受光
      api.rect(x, y, 1, h, WHITE);
      api.rect(x, y + h - 1, w, 1, NAVY);       // 背光
      api.rect(x + w - 1, y, 1, h, NAVY);
      if (b.maxHp > 1 && w > 5) {               // 2 血砖:内框"装甲"
        api.rect(x + 2, y + 2, w - 4, 1, SLATE);
        api.rect(x + 2, y + h - 3, w - 4, 1, SLATE);
      }
      if (b.hp < b.maxHp && Math.abs(sc.sx - 1) < 0.15) {   // 裂纹(剧烈晃动时暂隐)
        for (let i = 0; i < CRACKS.length; i++) {
          const cx = CRACKS[i][0], cy = CRACKS[i][1];
          if (cx < w && cy < h) api.px(x + cx, y + cy, NAVY);
        }
      }
    }
  }

  function drawPanel(api, x, y, w, h) {
    api.rect(x, y, w, h, NAVY);
    api.rect(x, y, w, 1, SLATE); api.rect(x, y + h - 1, w, 1, SLATE);
    api.rect(x, y, 1, h, SLATE); api.rect(x + w - 1, y, 1, h, SLATE);
    api.rect(x, y, 2, 2, LGRAY); api.rect(x + w - 2, y, 2, 2, LGRAY);
    api.rect(x, y + h - 2, 2, 2, LGRAY); api.rect(x + w - 2, y + h - 2, 2, 2, LGRAY);
  }

  function drawPaddle(api) {
    let s = 1;
    if (scene === 'serve') s = backOut(Math.min(1, introT / 14));  // 入场弹出
    const sq = padSquash > 0;
    const w = Math.max(2, Math.round(PADDLE.w * s));
    const h = PADDLE.h + (sq ? 2 : 0);
    const x = Math.round(pad.x + (PADDLE.w - w) / 2);
    const y = PADDLE.y - (sq ? 1 : 0);
    api.rect(x + 1, y + h, w - 2, 1, NAVY);
    api.rect(x, y, w, h, WHITE);
    if (h > 2) api.rect(x, y + h - 1, w, 1, LGRAY);
    const glow = ball && ball.stuck ? (api.frame % 24 < 12 ? PCYAN : WHITE) : LGRAY;
    if (w > 6) api.rect(x + 2, y, w - 4, 1, glow);
  }

  function drawBall(api) {
    if (scene === 'serve' && introMode && introT < 16) return;   // 入场后半段才现身
    for (let i = trail.length - 1; i >= 1; i--) {
      const t = trail[i];
      const s = i < 3 ? 2 : 1;
      if (s === 1) api.px(t.x + 1, t.y + 1, i < 5 ? LGRAY : NAVY);
      else api.rect(t.x, t.y, 2, 2, i < 5 ? LGRAY : NAVY);
    }
    const cx = ball.x + BALL / 2, cy = ball.y + BALL / 2;
    let bw = BALL, bh = BALL;
    if (ballSq > 0) {
      if (ballSqAxis === 'y') { bw = 5; bh = 2; } else { bw = 2; bh = 5; }
    }
    if (ball.stuck && api.frame % 20 < 10)
      api.rect(cx - 3, cy - 3, 6, 6, NAVY);
    api.rect(cx - bw / 2, cy - bh / 2, bw, bh, WHITE);
  }

  function drawWorld(api) {
    api.rect(FX0, 11, FX1 - FX0, 2, SLATE);   // 顶墙(场内宽度)
    api.rect(FX0, 13, FX1 - FX0, 1, NAVY);
    for (const b of bricks) if (b.alive) drawBrick(api, b);
    for (const c of chunks) {
      const k = c.life / c.max;
      const w = Math.max(2, (c.w * k) | 0), h = Math.max(2, (c.h * k) | 0);
      const x = (c.x - w / 2) | 0, y = (c.y - h / 2) | 0;
      api.rect(x, y, w, h, c.ci);
      if ((c.life >> 2) & 1) api.rect(x, y, w, 1, WHITE);
      else api.rect(x, y + h - 1, w, 1, WHITE);
    }
    for (const r of rings) {
      const s = r.r | 0, ci = r.life > r.max / 2 ? WHITE : LGRAY;
      api.rect(r.x - s, r.y - s, s * 2, 1, ci);
      api.rect(r.x - s, r.y + s, s * 2, 1, ci);
      api.rect(r.x - s, r.y - s, 1, s * 2, ci);
      api.rect(r.x + s, r.y - s, 1, s * 2, ci);
    }
    for (const s of hitSparks) {
      const t = s.life / s.max;
      const L = Math.max(1, Math.round((s.big ? 8 : 5) * t));
      api.rect(s.x - 1, s.y - 1, 3, 3, WHITE);
      api.rect(s.x - L, s.y, L * 2 + 1, 1, WHITE);
      api.rect(s.x, s.y - L, 1, L * 2 + 1, WHITE);
      for (let i = 2; i <= L; i++) {
        api.px(s.x + i, s.y + i, YELLOW);
        api.px(s.x - i, s.y - i, YELLOW);
        api.px(s.x + i, s.y - i, ORANGE);
        api.px(s.x - i, s.y + i, ORANGE);
      }
    }
    for (const f of flashes) {
      if (f.dither) {
        for (let yy = f.y; yy < f.y + f.h; yy += 2)
          api.rect(f.x + (yy & 2 ? 1 : 0), yy, f.w, 1, WHITE);
      } else {
        const inset = (3 - f.life) * 2;
        api.rect(f.x + inset, f.y + inset, Math.max(1, f.w - inset * 2),
                 Math.max(1, f.h - inset * 2), WHITE);
      }
    }
    if (scene === 'serve' || scene === 'play' || scene === 'clear') drawPaddle(api);
    if (scene === 'serve' || scene === 'play') drawBall(api);
    for (const p of particles) {
      if (p.life < p.max * 0.3 && api.frame % 2) continue;
      const s = p.kind === 'debris' && p.life > p.max * 0.55 ? 2 : 1;
      if (s === 1) api.px(p.x, p.y, p.ci);
      else api.rect(p.x, p.y, 2, 2, p.ci);
    }
    for (const p of popups) {
      if (p.life > 10 || api.frame % 4 < 2) {
        api.text(p.text, (p.x | 0) + 1, (p.y | 0) + 1, NAVY);
        api.text(p.text, p.x | 0, p.y | 0, p.ci);
      }
    }
  }

  /* 外层 UI 边框:左右立柱(静态,不参与震动) */
  function drawBezel(api) {
    api.rect(0, 0, BEZEL, H, NAVY);
    api.rect(FX1, 0, BEZEL, H, NAVY);
    api.rect(FX0 - 1, 0, 1, H, SLATE);        // 内沿亮线
    api.rect(FX1, 0, 1, H, SLATE);
    api.rect(FX0 - 1, 14, 1, 10, CYAN);       // 上下青色角标
    api.rect(FX1, 14, 1, 10, CYAN);
    api.rect(FX0 - 1, H - 24, 1, 10, CYAN);
    api.rect(FX1, H - 24, 1, 10, CYAN);
    for (let y = 30; y < H - 34; y += 18) {   // 铆钉
      api.rect(10, y, 2, 2, SLATE);
      api.rect(W - 12, y, 2, 2, SLATE);
    }
  }

  function drawHud(api, off) {                // off:入场时 HUD 从顶部滑入
    drawBezel(api);
    api.rect(FX0, off, FX1 - FX0, 10, NAVY);
    api.rect(FX0, off + 10, FX1 - FX0, 1, SLATE);
    const sTxt = 'SCORE ' + String(score).padStart(5, '0');
    api.text(sTxt, FX0 + 4, off + 5, NAVY); api.text(sTxt, FX0 + 3, off + 4, WHITE);
    const lTxt = 'LV' + level;
    const lx = FX0 + (FX1 - FX0 - api.textWidth(lTxt)) / 2;
    api.text(lTxt, lx + 1, off + 5, NAVY); api.text(lTxt, lx, off + 4, WHITE);
    for (let i = 0; i < Math.max(0, lives); i++)
      api.rect(FX1 - 10 - i * 10, off + 4, 7, 2, WHITE);
    if (scene === 'serve' || scene === 'play' || scene === 'clear') {
      const ratio = Math.max(0, Math.min(1, ball.sp / maxSpeed()));
      api.rect(129, off + 2, 42, 6, NAVY);
      api.rect(130, off + 3, 40, 4, SLATE);
      api.rect(131, off + 5, (38 * ratio) | 0, 1, ratio > 0.8 ? PCYAN : WHITE);
    }
  }

  function drawTitle(api) {
    drawPanel(api, 30, 36, 180, 92);          // 收进场地内
    centerShadow(api, 'AETHER CONSOLE', 46, LGRAY);
    const dy = Math.round(Math.sin(api.frame * 0.06) * 2);
    centerShadow(api, 'BREAKOUT', 58 + dy, WHITE, 3);
    centerText(api, 'ARCADE DEMO', 84, SLATE);
    if (api.frame % 60 < 36) centerShadow(api, 'PRESS START', 98, WHITE);
    centerText(api, 'ARROWS MOVE - Z LAUNCH - ENTER PAUSE', 114, SLATE);
    centerText(api, '240*180 60FPS', 132, SLATE);
  }

  return {
    name: 'BREAKOUT',
    version: '0.11',
    filter: 'none',   // 默认扫描线由壳层叠加实现(物理分辨率,细线)

    /* RGB565 调色板:
       静态 0黑 1藏青 2岩灰 3浅灰 4白
       彩色 5红 6橙 7黄 8绿 9青 10粉 11品红 12紫 13青柠 14冰蓝 15暖白 */
    palette: [
      0x0000, 0x2129, 0x5B30, 0xADB8, 0xFFFF,
      0xF20B, 0xFC86, 0xFE87, 0x2EED, 0x3E1E, 0xFBF5,
      0xE25A, 0x8ADE, 0xAF89, 0xAF7F, 0xFF98,
    ],

    init() {
      score = 0; lives = START_LIVES; level = 1;
      pad = { x: (W - PADDLE.w) / 2 };
      resetBricks(); stickBall();
      particles = []; chunks = []; hitSparks = [];
      popups = []; flashes = []; rings = []; trail = [];
      padSquash = 0; hitStop = 0; ballSq = 0;
      combo = 0; comboTimer = 0; goT = 0;
      stars = [];
      for (let i = 0; i < 30; i++) {
        stars.push({ x: rnd(0, W), y: rnd(0, H), v: rnd(0.05, 0.3),
                     ci: Math.random() < 0.75 ? NAVY : SLATE });
      }
      scene = 'title'; paused = false; introT = 0; introMode = false;
    },

    update(api) {
      if (hitStop > 0) { hitStop--; return; }
      updateFx();
      const jp = api.justPressed;

      if (scene === 'title') {
        if (api.frame % 7 === 0) ember();
        if (jp('start') || jp('a')) {
          scene = 'serve'; introT = 0; introMode = true;   // 完整入场
          api.shake(0.8);
        }
        return;
      }
      if (scene === 'over') {
        if (jp('start') || jp('a')) this.init();
        return;
      }

      if (jp('start')) paused = !paused;
      if (paused) return;

      if (api.pressed('left')) pad.x -= PADDLE.speed;
      if (api.pressed('right')) pad.x += PADDLE.speed;
      pad.x = Math.max(FX0, Math.min(FX1 - PADDLE.w, pad.x));

      if (scene === 'serve') {
        introT++;
        ball.x = pad.x + PADDLE.w / 2 - BALL / 2;
        ball.y = PADDLE.y - BALL - 1;
        // 入场完成瞬间:GO!
        if (introMode && introT === INTRO_LEN) {
          goT = 26;
          screenFlash(2);
          sparkFan(W / 2, 100, 14, 1.2);
          api.shake(1.2);
        }
        // 入场结束前锁发球
        if ((!introMode || introT >= INTRO_LEN) && jp('a')) {
          launch(); scene = 'play';
        }
        return;
      }

      if (scene === 'clear') {
        if (timer > 50) confetti();
        if (--timer <= 0) {
          level++; resetBricks(); stickBall();
          scene = 'serve'; introT = 0; introMode = true;   // 过关也走完整入场
        }
        return;
      }

      // —— play:速度动力学 + 球运动 ——
      ball.sp = Math.min(maxSpeed(), ball.sp + SPEED_ACCEL);
      applySp();
      ball.x += ball.vx;
      ball.y += ball.vy;
      trail.unshift({ x: ball.x, y: ball.y });
      if (trail.length > 6) trail.pop();
      wake();

      if (ball.x <= FX0) { ball.x = FX0; ball.vx = Math.abs(ball.vx); absorb(SPEED_WALL_HIT); bounceFx(api, FX0 + 1, ball.y + 1, 'x'); }
      if (ball.x + BALL >= FX1) { ball.x = FX1 - BALL; ball.vx = -Math.abs(ball.vx); absorb(SPEED_WALL_HIT); bounceFx(api, FX1 - 1, ball.y + 1, 'x'); }
      if (ball.y <= TOP) { ball.y = TOP; ball.vy = Math.abs(ball.vy); absorb(SPEED_WALL_HIT); bounceFx(api, ball.x + 1, TOP + 1, 'y'); }

      if (ball.vy > 0 &&
          ball.y + BALL >= PADDLE.y && ball.y + BALL <= PADDLE.y + PADDLE.h + 3 &&
          ball.x + BALL >= pad.x && ball.x <= pad.x + PADDLE.w) {
        const t = Math.max(-1, Math.min(1,
          (ball.x + BALL / 2 - (pad.x + PADDLE.w / 2)) / (PADDLE.w / 2)));
        const ang = t * Math.PI / 3;
        const sp = Math.min(maxSpeed(),
          Math.max(SPEED_MIN, Math.hypot(ball.vx, ball.vy) + SPEED_PAD_HIT));
        ball.vx = Math.sin(ang) * sp;
        ball.vy = -Math.cos(ang) * sp;
        ball.sp = sp;
        ball.y = PADDLE.y - BALL;
        combo = 0; comboTimer = 0;
        padSquash = 8;
        hitSpark(ball.x + 1, PADDLE.y, false);
        ring(ball.x + 1, PADDLE.y, 2);
        sparkFan(ball.x + 1, PADDLE.y - 2, 12, 0.8);
        api.shake(0.8);
        hitStop = 2;
        ballSq = 4; ballSqAxis = 'y';
      }

      for (const b of bricks) {
        if (!b.alive) continue;
        const ox = Math.min(ball.x + BALL, b.x + BR.w) - Math.max(ball.x, b.x);
        const oy = Math.min(ball.y + BALL, b.y + BR.h) - Math.max(ball.y, b.y);
        if (ox > 0 && oy > 0) {
          const axis = ox < oy ? 'x' : 'y';
          if (axis === 'x') { ball.vx = -ball.vx; ball.x += ball.vx > 0 ? ox : -ox; }
          else { ball.vy = -ball.vy; ball.y += ball.vy > 0 ? oy : -oy; }
          b.hp--;
          if (b.hp <= 0) absorb(SPEED_BRICK_HIT);
          else absorb(SPEED_BRICK_HIT * 0.7);
          if (Math.abs(ball.vy) < 0.2 * ball.sp) {
            ball.vy = (ball.vy >= 0 ? 1 : -1) * 0.3 * ball.sp;
            applySp();
          }
          if (b.hp <= 0) killBrick(api, b, axis);
          else crackBrick(api, b, axis);
          break;
        }
      }

      if (ball.y > H) {
        burstDebris(ball.x, H - 4, 0, -1, 20, 12, RED);
        sparkFan(ball.x, H - 8, 12, 1.4);
        hitSpark(ball.x + 1, H - 8, true);
        ring(ball.x, H - 8, 4);
        flashes.push({ x: FX0, y: H - 5, w: FX1 - FX0, h: 5, life: 3 });
        api.shake(5);
        hitStop = 4;
        lives--;
        if (lives <= 0) scene = 'over';
        else {
          stickBall(); scene = 'serve'; introT = 0; introMode = false; // 快速复位
        }
      }
    },

    draw(api) {
      api.cls(BG);
      for (const s of stars) {
        const tw = (api.frame + ((s.x * 31 + s.y * 7) | 0)) % 240 < 12;
        api.px(s.x, s.y, tw ? LGRAY : s.ci);
      }
      drawWorld(api);
      // HUD 入场:从顶部滑入(easeOut 平方根)
      const hudOff = (scene === 'serve' && introMode && introT < 18)
        ? Math.round(-14 * Math.sqrt(1 - introT / 18)) : 0;
      drawHud(api, hudOff);
      if (scene === 'title') {
        drawTitle(api);
      } else if (scene === 'serve') {
        if (introMode && introT < INTRO_LEN - 12) {
          if (api.frame % 10 < 7) centerShadow(api, 'READY', 104, WHITE, 2);
        } else if (!introMode || introT >= INTRO_LEN) {
          if (api.frame % 60 < 36) centerShadow(api, 'Z:LAUNCH', 124, WHITE);
        }
      } else if (scene === 'clear') {
        centerShadow(api, 'LEVEL CLEAR!', 78, WHITE, 2);
        centerShadow(api, '+100', 100, WHITE);
      } else if (scene === 'over') {
        drawPanel(api, 40, 56, 160, 68);
        centerShadow(api, 'GAME OVER', 66, WHITE, 2);
        centerShadow(api, 'SCORE ' + score, 92, WHITE);
        if (api.frame % 60 < 36) centerShadow(api, 'PRESS START', 106, LGRAY);
      }
      if (goT > 0 && (goT > 8 || api.frame % 4 < 2)) {
        centerShadow(api, 'GO!', 96, WHITE, 2);
      }
      if (scene === 'play' && comboTimer > 0 && combo >= 2) {
        if (comboTimer >= 15 || api.frame % 4 < 2) {
          const scale = comboTimer > 48 ? 2 : 1;
          centerShadow(api, combo + ' HITS!', 96, WHITE, scale);
        }
      }
      if (paused && scene !== 'title' && scene !== 'over') {
        drawPanel(api, 82, 74, 76, 30);
        centerShadow(api, 'PAUSE', 84, WHITE, 2);
      }
    },
  };

  /* 碰撞吸能 */
  function absorb(amount) {
    ball.sp = Math.max(SPEED_MIN, ball.sp - amount);
    applySp();
  }
})();
