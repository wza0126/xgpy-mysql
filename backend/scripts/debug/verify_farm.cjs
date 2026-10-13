#!/usr/bin/env node
/**
 * 代码农场 · 端到端验证
 * ============================================================
 * 覆盖：
 *   A. 教师端配置读写（开关 / 班级范围）
 *   B. 学生端 state：未开启不返回数据；开启后初始化地块、返回世界与作物
 *   C. ⛔ 劳作计费口径：按「动作单位」计，不按提交次数
 *   D. ★ 一天一茬：精准写法（水 5 份 + 肥 5 份 + 播种 + 收获 = 12 次）能收
 *   D2. ★ 猛灌 / 盲写循环 收不了（激励方向对不对）
 *   D3. ★ 除草：单次值钱（+24 = 1.5 次浇水），但撑不起一整块地
 *   E. 收获发积分（原子写 + point_transactions source_type='farm'）
 *   F. 班级范围排除（不命中班级 → enabled:false, reason=out_of_scope）
 *   G. 鉴权：学生不得访问教师端接口
 *   H. 参数夹取（防误填）
 *   I. 教师端总览 / 劳作日志
 *   H2. 不留痕断言
 *
 * ⛔ 不污染数据库（铁律）：
 *   · 只对单个测试学生发放/劳作；配置先快照后还原；
 *   · 测试产生的地块 / 日志 / 积分流水在 finally 全量清理，
 *     current_points 与 total_points_earned 都要回滚（只回滚前者会永久污染累计积分）；
 *   · 末尾「不留痕」断言。
 *
 * 用法：node scripts/debug/verify_farm.cjs
 */

'use strict';

const mysql = require('mysql2/promise');
const { snapshotFarmData, restoreFarmData } = require('./lib/farm-data.cjs');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', password: '122201', user: 'root', database: 'xgpy' };
const TEACHER = { u: 'teacher', p: 'xgpy666' };
const STUDENT = { u: 'a', p: '111111' };
const BUDGET = 15; // 本脚本使用的「每天劳作次数」（按动作计）

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

const num = (v) => Number(v) || 0;
const near = (a, b, eps = 0.01) => Math.abs(num(a) - b) < eps;

