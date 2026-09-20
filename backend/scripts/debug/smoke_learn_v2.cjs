#!/usr/bin/env node
/**
 * 第二次改造冒烟测试：
 *   A. 学习模块章节目录 / 讲义正文 / 讲义 CSS
 *   B. 勤学好问 Buff 新规则（当天 AI 答疑成功次数驱动）
 *
 * 用法（沙箱内，需后端已在 3101 运行）：
 *   node scripts/debug/smoke_learn_v2.cjs
 */
const path = require('path');
process.chdir(path.resolve(__dirname, '..', '..'));
const mysql = require('mysql2/promise');

const BASE = 'http://127.0.0.1:3101';
const {CHAPTER_NAMES} = require('../../src/chapter-taxonomy');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/secure-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, deviceInfo: 'smoke-learn-v2' }),
  });
  const j = await r.json();
  if (!j?.data?.session?.access_token) throw new Error(`登录失败 ${username}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.data.session.access_token;
}

async function api(token, method, url, body) {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

(async () => {
  const pool = await mysql.createPool({
    host: '127.0.0.1', port: 3306, user: 'root', password: '122201',
    database: 'xgpy', connectionLimit: 4,
  });

  let token;
  try {
    // 找一个学生账号
    const [stuRows] = await pool.query(
      "SELECT username FROM profiles WHERE role='student' ORDER BY created_at LIMIT 1"
    );
    const stuName = stuRows[0]?.username;
    if (!stuName) throw new Error('库中没有学生账号');
    console.log(`使用学生账号: ${stuName}`);

    // 学生初始密码在种子数据里是 meoo.local，实际库中可能已改；用管理员重置成临时密码
    const tmpPwd = 'SmokeLearn!2026';
    await pool.query("UPDATE profiles SET password_hash=SHA2(?,256) WHERE username=?", [tmpPwd, stuName]);
    token = await login(stuName, tmpPwd);

    // ---------- A. 学习模块 ----------
    section('A1 章节目录 /api/student/learn-chapters');
    const list = await api(token, 'GET', '/api/student/learn-chapters');
    ok(list.status === 200, `HTTP 200（实际 ${list.status}）`);
    const chapters = list.json?.data?.chapters || [];
    ok(chapters.length === 16, `返回 16 章（实际 ${chapters.length}）`);
    ok(chapters.every(c => CHAPTER_NAMES.includes(c.cluster_id)), '所有章名都在词表内');
    ok(chapters.every(c => c.has_lecture), '16 章都有讲义');
    ok(chapters.every(c => typeof c.question_count === 'number'), '每章都有题量');
    const totalQ = chapters.reduce((s, c) => s + c.question_count, 0);
    ok(totalQ > 1000, `题库总题量合理（${totalQ}）`);
    // 章级兜底题统计
    const withSelf = chapters.filter(c => c.chapter_only_count > 0);
    console.log(`    章级兜底题的章：${withSelf.map(c => `${c.cluster_id}(${c.chapter_only_count})`).join('、') || '无'}`);
    // 小节合计
    const secSum = chapters.reduce((s, c) => s + c.sections.reduce((a, x) => a + x.question_count, 0), 0);
    ok(totalQ - secSum === withSelf.reduce((a, c) => a + c.chapter_only_count, 0),
      '「章题量 - 小节题量之和 = 章级兜底题」自洽');

    section('A2 章节讲义 /api/student/learn-chapter/:id');
    const first = chapters[0].cluster_id;
    const detail = await api(token, 'GET', `/api/student/learn-chapter/${encodeURIComponent(first)}`);
    ok(detail.status === 200, `HTTP 200（实际 ${detail.status}）`);
    ok(!!detail.json?.data?.html, '返回 html 正文');
    ok(detail.json.data.html.includes('xs-lecture'), '正文外层带 .xs-lecture 作用域类');
    ok(detail.json.data.html.includes('class="def"') || detail.json.data.html.includes('class="warn"'),
      '保留了定义框/易错框样式元素');
    ok(Array.isArray(detail.json.data.sections), '返回小节列表');
    // 越界章
    const bad = await api(token, 'GET', '/api/student/learn-chapter/%E4%B8%8D%E5%AD%98%E5%9C%A8%E7%9A%84%E7%AB%A0');
    ok(bad.status === 404, `不存在的章返回 404（实际 ${bad.status}）`);

    section('A3 讲义样式 /api/student/learn-lecture.css');
    const cssRes = await fetch(`${BASE}/api/student/learn-lecture.css`);
    const css = await cssRes.text();
    ok(cssRes.status === 200, `HTTP 200（实际 ${cssRes.status}）`);
    ok(cssRes.headers.get('content-type')?.includes('text/css'), 'Content-Type 为 text/css');
    ok(css.includes('.xs-lecture'), '样式已作用域到 .xs-lecture');
    ok(!/(^|\n)\s*body\s*\{/.test(css), '不含全局 body 规则（无污染）');
    ok(!/(^|\n)\s*p\s*\{/.test(css), '不含全局 p 规则（无污染）');
    ok(!/(^|\n)\s*table\s*\{/.test(css), '不含全局 table 规则（无污染）');

    // ---------- B. 勤学好问 ----------
    section('B1 勤学好问配置项');
    const [cfgRows] = await pool.query(
      "SELECT value FROM system_config WHERE config_key='honor_studious_questions'"
    );
    ok(cfgRows.length === 1, 'honor_studious_questions 配置项已存在');

    section('B2 checkin 阈值来自配置（默认 10）');
    // 清掉今日 checkin，保证可重复跑
    const [stuIdRows] = await pool.query('SELECT id FROM profiles WHERE username=?', [stuName]);
    const stuId = stuIdRows[0].id;
    await pool.query('DELETE FROM studious_checkins WHERE student_id=? AND check_date=CURDATE()', [stuId]);

    const ck = await api(token, 'POST', '/api/student/learn-studious-checkin', {});
    ok(ck.status === 200, `HTTP 200（实际 ${ck.status}）`);
    ok(typeof ck.json?.data?.threshold === 'number', `返回 threshold（${ck.json?.data?.threshold}）`);
    ok(ck.json?.data?.threshold === 10, 'threshold 默认为 10');
    ok(typeof ck.json?.data?.today_count === 'number', `返回 today_count（${ck.json?.data?.today_count}）`);
    ok(typeof ck.json?.data?.remaining === 'number', '返回 remaining');

    section('B3 判定依据是 AI 答疑次数（不再是看题数）');
    // 造 10 条今日 ai_qa_history
    const madeIds = [];
    for (let i = 0; i < 10; i++) {
      const id = `smoke_qa_${Date.now()}_${i}`;
      madeIds.push(id);
      await pool.query(
        "INSERT INTO ai_qa_history (id, student_id, question, answer, created_at) VALUES (?,?,?,?,NOW())",
        [id, stuId, `冒烟问题${i}`, `冒烟回答${i}`]
      );
    }
    // 同时把今日看题记录清空，验证「看题数」不再影响判定
    await pool.query('DELETE FROM learn_visited_records WHERE student_id=? AND DATE(visited_at)=CURDATE()', [stuId]);
    await pool.query('DELETE FROM studious_checkins WHERE student_id=? AND check_date=CURDATE()', [stuId]);

    const before = await pool.query('SELECT studious_times FROM profiles WHERE id=?', [stuId]);
    const timesBefore = before[0][0]?.studious_times || 0;

    const ck2 = await api(token, 'POST', '/api/student/learn-studious-checkin', {});
    ok(ck2.status === 200, `HTTP 200（实际 ${ck2.status}）`);
    ok(ck2.json?.data?.today_count === 10, `today_count=10（实际 ${ck2.json?.data?.today_count}）`);
    ok(ck2.json?.data?.triggered === true, '看题数为 0 也能触发（判定已改为答疑次数）');
    ok(!!ck2.json?.data?.honor, '返回 honor 信息');
    ok(!!ck2.json?.data?.buff, '返回 buff 信息');
    ok(ck2.json?.data?.honor?.description?.includes('AI 答疑'), `honor 文案提到 AI 答疑：「${ck2.json?.data?.honor?.description}」`);
    // buff 加成 / 时长必须与 system_config 一致（默认 8% / 30 分钟，但老师可能改过）
    const [critRows] = await pool.query(
      "SELECT value FROM system_config WHERE config_key='honor_studious_buff_crit'"
    );
    let cfgCrit = 8;
    if (critRows.length) {
      let v = critRows[0].value;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch {} }
      if (v && typeof v === 'object' && v.value !== undefined) v = v.value;
      cfgCrit = parseFloat(v) || 8;
    }
    ok(ck2.json?.data?.buff?.crit_modifier === cfgCrit,
      `buff 加成与系统配置一致 ${cfgCrit}%（实际 ${ck2.json?.data?.buff?.crit_modifier}）`);
    const [minRows] = await pool.query(
      "SELECT value FROM system_config WHERE config_key='honor_studious_buff_minutes'"
    );
    let cfgMin = 30;
    if (minRows.length) {
      let v = minRows[0].value;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch {} }
      if (v && typeof v === 'object' && v.value !== undefined) v = v.value;
      cfgMin = parseInt(v) || 30;
    }
    ok(ck2.json?.data?.buff?.duration_minutes === cfgMin,
      `buff 时长与系统配置一致 ${cfgMin} 分钟（实际 ${ck2.json?.data?.buff?.duration_minutes}）`);

    const after = await pool.query('SELECT studious_times FROM profiles WHERE id=?', [stuId]);
    ok((after[0][0]?.studious_times || 0) === timesBefore + 1, 'studious_times +1');

    // buff 落库
    const buffs = await pool.query(
      "SELECT buff_type, crit_modifier FROM student_buffs WHERE student_id=? AND buff_type='studious_crit' AND expires_at>NOW()",
      [stuId]
    );
    ok(buffs[0].length === 1, 'studious_crit Buff 已写入 student_buffs 且未过期');

    section('B4 每日限一次');
    const ck3 = await api(token, 'POST', '/api/student/learn-studious-checkin', {});
    ok(ck3.json?.data?.triggered === false, '当天第二次不再触发');
    ok(ck3.json?.data?.triggered_today === true, 'triggered_today 为 true');
    const after2 = await pool.query('SELECT studious_times FROM profiles WHERE id=?', [stuId]);
    ok((after2[0][0]?.studious_times || 0) === timesBefore + 1, 'studious_times 未重复 +1（仍只 +1）');

    section('B5 阈值可被老师后台调大');
    await pool.query(
      "UPDATE system_config SET value='{\"value\": 20}' WHERE config_key='honor_studious_questions'"
    );
    await pool.query('DELETE FROM studious_checkins WHERE student_id=? AND check_date=CURDATE()', [stuId]);
    const ck4 = await api(token, 'POST', '/api/student/learn-studious-checkin', {});
    ok(ck4.json?.data?.threshold === 20, `threshold 读配置为 20（实际 ${ck4.json?.data?.threshold}）`);
    ok(ck4.json?.data?.triggered === false, '10 次 < 20 次，不触发');
    // 还原
    await pool.query(
      "UPDATE system_config SET value='{\"value\": 10}' WHERE config_key='honor_studious_questions'"
    );

    section('B6 清理测试数据');
    for (const id of madeIds) await pool.query('DELETE FROM ai_qa_history WHERE id=?', [id]);
    await pool.query('DELETE FROM studious_checkins WHERE student_id=? AND check_date=CURDATE()', [stuId]);
    await pool.query("DELETE FROM student_buffs WHERE student_id=? AND buff_type='studious_crit'", [stuId]);
    await pool.query('UPDATE profiles SET studious_times=? WHERE id=?', [timesBefore, stuId]);
    const [leftQa] = await pool.query('SELECT COUNT(*) c FROM ai_qa_history WHERE id LIKE ?', ['smoke_qa_%']);
    ok(Number(leftQa[0].c) === 0, '临时答疑记录已清理');
    ok(!!token, '学生密码已改为临时密码（不影响生产，改动前请确认）');
  } catch (e) {
    fail++;
    console.error('\n[EXCEPTION]', e.message);
    console.error(e.stack);
  } finally {
    await pool.end();
  }

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})();
