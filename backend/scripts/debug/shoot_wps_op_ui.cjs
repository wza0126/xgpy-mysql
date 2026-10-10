/**
 * WPS 操作题一期 · 界面截图（CDP 真浏览器）
 * 前置：后端 3101 + 前端 dev 3266 + 样例题已 seed。
 * 用法：node backend/scripts/debug/shoot_wps_op_ui.cjs
 *
 * 产出（backend/scripts/debug/shots/）：
 *   wpsop_1_student_desktop.png  学生桌面（「操作题」图标位置）
 *   wpsop_2_student_list.png     学生端操作题列表
 *   wpsop_3_student_detail.png   题目详情（步骤/分值/下载模板/上传区）
 *   wpsop_4_student_result.png   判分回执（逐评分点明细）
 *   wpsop_5_teacher_menu.png     教师端左侧菜单（WPS操作题位置）
 *   wpsop_6_teacher_list.png     教师端操作题列表
 *   wpsop_7_teacher_editor.png   出题编辑器（模板 + 评分点 + 演示视频位）
 *
 * ⛔ 不留痕：跑完删掉本次产生的提交记录与上传文件。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const SHOT_DIR = path.join(__dirname, 'shots');
const QUESTION_ID = 'wps_op_demo_popshen';

const SET_VAL = `
function __setVal(el, v){
  const proto = Object.getPrototypeOf(el);
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  d.set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}`;

async function shot(b, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const r = await b.ws.send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(SHOT_DIR, name);
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`  📷 ${name}  (${kb} KB)`);
}

/** 把包含指定文字的最小元素滚到视口居中，便于截图 */
async function scrollToText(b, text) {
  return b.evalJs(`(() => {
    const all = Array.from(document.querySelectorAll('div,section,h3,h4,button'));
    let best = null;
    for (const e of all) {
      if (!(e.textContent || '').includes(${JSON.stringify(text)})) continue;
      if (!best || e.textContent.length < best.textContent.length) best = e;
    }
    if (!best) return 'not-found';
    best.scrollIntoView({ block: 'center' });
    return 'ok';
  })()`);
}

