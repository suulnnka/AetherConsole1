/*
 * 魔塔校验脚本(node tools/mt-check.mjs)
 * 1) 地图合法性:11×11、字符集、楼梯、连通性(门视作可通行)
 * 2) 钥匙/门收支表
 * 3) 数值平衡:每层"先捡光道具再打光怪物"的 HP 曲线(乐观估计)
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/cart-magictower.js', import.meta.url), 'utf8');

function extract() {
  // 把 `const MagicTowerCart = (...)();` 求值后取 _data
  const mod = { exports: {} };
  const code = src.replace('const MagicTowerCart =', 'module.exports =');
  const fn = new Function('module', 'exports', 'window',
    'var localStorage = { getItem: () => null, setItem(){}, removeItem(){} };\n' + code);
  fn(mod, mod.exports, {});
  return mod.exports._data;
}
const D = extract();

const { MAPS, MON, ITEMS, forecastStub: fc } = D;
const MON_IDS = Object.keys(MON);
const WALL = '#';
let errors = 0;
const err = (f, msg) => { errors++; console.log(`  [F${f + 1}] ${msg}`); };

// —— 1. 地图合法性 ——
console.log('== 地图校验 ==');
MAPS.forEach((m, f) => {
  if (m.length !== 11) err(f, `行数 ${m.length} != 11`);
  m.forEach((row, y) => { if (row.length !== 11) err(f, `第 ${y} 行宽度 ${row.length}: "${row}"`); });
  const flat = m.join('');
  for (const ch of flat) {
    if (!'#.<>x'.includes(ch) && !'dbra su p U P a s A Z Q E S X W R'.replace(/ /g, '').includes(ch) && !MON_IDS.includes(ch) && ch !== 'y' && ch !== '$' && ch !== 'k' && ch !== 'j' && ch !== 'i') {
      err(f, `非法字符 "${ch}"`);
    }
  }
  if (f < 20 && !m.some(r => r.includes('<'))) err(f, '缺上楼楼梯 <');
  if (f > 0 && !m.some(r => r.includes('>'))) err(f, '缺下楼楼梯 >');
  if (f === 0 && !m.some(r => r.includes('x'))) err(f, '缺起点 x');
});

// —— 2. 连通性(门可通行)——
console.log('== 连通性 ==');
MAPS.forEach((m, f) => {
  const pass = ch => ch !== '#';
  const seen = Array.from({ length: 11 }, () => Array(11).fill(false));
  let start = null;
  for (let y = 0; y < 11 && !start; y++) for (let x = 0; x < 11; x++)
    if (m[y][x] === (f === 0 ? 'x' : '>')) { start = [x, y]; break; }
  if (!start) { err(f, '找不到入口'); return; }
  const q = [start];
  seen[start[1]][start[0]] = true;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx > 10 || ny < 0 || ny > 10 || seen[ny][nx]) continue;
      if (!pass(m[ny][nx])) continue;
      seen[ny][nx] = true; q.push([nx, ny]);
    }
  }
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
    const ch = m[y][x];
    if (ch !== '#' && !seen[y][x]) err(f, `(${x},${y}) "${ch}" 不可达`);
  }
});

// —— 3. 钥匙收支 ——
console.log('== 钥匙 / 门 收支 ==');
let ky = 0, kb = 0, kr = 0;
MAPS.forEach((m, f) => {
  const flat = m.join('');
  const c = ch => flat.split(ch).length - 1;
  ky += c('k') - c('d');
  kb += c('j') - c('b');
  kr += c('i') - c('r');
  const flag = (ky < 0 || kb < 0 || kr < 0) ? '  <-- 负数!' : '';
  console.log(`F${String(f + 1).padStart(2)}  黄 ${String(c('k')).padStart(2)}钥匙/${c('d')}门 累计${String(ky).padStart(3)}   蓝 ${c('j')}/${c('b')} 累计${String(kb).padStart(3)}   红 ${c('i')}/${c('r')} 累计${String(kr).padStart(3)}${flag}`);
});

// —— 4. 平衡:全清路线 HP 曲线 ——
console.log('== 平衡(先捡光道具再打光怪,乐观)==');
const st = { hp: 1000, atk: 10, def: 10, gold: 0 };
const equip = { A: ['atk', 10], Z: ['atk', 20], Q: ['atk', 40], E: ['atk', 100],
                S: ['def', 10], X: ['def', 20], W: ['def', 40], R: ['def', 100] };
let totalFights = 0, cantWin = [];
MAPS.forEach((m, f) => {
  const flat = m.join('');
  const count = ch => flat.split(ch).length - 1;
  // 捡道具
  for (const it of ['u', 'p', 'U', 'P']) st.hp += { u: 200, p: 500, U: 1000, P: 2000 }[it] * count(it);
  st.atk += 2 * count('a'); st.def += 2 * count('s');
  for (const e in equip) { const [k, v] = equip[e]; st[k] += v * count(e); }
  if (f === 4) st.hp += 1000;                     // 仙子
  // 打怪
  let dmg = 0;
  for (const id of MON_IDS) {
    for (let i = 0; i < count(id); i++) {
      const r = fc(id, st);
      if (r.no) { cantWin.push(`F${f + 1} ${MON[id].n}`); continue; }
      if (r.dmg >= st.hp - dmg) { cantWin.push(`F${f + 1} ${MON[id].n} 致死(${r.dmg})`); }
      dmg += r.dmg;
      st.gold += MON[id].gold;
      totalFights++;
    }
  }
  st.hp -= dmg;
  console.log(`F${String(f + 1).padStart(2)}  打完剩 HP ${String(st.hp).padStart(6)}  ATK ${String(st.atk).padStart(3)} DEF ${String(st.def).padStart(3)}  本层承伤 ${String(dmg).padStart(6)}  金币 ${st.gold}`);
  if (st.hp <= 0) console.log('   <-- HP 归零!');
});
console.log(`总战斗 ${totalFights} 场;结余金币 ${st.gold}(商店可换 +${st.gold * 6} HP)`);
if (cantWin.length) console.log('打不过/致死:', cantWin.join(', '));
console.log(errors ? `共 ${errors} 处地图问题` : '地图无问题');
