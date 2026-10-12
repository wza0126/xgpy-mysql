/**
 * 奖励发放（通知管理） · 真浏览器 UI 验证（CDP）
 * 前置：后端 3101 + 前端 dev 3266
 * 用法：node backend/scripts/debug/verify_reward_grant_ui.cjs
 *
 * 覆盖（教师端 · 通知管理 → 奖励发放）：
 *   · 页头「奖励发放」按钮存在
 *   · 打开模态框：4 个分区（发放范围 / 筛选条件 / 奖励 / 通知文案）
 *   · 选班级 → 候选学生出现
 *   · 预览名单（dry_run，不写库）→ 显示「候选 N 人 → 符合条件 M 人」
 *   · 关闭模态框后复位
 * 并断言无 JS 运行期异常、无 4xx/5xx
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
      return t.includes('退出登录') || t.includes('通知管理') || t.includes('操作题');
    })()`);
    if (done === true) break;
  }
  return res;
}

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
  const b = await launchHeadless({ userDataDir: '.tmp-chrome-reward', port: 9471 });
  try {
    section('教师端 · 登录并进入「通知管理」');
    const r = await loginAs(b, 'teacher', 'xgpy666');
    ok('教师登录成功', r === 'submitted', r);
    await sleep(1500);

    const nav = await clickByText(b, '通知管理');
    ok('打开「通知管理」', nav === 'clicked', nav);
    await sleep(1800);

    let t = await b.evalJs('document.body.innerText');
    let body = typeof t === 'string' ? t : '';
    ok('页面标题为「通知管理」', body.includes('通知管理'));
    ok('页头出现「奖励发放」按钮', body.includes('奖励发放'));

    // ---- 打开模态框 ----
    section('奖励发放模态框');
    const op = await clickByText(b, '奖励发放');
    ok('点击「奖励发放」', op === 'clicked', op);
    await sleep(1200);

    t = await b.evalJs('document.body.innerText');
    body = typeof t === 'string' ? t : '';
    ok('模态框标题「奖励发放」', body.includes('奖励发放'));
    ok('含「发放范围」分区', body.includes('发放范围'));
    ok('含「筛选条件」分区', body.includes('筛选条件'));
    ok('含「奖励」分区', body.includes('奖励物项') || body.includes('奖励（可组合'));
    ok('含「通知文案」分区', body.includes('通知文案'));
    ok('含「预览名单」按钮', body.includes('预览名单'));
    ok('含「发放奖励并通知」按钮', body.includes('发放奖励并通知'));
    ok('含与/或切换', body.includes('全部满足') && body.includes('任一满足'));
    ok('含「加条件」入口', body.includes('加条件'));

    // 指标下拉应含「累计掌握题数」（一次性任务口径）
    const selTxt = await b.evalJs(`(() => {
      const sels = Array.from(document.querySelectorAll('select'));
      return sels.map(s => s.textContent || '').join(' || ').slice(0, 2000);
    })()`);
    ok('指标下拉含累计口径选项', typeof selTxt === 'string' && /累计/.test(selTxt), String(selTxt).slice(0, 120));

    // ---- 选班级 → 候选学生 ----
    section('选择班级 → 候选学生');
    const classNames = JSON.parse(await b.evalJs(`(() => {
      const h = Array.from(document.querySelectorAll('h3')).find(x => (x.textContent||'').includes('发放范围'));
      const sec = h && h.closest('section');
      if (!sec) return '[]';
      const btns = Array.from(sec.querySelectorAll('button')).filter(x => (x.textContent||'').trim());
      return JSON.stringify(btns.map(x => (x.textContent||'').trim()));
    })()`) || '[]');
    ok('「发放范围」含班级可选', Array.isArray(classNames) && classNames.length > 0, 'classes=' + classNames.length);

    let candCount = 0;
    let pickedName = '';
    for (const cn of classNames) {
      const clicked = await b.evalJs(`(() => {
        const norm=(s)=>(s||'').replace(/\\s+/g,'');
        const h = Array.from(document.querySelectorAll('h3')).find(x => (x.textContent||'').includes('发放范围'));
        const sec = h && h.closest('section'); if (!sec) return 'no-section';
        const btn = Array.from(sec.querySelectorAll('button')).find(x => norm(x.textContent) === norm(${JSON.stringify(cn)}));
        if (!btn) return 'not-found';
        if ((btn.className||'').includes('bg-blue-500')) return 'already';
        btn.click(); return 'clicked';
      })()`);
      await sleep(1800);
      const cnt = await b.evalJs(`(() => { const m = (document.body.innerText||'').match(/候选学生\\s*(\\d+)\\s*人/); return m ? Number(m[1]) : 0; })()`);
      candCount = Number(cnt) || 0;
      pickedName = cn;
      if (candCount > 0) break;
    }
    ok('可点击班级并加载候选', pickedName !== '', 'picked=' + pickedName);
    ok('候选学生 > 0（该班有学生）', candCount > 0, 'candidates=' + candCount);

    // ---- 预览名单（dry_run） ----
    section('预览名单（dry_run，不写库）');
    const pv = await clickByText(b, '预览名单');
    ok('点击「预览名单」', pv === 'clicked', pv);
    await sleep(2500);
    t = await b.evalJs('document.body.innerText');
    body = typeof t === 'string' ? t : '';
    ok('显示预览结果「候选 N 人 → 符合条件 M 人」', /候选\s*\d+\s*人\s*→\s*符合条件\s*\d+\s*人/.test(body),
      (body.match(/候选\s*\d+\s*人\s*→\s*符合条件\s*\d+\s*人[^\n]*/) || [''])[0].slice(0, 80));

    // 截图
    try {
      const shot = await b.ws.send('Page.captureScreenshot', { format: 'png' });
      if (shot && shot.data) {
        const fs = require('fs');
        const path = require('path');
        const dir = path.join(__dirname, 'shots');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'reward_grant_modal.png'), Buffer.from(shot.data, 'base64'));
        ok('截图已保存 reward_grant_modal.png', true);
      }
    } catch { ok('截图已保存 reward_grant_modal.png', false, 'capture failed'); }

    // ---- 关闭 ----
    const cancel = await clickByText(b, '取消');
    ok('点击「取消」', cancel === 'clicked', cancel);
    await sleep(900);
    t = await b.evalJs('document.body.innerText');
    body = typeof t === 'string' ? t : '';
    ok('关闭后不再显示「发放奖励并通知」', !body.includes('发放奖励并通知'));

    // ---- 运行期异常 ----
    section('运行期异常');
    const realErrs = b.jsErrors.filter((e) => !/favicon/i.test(e));
    ok('无 JS 运行期异常', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

    const realFails = b.netFails.filter((e) =>
      !e.includes('favicon') && !e.includes('ERR_ABORTED') && !(e.includes('401') && e.includes('/api/auth/session')));
    ok('无 4xx/5xx 网络失败', realFails.length === 0, realFails.slice(0, 3).join(' | '));
  } finally {
    await b.close();
    console.log(`\n===== 奖励发放 UI 验证：${pass} 通过 / ${fail} 失败 =====`);
    process.exit(fail === 0 ? 0 : 1);
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
