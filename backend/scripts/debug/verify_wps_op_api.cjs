/**
 * WPS 操作题一期端到端验证（真后端 + 真上传 + 真判分 + 真落库）
 * 前置：后端跑在 3101，且已执行 seed_wps_op_sample.cjs 灌入样例题。
 * 用法：node backend/scripts/debug/verify_wps_op_api.cjs
 *
 * ⛔ 不留痕铁律：
 *   - 脚本产生的提交记录 / 答题记录 / 上传文件全部记录 id，在 finally 中删除；
 *   - 末尾断言「跑完之后 wps_op_submissions 的行数 == 跑之前」，防止悄悄污染。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('../../node_modules/mysql2/promise');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const QUESTION_ID = 'wps_op_demo_popshen';
const FIX = path.join(__dirname, 'fixtures');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
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

async function upload(p, filePath, { token, fields = {} } = {}) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), path.basename(filePath));
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: fd,
  });
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
  let teacherToken = null, stuToken = null, stuId = null;
  let baselineSubs = 0;
  let baselineAnswerIds = new Set();

  try {
    const [[b1]] = await conn.query('SELECT COUNT(*) AS n FROM wps_op_submissions');
    baselineSubs = b1.n;
    // 快照跑之前本题已有的答题记录 id：finally 里按「差集」清理，
    // 比只按 id 列表删更稳（异常路径下 id 可能没被记录到）。
    const [bRows] = await conn.query("SELECT id FROM student_answers WHERE question_id = ? AND answer LIKE '[WPS操作题]%'", [QUESTION_ID]);
    baselineAnswerIds = new Set(bRows.map((r) => r.id));
    const [stuRows] = await conn.query("SELECT id FROM profiles WHERE username = 'a' LIMIT 1");
    if (!stuRows.length) throw new Error('找不到学生 a');
    stuId = stuRows[0].id;

    section('A. 登录');
    teacherToken = await login('teacher', 'xgpy666');
    stuToken = await login('a', '111111');
    ok('教师登录成功', !!teacherToken);
    ok('学生 a 登录成功', !!stuToken);
    if (!teacherToken || !stuToken) throw new Error('登录失败');

    section('B. 学生取题列表');
    const list = await api('GET', '/api/student/wps-op/questions', { token: stuToken });
    ok('列表接口 200', list.status === 200, 'status=' + list.status);
    const item = (list.body?.data || []).find((x) => x.id === QUESTION_ID);
    ok('列表包含样例操作题', !!item);
    if (item) {
      ok('列表返回满分 10', item.full_score === 10, 'full_score=' + item.full_score);
      ok('列表返回 4 个步骤', item.step_count === 4, 'step_count=' + item.step_count);
      ok('列表返回模板名', !!item.template_name, item.template_name);
      ok('列表不含评分点字段', !('wps_spec' in item) && !('checks' in item));
    }

    section('C. 学生取题详情：⛔ 不得下发评分点');
    const detail = await api('GET', `/api/student/wps-op/${QUESTION_ID}`, { token: stuToken });
    ok('详情接口 200', detail.status === 200);
    const spec = detail.body?.data?.spec || {};
    ok('详情含 4 个步骤说明', (spec.steps || []).length === 4, 'steps=' + (spec.steps || []).length);
    ok('步骤带说明文字', (spec.steps || []).every((s) => !!s.title));
    ok('步骤带演示视频字段（后期每步配视频）', (spec.steps || []).every((s) => 'video_url' in s));
    const raw = JSON.stringify(detail.body);
    ok('⛔ 响应体不含 checks 字段', !raw.includes('"checks"'));
    ok('⛔ 响应体不含 range_values 答案值', !raw.includes('15089') && !raw.includes('17736'));
    ok('⛔ 响应体不含 grader 口径', !raw.includes('"grader"'));
    ok('下发模板下载路径', !!spec.template?.path, spec.template?.path);

    section('D. ⛔ 通用表接口对学生同样不得泄露 wps_spec');
    const tbl = await api('GET', '/api/tables/questions?filters=' + encodeURIComponent(JSON.stringify({ id: QUESTION_ID })), { token: stuToken });
    const tblRow = (tbl.body?.data || [])[0] || {};
    ok('通用表接口 200', tbl.status === 200);
    ok('⛔ questions.wps_spec 已对学生剥离', tblRow.wps_spec === undefined, 'wps_spec=' + JSON.stringify(tblRow.wps_spec));
    ok('⛔ questions.answers 已对学生剥离', tblRow.answers === undefined);
    const teachTbl = await api('GET', '/api/tables/questions?filters=' + encodeURIComponent(JSON.stringify({ id: QUESTION_ID })), { token: teacherToken });
    ok('教师侧仍能看到 wps_spec（用于编辑）', !!(teachTbl.body?.data || [])[0]?.wps_spec);

    section('E. 提交全对卷 → 应得 10 分');
    const r1 = await upload(`/api/student/wps-op/${QUESTION_ID}/submit`, path.join(FIX, 'wps_popshen_correct.xlsx'), { token: stuToken });
    ok('提交接口 200', r1.status === 200, 'status=' + r1.status + ' ' + JSON.stringify(r1.body?.error || ''));
    const d1 = r1.body?.data || {};
    ok('得分 10 / 10', d1.score === 10 && d1.full_score === 10, `${d1.score}/${d1.full_score}`);
    ok('passed = true', d1.passed === true);
    ok('duplicate = false', d1.duplicate === false);
    if (d1.submission_id) createdSubmissionIds.push(d1.submission_id);
    const steps1 = d1.detail?.steps || [];
    ok('明细含 4 个步骤', steps1.length === 4);
    ok('每步均满分', steps1.every((s) => s.pass && s.obtained === s.score));
    ok('步骤带演示视频位', steps1.every((s) => 'video_url' in s));
    ok('明细含逐评分点 label', steps1.every((s) => (s.checks || []).every((c) => !!c.label)));
    ok('⛔ 回执不含 sha256 内部字段', !('sha256' in (d1.detail || {})));

    section('F. 落库检查');
    const [subRows] = await conn.query('SELECT id, score_obtained, full_score, file_sha256, file_path FROM wps_op_submissions WHERE question_id = ? ORDER BY created_at DESC LIMIT 1', [QUESTION_ID]);
    ok('wps_op_submissions 已写入', subRows.length === 1);
    if (subRows.length) {
      ok('落库分数 = 10', Number(subRows[0].score_obtained) === 10);
      ok('落库满分 = 10', Number(subRows[0].full_score) === 10);
      ok('落库 sha256 非空', !!subRows[0].file_sha256 && subRows[0].file_sha256.length === 64);
      const abs = path.join(__dirname, '../..', subRows[0].file_path.replace(/^\/uploads\//, 'uploads/'));
      ok('落库文件确实存在', fs.existsSync(abs), abs);
      if (fs.existsSync(abs)) createdFiles.push(abs);
    }
    const [ansRows] = await conn.query("SELECT id, is_correct, score_obtained FROM student_answers WHERE student_id = ? AND question_id = ? ORDER BY created_at DESC LIMIT 1", [stuId, QUESTION_ID]);
    ok('student_answers 已写入（进入掌握口径）', ansRows.length === 1);
    if (ansRows.length) {
      ok('满分 → is_correct = 1', Number(ansRows[0].is_correct) === 1);
      ok('score_obtained = 10', Number(ansRows[0].score_obtained) === 10);
      createdAnswerIds.push(ansRows[0].id);
    }

    section('G. 幂等：同一份文件重复提交不重复记分');
    const before = (await conn.query('SELECT COUNT(*) AS n FROM wps_op_submissions'))[0][0].n;
    const r2 = await upload(`/api/student/wps-op/${QUESTION_ID}/submit`, path.join(FIX, 'wps_popshen_correct.xlsx'), { token: stuToken });
    ok('重复提交 200', r2.status === 200);
    ok('duplicate = true', r2.body?.data?.duplicate === true);
    ok('仍返回上次分数 10', r2.body?.data?.score === 10);
    const after = (await conn.query('SELECT COUNT(*) AS n FROM wps_op_submissions'))[0][0].n;
    ok('⛔ 提交记录行数未增加', after === before, `${before} → ${after}`);

    section('H. 缺图表卷 → 只丢第 4 步 2 分');
    const r3 = await upload(`/api/student/wps-op/${QUESTION_ID}/submit`, path.join(FIX, 'wps_popshen_nochart.xlsx'), { token: stuToken });
    const d3 = r3.body?.data || {};
    ok('提交 200', r3.status === 200);
    ok('得分 8 / 10', d3.score === 8, `${d3.score}/${d3.full_score}`);
    ok('步骤 4 得 0 分', d3.detail?.steps?.[3]?.obtained === 0);
    ok('失败原因可读', /未在/.test(d3.detail?.steps?.[3]?.checks?.[0]?.got || ''), d3.detail?.steps?.[3]?.checks?.[0]?.got);
    if (d3.submission_id) createdSubmissionIds.push(d3.submission_id);
    const [a3] = await conn.query('SELECT id FROM student_answers WHERE student_id = ? AND question_id = ? ORDER BY created_at DESC LIMIT 1', [stuId, QUESTION_ID]);
    if (a3.length) createdAnswerIds.push(a3[0].id);

    section('I. 手填数字卷 → 丢公式分与求和分');
    const r4 = await upload(`/api/student/wps-op/${QUESTION_ID}/submit`, path.join(FIX, 'wps_popshen_hardcode.xlsx'), { token: stuToken });
    const d4 = r4.body?.data || {};
    ok('提交 200', r4.status === 200);
    ok('得分 7 / 10', d4.score === 7, `${d4.score}/${d4.full_score}`);
    const c4 = d4.detail?.steps?.[1]?.checks?.[0] || {};
    ok('指出"没用公式"', /纯值/.test(c4.got || ''), c4.got);
    if (d4.submission_id) createdSubmissionIds.push(d4.submission_id);
    const [a4] = await conn.query('SELECT id, is_correct FROM student_answers WHERE student_id = ? AND question_id = ? ORDER BY created_at DESC LIMIT 1', [stuId, QUESTION_ID]);
    if (a4.length) { createdAnswerIds.push(a4[0].id); ok('未满分 → is_correct = 0', Number(a4[0].is_correct) === 0); }

    section('J. 学生查历史结果');
    const res1 = await api('GET', `/api/student/wps-op/${QUESTION_ID}/result`, { token: stuToken });
    ok('结果接口 200', res1.status === 200);
    ok('返回最近一次结果', !!res1.body?.data);
    ok('明细可用', Array.isArray(res1.body?.data?.detail?.steps));
    const det2 = await api('GET', `/api/student/wps-op/${QUESTION_ID}`, { token: stuToken });
    ok('详情含提交历史', (det2.body?.data?.submissions || []).length >= 3, 'count=' + (det2.body?.data?.submissions || []).length);

    section('K. 异常上传');
    const tmpTxt = path.join(FIX, '_tmp_not_xlsx.txt');
    fs.writeFileSync(tmpTxt, 'not a spreadsheet');
    const rBad = await upload(`/api/student/wps-op/${QUESTION_ID}/submit`, tmpTxt, { token: stuToken });
    ok('非 xlsx 被拒 400', rBad.status === 400, 'status=' + rBad.status);
    ok('错误提示可操作', /xlsx|另存为/i.test(rBad.body?.error || ''), rBad.body?.error);
    fs.unlinkSync(tmpTxt);

    const brokenXlsx = path.join(FIX, '_tmp_broken.xlsx');
    fs.writeFileSync(brokenXlsx, Buffer.from('PK not really a zip'));
    const rBroken = await upload(`/api/student/wps-op/${QUESTION_ID}/submit`, brokenXlsx, { token: stuToken });
    ok('损坏 xlsx 被拒 400', rBroken.status === 400, 'status=' + rBroken.status);
    ok('损坏文件也给出可读提示', /无法识别|另存为/.test(rBroken.body?.error || ''), rBroken.body?.error);
    fs.unlinkSync(brokenXlsx);
    const [residue] = await conn.query("SELECT COUNT(*) AS n FROM wps_op_submissions WHERE question_id = ? AND file_size < 100", [QUESTION_ID]);
    ok('⛔ 被拒的上传没有落库', residue[0].n === 0, 'n=' + residue[0].n);

    section('L. 教师端');
    const subs = await api('GET', `/api/teacher/wps-op/submissions?questionId=${QUESTION_ID}`, { token: teacherToken });
    ok('教师提交列表 200', subs.status === 200);
    ok('能看到学生提交', (subs.body?.data || []).length >= 3, 'count=' + (subs.body?.data || []).length);
    ok('列表带学生姓名/账号', (subs.body?.data || []).every((x) => 'real_name' in x && 'username' in x));

    const kinds = await api('GET', '/api/teacher/wps-op/check-kinds', { token: teacherToken });
    ok('评分点类型清单 200', kinds.status === 200);
    ok('清单含 chart 与 range_values', (kinds.body?.data?.kinds || []).includes('chart') && (kinds.body?.data?.kinds || []).includes('range_values'));

    const insp = await upload('/api/teacher/wps-op/inspect', path.join(FIX, 'wps_popshen_correct.xlsx'), { token: teacherToken });
    ok('标准答案解析 200', insp.status === 200, 'status=' + insp.status);
    const sug = insp.body?.data?.suggested_spec;
    ok('返回自动生成的评分点骨架', !!sug && (sug.steps || []).length >= 3, 'steps=' + (sug?.steps || []).length);
    ok('骨架识别出图表评分点', JSON.stringify(sug || {}).includes('"chart"'));
    ok('骨架识别出合并检查', JSON.stringify(sug || {}).includes('"merged"'));
    const sum = insp.body?.data?.summary;
    ok('结构摘要识别出图表', (sum?.sheets?.[0]?.charts || []).length === 1);
    ok('结构摘要识别出 D3 公式', (sum?.sheets?.[0]?.cells || []).some((c) => c.ref === 'D3' && /C3\*10000\/B3/.test(c.formula || '')));

    const val = await api('POST', '/api/teacher/wps-op/validate-spec', { token: teacherToken, body: { spec: sug, full_score: 10 } });
    ok('规格校验接口 200', val.status === 200);
    ok('骨架可通过校验', val.body?.data?.ok === true, JSON.stringify(val.body?.data?.errors || []));

    const tpl = await upload('/api/teacher/wps-op/template', path.join(FIX, 'wps_popshen_correct.xlsx'), { token: teacherToken });
    ok('模板上传 200', tpl.status === 200, 'status=' + tpl.status);
    ok('返回模板路径', !!tpl.body?.data?.path, tpl.body?.data?.path);
    if (tpl.body?.data?.path) {
      createdFiles.push(path.join(__dirname, '../..', tpl.body.data.path.replace(/^\/uploads\//, 'uploads/')));
    }

    section('M. 权限');
    const noAuth = await api('GET', `/api/student/wps-op/${QUESTION_ID}`);
    ok('未登录访问详情被拒', noAuth.status === 401 || noAuth.status === 403, 'status=' + noAuth.status);
    const stuAsTeacher = await api('GET', '/api/teacher/wps-op/submissions', { token: stuToken });
    ok('学生访问教师接口被拒', stuAsTeacher.status === 403, 'status=' + stuAsTeacher.status);
    const teacherAsStu = await upload(`/api/student/wps-op/${QUESTION_ID}/submit`, path.join(FIX, 'wps_popshen_correct.xlsx'), { token: teacherToken });
    ok('⛔ 教师不能调作答接口（否则教师 id 会写进答题记录、污染学生统计）', teacherAsStu.status === 403, 'status=' + teacherAsStu.status);
    // ---------------------------------------------------------------
    // ⛔ 隔离断言：WPS 操作题是「独立入口」，绝不能混进普通练习/测试池，
    //    也不能计入「可练习题量」「章节题量」口径 —— 否则学生会在练习里
    //    拿到一道没有 options/answers 的空白题，页面上显示的题量也会虚高。
    //    对应实现：index.js 的 SQL_NOT_WPS_OP + PracticeModule/TestModule 的 neq 过滤。
    section('N. ⛔ 练习题池 / 计数口径隔离（wps_op 不得混进普通练习与测试）');
    const [[wpsPrac]] = await conn.query("SELECT COUNT(*) AS n FROM questions WHERE practice_enabled = 1 AND type = 'wps_op'");
    ok('样例操作题处于练习可用态（否则下面几条断言是空转）', Number(wpsPrac.n) > 0, 'n=' + wpsPrac.n);

    const [[dbPool]] = await conn.query("SELECT COUNT(*) AS n FROM questions WHERE practice_enabled = 1 AND type <> 'wps_op'");

    // 1) 学生端练习池：走通用表接口，与 PracticeModule 完全同一条链路
    const poolFilters = encodeURIComponent(JSON.stringify({ practice_enabled: true, type_neq: 'wps_op' }));
    const poolRes = await api('GET', `/api/tables/questions?filters=${poolFilters}`, { token: stuToken });
    const poolRows = Array.isArray(poolRes.body?.data) ? poolRes.body.data : [];
    ok('学生练习池接口 200', poolRes.status === 200, 'status=' + poolRes.status);
    ok('⛔ 练习池里没有 wps_op', poolRows.length > 0 && poolRows.every((r) => r.type !== 'wps_op'), 'count=' + poolRows.length);
    ok('⛔ 练习池没泄露 wps_spec', poolRows.every((r) => r.wps_spec === undefined));
    ok('练习池条数与 DB 口径一致', poolRows.length === Number(dbPool.n), `api=${poolRows.length} db=${dbPool.n}`);

    // 2) 教师端「类目题量上限」必须同口径（教师按这个数设掌握资格上限）
    const counts = await api('GET', '/api/teacher/qualification/counts', { token: teacherToken });
    ok('类目题量接口 200', counts.status === 200, 'status=' + counts.status);
    ok('⛔ 类目题量 total 不含 wps_op', Number(counts.body?.data?.total) === Number(dbPool.n),
      `total=${counts.body?.data?.total} db=${dbPool.n}`);

    // 3) 学习模块的「章/小节题量」必须同口径（点「去练习 N 题」用的就是这个 N）
    const [[seedQ]] = await conn.query('SELECT cluster_id FROM questions WHERE id = ?', [QUESTION_ID]);
    const chaptersRes = await api('GET', '/api/student/learn-chapters', { token: stuToken });
    const allSecs = [];
    (chaptersRes.body?.data?.chapters || []).forEach((c) => (c.sections || []).forEach((s) => allSecs.push(s)));
    const [secRows] = await conn.query(
      "SELECT cluster_id, COUNT(*) AS cnt FROM questions WHERE type <> 'wps_op' AND cluster_id IS NOT NULL AND cluster_id <> '' GROUP BY cluster_id"
    );
    const dbSecMap = new Map(secRows.map((r) => [r.cluster_id, Number(r.cnt)]));
    const secMismatch = allSecs.filter((s) => Number(s.question_count) !== (dbSecMap.get(s.path) || 0));
    ok('⛔ 学习页各小节题量与 DB 同口径（已扣掉 wps_op）', allSecs.length > 0 && secMismatch.length === 0,
      secMismatch.length ? `不一致 ${secMismatch.length} 条，例如 ${JSON.stringify(secMismatch[0])}` : 'checked=' + allSecs.length);
    const seedSec = allSecs.find((s) => s.path === seedQ?.cluster_id);
    ok('⛔ 样例操作题所在小节的题量没有把它算进去',
      !seedSec || Number(seedSec.question_count) === (dbSecMap.get(seedQ.cluster_id) || 0),
      `小节=${seedSec ? seedSec.question_count : 'n/a'} db=${dbSecMap.get(seedQ?.cluster_id) || 0}`);

    // 4) 举一反三（同类题）的回退池同样不得混入 wps_op
    const [peerRows] = await conn.query(
      "SELECT id FROM questions WHERE type <> 'wps_op' AND practice_enabled = 1 ORDER BY RAND() LIMIT 1"
    );
    if (peerRows.length) {
      const sim = await api('GET', `/api/practice/similar/${peerRows[0].id}?limit=10`, { token: stuToken });
      const simRows = sim.body?.data?.questions || [];
      ok('⛔ 举一反三的同类题池里没有 wps_op', sim.status === 200 && simRows.every((r) => r.type !== 'wps_op'),
        `count=${simRows.length}`);
    } else {
      ok('⛔ 举一反三的同类题池里没有 wps_op', false, '库里找不到普通练习题，无法验证');
    }
  } catch (e) {
    fail++; failures.push('脚本异常：' + e.message);
    console.error('\n脚本异常：', e);
  } finally {
    // ---------- 不留痕 ----------
    console.log('\n=== O. 清理与不留痕断言 ===');
    try {
      if (createdSubmissionIds.length) {
        const [r] = await conn.query('DELETE FROM wps_op_submissions WHERE id IN (?)', [createdSubmissionIds]);
        console.log(`  已删除提交记录 ${r.affectedRows} 行`);
      }
      if (createdAnswerIds.length) {
        const [r] = await conn.query('DELETE FROM student_answers WHERE id IN (?)', [createdAnswerIds]);
        console.log(`  已删除答题记录 ${r.affectedRows} 行`);
      }
      // 兜底：按「差集」清掉本题本次跑出来的全部答题记录（不管学生是谁、id 有没有被记到）
      const [curRows] = await conn.query("SELECT id FROM student_answers WHERE question_id = ? AND answer LIKE '[WPS操作题]%'", [QUESTION_ID]);
      const leaked = curRows.map((r) => r.id).filter((id) => !baselineAnswerIds.has(id));
      if (leaked.length) {
        const [r3] = await conn.query('DELETE FROM student_answers WHERE id IN (?)', [leaked]);
        console.log(`  兜底清理答题记录 ${r3.affectedRows} 行`);
      }
      // 兜底：清掉本题本次跑出来的提交记录（同样按差集）
      const [curSubs] = await conn.query('SELECT id FROM wps_op_submissions WHERE question_id = ?', [QUESTION_ID]);
      const leakedSubs = curSubs.map((r) => r.id).filter((id) => !createdSubmissionIds.includes(id));
      if (leakedSubs.length) {
        const [r4] = await conn.query('DELETE FROM wps_op_submissions WHERE id IN (?)', [leakedSubs]);
        if (r4.affectedRows) console.log(`  兜底清理提交记录 ${r4.affectedRows} 行`);
      }
      for (const f of createdFiles) { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ } }

      // 兜底：清掉「孤儿提交文件」——uploads/wps-op/submissions 下没有被 wps_op_submissions
      // 任何一行引用的文件（跑挂一次就会留一个）。以库为准，所以对本脚本和 UI 脚本产生的残留都有效。
      const SUB_DIR = path.join(__dirname, '../../uploads/wps-op/submissions');
      const [liveRows] = await conn.query('SELECT file_path FROM wps_op_submissions');
      const liveNames = new Set(liveRows.map((r) => path.basename(String(r.file_path || ''))).filter(Boolean));
      let swept = 0;
      if (fs.existsSync(SUB_DIR)) {
        for (const name of fs.readdirSync(SUB_DIR)) {
          if (!liveNames.has(name)) { try { fs.unlinkSync(path.join(SUB_DIR, name)); swept++; } catch { /* ignore */ } }
        }
      }
      if (swept) console.log(`  兜底清理孤儿提交文件 ${swept} 个`);

      const [[b2]] = await conn.query('SELECT COUNT(*) AS n FROM wps_op_submissions');
      const [[b3]] = await conn.query("SELECT COUNT(*) AS n FROM student_answers WHERE question_id = ? AND answer LIKE '[WPS操作题]%'", [QUESTION_ID]);
      ok('⛔ 不留痕：提交记录回到基线', b2.n === baselineSubs, `${baselineSubs} → ${b2.n}`);
      ok('⛔ 不留痕：无残留操作题答题记录', b3.n === 0, 'n=' + b3.n);
    } catch (e) {
      console.error('清理阶段异常：', e.message);
      fail++;
    }
    await conn.end();

    console.log('\n========================================');
    console.log(`结果：${pass} 通过 / ${fail} 失败`);
    if (fail) { console.log('\n失败项：'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
    console.log('全部通过 ✅');
  }
})();
