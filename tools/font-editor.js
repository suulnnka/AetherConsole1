/*
 * tools/font-editor.js — 12px 位图字体编辑器(规格 §11.3)
 * 字形网格 14×14:主区 12×12(内容 11px + 第 12 行/列作 1px 间隔),
 *   左侧 2 列为"入侵区"(渲染时向左溢出 2px,压入前一字符的间隔),
 *   下侧 2 行为"尾部区"(渲染时向下溢出 2px,压入下一行的间隔)。
 * 行高 12,固定步进 12;导出 JSON / font.bin(AFNT)。
 */
(function () {
  'use strict';
  const { el, toast, download, pickFile, dialog, draft } = window.AC;

  const GW = 14, GH = 14;          // 编辑网格(含入侵与尾部)
  const MAIN = 12;                 // 主区 12×12
  const INV = 2;                   // 左侧入侵列数
  const ADV = 12, LH = 12;         // 步进 / 行高

  /* —— 状态 —— */
  let glyphs = new Map();          // 码点 → Uint16Array(14),bit0..13 = 网格第 0..13 列
  let curCP = 65;
  let tool = 'pencil';
  let zoom = 26;
  let drawVal = 1;                 // 本次描画的值(右键=0)
  let undoStack = [], redoStack = [];
  let clipboard = null;
  let saveTimer = 0;

  const $ = (id) => document.getElementById(id);
  const glyphCv = $('glyph'), stripCv = $('strip'), prevCv = $('preview');
  const gctx = glyphCv.getContext('2d'), sctx = stripCv.getContext('2d'),
        pctx = prevCv.getContext('2d');

  const cur = () => glyphs.get(curCP) || newGlyph();
  function newGlyph() { return new Uint16Array(GH); }
  const getBit = (g, x, y) => (g[y] >> x) & 1;
  const setBit = (g, x, y, v) => { if (v) g[y] |= 1 << x; else g[y] &= ~(1 << x); };

  /* ================= 字形画布 ================= */

  function renderGlyph(preview) {
    const z = zoom, g = cur();
    glyphCv.width = GW * z; glyphCv.height = GH * z;
    const c = gctx;
    c.fillStyle = '#101015'; c.fillRect(0, 0, GW * z, GH * z);
    /* 区域底色:入侵区(左2列)/ 间隔行(11)/ 间隔列(13)/ 尾部区(下2行) */
    c.fillStyle = 'rgba(126,200,227,.10)'; c.fillRect(0, 0, INV * z, GH * z);
    c.fillStyle = 'rgba(224,108,108,.10)'; c.fillRect(0, MAIN * z, GW * z, (GH - MAIN) * z);
    c.fillStyle = 'rgba(0,0,0,.30)';
    c.fillRect((INV + 11) * z, 0, z, MAIN * z);          // 主区第 12 列 = 间隔列
    c.fillRect(INV * z, 11 * z, MAIN * z, z);            // 主区第 12 行 = 间隔行
    /* 像素 */
    c.fillStyle = $('fgColor').value;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (getBit(g, x, y)) c.fillRect(x * z, y * z, z, z);
    }
    /* 预览叠加(直线/矩形拖拽中) */
    if (preview) {
      c.fillStyle = 'rgba(224,194,108,.75)';
      for (const [x, y] of preview) c.fillRect(x * z + 1, y * z + 1, z - 2, z - 2);
    }
    /* 网格线 */
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1;
    c.beginPath();
    for (let x = 1; x < GW; x++) { c.moveTo(x * z + .5, 0); c.lineTo(x * z + .5, GH * z); }
    for (let y = 1; y < GH; y++) { c.moveTo(0, y * z + .5); c.lineTo(GW * z, y * z + .5); }
    c.stroke();
    /* 区域边界 */
    c.strokeStyle = 'rgba(126,200,227,.8)'; c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(INV * z + .5, 0); c.lineTo(INV * z + .5, GH * z); c.stroke();
    c.strokeStyle = 'rgba(224,108,108,.8)';
    c.beginPath(); c.moveTo(0, MAIN * z + .5); c.lineTo(GW * z, MAIN * z + .5); c.stroke();
    c.setLineDash([]);
    c.strokeStyle = 'rgba(255,255,255,.25)';
    c.strokeRect(INV * z + .5, .5, MAIN * z - 1, MAIN * z - 1);
  }

  function cellAt(e) {
    const r = glyphCv.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / (r.width / GW)),
            Math.floor((e.clientY - r.top) / (r.height / GH))];
  }
  const inGrid = (x, y) => x >= 0 && x < GW && y >= 0 && y < GH;

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
    return out.filter(([x, y]) => inGrid(x, y));
  }
  function rectCells(x0, y0, x1, y1, filled) {
    const out = [];
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
    const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      if (filled || x === xa || x === xb || y === ya || y === yb) out.push([x, y]);
    }
    return out;
  }
  function fillCells(g, sx, sy, v) {
    const t = getBit(g, sx, sy);
    if (t === v) return;
    const st = [[sx, sy]];
    while (st.length) {
      const [x, y] = st.pop();
      if (!inGrid(x, y) || getBit(g, x, y) !== t) continue;
      setBit(g, x, y, v);
      st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  /* —— 描画交互 —— */
  let dragging = false, startCell = null, lastCell = null, snapshot = null;

  glyphCv.addEventListener('contextmenu', (e) => e.preventDefault());
  glyphCv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { glyphCv.setPointerCapture(e.pointerId); } catch (err) { /* 非激活指针(合成/嵌入式事件)时忽略 */ }
    const cell = cellAt(e);
    if (!inGrid(cell[0], cell[1])) return;
    dragging = true; startCell = cell; lastCell = cell;
    drawVal = (tool === 'eraser' || e.button === 2) ? 0 : 1;
    snapshot = cur().slice();
    const g = cur();
    if (tool === 'pencil' || tool === 'eraser') { setBit(g, cell[0], cell[1], drawVal); renderGlyph(); }
    else if (tool === 'fill') { fillCells(g, cell[0], cell[1], drawVal); renderGlyph(); }
    else renderGlyph([cell]);
  });
  glyphCv.addEventListener('pointermove', (e) => {
    const cell = cellAt(e);
    if (inGrid(cell[0], cell[1])) {
      $('stCell').textContent = '格 (' + cell[0] + ',' + cell[1] + ') · ' + zoneName(cell[0], cell[1]);
    }
    if (!dragging) return;
    if (tool === 'pencil' || tool === 'eraser') {
      const g = cur();
      for (const [x, y] of lineCells(lastCell[0], lastCell[1], cell[0], cell[1]))
        setBit(g, x, y, drawVal);
      lastCell = cell;
      renderGlyph();
    } else if (startCell) {
      renderGlyph(tool === 'line'
        ? lineCells(startCell[0], startCell[1], cell[0], cell[1])
        : rectCells(startCell[0], startCell[1], cell[0], cell[1], false));
    }
  });
  glyphCv.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    const cell = cellAt(e), g = cur();
    if ((tool === 'line' || tool === 'rect' || tool === 'frect') && inGrid(cell[0], cell[1])) {
      const cells = tool === 'line'
        ? lineCells(startCell[0], startCell[1], cell[0], cell[1])
        : rectCells(startCell[0], startCell[1], cell[0], cell[1], tool === 'frect');
      for (const [x, y] of cells) setBit(g, x, y, drawVal);
    }
    if (!sameGlyph(snapshot, g)) pushUndo(snapshot, g);
    renderGlyph(); markDirty();
  });

  function zoneName(x, y) {
    if (x < INV) return '入侵区(向左溢出)';
    if (y >= MAIN) return '尾部区(向下溢出)';
    if (x === INV + 11) return '间隔列';
    if (y === 11) return '间隔行';
    return '主区';
  }
  function sameGlyph(a, b) {
    for (let i = 0; i < GH; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* ================= 撤销 / 重做 ================= */
  function pushUndo(before, after) {
    undoStack.push({ cp: curCP, before, after });
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }
  function applyUndo(entry, dir) {
    glyphs.set(entry.cp, (dir === 'undo' ? entry.before : entry.after).slice());
    curCP = entry.cp;
  }
  function undo() {
    const e = undoStack.pop(); if (!e) return;
    const now = cur().slice();                 // 当前态留作重做基准
    glyphs.set(e.cp, now); applyUndo(e, 'undo');
    redoStack.push(e); refreshAll();
  }
  function redo() {
    const e = redoStack.pop(); if (!e) return;
    applyUndo(e, 'redo'); undoStack.push(e); refreshAll();
  }
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);

  /* ================= 工具栏 / 操作 ================= */
  const TOOLS = [
    ['pencil', '铅笔(B)', '✏'], ['eraser', '橡皮(E)', '⌫'],
    ['line', '直线(L)', '╱'], ['rect', '矩形(R)', '▭'], ['frect', '实心矩形', '▬'],
    ['fill', '填充(F)', '🪣'],
  ];
  const toolRow = $('toolRow');
  for (const [id, tip, icon] of TOOLS) {
    const b = el('button', { class: 'btn', title: tip, 'data-tool': id }, icon + ' ' + tip.replace(/\(.*/, ''));
    b.addEventListener('click', () => setTool(id));
    toolRow.append(b);
  }
  function setTool(t) { tool = t; refreshToolBtns(); }
  function refreshToolBtns() {
    for (const b of toolRow.querySelectorAll('[data-tool]'))
      b.classList.toggle('active', b.dataset.tool === tool);
  }

  const opRow = $('opRow');
  function opBtn(label, title, fn) {
    const b = el('button', { class: 'btn', title }, label);
    b.addEventListener('click', fn); opRow.append(b); return b;
  }
  opBtn('复制字形', '复制当前字形到剪贴板', () => { clipboard = cur().slice(); toast('字形已复制'); });
  opBtn('粘贴字形', '把剪贴板字形粘贴到当前字符', () => {
    if (!clipboard) return toast('剪贴板为空', true);
    const before = cur().slice(), g = cur();
    g.set(clipboard);
    if (!sameGlyph(before, g)) pushUndo(before, g);
    markDirty();
  });
  opBtn('↔ 水平翻转', '', () => glyphOp((g, ng) => {
    for (let y = 0; y < GH; y++) { let v = 0; for (let x = 0; x < GW; x++) if (getBit(g, x, y)) v |= 1 << (GW - 1 - x); ng[y] = v; }
  }));
  opBtn('↕ 垂直翻转', '', () => glyphOp((g, ng) => {
    for (let y = 0; y < GH; y++) ng[GH - 1 - y] = g[y];
  }));
  opBtn('反色', '', () => glyphOp((g, ng) => {
    const mask = (1 << GW) - 1;
    for (let y = 0; y < GH; y++) ng[y] = ~g[y] & mask;
  }));
  opBtn('清空', '', () => glyphOp((g, ng) => ng.fill(0)));
  opRow.append(el('span', { class: 'sep' }));
  opBtn('←', '整体左移 1px', () => shiftGlyph(-1, 0));
  opBtn('→', '整体右移 1px', () => shiftGlyph(1, 0));
  opBtn('↑', '整体上移 1px', () => shiftGlyph(0, -1));
  opBtn('↓', '整体下移 1px', () => shiftGlyph(0, 1));
  opRow.append(el('span', { class: 'grow' }));
  opRow.append(el('span', { class: 'label' }, '缩放'));
  opBtn('−', '', () => { zoom = Math.max(10, zoom - 4); renderGlyph(); });
  opRow.append(el('span', { class: 'kv', id: 'zoomLabel' }, zoom + 'px'));
  opBtn('+', '', () => { zoom = Math.min(48, zoom + 4); renderGlyph(); });

  function glyphOp(fn) {
    const before = cur().slice(), g = cur(), ng = newGlyph();
    fn(g, ng); g.set(ng);
    if (!sameGlyph(before, g)) pushUndo(before, g);
    markDirty();
  }
  function shiftGlyph(dx, dy) {
    glyphOp((g, ng) => {
      const mask = (1 << GW) - 1;
      for (let y = 0; y < GH; y++) {
        const sy = ((y - dy) % GH + GH) % GH;
        let v = g[sy];
        if (dx > 0) v = (v << dx) | (v >> (GW - dx));   // 循环移位,跨区也一起卷动
        else if (dx < 0) v = (v >> -dx) | (v << (GW + dx));
        ng[y] = v & mask;
      }
    });
  }

  /* ================= 字符列表 ================= */
  const listEl = $('charList');
  const thumbIO = new IntersectionObserver((ents) => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      thumbIO.unobserve(en.target);
      drawThumb(en.target);
    }
  }, { root: listEl });

  function sortedCPs() { return [...glyphs.keys()].sort((a, b) => a - b); }
  function groupOf(cp) {
    if (cp >= 0x20 && cp <= 0x2F) return '标点';
    if (cp >= 0x30 && cp <= 0x39) return '数字';
    if (cp >= 0x41 && cp <= 0x5A) return '大写';
    if (cp >= 0x61 && cp <= 0x7A) return '小写';
    if (cp >= 0x21 && cp <= 0x7E) return 'ASCII 其他';
    if (cp >= 0x3000 && cp <= 0x30FF) return '假名 / 注音';
    if (cp >= 0x4E00 && cp <= 0x9FFF) return 'CJK 汉字';
    if (cp >= 0xFF00 && cp <= 0xFFEF) return '全角形式';
    if (cp >= 0x2000 && cp <= 0x2BFF) return '符号';
    return '其他';
  }
  function hex(cp) { return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'); }
  function charLabel(cp) {
    const ch = String.fromCodePoint(cp);
    return ch === ' ' ? '␣' : ch;
  }

  function rebuildList() {
    listEl.textContent = '';
    const q = $('search').value.trim().toLowerCase().replace(/^u\+?/, '');
    const cps = sortedCPs().filter((cp) => {
      if (!q) return true;
      return charLabel(cp).toLowerCase().includes(q) ||
             cp.toString(16).toLowerCase().includes(q);
    });
    let group = null;
    for (const cp of cps) {
      const g = groupOf(cp);
      if (g !== group) { group = g; listEl.append(el('div', { class: 'ghead' }, g)); }
      const item = el('div', {
        class: 'gitem' + (cp === curCP ? ' sel' : ''),
        'data-cp': cp,
        onclick: () => selectCP(cp),
      },
        el('canvas', { width: 28, height: 28, 'data-cp': cp }),
        el('span', { class: 'txt' }, charLabel(cp)),
        el('span', { class: 'code' }, hex(cp)));
      listEl.append(item);
      const cv = item.querySelector('canvas');
      thumbIO.observe(cv);
    }
    $('charCount').textContent = glyphs.size + ' 字符';
  }
  function drawThumb(cv) {
    const g = glyphs.get(+cv.dataset.cp);
    const c = cv.getContext('2d');
    c.fillStyle = '#0b0b0e'; c.fillRect(0, 0, 28, 28);
    c.fillStyle = '#9aa0aa';
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++)
      if (getBit(g, x, y)) c.fillRect(x * 2, y * 2, 2, 2);
  }
  function selectCP(cp) {
    curCP = cp;
    for (const it of listEl.querySelectorAll('.gitem'))
      it.classList.toggle('sel', +it.dataset.cp === cp);
    refreshAll(false);
    const sel = listEl.querySelector('.gitem.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  $('search').addEventListener('input', rebuildList);

  /* ================= 添加 / 删除字符 ================= */
  const PRESETS = {
    '平假名': 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔ゛゜ゝゞ',
    '片假名': '゠アィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ・ー',
    '常用符号': '★☆♠♥♦♣♪♫♩♬←→↑↓↔▲▼◆◇■□●○△▽※§¶†‡‰°℃№™©®£¥¢€¤…‥≈≠≤≥±×÷√∞·†',
    '希腊字母': 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω',
    '常用汉字(150)': '的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间知世什两次使身者被高已亲其进此话常与活正感',
  };

  $('btnAdd').addEventListener('click', () => {
    dialog((dlg, close) => {
      const ta = el('textarea', { placeholder: '输入或粘贴任意文本,其中每个不同字符都会被加入字符集\n例:你好世界 あいう アイウ ★☆' });
      const chips = el('div', { class: 'chips' });
      for (const name in PRESETS) {
        chips.append(el('button', {
          class: 'btn',
          onclick: () => { ta.value += PRESETS[name]; count(); },
        }, name));
      }
      const info = el('div', { class: 'kv' });
      function count() {
        const cps = new Set([...ta.value].map((c) => c.codePointAt(0)).filter((c) => c !== 10 && c !== 13 && c !== 9));
        let add = 0; for (const c of cps) if (!glyphs.has(c)) add++;
        info.textContent = '待添加 ' + add + ' 个新字符(已有 ' + (cps.size - add) + ' 个跳过)';
      }
      ta.addEventListener('input', count);
      dlg.append(el('h3', {}, '添加字符'),
        el('div', { class: 'row' }, chips), ta,
        el('div', { class: 'row' }, info),
        el('div', { class: 'foot' },
          el('button', { class: 'btn', onclick: close }, '取消'),
          el('button', {
            class: 'btn primary',
            onclick: () => {
              const cps = [...ta.value].map((c) => c.codePointAt(0))
                .filter((c) => c !== 10 && c !== 13 && c !== 9);
              const fresh = [...new Set(cps)].filter((c) => !glyphs.has(c));
              for (const c of fresh) glyphs.set(c, newGlyph());
              if (fresh.length) {
                selectCP(fresh[0]); rebuildList(); markDirty();
                toast('已添加 ' + fresh.length + ' 个字符');
              } else toast('没有新字符', true);
              close();
            },
          }, '添加')));
      setTimeout(() => ta.focus(), 30);
    });
  });

  $('btnDel').addEventListener('click', () => {
    if (!glyphs.has(curCP)) return;
    if (!confirm('删除字符 ' + charLabel(curCP) + '(' + hex(curCP) + ')?')) return;
    glyphs.delete(curCP);
    const rest = sortedCPs();
    curCP = rest.length ? rest.find((c) => c >= curCP) || rest[rest.length - 1] : 32;
    rebuildList(); markDirty();
  });

  $('btnReset').addEventListener('click', () => {
    if (!confirm('丢弃全部修改,恢复内置默认 ASCII 字体?')) return;
    glyphs = DEFAULT_FONT.buildDefaultGlyphs();
    undoStack.length = redoStack.length = 0;
    curCP = 65; rebuildList(); markDirty();
    toast('已恢复默认字体');
  });

  /* ================= 预览 ================= */
  let prevScale = 2;
  for (const b of document.querySelectorAll('[data-scale]')) {
    b.addEventListener('click', () => {
      prevScale = +b.dataset.scale;
      for (const o of document.querySelectorAll('[data-scale]'))
        o.classList.toggle('active', o === b);
      renderPreview();
    });
    if (+b.dataset.scale === prevScale) b.classList.add('active');
  }
  for (const id of ['optGrid', 'optBox', 'fgColor']) $(id).addEventListener('input', renderPreview);
  $('fgColor').addEventListener('input', renderGlyph);
  $('sample').addEventListener('input', renderPreview);

  /* 把一个字形画到画布:origin 为该字符原点(主区左上角),
     入侵列画到 origin.x-2..-1,尾部行画到 origin.y+12..13 */
  function blitGlyph(c, g, ox, oy, s, color) {
    c.fillStyle = color;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (getBit(g, x, y)) c.fillRect((ox + x - INV) * s, (oy + y) * s, s, s);
    }
  }
  function renderPreview() {
    const s = prevScale, lines = $('sample').value.split('\n');
    const fg = $('fgColor').value, bg = $('bgColor').value;
    const W = 320, maxCols = Math.floor(W / s / ADV);
    const height = Math.max(1, lines.length) * LH * s + 8;
    prevCv.width = W; prevCv.height = Math.min(height, 2000);
    pctx.fillStyle = bg; pctx.fillRect(0, 0, prevCv.width, prevCv.height);
    pctx.save();
    pctx.translate(4, 4);
    pctx.beginPath(); pctx.rect(0, 0, W - 8, height - 8); pctx.clip();
    lines.forEach((line, li) => {
      const oy = li * LH;
      const chars = [...line].slice(0, maxCols + 2);
      chars.forEach((ch, ci) => {
        const cp = ch.codePointAt(0), ox = ci * ADV;
        const g = glyphs.get(cp);
        if (!g) {
          pctx.strokeStyle = fg; pctx.lineWidth = 1;
          pctx.strokeRect(ox * s + .5, oy * s + .5, MAIN * s - 1, MAIN * s - 1);
        } else {
          blitGlyph(pctx, g, ox, oy, s, fg);
          if ($('optBox').checked) {
            pctx.strokeStyle = 'rgba(255,255,255,.14)';
            pctx.strokeRect(ox * s + .5, .5 + oy * s, MAIN * s - 1, MAIN * s - 1);
            pctx.strokeStyle = 'rgba(126,200,227,.35)'; pctx.setLineDash([3, 3]);
            pctx.strokeRect((ox - INV) * s + .5, oy * s + .5, INV * s - 1, MAIN * s - 1);
            pctx.strokeStyle = 'rgba(224,108,108,.35)';
            pctx.strokeRect(ox * s + .5, (oy + MAIN) * s + .5, MAIN * s - 1, (GH - MAIN) * s - 1);
            pctx.setLineDash([]);
          }
        }
      });
      if ($('optGrid').checked) {
        pctx.strokeStyle = 'rgba(255,255,255,.06)';
        for (let ci = 0; ci <= maxCols; ci++) {
          pctx.beginPath();
          pctx.moveTo(ci * ADV * s + .5, oy * s);
          pctx.lineTo(ci * ADV * s + .5, (oy + LH) * s);
          pctx.stroke();
        }
      }
    });
    pctx.restore();
  }

  /* 上下文条:前一个 / 当前 / 后一个字符,展示入侵与尾部的实际溢出效果 */
  function renderStrip() {
    const cps = sortedCPs(), s = 3;
    const i = cps.indexOf(curCP);
    const seq = [cps[(i - 1 + cps.length) % cps.length], curCP, cps[(i + 1) % cps.length]];
    const pad = 8;
    stripCv.width = 3 * ADV * s + pad * 2 + INV * s;
    stripCv.height = GH * s + pad * 2;
    sctx.fillStyle = '#0b0b0e'; sctx.fillRect(0, 0, stripCv.width, stripCv.height);
    seq.forEach((cp, k) => {
      const g = glyphs.get(cp); if (!g) return;
      const ox = pad + INV * s + k * ADV * s;
      blitGlyph(sctx, g, ox, pad, s, k === 1 ? $('fgColor').value : '#6d7280');
    });
    /* 当前字符的字格框 */
    const ox1 = pad + INV * s + ADV * s;
    sctx.strokeStyle = 'rgba(224,194,108,.8)';
    sctx.strokeRect(ox1 * 1 + .5, pad + .5, MAIN * s - 1, MAIN * s - 1);
    sctx.fillStyle = '#565b64'; sctx.font = '10px ui-monospace, monospace';
    sctx.fillText(seq.map((c) => (c === undefined ? '' : charLabel(c))).join(' '), 6, stripCv.height - 3);
  }

  /* ================= 导入 / 导出 ================= */
  function glyphToArr(g) { return Array.from(g); }

  $('btnExportJson').addEventListener('click', () => {
    const obj = {
      format: 'aether-font', version: 1,
      advance: ADV, lineHeight: LH,
      cell: { w: MAIN, h: MAIN }, invade: { left: INV, bottom: GH - MAIN },
      glyphs: {},
    };
    for (const cp of sortedCPs()) obj.glyphs[cp] = glyphToArr(glyphs.get(cp));
    download('font.af.json', JSON.stringify(obj), 'application/json');
    toast('已导出 ' + glyphs.size + ' 个字形(JSON)');
  });

  $('btnExportBin').addEventListener('click', () => {
    const cps = sortedCPs();
    /* 头部:'AFNT'(4) + ver/advance/lineH/gridW(4) + 数量 u32(4) + 码点表 + 位图 */
    const size = 12 + cps.length * 4 + cps.length * GH * 2;
    const u8 = new Uint8Array(size), dv = new DataView(u8.buffer);
    let o = 0;
    const w32 = (v) => { dv.setUint32(o, v >>> 0, true); o += 4; };
    const w16 = (v) => { dv.setUint16(o, v & 0xFFFF, true); o += 2; };
    for (const ch of 'AFNT') u8[o++] = ch.charCodeAt(0);
    u8[o++] = 1; u8[o++] = ADV; u8[o++] = LH; u8[o++] = GW;
    w32(cps.length);
    for (const cp of cps) w32(cp);
    for (const cp of cps) { const g = glyphs.get(cp); for (let y = 0; y < GH; y++) w16(g[y]); }
    download('font.bin', u8);
    toast('已导出 font.bin(' + u8.length + ' 字节,AFNT v1)');
  });

  function loadFromObject(obj) {
    const m = new Map();
    const gs = obj.glyphs || obj;
    for (const k in gs) {
      const cp = +k, rows = gs[k];
      const g = newGlyph();
      if (Array.isArray(rows)) rows.forEach((v, i) => { if (i < GH) g[i] = v & 0x3FFF; });
      m.set(cp, g);
    }
    if (!m.size) throw new Error('无有效字形');
    glyphs = m;
    undoStack.length = redoStack.length = 0;
    curCP = glyphs.has(65) ? 65 : sortedCPs()[0];
    rebuildList(); markDirty();
  }
  function parseBin(u8) {
    if (!(u8[0] === 65 && u8[1] === 70 && u8[2] === 78 && u8[3] === 84)) throw new Error('不是 AFNT 文件');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = 8;
    const count = dv.getUint32(o, true); o += 4;
    const cps = [];
    for (let i = 0; i < count; i++) { cps.push(dv.getUint32(o, true)); o += 4; }
    const obj = { glyphs: {} };
    for (const cp of cps) {
      const rows = [];
      for (let y = 0; y < GH; y++) { rows.push(dv.getUint16(o, true)); o += 2; }
      obj.glyphs[cp] = rows;
    }
    return obj;
  }
  $('btnImport').addEventListener('click', async () => {
    const f = await pickFile('.json,.afnt,.bin');
    if (!f) return;
    try {
      const u8 = new Uint8Array(f.data);
      let obj;
      if (u8[0] === 65 && u8[1] === 70) obj = parseBin(u8);
      else obj = JSON.parse(new TextDecoder().decode(u8));
      loadFromObject(obj);
      toast('已导入 ' + glyphs.size + ' 个字形');
    } catch (err) { toast('导入失败:' + err.message, true); }
  });

  /* ================= 草稿 / 刷新 ================= */
  function markDirty() {
    renderGlyph(); renderStrip(); renderPreview(); updateStatus();
    const sel = listEl.querySelector('.gitem.sel canvas');
    if (sel) drawThumb(sel);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const obj = { advance: ADV, lineH: LH, glyphs: {} };
      for (const cp of sortedCPs()) obj.glyphs[cp] = glyphToArr(glyphs.get(cp));
      draft.save('aetherfont.draft', obj);
    }, 600);
  }
  function refreshAll(rebuild = true) {
    if (rebuild) rebuildList();
    markDirty();
  }
  function updateStatus() {
    const g = cur();
    let n = 0;
    for (let y = 0; y < GH; y++) n += (g[y].toString(2).match(/1/g) || []).length;
    $('stChar').innerHTML = '当前 <b>' + charLabel(curCP) + '</b> ' + hex(curCP);
    $('stStat').textContent = '点亮 ' + n + ' px · 字形 ' + glyphs.size + ' · 步进/行高 12';
  }

  /* —— 快捷键 —— */
  addEventListener('keydown', (e) => {
    const t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault(); e.shiftKey ? redo() : undo(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    const map = { b: 'pencil', e: 'eraser', l: 'line', r: 'rect', f: 'fill' };
    const k = e.key.toLowerCase();
    if (map[k]) { setTool(map[k]); return; }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      shiftGlyph(d[0], d[1]);
    }
  });

  /* —— 启动:优先恢复草稿,否则载入内置默认字体 —— */
  const d = draft.load('aetherfont.draft');
  if (d && d.glyphs) {
    try { loadFromObject(d); toast('已恢复上次编辑草稿(重置默认字体可清除)'); }
    catch (e) { glyphs = DEFAULT_FONT.buildDefaultGlyphs(); }
  } else {
    glyphs = DEFAULT_FONT.buildDefaultGlyphs();
  }
  setTool('pencil');
  rebuildList(); markDirty();
})();
