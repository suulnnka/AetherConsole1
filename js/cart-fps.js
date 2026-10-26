/*
 * 卡带:PALE CITADEL · 3D 波次射击 FPS(v1.1)
 * 颜色模式 A:20 色;纯 JS 软件 3D:z-buffer 多边形光栅(AABB 盒体建筑)
 *   + 逐行地面投影 + 布告板敌人
 * 美术:白底天空,黄红橙敌人;建筑为"线描轮廓 + 非常浅的蓝抖动填充":
 *   立面按远近分层(近:浅蓝×冰蓝 → 中:冰蓝×雾 → 远:雾×白,Bayer 抖动),
 *   地面同样分层渐远,描边颜色随距离由深墨淡出为钢蓝,构成远景颜色层次
 * 输入(规范键位):上下左右(WASD/方向键)移动 · 鼠标视角(水平+俯仰,
 *   卡带声明 lockPointer,壳请求指针锁定并送入位移增量;锁定与否手感一致,
 *   都是"鼠标动多少视角转多少";未锁定时增量止于窗口边缘,点击锁定解除)·
 *   准星固定屏幕中心,主键(左键/Z)沿视线射击 · 副键(右键/X)跳跃 ·
 *   Start(Enter)暂停
 * 玩法:无限子弹;一张 240×240 城市大图(广场螺旋塔 / 城门楼 / 天桥 /
 *   仓库集装箱 / 老城巷战 / 台地花园 / 竞技场),地面街道与屋顶天桥多层
 *   路线四通八达;消灭全部敌人后仍在该图进入下一波,敌人更多更强;
 *   最佳成绩仅本次会话内存(无存档功能)
 */
