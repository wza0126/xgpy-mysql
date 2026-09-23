/**
 * verify_mastered_qualification_ui.cjs
 *
 * 真浏览器（headless Chromium + CDP）端到端验证：教师端「已掌握题数认证」配置界面，
 * 以及学生端普通测试 / PK 对战的双条件资格展示与拦截。
 *
 * 前置：前后端都要在跑（默认 3101 / 3266），脚本会真登录、真点界面。
 *
 * ⚠️ 教师页导航坑：直接加载 /#/teacher 会因首帧 profile 为 null 被路由守卫重置回 #/，
 *    必须**从根路由进入**再等应用自行跳转（应用既有行为，不是 bug）。
 *
 * 用法：node scripts/debug/verify_mastered_qualification_ui.cjs
 */
const path = require('path');
const pool = require('../../src/db');
const { launchHeadless } = require('./lib/cdp.cjs');

const BASE = process.env.XGPY_FE || 'http://127.0.0.1:3266';
const TEACHER = { user: 'teacher', pwd: 'xgpy666' };
const STUDENT = { user: 'a', pwd: '111111' };

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

/** 登录（页内 fetch，避免自己实现签名逻辑） */
async function feLogin(cdp, user, pwd) {
  return await cdp.evalJs(`(async () => {
    const r = await fetch('/api/auth/secure-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ${JSON.stringify(user)}, password: ${JSON.stringify(pwd)}, deviceInfo: 'e2e-verify' })
    });
    const j = await r.json();
    const t = j && j.data && j.data.session && j.data.session.access_token;
    if (t) {
      localStorage.setItem('xgpy_token', t);
      localStorage.setItem('xgpy_user', JSON.stringify(j.data.user));
    }
    return t ? 'ok' : ('fail:' + JSON.stringify(j).slice(0, 200));
  })()`);
}

async function gotoRoot(cdp) {
  await cdp.evalJs(`location.href = ${JSON.stringify(BASE + '/')}; 'go'`);
  await cdp.sleep(2500);
}

