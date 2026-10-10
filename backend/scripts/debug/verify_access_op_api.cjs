/**
 * Access 操作题端到端验证（真后端 + 真上传 + 真判分 + 真落库）
 * 前置：后端跑在 3101，且已执行 seed_access_op_sample.cjs 灌入样例题。
 * 用法：node backend/scripts/debug/verify_access_op_api.cjs
 *
 * 覆盖：检查器清单 / 答案解析（inspect + 骨架）/ 规格校验 / 学生取题脱敏 /
 *       提交判分（满分 + 错卷）/ 幂等 / 隔离（access_op 不进普通练习池）/ 教师端统计。
 *
 * ⛔ 不留痕铁律：
 *   - 脚本产生的提交记录 / 答题记录 / 上传文件全部记录，在 finally 中删除；
 *   - 末尾断言「跑完之后 kind='access' 的提交行数 == 跑之前」。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('../../node_modules/mysql2/promise');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const QUESTION_ID = 'access_op_demo_winter';
const FIX = path.join(__dirname, 'fixtures');
const ANSWER_OK = path.join(FIX, 'access_winter_olympic_ok.accdb');   // 正确作答（满分）
const ANSWER_WRONG = path.join(FIX, 'accdb_pk_sample.accdb');         // 完全不对的表
const FULL = 100;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(a, b, name) { ok(name, a === b, `期望 ${JSON.stringify(b)}，实为 ${JSON.stringify(a)}`); }
function section(t) { console.log(`\n=== ${t} ===`); }

async function api(method, p, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* 无 body */ }
  return { status: res.status, body: json };
}

async function upload(p, filePath, { token, field = 'file', fields = {}, mime } = {}) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  fd.append(field, new Blob([buf], { type: mime || 'application/octet-stream' }), path.basename(filePath));
  const res = await fetch(BASE + p, { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body: json };
}

async function login(username, password) {
  const r = await api('POST', '/api/auth/secure-login', { body: { username, password } });
  return r.body?.data?.session?.access_token || r.body?.data?.token || null;
}

