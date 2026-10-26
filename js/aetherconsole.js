/*
 * AetherConsole 内核 · 阶段一切片 v5
 * 规格:docs/spec.md(v0.5)
 *   - 240×180,固定 60fps,固定步长不追帧(§5.1)
 *   - 颜色模式 A:索引帧缓冲(Uint8Array,每像素一个调色板下标),
 *     游戏可直接编辑屏幕像素(px / rect / line / cls / text)(§5.2)
 *   - 上屏:帧缓冲 × 调色板 LUT → ImageData → 画布;整数震动偏移内建(shake)
 *   - 滤镜链切片(M4 预演):scanline / crt / halftone 后处理,setFilter 切换
 *   - 输入:统一虚拟键位(上下左右 / A / B / Start,不多键),手柄视图查询
 *     pressed/justPressed/justReleased(§7)
 *   - 鼠标视图切片(§7.3):pushInput 接受光标绝对坐标(壳负责换算到 240×180 系),
 *     内核逐帧计算增量,游戏经 api.cursor() 查询 {x,y,dx,dy,on};
 *     指针锁定模式(仍属"鼠标移动",非新增按键):卡带声明 lockPointer,
 *     壳请求 PointerLock 并送入原始位移增量 mdx/mdy + lock 状态,
 *     游戏读 cursor().rdx/rdy/.lock(不锁 240×180 边界,FPS 视角用)
 *   - 嵌入 API:attach / loadCart / start / pause / stop / pushInput / on('error')(§10)
 *   - 异常行为:console.error → 停机(保留最后画面)→ on('error') 上报壳(§9)
 * 本切片未含(后续里程碑):任意分辨率降采样与滤镜链、精灵/地图、音频(§8)、
 *   存档 API(§2)、卡带容器、原生 Canvas2D 直绘通道
 */
