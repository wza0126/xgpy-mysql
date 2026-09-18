/**
 * 掌握门禁（防"同一题无限重复提交"刷分刷装备）验证脚本
 *
 * 背景：有学生把同一道题在 26 分钟内重复提交 317 次，刷出 3155 分 + 反复重掷装备。
 * 本脚本直接打后端 /api/business/submit-answer，验证服务端门禁：
 *   A. 同一题答对连点 10 次 → 只有前 master_question_threshold 次计分，之后不再发积分/不掉装备/不涨连对
 *   B. 已掌握题再答错   → 不再扣分（不产生负分）
 *   C. 新题答错达到阈值 → 不再继续扣分
 *   D. 新题首次答对     → 正常计分（未误伤正常练习）
 *   E. test 来源        → 不受本次改动影响
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

(async () => {
  const conn = await mysql.createConnection(DB);
  const TS = 'smoke_gate_' + Date.now();

  // ---- 取 4 道真实题目 id（不新建题目，避免污染题库） ----
  const [qs] = await conn.query('SELECT id FROM questions LIMIT 4');
  if (qs.length < 4) throw new Error('题库题目不足，无法测试');
  const [Q1, Q2, Q3, Q4] = qs.map(q => q.id);
  console.log('测试题目:', Q1, Q2, Q3, Q4);

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

  const submit = (qid, isCorrect, points) => api('/api/business/submit-answer', {
    method: 'POST', token: rawToken,
    body: { student_id: TS, question_id: qid, answer: 'A', is_correct: isCorrect, points_change: points, source: 'practice' },
  });
  const snap = async () => {
    const [r] = await conn.query('SELECT current_points, total_points_earned, total_correct, curr_streak FROM profiles WHERE id=?', [TS]);
    const [eq] = await conn.query('SELECT COUNT(*) n FROM student_equipments WHERE student_id=?', [TS]);
    const [tx] = await conn.query('SELECT COUNT(*) n FROM point_transactions WHERE student_id=?', [TS]);
    return { ...r[0], equip: eq[0].n, tx: tx[0].n };
  };

  // ================= 场景 A：同题答对连点 10 次 =================
  console.log('--- 场景A：同一题答对，连续提交 10 次（模拟界面卡住连点） ---');
  const a0 = await snap();
  const RA = [];
  for (let i = 0; i < 10; i++) {
    const r = await submit(Q1, true, 10);
    RA.push(r.json?.data || { _err: r.json?.error || r.status });
  }
  const a1 = await snap();
  const rewarded = RA.filter(x => x.rewarded !== false).length;
  const earned = a1.current_points - a0.current_points;
  const equipGain = a1.equip - a0.equip;
  const txAdded = a1.tx - a0.tx;
  console.log(`  计分次数: ${rewarded}/10   积分: ${a0.current_points} → ${a1.current_points} (+${earned})   装备 +${equipGain}   流水 +${txAdded}`);
  console.log(`  对比漏洞版本：同样 10 次连点会拿到 +100 以上积分并掷 10 次装备掉落`);

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
  for (let i = 0; i < 5; i++) await submit(Q1, false, -5);
  const b1 = await snap();
  assert('已掌握题答错不扣分', b1.current_points === b0.current_points, `${b0.current_points} → ${b1.current_points}`);
  assert('积分仍 ≥ 0', b1.current_points >= 0);

  // ================= 场景 C：新题答错达到阈值后不再扣分 =================
  console.log('\n--- 场景C：新题答错，扣分次数应被限制在阈值内 ---');
  const c0 = await snap();
  const RC = [];
  for (let i = 0; i < THRESHOLD + 3; i++) {
    const r = await submit(Q2, false, -5);
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
  const rd = await submit(Q3, true, 10);
  const d1 = await snap();
  console.log(`  积分: ${d0.current_points} → ${d1.current_points}`);
  assert('新题首次答对正常加分', d1.current_points > d0.current_points, `+${d1.current_points - d0.current_points}`);
  assert('新题首次答对 rewarded=true', rd.json?.data?.rewarded !== false);
  assert('阈值>1 时首次答对不标记 mastered', THRESHOLD <= 1 || rd.json?.data?.mastered === false);

  // ================= 场景 E：非 practice 来源不受影响 =================
  console.log('\n--- 场景E：test 来源不受本次改动影响（用干净题目） ---');
  const re = await api('/api/business/submit-answer', {
    method: 'POST', token: rawToken,
    body: { student_id: TS, question_id: Q4, answer: 'A', is_correct: true, points_change: 10, source: 'test' },
  });
  assert('test 来源提交有明确回执（未 500）', re.status === 200 && !!re.json?.data, `status=${re.status} err=${re.json?.error}`);
  assert('test 来源不被掌握门禁拦截', re.json?.data?.rewarded !== false);

  // ================= 场景 F：越权仍被拦（学生改他人 student_id） =================
  console.log('\n--- 场景F：归属校验（学生不能替别人提交） ---');
  const [others] = await conn.query("SELECT id FROM profiles WHERE role='student' AND id<>? LIMIT 1", [TS]);
  if (others.length > 0) {
    const rf = await api('/api/business/submit-answer', {
      method: 'POST', token: rawToken,
      body: { student_id: others[0].id, question_id: Q4, answer: 'A', is_correct: true, points_change: 10, source: 'practice' },
    });
    assert('用他人 student_id 提交被拒 403', rf.status === 403, `status=${rf.status}`);
  } else {
    console.log('  （跳过，库中无其他学生）');
  }

  // ================= 场景 G/H/I：测试相关（每日次数限制 / 练习已掌握不影响测试 / 掉落接口加固） =================
  // 造一道简单题（非复合题）与其正确答案
  const [simpleQs] = await conn.query(
    "SELECT id, answers FROM questions WHERE type <> 'composite' AND answers IS NOT NULL LIMIT 1"
  );
  if (simpleQs.length === 0) throw new Error('题库中没有可用的简单题');
  const SIMPLE_Q = simpleQs[0];
  let simpleCorrect = '';
  try {
    const parsed = typeof SIMPLE_Q.answers === 'string' ? JSON.parse(SIMPLE_Q.answers) : SIMPLE_Q.answers;
    const arr = Array.isArray(parsed?.answers) ? parsed.answers : (Array.isArray(parsed) ? parsed : [parsed]);
    simpleCorrect = String(arr[0] ?? '');
  } catch {
    simpleCorrect = String(SIMPLE_Q.answers);
  }
  console.log(`\n简单题: ${SIMPLE_Q.id}  正确答案: ${simpleCorrect}`);

  const mkTest = async (testId, { dailyLimit = 0, drop = 0, points = 100 }) => {
    await conn.query(
      `INSERT INTO tests (id, title, question_ids, difficulty, question_count, points_reward, time_limit, is_active, passing_score, created_by, type, class_ids, allow_equipment_drop, daily_test_limit)
       VALUES (?, '冒烟测试-临时', ?, 'medium', 1, ?, 30, 1, 60, ?, 'test', '[]', ?, ?)`,
      [testId, JSON.stringify([SIMPLE_Q.id]), points, TS, drop, dailyLimit]
    );
  };
  const submitTest = (testId) => api('/api/business/submit-test', {
    method: 'POST', token: rawToken,
    body: {
      student_id: TS,
      test_id: testId,
      answers: { [SIMPLE_Q.id]: simpleCorrect },
      questions: [{ id: SIMPLE_Q.id, type: 'choice', answers: JSON.stringify([simpleCorrect]), multiple: false }],
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
  // 先让该题在练习中达到掌握阈值（之后练习不再计分，但测试必须照常）
  for (let i = 0; i < THRESHOLD; i++) {
    await submit(SIMPLE_Q.id, true, 10);
  }
  const [hHist] = await conn.query(
    "SELECT SUM(CASE WHEN is_correct=1 THEN 1 ELSE 0 END) correct_cnt FROM student_answers WHERE student_id=? AND question_id=? AND source='practice'",
    [TS, SIMPLE_Q.id]
  );
  console.log(`  该题练习答对次数: ${hHist[0].correct_cnt}（阈值 ${THRESHOLD}）`);
  assert('前置条件：该题在练习中已达到掌握阈值', Number(hHist[0].correct_cnt) >= THRESHOLD, `实际 ${hHist[0].correct_cnt}`);

  const TEST_H = 'smoke_test_h_' + Date.now();
  await conn.query(
    `INSERT INTO tests (id, title, question_ids, difficulty, question_count, points_reward, time_limit, is_active, passing_score, created_by, type, class_ids, allow_equipment_drop, daily_test_limit)
     VALUES (?, '冒烟测试-含已掌握题', ?, 'medium', 1, 100, 30, 1, 60, ?, 'test', '[]', 0, 0)`,
    [TEST_H, JSON.stringify([SIMPLE_Q.id]), TS]
  );

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
  await mkTest(TEST_I, { dailyLimit: 0, drop: 1, points: 100 });

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

  // 未及格的记录不得发掉落
  const FAIL_REC = 'smoke_tr_fail_' + Date.now();
  await conn.query(
    'INSERT INTO test_records (id, test_id, student_id, score, correct_count, total_count, points_earned) VALUES (?, ?, ?, 10, 0, 1, 0)',
    [FAIL_REC, TEST_I, TS]
  );
  const di4 = await dropCall({ student_id: TS, test_id: TEST_I, test_record_id: FAIL_REC });
  assert('未及格记录不发放掉落（400）', di4.status === 400, `status=${di4.status} err=${di4.json?.error}`);

  const [others2] = await conn.query("SELECT id FROM profiles WHERE role='student' AND id<>? LIMIT 1", [TS]);
  if (others2.length > 0) {
    const di5 = await dropCall({ student_id: others2[0].id, test_id: TEST_I, test_record_id: REC_I });
    assert('用他人 student_id 调用掉落接口被拒 403', di5.status === 403, `status=${di5.status}`);
  }

  const di2 = await dropCall({ student_id: TS, test_id: TEST_I, test_record_id: REC_I, is_passed: true });
  const [recAfter] = await conn.query('SELECT equipment_granted FROM test_records WHERE id = ?', [REC_I]);
  assert('真实及格记录可发放掉落（200）', di2.status === 200, `status=${di2.status} err=${di2.json?.error}`);
  assert('发放后标记 equipment_granted=1', Number(recAfter[0].equipment_granted) === 1, `实际 ${recAfter[0]?.equipment_granted}`);

  const di3 = await dropCall({ student_id: TS, test_id: TEST_I, test_record_id: REC_I, is_passed: true });
  assert('同一条记录再次调用不再掉落（幂等）', di3.status === 200 && (di3.json?.data?.dropped_equipments || []).length === 0,
    `status=${di3.status} 掉落 ${(di3.json?.data?.dropped_equipments || []).length} 件`);

  // 主路径（submit-test）内部发完掉落也应打上标记，避免降级路径二次发放
  const ri1 = await submitTest(TEST_I);
  const recI = ri1.json?.data?.test_record_id;
  assert('场景I：submit-test 主路径提交成功', ri1.status === 200 && !!recI, `status=${ri1.status}`);
  const [recMain] = await conn.query('SELECT equipment_granted FROM test_records WHERE id = ?', [recI]);
  assert('主路径发完掉落即标记 equipment_granted=1', Number(recMain[0].equipment_granted) === 1, `实际 ${recMain[0]?.equipment_granted}`);

  // ---- 场景 J：submit-answer 对非练习来源的查重口径 ----
  console.log('\n--- 场景J：非练习来源只拦截「同一次作答」内的重复提交 ---');
  const TR_A = 'smoke_tr_a_' + Date.now();
  const TR_B = 'smoke_tr_b_' + Date.now();
  const j1 = await api('/api/business/submit-answer', {
    method: 'POST', token: rawToken,
    body: { student_id: TS, question_id: Q4, answer: 'A', is_correct: true, points_change: 10, source: 'test', test_id: 'x', test_record_id: TR_A },
  });
  assert('同一次作答的第 1 次提交成功（200）', j1.status === 200, `status=${j1.status} err=${j1.json?.error}`);

  const j2 = await api('/api/business/submit-answer', {
    method: 'POST', token: rawToken,
    body: { student_id: TS, question_id: Q4, answer: 'A', is_correct: true, points_change: 10, source: 'test', test_id: 'x', test_record_id: TR_A },
  });
  assert('同一次作答内重复提交被拒 400', j2.status === 400, `status=${j2.status}`);

  const j3 = await api('/api/business/submit-answer', {
    method: 'POST', token: rawToken,
    body: { student_id: TS, question_id: Q4, answer: 'A', is_correct: true, points_change: 10, source: 'test', test_id: 'x', test_record_id: TR_B },
  });
  assert('换一次作答（新的 test_record_id）不被历史拦截（200）', j3.status === 200, `status=${j3.status} err=${j3.json?.error}`);

  // ---- 清理 ----
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