const PaleCitadelCart = (function () {
  'use strict';

  const W = 240, H = 180, CX = 120, CY = 90;
  const NEARZ = 0.3;            // 近裁剪
  const STEP = 0.55;            // 自动上台阶高度
  const EYE = 1.62, PR = 0.36, PH = 1.72;   // 眼高 / 玩家半径 / 玩家高
  const GRAV = 14, JUMP_V = 5.6;
  const F = 150;                // 透视焦距(固定视场)
  const SENS = 0.0029;
  const PITCH_MAX = 1.35;

  // —— 调色板索引 ——
  const SKY = 0, HAZE = 1, PAVE = 2, GRID = 3, GRAY = 4, DGRAY = 5,
        INKB = 6, NAVY = 7, STEEL = 8, LBLUE = 9, ICE = 10, YEL = 11,
        AMBER = 12, ORANGE = 13, RORANGE = 14, RED = 15, DRED = 16,
        BLACK = 17, CYAN = 18, GOLD = 19;
  const WHITE = SKY;            // 纯白(特效/HUD)复用天空白

  // 4×4 Bayer 有序抖动矩阵(建筑浅蓝填充与地面远近分层共用)
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // 建筑描边配色(立面统一为浅蓝抖动填充,仅描边随结构变化)
  const SCHEMES = {
    ink: BLACK, navy: INKB, steel: INKB, gray: DGRAY, slate: BLACK,
  };

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const angDiff = (a, b) => {
    let d = (a - b) % 6.2832;
    if (d > 3.1416) d -= 6.2832;
    if (d < -3.1416) d += 6.2832;
    return d;
  };

  /* ============ 地图:240×240 城市,全 AABB 盒体 ============ */

  const boxes = [];

  function B(x, z, w, d, y0, y1, scheme) {
    boxes.push({
      x0: x, z0: z, x1: x + w, z1: z + d, y0, y1,
      ed: SCHEMES[scheme || 'gray'],
      cx: x + w / 2, cz: z + d / 2, rr: Math.sqrt(w * w + d * d) / 2,
    });
  }
  /* 楼梯:dir 0:+x 1:-x 2:+z 3:-z(上升方向);台阶 rise ≤ 0.55 可自动登 */
  function stairs(x, z, w, rise, run, steps, dir, scheme, y0) {
    y0 = y0 || 0;
    for (let i = 0; i < steps; i++) {
      const top = y0 + rise * (i + 1);
      if (dir === 0) B(x + i * run, z, run + 0.05, w, 0, top, scheme);
      else if (dir === 1) B(x - (i + 1) * run, z, run + 0.05, w, 0, top, scheme);
      else if (dir === 2) B(x, z + i * run, w, run + 0.05, 0, top, scheme);
      else B(x, z - (i + 1) * run, w, run + 0.05, 0, top, scheme);
    }
  }
  function bridge(x, z, w, d) {          // 天桥:桥面 + 两侧扶手
    B(x, z, w, d, 7.95, 8.55, 'slate');
    if (w >= d) {
      B(x, z - 0.35, w, 0.35, 8.55, 9.4, 'navy');
      B(x, z + d, w, 0.35, 8.55, 9.4, 'navy');
    } else {
      B(x - 0.35, z, 0.35, d, 8.55, 9.4, 'navy');
      B(x + w, z, 0.35, d, 8.55, 9.4, 'navy');
    }
  }

  function buildMap() {
    // —— 城墙(周界,蓝黑交替分段)——
    for (let i = 0; i < 8; i++) {
      const c = i & 1 ? 'navy' : 'ink';
      B(2 + i * 29.5, 2, 29.5, 3, 0, 11 + (i % 3) * 1.5, c);
      B(2 + i * 29.5, 235, 29.5, 3, 0, 11 + ((i + 1) % 3) * 1.5, c);
      B(2, 2 + i * 29.5, 3, 29.5, 0, 11 + ((i + 2) % 3) * 1.5, c);
      B(235, 2 + i * 29.5, 3, 29.5, 0, 11 + ((i + 3) % 3) * 1.5, c);
    }

    // —— 中央广场:高台 + 四向大台阶 + 柱廊 ——
    B(98, 98, 44, 44, 0, 1.6, 'gray');
    stairs(115, 93.2, 10, 0.4, 1.2, 4, 2, 'gray');       // 北上(升 +z)
    stairs(125, 146.8, 10, 0.4, 1.2, 4, 3, 'gray');       // 南上
    stairs(93.2, 115, 10, 0.4, 1.2, 4, 0, 'gray');        // 西上(升 +x)
    stairs(146.8, 125, 10, 0.4, 1.2, 4, 1, 'gray');       // 东上
    for (let i = 0; i < 8; i++) {                          // 柱廊
      const t = 101 + i * 5.43;
      B(t, 100.2, 1.5, 1.5, 1.6, 5.6, 'navy');
      B(t, 138.3, 1.5, 1.5, 1.6, 5.6, 'navy');
      B(100.2, t, 1.5, 1.5, 1.6, 5.6, 'navy');
      B(138.3, t, 1.5, 1.5, 1.6, 5.6, 'navy');
    }
    B(99.6, 100.2, 40.8, 1.5, 4.9, 5.6, 'navy');           // 檩梁环
    B(99.6, 138.3, 40.8, 1.5, 4.9, 5.6, 'navy');
    B(100.2, 101.7, 1.5, 36.6, 4.9, 5.6, 'navy');
    B(138.3, 101.7, 1.5, 36.6, 4.9, 5.6, 'navy');

    // —— 中央螺旋塔:核心 + 方形螺旋台阶 + 顶部环廊 + 天线 ——
    B(115.5, 115.5, 9, 9, 0, 17, 'navy');
    const M = 1.2, X0 = 115.5 - M, Z0 = 115.5 - M, SIDE = 9 + 2 * M, ST = 2.4;
    for (let k = 0; k < 17; k++) {
      const u = k / 17 * 4, side = Math.min(3, u | 0), f = u - side;
      let x, z;
      if (side === 0) { x = X0 + f * SIDE; z = Z0; }
      else if (side === 1) { x = X0 + SIDE - ST; z = Z0 + f * SIDE; }
      else if (side === 2) { x = X0 + SIDE - ST - f * SIDE; z = Z0 + SIDE - ST; }
      else { x = X0; z = Z0 + SIDE - ST - f * SIDE; }
      B(x, z, ST, ST, 0, 0.5 * (k + 1), 'steel');
    }
    B(111.5, 111.5, 17, 17, 7.95, 8.55, 'steel');          // 塔顶环廊
    B(111.5, 111.5, 17, 0.5, 8.55, 9.45, 'slate');         // 矮护墙
    B(111.5, 128, 17, 0.5, 8.55, 9.45, 'slate');
    B(111.5, 111.5, 0.5, 17, 8.55, 9.45, 'slate');
    B(128, 111.5, 0.5, 17, 8.55, 9.45, 'slate');
    B(119.5, 119.5, 1, 1, 17, 21.5, 'ink');                // 天线

    // —— 北城门:双楼 + 门楣,楼侧楼梯上顶 ——
    B(104, 60, 8, 24, 0, 8.55, 'ink');
    B(128, 60, 8, 24, 0, 8.55, 'ink');
    B(112, 69.7, 16, 2.6, 7.95, 8.55, 'ink');
    stairs(112.15, 84.4, 3, 0.5, 1.15, 17, 3, 'slate');
    stairs(124.85, 84.4, 3, 0.5, 1.15, 17, 3, 'slate');

    // —— 南城门(同构,竞技场侧)+ 塔顶环廊天桥 ——
    B(104, 146, 8, 24, 0, 8.55, 'steel');
    B(128, 146, 8, 24, 0, 8.55, 'steel');
    B(112, 146.7, 16, 2.6, 7.95, 8.55, 'steel');
    stairs(112.15, 169.6, 3, 0.5, 1.15, 17, 2, 'slate');
    stairs(124.85, 169.6, 3, 0.5, 1.15, 17, 2, 'slate');
    bridge(118.7, 128.5, 2.6, 18.2);

    // —— 西:仓库区(W1 屋顶桥接广场塔)——
    B(66, 100, 30, 30, 0, 8.55, 'navy');                    // W1
    stairs(67, 130.05, 3, 0.5, 1.15, 17, 3, 'slate');       // W1 南墙外挂楼梯
    bridge(96, 118.7, 15.5, 2.6);                           // 广场塔→W1 屋顶
    B(20, 16, 34, 28, 0, 7.5, 'steel');                     // W2
    for (let i = 0; i < 14; i++)                            // 阶梯院直上 W2 屋顶
      B(54.8, 16 + i * 2.3, 1.15, 2.2, 0, 0.55 * (i + 1), 'gray');
    B(58, 18, 7, 3, 0, 2.6, 'ink'); B(66, 18, 7, 3, 2.6, 5.2, 'gray');
    B(58, 24, 3, 7, 0, 2.6, 'navy'); B(64, 24, 3, 7, 0, 2.6, 'slate');
    B(74, 22, 7, 3, 0, 2.6, 'gray'); B(74, 30, 7, 3, 0, 2.6, 'ink');
    B(84, 18, 7, 3, 0, 2.6, 'navy'); B(92, 18, 7, 3, 0, 2.6, 'slate');
    B(84, 28, 3, 8, 0, 2.6, 'ink');
    B(58, 52, 1.2, 1.2, 0, 10, 'ink');                      // 龙门吊
    B(96, 52, 1.2, 1.2, 0, 10, 'ink');
    B(58, 51.6, 39.2, 2, 9.4, 10.2, 'ink');
    B(24, 52, 26, 1.4, 3.1, 3.7, 'slate');                  // 管廊(可穿行)
    B(24, 60, 26, 1.4, 3.1, 3.7, 'slate');

    // —— 东:老城街区(9 街区 × 3 栋,留院子和巷)——
    const OTX = [142, 170, 198], OTZ = [18, 46, 74];
    for (let gi = 0; gi < 3; gi++) for (let gj = 0; gj < 3; gj++) {
      const x = OTX[gi], z = OTZ[gj];
      B(x, z, 20, 8, 0, 6 + (gi + gj) % 3, (gi + gj) & 1 ? 'ink' : 'gray');
      B(x, z + 12, 8, 8, 0, 5 + gj % 2, 'slate');
      B(x + 12, z + 12, 8, 8, 0, 6.5 + gj % 2, (gi * 2 + gj) % 3 ? 'gray' : 'navy');
    }
    stairs(152.6, 35.1, 2.6, 0.5, 1.15, 13, 3, 'slate');    // 院子上屋顶 ×2
    stairs(182.6, 63.1, 2.6, 0.5, 1.15, 13, 3, 'slate');

    // —— 东南:竞技场(三层看台 + 中央舞台)——
    B(146, 154, 68, 68, 0, 1.2, 'gray');
    B(154, 162, 52, 52, 0, 2.4, 'slate');
    B(162, 170, 36, 36, 0, 3.6, 'navy');
    B(172, 180, 16, 16, 3.6, 4.7, 'ink');
    stairs(206, 158, 3, 0.4, 1.15, 3, 1, 'slate', 1.2);     // 看台 NE 角两段
    stairs(202, 166, 3, 0.4, 1.15, 3, 1, 'slate', 2.4);
    stairs(196, 184, 3, 0.37, 1.15, 3, 1, 'gray', 3.6);
    stairs(158, 210, 3, 0.4, 1.15, 3, 0, 'slate', 1.2);     // 看台 SW 角两段
    stairs(164, 204, 3, 0.4, 1.15, 3, 0, 'slate', 2.4);
    stairs(170, 194, 3, 0.37, 1.15, 3, 0, 'gray', 3.6);
    stairs(136.05, 155, 3, 0.5, 1.15, 16, 0, 'slate');      // 南门楼→看台长梯

    // —— 西南:台地花园(树篱院 + 双凉亭 + 双层台地)——
    B(20, 150, 30, 1, 0, 1.1, 'slate'); B(20, 150, 1, 26, 0, 1.1, 'slate');
    B(60, 150, 30, 1, 0, 1.1, 'slate'); B(89, 150, 1, 26, 0, 1.1, 'slate');
    B(20, 190, 30, 1, 0, 1.1, 'slate'); B(20, 178, 1, 26, 0, 1.1, 'slate');
    B(60, 190, 30, 1, 0, 1.1, 'slate'); B(89, 178, 1, 26, 0, 1.1, 'slate');
    for (const pt of [[30, 200], [74, 200]]) {              // 凉亭
      B(pt[0], pt[1], 0.9, 0.9, 0, 3.2, 'navy');
      B(pt[0] + 6.1, pt[1], 0.9, 0.9, 0, 3.2, 'navy');
      B(pt[0], pt[1] + 6.1, 0.9, 0.9, 0, 3.2, 'navy');
      B(pt[0] + 6.1, pt[1] + 6.1, 0.9, 0.9, 0, 3.2, 'navy');
      B(pt[0] - 0.5, pt[1] - 0.5, 8, 8, 3.2, 3.8, 'navy');
    }
    B(34, 158, 18, 18, 0, 2.6, 'gray');                     // 台地 T1
    B(38, 162, 10, 10, 2.6, 5.2, 'gray');                   // 台地 T2
    stairs(34, 160, 4, 0.52, 1.15, 5, 0, 'slate');
    stairs(48, 165, 3, 0.52, 1.15, 5, 1, 'slate', 2.6);

    // —— 东桥落点楼(广场塔→老城西缘)——
    B(144, 106, 24, 26, 0, 8.55, 'ink');
    bridge(128.5, 118.7, 15.5, 2.6);

    // —— 大道与广场前掩体 ——
    const CRATES = [
      [104, 104], [136, 104], [104, 136], [136, 136], [117, 88], [123, 88],
      [146, 140], [152, 140], [90, 114], [84, 124], [156, 114], [162, 124],
      [180, 190], [60, 60], [70, 84], [40, 120], [200, 60], [210, 80],
      [46, 210], [80, 214], [170, 110], [150, 96], [30, 40], [196, 166],
    ];
    CRATES.forEach((c, i) => B(c[0], c[1], 1.15, 1.15, 0, 1.15, i & 1 ? 'ink' : 'gray'));
    const BARS = [
      [113.5, 52, 2], [113.5, 178, 2], [126.5, 52, 2], [126.5, 178, 2],
      [52, 113.5, 0], [52, 126.5, 0], [178, 113.5, 0], [178, 126.5, 0],
    ];
    for (const bar of BARS)
      bar[2] === 2 ? B(bar[0], bar[1], 1.15, 2.4, 0, 1.15, 'slate')
                   : B(bar[0], bar[1], 2.4, 1.15, 0, 1.15, 'slate');
  }

  // 出生点(尽量分散在城区边缘)
  const SPAWNS = [
    [180, 188], [72, 200], [30, 164], [180, 56], [156, 80], [216, 28],
    [76, 36], [30, 80], [120, 40], [120, 200], [40, 120], [200, 120],
    [190, 210], [24, 226],
  ];

  /* ============ 寻路:2m 网格地面高度 + BFS 流场 ============ */

  const GRES = 2, GN = 120;                     // 240/2
  const floorG = new Float32Array(GN * GN);     // 每格可行走面高
  const flow = new Int16Array(GN * GN);         // BFS 距离(-1 未访问)
  const flowQ = new Int32Array(GN * GN);

  function buildNav() {
    for (const b of boxes) {
      if (b.y1 > 4.2) continue;                 // 高处建筑不作为地面层
      const cx0 = Math.max(0, b.x0 / GRES | 0), cx1 = Math.min(GN - 1, b.x1 / GRES | 0);
      const cz0 = Math.max(0, b.z0 / GRES | 0), cz1 = Math.min(GN - 1, b.z1 / GRES | 0);
      for (let gz = cz0; gz <= cz1; gz++)
        for (let gx = cx0; gx <= cx1; gx++) {
          const i = gz * GN + gx;
          if (b.y1 > floorG[i]) floorG[i] = b.y1;
        }
    }
  }
  function cellFloor(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= GN || gz >= GN) return 99;
    return floorG[gz * GN + gx];
  }
  function cellFlow(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= GN || gz >= GN) return -1;
    return flow[gz * GN + gx];
  }
  function rebuildFlow(px, pz) {
    flow.fill(-1);
    const sx = clamp(px / GRES | 0, 0, GN - 1), sz = clamp(pz / GRES | 0, 0, GN - 1);
    let head = 0, tail = 0;
    flow[sz * GN + sx] = 0; flowQ[tail++] = sz * GN + sx;
    while (head < tail) {
      const i = flowQ[head++], gx = i % GN, gz = i / GN | 0, d = flow[i], f0 = floorG[i];
      if (d > 250) continue;
      for (let k = 0; k < 4; k++) {
        const nx = gx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const nz = gz + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= GN || nz >= GN) continue;
        const j = nz * GN + nx;
        if (flow[j] >= 0) continue;
        if (Math.abs(floorG[j] - f0) > 0.56) continue;   // 台阶外的落差不通
        flow[j] = d + 1; flowQ[tail++] = j;
      }
    }
  }
  /* 顺流而下:返回朝下一格的方向(轴向单位向量),无路返回 null */
  function flowDir(x, z) {
    const gx = clamp(x / GRES | 0, 0, GN - 1), gz = clamp(z / GRES | 0, 0, GN - 1);
    const d0 = flow[gz * GN + gx];
    if (d0 < 0) return null;
    let bx = 0, bz = 0, best = d0;
    for (let k = 0; k < 4; k++) {
      const nx = gx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const nz = gz + (k === 2 ? 1 : k === 3 ? -1 : 0);
      const d = cellFlow(nx, nz);
      if (d >= 0 && d < best && Math.abs(cellFloor(nx, nz) - floorG[gz * GN + gx]) <= 0.56) {
        best = d; bx = nx - gx; bz = nz - gz;
      }
    }
    if (!bx && !bz) return null;
    return [bx, bz];
  }

  /* ============ 碰撞与地面 ============ */

  function groundY(x, z, fromY) {
    let g = 0;
    const lim = fromY + STEP;
    for (const b of boxes) {
      if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.y1 <= lim && b.y1 > g) g = b.y1;
    }
    return g;
  }
  /* 轴分离移动 + 自动上台阶;e:{x,z,y(脚),r,h,vy} */
  function moveXZ(e, dx, dz) {
    if (dx) {
      e.x += dx;
      for (const b of boxes) {
        if (e.x + e.r > b.x0 && e.x - e.r < b.x1 && e.z + e.r > b.z0 && e.z - e.r < b.z1 &&
            b.y1 > e.y + 0.001 && b.y0 < e.y + e.h) {
          if (b.y1 <= e.y + STEP && e.vy <= 0.1) e.y = b.y1;      // 踩上去
          else e.x = dx > 0 ? b.x0 - e.r : b.x1 + e.r;
        }
      }
    }
    if (dz) {
      e.z += dz;
      for (const b of boxes) {
        if (e.x + e.r > b.x0 && e.x - e.r < b.x1 && e.z + e.r > b.z0 && e.z - e.r < b.z1 &&
            b.y1 > e.y + 0.001 && b.y0 < e.y + e.h) {
          if (b.y1 <= e.y + STEP && e.vy <= 0.1) e.y = b.y1;
          else e.z = dz > 0 ? b.z0 - e.r : b.z1 + e.r;
        }
      }
    }
  }
  /* 射线 vs 盒,返回 t(>0)或 -1 */
  function rayBox(ox, oy, oz, dx, dy, dz, b, tMax) {
    let t0 = 0, t1 = tMax;
    for (let a = 0; a < 3; a++) {
      const o = a === 0 ? ox : a === 1 ? oy : oz;
      const d = a === 0 ? dx : a === 1 ? dy : dz;
      const lo = a === 0 ? b.x0 : a === 1 ? b.y0 : b.z0;
      const hi = a === 0 ? b.x1 : a === 1 ? b.y1 : b.z1;
      if (d > -1e-9 && d < 1e-9) { if (o < lo || o > hi) return -1; }
      else {
        let ta = (lo - o) / d, tb = (hi - o) / d;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return -1;
      }
    }
    return t0 > 0.001 ? t0 : -1;
  }
  function rayWorld(ox, oy, oz, dx, dy, dz, tMax) {
    let best = tMax;
    for (const b of boxes) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, b, best);
      if (t > 0 && t < best) best = t;
    }
    return best;
  }
  function losClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.01) return true;
    return rayWorld(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05) >= len - 0.06;
  }
  function pointInBox(x, y, z) {
    for (const b of boxes)
      if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return true;
    return false;
  }

  /* ============ 渲染:软件 3D ============ */

  const zbuf = new Float32Array(W * H);
  let A = null;                                  // 内核 api(init 捕获)
  let camX = 0, camY = 0, camZ = 0;
  let fwdX = 0, fwdY = 0, fwdZ = 1, rgtX = 1, rgtY = 0, rgtZ = 0,
      upX = 0, upY = 1, upZ = 0;

  function setCam(x, y, z, yaw, pitch) {
    camX = x; camY = y; camZ = z;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    fwdX = sy * cp; fwdY = sp; fwdZ = cy * cp;
    rgtX = cy; rgtY = 0; rgtZ = -sy;
    upX = fwdY * rgtZ - fwdZ * rgtY;
    upY = fwdZ * rgtX - fwdX * rgtZ;
    upZ = fwdX * rgtY - fwdY * rgtX;
  }
  function toCam(x, y, z, out) {
    const rx = x - camX, ry = y - camY, rz = z - camZ;
    out[0] = rx * rgtX + ry * rgtY + rz * rgtZ;
    out[1] = rx * upX + ry * upY + rz * upZ;
    out[2] = rx * fwdX + ry * fwdY + rz * fwdZ;
  }

  function drawSky() {
    // 太阳(方位固定,随视角平移)+ 淡云带(白底世界的高度参照)
    const yaw = Math.atan2(fwdX, fwdZ);
    const sd = angDiff(0.8, yaw);
    if (Math.abs(sd) < 1.15) {
      const sx = CX + Math.tan(sd) * F;
      const sy = 30 - fwdY * 46;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        const r2 = dx * dx + dy * dy;
        if (r2 <= 30) A.px(sx + dx, sy + dy, r2 <= 14 ? ICE : HAZE);
      }
    }
    for (let i = 0; i < 22; i++) {
      const az = i * 0.53 + 0.31, el = 0.16 + (i * 0.371 % 1) * 0.5;
      const d = angDiff(az, yaw);
      if (Math.abs(d) > 1.2) continue;
      const sx = CX + Math.tan(d) * F, sy = CY - F * el - fwdY * 46;
      A.rect(sx, sy, 3, 1, i % 3 ? HAZE : ICE);
      A.px(sx + 1, sy - 1, HAZE);
    }
  }

  function drawFloor() {
    for (let y = 0; y < H; y++) {
      const v = (CY - y) / F;
      const dirY = fwdY + v * upY;
      if (dirY >= -1e-6) continue;               // 天空行(zbuf 保持无穷远)
      const t = camY / -dirY;
      const row = y * W;
      if (t > 132) {                             // 远地面:整体雾白
        A.rect(0, y, W, 1, SKY);
        zbuf.fill(t, row, row + W);
        continue;
      }
      const ax = camX + t * (fwdX + v * upX);
      const az = camZ + t * (fwdZ + v * upZ);
      const dx = t / F * rgtX, dz = t / F * rgtZ;
      let wx = ax - dx * CX, wz = az - dz * CX;
      const band = t < 55 ? 0 : t < 95 ? 1 : 2;  // 远近分层
      const k1 = band === 1 ? 0.75 - (t - 55) * 0.01 : 0.6 - (t - 95) * 0.011;
      const by = (y & 3) * 4;
      for (let x = 0; x < W; x++, wx += dx, wz += dz) {
        let ci;
        if (band === 0) {                        // 近:路面 + 街缝/棋盘
          const gx = wx % 8, gz = wz % 8;
          if (gx < 0.22 || gx > 7.78 || gz < 0.22 || gz > 7.78) ci = GRID;
          else if (Math.abs(wx - 120) < 7 || Math.abs(wz - 120) < 7) ci = HAZE;
          else if (Math.abs(wx - 120) < 22 && Math.abs(wz - 120) < 22 &&
                   (((wx / 4 | 0) + (wz / 4 | 0)) & 1)) ci = GRID;
          else ci = PAVE;
        } else {                                 // 中/远:两色抖动渐白
          const th = (BAYER[by + (x & 3)] + 0.5) * 0.0625;
          if (band === 1) ci = th < k1 ? PAVE : HAZE;
          else ci = th < k1 ? HAZE : SKY;
        }
        A.px(x, y, ci);
        zbuf[row + x] = t;
      }
    }
  }

  // —— 多边形(墙面)光栅 ——
  const cA = [0, 0, 0], cB = [0, 0, 0], cC = [0, 0, 0], cD = [0, 0, 0];
  const poly = [];
  const pvx = new Float32Array(10), pvy = new Float32Array(10), pvz = new Float32Array(10);

  /* 建筑面像素色:Bayer 抖动的非常浅蓝,按深度分三层,远层渐白;
     mode 0 立面 1 顶面 2 底面(顶面受光更亮,底面投影更深) */
  function faceCi(x, y, dep, mode) {
    const th = (BAYER[((y & 3) << 2) + (x & 3)] + 0.5) * 0.0625;
    let a, b, k;
    if (dep < 60) {
      if (mode === 1) { a = ICE; b = HAZE; k = 0.6; }
      else if (mode === 2) { a = STEEL; b = LBLUE; k = 0.45; }
      else { a = LBLUE; b = ICE; k = 0.62; }
    } else if (dep < 95) {
      if (mode === 1) { a = HAZE; b = SKY; k = 0.55; }
      else if (mode === 2) { a = LBLUE; b = ICE; k = 0.5; }
      else { a = ICE; b = HAZE; k = 0.55; }
    } else {
      if (mode === 1) { a = HAZE; b = SKY; k = 0.3; }
      else if (mode === 2) { a = ICE; b = HAZE; k = 0.5; }
      else { a = HAZE; b = SKY; k = 0.5; }
    }
    return th < k ? a : b;
  }

  function face(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, mode, ec) {
    toCam(x0, y0, z0, cA); toCam(x1, y1, z1, cB);
    toCam(x2, y2, z2, cC); toCam(x3, y3, z3, cD);
    if (cA[2] < NEARZ && cB[2] < NEARZ && cC[2] < NEARZ && cD[2] < NEARZ) return;
    if (cA[2] > 175 && cB[2] > 175 && cC[2] > 175 && cD[2] > 175) return;
    // Sutherland–Hodgman 对 Zc ≥ NEARZ 裁剪
    poly.length = 0;
    const src = [cA, cB, cC, cD];
    for (let i = 0; i < 4; i++) {
      const p = src[i], q = src[(i + 1) & 3];
      const pin = p[2] >= NEARZ, qin = q[2] >= NEARZ;
      if (pin) poly.push(p[0], p[1], p[2]);
      if (pin !== qin) {
        const k = (NEARZ - p[2]) / (q[2] - p[2]);
        poly.push(p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, NEARZ);
      }
    }
    const n = poly.length / 3;
    if (n < 3) return;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, minZ = 1e9;
    for (let i = 0; i < n; i++) {
      const Xc = poly[i * 3], Yc = poly[i * 3 + 1], Zc = poly[i * 3 + 2];
      pvx[i] = CX + F * Xc / Zc;
      pvy[i] = CY - F * Yc / Zc;
      pvz[i] = 1 / Zc;
      if (pvx[i] < minX) minX = pvx[i];
      if (pvx[i] > maxX) maxX = pvx[i];
      if (pvy[i] < minY) minY = pvy[i];
      if (pvy[i] > maxY) maxY = pvy[i];
      if (Zc < minZ) minZ = Zc;
    }
    if (maxX < 0 || minX > W - 1 || maxY < 0 || minY > H - 1) return;
    for (let t = 1; t < n - 1; t++)
      fillTri(pvx[0], pvy[0], pvz[0], pvx[t], pvy[t], pvz[t],
              pvx[t + 1], pvy[t + 1], pvz[t + 1], mode);
    if (ec >= 0 && minZ < 125) {                 // 线描轮廓(随距离淡出)
      const ec2 = minZ < 55 ? ec : minZ < 95 ? NAVY : STEEL;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        zlineScr(pvx[i], pvy[i], pvz[i], pvx[j], pvy[j], pvz[j], ec2);
      }
    }
  }

  function fillTri(x0, y0, z0, x1, y1, z1, x2, y2, z2, mode) {
    const ax = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const bx = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const ay = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const by = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (ax > bx || ay > by) return;
    const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(d) < 1e-7) return;
    const ia = 1 / d;
    for (let y = ay; y <= by; y++) {
      const row = y * W;
      for (let x = ax; x <= bx; x++) {
        const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) * ia;
        if (w0 < 0) continue;
        const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) * ia;
        if (w1 < 0) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < 0) continue;
        const dep = 1 / (w0 * z0 + w1 * z1 + w2 * z2);
        const i = row + x;
        if (dep < zbuf[i]) {
          zbuf[i] = dep;
          A.px(x, y, faceCi(x, y, dep, mode));
        }
      }
    }
  }

  /* 屏幕线段:深度 = 1/lerp(1/z),带 z 测试(墙面描边 / 曳光共用) */
  function zlineScr(x0, y0, iz0, x1, y1, iz1, ci) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    if (steps === 0 || steps > 300) return;
    const sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    let err = dx + dy, x = x0, y = y0;
    for (let s = 0; s <= steps; s++) {
      const dep = 1 / (iz0 + (iz1 - iz0) * (s / steps));
      if (x >= 0 && x < W && y >= 0 && y < H) {
        const i = y * W + x;
        if (dep < zbuf[i]) { zbuf[i] = dep; A.px(x, y, ci); }
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  function drawBoxes() {
    const FAR = 165;
    for (const b of boxes) {
      const ddx = b.cx - camX, ddz = b.cz - camZ;
      const rr = FAR + b.rr;
      if (ddx * ddx + ddz * ddz > rr * rr) continue;
      if (ddx * fwdX + ddz * fwdZ < -b.rr - 3) continue;
      if (camY > b.y1)
        face(b.x0, b.y1, b.z0, b.x1, b.y1, b.z0, b.x1, b.y1, b.z1, b.x0, b.y1, b.z1, 1, b.ed);
      else if (camY < b.y0)
        face(b.x0, b.y0, b.z0, b.x1, b.y0, b.z0, b.x1, b.y0, b.z1, b.x0, b.y0, b.z1, 2, -1);
      if (camX > b.x1)
        face(b.x1, b.y0, b.z0, b.x1, b.y1, b.z0, b.x1, b.y1, b.z1, b.x1, b.y0, b.z1, 0, b.ed);
      else if (camX < b.x0)
        face(b.x0, b.y0, b.z0, b.x0, b.y1, b.z0, b.x0, b.y1, b.z1, b.x0, b.y0, b.z1, 0, b.ed);
      if (camZ > b.z1)
        face(b.x0, b.y0, b.z1, b.x1, b.y0, b.z1, b.x1, b.y1, b.z1, b.x0, b.y1, b.z1, 0, b.ed);
      else if (camZ < b.z0)
        face(b.x0, b.y0, b.z0, b.x1, b.y0, b.z0, b.x1, b.y1, b.z0, b.x0, b.y1, b.z0, 0, b.ed);
    }
  }

  // —— z 测试图元(精灵用)——
  function zrect(sx, sy, w, h, ci, dep) {
    const x0 = Math.max(0, sx | 0), y0 = Math.max(0, sy | 0);
    const x1 = Math.min(W, Math.ceil(sx + w)), y1 = Math.min(H, Math.ceil(sy + h));
    for (let y = y0; y < y1; y++) {
      const row = y * W;
      for (let x = x0; x < x1; x++) {
        const i = row + x;
        if (dep < zbuf[i]) { zbuf[i] = dep; A.px(x, y, ci); }
      }
    }
  }
  function zpx(sx, sy, ci, dep) {
    const x = sx | 0, y = sy | 0;
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = y * W + x;
    if (dep < zbuf[i]) { zbuf[i] = dep; A.px(x, y, ci); }
  }
  const _s = [0, 0, 0], _c = [0, 0, 0];
  /* 世界线段(曳光):两端近裁剪后走屏幕深度线 */
  function zseg(ax, ay, az, bx, by, bz, ci) {
    toCam(ax, ay, az, cA); toCam(bx, by, bz, cB);
    let p = cA, q = cB;
    if (p[2] < NEARZ && q[2] < NEARZ) return;
    if (p[2] < NEARZ) {
      const t = (NEARZ - p[2]) / (q[2] - p[2]);
      p = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, NEARZ];
    } else if (q[2] < NEARZ) {
      const t = (NEARZ - q[2]) / (p[2] - q[2]);
      q = [q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t, NEARZ];
    }
    zlineScr(CX + F * p[0] / p[2], CY - F * p[1] / p[2], 1 / p[2],
             CX + F * q[0] / q[2], CY - F * q[1] / q[2], 1 / q[2], ci);
  }

  /* ============ 敌人 ============ */

  const ETYPES = {
    stalker: { hp: 34,  sp: 4.6, dmg: 10, r: 0.38, h: 1.7, w: 0.62, score: 100,
               main: AMBER, alt: YEL,   eye: YEL },
    wasp:    { hp: 26,  sp: 4.2, dmg: 6,  r: 0.34, h: 1.0, w: 0.9,  score: 150,
               main: YEL,   alt: GOLD,   eye: WHITE },
    sentry:  { hp: 58,  sp: 3.4, dmg: 9,  r: 0.40, h: 1.8, w: 0.80, score: 200,
               main: ORANGE, alt: RORANGE, eye: RED },
    brute:   { hp: 260, sp: 2.1, dmg: 24, r: 0.62, h: 2.5, w: 1.5,  score: 500,
               main: RED,   alt: DRED,   eye: YEL },
  };

  function makeEnemy(type, x, z, hpMul, dmgMul) {
    const t = ETYPES[type];
    return {
      t: type, x, z, y: 0, vy: 0, r: t.r, h: t.h, w: t.w,
      hp: t.hp * hpMul, maxHp: t.hp * hpMul, dmg: t.dmg * dmgMul,
      animT: (Math.random() * 60) | 0, seed: Math.random() * 6.28,
      atkCd: 30 + (Math.random() * 40 | 0), los: false, losT: (Math.random() * 8) | 0,
      flash: 0, dieT: 0, alive: true,
    };
  }

  /* ============ 全局状态 ============ */

  let scene = 'title', paused = false, lockPause = false, hadLock = false;
  let mouseLocked = false;                        // 本帧指针是否锁定(提示用)
  let player, enemies, eballs, parts, tracers;
  let wave, quota, spawned, spawnT, interT, clearPending;
  let score, kills, best = null;                 // 最佳成绩仅本次会话
  let recoil = 0, muzzleT = 0, spread = 0, pitchKick = 0;
  let fireCd = 0, bobT = 0, bobPh = 0, coyote = 0, jumpBuf = 0;
  let dmgT = 0, hitM = 0, hitKill = false, bannerT = 0, bannerSub = '';
  let lastHitT = 0, overT = 0, flowT = 0;

  function resetRun() {
    player = {
      x: 120, y: 1.6, z: 136, vx: 0, vy: 0, vz: 0, r: PR, h: PH,
      yaw: 3.1416, pitch: 0, hp: 100, maxHp: 100, grounded: true, turnVel: 0,
    };
    enemies = []; eballs = []; parts = []; tracers = [];
    wave = 0; score = 0; kills = 0;
    clearPending = false; interT = 0;
    recoil = 0; muzzleT = 0; spread = 0; fireCd = 0; pitchKick = 0;
    dmgT = 0; hitM = 0; bannerT = 0; lastHitT = 999; overT = 0;
    coyote = 0; jumpBuf = 0;
    paused = false; lockPause = false; hadLock = false;
    nextWave();
    scene = 'play';
  }

  function nextWave() {
    wave++;
    quota = Math.min(64, 4 + wave * 4);
    spawned = 0; spawnT = 40;
    bannerT = 140; bannerSub = 'HOSTILES ' + quota;
    rebuildFlow(player.x, player.z); flowT = 0;
  }

  function pickType(w) {
    const r = Math.random();
    if (w <= 1) return 'stalker';
    if (w === 2) return r < 0.6 ? 'stalker' : 'wasp';
    if (w <= 4) return r < 0.4 ? 'stalker' : r < 0.65 ? 'wasp' : 'sentry';
    if (w <= 7) return r < 0.3 ? 'stalker' : r < 0.55 ? 'wasp' : r < 0.85 ? 'sentry' : 'brute';
    return r < 0.24 ? 'stalker' : r < 0.48 ? 'wasp' : r < 0.78 ? 'sentry' : 'brute';
  }

  function spawnEnemy() {
    let pt = null;                                // 距玩家 35..115 的出生点优先
    for (let tries = 0; tries < 8; tries++) {
      const s = SPAWNS[(Math.random() * SPAWNS.length) | 0];
      const d = Math.hypot(s[0] - player.x, s[1] - player.z);
      if (d > 35 && d < 115) { pt = s; break; }
      if (!pt) pt = s;
    }
    const hpMul = Math.min(3.2, 1 + 0.08 * (wave - 1));
    const dmgMul = Math.min(2.4, 1 + 0.05 * (wave - 1));
    const e = makeEnemy(pickType(wave), pt[0] + rnd(-2, 2), pt[1] + rnd(-2, 2), hpMul, dmgMul);
    e.y = groundY(e.x, e.z, 4);
    enemies.push(e);
    for (let i = 0; i < 6; i++)                  // 出生光柱
      parts.push({ x: e.x + rnd(-0.4, 0.4), y: e.y + i * 0.5, z: e.z + rnd(-0.4, 0.4),
                   vx: 0, vy: 2.4, vz: 0, life: 14, ci: YEL });
  }

  function hurtPlayer(dmg) {
    if (scene !== 'play' || player.hp <= 0) return;
    player.hp -= dmg;
    dmgT = 22; lastHitT = 0;
    A.shake(2.4);
    if (player.hp <= 0) {
      player.hp = 0;
      if (!best || wave > best.w || (wave === best.w && score > best.s))
        best = { w: wave, s: score };
      overT = 70;
      for (let i = 0; i < 30; i++)
        parts.push({ x: player.x, y: player.y + 1, z: player.z,
                     vx: rnd(-3, 3), vy: rnd(0, 4), vz: rnd(-3, 3),
                     life: rnd(20, 44) | 0, ci: [RED, ORANGE, WHITE][i % 3] });
    }
  }

  function fireGun() {
    fireCd = 7;
    recoil = Math.min(7, recoil + 2.6);
    muzzleT = 4;
    spread = Math.min(0.05, spread + 0.007);
    pitchKick = 0.012;
    A.shake(0.5);
    // 准星即屏幕中心:沿视线散射
    const yaw = player.yaw + rnd(-spread, spread);
    const pitch = clamp(player.pitch + rnd(-spread, spread) * 0.7, -PITCH_MAX, PITCH_MAX);
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
    const ox = player.x, oy = player.y + EYE, oz = player.z;
    const wallT = rayWorld(ox, oy, oz, dx, dy, dz, 200);
    let hitE = null, hitT = wallT, head = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      const bb = { x0: e.x - e.r, x1: e.x + e.r, y0: e.y, y1: e.y + e.h,
                   z0: e.z - e.r, z1: e.z + e.r };
      const t = rayBox(ox, oy, oz, dx, dy, dz, bb, hitT);
      if (t > 0 && t < hitT) {
        hitT = t; hitE = e;
        head = (oy + dy * t) > e.y + e.h * 0.76;           // 上部 1/4 判爆头
      }
    }
    const hx = ox + dx * hitT, hy = oy + dy * hitT, hz = oz + dz * hitT;
    tracers.push({ x0: ox + Math.sin(player.yaw) * 0.4, y0: oy - 0.16,
                   z0: oz + Math.cos(player.yaw) * 0.4, x1: hx, y1: hy, z1: hz, life: 3 });
    if (hitE) {
      hitE.hp -= head ? 16 : 9;
      hitE.flash = 3;
      hitM = 7; hitKill = false;
      for (let i = 0; i < 4; i++)
        parts.push({ x: hx, y: hy, z: hz, vx: rnd(-2, 2), vy: rnd(0, 3), vz: rnd(-2, 2),
                     life: rnd(6, 14) | 0, ci: i & 1 ? ETYPES[hitE.t].main : YEL });
      if (hitE.hp <= 0 && hitE.alive) {
        hitE.alive = false; hitE.dieT = 12;
        hitM = 12; hitKill = true;
        kills++;
        score += Math.round(ETYPES[hitE.t].score * (1 + 0.06 * (wave - 1)));
        const big = hitE.t === 'brute';
        for (let i = 0; i < (big ? 26 : 14); i++)
          parts.push({ x: hitE.x, y: hitE.y + hitE.h / 2, z: hitE.z,
                       vx: rnd(-4, 4), vy: rnd(1, 6), vz: rnd(-4, 4),
                       life: rnd(14, 30) | 0,
                       ci: [ETYPES[hitE.t].main, ETYPES[hitE.t].alt, YEL, WHITE][i % 4] });
        if (big) A.shake(3);
      }
    } else {
      for (let i = 0; i < 3; i++)                // 命中墙面火花
        parts.push({ x: hx - dx * 0.1, y: hy - dy * 0.1, z: hz - dz * 0.1,
                     vx: rnd(-1.5, 1.5), vy: rnd(0, 2), vz: rnd(-1.5, 1.5),
                     life: rnd(5, 10) | 0, ci: i & 1 ? WHITE : GRAY });
    }
  }

  /* ============ 更新 ============ */

  function updatePlay(api) {
    const jp = api.justPressed, pr = api.pressed;
    const cur = api.cursor();

    // —— 指针锁定:丢失即暂停,重获即恢复 ——
    if (cur.lock && !hadLock) hadLock = true;
    if (hadLock && !cur.lock) lockPause = true;
    if (lockPause && cur.lock) lockPause = false;
    mouseLocked = cur.lock;
    if (jp('start')) paused = !paused;
    if (paused || lockPause) return;

    if (player.hp <= 0) {                        // 阵亡过场
      overT--;
      updateFx();
      if (overT <= 0) scene = 'over';
      return;
    }

    // —— 视角:始终按鼠标位移增量转动(锁定与否手感一致);
    //    未锁定时增量来自光标在画布内的移动,到窗口边缘即止(点击锁定解除) ——
    let turned = 0;
    if (cur.rdx || cur.rdy) {
      player.yaw += cur.rdx * SENS;
      player.pitch = clamp(player.pitch - cur.rdy * SENS, -PITCH_MAX, PITCH_MAX);
      turned = cur.rdx;
    }
    if (pitchKick) {                             // 开火上抬
      player.pitch = clamp(player.pitch + pitchKick, -PITCH_MAX, PITCH_MAX);
      pitchKick *= 0.5;
      if (pitchKick < 0.001) pitchKick = 0;
    }
    player.turnVel += (turned - player.turnVel) * 0.3;

    // —— 移动:副键跳跃(带缓冲与土狼时间),自动上台阶 ——
    const fx0 = Math.sin(player.yaw), fz0 = Math.cos(player.yaw);
    let mx = 0, mz = 0;
    if (pr('up')) { mx += fx0; mz += fz0; }
    if (pr('down')) { mx -= fx0; mz -= fz0; }
    if (pr('left')) { mx += fz0; mz -= fx0; }
    if (pr('right')) { mx -= fz0; mz += fx0; }
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx = mx / ml * 5.6; mz = mz / ml * 5.6; }
    const acc = player.grounded ? 0.22 : 0.05;
    player.vx += (mx - player.vx) * acc;
    player.vz += (mz - player.vz) * acc;
    if (ml > 0 && player.grounded) bobT += 0.22;

    if (jp('b')) jumpBuf = 7;
    if (jumpBuf > 0) jumpBuf--;
    if (player.grounded) coyote = 7; else if (coyote > 0) coyote--;
    if (jumpBuf > 0 && coyote > 0) {
      player.vy = JUMP_V; player.grounded = false; coyote = 0; jumpBuf = 0;
    }

    player.vy -= GRAV / 60;
    if (player.vy < -22) player.vy = -22;
    const wasGrounded = player.grounded, fallV = player.vy;
    moveXZ(player, player.vx / 60, 0);
    moveXZ(player, 0, player.vz / 60);
    player.y += player.vy / 60;
    if (player.vy > 0)                           // 天花板
      for (const b of boxes) {
        if (player.x + PR > b.x0 && player.x - PR < b.x1 && player.z + PR > b.z0 &&
            player.z - PR < b.z1 && b.y0 > player.y + 0.1 && b.y0 < player.y + PH) {
          player.y = b.y0 - PH; player.vy = 0;
        }
      }
    const sup = groundY(player.x, player.z, player.y);
    player.grounded = false;
    if (player.vy <= 0 && player.y <= sup + 0.001) {
      player.y = sup; player.vy = 0; player.grounded = true;
      if (!wasGrounded && fallV < -7) bobPh = 4;  // 落地下沉
    } else if (wasGrounded && player.y - sup <= STEP && player.vy <= 0) {
      player.y = sup; player.grounded = true;     // 下台阶吸附
    }
    player.x = clamp(player.x, 4, 236); player.z = clamp(player.z, 4, 236);

    // —— 武器:无限弹药全自动 ——
    if (fireCd > 0) fireCd--;
    if (pr('a') && fireCd <= 0) fireGun();
    recoil *= 0.82;
    if (muzzleT > 0) muzzleT--;
    spread = Math.max(0.011, spread * 0.94);
    if (ml > 0 && player.grounded) spread = Math.min(0.05, spread + 0.0004);

    // —— 波次 ——
    if (clearPending) {
      interT--;
      if (interT <= 0) { clearPending = false; nextWave(); }
    } else {
      const alive = enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
      if (spawned < quota && alive < Math.min(16, 5 + wave)) {
        if (--spawnT <= 0) {
          spawnT = Math.max(16, 46 - wave * 2);
          spawnEnemy(); spawned++;
        }
      } else if (spawned >= quota && alive === 0) {
        clearPending = true; interT = 190;
        player.hp = Math.min(player.maxHp, player.hp + 30);
        score += wave * 100;
        bannerT = 130; bannerSub = 'AREA SECURED  +' + wave * 100;
        if (!best || wave > best.w) best = { w: wave, s: score };
      }
    }

    if (++flowT >= 22) { flowT = 0; rebuildFlow(player.x, player.z); }
    updateEnemies();
    updateFx();

    lastHitT++;
    if (lastHitT > 240 && player.hp > 0 && player.hp < player.maxHp)
      player.hp = Math.min(player.maxHp, player.hp + 0.22);
    if (dmgT > 0) dmgT--;
    if (hitM > 0) hitM--;
    if (bannerT > 0) bannerT--;
    if (bobPh > 0) bobPh--;
  }

  function updateEnemies() {
    const px = player.x, py = player.y, pz = player.z;
    for (let i = 0; i < enemies.length; i++) {    // 分离(局部)
      const a = enemies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz, rr = a.r + b.r + 0.25;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (rr - d) * 0.5 / d;
          a.x -= dx * push; a.z -= dz * push;
          b.x += dx * push; b.z += dz * push;
        }
      }
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.animT++;
      if (e.flash > 0) e.flash--;
      if (!e.alive) { if (--e.dieT <= 0) enemies.splice(i, 1); continue; }
      const t = ETYPES[e.t];
      const dx = px - e.x, dz = pz - e.z;
      const dist = Math.hypot(dx, dz);
      if (--e.losT <= 0) {                        // 视线(分帧摊薄)
        e.losT = 8;
        e.los = dist < 48 && losClear(e.x, e.y + e.h * 0.8, e.z,
                                      px, py + EYE - 0.2, pz);
      }
      let vx = 0, vz = 0;
      const ndx = dist > 0.01 ? dx / dist : 0, ndz = dist > 0.01 ? dz / dist : 0;
      if (e.t === 'stalker') {
        if (e.los && dist < 40) { vx = ndx * t.sp; vz = ndz * t.sp; }
        else { const f = flowDir(e.x, e.z); if (f) { vx = f[0] * t.sp; vz = f[1] * t.sp; } }
        if (dist < e.r + PR + 0.5 && Math.abs(e.y - py) < 2.4 && --e.atkCd <= 0) {
          e.atkCd = 48; hurtPlayer(e.dmg);
        }
      } else if (e.t === 'sentry') {
        if (e.los && dist < 30) {
          const want = dist > 17 ? 1 : dist < 10 ? -0.8 : 0;
          const strafe = Math.sin(e.animT * 0.02 + e.seed);
          vx = (ndx * want - ndz * strafe * 0.7) * t.sp;
          vz = (ndz * want + ndx * strafe * 0.7) * t.sp;
          if (--e.atkCd <= 0) {
            e.atkCd = 86 + (Math.random() * 30 | 0);
            const ex = e.x, ey = e.y + e.h * 0.8, ez = e.z;
            const ddx = px + player.vx * 0.18 - ex, ddy = py + EYE - 0.3 - ey,
                  ddz = pz + player.vz * 0.18 - ez;
            const L = Math.hypot(ddx, ddy, ddz) || 1;
            eballs.push({ x: ex, y: ey, z: ez, vx: ddx / L * 15, vy: ddy / L * 15,
                          vz: ddz / L * 15, dmg: e.dmg, r: 0.16, ci: ORANGE, life: 200 });
          }
        } else { const f = flowDir(e.x, e.z); if (f) { vx = f[0] * t.sp; vz = f[1] * t.sp; } }
      } else if (e.t === 'wasp') {
        // 飞行:有视线→环绕玩家;无→顺流场低飞
        const targetY = e.los ? py + 2.5 : groundY(e.x, e.z, e.y + 1) + 2.3;
        e.y += clamp(targetY - e.y, -0.1, 0.1);
        if (e.los && dist < 34) {
          const orb = Math.sin(e.animT * 0.013 + e.seed) * 0.9;
          vx = (ndx + ndz * orb) * t.sp; vz = (ndz - ndx * orb) * t.sp;
          if (dist < 6) { vx -= ndx * t.sp * 0.9; vz -= ndz * t.sp * 0.9; }
          if (--e.atkCd <= 0) {
            e.atkCd = 64 + (Math.random() * 24 | 0);
            const ex = e.x, ey = e.y + e.h * 0.5, ez = e.z;
            const ddx = px - ex, ddy = py + EYE - 0.4 - ey, ddz = pz - ez;
            const L = Math.hypot(ddx, ddy, ddz) || 1;
            eballs.push({ x: ex, y: ey, z: ez, vx: ddx / L * 13, vy: ddy / L * 13,
                          vz: ddz / L * 13, dmg: e.dmg, r: 0.12, ci: YEL, life: 200 });
          }
        } else {
          const f = flowDir(e.x, e.z);
          if (f) { vx = f[0] * t.sp; vz = f[1] * t.sp; }
        }
      } else {                                    // brute
        if (e.los && dist < 40) { vx = ndx * t.sp; vz = ndz * t.sp; }
        else { const f = flowDir(e.x, e.z); if (f) { vx = f[0] * t.sp; vz = f[1] * t.sp; } }
        if (dist < e.r + PR + 0.7 && Math.abs(e.y - py) < 2.6 && --e.atkCd <= 0) {
          e.atkCd = 66; hurtPlayer(e.dmg); A.shake(3);
        }
      }
      moveXZ(e, vx / 60, vz / 60);
      if (e.t !== 'wasp') {
        const g = groundY(e.x, e.z, e.y);
        if (Math.abs(g - e.y) <= 1.2) e.y += (g - e.y) * 0.35;   // 平滑登阶
      }
      const pd = Math.hypot(px - e.x, pz - e.z);  // 撞玩家推挤
      if (pd < e.r + PR && pd > 0.01) {
        const push = (e.r + PR - pd) / pd;
        e.x -= (px - e.x) * push; e.z -= (pz - e.z) * push;
      }
    }
    for (let i = eballs.length - 1; i >= 0; i--) {  // 敌方弹丸
      const b = eballs[i];
      b.x += b.vx / 60; b.y += b.vy / 60; b.z += b.vz / 60;
      let dead = --b.life <= 0;
      if (!dead && pointInBox(b.x, b.y, b.z)) dead = true;
      if (!dead && scene === 'play' &&
          Math.abs(b.x - player.x) < PR + b.r && Math.abs(b.z - player.z) < PR + b.r &&
          b.y > player.y && b.y < player.y + PH) {
        hurtPlayer(b.dmg);
        dead = true;
      }
      if (dead) {
        for (let k = 0; k < 3; k++)
          parts.push({ x: b.x, y: b.y, z: b.z, vx: rnd(-2, 2), vy: rnd(0, 2), vz: rnd(-2, 2),
                       life: 6 + (Math.random() * 6 | 0), ci: b.ci });
        eballs.splice(i, 1);
      }
    }
  }

  function updateFx() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx / 60; p.y += p.vy / 60; p.z += p.vz / 60;
      p.vy -= 8 / 60;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      if (--p.life <= 0) parts.splice(i, 1);
    }
    for (let i = tracers.length - 1; i >= 0; i--) if (--tracers[i].life <= 0) tracers.splice(i, 1);
  }

  /* ============ 绘制:敌人 / 特效 / 武器 / HUD ============ */

  function drawEnemy(e) {
    toCam(e.x, e.y + e.h * 0.5, e.z, _c);
    const Zc = _c[2];
    if (Zc < NEARZ + 0.2 || Zc > 128) return;
    const fg = Zc < 60 ? 0 : Zc < 95 ? 1 : 2;
    toCam(e.x, e.y, e.z, _s);
    const fx = CX + F * _s[0] / Zc, fy = CY - F * _s[1] / Zc;
    const k = F / Zc;
    const bw = e.w * k, bh = e.h * k;
    if (bh < 2.5) { zpx(fx, fy - 1, e.t === 'brute' ? RED : ORANGE, Zc); return; }
    const x0 = fx - bw / 2, y0 = fy - bh;
    let main = ETYPES[e.t].main, alt = ETYPES[e.t].alt, eye = ETYPES[e.t].eye;
    if (fg === 2) { main = alt = HAZE; eye = HAZE; }     // 远处淡出
    if (e.flash > 0) { main = alt = WHITE; }
    const dep = Zc - 0.05;
    if (!e.alive) {                                      // 死亡压扁
      const q = e.dieT / 12;
      zrect(x0 - 1, fy - bh * 0.3 * q - 1, bw + 2, bh * 0.3 * q + 2, INKB, dep);
      zrect(x0, fy - bh * 0.28 * q, bw, bh * 0.28 * q, alt, dep);
      return;
    }
    zrect(x0 - 1, y0 - 1, bw + 2, bh + 2, INKB, dep);    // 轮廓
    const legW = Math.max(1, bw * 0.26), legH = bh * 0.34;
    if (e.t === 'wasp') {
      zrect(x0, y0 + bh * 0.25, bw, bh * 0.5, main, dep);
      zrect(x0 + bw * 0.22, y0 + bh * 0.4, bw * 0.56, bh * 0.2, WHITE, dep);
      const th = e.animT % 12 < 6 ? 0 : 1;
      zrect(x0 + bw * 0.3, y0 + bh * 0.78, bw * 0.4, bh * 0.2 + th, alt, dep);
      zpx(x0 + bw * 0.2, y0 + bh * 0.2, eye, dep);
      zpx(x0 + bw * 0.8, y0 + bh * 0.2, eye, dep);
    } else {
      const ph = (e.animT >> 3) & 1;
      zrect(x0 + bw * 0.12, fy - legH, legW, legH - ph, alt, dep);
      zrect(x0 + bw * 0.62, fy - legH, legW, legH - (1 - ph), alt, dep);
      zrect(x0, y0 + bh * 0.3, bw, bh * 0.42, main, dep);
      zrect(x0 + bw * 0.1, y0 + bh * 0.3, bw * 0.8, bh * 0.1, alt, dep);
      zrect(x0 + bw * 0.24, y0, bw * 0.52, bh * 0.2, main, dep);
      if (e.animT % 44 < 30) {
        zpx(x0 + bw * 0.34, y0 + bh * 0.08, eye, dep);
        zpx(x0 + bw * 0.62, y0 + bh * 0.08, eye, dep);
      }
      if (e.t === 'sentry')                             // 枪臂
        zrect(x0 + bw * 0.7, y0 + bh * 0.44, bw * 0.5, Math.max(1, bh * 0.08), INKB, dep);
      if (e.t === 'brute') {
        zrect(x0 - 1, y0 + bh * 0.3, bw * 0.24, bh * 0.24, alt, dep);
        zrect(x0 + bw * 0.77, y0 + bh * 0.3, bw * 0.24, bh * 0.24, alt, dep);
      }
    }
    if (Zc < 60 && e.hp < e.maxHp) {                    // 血条
      const bbw = Math.max(6, bw + 2);
      A.rect(fx - bbw / 2, y0 - 5, bbw, 3, INKB);
      A.rect(fx - bbw / 2 + 1, y0 - 4, (bbw - 2) * clamp(e.hp / e.maxHp, 0, 1), 1,
             e.t === 'brute' ? DRED : RED);
    }
  }

  function drawWorldFx() {
    for (const t of tracers)
      zseg(t.x0, t.y0, t.z0, t.x1, t.y1, t.z1, t.life === 3 ? WHITE : GOLD);
    for (const e of enemies) drawEnemy(e);
    for (const b of eballs) {
      toCam(b.x, b.y, b.z, _c);
      if (_c[2] < NEARZ + 0.2 || _c[2] > 128) continue;
      const k = F / _c[2];
      const sx = CX + F * _c[0] / _c[2], sy = CY - F * _c[1] / _c[2];
      const s = Math.max(1.5, b.r * 2 * k);
      zrect(sx - s / 2, sy - s / 2, s, s, b.ci, _c[2] - 0.05);
      zpx(sx, sy, WHITE, _c[2] - 0.06);
    }
    for (const p of parts) {
      toCam(p.x, p.y, p.z, _c);
      if (_c[2] < NEARZ + 0.1 || _c[2] > 90) continue;
      zpx(CX + F * _c[0] / _c[2], CY - F * _c[1] / _c[2], p.ci, _c[2] - 0.03);
    }
  }

  function renderWorld() {
    A.cls(SKY);
    drawSky();
    zbuf.fill(1e9);
    drawFloor();
    drawBoxes();
    drawWorldFx();
  }

  function drawGun(api) {
    const bob = Math.sin(bobT) * 1.4;
    const bobX = Math.cos(bobT * 0.5) * 1.1;
    const gx = Math.round(W * 0.60 + bobX - player.turnVel * 0.8);
    const gy = Math.round(H - 3 + recoil * 1.7 + bob + bobPh);
    api.rect(gx, gy - 15, 26, 8, DGRAY);          // 机匣
    api.rect(gx + 26, gy - 13, 17, 4, INKB);      // 枪管
    api.rect(gx + 43, gy - 14, 4, 6, INKB);       // 消焰器
    api.rect(gx + 6, gy - 7, 7, 9, GRAY);         // 握把
    api.rect(gx + 17, gy - 7, 8, 6, STEEL);       // 弹匣(蓝)
    api.rect(gx + 2, gy - 18, 10, 3, INKB);       // 照门
    api.rect(gx + 36, gy - 16, 2, 3, INKB);       // 准星柱
    api.rect(gx + 23, gy - 13, 2, 2, CYAN);       // 能量灯
    if (muzzleT > 0) {                            // 枪口焰
      const mx = gx + 47, my = gy - 11, r = muzzleT;
      api.rect(mx - 2, my - 5 - r, 4, 3 + r, WHITE);
      api.rect(mx - 5 - r, my - 2, 3 + r, 4, GOLD);
      api.rect(mx + 2, my - 2, 3 + r, 4, GOLD);
      api.rect(mx - 1, my - 1, 3, 3, WHITE);
    }
  }

  function drawCrosshair(api) {
    const g = 3 + Math.round(spread * 800);
    const ticks = [[CX, CY - g - 3, CX, CY - g], [CX, CY + g, CX, CY + g + 3],
                   [CX - g - 3, CY, CX - g, CY], [CX + g, CY, CX + g + 3, CY]];
    for (const tk of ticks) {
      api.line(tk[0], tk[1] + 1, tk[2], tk[3] + 1, WHITE);
      api.line(tk[0], tk[1], tk[2], tk[3], BLACK);
    }
    api.px(CX, CY, BLACK); api.px(CX + 1, CY, WHITE);
    if (hitM > 0) {                               // 命中标记
      const ci = hitKill ? RED : WHITE;
      const s = hitKill ? 5 : 4;
      for (const d of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        api.line(CX + d[0] * 2, CY + d[1] * 2, CX + d[0] * s, CY + d[1] * s, ci);
        api.line(CX + d[0] * 2, CY + d[1] * 2 + 1, CX + d[0] * s, CY + d[1] * s + 1,
                 hitKill ? DRED : BLACK);
      }
    }
  }

  function drawMinimap(api) {
    const S = 46, OX = W - S - 4, OY = 4, R = 55;
    api.rect(OX - 1, OY - 1, S + 2, S + 2, BLACK);
    api.rect(OX, OY, S, S, WHITE);
    const sc = S / (R * 2), mx = OX + S / 2, my = OY + S / 2;
    for (const b of boxes) {
      if (b.y1 < 0.9) continue;
      const dx = b.cx - player.x, dz = b.cz - player.z;
      const rr = R + b.rr;
      if (dx * dx + dz * dz > rr * rr) continue;
      api.rect(mx + (b.x0 - player.x) * sc, my + (b.z0 - player.z) * sc,
               Math.max(1, (b.x1 - b.x0) * sc), Math.max(1, (b.z1 - b.z0) * sc),
               b.y1 > 5 ? INKB : b.y1 > 2.2 ? DGRAY : GRID);
    }
    for (const e of enemies) {
      if (!e.alive) continue;
      const ex = mx + (e.x - player.x) * sc, ey = my + (e.z - player.z) * sc;
      if (ex >= OX && ex < OX + S && ey >= OY && ey < OY + S)
        api.rect(ex - 1, ey - 1, 2, 2, e.t === 'brute' ? RED : e.t === 'wasp' ? YEL : ORANGE);
    }
    api.rect(mx - 1, my - 1, 2, 2, CYAN);
    api.line(mx, my, mx + Math.sin(player.yaw) * 6, my + Math.cos(player.yaw) * 6, CYAN);
  }

  function drawEdgeHints(api) {                   // 残敌极少时给方向提示
    const alive = enemies.filter(e => e.alive);
    if (alive.length === 0 || alive.length > 5) return;
    alive.slice(0, 4).forEach(e => {
      const rel = angDiff(Math.atan2(e.x - player.x, e.z - player.z), player.yaw);
      if (Math.abs(rel) < 0.9) return;            // 在视野内
      const ax = CX + Math.sin(rel) * 74, ay = CY - Math.cos(rel) * 60;
      api.rect(ax - 2, ay - 1, 5, 3, ORANGE);
      api.line(ax, ay, ax + Math.sin(rel) * 8, ay - Math.cos(rel) * 7, ORANGE);
    });
  }

  function drawHud(api) {
    api.text('WAVE ' + wave, 4, 4, BLACK);
    const alive = enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
    const foes = clearPending ? 'CLEAR'
      : 'FOES ' + alive + (spawned < quota ? '+' + (quota - spawned) : '');
    api.text(foes, 4, 12, DRED);
    api.text(String(score).padStart(7, '0'), 4, 20, INKB);
    const bw = 46;                                // 血条
    api.text('HP', 5, H - 22, BLACK);
    api.rect(5, H - 14, bw + 2, 8, BLACK);
    api.rect(6, H - 13, bw, 6, WHITE);
    api.rect(6, H - 13, Math.round(bw * clamp(player.hp / player.maxHp, 0, 1)), 6,
             player.hp > 30 ? RED : DRED);
    if (player.hp < player.maxHp && lastHitT > 240 && (api.frame & 8))
      api.text('+', 6 + bw + 4, H - 14, CYAN);
    const iy = H - 11;                            // 弹药无限(双环 ∞)
    for (const ox of [0, 7]) {
      api.rect(W - 22 + ox, iy, 6, 1, BLACK);
      api.rect(W - 22 + ox, iy + 3, 6, 1, BLACK);
      api.rect(W - 22 + ox, iy, 1, 4, BLACK);
      api.rect(W - 22 + ox + 5, iy, 1, 4, BLACK);
    }
    api.text('ARC-9 INFINITE', W - 4 - api.textWidth('ARC-9 INFINITE'), H - 22, INKB);
    drawMinimap(api);
    drawEdgeHints(api);
    if (dmgT > 0) {                               // 受击边缘
      const t = Math.min(5, dmgT >> 2) + 1;
      api.rect(0, 0, W, t, RED); api.rect(0, H - t, W, t, RED);
      api.rect(0, 0, t, H, RED); api.rect(W - t, 0, t, H, RED);
    }
    drawCrosshair(api);
    drawGun(api);
    if (bannerT > 0 && (bannerT > 16 || api.frame % 4 < 2)) {
      const s = 'WAVE ' + wave;
      api.text(s, (W - api.textWidth(s, 2)) / 2 + 1, 35 + 1, WHITE, 2);
      api.text(s, (W - api.textWidth(s, 2)) / 2, 35, BLACK, 2);
      api.text(bannerSub, (W - api.textWidth(bannerSub)) / 2 + 1, 52 + 1, WHITE);
      api.text(bannerSub, (W - api.textWidth(bannerSub)) / 2, 52, DRED);
    }
    if (clearPending && interT > 0) {
      const s = 'NEXT WAVE IN ' + Math.ceil(interT / 60);
      api.text(s, (W - api.textWidth(s)) / 2, 4, BLACK);
    }
    if (player.hp <= 0 && scene === 'play')
      api.text('SIGNAL LOST', (W - api.textWidth('SIGNAL LOST', 2)) / 2, 70, RED, 2);
    if (!mouseLocked && !clearPending && api.frame % 60 < 38)   // 未锁定提示
      api.text('CLICK TO LOCK MOUSE', (W - api.textWidth('CLICK TO LOCK MOUSE')) / 2,
               150, BLACK);
  }

  function drawTitle(api) {
    const a = api.frame * 0.004;
    const R = 64;
    const cx = 120 + Math.cos(a) * R, cz = 120 + Math.sin(a) * R;
    setCam(cx, 15, cz, Math.atan2(120 - cx, 120 - cz), -0.13);
    renderWorld();
    const t1 = 'PALE', t2 = 'CITADEL';
    const tw = api.textWidth(t1 + ' ' + t2, 3);
    let x = (W - tw) / 2;
    api.text(t1, x + 2, 16 + 2, WHITE, 3);
    api.text(t1, x, 16, INKB, 3);
    x += api.textWidth(t1 + ' ', 3);
    api.text(t2, x + 2, 16 + 2, WHITE, 3);
    api.text(t2, x, 16, RED, 3);
    const sub = '3D WAVE SHOOTER';
    api.text(sub, (W - api.textWidth(sub)) / 2, 40, INKB);
    if (best) {
      const bs = 'BEST WAVE ' + best.w + '  SCORE ' + String(best.s).padStart(7, '0');
      api.text(bs, (W - api.textWidth(bs)) / 2, 52, GOLD);
    }
    if (api.frame % 60 < 38)
      api.text('PRESS START', (W - api.textWidth('PRESS START', 2)) / 2, 76, BLACK, 2);
    const hints = [
      'WASD MOVE  MOUSE AIM  LMB FIRE',
      'RMB JUMP  ENTER PAUSE',
      'CLICK TO LOCK MOUSE / ESC RELEASE',
      'INFINITE AMMO - HOLD THE LINE',
    ];
    hints.forEach((s, i) =>
      api.text(s, (W - api.textWidth(s)) / 2, 104 + i * 11, i === 3 ? DRED : DGRAY));
  }

  function drawOver(api) {
    renderWorld();
    api.rect(30, 42, 180, 96, WHITE);
    api.rect(30, 42, 180, 1, BLACK); api.rect(30, 137, 180, 1, BLACK);
    api.rect(30, 42, 1, 96, BLACK); api.rect(209, 42, 1, 96, BLACK);
    api.text('GAME OVER', (W - api.textWidth('GAME OVER', 2)) / 2, 50, RED, 2);
    const rows = ['REACHED WAVE ' + wave, 'KILLS ' + kills,
                  'SCORE ' + String(score).padStart(7, '0')];
    rows.forEach((s, i) => api.text(s, (W - api.textWidth(s)) / 2, 72 + i * 12, INKB));
    if (best)
      api.text('BEST W' + best.w + '  ' + String(best.s).padStart(7, '0'),
               (W - api.textWidth('BEST W' + best.w + '  ' + String(best.s).padStart(7, '0'))) / 2,
               110, GOLD);
    if (api.frame % 60 < 38)
      api.text('PRESS START TO RE-DEPLOY',
               (W - api.textWidth('PRESS START TO RE-DEPLOY')) / 2, 124, BLACK);
  }

  /* ============ 卡带接口 ============ */

  return {
    name: 'PALE CITADEL',
    version: '1.1',
    filter: 'none',
    lockPointer: true,          // 壳见此标志请求指针锁定(鼠标视图,非新增按键)

    /* RGB565:0白 1雾 2路面 3路面缝 4灰 5深灰 6墨黑 7藏蓝 8钢蓝 9浅蓝
       10冰蓝 11黄 12琥珀 13橙 14红橙 15红 16暗红 17黑 18青 19金 */
    palette: [
      0xFFFF, 0xF79F, 0xD67A, 0xAD76, 0x8431, 0x52AC, 0x2125, 0x1954,
      0x63D4, 0x9DBC, 0xD71E, 0xFF01, 0xFD67, 0xFBA3, 0xFAA4, 0xE944,
      0x9883, 0x0000, 0x067C, 0xFE48,
    ],

    init(api) {
      A = api;
      boxes.length = 0;
      buildMap();
      buildNav();
      enemies = []; eballs = []; parts = []; tracers = [];
      scene = 'title'; paused = false; lockPause = false; hadLock = false;
      player = { x: 120, y: 1.6, z: 136, vx: 0, vy: 0, vz: 0, r: PR, h: PH,
                 yaw: 3.1416, pitch: 0, hp: 100, maxHp: 100, grounded: true,
                 turnVel: 0 };
      wave = 1; score = 0; kills = 0;
      bannerT = 0; dmgT = 0; hitM = 0; overT = 0;
    },

    update(api) {
      if (scene === 'title' || scene === 'over') {
        if (api.justPressed('start') || api.justPressed('a')) resetRun();
        return;
      }
      updatePlay(api);
    },

    draw(api) {
      if (scene === 'title') { drawTitle(api); return; }
      if (scene === 'over') { drawOver(api); return; }
      setCam(player.x, player.y + EYE, player.z, player.yaw, player.pitch);
      renderWorld();
      drawHud(api);
      if (paused || lockPause) {
        api.rect(58, 62, 124, 56, WHITE);
        api.rect(58, 62, 124, 1, BLACK); api.rect(58, 117, 124, 1, BLACK);
        api.rect(58, 62, 1, 56, BLACK); api.rect(181, 62, 1, 56, BLACK);
        api.text('PAUSED', (W - api.textWidth('PAUSED', 2)) / 2, 68, BLACK, 2);
        if (lockPause) {
          api.text('MOUSE RELEASED', (W - api.textWidth('MOUSE RELEASED')) / 2, 84, DRED);
          api.text('CLICK TO RESUME', (W - api.textWidth('CLICK TO RESUME')) / 2, 96, INKB);
        } else {
          api.text('ENTER TO RESUME', (W - api.textWidth('ENTER TO RESUME')) / 2, 86, INKB);
          api.text('ESC ESC = MENU', (W - api.textWidth('ESC ESC = MENU')) / 2, 98, DGRAY);
        }
      }
    },
  };
})();
