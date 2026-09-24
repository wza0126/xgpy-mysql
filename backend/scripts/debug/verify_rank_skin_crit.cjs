/**
 * 验证：段位皮肤激活后，暴击加成是否真正生效
 *
 * 背景（用户实测报障）：激活段位皮肤后「战力暴击」卡片位没有显示皮肤加成。
 * 根因：/api/student/stats 与答题结算各写死了一份「只含 7 套积分皮肤」的
 *       SKIN_CRIT_BONUS 字面量表，5 套段位皮肤查不到 → 加成恒为 0。
 * 修法：两处改为引用由 WINDOW_SKINS_META 派生的 SKIN_CRIT_BONUS_MAP。
 *
 * 本脚本真登录学生、真切换激活皮肤、真调 /api/student/stats 断言 from_skin。
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const API = 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' };
const ROOT = path.join(__dirname, '../..');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

async function login(username, password) {
  const res = await fetch(`${API}/api/auth/secure-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-info': 'verify-script' },
    body: JSON.stringify({ username, password })
  });
  const j = await res.json();
  return j?.data?.session?.access_token || null;
}

async function getStats(token) {
  const res = await fetch(`${API}/api/student/stats`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
}

// ⚠️ 接口参数是 skinId（驼峰），不是 skin_id
async function activateSkin(token, skinId) {
  const res = await fetch(`${API}/api/student/active-skin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ skinId })
  });
  return res.json();
}

(async () => {
  // 期望值：与后端 WINDOW_SKINS_META 的 critBonus 对齐（段位档位 1/3/6/8/10）
  const EXPECT = {
    skin_rank_primary: 1,
    skin_rank_junior: 3,
    skin_rank_senior: 6,
    skin_rank_undergrad: 8,
    skin_rank_researcher: 10,
    // 积分皮肤对照（旧表里有，回归用）
    skin_minimal_white: 1,
    skin_galaxy_star: 5,
  };

  section('A. 源码口径：不再存在第二份硬编码皮肤暴击表');
  const src = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8');
  const literalTables = (src.match(/const SKIN_CRIT_BONUS = \{/g) || []).length;
  ok('已无 const SKIN_CRIT_BONUS = { 字面量表', literalTables === 0, `残留 ${literalTables} 处`);
  ok('存在由 WINDOW_SKINS_META 派生的 SKIN_CRIT_BONUS_MAP',
    /const SKIN_CRIT_BONUS_MAP = WINDOW_SKINS_META\.reduce/.test(src));
  const uses = (src.match(/SKIN_CRIT_BONUS_MAP\[/g) || []).length;
  ok('计算处引用派生表（答题结算 + 战力统计）', uses >= 2, `引用 ${uses} 处`);

  section('B. 学生端接口：/api/student/stats 的 from_skin');
  const token = await login('a', '111111');
  if (!token) { console.log('  ✗ 登录失败，后续跳过'); process.exit(1); }
  ok('学生登录成功', !!token);

  const conn = await mysql.createConnection(DB);
  const [uRows] = await conn.query('SELECT id FROM profiles WHERE username = ?', ['a']);
  const uid = uRows[0].id;
  const [owned] = await conn.query('SELECT skin_id FROM student_skins WHERE student_id = ?', [uid]);
  const ownedSet = new Set(owned.map(r => r.skin_id));

  for (const sid of Object.keys(EXPECT)) {
    // 没有就先补一行，保证能激活（模拟已解锁；本地库为测试库）
    if (!ownedSet.has(sid)) {
      await conn.query(
        'INSERT IGNORE INTO student_skins (id, student_id, skin_id, unlock_source) VALUES (?, ?, ?, ?)',
        ['tmp_' + sid, uid, sid, sid.startsWith('skin_rank_') ? 'rank' : 'points']
      );
    }
    const ar = await activateSkin(token, sid);
    if (ar?.error) { ok(`激活 ${sid}`, false, String(ar.error)); continue; }
    const st = await getStats(token);
    const bd = st?.data?.crit_rate_breakdown || {};
    ok(`${sid} → from_skin = ${EXPECT[sid]}`,
      Number(bd.from_skin) === EXPECT[sid],
      `from_skin=${bd.from_skin} active=${st?.data?.active_skin_id} crit_rate=${st?.data?.crit_rate}`);
  }

  section('C. 战力卡片可见性：from_skin > 0 才会渲染');
  // ROOT = backend；前端在同级 ../frontend（不是 ../../，那会跳到 wza 根目录）
  const feSrc = fs.readFileSync(
    path.join(ROOT, '../frontend/src/components/student/ProfileModule.tsx'), 'utf8');
  ok('ProfileModule 有 from_skin 展示分支', /from_skin/.test(feSrc));
  ok('展示分支条件含 (from_skin || 0) > 0', /from_skin \|\| 0\)\s*>\s*0/.test(feSrc));

  section('D. 反向回归：清空激活皮肤后 from_skin 应为 0');
  await conn.query('UPDATE profiles SET active_skin_id = NULL WHERE id = ?', [uid]);
  const stNone = await getStats(token);
  ok('无激活皮肤 → from_skin = 0',
    Number(stNone?.data?.crit_rate_breakdown?.from_skin) === 0,
    `实际 ${stNone?.data?.crit_rate_breakdown?.from_skin}`);

  // 恢复：重新激活一套段位皮肤，便于用户直接看效果
  await activateSkin(token, 'skin_rank_senior');
  await conn.end();

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('脚本异常:', e); process.exit(1); });
