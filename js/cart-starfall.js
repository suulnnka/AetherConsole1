/*
 * 卡带:STARFALL · 竖版弹幕射击(v1.0)
 * 颜色模式 A:16 色调色板;240×180 索引帧缓冲
 * 输入:←→↑↓ / WASD 移动 · Z / J 开火(按住)· X / K 符卡炸弹 · Enter 开始/暂停
 * 玩法:东方风竖版弹幕——敌波推进,每 4 波出 Boss(三阶段弹幕);
 *   贴弹"擦弹"(GRAZE)加分;阵亡掉 1 级火力;3 命 2 炸弹;
 *   击杀连击(CHAIN)提高倍率;最佳成绩记入 localStorage
 * 打击感:命中停顿 / 受击闪白 / 爆炸粒子 + 冲击波环 / 弹幕生成缩放 /
 *   玩家死亡清屏白闪 / Boss 入场 WARNING 抖屏 / 连击弹字
 */
const StarfallCart = (function () {
  'use strict';

  const W = 240, H = 180;
  const TAU = Math.PI * 2;

  // —— 调色板索引 ——
  const BG = 0, INK = 1, DNEB = 2, SLATE = 3, CYAN = 4, WHITE = 5, GOLD = 6,
        YELLOW = 7, RED = 8, ORANGE = 9, VIOLET = 10, PINK = 11, LGRAY = 12,
        ROCK = 13, GREEN = 14, ICE = 15;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const irnd = (a, b) => (a + Math.random() * (b - a)) | 0;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const d2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const aimAt = (x, y, spd) => {
    const a = Math.atan2(py - y, px - x);
    return [Math.cos(a) * spd, Math.sin(a) * spd];
  };

  // —— 状态 ——
  let scene, paused, frame, freeze, flashT;
  let px, py, inv, dead, respawnT, fireCd, bombT, bombs, lives, power, score, graze;
  let chain, chainT, enemies, ebul, pbul, parts, rings, pops, drops;
  let stars, wave, waveT, script, groupIdx, bossWait, boss, bossSeq, bossExpT;
  let bannerT, bannerA, bannerB, overT, best;

  function loadBest() {
    try { const s = localStorage.getItem('ac_sf_best'); if (s) return +s || 0; } catch (e) {}
    return 0;
  }
  function saveBest() {
    if (score > best) { best = score; try { localStorage.setItem('ac_sf_best', String(score)); } catch (e) {} }
  }

  // —— 打击感原语 ——
  function burst(x, y, n, ci, sp, life) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), v = rnd(sp * 0.25, sp);
      const m = irnd(life * 0.55, life);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                   ci, life: m, max: m });
    }
  }
  function ring(x, y, r, ci, spd) { rings.push({ x, y, r, ci, spd }); }
  function pop(t, x, y, ci) { pops.push({ t, x, y, ci, life: 40 }); }
  function killFx(api, x, y, big) {
    burst(x, y, big ? 34 : 12, WHITE, big ? 3.4 : 2.2, big ? 42 : 26);
    burst(x, y, big ? 18 : 8, big ? ORANGE : YELLOW, big ? 2.6 : 1.7, big ? 34 : 20);
    ring(x, y, big ? 4 : 2, WHITE, big ? 1.7 : 1.1);
    api.shake(big ? 4.5 : 1.4);
    freeze = Math.max(freeze, big ? 6 : 2);
  }

  // —— 敌波脚本 ——
  function buildWave(n) {
    const ev = [];
    let t = 46;
    const groups = 4 + Math.min(4, n);
    for (let g = 0; g < groups; g++) {
      const kind = irnd(0, n >= 2 ? 5 : 3);
      ev.push({ t, kind });
      t += irnd(78, 128) - Math.min(28, n * 3);
    }
    ev.total = t + 150;
    return ev;
  }

  function spawnGroup(kind) {
    const hpUp = 1 + wave * 0.12;
    if (kind === 0 || kind === 1) {            // 妖精纵队(左/右)
      const side = kind === 0 ? -1 : 1;
      for (let i = 0; i < 5; i++)
        enemies.push({ type: 'fairy', bx: side < 0 ? 34 : W - 34, x: side < 0 ? 26 : W + 26,
                       y: 20 + i * 9, hp: Math.ceil(2 * hpUp), r: 4, t: -i * 9,
                       fcd: irnd(50, 150), score: 60, side });
    } else if (kind === 2) {                   // 玉灵:悬停放环
      const n = wave > 3 ? 2 : 1;
      for (let i = 0; i < n; i++)
        enemies.push({ type: 'orb', x: 50 + i * (W - 100), y: -14 - i * 26,
                       ty: irnd(34, 62), hp: Math.ceil(9 * hpUp), r: 5, t: 0,
                       fcd: 70, rings: 0, score: 220 });
    } else if (kind === 3) {                   // 飞镖:对玩家俯冲
      const n = irnd(3, 6);
      for (let i = 0; i < n; i++) {
        enemies.push({ type: 'dart', x: rnd(20, W - 20), y: -12 - i * 16,
                       hp: Math.ceil(2 * hpUp), r: 4, t: 0, vx: 0, vy: 0,
                       aimed: false, score: 90 });
      }
    } else if (kind === 4) {                   // 炮车:三向散射
      const n = wave > 4 ? 2 : 1;
      for (let i = 0; i < n; i++)
        enemies.push({ type: 'tank', x: 60 + i * (W - 120) + rnd(-14, 14), y: -16,
                       hp: Math.ceil(14 * hpUp), r: 6, t: 0, fcd: 64,
                       score: 300 });
    } else {                                   // 混编:妖精 + 飞镖
      for (let i = 0; i < 3; i++)
        enemies.push({ type: 'fairy', bx: rnd(40, W - 40), x: rnd(0, W), y: -10 - i * 14,
                       hp: Math.ceil(2 * hpUp), r: 4, t: 0, fcd: irnd(60, 160),
                       score: 60, side: 0 });
      for (let i = 0; i < 3; i++)
        enemies.push({ type: 'dart', x: rnd(20, W - 20), y: -70 - i * 16,
                       hp: Math.ceil(2 * hpUp), r: 4, t: 0, vx: 0, vy: 0,
                       aimed: false, score: 90 });
    }
  }

  function spawnBoss() {
    boss = { type: 'boss', x: W / 2, y: -34, hp: 320 + wave * 95,
             maxHp: 320 + wave * 95, r: 13, t: 0, fcd: 14, fcd2: 60,
             phase: 0, score: 4000 + wave * 300 };
    enemies.push(boss);
  }

  // —— 弹幕发射 ——
  function eShot(x, y, vx, vy, ci, big) {
    if (ebul.length >= 250) return;
    ebul.push({ x, y, vx, vy, ci: ci || PINK, big: !!big, age: 0, gz: false });
  }
  function ringShot(x, y, n, spd, off, ci) {
    for (let i = 0; i < n; i++) {
      const a = off + i * TAU / n;
      eShot(x, y, Math.cos(a) * spd, Math.sin(a) * spd, ci, spd > 1.15);
    }
  }

  // —— 玩家 ——
  function firePlayer() {
    const cd = power >= 4 ? 5 : 7;
    if (fireCd > 0) return;
    fireCd = cd;
    const y = py - 8;
    pbul.push({ x: px, y, vx: 0, vy: -7.2, ci: CYAN });
    if (power >= 2) {
      pbul.push({ x: px - 4, y, vx: 0, vy: -7.2, ci: CYAN });
      pbul.push({ x: px + 4, y, vx: 0, vy: -7.2, ci: CYAN });
    }
    if (power >= 3) {
      pbul.push({ x: px - 7, y: y + 3, vx: -1.15, vy: -6.4, ci: ICE });
      pbul.push({ x: px + 7, y: y + 3, vx: 1.15, vy: -6.4, ci: ICE });
    }
    if (power >= 4) {
      pbul.push({ x: px - 2, y, vx: 0, vy: -7.6, ci: WHITE });
      pbul.push({ x: px + 2, y, vx: 0, vy: -7.6, ci: WHITE });
    }
    parts.push({ x: px, y: y - 2, vx: 0, vy: -1.4, ci: WHITE, life: 3, max: 3 });  // 枪口焰
  }

  function playerDie(api) {
    dead = true;
    freeze = 10;
    flashT = 8;
    api.shake(6);
    killFx(api, px, py, true);
    for (const b of ebul) {                       // 弹幕全部化为火花 +5
      parts.push({ x: b.x, y: b.y, vx: rnd(-0.8, 0.8), vy: rnd(-0.8, 0.8),
                   ci: b.ci, life: 16, max: 16 });
      score += 5;
    }
    ebul.length = 0;
    power = Math.max(0, power - 1);
    lives--;
    if (lives < 0) { saveBest(); scene = 'over'; overT = 0; }
    else { inv = 0; respawnT = 66; }
  }

  // —— 敌人受击/死亡 ——
  function hurtEnemy(api, e, dmg, hx, hy) {
    e.hp -= dmg;
    e.flash = 3;
    parts.push({ x: hx, y: hy, vx: rnd(-1, 1), vy: rnd(-1.6, -0.4),
                 ci: WHITE, life: 6, max: 6 });
    if (e.hp <= 0) {
      e.dead = true;
      chain++; chainT = 90;
      const mult = 1 + Math.min(2, (chain - 1) * 0.08);
      const pts = Math.round(e.score * mult);
      score += pts;
      const big = e.type === 'tank' || e.type === 'boss';
      killFx(api, e.x, e.y, big);
      if (chain >= 3 && chain % 5 === 0)
        pop('CHAIN X' + chain + '! ' + pts, e.x, clamp(e.y, 16, H - 30), GOLD);
      if (e.type === 'boss') return;              // Boss 走演出
      if (Math.random() < (big ? 0.5 : 0.14))
        drops.push({ x: e.x, y: e.y, kind: Math.random() < 0.6 ? 'P' : 'G', t: 0 });
    }
  }

  // —— Boss 死亡演出 ——
  function startBossSeq(api) {
    bossSeq = true;
    bossExpT = 0;
    freeze = 12;
    api.shake(6);
    ebul.length = 0;
  }
  function updateBossSeq(api) {
    bossExpT++;
    if (bossExpT % 6 === 0 && boss) {
      burst(boss.x + rnd(-22, 22), boss.y + rnd(-16, 16), 14, [WHITE, ORANGE, YELLOW][irnd(0, 3)], 2.8, 34);
      api.shake(4);
    }
    if (bossExpT === 70) {
      flashT = 10;
      api.shake(6);
      ring(boss.x, boss.y, 6, WHITE, 3);
      burst(boss.x, boss.y, 60, WHITE, 4.2, 50);
      score += boss.score;
      pop('+' + boss.score, W / 2 - 20, boss.y, GOLD);
      for (let i = 0; i < 3; i++)
        drops.push({ x: boss.x - 20 + i * 20, y: boss.y, kind: i === 0 ? 'P' : 'G', t: 0 });
      enemies.length = 0;                          // Boss 阵亡清杂兵
      boss = null;
    }
    if (bossExpT > 110) {
      bossSeq = false;
      wave++;
      script = buildWave(wave);
      waveT = 0; groupIdx = 0; bossWait = 0;
      bannerT = 90; bannerA = 'WAVE ' + wave; bannerB = wave % 4 === 0 ? 'BOSS APPROACHING' : '';
    }
  }

  function resetRun() {
    scene = 'play'; paused = false;
    px = W / 2; py = H - 26; inv = 60; dead = false;
    fireCd = 0; bombT = 0; bombs = 2; lives = 3; power = 1;
    score = 0; graze = 0; chain = 0; chainT = 0;
    enemies = []; ebul = []; pbul = []; parts = []; rings = []; pops = []; drops = [];
    boss = null; bossSeq = false; bossWait = 0;
    wave = 1; script = buildWave(1); waveT = 0; groupIdx = 0;
    bannerT = 100; bannerA = 'WAVE 1'; bannerB = '';
    freeze = 0; flashT = 0; overT = 0;
  }

  function initStars() {
    stars = [];
    for (let i = 0; i < 70; i++)
      stars.push({ x: rnd(0, W), y: rnd(0, H), v: 0.2 + (i % 3) * 0.35, ci: [INK, SLATE, LGRAY][i % 3] });
  }

  // —— 更新 ——
  function updatePlay(api) {
    const jp = api.justPressed;

    if (bannerT > 0) bannerT--;
    if (chainT > 0) { if (--chainT <= 0) chain = 0; }
    if (flashT > 0) flashT--;
    if (freeze > 0) { freeze--; updateParts(); return; }   // 命中停顿:世界暂停

    // —— 玩家 ——
    if (!dead) {
      const sp = 1.9;
      let mx = 0, my = 0;
      if (api.pressed('left')) mx -= 1;
      if (api.pressed('right')) mx += 1;
      if (api.pressed('up')) my -= 1;
      if (api.pressed('down')) my += 1;
      if (mx && my) { mx *= 0.707; my *= 0.707; }
      px = clamp(px + mx * sp, 6, W - 6);
      py = clamp(py + my * sp, 10, H - 8);
      if (inv > 0) inv--;
      if (api.pressed('a')) firePlayer();
      if (fireCd > 0) fireCd--;
      if (jp('b') && bombs > 0 && bombT <= 0) {         // 符卡
        bombs--; bombT = 46; inv = Math.max(inv, 80);
        freeze = 3; api.shake(4);
        flashT = 3; ring(px, py, 4, WHITE, 3.2);
        score += 30;
      }
      // 引擎尾焰
      if (api.frame % 3 === 0)
        parts.push({ x: px + rnd(-1, 1), y: py + 7, vx: 0, vy: 1.6,
                     ci: api.frame % 6 ? ORANGE : YELLOW, life: 5, max: 5 });
    } else {
      if (--respawnT <= 0) {                                // 重生
        dead = false; px = W / 2; py = H - 26; inv = 150; bombT = 0;
      }
    }

    // —— 炸弹推进 ——
    if (bombT > 0) {
      bombT--;
      const r = (46 - bombT) * 5.6;
      if (bombT % 5 === 0) ring(px, py, Math.min(r - 4, 70), bombT % 10 < 5 ? WHITE : CYAN, 1.4);
      for (let i = ebul.length - 1; i >= 0; i--) {
        const b = ebul[i];
        if (d2(b.x, b.y, px, py) < r * r) {
          burst(b.x, b.y, 2, b.ci, 1.2, 10);
          score += 10;
          ebul.splice(i, 1);
        }
      }
      for (const e of enemies) {
        if (!e.dead && d2(e.x, e.y, px, py) < r * r)
          hurtEnemy(api, e, e.type === 'boss' ? 1.6 : 3, e.x, e.y);
      }
      enemies = enemies.filter(e => !e.dead);
    }

    // —— 波次推进:到点即推进(残敌化火花清场,不卡流程)——
    waveT++;
    if (!boss && !bossSeq) {
      while (groupIdx < script.length && script[groupIdx].t <= waveT) {
        spawnGroup(script[groupIdx].kind);
        groupIdx++;
      }
      if (groupIdx >= script.length && waveT > script.total) {
        for (const e of enemies) {                         // 残敌退场
          burst(e.x, e.y, 6, WHITE, 1.8, 16);
          score += 20;
        }
        enemies.length = 0;
        if (wave % 4 === 0) {
          if (bossWait < 60) {                             // WARNING 演出
            bossWait++;
            if (bossWait === 1) { api.shake(2.5); bannerT = 90; bannerA = 'WARNING'; bannerB = 'LARGE ENEMY'; }
          } else {
            spawnBoss();
            waveT = 0;
          }
        } else {
          wave++;
          script = buildWave(wave);
          waveT = 0; groupIdx = 0;
          bannerT = 80; bannerA = 'WAVE ' + wave; bannerB = '';
        }
      }
    }
    if (bossSeq) updateBossSeq(api);

    // —— 玩家子弹 ——
    for (let i = pbul.length - 1; i >= 0; i--) {
      const b = pbul[i];
      b.x += b.vx; b.y += b.vy;
      if (b.y < -6 || b.x < -6 || b.x > W + 6) { pbul.splice(i, 1); continue; }
      let hit = false;
      for (const e of enemies) {
        if (e.dead || e.y < -20) continue;
        const rr = e.r + 2;
        if (d2(b.x, b.y, e.x, e.y) < rr * rr) {
          hurtEnemy(api, e, 1, b.x, b.y);
          hit = true;
          break;
        }
      }
      if (hit) pbul.splice(i, 1);
    }
    enemies = enemies.filter(e => !e.dead);

    // —— 敌人 ——
    for (const e of enemies) {
      e.t++;
      if (e.flash > 0) e.flash--;
      if (e.type === 'fairy') {
        e.y += 0.55;
        if (e.side) {                                     // 纵队:侧翼切入
          const tx = e.bx - e.side * 10;
          e.x += (tx - e.x) * 0.04 + Math.sin(e.t * 0.06 + e.bx) * 0.55;
        }
        if (e.y > 24 && e.y < 120 && --e.fcd <= 0) {
          e.fcd = irnd(110, 190);
          const v = aimAt(e.x, e.y, 1.25);
          eShot(e.x, e.y + 4, v[0], v[1], PINK);
        }
      } else if (e.type === 'orb') {
        if (e.y < e.ty) e.y += 0.7;
        e.x += Math.sin(e.t * 0.02 + e.ty) * 0.3;
        if (e.y >= e.ty - 2 && --e.fcd <= 0) {
          e.fcd = 86;
          e.rings++;
          ringShot(e.x, e.y, 12 + (e.rings % 3 === 0 ? 4 : 0), 0.58,
                   e.rings * 0.24, e.rings % 2 ? VIOLET : PINK);
          if (e.rings % 3 === 0) {
            const v = aimAt(e.x, e.y, 1.5);
            eShot(e.x, e.y, v[0], v[1], CYAN, true);
          }
        }
      } else if (e.type === 'dart') {
        if (!e.aimed && e.y > 8) {
          e.aimed = true;
          const v = aimAt(e.x, e.y, 2.7);
          e.vx = v[0]; e.vy = v[1];
          burst(e.x, e.y, 3, ICE, 0.8, 8);
        }
        e.x += e.vx; e.y += e.aimed ? e.vy : 1.1;
      } else if (e.type === 'tank') {
        e.y += 0.28;
        if (e.y > 20 && --e.fcd <= 0) {
          e.fcd = 104;
          const base = Math.atan2(py - e.y, px - e.x);
          for (let k = -1; k <= 1; k++)
            eShot(e.x, e.y + 5, Math.cos(base + k * 0.3) * 1.5,
                  Math.sin(base + k * 0.3) * 1.5, ORANGE, true);
        }
      } else if (e.type === 'boss') {
        updateBoss(api, e);
      }
    }
    // 出屏回收
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.type !== 'boss' && (e.y > H + 20 || e.x < -30 || e.x > W + 30))
        enemies.splice(i, 1);
    }

    // —— 敌弹 ——
    for (let i = ebul.length - 1; i >= 0; i--) {
      const b = ebul[i];
      b.x += b.vx; b.y += b.vy;
      b.age++;
      if (b.x < -8 || b.x > W + 8 || b.y < -10 || b.y > H + 10) { ebul.splice(i, 1); continue; }
      if (dead) continue;
      const dd = d2(b.x, b.y, px, py);
      const hitR = b.big ? 3.4 : 2.6;                      // 判定小(东方风)
      if (dd < hitR * hitR) {
        if (inv <= 0) { ebul.splice(i, 1); playerDie(api); break; }
      } else if (!b.gz && dd < 121 && inv <= 0) {          // 擦弹
        b.gz = true; graze++; score += 2;
        parts.push({ x: b.x, y: b.y, vx: rnd(-1, 1), vy: rnd(-1, 1),
                     ci: ICE, life: 5, max: 5 });
      }
    }

    // —— 掉落物 ——
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t++;
      d.y += 0.7;
      if (d2(d.x, d.y, px, py) < 26 * 26) {                // 轻磁吸
        d.x += (px - d.x) * 0.12; d.y += (py - d.y) * 0.12;
      }
      if (d2(d.x, d.y, px, py) < 30 && !dead) {
        if (d.kind === 'P') {
          if (power < 4) { power++; pop('POWER UP!', d.x - 16, d.y - 6, CYAN); }
          else { score += 500; pop('+500', d.x - 8, d.y - 6, GOLD); }
          flashT = 1;
        } else { score += 500; pop('+500', d.x - 8, d.y - 6, GOLD); }
        burst(d.x, d.y, 8, GOLD, 1.6, 14);
        drops.splice(i, 1);
      } else if (d.y > H + 10) drops.splice(i, 1);
    }

    // 玩家与敌机相撞
    if (!dead && inv <= 0) {
      for (const e of enemies) {
        if (e.dead || e.y < -10) continue;
        const rr = e.r + 2.5;
        if (d2(e.x, e.y, px, py) < rr * rr) { playerDie(api); break; }
      }
    }

    updateParts();
  }

  function updateBoss(api, e) {
    e.phase = e.hp > e.maxHp * 0.66 ? 0 : e.hp > e.maxHp * 0.33 ? 1 : 2;
    const amp = [26, 36, 46][e.phase];
    if (e.t < 80) { e.y += (44 - e.y) * 0.06; return; }    // 入场
    e.x = W / 2 + Math.sin(e.t * 0.017) * amp;
    e.y = 44 + Math.sin(e.t * 0.011) * 7;
    if (--e.fcd <= 0) {
      if (e.phase === 0) {
        e.fcd = 46;
        ringShot(e.x, e.y, 22, 0.62, e.t * 0.29, PINK);
      } else if (e.phase === 1) {
        e.fcd = 7;
        const a = e.t * 0.13;
        eShot(e.x, e.y, Math.cos(a) * 0.9, Math.sin(a) * 0.9, VIOLET);
        eShot(e.x, e.y, Math.cos(a + Math.PI) * 0.9, Math.sin(a + Math.PI) * 0.9, VIOLET);
      } else {
        e.fcd = 36;
        ringShot(e.x, e.y, 26, 0.78, e.t * 0.41, RED);
      }
    }
    if (--e.fcd2 <= 0) {                                    // 各阶段补充对准弹
      e.fcd2 = e.phase === 2 ? 44 : 120;
      const n = e.phase === 2 ? 3 : 5;
      const base = Math.atan2(py - e.y, px - e.x);
      const spread = e.phase === 2 ? 0.16 : 0.42;
      for (let k = 0; k < n; k++) {
        const a = base + (k - (n - 1) / 2) * spread;
        const spd = e.phase === 2 ? 2.0 : 1.4;
        eShot(e.x, e.y, Math.cos(a) * spd, Math.sin(a) * spd, CYAN, true);
      }
    }
  }

  function updateParts() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.93; p.vy *= 0.93;
      if (--p.life <= 0) parts.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += r.spd || 1.2;
      if (r.r > 90) rings.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      p.y -= 0.45;
      if (--p.life <= 0) pops.splice(i, 1);
    }
  }

  // —— 绘制 ——
  function drawShip(api, x, y, blink) {
    if (blink && api.frame % 6 < 3) return;
    x |= 0; y |= 0;
    api.rect(x - 6, y + 1, 4, 3, ICE);                     // 翼
    api.rect(x + 2, y + 1, 4, 3, ICE);
    api.rect(x - 5, y + 4, 2, 2, CYAN);
    api.rect(x + 3, y + 4, 2, 2, CYAN);
    api.rect(x - 1, y - 5, 3, 9, WHITE);                   // 机身
    api.rect(x - 2, y - 2, 5, 4, WHITE);
    api.rect(x, y - 3, 1, 3, CYAN);                        // 座舱
    api.px(x, y, WHITE);                                   // 判定点
  }

  function drawEnemy(api, e) {
    const x = e.x | 0, y = e.y | 0;
    const fl = e.flash > 0;
    if (e.type === 'fairy') {
      const flap = (api.frame >> 2) & 1;
      api.rect(x - 7, y - 3 - flap, 3, 5, fl ? WHITE : LGRAY);
      api.rect(x + 4, y - 3 - flap, 3, 5, fl ? WHITE : LGRAY);
      api.rect(x - 2, y - 3, 4, 6, fl ? WHITE : PINK);
      api.rect(x - 1, y - 1, 2, 3, WHITE);
      api.px(x, y - 4, fl ? WHITE : VIOLET);
    } else if (e.type === 'orb') {
      const pul = api.frame % 24 < 12;
      api.rect(x - 5, y - 5, 10, 10, fl ? WHITE : VIOLET);
      api.rect(x - 6, y - 2, 1, 5, VIOLET); api.rect(x + 5, y - 2, 1, 5, VIOLET);
      api.rect(x - 2, y - 2, 4, 4, fl ? WHITE : (pul ? PINK : WHITE));
    } else if (e.type === 'dart') {
      const ci = fl ? WHITE : ICE;
      api.rect(x - 1, y - 4, 2, 8, ci);
      api.rect(x - 3, y, 2, 4, ci);
      api.rect(x + 1, y, 2, 4, ci);
      api.px(x, y - 5, fl ? WHITE : CYAN);
    } else if (e.type === 'tank') {
      api.rect(x - 7, y - 6, 14, 11, fl ? WHITE : ROCK);
      api.rect(x - 5, y - 4, 10, 5, fl ? WHITE : SLATE);
      api.rect(x - 1, y + 5, 3, 3, fl ? WHITE : SLATE);    // 炮口
      api.px(x - 3, y - 2, fl ? WHITE : ORANGE);
      api.px(x + 3, y - 2, fl ? WHITE : ORANGE);
    } else if (e.type === 'boss') {
      const ci = fl ? WHITE : VIOLET, sh = fl ? WHITE : ROCK;
      api.rect(x - 18, y - 13, 36, 26, ci);
      api.rect(x - 22, y - 8, 4, 14, sh);                  // 侧舱
      api.rect(x + 18, y - 8, 4, 14, sh);
      api.rect(x - 15, y - 10, 30, 3, sh);
      api.rect(x - 15, y + 7, 30, 3, sh);
      const pul = api.frame % 16 < 8;
      api.rect(x - 5, y - 5, 10, 10, fl ? WHITE : (pul ? PINK : VIOLET));
      api.rect(x - 2, y - 2, 4, 4, fl ? WHITE : WHITE);
      if (e.phase === 2 && api.frame % 8 < 4) api.rect(x - 15, y - 10, 30, 3, RED);
    }
  }

  function drawBullet(api, b) {
    const x = b.x | 0, y = b.y | 0;
    if (b.age < 3) { api.px(x, y, WHITE); return; }        // 生成缩放
    if (b.big) {
      api.px(x - 1, y - 2, b.ci); api.px(x + 1, y - 2, b.ci);
      api.px(x - 2, y - 1, b.ci); api.px(x + 2, y - 1, b.ci);
      api.px(x - 2, y + 1, b.ci); api.px(x + 2, y + 1, b.ci);
      api.px(x - 1, y + 2, b.ci); api.px(x + 1, y + 2, b.ci);
      api.rect(x - 1, y - 1, 3, 3, b.ci);
      api.px(x, y, WHITE);
    } else {
      api.px(x, y - 1, b.ci); api.px(x, y + 1, b.ci);
      api.px(x - 1, y, b.ci); api.px(x + 1, y, b.ci);
      api.px(x, y, WHITE);
    }
  }

  function drawHud(api) {
    api.text(String(score).padStart(7, '0'), 3, 3, GOLD);
    api.text('HI ' + String(Math.max(best, score)).padStart(7, '0'), 3, 10, SLATE);
    const wTxt = 'WAVE ' + wave;
    api.text(wTxt, W - 3 - api.textWidth(wTxt), 3, boss ? RED : LGRAY);
    for (let i = 0; i < Math.max(0, lives); i++) drawShip(api, 10 + i * 13, 24, false);
    for (let i = 0; i < bombs; i++) {
      const x = 6 + i * 8;
      api.rect(x, 31, 4, 4, api.frame % 20 < 10 ? CYAN : ICE);
      api.px(x + 1, 32, WHITE);
    }
    // 火力条
    api.rect(4, 40, 4 * 8 + 1, 5, INK);
    for (let i = 0; i < 4; i++)
      api.rect(5 + i * 8, 41, 7, 3, i < power ? CYAN : SLATE);
    const gTxt = 'GRAZE ' + graze;
    api.text(gTxt, W - 3 - api.textWidth(gTxt), H - 8, ICE);
    if (chain >= 3) {
      const cTxt = 'CHAIN X' + chain;
      api.text(cTxt, W - 3 - api.textWidth(cTxt), 10, chainT > 20 ? YELLOW : SLATE);
    }
    if (boss && !bossSeq) {                                 // Boss 血条
      api.rect(9, 16, 222, 3, INK);
      api.rect(10, 17, Math.round(220 * Math.max(0, boss.hp) / boss.maxHp), 1,
               boss.phase === 2 ? RED : VIOLET);
    }
  }

  function drawPlay(api) {
    api.cls(BG);
    for (const s of stars) {                                // 星野向下滚动
      s.y += s.v;
      if (s.y > H) { s.y = -1; s.x = rnd(0, W); }
      api.px(s.x, s.y, s.ci);
    }
    for (let y = 0; y < H; y += 46) {                       // 星云带
      const off = (api.frame * 0.08 + y * 1.7) % (H + 90) - 45;
      for (let x = 0; x < W; x += 3)
        if (((x * 7 + y * 13 + (api.frame >> 3)) % 11) < 3) api.px(x, off + (x % 5), DNEB);
    }
    for (const d of drops) {                                // 掉落物
      const x = d.x | 0, y = d.y | 0;
      const pul = api.frame % 14 < 7;
      if (d.kind === 'P') {
        api.rect(x - 3, y - 3, 7, 7, pul ? CYAN : ICE);
        api.rect(x - 2, y - 1, 1, 3, WHITE); api.rect(x - 1, y - 2, 3, 1, WHITE);
        api.rect(x, y, 1, 1, WHITE); api.rect(x + 1, y + 1, 1, 1, WHITE);
      } else {
        api.rect(x - 2, y - 3, 5, 7, pul ? GOLD : YELLOW);
        api.px(x, y - 1, WHITE); api.px(x, y + 1, WHITE);
      }
    }
    for (const b of pbul) {                                 // 自机弹
      const x = b.x | 0, y = b.y | 0;
      api.rect(x, y, 1, 5, b.ci);
      api.px(x, y + 1, WHITE);
      api.px(x, y + 3, WHITE);
    }
    for (const e of enemies) drawEnemy(api, e);
    for (const p of parts) {
      if (p.life < p.max * 0.3 && api.frame % 2) continue;
      api.px(p.x, p.y, p.ci);
    }
    if (!dead) drawShip(api, px, py, inv > 0);
    for (const b of ebul) drawBullet(api, b);               // 敌弹压在最上层
    for (const r of rings) {                                // 冲击波环
      const n = Math.max(8, r.r * 1.2) | 0;
      for (let i = 0; i < n; i++) {
        const a = i * TAU / n;
        api.px(r.x + Math.cos(a) * r.r, r.y + Math.sin(a) * r.r, r.ci);
      }
    }
    for (const p of pops) {
      if (p.life < 12 && api.frame % 4 >= 2) continue;
      api.text(p.t, (p.x) | 0, p.y | 0, INK);
      api.text(p.t, (p.x - 1) | 0, (p.y - 1) | 0, p.ci);
    }
    drawHud(api);
    if (bombT > 0) {                                        // 符卡全屏泛光
      const k = Math.min(1, bombT / 46);
      for (let y = 0; y < H; y += 2)
        for (let x = (y >> 1) % 2; x < W; x += 2)
          if (((x * 31 + y * 17 + api.frame) % 9) < 2) api.px(x, y, CYAN);
      api.text('SPELL CARD', (W - api.textWidth('SPELL CARD')) / 2, 60, WHITE);
    }
    if (flashT > 0) api.rect(0, 0, W, H, WHITE);            // 白闪
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
    for (const s of stars) {
      api.px(s.x, (s.y + api.frame * s.v * 0.4) % H, s.ci);
    }
    // 演出弹幕
    for (let i = 0; i < 10; i++) {
      const t = api.frame * 0.02 + i * TAU / 10;
      const x = 120 + Math.cos(t) * (30 + i * 6);
      const y = 76 + Math.sin(t) * (18 + i * 3);
      api.px(x, y - 1, PINK); api.px(x, y + 1, PINK);
      api.px(x - 1, y, PINK); api.px(x + 1, y, PINK);
      api.px(x, y, WHITE);
    }
    drawShip(api, 120, 148, false);
    centerShadow(api, 'STARFALL', 18, GOLD, 3);
    centerText(api, 'DANMAKU SHOOTER', 40, CYAN);
    if (best > 0) centerText(api, 'BEST ' + best, 54, YELLOW);
    if (api.frame % 60 < 38) centerShadow(api, 'PRESS START', 104, WHITE);
    centerText(api, 'ARROWS OR WASD - MOVE', 122, LGRAY);
    centerText(api, 'Z - FIRE   X - SPELL CARD', 132, LGRAY);
    centerText(api, 'SKIM BULLETS FOR GRAZE PTS', 142, SLATE);
    centerText(api, 'BOSS EVERY 4 WAVES', 152, SLATE);
  }

  return {
    name: 'STARFALL',
    version: '1.0',
    filter: 'none',

    /* RGB565:0黑 1深蓝 2星云紫 3岩灰 4青 5白 6金 7黄 8红 9橙 10紫罗兰
       11粉 12浅灰 13岩 14绿 15冰 */
    palette: [
      0x0000, 0x1082, 0x610C, 0x5B30, 0x07FF, 0xFFFF, 0xFE40,
      0xFE87, 0xF800, 0xFC86, 0x8ADE, 0xE25A, 0xADB8, 0x3A28,
      0x2EED, 0xAF7F,
    ],

    init() {
      scene = 'title'; paused = false;
      frame = 0; freeze = 0; flashT = 0;
      enemies = []; ebul = []; pbul = []; parts = []; rings = []; pops = []; drops = [];
      boss = null; bossSeq = false;
      px = W / 2; py = H - 26; dead = false; inv = 0;
      score = 0; graze = 0; best = loadBest();
      initStars();
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
        updateParts();
        if (overT > 40 && (jp('start') || jp('a'))) scene = 'title';
        return;
      }
      if (jp('start')) paused = !paused;
      if (paused) return;
      updatePlay(api);
    },

    draw(api) {
      if (scene === 'title') { drawTitle(api); return; }
      drawPlay(api);
      if (bannerT > 0 && (bannerT > 16 || api.frame % 4 < 2)) {
        const warn = bannerA === 'WARNING';
        centerShadow(api, bannerA, 66, warn ? RED : WHITE, 2);
        if (bannerB) centerText(api, bannerB, 84, warn ? (api.frame % 12 < 6 ? YELLOW : RED) : GOLD);
        if (warn) api.shake(1.5);
      }
      if (scene === 'over') {
        api.rect(30, 46, 180, 86, INK);
        api.rect(30, 46, 180, 1, RED); api.rect(30, 131, 180, 1, RED);
        api.rect(30, 46, 1, 86, RED); api.rect(209, 46, 1, 86, RED);
        centerShadow(api, 'GAME OVER', 56, RED, 2);
        centerText(api, 'SCORE ' + score, 80, WHITE);
        centerText(api, 'WAVE ' + wave + '  GRAZE ' + graze, 92, LGRAY);
        centerText(api, 'BEST ' + best, 104, YELLOW);
        if (overT > 40 && api.frame % 60 < 38) centerShadow(api, 'PRESS START', 116, WHITE);
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
