/*
 * 冒烟测试:用桩内核在 Node 里跑卡带 update/draw 数千帧,抓运行时异常
 * 用法:node tools/smoke.js [帧数]
 * 覆盖:title → play 全程随机输入、暂停切换、受击/死亡/结算路径尽量走到
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRAMES = +(process.argv[2] || 6000);

/* 桩内核:覆盖卡带用到的全部 api(规格 §6/§7) */
function makeApi() {
  const W = 240, H = 180;
  let frame = 0;
  let shakeMag = 0;
  const state = {}, prev = {};
  const keys = ['up', 'down', 'left', 'right', 'a', 'b', 'start'];
  for (const k of keys) { state[k] = false; prev[k] = false; }
  const fb = new Uint8Array(W * H);
  let pxCalls = 0;
  const api = {
    get width() { return W; },
    get height() { return H; },
    get frame() { return frame; },
    get palette() { return []; },
    px(x, y, ci) { pxCalls++; },
    cls() {},
    rect(x, y, w, h, ci) { pxCalls += Math.max(0, w | 0) * Math.max(0, h | 0); },
    line(x0, y0, x1, y1, ci) {
      pxCalls += Math.max(1, Math.max(Math.abs((x1 | 0) - (x0 | 0)),
                                       Math.abs((y1 | 0) - (y0 | 0))));
    },
    text(str, x, y, ci, scale) { pxCalls += String(str).length * 12; },
    textWidth(str, scale) { return (String(str).length * 4 - 1) * (scale || 1); },
    shake(mag) { shakeMag = Math.max(shakeMag, mag); },
    pressed: (k) => state[k] === true,
    justPressed: (k) => state[k] === true && prev[k] === false,
    justReleased: (k) => state[k] === false && prev[k] === true,
    cursor: () => ({ x: 120, y: 90, dx: 0, dy: 0, on: false, rdx: 0, rdy: 0, lock: false }),
    _tick() {
      frame++;
      try {
        this.update(api);
        this.draw(api);
      } finally {
        for (const k of keys) prev[k] = state[k];
      }
    },
    _state: state,
    _px() { return pxCalls; },
  };
  return api;
}

/* 确定性伪随机(可复现) */
let seed = 1234567;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const CARTS = [
  ['BreakoutCart', 'js/cart-breakout.js'],
  ['VampireCart', 'js/cart-vampire.js'],
  ['GateRunnerCart', 'js/cart-stargate.js'],
  ['StarfallCart', 'js/cart-starfall.js'],
  ['AetherGPCart', 'js/cart-racer.js'],
  ['PixelDashCart', 'js/cart-runner.js'],
  ['DeepDropCart', 'js/cart-drop.js'],
  ['PaleCitadelCart', 'js/cart-fps.js'],
  ['MagicTowerCart', 'js/cart-magictower.js'],
  ['TidyUpCart', 'js/cart-tidy.js'],
  ['PuffVolleyCart', 'js/cart-volley.js'],
];

let failed = 0;
for (const [name, file] of CARTS) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const ctx = { window: {}, localStorage: storage, console, Math, performance: { now: () => 0 } };
  vm.createContext(ctx);
  const api = makeApi();
  try {
    vm.runInContext(code + '\nthis.__c = ' + name + ';', ctx, { filename: file });
    const cart = ctx.__c;
    cart.init(api);
    for (let f = 0; f < FRAMES; f++) {
      const s = api._state;
      // 随机方向键:每 24 帧重掷
      if (f % 24 === 0) {
        for (const k of ['up', 'down', 'left', 'right']) s[k] = rnd() < 0.4;
        s.a = rnd() < 0.7;                       // 主键多数时间按住(开火/跳跃)
      }
      // start:title 进入 + 偶发暂停开关(成对,保证恢复)
      if (f === 30 || f === 2700 || f === 2712 || f === 5000 || f === 5008) {
        s.start = true;
      } else s.start = false;
      s.b = rnd() < 0.02;                        // 副键偶发(炸弹)
      const host = { update: cart.update.bind(cart), draw: cart.draw.bind(cart) };
      api._tick.call(host);
    }
    // 收尾阶段:狂按 b / start / a,覆盖 结束→回标题、切屏等收尾画面
    for (let f = 0; f < 400; f++) {
      const s = api._state;
      for (const k of ['up', 'down', 'left', 'right']) s[k] = false;
      s.b = f % 7 < 1;
      s.start = f % 11 < 1;
      s.a = f % 5 < 1;
      const host = { update: cart.update.bind(cart), draw: cart.draw.bind(cart) };
      api._tick.call(host);
    }
    const drew = api._px();
    console.log('PASS', name.padEnd(16), FRAMES + ' 帧 · 绘制调用 ' + drew);
  } catch (err) {
    failed++;
    console.log('FAIL', name.padEnd(16), err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err);
  }
}
process.exit(failed ? 1 : 0);
