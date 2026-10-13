/**
 * 代码农场（桌面即游戏场） · 真浏览器 UI 验证（CDP）
 * 前置：后端 3101 + 前端 dev 3266
 * 用法：node backend/scripts/debug/verify_farm_ui.cjs
 *
 * 覆盖：
 *   A. 教师端侧栏「代码农场」→ 配置页（世界设定 / 生效班级 / 天气 / 重置世界）
 *   B. 「全班地块」表格、「劳作日志」页签
 *   C. 学生桌面**自动**进入农场态（教师开关打开 + 班级命中），图标仍浮在田野上
 *   D. 打开代码编辑器 → 运行 → 后端结算回显 + 落库
 *   E. 教师关闭开关 → 学生桌面自动退出农场
 *   F. 无 JS 运行期异常、无 4xx/5xx
 *
 * ⛔ 不留痕（铁律）：
 *   · 用临时班级 tmp_farm_e2e 承载测试学生，验后还原学生班级并删除该班级；
 *   · farm_config 先快照后还原；farm_plots / farm_logs / 农场积分流水全清；
 *   · 末尾「不留痕」断言。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');
const { snapshotFarmData, restoreFarmData } = require('./lib/farm-data.cjs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const API = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy' };

const TMP_CLASS_ID = 'tmp_farm_e2e_cls';
const TMP_CLASS_NAME = 'tmp_农场E2E班';
const STUDENT = { u: 'a', p: '111111' };
const TEACHER = { u: 'teacher', p: 'xgpy666' };
const NOTICE = 'E2E 联调中';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

const SET_VAL = `
function __setVal(el, v){
  const proto = Object.getPrototypeOf(el);
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  d.set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}`;

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, body: json };
}
async function loginToken(u, p) {
  const r = await api('/api/auth/secure-login', { method: 'POST', body: { username: u, password: p } });
  const d = r.body && r.body.data;
  return (d && ((d.session && d.session.access_token) || d.token)) || null;
}

/**
 * 用真实登录表单登录（顺带验证登录链路没被改坏）。
 *
 * ⚠️ 为什么要「稳定校验 + 重试」：
 *   服务端是「会话替换」策略——同一账号再次登录会让旧 token 失效。
 *   在 dev 下切换账号（清 localStorage → 重新登录）时，偶发会先短暂进入桌面、
 *   随即因 token 被替换而 401 被踢回登录页。这是测试环境的竞态，不是功能缺陷，
 *   故登录后要求「桌面稳定 3 秒」才算成功，最多重试 3 次。
 */
async function loginAs(b, username, password) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await b.evalJs('(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return true; })()');
    await b.ws.send('Page.navigate', { url: PAGE });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      ready = await b.evalJs(`!!Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.includes('用户名'))`);
      if (ready === true) break;
    }
    if (ready !== true) { console.log(`    (第 ${attempt} 次：登录表单未出现，重试)`); continue; }

    const res = await b.evalJs(`(() => {
      ${SET_VAL}
      const inputs = Array.from(document.querySelectorAll('input'));
      const u = inputs.find(i => i.placeholder && i.placeholder.includes('用户名'));
      const p = inputs.find(i => i.type === 'password');
      if (!u || !p) return 'no-form';
      __setVal(u, ${JSON.stringify(username)});
      __setVal(p, ${JSON.stringify(password)});
      const form = u.closest('form');
      if (!form) return 'no-form';
      form.requestSubmit();
      return 'submitted';
    })()`);
    if (res !== 'submitted') continue;

    let stable = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const st = await b.evalJs(`(() => { const t = document.body.innerText || ''; return {
        out: t.includes('退出登录'),
        form: !!Array.from(document.querySelectorAll('input')).find(x => x.placeholder && x.placeholder.includes('用户名')),
      }; })()`);
      if (st && st.out === true && st.form === false) {
        await sleep(3000);
        const still = await b.evalJs(`(document.body.innerText || '').includes('退出登录')`);
        if (still === true) { stable = true; break; }
      }
    }
    if (stable) return 'submitted';
    console.log(`    (第 ${attempt} 次：登录后登录态不稳定，重试)`);
  }
  return 'login-unstable';
}

async function clickByText(b, text) {
  return b.evalJs(`(() => {
    const want = ${JSON.stringify(text)}.replace(/\\s+/g, '');
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    let nodes = Array.from(document.querySelectorAll('button, a')).filter(n => norm(n.textContent) === want);
    if (!nodes.length) nodes = Array.from(document.querySelectorAll('button, a')).filter(n => norm(n.textContent).includes(want));
    if (!nodes.length) return 'not-found';
    nodes[0].click();
    return 'clicked';
  })()`);
}

