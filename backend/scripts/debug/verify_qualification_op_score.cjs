#!/usr/bin/env node
/**
 * verify_qualification_op_score.cjs
 *
 * 目的：验证「普通测试 / 对战PK 资格验证」在原有两项（做对题数、已掌握题数）之外，
 *       **新增的两项操作题累计得分条件**（迁移 103，2026-10-16）：
 *         条件三 · WPS操作题累计得分    >= qualification_wps_op_score
 *         条件四 · Access操作题累计得分 >= qualification_access_op_score
 *       四项是 AND 关系；任一项阈值为 NULL/0 即该项不启用。
 *
 * 口径要求（本次实现的关键约束）：第 3/4 项必须与
 *   任务中心 → 成就殿堂 → 「累计操作题得分」（指标 total_op_score）
 * 完全同源 —— 两边都走 game-task-metrics.getOpScore()。本脚本正是要证明这一点。
 *
 * 分层：
 *   A. 库结构     —— 两张表都有新列，且可空
 *   B. 口径一致   —— 成就殿堂指标 == 直接 SQL == 资格接口返回的 current
 *   C. 判定矩阵   —— 达标 / 不达标 / 未启用 / 混搭，逐个断言 passed
 *   D. PK 侧      —— pk-socket/handler.js 的 checkQualification（直调真实导出）
 *   E. 教师端往返 —— 走真实写接口建房/建测试，读回确认两个新字段落库
 *   F. 学生端界面 —— 真机无头浏览器：卡片文案 + 点击拦截提示
 *   G. 清理       —— 临时数据全部回收，末尾断言「不留痕」
 *
 * 用法：node scripts/debug/verify_qualification_op_score.cjs
 * 前置：后端 3101 在跑；F 段还需要前端 3266。
 *
 * ⛔ 数据纪律：所有临时行用 tmp_ 前缀（PK 配置用可识别的 __tmp_qos 名字），
 *    finally 里回收，并在最后断言库里 0 残留。
 */

const path = require('path');
const fs = require('fs');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('../../src/env');

const pool = require('../../src/db');
const metrics = require('../../src/game-task-metrics');
const pk = require('../../src/pk-socket/handler');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
}
function section(t) { console.log(`\n【${t}】`); }

const RUN = Date.now();
const TMP_SUB_PREFIX = 'tmp_qos_sub_';
const TMP_TEST_OK = `tmp_qos_test_ok_${RUN}`;    // WPS 70 / Access 15  → 学生A 通过
const TMP_TEST_NO = `tmp_qos_test_no_${RUN}`;    // WPS 100            → 学生A 不通过
const TMP_TEST_ZERO = `tmp_qos_test_zero_${RUN}`;// 全 0               → 四项都不启用
const TMP_PK_NAME = `__tmp_qos_pk_${RUN}__`;     // PK：WPS 70 / Access 15

const created = { subIds: [], testIds: [], pkIds: [] };

// ── HTTP 小工具 ─────────────────────────────────────────────────────────
async function httpJson(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}

async function login(username, password) {
  const r = await httpJson('POST', '/api/auth/secure-login', {
    username, password, deviceInfo: 'verify_qualification_op_score.cjs',
  });
  const token = r.json?.data?.session?.access_token;
  const id = r.json?.data?.user?.id;
  return token ? { token, id } : null;
}

// ── 直接 SQL 算操作题累计得分（独立实现，用于交叉验证）────────────────────
async function sqlOpScore(studentId, kind) {
  const [rows] = await pool.query(
    'SELECT COALESCE(SUM(score_obtained), 0) AS s FROM wps_op_submissions WHERE student_id = ? AND kind = ?',
    [studentId, kind]
  );
  return Number(rows[0]?.s) || 0;
}

async function cleanup() {
  if (created.subIds.length) {
    await pool.query('DELETE FROM wps_op_submissions WHERE id IN (?)', [created.subIds]);
  }
  if (created.testIds.length) {
    await pool.query('DELETE FROM tests WHERE id IN (?)', [created.testIds]);
  }
  if (created.pkIds.length) {
    await pool.query('DELETE FROM pk_battle_configs WHERE id IN (?)', [created.pkIds]);
  }
}