async function loginAs(b, username, password) {
  await b.ws.send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const atOrigin = await b.evalJs(`location.origin === ${JSON.stringify(new URL(PAGE).origin)}`);
    if (atOrigin === true) break;
  }
  await b.evalJs(`(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return true; })()`);
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
      const t = document.body.innerText;
      return t.includes('操作题') || t.includes('题库管理') || t.includes('退出登录');
    })()`);
    if (done) break;
  }
  return res;
}

async function openDesktopApp(b, title) {
  return b.evalJs(`(() => {
    const nodes = Array.from(document.querySelectorAll('span'));
    const target = nodes.find(n => n.textContent.trim() === ${JSON.stringify(title)});
    if (!target) return 'icon-not-found';
    target.closest('div[class*="cursor-pointer"]').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return 'clicked';
  })()`);
}

(async () => {
  const mysql = require('../../node_modules/mysql2/promise');
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  const [bSubs] = await conn.query('SELECT id FROM wps_op_submissions WHERE question_id = ?', [QUESTION_ID]);
  const [bAns] = await conn.query("SELECT id FROM student_answers WHERE question_id = ? AND answer LIKE '[WPS操作题]%'", [QUESTION_ID]);
  const baseSub = new Set(bSubs.map((r) => r.id));
  const baseAns = new Set(bAns.map((r) => r.id));

  const b = await launchHeadless({
    userDataDir: path.join(__dirname, '.tmp-chrome-wpsop-shot'),
    port: 9475,
    windowSize: '1440,900',
  });

  try {
    // ============ 学生端 ============
    console.log('\n=== 学生端 ===');
    const login = await loginAs(b, 'a', '111111');
    if (login !== 'submitted') throw new Error('学生登录失败：' + login);
    await sleep(2200);

    // 1. 桌面
    await b.evalJs(`window.dispatchEvent(new Event('resize'))`);
    await sleep(500);
    await shot(b, 'wpsop_1_student_desktop.png');

    // 2. 打开操作题 → 列表
    await openDesktopApp(b, '操作题');
    await sleep(2000);
    await shot(b, 'wpsop_2_student_list.png');

    // 3. 详情
    await b.evalJs(`(() => { const c = document.querySelector('button.group'); if (c) c.click(); return !!c; })()`);
    await sleep(1800);
    await shot(b, 'wpsop_3_student_detail.png');

    // 4. 上传 + 提交 → 判分回执
    const doc = await b.ws.send('DOM.getDocument', { depth: -1 });
    const q = await b.ws.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    if (q.nodeId) {
      await b.ws.send('DOM.setFileInputFiles', {
        files: [path.join(__dirname, 'fixtures', 'wps_popshen_correct.xlsx')], nodeId: q.nodeId,
      });
      await sleep(800);
      await b.evalJs(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('提交判分'));
        if (btn) { btn.click(); return true; } return false;
      })()`);
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        if (await b.evalJs(`/判分结果/.test(document.body.innerText)`) === true) break;
      }
      // 展开第 1 步，展示逐评分点明细
      await b.evalJs(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(x => /第 1 步/.test(x.textContent||''));
        if (btn) { btn.click(); return true; } return false;
      })()`);
      await sleep(700);
      await scrollToText(b, '判分结果');
      await sleep(600);
      await shot(b, 'wpsop_4_student_result.png');
    } else {
      console.log('  ⚠️ 未找到 file input，跳过回执截图');
    }

    // ============ 教师端 ============
    console.log('\n=== 教师端 ===');
    const tLogin = await loginAs(b, 'teacher', 'xgpy666');
    if (tLogin !== 'submitted') throw new Error('教师登录失败：' + tLogin);
    await sleep(2200);

    // 5. 左侧菜单（滚到 WPS操作题 可见）
    await scrollToText(b, 'WPS操作题');
    await sleep(700);
    await shot(b, 'wpsop_5_teacher_menu.png');

    // 6. 进入管理页
    await b.evalJs(`(() => {
      const els = Array.from(document.querySelectorAll('button, a, div, span'));
      const t = els.find(e => e.textContent.trim() === 'WPS操作题' && e.children.length <= 1);
      if (t) { t.click(); return true; } return false;
    })()`);
    await sleep(1600);
    await shot(b, 'wpsop_6_teacher_list.png');

    // 7. 编辑器
    await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('新建操作题'));
      if (btn) { btn.click(); return true; } return false;
    })()`);
    await sleep(1200);
    await scrollToText(b, '模板与评分点');
    await sleep(600);
    await shot(b, 'wpsop_7_teacher_editor.png');

    console.log('\nJS 错误：', b.jsErrors.length ? b.jsErrors.slice(0, 3) : '无');
  } catch (e) {
    console.error('\n异常：', e.message);
    process.exitCode = 1;
  } finally {
    await b.close();
    try {
      const [curSubs] = await conn.query('SELECT id, file_path FROM wps_op_submissions WHERE question_id = ?', [QUESTION_ID]);
      const leaked = curSubs.filter((r) => !baseSub.has(r.id));
      if (leaked.length) {
        await conn.query('DELETE FROM wps_op_submissions WHERE id IN (?)', [leaked.map((r) => r.id)]);
        for (const r of leaked) {
          const abs = path.join(__dirname, '../..', String(r.file_path || '').replace(/^\/uploads\//, 'uploads/'));
          try { if (abs && fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* ignore */ }
        }
      }
      const [curAns] = await conn.query("SELECT id FROM student_answers WHERE question_id = ? AND answer LIKE '[WPS操作题]%'", [QUESTION_ID]);
      const leakedAns = curAns.map((r) => r.id).filter((id) => !baseAns.has(id));
      if (leakedAns.length) await conn.query('DELETE FROM student_answers WHERE id IN (?)', [leakedAns]);
      console.log(`\n清理：删除提交 ${leaked.length} 条 / 作答 ${leakedAns.length} 条（回到基线）`);
    } catch (e) { console.error('清理异常：', e.message); }
    await conn.end();
    try { fs.rmSync(path.join(__dirname, '.tmp-chrome-wpsop-shot'), { recursive: true, force: true }); } catch { /* ignore */ }
    console.log('截图目录：' + SHOT_DIR);
  }
})();
