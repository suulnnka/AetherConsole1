/*
 * tools/editor-common.js — 编辑器共用工具(纯 JS,无模块,file:// 可用)
 * 提供:DOM 构建、toast、文件下载/读取、RGB565 换算、索引色画布渲染、草稿存取
 */
(function () {
  'use strict';

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'style') n.style.cssText = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }

  function toast(msg, opts) {
    const o = typeof opts === 'object' ? opts : { err: opts === true, ms: opts };
    let host = document.getElementById('toasts');
    if (!host) { host = el('div', { id: 'toasts' }); document.body.append(host); }
    const t = el('div', { class: 'toast' + (o.err ? ' err' : '') }, msg);
    host.append(t);
    setTimeout(() => t.remove(), o.ms || 2600);
    return t;
  }

  function download(name, data, mime) {
    const blob = data instanceof Blob ? data
      : new Blob([data], { type: mime || 'application/octet-stream' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function pickFile(accept, asText) {
    return new Promise((resolve) => {
      const inp = el('input', { type: 'file', accept });
      inp.addEventListener('change', () => {
        const f = inp.files[0];
        if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve({ name: f.name, data: r.result });
        if (asText === 'text') r.readAsText(f); else r.readAsArrayBuffer(f);
      });
      inp.click();
    });
  }

  /* —— base64 ↔ 字节 —— */
  function b64FromBytes(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000)
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function bytesFromB64(s) {
    const bin = atob(s), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  /* —— RGB565(规格 §5.2 模式 A)—— */
  function rgb565FromRGB(r, g, b) {
    return ((r & 248) << 8) | ((g & 252) << 3) | (b >> 3);
  }
  function rgb565ToRGB(v) {
    return [Math.round((v >> 11 & 31) * 255 / 31),
            Math.round((v >> 5 & 63) * 255 / 63),
            Math.round((v & 31) * 255 / 31)];
  }
  function hexFromRGB565(v) {
    const [r, g, b] = rgb565ToRGB(v);
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }
  function rgb565FromHex(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return rgb565FromRGB(v >> 16 & 255, v >> 8 & 255, v & 255);
  }

  /* —— 索引色画布:数据(u8,每像素一个调色板下标)→ ImageData —— */
  function renderIndexed(canvas, data, w, h, paletteRGB) {
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const px = new Uint32Array(img.data.buffer);
    const lut = new Uint32Array(256).fill(0xFF000000);
    paletteRGB.forEach((c, i) => {
      lut[i] = 0xFF000000 | (c[2] << 16) | (c[1] << 8) | c[0];
    });
    for (let i = 0; i < data.length; i++) px[i] = lut[data[i]];
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /* —— 草稿(localStorage,自动保存)—— */
  const draft = {
    save(key, obj) {
      try { localStorage.setItem(key, JSON.stringify(obj)); return true; }
      catch (e) { return false; }
    },
    load(key) {
      try {
        const s = localStorage.getItem(key);
        return s ? JSON.parse(s) : null;
      } catch (e) { return null; }
    },
    clear(key) { try { localStorage.removeItem(key); } catch (e) {} },
  };

  /* —— 通用小件 —— */
  function dialog(build) {  // build(dlg) 自行填充内容;返回关闭函数
    const ov = el('div', { class: 'overlay' });
    const dlg = el('div', { class: 'dlg' });
    ov.append(dlg);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    document.body.append(ov);
    function close() { ov.remove(); }
    build(dlg, close);
    return close;
  }

  window.AC = {
    el, toast, download, pickFile, dialog,
    b64FromBytes, bytesFromB64,
    rgb565FromRGB, rgb565ToRGB, hexFromRGB565, rgb565FromHex,
    renderIndexed, draft,
  };
})();
