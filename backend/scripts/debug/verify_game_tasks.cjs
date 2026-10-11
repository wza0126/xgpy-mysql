#!/usr/bin/env node
/**
 * 游戏化任务系统 · 端到端验证
 * ============================================================
 * 覆盖：
 *   A. 指标引擎（7 个指标，只读）
 *   B. 教师端 API（meta / 列表 / 新建 / 编辑 / 删除）
 *   C. 学生端 API（列表 / 红点计数 / 领取四类奖励 / 幂等）
 *   D. 适用班级过滤（不可见 + 直接领取被拒）
 *
 * ⛔ 不污染数据库（铁律）：
 *   · 所有临时任务 id / 答题行 id 一律 `tmp_` 前缀，随手可辨；
 *   · 领取涉及真实学生 a 的积分 / 上网码 / 应用 / 装备 → **先快照，finally 全量还原**；
 *   · 清理走「按前缀兜底删除」，不依赖运行时 id；
 *   · 断言用**差集语义**（+3 而非绝对 0），末尾加「不留痕」断言。
 *
 * 用法：node scripts/debug/verify_game_tasks.cjs
 */

'use strict';

const mysql = require('mysql2/promise');
const metrics = require('../../src/game-task-metrics');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy' };

const TEACHER = { u: 'teacher', p: 'xgpy666' };
const STUDENT = { u: 'a', p: '111111' };

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra !== undefined ? ' \u2014 ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

async function req(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 非 JSON 响应 */ }
  return { status: res.status, body: json };
}

async function login(u, p) {
  const r = await req('/api/auth/secure-login', { method: 'POST', body: { username: u, password: p } });
  return r.body && r.body.data && r.body.data.session ? r.body.data.session.access_token : null;
}

