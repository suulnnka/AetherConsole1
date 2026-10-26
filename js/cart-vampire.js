/*
 * 卡带:NIGHT SURVIVOR · 吸血鬼幸存者式生存射击(v1.0)
 * 颜色模式 A:20 色调色板;无限地面卷轴,摄像机跟随玩家
 * 输入(手柄视图):WASD/方向键移动,Enter 开始/暂停,Z 确认升级
 * 玩法:武器全自动开火;击杀掉落经验宝石,升级三选一(武器/被动);
 *   精英掉宝箱(直接给随机强化);每关计时结束时出 Boss,击杀过关进入下一关,
 *   4 关后进入 ENDLESS 循环增强;死亡结算并记录最佳生存时间(localStorage)
 * 5 武器:魔弹(追踪最近)/飞刀(朝向前方)/圣环(近身灼烧)/月珠(环绕)/落雷(随机落雷)
 * 7 被动:移速/生命/回复/拾取/护甲/威力/急速
 */
const VampireCart = (function () {
  'use strict';

  const W = 240, H = 180, HUD = 14;

  // —— 调色板索引 ——
  const BG = 0, INK = 1, NAVY = 2, SLATE = 3, LGRAY = 4, WHITE = 5, GRAY = 6,
        DG1 = 7, DG2 = 8, GREEN = 9, CYAN = 10, ICE = 11, RED = 12, BLOOD = 13,
        ORANGE = 14, YELLOW = 15, GOLD = 16, PINK = 17, VIOLET = 18, BONE = 19;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const irnd = (a, b) => (a + Math.random() * (b - a)) | 0;
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // —— 武器等级表(数组下标 = 等级-1)——
  const WEAPONS = {
    wand:   { name: 'MAGIC WAND',  d1: 'AUTO SHOTS AT THE', d2: 'NEAREST FOE',  max: 5, ic: 'W',
              dmg: [5, 7, 9, 12, 16], cd: [42, 38, 34, 30, 26], cnt: [1, 1, 2, 2, 3], pier: [1, 1, 1, 2, 2] },
    knife:  { name: 'THROW KNIVES', d1: 'FAST BLADES FIRED', d2: 'AHEAD OF YOU', max: 5, ic: 'K',
              dmg: [4, 6, 8, 11, 15], cd: [32, 29, 26, 23, 20], cnt: [1, 2, 2, 3, 4], pier: [1, 1, 2, 2, 3] },
    aura:   { name: 'HOLY AURA',   d1: 'BURNS AND PUSHES',  d2: 'ALL NEARBY',   max: 5, ic: 'A',
              dmg: [1, 2, 3, 4, 6],  rad: [26, 30, 34, 38, 44] },
    orb:    { name: 'MOON ORBS',   d1: 'ORBITING STARS',    d2: 'HIT ON CONTACT', max: 5, ic: 'O',
              dmg: [4, 6, 8, 12, 16], cnt: [1, 2, 3, 3, 4] },
    bolt:   { name: 'THUNDER',     d1: 'SMITES RANDOM FOES', d2: 'ON SCREEN',    max: 5, ic: 'T',
              dmg: [12, 18, 26, 36, 50], cd: [140, 124, 108, 92, 76], cnt: [1, 2, 3, 4, 6] },
  };
  const PASSIVES = {
    boots:  { name: 'HERO BOOTS',  d1: 'MOVE SPEED UP',   d2: '',           max: 3 },
    heart:  { name: 'IRON HEART',  d1: 'MAX HP UP AND',   d2: 'HEALS A BIT', max: 3 },
    regen:  { name: 'MOON RING',   d1: 'SLOWLY REGENERATE', d2: 'HP OVER TIME', max: 3 },
    magnet: { name: 'LODESTONE',   d1: 'WIDER PICKUP',    d2: 'RANGE',      max: 3 },
    armor:  { name: 'STEEL PLATE', d1: 'REDUCES THE',     d2: 'DAMAGE OF EACH HIT', max: 3 },
    might:  { name: 'POWER GEM',   d1: 'ALL WEAPON',      d2: 'DAMAGE UP',  max: 3 },
    haste:  { name: 'SWIFT SIGIL', d1: 'WEAPON COOLDOWN', d2: 'DOWN',       max: 3 },
  };

  // —— 敌人类型 ——
  const ETYPES = {
    bat:     { r: 2, sp: 1.00, hp: 4,  dmg: 3,  xp: 1, w: 2, h: 2, ci: VIOLET, ci2: PINK },
    zombie:  { r: 3, sp: 0.42, hp: 14, dmg: 6,  xp: 2, w: 4, h: 5, ci: GREEN,  ci2: GRAY },
    ghost:   { r: 2, sp: 0.70, hp: 8,  dmg: 4,  xp: 2, w: 3, h: 4, ci: ICE,    ci2: WHITE },
    spitter: { r: 3, sp: 0.55, hp: 10, dmg: 4,  xp: 3, w: 4, h: 4, ci: PINK,   ci2: RED },
    brute:   { r: 5, sp: 0.30, hp: 44, dmg: 12, xp: 6, w: 6, h: 7, ci: RED,    ci2: BLOOD },
  };

  // —— 关卡(阶段)配置:时长秒 / 地砖双色 / 敌混表 / 精英间隔秒 ——
  const STAGES = [
    { name: 'CRIMSON FIELD',  dur: 110, tiles: [DG1, DG2],    mix: ['bat', 'bat', 'zombie'],             elite: 40, tuft: GREEN },
    { name: 'OLD GRAVEYARD',  dur: 120, tiles: [INK, SLATE],  mix: ['bat', 'zombie', 'ghost'],           elite: 36, tuft: ICE },
    { name: 'ROT GARDEN',     dur: 130, tiles: [BLOOD, INK],  mix: ['zombie', 'ghost', 'spitter'],       elite: 34, tuft: RED },
    { name: 'ABYSS GATE',     dur: 140, tiles: [INK, DG1],    mix: ['bat', 'ghost', 'spitter', 'brute'], elite: 32, tuft: GOLD },
  ];
  function stageCfg(i) {
    if (i < STAGES.length) return STAGES[i];
    const r = i - STAGES.length + 1;
    return { name: 'ENDLESS ' + r, dur: 150, tiles: [INK, BLOOD],
             mix: ['bat', 'zombie', 'ghost', 'spitter', 'brute'], elite: 28, tuft: CYAN };
  }

  // —— 全局状态 ——
  let scene, paused;
  let player, weapons, plv, mightMul, hasteMul;
  let enemies, bullets, ebullets, gems, pickups, parts, floats, bolts, orbPos;
  let stageIdx, cfg, stageT, totalT, bossOn, boss, warnT, bannerT, clearT;
  let kills, levelQueue, choices, sel, spawnT, burstT, eliteT, best;

  function loadBest() {
    try { const s = localStorage.getItem('ac_ns_best'); if (s) return JSON.parse(s); } catch (e) {}
    return null;
  }
  function saveBest() {
    const t = Math.floor(totalT / 60);
    if (!best || t > (best.t || 0)) {
      best = { t, k: kills, l: player.lvl, s: stageIdx + 1 };
      try { localStorage.setItem('ac_ns_best', JSON.stringify(best)); } catch (e) {}
    }
  }
  const mmss = (fr) => {
    const s = Math.floor(fr / 60);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const hpMul = () => 1 + stageIdx * 0.45 + totalT / 4800;
  const dmgMul = () => 1 + stageIdx * 0.2 + totalT / 9000;
  const xpNeed = (l) => 6 + l * 5 + Math.floor(l * l * 0.35);

  function recompute() {
    player.speed = 1.25 * (1 + 0.10 * (plv.boots || 0));
    player.maxhp = 100 + 20 * (plv.heart || 0);
    player.magnet = 26 + 13 * (plv.magnet || 0);
    player.armor = plv.armor || 0;
    player.regen = plv.regen || 0;
    mightMul = 1 + 0.15 * (plv.might || 0);
    hasteMul = 1 - 0.08 * (plv.haste || 0);
  }

  function startStage(i) {
    stageIdx = i;
    cfg = stageCfg(i);
    stageT = 0;
    bossOn = false;
    boss = null;
    bannerT = 120;
    enemies = [];
    ebullets = [];
    bullets = [];
    for (const g of gems) addXp(g.v, null);
    gems = [];
    pickups = [];
    bolts = [];
    player.hp = Math.min(player.maxhp, player.hp + player.maxhp * 0.25);
    spawnT = 40;
    burstT = 700;
    eliteT = cfg.elite * 60;
    scene = 'play';
  }

  function spawnEnemy(type, elite, x, y) {
    if (enemies.length >= 110) return;
    const t = ETYPES[type];
    if (x === undefined) {
      const a = rnd(0, Math.PI * 2), d = rnd(130, 160);
      x = player.x + Math.cos(a) * d;
      y = player.y + Math.sin(a) * d;
    }
    const hp = t.hp * hpMul() * (elite ? 7 : 1);
    enemies.push({
      type, elite: !!elite, x, y, hp, max: hp,
      dmg: Math.round(t.dmg * dmgMul() * (elite ? 1.6 : 1)),
      r: t.r + (elite ? 2 : 0), w: t.w + (elite ? 4 : 0), h: t.h + (elite ? 4 : 0),
      sp: t.sp * (elite ? 0.9 : 1) * rnd(0.9, 1.1),
      xp: t.xp * (elite ? 6 : 1),
      ci: t.ci, ci2: t.ci2,
      acd: 30 + irnd(0, 30), flash: 0, kx: 0, ky: 0, ocd: 0,
      ph: rnd(0, 6.28), shootT: irnd(60, 150), boss: false,
    });
  }

  function spawnBoss() {
    const hp = 240 * hpMul() * 1.6;
    boss = {
      type: 'boss', elite: false, boss: true,
      x: player.x + rnd(-100, 100), y: player.y - 130,
      hp, max: hp, dmg: Math.round(14 * dmgMul()),
      r: 8, w: 10, h: 12, sp: 0.34, xp: 40,
      ci: RED, ci2: BLOOD,
      acd: 40, flash: 0, kx: 0, ky: 0, ocd: 0, ph: 0,
      shootT: 100, ringT: 130, sumT: 220,
    };
    enemies.push(boss);
    bossOn = true;
    warnT = 100;
  }

  function hurtPlayer(dmg, dx, dy) {
    if (player.invuln > 0 || scene !== 'play') return;
    const d = Math.max(1, Math.round(dmg) - player.armor);
    player.hp -= d;
    player.invuln = 16;
    player.x += dx * 4;
    player.y += dy * 4;
    burst(player.x, player.y, 10, RED, 1.4);
    if (player.hp <= 0) {
      player.hp = 0;
      burst(player.x, player.y, 40, WHITE, 2.5);
      saveBest();
      scene = 'over';
    }
  }

  function killEnemy(api, e, j) {
    if (j !== undefined && enemies[j] === e) enemies.splice(j, 1);
    else {
      const i = enemies.indexOf(e);
      if (i >= 0) enemies.splice(i, 1);
    }
    kills++;
    burst(e.x, e.y, e.elite || e.boss ? 26 : 8, e.ci, e.elite || e.boss ? 2.2 : 1.2);
    // 掉落
    if (e.boss) {
      gems.push({ x: e.x, y: e.y, v: 30, vx: 0, vy: 0, mag: false });
      pickups.push({ kind: 'chest', x: e.x + 10, y: e.y });
      scoreBossKill(api);
      return;
    }
    gems.push({ x: e.x + rnd(-3, 3), y: e.y + rnd(-3, 3), v: e.xp, vx: 0, vy: 0, mag: false });
    if (gems.length > 160) {          // 宝石过多:就近合并
      let bi = 0, bd = 1e9;
      for (let i = 1; i < gems.length; i++) {
        const d2 = (gems[i].x - gems[0].x) ** 2 + (gems[i].y - gems[0].y) ** 2;
        if (d2 < bd) { bd = d2; bi = i; }
      }
      gems[0].v += gems[bi].v;
      gems.splice(bi, 1);
    }
    if (e.elite) pickups.push({ kind: 'chest', x: e.x, y: e.y });
    else {
      const r = Math.random();
      if (r < 0.012) pickups.push({ kind: 'heart', x: e.x, y: e.y });
      else if (r < 0.017) pickups.push({ kind: 'magnet', x: e.x, y: e.y });
    }
  }

  function scoreBossKill(api) {
    bossOn = false;
    boss = null;
    scene = 'clear';
    clearT = 180;
    player.hp = Math.min(player.maxhp, player.hp + player.maxhp * 0.25);
    api.shake(4);
    for (let i = 0; i < 3; i++) burst(player.x + rnd(-40, 40), player.y + rnd(-30, 30), 20, GOLD, 2);
  }

  function addXp(v) {
    player.xp += v;
    while (player.xp >= player.next) {
      player.xp -= player.next;
      player.lvl++;
      player.next = xpNeed(player.lvl);
      levelQueue++;
    }
  }

  // —— 升级三选一 ——
  function buildChoices() {
    const pool = [];
    for (const wp of weapons)
      if (wp.lvl < WEAPONS[wp.id].max) pool.push({ t: 'w', id: wp.id, lv: wp.lvl + 1 });
    if (weapons.length < 4)
      for (const id in WEAPONS)
        if (!weapons.some(wp => wp.id === id)) pool.push({ t: 'w', id, lv: 1 });
    for (const id in PASSIVES)
      if ((plv[id] || 0) < PASSIVES[id].max) pool.push({ t: 'p', id, lv: (plv[id] || 0) + 1 });
    // 洗牌取 3
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const out = pool.slice(0, 3).map(c => {
      const def = c.t === 'w' ? WEAPONS[c.id] : PASSIVES[c.id];
      return { ...c, name: def.name, d1: def.d1, d2: def.d2, ic: def.ic || '',
               st: c.lv === 1 ? 'NEW!' : 'LV ' + c.lv };
    });
    while (out.length < 3)
      out.push({ t: 'h', name: 'ROAST CHICKEN', d1: 'RESTORES 40 HP', d2: '', st: 'EAT' });
    return out;
  }

  function applyChoice(c) {
    if (c.t === 'h') { player.hp = Math.min(player.maxhp, player.hp + 40); return; }
    if (c.t === 'w') {
      const wp = weapons.find(w => w.id === c.id);
      if (wp) wp.lvl = c.lv;
      else weapons.push({ id: c.id, lvl: 1, t: 0 });
    } else {
      plv[c.id] = c.lv;
      if (c.id === 'heart') player.hp = Math.min(100 + 20 * c.lv, player.hp + 20);
    }
    recompute();
  }

  function grantChest() {
    const c = buildChoices()[0];
    applyChoice(c);
    floats.push({ x: player.x, y: player.y - 14, txt: c.name, ci: GOLD, life: 70 });
    for (let i = 0; i < 3; i++) burst(player.x + rnd(-20, 20), player.y + rnd(-16, 16), 14, GOLD, 1.8);
  }

  // —— 粒子 ——
  function burst(x, y, n, ci, pow) {
    for (let i = 0; i < n && parts.length < 140; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(0.2, pow + 0.6), max = irnd(14, 30);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                   ci: Math.random() < 0.5 ? ci : pick([WHITE, YELLOW, LGRAY]),
                   life: max, max });
    }
  }

  function updateFx() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.92; p.vy *= 0.92;
      if (--p.life <= 0) parts.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--)
      if (--floats[i].life <= 0) floats.splice(i, 1);
    for (let i = bolts.length - 1; i >= 0; i--)
      if (--bolts[i].life <= 0) bolts.splice(i, 1);
  }

  // —— 武器开火 ——
  function updateWeapons(api) {
    orbPos = [];
    for (const wp of weapons) {
      const def = WEAPONS[wp.id], lv = wp.lvl - 1;
      wp.t++;
      const cd = Math.max(8, Math.round(def.cd[lv] * hasteMul));
      const dmg = def.dmg[lv] * mightMul;
      if (wp.id === 'wand' && wp.t >= cd) {
        wp.t = 0;
        const n = def.cnt[lv];
        const near = enemies
          .filter(e => (e.x - player.x) ** 2 + (e.y - player.y) ** 2 < 150 * 150)
          .sort((a, b) => ((a.x - player.x) ** 2 + (a.y - player.y) ** 2) -
                          ((b.x - player.x) ** 2 + (b.y - player.y) ** 2));
        for (let k = 0; k < n && k < near.length; k++) {
          const e = near[k];
          let dx = e.x - player.x, dy = e.y - player.y;
          const m = Math.hypot(dx, dy) || 1;
          bullets.push({ x: player.x, y: player.y, vx: dx / m * 2.6, vy: dy / m * 2.6,
                         dmg, pierce: def.pier[lv], r: 2, ci: VIOLET, life: 70, hit: [] });
        }
      } else if (wp.id === 'knife' && wp.t >= cd) {
        wp.t = 0;
        for (let k = 0; k < def.cnt[lv]; k++) {
          const sp = (k - (def.cnt[lv] - 1) / 2) * 0.18;
          bullets.push({
            x: player.x, y: player.y,
            vx: player.fx * 3.4 - player.fy * sp,
            vy: player.fy * 3.4 + player.fx * sp,
            dmg, pierce: def.pier[lv], r: 2, ci: WHITE, life: 46, hit: [],
          });
        }
      } else if (wp.id === 'aura' && wp.t >= 20) {
        wp.t = 0;
        const R = def.rad[lv];
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          let dx = e.x - player.x, dy = e.y - player.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R * R) {
            e.hp -= dmg;
            const d = Math.sqrt(d2) || 1;
            e.kx += dx / d * 0.5;
            e.ky += dy / d * 0.5;
            if (e.hp <= 0) killEnemy(api, e, j);
          }
        }
      } else if (wp.id === 'orb') {
        const n = def.cnt[lv], R = 22;
        for (let k = 0; k < n; k++) {
          const a = api.frame * 0.055 + k / n * Math.PI * 2;
          const ox = player.x + Math.cos(a) * R, oy = player.y + Math.sin(a) * R;
          orbPos.push({ x: ox, y: oy });
          for (const e of enemies) {
            if (api.frame < e.ocd) continue;
            const rr = 3 + e.r;
            if ((e.x - ox) ** 2 + (e.y - oy) ** 2 < rr * rr) {
              e.hp -= dmg;
              e.flash = 3;
              e.ocd = api.frame + 15;
              e.kx += (e.x - ox) * 0.06;
              e.ky += (e.y - oy) * 0.06;
              if (e.hp <= 0) killEnemy(api, e);
            }
          }
        }
      } else if (wp.id === 'bolt' && wp.t >= cd) {
        const onScr = enemies.filter(e =>
          Math.abs(e.x - player.x) < 130 && Math.abs(e.y - player.y) < 90);
        if (!onScr.length) { wp.t = cd - 20; continue; }
        wp.t = 0;
        for (let k = 0; k < def.cnt[lv] && onScr.length; k++) {
          const e = onScr.splice((Math.random() * onScr.length) | 0, 1)[0];
          bolts.push({ x: e.x, y: e.y, life: 9, seed: Math.random() * 9 });
          api.shake(1.2);
          e.hp -= dmg;
          e.flash = 5;
          for (const o of enemies) {
            if (o === e) continue;
            if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 < 12 * 12) {
              o.hp -= dmg * 0.5;
              o.flash = 3;
              if (o.hp <= 0) killEnemy(api, o);
            }
          }
          if (e.hp <= 0) killEnemy(api, e);
        }
      }
    }
  }

  function updateBullets(api) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx; b.y += b.vy;
      let dead = --b.life <= 0;
      if (!dead) {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (b.hit.indexOf(e) >= 0) continue;
          const rr = b.r + e.r;
          const dx = b.x - e.x, dy = b.y - e.y;
          if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
          if (dx * dx + dy * dy < rr * rr) {
            e.hp -= b.dmg;
            e.flash = 4;
            e.kx += b.vx * 0.12;
            e.ky += b.vy * 0.12;
            if (e.hp <= 0) killEnemy(api, e, j);
            b.hit.push(e);
            if (--b.pierce <= 0) { dead = true; break; }
          }
        }
      }
      if (dead) bullets.splice(i, 1);
    }
    for (let i = ebullets.length - 1; i >= 0; i--) {
      const b = ebullets[i];
      b.x += b.vx; b.y += b.vy;
      if (--b.life <= 0) { ebullets.splice(i, 1); continue; }
      if ((b.x - player.x) ** 2 + (b.y - player.y) ** 2 < 4 * 4) {
        hurtPlayer(b.dmg, b.vx, b.vy);
        ebullets.splice(i, 1);
      }
    }
  }

  function updateEnemies(api) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.flash > 0) e.flash--;
      if (e.acd > 0) e.acd--;
      let dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      let mx = dx * e.sp, my = dy * e.sp;
      if (e.type === 'ghost') {                       // 幽灵横漂
        const s = Math.sin(api.frame * 0.05 + e.ph) * 0.5;
        mx += -dy * s; my += dx * s;
      } else if (e.type === 'spitter') {              // 吐息者保持距离射击
        if (d < 46) { mx = -dx * e.sp; my = -dy * e.sp; }
        else if (d < 82) { mx = -dy * e.sp * 0.7; my = dx * e.sp * 0.7; }
        if (--e.shootT <= 0 && d < 160) {
          e.shootT = 150;
          ebullets.push({ x: e.x, y: e.y, vx: dx * 1.05, vy: dy * 1.05,
                          dmg: Math.round(5 * dmgMul()), life: 320 });
        }
      }
      if (e.boss) {
        if (--e.ringT <= 0) {                         // 弹环
          e.ringT = 170;
          for (let k = 0; k < 10; k++) {
            const a = k / 10 * Math.PI * 2;
            ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 0.85, vy: Math.sin(a) * 0.85,
                            dmg: Math.round(6 * dmgMul()), life: 320 });
          }
        }
        if (--e.sumT <= 0) {                          // 召唤
          e.sumT = 320;
          for (let k = 0; k < 3; k++) spawnEnemy('bat', false, e.x + rnd(-24, 24), e.y + rnd(-24, 24));
        }
      }
      e.x += mx + e.kx;
      e.y += my + e.ky;
      e.kx *= 0.85; e.ky *= 0.85;
      if (d < e.r + 3 && e.acd <= 0) {
        e.acd = 45;
        hurtPlayer(e.dmg, dx, dy);
        if (scene !== 'play') return;
      }
      if (e.hp <= 0) killEnemy(api, e, i);
    }
    // 轻量分离,防止叠成一坨
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const rr = a.r + b.r;
        if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 0.01) {
          const d = Math.sqrt(d2), push = (rr - d) / d * 0.22;
          dx *= push; dy *= push;
          if (!a.boss) { a.x -= dx; a.y -= dy; }
          if (!b.boss) { b.x += dx; b.y += dy; }
        }
      }
    }
  }

  function updateDrops(api) {
    const mag2 = player.magnet * player.magnet;
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      const dx = player.x - g.x, dy = player.y - g.y;
      const d2 = dx * dx + dy * dy;
      if (g.mag || d2 < mag2) {
        g.mag = g.mag || d2 < mag2 * 0.7;
        const d = Math.sqrt(d2) || 1;
        const pull = g.mag ? 3.2 : 2.2;
        g.x += dx / d * pull; g.y += dy / d * pull;
      }
      if (d2 < 10) {
        addXp(g.v);
        burst(g.x, g.y, 2, CYAN, 0.5);
        gems.splice(i, 1);
      }
    }
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      if ((p.x - player.x) ** 2 + (p.y - player.y) ** 2 < 8 * 8) {
        if (p.kind === 'heart') {
          player.hp = Math.min(player.maxhp, player.hp + 30);
          floats.push({ x: p.x, y: p.y - 8, txt: 'HP', ci: RED, life: 50 });
        } else if (p.kind === 'magnet') {
          for (const g of gems) g.mag = true;
          floats.push({ x: p.x, y: p.y - 8, txt: 'MAGNET', ci: ICE, life: 50 });
        } else grantChest();
        burst(p.x, p.y, 12, GOLD, 1.4);
        pickups.splice(i, 1);
      }
    }
  }

  function updateSpawns() {
    let interval = clamp(46 - stageIdx * 2 - stageT / 300, 14, 46);
    if (bossOn) interval *= 1.8;
    if (--spawnT <= 0) {
      spawnT = interval * rnd(0.7, 1.3);
      spawnEnemy(pick(cfg.mix));
      if (stageT > 3600 && Math.random() < 0.35) spawnEnemy(pick(cfg.mix));
    }
    if (--burstT <= 0) {                             // 整点蝙蝠环
      burstT = 900;
      const n = 8 + stageIdx;
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2;
        spawnEnemy('bat', false, player.x + Math.cos(a) * 150, player.y + Math.sin(a) * 150);
      }
    }
    if (!bossOn && --eliteT <= 0) {                  // 精英
      eliteT = cfg.elite * 60;
      spawnEnemy(pick(cfg.mix), true);
    }
    if (!bossOn && stageT >= cfg.dur * 60) spawnBoss();
  }

  // —— 绘制 ——
  function drawWorld(api) {
    const camx = player.x, camy = player.y;
    api.cls(cfg.tiles[0]);
    const x0 = Math.floor((camx - 124) / 8), y0 = Math.floor((camy - 94) / 8);
    for (let ty = y0; ty < y0 + 25; ty++) {
      for (let tx = x0; tx < x0 + 32; tx++) {
        const hsh = ((tx * 374761393 + ty * 668265263) ^ (tx * ty * 97)) >>> 0;
        const sx = tx * 8 - camx + 120, sy = ty * 8 - camy + 90;
        if (sx < -8 || sx > W || sy < -8 || sy > H) continue;
        if (hsh % 7 < 2) api.rect(sx, sy, 8, 8, cfg.tiles[1]);
        else if (hsh % 13 === 0) api.px(sx + (hsh >>> 4 & 7), sy + (hsh >>> 7 & 7), cfg.tuft);
      }
    }
    const sxOf = (x) => x - camx + 120, syOf = (y) => y - camy + 90;

    // 圣环
    const aura = weapons.find(w => w.id === 'aura');
    if (aura) {
      const R = WEAPONS.aura.rad[aura.lvl - 1];
      const ci = api.frame % 8 < 4 ? ICE : WHITE;
      for (let a = 0; a < Math.PI * 2; a += 0.38)
        api.px(sxOf(player.x) + Math.cos(a) * R, syOf(player.y) + Math.sin(a) * R, ci);
    }
    // 宝石与拾取
    for (const g of gems) {
      const x = sxOf(g.x), y = syOf(g.y);
      if (x < -4 || x > W + 4 || y < HUD - 4 || y > H + 4) continue;
      if (g.v >= 6) { api.rect(x - 1, y - 1, 3, 3, api.frame % 10 < 5 ? GOLD : YELLOW); }
      else api.rect(x, y, 2, 2, api.frame % 12 < 6 ? CYAN : ICE);
    }
    for (const p of pickups) {
      const x = Math.round(sxOf(p.x)), y = Math.round(syOf(p.y)) + Math.round(Math.sin(api.frame * 0.1) * 1.5);
      if (p.kind === 'heart') {
        api.px(x - 2, y - 2, RED); api.px(x + 1, y - 2, RED);
        api.rect(x - 2, y - 1, 4, 2, RED); api.rect(x - 1, y + 1, 2, 1, RED);
        api.px(x - 1, y - 2, PINK);
      } else if (p.kind === 'magnet') {
        api.rect(x - 2, y - 2, 4, 1, ICE); api.rect(x - 2, y - 1, 1, 3, ICE);
        api.rect(x + 1, y - 1, 1, 3, ICE);
      } else {                                        // 宝箱
        api.rect(x - 4, y - 3, 8, 6, GOLD);
        api.rect(x - 4, y - 1, 8, 1, ORANGE);
        api.rect(x - 1, y, 2, 2, YELLOW);
        api.rect(x - 4, y - 3, 8, 1, WHITE);
      }
    }
    // 敌人
    for (const e of enemies) drawEnemy(api, e, sxOf, syOf);
    // 玩家子弹 / 月珠
    for (const b of bullets) {
      const x = sxOf(b.x), y = syOf(b.y);
      api.rect(x, y, 2, 2, b.ci);
      api.px(x - b.vx, y - b.vy, INK);
    }
    for (const o of orbPos) {
      const x = sxOf(o.x), y = syOf(o.y);
      api.rect(x - 1, y - 1, 3, 3, CYAN);
      api.px(x, y, WHITE);
    }
    // 玩家
    if (!(player.invuln > 0 && api.frame % 4 < 2)) {
      const x = Math.round(sxOf(player.x)), y = Math.round(syOf(player.y));
      api.rect(x - 2, y - 3, 5, 7, WHITE);
      api.rect(x - 2, y - 3, 5, 2, BONE);
      api.px(x - 1, y - 2, INK); api.px(x + 1, y - 2, INK);
      api.rect(x - 2, y + 3, 5, 1, CYAN);
      api.px(x + Math.round(player.fx * 5), y + Math.round(player.fy * 5), CYAN);
    }
    // 敌弹
    for (const b of ebullets) {
      const x = sxOf(b.x), y = syOf(b.y);
      api.rect(x, y, 2, 2, api.frame % 6 < 3 ? PINK : RED);
    }
    // 落雷
    for (const b of bolts) {
      const x = Math.round(sxOf(b.x)), y = Math.round(syOf(b.y));
      const ci = b.life % 2 ? WHITE : YELLOW;
      let px2 = x + Math.round(Math.sin(b.seed) * 6);
      for (let yy = HUD; yy < y; yy += 7) {
        const nx = x + Math.round(Math.sin(b.seed + yy * 0.3) * 8);
        line(api, px2, yy, nx, Math.min(yy + 7, y), ci);
        px2 = nx;
      }
      api.rect(x - 1, y - 1, 3, 3, WHITE);
    }
    // 粒子 / 飘字
    for (const p of parts) {
      if (p.life < p.max * 0.3 && api.frame % 2) continue;
      api.px(sxOf(p.x), syOf(p.y), p.ci);
    }
    for (const f of floats) {
      if (f.life > 10 || api.frame % 4 < 2) {
        const x = Math.round(sxOf(f.x) - api.textWidth(f.txt) / 2), y = Math.round(syOf(f.y));
        api.text(f.txt, x + 1, y + 1, INK);
        api.text(f.txt, x, y, f.ci);
      }
    }
  }

  function line(api, x0, y0, x1, y1, ci) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      api.px(x0, y0, ci);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function drawEnemy(api, e, sxOf, syOf) {
    const sx = Math.round(sxOf(e.x)), sy = Math.round(syOf(e.y));
    const w = e.w, h = e.h, x = sx - (w >> 1), y = sy - (h >> 1);
    if (sx < -12 || sx > W + 12 || sy < HUD - 12 || sy > H + 12) return;
    const fl = e.flash > 0;
    const ci = fl ? WHITE : e.ci, ci2 = fl ? WHITE : e.ci2;
    if (e.elite) {                                    // 精英金环
      const p = api.frame % 20 < 10 ? GOLD : YELLOW;
      api.rect(x - 2, y - 2, w + 4, 1, p); api.rect(x - 2, y + h + 1, w + 4, 1, p);
      api.rect(x - 2, y - 2, 1, h + 4, p); api.rect(x + w + 1, y - 2, 1, h + 4, p);
    }
    if (e.boss) {
      api.rect(x - 1, y - 3, 3, 3, BLOOD); api.rect(x + w - 2, y - 3, 3, 3, BLOOD);   // 角
      api.rect(x, y, w, h, ci);
      api.rect(x + 1, y + 3, 2, 2, YELLOW); api.rect(x + w - 3, y + 3, 2, 2, YELLOW); // 眼
      api.rect(x + 2, y + h - 2, w - 4, 1, INK);                                       // 嘴
      api.px(x + 3, y + h - 2, WHITE); api.px(x + w - 4, y + h - 2, WHITE);            // 牙
      // Boss 血条
      const bw = 100, ratio = clamp(e.hp / e.max, 0, 1);
      api.rect(70, HUD + 2, bw, 4, INK);
      api.rect(71, HUD + 3, Math.round((bw - 2) * ratio), 2, RED);
      return;
    }
    api.rect(x, y, w, h, ci);
    if (e.type === 'bat') {
      if (api.frame % 8 < 4) { api.px(x - 1, y, ci2); api.px(x + w, y, ci2); }
      else { api.px(x - 1, y + 1, ci2); api.px(x + w, y + 1, ci2); }
    } else if (e.type === 'zombie') {
      api.px(x, y + 1, RED); api.px(x + w - 1, y + 1, RED);          // 眼
      api.px(x - 1, y + 2, ci2); api.px(x + w, y + 2, ci2);          // 手
    } else if (e.type === 'ghost') {
      if (api.frame % 10 < 5) { api.px(x + 1, y + 1, INK); api.px(x + w - 2, y + 1, INK); }
      api.px(x, y + h, INK); api.px(x + w - 1, y + h, INK);          // 拖尾
    } else if (e.type === 'spitter') {
      api.px(x + 1, y + 1, YELLOW); api.px(x + w - 2, y + 1, YELLOW);
      api.rect(x + 1, y + h - 1, 2, 1, ci2);
    } else if (e.type === 'brute') {
      api.px(x + 1, y + 2, YELLOW); api.px(x + w - 2, y + 2, YELLOW);
      api.rect(x - 1, y + 2, 1, 3, ci2); api.rect(x + w, y + 2, 1, 3, ci2);
    }
  }

  function drawHud(api) {
    api.rect(0, 0, W, HUD, NAVY);
    api.rect(0, HUD, W, 1, SLATE);
    const xr = clamp(player.xp / player.next, 0, 1);
    api.rect(2, 2, W - 4, 2, INK);
    api.rect(2, 2, Math.round((W - 4) * xr), 2, CYAN);
    const hr = clamp(player.hp / player.maxhp, 0, 1);
    api.rect(2, 7, 64, 5, INK);
    api.rect(3, 8, Math.max(0, Math.round(62 * hr)), 3, hr > 0.35 ? RED : api.frame % 10 < 5 ? RED : BLOOD);
    api.text('LV' + player.lvl, 70, 8, WHITE);
    const tTxt = mmss(totalT);
    api.text(tTxt, (W - api.textWidth(tTxt)) / 2, 8, WHITE);
    const kTxt = 'K' + kills;
    api.text(kTxt, W - 3 - api.textWidth(kTxt), 8, LGRAY);
    // 武器栏(左下)
    for (let i = 0; i < weapons.length; i++) {
      const wp = weapons[i], def = WEAPONS[wp.id];
      const x = 3 + i * 9, y = H - 9;
      api.rect(x, y, 7, 7, NAVY);
      api.rect(x, y, 7, 1, wp.lvl >= def.max ? GOLD : SLATE);
      api.text(def.ic, x + 2, y + 1, wp.lvl >= def.max ? GOLD : WHITE);
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
    api.cls(INK);
    for (let i = 0; i < 46; i++) {                    // 星尘 + 蝙蝠
      const x = (i * 53 + api.frame * 0.15) % W, y = (i * 97 + Math.sin(api.frame * 0.02 + i) * 6 + H) % H;
      api.px(x, y, i % 5 ? NAVY : SLATE);
    }
    for (let i = 0; i < 4; i++) {                     // 装饰蝙蝠
      const x = (api.frame * (0.6 + i * 0.2) + i * 70) % (W + 20) - 10;
      const y = 20 + i * 12 + Math.sin(api.frame * 0.06 + i * 2) * 6;
      const fl = api.frame % 10 < 5 ? VIOLET : PINK;
      api.px(x - 1, y, fl); api.rect(x, y, 2, 2, fl); api.px(x + 2, y, fl);
    }
    centerShadow(api, 'NIGHT', 26, RED, 3);
    centerShadow(api, 'SURVIVOR', 50, GOLD, 3);
    centerText(api, 'ENDLESS HORDE SURVIVAL', 74, SLATE);
    if (best) {
      const bTxt = 'BEST ' + mmss(best.t * 60) + '  K' + best.k + '  ST' + best.s;
      centerText(api, bTxt, 84, YELLOW);
    }
    if (api.frame % 60 < 36) centerShadow(api, 'PRESS START', 102, WHITE);
    centerText(api, 'WASD OR ARROWS TO MOVE', 126, LGRAY);
    centerText(api, 'WEAPONS FIRE ON THEIR OWN', 136, SLATE);
    centerText(api, 'SLAY THE BOSS TO ADVANCE', 146, SLATE);
  }

  function drawLevelUp(api) {
    for (let y = HUD; y < H; y += 2) api.rect(0, y, W, 1, INK);   // 隔行压暗
    api.rect(18, 34, 204, 108, NAVY);
    api.rect(18, 34, 204, 1, WHITE); api.rect(18, 141, 204, 1, WHITE);
    api.rect(18, 34, 1, 108, WHITE); api.rect(221, 34, 1, 108, WHITE);
    centerShadow(api, 'LEVEL UP!', 42, GOLD, 2);
    for (let i = 0; i < 3; i++) {
      const c = choices[i], y = 58 + i * 28;
      if (i === sel) {
        const blink = api.frame % 12 < 8;
        api.rect(24, y - 3, 192, 26, INK);
        if (blink) {
          api.px(28, y + 3, GOLD); api.px(29, y + 3, GOLD); api.px(30, y + 3, GOLD);
          api.px(29, y + 4, GOLD);
        }
      }
      api.text(c.name, 36, y, i === sel ? WHITE : LGRAY);
      const stX = 213 - api.textWidth(c.st);
      api.text(c.st, stX, y, c.st === 'NEW!' ? GOLD : YELLOW);
      api.text(c.d1, 36, y + 9, i === sel ? LGRAY : SLATE);
      if (c.d2) api.text(c.d2, 36, y + 16, i === sel ? LGRAY : SLATE);
    }
    centerText(api, 'ARROWS PICK - Z CONFIRM', 152, SLATE);
  }

  return {
    name: 'NIGHT SURVIVOR',
    version: '1.0',
    filter: 'none',

    /* RGB565:0黑 1深蓝 2面板蓝 3岩灰 4浅灰 5白 6灰
       7/8 草地双色 9绿 10青 11冰 12红 13暗红 14橙 15黄 16金 17粉 18紫 19暖白 */
    palette: [
      0x0000, 0x1082, 0x2129, 0x5B30, 0xADB8, 0xFFFF, 0x7BEF,
      0x03A0, 0x05C0, 0x2EED, 0x4FFF, 0xAF7F, 0xF20B, 0x8002,
      0xFC86, 0xFE87, 0xFE40, 0xE25A, 0x8ADE, 0xFF98,
    ],

    init() {
      player = { x: 0, y: 0, fx: 1, fy: 0, hp: 100, maxhp: 100,
                 speed: 1.25, lvl: 1, xp: 0, next: xpNeed(1),
                 magnet: 26, armor: 0, regen: 0, invuln: 0 };
      weapons = [{ id: 'wand', lvl: 1, t: 0 }];
      plv = {};
      recompute();
      enemies = []; bullets = []; ebullets = []; gems = []; pickups = [];
      parts = []; floats = []; bolts = []; orbPos = [];
      kills = 0; levelQueue = 0; choices = null; sel = 0;
      totalT = 0; warnT = 0; clearT = 0;
      best = loadBest();
      scene = 'title'; paused = false;
    },

    update(api) {
      const jp = api.justPressed;
      if (scene === 'title') {
        if (jp('start') || jp('a')) {
          this.init();                                 // 完整重置玩家与全局状态
          startStage(0);
          api.shake(1);
        }
        return;
      }
      if (scene === 'over') {
        if (jp('start') || jp('a')) scene = 'title';
        return;
      }
      if (jp('start')) paused = !paused;
      if (paused) return;

      if (scene === 'levelup') {
        if (jp('left') || jp('up')) sel = (sel + 2) % 3;
        if (jp('right') || jp('down')) sel = (sel + 1) % 3;
        if (jp('a')) {                                 // Enter 已被上方用作暂停
          applyChoice(choices[sel]);
          levelQueue--;
          if (levelQueue > 0) { choices = buildChoices(); sel = 0; }
          else scene = 'play';
        }
        return;
      }
      if (scene === 'clear') {
        updateFx();
        if (--clearT <= 0) startStage(stageIdx + 1);
        return;
      }

      // —— play ——
      if (bannerT > 0) bannerT--;
      if (warnT > 0) warnT--;
      if (player.invuln > 0) player.invuln--;
      stageT++; totalT++;

      if (levelQueue > 0) { choices = buildChoices(); sel = 0; scene = 'levelup'; return; }

      let dx = 0, dy = 0;
      if (api.pressed('left')) dx -= 1;
      if (api.pressed('right')) dx += 1;
      if (api.pressed('up')) dy -= 1;
      if (api.pressed('down')) dy += 1;
      if (dx || dy) {
        const m = Math.hypot(dx, dy);
        player.x += dx / m * player.speed;
        player.y += dy / m * player.speed;
        player.fx = dx / m; player.fy = dy / m;
      }
      if (player.regen) player.hp = Math.min(player.maxhp, player.hp + 0.5 * player.regen / 60);

      updateWeapons(api);
      updateBullets(api);
      if (scene !== 'play') return;                   // 弹途致死则跳出
      updateEnemies(api);
      if (scene !== 'play') return;
      updateDrops(api);
      updateSpawns();
      updateFx();
    },

    draw(api) {
      if (scene === 'title') { drawTitle(api); return; }
      drawWorld(api);
      drawHud(api);
      if (scene === 'levelup') drawLevelUp(api);
      else if (scene === 'clear') {
        centerShadow(api, 'STAGE CLEAR!', 62, GOLD, 2);
        centerShadow(api, 'HP RESTORED', 84, WHITE);
        if (clearT < 120 && clearT % 6 < 4)
          centerText(api, 'NEXT: ' + stageCfg(stageIdx + 1).name, 98, LGRAY);
      } else if (scene === 'over') {
        for (let y = 0; y < H; y += 2) api.rect(0, y, W, 1, INK);
        api.rect(30, 44, 180, 92, NAVY);
        api.rect(30, 44, 180, 1, RED); api.rect(30, 135, 180, 1, RED);
        api.rect(30, 44, 1, 92, RED); api.rect(209, 44, 1, 92, RED);
        centerShadow(api, 'YOU DIED', 52, RED, 2);
        centerText(api, 'SURVIVED ' + mmss(totalT), 76, WHITE);
        centerText(api, 'LEVEL ' + player.lvl + '  KILLS ' + kills, 88, LGRAY);
        centerText(api, 'REACHED STAGE ' + (stageIdx + 1), 100, LGRAY);
        if (best) centerText(api, 'BEST ' + mmss(best.t * 60), 114, YELLOW);
        if (api.frame % 60 < 36) centerShadow(api, 'PRESS START', 124, WHITE);
      }
      if (warnT > 0 && api.frame % 12 < 8) {
        centerShadow(api, 'WARNING', 56, RED, 2);
        centerText(api, 'THE BOSS APPROACHES', 76, LGRAY);
      }
      if (bannerT > 0 && (bannerT > 20 || api.frame % 4 < 2)) {
        centerShadow(api, 'STAGE ' + (stageIdx + 1), 50, WHITE);
        centerShadow(api, cfg.name, 64, GOLD, 2);
      }
      if (paused && scene !== 'title' && scene !== 'over') {
        api.rect(86, 76, 68, 26, NAVY);
        api.rect(86, 76, 68, 1, WHITE); api.rect(86, 101, 68, 1, WHITE);
        api.rect(86, 76, 1, 26, WHITE); api.rect(153, 76, 1, 26, WHITE);
        centerShadow(api, 'PAUSED', 84, WHITE, 2);
      }
    },
  };
})();