(function () {
  'use strict';

  const W = 240, H = 180, STEP = 1000 / 60;

  /* 临时 3×5 调试字体(0-9、A-Z 与常用符号);
     正式 12px(11px 高)固件字体到位后替换(规格 §6) */
  const MINI_FONT = {
    '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '011', '001', '111'],
    '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '010', '010'],
    '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
    'A': ['111', '101', '111', '101', '101'], 'B': ['110', '101', '110', '101', '110'],
    'C': ['111', '100', '100', '100', '111'], 'D': ['110', '101', '101', '101', '110'],
    'E': ['111', '100', '111', '100', '111'], 'F': ['111', '100', '111', '100', '100'],
    'G': ['111', '100', '101', '101', '111'], 'H': ['101', '101', '111', '101', '101'],
    'I': ['111', '010', '010', '010', '111'], 'J': ['011', '001', '001', '101', '111'],
    'K': ['101', '101', '110', '101', '101'], 'L': ['100', '100', '100', '100', '111'],
    'M': ['101', '111', '111', '101', '101'], 'N': ['110', '101', '101', '101', '101'],
    'O': ['111', '101', '101', '101', '111'], 'P': ['111', '101', '111', '100', '100'],
    'Q': ['111', '101', '101', '111', '011'], 'R': ['111', '101', '111', '110', '101'],
    'S': ['111', '100', '111', '001', '111'], 'T': ['111', '010', '010', '010', '010'],
    'U': ['101', '101', '101', '101', '111'], 'V': ['101', '101', '101', '101', '010'],
    'W': ['101', '101', '111', '111', '101'], 'X': ['101', '101', '010', '101', '101'],
    'Y': ['101', '101', '111', '010', '010'], 'Z': ['111', '001', '010', '100', '111'],
    ' ': ['000', '000', '000', '000', '000'], '-': ['000', '000', '111', '000', '000'],
    '.': ['000', '000', '000', '000', '010'], '!': ['010', '010', '010', '000', '010'],
    ':': ['000', '010', '000', '010', '000'], '/': ['001', '001', '010', '100', '100'],
  };

  const KEYS = ['up', 'down', 'left', 'right', 'a', 'b', 'start'];

  /* 4×4 Bayer 抖动矩阵(halftone 用) */
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const FILTER_NAMES = ['none', 'scanline', 'crt', 'halftone'];

  function blankInput() {
    const o = {};
    for (const k of KEYS) o[k] = false;
    return o;
  }

  class AetherConsole {
    constructor() {
      this.width = W;
      this.height = H;
      this.canvas = null;
      this.ctx = null;
      this.cart = null;
      this.palette = [];
      this.running = false;
      this.halted = false;
      this._api = null;
      this._raf = 0;
      this._last = 0;
      this._acc = 0;
      this._frame = 0;
      this._input = blankInput();
      this._prev = blankInput();
      /* 鼠标视图(§7.3):光标状态;_curNow 为壳最近送入值,_cur 含逐帧增量;
         指针锁定模式:rdx/rdy 为原始位移增量(帧间累计、逐帧清零),lock 为锁定态 */
      this._cur = { x: W / 2, y: H / 2, dx: 0, dy: 0, on: false, rdx: 0, rdy: 0, lock: false };
      this._curNow = { x: W / 2, y: H / 2, on: false, lock: false };
      this._curRaw = { rdx: 0, rdy: 0 };   // pushInput 累计 → _tick 结算
      this._listeners = { error: [] };

      /* 索引帧缓冲(模式 A):每像素 = 调色板下标 */
      this.fb = new Uint8Array(W * H);
      this._off = null;       // 离屏画布:LUT 展开 → ImageData
      this._offCtx = null;
      this._img = null;
      this._px32 = null;      // ImageData 的 Uint32 视图
      this._lut = null;       // 调色板下标 → ABGR Uint32
      this._shake = 0;        // 屏幕震动幅度(blit 时偏移)
      this._filter = 'none';  // 后处理滤镜名
    }

    /* —— 嵌入 API(规格 §10)—— */

    attach(canvas) {
      this.canvas = canvas;
      canvas.width = W;   // 内核只输出 240×180 最终帧(§5.5),缩放归壳
      canvas.height = H;
      this.ctx = canvas.getContext('2d');
      this._off = document.createElement('canvas');
      this._off.width = W;
      this._off.height = H;
      this._offCtx = this._off.getContext('2d');
      this._img = this._offCtx.createImageData(W, H);
      this._px32 = new Uint32Array(this._img.data.buffer);
      return this;
    }

    loadCart(cart) {
      if (!cart || !Array.isArray(cart.palette) ||
          cart.palette.length < 1 || cart.palette.length > 32) {
        throw new Error('卡带非法:palette 需为 1..32 个 RGB565 颜色(规格 §5.2 模式 A)');
      }
      this.cart = cart;
      this.halted = false;
      this.palette = cart.palette.map((rgb565) => {
        const r = Math.round((rgb565 >> 11 & 31) * 255 / 31);
        const g = Math.round((rgb565 >> 5 & 63) * 255 / 63);
        const b = Math.round((rgb565 & 31) * 255 / 31);
        return 'rgb(' + r + ',' + g + ',' + b + ')';
      });
      /* LUT:下标 → ABGR(小端 ImageData 布局),未用槽位为黑 */
      this._lut = new Uint32Array(32).fill(0xFF000000);
      cart.palette.forEach((c, i) => {
        const r = Math.round((c >> 11 & 31) * 255 / 31);
        const g = Math.round((c >> 5 & 63) * 255 / 63);
        const b = Math.round((c & 31) * 255 / 31);
        this._lut[i] = 0xFF000000 | (b << 16) | (g << 8) | r;
      });
      this._api = this._buildApi();
      this._filter = FILTER_NAMES.includes(cart.filter) ? cart.filter : 'none';
      if (typeof cart.init === 'function') cart.init(this._api);
      return this;
    }

    /* 壳/调试:运行时切换后处理滤镜 */
    setFilter(name) {
      if (FILTER_NAMES.includes(name)) this._filter = name;
      return this;
    }

    start() {
      if (this.running || this.halted || !this.cart || !this.ctx) return this;
      this.running = true;
      this._last = performance.now();
      this._acc = 0;
      const loop = (now) => {
        if (!this.running) return;
        this._acc += now - this._last;
        this._last = now;
        if (this._acc >= STEP) {
          this._tick();
          /* 固定步长、不追帧(§5.1):每个 rAF 至多步进一次,
             仍积压的时间直接丢弃,表现为掉帧、内核不补偿 */
          this._acc = Math.min(this._acc - STEP, STEP - 1);
        }
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
      return this;
    }

    pause() {
      this.running = false;
      cancelAnimationFrame(this._raf);
      return this;
    }

    stop() {
      this.pause();
      this._frame = 0;
      return this;
    }

    /* 壳按帧送入虚拟键位(规格 §7.1);光标字段可选(鼠标视图,§7.3);
       指针锁定模式:mdx/mdy 为浏览器原始位移增量(不裁剪),lock 为锁定态 */
    pushInput(state) {
      for (const k of KEYS) if (k in state) this._input[k] = !!state[k];
      if ('cursorX' in state) this._curNow.x = Math.max(0, Math.min(W - 1, state.cursorX));
      if ('cursorY' in state) this._curNow.y = Math.max(0, Math.min(H - 1, state.cursorY));
      if ('cursorOn' in state) this._curNow.on = !!state.cursorOn;
      if ('mdx' in state) this._curRaw.rdx += state.mdx || 0;
      if ('mdy' in state) this._curRaw.rdy += state.mdy || 0;
      if ('lock' in state) this._curNow.lock = !!state.lock;
      return this;
    }

    on(evt, fn) {
      if (this._listeners[evt]) this._listeners[evt].push(fn);
      return this;
    }

    _emit(evt, arg) {
      for (const fn of this._listeners[evt]) fn(arg);
    }

    _tick() {
      try {
        /* 光标增量按逻辑帧结算(游戏在 update 里看到稳定的 dx/dy);
           指针锁定增量同理:本帧合计 → 清零累计 */
        this._cur.dx = this._curNow.x - this._cur.x;
        this._cur.dy = this._curNow.y - this._cur.y;
        this._cur.x = this._curNow.x;
        this._cur.y = this._curNow.y;
        this._cur.on = this._curNow.on;
        this._cur.rdx = this._curRaw.rdx; this._curRaw.rdx = 0;
        this._cur.rdy = this._curRaw.rdy; this._curRaw.rdy = 0;
        this._cur.lock = this._curNow.lock;
        const api = this._api;
        if (this.cart.update) this.cart.update(api);
        if (this.cart.draw) this.cart.draw(api);
        this._blit();
        this._frame++;
        for (const k of KEYS) this._prev[k] = this._input[k];
      } catch (err) {
        /* 规格异常行为(§9):输出调用栈 → 停机(保留最后画面)→ 上报壳 */
        console.error('[AetherConsole] 游戏异常,内核停机:', err);
        this.pause();
        this.halted = true;
        this._emit('error', err);
      }
    }

    /* 帧缓冲 × LUT → 画布;滤镜后处理;震动时整体偏移,露出底色 */
    _blit() {
      const fb = this.fb, px = this._px32, lut = this._lut;
      for (let i = 0; i < fb.length; i++) px[i] = lut[fb[i]];
      this._applyFilter(px);
      this._offCtx.putImageData(this._img, 0, 0);
      let sx = 0, sy = 0;
      if (this._shake > 0.1) {
        sx = Math.round((Math.random() * 2 - 1) * this._shake);
        sy = Math.round((Math.random() * 2 - 1) * this._shake);
        this._shake *= 0.86;
      } else {
        this._shake = 0;
      }
      const c = this.ctx;
      c.fillStyle = this.palette[0];
      c.fillRect(0, 0, W, H);
      c.drawImage(this._off, sx, sy);
    }

    /* 滤镜链切片:在 RGB(ImageData)域逐像素后处理
       px 为 ABGR 小端 Uint32:r=c&255, g=(c>>8)&255, b=(c>>16)&255 */
    _applyFilter(px) {
      const f = this._filter, W = this.width, H = this.height;
      if (f === 'none') return;
      const scale = (c, k) => {
        let r = ((c & 255) * k) >> 8, g = (((c >> 8) & 255) * k) >> 8,
            b = (((c >> 16) & 255) * k) >> 8;
        if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
        return 0xFF000000 | (b << 16) | (g << 8) | r;
      };
      if (f === 'scanline') {                 // 隔行压暗 46%
        for (let y = 1; y < H; y += 2) {
          const row = y * W;
          for (let x = 0; x < W; x++) px[row + x] = scale(px[row + x], 138);
        }
      } else if (f === 'crt') {               // 磷光弥散 + 扫描线 + 暗角 + 中心提亮
        const tmp = new Uint32Array(W);
        for (let y = 0; y < H; y++) {         // 横向轻模糊(0.22/0.56/0.22)
          const row = y * W;
          tmp.set(px.subarray(row, row + W));
          for (let x = 0; x < W; x++) {
            const l = tmp[x > 0 ? x - 1 : 0], c = tmp[x], r2 = tmp[x < W - 1 ? x + 1 : W - 1];
            const R = ((l & 255) * 56 + (c & 255) * 144 + (r2 & 255) * 56) >> 8;
            const G = (((l >> 8) & 255) * 56 + ((c >> 8) & 255) * 144 + ((r2 >> 8) & 255) * 56) >> 8;
            const B = (((l >> 16) & 255) * 56 + ((c >> 16) & 255) * 144 + ((r2 >> 16) & 255) * 56) >> 8;
            px[row + x] = 0xFF000000 | (B << 16) | (G << 8) | R;
          }
        }
        const cx = W / 2, cy = H / 2, nx = 1 / cx, ny = 1 / cy;
        for (let y = 0; y < H; y++) {
          const row = y * W;
          const dark = (y & 1) ? 200 : 255;   // 扫描线 22%
          const dy = (y - cy) * ny;
          for (let x = 0; x < W; x++) {
            const dx = (x - cx) * nx;
            const d2 = dx * dx + dy * dy;     // 椭圆距离²
            let k = dark;
            if (d2 > 0.55) k *= Math.max(0.45, 1 - (d2 - 0.55) * 0.9);  // 暗角
            else if (d2 < 0.12) k = Math.min(266, k * 1.06);            // 中心提亮
            px[row + x] = scale(px[row + x], k);
          }
        }
      } else if (f === 'halftone') {          // Bayer 有序抖动半色调:亮度点阵纹理
        for (let y = 0; y < H; y++) {
          const row = y * W, by = (y & 3) * 4;
          for (let x = 0; x < W; x++) {
            const c = px[row + x];
            const lum = ((c & 255) * 77 + ((c >> 8) & 255) * 151 +
                         ((c >> 16) & 255) * 28) >> 8;
            const th = 16 + BAYER[by + (x & 3)] * 13;
            px[row + x] = lum < th ? scale(c, 102) : scale(c, 302);
          }
        }
      }
    }

    _buildApi() {
      const self = this;
      const putPx = (x, y, ci) => {
        if (x >= 0 && x < W && y >= 0 && y < H) self.fb[y * W + x] = ci;
      };
      return {
        get width() { return self.width; },
        get height() { return self.height; },
        get frame() { return self._frame; },
        get palette() { return self.palette; },  // 调色板 CSS 色(只读)

        /* —— 像素级绘制:直接编辑索引帧缓冲(模式 A)—— */
        px(x, y, ci) { putPx(x | 0, y | 0, ci); },
        cls(ci) { self.fb.fill(ci || 0); },
        rect(x, y, w, h, ci) {
          const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
          const x1 = Math.min(W, (x | 0) + (w | 0)), y1 = Math.min(H, (y | 0) + (h | 0));
          const fb = self.fb;
          for (let yy = y0; yy < y1; yy++) fb.fill(ci, yy * W + x0, yy * W + x1);
        },
        text(str, x, y, ci, scale) {  // 3×5 迷你字体,4px 步进(3+1);scale 整数放大
          const sc = scale || 1;
          let cx = x | 0;
          for (const ch of String(str).toUpperCase()) {
            const glyph = MINI_FONT[ch];
            if (glyph) {
              for (let row = 0; row < 5; row++) {
                const bits = glyph[row];
                for (let col = 0; col < 3; col++) {
                  if (bits.charCodeAt(col) === 49) {
                    if (sc === 1) putPx(cx + col, (y | 0) + row, ci);
                    else self.fbFill(cx + col * sc, (y | 0) + row * sc, sc, sc, ci);
                  }
                }
              }
            }
            cx += 4 * sc;
          }
        },
        textWidth(str, scale) { return (String(str).length * 4 - 1) * (scale || 1); },

        /* 线段(Bresenham,端点取整,屏内自动裁剪) */
        line(x0, y0, x1, y1, ci) {
          x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
          if (x0 === x1 && y0 === y1) { putPx(x0, y0, ci); return; }
          const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
          const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
          let err = dx + dy;
          for (;;) {
            putPx(x0, y0, ci);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
          }
        },

        /* 屏幕震动(内核原语:blit 时整体偏移,幅度指数衰减) */
        shake(mag) { self._shake = Math.min(6, Math.max(self._shake, mag)); },

        /* 手柄视图输入查询(规格 §7.3) */
        pressed: (k) => self._input[k] === true,
        justPressed: (k) => self._input[k] === true && self._prev[k] === false,
        justReleased: (k) => self._input[k] === false && self._prev[k] === true,

        /* 鼠标视图(规格 §7.3):光标绝对坐标(240×180 系)+ 本帧增量 + 是否在屏;
           指针锁定模式:rdx/rdy 为原始位移增量(浏览器系,不裁剪),lock 为锁定态 */
        cursor() {
          return { x: self._cur.x, y: self._cur.y,
                   dx: self._cur.dx, dy: self._cur.dy, on: self._cur.on,
                   rdx: self._cur.rdx, rdy: self._cur.rdy, lock: self._cur.lock };
        },
      };
    }

    /* rect 的内部实现(text 放大也用它) */
    fbFill(x, y, w, h, ci) {
      const x0 = Math.max(0, x), y0 = Math.max(0, y);
      const x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
      for (let yy = y0; yy < y1; yy++) this.fb.fill(ci, yy * W + x0, yy * W + x1);
    }
  }

  window.AetherConsole = AetherConsole;
})();
