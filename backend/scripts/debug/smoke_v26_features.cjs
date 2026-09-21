/**
 * v2.6 五项需求 联合冒烟
 *
 * 需求1  学习模块「已掌握 XX 题」 → /api/student/learn-chapters 的 mastered_count
 * 需求2  学情分析 每生每章掌握进度 → /api/teacher/analytics/chapter-mastery/:classId
 * 需求3  创建考试「添加题目」界面（纯前端布局，此处只验证题库拉取字段充足）
 * 需求4  测试范围 / 随堂习题 增加聚类筛选
 *         → /api/teacher/questions?cluster=…  与 submit-test 的抽题池分母口径
 * 需求5  重置密码 → POST /api/teacher/students/reset-password（默认 123456）
 *
 * 用法：先启动后端(node src/index.js, 端口 3101)，再执行
 *   node scripts/debug/smoke_v26_features.cjs
 */
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' };

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  \u2705 ${name}`); }
  else { fail++; failures.push(name); console.log(`  \u274c ${name}  ${extra}`); }
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function makeSession(conn, userId, tag) {
  const raw = `${Date.now()}.${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  await conn.query(
    `INSERT INTO login_sessions (id, user_id, token, device_info, ip_address, created_at, last_active_at, expires_at, is_active)
     VALUES (?, ?, ?, ?, '127.0.0.1', NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), TRUE)`,
    ['smk26_' + tag + '_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), userId, hash, 'smoke']
  );
  return raw;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

(async () => {
  const conn = await mysql.createConnection(DB);
  const TS = 'smk26_' + Date.now();
  const createdStudentIds = [];
  const createdTestIds = [];

  const [cfgRow] = await conn.query("SELECT value FROM system_config WHERE config_key='master_question_threshold' LIMIT 1");
  let tv = cfgRow[0]?.value;
  if (typeof tv === 'string') { try { tv = JSON.parse(tv); } catch {} }
  const THRESHOLD = parseInt(typeof tv === 'object' && tv !== null ? tv.value : tv, 10) || 3;

  const [tchRows] = await conn.query(
    "SELECT id FROM profiles WHERE role IN ('teacher','super_admin') LIMIT 1"
  );
  const teacherToken = tchRows.length ? await makeSession(conn, tchRows[0].id, 't') : null;
  const teacherId = tchRows[0]?.id;

  // ===================== 需求 1 =====================
  console.log('\n【需求1】学习模块「已掌握 XX 题」');
  await conn.query(
    `INSERT INTO profiles (id, username, real_name, role, current_points, max_points, total_points_earned, total_correct)
     VALUES (?, ?, 'v26冒烟生', 'student', 0, 0, 0, 0)`, [TS, TS]
  );
  createdStudentIds.push(TS);
  const stuToken = await makeSession(conn, TS, 's');

  const lc = await api('/api/student/learn-chapters', { token: stuToken });
  const lcData = lc.json?.data || {};
  const chapters = lcData.chapters || [];
  assert('1.1 接口 200 且返回 16 章', lc.status === 200 && chapters.length === 16,
    `status=${lc.status} len=${chapters.length}`);
  assert('1.2 每章带 mastered_count 数值',
    chapters.every(c => typeof c.mastered_count === 'number'),
    chapters.filter(c => typeof c.mastered_count !== 'number').map(c => c.cluster_id).join(','));
  assert('1.3 顶层带 master_threshold 且与库一致',
    Number(lcData.master_threshold) === THRESHOLD, `got=${lcData.master_threshold} want=${THRESHOLD}`);

  // 造掌握数据：找一道有 cluster_id 的题，练习答对 THRESHOLD 次，看该章 mastered_count 是否 +1
  const [candQ] = await conn.query(
    "SELECT id, cluster_id FROM questions WHERE cluster_id IS NOT NULL AND cluster_id <> '' LIMIT 1"
  );
  if (candQ.length) {
    const q = candQ[0];
    const chName = q.cluster_id.includes('/') ? q.cluster_id.split('/')[0] : q.cluster_id;
    const before = (chapters.find(c => c.cluster_id === chName) || {}).mastered_count || 0;
    const [ansRows] = await conn.query('SELECT answers, type FROM questions WHERE id = ?', [q.id]);
    let ans = ansRows[0].answers;
    if (typeof ans === 'string') { try { ans = JSON.parse(ans); } catch {} }
    const arr = Array.isArray(ans?.answers) ? ans.answers : (Array.isArray(ans) ? ans : [ans]);
    const submitAns = ansRows[0].type === 'choice'
      ? arr.map(a => String(a).trim()).join(',')
      : String(arr[0]).trim();
    for (let i = 0; i < THRESHOLD; i++) {
      await conn.query(
        `INSERT INTO student_answers (id, student_id, question_id, answer, is_correct, points_change, source, created_at)
         VALUES (?, ?, ?, ?, 1, 0, 'practice', NOW())`,
        [`smk26a_${TS}_${i}`, TS, q.id, submitAns]
      );
    }
    const lc2 = await api('/api/student/learn-chapters', { token: stuToken });
    const after = ((lc2.json?.data?.chapters || []).find(c => c.cluster_id === chName) || {}).mastered_count || 0;
    assert(`1.4 练习答对 ${THRESHOLD} 次后「${chName}」掌握数 +1`, after === before + 1, `before=${before} after=${after}`);
    // 再答对 1 次不应继续涨（已掌握不重复计）
    await conn.query(
      `INSERT INTO student_answers (id, student_id, question_id, answer, is_correct, points_change, source, created_at)
       VALUES (?, ?, ?, ?, 1, 0, 'practice', NOW())`,
      [`smk26b_${TS}`, TS, q.id, submitAns]
    );
    const lc3 = await api('/api/student/learn-chapters', { token: stuToken });
    const after2 = ((lc3.json?.data?.chapters || []).find(c => c.cluster_id === chName) || {}).mastered_count || 0;
    assert('1.5 同一题继续答对不重复计入掌握', after2 === after, `after=${after} after2=${after2}`);
  } else {
    console.log('  （跳过 1.4/1.5：题库中没有带 cluster_id 的题）');
  }

  // ===================== 需求 2 =====================
  console.log('\n【需求2】学情分析 每生每章掌握进度');
  const [clsRows] = await conn.query(
    `SELECT c.id, c.teacher_id, COUNT(p.id) AS n FROM classes c
     JOIN profiles p ON p.class_id = c.id AND p.role='student'
     GROUP BY c.id, c.teacher_id HAVING n > 0 ORDER BY n DESC LIMIT 1`
  );
  if (clsRows.length && teacherToken) {
    const cls = clsRows[0];
    // 让冒烟生加入该班，便于校验
    await conn.query('UPDATE profiles SET class_id = ? WHERE id = ?', [cls.id, TS]);
    const cm = await api(`/api/teacher/analytics/chapter-mastery/${cls.id}`, { token: teacherToken });
    const cmd = cm.json?.data || {};
    assert('2.1 接口 200', cm.status === 200, `status=${cm.status}`);
    assert('2.2 chapters 16 章且带 question_count',
      (cmd.chapters || []).length === 16 && (cmd.chapters || []).every(c => typeof c.question_count === 'number'));
    assert('2.3 students 覆盖本班全部学生',
      (cmd.students || []).length === Number(cls.n) + 1,
      `got=${(cmd.students || []).length} want=${Number(cls.n) + 1}`);
    const me = (cmd.students || []).find(s => s.id === TS);
    assert('2.4 含刚加入的冒烟生且 by_chapter 覆盖 16 章',
      !!me && Object.keys(me.by_chapter || {}).length === 16);
    assert('2.5 冒烟生掌握总数 = 1（刚造的题）',
      me && me.total_mastered === 1, `got=${me?.total_mastered}`);
    assert('2.6 带 master_threshold 且与库一致', Number(cmd.master_threshold) === THRESHOLD);
    // 归属校验
    const bad = await api(`/api/teacher/analytics/chapter-mastery/__none__`, { token: teacherToken });
    assert('2.7 非本人/不存在班级被拒', bad.status !== 200, `status=${bad.status}`);
  } else {
    console.log('  （跳过需求2：无班级或教学账号）');
  }

  // ===================== 需求 4 =====================
  console.log('\n【需求4】聚类筛选（题库接口 + 抽题池口径）');
  if (teacherToken) {
    const q1 = await api('/api/teacher/questions?page=1&pageSize=5', { token: teacherToken });
    assert('4.1 题库接口 200 且带 cluster_tree', q1.status === 200 && !!q1.json?.cluster_tree,
      `status=${q1.status}`);
    const tree = q1.json?.cluster_tree || {};
    const primaries = Object.keys(tree);
    assert('4.2 cluster_tree 至少有一个一级类目', primaries.length > 0, `len=${primaries.length}`);
    assert('4.3 题目行带 cluster_id 字段（前端展示/筛选需要）',
      (q1.json?.data || []).every(r => 'cluster_id' in r));

    if (primaries.length > 0) {
      const p = primaries[0];
      // 一级筛选（"一级/" 前缀）
      const byPrimary = await api(`/api/teacher/questions?cluster=${encodeURIComponent(p + '/')}&page=1&pageSize=100`, { token: teacherToken });
      const [cntRow] = await conn.query(
        'SELECT COUNT(*) n FROM questions WHERE cluster_id = ? OR cluster_id LIKE ?', [p, `${p}/%`]
      );
      assert(`4.4 一级筛选命中数与 SQL 一致（${p}）`,
        Number(byPrimary.json?.total) === Number(cntRow[0].n),
        `api=${byPrimary.json?.total} sql=${cntRow[0].n}`);

      // 二级筛选（精确）
      const secs = tree[p] || [];
      if (secs.length > 0) {
        const full = `${p}/${secs[0]}`;
        const bySec = await api(`/api/teacher/questions?cluster=${encodeURIComponent(full)}&page=1&pageSize=100`, { token: teacherToken });
        const [cntRow2] = await conn.query('SELECT COUNT(*) n FROM questions WHERE cluster_id = ?', [full]);
        assert(`4.5 二级筛选精确命中（${full}）`,
          Number(bySec.json?.total) === Number(cntRow2[0].n),
          `api=${bySec.json?.total} sql=${cntRow2[0].n}`);
      }
      // 多选 OR
      if (primaries.length >= 2) {
        const both = `${primaries[0]}/,${primaries[1]}/`;
        const byBoth = await api(`/api/teacher/questions?cluster=${encodeURIComponent(both)}&page=1&pageSize=1`, { token: teacherToken });
        const [cntRow3] = await conn.query(
          'SELECT COUNT(*) n FROM questions WHERE (cluster_id = ? OR cluster_id LIKE ?) OR (cluster_id = ? OR cluster_id LIKE ?)',
          [primaries[0], `${primaries[0]}/%`, primaries[1], `${primaries[1]}/%`]
        );
        assert('4.6 多选一级 OR 命中数与 SQL 一致',
          Number(byBoth.json?.total) === Number(cntRow3[0].n),
          `api=${byBoth.json?.total} sql=${cntRow3[0].n}`);
      }
    }

    // tests 表已加 cluster_filters 列
    const [colRows] = await conn.query("SHOW COLUMNS FROM tests LIKE 'cluster_filters'");
    assert('4.7 tests 表存在 cluster_filters 列', colRows.length === 1,
      `cols=${colRows.map(c => c.Field).join(',')}`);
  } else {
    console.log('  （跳过需求4：无教学账号）');
  }

  // ===================== 需求 5 =====================
  console.log('\n【需求5】重置密码（默认 123456）');
  if (teacherToken) {
    const stuA = 'smk26_pw_a_' + Date.now();
    const stuB = 'smk26_pw_b_' + Date.now();
    for (const sid of [stuA, stuB]) {
      await conn.query(
        `INSERT INTO profiles (id, username, real_name, role, class_id, current_points, max_points, total_points_earned, total_correct)
         VALUES (?, ?, '重置密码冒烟', 'student', ?, 0, 0, 0, 0)`,
        [sid, sid, clsRows.length ? clsRows[0].id : null]
      );
      createdStudentIds.push(sid);
    }
    // 给 A 造一个登录会话，验证重置后会被强制下线
    const tokA = await makeSession(conn, stuA, 'pa');

    // 默认密码（不传 new_password）
    const r1 = await api('/api/teacher/students/reset-password', {
      method: 'POST', token: teacherToken,
      body: { student_ids: [stuA] },
    });
    assert('5.1 不传 new_password 返回 200', r1.status === 200, `status=${r1.status}`);
    assert('5.2 成功 1 条', Number(r1.json?.data?.success_count) === 1, JSON.stringify(r1.json?.data));
    assert('5.3 回执标明默认密码为 123456', r1.json?.data?.password === '123456', String(r1.json?.data?.password));
    const [pwRow] = await conn.query('SELECT password_hash FROM profiles WHERE id = ?', [stuA]);
    assert('5.4 库中密码 = sha256("123456")', pwRow[0]?.password_hash === sha256('123456'),
      `got=${pwRow[0]?.password_hash}`);
    const [sessRow] = await conn.query('SELECT is_active FROM login_sessions WHERE user_id = ?', [stuA]);
    assert('5.5 旧会话被置为失效（强制下线）', sessRow.length > 0 && sessRow.every(s => s.is_active === 0),
      JSON.stringify(sessRow));

    // 指定密码 + 批量
    const r2 = await api('/api/teacher/students/reset-password', {
      method: 'POST', token: teacherToken,
      body: { student_ids: [stuA, stuB], new_password: 'abc12345' },
    });
    assert('5.6 批量重置 2 人成功', Number(r2.json?.data?.success_count) === 2, JSON.stringify(r2.json?.data));
    const [pwRows] = await conn.query('SELECT password_hash FROM profiles WHERE id IN (?)', [[stuA, stuB]]);
    assert('5.7 两人密码均 = sha256("abc12345")',
      pwRows.length === 2 && pwRows.every(r => r.password_hash === sha256('abc12345')));

    // 参数校验
    const r3 = await api('/api/teacher/students/reset-password', {
      method: 'POST', token: teacherToken, body: { student_ids: [] },
    });
    assert('5.8 空列表返回 400', r3.status === 400, `status=${r3.status}`);
    const r4 = await api('/api/teacher/students/reset-password', {
      method: 'POST', body: { student_ids: [stuA] },
    });
    assert('5.9 无 token 被拒 401', r4.status === 401, `status=${r4.status}`);
    // 不存在的 ID → 计入 failed 而非 500
    const r5 = await api('/api/teacher/students/reset-password', {
      method: 'POST', token: teacherToken, body: { student_ids: ['__no_such_student__'] },
    });
    assert('5.10 不存在的学生计入 failed 且不报错',
      r5.status === 200 && (r5.json?.data?.failed || []).length === 1,
      `status=${r5.status} failed=${JSON.stringify(r5.json?.data?.failed)}`);
  } else {
    console.log('  （跳过需求5：无教学账号）');
  }

  // 清理
  await conn.query('DELETE FROM student_answers WHERE student_id = ?', [TS]);
  for (const sid of createdStudentIds) {
    await conn.query('DELETE FROM login_sessions WHERE user_id = ?', [sid]);
  }
  await conn.query('DELETE FROM profiles WHERE id IN (?)', [createdStudentIds]);
  await conn.end();

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  if (fail) { console.log('失败项：\n  - ' + failures.join('\n  - ')); process.exit(1); }
})().catch((e) => { console.error('冒烟异常：', e); process.exit(1); });
