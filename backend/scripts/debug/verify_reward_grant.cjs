#!/usr/bin/env node
/**
 * 奖励发放（通知管理） · 端到端验证
 * ============================================================
 * 覆盖：
 *   A. 参数校验（未选范围 400 / 无效指标 400 / 无效条件 400）
 *   B. 预览（dry_run）：按班级候选数、按条件命中、and/or 组合
 *   C. 实际发放：积分 / 上网码 / 装备 各自落库 + 通知 + recipients
 *   D. 无命中 → 400 且不写库
 *   E. 不留痕断言
 *
 * ⛔ 不污染数据库（铁律）：
 *   · 发放仅用 student_ids 精确限定到单个测试学生 a（班级分支只跑 dry_run，不写库）；
 *   · 通知标题一律 `tmp_` 前缀 + id 记账，双保险清理；
 *   · 积分 / 装备 / 上网码 → 先快照，finally 全量还原；
 *   · 末尾「不留痕」断言。
 *
 * 用法：node scripts/debug/verify_reward_grant.cjs
 */

'use strict';

const mysql = require('mysql2/promise');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy' };
const TEACHER = { u: 'teacher', p: 'xgpy666' };
const STUDENT = { u: 'a', p: '111111' };
const TITLE = 'tmp_奖励发放测试';

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
  try { json = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, body: json };
}

async function login(u, p) {
  const r = await req('/api/auth/secure-login', { method: 'POST', body: { username: u, password: p } });
  return (r.body && r.body.data && r.body.data.session && r.body.data.session.access_token) || null;
}

