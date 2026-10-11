/**
 * 游戏化任务系统 · 真浏览器 UI 验证（CDP）
 * 前置：后端 3101 + 前端 dev 3266
 * 用法：node backend/scripts/debug/verify_game_task_ui.cjs
 *
 * 覆盖：
 *   学生端：桌面「任务中心」入口 → 顶层 Tab（课堂任务 / 每日任务 / 成就殿堂）
 *           · 入口红点 与 Tab 角标（每日→daily / 成就→once）须与 pending-count 接口一致
 *           · 每日任务：概览 + 任务卡片
 *           · 成就殿堂：完成度环 + 系列筛选 + 成就卡（含系列名）
 *   教师端：「刷题打怪系统」→「任务系统」Tab → 任务列表 / 达成条件 / 奖励 / **系列** / 适用班级
 *           · **多选与批量操作**：表头全选 + 每行复选框 + 批量启用/停用/删除栏（只读断言，不点批量按钮）
 *   并断言无 JS 运行期异常、无 4xx/5xx
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
    // ---------------- 学生端 · 每日任务 ----------------
    section('学生端 · 任务中心 → 每日任务');
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
    const hasAchTab = await b.evalJs(`document.body.innerText.includes('成就殿堂')`);
    ok('窗口内含「成就殿堂」Tab', hasAchTab === true);

    // ---- Tab 角标（红点拆分）：每日任务 → daily；成就殿堂 → once；须与接口一致 ----
    const badgeRaw = await b.evalJs(`(async () => {
      try {
        const tk = localStorage.getItem('xgpy_token');
        const r = await fetch('/api/student/daily-tasks/pending-count', { headers: { Authorization: 'Bearer ' + tk } });
        const j = await r.json();
        const d = (j && j.data) || {};
        const btns = Array.from(document.querySelectorAll('button')).filter(x => /每日任务|成就殿堂/.test(x.textContent || ''));
        const read = (label) => {
          const btn = btns.find(x => (x.textContent || '').includes(label));
          if (!btn) return { found: false };
          const pill = btn.querySelector('span.bg-red-500');
          return { found: true, hasPill: !!pill, n: pill ? pill.textContent.trim() : null };
        };
        return JSON.stringify({ count: d.count, daily: d.daily, once: d.once, dailyTab: read('每日任务'), achTab: read('成就殿堂') });
      } catch (e) { return 'ERR:' + e.message; }
    })()`);
    let badge = {};
    try { badge = JSON.parse(badgeRaw); } catch (e) { badge = {}; }
    const expPill = (v) => (v > 99 ? '99+' : String(v));
    ok('每日任务 Tab 角标与接口一致（0 则不显示）',
      !!(badge.dailyTab && badge.dailyTab.found) &&
      (badge.daily > 0
        ? (badge.dailyTab.hasPill === true && badge.dailyTab.n === expPill(badge.daily))
        : badge.dailyTab.hasPill === false),
      `daily=${badge.daily} pill=${JSON.stringify(badge.dailyTab)}`);
    ok('成就殿堂 Tab 角标与接口一致（0 则不显示）',
      !!(badge.achTab && badge.achTab.found) &&
      (badge.once > 0
        ? (badge.achTab.hasPill === true && badge.achTab.n === expPill(badge.once))
        : badge.achTab.hasPill === false),
      `once=${badge.once} pill=${JSON.stringify(badge.achTab)}`);
    ok('角标语义：总数 = 每日 + 成就',
      badge.count === badge.daily + badge.once,
      `count=${badge.count} daily=${badge.daily} once=${badge.once}`);

    await clickByText(b, '每日任务');
    await sleep(1800);

    const txt = await b.evalJs('document.body.innerText');
    const body = typeof txt === 'string' ? txt : '';
    ok('每日面板渲染（概览「待领取奖励」）', body.includes('待领取奖励'));
    ok('每日面板第三卡为「今日已领取」', body.includes('今日已领取'));
    ok('任务卡片出现（每日百题达人）', body.includes('每日百题达人'));
    ok('任务卡片出现（每日掌握）', body.includes('每日掌握'));
    ok('显示奖励说明', body.includes('积分'));

    // ---------------- 学生端 · 成就殿堂 ----------------
    section('学生端 · 成就殿堂');
    const goAch = await clickByText(b, '成就殿堂');
    ok('切换到「成就殿堂」', goAch === 'clicked', goAch);
    await sleep(1800);

    const at = await b.evalJs('document.body.innerText');
    const abody = typeof at === 'string' ? at : '';
    ok('成就殿堂渲染（完成度）', abody.includes('成就完成度'));
    ok('概览含「已点亮成就」', abody.includes('已点亮成就'));
    ok('概览含「可领取奖励」', abody.includes('可领取奖励'));
    ok('系列筛选含「答题达人」', abody.includes('答题达人'));
    ok('系列筛选含「对战王者」', abody.includes('对战王者'));
    // 成就是教师可编辑内容（可启停/删除），故**不锁定具体成就名**，只断言卡片状态文案
    ok('成就卡带状态文案（已点亮/领取/继续努力）', /已点亮|领取奖励|继续努力/.test(abody));

    const achCards = await b.evalJs(`document.querySelectorAll('div.relative.flex.flex-col.items-center.text-center').length`);
    ok('成就卡网格有卡片', typeof achCards === 'number' && achCards >= 1, 'cards=' + achCards);

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
    ok('任务列表加载（含每日种子任务）', tbody.includes('每日百题达人'));
    ok('任务列表加载（含预置成就）', tbody.includes('初出茅庐') || tbody.includes('题海之王'));
    ok('含「新建任务」按钮', tbody.includes('新建任务'));
    ok('列头含「系列」', tbody.includes('系列'));
    ok('列头含「达成条件」与「奖励」', tbody.includes('达成条件') && tbody.includes('奖励'));
    ok('显示适用班级列', tbody.includes('适用班级'));
    ok('显示启停状态', tbody.includes('启用中') || tbody.includes('已停用'));

    // ---- 多选与批量操作（**只读断言**：只勾选，绝不点击批量按钮，避免改动真实任务）----
    const hasHeadCb = await b.evalJs(`(() => {
      const ths = Array.from(document.querySelectorAll('th'));
      return ths.some(th => th.querySelector('input[type=checkbox]'));
    })()`);
    ok('表头含全选复选框', hasHeadCb === true);

    const rowCbCount = await b.evalJs(`document.querySelectorAll('tbody input[type=checkbox]').length`);
    ok('每行含复选框', typeof rowCbCount === 'number' && rowCbCount >= 1, 'rows=' + rowCbCount);

    ok('未选中时不显示批量操作栏', tbody.includes('批量删除') === false);

    // 勾选第一行 → 批量操作栏应出现
    await b.evalJs(`(() => { const cb = document.querySelector('tbody input[type=checkbox]'); if (cb) cb.click(); return true; })()`);
    await sleep(700);
    const barTxt = await b.evalJs('document.body.innerText');
    const bb = typeof barTxt === 'string' ? barTxt : '';
    ok('勾选后出现「已选 N 个任务」', bb.includes('已选'));
    ok('批量栏含「批量启用」', bb.includes('批量启用'));
    ok('批量栏含「批量停用」', bb.includes('批量停用'));
    ok('批量栏含「批量删除」', bb.includes('批量删除'));

    // 全选 → 勾选数应等于行数，且与「已选 N」一致
    await b.evalJs(`(() => { const head = document.querySelector('th input[type=checkbox]'); if (head) head.click(); return true; })()`);
    await sleep(700);
    const countsRaw = await b.evalJs(`(() => {
      const rows = document.querySelectorAll('tbody input[type=checkbox]').length;
      const checked = document.querySelectorAll('tbody input[type=checkbox]:checked').length;
      const m = (document.body.innerText || '').match(/已选\\s*(\\d+)\\s*个任务/);
      return JSON.stringify({ rows, checked, shown: m ? Number(m[1]) : null });
    })()`);
    let cf = {};
    try { cf = JSON.parse(countsRaw); } catch (e) { cf = {}; }
    ok('全选后所有行均勾选', cf.rows > 0 && cf.checked === cf.rows, JSON.stringify(cf));
    ok('「已选 N」与勾选数一致', cf.shown === cf.checked, JSON.stringify(cf));

    // 取消选择 → 批量栏消失
    await clickByText(b, '取消选择');
    await sleep(700);
    const barGone = await b.evalJs(`document.body.innerText.includes('批量删除')`);
    ok('取消选择后批量栏消失', barGone === false);

    // 打开新建表单 → 选「一次性成就」应校验指标口径切换
    const openNew = await clickByText(b, '新建任务');
    ok('打开「新建任务」表单', openNew === 'clicked', openNew);
    await sleep(600);
    const pickOnce = await b.evalJs(`(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const l = labels.find(x => (x.textContent || '').includes('一次性成就'));
      if (!l) return 'not-found';
      const radio = l.querySelector('input[type=radio]');
      if (!radio) return 'no-radio';
      radio.click();
      return 'clicked';
    })()`);
    ok('可切换为「一次性成就」', pickOnce === 'clicked', pickOnce);
    await sleep(800);
    const metricTxt = await b.evalJs(`(() => {
      const sels = Array.from(document.querySelectorAll('select'));
      const s = sels.map(x => x.textContent || '').find(t => t.includes('累计'));
      return s ? s.slice(0, 120) : 'no-cumulative-options';
    })()`);
    ok('切一次性后指标下拉为累计口径', typeof metricTxt === 'string' && metricTxt.includes('累计'),
      String(metricTxt).slice(0, 80));

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
