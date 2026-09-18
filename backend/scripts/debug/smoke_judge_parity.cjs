/**
 * 判分一致性校验（服务端判分 vs 题库真实答案）
 *
 * 为什么需要它：练习 / 错题 / 测试 / 考试的判分现在全部由服务端按题库答案裁定。
 * 如果服务端判分比前端更严格，就会出现「学生明明答对了却被判错」的事故。
 * 本脚本拿真实题库数据，把「按题库正确答案构造的满分作答」逐个提交给后端，
 * 要求服务端必须判对；再用明显错误的答案提交，要求必须判错。
 *
 * 用法：先启动后端(node src/index.js)，再执行
 *   node scripts/debug/smoke_judge_parity.cjs
 */
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' };

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}  ${extra}`); }
}

const parseField = (v) => {
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; }
};
const answersArr = (v) => {
  const p = parseField(v);
  if (Array.isArray(p?.answers)) return p.answers;
  if (Array.isArray(p)) return p;
  if (p === null || p === undefined) return [];
  return [p];
};

(async () => {
  const conn = await mysql.createConnection(DB);
  const TS = 'smoke_judge_' + Date.now();

  await conn.query(
    `INSERT INTO profiles (id, username, real_name, role, current_points, max_points, total_points_earned, total_correct)
     VALUES (?, ?, '判分一致性测试', 'student', 500, 500, 0, 0)`,
    [TS, TS]
  );
  const rawToken = `${Date.now()}.${crypto.randomBytes(32).toString('hex')}`;
  await conn.query(
    `INSERT INTO login_sessions (id, user_id, token, device_info, ip_address, created_at, last_active_at, expires_at, is_active)
     VALUES (?, ?, ?, 'smoke', '127.0.0.1', NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), TRUE)`,
    ['smoke_judge_' + Date.now(), TS, crypto.createHash('sha256').update(rawToken).digest('hex')]
  );

  const submit = (question_id, answer) => fetch(BASE + '/api/business/submit-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawToken}` },
    body: JSON.stringify({ student_id: TS, question_id, answer, is_correct: false, points_change: 0, source: 'practice' }),
  }).then(r => r.json()).then(j => j?.data || { _err: j?.error });

  // ---------------- 1. 普通题目：选择题 / 填空题 ----------------
  console.log('--- 1. 普通题（选择题/填空题）判分一致性 ---');
  const [plain] = await conn.query(
    "SELECT id, type, answers FROM questions WHERE practice_enabled = 1 AND type IN ('choice','fill_blank') LIMIT 40"
  );
  let plainOk = 0, plainWrongOk = 0, plainTotal = 0;
  for (const q of plain) {
    const arr = answersArr(q.answers).map(a => String(a).trim()).filter(Boolean);
    if (arr.length === 0) continue;
    plainTotal++;
    const perfect = q.type === 'choice' ? arr.join(',') : arr[0];
    const rOk = await submit(q.id, perfect);
    if (rOk.is_correct === true) plainOk++;
    else console.log(`     判错示例: ${q.id}(${q.type}) 提交"${perfect}" → server=${rOk.is_correct}`);

    const rBad = await submit(q.id, `__WRONG_${Math.random().toString(36).slice(2, 6)}__`);
    if (rBad.is_correct === false) plainWrongOk++;
    else console.log(`     误判对示例: ${q.id}(${q.type}) 提交乱码 → server=${rBad.is_correct}`);
  }
  console.log(`  抽样 ${plainTotal} 题：满分作答判对 ${plainOk}/${plainTotal}，错误作答判错 ${plainWrongOk}/${plainTotal}`);
  assert('普通题：按题库答案作答一律判对（无漏判）', plainOk === plainTotal, `${plainOk}/${plainTotal}`);
  assert('普通题：乱码作答一律判错（无误判）', plainWrongOk === plainTotal, `${plainWrongOk}/${plainTotal}`);

  // ---------------- 2. 复合题：按前端同构的作答结构提交 ----------------
  console.log('\n--- 2. 复合题判分一致性（按前端同构结构构造作答） ---');
  const [comps] = await conn.query(
    "SELECT id, type, answers FROM questions WHERE practice_enabled = 1 AND type = 'composite'"
  );
  const buildComposite = (subQs, mode) => {
    const choice_answers = [];
    const blank_answers = [];
    let wrongFlipped = false;
    subQs.forEach((sq, idx) => {
      const arr = answersArr(sq.answers);
      if (sq.type === 'choice' || sq.type === 'multiple_choice') {
        let letters;
        if (mode === 'perfect') {
          letters = arr.map(a => String(a).trim().toUpperCase());
        } else if (!wrongFlipped) {
          letters = ['Z']; // 一定不在选项里
          wrongFlipped = true;
        } else {
          letters = arr.map(a => String(a).trim().toUpperCase());
        }
        choice_answers[idx] = letters.join(',');
        blank_answers[idx] = [];
      } else {
        const blanks = (Array.isArray(arr) ? arr : [])
          .map(a => (Array.isArray(a) ? String(a[0] ?? '') : String(a ?? '')))
          .filter(v => v !== '');
        if (mode === 'wrong' && !wrongFlipped) {
          blank_answers[idx] = blanks.map(() => '__WRONG__');
          wrongFlipped = true;
        } else {
          blank_answers[idx] = blanks;
        }
        choice_answers[idx] = '';
      }
    });
    return JSON.stringify({ choice_answers, blank_answers });
  };

  let compPerfect = 0, compWrong = 0, compTotal = 0, compSkipped = 0;
  // 小题答案缺失（answers 为空）的复合题：前端 checkChoiceAnswer 同样会返回 false，
  // 属于题库数据问题，这里跳过并单独提示，不算判分漏判。
  const hasUsableAnswers = (subQs) => subQs.every(sq => {
    const arr = answersArr(sq.answers);
    return Array.isArray(arr) && arr.length > 0;
  });
  for (const q of comps) {
    const subQs = answersArr(q.answers);
    if (!Array.isArray(subQs) || subQs.length === 0 || typeof subQs[0] !== 'object') continue;
    if (!hasUsableAnswers(subQs)) {
      compSkipped++;
      console.log(`  跳过（小题答案缺失，前端也会判错，建议教师补全）: ${q.id}`);
      continue;
    }
    compTotal++;

    const rOk = await submit(q.id, buildComposite(subQs, 'perfect'));
    if (rOk.is_correct === true) compPerfect++;
    else console.log(`     复合题判错示例: ${q.id} → server=${rOk.is_correct}`);

    const rBad = await submit(q.id, buildComposite(subQs, 'wrong'));
    if (rBad.is_correct === false) compWrong++;
    else console.log(`     复合题误判对示例: ${q.id} → server=${rBad.is_correct}`);
  }
  console.log(`  抽样 ${compTotal} 道复合题：满分作答判对 ${compPerfect}/${compTotal}，含错作答判错 ${compWrong}/${compTotal}（跳过数据缺失 ${compSkipped} 道）`);
  assert('复合题：按题库答案作答一律判对（无漏判）', compTotal > 0 && compPerfect === compTotal, `${compPerfect}/${compTotal}`);
  assert('复合题：含错误小题时判错', compWrong === compTotal, `${compWrong}/${compTotal}`);

  // ---------------- 3. 题目不存在时不允许计分 ----------------
  console.log('\n--- 3. 题目不存在时拒绝计分 ---');
  const ghost = await fetch(BASE + '/api/business/submit-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawToken}` },
    body: JSON.stringify({ student_id: TS, question_id: 'not_exists_' + Date.now(), answer: 'A', is_correct: true, points_change: 999, source: 'practice' }),
  });
  assert('题库中不存在的 question_id 被拒 404', ghost.status === 404, `status=${ghost.status}`);

  // ---- 清理 ----
  await conn.query('DELETE FROM student_answers WHERE student_id=?', [TS]);
  await conn.query('DELETE FROM student_equipments WHERE student_id=?', [TS]);
  await conn.query('DELETE FROM point_transactions WHERE student_id=?', [TS]);
  await conn.query('DELETE FROM wrong_questions WHERE student_id=?', [TS]);
  await conn.query('DELETE FROM student_buffs WHERE student_id=?', [TS]).catch(() => {});
  await conn.query('DELETE FROM login_sessions WHERE user_id=?', [TS]);
  await conn.query('DELETE FROM profiles WHERE id=?', [TS]);
  await conn.end();

  console.log(`\n========== ${pass} 通过 / ${fail} 失败 ==========`);
  if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('PARITY ERROR:', e); process.exit(2); });