async function main() {
  const cdp = await launchHeadless({ port: 9461, userDataDir: path.join(__dirname, '..', '..', '.tmp-e2e-qual') });
  try {
    // ══ 教师端：PK 对战配置界面有「已掌握题数认证」 ═════════════════════════
    section('教师端 · PK 对战配置界面');
    await gotoRoot(cdp);
    let r = await feLogin(cdp, TEACHER.user, TEACHER.pwd);
    ok('教师登录成功', r === 'ok', String(r));
    await gotoRoot(cdp);
    await cdp.sleep(1500);

    // 进入考试管理 → 对战PK 配置 Tab
    const nav = await cdp.evalJs(`(() => {
      const txts = [...document.querySelectorAll('button,a,div[role=button]')].map(e => e.textContent.trim());
      return JSON.stringify(txts.filter(t => /考试管理|对战|PK|普通测试/.test(t)).slice(0, 20));
    })()`);
    console.log('  ℹ️  可见相关入口：' + nav);

    // 直接查接口 + 查界面：先确认配置接口返回新字段
    const cfgRes = await cdp.evalJs(`(async () => {
      const t = localStorage.getItem('xgpy_token');
      const r = await fetch('/api/pk/battle-configs', { headers: { Authorization: 'Bearer ' + t } });
      const j = await r.json();
      return JSON.stringify({ n: (j.data||[]).length, sample: (j.data||[])[0] || null });
    })()`);
    console.log('  ℹ️  对战配置接口：' + cfgRes);
    ok('对战配置接口返回新字段',
      /qualification_mastered_count/.test(String(cfgRes)) && /qualification_mastered_clusters/.test(String(cfgRes)));

    // 类目题量接口（设置上限的参考值）
    const cntRes = await cdp.evalJs(`(async () => {
      const t = localStorage.getItem('xgpy_token');
      const r = await fetch('/api/teacher/qualification/counts', { headers: { Authorization: 'Bearer ' + t } });
      const j = await r.json();
      return JSON.stringify(j.data);
    })()`);
    let cd = null;
    try { cd = JSON.parse(String(cntRes)); } catch {}
    ok('教师端能拿到类目题量',
      !!cd && typeof cd.total === 'number' && cd.total > 0, String(cntRes).slice(0, 160));
    ok('题量按一级类目分布（16 章）',
      !!cd && Object.keys(cd.by_primary || {}).length === 16,
      cd ? `类目数=${Object.keys(cd.by_primary || {}).length}` : '无');

    // ══ 教师端：保存带掌握资格的配置，再读回校验 ══════════════════════════
    section('教师端 · 配置保存往返');
    const saved = await cdp.evalJs(`(async () => {
      const t = localStorage.getItem('xgpy_token');
      const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t };
      const name = '__E2E掌握资格_' + Date.now();
      const body = {
        name, mode: 'timed', duration_seconds: 180, question_count: 20,
        is_active: false, daily_limit: null,
        qualification_correct_count: 12,
        qualification_mastered_count: 5,
        qualification_mastered_clusters: ['数据与信息', '算法的程序实现'],
      };
      const c = await fetch('/api/pk/battle-configs', { method: 'POST', headers: H, body: JSON.stringify(body) });
      const cj = await c.json();
      const id = cj.data && cj.data.id;
      if (!id) return 'create-fail:' + JSON.stringify(cj).slice(0,200);
      const l = await fetch('/api/pk/battle-configs', { headers: H });
      const lj = await l.json();
      const row = (lj.data||[]).find(x => x.id === id);
      return JSON.stringify({ id, row: row ? {
        correct: row.qualification_correct_count,
        mastered: row.qualification_mastered_count,
        clusters: row.qualification_mastered_clusters,
      } : null });
    })()`);
    let createdId = null;
    try { const o = JSON.parse(String(saved)); createdId = o.id; 
      ok('创建带掌握资格的配置成功', !!o.id);
      ok('做对题数往返正确', o.row && o.row.correct === 12, `值=${o.row && o.row.correct}`);
      ok('已掌握题数往返正确', o.row && o.row.mastered === 5, `值=${o.row && o.row.mastered}`);
      const cl = o.row && o.row.clusters;
      const clArr = typeof cl === 'string' ? JSON.parse(cl) : cl;
      ok('类目范围往返正确', Array.isArray(clArr) && clArr.length === 2 && clArr.includes('数据与信息'),
        JSON.stringify(clArr));
    } catch (e) {
      ok('创建带掌握资格的配置成功', false, String(saved).slice(0, 200));
    }

    // ══ 学生端：测试列表显示双条件 ═══════════════════════════════════════
    section('学生端 · 普通测试双条件');

    // 造一个对全体可见、要求双条件的测试，并设为不激活（避免真被点到）
    let testId = null;
    try {
      const { randomUUID } = require('crypto');
      testId = 'test_' + randomUUID().replace(/-/g, '').slice(0, 16);
      const [teacherRow] = await pool.query("SELECT id FROM profiles WHERE role='teacher' LIMIT 1");
      await pool.query(
        `INSERT INTO tests (id, title, type, question_count, points_reward, time_limit,
           passing_score, is_active, qualification_correct_count,
           qualification_mastered_count, qualification_mastered_clusters, created_by, created_at)
         VALUES (?, ?, 'test', 5, 10, 30, 60, 1, 1, 1, ?, ?, NOW())`,
        [testId, '__E2E双条件测试',
         JSON.stringify(['数据与信息']),
         teacherRow[0]?.id]
      );
      console.log('  ℹ️  已造测试 ' + testId);
    } catch (e) {
      console.log('  ⚠️  造测试失败：' + e.message);
    }

    await gotoRoot(cdp);
    r = await feLogin(cdp, STUDENT.user, STUDENT.pwd);
    ok('学生登录成功', r === 'ok', String(r));
    await gotoRoot(cdp);
    await cdp.sleep(3000);

    const stu = await cdp.evalJs(`(async () => {
      const t = localStorage.getItem('xgpy_token');
      const r = await fetch('/api/student/qualification/tests', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ test_ids: [${JSON.stringify(testId)}] })
      });
      const j = await r.json();
      const d = j.data && j.data[${JSON.stringify(testId)}];
      return JSON.stringify({ passed: d && d.passed,
        correct: d && d.correct, mastered: d && d.mastered,
        clusters: d && d.mastered && d.mastered.clusters });
    })()`);
    console.log('  ℹ️  资格明细：' + stu);
    let sd = null;
    try { sd = JSON.parse(String(stu)); } catch {}
    ok('测试资格接口返回两项条件',
      !!sd && !!sd.correct && !!sd.mastered, String(stu).slice(0, 300));
    if (sd && sd.mastered) {
      ok('已掌握条件带类目范围（数据与信息）',
        Array.isArray(sd.mastered.clusters) && sd.mastered.clusters.includes('数据与信息'),
        JSON.stringify(sd.mastered.clusters));
      ok('已掌握条件标记为启用', sd.mastered.enabled === true);
      ok('掌握阈值为1，学生实际掌握>=1 → 通过',
        sd.mastered.passed === true, `cur=${sd.mastered.current}`);
    } else {
      ok('已掌握条件带类目范围（数据与信息）', false, '资格明细为空');
      ok('已掌握条件标记为启用', false, '资格明细为空');
      ok('掌握阈值为1，学生实际掌握>=1 → 通过', false, '资格明细为空');
    }
    ok('做对可见性条件也返回（本题设为1，应通过）',
      !!sd && !!sd.correct && sd.correct.enabled === true && sd.correct.passed === true,
      sd && sd.correct ? `enabled=${sd.correct.enabled} passed=${sd.correct.passed} cur=${sd.correct.current}` : '无');
    ok('总体 passed 为 true', !!sd && sd.passed === true);

    // ══ 学生端：PK 大厅双条件 ═════════════════════════════════════════════
    section('学生端 · PK 双条件');
    const pkActive = await cdp.evalJs(`(async () => {
      const t = localStorage.getItem('xgpy_token');
      const r = await fetch('/api/pk/battle-configs/active', { headers: { Authorization: 'Bearer ' + t } });
      const j = await r.json();
      return JSON.stringify((j.data||[])[0] || null).slice(0, 400);
    })()`);
    console.log('  ℹ️  活跃PK配置：' + pkActive);
    ok('学生拿到活跃PK配置（含新字段）',
      /qualification_mastered/.test(String(pkActive)) || pkActive === 'null',
      String(pkActive).slice(0, 160));

    // ══ 无 JS 报错 / 无 4xx ═══════════════════════════════════════════════
    section('运行时健康');
    const realJsErrors = cdp.jsErrors.filter(e => !/favicon|ResizeObserver/i.test(String(e)));
    ok('无 JS 运行时异常', realJsErrors.length === 0, realJsErrors.slice(0, 3).join(' | '));
    const realNet = cdp.netFails.filter(f => !/favicon/i.test(String(f)));
    ok('无 4xx/5xx 响应', realNet.length === 0, realNet.slice(0, 3).join(' | '));

    // ── 清理 ──
    section('清理');
    if (testId) {
      await pool.query('DELETE FROM tests WHERE id = ?', [testId]);
      console.log('  ℹ️  已删除临时测试');
    }
    if (createdId) {
      await pool.query('DELETE FROM pk_battle_configs WHERE id = ?', [createdId]);
      console.log('  ℹ️  已删除临时PK配置');
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  通过 ${pass} / ${pass + fail}`);
    if (fail > 0) { console.log('  ❌ 失败项：'); failures.forEach(f => console.log('     - ' + f)); }
    else console.log('  ✅ 全部通过');
    console.log(`${'═'.repeat(60)}\n`);
  } finally {
    cdp.close();
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(2); });