async function main() {
  // ══ 准备：挑两个真实学生 ══════════════════════════════════════════════
  const [stuRows] = await pool.query(
    "SELECT id, username, class_id FROM profiles WHERE role = 'student' AND username IN ('a','b') ORDER BY username"
  );
  if (stuRows.length < 2) throw new Error('需要 a / b 两个学生账号，请先确认库里有');
  const SA = stuRows.find((s) => s.username === 'a');
  const SB = stuRows.find((s) => s.username === 'b');
  console.log(`  学生A=${SA.username}(${SA.id})  学生B=${SB.username}(${SB.id})`);

  // 造临时操作题提交：A 得 WPS 75 分 / Access 20 分；B 不造（0 分）
  const rows = [
    { id: `${TMP_SUB_PREFIX}${RUN}_1`, student: SA.id, kind: 'wps', score: 40 },
    { id: `${TMP_SUB_PREFIX}${RUN}_2`, student: SA.id, kind: 'wps', score: 35 },
    { id: `${TMP_SUB_PREFIX}${RUN}_3`, student: SA.id, kind: 'access', score: 20 },
  ];
  for (const r of rows) {
    await pool.query(
      `INSERT INTO wps_op_submissions (id, student_id, question_id, kind, source, file_path, score_obtained, full_score, graded_at)
       VALUES (?, ?, ?, ?, 'practice', NULL, ?, 10, NOW())`,
      [r.id, r.student, `tmp_qos_q_${r.kind}`, r.kind, r.score]
    );
    created.subIds.push(r.id);
  }
  console.log(`  已造临时提交 ${created.subIds.length} 条（A：WPS 40+35=75 / Access 20）`);

  // ══ A. 库结构 ═════════════════════════════════════════════════════════
  section('A. 库结构（迁移 103）');
  for (const t of ['tests', 'pk_battle_configs']) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM ${t}`);
    const names = cols.map((c) => c.Field);
    ok(`${t} 有 qualification_wps_op_score`, names.includes('qualification_wps_op_score'));
    ok(`${t} 有 qualification_access_op_score`, names.includes('qualification_access_op_score'));
    const wc = cols.find((c) => c.Field === 'qualification_wps_op_score');
    ok(`${t}.qualification_wps_op_score 允许 NULL`, wc && wc.Null === 'YES', `Null=${wc?.Null}`);
  }
  const [migRows] = await pool.query(
    "SELECT COUNT(*) AS n FROM schema_migrations WHERE version LIKE '103%'"
  ).catch(() => [[{ n: '?' }]]);
  console.log(`  （迁移表记录：103 -> ${migRows[0]?.n}）`);

  // ══ B. 口径一致性（成就殿堂 == SQL == 接口 current）════════════════════
  section('B. 口径一致性（成就殿堂 · 累计操作题得分）');
  const hallWps = await metrics.getProgress(pool, 'total_op_score', SA.id, { kind: 'wps' });
  const hallAcc = await metrics.getProgress(pool, 'total_op_score', SA.id, { kind: 'access' });
  const hallAll = await metrics.getProgress(pool, 'total_op_score', SA.id, {});
  const sqlWps = await sqlOpScore(SA.id, 'wps');
  const sqlAcc = await sqlOpScore(SA.id, 'access');
  console.log(`  成就殿堂：WPS=${hallWps.value} Access=${hallAcc.value} 合计=${hallAll.value} ｜ SQL：WPS=${sqlWps} Access=${sqlAcc}`);
  ok('成就殿堂 WPS 分 == 直接 SQL', hallWps.value === sqlWps, `${hallWps.value} vs ${sqlWps}`);
  ok('成就殿堂 Access 分 == 直接 SQL', hallAcc.value === sqlAcc, `${hallAcc.value} vs ${sqlAcc}`);
  ok('留空 = 两者合计', hallAll.value === sqlWps + sqlAcc, `${hallAll.value} vs ${sqlWps + sqlAcc}`);
  ok('造数生效（WPS=75 / Access=20）', sqlWps === 75 && sqlAcc === 20, `实际 ${sqlWps}/${sqlAcc}`);

  // ══ 建临时测试（走教师端真实写接口）══════════════════════════════════
  const teacher = await login('teacher', 'xgpy666');
  if (!teacher) throw new Error('教师登录失败（teacher/xgpy666）');
  const teacherToken = teacher.token;

  const mkTest = async (id, title, wps, acc) => {
    const r = await httpJson('POST', '/api/tables/tests', {
      id,
      title,
      type: 'test',
      created_by: teacher.id,
      is_active: true,
      question_count: 5,
      time_limit: 10,
      points_reward: 0,
      passing_score: 60,
      class_ids: null,
      qualification_correct_count: 0,
      qualification_wps_op_score: wps,
      qualification_access_op_score: acc,
    }, teacherToken);
    if (r.status === 200 && r.json?.data?.[0]?.id === id) created.testIds.push(id);
    return r;
  };

  section('E1. 教师端写入往返（/api/tables/tests，UI 保存走的就是这条链路）');
  const w1 = await mkTest(TMP_TEST_OK, `tmp资格验证-通过 ${RUN}`, 70, 15);
  const w2 = await mkTest(TMP_TEST_NO, `tmp资格验证-不足 ${RUN}`, 100, 0);
  const w3 = await mkTest(TMP_TEST_ZERO, `tmp资格验证-无要求 ${RUN}`, 0, 0);
  ok('新建测试①（WPS70/Access15）返回 200', w1.status === 200, `status=${w1.status}`);
  ok('新建测试②（WPS100）返回 200', w2.status === 200, `status=${w2.status}`);
  ok('新建测试③（全 0）返回 200', w3.status === 200, `status=${w3.status}`);

  const [tRows] = await pool.query(
    'SELECT id, qualification_wps_op_score, qualification_access_op_score FROM tests WHERE id IN (?)',
    [[TMP_TEST_OK, TMP_TEST_NO, TMP_TEST_ZERO]]
  );
  const tMap = Object.fromEntries(tRows.map((r) => [r.id, r]));
  ok('测试① 两列落库正确',
    Number(tMap[TMP_TEST_OK]?.qualification_wps_op_score) === 70
    && Number(tMap[TMP_TEST_OK]?.qualification_access_op_score) === 15,
    JSON.stringify(tMap[TMP_TEST_OK]));
  ok('测试② WPS=100 落库', Number(tMap[TMP_TEST_NO]?.qualification_wps_op_score) === 100);
  ok('测试③ 全 0 落库', Number(tMap[TMP_TEST_ZERO]?.qualification_wps_op_score) === 0
    && Number(tMap[TMP_TEST_ZERO]?.qualification_access_op_score) === 0);

  // ══ C. 学生端资格接口 ═════════════════════════════════════════════════
  section('C. 学生端资格接口（单题 / 批量）');
  const loginA = await login('a', '111111');
  const loginB = await login('b', '111111');
  if (!loginA || !loginB) throw new Error('学生 a/b 登录失败（111111）');
  const TA = loginA.token;
  const TB = loginB.token;

  const qOK = await httpJson('GET', `/api/student/qualification/test/${TMP_TEST_OK}`, undefined, TA);
  if (qOK.status !== 200) console.log(`    [诊断] 单题接口返回 ${qOK.status}: ${String(qOK.text).slice(0, 300)}`);
  const dOK = qOK.json?.data;
  ok('接口① 返回 200', qOK.status === 200, `status=${qOK.status}`);
  ok('接口① 含 wps_op 明细', !!dOK?.wps_op, JSON.stringify(dOK?.wps_op));
  ok('接口① wps_op 达标（75>=70）',
    dOK?.wps_op?.enabled === true && dOK.wps_op.required === 70
    && dOK.wps_op.current === 75 && dOK.wps_op.passed === true, JSON.stringify(dOK?.wps_op));
  ok('接口① access_op 达标（20>=15）',
    dOK?.access_op?.enabled === true && dOK.access_op.required === 15
    && dOK.access_op.current === 20 && dOK.access_op.passed === true, JSON.stringify(dOK?.access_op));
  ok('接口① current 与直接 SQL / 成就殿堂一致', dOK?.wps_op?.current === sqlWps && dOK?.access_op?.current === sqlAcc);
  ok('接口① 总判定 passed=true', dOK?.passed === true);

  const qNO = await httpJson('GET', `/api/student/qualification/test/${TMP_TEST_NO}`, undefined, TA);
  const dNO = qNO.json?.data;
  ok('接口② wps_op 不达标（75<100）',
    dNO?.wps_op?.enabled === true && dNO.wps_op.required === 100
    && dNO.wps_op.current === 75 && dNO.wps_op.passed === false, JSON.stringify(dNO?.wps_op));
  ok('接口② access_op 未启用（阈值为 0）', dNO?.access_op?.enabled === false, JSON.stringify(dNO?.access_op));
  ok('接口② 总判定 passed=false', dNO?.passed === false);

  const qZero = await httpJson('GET', `/api/student/qualification/test/${TMP_TEST_ZERO}`, undefined, TA);
  const dZero = qZero.json?.data;
  ok('接口③ 四项全未启用', dZero?.correct?.enabled === false && dZero?.mastered?.enabled === false
    && dZero?.wps_op?.enabled === false && dZero?.access_op?.enabled === false);
  ok('接口③ 未启用时 passed=true（不拦人）', dZero?.passed === true);

  const qB = await httpJson('GET', `/api/student/qualification/test/${TMP_TEST_OK}`, undefined, TB);
  const dB = qB.json?.data;
  ok('学生B（无操作题记录）wps_op.current=0', dB?.wps_op?.current === 0, JSON.stringify(dB?.wps_op));
  ok('学生B 因 WPS 未达标而整体不通过', dB?.passed === false);

  const qBatch = await httpJson('POST', '/api/student/qualification/tests',
    { test_ids: [TMP_TEST_OK, TMP_TEST_NO, TMP_TEST_ZERO] }, TA);
  const mapB = qBatch.json?.data || {};
  ok('批量接口返回 3 条', Object.keys(mapB).length === 3, `keys=${Object.keys(mapB).length}`);
  ok('批量接口每条都带 wps_op / access_op',
    Object.values(mapB).every((d) => d.wps_op && d.access_op));
  ok('批量接口判定与单题一致',
    mapB[TMP_TEST_OK]?.passed === true && mapB[TMP_TEST_NO]?.passed === false
    && mapB[TMP_TEST_ZERO]?.passed === true);

  // ══ D. PK 侧判定（直调 handler 的真实导出）════════════════════════════
  section('D. PK 侧 checkQualification（pk-socket/handler.js）');
  ok('handler 导出了 checkQualification / loadQualificationConfig',
    typeof pk.checkQualification === 'function' && typeof pk.loadQualificationConfig === 'function');

  const pkCfg = { qualification_wps_op_score: 70, qualification_access_op_score: 15 };
  const pkOK = await pk.checkQualification(pool, SA.id, pkCfg);
  ok('PK：WPS70+Access15 → ok=true', pkOK.ok === true, JSON.stringify(pkOK).slice(0, 160));

  const pkNO = await pk.checkQualification(pool, SA.id, {
    qualification_wps_op_score: 100, qualification_access_op_score: 40,
  });
  ok('PK：WPS100+Access40 两项都不达标', pkNO.ok === false, JSON.stringify(pkNO).slice(0, 160));
  ok('PK：message 点名两个缺口并带当前值',
    typeof pkNO.message === 'string'
    && pkNO.message.includes('WPS操作题累计得 100 分（当前 75 分）')
    && pkNO.message.includes('Access操作题累计得 40 分（当前 20 分）'),
    pkNO.message);
  ok('PK：parts 结构化输出 2 条', Array.isArray(pkNO.parts) && pkNO.parts.length === 2, JSON.stringify(pkNO.parts));

  // 单项不达标时 message 只点名那一项
  const pkOne = await pk.checkQualification(pool, SA.id, { qualification_wps_op_score: 70, qualification_access_op_score: 40 });
  ok('PK：仅 Access 不达标时只点名 Access',
    pkOne.ok === false && pkOne.parts.length === 1 && /^Access操作题累计得 40 分（当前 20 分）$/.test(pkOne.parts[0]),
    JSON.stringify(pkOne.parts));

  const pkNone = await pk.checkQualification(pool, SA.id, {});
  ok('PK：配置为空 → 直接放行（不再查库）', pkNone.ok === true);

  const pkB = await pk.checkQualification(pool, SB.id, { qualification_wps_op_score: 1 });
  ok('PK：学生B（0 分）wps 1 分也不达标', pkB.ok === false && pkB.wpsScore === 0, JSON.stringify(pkB).slice(0, 140));

  // 通过 id 加载配置（真实链路：pk:match_start 用的就是它）
  const pkCreate = await httpJson('POST', '/api/pk/battle-configs', {
    name: TMP_PK_NAME,
    mode: 'timed',
    duration_seconds: 180,
    question_count: 10,
    is_active: true,
    daily_limit: 99,
    qualification_correct_count: 0,
    qualification_wps_op_score: 70,
    qualification_access_op_score: 15,
  }, teacherToken);
  ok('E2. 教师端新建 PK 配置返回 200', pkCreate.status === 200, `status=${pkCreate.status}`);
  const pkId = pkCreate.json?.data?.id;
  if (pkId) created.pkIds.push(pkId);

  if (pkId) {
    const [cfgRows] = await pool.query(
      'SELECT qualification_wps_op_score, qualification_access_op_score FROM pk_battle_configs WHERE id = ?', [pkId]);
    ok('PK 配置两列落库正确',
      Number(cfgRows[0]?.qualification_wps_op_score) === 70
      && Number(cfgRows[0]?.qualification_access_op_score) === 15, JSON.stringify(cfgRows[0]));

    const loaded = await pk.loadQualificationConfig(pool, pkId);
    ok('loadQualificationConfig 带出两个新列',
      Number(loaded?.qualification_wps_op_score) === 70
      && Number(loaded?.qualification_access_op_score) === 15, JSON.stringify(loaded));

    const pkFromDb = await pk.checkQualification(pool, SA.id, loaded);
    ok('PK：由库加载的配置判定 ok=true', pkFromDb.ok === true, JSON.stringify(pkFromDb).slice(0, 160));

    // 学生端 PK 资格接口
    const qPk = await httpJson('GET', `/api/student/qualification/pk/${pkId}`, undefined, TA);
    const dPk = qPk.json?.data;
    ok('学生端 PK 资格接口 200', qPk.status === 200, `status=${qPk.status}`);
    ok('PK 接口 wps_op 达标', dPk?.wps_op?.passed === true && dPk.wps_op.current === 75, JSON.stringify(dPk?.wps_op));
    ok('PK 接口 access_op 达标', dPk?.access_op?.passed === true && dPk.access_op.current === 20, JSON.stringify(dPk?.access_op));
    ok('PK 接口总判定 passed=true', dPk?.passed === true);

    // 学生端可见配置列表（PKLobby 用的接口）必须带出新字段
    const act = await httpJson('GET', '/api/pk/battle-configs/active', undefined, TA);
    const found = (act.json?.data || []).find((c) => c.id === pkId);
    ok('学生端 battle-configs/active 带出两个新字段',
      !!found && Number(found.qualification_wps_op_score) === 70
      && Number(found.qualification_access_op_score) === 15, JSON.stringify(found || {}).slice(0, 180));

    // 更新链路：改成 WPS 100 → 应变成不达标
    const upd = await httpJson('PUT', `/api/pk/battle-configs/${pkId}`, {
      name: TMP_PK_NAME,
      mode: 'timed',
      duration_seconds: 180,
      question_count: 10,
      is_active: true,
      daily_limit: 99,
      qualification_correct_count: 0,
      qualification_wps_op_score: 100,
      qualification_access_op_score: 15,
    }, teacherToken);
    ok('E3. PK 配置更新返回 200', upd.status === 200, `status=${upd.status}`);
    const [cfg2] = await pool.query(
      'SELECT qualification_wps_op_score FROM pk_battle_configs WHERE id = ?', [pkId]);
    ok('PK 配置更新后 WPS 阈值=100', Number(cfg2[0]?.qualification_wps_op_score) === 100);
  }

  // ══ F. 学生端界面 ═════════════════════════════════════════════════════
  section('F. 学生端界面（真机无头浏览器）');
  let cdp = null;
  try {
    const { launchHeadless, sleep } = require('./lib/cdp.cjs');
    cdp = await launchHeadless({ windowSize: '1440,960', userDataDir: '.tmp-chrome-qos-' + RUN });
    const b = cdp;

    // 登录（覆盖 a 的会话）
    await b.evalJs('(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return true; })()');
    await b.ws.send('Page.navigate', { url: PAGE });
    let formReady = false;
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      formReady = await b.evalJs(`!!Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.includes('用户名'))`);
      if (formReady === true) break;
    }
    ok('登录页就绪', formReady === true);

    await b.evalJs(`(() => {
      function setVal(el, v){
        const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
        d.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const inputs = Array.from(document.querySelectorAll('input'));
      const u = inputs.find(i => i.placeholder && i.placeholder.includes('用户名'));
      const p = inputs.find(i => i.type === 'password');
      setVal(u, 'a'); setVal(p, '111111');
      u.closest('form').requestSubmit();
      return 'ok';
    })()`);
    let logged = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      logged = await b.evalJs(`(document.body.innerText || '').includes('退出登录')`);
      if (logged === true) break;
    }
    ok('学生 a 登录成功', logged === true);

    // 关掉可能弹出的提示，打开「测试」
    await b.evalJs('(() => { window.alert = (m) => { window.__lastAlert = m; }; window.confirm = () => true; return true; })()');
    await b.evalJs(`(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      const n = Array.from(document.querySelectorAll('div,button')).find(x => norm(x.textContent) === '测试');
      if (n) n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return !!n;
    })()`);
    await sleep(3500);

    const pageText = await b.evalJs('(document.body.innerText || "")');
    ok('测试模块已打开', /测试列表|测试/.test(pageText));
    ok('卡片① 展示 WPS 要求且已达标',
      pageText.includes('需WPS操作题累计得 70 分') && pageText.includes('✓ 已达标'),
      pageText.includes('需WPS操作题累计得 70 分') ? '' : '未找到「需WPS操作题累计得 70 分」');
    ok('卡片① 展示 Access 要求', pageText.includes('需Access操作题累计得 15 分'));
    ok('卡片② 展示未达标进度（当前 75 分）', pageText.includes('需WPS操作题累计得 100 分')
      && pageText.includes('（当前 75 分）'));

    // 按钮状态：达标卡可点，未达标卡禁用且文案为「资格不足」
    const btnState = await b.evalJs(`(() => {
      const pick = (title) => {
        const cards = Array.from(document.querySelectorAll('div')).filter(d => (d.textContent || '').includes(title) && d.querySelector('button'));
        if (!cards.length) return null;
        cards.sort((a, c) => a.textContent.length - c.textContent.length);
        const btn = cards[0].querySelector('button');
        return btn ? { text: (btn.textContent || '').trim(), disabled: !!btn.disabled } : null;
      };
      return {
        okCard: pick(${JSON.stringify(`tmp资格验证-通过 ${RUN}`)}),
        noCard: pick(${JSON.stringify(`tmp资格验证-不足 ${RUN}`)}),
        zeroCard: pick(${JSON.stringify(`tmp资格验证-无要求 ${RUN}`)}),
      };
    })()`);
    console.log('    按钮状态: ' + JSON.stringify(btnState));
    ok('达标卡按钮可点、文案「开始测试」',
      btnState?.okCard?.disabled === false && /开始测试/.test(btnState.okCard.text), JSON.stringify(btnState?.okCard));
    ok('未达标卡按钮禁用、文案「资格不足」',
      btnState?.noCard?.disabled === true && /资格不足/.test(btnState.noCard.text), JSON.stringify(btnState?.noCard));
    ok('无要求卡按钮可点', btnState?.zeroCard?.disabled === false, JSON.stringify(btnState?.zeroCard));

    // 前端 startTest 的兜底 alert 文案必须点名新条件（点不到禁用按钮，故做源码级接线检查）
    const feSrc = require('fs').readFileSync(
      path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'components', 'student', 'TestModule.tsx'), 'utf8');
    ok('TestModule.startTest 兜底提示含 WPS/Access 缺口',
      /qualCheck\.wps_op\?\.enabled && !qualCheck\.wps_op\.passed/.test(feSrc)
      && /qualCheck\.access_op\?\.enabled && !qualCheck\.access_op\.passed/.test(feSrc)
      && /WPS操作题累计得 \$\{qualCheck\.wps_op\.required\} 分/.test(feSrc));

    // 截图留档：学生看到的卡片（含 WPS / Access 两条要求）
    try {
      const rect = await b.evalJs(`(() => {
        const title = ${JSON.stringify(`tmp资格验证-通过 ${RUN}`)};
        const cards = Array.from(document.querySelectorAll('div')).filter(d => (d.textContent || '').includes(title) && d.querySelector('button'));
        if (!cards.length) return null;
        cards.sort((a, c) => a.textContent.length - c.textContent.length);
        const r = cards[0].getBoundingClientRect();
        return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.width + 20, height: r.height + 20 };
      })()`);
      if (rect && rect.width > 50 && rect.height > 50) {
        const shot = await b.ws.send('Page.captureScreenshot', {
          format: 'png',
          clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 },
        });
        const out = path.join(__dirname, '..', '..', '..', '.workbuddy', 'qualification_op_score_preview.png');
        fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
        console.log('    📷 截图已保存: ' + out);
      } else {
        console.log('    (卡片区域未取到，跳过截图)');
      }
    } catch (e) { console.log('    (截图失败: ' + e.message + ')'); }
  } catch (e) {
    ok('F 段（界面）执行未抛异常', false, e.message);
  } finally {
    if (cdp && typeof cdp.close === 'function') { try { await cdp.close(); } catch { /* ignore */ } }
  }

  // ══ G. 清理 ═══════════════════════════════════════════════════════════
  section('G. 清理与「不留痕」断言');
  await cleanup();
  created.subIds = []; created.testIds = []; created.pkIds = [];

  const [r1] = await pool.query("SELECT COUNT(*) n FROM wps_op_submissions WHERE id LIKE 'tmp_qos_%'");
  const [r2] = await pool.query("SELECT COUNT(*) n FROM tests WHERE id LIKE 'tmp_qos_%'");
  const [r3] = await pool.query('SELECT COUNT(*) n FROM pk_battle_configs WHERE name LIKE "__tmp_qos_%"');
  ok('wps_op_submissions 无 tmp_qos 残留', Number(r1[0].n) === 0, `残留=${r1[0].n}`);
  ok('tests 无 tmp_qos 残留', Number(r2[0].n) === 0, `残留=${r2[0].n}`);
  ok('pk_battle_configs 无 __tmp_qos 残留', Number(r3[0].n) === 0, `残留=${r3[0].n}`);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  通过 ${pass} / ${pass + fail}`);
  if (fail > 0) {
    console.log(`  ✗ 失败 ${fail} 项：`);
    failures.forEach((f) => console.log('     - ' + f));
  } else {
    console.log('  ✓ 全部通过');
  }
  console.log(`${'═'.repeat(60)}\n`);
  return fail > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    try { await cleanup(); } catch { /* ignore */ }
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(code);
  })
  .catch(async (e) => {
    console.error('\n脚本异常：', e);
    try { await cleanup(); } catch { /* ignore */ }
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(1);
  });
