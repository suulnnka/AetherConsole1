/*
 * 卡带:AETHER GP · FC 风伪 3D 赛车(v1.0)
 * 颜色模式 A:30 色调色板;240×180 索引帧缓冲
 * 渲染:逐扫描线透视投影(经典 Lou 伪 3D 扫描线法,无三方库):
 *   自下而上累计弯道偏移,得到每行路面中心;精灵按 z 反投影定位
 * 输入:↑ 油门 · ↓ 刹车 · ←→ 转向 · Enter 开始/暂停
 * 玩法:检查点续时(每 2600 单位 +20S);撞车减速掉速;擦身而过有 CLOSE 加分;
 *   每 2 个检查点进下一 STAGE(白天→黄昏→夜晚循环,弯更急车更密);
 *   时间归零结束;最佳成绩记入 localStorage
 * 打击感:撞车命中停顿 + 火花 + 红闪 · 路肩碎石 · 高速抖屏 ·
 *   检查点拱门 + 白闪弹字 · 起步 3-2-1-GO 倒计时
 */
const AetherGPCart = (function () {
  'use strict';

  const W = 240, H = 180, HZN = 62, DYMAX = H - 1 - HZN;   // 地平线 62,行距 1..117
  const CAMD = 620;               // 透视常数:z = CAMD / dy
  const CP_DIST = 2800;           // 检查点间距
  const TAU = Math.PI * 2;

  // —— 调色板索引 ——
  const BG = 0, INK = 1, SKYD = 2, SKYU = 3, SKYN = 4,
        GAD = 5, GBD = 6, GAU = 7, GBU = 8, GAN = 9, GBN = 10,
        ROADA = 11, ROADB = 12, RED = 13, WHITE = 14, LGRAY = 15,
        SLATE = 16, GOLD = 17, YELLOW = 18, ORANGE = 19, GREEN = 20,
        ICE = 21, CYAN = 22, VIOLET = 23,
        MTFD = 24, MTND = 25, MTFU = 26, MTNU = 27, MTFN = 28, MTNN = 29;

  const THEMES = [               // 白天 → 黄昏 → 夜晚(随 STAGE 循环)
    { sky: SKYD, gA: GAD, gB: GBD, mtF: MTFD, mtN: MTND, sun: YELLOW, night: false },
    { sky: SKYU, gA: GAU, gB: GBU, mtF: MTFU, mtN: MTNU, sun: RED, night: false },
    { sky: SKYN, gA: GAN, gB: GBN, mtF: MTFN, mtN: MTNN, sun: WHITE, night: true },
  ];
  const CAR_CI = [RED, GREEN, YELLOW, ICE, ORANGE, VIOLET];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const irnd = (a, b) => (a + Math.random() * (b - a)) | 0;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // —— 状态 ——
  let scene, paused, frame, freeze, flashT, flashCi;
  let camZ, v, playerX, steer, curveS, sections, secIdx, bgX;
  let time, score, cpNext, cpDone, stage, bannerT, bannerA, bannerB, bannerCi;
  let cars, pylons, gates, parts, pops, crashT, nearT, startT, overT, best;
  let cxAt, starField;

  function loadBest() {
    try { const s = localStorage.getItem('ac_gp_best'); if (s) return +s || 0; } catch (e) {}
    return 0;
  }
  function saveBest() {
    if (score > best) { best = score; try { localStorage.setItem('ac_gp_best', String(score)); } catch (e) {} }
  }

  function burst(x, y, n, ci, sp, life) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), s = rnd(sp * 0.3, sp);
      const m = irnd(life * 0.6, life);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7,
                   ci, life: m, max: m, g: 0.12 });
    }
  }
  function pop(t, x, y, ci) { pops.push({ t, x, y, ci, life: 46 }); }

  // —— 路段生成:直道 / 缓弯 / 急弯 / S 弯,难度随 STAGE ——
  function genSection(z) {
    const mag = Math.min(1.25, 0.7 + stage * 0.09);
    const r = Math.random();
    let curve = 0, len = irnd(320, 680);
    if (r < 0.34) curve = 0;                                  // 直道
    else if (r < 0.62) curve = rnd(0.28, 0.5) * (irnd(0, 2) ? 1 : -1);
    else if (r < 0.85) curve = rnd(0.55, 0.8) * (irnd(0, 2) ? 1 : -1);
    else { curve = rnd(0.8, 1) * (irnd(0, 2) ? 1 : -1); len = irnd(240, 420); }
    return { curve: curve * mag, len, start: z };
  }
  function ensureSections() {
    let last = sections[sections.length - 1];
    while (last.start + last.len < camZ + 900) {
      last = genSection(last.start + last.len);
      sections.push(last);
    }
    while (sections[secIdx] && camZ >= sections[secIdx].start + sections[secIdx].len) secIdx++;
  }

  function genPylons() {
    let lastZ = pylons.length ? pylons[pylons.length - 1].z : 40;
    while (lastZ < camZ + 700) {
      lastZ += 46;
      pylons.push({ z: lastZ, side: (pylons.length & 1) ? 1 : -1 });
    }
    while (pylons.length && pylons[0].z < camZ - 30) pylons.shift();
  }

  function spawnCar() {
    const lane = rnd(-0.62, 0.62);
    for (const c of cars)                                 // 同车道保持间距
      if (c.lane > lane - 0.24 && c.lane < lane + 0.24 && Math.abs(c.z - (camZ + 300)) < 60) return;
    cars.push({ z: camZ + rnd(280, 540), lane,
                spd: rnd(2.6, 4.2) + stage * 0.12,
                ci: CAR_CI[irnd(0, CAR_CI.length)], passed: false, minDiff: 9 });
  }

  function resetRun() {
    scene = 'play'; paused = false;
    camZ = 0; v = 0; playerX = 0; steer = 0; curveS = 0;
    sections = [{ curve: 0, len: 420, start: 0 }]; secIdx = 0;
    ensureSections();
    pylons = []; genPylons();
    cars = []; gates = []; parts = []; pops = [];
    time = 50; score = 0; cpNext = CP_DIST; cpDone = 0; stage = 1;
    crashT = 0; nearT = 0; freeze = 0; flashT = 0;
    bannerT = 0; startT = 150; overT = 0; bgX = 0;
  }

  function doCrash(api, car) {
    crashT = 55;
    freeze = 6;
    flashT = 4; flashCi = RED;
    api.shake(5);
    v *= 0.28;
    burst(120, 148, 22, ORANGE, 3, 30);
    burst(120, 148, 10, WHITE, 2, 20);
    pop('CRASH!', 96, 120, RED);
    car.z = camZ - 30;                                     // 撞停后落在身后
  }

  function updatePlay(api) {
    frame++;
    if (bannerT > 0) bannerT--;
    if (flashT > 0) flashT--;
    if (nearT > 0) nearT--;
    for (let i = parts.length - 1; i >= 0; i--) {          // 粒子(自由落体)
      const p = parts[i];
      p.x += p.vx; p.y += p.vy; p.vy += p.g;
      if (--p.life <= 0) parts.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--)
      if (--pops[i].life <= 0) pops.splice(i, 1);
    if (freeze > 0) { freeze--; return; }                  // 命中停顿
    if (startT > 0) {                                      // 3-2-1-GO
      startT--;
      if (startT === 0) { bannerT = 40; bannerA = 'GO!'; bannerB = ''; bannerCi = GREEN; }
      return;
    }

    const vmax = Math.min(8.2, 6.5 + stage * 0.16);
    if (crashT > 0) crashT--;
    // —— 纵向:油门 / 刹车 / 拖滞 ——
    if (api.pressed('up') && crashT <= 0) {
      v += 0.058;
      if (api.frame % 5 === 0)                             // 排气尾流
        parts.push({ x: 120 + rnd(-6, 6), y: 166, vx: rnd(-0.4, 0.4), vy: 2.2,
                     ci: api.frame % 10 ? SLATE : LGRAY, life: 8, max: 8, g: 0 });
    } else if (api.pressed('down')) v *= 0.93;
    else v *= 0.994;

    // —— 路外减速 ——
    const off = Math.abs(playerX) > 1.02;
    if (off) {
      v = Math.min(v, 3.4);
      v *= 0.975;
      if (v > 0.8 && api.frame % 3 === 0) {
        burst(120 + playerX * 28, 164, 2, THEMES[(stage - 1) % 3].gA, 1.6, 14);
        api.shake(0.7);
      }
    }
    v = clamp(v, 0, off ? 3.4 : vmax);

    // —— 转向 + 离心力 ——
    const dir = (api.pressed('right') ? 1 : 0) - (api.pressed('left') ? 1 : 0);
    steer += (dir - steer) * 0.25;
    playerX += steer * 0.026 * (0.35 + v / 6);
    playerX -= curveS * v * 0.0125;
    playerX = clamp(playerX, -1.55, 1.55);

    camZ += v;
    bgX -= curveS * v * 0.6;                               // 山体视差
    ensureSections();
    curveS += (sections[secIdx].curve - curveS) * 0.05;
    genPylons();

    // —— 计时 / 检查点 ——
    time -= 1 / 60;
    if (camZ >= cpNext) {
      cpNext += CP_DIST;
      cpDone++;
      time = Math.min(60, time + 12);
      score += 500;
      gates.push({ z: camZ + 30, t: 0 });
      bannerT = 80; bannerA = 'CHECKPOINT'; bannerB = 'TIME +12'; bannerCi = CYAN;
      flashT = 2; flashCi = WHITE;
      api.shake(1.5);
      pop('+500', 104, 96, GOLD);
      const ns = 1 + (cpDone >> 1);
      if (ns > stage) {
        stage = ns;
        bannerT = 110; bannerA = 'STAGE ' + stage; bannerB = 'FASTER TRAFFIC'; bannerCi = YELLOW;
      }
    }
    for (let i = gates.length - 1; i >= 0; i--)
      if (--gates[i].t > 90 || gates[i].z < camZ - 20) gates.splice(i, 1);

    if (time <= 0) {
      time = 0;
      saveBest();
      scene = 'over'; overT = 0;
      api.shake(3);
      return;
    }

    // —— 车流 ——
    const want = Math.min(9, 4 + stage);
    if (cars.length < want && Math.random() < 0.06) spawnCar();
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      c.z += c.spd;
      const zRel = c.z - camZ;
      const diff = Math.abs(playerX - c.lane);
      if (zRel < 40 && zRel > -10) c.minDiff = Math.min(c.minDiff, diff);
      if (crashT <= 0 && zRel > 1 && zRel < 11 && diff < 0.17 && v > 0.6) {
        doCrash(api, c);                                   // 追尾
      } else if (zRel <= 1 && !c.passed) {
        c.passed = true;
        if (c.minDiff < 0.36) {                            // 擦身而过
          score += 100;
          nearT = 40;
          pop('CLOSE! +100', 92, 118, ICE);
        }
      }
      if (zRel < -60 || zRel > 700) cars.splice(i, 1);
    }

    // —— 高速氛围 ——
    if (v > vmax * 0.92 && api.frame % 9 === 0) api.shake(0.4);
  }

  // —— 山脊(正弦叠加)——
  const ridgeFar = (x) => 15 + 11 * Math.sin(x * 0.017) + 6 * Math.sin(x * 0.043 + 1.7) + 3 * Math.sin(x * 0.089 + 4.2);
  const ridgeNear = (x) => 8 + 6 * Math.sin(x * 0.029 + 2.3) + 4 * Math.sin(x * 0.067 + 0.6);

  // —— 绘制 ——
  function drawWorld(api) {
    const th = THEMES[(stage - 1) % 3];
    api.cls(th.sky);
    if (th.night)                                          // 夜空星点
      for (let i = 0; i < 40; i++)
        api.px((i * 61 + 17) % W, (i * 37) % (HZN - 8), (i % 3) ? SLATE : LGRAY);
    const sunX = ((-bgX * 0.25 + 300) % (W + 80) + W + 80) % (W + 80) - 40;
    api.rect(sunX - 4, 22, 9, 9, th.sun);
    api.rect(sunX - 2, 20, 5, 13, th.sun);
    api.rect(sunX - 6, 24, 13, 5, th.sun);
    for (let x = 0; x < W; x++) {                          // 远山
      const h = Math.max(2, ridgeFar(x + bgX * 0.4) | 0);
      api.rect(x, HZN - h, 1, h, th.mtF);
    }
    for (let x = 0; x < W; x++) {                          // 近山
      const h = Math.max(1, ridgeNear(x + bgX) | 0);
      api.rect(x, HZN - h, 1, h, th.mtN);
    }

    // —— 路面:自下而上扫描,累计弯道偏移 ——
    let x = W / 2, dx = 0;
    for (let dy = DYMAX; dy >= 1; dy--) {
      const y = HZN + dy;
      cxAt[dy] = x;
      dx += curveS * 0.009;
      x += dx;
      const wz = camZ + CAMD / dy;
      const par = ((wz / 14) | 0) & 1;
      const hw = dy * 0.98;
      api.rect(0, y, W, 1, par ? th.gA : th.gB);           // 路肩草地
      const rw = Math.max(1, dy * 0.13);
      api.rect(x - hw, y, hw * 2, 1, par ? ROADA : ROADB); // 路面
      if (par) {                                           // 红白路缘
        api.rect(x - hw - rw, y, rw, 1, RED);
        api.rect(x + hw, y, rw, 1, RED);
      } else {
        api.rect(x - hw - rw, y, rw, 1, WHITE);
        api.rect(x + hw, y, rw, 1, WHITE);
      }
      if (par && dy > 7) {                                 // 车道虚线
        api.rect(x - hw / 3, y, 1, 1, LGRAY);
        api.rect(x + hw / 3, y, 1, 1, LGRAY);
      }
    }

    // —— 路灯柱(近 → 远绘制,远处先被近处覆盖)——
    const sprites = [];
    for (const p of pylons) {
      const zRel = p.z - camZ;
      if (zRel > 3 && zRel < 620) sprites.push({ z: zRel, kind: 'pylon', side: p.side });
    }
    for (const g of gates) {
      const zRel = g.z - camZ;
      if (zRel > 3 && zRel < 620) sprites.push({ z: zRel, kind: 'gate', t: g.t });
    }
    for (const c of cars) {
      const zRel = c.z - camZ;
      if (zRel > 2 && zRel < 620) sprites.push({ z: zRel, kind: 'car', lane: c.lane, ci: c.ci, blink: crashT > 0 && c.z < camZ + 40 });
    }
    sprites.sort((a, b) => b.z - a.z);
    for (const s of sprites) {
      const dy = clamp(CAMD / s.z, 1, DYMAX);
      const y = HZN + dy;
      const cx = cxAt[dy | 0];
      const hw = dy * 0.98;
      if (s.kind === 'pylon') {
        const h = Math.max(2, dy * 0.09 | 0), pw = dy > 40 ? 2 : 1;
        const px = cx + s.side * (hw + dy * 0.16);
        api.rect(px, y - h, pw, h, LGRAY);
        api.rect(px, y - h, pw, Math.max(1, h * 0.3) | 0, RED);
      } else if (s.kind === 'gate') {                      // 检查点拱门
        const ph = Math.max(8, dy * 0.5 | 0), pw = Math.max(1, dy * 0.05 | 0);
        const gx = cx, half = hw + 4;
        api.rect(gx - half, y - ph, pw, ph, WHITE);
        api.rect(gx + half, y - ph, pw, ph, WHITE);
        const bw = half * 2;
        api.rect(gx - half, y - ph, bw, Math.max(2, ph * 0.22) | 0, CYAN);
        if (dy > 26) {
          const t = 'CHECK';
          api.text(t, gx - api.textWidth(t) / 2, y - ph + 1, INK);
        }
      } else {
        drawTraffic(api, cx + s.lane * hw, y, dy / DYMAX, s.ci, s.blink);
      }
    }
  }

  function drawTraffic(api, x, y, s, ci, blink) {
    const w = Math.max(4, (18 * s) | 0), h = Math.max(3, (11 * s) | 0);
    x |= 0; y |= 0;
    if (blink && api.frame % 8 < 4) return;
    api.rect(x - w / 2 - 1, y - h * 0.3, 2, h * 0.35 | 0 || 1, INK);   // 轮
    api.rect(x + w / 2 - 1, y - h * 0.3, 2, h * 0.35 | 0 || 1, INK);
    api.rect(x - w / 2, y - h, w, h, ci);                              // 车身
    api.rect(x - w * 0.32, y - h, w * 0.64, h * 0.35 | 0 || 1, INK);   // 后窗
    api.rect(x - w / 2 + 1, y - 2, Math.max(1, w * 0.16) | 0, 1, RED); // 尾灯
    api.rect(x + w / 2 - 1 - Math.max(1, w * 0.16) | 0, y - 2, Math.max(1, w * 0.16) | 0, 1, RED);
  }

  function drawPlayer(api) {
    const x = 120, y = 150;
    const bounce = v > 5 ? ((api.frame % 6 < 3) ? 1 : 0) : 0;
    const lean = (steer * 2) | 0;
    const yy = y + bounce;
    if (crashT > 0 && api.frame % 8 < 4) return;            // 撞车闪烁
    api.rect(x - 13, yy + 8, 5, 7, INK);                    // 轮
    api.rect(x + 8, yy + 8, 5, 7, INK);
    api.rect(x - 12, yy + 5 - lean, 4, 4, INK);             // 前翼
    api.rect(x + 8, yy + 5 + lean, 4, 4, INK);
    api.rect(x - 11, yy - 6 + lean, 22, 14, RED);           // 车体
    api.rect(x - 11, yy - 6 + lean, 22, 2, ORANGE);
    api.rect(x - 7, yy - 4 + lean, 14, 4, INK);             // 后窗
    api.rect(x - 15, yy - 8 + lean, 6, 3, RED);             // 尾翼
    api.rect(x + 9, yy - 8 + lean, 6, 3, RED);
    api.rect(x - 10, yy + 3, 3, 2, YELLOW);                 // 尾灯
    api.rect(x + 7, yy + 3, 3, 2, YELLOW);
    if (v > 4 && api.frame % 4 < 2) api.rect(x - 2, yy + 9, 4, 2, ORANGE);  // 排气火
  }

  function drawFx(api) {
    for (const p of parts) {
      if (p.life < p.max * 0.3 && api.frame % 2) continue;
      api.px(p.x, p.y, p.ci);
    }
    for (const p of pops) {
      if (p.life < 12 && api.frame % 4 >= 2) continue;
      api.text(p.t, p.x | 0, p.y | 0, INK);
      api.text(p.t, (p.x - 1) | 0, (p.y - 1) | 0, p.ci);
    }
    if (v > 6.4) {                                          // 高速流光
      for (let i = 0; i < 5; i++) {
        const lx = irnd(0, 3) ? irnd(0, 50) : irnd(190, 239);
        api.rect(lx, irnd(20, HZN + 40), 1, irnd(6, 14), LGRAY);
      }
    }
    if (nearT > 0 && api.frame % 6 < 4) api.text('NICE!', 108, 108, ICE);
    if (flashT > 0) api.rect(0, 0, W, H, flashCi);
  }

  function drawHud(api) {
    const tSec = Math.ceil(time);
    const tCol = tSec <= 10 ? (api.frame % 20 < 10 ? RED : YELLOW) : WHITE;
    const tTxt = 'TIME ' + String(tSec).padStart(2, '0');
    api.text(tTxt, (W - api.textWidth(tTxt, 2)) / 2, 3, tCol, 2);
    api.text(String(score).padStart(6, '0'), 3, 3, GOLD);
    api.text('HI ' + String(Math.max(best, score)).padStart(6, '0'), 3, 11, SLATE);
    const stTxt = 'STAGE ' + stage;
    api.text(stTxt, 3, 19, CYAN);
    const kmh = (v * 36) | 0;
    const sTxt = String(kmh).padStart(3, ' ') + ' KMH';
    api.text(sTxt, W - 3 - api.textWidth(sTxt), 3, v > 7 ? RED : LGRAY);
    api.rect(W - 58, 11, 55, 4, INK);                       // 速度表
    const vmax = Math.min(8.2, 6.5 + stage * 0.16);
    api.rect(W - 57, 12, Math.round(53 * v / vmax), 2,
             v > vmax * 0.9 ? RED : v > vmax * 0.6 ? YELLOW : GREEN);
    // 到检查点距离
    const cp = Math.max(0, CP_DIST - (camZ - (cpNext - CP_DIST)));
    api.rect(3, 26, 53, 3, INK);
    api.rect(4, 27, Math.round(51 * (1 - cp / CP_DIST)), 1, CYAN);
    api.text('CP', 60, 24, SLATE);
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
    api.cls(INK);
    for (let i = 0; i < 40; i++) {
      const x = (i * 53 + api.frame * ((i % 3) + 1) * 0.3) % W;
      api.px(x, (i * 97) % H, i % 4 ? SLATE : LGRAY);
    }
    // 装饰:直线跑道
    cxAt[117] = W / 2;
    curveS = 0;
    for (let dy = DYMAX; dy >= 1; dy--) {
      const y = HZN + dy, hw = dy * 0.7;
      const par = (((api.frame * 4 + dy * 3) / 14) | 0) & 1;
      api.rect(0, y, W, 1, par ? GAD : GBD);
      api.rect(W / 2 - hw, y, hw * 2, 1, par ? ROADA : ROADB);
      if (par && dy > 8) api.rect(W / 2, y, 1, 1, LGRAY);
    }
    api.rect(W / 2 - 14, 138, 28, 16, RED);                 // 标题车
    api.rect(W / 2 - 9, 141, 18, 5, INK);
    api.rect(W / 2 - 12, 154, 6, 4, INK);
    api.rect(W / 2 + 6, 154, 6, 4, INK);
    centerShadow(api, 'AETHER GP', 14, GOLD, 3);
    centerText(api, 'FC ROAD RACER', 36, CYAN);
    if (best > 0) centerText(api, 'BEST ' + best, 48, YELLOW);
    if (api.frame % 60 < 38) centerShadow(api, 'PRESS START', 100, WHITE);
    centerText(api, 'UP - THROTTLE  DOWN - BRAKE', 118, LGRAY);
    centerText(api, 'LEFT RIGHT - STEER', 128, LGRAY);
    centerText(api, 'REACH CHECKPOINTS FOR TIME', 138, SLATE);
    centerText(api, 'AVOID TRAFFIC - SKIM FOR BONUS', 148, SLATE);
  }

  return {
    name: 'AETHER GP',
    version: '1.0',
    filter: 'none',

    /* RGB565(30 色):0黑 1深蓝 2天(昼) 3天(暮) 4天(夜) 5-10 草地三主题
       11/12 路面双色 13红 14白 15浅灰 16岩灰 17金 18黄 19橙 20绿 21冰
       22青 23紫 24-29 山体三主题(远/近×昼/暮/夜) */
    palette: [
      0x0000, 0x1082, 0x7DFF, 0xFC6B, 0x18E7,
      0x2D0A, 0x23E8, 0x62C6, 0x4A25, 0x1965, 0x1104,
      0x4A4A, 0x39E9, 0xF800, 0xFFFF, 0xADB8,
      0x5B30, 0xFE40, 0xFE87, 0xFC86, 0x2EED,
      0xAF7F, 0x07FF, 0x8ADE,
      0x84EB, 0x53B2, 0x7A9D, 0x51BA, 0x296A, 0x1907,
    ],

    init() {
      scene = 'title'; paused = false;
      frame = 0; freeze = 0; flashT = 0; flashCi = WHITE;
      camZ = 0; v = 0; playerX = 0; steer = 0; curveS = 0;
      sections = [{ curve: 0, len: 400, start: 0 }]; secIdx = 0;
      pylons = []; cars = []; gates = []; parts = []; pops = [];
      time = 50; score = 0; cpNext = CP_DIST; cpDone = 0; stage = 1;
      crashT = 0; nearT = 0; startT = 0; overT = 0; bgX = 0;
      best = loadBest();
      cxAt = new Float32Array(DYMAX + 1);
      starField = null;
    },

    update(api) {
      frame++;
      const jp = api.justPressed;
      if (scene === 'title') {
        if (jp('start') || jp('a')) resetRun();
        return;
      }
      if (scene === 'over') {
        overT++;
        for (let i = parts.length - 1; i >= 0; i--) if (--parts[i].life <= 0) parts.splice(i, 1);
        if (overT > 50 && (jp('start') || jp('a'))) scene = 'title';
        return;
      }
      if (jp('start')) paused = !paused;
      if (paused) return;
      updatePlay(api);
    },

    draw(api) {
      if (scene === 'title') { drawTitle(api); return; }
      drawWorld(api);
      drawPlayer(api);
      drawFx(api);
      drawHud(api);

      if (startT > 0) {                                      // 倒计时
        const n = Math.ceil(startT / 50);
        const label = n > 3 ? 'READY' : String(Math.min(3, n));
        centerShadow(api, label, 66, n > 3 ? WHITE : YELLOW, 3);
        if (startT % 50 < 8 && n <= 3) api.shake(1.2);
      }
      if (bannerT > 0 && (bannerT > 16 || api.frame % 4 < 2)) {
        centerShadow(api, bannerA, 60, bannerCi, 2);
        if (bannerB) centerText(api, bannerB, 78, bannerCi === CYAN ? WHITE : LGRAY);
      }
      if (scene === 'over') {
        api.rect(36, 50, 168, 80, INK);
        api.rect(36, 50, 168, 1, RED); api.rect(36, 129, 168, 1, RED);
        api.rect(36, 50, 1, 80, RED); api.rect(203, 50, 1, 80, RED);
        centerShadow(api, 'TIME UP', 58, RED, 2);
        centerText(api, 'SCORE ' + score, 82, WHITE);
        centerText(api, 'STAGE ' + stage + '  CP ' + cpDone, 94, LGRAY);
        centerText(api, 'BEST ' + best, 106, YELLOW);
        if (overT > 50 && api.frame % 60 < 38) centerShadow(api, 'PRESS START', 116, WHITE);
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
