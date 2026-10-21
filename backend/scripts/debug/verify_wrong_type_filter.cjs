#!/usr/bin/env node
/**
 * verify_wrong_type_filter.cjs
 * ============================================================
 * 验证（2026-10-21）：
 *   A. 学情分析 · 错题排行 **题型筛选** —— /api/teacher/analytics/wrong-questions 支持 type=
 *      （all / choice / fill_blank / composite / code / wps_op / access_op / op），
 *      非法值回落 all 且不 500；返回条目题型与筛选值一致。
 *   B. 学生端讲解列表 **剔除综合题** —— /api/student/explain/wrong-questions 不再下发
 *      composite（内含多个小题，讲解结构装不下）与操作题。
 *   C. 连续讲解选题 —— utils/explainQueue.ts 的 pickExplainQueue：
 *      ⛔ 过滤必须发生在「截断到 20」之前（否则名额被综合题吃掉，实际只讲十几道）；
 *      排序（错次 / 错误率）、空队列、全综合题、limit 边界。
 *   D. 不留痕 —— 临时改过的学生 hidden_features 原样还原并复查。
 *
 * 用法：node scripts/debug/verify_wrong_type_filter.cjs
 * 前置：后端 3101 在跑（不需要前端 dev server）；本机装了 frontend/node_modules/typescript。
 * 说明：C 段用 tsc 把 explainQueue.ts 编译成 cjs 后直接 require，喂构造数据断言，不碰库。
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('../../src/env');

const pool = require('../../src/db');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const TEACHER = { u: 'teacher', p: 'xgpy666' };
const REPO = path.resolve(__dirname, '..', '..', '..');

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
}
function section(t) { console.log(`\n【${t}】`); }

async function httpJson(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}

async function login(u, p) {
  const r = await httpJson('POST', '/api/auth/secure-login', { username: u, password: p });
  return r.json?.data?.session?.access_token || null;
}

/** 把前端 TS 工具函数编译成 cjs 供断言使用（不污染仓库，落到临时目录） */
function compileExplainQueue() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgpy-eq-'));
  execFileSync(process.execPath, [
    path.join(REPO, 'frontend', 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(REPO, 'frontend', 'src', 'utils', 'explainQueue.ts'),
    path.join(REPO, 'frontend', 'src', 'utils', 'questionType.ts'),
    '--outDir', outDir,
    '--rootDir', path.join(REPO, 'frontend', 'src'),
    '--module', 'commonjs',
    '--target', 'es2020',
    '--skipLibCheck',
  ], { stdio: 'pipe' });
  const file = path.join(outDir, 'utils', 'explainQueue.js');
  if (!fs.existsSync(file)) throw new Error(`编译产物不存在：${file}`);
  return { mod: require(file), cleanup: () => fs.rmSync(outDir, { recursive: true, force: true }) };
}

