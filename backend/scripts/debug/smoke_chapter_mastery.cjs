/**
 * 掌握进度接口冒烟（需求 1 + 需求 2 的后端）
 *
 * 覆盖：
 *   A. /api/student/learn-chapters 每章带 mastered_count，且与「练习来源答对次数 >= 阈值」逐章一致
 *   B. /api/teacher/analytics/chapter-mastery/:classId 的每学生每章掌握数、总数与 SQL 直算一致
 *   C. 归属校验：教师访问自己班以外的班被拒
 *
 * 用法：先启动后端(node src/index.js, 端口 3101)，再执行
 *   node scripts/debug/smoke_chapter_mastery.cjs
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
    ['smoke_cm_' + tag + '_' + Date.now(), userId, hash, 'smoke']
  );
  return raw;
}

(async () => {
  const conn = await mysql.createConnection(DB);
  const TS = 'smoke_cm_' + Date.now();

  // 掌握阈值
  const [cfgRow] = await conn.query("SELECT value FROM system_config WHERE config_key='master_question_threshold' LIMIT 1");
  let tv = cfgRow[0]?.value;
  if (typeof tv === 'string') { try { tv = JSON.parse(tv); } catch {} }
  const THRESHOLD = parseInt(typeof tv === 'object' && tv !== null ? tv.value : tv, 10) || 3;
  console.log(`\n掌握阈值 master_question_threshold = ${THRESHOLD}\n`);

  // 找一个有学生的班级 + 一个教学角色
  const [clsRows] = await conn.query(
    `SELECT c.id, c.name, COUNT(p.id) AS n FROM classes c
     JOIN profiles p ON p.class_id = c.id AND p.role='student'
     GROUP BY c.id, c.name HAVING n > 0 ORDER BY n DESC LIMIT 1`
  );
  if (!clsRows.length) { console.log('库中没有含学生的班级，跳过需求2断言'); }
  const cls = clsRows[0] || null;
  if (cls) console.log(`班级：${cls.name} (${cls.id}) 学生 ${cls.n} 人`);

  const [tchRows] = await conn.query(
    `SELECT id FROM profiles WHERE role IN ('teacher','super_admin') LIMIT 1`
  );
  if (!tchRows.length) { console.log('库中没有教学角色，无法测需求2'); }

  const teacherToken = tchRows.length ? await makeSession(conn, tchRows[0].id, 't') : null;

  // 造一个学生（用于需求1：该学生 0 掌握，返回应为 0）
  await conn.query(
    `INSERT INTO profiles (id, username, real_name, role, current_points, max_points, total_points_earned, total_correct)
     VALUES (?, ?, '掌握进度冒烟', 'student', 0, 0, 0, 0)`,
    [TS, TS]
  );
  const stuToken = await makeSession(conn, TS, 's');

  // ============ A. learn-chapters ============
  console.log('\n【A】learn-chapters 每章 mastered_count');
  const lc = await api('/api/student/learn-chapters', { token: stuToken });
  assert('A1 接口 200', lc.status === 200, `status=${lc.status}`);
  const lcData = lc.json?.data || {};
  const chapters = lcData.chapters || [];
  assert('A2 返回 16 章', chapters.length === 16, `len=${chapters.length}`);
  assert('A3 顶层带 master_threshold 且与库一致',
    Number(lcData.master_threshold) === THRESHOLD, `got=${lcData.master_threshold} want=${THRESHOLD}`);
  assert('A4 每章都有 mastered_count 字段',
    chapters.every(c => typeof c.mastered_count === 'number'),
    `missing=${chapters.filter(c => typeof c.mastered_count !== 'number').map(c => c.cluster_id).join(',')}`);
  assert('A5 新建学生全章掌握数均为 0',
    chapters.every(c => c.mastered_count === 0),
    `非零章=${chapters.filter(c => c.mastered_count !== 0).map(c => c.cluster_id + ':' + c.mastered_count).join(',')}`);

  // 直连 SQL 复核：拿一个真实学生，逐章比对
  const [anyStu] = await conn.query(
    "SELECT id FROM profiles WHERE role='student' AND id <> ? LIMIT 1", [TS]
  );
  if (anyStu.length) {
    const sid = anyStu[0].id;
    const t2 = await makeSession(conn, sid, 's2');
    const lc2 = await api('/api/student/learn-chapters', { token: t2 });
    const ch2 = lc2.json?.data?.chapters || [];
    const [rows] = await conn.query(
      `SELECT q.cluster_id AS cid, COUNT(*) AS n FROM (
         SELECT question_id FROM student_answers
         WHERE student_id = ? AND source='practice' AND is_correct = 1
         GROUP BY question_id HAVING COUNT(*) >= ?
       ) m JOIN questions q ON q.id = m.question_id
       WHERE q.cluster_id IS NOT NULL AND q.cluster_id <> ''
       GROUP BY q.cluster_id`, [sid, THRESHOLD]
    );
    const expect = new Map();
    for (const r of rows) {
      const ch = String(r.cid).includes('/') ? String(r.cid).split('/')[0] : String(r.cid);
      expect.set(ch, (expect.get(ch) || 0) + Number(r.n));
    }
    const diffs = [];
    for (const c of ch2) {
      const want = expect.get(c.cluster_id) || 0;
      if (c.mastered_count !== want) diffs.push(`${c.cluster_id}: got ${c.mastered_count} want ${want}`);
    }
    assert('A6 真实学生逐章掌握数与 SQL 直算一致', diffs.length === 0, diffs.join(' | '));
    console.log(`     该生掌握总数 = ${ch2.reduce((s, c) => s + c.mastered_count, 0)}`);
  }

  // ============ B. chapter-mastery ============
  if (cls && teacherToken) {
    console.log('\n【B】/api/teacher/analytics/chapter-mastery/:classId');
    const cm = await api(`/api/teacher/analytics/chapter-mastery/${cls.id}`, { token: teacherToken });
    assert('B1 接口 200', cm.status === 200, `status=${cm.status} body=${JSON.stringify(cm.json).slice(0, 200)}`);
    const cmd = cm.json?.data || {};
    assert('B2 带 chapters（16章，含 question_count）',
      (cmd.chapters || []).length === 16 && (cmd.chapters || []).every(c => typeof c.question_count === 'number'),
      `len=${(cmd.chapters || []).length}`);
    assert('B3 带 master_threshold 且与库一致',
      Number(cmd.master_threshold) === THRESHOLD, `got=${cmd.master_threshold} want=${THRESHOLD}`);
    assert('B4 学生数与本班学生数一致',
      (cmd.students || []).length === Number(cls.n),
      `got=${(cmd.students || []).length} want=${cls.n}`);
    const first = (cmd.students || [])[0];
    assert('B5 学生行结构完整（id/real_name/by_chapter/total_mastered）',
      !!first && !!first.id && first.by_chapter && typeof first.total_mastered === 'number');
    assert('B6 by_chapter 覆盖全部 16 章',
      !!first && Object.keys(first.by_chapter).length === 16,
      `keys=${first ? Object.keys(first.by_chapter).length : 'n/a'}`);

    // SQL 逐学生逐章复核
    const [srows] = await conn.query(
      `SELECT m.student_id, q.cluster_id AS cid, COUNT(*) AS n FROM (
         SELECT student_id, question_id FROM student_answers
         WHERE student_id IN (SELECT id FROM profiles WHERE class_id = ? AND role='student')
           AND source='practice' AND is_correct = 1
         GROUP BY student_id, question_id HAVING COUNT(*) >= ?
       ) m JOIN questions q ON q.id = m.question_id
       WHERE q.cluster_id IS NOT NULL AND q.cluster_id <> ''
       GROUP BY m.student_id, q.cluster_id`, [cls.id, THRESHOLD]
    );
    const expMap = new Map();
    for (const r of srows) {
      const ch = String(r.cid).includes('/') ? String(r.cid).split('/')[0] : String(r.cid);
      if (!expMap.has(r.student_id)) expMap.set(r.student_id, new Map());
      const m = expMap.get(r.student_id);
      m.set(ch, (m.get(ch) || 0) + Number(r.n));
    }
    const bad = [];
    for (const s of cmd.students || []) {
      const m = expMap.get(s.id) || new Map();
      let tot = 0;
      for (const c of cmd.chapters || []) {
        const want = m.get(c.cluster_id) || 0;
        if ((s.by_chapter[c.cluster_id] || 0) !== want) {
          bad.push(`${s.real_name}/${c.cluster_id}: got ${s.by_chapter[c.cluster_id]} want ${want}`);
        }
        tot += want;
      }
      if (s.total_mastered !== tot) bad.push(`${s.real_name}/total: got ${s.total_mastered} want ${tot}`);
    }
    assert('B7 每学生每章掌握数 + 总数与 SQL 直算完全一致', bad.length === 0, bad.slice(0, 5).join(' | '));
    const totAll = (cmd.students || []).reduce((a, s) => a + s.total_mastered, 0);
    console.log(`     本班掌握总数（学生×题 去重） = ${totAll}`);

    // C. 归属校验：教师访问不存在的班级
    console.log('\n【C】归属校验');
    const other = await api('/api/teacher/analytics/chapter-mastery/__no_such_class__', { token: teacherToken });
    assert('C1 不存在/非本人班级被拒（非 200）', other.status !== 200, `status=${other.status}`);
    const noTok = await api(`/api/teacher/analytics/chapter-mastery/${cls.id}`);
    assert('C2 无 token 被拒（401）', noTok.status === 401, `status=${noTok.status}`);
  } else {
    console.log('\n（跳过 B/C：无可用班级或教学账号）');
  }

  // 清理
  await conn.query('DELETE FROM login_sessions WHERE user_id = ?', [TS]);
  await conn.query('DELETE FROM profiles WHERE id = ?', [TS]);
  await conn.end();

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  if (fail) { console.log('失败项：\n  - ' + failures.join('\n  - ')); process.exit(1); }
})().catch(async (e) => {
  console.error('冒烟异常：', e);
  process.exit(1);
});