(async () => {
  const db = await mysql.createConnection(DB);
  const createdNotifIds = [];
  const usedCodeIds = [];
  let studentId = null;
  let studentClass = null;
  let teacherToken = null;
  let snapPoints = null;
  let snapEquip = null;
  let equipId = null;
  let classSize = 0;

  async function cleanup() {
    try {
      if (usedCodeIds.length) {
        await db.query(
          'UPDATE internet_codes SET is_used = 0, used_by = NULL, used_at = NULL, used_by_username = NULL, source = NULL, source_id = NULL WHERE id IN (?)',
          [usedCodeIds]
        );
      }
      if (createdNotifIds.length) {
        await db.query('DELETE FROM notification_recipients WHERE notification_id IN (?)', [createdNotifIds]);
        await db.query("DELETE FROM point_transactions WHERE source_type = 'notification' AND source_id IN (?)", [createdNotifIds.map(String)]);
        await db.query('DELETE FROM notifications WHERE id IN (?)', [createdNotifIds]);
      }
      // 兜底：按标题前缀再清一次（不依赖记账 id）
      await db.query('DELETE FROM notification_recipients WHERE notification_id IN (SELECT id FROM notifications WHERE title = ?)', [TITLE]);
      await db.query('DELETE FROM point_transactions WHERE source_type = \'notification\' AND source_id IN (SELECT CAST(id AS CHAR) FROM notifications WHERE title = ?)', [TITLE]);
      await db.query('DELETE FROM notifications WHERE title = ?', [TITLE]);
      if (snapPoints && studentId) {
        await db.query(
          'UPDATE profiles SET current_points = ?, max_points = ?, total_points_earned = ? WHERE id = ?',
          [snapPoints.current_points, snapPoints.max_points, snapPoints.total_points_earned, studentId]
        );
      }
      if (studentId && equipId) {
        if (snapEquip === null) {
          await db.query('DELETE FROM student_equipments WHERE student_id = ? AND equipment_id = ?', [studentId, equipId]);
        } else {
          await db.query('UPDATE student_equipments SET quantity = ? WHERE student_id = ? AND equipment_id = ?', [snapEquip, studentId, equipId]);
        }
      }
    } catch (e) {
      console.error('  [cleanup] ' + e.message);
    }
  }

  try {
    // ---------- 准备 ----------
    teacherToken = await login(TEACHER.u, TEACHER.p);
    ok('教师登录成功', !!teacherToken);

    const [prs] = await db.query(
      "SELECT id, username, class_id, current_points, max_points, total_points_earned FROM profiles WHERE username = ? AND role = 'student' LIMIT 1",
      [STUDENT.u]
    );
    ok('找到测试学生 ' + STUDENT.u, prs.length === 1);
    if (!prs.length) throw new Error('缺少测试学生');
    studentId = prs[0].id;
    studentClass = prs[0].class_id;
    snapPoints = { current_points: prs[0].current_points, max_points: prs[0].max_points, total_points_earned: prs[0].total_points_earned };

    const [[cr]] = await db.query("SELECT class_id, COUNT(*) AS c FROM profiles WHERE class_id = ? AND role = 'student' GROUP BY class_id", [studentClass]);
    classSize = cr ? Number(cr.c) : 0;
    ok('测试学生所在班级人数可读', classSize > 0, 'class=' + studentClass + ' n=' + classSize);

    const [eqs] = await db.query('SELECT id FROM equipments WHERE is_active = 1 ORDER BY id LIMIT 1');
    equipId = eqs.length ? eqs[0].id : null;
    const [sr] = await db.query('SELECT COUNT(*) AS c FROM internet_codes WHERE is_used = 0');
    const codesAvail = Number(sr[0].c);

    const studentToken = await login(STUDENT.u, STUDENT.p);
    ok('学生登录成功', !!studentToken);
    const scopeA = { class_ids: [], student_ids: [studentId] };

    // ---------- A. 参数校验 ----------
    section('A. 参数校验');
    let r = await req('/api/teacher/rewards/grant', { method: 'POST', token: teacherToken, body: { dry_run: true, scope: {}, conditions: [], rewards: [] } });
    ok('未选范围 → 400', r.status === 400, 'status=' + r.status + ' ' + JSON.stringify(r.body));
    r = await req('/api/teacher/rewards/grant', { method: 'POST', token: teacherToken, body: { dry_run: true, scope: scopeA, conditions: [{ metric: 'no_such_metric', op: 'gte', value: 1 }], rewards: [] } });
    ok('未知指标 → 400', r.status === 400);
    r = await req('/api/teacher/rewards/grant', { method: 'POST', token: teacherToken, body: { dry_run: false, scope: scopeA, conditions: [], rewards: [] } });
    ok('发放但无奖励 → 400', r.status === 400);
    const anon = await req('/api/teacher/rewards/grant', { method: 'POST', body: { dry_run: true, scope: scopeA, conditions: [], rewards: [] } });
    ok('未登录 → 401', anon.status === 401, 'status=' + anon.status);

    // ---------- B. 预览（dry_run） ----------
    section('B. 预览（dry_run，不写库）');
    r = await req('/api/teacher/rewards/grant', {
      method: 'POST', token: teacherToken,
      body: { dry_run: true, scope: { class_ids: [studentClass], student_ids: [] }, conditions: [{ metric: 'total_correct', op: 'gte', value: 0 }], rewards: [] },
    });
    ok('按班级预览 → 200', r.status === 200);
    ok('按班级候选数 = 班级人数', r.body?.data?.candidates === classSize, JSON.stringify(r.body?.data && { c: r.body.data.candidates, n: classSize }));
    ok('条件 total_correct≥0 → 全班命中', r.body?.data?.matched_count === classSize, 'matched=' + r.body?.data?.matched_count);

    r = await req('/api/teacher/rewards/grant', {
      method: 'POST', token: teacherToken,
      body: { dry_run: true, scope: scopeA, conditions: [{ metric: 'total_correct', op: 'gte', value: 0 }], rewards: [] },
    });
    ok('指定学生 + 恒真条件 → 命中 1', r.body?.data?.matched_count === 1, 'matched=' + r.body?.data?.matched_count);
    ok('预览返回条件描述', /累计做对题数/.test(r.body?.data?.condition_text || ''), r.body?.data?.condition_text);

    r = await req('/api/teacher/rewards/grant', {
      method: 'POST', token: teacherToken,
      body: { dry_run: true, scope: scopeA, conditions: [{ metric: 'total_correct', op: 'gte', value: 99999999 }], rewards: [] },
    });
    ok('条件不可能满足 → 命中 0', r.body?.data?.matched_count === 0, 'matched=' + r.body?.data?.matched_count);

    // and：一真一假 → 0 命中；or：一真一假 → 1 命中
    const twoConds = [
      { metric: 'total_correct', op: 'gte', value: 0 },
      { metric: 'total_correct', op: 'gte', value: 99999999 },
    ];
    r = await req('/api/teacher/rewards/grant', { method: 'POST', token: teacherToken, body: { dry_run: true, scope: scopeA, logic: 'and', conditions: twoConds, rewards: [] } });
    ok('logic=and（一真一假）→ 0 命中', r.body?.data?.matched_count === 0, 'matched=' + r.body?.data?.matched_count);
    r = await req('/api/teacher/rewards/grant', { method: 'POST', token: teacherToken, body: { dry_run: true, scope: scopeA, logic: 'or', conditions: twoConds, rewards: [] } });
    ok('logic=or（一真一假）→ 1 命中', r.body?.data?.matched_count === 1, 'matched=' + r.body?.data?.matched_count);

    r = await req('/api/teacher/rewards/grant', {
      method: 'POST', token: teacherToken,
      body: { dry_run: true, scope: scopeA, conditions: [{ metric: 'total_op_score', op: 'gte', value: 0, params: { kind: 'wps' } }], rewards: [] },
    });
    ok('带参指标（仅 WPS）描述含「WPS」', /WPS/.test(r.body?.data?.condition_text || ''), r.body?.data?.condition_text);

    // 预览不应写库
    const [npv] = await db.query('SELECT COUNT(*) AS c FROM notifications WHERE title = ?', [TITLE]);
    ok('预览未产生通知记录', Number(npv[0].c) === 0, 'n=' + npv[0].c);

    // ---------- C. 实际发放 ----------
    section('C. 实际发放（积分 + 装备）');
    const rewards1 = [{ type: 'points', value: 7 }, ...(equipId ? [{ type: 'equipment', value: 2, target_id: equipId }] : [])];
    const beforePoints = snapPoints.current_points;
    const [beforeEq] = equipId
      ? await db.query('SELECT quantity FROM student_equipments WHERE student_id = ? AND equipment_id = ?', [studentId, equipId])
      : [[]];
    const prevEqQty = equipId && beforeEq.length ? Number(beforeEq[0].quantity) : null;

    r = await req('/api/teacher/rewards/grant', {
      method: 'POST', token: teacherToken,
      body: { dry_run: false, scope: scopeA, title: TITLE, content: '恭喜获得奖励', conditions: [{ metric: 'total_correct', op: 'gte', value: 0 }], rewards: rewards1 },
    });
    ok('发放 → 200', r.status === 200, JSON.stringify(r.body));
    const notifId = r.body?.data?.notification_id;
    if (notifId) createdNotifIds.push(notifId);
    ok('返回 granted_count = 1', r.body?.data?.granted_count === 1, 'n=' + r.body?.data?.granted_count);

    const [pf] = await db.query('SELECT current_points, total_points_earned FROM profiles WHERE id = ?', [studentId]);
    ok('积分 +7 落库', Number(pf[0].current_points) === Number(beforePoints) + 7, `before=${beforePoints} after=${pf[0].current_points}`);

    const [pts] = await db.query("SELECT amount, reason FROM point_transactions WHERE source_type = 'notification' AND source_id = ?", [String(notifId)]);
    ok('积分流水记录 1 条 +7', pts.length === 1 && Number(pts[0].amount) === 7, JSON.stringify(pts));
    ok('积分流水原因含「奖励发放」', /奖励发放/.test(pts[0] ? pts[0].reason : ''), pts[0] && pts[0].reason);

    if (equipId) {
      const [af] = await db.query('SELECT quantity FROM student_equipments WHERE student_id = ? AND equipment_id = ?', [studentId, equipId]);
      const after = af.length ? Number(af[0].quantity) : 0;
      ok('装备 +2 落库', after === (prevEqQty || 0) + 2, `before=${prevEqQty} after=${after}`);
      snapEquip = prevEqQty; // 供还原
    }

    const [nr] = await db.query('SELECT title, content, notification_type, target_student_ids FROM notifications WHERE id = ?', [notifId]);
    ok('通知已创建（type=student）', nr.length === 1 && nr[0].notification_type === 'student');
    ok('通知正文含「奖励物项」', /奖励物项/.test(nr[0].content), (nr[0].content || '').slice(0, 80));
    ok('通知正文含「发放条件」', /发放条件/.test(nr[0].content));
    ok('通知正文含具体奖励（+7 积分）', /\+7 积分/.test(nr[0].content));

    const [rc] = await db.query('SELECT student_id, point_change, point_change_reason FROM notification_recipients WHERE notification_id = ?', [notifId]);
    ok('recipients 记录 1 条', rc.length === 1, 'n=' + rc.length);
    ok('recipient 积分变动记录 +7', rc.length === 1 && Number(rc[0].point_change) === 7);
    ok('recipient 原因含条件描述', rc.length === 1 && /累计做对题数/.test(rc[0].point_change_reason || ''), rc[0] && rc[0].point_change_reason);

    // 学生端可见性：发放的同时，学生应能查到这条通知
    const sn = await req('/api/notifications/student/' + studentId, { token: studentToken });
    const mine = (sn.body?.data || []).find((x) => x.title === TITLE);
    ok('学生端可查到该奖励通知', !!mine, 'status=' + sn.status);
    ok('学生端通知正文含「奖励物项」', !!mine && /奖励物项/.test(mine.content));
    ok('学生端通知 point_change = +7', !!mine && Number(mine.point_change) === 7, mine && String(mine.point_change));
    ok('学生端通知原因含条件', !!mine && /累计做对题数/.test(mine.point_change_reason || ''));
    ok('未发上网码的通知不带 internet_codes',
      !(mine && mine.internet_codes && mine.internet_codes.length),
      mine && JSON.stringify(mine.internet_codes || []));

    // ---------- C2. 上网码（有库存才测） ----------
    section('C2. 上网码发放');
    if (codesAvail > 0) {
      r = await req('/api/teacher/rewards/grant', {
        method: 'POST', token: teacherToken,
        body: { dry_run: false, scope: scopeA, title: TITLE, content: '', conditions: [{ metric: 'total_correct', op: 'gte', value: 0 }], rewards: [{ type: 'internet_code', value: 1 }] },
      });
      ok('发上网码 → 200', r.status === 200, JSON.stringify(r.body));
      const nid2 = r.body?.data?.notification_id;
      if (nid2) createdNotifIds.push(nid2);
      const [codes] = await db.query("SELECT id, is_used, source, source_id FROM internet_codes WHERE source = 'notification' AND source_id = ?", [String(nid2)]);
      ok('上网码已标记占用（source=notification）', codes.length === 1 && Number(codes[0].is_used) === 1, JSON.stringify(codes));
      codes.forEach((c) => usedCodeIds.push(c.id));

      // ⭐ 关键：学生端通知接口要回填该生的上网码（异步到账，通知是唯一可见处）
      const sn2 = await req('/api/notifications/student/' + studentId, { token: studentToken });
      const mine2 = (sn2.body?.data || []).find((x) => Number(x.id) === Number(nid2));
      ok('学生端能查到该上网码通知', !!mine2, 'status=' + sn2.status);
      ok('学生端通知带 internet_codes（1 个）',
        !!(mine2 && Array.isArray(mine2.internet_codes) && mine2.internet_codes.length === 1),
        mine2 && JSON.stringify(mine2.internet_codes));
      if (mine2 && mine2.internet_codes && mine2.internet_codes.length && codes.length) {
        const [cr2] = await db.query('SELECT code FROM internet_codes WHERE id = ?', [codes[0].id]);
        ok('通知里的码与实际发放的码一致', mine2.internet_codes[0] === cr2[0].code,
          `${mine2.internet_codes[0]} vs ${cr2[0] && cr2[0].code}`);
      }
    } else {
      console.log('  - 跳过（无可用上网码）');
    }

    // ---------- D. 无命中 ----------
    section('D. 无命中 → 400 且不写库');
    const beforeNotifCount = (await db.query('SELECT COUNT(*) AS c FROM notifications WHERE title = ?', [TITLE]))[0][0].c;
    r = await req('/api/teacher/rewards/grant', {
      method: 'POST', token: teacherToken,
      body: { dry_run: false, scope: scopeA, title: TITLE, conditions: [{ metric: 'total_correct', op: 'gte', value: 99999999 }], rewards: [{ type: 'points', value: 5 }] },
    });
    ok('无命中发放 → 400', r.status === 400, 'status=' + r.status);
    const afterNotifCount = (await db.query('SELECT COUNT(*) AS c FROM notifications WHERE title = ?', [TITLE]))[0][0].c;
    ok('无命中未新增通知', Number(afterNotifCount) === Number(beforeNotifCount));
  } catch (e) {
    console.error('\n[异常] ' + (e && e.stack ? e.stack : e));
    fail++;
  } finally {
    // 先把通知 id 收齐再清理
    try {
      const [rows] = await db.query('SELECT id FROM notifications WHERE title = ?', [TITLE]);
      rows.forEach((x) => { if (!createdNotifIds.includes(x.id)) createdNotifIds.push(x.id); });
    } catch { /* ignore */ }
    await cleanup();

    // ---------- E. 不留痕 ----------
    section('E. 不留痕断言');
    const [[a1]] = await db.query('SELECT COUNT(*) AS c FROM notifications WHERE title = ?', [TITLE]);
    ok('无残留测试通知', Number(a1.c) === 0, 'n=' + a1.c);
    if (createdNotifIds.length) {
      const [[a2]] = await db.query('SELECT COUNT(*) AS c FROM notification_recipients WHERE notification_id IN (?)', [createdNotifIds]);
      ok('无残留 recipients', Number(a2.c) === 0, 'n=' + a2.c);
      const [[a3]] = await db.query("SELECT COUNT(*) AS c FROM point_transactions WHERE source_type = 'notification' AND source_id IN (?)", [createdNotifIds.map(String)]);
      ok('无残留积分流水', Number(a3.c) === 0, 'n=' + a3.c);
    }
    if (snapPoints) {
      const [[a4]] = await db.query('SELECT current_points, max_points, total_points_earned FROM profiles WHERE id = ?', [studentId]);
      ok('积分已还原到快照',
        Number(a4.current_points) === Number(snapPoints.current_points)
        && Number(a4.max_points) === Number(snapPoints.max_points)
        && Number(a4.total_points_earned) === Number(snapPoints.total_points_earned),
        JSON.stringify(a4));
    }
    if (usedCodeIds.length) {
      const [[a5]] = await db.query('SELECT COUNT(*) AS c FROM internet_codes WHERE id IN (?) AND is_used = 1', [usedCodeIds]);
      ok('上网码已归还', Number(a5.c) === 0);
    }
    if (equipId) {
      const [[a6]] = await db.query('SELECT quantity FROM student_equipments WHERE student_id = ? AND equipment_id = ?', [studentId, equipId]);
      const q = a6 ? Number(a6.quantity) : null;
      ok('装备数量已还原', snapEquip === null ? q === null : q === Number(snapEquip), `want=${snapEquip} got=${q}`);
    }

    console.log('\n========================================');
    console.log(`  奖励发放验证：${pass} 通过 / ${fail} 失败`);
    console.log('========================================');
    await db.end();
    process.exit(fail ? 1 : 0);
  }
})();