(async () => {
  const db = await mysql.createConnection(DB);
  let studentId = null;
  let studentClass = null;
  let teacherToken = null;
  let studentToken = null;
  let snapCfg = null;
  let snapPoints = 0;
  let snapEarned = 0; // ⛔ 累计获得积分也要快照：收获会让它 +10，不回滚就永久污染
  let snapFarm = null; // ⛔ 该学生的 地块 / 日志 / 农场流水 整份快照（跑完放回原样）

  // 把测试学生的地恢复成「空地 + 水50/肥50 + 今天没用过劳作」
  async function resetPlot() {
    await db.query(
      'UPDATE farm_plots SET crop = NULL, growth = 0, stage = 0, moisture = 50, nutrient = 50, ' +
        'ops_today = 0, total_harvest = 0, total_points = 0 WHERE student_id = ?',
      [studentId]
    );
  }

  async function cleanup() {
    if (!studentId) return;
    // ⛔ 不是「删干净」，而是「放回原样」：本脚本删掉的
    //    farm_plots / farm_logs / 农场积分流水必须整份还回去，
    //    否则每跑一次回归就吃掉一份真实试玩数据（详见 lib/farm-data.cjs）。
    await restoreFarmData(db, snapFarm);
    await db.query('UPDATE profiles SET current_points = ?, total_points_earned = ? WHERE id = ?',
      [snapPoints, snapEarned, studentId]);
    if (snapCfg) {
      await db.query(
        'UPDATE farm_config SET enabled=?, class_ids=?, day_minutes=?, base_yield=?, max_ops_per_day=?, ' +
          'weather=?, notice=?, default_code=?, start_at=?, updated_by=NULL WHERE id = 1',
        [
          snapCfg.enabled,
          snapCfg.class_ids,
          snapCfg.day_minutes,
          snapCfg.base_yield,
          snapCfg.max_ops_per_day,
          snapCfg.weather,
          snapCfg.notice,
          snapCfg.default_code,
          snapCfg.start_at,
        ]
      );
    }
  }

  try {
    // ---------- 准备 ----------
    teacherToken = await login(TEACHER.u, TEACHER.p);
    studentToken = await login(STUDENT.u, STUDENT.p);
    const [prows] = await db.query(
      'SELECT id, class_id, current_points, total_points_earned FROM profiles WHERE username = ? LIMIT 1', [STUDENT.u]);
    if (!prows.length) throw new Error('找不到测试学生 ' + STUDENT.u);
    studentId = prows[0].id;
    studentClass = prows[0].class_id;
    snapPoints = Number(prows[0].current_points) || 0;
    snapEarned = Number(prows[0].total_points_earned) || 0;

    const [crows] = await db.query('SELECT * FROM farm_config WHERE id = 1');
    snapCfg = crows[0] ? {
      enabled: crows[0].enabled,
      class_ids: crows[0].class_ids,
      day_minutes: crows[0].day_minutes,
      base_yield: crows[0].base_yield,
      max_ops_per_day: crows[0].max_ops_per_day,
      weather: crows[0].weather,
      notice: crows[0].notice,
      default_code: crows[0].default_code,
      start_at: crows[0].start_at,
    } : null;

    console.log('测试学生 =', STUDENT.u, '/ 班级 =', studentClass, '/ 快照积分 =', snapPoints);

    // ⛔ 动手删之前先把这三张表整份快照下来（学生 a 同时也是老师试玩用的账号）
    snapFarm = await snapshotFarmData(db, studentId);
    console.log('已快照：plots=' + snapFarm.tables.farm_plots.length +
      ' logs=' + snapFarm.tables.farm_logs.length +
      ' 农场流水=' + snapFarm.tables.point_transactions.length);

    // 清掉历史残留，保证从干净状态开始
    await db.query('DELETE FROM farm_logs WHERE student_id = ?', [studentId]);
    await db.query('DELETE FROM farm_plots WHERE student_id = ?', [studentId]);

    // ---------- A. 未开启 ----------
    section('A. 未开启时');
    await req('/api/teacher/farm/config', {
      method: 'PUT',
      token: teacherToken,
      body: { enabled: false, class_ids: [], day_minutes: 10, base_yield: 10, max_ops_per_day: BUDGET, weather: 'sunny', notice: '' },
    });
    let r = await req('/api/student/farm/state', { token: studentToken });
    ok('学生 state 返回 enabled:false', r.status === 200 && r.body.data && r.body.data.enabled === false, JSON.stringify(r.body && r.body.data));
    ok('未开启时不下发地块数据', !(r.body.data && r.body.data.me));
    r = await req('/api/student/farm/run', { method: 'POST', token: studentToken, body: { ops: [{ op: 'water', n: 1 }], code: 'water(1)' } });
    ok('未开启时劳作被拒（403）', r.status === 403, 'status=' + r.status);

    // ---------- B. 开启（全校生效） ----------
    section('B. 教师开启 + 学生在范围内');
    r = await req('/api/teacher/farm/config', {
      method: 'PUT',
      token: teacherToken,
      body: { enabled: true, class_ids: [], day_minutes: 10, base_yield: 10, max_ops_per_day: BUDGET, weather: 'sunny', notice: '欢迎来到代码农场' },
    });
    ok('教师保存配置成功', r.status === 200 && r.body.data && r.body.data.ok === true, JSON.stringify(r.body));
    r = await req('/api/teacher/farm/config', { token: teacherToken });
    ok('配置回读：enabled=true / 公告已存', r.body.data.config.enabled === true && r.body.data.config.notice === '欢迎来到代码农场');
    ok('配置回读：null 表示全校生效', Array.isArray(r.body.data.config.class_ids) && r.body.data.config.class_ids.length === 0);
    ok('配置回读：含作物目录', Array.isArray(r.body.data.crops) && r.body.data.crops.length >= 3);
    ok('配置回读：含统计字段', r.body.data.stats && typeof r.body.data.stats.plots === 'number');
    ok('配置回读：劳作上限 = ' + BUDGET, num(r.body.data.config.max_ops_per_day) === BUDGET, r.body.data.config.max_ops_per_day);

    // ⛔ 把世界时钟归零：否则 start_at 沿用环境里的旧值，新建地块会立刻被 tick 补算 N 天，
    //    nutrient 从 50 掉到很低（每天 -4），后续「施肥后养分上升」这类断言就会随机失败。
    await db.query('UPDATE farm_config SET start_at = NOW() WHERE id = 1');
    await db.query('DELETE FROM farm_plots WHERE student_id = ?', [studentId]);

    r = await req('/api/student/farm/state', { token: studentToken });
    ok('学生 state enabled:true', r.status === 200 && r.body.data.enabled === true);
    const world = (r.body.data || {}).world || {};
    ok('世界信息含天数/天气/进度', typeof world.day === 'number' && typeof world.weather_label === 'string' && typeof world.day_progress === 'number');
    ok('世界信息含作物目录', Array.isArray(world.crops) && world.crops.length >= 3);
    ok('世界信息含劳作上限', num(world.max_ops_per_day) === BUDGET, world.max_ops_per_day);
    ok('我的地块已初始化', !!r.body.data.me && typeof r.body.data.me.moisture === 'number');
    ok('劳作次数初始为满（' + BUDGET + '）', num(r.body.data.me.ops_left_today) === BUDGET, 'ops_left=' + r.body.data.me.ops_left_today);
    ok('同学列表含自己', Array.isArray(r.body.data.peers) && r.body.data.peers.some((p) => p.student_id === studentId));

    // ---------- B2. ★ 编辑器默认代码（教师可配） ----------
    section('B2. ★ 编辑器默认代码：教师可配，学生端下发');
    const MARKER = '# 老师留的题目\nplant("wheat")\nwater(10)\nfertilize(10)\nharvest()\n';
    r = await req('/api/teacher/farm/config', {
      method: 'PUT',
      token: teacherToken,
      body: {
        enabled: true, class_ids: [], day_minutes: 10, base_yield: 10,
        max_ops_per_day: BUDGET, weather: 'sunny', notice: '欢迎来到代码农场', default_code: MARKER,
      },
    });
    ok('教师保存 default_code 成功', r.status === 200 && r.body.data.ok === true, JSON.stringify(r.body));
    r = await req('/api/teacher/farm/config', { token: teacherToken });
    ok('★ 配置回读：default_code 原样返回', r.body.data.config.default_code === MARKER,
      JSON.stringify(r.body.data.config.default_code));
    r = await req('/api/student/farm/state', { token: studentToken });
    ok('★ 学生 state 的 world 里带上 default_code（编辑器据此初始化）',
      r.body.data.world.default_code === MARKER, JSON.stringify(r.body.data.world.default_code));

    // ⛔ 不带 default_code 的保存（老前端 / 只想改开关）必须**保留**原值，不能把老师配好的代码清空
    r = await req('/api/teacher/farm/config', {
      method: 'PUT',
      token: teacherToken,
      body: { enabled: true, class_ids: [], day_minutes: 10, base_yield: 10, max_ops_per_day: BUDGET, weather: 'sunny', notice: '欢迎来到代码农场' },
    });
    ok('不带 default_code 保存 → 状态码 200', r.status === 200);
    r = await req('/api/teacher/farm/config', { token: teacherToken });
    ok('★ 缺省字段保留原值（没被清空）', r.body.data.config.default_code === MARKER,
      JSON.stringify(r.body.data.config.default_code));

    // 显式传 null / 空串 = 改回内置示例
    r = await req('/api/teacher/farm/config', {
      method: 'PUT',
      token: teacherToken,
      body: { enabled: true, class_ids: [], day_minutes: 10, base_yield: 10, max_ops_per_day: BUDGET, weather: 'sunny', notice: '欢迎来到代码农场', default_code: null },
    });
    r = await req('/api/teacher/farm/config', { token: teacherToken });
    ok('显式传 null → 回读为空串（前端回退内置示例）', r.body.data.config.default_code === '',
      JSON.stringify(r.body.data.config.default_code));

    // 超长截断（MAX_DEFAULT_CODE = 4000）
    r = await req('/api/teacher/farm/config', {
      method: 'PUT',
      token: teacherToken,
      body: { enabled: true, class_ids: [], day_minutes: 10, base_yield: 10, max_ops_per_day: BUDGET, weather: 'sunny', default_code: 'x'.repeat(5000) },
    });
    ok('超长默认代码被接受（200）', r.status === 200);
    r = await req('/api/teacher/farm/config', { token: teacherToken });
    ok('★ 超长默认代码被截断到 4000 字', String(r.body.data.config.default_code).length === 4000,
      'len=' + String(r.body.data.config.default_code).length);

    // ---------- C. ⛔ 劳作计费口径 ----------
    section('C. ⛔ 劳作计费：按「动作单位」计（播种 1 / 除草 1 / 收获 1 / water(n)=n）');
    await resetPlot();
    r = await req('/api/student/farm/run', {
      method: 'POST',
      token: studentToken,
      body: { ops: [{ op: 'plant', crop: 'wheat' }, { op: 'water', n: 3 }], code: 'plant("wheat")\nwater(3)', prints: [] },
    });
    ok('run 返回 200', r.status === 200, JSON.stringify(r.body && r.body.error));
    const ev1 = ((r.body.data || {}).events || []).map((e) => e.text).join(' | ');
    ok('事件含「播下」', /播下/.test(ev1));
    ok('事件含「浇水」', /浇水/.test(ev1));
    ok('浇水事件写明花了 3 次劳作', /花 3 次劳作/.test(ev1), ev1.slice(0, 120));
    ok('结算后地块是小麦', r.body.data.me.crop === 'wheat' && r.body.data.me.stage === 1, JSON.stringify(r.body.data.me));
    ok('★ 播种 1 + 浇水 3 = 扣 4 次劳作', num(r.body.data.me.ops_left_today) === BUDGET - 4,
      'ops_left=' + r.body.data.me.ops_left_today + '（应 ' + (BUDGET - 4) + '）');
    ok('回传 labor_used = 4', num(r.body.data.labor_used) === 4, r.body.data.labor_used);

    r = await req('/api/student/farm/run', { method: 'POST', token: studentToken, body: { ops: [], code: '# 只看看', prints: ['debug'] } });
    ok('空 ops 不占劳作次数', r.status === 200 && num(r.body.data.me.ops_left_today) === BUDGET - 4,
      'ops_left=' + (r.body.data && r.body.data.me.ops_left_today));

    r = await req('/api/student/farm/run', { method: 'POST', token: studentToken, body: { ops: [{ op: 'harvest' }], code: 'harvest()' } });
    ok('未成熟收获无积分', r.status === 200 && num(r.body.data.points_gained) === 0,
      'status=' + r.status + ' gained=' + (r.body.data && r.body.data.points_gained));
    ok('失败的操作不占劳作次数', num(r.body.data.me.ops_left_today) === BUDGET - 4,
      'ops_left=' + (r.body.data && r.body.data.me.ops_left_today));

    // ⛔ 用「施肥前后差值」判断，不锁绝对阈值（会被 tick 的自然衰减影响）
    const [[nutBefore]] = await db.query('SELECT nutrient FROM farm_plots WHERE student_id = ?', [studentId]);
    r = await req('/api/student/farm/run', { method: 'POST', token: studentToken, body: { ops: [{ op: 'fertilize', n: 3 }], code: 'fertilize(3)' } });
    ok('★ 施肥 3 份 = 扣 3 次劳作', r.status === 200 && num(r.body.data.me.ops_left_today) === BUDGET - 7,
      'ops_left=' + (r.body.data && r.body.data.me.ops_left_today));
    ok('施肥让养分上升', num(r.body.data.me.nutrient) > num(nutBefore.nutrient),
      'nutrient ' + nutBefore.nutrient + ' → ' + (r.body.data && r.body.data.me.nutrient));

    r = await req('/api/student/farm/run', { method: 'POST', token: studentToken, body: { ops: [{ op: 'water', n: 2 }, { op: 'weed' }], code: 'water(2)\nweed()' } });
    ok('★ 一次提交里 浇水 2 份 + 除草 1 次 = 扣 3 次', num(r.body.data.me.ops_left_today) === BUDGET - 10,
      'ops_left=' + (r.body.data && r.body.data.me.ops_left_today));

    // 水已经满了，再浇 5 份：仍要扣 5 次劳作（但不会有任何成长）——这是「白花力气」的核心教学点
    const [[preFull]] = await db.query('SELECT moisture, growth FROM farm_plots WHERE student_id = ?', [studentId]);
    r = await req('/api/student/farm/run', { method: 'POST', token: studentToken, body: { ops: [{ op: 'water', n: 5 }], code: 'water(5)' } });
    ok('水已满时浇水仍扣 5 次劳作（白花力气）', num(r.body.data.me.ops_left_today) === BUDGET - 15,
      'ops_left=' + (r.body.data && r.body.data.me.ops_left_today));
    ok('水已满时浇水不产生成长', near(r.body.data.me.growth, num(preFull.growth)),
      preFull.growth + ' → ' + r.body.data.me.growth);
    ok('事件里提示「白花了力气」', /白花了力气/.test(((r.body.data || {}).events || []).map((e) => e.text).join(' | ')));

    r = await req('/api/student/farm/run', { method: 'POST', token: studentToken, body: { ops: [{ op: 'water', n: 1 }], code: 'water(1)' } });
    ok('次数用尽后再劳作被拒（429）', r.status === 429 && /用完/.test(String(r.body.error)), 'status=' + r.status + ' err=' + (r.body && r.body.error));

    // ---------- D. ★ 一天一茬：精准写法 ----------
    section('D. ★ 一天一茬：精准写法（播种 1 + 水 5 + 肥 5 + 收获 1 = 12 次劳作）');
    await resetPlot();
    const exactOps = [{ op: 'plant', crop: 'wheat' }];
    for (let i = 0; i < 5; i++) exactOps.push({ op: 'water', n: 1 });
    for (let i = 0; i < 5; i++) exactOps.push({ op: 'fertilize', n: 1 });
    exactOps.push({ op: 'harvest' });
    const [[pBefore]] = await db.query('SELECT current_points FROM profiles WHERE id = ?', [studentId]);
    r = await req('/api/student/farm/run', {
      method: 'POST',
      token: studentToken,
      body: {
        ops: exactOps,
        code: 'plant("wheat")\nwhile moisture() < 100:\n    water()\nwhile nutrient() < 100:\n    fertilize()\nharvest()',
      },
    });
    ok('12 条操作恰好扣 12 次劳作', num(r.body.data.labor_used) === 12, r.body.data.labor_used);
    ok('★ 成熟并收获 +10 积分', num(r.body.data.points_gained) === 10, 'gained=' + r.body.data.points_gained);
    ok('★ 地块已清空（收获成功）', r.body.data.me.crop === null && num(r.body.data.me.total_harvest) === 1,
      JSON.stringify(r.body.data.me));
    ok('★ 还剩下 ' + (BUDGET - 12) + ' 次劳作', num(r.body.data.me.ops_left_today) === BUDGET - 12,
      'ops_left=' + r.body.data.me.ops_left_today);
    const [[pAfter]] = await db.query('SELECT current_points FROM profiles WHERE id = ?', [studentId]);
    ok('积分实际到账 +10', num(pAfter.current_points) - num(pBefore.current_points) === 10,
      pBefore.current_points + ' → ' + pAfter.current_points);

    // ---------- D2. ★ 猛灌 / 盲写循环 收不了 ----------
    section('D2. ★ 粗暴写法收不了（激励方向检查）');
    await resetPlot();
    r = await req('/api/student/farm/run', {
      method: 'POST',
      token: studentToken,
      body: {
        ops: [{ op: 'plant', crop: 'wheat' }, { op: 'water', n: 10 }, { op: 'fertilize', n: 10 }, { op: 'harvest' }],
        code: 'plant("wheat")\nwater(10)\nfertilize(10)\nharvest()',
      },
    });
    ok('猛灌：扣 11 次劳作（水 10 + 播种 1）', num(r.body.data.labor_used) === 11, r.body.data.labor_used);
    ok('猛灌：施肥那条因只剩 4 次被挡下', num(r.body.data.ops_refused) === 1, r.body.data.ops_refused);
    ok('★ 猛灌：收不了、0 积分', num(r.body.data.points_gained) === 0, r.body.data.points_gained);
    ok('★ 猛灌：10 次劳作只买到 5 份的成长（33.6）', near(r.body.data.me.growth, 33.6), r.body.data.me.growth);

    await resetPlot();
    const blindOps = [{ op: 'plant', crop: 'wheat' }];
    for (let i = 0; i < 20; i++) blindOps.push({ op: 'water', n: 1 });
    r = await req('/api/student/farm/run', {
      method: 'POST',
      token: studentToken,
      body: { ops: blindOps, code: 'plant("wheat")\nfor i in range(20):\n    water()' },
    });
    ok('盲写循环：把预算耗光（15 次）', num(r.body.data.labor_used) === BUDGET, r.body.data.labor_used);
    ok('盲写循环：成长停在 33.6（水满了还浇）', near(r.body.data.me.growth, 33.6), r.body.data.me.growth);
    ok('★ 盲写循环：收不了、0 积分', num(r.body.data.points_gained) === 0, r.body.data.points_gained);
    ok('事件里提示「白花了力气」', /白花了力气/.test(((r.body.data || {}).events || []).map((e) => e.text).join(' | ')));

    // ---------- D3. ★ 除草不再是后门 ----------
    section('D3. ★ 除草：单次值钱，但撑不起一整块地');
    await resetPlot();
    const weedOps = [{ op: 'plant', crop: 'wheat' }];
    for (let i = 0; i < 50; i++) weedOps.push({ op: 'weed' });
    weedOps.push({ op: 'harvest' });
    r = await req('/api/student/farm/run', {
      method: 'POST',
      token: studentToken,
      body: { ops: weedOps, code: 'plant("wheat")\nfor i in range(50):\n    weed()\nharvest()' },
    });
    ok('提交 52 条操作返回 200', r.status === 200, 'status=' + r.status + ' err=' + (r.body && r.body.error));
    ok('除草用光 15 次劳作', num(r.body.data.labor_used) === BUDGET, r.body.data.labor_used);
    ok('其余 37 条被预算挡下', num(r.body.data.ops_refused) === 37, r.body.data.ops_refused);
    ok('★ 水肥 50/50 时 14 次除草共长 84（每次 +6，= 1.5 × 一次浇水 4）', near(r.body.data.me.growth, 84), r.body.data.me.growth);
    ok('★ 但 15 次劳作全除草仍收不了、0 积分', num(r.body.data.points_gained) === 0, r.body.data.points_gained);
    ok('地块仍是小麦、未被清空', r.body.data.me.crop === 'wheat', JSON.stringify(r.body.data.me));
    ok('事件里逐条汇报除草收益', /除草松土（花 1 次劳作）：成长/.test(((r.body.data || {}).events || []).map((e) => e.text).join(' | ')));
    {
      const [[wg]] = await db.query('SELECT growth, total_harvest FROM farm_plots WHERE student_id = ?', [studentId]);
      ok('库内成长 = 84（14 次除草 × 6）', near(wg.growth, 84), wg.growth);
      ok('库内收获次数未增加', num(wg.total_harvest) === 0, wg.total_harvest);
    }
    // 满水满肥时除草最值钱：24 = 1.5 次浇水
    await db.query('UPDATE farm_plots SET moisture = 100, nutrient = 100, growth = 0, ops_today = 0 WHERE student_id = ?', [studentId]);
    r = await req('/api/student/farm/run', { method: 'POST', token: studentToken, body: { ops: [{ op: 'weed' }], code: 'weed()' } });
    ok('★ 满水满肥时除草 +24（= LABOR_GROWTH × 1.5）', near(r.body.data.me.growth, 24), r.body.data.me.growth);
    ok('除草扣 1 次劳作', num(r.body.data.me.ops_left_today) === BUDGET - 1, r.body.data.me.ops_left_today);

    // 水肥极低时除草仍几乎没用（防止「除草绕开水肥」的回退）
    await db.query('UPDATE farm_plots SET moisture = 10, nutrient = 10, growth = 0, ops_today = 0 WHERE student_id = ?', [studentId]);
    r = await req('/api/student/farm/run', { method: 'POST', token: studentToken, body: { ops: [{ op: 'weed' }], code: 'weed()' } });
    ok('★ 水肥 10/10 时除草只 +0.24', near(r.body.data.me.growth, 0.24), r.body.data.me.growth);
    ok('水肥太低时提示「水肥不足」', /水肥不足/.test(((r.body.data || {}).events || []).map((e) => e.text).join(' | ')));

    // ---------- E. 收获发积分 ----------
    section('E. 成熟收获 → 积分入账');
    await resetPlot();
    await db.query('UPDATE farm_plots SET crop = "wheat", growth = 100, stage = 3, ops_today = 0 WHERE student_id = ?', [studentId]);
    const [[beforeP]] = await db.query('SELECT current_points FROM profiles WHERE id = ?', [studentId]);
    r = await req('/api/student/farm/run', { method: 'POST', token: studentToken, body: { ops: [{ op: 'harvest' }], code: 'harvest()' } });
    ok('收获成功且返回积分', r.status === 200 && num(r.body.data.points_gained) === 10, 'gained=' + (r.body.data && r.body.data.points_gained));
    ok('收获扣 1 次劳作', num(r.body.data.me.ops_left_today) === BUDGET - 1, r.body.data.me.ops_left_today);
    const [[afterP]] = await db.query('SELECT current_points FROM profiles WHERE id = ?', [studentId]);
    ok('积分实际到账 +10', num(afterP.current_points) - num(beforeP.current_points) === 10, beforeP.current_points + ' -> ' + afterP.current_points);
    const [txs] = await db.query("SELECT * FROM point_transactions WHERE student_id = ? AND source_type = 'farm' ORDER BY created_at DESC LIMIT 3", [studentId]);
    ok("写入 point_transactions(source_type='farm')", txs.length >= 1 && num(txs[0].amount) === 10, 'txs=' + txs.length);
    ok('积分流水原因含作物名', txs.length >= 1 && /小麦/.test(String(txs[0].reason)));
    ok('收获后地块清空', r.body.data.me.crop === null && num(r.body.data.me.total_harvest) >= 1);

    // ---------- F. 班级范围 ----------
    section('F. 班级范围');
    r = await req('/api/teacher/farm/config', {
      method: 'PUT',
      token: teacherToken,
      body: { enabled: true, class_ids: ['__nonexistent_class__'], day_minutes: 10, base_yield: 10, max_ops_per_day: BUDGET, weather: 'sunny' },
    });
    ok('保存到不存在的班级成功', r.status === 200);
    r = await req('/api/student/farm/state', { token: studentToken });
    ok('非命中班级 → enabled:false', r.body.data.enabled === false, JSON.stringify(r.body.data));
    ok('非命中班级 → reason=out_of_scope', r.body.data.reason === 'out_of_scope', 'reason=' + r.body.data.reason);

    // ---------- G. 鉴权 ----------
    section('G. 鉴权');
    r = await req('/api/teacher/farm/config', { token: studentToken });
    ok('学生访问教师接口被拒（403）', r.status === 403 || r.status === 401, 'status=' + r.status);
    r = await req('/api/student/farm/state');
    ok('未登录访问学生接口被拒（401）', r.status === 401, 'status=' + r.status);

    // ---------- H. 参数夹取 ----------
    section('H. 参数夹取（防误填）');
    r = await req('/api/teacher/farm/config', {
      method: 'PUT',
      token: teacherToken,
      body: { enabled: true, class_ids: [], day_minutes: 99999, base_yield: -5, max_ops_per_day: 9999, weather: 'not_a_weather' },
    });
    ok('越界配置被接受但夹取', r.status === 200);
    r = await req('/api/teacher/farm/config', { token: teacherToken });
    const c2 = r.body.data.config;
    ok('day_minutes 夹到 120', num(c2.day_minutes) === 120, 'v=' + c2.day_minutes);
    ok('base_yield 夹到 >=1', num(c2.base_yield) >= 1, 'v=' + c2.base_yield);
    ok('max_ops_per_day 夹到 200', num(c2.max_ops_per_day) === 200, 'v=' + c2.max_ops_per_day);
    ok('非法天气回退 sunny', c2.weather === 'sunny', 'v=' + c2.weather);

    // ---------- 教师端总览 ----------
    section('I. 教师端总览 / 劳作日志');
    r = await req('/api/teacher/farm/overview', { token: teacherToken });
    ok('总览返回列表', r.status === 200 && Array.isArray(r.body.data.list));
    ok('总览含测试学生地块', r.body.data.list.some((x) => x.student_id === studentId));
    r = await req('/api/teacher/farm/logs?limit=10', { token: teacherToken });
    ok('日志接口可读', r.status === 200 && Array.isArray(r.body.data.list));
    ok('日志含本次提交的代码', r.body.data.list.some((x) => x.student_id === studentId && /water|plant|harvest/.test(String(x.code))));
    {
      const withSummary = r.body.data.list.find((x) => x.student_id === studentId && x.summary);
      let laborLogged = false;
      try {
        const s = typeof withSummary.summary === 'string' ? JSON.parse(withSummary.summary) : withSummary.summary;
        laborLogged = typeof s.labor === 'number';
      } catch (_) { laborLogged = false; }
      ok('日志摘要里记了 labor（消耗的劳作次数）', laborLogged);
    }
  } finally {
    await cleanup();

    section('H2. 不留痕断言（还原成跑测试前的样子）');
    const snapCounts = {
      plots: (snapFarm && snapFarm.tables.farm_plots.length) || 0,
      logs: (snapFarm && snapFarm.tables.farm_logs.length) || 0,
      txs: (snapFarm && snapFarm.tables.point_transactions.length) || 0,
    };
    const [[c1]] = await db.query('SELECT COUNT(*) AS c FROM farm_plots WHERE student_id = ?', [studentId]);
    ok('★ farm_plots 已还原（是「放回原样」，不是「删干净」）', Number(c1.c) === snapCounts.plots,
      c1.c + ' vs 快照 ' + snapCounts.plots);
    const [[c2]] = await db.query('SELECT COUNT(*) AS c FROM farm_logs WHERE student_id = ?', [studentId]);
    ok('★ farm_logs 已还原（真实试玩日志不会被回归吃掉）', Number(c2.c) === snapCounts.logs,
      c2.c + ' vs 快照 ' + snapCounts.logs);
    const [[c3]] = await db.query("SELECT COUNT(*) AS c FROM point_transactions WHERE student_id = ? AND source_type = 'farm'", [studentId]);
    ok('★ 农场积分流水已还原', Number(c3.c) === snapCounts.txs, c3.c + ' vs 快照 ' + snapCounts.txs);
    const [[c4]] = await db.query('SELECT current_points, total_points_earned FROM profiles WHERE id = ?', [studentId]);
    ok('学生积分已还原', Number(c4.current_points) === snapPoints, c4.current_points + ' vs ' + snapPoints);
    ok('★ 学生累计获得积分已还原', Number(c4.total_points_earned) === snapEarned,
      c4.total_points_earned + ' vs ' + snapEarned);
    // ⛔ 不要锁死「enabled 必须是 0」——开关是教师可改的内容，断言只要求「回到跑测试前的样子」
    const [[c5]] = await db.query(
      'SELECT enabled, day_minutes, base_yield, max_ops_per_day, weather, notice, default_code, start_at FROM farm_config WHERE id = 1');
    const cfgSame = snapCfg
      ? Number(c5.enabled) === Number(snapCfg.enabled) &&
        Number(c5.day_minutes) === Number(snapCfg.day_minutes) &&
        Number(c5.base_yield) === Number(snapCfg.base_yield) &&
        Number(c5.max_ops_per_day) === Number(snapCfg.max_ops_per_day) &&
        String(c5.weather) === String(snapCfg.weather) &&
        String(c5.default_code == null ? '' : c5.default_code) ===
          String(snapCfg.default_code == null ? '' : snapCfg.default_code)
      : true;
    ok('配置已还原（与快照一致）', cfgSame,
      'enabled=' + c5.enabled + ' vs 快照 ' + (snapCfg && snapCfg.enabled) +
      ' | max_ops_per_day=' + c5.max_ops_per_day + ' vs ' + (snapCfg && snapCfg.max_ops_per_day) +
      ' | default_code 长度=' + String(c5.default_code || '').length + ' vs ' +
      String((snapCfg && snapCfg.default_code) || '').length);

    await db.end();

    console.log('\n========================================');
    console.log('通过 ' + pass + ' / 失败 ' + fail);
    console.log('========================================');
    process.exit(fail === 0 ? 0 : 1);
  }
})();