async function waitText(b, text, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await b.evalJs(`(document.body.innerText || '').includes(${JSON.stringify(text)})`) === true) return true;
    await sleep(400);
  }
  return false;
}

(async () => {
  const db = await mysql.createConnection(DB);
  let snapCfg = null;
  let studentId = null;
  let oldClassId = null;
  let snapPoints = null; // ⛔ 学生 current_points 快照（跑测试会真发积分，必须还原）
  let snapEarned = null; // ⛔ 学生 total_points_earned 快照
  let snapFarm = null; // ⛔ 学生的 地块 / 日志 / 农场流水 整份快照（跑完放回原样）
  let b = null;
  let chromeDir = null;

  async function cleanup() {
    try {
      // ⛔ 不是「删干净」，而是「放回原样」：学生 a 同时也是老师试玩用的账号，
      //    直接 DELETE 会把真实试玩记录吃掉（详见 lib/farm-data.cjs）。
      if (studentId) await restoreFarmData(db, snapFarm);
      // ⛔ 积分必须回滚：只还原明细还不够，current_points / total_points_earned 也要回到原值。
      if (studentId && snapPoints !== null) {
        await db.query('UPDATE profiles SET current_points = ?, total_points_earned = ? WHERE id = ?',
          [snapPoints, snapEarned, studentId]);
      }
      if (snapCfg) {
        await db.query(
          'UPDATE farm_config SET enabled=?, class_ids=?, day_minutes=?, base_yield=?, max_ops_per_day=?, ' +
            'weather=?, notice=?, default_code=?, start_at=?, updated_by=NULL WHERE id = 1',
          [snapCfg.enabled, snapCfg.class_ids, snapCfg.day_minutes, snapCfg.base_yield,
           snapCfg.max_ops_per_day, snapCfg.weather, snapCfg.notice, snapCfg.default_code, snapCfg.start_at]
        );
      }
      if (studentId) await db.query('UPDATE profiles SET class_id = ? WHERE id = ?', [oldClassId, studentId]);
      await db.query('DELETE FROM classes WHERE id = ?', [TMP_CLASS_ID]);
    } catch (e) { console.log('  [cleanup warn] ' + e.message); }
  }

  try {
    // ---------- 前置 ----------
    section('前置：临时班级 + 农场仅对该班开启');
    const [cfgRows] = await db.query('SELECT * FROM farm_config WHERE id = 1');
    snapCfg = cfgRows[0] || null;
    const [stuRows] = await db.query(
      'SELECT id, class_id, current_points, total_points_earned FROM profiles WHERE username = ? LIMIT 1', [STUDENT.u]);
    if (!stuRows.length) throw new Error('找不到测试学生 ' + STUDENT.u);
    studentId = stuRows[0].id;
    oldClassId = stuRows[0].class_id;
    snapPoints = Number(stuRows[0].current_points) || 0;
    snapEarned = Number(stuRows[0].total_points_earned) || 0;
    // ⛔ 动手删之前先把 地块 / 日志 / 农场流水 整份快照（学生 a 也是老师试玩用的账号）
    snapFarm = await snapshotFarmData(db, studentId);
    console.log('  已快照真实试玩数据：plots=' + snapFarm.tables.farm_plots.length +
      ' logs=' + snapFarm.tables.farm_logs.length +
      ' 农场流水=' + snapFarm.tables.point_transactions.length);
    await db.query('DELETE FROM classes WHERE id = ?', [TMP_CLASS_ID]);
    await db.query('INSERT INTO classes (id, name) VALUES (?, ?)', [TMP_CLASS_ID, TMP_CLASS_NAME]);
    await db.query('UPDATE profiles SET class_id = ? WHERE id = ?', [TMP_CLASS_ID, studentId]);
    await db.query(
      'UPDATE farm_config SET enabled=1, class_ids=?, day_minutes=1, base_yield=10, max_ops_per_day=15, ' +
        "weather='sunny', notice=?, default_code=NULL, start_at=NOW() WHERE id = 1",
      [JSON.stringify([TMP_CLASS_ID]), NOTICE]
    );
    const teacherToken = await loginToken(TEACHER.u, TEACHER.p);
    const studentToken = await loginToken(STUDENT.u, STUDENT.p);
    const st0 = await api('/api/student/farm/state', { token: studentToken });
    ok('临时班级建立、农场仅对该班开启', true);
    ok('后端 state.enabled = true', st0.body?.data?.enabled === true, JSON.stringify(st0.body?.data || {}).slice(0, 120));

    // ⚠️ 必须用**每次全新**的 user-data-dir：复用目录会让 Chrome 恢复上次的标签页/会话，
    //    导致登录态串台（上一轮的角色 token 干扰本轮），表现为随机 401 被踢回登录页。
    chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-ui-'));
    b = await launchHeadless({ userDataDir: chromeDir, port: 9472, windowSize: '1440,900' });

    // ---------- A/B 教师端 ----------
    section('A. 教师端 → 代码农场配置页');
    const r = await loginAs(b, TEACHER.u, TEACHER.p);
    ok('教师登录成功（真实登录表单）', r === 'submitted', r);
    await sleep(1200);

    const nav = await clickByText(b, '代码农场');
    ok('侧栏点击「代码农场」', nav === 'clicked', nav);
    await sleep(1500);

    let body = String(await b.evalJs('document.body.innerText') || '');
    ok('配置页标题「桌面即游戏场」', body.includes('桌面即游戏场'));
    ok('含「生效班级（多选）」', body.includes('生效班级'));
    ok('含「世界设定」与三个数值项', body.includes('世界设定') && body.includes('一天时长（分钟）')
      && body.includes('成熟收获基础积分') && body.includes('每天劳作次数上限'));
    ok('含天气选择与教学提示', body.includes('当前天气'));
    ok('含公告输入框', body.includes('全班公告'));
    ok('★ 含「编辑器默认代码」设置区', body.includes('编辑器默认代码') && body.includes('载入内置示例'));
    ok('含「重置世界」危险操作按钮', body.includes('重置世界'));
    ok('顶部统计卡（已建地块）', body.includes('已建地块'));
    ok('临时班级出现在班级多选里', body.includes(TMP_CLASS_NAME), TMP_CLASS_NAME);

    section('B. 三个页签');
    ok('有「全班地块 / 劳作日志」页签', body.includes('全班地块') && body.includes('劳作日志'));
    await clickByText(b, '全班地块');
    await sleep(1500);
    body = String(await b.evalJs('document.body.innerText') || '');
    ok('「全班地块」表格表头（学生/作物/阶段/积分）',
      body.includes('作物') && body.includes('阶段') && body.includes('积分'));
    await clickByText(b, '劳作日志');
    await sleep(1500);
    body = String(await b.evalJs('document.body.innerText') || '');
    ok('「劳作日志」可打开', body.includes('劳作日志') && (body.includes('最近 50 条') || body.includes('暂无劳作记录')));

    // ---------- C/D 学生端 ----------
    // ⛔ 这段要断言「默认代码恰好消耗 8 次劳作」，前提是地块从「空地 水50/肥50」起跑。
    //    真实环境里学生 a 自己玩过，地块可能已经种着成熟作物 → 断言会随数据漂移。
    //    所以先只清掉「临时状态」（total_harvest / total_points 不动，教师统计不受影响），
    //    学生登录时 FarmOverlay 会拉到这块空地；脚本末尾统一按快照还原。
    await db.query(
      'UPDATE farm_plots SET crop=NULL, growth=0, moisture=50, nutrient=50, stage=0, ops_today=0, ops_day=0 WHERE student_id = ?',
      [studentId]
    );
    section('C. 学生桌面自动进入农场');
    const r2 = await loginAs(b, STUDENT.u, STUDENT.p);
    ok('学生登录成功', r2 === 'submitted', r2);
    await sleep(2000);
    body = String(await b.evalJs('document.body.innerText') || '');
    ok('登录后被路由到学生桌面', body.includes('退出登录') && !body.includes('用户名'), body.replace(/\n+/g, ' | ').slice(0, 160));

    const shown = await waitText(b, '今天还能劳作', 30000);
    body = String(await b.evalJs('document.body.innerText') || '');
    ok('桌面**自动**进入农场态（「我的地 / 今天还能劳作」）', shown && body.includes('我的地'),
      body.replace(/\n+/g, ' | ').slice(0, 220));
    ok('农场里显示教师公告', body.includes(NOTICE));
    ok('农场里显示天气与天数', /第\s*\d+\s*天/.test(body) && body.includes('晴'));
    ok('农场里显示水肥指标', body.includes('水分') && body.includes('养分'));
    ok('桌面图标仍浮在农场之上（未被遮挡）',
      ['学习', '练习', '测试', 'Python编程', '错题集'].some((k) => body.includes(k)));

    section('D. 打开代码编辑器 → 运行 → 后端结算');
    const opened = await clickByText(b, '编写农活代码');
    ok('打开代码编辑器', opened === 'clicked', opened);
    await sleep(1200);
    const hasTa = await b.evalJs('!!document.querySelector("textarea")');
    ok('编辑器含代码输入框', hasTa === true);

    const ran = await clickByText(b, '运行');
    ok('点击「运行」', ran === 'clicked', ran);
    let feedback = false;
    for (let i = 0; i < 50; i++) {
      await sleep(400);
      body = String(await b.evalJs('document.body.innerText') || '');
      if (body.includes('小麦') || body.includes('播种') || body.includes('浇水')) { feedback = true; break; }
    }
    ok('运行后有结算反馈（出现作物名/播种/浇水）', feedback, body.replace(/\n+/g, ' | ').slice(0, 220));

    // ⚠️ 不能用 Node 侧的旧 token 再查接口：学生刚在浏览器里登录过，
    //    服务端会话替换（顶号）会让旧 token 失效 → 401。直接查库更可靠。
    const [plotRows] = await db.query('SELECT crop, growth, moisture, nutrient, ops_today FROM farm_plots WHERE student_id = ?', [studentId]);
    ok('后端已落库：学生地块已有作物', !!plotRows[0]?.crop, JSON.stringify(plotRows[0] || {}));
    ok('地块水分已因浇水提升 (>50)', Number(plotRows[0]?.moisture || 0) > 50, plotRows[0]?.moisture);
    ok('地块已产生成长值 (>0)', Number(plotRows[0]?.growth || 0) > 0, plotRows[0]?.growth);
    // ⛔ 新口径：默认代码 = 播种 1 + 浇到满 5 + 施肥 2 = 8 次劳作（不是「1 次提交」）
    ok('★ 劳作按动作计：默认代码消耗 8 次（库内 ops_today=8）', Number(plotRows[0]?.ops_today) === 8,
      'ops_today=' + plotRows[0]?.ops_today);
    ok('界面回显「本次消耗劳作」', body.includes('本次消耗劳作'), body.replace(/\n+/g, ' | ').slice(0, 200));

    // ---------- D2 ★ 教师改「编辑器默认代码」→ 学生编辑器自动跟随 ----------
    // ⛔ 这一段依赖「学生没动过代码」：脚本一路没改 textarea，所以代码仍等于默认，
    //    老师换默认后应当自动跟随（改过的代码则保留，见 FarmOverlay 的 codeBaseRef 逻辑）。
    section('D2. ★ 教师改「编辑器默认代码」→ 学生编辑器自动跟随');
    const MARKER = '# 老师留的题目：先原样跑一遍，再想办法改好\nplant("wheat")\nwater(10)\nfertilize(10)\nharvest()';
    const putDc = await api('/api/teacher/farm/config', {
      method: 'PUT', token: teacherToken,
      body: {
        enabled: true, class_ids: [TMP_CLASS_ID], day_minutes: 1, base_yield: 10,
        max_ops_per_day: 15, weather: 'sunny', notice: NOTICE, default_code: MARKER,
      },
    });
    ok('教师端保存新默认代码（200）', putDc.status === 200, 'status=' + putDc.status);
    let followed = false;
    let taVal = '';
    for (let i = 0; i < 44; i++) { // 学生桌面 10 秒轮询
      await sleep(500);
      taVal = String(await b.evalJs('(() => { const t = document.querySelector("textarea"); return t ? t.value : ""; })()'));
      if (taVal.includes('先原样跑一遍')) { followed = true; break; }
    }
    ok('★ 未改过代码 → 编辑器自动换成老师的新默认（含「先原样跑一遍」）', followed, taVal.slice(0, 80).replace(/\n/g, ' / '));

    // ---------- E 关闭开关 ----------
    section('E. 教师关闭开关 → 学生桌面自动退出');
    await api('/api/teacher/farm/config', {
      method: 'PUT', token: teacherToken,
      body: {
        enabled: false, class_ids: [TMP_CLASS_ID], day_minutes: 1, base_yield: 10,
        max_ops_per_day: 15, weather: 'sunny', notice: NOTICE,
      },
    });
    let exited = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      body = String(await b.evalJs('document.body.innerText') || '');
      if (!body.includes('今天还能劳作') && !body.includes('我的地')) { exited = true; break; }
    }
    ok('关闭后学生桌面自动退出农场世界', exited, body.replace(/\n+/g, ' | ').slice(0, 180));
    ok('退出后仍是正常桌面（未跳登录）', body.includes('退出登录'));

    // ---------- F 无异常 ----------
    section('F. 运行期异常 / 网络错误');
    ok('无 JS 运行期异常', b.jsErrors.length === 0, JSON.stringify(b.jsErrors.slice(0, 3)));
    // 切换账号时（localStorage.clear() 后重新导航）会出现无 token 的 /api/auth/session 401
    // 与导航中断 ERR_ABORTED —— 属预期行为，排除后再断言。
    const netNoise = /\/api\/auth\/session|net::ERR_ABORTED/;
    const realFails = b.netFails.filter((f) => !netNoise.test(f));
    ok('无 4xx/5xx 接口错误（已排除切换账号时的 session 401 与导航中断）',
      realFails.length === 0, JSON.stringify(realFails.slice(0, 3)));
  } catch (e) {
    fail++;
    console.log('\n  ✗ 异常：' + e.message + '\n' + String(e.stack || '').split('\n').slice(1, 4).join('\n'));
  } finally {
    section('清理与不留痕断言');
    await cleanup();
    if (b) await b.close();
    await sleep(1200);
    try {
      const [p] = await db.query('SELECT COUNT(*) AS c FROM farm_plots WHERE student_id = ?', [studentId]);
      const [l] = await db.query('SELECT COUNT(*) AS c FROM farm_logs WHERE student_id = ?', [studentId]);
      const [t] = await db.query("SELECT COUNT(*) AS c FROM point_transactions WHERE student_id = ? AND source_type='farm'", [studentId]);
      const [c] = await db.query('SELECT COUNT(*) AS c FROM classes WHERE id = ?', [TMP_CLASS_ID]);
      const [s] = await db.query('SELECT class_id FROM profiles WHERE id = ?', [studentId]);
      const [f] = await db.query('SELECT enabled, class_ids, notice, day_minutes, base_yield, max_ops_per_day, default_code FROM farm_config WHERE id = 1');
      ok('★ farm_plots 已还原（是「放回原样」，不是「删干净」）',
        Number(p[0].c) === (snapFarm ? snapFarm.tables.farm_plots.length : 0),
        p[0].c + ' vs 快照 ' + (snapFarm ? snapFarm.tables.farm_plots.length : 0));
      ok('★ farm_logs 已还原（真实试玩日志不会被回归吃掉）',
        Number(l[0].c) === (snapFarm ? snapFarm.tables.farm_logs.length : 0),
        l[0].c + ' vs 快照 ' + (snapFarm ? snapFarm.tables.farm_logs.length : 0));
      ok('★ 农场积分流水已还原',
        Number(t[0].c) === (snapFarm ? snapFarm.tables.point_transactions.length : 0),
        t[0].c + ' vs 快照 ' + (snapFarm ? snapFarm.tables.point_transactions.length : 0));
      ok('临时班级已删除', Number(c[0].c) === 0, c[0].c);
      ok('测试学生班级已还原', s[0].class_id === oldClassId, s[0].class_id + ' vs ' + oldClassId);
      // ⛔ 别锁死 enabled 的具体值（教师可改）；只要求回到跑测试前的状态
      ok('农场配置已还原（与快照一致）',
        !snapCfg || (Number(f[0].enabled) === Number(snapCfg.enabled) &&
          Number(f[0].day_minutes) === Number(snapCfg.day_minutes) &&
          Number(f[0].base_yield) === Number(snapCfg.base_yield) &&
          Number(f[0].max_ops_per_day) === Number(snapCfg.max_ops_per_day) &&
          String(f[0].default_code == null ? '' : f[0].default_code) ===
            String(snapCfg.default_code == null ? '' : snapCfg.default_code)),
        JSON.stringify(f[0]) + ' vs 快照 enabled=' + (snapCfg && snapCfg.enabled));
      // ⛔ 积分还原断言：没有这条，脚本会静默给学生白送积分（流水已删、事后无法追溯）
      const [pp] = await db.query('SELECT current_points, total_points_earned FROM profiles WHERE id = ?', [studentId]);
      ok('★ 学生 current_points 已还原', Number(pp[0].current_points) === snapPoints,
        pp[0].current_points + ' vs 快照 ' + snapPoints);
      ok('★ 学生 total_points_earned 已还原', Number(pp[0].total_points_earned) === snapEarned,
        pp[0].total_points_earned + ' vs 快照 ' + snapEarned);
    } catch (e) { console.log('  [断言失败] ' + e.message); fail++; }
    try { if (chromeDir) fs.rmSync(chromeDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    await db.end();

    console.log('\n' + '='.repeat(40));
    console.log('通过 ' + pass + ' / 失败 ' + fail);
    console.log('='.repeat(40));
    process.exit(fail === 0 ? 0 : 1);
  }
})();
