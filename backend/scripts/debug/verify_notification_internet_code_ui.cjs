#!/usr/bin/env node
/**
 * 奖励发放 · 上网码在学生端通知中心可见性 · 真浏览器 UI 验证（CDP）
 * ============================================================
 * 前置：后端 3101 + 前端 dev 3266
 * 用法：node backend/scripts/debug/verify_notification_internet_code_ui.cjs
 *
 * 背景：
 *   奖励发放是**异步到账**（学生不在领取现场），而通知正文是全体共享的一条，
 *   无法写入逐人不同的上网码 → 码会"发了但找不到"。
 *   故后端在学生通知接口里按通知回填 internet_codes（源：internet_codes 表），
 *   学生端通知中心需展示这些可复制的码。
 *
 * ⛔ 不污染数据库（铁律）：
 *   · 仅对单个测试学生 a 发放（student_ids 精确限定）；
 *   · 标题 `tmp_` 前缀 + id 记账双保险清理；
 *   · 上网码 finally 全量归还（置回未使用 / 清空占用字段）。
 */

'use strict';

const mysql = require('mysql2/promise');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy' };
const TITLE = 'tmp_上网码通知UI';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \u2713 ${name}${detail ? ' \u2014 ' + detail : ''}`); }
  else { fail++; console.log(`  \u2717 ${name}${detail ? ' \u2014 ' + detail : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

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
  // 学生端桌面出现的标志：任务栏通知铃铛
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const done = await b.evalJs("!!document.querySelector('i.fa-bell')");
    if (done === true) break;
  }
  return res;
}

(async () => {
  const db = await mysql.createConnection(DB);
  const createdNotifIds = [];
  const usedCodeIds = [];
  let studentId = null;
  let codes = [];

  async function cleanup() {
    try {
      if (usedCodeIds.length) {
        await db.query(
          'UPDATE internet_codes SET is_used = 0, used_by = NULL, used_at = NULL, used_by_username = NULL, source = NULL, source_id = NULL WHERE id IN (?)',
          [usedCodeIds]
        );
      }
      if (createdNotifIds.length) {
        await db.query('DELETE FROM notification_recipients WHERE notification_id IN (?)', [createdNotifIds]);
        await db.query('DELETE FROM notifications WHERE id IN (?)', [createdNotifIds]);
      }
      // 兜底：按标题前缀再清一次（不依赖记账 id）
      await db.query('DELETE FROM notification_recipients WHERE notification_id IN (SELECT id FROM notifications WHERE title = ?)', [TITLE]);
      await db.query('DELETE FROM notifications WHERE title = ?', [TITLE]);
    } catch (e) {
      console.error('  [cleanup] ' + e.message);
    }
    try { await db.end(); } catch { /* ignore */ }
  }

  const b = await launchHeadless({ userDataDir: '.tmp-chrome-notifcode', port: 9472 });
  try {
    // ---------- 准备 / 造数 ----------
    section('准备：教师发一条带上网码的奖励通知');
    const teacherToken = await login('teacher', 'xgpy666');
    ok('教师登录成功', !!teacherToken);

    const [prs] = await db.query("SELECT id FROM profiles WHERE username = 'a' AND role = 'student' LIMIT 1");
    ok('找到测试学生 a', prs.length === 1);
    if (!prs.length) throw new Error('缺少测试学生');
    studentId = prs[0].id;

    const [[sr]] = await db.query('SELECT COUNT(*) AS c FROM internet_codes WHERE is_used = 0');
    ok('有可用上网码库存', Number(sr.c) > 0, 'avail=' + sr.c);

    const r = await req('/api/teacher/rewards/grant', {
      method: 'POST', token: teacherToken,
      body: {
        dry_run: false,
        scope: { class_ids: [], student_ids: [studentId] },
        title: TITLE,
        content: '上课表现优秀',
        conditions: [{ metric: 'total_correct', op: 'gte', value: 0 }],
        rewards: [{ type: 'internet_code', value: 1 }],
      },
    });
    ok('发放上网码 → 200', r.status === 200, JSON.stringify(r.body).slice(0, 160));
    const nid = r.body?.data?.notification_id;
    if (nid) createdNotifIds.push(nid);

    const [cs] = await db.query(
      "SELECT id, code FROM internet_codes WHERE source = 'notification' AND source_id = ?",
      [String(nid)]
    );
    ok('上网码已标记占用', cs.length === 1, JSON.stringify(cs));
    codes = cs.map((x) => x.code);
    cs.forEach((x) => usedCodeIds.push(x.id));

    // ---------- 学生端 UI ----------
    section('学生端 · 通知中心看到上网码');
    const lr = await loginAs(b, 'a', '111111');
    ok('学生登录成功', lr === 'submitted', lr);
    await sleep(1500);

    const bell = await b.evalJs("!!document.querySelector('i.fa-bell')");
    ok('任务栏出现通知铃铛（学生身份）', bell === true);

    const clicked = await b.evalJs(`(() => {
      const i = document.querySelector('i.fa-bell');
      const btn = i && i.closest('button');
      if (!btn) return 'no-btn';
      btn.click();
      return 'clicked';
    })()`);
    ok('点击铃铛打开通知中心', clicked === 'clicked', clicked);
    await sleep(2000);

    let body = await b.evalJs('document.body.innerText');
    body = typeof body === 'string' ? body : '';
    ok('通知中心显示该奖励通知', body.includes(TITLE), body.slice(0, 100));
    ok('页面出现「上网码」字样', /上网码/.test(body));
    ok('页面出现「可选中复制」提示', /可选中复制/.test(body));
    if (codes.length) {
      ok('页面出现具体上网码文本', body.includes(codes[0]), codes[0]);
    }

    // 截图
    try {
      const shot = await b.ws.send('Page.captureScreenshot', { format: 'png' });
      if (shot && shot.data) {
        const fs = require('fs');
        const path = require('path');
        const dir = path.join(__dirname, 'shots');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'student_notification_internet_code.png'), Buffer.from(shot.data, 'base64'));
        ok('截图已保存 student_notification_internet_code.png', true);
      }
    } catch { ok('截图已保存 student_notification_internet_code.png', false, 'capture failed'); }

    // ---------- 运行期异常 ----------
    section('运行期异常');
    const realErrs = b.jsErrors.filter((e) => !/favicon/i.test(e));
    ok('无 JS 运行期异常', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

    const realFails = b.netFails.filter((e) =>
      !e.includes('favicon') && !e.includes('ERR_ABORTED') && !(e.includes('401') && e.includes('/api/auth/session')));
    ok('无 4xx/5xx 网络失败', realFails.length === 0, realFails.slice(0, 3).join(' | '));
  } catch (e) {
    console.error('\n[异常] ' + (e && e.stack ? e.stack : e));
    fail++;
  } finally {
    await cleanup();
    await b.close();
    console.log(`\n===== 上网码通知可见性 UI 验证：${pass} 通过 / ${fail} 失败 =====`);
    process.exit(fail === 0 ? 0 : 1);
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