async function main() {
  const teacherToken = await login(TEACHER.u, TEACHER.p);
  ok('教师登录', !!teacherToken);
  if (!teacherToken) throw new Error('教师登录失败，后端是否在跑？');

  // 找一个「确实有综合题错答」的班级，用它验证题型筛选
  const [clsRows] = await pool.query(`
    SELECT p.class_id, COUNT(DISTINCT sa.question_id) AS n
      FROM student_answers sa
      JOIN profiles p ON p.id = sa.student_id
      JOIN questions q ON q.id = sa.question_id
     WHERE sa.is_correct = 0 AND p.role = 'student' AND q.type = 'composite'
     GROUP BY p.class_id
     ORDER BY n DESC
     LIMIT 1
  `);
  ok('存在含综合题错答的班级', clsRows.length > 0);
  if (!clsRows.length) throw new Error('没有可用于测试的班级数据');
  const classId = clsRows[0].class_id;
  console.log(`  使用班级：${classId}`);

  const qs = (params) => `/api/teacher/analytics/wrong-questions/${classId}?pageSize=100&${params}`;

  // ---------- A. 题型筛选 ----------
  section('A. 错题排行 · 题型筛选');

  const [dbCounts] = await pool.query(`
    SELECT q.type, COUNT(DISTINCT sa.question_id) AS n
      FROM student_answers sa
      JOIN profiles p ON p.id = sa.student_id
      JOIN questions q ON q.id = sa.question_id
     WHERE sa.is_correct = 0 AND p.role = 'student' AND p.class_id = ?
     GROUP BY q.type
  `, [classId]);
  const dbMap = Object.fromEntries(dbCounts.map((r) => [r.type, Number(r.n)]));

  const getType = async (t) => {
    const url = t === undefined ? qs('filter=all') : qs(`filter=all&type=${encodeURIComponent(t)}`);
    const r = await httpJson('GET', url, undefined, teacherToken);
    return { status: r.status, data: r.json?.data || { items: [], total: 0 } };
  };

  for (const t of ['choice', 'fill_blank', 'composite']) {
    const { status, data } = await getType(t);
    const bad = (data.items || []).filter((it) => it.type !== t);
    const expect = Math.min(dbMap[t] || 0, 100);
    ok(`type=${t} 只返回该题型`, status === 200 && bad.length === 0 && data.items.length > 0, `条目=${data.items.length}, 混入=${bad.length}`);
    ok(`type=${t} 的 total 与库内去重题数一致`, Number(data.total) === expect, `接口=${data.total} / 库=${dbMap[t] || 0}（上限100）`);
  }

  {
    const { status, data } = await getType('op');
    const bad = (data.items || []).filter((it) => it.type !== 'wps_op' && it.type !== 'access_op');
    ok('type=op（操作题合并）只返回 wps_op/access_op', status === 200 && bad.length === 0, `条目=${data.items.length}`);
  }

  {
    const all = await getType();
    const explicitAll = await getType('all');
    // 只比「集合」：错误次数并列时后端按 question_id 兜底排序保证确定性，
    // 但这里用集合比较可以避免将来改排序时误报
    const idsOf = (d) => (d.items || []).map((i) => i.question_id).sort();
    ok('不传 type 与 type=all 等价',
      all.data.total === explicitAll.data.total
      && JSON.stringify(idsOf(all.data)) === JSON.stringify(idsOf(explicitAll.data)),
      `total=${all.data.total}`);

    // 并列时的排序必须稳定：连讲两次「前 20」应是同一批题（否则老师每次听到的都不一样）
    const again = await getType();
    ok('同一查询重复调用结果顺序稳定（并列有兜底排序）',
      JSON.stringify((all.data.items || []).map((i) => i.question_id)) === JSON.stringify((again.data.items || []).map((i) => i.question_id)));

    const evil = await getType(`choice' OR 1=1 --`);
    ok('非法 type 回落 all（不 500、不注入）',
      evil.status === 200 && evil.data.total === all.data.total && evil.data.items.length === all.data.items.length,
      `status=${evil.status} total=${evil.data.total}`);
  }

  // ---------- B. 学生端讲解列表剔除综合题 ----------
  section('B. 学生端讲解列表（剔除综合题 / 操作题）');
  const [stuRows] = await pool.query(`
    SELECT wq.student_id, p.username,
           SUM(q.type = 'composite') AS comp,
           SUM(q.type IN ('wps_op','access_op')) AS opq,
           SUM(q.type NOT IN ('composite','wps_op','access_op')) AS normal_cnt
      FROM wrong_questions wq
      JOIN questions q ON q.id = wq.question_id
      JOIN profiles p ON p.id = wq.student_id
     GROUP BY wq.student_id, p.username
    HAVING comp > 0
     ORDER BY comp DESC
     LIMIT 1
  `);
  ok('存在错题里含综合题的学生', stuRows.length > 0);
  if (stuRows.length) {
    const stu = stuRows[0];
    const [before] = await pool.query('SELECT hidden_features FROM profiles WHERE id = ?', [stu.student_id]);
    const snapshot = before[0].hidden_features;
    // 临时放开讲解（hidden_features 里去掉 ai_explain = 开放），finally 原样还原
    await pool.query(
      `UPDATE profiles SET hidden_features = JSON_REMOVE(hidden_features, JSON_UNQUOTE(JSON_SEARCH(hidden_features, 'one', 'ai_explain')))
        WHERE id = ? AND JSON_CONTAINS(hidden_features, '"ai_explain"')`,
      [stu.student_id],
    );
    try {
      // 测试账号口令统一 111111（与 verify_explain_styles.cjs 一致）
      const token = await login(stu.username, '111111');
      ok('学生登录', !!token, `username=${stu.username}`);
      if (token) {
        const r = await httpJson('GET', '/api/student/explain/wrong-questions?limit=50', undefined, token);
        const items = r.json?.data?.questions || [];
        const types = items.reduce((m, it) => { m[it.type] = (m[it.type] || 0) + 1; return m; }, {});
        ok('接口 200', r.status === 200, `status=${r.status}`);
        ok('下发列表里没有综合题', !items.some((it) => it.type === 'composite'), JSON.stringify(types));
        ok('下发列表里没有操作题', !items.some((it) => it.type === 'wps_op' || it.type === 'access_op'), JSON.stringify(types));
        ok('该学生的普通错题确实能取到（不是全空）',
          items.length > 0 && items.length <= Number(stu.normal_cnt),
          `返回=${items.length} / 普通错题=${stu.normal_cnt} / 综合题=${stu.comp}`);
      }
    } finally {
      await pool.query('UPDATE profiles SET hidden_features = ? WHERE id = ?', [snapshot, stu.student_id]);
      const [after] = await pool.query('SELECT hidden_features FROM profiles WHERE id = ?', [stu.student_id]);
      ok('学生 hidden_features 已原样还原', JSON.stringify(after[0].hidden_features) === JSON.stringify(snapshot),
        `现=${JSON.stringify(after[0].hidden_features)}`);
    }
  }

  // ---------- C. 连续讲解选题函数 ----------
  section('C. 连续讲解选题 pickExplainQueue');
  let compiled = null;
  try {
    compiled = compileExplainQueue();
    const { pickExplainQueue, isNonExplainable } = compiled.mod;

    ok('isNonExplainable：综合题 true', isNonExplainable('composite') === true);
    ok('isNonExplainable：操作题 true', isNonExplainable('wps_op') === true && isNonExplainable('access_op') === true);
    ok('isNonExplainable：选择题 false', isNonExplainable('choice') === false);

    // 构造：q1~q3 是错次最高的综合题，q4~ 才是普通题 → 过滤必须在截断前
    const mk = (id, wrong, attempts, type) => ({ question_id: id, type: type || 'choice', wrong_count: wrong, total_attempts: attempts });
    const items = [];
    items.push(mk('q1', 50, 50, 'composite'));
    items.push(mk('q2', 48, 50, 'composite'));
    items.push(mk('q3', 46, 50, 'composite'));
    items.push(mk('q4', 45, 50, 'wps_op'));
    for (let i = 5; i <= 30; i++) items.push(mk(`q${i}`, 100 - i, 100));
    // 让 qRate 错误率最高（100%），用于 rate 模式
    items.push(mk('qRate', 8, 8));

    const picked = pickExplainQueue(items, 'wrong');
    ok('返回 20 条', picked.ids.length === 20, `实际=${picked.ids.length}`);
    ok('不含任何综合题', !picked.ids.some((id) => ['q1', 'q2', 'q3'].includes(id)), picked.ids.slice(0, 3).join(','));
    ok('不含操作题', !picked.ids.includes('q4'));
    ok('跳过计数正确（3 综合 + 1 操作）', picked.skipped === 4 && picked.skippedComposite === 3 && picked.skippedOperation === 1,
      `skipped=${picked.skipped}/${picked.skippedComposite}/${picked.skippedOperation}`);
    ok('过滤发生在截断前：第一条是原第 5 名', picked.ids[0] === 'q5', `首条=${picked.ids[0]}`);
    ok('20 个名额没被占掉：末条是原第 24 名', picked.ids[19] === 'q24', `末条=${picked.ids[19]}`);

    const byRate = pickExplainQueue(items, 'rate', 3);
    ok('rate 模式按错误率排序', byRate.ids[0] === 'qRate', byRate.ids.join(','));
    ok('limit 生效', byRate.ids.length === 3, `实际=${byRate.ids.length}`);

    const onlyComposite = pickExplainQueue([mk('c1', 9, 9, 'composite'), mk('c2', 8, 9, 'composite')], 'wrong');
    ok('全是综合题 → 空队列且计数为 2', onlyComposite.ids.length === 0 && onlyComposite.skippedComposite === 2, JSON.stringify(onlyComposite));

    ok('空数组 / null 不炸', pickExplainQueue([], 'wrong').ids.length === 0 && pickExplainQueue(null, 'wrong').ids.length === 0);
    ok('脏数据（缺 id / 非数字）被跳过',
      pickExplainQueue([{ question_id: '' }, { question_id: 'x', wrong_count: 'abc', total_attempts: null, type: 'choice' }], 'wrong').ids.join(',') === 'x');

    // 用真实接口数据交叉验证
    let realQueue = null;
    try {
      const r = await httpJson('GET', qs('filter=unexplained'), undefined, teacherToken);
      realQueue = pickExplainQueue(r.json?.data?.items || [], 'wrong');
    } catch { /* ignore */ }
    if (realQueue) {
      const r = await httpJson('GET', qs('filter=unexplained'), undefined, teacherToken);
      const byId = new Map((r.json?.data?.items || []).map((it) => [it.question_id, it.type]));
      const bad = realQueue.ids.filter((id) => isNonExplainable(byId.get(id)));
      ok('真实数据：队列里没有不适合讲解的题型', bad.length === 0, bad.join(','));
      ok('真实数据：队列不超过 20 条', realQueue.ids.length <= 20, `实际=${realQueue.ids.length}，跳过 ${realQueue.skipped} 道`);
    }
  } finally {
    if (compiled) compiled.cleanup();
  }

  // ---------- D. 不留痕 ----------
  section('D. 不留痕');
  const [leftover] = await pool.query("SHOW TABLES LIKE 'tmp\\_%'");
  ok('无 tmp_ 临时表残留', leftover.length === 0);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('失败项：\n  - ' + failures.join('\n  - ')); process.exitCode = 1; }
  await pool.end();
}

main().catch(async (e) => {
  console.error('脚本异常：', e);
  process.exitCode = 1;
  try { await pool.end(); } catch { /* ignore */ }
});
