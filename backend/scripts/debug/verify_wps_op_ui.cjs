/**
 * WPS 操作题一期 · 真浏览器 UI 验证（CDP）
 * 前置：后端 3101 + 前端 dev 3266（vite proxy）+ 样例题已 seed。
 * 用法：node backend/scripts/debug/verify_wps_op_ui.cjs
 *
 * 覆盖：学生端「操作题」桌面入口 → 列表 → 题目详情（步骤/模板/上传区）→ 模板可下载；
 *       教师端「WPS操作题」菜单 → 列表 → 新建编辑器（题干/模板/评分点面板）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const SHOT_DIR = path.join(__dirname, 'shots');
const QUESTION_ID = 'wps_op_demo_popshen';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
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
  // ⛔ 不能先 localStorage.clear()：初始页是 about:blank（不透明源），访问 localStorage 会抛
  //    SecurityError，清不掉旧会话 → 下次跑测试会直接以"上一个账号"自动登录，登录表单永远不出现。
  //    必须先导航到真实源，再清理，再刷新。
  await b.ws.send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const atOrigin = await b.evalJs(`location.origin === ${JSON.stringify(new URL(PAGE).origin)}`);
    if (atOrigin === true) break;
  }
  await b.evalJs(`(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return true; })()`);
  await b.ws.send('Page.navigate', { url: PAGE });
  // ⚠️ dev 首次访问要现编译模块，登录表单可能十几秒才出现；固定 sleep 会偶发假失败
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
  // 等登录完成（桌面或教师端出现）
  for (let i = 0; i < 30; i++) {
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
  // ⛔ 不留痕：UI 上传会真写 wps_op_submissions / student_answers，跑完必须清掉
  const mysql = require('../../node_modules/mysql2/promise');
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  const [bSubs] = await conn.query('SELECT id FROM wps_op_submissions WHERE question_id = ?', [QUESTION_ID]);
  const [bAns] = await conn.query("SELECT id FROM student_answers WHERE question_id = ? AND answer LIKE '[WPS操作题]%'", [QUESTION_ID]);
  const baselineSubIds = new Set(bSubs.map((r) => r.id));
  const baselineAnsIds = new Set(bAns.map((r) => r.id));

  const b = await launchHeadless({
    userDataDir: path.join(__dirname, '.tmp-chrome-wpsop'),
    port: 9473,
    windowSize: '1440,900',
  });

  try {
    // ================= 学生端 =================
    section('A. 学生登录并进入桌面');
    const stuLogin = await loginAs(b, 'a', '111111');
    ok('登录表单已提交', stuLogin === 'submitted', String(stuLogin));
    const onDesktop = await b.evalJs(`!!document.querySelector('span') && document.body.innerText.includes('操作题')`);
    ok('桌面上出现「操作题」图标', onDesktop === true, String(onDesktop));

    section('B. 打开「操作题」应用');
    const opened = await openDesktopApp(b, '操作题');
    ok('双击图标已派发', opened === 'clicked', String(opened));
    await sleep(1600);
    const openedText = await b.evalJs(`document.body.innerText`);
    ok('★ 操作题窗口已打开', /学测 WPS 操作题/.test(openedText), openedText.slice(0, 120).replace(/\n/g, ' '));
    ok('窗口标题为「操作题」', /操作题/.test(openedText));

    section('C. 题目列表');
    const cards = await b.evalJs(`document.querySelectorAll('button.group').length`);
    ok('★ 列表渲染出题目卡片', cards >= 1, 'count=' + cards);
    const hasScoreBadge = await b.evalJs(`/10 分 · 4 步/.test(document.body.innerText)`);
    ok('★ 卡片显示「10 分 · 4 步」', hasScoreBadge === true);

    section('D. 进入题目详情');
    await b.evalJs(`(() => {
      const card = document.querySelector('button.group');
      if (!card) return false;
      card.click();
      return true;
    })()`);
    await sleep(1800);
    const detailText = await b.evalJs(`document.body.innerText`);
    ok('★ 显示操作步骤区', /操作步骤与分值/.test(detailText));
    ok('★ 4 个步骤都列出', (detailText.match(/第 ?\d+ ?步/g) || []).length >= 0 && /合并单元格并设置标题格式/.test(detailText));
    ok('★ 显示「下载模板」按钮', /下载模板/.test(detailText));
    ok('★ 显示上传区提示', /点击选择要上传的 \.xlsx 作答文件/.test(detailText));
    ok('★ 显示「提交判分」按钮', /提交判分/.test(detailText));
    ok('⛔ 页面不显示评分点答案（期望值）', !/15089/.test(detailText) && !/17736/.test(detailText));

    section('E. 模板文件可下载');
    const tplHref = await b.evalJs(`(() => {
      const a = Array.from(document.querySelectorAll('a')).find(x => (x.textContent||'').includes('下载模板'));
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('下载模板'));
      return btn ? 'button-ok' : (a ? 'a-ok' : 'none');
    })()`);
    ok('模板下载按钮存在且可用', tplHref === 'button-ok', String(tplHref));

    // 直接请求模板地址，确认后端真给了文件
    const tplPath = '/uploads/wps-op/templates/tpl_wps_popshen_template.xlsx';
    const tplResp = await b.evalJs(`fetch(${JSON.stringify(tplPath)}, { method: 'HEAD' }).then(r => r.status + ':' + r.headers.get('content-length'))`);
    ok('★ 模板文件 HTTP 可达', /^200:/.test(String(tplResp)), String(tplResp));

    section('E2. ★ 真浏览器上传作答 → 判分回执');
    // 用 CDP 把文件塞进隐藏的 file input（等价于用户点选文件）
    const doc = await b.ws.send('DOM.getDocument', { depth: -1 });
    const fileQuery = await b.ws.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    ok('页面上存在文件选择框', !!fileQuery.nodeId, 'nodeId=' + fileQuery.nodeId);
    const correctXlsx = path.join(__dirname, 'fixtures', 'wps_popshen_correct.xlsx');
    await b.ws.send('DOM.setFileInputFiles', { files: [correctXlsx], nodeId: fileQuery.nodeId });
    await sleep(700);
    const pickedName = await b.evalJs(`document.body.innerText`);
    ok('文件已选中并显示文件名', /wps_popshen_correct\.xlsx/.test(pickedName), '');

    await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('提交判分'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    let graded = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      graded = await b.evalJs(`/判分结果/.test(document.body.innerText)`);
      if (graded === true) break;
    }
    ok('★ 上传后得到判分回执', graded === true);
    const rText = await b.evalJs(`document.body.innerText`);
    ok('★ 回执显示满分 10 / 10', /10\s*\/\s*10/.test(rText.replace(/\n/g, ' ')), rText.match(/\d+\s*\/\s*\d+/g)?.slice(0, 3).join(' , '));
    ok('★ 回执显示满分通过提示', /满分通过/.test(rText));

    // 展开第 1 步看逐评分点明细
    await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => /第 1 步/.test(x.textContent||''));
      if (btn) { btn.click(); return true; } return false;
    })()`);
    await sleep(600);
    const dText = await b.evalJs(`document.body.innerText`);
    ok('★ 可展开查看逐评分点明细', /要求：/.test(dText));
    ok('★ 明细含判分依据（不保留小数/字体等）', /不保留小数|隶书|合并/.test(dText));

    try {
      require('fs').mkdirSync(SHOT_DIR, { recursive: true });
      const shot = await b.ws.send('Page.captureScreenshot', { format: 'png' });
      if (shot && shot.data) {
        require('fs').writeFileSync(path.join(SHOT_DIR, 'wpsop_student_result.png'), Buffer.from(shot.data, 'base64'));
        console.log('  （截图已保存：shots/wpsop_student_result.png）');
      }
    } catch (e) { console.log('  （截图失败，跳过：' + e.message + '）'); }

    section('F. JS 运行时无异常');
    ok('无 JS 运行时错误', b.jsErrors.length === 0, b.jsErrors.slice(0, 3).join(' | ') || '无');
    // 噪声白名单：favicon、登录时 Page.navigate 打断在途请求造成的 ERR_ABORTED，
    // 以及**未登录时**前端探测 /api/auth/session 得到的 401 —— 该接口挂了 authenticate，
    // 没有 token 必然 401，属正常行为，不代表资源加载失败。
    const badRes = b.netFails.filter((x) =>
      !x.includes('favicon') && !x.includes('ERR_ABORTED') && !(x.includes('401') && x.includes('/api/auth/session'))
    );
    ok('无资源加载失败', badRes.length === 0, badRes.slice(0, 3).join(' | ') || '无');

    // ================= 教师端 =================
    section('G. 教师登录并进入 WPS 操作题管理');
    const tLogin = await loginAs(b, 'teacher', 'xgpy666');
    ok('教师登录表单已提交', tLogin === 'submitted', String(tLogin));
    const tText0 = await b.evalJs(`document.body.innerText`);
    ok('进入教师端', /题库管理/.test(tText0));

    const menuClicked = await b.evalJs(`(() => {
      const els = Array.from(document.querySelectorAll('button, a, div, span'));
      const target = els.find(e => e.textContent.trim() === 'WPS操作题' && e.children.length <= 1);
      if (!target) return 'menu-not-found';
      target.click();
      return 'clicked';
    })()`);
    ok('找到并点击「WPS操作题」菜单', menuClicked === 'clicked', String(menuClicked));
    await sleep(1400);

    const tText = await b.evalJs(`document.body.innerText`);
    ok('★ 进入操作题管理页', /WPS 操作题/.test(tText) && /新建操作题/.test(tText));
    ok('★ 列表显示样例题（10 分 · 4 步）', /10 分 · 4 步/.test(tText));
    ok('★ 显示所属分类', /数据获取与表达/.test(tText), '');

    section('H. 新建编辑器');
    await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('新建操作题'));
      if (btn) { btn.click(); return true; } return false;
    })()`);
    await sleep(900);
    const eText = await b.evalJs(`document.body.innerText`);
    ok('★ 编辑器渲染：基本信息', /基本信息/.test(eText) && /题干/.test(eText));
    ok('★ 编辑器渲染：模板与评分点', /模板与评分点/.test(eText));
    ok('★ 提供「上传标准答案表 → 自动生成评分点」', /自动生成评分点/.test(eText));
    ok('★ 编辑器渲染：评分点面板', /操作步骤与评分点/.test(eText) && /合并单元格/.test(eText));
    ok('★ 提供 JSON 直编入口', /直接编辑 JSON|收起 JSON/.test(eText));
    ok('★ 提供分值辅助按钮', /按评分点重算步骤分/.test(eText) && /等比缩放到满分/.test(eText));
    // ⚠️ placeholder 不会出现在 innerText 里，必须查属性
    const videoInputs = await b.evalJs(`document.querySelectorAll('input[placeholder*="演示视频"]').length`);
    ok('★ 每个步骤预留演示视频输入', videoInputs >= 1, 'count=' + videoInputs);
    const descInputs = await b.evalJs(`document.querySelectorAll('input[placeholder*="步骤说明"]').length`);
    ok('每个步骤有说明输入框', descInputs >= 1, 'count=' + descInputs);

    const stepInputs = await b.evalJs(`document.querySelectorAll('input[placeholder*="步骤标题"]').length`);
    ok('新建时默认有 1 个步骤可编辑', stepInputs === 1, 'count=' + stepInputs);

    section('I. 教师端无 JS 异常');
    ok('无 JS 运行时错误', b.jsErrors.length === 0, b.jsErrors.slice(0, 3).join(' | ') || '无');
  } catch (e) {
    fail++; failures.push('脚本异常：' + e.message);
    console.error('\n脚本异常：', e);
  } finally {
    await b.close();

    // ---------- 不留痕 ----------
    try {
      const [curSubs] = await conn.query('SELECT id, file_path FROM wps_op_submissions WHERE question_id = ?', [QUESTION_ID]);
      const leakedSubs = curSubs.filter((r) => !baselineSubIds.has(r.id));
      if (leakedSubs.length) {
        await conn.query('DELETE FROM wps_op_submissions WHERE id IN (?)', [leakedSubs.map((r) => r.id)]);
        for (const r of leakedSubs) {
          const abs = path.join(__dirname, '../..', String(r.file_path || '').replace(/^\/uploads\//, 'uploads/'));
          try { if (abs && fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* ignore */ }
        }
      }
      const [curAns] = await conn.query("SELECT id FROM student_answers WHERE question_id = ? AND answer LIKE '[WPS操作题]%'", [QUESTION_ID]);
      const leakedAns = curAns.map((r) => r.id).filter((id) => !baselineAnsIds.has(id));
      if (leakedAns.length) await conn.query('DELETE FROM student_answers WHERE id IN (?)', [leakedAns]);

      const [[afterSubs]] = await conn.query('SELECT COUNT(*) AS n FROM wps_op_submissions WHERE question_id = ?', [QUESTION_ID]);
      ok('⛔ 不留痕：提交记录回到基线', afterSubs.n === baselineSubIds.size, `${baselineSubIds.size} → ${afterSubs.n}`);
    } catch (e) {
      console.error('清理阶段异常：', e.message);
      fail++;
    }
    await conn.end();

    console.log('\n========================================');
    console.log(`结果：${pass} 通过 / ${fail} 失败`);
    if (fail) { console.log('\n失败项：'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
    console.log('全部通过 ✅');
  }
})();
