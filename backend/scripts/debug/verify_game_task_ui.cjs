/**
 * 游戏化任务系统 · 真浏览器 UI 验证（CDP）
 * 前置：后端 3101 + 前端 dev 3266
 * 用法：node backend/scripts/debug/verify_game_task_ui.cjs
 *
 * 覆盖：
 *   学生端：桌面「任务中心」入口 → 窗口内「每日任务」Tab → 任务卡片与概览 → 切「我的成就」
 *   教师端：「刷题打怪系统」→「任务系统」Tab → 任务列表 / 达成条件 / 奖励列 / 新建任务按钮
 *   并断言无 JS 运行期异常
 */

'use strict';

const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

// React 受控输入必须用原生 setter + input 事件，直接改 .value 不会触发 onChange
const SET_VAL = `
function __setVal(el, v){
  const proto = Object.getPrototypeOf(el);
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  d.set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}`;

async function loginAs(b, username, password) {
  await b.ws.send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const atOrigin = await b.evalJs(`location.origin === ${JSON.stringify(new URL(PAGE).origin)}`);
    if (atOrigin === true) break;
  }
  await b.evalJs('(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return true; })()');
  await b.ws.send('Page.navigate', { url: PAGE });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    ready = await b.evalJs(`(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return !!inputs.find(i => i.placeholder && i.placeholder.includes('用户名'));
    })()`);
    if (ready === true) break;
  }
  if (ready !== true) return 'no-form';
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
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const done = await b.evalJs(`(() => {
      const t = document.body.innerText || '';
      return t.includes('任务中心') || t.includes('刷题打怪系统') || t.includes('操作题') || t.includes('退出登录');
    })()`);
    if (done === true) break;
  }
  return res;
}

/** 按可见文本点击（优先 button/a，找不到再按精确文本兜底） */
async function clickByText(b, text) {
  return b.evalJs(`(() => {
    const want = ${JSON.stringify(text)}.replace(/\\s+/g, '');
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    let nodes = Array.from(document.querySelectorAll('button, a')).filter(n => norm(n.textContent).includes(want));
    if (!nodes.length) nodes = Array.from(document.querySelectorAll('div, span, li')).filter(n => norm(n.textContent) === want);
    if (!nodes.length) return 'not-found';
    nodes[0].click();
    return 'clicked';
  })()`);
}

(async () => {
  const b = await launchHeadless({ userDataDir: '.tmp-chrome-gametask', port: 9461 });
  try {
    // ---------------- 学生端 ----------------
    section('学生端 · 任务中心');
    const r = await loginAs(b, 'a', '111111');
    ok('学生登录成功', r === 'submitted', r);
    await sleep(1200);

    const hasEntry = await b.evalJs(`document.body.innerText.includes('任务中心')`);
    ok('桌面出现「任务中心」入口', hasEntry === true);

    const clicked = await clickByText(b, '任务中心');
    ok('点击任务中心入口', clicked === 'clicked', clicked);
    await sleep(1500);

    const hasTab = await b.evalJs(`document.body.innerText.includes('每日任务')`);
    ok('窗口内含「每日任务」Tab', hasTab === true);

    await clickByText(b, '每日任务');
    await sleep(1800);

    const txt = await b.evalJs('document.body.innerText');
    const body = typeof txt === 'string' ? txt : '';
    ok('每日面板渲染（概览「待领取奖励」）', body.includes('待领取奖励'));
    ok('任务卡片出现（每日百题达人）', body.includes('每日百题达人'));
    ok('任务卡片出现（每日掌握）', body.includes('每日掌握'));
    ok('显示奖励说明', body.includes('积分'));

    const sw = await clickByText(b, '我的成就');
    ok('可切换到「我的成就」', sw === 'clicked', sw);
    await sleep(1000);

    // ---------------- 教师端 ----------------
    section('教师端 · 刷题打怪系统 → 任务系统');
    const r2 = await loginAs(b, 'teacher', 'xgpy666');
    ok('教师登录成功', r2 === 'submitted', r2);
    await sleep(1500);

    const mc = await clickByText(b, '刷题打怪系统');
    ok('打开「刷题打怪系统」', mc === 'clicked', mc);
    await sleep(1800);

    const tc = await clickByText(b, '任务系统');
    ok('切换到「任务系统」Tab', tc === 'clicked', tc);
    await sleep(1800);

    const t2 = await b.evalJs('document.body.innerText');
    const tbody = typeof t2 === 'string' ? t2 : '';
    ok('任务列表加载（含种子任务）', tbody.includes('每日百题达人'));
    ok('含「新建任务」按钮', tbody.includes('新建任务'));
    ok('列头含「达成条件」与「奖励」', tbody.includes('达成条件') && tbody.includes('奖励'));
    ok('显示适用班级列', tbody.includes('适用班级'));
    ok('显示启停状态', tbody.includes('启用中') || tbody.includes('已停用'));

    // ---------------- 运行期异常 ----------------
    section('运行期异常');
    const realErrs = b.jsErrors.filter((e) => !/favicon/i.test(e));
    ok('无 JS 运行期异常', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

    // 噪声白名单（与 verify_wps_op_ui / verify_access_op_ui 同口径）：
    //   favicon；登录时 Page.navigate 打断在途请求造成的 ERR_ABORTED；
    //   **未登录时**前端探测 /api/auth/session 得到的 401（该接口挂了 authenticate，401 属预期）。
    const realFails = b.netFails.filter((e) =>
      !e.includes('favicon') && !e.includes('ERR_ABORTED') && !(e.includes('401') && e.includes('/api/auth/session')));
    ok('无 4xx/5xx 网络失败', realFails.length === 0, realFails.slice(0, 3).join(' | '));
  } finally {
    await b.close();
    console.log(`\n===== 任务系统 UI 验证：${pass} 通过 / ${fail} 失败 =====`);
    process.exit(fail === 0 ? 0 : 1);
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
