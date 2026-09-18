/**
 * 门禁 / 判分 / 归属校验 冒烟测试
 *
 * 覆盖四件事：
 *   1. 掌握门禁：同一题反复提交不再刷分刷装备（背景：有学生 26 分钟提交同一题 317 次）
 *   2. 服务端判分：对错与分值一律以题库 + 系统配置为准，前端传的 is_correct / points_change /
 *      questions[].answers 一概不作数（背景：伪造这两个字段就能白拿积分和装备）
 *   3. 归属校验：学生不能拿别人的 student_id 提交（练习 / 测试 / 考试 / 掉落接口）
 *   4. 考试重考：同一场考试只补发「成绩提高」的积分差额，重考同分不再加分
 *
 * 用法：先启动后端(node src/index.js, 端口 3101)，再执行
 *   node scripts/debug/smoke_master_gate.cjs
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
// 从题库行里取出「学生该提交什么才算对」：多选拼成 "A,C"，其他取第一个
const correctAnswerFor = (row) => {
  const arr = answersArr(row.answers);
  if (arr.length === 0) return null;
  if (!arr.every(a => typeof a === 'string' && a.trim() !== '')) return null;
  return row.type === 'choice' ? arr.map(a => a.trim()).join(',') : arr[0].trim();
};

(async () => {
  const conn = await mysql.createConnection(DB);
  const TS = 'smoke_gate_' + Date.now();

  // ---- 取真实题目（跳过复合题，需要能被判分的正确答案；不新建题目，避免污染题库） ----
  const [cand] = await conn.query(
    "SELECT id, type, answers, options FROM questions WHERE type <> 'composite' AND answers IS NOT NULL LIMIT 300"
  );
  const usable = [];
  for (const row of cand) {
    const correct = correctAnswerFor(row);
    if (correct) {
      usable.push({
        id: row.id,
        type: row.type,
        correct,
        wrong: `__WRONG_${Math.random().toString(36).slice(2, 8)}__`,
      });
    }
  }
  if (usable.length < 7) throw new Error(`可判分的非复合题只有 ${usable.length} 道，至少需要 7 道`);
  const [Q1, Q2, Q3, Q4, Q5, Q6, Q7] = usable;
  console.log('测试题目:', usable.slice(0, 7).map(q => `${q.id}(${q.type})`).join(' '));

  // ---- 造测试学生 + 直连造会话（绕过登录接口） ----
  await conn.query(
    `INSERT INTO profiles (id, username, real_name, role, current_points, max_points, total_points_earned, total_correct)
     VALUES (?, ?, '门禁冒烟测试', 'student', 500, 500, 0, 0)`,
    [TS, TS]
  );
  const rawToken = `${Date.now()}.${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await conn.query(
    `INSERT INTO login_sessions (id, user_id, token, device_info, ip_address, created_at, last_active_at, expires_at, is_active)
     VALUES (?, ?, ?, 'smoke', '127.0.0.1', NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), TRUE)`,
    ['smoke_' + Date.now(), TS, tokenHash]
  );

  // ---- 读取阈值 ----
  const [cfgRow] = await conn.query("SELECT value FROM system_config WHERE config_key='master_question_threshold' LIMIT 1");
  let tv = cfgRow[0]?.value;
  if (typeof tv === 'string') { try { tv = JSON.parse(tv); } catch {} }
  const THRESHOLD = parseInt(typeof tv === 'object' && tv !== null ? tv.value : tv, 10) || 3;
  console.log(`\n掌握阈值 master_question_threshold = ${THRESHOLD}`);
  console.log(`后端地址 ${BASE}\n`);

  // 练习提交：显式带上前端会传的 is_correct / points_change，用来验证服务端是否采信
  const submitQ = (q, answerText, clientIsCorrect, pointsChange, source = 'practice', extra = {}) =>
    api('/api/business/submit-answer', {
      method: 'POST', token: rawToken,
      body: {
        student_id: TS, question_id: q.id, answer: answerText,
        is_correct: clientIsCorrect, points_change: pointsChange, source, ...extra,
      },
    });

  const snap = async () => {
    const [r] = await conn.query(
      'SELECT current_points, max_points, total_points_earned, total_correct, curr_streak FROM profiles WHERE id=?', [TS]
    );
    const [eq] = await conn.query('SELECT COUNT(*) n FROM student_equipments WHERE student_id=?', [TS]);
    const [tx] = await conn.query('SELECT COUNT(*) n FROM point_transactions WHERE student_id=?', [TS]);
    return { ...r[0], equip: eq[0].n, tx: tx[0].n };
  };

  // ================= 场景 A：同题答对连点 10 次 =================
  console.log('--- 场景A：同一题答对，连续提交 10 次（模拟界面卡住连点） ---');
  const a0 = await snap();
  const RA = [];
  for (let i = 0; i < 10; i++) {
    const r = await submitQ(Q1, Q1.correct, true, 10);
    RA.push(r.json?.data || { _err: r.json?.error || r.status });
  }
  const a1 = await snap();
  const rewarded = RA.filter(x => x.rewarded !== false).length;
  const earned = a1.current_points - a0.current_points;
  const equipGain = a1.equip - a0.equip;
  const txAdded = a1.tx - a0.tx;
  console.log(`  计分次数: ${rewarded}/10   积分: ${a0.current_points} → ${a1.current_points} (+${earned})   装备 +${equipGain}   流水 +${txAdded}`);
  console.log(`  对比漏洞版本：同样 10 次连点会拿到 +100 以上积分并掷 10 次装备掉落`);

  assert('服务端判分与题库答案一致（is_correct=true）', RA.every(x => x.is_correct === true), JSON.stringify(RA.map(x => x.is_correct)));
  assert(`答对连点 10 次只有前 ${THRESHOLD} 次计分`, rewarded === THRESHOLD, `实际 ${rewarded}`);
  assert('被拦截的提交标记 already_mastered', RA.slice(THRESHOLD).every(x => x.reward_blocked_reason === 'already_mastered'), JSON.stringify(RA.slice(THRESHOLD).map(x => x.reward_blocked_reason)));
  assert('被拦截的提交不再掉装备', RA.slice(THRESHOLD).every(x => !(x.dropped_equipments || []).length));
  assert('被拦截的提交 final_score 归零', RA.slice(THRESHOLD).every(x => x.final_score === 0), JSON.stringify(RA.slice(THRESHOLD).map(x => x.final_score)));
  assert('被拦截的提交 crit_final_score 归零', RA.slice(THRESHOLD).every(x => x.crit_final_score === 0));
  assert(`积分增量受控（远小于 10 次的 +100）`, earned > 0 && earned <= THRESHOLD * 25, `实际 +${earned}`);
  assert('积分流水条数 ≤ 计分次数×2（基础分+暴击/战力差额）', txAdded <= rewarded * 2, `实际 ${txAdded}，计分 ${rewarded} 次`);
  assert('total_correct 未被连点灌水', a1.total_correct - a0.total_correct <= THRESHOLD, `实际 +${a1.total_correct - a0.total_correct}`);
  assert('curr_streak 未被连点灌水', a1.curr_streak <= THRESHOLD, `实际 ${a1.curr_streak}`);
  assert('回执带 mastered=true（前端据此移出队列）', RA[RA.length - 1].mastered === true);

  // ================= 场景 B：已掌握题再答错不再扣分 =================
  console.log('\n--- 场景B：已掌握的题继续答错，不应再扣分 ---');
  const b0 = await snap();
  for (let i = 0; i < 5; i++) await submitQ(Q1, Q1.wrong, false, -5);
  const b1 = await snap();
  assert('已掌握题答错不扣分', b1.current_points === b0.current_points, `${b0.current_points} → ${b1.current_points}`);
  assert('积分仍 ≥ 0', b1.current_points >= 0);

  // ================= 场景 C：新题答错达到阈值后不再扣分 =================
  console.log('\n--- 场景C：新题答错，扣分次数应被限制在阈值内 ---');
  const c0 = await snap();
  const RC = [];
  for (let i = 0; i < THRESHOLD + 3; i++) {
    const r = await submitQ(Q2, Q2.wrong, false, -5);
    RC.push(r.json?.data || {});
  }
  const c1 = await snap();
  const deducted = c0.current_points - c1.current_points;
  console.log(`  答错 ${THRESHOLD + 3} 次，共扣 ${deducted} 分（上限应为 5×${THRESHOLD}=${5 * THRESHOLD}）`);
  assert('同题答错扣分被限制在阈值内', deducted <= 5 * THRESHOLD, `实际扣 ${deducted}`);
  assert('答错超限标记 wrong_limit', RC.slice(-2).some(x => x.reward_blocked_reason === 'wrong_limit'));
  assert('答错超限后 final_score 归零', RC.slice(-1)[0].final_score === 0);

  // ================= 场景 D：新题首次答对正常计分 =================
  console.log('\n--- 场景D：新题首次答对，正常计分（未误伤） ---');
  const d0 = await snap();
  const rd = await submitQ(Q3, Q3.correct, true, 10);
  const d1 = await snap();
  console.log(`  积分: ${d0.current_points} → ${d1.current_points}`);
  assert('新题首次答对正常加分', d1.current_points > d0.current_points, `+${d1.current_points - d0.current_points}`);
  assert('新题首次答对 rewarded=true', rd.json?.data?.rewarded !== false);
  assert('阈值>1 时首次答对不标记 mastered', THRESHOLD <= 1 || rd.json?.data?.mastered === false);

  // ================= 场景 E：非 practice 来源不受影响 =================
  console.log('\n--- 场景E：test 来源不受本次改动影响（用干净题目） ---');
  const re = await submitQ(Q4, Q4.correct, true, 10, 'test', { test_id: 'x', test_record_id: 'smoke_er_' + Date.now() });
  assert('test 来源提交有明确回执（未 500）', re.status === 200 && !!re.json?.data, `status=${re.status} err=${re.json?.error}`);
  assert('test 来源不被掌握门禁拦截', re.json?.data?.rewarded !== false);

  // ================= 场景 F：越权仍被拦（学生改他人 student_id） =================
  console.log('\n--- 场景F：归属校验（学生不能替别人提交） ---');
  const [others] = await conn.query("SELECT id FROM profiles WHERE role='student' AND id<>? LIMIT 1", [TS]);
  const OTHER_ID = others.length > 0 ? others[0].id : null;
  if (OTHER_ID) {
    const rf = await submitQ(Q4, Q4.correct, true, 10, 'practice');
    assert('自测前置：本人提交正常（200）', rf.status === 200, `status=${rf.status}`);
    const rf2 = await api('/api/business/submit-answer', {
      method: 'POST', token: rawToken,
      body: { student_id: OTHER_ID, question_id: Q4.id, answer: Q4.correct, is_correct: true, points_change: 10, source: 'practice' },
    });
    assert('用他人 student_id 提交被拒 403', rf2.status === 403, `status=${rf2.status}`);
  } else {
    console.log('  （跳过，库中无其他学生）');
  }

  // ================= 场景 G/H/I/J：测试相关 =================
  const SIMPLE_Q = Q5; // 专用于测试场景
  console.log(`\n测试用题: ${SIMPLE_Q.id}(${SIMPLE_Q.type})  正确答案: ${SIMPLE_Q.correct}`);

  const mkTest = async (testId, { dailyLimit = 0, drop = 0, points = 100, q = SIMPLE_Q, type = 'test', title = '冒烟测试-临时' } = {}) => {
    await conn.query(
      `INSERT INTO tests (id, title, question_ids, difficulty, question_count, points_reward, time_limit, is_active, passing_score, created_by, type, class_ids, allow_equipment_drop, daily_test_limit)
       VALUES (?, ?, ?, 'medium', 1, ?, 30, 1, 60, ?, ?, '[]', ?, ?)`,
      [testId, title, JSON.stringify([q.id]), points, TS, type, drop, dailyLimit]
    );
  };
  const submitTest = (testId, q = SIMPLE_Q) => api('/api/business/submit-test', {
    method: 'POST', token: rawToken,
    body: {
      student_id: TS,
      test_id: testId,
      answers: { [q.id]: q.correct },
      questions: [{ id: q.id, type: q.type, answers: JSON.stringify([q.correct]), multiple: false }],
    },
  });

  // ---- 场景 G：每日测试次数限制 ----
  console.log('\n--- 场景G：每日测试次数限制（daily_test_limit=1） ---');
  const TEST_G = 'smoke_test_g_' + Date.now();
  await mkTest(TEST_G, { dailyLimit: 1, drop: 0, points: 100 });
  const g0 = await snap();
  const rg1 = await submitTest(TEST_G);
  const g1 = await snap();
  console.log(`  第 1 次提交: status=${rg1.status} score=${rg1.json?.data?.score} 得积分=${rg1.json?.data?.points_earned}`);
  assert('每日限 1 次时，第 1 次可正常提交并及格', rg1.status === 200 && rg1.json?.data?.is_passed === true, `status=${rg1.status} err=${rg1.json?.error}`);
  assert('第 1 次正常发放奖励积分', g1.current_points > g0.current_points, `${g0.current_points} → ${g1.current_points}`);

  const rg2 = await submitTest(TEST_G);
  const g2 = await snap();
  console.log(`  第 2 次提交: status=${rg2.status} error=${rg2.json?.error}`);
  assert('每日限 1 次时，第 2 次被拒 400', rg2.status === 400, `status=${rg2.status}`);
  assert('拒绝提示包含「今日」', String(rg2.json?.error || '').includes('今日'), String(rg2.json?.error));
  assert('被拒时不再发积分', g2.current_points === g1.current_points, `${g1.current_points} → ${g2.current_points}`);

  const [trG] = await conn.query('SELECT COUNT(*) n FROM test_records WHERE student_id=? AND test_id=?', [TS, TEST_G]);
  assert('被拒时不再写入测试记录', trG[0].n === 1, `实际 ${trG[0].n} 条`);

  // 限制改为 0 → 不再限制
  await conn.query('UPDATE tests SET daily_test_limit = 0 WHERE id = ?', [TEST_G]);
  const rg3 = await submitTest(TEST_G);
  assert('将限制改为 0 后可继续正常提交（不限制）', rg3.status === 200 && rg3.json?.data?.is_passed === true, `status=${rg3.status} err=${rg3.json?.error}`);

  // ---- 场景 H：练习里已「掌握」的题，测试中照样完整作答并拿奖励 ----
  console.log('\n--- 场景H：练习已掌握的题，在测试中仍能完整作答并拿奖励 ---');
  for (let i = 0; i < THRESHOLD; i++) {
    await submitQ(SIMPLE_Q, SIMPLE_Q.correct, true, 10);
  }
  const [hHist] = await conn.query(
    "SELECT SUM(CASE WHEN is_correct=1 THEN 1 ELSE 0 END) correct_cnt FROM student_answers WHERE student_id=? AND question_id=? AND source='practice'",
    [TS, SIMPLE_Q.id]
  );
  console.log(`  该题练习答对次数: ${hHist[0].correct_cnt}（阈值 ${THRESHOLD}）`);
  assert('前置条件：该题在练习中已达到掌握阈值', Number(hHist[0].correct_cnt) >= THRESHOLD, `实际 ${hHist[0].correct_cnt}`);

  const TEST_H = 'smoke_test_h_' + Date.now();
  await mkTest(TEST_H, { q: SIMPLE_Q, title: '冒烟测试-含已掌握题' });

  const h0 = await snap();
  const rh = await submitTest(TEST_H);
  const h1 = await snap();
  console.log(`  提交已掌握题: status=${rh.status} score=${rh.json?.data?.score} 得积分=${rh.json?.data?.points_earned}`);
  assert('练习已掌握的题在测试中不被拦截（200）', rh.status === 200, `status=${rh.status} err=${rh.json?.error}`);
  assert('测试中该题正常判分及格', rh.json?.data?.is_passed === true, `score=${rh.json?.data?.score}`);
  assert('测试及格正常发放奖励积分', h1.current_points > h0.current_points, `${h0.current_points} → ${h1.current_points}`);

  const [hTestCnt] = await conn.query(
    "SELECT SUM(CASE WHEN source='test' THEN 1 ELSE 0 END) test_cnt FROM student_answers WHERE student_id=? AND question_id=?",
    [TS, SIMPLE_Q.id]
  );
  assert('测试答题以 source=test 单独记录，不污染练习口径', Number(hTestCnt[0].test_cnt) >= 1, `test 条数 ${hTestCnt[0].test_cnt}`);

  // ---- 场景 I：装备掉落接口加固 ----
  console.log('\n--- 场景I：test-equipment-drop 加固（归属 / 真实及格记录 / 幂等） ---');
  const TEST_I = 'smoke_test_i_' + Date.now();
  await mkTest(TEST_I, { dailyLimit: 0, drop: 1, points: 100, title: '冒烟测试-掉落' });

  // 模拟「前端降级路径」：直接写一条及格的作答记录（equipment_granted 默认 0）
  const REC_I = 'smoke_tr_pass_' + Date.now();
  await conn.query(
    'INSERT INTO test_records (id, test_id, student_id, score, correct_count, total_count, points_earned) VALUES (?, ?, ?, 100, 1, 1, 100)',
    [REC_I, TEST_I, TS]
  );

  const dropCall = (body) => api('/api/business/test-equipment-drop', { method: 'POST', token: rawToken, body });

  const di0 = await dropCall({ student_id: TS, test_id: TEST_I });
  assert('不传 test_record_id 直接被拒 400', di0.status === 400, `status=${di0.status} err=${di0.json?.error}`);

  const di1 = await dropCall({ student_id: TS, test_id: TEST_I, test_record_id: 'not_exists_' + Date.now() });
  assert('伪造 test_record_id 被拒 400', di1.status === 400, `status=${di1.status} err=${di1.json?.error}`);

  const FAIL_REC = 'smoke_tr_fail_' + Date.now();
  await conn.query(
    'INSERT INTO test_records (id, test_id, student_id, score, correct_count, total_count, points_earned) VALUES (?, ?, ?, 10, 0, 1, 0)',
    [FAIL_REC, TEST_I, TS]
  );
  const di4 = await dropCall({ student_id: TS, test_id: TEST_I, test_record_id: FAIL_REC });
  assert('未及格记录不发放掉落（400）', di4.status === 400, `status=${di4.status} err=${di4.json?.error}`);

  if (OTHER_ID) {
    const di5 = await dropCall({ student_id: OTHER_ID, test_id: TEST_I, test_record_id: REC_I });
    assert('用他人 student_id 调用掉落接口被拒 403', di5.status === 403, `status=${di5.status}`);
  }

  const di2 = await dropCall({ student_id: TS, test_id: TEST_I, test_record_id: REC_I, is_passed: true });
  const [recAfter] = await conn.query('SELECT equipment_granted FROM test_records WHERE id = ?', [REC_I]);
  assert('真实及格记录可发放掉落（200）', di2.status === 200, `status=${di2.status} err=${di2.json?.error}`);
  assert('发放后标记 equipment_granted=1', Number(recAfter[0].equipment_granted) === 1, `实际 ${recAfter[0]?.equipment_granted}`);

  const di3 = await dropCall({ student_id: TS, test_id: TEST_I, test_record_id: REC_I, is_passed: true });
  assert('同一条记录再次调用不再掉落（幂等）', di3.status === 200 && (di3.json?.data?.dropped_equipments || []).length === 0,
    `status=${di3.status} 掉落 ${(di3.json?.data?.dropped_equipments || []).length} 件`);

  const ri1 = await submitTest(TEST_I);
  const recI = ri1.json?.data?.test_record_id;
  assert('场景I：submit-test 主路径提交成功', ri1.status === 200 && !!recI, `status=${ri1.status}`);
  const [recMain] = await conn.query('SELECT equipment_granted FROM test_records WHERE id = ?', [recI]);
  assert('主路径发完掉落即标记 equipment_granted=1', Number(recMain[0].equipment_granted) === 1, `实际 ${recMain[0]?.equipment_granted}`);

  // ---- 场景 J：submit-answer 对非练习来源的查重口径 ----
  console.log('\n--- 场景J：非练习来源只拦截「同一次作答」内的重复提交 ---');
  const TR_A = 'smoke_tr_a_' + Date.now();
  const TR_B = 'smoke_tr_b_' + Date.now();
  const j1 = await submitQ(Q4, Q4.correct, true, 10, 'test', { test_id: 'x', test_record_id: TR_A });
  assert('同一次作答的第 1 次提交成功（200）', j1.status === 200, `status=${j1.status} err=${j1.json?.error}`);

  const j2 = await submitQ(Q4, Q4.correct, true, 10, 'test', { test_id: 'x', test_record_id: TR_A });
  assert('同一次作答内重复提交被拒 400', j2.status === 400, `status=${j2.status}`);

  const j3 = await submitQ(Q4, Q4.correct, true, 10, 'test', { test_id: 'x', test_record_id: TR_B });
  assert('换一次作答（新的 test_record_id）不被历史拦截（200）', j3.status === 200, `status=${j3.status} err=${j3.json?.error}`);

  // ================= 场景 K：伪造判分与分值（核心防作弊） =================
  console.log('\n--- 场景K：前端传的 is_correct / points_change 不作数 ---');
  const k0 = await snap();
  const rk1 = await submitQ(Q6, Q6.wrong, true, 10);
  const k1 = await snap();
  assert('K1 答错却声称 is_correct=true → 服务端仍判错', rk1.json?.data?.is_correct === false, `服务端 is_correct=${rk1.json?.data?.is_correct}`);
  assert('K1 不发放积分（按答错处理）', k1.current_points <= k0.current_points, `${k0.current_points} → ${k1.current_points}`);
  assert('K1 total_correct 未被灌水', k1.total_correct - k0.total_correct <= 0, `实际 +${k1.total_correct - k0.total_correct}`);
  assert('K1 未触发装备掉落', (rk1.json?.data?.dropped_equipments || []).length === 0);

  const k2_0 = await snap();
  const rk2 = await submitQ(Q7, Q7.correct, false, -5);
  const k2_1 = await snap();
  assert('K2 答对却声称 is_correct=false → 服务端仍判对', rk2.json?.data?.is_correct === true, `服务端 is_correct=${rk2.json?.data?.is_correct}`);
  assert('K2 正常加分（伪造的前端判分无效）', k2_1.current_points > k2_0.current_points, `${k2_0.current_points} → ${k2_1.current_points}`);

  const k3_0 = await snap();
  await submitQ(Q7, Q7.correct, true, 999999);
  const k3_1 = await snap();
  assert('K3 伪造 points_change=999999 未灌高 total_points_earned', k3_1.total_points_earned - k3_0.total_points_earned <= 25,
    `实际 +${k3_1.total_points_earned - k3_0.total_points_earned}`);
  assert('K3 伪造 points_change 未灌高 max_points', k3_1.max_points - k3_0.max_points <= 25,
    `实际 +${k3_1.max_points - k3_0.max_points}`);

  // ================= 场景 L：伪造测试题答案（questions[].answers 不可信） =================
  console.log('\n--- 场景L：测试提交时伪造「正确答案」 ---');
  const TEST_L = 'smoke_test_l_' + Date.now();
  const FORGED = '__FORGED_' + Math.random().toString(36).slice(2, 8) + '__';
  await mkTest(TEST_L, { q: Q6, title: '冒烟测试-伪造答案' });
  const rl = await api('/api/business/submit-test', {
    method: 'POST', token: rawToken,
    body: {
      student_id: TS,
      test_id: TEST_L,
      answers: { [Q6.id]: FORGED },
      // 伪造：把自己的答案当成"正确答案"塞进请求体
      questions: [{ id: Q6.id, type: 'choice', answers: JSON.stringify([FORGED]), multiple: false }],
    },
  });
  assert('伪造答案提交成功但判 0 分（服务端取自题库）', rl.status === 200 && rl.json?.data?.score === 0,
    `status=${rl.status} score=${rl.json?.data?.score}`);
  assert('伪造答案不及格、不发奖励', rl.json?.data?.is_passed === false && (rl.json?.data?.points_earned || 0) === 0,
    `is_passed=${rl.json?.data?.is_passed} points=${rl.json?.data?.points_earned}`);

  // ================= 场景 P：少报题目（缩分母）不能得满分 =================
  console.log('\n--- 场景P：只提交 1 道题（缩分母）刷满分 ---');
  const TEST_P = 'smoke_test_p_' + Date.now();
  await conn.query(
    `INSERT INTO tests (id, title, question_ids, difficulty, question_count, points_reward, time_limit, is_active, passing_score, created_by, type, class_ids, allow_equipment_drop, daily_test_limit)
     VALUES (?, '冒烟测试-缩分母', ?, 'medium', 3, 100, 30, 1, 60, ?, 'test', '[]', 0, 0)`,
    [TEST_P, JSON.stringify([Q1.id, Q2.id, Q3.id]), TS]
  );
  const rp = await api('/api/business/submit-test', {
    method: 'POST', token: rawToken,
    body: {
      student_id: TS, test_id: TEST_P,
      // 只交一道自己会的题，并把它当成"整张卷子"
      answers: { [Q1.id]: Q1.correct },
      questions: [{ id: Q1.id, type: Q1.type, answers: JSON.stringify([Q1.correct]) }],
    },
  });
  console.log(`  只交 1 题（试卷应有 3 题）: status=${rp.status} score=${rp.json?.data?.score} total=${rp.json?.data?.total}`);
  assert('缩分母提交被按应有题数计分（score 明显低于 100）', rp.status === 200 && rp.json?.data?.score < 100,
    `score=${rp.json?.data?.score} total=${rp.json?.data?.total}`);
  assert('缩分母提交因不及格而不发奖励', rp.json?.data?.is_passed === false && (rp.json?.data?.points_earned || 0) === 0,
    `is_passed=${rp.json?.data?.is_passed} points=${rp.json?.data?.points_earned}`);

  // ================= 场景 M：测试/考试提交的归属校验 =================
  console.log('\n--- 场景M：submit-test / submit-exam 归属校验 ---');
  if (OTHER_ID) {
    const rm = await api('/api/business/submit-test', {
      method: 'POST', token: rawToken,
      body: {
        student_id: OTHER_ID, test_id: TEST_G,
        answers: { [SIMPLE_Q.id]: SIMPLE_Q.correct },
        questions: [{ id: SIMPLE_Q.id, type: SIMPLE_Q.type, answers: JSON.stringify([SIMPLE_Q.correct]) }],
      },
    });
    assert('用他人 student_id 提交测试被拒 403', rm.status === 403, `status=${rm.status}`);

    const rm2 = await api('/api/business/submit-exam', {
      method: 'POST', token: rawToken,
      body: {
        student_id: OTHER_ID, test_id: TEST_G,
        answers: { [SIMPLE_Q.id]: SIMPLE_Q.correct },
        questions: [{ id: SIMPLE_Q.id, type: SIMPLE_Q.type, answers: JSON.stringify([SIMPLE_Q.correct]) }],
      },
    });
    assert('用他人 student_id 提交考试被拒 403', rm2.status === 403, `status=${rm2.status}`);
  } else {
    console.log('  （跳过，库中无其他学生）');
  }

  // ================= 场景 N：考试重考不重复发分 =================
  console.log('\n--- 场景N：同一场考试重考不重复发分 ---');
  const TEST_N = 'smoke_test_n_' + Date.now();
  await mkTest(TEST_N, { q: Q3, type: 'exam', points: 100, title: '冒烟考试-重考' });
  const submitExamN = () => api('/api/business/submit-exam', {
    method: 'POST', token: rawToken,
    body: {
      student_id: TS, test_id: TEST_N,
      answers: { [Q3.id]: Q3.correct },
      questions: [{ id: Q3.id, type: Q3.type, answers: JSON.stringify([Q3.correct]) }],
    },
  });
  const n0 = await snap();
  const rn1 = await submitExamN();
  const n1 = await snap();
  const firstEarned = rn1.json?.data?.points_earned || 0;
  console.log(`  第 1 次: status=${rn1.status} score=${rn1.json?.data?.score} 得分=${firstEarned}`);
  assert('N 第一次考试通过并发放积分', rn1.status === 200 && rn1.json?.data?.is_passed === true && firstEarned > 0,
    `status=${rn1.status} is_passed=${rn1.json?.data?.is_passed} points=${firstEarned}`);

  const rn2 = await submitExamN();
  const n2 = await snap();
  console.log(`  第 2 次（重考同分）: 得分=${rn2.json?.data?.points_earned}  积分 ${n1.current_points} → ${n2.current_points}`);
  assert('N 重考同分不再加分', n2.current_points === n1.current_points, `${n1.current_points} → ${n2.current_points}`);
  assert('N 重考回执 points_earned = 0', (rn2.json?.data?.points_earned || 0) === 0, `实际 ${rn2.json?.data?.points_earned}`);
  assert('N 重考不新增积分流水', n2.tx === n1.tx, `${n1.tx} → ${n2.tx}`);

  const [erN] = await conn.query(
    'SELECT COUNT(*) n, MAX(points_earned) p FROM exam_records WHERE student_id=? AND test_id=?', [TS, TEST_N]
  );
  assert('N 考试记录仍只有 1 条（重考是更新不是新增）', Number(erN[0].n) === 1, `实际 ${erN[0].n} 条`);
  assert('N 记录的 points_earned 未被重复累加', Number(erN[0].p) === firstEarned, `实际 ${erN[0].p}，首次 ${firstEarned}`);
  assert('N 重考总分不超过单次奖励上限', n2.current_points - n0.current_points === firstEarned,
    `累计 +${n2.current_points - n0.current_points}，单次奖励 ${firstEarned}`);

  // ---- 清理 ----
  await conn.query('DELETE FROM exam_records WHERE student_id=?', [TS]);
  await conn.query('DELETE FROM test_records WHERE student_id=?', [TS]);
  await conn.query('DELETE FROM tests WHERE created_by=?', [TS]);
  await conn.query('DELETE FROM wrong_questions WHERE student_id=?', [TS]);
  await conn.query('DELETE FROM student_equipments WHERE student_id=?', [TS]);
  await conn.query('DELETE FROM point_transactions WHERE student_id=?', [TS]);
  await conn.query('DELETE FROM student_answers WHERE student_id=?', [TS]);
  await conn.query('DELETE FROM student_buffs WHERE student_id=?', [TS]).catch(() => {});
  await conn.query('DELETE FROM login_sessions WHERE user_id=?', [TS]);
  await conn.query('DELETE FROM profiles WHERE id=?', [TS]);
  await conn.end();

  console.log(`\n========== ${pass} 通过 / ${fail} 失败 ==========`);
  if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('SMOKE ERROR:', e); process.exit(2); });
