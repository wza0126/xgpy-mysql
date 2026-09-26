/**
 * 验证：段位皮肤激活后，暴击加成是否真正生效
 *
 * 背景（用户实测报障）：激活段位皮肤后「战力暴击」卡片位没有显示皮肤加成。
 * 根因：/api/student/stats 与答题结算各写死了一份 SKIN_CRIT_BONUS 字面量表，
 *       只含 7 套积分皮肤，5 套段位皮肤查不到 → 加成恒为 0。
 * 修法：两处改为引用由 WINDOW_SKINS_META 派生的 SKIN_CRIT_BONUS_MAP。
 *
 * ⛔【重要】本脚本会临时给学生补发皮肤以便逐个激活测试（接口有「未拥有则 403」校验，
 *   不补就测不了 5 套段位皮肤）。因此：
 *   - 临时行统一用 id 前缀 `tmp_`，与正常 `ss_` 行区分；
 *   - **必须在 finally 中删除全部 tmp_ 行并把 active_skin_id 还原为原值**；
 *   - 脚本末尾有「不留痕」断言，跑完必须与学生原有状态完全一致。
 *   历史教训：上一版只补不清理，导致学生 a 的皮肤被永久污染成 5 套（用户实测发现）。
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const API = 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' };
const ROOT = path.join(__dirname, '../..');
const TEST_USER = 'a';
const TEST_PASS = '111111';
const TMP_PREFIX = 'tmp_';

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
  const res = await fetch(`${API}/api/student/stats`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

// ⚠️ 接口参数是 skinId（驼峰），不是 skin_id
async function activateSkin(token, skinId) {
  const res = await fetch(`${API}/api/student/active-skin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ skinId })
  });
  return { status: res.status, body: await res.json() };
}

(async () => {
  // 期望值：与后端 WINDOW_SKINS_META 的 critBonus 对齐（段位档位 1/3/6/8/10）
  const EXPECT = {
    skin_rank_primary: 1,
    skin_rank_junior: 3,
    skin_rank_senior: 6,
    skin_rank_undergrad: 8,
    skin_rank_researcher: 10,
    skin_minimal_white: 1,
    skin_galaxy_star: 5,
  };

  section('A. 源码口径：不再存在第二份硬编码皮肤暴击表');
  const src = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8');
  ok('已无 const SKIN_CRIT_BONUS = { 字面量表',
    (src.match(/const SKIN_CRIT_BONUS = \{/g) || []).length === 0);
  ok('存在由 WINDOW_SKINS_META 派生的 SKIN_CRIT_BONUS_MAP',
    /const SKIN_CRIT_BONUS_MAP = WINDOW_SKINS_META\.reduce/.test(src));
  const uses = (src.match(/SKIN_CRIT_BONUS_MAP\[/g) || []).length;
  ok('计算处引用派生表（答题结算 + 战力统计）', uses >= 2, `引用 ${uses} 处`);

  const token = await login(TEST_USER, TEST_PASS);
  if (!token) { console.log('  ✗ 登录失败，后续跳过'); process.exit(1); }

  const conn = await mysql.createConnection(DB);
  const [uRows] = await conn.query('SELECT id FROM profiles WHERE username = ?', [TEST_USER]);
  const uid = uRows[0].id;

  // ---- 记录原始状态，用于 finally 还原 ----
  const [origRows] = await conn.query(
    'SELECT skin_id FROM student_skins WHERE student_id = ?', [uid]);
  const originalSkins = new Set(origRows.map(r => r.skin_id));
  const [profRows] = await conn.query(
    'SELECT active_skin_id FROM profiles WHERE id = ?', [uid]);
  const originalActive = profRows[0]?.active_skin_id ?? null;
  console.log(`\n（测试账号 ${TEST_USER} 原有皮肤 ${originalSkins.size} 套，激活=${originalActive}；测完将还原）`);

  let afterClearFromSkin = null;

  try {
    section('B. 学生端接口：/api/student/stats 的 from_skin');
    ok('学生登录成功', !!token);

    for (const sid of Object.keys(EXPECT)) {
      // 临时补发（tmp_ 前缀，finally 会删除）
      await conn.query(
        'INSERT IGNORE INTO student_skins (id, student_id, skin_id, unlock_source) VALUES (?, ?, ?, ?)',
        [TMP_PREFIX + sid, uid, sid, sid.startsWith('skin_rank_') ? 'rank' : 'points']
      );
      const ar = await activateSkin(token, sid);
      if (ar.body?.error) { ok(`激活 ${sid}`, false, String(ar.body.error)); continue; }
      const st = await getStats(token);
      const bd = st?.data?.crit_rate_breakdown || {};
      ok(`${sid} → from_skin = ${EXPECT[sid]}`,
        Number(bd.from_skin) === EXPECT[sid],
        `from_skin=${bd.from_skin} active=${st?.data?.active_skin_id}`);
    }

    section('C. 安全回归：未拥有的皮肤不能激活');
    const notOwned = await activateSkin(token, 'skin_rank_undergrad_does_not_exist');
    ok('不存在的皮肤 ID → 403/400', notOwned.status === 403 || notOwned.status === 400,
      `status=${notOwned.status}`);

    section('D. 战力卡片可见性：from_skin > 0 才会渲染');
    // ROOT = backend；前端在同级 ../frontend（不是 ../../）
    const feSrc = fs.readFileSync(
      path.join(ROOT, '../frontend/src/components/student/ProfileModule.tsx'), 'utf8');
    ok('ProfileModule 有 from_skin 展示分支', /from_skin/.test(feSrc));
    ok('展示分支条件含 (from_skin || 0) > 0', /from_skin \|\| 0\)\s*>\s*0/.test(feSrc));

    section('E. 反向回归：清空激活皮肤后 from_skin 应为 0');
    await conn.query('UPDATE profiles SET active_skin_id = NULL WHERE id = ?', [uid]);
    const stNone = await getStats(token);
    afterClearFromSkin = Number(stNone?.data?.crit_rate_breakdown?.from_skin);
    ok('无激活皮肤 → from_skin = 0', afterClearFromSkin === 0, `实际 ${afterClearFromSkin}`);
  } finally {
    // ---- 还原：删除临时补发 + 恢复原激活皮肤 ----
    await conn.query(
      'DELETE FROM student_skins WHERE student_id = ? AND id LIKE ?', [uid, TMP_PREFIX + '%']);
    await conn.query('UPDATE profiles SET active_skin_id = ? WHERE id = ?', [originalActive, uid]);
  }

  section('F. 不留痕：脚本跑完必须与学生原始状态一致');
  const [leftRows] = await conn.query(
    'SELECT id FROM student_skins WHERE student_id = ? AND id LIKE ?', [uid, TMP_PREFIX + '%']);
  ok('无 tmp_ 临时皮肤残留', leftRows.length === 0, `残留 ${leftRows.length} 条`);

  const [nowRows] = await conn.query(
    'SELECT skin_id FROM student_skins WHERE student_id = ?', [uid]);
  const nowSkins = new Set(nowRows.map(r => r.skin_id));
  const added = [...nowSkins].filter(s => !originalSkins.has(s));
  const removed = [...originalSkins].filter(s => !nowSkins.has(s));
  ok('皮肤集合与测试前完全一致', added.length === 0 && removed.length === 0,
    added.length || removed.length ? `新增[${added}] 丢失[${removed}]` : `${nowSkins.size} 套，无变化`);

  const [profAfter] = await conn.query(
    'SELECT active_skin_id FROM profiles WHERE id = ?', [uid]);
  ok('active_skin_id 已还原', (profAfter[0]?.active_skin_id ?? null) === originalActive,
    `现在=${profAfter[0]?.active_skin_id ?? null} 原值=${originalActive}`);

  await conn.end();
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('脚本异常:', e); process.exit(1); });
