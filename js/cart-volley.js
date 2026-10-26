/*
 * 卡带:PUFF VOLLEY · 圆球兽排球(v1.0)
 * 颜色模式 A:24 色调色板;240×180 索引帧缓冲
 * 致敬皮卡丘排球(pikachu volleyball)的核心手感:
 *   无攻击键 —— 身体碰到球即自动出拳,拳向 = 球在身体的哪一侧;
 *   球撞两侧墙壁反弹、过网才有效,落地即失分;先得 15 分获胜
 * 物理:重力 0.22/帧²,玩家地面加速 0.35 / 空中 0.16,跳跃 -6.3;
 *   出拳:vx = ±(3.8 + |自身速度|×0.5),vy = -(3.0 + |球速|×0.25);
 *   同一玩家连续出拳有冷却,离开身体范围后恢复
 * AI:前向模拟球的轨迹预测落点,按难度限制反应间隔 / 移速 / 误差 / 起跳率
 * 输入:←→ / A D 移动 · ↑ / W 跳 · Enter 开始 / 暂停 · Z 确认
 */
const PuffVolleyCart = (function () {
  'use strict';

  const W = 240, H = 180;
  const HUD_H = 14;
  const GY = 162;                 // 地面(脚底)
  const NET_X = 120, NET_TOP = 122, NET_W = 3;
  const GRAV = 0.22;
  const BALL_R = 7;
  const PR = 11;                  // 玩家半径(身体圆)
  const WIN_PT = 15;

  // —— 调色板索引 ——
  const INK = 0, SKY1 = 1, SKY2 = 2, SKY3 = 3, SUN = 4, SEA = 5, SEAD = 6,
        SAND = 7, SANDD = 8, WHITE = 9, LGRAY = 10, GRAY = 11, DGRAY = 12,
        MINT = 13, MINTD = 14, CORAL = 15, CORALD = 16, RED = 17, ORANGE = 18,
        YELLOW = 19, GREEN = 20, CYAN = 21, VIOLET = 22, PINK = 23,
        SLATE = 12;             // 别名:副标题灰(同 DGRAY)

  const DIFFS = [
    { n: 'EASY',   v: 1.55, react: 20, jit: 32, jump: 0.35 },
    { n: 'NORMAL', v: 2.30, react: 12, jit: 16, jump: 0.62 },
    { n: 'HARD',   v: 3.05, react: 6,  jit: 7,  jump: 0.86 },
  ];

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // —— 状态 ——
  let scene;                 // title/serve/play/point/over/pause
  let diffSel;
  let p1, p2;                // {x,y,vx,vy,face,squash,jumpHeld,punchOk}
  let ball;                  // {x,y,vx,vy,live,trail,rot}
  let score1, score2, serveTo, rally;
  let freezeT, bannerT, bannerTxt, bannerCi;
  let clouds, parts, pops;
  let frameInScene, paused;
  let bestRally = 0;
  let lastPt = 1;

  const SAVE_KEY = 'ac_vb_best';

  function loadRec() {
    try { const s = localStorage.getItem(SAVE_KEY); if (s) return JSON.parse(s); } catch (e) {}
    return { w: 0, d: 0 };   // {w: 胜场, d: 难度}
  }
  function saveRec() {
    try {
      const r = loadRec();
      r.w++;
      r.d = diffSel;
      localStorage.setItem(SAVE_KEY, JSON.stringify(r));
    } catch (e) {}
  }

  function newMatch() {
    p1 = mkPlayer(60, MINT, MINTD);
    p2 = mkPlayer(180, CORAL, CORALD);
    score1 = 0; score2 = 0; serveTo = 1; rally = 0;
    parts = []; pops = [];
    setupServe(1);
  }

  function mkPlayer(x, ci, dark) {
    return { x, y: GY, vx: 0, vy: 0, face: x < 120 ? 1 : -1, ci, dark,
             squash: 0, punchOk: true, blink: (Math.random() * 200) | 0 };
  }

  function setupServe(to) {
    serveTo = to;
    const s = to === 1 ? p1 : p2;
    ball = { x: s.x + (to === 1 ? 14 : -14), y: s.y - 46, vx: 0, vy: 0,
             live: false, trail: [], rot: 0 };
    scene = 'serve';
    freezeT = 45;
    bannerTxt = to === 1 ? 'YOUR SERVE' : 'OPPONENT SERVE';
    bannerT = 45; bannerCi = to === 1 ? GREEN : ORANGE;
  }

  function pop(t, x, y, ci) { pops.push({ t, x, y, ci, life: 50 }); }
  function burst(x, y, ci, n, sp) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (sp || 1.6) * (0.4 + Math.random());
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.8,
                   ci, life: 12 + Math.random() * 20 });
    }
  }

  // —— 出拳(皮卡丘排球式:碰撞即强力击出,方向=球在身体哪侧)——
  function punch(p) {
    if (scene === 'serve') { scene = 'play'; ball.live = true; }
    const dir = ball.x >= p.x ? 1 : -1;
    ball.vx = dir * (3.8 + Math.abs(p.vx) * 0.5);
    if (ball.vx > 7) ball.vx = 7;
    if (ball.vx < -7) ball.vx = -7;
    ball.vy = -(3.0 + Math.abs(ball.vy) * 0.25);
    if (ball.vy < -8.8) ball.vy = -8.8;
    if (ball.vy > -1.5) ball.vy = -1.5;
    ball.vx += (Math.random() - 0.5) * 0.5;
    p.punchOk = false;
    p.face = dir;
    rally++;
    burst(ball.x, ball.y, WHITE, 5, 1.2);
    // 扣杀感:击球点高且球向下猛 → 强力
    if (ball.vy < -7) { burst(ball.x, ball.y, YELLOW, 8, 2.2); }
  }

  // —— 球物理 ——
  function stepBall(api) {
    ball.vy += GRAV;
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.rot += ball.vx * 0.06;
    // 侧墙反弹
    if (ball.x < 3 + BALL_R) { ball.x = 3 + BALL_R; ball.vx = Math.abs(ball.vx) * 0.92; }
    if (ball.x > W - 3 - BALL_R) { ball.x = W - 3 - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.92; }
    // 球网
    if (ball.y + BALL_R > NET_TOP) {
      if (ball.x < NET_X && ball.x + BALL_R > NET_X - NET_W) {
        ball.x = NET_X - NET_W - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.6;
      } else if (ball.x > NET_X && ball.x - BALL_R < NET_X + NET_W) {
        ball.x = NET_X + NET_W + BALL_R; ball.vx = Math.abs(ball.vx) * 0.6;
      }
    }
    // 网顶:坐网弹起
    if (Math.abs(ball.x - NET_X) < BALL_R + NET_W && ball.y + BALL_R > NET_TOP - 2 &&
        ball.y + BALL_R < NET_TOP + 4 && ball.vy > 0) {
      ball.vy = -ball.vy * 0.45;
      if (Math.abs(ball.vx) < 0.4) ball.vx += Math.random() < 0.5 ? -0.6 : 0.6;
    }
    // 轨迹
    ball.trail.push([ball.x, ball.y]);
    if (ball.trail.length > 9) ball.trail.shift();
    // 出拳判定
    tryPunch(p1);
    tryPunch(p2);
    // 落地
    if (ball.y + BALL_R >= GY) {
      ball.y = GY - BALL_R;
      const scorer = ball.x < NET_X ? 2 : 1;      // 球落在左边 → 对手得分
      burst(ball.x, GY, SANDD, 12, 2);
      api.shake(scorer === 1 ? 1.5 : 2.5);
      pointTo(scorer, api);
    }
  }

  function tryPunch(p) {
    const dx = Math.abs(ball.x - p.x), dy = Math.abs(ball.y - (p.y - PR));
    if (dx < PR + BALL_R + 2 && dy < PR + BALL_R + 4) {
      if (p.punchOk) punch(p);
    } else if (dx > PR + BALL_R + 9) {
      p.punchOk = true;
    }
  }

  function pointTo(who, api) {
    if (who === 1) score1++; else score2++;
    lastPt = who;
    if (rally > bestRally) bestRally = rally;
    scene = 'point';
    freezeT = 60;
    if (score1 >= WIN_PT || score2 >= WIN_PT) {
      bannerTxt = score1 > score2 ? 'YOU WIN!' : 'YOU LOSE...';
      bannerCi = score1 > score2 ? YELLOW : RED;
      if (score1 > score2) saveRec();
    } else {
      bannerTxt = who === 1 ? 'POINT YOU!' : 'POINT RIVAL';
      bannerCi = who === 1 ? GREEN : ORANGE;
    }
    bannerT = 90;
    void api;
  }

  // —— 玩家物理 ——
  function stepPlayer(p, input, minX, maxX) {
    const onG = p.y >= GY - 0.5;
    if (input.left) { p.vx -= onG ? 0.35 : 0.16; p.face = -1; }
    if (input.right) { p.vx += onG ? 0.35 : 0.16; p.face = 1; }
    if (!input.left && !input.right && onG) p.vx *= 0.8;
    if (input.jump && onG) { p.vy = -6.3; p.squash = -0.5; }
    p.vx = clamp(p.vx, -2.9, 2.9);
    p.vy += GRAV;
    p.x = clamp(p.x + p.vx, minX, maxX);
    p.y += p.vy;
    if (p.y > GY) {
      if (p.vy > 3.5) { p.squash = 0.6; burst(p.x, GY, SANDD, 5, 1); }
      p.y = GY; p.vy = 0;
    }
    p.squash *= 0.85;
    p.blink++;
  }

  // —— AI:预测落点 + 按难度加噪 ——
  let aiTarget = 184, aiClock = 0;
  function stepAI(api) {
    const D = DIFFS[diffSel];
    aiClock++;
    const onMySide = ball.x > NET_X - 6 || ball.vx > 0.3;
    if (aiClock % D.react === 0) {
      if (onMySide && ball.live !== false) {
        // 前向模拟球轨迹求落点(含墙反弹,忽略网)
        let sx = ball.x, sy = ball.y, svx = ball.vx, svy = ball.vy;
        for (let i = 0; i < 240; i++) {
          svy += GRAV; sx += svx; sy += svy;
          if (sx < 3 + BALL_R) { sx = 3 + BALL_R; svx = -svx; }
          if (sx > W - 3 - BALL_R) { sx = W - 3 - BALL_R; svx = -svx; }
          if (sy + BALL_R >= GY) break;
        }
        aiTarget = clamp(sx + (Math.random() - 0.5) * D.jit, 130, 230);
      } else {
        aiTarget = 184 + (Math.random() - 0.5) * 10;
      }
    }
    const dx = aiTarget - p2.x;
    const input = { left: dx < -2, right: dx > 2, jump: false };
    // 起跳截击:球在头顶附近且正在下落
    if (ball.live !== false && ball.vy > 0.5 &&
        Math.abs(ball.x - p2.x) < 26 && ball.y < p2.y - 30 &&
        p2.y >= GY - 0.5 && Math.random() < D.jump * 0.12)
      input.jump = true;
    // 发球时走到球下方起跳
    if (scene === 'serve' && serveTo === 2) {
      input.left = ball.x < p2.x - 2 && ball.x > 132;
      input.right = ball.x > p2.x + 2;
      if (Math.abs(ball.x - p2.x) < 4 && p2.y >= GY - 0.5 && Math.random() < 0.3)
        input.jump = true;
    }
    stepPlayer(p2, input, 130, 230);
  }

  // —— 绘制 ——
  function drawCourt(api) {
    // 天空三段
    api.rect(0, HUD_H, W, 50, SKY1);
    api.rect(0, HUD_H + 50, W, 20, SKY2);
    api.rect(0, HUD_H + 70, W, 26, SKY3);
    // 太阳
    const sx = 26, sy = 34;
    api.rect(sx - 6, sy - 2, 12, 4, SUN);
    api.rect(sx - 2, sy - 6, 4, 12, SUN);
    for (let i = 0; i < 4; i++) {
      const a = api.frame * 0.02 + i * 1.57;
      api.px(sx + Math.cos(a) * 10, sy + Math.sin(a) * 10, SUN);
    }
    // 云
    for (const c of clouds) {
      c.x += c.s;
      if (c.x > W + 20) c.x = -20;
      api.rect(c.x, c.y, 16, 4, WHITE);
      api.rect(c.x + 3, c.y - 3, 10, 4, WHITE);
    }
    // 海
    api.rect(0, HUD_H + 96, W, 8, SEA);
    api.rect(0, HUD_H + 96, W, 2, SEAD);
    for (let i = 0; i < 12; i++)
      api.px((i * 37 + api.frame * 0.4) % W, HUD_H + 99 + (i % 3), SKY3);
    // 沙地
    api.rect(0, HUD_H + 104, W, H - HUD_H - 104, SAND);
    api.rect(0, HUD_H + 104, W, 2, LGRAY);
    for (let i = 0; i < 26; i++) {
      const x = (i * 71) % W, y = HUD_H + 110 + (i * 29) % (H - HUD_H - 116);
      api.px(x, y, SANDD);
    }
    // 边线
    api.rect(0, GY, W, 2, SANDD);
  }

  function drawNet(api) {
    // 网柱
    api.rect(NET_X - NET_W, NET_TOP, NET_W * 2, GY - NET_TOP, DGRAY);
    // 网面(横线)
    for (let y = NET_TOP + 3; y < GY - 2; y += 5)
      api.rect(NET_X - NET_W - 5, y, NET_W * 2 + 10, 1, WHITE);
    // 白边
    api.rect(NET_X - NET_W - 5, NET_TOP, NET_W * 2 + 10, 2, WHITE);
    api.px(NET_X - NET_W - 6, NET_TOP + 2, DGRAY);
    api.px(NET_X + NET_W + 5, NET_TOP + 2, DGRAY);
  }

  function drawShadow(api, x, y, w) {
    const k = clamp(1 - (GY - y) / 130, 0.3, 1);
    const sw = Math.round(w * k);
    api.rect(x - sw / 2, GY + 1, sw, 2, SANDD);
  }

  function drawPuff(api, p, isP1) {
    const sq = p.squash;                       // >0 压扁, <0 拉长
    const rx = Math.round(PR * (1 + sq * 0.4));
    const ry = Math.round(PR * (1 - sq * 0.4));
    const cx = Math.round(p.x), cy = Math.round(p.y - PR);
    drawShadow(api, p.x, p.y, rx * 2);
    // 耳朵
    const ex = p.face >= 0 ? 3 : -3;
    api.rect(cx - 6 + ex, cy - ry - 5, 2, 5, p.ci);
    api.rect(cx + 4 + ex, cy - ry - 5, 2, 5, p.ci);
    api.px(cx - 6 + ex, cy - ry - 6, p.dark); api.px(cx + 4 + ex, cy - ry - 6, p.dark);
    // 身体
    for (let dy = -ry; dy <= ry; dy++) {
      const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
      api.rect(cx - half, cy + dy, half * 2, 1, dy > ry - 3 ? p.dark : p.ci);
    }
    // 眼睛看向球
    const lookX = ball ? clamp((ball.x - p.x) / 40, -1.4, 1.4) : 0;
    const lookY = ball ? clamp((ball.y - cy) / 60, -1, 1.5) : 0;
    const blink = p.blink % 190 < 6;
    for (const side of [-1, 1]) {
      const ey = cy - 2, exx = cx + side * 4;
      if (blink) api.rect(exx - 1, ey, 3, 1, INK);
      else {
        api.rect(exx - 1, ey - 1, 3, 3, WHITE);
        api.px(exx + Math.round(lookX), ey - 1 + Math.round(lookY), INK);
      }
      api.px(exx, ey + 3, PINK);              // 腮红
    }
    // 嘴
    api.px(cx + Math.round(lookX * 0.8), cy + 3, INK);
    // 尾巴(卷卷的小尾巴)
    const tx = cx + (p.face >= 0 ? rx : -rx);
    api.px(tx, cy + 2, p.ci); api.px(tx + p.face, cy + 1, p.ci);
    api.px(tx + p.face, cy, p.ci); api.px(tx, cy - 1, p.ci);
    void isP1;
  }

  function drawBall(api) {
    // 轨迹
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i];
      if (i % 2) continue;
      api.px(t[0], t[1], LGRAY);
    }
    drawShadow(api, ball.x, ball.y + BALL_R, 10);
    const cx = Math.round(ball.x), cy = Math.round(ball.y);
    for (let dy = -BALL_R; dy <= BALL_R; dy++) {
      const half = Math.round(BALL_R * Math.sqrt(Math.max(0, 1 - (dy * dy) / (BALL_R * BALL_R))));
      api.rect(cx - half, cy + dy, half * 2, 1, dy > BALL_R - 2 ? LGRAY : WHITE);
    }
    // 排球纹(随旋转的两条弧)
    const r = ball.rot;
    for (let k = 0; k < 3; k++) {
      const a = r + k * 2.09;
      for (let i = -BALL_R + 2; i <= BALL_R - 2; i++) {
        const px2 = cx + Math.round(i * Math.cos(a));
        const py2 = cy + Math.round(i * Math.sin(a) * 0.6);
        if ((px2 - cx) * (px2 - cx) + (py2 - cy) * (py2 - cy) <= (BALL_R - 1) * (BALL_R - 1))
          api.px(px2, py2, k === 0 ? ORANGE : YELLOW);
      }
    }
  }

  function drawHud(api) {
    api.rect(0, 0, W, HUD_H, INK);
    const s = score1 + ' - ' + score2;
    api.text(s, (W - api.textWidth(s, 2)) / 2, 3, WHITE, 2);
    api.text(DIFFS[diffSel].n, 4, 5, CYAN);
    if (rally >= 3) {
      const rt = 'RALLY ' + rally;
      api.text(rt, W - 4 - api.textWidth(rt), 5, rally >= 8 ? YELLOW : LGRAY);
    }
    // 赛点
    if (score1 >= WIN_PT - 1 && score1 > score2) api.text('MATCH PT', 44, 5, YELLOW);
    else if (score2 >= WIN_PT - 1 && score2 > score1) api.text('MATCH PT', 168, 5, ORANGE);
  }

  function centerText(api, s, y, ci, scale) {
    api.text(s, (W - api.textWidth(s, scale)) / 2, y, ci, scale);
  }

  function drawTitle(api) {
    drawCourt(api);
    drawNet(api);
    // 演出:AI 自己颠球
    const t = api.frame;
    p1.x = 60; p1.y = GY; p1.squash = 0;
    p2.x = 180; p2.y = GY;
    ball.x = 120 + Math.sin(t * 0.03) * 55;
    ball.y = 80 + Math.sin(t * 0.07) * 22;
    ball.trail = [];
    drawBall(api);
    drawPuff(api, p1, true);
    drawPuff(api, p2, false);

    api.rect(24, 16, 192, 62, INK);
    const bob = Math.sin(t * 0.06) * 2;
    api.text('PUFF', (W - api.textWidth('PUFF', 3)) / 2, 22 + bob, YELLOW, 3);
    api.text('VOLLEY', (W - api.textWidth('VOLLEY', 3)) / 2, 40 - bob, GREEN, 3);
    api.text(DIFFS[diffSel].n + '  <  >', (W - api.textWidth(DIFFS[diffSel].n + '  <  >')) / 2, 62, CYAN);
    const rec = loadRec();
    if (rec.w) api.text('WINS ' + rec.w, 104, 72, LGRAY);
    if (t % 60 < 38) centerText(api, 'PRESS Z OR START', 96, WHITE);
    centerText(api, 'FIRST TO ' + WIN_PT + ' POINTS', 116, LGRAY);
    centerText(api, 'ARROWS MOVE - UP JUMP', 128, SLATE);
    centerText(api, 'BODY HITS BALL AUTOMATICALLY', 140, SLATE);
  }

  function drawBanner(api) {
    if (bannerT <= 0) return;
    if (bannerT < 15 && api.frame % 4 < 2) return;
    api.rect(40, 66, 160, 30, INK);
    api.rect(40, 66, 160, 1, bannerCi); api.rect(40, 95, 160, 1, bannerCi);
    api.rect(40, 66, 1, 30, bannerCi); api.rect(199, 66, 1, 30, bannerCi);
    api.text(bannerTxt, (W - api.textWidth(bannerTxt, 2)) / 2, 74, bannerCi, 2);
    if (scene === 'serve') {
      const s = serveTo === 1 ? 'JUMP AND HIT IT OVER' : 'GET READY!';
      api.text(s, (W - api.textWidth(s)) / 2, 88, LGRAY);
    }
  }

  return {
    name: 'PUFF VOLLEY',
    version: '1.0',
    filter: 'none',

    /* 0黑 1天顶 2天中 3天底 4日光 5海 6海暗 7沙 8沙暗 9白 10浅灰 11灰 12深灰
       13薄荷 14薄荷暗 15珊瑚 16珊瑚暗 17红 18橙 19黄 20绿 21青 22紫 23粉 */
    palette: [
      0x0000, 0x6E5C, 0x9CD3, 0xCE79, 0xFE87, 0x267E, 0x133E, 0xFDB8,
      0xDB60, 0xFFFF, 0xADB8, 0x7C32, 0x426B, 0x5FDD, 0x2EA6, 0xFD42,
      0xCB03, 0xF800, 0xFC86, 0xFE87, 0x2EED, 0x07FF, 0x8ADE, 0xE25A,
    ],

    init() {
      scene = 'title';
      diffSel = 1;
      p1 = mkPlayer(60, MINT, MINTD);
      p2 = mkPlayer(180, CORAL, CORALD);
      ball = { x: 120, y: 80, vx: 0, vy: 0, live: false, trail: [], rot: 0 };
      score1 = 0; score2 = 0; rally = 0; serveTo = 1;
      freezeT = 0; bannerT = 0; frameInScene = 0; paused = false;
      parts = []; pops = [];
      clouds = [];
      for (let i = 0; i < 4; i++)
        clouds.push({ x: 20 + i * 60, y: 26 + (i % 2) * 14, s: 0.06 + i * 0.02 });
    },

    update(api) {
      const jp = api.justPressed;
      frameInScene++;
      if (bannerT > 0) bannerT--;
      // 粒子推进(所有场景通用)
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.07;
        if (--p.life <= 0) parts.splice(i, 1);
      }

      if (scene === 'title') {
        if (jp('left')) diffSel = (diffSel + 2) % 3;
        if (jp('right')) diffSel = (diffSel + 1) % 3;
        if (jp('a') || jp('start')) { newMatch(); }
        return;
      }
      if (paused) {
        if (jp('start')) paused = false;
        return;
      }
      if (jp('start') && (scene === 'play' || scene === 'serve')) { paused = true; return; }

      if (scene === 'serve') {
        stepPlayer(p1, readP1Input(api), 8, 108);
        stepAI(api);
        // 球先悬停在发球者头顶,读秒后开始下落;任何一方出拳即进入对打
        const s = serveTo === 1 ? p1 : p2;
        if (freezeT > 18) {
          ball.x += (s.x + (serveTo === 1 ? 14 : -14) - ball.x) * 0.2;
          ball.y += (s.y - 46 - ball.y) * 0.1;
          ball.vy = 0; ball.vx = 0;
        } else {
          ball.vy += GRAV;
          ball.x += ball.vx;
          ball.y += ball.vy;
          tryPunch(p1); tryPunch(p2);
          if (ball.y + BALL_R >= GY) {          // 发球方没接住:对方得分
            pointTo(serveTo === 1 ? 2 : 1, api);
          }
        }
        if (--freezeT < -300) { scene = 'play'; ball.live = true; }
        return;
      }

      if (scene === 'play') {
        stepPlayer(p1, readP1Input(api), 8, 108);
        stepAI(api);
        stepBall(api);
        return;
      }

      if (scene === 'point') {
        stepPlayer(p1, { left: false, right: false, jump: false }, 8, 108);
        if (--freezeT <= 0) {
          if (score1 >= WIN_PT || score2 >= WIN_PT) {
            scene = 'over';
            bannerT = 0;
          } else {
            setupServe(lastPt);
          }
        }
        return;
      }

      if (scene === 'over') {
        if (jp('a') || jp('start')) newMatch();
        if (jp('b')) scene = 'title';
        return;
      }
    },

    draw(api) {
      if (scene === 'title') { drawTitle(api); return; }
      drawCourt(api);
      drawNet(api);
      drawPuff(api, p2, false);
      drawPuff(api, p1, true);
      drawBall(api);
      // 粒子 / 弹字
      for (const p of parts) {
        if (p.life < 8 && api.frame % 2) continue;
        api.px(p.x, p.y, p.ci);
      }
      for (const p of pops) api.text(p.t, p.x - api.textWidth(p.t) / 2, p.y, p.ci);
      drawHud(api);
      drawBanner(api);
      if (scene === 'over') {
        api.rect(36, 54, 168, 76, INK);
        const win = score1 > score2;
        api.rect(36, 54, 168, 1, win ? YELLOW : RED);
        api.rect(36, 129, 168, 1, win ? YELLOW : RED);
        api.rect(36, 54, 1, 76, win ? YELLOW : RED);
        api.rect(203, 54, 1, 76, win ? YELLOW : RED);
        const s = win ? 'YOU WIN!' : 'YOU LOSE...';
        api.text(s, (W - api.textWidth(s, 3)) / 2, 64, win ? YELLOW : RED, 3);
        const f = score1 + ' - ' + score2;
        api.text(f, (W - api.textWidth(f, 2)) / 2, 90, WHITE, 2);
        const b = 'BEST RALLY ' + bestRally;
        api.text(b, (W - api.textWidth(b)) / 2, 108, LGRAY);
        if (api.frame % 60 < 38) centerText(api, 'Z:REMATCH X:TITLE', 118, GREEN);
      }
      if (paused) {
        api.rect(84, 76, 72, 26, INK);
        api.rect(84, 76, 72, 1, WHITE); api.rect(84, 101, 72, 1, WHITE);
        api.rect(84, 76, 1, 26, WHITE); api.rect(155, 76, 1, 26, WHITE);
        centerText(api, 'PAUSED', 84, WHITE, 2);
      }
    },
    /* 调试探针(只读,不影响玩法) */
    _debug: () => ({ scene, score1, score2, rally,
                     bx: Math.round(ball.x), by: Math.round(ball.y),
                     p1x: Math.round(p1.x), p2x: Math.round(p2.x) }),
  };

  function readP1Input(api) {
    return {
      left: api.pressed('left'),
      right: api.pressed('right'),
      jump: api.pressed('up'),
    };
  }
})();