(async () => {
  const db = await mysql.createConnection(DB);
  const ts = Date.now();
  const TMP_TASK = 'tmp_gtask_a_' + ts;
  const TMP_TASK_CLS = 'tmp_gtask_cls_' + ts;
  const TMP_ANS = 'tmp_gt_ans_' + ts;
  const TMP_Q = 'tmp_gt_q_' + ts;
  const LIKE_TASK = "tmp\\_gtask\\_%";
  const LIKE_ANS = "tmp\\_gt\\_%";

  let studentId = null;
  let studentToken = null;
  let teacherToken = null;
  let snapProfile = null;
  let snapApp = null;
  let snapEquip = null;
  let haveCode = false;
  let appId = null;
  let equipId = null;

  async function cleanup() {
    try {
      // 1) 归还本脚本发出的上网码（按 source_id 兜底，不依赖运行时 id）
      await db.query(
        "UPDATE internet_codes SET is_used = 0, used_by = NULL, used_at = NULL, " +
        "used_by_username = NULL, source = NULL, source_id = NULL " +
        "WHERE source_id LIKE ? AND source = 'mission'",
        [LIKE_TASK]
      );
      // 2) 删临时任务 / 领取记录 / 积分流水 / 临时答题行
      await db.query('DELETE FROM game_tasks WHERE id LIKE ?', [LIKE_TASK]);
      await db.query('DELETE FROM student_task_claims WHERE task_id LIKE ?', [LIKE_TASK]);
      await db.query('DELETE FROM point_transactions WHERE source_id LIKE ?', [LIKE_TASK]);
      await db.query('DELETE FROM student_answers WHERE id LIKE ?', [LIKE_ANS]);

      // 3) 还原积分快照
      if (snapProfile && studentId) {
        await db.query(
          'UPDATE profiles SET current_points = ?, max_points = ?, total_points_earned = ? WHERE id = ?',
          [snapProfile.current_points, snapProfile.max_points, snapProfile.total_points_earned, studentId]
        );
      }
      // 4) 还原应用拥有状态（脚本前没有 → 删除脚本新增的行）
      if (studentId && appId && snapApp === null) {
        await db.query('DELETE FROM student_app_usage WHERE student_id = ? AND app_id = ?', [studentId, appId]);
      }
      // 5) 还原装备数量
      if (studentId && equipId) {
        if (snapEquip === null) {
          await db.query('DELETE FROM student_equipments WHERE student_id = ? AND equipment_id = ?', [studentId, equipId]);
        } else {
          await db.query(
            'UPDATE student_equipments SET quantity = ? WHERE student_id = ? AND equipment_id = ?',
            [snapEquip, studentId, equipId]
          );
        }
      }
    } catch (e) {
      console.error('  ! 清理异常：', e.message);
    }
  }

  try {
    // ================= A. 指标引擎 =================
    section('A. 指标引擎（只读）');

    const tl = await req('/api/auth/secure-login', { method: 'POST', body: { username: TEACHER.u, password: TEACHER.p } });
    const sl = await req('/api/auth/secure-login', { method: 'POST', body: { username: STUDENT.u, password: STUDENT.p } });
    teacherToken = tl.body && tl.body.data && tl.body.data.session ? tl.body.data.session.access_token : null;
    studentToken = sl.body && sl.body.data && sl.body.data.session ? sl.body.data.session.access_token : null;
    studentId = sl.body && sl.body.data && sl.body.data.user ? sl.body.data.user.id : null;
    ok('教师登录成功', !!teacherToken);
    ok('学生登录成功', !!studentToken);
    ok('取得学生 id', !!studentId, studentId);
    if (!studentToken || !teacherToken || !studentId) throw new Error('登录失败，无法继续');

    const list = metrics.listMetrics();
    ok('指标清单 7 项', list.length === 7, '实际 ' + list.length);

    const metricCases = ['answer_correct', 'answer_count', 'practice_mastered', 'op_score', 'checkin', 'accuracy', 'pk_win'];
    for (const m of metricCases) {
      const p = await metrics.getProgress(db, m, studentId, {});
      ok(`指标 ${m} 返回数值`, !p.error && Number.isFinite(p.value), p.error || ('value=' + p.value));
    }
    const acc = await metrics.getProgress(db, 'accuracy', studentId, { rate: 90, min_count: 10 });
    ok('accuracy 附带可读说明', typeof acc.text === 'string', acc.text);

    // ================= B. 教师端 API =================
    section('B. 教师端 API');

    const meta = await req('/api/teacher/game-tasks/meta', { token: teacherToken });
    ok('meta 200', meta.status === 200, 'status=' + meta.status);
    const metaData = (meta.body && meta.body.data) || {};
    ok('meta.metrics 7 项', Array.isArray(metaData.metrics) && metaData.metrics.length === 7);
    ok('meta.rewardTypes 4 类', Array.isArray(metaData.rewardTypes) && metaData.rewardTypes.length === 4);
    ok('meta.classes 为数组', Array.isArray(metaData.classes));

    const seed = await req('/api/teacher/game-tasks?type=daily', { token: teacherToken });
    ok('种子任务 ≥ 8 条', seed.status === 200 && Array.isArray(seed.body.data) && seed.body.data.length >= 8,
      '实际 ' + (seed.body && seed.body.data ? seed.body.data.length : 'n/a'));

    // 进度目标：今日作答数 + 1（差集语义，不写死数字）
    const [[cntRow]] = await db.query(
      'SELECT COUNT(*) AS n FROM student_answers WHERE student_id = ? AND DATE(created_at) = CURDATE()',
      [studentId]
    );
    const target = Number(cntRow.n) + 1;

    // 可选奖励资源
    const [apps] = await db.query('SELECT id FROM apps WHERE is_active = 1 LIMIT 1');
    appId = apps.length ? apps[0].id : null;
    const [equips] = await db.query('SELECT id FROM equipments WHERE is_active = 1 LIMIT 1');
    equipId = equips.length ? equips[0].id : null;
    const [[codeLeft]] = await db.query('SELECT COUNT(*) AS n FROM internet_codes WHERE is_used = 0');
    haveCode = Number(codeLeft.n) > 0;

    const rewards = [{ type: 'points', value: 3 }];
    if (haveCode) rewards.push({ type: 'internet_code', value: 1 });
    if (appId) rewards.push({ type: 'app', value: 1, target_id: appId });
    if (equipId) rewards.push({ type: 'equipment', value: 1, target_id: equipId });

    const createRes = await req('/api/teacher/game-tasks', {
      method: 'POST',
      token: teacherToken,
      body: {
        id: TMP_TASK,
        name: 'tmp_验证任务',
        description: '自动化验证用，脚本结束即删除',
        icon: 'star',
        task_type: 'daily',
        metric: 'answer_count',
        target_value: target,
        unit: '题',
        rewards,
        class_ids: null,
        is_active: true,
        sort_order: 999,
      },
    });
    ok('新建临时任务成功', createRes.status === 200 && createRes.body.data && createRes.body.data.id === TMP_TASK,
      JSON.stringify(createRes.body));

    const editRes = await req('/api/teacher/game-tasks/' + TMP_TASK, {
      method: 'PUT',
      token: teacherToken,
      body: { name: 'tmp_验证任务(已编辑)', sort_order: 998 },
    });
    ok('编辑任务成功', editRes.status === 200, JSON.stringify(editRes.body));

    const listRes = await req('/api/teacher/game-tasks?type=daily', { token: teacherToken });
    const edited = (listRes.body.data || []).find((t) => t.id === TMP_TASK);
    ok('编辑已生效', !!edited && edited.name === 'tmp_验证任务(已编辑)');
    ok('奖励 4 类解析正确', !!edited && edited.rewards.length === rewards.length, edited ? JSON.stringify(edited.rewards) : 'n/a');

    // ================= C. 学生端 API =================
    section('C. 学生端 API 与领取');

    const beforeList = await req('/api/student/daily-tasks', { token: studentToken });
    ok('学生任务列表 200', beforeList.status === 200);
    const beforeTask = (beforeList.body.data || []).find((t) => t.id === TMP_TASK);
    ok('临时任务对学生可见', !!beforeTask);
    ok('进度未达标 → 不可领取', !!beforeTask && beforeTask.can_claim === false,
      beforeTask ? `value=${beforeTask.progress.value} target=${beforeTask.target_value}` : 'n/a');

    const pendBefore = await req('/api/student/daily-tasks/pending-count', { token: studentToken });
    ok('红点计数返回数字', pendBefore.status === 200 && Number.isFinite(pendBefore.body.data.count),
      JSON.stringify(pendBefore.body));

    // 造一条临时答题行把进度顶到目标
    await db.query(
      'INSERT INTO student_answers (id, student_id, question_id, answer, is_correct, points_change, source, created_at) ' +
      "VALUES (?, ?, ?, 'x', 0, 0, 'practice', NOW())",
      [TMP_ANS, studentId, TMP_Q]
    );

    const afterList = await req('/api/student/daily-tasks', { token: studentToken });
    const readyTask = (afterList.body.data || []).find((t) => t.id === TMP_TASK);
    ok('进度达标 → 可领取', !!readyTask && readyTask.can_claim === true,
      readyTask ? `value=${readyTask.progress.value} target=${readyTask.target_value}` : 'n/a');

    const pendAfter = await req('/api/student/daily-tasks/pending-count', { token: studentToken });
    ok('红点计数已 +1', pendAfter.body.data.count === pendBefore.body.data.count + 1,
      `${pendBefore.body.data.count} → ${pendAfter.body.data.count}`);

    // 快照（在领取之前）
    const [[pr]] = await db.query(
      'SELECT current_points, max_points, total_points_earned FROM profiles WHERE id = ?', [studentId]
    );
    snapProfile = pr;
    if (appId) {
      const [ar] = await db.query('SELECT usage_count FROM student_app_usage WHERE student_id = ? AND app_id = ?', [studentId, appId]);
      snapApp = ar.length ? ar[0].usage_count : null;
    }
    if (equipId) {
      const [er] = await db.query('SELECT quantity FROM student_equipments WHERE student_id = ? AND equipment_id = ?', [studentId, equipId]);
      snapEquip = er.length ? er[0].quantity : null;
    }

    const claim = await req('/api/student/daily-tasks/' + TMP_TASK + '/claim', { method: 'POST', token: studentToken });
    ok('领取成功', claim.status === 200, JSON.stringify(claim.body));
    const granted = (claim.body.data && claim.body.data.granted) || [];
    ok('发放含积分', granted.some((g) => g.type === 'points' && g.value === 3), JSON.stringify(granted));
    if (haveCode) ok('发放含上网码', granted.some((g) => g.type === 'internet_code'), JSON.stringify(granted));
    if (appId) ok('发放含应用解锁', granted.some((g) => g.type === 'app' && g.target_id === appId), JSON.stringify(granted));
    if (equipId) ok('发放含装备', granted.some((g) => g.type === 'equipment' && g.target_id === equipId), JSON.stringify(granted));

    const [[pr2]] = await db.query('SELECT current_points FROM profiles WHERE id = ?', [studentId]);
    ok('积分按差集 +3', pr2.current_points === snapProfile.current_points + 3,
      `${snapProfile.current_points} → ${pr2.current_points}`);

    if (haveCode) {
      const [[codeUsed]] = await db.query(
        "SELECT COUNT(*) AS n FROM internet_codes WHERE source_id = ? AND is_used = 1", [TMP_TASK]
      );
      ok('上网码已标记使用', Number(codeUsed.n) === 1, 'used=' + codeUsed.n);
    }

    // 幂等：同日再领一次应被拒
    const claim2 = await req('/api/student/daily-tasks/' + TMP_TASK + '/claim', { method: 'POST', token: studentToken });
    ok('重复领取被拒(409)', claim2.status === 409, 'status=' + claim2.status);
    const [[pr3]] = await db.query('SELECT current_points FROM profiles WHERE id = ?', [studentId]);
    ok('重复领取未再加分', pr3.current_points === pr2.current_points, `${pr2.current_points} → ${pr3.current_points}`);

    const afterClaimList = await req('/api/student/daily-tasks', { token: studentToken });
    const claimedTask = (afterClaimList.body.data || []).find((t) => t.id === TMP_TASK);
    ok('领取后标记已领取', !!claimedTask && claimedTask.claimed === true && claimedTask.can_claim === false);

    // ================= D. 适用班级过滤 =================
    section('D. 适用班级过滤');

    const clsCreate = await req('/api/teacher/game-tasks', {
      method: 'POST',
      token: teacherToken,
      body: {
        id: TMP_TASK_CLS,
        name: 'tmp_限班级任务',
        task_type: 'daily',
        metric: 'answer_count',
        target_value: 1,
        unit: '题',
        rewards: [{ type: 'points', value: 1 }],
        class_ids: ['tmp_cls_not_exists'],
        is_active: true,
      },
    });
    ok('建限班级任务成功', clsCreate.status === 200, JSON.stringify(clsCreate.body));

    const stuList2 = await req('/api/student/daily-tasks', { token: studentToken });
    ok('不适用班级 → 学生不可见', !(stuList2.body.data || []).some((t) => t.id === TMP_TASK_CLS));

    const claimCls = await req('/api/student/daily-tasks/' + TMP_TASK_CLS + '/claim', { method: 'POST', token: studentToken });
    ok('不适用班级 → 直接领取被拒(403)', claimCls.status === 403, 'status=' + claimCls.status);

    // 学生端不可越权访问教师接口
    const forbidden = await req('/api/teacher/game-tasks', { token: studentToken });
    ok('学生访问教师接口被拒', forbidden.status === 403 || forbidden.status === 401, 'status=' + forbidden.status);
  } catch (e) {
    fail++;
    console.error('\n  ✗ 异常终止：', e && e.stack ? e.stack : e);
  } finally {
    await cleanup();

    // ================= E. 不留痕断言 =================
    section('E. 不留痕断言');
    const [[t1]] = await db.query('SELECT COUNT(*) AS n FROM game_tasks WHERE id LIKE ?', [LIKE_TASK]);
    ok('无残留临时任务', Number(t1.n) === 0, 'n=' + t1.n);
    const [[t2]] = await db.query('SELECT COUNT(*) AS n FROM student_task_claims WHERE task_id LIKE ?', [LIKE_TASK]);
    ok('无残留领取记录', Number(t2.n) === 0, 'n=' + t2.n);
    const [[t3]] = await db.query('SELECT COUNT(*) AS n FROM point_transactions WHERE source_id LIKE ?', [LIKE_TASK]);
    ok('无残留积分流水', Number(t3.n) === 0, 'n=' + t3.n);
    const [[t4]] = await db.query('SELECT COUNT(*) AS n FROM student_answers WHERE id LIKE ?', [LIKE_ANS]);
    ok('无残留临时答题行', Number(t4.n) === 0, 'n=' + t4.n);
    const [[t5]] = await db.query("SELECT COUNT(*) AS n FROM internet_codes WHERE source_id LIKE ?", [LIKE_TASK]);
    ok('无残留上网码归属', Number(t5.n) === 0, 'n=' + t5.n);
    if (snapProfile && studentId) {
      const [[p]] = await db.query('SELECT current_points, max_points, total_points_earned FROM profiles WHERE id = ?', [studentId]);
      ok('积分已还原到快照',
        p.current_points === snapProfile.current_points &&
        p.max_points === snapProfile.max_points &&
        p.total_points_earned === snapProfile.total_points_earned,
        JSON.stringify(p) + ' vs ' + JSON.stringify(snapProfile));
    }

    console.log(`\n===== 游戏化任务系统验证：${pass} 通过 / ${fail} 失败 =====`);
    await db.end();
    process.exit(fail === 0 ? 0 : 1);
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
