/**
 * WPS 操作题 · 真浏览器 UI 验证（CDP）
 * 前置：后端 3101 + 前端 dev 3266（vite proxy）+ 样例题已 seed。
 * 用法：node backend/scripts/debug/verify_wps_op_ui.cjs
 *
 * 覆盖：学生端「操作题」桌面入口 → WPS/Access 分段 → 列表（满分 100 + 多模板）
 *       → 题目详情（步骤/多模板下载/上传区）→ 真上传判分 → 逐评分点明细；
 *       教师端「WPS/ACCESS」菜单 → 题库管理 / 练习情况 / Access 分段（已接线）
 *       → 新建编辑器（题干/多模板上传/评分点面板/每步视频上传）。
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

/** 点一个文本精确匹配的按钮/元素 */
async function clickByText(b, text) {
  return b.evalJs(`(() => {
    const els = Array.from(document.querySelectorAll('button, a, div, span'));
    const target = els.find(e => e.textContent.trim() === ${JSON.stringify(text)} && e.children.length <= 1);
    if (!target) return 'not-found';
    target.click();
    return 'clicked';
  })()`);
}

(async () => {
  // ⛔ 不留痕：UI 上传会真写 wps_op_submissions / student_answers，跑完必须清掉
  const mysql = require('../../node_modules/mysql2/promise');
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  // ⚠️ 基线/兜底/断言全部限定「测试学生 a」：运行期间真实用户可能正在提交本题，
  //    全表差集兜底会把别人的提交当泄漏删掉（2026-10-10 误删事故）。
  const [[stuRow]] = await conn.query("SELECT id FROM profiles WHERE username = 'a' LIMIT 1");
  const STU_ID = stuRow ? stuRow.id : null;
  const [bSubs] = await conn.query('SELECT id FROM wps_op_submissions WHERE question_id = ? AND student_id = ?', [QUESTION_ID, STU_ID]);
  const [bAns] = await conn.query("SELECT id FROM student_answers WHERE question_id = ? AND student_id = ? AND answer LIKE '[WPS操作题]%'", [QUESTION_ID, STU_ID]);
  const baselineSubIds = new Set(bSubs.map((r) => r.id));
  const baselineAnsIds = new Set(bAns.map((r) => r.id));
  const baselineMySubs = baselineSubIds.size;
  /** 题干分块临时改动的备份（非 null 表示库里还挂着临时数据，必须在 finally 还原） */
  let stemPatchBackup = null;

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
    ok('★ 操作题窗口已打开', /WPS 操作题/.test(openedText), openedText.slice(0, 120).replace(/\n/g, ' '));
    ok('窗口标题为「操作题」', /操作题/.test(openedText));

    section('B2. ★ 学生端 WPS / Access 分段');
    ok('★ 有「WPS 操作题」分段', /WPS 操作题/.test(openedText));
    ok('★ 有「Access 操作题」分段', /Access 操作题/.test(openedText));
    const accClick = await clickByText(b, 'Access 操作题');
    ok('可切到 Access 分段', accClick === 'clicked', String(accClick));
    await sleep(900);
    const accText = await b.evalJs(`document.body.innerText`);
    ok('★ Access 段已接线（不再是占位）', /Access 操作题/.test(accText) && !/还在准备中/.test(accText), accText.slice(0, 160).replace(/\n/g, ' '));
    await clickByText(b, 'WPS 操作题');
    await sleep(700);

    // ★ 题干分块：临时给样例题挂两段题干视频（跑完立刻还原，finally 里还有兜底还原）
    //    —— 验证学生端题面是按块渲染的、视频能在题干里就地播放
    {
      const [[origRow]] = await conn.query('SELECT wps_spec FROM questions WHERE id = ?', [QUESTION_ID]);
      stemPatchBackup = { raw: origRow.wps_spec };
      const stemSpec = { ...(JSON.parse(origRow.wps_spec || '{}') || {}) };
      stemSpec.stem_blocks = [
        { type: 'text', html: '<p>【题干分块校验】下载模板并完成下列操作：</p>' },
        { type: 'text', html: '<p>1. 导入外部数据到 A3:D18。</p>' },
        { type: 'video', title: '第 1 步演示', urls: ['/uploads/wps-op/videos/stem-verify-1.mp4'] },
        { type: 'text', html: '<p>2. 用公式计算环比增幅。</p>' },
        { type: 'image', title: '第 2 步图示', urls: ['/uploads/wps-op/images/stem-verify-1.png'] },
        { type: 'video', urls: ['https://cdn.invalid.example/stem-verify-2.mp4'] },
      ];
      await conn.query('UPDATE questions SET wps_spec = ? WHERE id = ?', [JSON.stringify(stemSpec), QUESTION_ID]);
    }

    section('C. 题目列表');
    const cards = await b.evalJs(`document.querySelectorAll('button.group').length`);
    ok('★ 列表渲染出题目卡片', cards >= 1, 'count=' + cards);
    const listText = await b.evalJs(`document.body.innerText`);
    ok('★ 卡片显示「100 分 · 4 步」（满分已改 100）', /100 分 · 4 步/.test(listText), listText.slice(0, 200).replace(/\n/g, ' '));
    ok('★ 卡片标注模板数量（多模板）', /2 个模板/.test(listText));

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
    ok('★ 4 个步骤都列出', /合并单元格并设置标题格式/.test(detailText));
    ok('★ 显示「下载模板文件」步骤', /第 1 步：下载模板文件/.test(detailText));
    ok('★ 显示上传区提示', /点击选择要上传的 \.xlsx 作答文件/.test(detailText));
    ok('★ 显示「提交判分」按钮', /提交判分/.test(detailText));
    ok('⛔ 页面不显示评分点答案（期望值）', !/15089/.test(detailText) && !/17736/.test(detailText));

    section('D2. ★ 题干分块渲染（老师原题每一步的视频就挂在题面上）');
    ok('★ 题面按「题干分块」渲染（文字块 + 视频块都在）',
      /【题干分块校验】/.test(detailText) && /第 1 步演示/.test(detailText),
      detailText.slice(0, 160).replace(/\n/g, ' '));
    const stemPlayBtns = await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('看演示视频')).length`);
    ok('★ 每个题干视频块给出「看演示视频」按钮', stemPlayBtns >= 2, 'count=' + stemPlayBtns);
    await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('看演示视频'));
      if (btn) { btn.click(); return true; } return false;
    })()`);
    await sleep(600);
    const stemVideoInfo = await b.evalJs(`(() => {
      const v = Array.from(document.querySelectorAll('video')).find(x => /stem-verify-1\\.mp4/.test(x.getAttribute('src')||''));
      return v ? (v.getAttribute('src') + '|controls=' + v.hasAttribute('controls')) : 'none';
    })()`);
    ok('★ 题干视频内嵌 <video>（同源 /uploads，机房断网也能播）',
      /stem-verify-1\.mp4/.test(String(stemVideoInfo)) && /controls=true/.test(String(stemVideoInfo)),
      String(stemVideoInfo));

    // ---- 题干图片块：默认收起（点击才显示）→ 展开后内嵌 <img> ----
    ok('★ 图片块标题显示在题面上（第 2 步图示）', /第 2 步图示/.test(detailText));
    const stemImgBtns = await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('看图示')).length`);
    ok('★ 每个题干图片块给出「看图示」按钮', stemImgBtns >= 1, 'count=' + stemImgBtns);
    const imgClosed = await b.evalJs(`Array.from(document.querySelectorAll('img')).filter(x => /stem-verify-1\\.png/.test(x.getAttribute('src')||'')).length`);
    ok('★ 默认收起：图片块不渲染 <img>（题面不被图撑长）', imgClosed === 0, 'n=' + imgClosed);
    await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('看图示'));
      if (btn) { btn.click(); return true; } return false;
    })()`);
    await sleep(600);
    const stemImgInfo = await b.evalJs(`(() => {
      const im = Array.from(document.querySelectorAll('img')).find(x => /stem-verify-1\\.png/.test(x.getAttribute('src')||''));
      return im ? im.getAttribute('src') : 'none';
    })()`);
    ok('★ 点开后题干图片内嵌显示（同源 /uploads）',
      /stem-verify-1\.png/.test(String(stemImgInfo)), String(stemImgInfo));

    // 立刻还原（finally 里还有兜底）
    {
      await conn.query('UPDATE questions SET wps_spec = ? WHERE id = ?', [stemPatchBackup.raw, QUESTION_ID]);
      const [[back]] = await conn.query('SELECT wps_spec FROM questions WHERE id = ?', [QUESTION_ID]);
      ok('⛔ 题干分块临时数据已还原（不留痕）', String(back.wps_spec) === String(stemPatchBackup.raw));
      stemPatchBackup = null;
    }

    section('E. 多模板文件可分别下载');
    const tplButtons = await b.evalJs(`(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('下载 '));
      return btns.map(x => x.textContent.trim());
    })()`);
    ok('★ 有两个模板下载按钮（xlsx + txt）', Array.isArray(tplButtons) && tplButtons.length === 2, JSON.stringify(tplButtons));
    ok('★ 含 xlsx 模板下载按钮', /人口密度数据分析表\.xlsx/.test(String(tplButtons)), JSON.stringify(tplButtons));
    ok('★ 含 txt 数据源下载按钮（有些题要从 txt 导入数据）', /人口数据源\.txt/.test(String(tplButtons)), JSON.stringify(tplButtons));

    const tplResp = await b.evalJs(`fetch('/uploads/wps-op/templates/tpl_wps_popshen_template.xlsx', { method: 'HEAD' }).then(r => r.status + ':' + r.headers.get('content-length'))`);
    ok('★ xlsx 模板文件 HTTP 可达', /^200:/.test(String(tplResp)), String(tplResp));
    const txtResp = await b.evalJs(`fetch('/uploads/wps-op/templates/tpl_wps_popshen_data.txt', { method: 'HEAD' }).then(r => r.status + ':' + r.headers.get('content-length'))`);
    ok('★ txt 数据源 HTTP 可达', /^200:/.test(String(txtResp)), String(txtResp));

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
    ok('★ 回执显示满分 100 / 100', /100\s*\/\s*100/.test(rText.replace(/\n/g, ' ')), rText.match(/\d+\s*\/\s*\d+/g)?.slice(0, 3).join(' , '));
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

    // ★ 提交记录可点击回看：点记录名称 → 弹窗显示这一次的判分明细（不必趁热记，可反复看）
    const hisBtnCount = await b.evalJs(`document.querySelectorAll('button[title="查看这一次判分的详细情况"]').length`);
    ok('★ 提交后出现「我的提交记录」，且记录名称可点', hisBtnCount >= 1, 'count=' + hisBtnCount);
    const openedModal = await b.evalJs(`(() => {
      const btn = document.querySelector('button[title="查看这一次判分的详细情况"]');
      if (!btn) return 'not-found';
      btn.click();
      return 'clicked';
    })()`);
    await sleep(600);
    const modalText = async () => b.evalJs(`(() => { const el = document.querySelector('.fixed.inset-0.z-50'); return el ? el.innerText : ''; })()`);
    const mBefore = await modalText();
    ok('★ 点记录名称弹出「这次判分详情」', openedModal === 'clicked' && /这次判分详情/.test(String(mBefore)) && /第\s*1\s*步/.test(String(mBefore)), String(openedModal));
    const mStepOpen = await b.evalJs(`(() => {
      const box = document.querySelector('.fixed.inset-0.z-50');
      if (!box) return 'no-modal';
      // ⚠️ 模板字符串里 \s 会被当转义吃掉 → 这里只能用字面空格
      const btn = Array.from(box.querySelectorAll('button')).find(x => /第 1 步/.test(x.textContent||''));
      if (!btn) return 'no-step';
      btn.click(); return 'clicked';
    })()`);
    await sleep(500);
    const mAfter = await modalText();
    ok('★ 弹窗内可展开逐评分点明细（要求 / 实际）', mStepOpen === 'clicked' && /要求：/.test(String(mAfter)), String(mStepOpen));
    ok('★ 弹窗内含该次得分', /\d+\s*\/\s*\d+/.test(String(mAfter).replace(/\n/g, ' ')));

    try {
      require('fs').mkdirSync(SHOT_DIR, { recursive: true });
      const shot2 = await b.ws.send('Page.captureScreenshot', { format: 'png' });
      if (shot2 && shot2.data) {
        require('fs').writeFileSync(path.join(SHOT_DIR, 'wpsop_student_history_modal.png'), Buffer.from(shot2.data, 'base64'));
        console.log('  （截图已保存：shots/wpsop_student_history_modal.png）');
      }
    } catch (e) { console.log('  （弹窗截图失败，跳过：' + e.message + '）'); }

    const closed = await b.evalJs(`(() => {
      const btn = document.querySelector('.fixed.inset-0.z-50 button[title="关闭"]');
      if (!btn) return 'not-found';
      btn.click();
      return 'clicked';
    })()`);
    await sleep(400);
    const afterClose = await b.evalJs(`(() => { const el = document.querySelector('.fixed.inset-0.z-50'); return el ? el.innerText : ''; })()`);
    ok('★ 弹窗可关闭（关闭后详情弹窗消失）', closed === 'clicked' && !/这次判分详情/.test(String(afterClose)), String(closed));

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
      // ★ D2 段故意写的"假视频/假图片路径"：只验证题干里的 <video>/<img> 接线（src/controls），
      //   仓库里不放真 mp4/png，所以这些 404 是测试自造的，不算缺陷。
      && !x.includes('stem-verify-1.mp4')
      && !x.includes('stem-verify-1.png')
    );
    ok('无资源加载失败', badRes.length === 0, badRes.slice(0, 3).join(' | ') || '无');

    // ================= 教师端 =================
    section('G. 教师登录并进入 WPS/ACCESS 管理');
    const tLogin = await loginAs(b, 'teacher', 'xgpy666');
    ok('教师登录表单已提交', tLogin === 'submitted', String(tLogin));
    const tText0 = await b.evalJs(`document.body.innerText`);
    ok('进入教师端', /题库管理/.test(tText0));

    const menuClicked = await clickByText(b, 'WPS/ACCESS');
    ok('★ 左侧菜单名已改为「WPS/ACCESS」并点击成功', menuClicked === 'clicked', String(menuClicked));
    await sleep(1400);

    const tText = await b.evalJs(`document.body.innerText`);
    ok('★ 进入操作题管理页', /WPS \/ ACCESS 操作题/.test(tText) && /新建操作题/.test(tText));
    ok('★ 有 WPS / Access 一级分段', /WPS 操作题/.test(tText) && /Access 操作题/.test(tText));
    ok('★ 有「题库管理」「练习情况」二级页签', /题库管理/.test(tText) && /练习情况/.test(tText));
    ok('★ 列表显示样例题（100 分 · 4 步）', /100 分 · 4 步/.test(tText), '');
    ok('★ 列表显示模板数/视频数标注', /模板 2/.test(tText) && /视频 \d+ 条/.test(tText));
    // 列表分类已按要求换成数字序号
    ok('★ 列表显示数字序号（不再显示分类）', /(^|\n)\s*1\s*(\n| )/.test(tText) && !/数据获取与表达/.test(tText), '');

    section('G2. ★ 教师端 Access 分段');
    const tAccClick = await clickByText(b, 'Access 操作题');
    ok('可切到 Access 分段', tAccClick === 'clicked', String(tAccClick));
    await sleep(900);
    const tAccText = await b.evalJs(`document.body.innerText`);
    ok('★ 教师端 Access 段已接线（不再是占位）', /新建操作题/.test(tAccText) && !/（占位）/.test(tAccText), tAccText.slice(0, 200).replace(/\n/g, ' '));
    await clickByText(b, 'WPS 操作题');
    await sleep(900);

    section('G3. ★ 练习情况页签（最高分矩阵 + 总分）');
    const anaClick = await clickByText(b, '练习情况');
    ok('可切到「练习情况」', anaClick === 'clicked', String(anaClick));
    let anaText = '';
    for (let i = 0; i < 20; i++) {
      await sleep(600);
      anaText = await b.evalJs(`document.body.innerText`);
      if (/全卷满分/.test(anaText) || /练习情况/.test(anaText)) break;
    }
    ok('★ 练习情况页渲染', /全卷满分/.test(anaText), anaText.slice(0, 200).replace(/\n/g, ' '));
    ok('★ 说明口径「每题取该生最高分」', /每题取该生最高分/.test(anaText));
    ok('★ 表头含 账号 姓名 / 总分 / 已做', /账号 姓名/.test(anaText) && /总分/.test(anaText) && /已做/.test(anaText));
    ok('★ 表尾含「每题平均」统计行', /每题平均/.test(anaText));
    const anaRows = await b.evalJs(`document.querySelectorAll('table tbody tr').length`);
    ok('★ 学生名单有数据行', anaRows >= 1, 'rows=' + anaRows);
    ok('★ 有班级筛选下拉', /全部班级/.test(anaText));
    // 回到题库管理（⚠️ 左侧边栏也有「题库管理」，必须排除深色侧边栏那一项，
    //                否则会点到侧边栏 → 直接跳去 QuestionBank 页，编辑器根本不会出现）
    const backBank = await b.evalJs(`(() => {
      const els = Array.from(document.querySelectorAll('button'));
      const target = els.find(e => e.textContent.trim() === '题库管理' && !e.closest('[class*="bg-gray-900"]'));
      if (!target) return 'not-found';
      target.click();
      return 'clicked';
    })()`);
    ok('可切回「题库管理」', backBank === 'clicked', String(backBank));
    await sleep(900);

    section('G4. ★ 题干分块：教师端回读 + 保存不得静默丢视频');
    {
      // 曾经的 bug：题干视频块用 urls[]/url，编辑器却拿 normalizeVideos()（只认 video_urls/video_url）
      // 回读 → 视频块被当成"空块"丢掉 → 老师一按保存视频就没了。这里把这条链路钉死。
      const [[origRow]] = await conn.query('SELECT content, wps_spec FROM questions WHERE id = ?', [QUESTION_ID]);
      stemPatchBackup = { raw: origRow.wps_spec, content: origRow.content };
      const spec2 = { ...(JSON.parse(origRow.wps_spec || '{}') || {}) };
      spec2.stem_blocks = [
        { type: 'text', html: '<p>【回读校验】下载模板并完成下列操作。</p>' },
        { type: 'video', title: '第 1 步演示', urls: ['/uploads/wps-op/videos/stem-verify-1.mp4'] },
        { type: 'text', html: '<p>1. 导入外部数据到 A3:D18。</p>' },
        { type: 'video', urls: ['/uploads/wps-op/videos/stem-verify-2.mp4'] },
        { type: 'image', title: '第 2 步图示', urls: ['/uploads/wps-op/images/stem-verify-1.png'] },
      ];
      await conn.query('UPDATE questions SET wps_spec = ? WHERE id = ?', [JSON.stringify(spec2), QUESTION_ID]);

      // ⚠️ 左导航里也有同名菜单「题库管理」→ 必须排除 <nav> 内的元素，否则会跳到普通题库页（不是 WPS/ACCESS）
      await clickByText(b, 'WPS/ACCESS');
      await sleep(1600);
      const tabClicked = await b.evalJs(`(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(x => x.textContent.trim() === '题库管理' && !x.closest('nav'));
        if (!btns.length) return 'not-found';
        btns[0].click();
        return 'clicked';
      })()`);
      ok('回到「题库管理」页签', tabClicked === 'clicked', String(tabClicked));
      await sleep(800);
      // ⛔ 必须让列表重新拉一次：直接改库不会刷新已挂载组件的 rows，
      //    切一次分段（Access → WPS）会触发 load()，否则拿到的是改动前的旧 spec。
      await clickByText(b, 'Access 操作题');
      await sleep(1200);
      await clickByText(b, 'WPS 操作题');
      await sleep(1500);
      const editClicked = await b.evalJs(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).filter(x => x.textContent.trim() === '编辑' && !x.closest('nav'))[0];
        if (btn) { btn.click(); return 'clicked'; } return 'not-found';
      })()`);
      ok('可打开样例题编辑器', editClicked === 'clicked', String(editClicked));
      await sleep(1800);
      const gText = await b.evalJs('document.body.innerText');
      const vBlocks = await b.evalJs(`Array.from(document.querySelectorAll('span')).filter(s => s.textContent.trim() === '视频块').length`);
      ok('★ 编辑器回读题干视频块（不再被当成空块丢掉）', vBlocks === 2, 'count=' + vBlocks);
      ok('★ 回读后标注「视频 2 条」', /视频 2 条/.test(gText), (gText.match(/视频 \d+ 条/) || [''])[0]);
      ok('★ 两条视频地址都列出来了', /stem-verify-1\.mp4/.test(gText) && /stem-verify-2\.mp4/.test(gText));
      // 标题在 <input> 里，innerText 读不到，必须读 value
      const titleVals = await b.evalJs(`Array.from(document.querySelectorAll('input')).filter(i => (i.placeholder||'').includes('这块视频的说明')).map(i => i.value)`);
      ok('★ 视频块标题保留（第 1 步演示）', titleVals.includes('第 1 步演示'), JSON.stringify(titleVals));

      // ---- 题干图片块（与视频块用两组不同键，回读/保存都不能丢） ----
      const iBlocks = await b.evalJs(`Array.from(document.querySelectorAll('span')).filter(s => s.textContent.trim() === '图片块').length`);
      ok('★ 编辑器回读题干图片块', iBlocks === 1, 'count=' + iBlocks);
      ok('★ 回读后标注「图片 1 张」', /图片 1 张/.test(gText), (gText.match(/图片 \d+ 张/) || [''])[0]);
      // 图片块不显示地址文本（显示的是缩略图），所以断言读 <img src> 而不是 innerText
      const imgSrcs = await b.evalJs(`Array.from(document.querySelectorAll('img')).map(x => x.getAttribute('src')||'').filter(s => /stem-verify-1\\.png/.test(s))`);
      ok('★ 图片地址读回来了（编辑器用同源地址渲染缩略图）',
        Array.isArray(imgSrcs) && imgSrcs.length === 1, JSON.stringify(imgSrcs));
      const imgTitleVals = await b.evalJs(`Array.from(document.querySelectorAll('input')).filter(i => (i.placeholder||'').includes('这块图的说明')).map(i => i.value)`);
      ok('★ 图片块标题保留（第 2 步图示）', imgTitleVals.includes('第 2 步图示'), JSON.stringify(imgTitleVals));
      ok('★ 图片块提供「上传本地图片 / 抓取外链到本地 / 粘贴地址」三件套',
        /上传本地图片/.test(gText) && /抓取外链到本地/.test(gText) && /粘贴地址/.test(gText));
      ok('★ 题干区提供「+ 图片块」与「＋图片」快速插入入口',
        (await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => ['图片块','＋图片'].includes((x.textContent||'').trim())).length`)) >= 2);

      await b.evalJs(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === '保存');
        if (btn) { btn.click(); return true; } return false;
      })()`);
      let backToList = false;
      for (let i = 0; i < 24; i++) {
        await sleep(500);
        if (/新建操作题/.test(await b.evalJs('document.body.innerText'))) { backToList = true; break; }
      }
      ok('保存后回到题库列表', backToList === true);

      const [[afterSave]] = await conn.query('SELECT wps_spec FROM questions WHERE id = ?', [QUESTION_ID]);
      const aSpec = JSON.parse(afterSave.wps_spec || '{}');
      const savedVideos = (aSpec.stem_blocks || []).filter((x) => x.type === 'video')
        .reduce((n, x) => n + (Array.isArray(x.urls) ? x.urls.length : 0), 0);
      ok('⛔ 保存后题干视频仍在（不再静默丢视频）', savedVideos === 2, 'videos=' + savedVideos);
      const savedImages = (aSpec.stem_blocks || []).filter((x) => x.type === 'image')
        .reduce((n, x) => n + (Array.isArray(x.urls) ? x.urls.length : 0), 0);
      ok('⛔ 保存后题干图片仍在（视频/图片两组键都不能丢）', savedImages === 1, 'images=' + savedImages);
      const savedImgTitle = (aSpec.stem_blocks || []).find((x) => x.type === 'image')?.title;
      ok('⛔ 保存后图片块标题未丢', savedImgTitle === '第 2 步图示', String(savedImgTitle));
      const savedTexts = (aSpec.stem_blocks || []).filter((x) => x.type === 'text').length;
      ok('保存后文字块仍在（content 由文字块拼出）', savedTexts === 2, 'texts=' + savedTexts);

      await conn.query('UPDATE questions SET content = ?, wps_spec = ? WHERE id = ?', [stemPatchBackup.content, stemPatchBackup.raw, QUESTION_ID]);
      const [[bk]] = await conn.query('SELECT content, wps_spec FROM questions WHERE id = ?', [QUESTION_ID]);
      ok('⛔ 题干分块临时数据已还原（不留痕）',
        String(bk.wps_spec) === String(stemPatchBackup.raw) && String(bk.content) === String(stemPatchBackup.content));
      stemPatchBackup = null;
    }

    section('H. 新建编辑器');
    await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('新建操作题'));
      if (btn) { btn.click(); return true; } return false;
    })()`);
    await sleep(900);
    const eText = await b.evalJs(`document.body.innerText`);
    ok('★ 编辑器渲染：基本信息', /基本信息/.test(eText) && /题干/.test(eText));
    ok('★ 编辑器渲染：模板文件与评分点', /模板文件与评分点/.test(eText));
    ok('★ 提供「上传模板文件（可多选）」', /上传模板文件（可多选）/.test(eText));
    ok('★ 提示支持 txt 数据源', /数据源/.test(eText) && /txt/.test(eText));
    ok('★ 提供「上传标准答案表 → 自动生成评分点」', /自动生成评分点/.test(eText));
    ok('★ 编辑器渲染：评分点面板', /操作步骤与评分点/.test(eText) && /合并单元格/.test(eText));
    ok('★ 提供 JSON 直编入口', /直接编辑 JSON|收起 JSON/.test(eText));
    ok('★ 提供分值辅助按钮', /按评分点重算步骤分/.test(eText) && /等比缩放到满分/.test(eText));

    // ★ 题干分块：演示视频 / 图示可以挂在「老师原题的每一步」上，而不是只能挂在自动生成的评分步骤上
    ok('★ 题干改为「分块」编辑（文字块 + 视频块 + 图片块）',
      /题干分块/.test(eText) && /文字块/.test(eText) && /视频块/.test(eText) && /图片块/.test(eText));
    ok('★ 题干区提供「+ 图片块」入口（还能在任意块后用「＋图片」插到某一步下面）', /图片块/.test(eText));
    const stemVideoBtnBefore = await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('上传本地视频')).length`);
    const addStemVideo = await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').trim() === '视频块');
      if (!btn) return 'not-found';
      btn.click();
      return 'clicked';
    })()`);
    await sleep(500);
    const stemVideoBtnAfter = await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('上传本地视频')).length`);
    ok('★ 点「+ 视频块」后多出一个题干视频位（上传/抓取/粘贴三入口齐备）',
      addStemVideo === 'clicked' && stemVideoBtnAfter === stemVideoBtnBefore + 1,
      `${stemVideoBtnBefore} → ${stemVideoBtnAfter}`);
    ok('★ 空视频块提示「保存时会自动丢掉」', /保存时会自动丢掉/.test(await b.evalJs('document.body.innerText')));

    // ---- 图片块：点「+ 图片块」后应出现「上传本地图片 / 抓取外链到本地 / 粘贴地址」三入口 ----
    const stemImgBtnBefore = await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('上传本地图片')).length`);
    const addStemImage = await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').trim() === '图片块');
      if (!btn) return 'not-found';
      btn.click();
      return 'clicked';
    })()`);
    await sleep(500);
    const hImgText = await b.evalJs('document.body.innerText');
    const stemImgBtnAfter = await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('上传本地图片')).length`);
    ok('★ 点「+ 图片块」后多出一个题干图片位（上传/抓取/粘贴三入口齐备）',
      addStemImage === 'clicked' && stemImgBtnAfter === stemImgBtnBefore + 1,
      `${stemImgBtnBefore} → ${stemImgBtnAfter}`);
    ok('★ 图片块标注支持格式（png / jpg / gif / webp / bmp）', /支持 png \/ jpg \/ gif \/ webp \/ bmp/.test(hImgText));
    ok('★ 空图片块提示「学生端点看图示展开 / 保存时会自动丢掉」',
      /看图示/.test(hImgText) && /保存时会自动丢掉/.test(hImgText));

    const stemTyped = await b.evalJs(`(() => {
      ${SET_VAL}
      const ta = Array.from(document.querySelectorAll('textarea')).find(t => (t.placeholder||'').includes('下载'));
      if (!ta) return 'no-textarea';
      __setVal(ta, '<p>下载模板，按下列要求操作并保存。</p><p>1. 导入外部数据到 A3:D18。</p><p>2. 用公式计算环比增幅。</p>');
      return 'set';
    })()`);
    ok('★ 题干文字块可粘整段题干（支持简单 HTML）', stemTyped === 'set', String(stemTyped));
    await sleep(400);
    const splitClicked = await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('按步骤拆块'));
      if (!btn) return 'not-found';
      btn.click();
      return 'clicked';
    })()`);
    await sleep(600);
    const afterSplit = await b.evalJs(`({
      text: Array.from(document.querySelectorAll('span')).filter(s => s.textContent.trim() === '文字块').length,
      video: Array.from(document.querySelectorAll('span')).filter(s => s.textContent.trim() === '视频块').length,
      order: Array.from(document.querySelectorAll('span')).filter(s => ['文字块','视频块'].includes(s.textContent.trim())).map(s => s.textContent.trim()).join('>'),
    })`);
    ok('★ 「按步骤拆块」拆成 说明块 + 每步文字块，并给每一步自动留视频位',
      splitClicked === 'clicked' && afterSplit.text === 3 && afterSplit.video === 3,
      JSON.stringify(afterSplit));
    ok('★ 块顺序即渲染顺序（文字块在前、视频位跟在对应的步骤块后）',
      String(afterSplit.order).startsWith('文字块>文字块>视频块>文字块>视频块'),
      String(afterSplit.order));

    // 满分默认 100
    const fullScoreVal = await b.evalJs(`(() => {
      const lab = Array.from(document.querySelectorAll('label')).find(l => (l.textContent||'').includes('满分（默认 100）'));
      if (!lab) return 'no-label';
      const box = lab.parentElement.querySelector('input[type=number]');
      return box ? String(box.value) : 'no-input';
    })()`);
    ok('★ 新建时默认满分 100', fullScoreVal === '100', String(fullScoreVal));

    // 每步视频：★ 一个步骤可挂多条 —— 上传 / 抓取 / 粘贴 三个入口 + 条数标注
    const videoUpBtns = await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('上传本地视频')).length`);
    ok('★ 提供「上传本地视频」按钮（机房断网兜底）', videoUpBtns >= 1, 'count=' + videoUpBtns);
    const videoFetchBtns = await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('抓取外链到本地')).length`);
    ok('★ 提供「抓取外链到本地」按钮', videoFetchBtns >= 1, 'count=' + videoFetchBtns);
    const videoPasteBtns = await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('粘贴地址')).length`);
    ok('★ 提供「粘贴地址」直接加一条视频', videoPasteBtns >= 1, 'count=' + videoPasteBtns);
    ok('★ 提示"同一操作可挂多条视频"', /同一操作可挂/.test(eText) && /多条/.test(eText));
    ok('★ 每步有视频条数标注', /演示视频/.test(eText) && /\d+ 条/.test(eText));
    const videoInputAccept = await b.evalJs(`(() => { const i = Array.from(document.querySelectorAll('input[type=file]')).find(x => (x.accept||'').startsWith('video')); return i ? i.accept : 'none'; })()`);
    ok('★ 视频文件选择框只收视频', String(videoInputAccept).startsWith('video'), String(videoInputAccept));
    const tplInputAccept = await b.evalJs(`(() => { const i = Array.from(document.querySelectorAll('input[type=file]')).find(x => (x.accept||'').includes('.txt')); return i ? (i.accept + '|multiple=' + i.multiple) : 'none'; })()`);
    ok('★ 模板文件选择框支持 txt 且可多选', /\.txt/.test(String(tplInputAccept)) && /multiple=true/.test(String(tplInputAccept)), String(tplInputAccept));

    const descInputs = await b.evalJs(`document.querySelectorAll('input[placeholder*="步骤说明"]').length`);
    ok('每个步骤有说明输入框', descInputs >= 1, 'count=' + descInputs);

    const stepInputs = await b.evalJs(`document.querySelectorAll('input[placeholder*="步骤标题"]').length`);
    ok('新建时默认有 1 个步骤可编辑', stepInputs === 1, 'count=' + stepInputs);

    // 评分点类型下拉里必须能选到新增四类
    // ⚠️ 编辑器里第一个 <select> 是「所属分类」（章节），评分点那个要按选项内容找
    const kindOptions = await b.evalJs(`(() => {
      const sels = Array.from(document.querySelectorAll('select'));
      const sel = sels.find(s => Array.from(s.options).some(o => o.textContent.trim() === '合并单元格'));
      if (!sel) return { found: false, all: sels.map(s => Array.from(s.options).map(o => o.textContent.trim()).join('/')) };
      return { found: true, options: Array.from(sel.options).map(o => o.textContent.trim()) };
    })()`);
    const kindText = JSON.stringify(kindOptions.options || kindOptions.all || []);
    ok('★ 找到评分点类型下拉', kindOptions.found === true, JSON.stringify(kindOptions).slice(0, 200));
    ok('★ 评分点类型含「排序」', /排序/.test(kindText), kindText.slice(0, 160));
    ok('★ 评分点类型含「自动筛选」', /自动筛选/.test(kindText));
    ok('★ 评分点类型含「分类汇总」', /分类汇总/.test(kindText));
    ok('★ 评分点类型含「条件格式」', /条件格式/.test(kindText));
    // 2026-10-10 依 88 道真题补齐的五类
    ok('★ 评分点类型含「底纹填充色」', /底纹填充色/.test(kindText));
    ok('★ 评分点类型含「区域边框」', /区域边框/.test(kindText));
    ok('★ 评分点类型含「列宽」', /列宽/.test(kindText));
    ok('★ 评分点类型含「行高」', /行高/.test(kindText));
    ok('★ 评分点类型含「函数计算」', /函数计算/.test(kindText));
    ok('★ 对齐项已扩展为「水平/垂直」', /水平\/垂直/.test(kindText));
    ok('★ 数字格式项已扩展「类型/小数位」', /类型\/小数位/.test(kindText));
    ok('★ 评分点类型共 25 种', (kindOptions.options || []).length === 25, 'n=' + (kindOptions.options || []).length);

    // 字段级断言：选中「图表」后必须出现进阶字段（图例位置 / 数据标签 / 轴标题 / 系列产生在行）
    const chartSel = await b.evalJs(`(() => {
      const sels = Array.from(document.querySelectorAll('select'));
      const sel = sels.find(s => Array.from(s.options).some(o => o.textContent.trim() === '合并单元格'));
      if (!sel) return 'no-sel';
      const opt = Array.from(sel.options).find(o => o.textContent.trim() === '图表');
      if (!opt) return 'no-opt';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    ok('可把评分点类型切到「图表」', chartSel === 'ok', String(chartSel));
    await sleep(500);
    const panelText = await b.evalJs(`document.body.innerText`);
    ok('★ 选「图表」后出现进阶字段（图例位置/数据标签/轴标题/系列方向）',
      /图例位置/.test(panelText) && /数据标签/.test(panelText) && /轴标题/.test(panelText) && /系列产生在行/.test(panelText));

    section('I. 教师端无 JS 异常');
    ok('无 JS 运行时错误', b.jsErrors.length === 0, b.jsErrors.slice(0, 3).join(' | ') || '无');
  } catch (e) {
    fail++; failures.push('脚本异常：' + e.message);
    console.error('\n脚本异常：', e);
  } finally {
    await b.close();

    // ---------- 不留痕 ----------
    try {
      // 题干分块临时数据兜底还原（正常流程在 D2 / G4 段末尾已经还原并把备份置空）
      if (stemPatchBackup) {
        await conn.query('UPDATE questions SET wps_spec = ? WHERE id = ?', [stemPatchBackup.raw, QUESTION_ID]);
        if (stemPatchBackup.content !== undefined) {
          await conn.query('UPDATE questions SET content = ? WHERE id = ?', [stemPatchBackup.content, QUESTION_ID]);
        }
        const [[r2]] = await conn.query('SELECT content, wps_spec FROM questions WHERE id = ?', [QUESTION_ID]);
        ok('⛔ 不留痕：样例题题干分块临时数据已还原（兜底路径）',
          String(r2.wps_spec) === String(stemPatchBackup.raw)
          && (stemPatchBackup.content === undefined || String(r2.content) === String(stemPatchBackup.content)));
        stemPatchBackup = null;
      }
      const [curSubs] = await conn.query('SELECT id, student_id, file_path FROM wps_op_submissions WHERE question_id = ?', [QUESTION_ID]);
      const leakedSubs = curSubs.filter((r) => r.student_id === STU_ID && !baselineSubIds.has(r.id));
      if (leakedSubs.length) {
        await conn.query('DELETE FROM wps_op_submissions WHERE id IN (?)', [leakedSubs.map((r) => r.id)]);
        for (const r of leakedSubs) {
          const abs = path.join(__dirname, '../..', String(r.file_path || '').replace(/^\/uploads\//, 'uploads/'));
          try { if (abs && fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* ignore */ }
        }
      }
      const [curAns] = await conn.query("SELECT id, student_id FROM student_answers WHERE question_id = ? AND answer LIKE '[WPS操作题]%'", [QUESTION_ID]);
      const leakedAns = curAns.filter((r) => r.student_id === STU_ID).map((r) => r.id).filter((id) => !baselineAnsIds.has(id));
      if (leakedAns.length) await conn.query('DELETE FROM student_answers WHERE id IN (?)', [leakedAns]);

      const [postSubs] = await conn.query('SELECT id FROM wps_op_submissions WHERE question_id = ? AND student_id = ?', [QUESTION_ID, STU_ID]);
      const subLeak = postSubs.map((r) => r.id).filter((id) => !baselineSubIds.has(id));
      ok('⛔ 不留痕：本次提交记录已清理（差集）', subLeak.length === 0, `leak=${subLeak.length}`);
      const [postAns] = await conn.query("SELECT id FROM student_answers WHERE question_id = ? AND student_id = ? AND answer LIKE '[WPS操作题]%'", [QUESTION_ID, STU_ID]);
      const ansLeak = postAns.map((r) => r.id).filter((id) => !baselineAnsIds.has(id));
      ok('⛔ 不留痕：本次答题记录已清理（差集）', ansLeak.length === 0, `leak=${ansLeak.length}`);
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