(async () => {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  const createdSubmissionIds = [];
  const createdAnswerIds = [];
  const createdFiles = [];
  let teacherToken = null, stuToken = null;
  let baselineSubs = 0;
  const baselineMySubIds = new Set();

  try {
    section('A. 登录与基线');
    teacherToken = await login('teacher', 'xgpy666');
    stuToken = await login('a', '111111');
    ok(!!teacherToken, 'A1 教师登录成功');
    ok(!!stuToken, 'A2 学生登录成功');
    const [[bs]] = await conn.query("SELECT COUNT(*) n FROM wps_op_submissions WHERE kind = 'access'");
    baselineSubs = Number(bs.n);
    console.log(`  （基线：kind='access' 提交记录 ${baselineSubs} 行）`);
    // ⚠️ 学生 a 同时是测试账号和日常账号：基线按「a 在本题的 id 集合」快照，
    //    兜底/断言只碰本次新产生的行，不碰基线（2026-10-10 误删事故）。
    const [bsMy] = await conn.query("SELECT id FROM wps_op_submissions WHERE kind = 'access' AND question_id = ? AND student_id = (SELECT id FROM profiles WHERE username='a' LIMIT 1)", [QUESTION_ID]);
    for (const r of bsMy) baselineMySubIds.add(r.id);

    const [[q]] = await conn.query('SELECT id, type, access_spec FROM questions WHERE id = ?', [QUESTION_ID]);
    ok(!!q, 'A3 样例题已灌入（先跑 seed_access_op_sample.cjs）');
    eq(q && q.type, 'access_op', 'A4 题型 = access_op');

    section('B. 教师端 · 检查器清单');
    const kinds = await api('GET', '/api/teacher/access-op/check-kinds', { token: teacherToken });
    eq(kinds.status, 200, 'B1 HTTP 200');
    eq(kinds.body?.data?.kinds?.length, 9, 'B2 共 9 种检查器');
    ok(!!kinds.body?.data?.doc?.accdb_primary_key, 'B3 附带字段说明文档');

    section('C. 教师端 · 答案解析 + 自动骨架');
    const subDirSnap = (() => {
      const d = path.join(__dirname, '../../uploads/access-op/submissions');
      return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
    })();
    const ins = await upload('/api/teacher/access-op/inspect', ANSWER_OK, { token: teacherToken });
    eq(ins.status, 200, 'C1 HTTP 200');
    const summary = ins.body?.data?.summary;
    ok(!!summary, 'C2 返回结构摘要');
    eq(summary?.tables?.[0]?.name, '奖牌榜', 'C3 识别出「奖牌榜」');
    eq(summary?.tables?.[0]?.row_count, 9, 'C4 记录数 = 9');
    ok(Array.isArray(ins.body?.data?.suggested_spec?.steps) && ins.body.data.suggested_spec.steps.length > 0, 'C5 自动生成评分点骨架');
    const sugTotal = (ins.body?.data?.suggested_spec?.steps || []).reduce((a, s) => a + (s.score || 0), 0);
    eq(Math.round(sugTotal), 100, 'C6 骨架总分 = 100');
    // 解析用的临时文件不留在提交目录（前后快照对比，确定性判定）
    const subDir = path.join(__dirname, '../../uploads/access-op/submissions');
    const subDirAfter = fs.existsSync(subDir) ? fs.readdirSync(subDir).sort() : [];
    eq(subDirAfter.length, subDirSnap.length, 'C7 inspect 的临时文件已清理（目录文件数不变）');

    section('D. 教师端 · 规格校验');
    const vs = await api('POST', '/api/teacher/access-op/validate-spec', { token: teacherToken, body: { spec: JSON.parse(q.access_spec), full_score: FULL } });
    eq(vs.status, 200, 'D1 HTTP 200');
    ok(vs.body?.data?.ok, 'D2 样例题规格无错误');
    eq(vs.body?.data?.total, FULL, 'D3 评分点总分 = 100');

    section('E. 学生端 · 取题与脱敏');
    const list = await api('GET', '/api/student/access-op/questions', { token: stuToken });
    eq(list.status, 200, 'E1 HTTP 200');
    const target = (list.body?.data || []).find((x) => x.id === QUESTION_ID);
    ok(!!target, 'E2 列表里有样例题');
    eq(target?.full_score, FULL, 'E3 满分 100');
    eq(target?.step_count, 4, 'E4 4 个步骤');
    eq(target?.template_count, 2, 'E5 2 个模板（accdb + xlsx）');

    const detail = await api('GET', `/api/student/access-op/${QUESTION_ID}`, { token: stuToken });
    eq(detail.status, 200, 'E6 详情 HTTP 200');
    ok(!!detail.body?.data?.spec, 'E7 返回 spec');
    const specStr = JSON.stringify(detail.body?.data?.spec || {});
    ok(!specStr.includes('"checks"'), 'E8 ⛔ 学生端 spec 不含 checks（答案）');
    ok(!specStr.includes('accdb_primary_key') && !specStr.includes('accdb_rows'), 'E9 ⛔ 学生端 spec 不含检查器类型');
    ok(JSON.stringify(detail.body?.data?.spec || {}).includes('步骤1'), 'E10 步骤标题正常下发');
    ok(Array.isArray(detail.body?.data?.spec?.templates) && detail.body.data.spec.templates.length === 2, 'E11 模板清单下发');

    section('F. 学生端 · 提交作答并判分（满分卷）');
    const sub1 = await upload(`/api/student/access-op/${QUESTION_ID}/submit`, ANSWER_OK, { token: stuToken });
    eq(sub1.status, 200, 'F1 HTTP 200');
    const d1 = sub1.body?.data;
    eq(d1?.score, 100, 'F2 得分 = 100');
    eq(d1?.full_score, 100, 'F3 满分 = 100');
    ok(d1?.passed, 'F4 passed = true');
    eq(d1?.detail?.steps?.length, 4, 'F5 回执含 4 个步骤明细');
    ok(d1?.detail?.steps?.every((s) => s.pass), 'F6 每一步都通过');
    ok(!('sha256' in (d1?.detail || {})), 'F7 ⛔ 回执不含 sha256');
    ok(d1?.detail?.steps?.[0]?.video_urls !== undefined, 'F8 步骤带 video_urls 字段（多视频兼容）');
    if (d1?.submission_id) createdSubmissionIds.push(d1.submission_id);

    section('G. 幂等：同一份文件再交一次');
    const sub2 = await upload(`/api/student/access-op/${QUESTION_ID}/submit`, ANSWER_OK, { token: stuToken });
    eq(sub2.status, 200, 'G1 HTTP 200');
    ok(sub2.body?.data?.duplicate === true, 'G2 duplicate = true（未重复记分）');
    eq(sub2.body?.data?.submission_id, d1?.submission_id, 'G3 回放同一条提交记录');

    section('H. 学生端 · 错卷只丢对应分');
    const sub3 = await upload(`/api/student/access-op/${QUESTION_ID}/submit`, ANSWER_WRONG, { token: stuToken });
    eq(sub3.status, 200, 'H1 HTTP 200');
    eq(sub3.body?.data?.score, 0, 'H2 完全不对的表 → 0 分');
    ok(sub3.body?.data?.passed === false, 'H3 passed = false');
    if (sub3.body?.data?.submission_id) createdSubmissionIds.push(sub3.body.data.submission_id);
    const step1 = sub3.body?.data?.detail?.steps?.[0];
    ok(step1 && step1.checks && step1.checks[0] && step1.checks[0].pass === false, 'H4 表存在评分点不通过');

    section('I. 判分结果查询');
    const res1 = await api('GET', `/api/student/access-op/${QUESTION_ID}/result`, { token: stuToken });
    eq(res1.status, 200, 'I1 HTTP 200');
    ok(!!res1.body?.data, 'I2 返回最近一次结果');
    eq(res1.body?.data?.score, 0, 'I3 最近一次是错卷 → 0 分');
    ok(!('sha256' in (res1.body?.data?.detail || {})), 'I4 ⛔ 结果不含 sha256');

    section('J. 落库与统计口径');
    const [subs] = await conn.query("SELECT id FROM wps_op_submissions WHERE kind='access' AND question_id=? AND student_id=(SELECT id FROM profiles WHERE username='a' LIMIT 1)", [QUESTION_ID]);
    ok(subs.length >= 1, 'J1 提交记录已落库（kind=access）');
    const [oldRow] = await conn.query("SELECT id, kind FROM wps_op_submissions WHERE id IN (?)", [createdSubmissionIds.length ? createdSubmissionIds : ['-']]);
    ok(oldRow.every((r) => r.kind === 'access'), 'J2 落库行 kind 均为 access');
    const [ans] = await conn.query("SELECT id FROM student_answers WHERE question_id=? AND source='practice' AND answer LIKE '[Access操作题]%'", [QUESTION_ID]);
    ok(ans.length >= 1, 'J3 进入 student_answers 统计口径');
    ans.forEach((r) => createdAnswerIds.push(r.id));

    section('K. 教师端 · 练习情况统计');
    const an = await api('GET', '/api/teacher/access-op/analytics', { token: teacherToken });
    eq(an.status, 200, 'K1 HTTP 200');
    const qs = an.body?.data?.questions || [];
    ok(qs.some((x) => x.id === QUESTION_ID), 'K2 统计里包含样例题');
    const me = (an.body?.data?.students || []).find((s) => s.username === 'a');
    ok(!!me, 'K3 统计里有学生 a');
    eq(me?.scores?.[QUESTION_ID]?.best, 100, 'K4 学生最高分按 MAX 取 = 100');

    section('L. 教师端 · 提交记录（只列 access）');
    const tsub = await api('GET', `/api/teacher/access-op/submissions?questionId=${QUESTION_ID}`, { token: teacherToken });
    eq(tsub.status, 200, 'L1 HTTP 200');
    ok((tsub.body?.data || []).length >= 1, 'L2 有提交记录');
    ok((tsub.body?.data || []).every((r) => r.question_id === QUESTION_ID), 'L3 只返回该题记录');

    section('M. 隔离：access_op 不进普通练习池');
    const [base] = await conn.query("SELECT id FROM questions WHERE type NOT IN ('wps_op','access_op') AND practice_enabled=1 LIMIT 1");
    if (base.length) {
      const sim = await api('GET', `/api/practice/similar/${base[0].id}`, { token: stuToken });
      const text = JSON.stringify(sim.body || {});
      ok(!text.includes(QUESTION_ID), 'M1 ⛔ 练习池里没有 access_op 题');
      ok(!text.includes('access_op'), 'M2 ⛔ 练习池返回不含 access_op 类型');
    } else {
      ok(true, 'M1 没有可参照的普通题，跳过');
      ok(true, 'M2 跳过');
    }
  } catch (e) {
    fail++;
    failures.push('脚本异常：' + e.message);
    console.error('脚本异常：', e);
  } finally {
    section('N. 清理与不留痕断言');
    try {
      if (createdSubmissionIds.length) {
        const [r] = await conn.query('DELETE FROM wps_op_submissions WHERE id IN (?)', [createdSubmissionIds]);
        console.log(`  已删除提交记录 ${r.affectedRows} 行`);
      }
      // 兜底：只删「a 在本题、本次新产生」的行（基线除外）。
      // ⛔ 运行期间真实用户（含 a 本人）可能正提交本题，基线行不能碰。
      const [r2] = await conn.query("DELETE FROM wps_op_submissions WHERE kind='access' AND question_id=? AND student_id=(SELECT id FROM profiles WHERE username='a' LIMIT 1) AND id NOT IN (?) AND id <> 'x'", [QUESTION_ID, baselineMySubIds.size ? [...baselineMySubIds] : ['x']]);
      if (r2.affectedRows) console.log(`  兜底删除提交记录 ${r2.affectedRows} 行`);
      const [r3] = await conn.query("DELETE FROM student_answers WHERE question_id=? AND source='practice' AND answer LIKE '[Access操作题]%' AND student_id=(SELECT id FROM profiles WHERE username='a' LIMIT 1) AND created_at > (SELECT NOW() - INTERVAL 1 HOUR)", [QUESTION_ID]);
      if (r3.affectedRows) console.log(`  已删除答题记录 ${r3.affectedRows} 行`);
      for (const f of createdFiles) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ } }
      // 清理本次测试留下的上传文件：只删「库中无引用的孤儿」且落盘已超过 10 秒
      // （刚写盘的可能是真实用户正在提交判分中，不能碰；判分落库是同步的，10 秒绰绰有余）
      const subDir = path.join(__dirname, '../../uploads/access-op/submissions');
      if (fs.existsSync(subDir)) {
        const [liveRows2] = await conn.query("SELECT file_path FROM wps_op_submissions WHERE kind='access'");
        const liveNames = new Set(liveRows2.map((r) => path.basename(String(r.file_path || ''))).filter(Boolean));
        let removed = 0;
        for (const f of fs.readdirSync(subDir)) {
          try {
            if (liveNames.has(f)) continue;
            const fp = path.join(subDir, f);
            if (Date.now() - fs.statSync(fp).mtimeMs < 10 * 1000) continue;
            fs.unlinkSync(fp);
            removed++;
          } catch { /* ignore */ }
        }
        if (removed) console.log(`  已删除孤儿作答文件 ${removed} 个`);
      }
      // ⚠️ 差集语义（学生 a 也是日常账号，不能要求绝对 0）：只断言「本次新产生的行」已清干净
      const [[as]] = await conn.query("SELECT COUNT(*) n FROM wps_op_submissions WHERE kind = 'access' AND question_id = ? AND student_id = (SELECT id FROM profiles WHERE username='a' LIMIT 1) AND id NOT IN (?)", [QUESTION_ID, baselineMySubIds.size ? [...baselineMySubIds] : ['x']]);
      eq(Number(as.n), 0, "N1 ⛔ 不留痕：学生 a 本次提交记录已清理（差集）");
      const [residue] = await conn.query("SELECT COUNT(*) n FROM student_answers WHERE question_id=? AND answer LIKE '[Access操作题]%' AND student_id=(SELECT id FROM profiles WHERE username='a' LIMIT 1) AND created_at > (SELECT NOW() - INTERVAL 1 HOUR)", [QUESTION_ID]);
      eq(Number(residue[0].n), 0, "N2 ⛔ 学生 a 本次答题记录已清理（差集）");
    } catch (e) {
      console.error('清理异常：', e.message);
      fail++;
      failures.push('清理异常：' + e.message);
    }
    await conn.end();

    console.log('\n========================================');
    console.log(`结果：${pass} 通过 / ${fail} 失败`);
    if (fail) { console.log('失败项：'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
    console.log('全部通过 ✅');
  }
})();
