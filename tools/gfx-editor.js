/*
 * tools/gfx-editor.js — 精灵 / Tile / 地图 三合一图形编辑器(规格 §11.1)
 * 数据模型与卡带区块联动(§6 / §9):
 *   - 精灵图 256×256,索引色(调色板 16 色,RGB565;下标 0 兼作透明)
 *   - tile 8×8,共 32×32=1024 个;精灵 = 精灵图上 8 倍数的任意矩形
 *   - 地图条目 u16:bit0..9 = tile 索引,bit10 = 水平翻转,bit11 = 垂直翻转,0xFFFF = 空
 * 导出:项目 JSON / 精灵图 PNG・spritesheet.bin / 地图 JSON・map.bin
 */
(function () {
  'use strict';
  const { el, toast, download, pickFile, dialog, draft, b64FromBytes, bytesFromB64,
          rgb565ToRGB, hexFromRGB565, rgb565FromHex, renderIndexed } = window.AC;

  const SW = 256, SH = 256, TX = 32, TY = 32, TILE = 8;
  const EMPTY = 0xFFFF;

  const DEFAULT_HEX = ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236',
    '#5F574F', '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436',
    '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'];

  /* ================= 状态 ================= */
  let G = null;
  let mode = 'sprite';                 // sprite | tile | map
  let pixTool = 'pencil', mapTool = 'pencil';
  let pxZoom = 12, mapZoom = 1, ovZoom = 1;
  let showPixGrid = true;
  let tileClip = null;                 // tile 剪贴板(Uint8Array 64)
  let undoStack = [], redoStack = [];
  let saveTimer = 0;

  function newProject() {
    G = {
      palette: DEFAULT_HEX.map(rgb565FromHex),
      sheet: new Uint8Array(SW * SH),
      sprites: [],
      map: { w: 32, h: 32, cells: new Uint16Array(32 * 32).fill(EMPTY) },
      color: 1, activeSprite: -1, tileIndex: 0,
      brush: { x: 0, y: 0, w: 1, h: 1, fh: false, fv: false },
    };
    /* 默认给一个 16×16 笑脸精灵,方便上手 */
    const sp = { name: '精灵1', x: 0, y: 0, w: 16, h: 16 };
    G.sprites.push(sp); G.activeSprite = 0;
    const put = (x, y, c) => { G.sheet[(sp.y + y) * SW + sp.x + x] = c; };
    for (let y = 3; y < 13; y++) for (let x = 4; x < 12; x++) put(x, y, 6);   // 脸
    for (let y = 2; y < 14; y++) { put(4, y, 5); put(11, y, 5); }
    for (let x = 4; x < 12; x++) { put(x, 3, 5); put(x, 12, 5); }
    put(6, 6, 0); put(6, 7, 0); put(9, 6, 0); put(9, 7, 0);                   // 眼
    for (let x = 6; x < 10; x++) put(x, 10, 8);                               // 嘴
  }

  const $ = (id) => document.getElementById(id);
  const editCv = $('edit'), ectx = editCv.getContext('2d');
  const sheetCv = $('sheet'), shctx = sheetCv.getContext('2d');
  const brushCv = $('brushPrev'), bctx = brushCv.getContext('2d');
  const sheetOff = document.createElement('canvas');
  const mapOff = document.createElement('canvas');
  let mapImg = null, mapImgCtx = null, mapLut = null;

  /* ================= 调色板 ================= */
  function palRGB() { return G.palette.map(rgb565ToRGB); }
  function cssOf(i) { return hexFromRGB565(G.palette[i]); }

  function buildPaletteUI() {
    const host = $('palette');
    host.textContent = '';
    const colorInput = el('input', { type: 'color' });
    colorInput.style.display = 'none';
    host.append(colorInput);
    let editIdx = -1;
    colorInput.addEventListener('change', () => {
      const v = rgb565FromHex(colorInput.value);
      if (v == null || editIdx < 0) return;
      const before = G.palette.slice();
      G.palette[editIdx] = v;
      pushUndoEntry({ type: 'palette', before, after: G.palette.slice() });
      buildPaletteUI(); refreshSheet(); rebuildMapBase(); renderAll(); autosave();
    });
    for (let i = 0; i < 16; i++) {
      const sw = el('div', {
        class: 'swatch' + (i === G.color ? ' cur' : '') + (i === 0 ? ' trans' : ''),
        title: '左键选用 #' + i + '\n双击修改颜色' + (i === 0 ? '(下标 0 = 透明)' : ''),
      });
      sw.style.background = cssOf(i);
      sw.addEventListener('click', () => { G.color = i; buildPaletteUI(); updateStatus(); });
      sw.addEventListener('dblclick', () => { editIdx = i; colorInput.value = cssOf(i); colorInput.click(); });
      host.append(sw);
    }
  }

  /* ================= 撤销 / 重做 ================= */
  function snapByType(t) {
    if (t === 'sheet') return G.sheet.slice();
    if (t === 'map') return { w: G.map.w, h: G.map.h, cells: G.map.cells.slice() };
    if (t === 'sprites') return JSON.parse(JSON.stringify(G.sprites));
    if (t === 'palette') return G.palette.slice();
  }
  function snapEqual(t, a, b) {
    if (t === 'sheet' || t === 'palette') {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function applySnap(t, s) {
    if (t === 'multi') { for (const it of s.items) applySnap(it.type, it); return; }
    if (t === 'sheet') G.sheet.set(s);
    else if (t === 'map') { G.map = { w: s.w, h: s.h, cells: s.cells.slice() }; rebuildMapBase(); }
    else if (t === 'sprites') { G.sprites = JSON.parse(JSON.stringify(s)); G.activeSprite = Math.min(G.activeSprite, G.sprites.length - 1); }
    else if (t === 'palette') G.palette = s.slice();
  }
  function pushUndoEntry(entry) {
    undoStack.push(entry);
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    updateUndoBtns();
  }
  let strokeSnap = null;
  function beginStroke(t) { strokeSnap = { type: t, data: snapByType(t) }; }
  function endStroke() {
    if (!strokeSnap) return;
    const t = strokeSnap.type;
    const after = snapByType(t);
    if (!snapEqual(t, strokeSnap.data, after))
      pushUndoEntry({ type: t, before: strokeSnap.data, after });
    strokeSnap = null;
    autosave();
  }
  function undo() {
    const e = undoStack.pop(); if (!e) return;
    applySnap(e.type, e.before); redoStack.push(e);
    afterHistoryJump();
  }
  function redo() {
    const e = redoStack.pop(); if (!e) return;
    applySnap(e.type, e.after); undoStack.push(e);
    afterHistoryJump();
  }
  function afterHistoryJump() {
    updateUndoBtns();
    buildPaletteUI(); refreshSheet(); rebuildMapBase(); renderAll(); autosave();
  }
  function updateUndoBtns() {
    $('btnUndo').disabled = !undoStack.length;
    $('btnRedo').disabled = !redoStack.length;
  }
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);

  /* ================= 页签 ================= */
  for (const b of document.querySelectorAll('#tabs .tab')) {
    b.addEventListener('click', () => setMode(b.dataset.tab));
  }
  function setMode(m) {
    mode = m;
    for (const b of document.querySelectorAll('#tabs .tab'))
      b.classList.toggle('active', b.dataset.tab === m);
    for (const p of document.querySelectorAll('.leftPane'))
      p.style.display = (p.id === 'panel-' + m) ? 'flex' : 'none';
    buildEditTools(); buildZoomRow(); renderAll(); updateStatus();
  }

  /* ================= 中心画布:像素编辑(精灵/Tile)================= */
  function currentRegion() {
    if (mode === 'tile') {
      const t = G.tileIndex;
      return { x: (t % TX) * TILE, y: Math.floor(t / TX) * TILE, w: TILE, h: TILE };
    }
    const s = G.sprites[G.activeSprite];
    if (s) return { x: s.x, y: s.y, w: s.w, h: s.h };
    return { x: 0, y: 0, w: TILE, h: TILE };
  }

  function renderPixelView() {
    const r = currentRegion(), z = pxZoom;
    editCv.width = r.w * z; editCv.height = r.h * z;
    ectx.fillStyle = '#0b0b0e'; ectx.fillRect(0, 0, editCv.width, editCv.height);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const ci = G.sheet[(r.y + y) * SW + r.x + x];
      if (ci) { ectx.fillStyle = cssOf(ci); ectx.fillRect(x * z, y * z, z, z); }
      else if (z >= 6) {
        ectx.fillStyle = ((x + y) & 1) ? '#131318' : '#101015';
        ectx.fillRect(x * z, y * z, z, z);
      }
    }
    if (showPixGrid && z >= 6) {
      ectx.strokeStyle = 'rgba(255,255,255,.08)'; ectx.lineWidth = 1;
      ectx.beginPath();
      for (let x = 1; x < r.w; x++) { ectx.moveTo(x * z + .5, 0); ectx.lineTo(x * z + .5, r.h * z); }
      for (let y = 1; y < r.h; y++) { ectx.moveTo(0, y * z + .5); ectx.lineTo(r.w * z, y * z + .5); }
      ectx.stroke();
    }
    if (mode === 'sprite' && r.w > TILE) {      // 每 8px 淡线提示 tile 边界
      ectx.strokeStyle = 'rgba(126,200,227,.25)';
      ectx.beginPath();
      for (let x = TILE; x < r.w; x += TILE) { ectx.moveTo(x * z + .5, 0); ectx.lineTo(x * z + .5, r.h * z); }
      for (let y = TILE; y < r.h; y += TILE) { ectx.moveTo(0, y * z + .5); ectx.lineTo(r.w * z, y * z + .5); }
      ectx.stroke();
    }
    if (pixPreview) {
      ectx.fillStyle = 'rgba(224,194,108,.65)';
      for (const [x, y] of pixPreview) {
        if (x >= 0 && x < r.w && y >= 0 && y < r.h) ectx.fillRect(x * z + 1, y * z + 1, z - 2, z - 2);
      }
    }
  }

  function editCellAt(e) {
    const r = currentRegion(), rect = editCv.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * r.w);
    const y = Math.floor((e.clientY - rect.top) / rect.height * r.h);
    return [x, y, r];
  }
  const inCell = (x, y, r) => x >= 0 && x < r.w && y >= 0 && y < r.h;
  function putCell(x, y, r, ci) {
    if (inCell(x, y, r)) G.sheet[(r.y + y) * SW + r.x + x] = ci;
  }
  function lineCells(x0, y0, x1, y1) {
    const out = [];
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      out.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return out;
  }
  function rectCells(x0, y0, x1, y1, filled) {
    const out = [];
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
    const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++)
      if (filled || x === xa || x === xb || y === ya || y === yb) out.push([x, y]);
    return out;
  }
  function floodCells(sx, sy, r, ci) {
    const idx = (x, y) => G.sheet[(r.y + y) * SW + r.x + x];
    const t = idx(sx, sy);
    if (t === ci) return;
    const st = [[sx, sy]];
    while (st.length) {
      const [x, y] = st.pop();
      if (!inCell(x, y, r) || idx(x, y) !== t) continue;
      G.sheet[(r.y + y) * SW + r.x + x] = ci;
      st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  let pixDragging = false, pixStart = null, pixLast = null, pixVal = 1, pixPreview = null;

  editCv.addEventListener('contextmenu', (e) => e.preventDefault());
  editCv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { editCv.setPointerCapture(e.pointerId); } catch (err) { /* 非激活指针(合成/嵌入式事件)时忽略 */ }
    if (mode === 'map') return mapDown(e);
    const [x, y, r] = editCellAt(e);
    if (!inCell(x, y, r)) return;
    pixDragging = true; pixStart = [x, y]; pixLast = [x, y];
    pixVal = (pixTool === 'eraser' || e.button === 2) ? 0 : G.color;
    beginStroke('sheet');
    if (pixTool === 'pencil' || pixTool === 'eraser') { putCell(x, y, r, pixVal); renderPixelView(); }
    else if (pixTool === 'fill') { floodCells(x, y, r, pixVal); renderPixelView(); }
    else if (pixTool === 'pick') { G.color = G.sheet[(r.y + y) * SW + r.x + x]; buildPaletteUI(); pixDragging = false; }
    else pixPreview = [[x, y]], renderPixelView();
  });
  editCv.addEventListener('pointermove', (e) => {
    if (mode === 'map') return mapMove(e);
    const [x, y, r] = editCellAt(e);
    if (inCell(x, y, r)) updateStatus(x, y);
    if (!pixDragging) return;
    if (pixTool === 'pencil' || pixTool === 'eraser') {
      for (const [lx, ly] of lineCells(pixLast[0], pixLast[1], x, y)) putCell(lx, ly, r, pixVal);
      pixLast = [x, y];
      renderPixelView();
    } else if (pixStart && (pixTool === 'line' || pixTool === 'rect' || pixTool === 'frect')) {
      pixPreview = pixTool === 'line'
        ? lineCells(pixStart[0], pixStart[1], x, y)
        : rectCells(pixStart[0], pixStart[1], x, y, false);
      renderPixelView();
    }
  });
  editCv.addEventListener('pointerup', (e) => {
    if (mode === 'map') return mapUp(e);
    if (!pixDragging) return;
    pixDragging = false;
    const [x, y, r] = editCellAt(e);
    if (inCell(x, y, r) && (pixTool === 'line' || pixTool === 'rect' || pixTool === 'frect')) {
      const cells = pixTool === 'line'
        ? lineCells(pixStart[0], pixStart[1], x, y)
        : rectCells(pixStart[0], pixStart[1], x, y, pixTool === 'frect');
      for (const [cx, cy] of cells) putCell(cx, cy, r, pixVal);
    }
    pixPreview = null;
    endStroke();
    refreshSheet(); renderAll();
  });
  editCv.addEventListener('pointerleave', () => { if (mode !== 'map') $('st2').textContent = ''; });

  /* ================= 中心画布:地图编辑 ================= */
  function mapCellAt(e) {
    const rect = editCv.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * G.map.w);
    const y = Math.floor((e.clientY - rect.top) / rect.height * G.map.h);
    return [x, y];
  }
  const inMap = (x, y) => x >= 0 && x < G.map.w && y >= 0 && y < G.map.h;
  function cellAt(x, y) { return G.map.cells[y * G.map.w + x]; }
  function setCell(x, y, v) {
    if (!inMap(x, y) || cellAt(x, y) === v) return;
    G.map.cells[y * G.map.w + x] = v;
    patchMapCell(x, y);
  }
  function stampAt(cx, cy, erase) {
    const b = G.brush;
    if (erase) { setCell(cx, cy, EMPTY); return; }
    const flip = (b.fh ? 0x400 : 0) | (b.fv ? 0x800 : 0);
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) {
      const tx = cx + i, ty = cy + j;
      const t = (b.y + j) * TX + (b.x + i);
      if (inMap(tx, ty) && t < TX * TY) setCell(tx, ty, t | flip);
    }
  }
  function floodMap(cx, cy) {
    const b = G.brush;
    const v = ((b.y * TX + b.x) | (b.fh ? 0x400 : 0) | (b.fv ? 0x800 : 0));
    const t = cellAt(cx, cy);
    if (t === v) return;
    const st = [[cx, cy]];
    while (st.length) {
      const [x, y] = st.pop();
      if (!inMap(x, y) || cellAt(x, y) !== t) continue;
      setCell(x, y, v);
      st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  let mapDragging = false, mapStart = null, mapLast = null, mapHover = null, mapDragErase = false;

  function renderMapView() {
    const z = mapZoom;
    editCv.width = G.map.w * TILE * z;
    editCv.height = G.map.h * TILE * z;
    ectx.imageSmoothingEnabled = false;
    ectx.drawImage(mapOff, 0, 0, editCv.width, editCv.height);
    if ($('mapGrid').checked && z >= 2) {
      ectx.strokeStyle = 'rgba(255,255,255,.07)';
      ectx.beginPath();
      for (let x = 1; x < G.map.w; x++) { ectx.moveTo(x * TILE * z + .5, 0); ectx.lineTo(x * TILE * z + .5, editCv.height); }
      for (let y = 1; y < G.map.h; y++) { ectx.moveTo(0, y * TILE * z + .5); ectx.lineTo(editCv.width, y * TILE * z + .5); }
      ectx.stroke();
    }
    /* 悬停幽灵笔刷 / 矩形预览 */
    const drawGhost = (cx, cy) => {
      const b = G.brush, erase = mapTool === 'eraser';
      ectx.fillStyle = erase ? 'rgba(224,108,108,.18)' : 'rgba(255,255,255,.14)';
      ectx.fillRect(cx * TILE * z, cy * TILE * z, b.w * TILE * z, b.h * TILE * z);
      ectx.strokeStyle = erase ? 'rgba(224,108,108,.9)' : 'rgba(255,255,255,.8)';
      ectx.strokeRect(cx * TILE * z + .5, cy * TILE * z + .5, b.w * TILE * z - 1, b.h * TILE * z - 1);
    };
    if (mapTool === 'rect' && mapStart && mapHover) {
      const xa = Math.min(mapStart[0], mapHover[0]), xb = Math.max(mapStart[0], mapHover[0]);
      const ya = Math.min(mapStart[1], mapHover[1]), yb = Math.max(mapStart[1], mapHover[1]);
      ectx.strokeStyle = 'rgba(224,194,108,.9)';
      ectx.strokeRect(xa * TILE * z + .5, ya * TILE * z + .5,
        (xb - xa + 1) * TILE * z - 1, (yb - ya + 1) * TILE * z - 1);
    } else if (mapHover && (mapTool === 'pencil' || mapTool === 'eraser')) {
      drawGhost(mapHover[0], mapHover[1]);
    }
  }

  function mapDown(e) {
    const [x, y] = mapCellAt(e);
    if (!inMap(x, y)) return;
    mapStart = [x, y]; mapLast = [x, y]; mapHover = [x, y];
    const erase = mapTool === 'eraser' || e.button === 2;
    mapDragErase = erase;
    if (mapTool === 'pick' && !erase) {
      const v = cellAt(x, y);
      if (v !== EMPTY) {
        G.brush = { x: (v & 0x3FF) % TX, y: Math.floor((v & 0x3FF) / TX), w: 1, h: 1, fh: !!(v & 0x400), fv: !!(v & 0x800) };
        mapTool = 'pencil'; buildEditTools(); renderBrushPrev();
        toast('已吸取 tile #' + (v & 0x3FF));
      }
      return;
    }
    mapDragging = true;
    beginStroke('map');
    if (mapTool === 'fill' && !erase) floodMap(x, y);
    else if (mapTool !== 'rect') stampAt(x, y, erase);
    renderMapView();
  }
  function mapMove(e) {
    const [x, y] = mapCellAt(e);
    mapHover = inMap(x, y) ? [x, y] : null;
    updateStatus(x, y);
    if (!mapDragging) { if (mode === 'map') renderMapView(); return; }
    const erase = mapDragErase;
    if (mapTool === 'pencil' || mapTool === 'eraser') {
      for (const [lx, ly] of lineCells(mapLast[0], mapLast[1], x, y)) stampAt(lx, ly, erase);
      mapLast = [x, y];
    }
    renderMapView();
  }
  function mapUp(e) {
    if (!mapDragging) return;
    mapDragging = false;
    const [x, y] = mapCellAt(e);
    if (mapTool === 'rect' && inMap(x, y)) {
      const xa = Math.min(mapStart[0], x), xb = Math.max(mapStart[0], x);
      const ya = Math.min(mapStart[1], y), yb = Math.max(mapStart[1], y);
      const b = G.brush;
      const flip = (b.fh ? 0x400 : 0) | (b.fv ? 0x800 : 0);
      for (let cy = ya; cy <= yb; cy++) for (let cx = xa; cx <= xb; cx++) {
        const t = (b.y + (cy - ya) % b.h) * TX + b.x + (cx - xa) % b.w;
        setCell(cx, cy, t | flip);
      }
    }
    endStroke();
    autosave(); renderMapView(); updateMapInfo();
  }

  /* ================= 地图底图(离屏,1×,逐格增量更新)================= */
  function rebuildMapLut() {
    mapLut = new Uint32Array(256).fill(0xFF000000);
    G.palette.forEach((p, i) => {
      const [r, g, b] = rgb565ToRGB(p);
      mapLut[i] = 0xFF000000 | (b << 16) | (g << 8) | r;
    });
  }
  function rebuildMapBase() {
    rebuildMapLut();
    mapOff.width = G.map.w * TILE; mapOff.height = G.map.h * TILE;
    mapImgCtx = mapOff.getContext('2d');
    mapImg = mapImgCtx.createImageData(mapOff.width, mapOff.height);
    for (let cy = 0; cy < G.map.h; cy++) for (let cx = 0; cx < G.map.w; cx++)
      writeMapCell(cx, cy);
    mapImgCtx.putImageData(mapImg, 0, 0);
  }
  function writeMapCell(cx, cy) {
    const px32 = new Uint32Array(mapImg.data.buffer);
    const v = G.map.cells[cy * G.map.w + cx];
    const bx = cx * TILE, by = cy * TILE;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      let c;
      if (v === EMPTY) {
        c = ((x >> 2) + (y >> 2)) & 1 ? 0xFF221b22 : 0xFF191519;
      } else {
        const t = v & 0x3FF;
        const sx = (t % TX) * TILE + ((v & 0x400) ? 7 - x : x);
        const sy = Math.floor(t / TX) * TILE + ((v & 0x800) ? 7 - y : y);
        c = mapLut[G.sheet[sy * SW + sx]];
      }
      px32[(by + y) * mapOff.width + bx + x] = c;
    }
  }
  function patchMapCell(cx, cy) {
    writeMapCell(cx, cy);
    mapImgCtx.putImageData(mapImg, 0, 0, cx * TILE, cy * TILE, TILE, TILE);
  }

  /* ================= 精灵图总览(右栏,三种模式三种交互)================= */
  function refreshSheet() {
    renderIndexed(sheetOff, G.sheet, SW, SH, palRGB());
    renderOverview(); renderBrushPrev(); rebuildSpriteThumbs();
  }
  function renderOverview() {
    const z = ovZoom;
    sheetCv.width = SW * z; sheetCv.height = SH * z;
    shctx.imageSmoothingEnabled = false;
    shctx.fillStyle = '#0b0b0e'; shctx.fillRect(0, 0, sheetCv.width, sheetCv.height);
    shctx.drawImage(sheetOff, 0, 0, sheetCv.width, sheetCv.height);
    if (z >= 2) {
      shctx.strokeStyle = 'rgba(255,255,255,.10)';
      shctx.beginPath();
      for (let x = 1; x < TX; x++) { shctx.moveTo(x * TILE * z + .5, 0); shctx.lineTo(x * TILE * z + .5, sheetCv.height); }
      for (let y = 1; y < TY; y++) { shctx.moveTo(0, y * TILE * z + .5); shctx.lineTo(sheetCv.width, y * TILE * z + .5); }
      shctx.stroke();
    }
    if (mode === 'sprite') {
      G.sprites.forEach((s, i) => {
        shctx.strokeStyle = i === G.activeSprite ? '#e0c26c' : 'rgba(126,200,227,.75)';
        shctx.lineWidth = i === G.activeSprite ? 2 : 1;
        shctx.strokeRect(s.x * z + .5, s.y * z + .5, s.w * z - 1, s.h * z - 1);
      });
      shctx.lineWidth = 1;
    } else if (mode === 'tile') {
      const t = G.tileIndex;
      shctx.strokeStyle = '#e0c26c'; shctx.lineWidth = 2;
      shctx.strokeRect((t % TX) * TILE * z + .5, Math.floor(t / TX) * TILE * z + .5, TILE * z - 1, TILE * z - 1);
      shctx.lineWidth = 1;
    } else {
      const b = G.brush;
      shctx.strokeStyle = '#e0c26c'; shctx.lineWidth = 2;
      shctx.strokeRect(b.x * TILE * z + .5, b.y * TILE * z + .5, b.w * TILE * z - 1, b.h * TILE * z - 1);
      shctx.lineWidth = 1;
    }
  }
  $('ovZoomIn').addEventListener('click', () => { ovZoom = Math.min(3, ovZoom + 1); $('ovZoomLabel').textContent = ovZoom + '×'; renderOverview(); });
  $('ovZoomOut').addEventListener('click', () => { ovZoom = Math.max(1, ovZoom - 1); $('ovZoomLabel').textContent = ovZoom + '×'; renderOverview(); });

  function ovPos(e) {
    const r = sheetCv.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / r.width * SW),
            Math.floor((e.clientY - r.top) / r.height * SH)];
  }
  let ovDragging = false, ovMoveSpr = null, ovBrushAnchor = null;
  sheetCv.addEventListener('contextmenu', (e) => e.preventDefault());
  sheetCv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { sheetCv.setPointerCapture(e.pointerId); } catch (err) { /* 同上 */ }
    const [px, py] = ovPos(e);
    if (mode === 'sprite') {
      let hit = -1;
      for (let i = G.sprites.length - 1; i >= 0; i--) {
        const s = G.sprites[i];
        if (px >= s.x && px < s.x + s.w && py >= s.y && py < s.y + s.h) { hit = i; break; }
      }
      if (hit >= 0) {
        G.activeSprite = hit;
        const s = G.sprites[hit];
        ovMoveSpr = { i: hit, dx: px - s.x, dy: py - s.y, ox: s.x, oy: s.y };
        ovDragging = true;
        beginStroke('sprites');
        refreshSpritePanel(); renderAll();
      }
    } else if (mode === 'tile') {
      G.tileIndex = Math.min(TY - 1, Math.floor(py / TILE)) * TX + Math.min(TX - 1, Math.floor(px / TILE));
      refreshTilePanel(); renderAll();
    } else {
      ovBrushAnchor = [Math.floor(px / TILE), Math.floor(py / TILE)];
      G.brush.x = ovBrushAnchor[0]; G.brush.y = ovBrushAnchor[1];
      G.brush.w = 1; G.brush.h = 1;
      ovDragging = true;
      renderOverview(); renderBrushPrev();
    }
  });
  sheetCv.addEventListener('pointermove', (e) => {
    if (!ovDragging) return;
    const [px, py] = ovPos(e);
    if (mode === 'sprite' && ovMoveSpr) {
      const s = G.sprites[ovMoveSpr.i];
      let nx = px - ovMoveSpr.dx, ny = py - ovMoveSpr.dy;
      if (e.shiftKey) { nx = Math.round(nx / TILE) * TILE; ny = Math.round(ny / TILE) * TILE; }
      s.x = Math.max(0, Math.min(SW - s.w, nx));
      s.y = Math.max(0, Math.min(SH - s.h, ny));
      renderOverview(); renderPixelView(); refreshSpritePanel(false);
    } else if (mode === 'map' && ovBrushAnchor) {
      const tx = Math.max(0, Math.min(TX - 1, Math.floor(px / TILE)));
      const ty = Math.max(0, Math.min(TY - 1, Math.floor(py / TILE)));
      G.brush.x = Math.min(ovBrushAnchor[0], tx);
      G.brush.y = Math.min(ovBrushAnchor[1], ty);
      G.brush.w = Math.abs(tx - ovBrushAnchor[0]) + 1;
      G.brush.h = Math.abs(ty - ovBrushAnchor[1]) + 1;
      renderOverview(); renderBrushPrev();
    }
  });
  sheetCv.addEventListener('pointerup', () => {
    if (!ovDragging) return;
    ovDragging = false;
    if (mode === 'sprite' && ovMoveSpr) {
      const s = G.sprites[ovMoveSpr.i];
      if (s.x !== ovMoveSpr.ox || s.y !== ovMoveSpr.oy) { endStroke(); refreshSpritePanel(); }
      ovMoveSpr = null;
    }
  });

  /* ================= 笔刷预览 ================= */
  function renderBrushPrev() {
    const b = G.brush;
    const pw = b.w * TILE, ph = b.h * TILE;
    const z = Math.max(1, Math.min(6, Math.floor(96 / Math.max(pw, ph))));
    brushCv.width = pw * z; brushCv.height = ph * z;
    bctx.imageSmoothingEnabled = false;
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) {
      const t = (b.y + j) * TX + (b.x + i);
      bctx.save();
      bctx.translate((i + (b.fh ? 1 : 0)) * TILE * z, (j + (b.fv ? 1 : 0)) * TILE * z);
      bctx.scale(b.fh ? -1 : 1, b.fv ? -1 : 1);
      bctx.drawImage(sheetOff, (t % TX) * TILE, Math.floor(t / TX) * TILE, TILE, TILE,
        0, 0, TILE * z, TILE * z);
      bctx.restore();
    }
    $('brushDesc').innerHTML = mode === 'map'
      ? '笔刷 <b>' + b.w + '×' + b.h + '</b> tile<br>起点 tile #' + (b.y * TX + b.x) +
        (b.fh ? ' · H' : '') + (b.fv ? ' · V' : '')
      : (mode === 'tile'
        ? 'Tile <b>#' + G.tileIndex + '</b><br>(' + (G.tileIndex % TX) + ', ' + Math.floor(G.tileIndex / TX) + ')'
        : '精灵图选区');
    if (mode !== 'map') {
      /* tile/精灵模式:预览区改为显示当前编辑区缩略 */
      const r = currentRegion();
      const z2 = Math.max(1, Math.min(6, Math.floor(96 / Math.max(r.w, r.h))));
      brushCv.width = r.w * z2; brushCv.height = r.h * z2;
      bctx.imageSmoothingEnabled = false;
      bctx.drawImage(sheetOff, r.x, r.y, r.w, r.h, 0, 0, r.w * z2, r.h * z2);
      $('brushDesc').innerHTML = mode === 'tile'
        ? 'Tile <b>#' + G.tileIndex + '</b><br>(' + (G.tileIndex % TX) + ', ' + Math.floor(G.tileIndex / TX) + ')'
        : '编辑区 <b>' + r.w + '×' + r.h + '</b><br>(' + r.x + ', ' + r.y + ')';
    }
  }

  /* ================= 精灵面板 ================= */
  function rebuildSpriteThumbs() {
    for (const cv of document.querySelectorAll('#sprList canvas'))
      drawSpriteThumb(cv);
  }
  function drawSpriteThumb(cv) {
    const i = +cv.dataset.i, s = G.sprites[i];
    if (!s) return;
    const z = Math.max(1, Math.floor(24 / Math.max(s.w, s.h)));
    cv.width = s.w * z; cv.height = s.h * z;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(sheetOff, s.x, s.y, s.w, s.h, 0, 0, s.w * z, s.h * z);
  }
  function refreshSpritePanel(rebuildList = true) {
    if (rebuildList) {
      const list = $('sprList');
      list.textContent = '';
      G.sprites.forEach((s, i) => {
        list.append(el('div', {
          class: 'gitem' + (i === G.activeSprite ? ' sel' : ''),
          onclick: () => { G.activeSprite = i; refreshSpritePanel(); renderAll(); },
        },
          el('canvas', { 'data-i': i }),
          el('span', { class: 'txt' }, s.name),
          el('span', { class: 'code' }, s.w + '×' + s.h)));
      });
      $('sprCount').textContent = G.sprites.length + ' 个';
    }
    rebuildSpriteThumbs();
    const props = $('sprProps');
    props.textContent = '';
    const s = G.sprites[G.activeSprite];
    if (!s) {
      props.append(el('div', { class: 'kv' }, '无选中精灵'));
      return;
    }
    const mk = (label, key, min, max, step, isWH) => {
      const inp = el('input', { type: 'number', value: s[key], min, max, step });
      inp.style.width = '58px';
      inp.addEventListener('focus', () => { inp.dataset.prev = s[key]; });
      inp.addEventListener('change', () => {
        let v = Math.round(+inp.value || 0);
        if (isWH) v = Math.max(8, Math.round(v / 8) * 8);
        v = Math.max(min, Math.min(max, v));
        const before = JSON.parse(JSON.stringify(G.sprites));
        s[key] = v;
        if (key === 'w') s.x = Math.min(s.x, SW - s.w);
        if (key === 'h') s.y = Math.min(s.y, SH - s.h);
        if (key === 'x') s.x = Math.min(s.x, SW - s.w);
        if (key === 'y') s.y = Math.min(s.y, SH - s.h);
        inp.value = s[key];
        pushUndoEntry({ type: 'sprites', before, after: JSON.parse(JSON.stringify(G.sprites)) });
        refreshSpritePanel(); renderAll(); autosave();
      });
      return el('label', { class: 'kv' }, label + ' ', inp);
    };
    const name = el('input', { type: 'text', value: s.name });
    name.style.width = '100%';
    name.addEventListener('focus', () => { name.dataset.prev = s.name; });
    name.addEventListener('change', () => {
      const before = JSON.parse(JSON.stringify(G.sprites));
      s.name = name.value || s.name;
      pushUndoEntry({ type: 'sprites', before, after: JSON.parse(JSON.stringify(G.sprites)) });
      refreshSpritePanel(); autosave();
    });
    const row = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' });
    row.append(mk('X', 'x', 0, SW - 8, 1), mk('Y', 'y', 0, SH - 8, 1),
      mk('宽', 'w', 8, 256, 8, true), mk('高', 'h', 8, 256, 8, true));
    const ops = el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;' });
    const op = (label, fn) => {
      const b = el('button', { class: 'btn' }, label);
      b.addEventListener('click', fn); ops.append(b);
    };
    op('↔ 翻转', () => flipRegion(s.x, s.y, s.w, s.h, true, false));
    op('↕ 翻转', () => flipRegion(s.x, s.y, s.w, s.h, false, true));
    op('↻ 旋转', () => { if (s.w === s.h) rotateRegion(s.x, s.y, s.w); else toast('仅正方形精灵可旋转', true); });
    op('清空', () => clearRegion(s.x, s.y, s.w, s.h));
    props.append(el('div', { class: 'kv' }, '名称'), name, row, ops);
  }
  $('sprNew').addEventListener('click', () => {
    dialog((dlg, close) => {
      const name = el('input', { type: 'text', value: '精灵' + (G.sprites.length + 1) });
      const w = el('select');
      for (let i = 1; i <= 8; i++) w.append(el('option', { value: i * 8 }, i * 8 + ' px'));
      const h = el('select');
      for (let i = 1; i <= 8; i++) h.append(el('option', { value: i * 8 }, i * 8 + ' px'));
      w.value = '16'; h.value = '16';
      dlg.append(el('h3', {}, '新建精灵'),
        el('div', { class: 'row' }, el('span', { class: 'kv' }, '名称'), name),
        el('div', { class: 'row' }, el('span', { class: 'kv' }, '宽'), w,
          el('span', { class: 'kv' }, '高'), h),
        el('div', { class: 'kv' }, '将自动放置在精灵图首个空闲位置'),
        el('div', { class: 'foot' },
          el('button', { class: 'btn', onclick: close }, '取消'),
          el('button', {
            class: 'btn primary',
            onclick: () => {
              const sw = +w.value, sh2 = +h.value;
              const spot = findFreeSpot(sw, sh2);
              if (!spot) { toast('精灵图 256×256 内找不到空闲位置', true); return; }
              const before = JSON.parse(JSON.stringify(G.sprites));
              G.sprites.push({ name: name.value || '精灵', x: spot[0], y: spot[1], w: sw, h: sh2 });
              G.activeSprite = G.sprites.length - 1;
              pushUndoEntry({ type: 'sprites', before, after: JSON.parse(JSON.stringify(G.sprites)) });
              close(); refreshSpritePanel(); renderAll(); autosave();
            },
          }, '创建')));
    });
  });
  function findFreeSpot(w, h) {
    for (let y = 0; y + h <= SH; y += 8) for (let x = 0; x + w <= SW; x += 8) {
      const clash = G.sprites.some((s) => x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y);
      if (!clash) return [x, y];
    }
    return null;
  }
  $('sprDup').addEventListener('click', () => {
    const s = G.sprites[G.activeSprite];
    if (!s) return;
    const spot = findFreeSpot(s.w, s.h);
    if (!spot) return toast('无空闲位置', true);
    const sprBefore = JSON.parse(JSON.stringify(G.sprites));
    const sheetBefore = G.sheet.slice();
    const ns = { name: s.name + ' 副本', x: spot[0], y: spot[1], w: s.w, h: s.h };
    G.sprites.push(ns);
    for (let row = 0; row < s.h; row++)
      G.sheet.copyWithin((ns.y + row) * SW + ns.x, (s.y + row) * SW + s.x,
        (s.y + row) * SW + s.x + s.w);
    G.activeSprite = G.sprites.length - 1;
    pushUndoEntry({ type: 'multi', items: [
      { type: 'sheet', before: sheetBefore, after: G.sheet.slice() },
      { type: 'sprites', before: sprBefore, after: JSON.parse(JSON.stringify(G.sprites)) },
    ] });
    refreshSheet(); refreshSpritePanel(); renderAll(); autosave();
    toast('已复制精灵(像素已拷贝到新位置)');
  });
  $('sprDel').addEventListener('click', () => {
    if (G.activeSprite < 0) return;
    if (!confirm('删除精灵定义?(精灵图上的像素会保留)')) return;
    const before = JSON.parse(JSON.stringify(G.sprites));
    G.sprites.splice(G.activeSprite, 1);
    G.activeSprite = Math.min(G.activeSprite, G.sprites.length - 1);
    pushUndoEntry({ type: 'sprites', before, after: JSON.parse(JSON.stringify(G.sprites)) });
    refreshSpritePanel(); renderAll(); autosave();
  });

  /* —— 区域操作(sheet 上,带撤销)—— */
  function regionOp(fn) {
    beginStroke('sheet');
    fn();
    endStroke();
    refreshSheet(); renderAll();
  }
  function flipRegion(x, y, w, h, fh, fv) {
    regionOp(() => {
      const tmp = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const si = (y + j) * SW + x + i;
        const di = (y + (fv ? h - 1 - j : j)) * SW + x + (fh ? w - 1 - i : i);
        tmp[di - (y * SW + x)] = G.sheet[si];
      }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++)
        G.sheet[(y + j) * SW + x + i] = tmp[j * w + i];
    });
  }
  function rotateRegion(x, y, size) {
    regionOp(() => {
      const src = new Uint8Array(size * size);
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++)
        src[j * size + i] = G.sheet[(y + j) * SW + x + i];
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++)
        G.sheet[(y + j) * SW + x + i] = src[(size - 1 - i) * size + j];   // 顺时针
    });
  }
  function clearRegion(x, y, w, h) {
    regionOp(() => {
      for (let j = 0; j < h; j++) G.sheet.fill(0, (y + j) * SW + x, (y + j) * SW + x + w);
    });
  }

  /* ================= Tile 面板 ================= */
  function refreshTilePanel() {
    $('tileIdx').value = G.tileIndex;
    $('tilePos').textContent = '第 (' + (G.tileIndex % TX) + ', ' + Math.floor(G.tileIndex / TX) + ') 格 · 精灵图像素 (' +
      (G.tileIndex % TX) * TILE + ', ' + Math.floor(G.tileIndex / TX) * TILE + ')';
  }
  $('tilePrev').addEventListener('click', () => { G.tileIndex = (G.tileIndex + TX * TY - 1) % (TX * TY); refreshTilePanel(); renderAll(); });
  $('tileNext').addEventListener('click', () => { G.tileIndex = (G.tileIndex + 1) % (TX * TY); refreshTilePanel(); renderAll(); });
  $('tileIdx').addEventListener('change', () => {
    G.tileIndex = Math.max(0, Math.min(TX * TY - 1, Math.round(+$('tileIdx').value || 0)));
    refreshTilePanel(); renderAll();
  });
  for (const b of document.querySelectorAll('.opTile')) {
    b.addEventListener('click', () => {
      const t = G.tileIndex, x = (t % TX) * TILE, y = Math.floor(t / TX) * TILE;
      const op = b.dataset.op;
      if (op === 'fliph') flipRegion(x, y, TILE, TILE, true, false);
      else if (op === 'flipv') flipRegion(x, y, TILE, TILE, false, true);
      else if (op === 'rotl') { rotateRegion(x, y, TILE); rotateRegion(x, y, TILE); rotateRegion(x, y, TILE); }
      else if (op === 'rotr') rotateRegion(x, y, TILE);
      else if (op === 'clear') clearRegion(x, y, TILE, TILE);
      else if (op === 'copy') {
        tileClip = new Uint8Array(TILE * TILE);
        for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++)
          tileClip[j * TILE + i] = G.sheet[(y + j) * SW + x + i];
        toast('tile 已复制');
      } else if (op === 'paste') {
        if (!tileClip) return toast('tile 剪贴板为空', true);
        regionOp(() => {
          for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++)
            G.sheet[(y + j) * SW + x + i] = tileClip[j * TILE + i];
        });
      }
    });
  }

  /* ================= 地图面板 ================= */
  const MAP_TOOLS = [['pencil', '画笔'], ['eraser', '橡皮'], ['fill', '填充'],
    ['rect', '矩形'], ['pick', '吸管']];
  const mapToolsEl = $('mapTools');
  for (const [id, label] of MAP_TOOLS) {
    const b = el('button', { class: 'btn', 'data-mtool': id }, label);
    b.addEventListener('click', () => { mapTool = id; buildEditTools(); renderMapView(); });
    mapToolsEl.append(b);
  }
  $('mapFlipH').addEventListener('change', () => { G.brush.fh = $('mapFlipH').checked; renderBrushPrev(); renderMapView(); });
  $('mapFlipV').addEventListener('change', () => { G.brush.fv = $('mapFlipV').checked; renderBrushPrev(); renderMapView(); });
  $('mapGrid').addEventListener('change', renderMapView);
  $('mapClear').addEventListener('click', () => {
    if (!confirm('清空整张地图?')) return;
    beginStroke('map');
    G.map.cells.fill(EMPTY);
    rebuildMapBase();
    endStroke(); renderMapView(); updateMapInfo(); autosave();
  });
  $('mapFill').addEventListener('click', () => {
    if (!confirm('用当前笔刷平铺整张地图?')) return;
    beginStroke('map');
    const b = G.brush, flip = (b.fh ? 0x400 : 0) | (b.fv ? 0x800 : 0);
    for (let cy = 0; cy < G.map.h; cy++) for (let cx = 0; cx < G.map.w; cx++)
      G.map.cells[cy * G.map.w + cx] = ((b.y + cy % b.h) * TX + b.x + cx % b.w) | flip;
    rebuildMapBase();
    endStroke(); renderMapView(); updateMapInfo(); autosave();
  });
  $('mapResize').addEventListener('click', () => {
    dialog((dlg, close) => {
      const w = el('input', { type: 'number', value: G.map.w, min: 1, max: 256 });
      const h = el('input', { type: 'number', value: G.map.h, min: 1, max: 256 });
      dlg.append(el('h3', {}, '调整地图尺寸(单位:tile)'),
        el('div', { class: 'row' }, el('span', { class: 'kv' }, '宽'), w,
          el('span', { class: 'kv' }, '高'), h),
        el('div', { class: 'kv' }, '现有内容保留在左上角,扩出的格为空'),
        el('div', { class: 'foot' },
          el('button', { class: 'btn', onclick: close }, '取消'),
          el('button', {
            class: 'btn primary',
            onclick: () => {
              const nw = Math.max(1, Math.min(256, Math.round(+w.value || 1)));
              const nh = Math.max(1, Math.min(256, Math.round(+h.value || 1)));
              beginStroke('map');
              const cells = new Uint16Array(nw * nh).fill(EMPTY);
              for (let y = 0; y < Math.min(nh, G.map.h); y++)
                for (let x = 0; x < Math.min(nw, G.map.w); x++)
                  cells[y * nw + x] = G.map.cells[y * G.map.w + x];
              G.map = { w: nw, h: nh, cells };
              rebuildMapBase();
              endStroke(); renderMapView(); updateMapInfo(); autosave();
              close();
            },
          }, '应用')));
    });
  });
  function updateMapInfo() {
    let used = 0;
    for (const c of G.map.cells) if (c !== EMPTY) used++;
    $('mapInfo').textContent = G.map.w + '×' + G.map.h + ' · ' + used + ' 格已用';
  }

  /* ================= 工具行 / 缩放行 ================= */
  function buildEditTools() {
    const row = $('editTools');
    row.textContent = '';
    if (mode === 'map') {
      for (const [id, label] of MAP_TOOLS) {
        const b = el('button', { class: 'btn' + (mapTool === id ? ' active' : '') }, label);
        b.addEventListener('click', () => { mapTool = id; buildEditTools(); renderMapView(); });
        row.append(b);
      }
      row.append(el('span', { class: 'label' }, '右键 = 橡皮 · 在右侧精灵图拖选笔刷'));
      /* 左栏同名工具按钮同步选中态 */
      for (const b of mapToolsEl.querySelectorAll('[data-mtool]'))
        b.classList.toggle('active', b.dataset.mtool === mapTool);
      return;
    }
    const tools = [['pencil', '铅笔(B)'], ['eraser', '橡皮(E)'], ['line', '直线(L)'],
      ['rect', '矩形(R)'], ['frect', '实心矩形'], ['fill', '填充(F)'], ['pick', '吸管(I)']];
    for (const [id, label] of tools) {
      const b = el('button', { class: 'btn' + (pixTool === id ? ' active' : '') },
        label.replace(/\(.*/, ''));
      b.title = label;
      b.addEventListener('click', () => { pixTool = id; buildEditTools(); });
      row.append(b);
    }
    const r = currentRegion();
    row.append(el('span', { class: 'label' },
      mode === 'tile' ? 'Tile #' + G.tileIndex : '精灵 ' + (G.sprites[G.activeSprite] ? G.sprites[G.activeSprite].name : '无')));
    row.append(el('span', { class: 'label' }, '右键 = 画透明'));
  }
  function buildZoomRow() {
    const row = $('zoomRow');
    row.textContent = '';
    const zm = mode === 'map' ? 'mapZoom' : 'pxZoom';
    const zo = () => mode === 'map' ? mapZoom : pxZoom;
    const bMinus = el('button', { class: 'btn icon' }, '−');
    const bPlus = el('button', { class: 'btn icon' }, '+');
    const lab = el('span', { class: 'kv' }, zo() + '×');
    const setZ = (v) => {
      if (mode === 'map') mapZoom = Math.max(1, Math.min(8, v));
      else pxZoom = Math.max(4, Math.min(40, v));
      lab.textContent = zo() + '×';
      renderAll();
    };
    bMinus.addEventListener('click', () => setZ(zo() - (mode === 'map' ? 1 : 2)));
    bPlus.addEventListener('click', () => setZ(zo() + (mode === 'map' ? 1 : 2)));
    row.append(el('span', { class: 'label' }, '缩放'), bMinus, lab, bPlus);
    if (mode !== 'map') {
      const g = el('button', { class: 'btn' + (showPixGrid ? ' active' : '') }, '网格(G)');
      g.addEventListener('click', () => { showPixGrid = !showPixGrid; buildZoomRow(); renderPixelView(); });
      row.append(g);
    } else {
      const fit = el('button', { class: 'btn' }, '适合窗口');
      fit.addEventListener('click', () => {
        const sc = $('editScroll');
        const z = Math.max(1, Math.floor(Math.min(
          (sc.clientWidth - 20) / (G.map.w * TILE), (sc.clientHeight - 20) / (G.map.h * TILE))));
        mapZoom = Math.min(8, z); buildZoomRow(); renderAll();
      });
      row.append(fit);
    }
  }

  /* ================= 渲染总入口 ================= */
  function renderAll() {
    if (mode === 'map') { renderMapView(); updateMapInfo(); }
    else renderPixelView();
    renderOverview(); renderBrushPrev();
  }

  /* ================= 导入 / 导出 ================= */
  function projectObj() {
    return {
      format: 'aether-gfx-project', version: 1,
      palette: G.palette.slice(),
      sheet: { w: SW, h: SH, data: b64FromBytes(G.sheet) },
      sprites: JSON.parse(JSON.stringify(G.sprites)),
      map: { w: G.map.w, h: G.map.h, cells: b64FromBytes(new Uint8Array(G.map.cells.buffer.slice(0))) },
    };
  }
  function loadProject(o) {
    if (!o || !o.sheet) throw new Error('不是有效的项目文件');
    G = {
      palette: (o.palette || DEFAULT_HEX.map(rgb565FromHex)).slice(0, 16),
      sheet: bytesFromB64(o.sheet.data),
      sprites: o.sprites || [],
      map: { w: o.map.w, h: o.map.h, cells: new Uint16Array(o.map.w * o.map.h) },
      color: 1, activeSprite: o.sprites && o.sprites.length ? 0 : -1, tileIndex: 0,
      brush: { x: 0, y: 0, w: 1, h: 1, fh: false, fv: false },
    };
    const mc = bytesFromB64(o.map.cells);
    for (let i = 0; i < G.map.cells.length && i * 2 + 1 < mc.length; i++)
      G.map.cells[i] = mc[i * 2] | (mc[i * 2 + 1] << 8);
    undoStack.length = redoStack.length = 0;
  }
  function mapBin() {
    const u8 = new Uint8Array(4 + 1 + 2 + 2 + G.map.cells.length * 2);
    let o = 0;
    for (const ch of 'AMAP') u8[o++] = ch.charCodeAt(0);
    u8[o++] = 1;
    u8[o++] = G.map.w & 255; u8[o++] = G.map.w >> 8;
    u8[o++] = G.map.h & 255; u8[o++] = G.map.h >> 8;
    for (const v of G.map.cells) { u8[o++] = v & 255; u8[o++] = v >> 8; }
    return u8;
  }
  function sheetPngCanvas() {
    const cv = document.createElement('canvas');
    renderIndexed(cv, G.sheet, SW, SH, palRGB());
    return cv;
  }

  const ioActions = [
    ['导入项目(.json)', async () => {
      const f = await pickFile('.json');
      if (!f) return;
      try {
        loadProject(JSON.parse(new TextDecoder().decode(new Uint8Array(f.data))));
        afterLoad(); toast('项目已导入');
      } catch (err) { toast('导入失败:' + err.message, true); }
    }],
    ['导出项目(.json)', () => {
      download('project.aethergfx.json', JSON.stringify(projectObj()), 'application/json');
      toast('项目已导出');
    }],
    null,
    ['导入精灵图 PNG(量化到调色板)', async () => {
      const f = await pickFile('.png');
      if (!f) return;
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([f.data]));
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = SW; cv.height = SH;
      const c = cv.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.drawImage(img, 0, 0, SW, SH);
      const data = c.getImageData(0, 0, SW, SH).data;
      const pal = palRGB();
      beginStroke('sheet');
      let miss = 0;
      for (let i = 0; i < SW * SH; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        let best = 0, bd = Infinity;
        for (let p = 0; p < pal.length; p++) {
          const dr = r - pal[p][0], dg = g - pal[p][1], db = b - pal[p][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; best = p; }
        }
        if (bd > 8) miss++;
        G.sheet[i] = best;
      }
      endStroke();
      refreshSheet(); rebuildMapBase(); renderAll();
      toast('PNG 已量化导入' + (miss ? '(' + miss + ' 像素就近取色)' : '(全部精确匹配)'));
    }],
    ['导出精灵图 PNG', () => {
      sheetPngCanvas().toBlob((b) => download('spritesheet.png', b));
      toast('spritesheet.png 已导出');
    }],
    ['导出精灵图 spritesheet.bin', () => {
      const u8 = new Uint8Array(4 + 1 + 2 + 2 + SW * SH);
      let o = 0;
      for (const ch of 'ASPR') u8[o++] = ch.charCodeAt(0);
      u8[o++] = 1; u8[o++] = SW & 255; u8[o++] = SW >> 8; u8[o++] = SH & 255; u8[o++] = SH >> 8;
      u8.set(G.sheet, o);
      download('spritesheet.bin', u8);
      toast('spritesheet.bin 已导出(' + u8.length + ' 字节)');
    }],
    null,
    ['导出地图 map.json', () => {
      const obj = { format: 'aether-map', version: 1, w: G.map.w, h: G.map.h,
        cells: b64FromBytes(new Uint8Array(G.map.cells.buffer.slice(0))) };
      download('map.json', JSON.stringify(obj), 'application/json');
      toast('map.json 已导出');
    }],
    ['导出地图 map.bin', () => { download('map.bin', mapBin()); toast('map.bin 已导出(' + mapBin().length + ' 字节)'); }],
    ['导入地图(.json / map.bin)', async () => {
      const f = await pickFile('.json,.bin');
      if (!f) return;
      try {
        const u8 = new Uint8Array(f.data);
        let w, h, cells;
        if (u8[0] === 65 && u8[1] === 77 && u8[2] === 65 && u8[3] === 80) {
          w = u8[5] | (u8[6] << 8); h = u8[7] | (u8[8] << 8);
          cells = new Uint16Array(w * h);
          for (let i = 0; i < cells.length; i++) cells[i] = u8[9 + i * 2] | (u8[10 + i * 2] << 8);
        } else {
          const o = JSON.parse(new TextDecoder().decode(u8));
          w = o.w; h = o.h;
          const b = bytesFromB64(o.cells);
          cells = new Uint16Array(w * h);
          for (let i = 0; i < cells.length; i++) cells[i] = b[i * 2] | (b[i * 2 + 1] << 8);
        }
        if (w < 1 || h < 1 || w > 256 || h > 256) throw new Error('尺寸非法');
        beginStroke('map');
        G.map = { w, h, cells };
        rebuildMapBase();
        endStroke(); renderAll(); autosave();
        toast('地图已导入(' + w + '×' + h + ')');
      } catch (err) { toast('导入失败:' + err.message, true); }
    }],
  ];

  $('ioBtn').addEventListener('click', (e) => {
    const pop = el('div', { class: 'pop' });
    for (const a of ioActions) {
      if (!a) { pop.append(el('div', { style: 'height:1px;background:var(--line);margin:2px 4px;' })); continue; }
      const b = el('button', { class: 'btn' }, a[0]);
      b.addEventListener('click', () => { pop.remove(); a[1](); });
      pop.append(b);
    }
    $('ioMenu').append(pop);
    const close = (ev) => {
      if (!pop.contains(ev.target) && ev.target !== $('ioBtn')) { pop.remove(); removeEventListener('pointerdown', close); }
    };
    setTimeout(() => addEventListener('pointerdown', close), 0);
  });

  $('btnNew').addEventListener('click', () => {
    if (!confirm('新建项目将清空当前精灵图 / 地图 / 精灵列表(草稿一并清除),继续?')) return;
    newProject();
    undoStack.length = redoStack.length = 0;
    draft.clear('aethergfx.draft');
    afterLoad();
    toast('已新建项目');
  });

  function afterLoad() {
    updateUndoBtns();
    buildPaletteUI();
    rebuildMapBase();
    refreshSheet();
    refreshSpritePanel();
    refreshTilePanel();
    updateMapInfo();
    buildEditTools(); buildZoomRow();
    renderAll(); updateStatus();
    autosave();
  }

  /* ================= 状态栏 / 快捷键 ================= */
  function updateStatus(x, y) {
    if (mode === 'map') {
      $('st1').textContent = '地图 ' + G.map.w + '×' + G.map.h;
      if (x !== undefined && inMap(x, y)) {
        const v = cellAt(x, y);
        $('st2').textContent = '格 (' + x + ',' + y + ')';
        $('st3').innerHTML = v === EMPTY ? '空' :
          'tile <b>#' + (v & 0x3FF) + '</b>' + (v & 0x400 ? ' H' : '') + (v & 0x800 ? ' V' : '');
      }
      return;
    }
    const r = currentRegion();
    $('st1').textContent = mode === 'tile' ? 'Tile #' + G.tileIndex
      : '精灵 ' + (G.sprites[G.activeSprite] ? G.sprites[G.activeSprite].name + ' ' + G.sprites[G.activeSprite].w + '×' + G.sprites[G.activeSprite].h : '无');
    if (x !== undefined && x >= 0 && x < r.w && y !== undefined && y >= 0 && y < r.h) {
      $('st2').textContent = '像素 (' + (r.x + x) + ',' + (r.y + y) + ')';
      $('st3').innerHTML = '颜色 <b>#' + G.sheet[(r.y + y) * SW + r.x + x] + '</b> / 当前 #' + G.color;
    }
  }
  addEventListener('keydown', (e) => {
    const t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault(); e.shiftKey ? redo() : undo(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    const k = e.key.toLowerCase();
    const map = { b: 'pencil', e: 'eraser', l: 'line', r: 'rect', f: 'fill', i: 'pick' };
    if (map[k] && k !== 'r') {
      if (mode === 'map') { if (map[k] !== 'line' && map[k] !== 'i' || map[k] === 'i') mapTool = map[k] === 'i' ? 'pick' : map[k]; }
      else pixTool = map[k];
      buildEditTools(); return;
    }
    if (k === 'g') {
      if (mode === 'map') { $('mapGrid').checked = !$('mapGrid').checked; renderMapView(); }
      else { showPixGrid = !showPixGrid; buildZoomRow(); renderPixelView(); }
    }
  });

  /* ================= 草稿 ================= */
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => draft.save('aethergfx.draft', projectObj()), 800);
  }

  /* ================= 启动 ================= */
  const d = draft.load('aethergfx.draft');
  let restored = false;
  if (d && d.sheet) {
    try { loadProject(d); restored = true; } catch (e) { newProject(); }
  } else newProject();
  afterLoad();
  if (restored) toast('已恢复上次草稿(新建项目可清空重来)');
})();
