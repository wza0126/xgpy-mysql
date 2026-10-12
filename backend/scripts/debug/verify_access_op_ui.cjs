/**
 * Access 操作题 · 真浏览器 UI 验证（CDP）
 * 前置：后端 3101 + 前端 dev 3266（vite proxy）+ 样例题已 seed（seed_access_op_sample.cjs）
 * 用法：node backend/scripts/debug/verify_access_op_ui.cjs
 *
 * 覆盖（学生端与教师端的 Access 段**都已接线**，不再是占位）：
 *   学生端：桌面「操作题」→ 「Access 操作题」分段 → 列表 → 题目详情（步骤/多模板下载/
 *           .accdb 上传区/另交附件区）→ 真上传 .accdb 判分 → 逐评分点明细 → 切回 WPS 不炸
 *   教师端：「WPS/ACCESS」→「Access 操作题」分段 → 题库管理（样例题/模板数）→ 练习情况
 *           → 新建编辑器（9 种 accdb 评分点 / .accdb 模板后缀 / 「上传标准答案库」）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const SHOT_DIR = path.join(__dirname, 'shots');
const QUESTION_ID = 'access_op_demo_winter';

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
  //    SecurityError，清不掉旧会话 → 下次跑测试会直接以"上一个账号"自动登录。
  //    必须先导航到真实源，再清理，再刷新。
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

/** 点一个文本精确匹配的按钮/元素。⚠️ 必须优先 BUTTON/A：
 *  仅含一个按钮的 DIV 包裹层 textContent 也等于按钮文字，若不优先会点到 DIV（不触发 onClick）。 */
async function clickByText(b, text) {
  return b.evalJs(`(() => {
    const els = Array.from(document.querySelectorAll('button, a, div, span'));
    const matches = els.filter(e => e.textContent.trim() === ${JSON.stringify(text)} && e.children.length <= 1);
    if (!matches.length) return 'not-found';
    const target = matches.find(e => e.tagName === 'BUTTON' || e.tagName === 'A') || matches[matches.length - 1];
    target.click();
    return 'clicked';
  })()`);
}

/** 找「题库管理 / 练习情况」这类页签按钮（排除深色侧边栏里的同名项） */
async function clickTab(b, text) {
  return b.evalJs(`(() => {
    const els = Array.from(document.querySelectorAll('button'));
    const target = els.find(e => e.textContent.trim() === ${JSON.stringify(text)} && !e.closest('[class*="bg-gray-900"]'));
    if (!target) return 'not-found';
    target.click();
    return 'clicked';
  })()`);
}

/** 把一份文件塞进「accept 含某后缀」的隐藏 file input（等价于用户点选文件） */
async function setFileInput(b, acceptIncludes, absPath) {
  const doc = await b.ws.send('DOM.getDocument', { depth: -1 });
  const nodeIds = await b.evalJsWithNodeIds(acceptIncludes);
  void doc;
  return nodeIds;
}

(async () => {
  // ⛔ 不留痕：UI 上传会真写 wps_op_submissions / student_answers，跑完必须清掉
  const mysql = require('../../node_modules/mysql2/promise');
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  // ⚠️ 基线/兜底/断言全部限定「测试学生 a」：运行期间真实用户可能正在提交本题，
  //    全表差集兜底会把别人的提交当泄漏删掉（2026-10-10 误删事故）。
  const [[stuRow]] = await conn.query("SELECT id FROM profiles WHERE username = 'a' LIMIT 1");
  const STU_ID = stuRow ? stuRow.id : null;
  const [bSubs] = await conn.query("SELECT id FROM wps_op_submissions WHERE kind='access' AND question_id = ? AND student_id = ?", [QUESTION_ID, STU_ID]);
  const [bAns] = await conn.query("SELECT id FROM student_answers WHERE question_id = ? AND student_id = ? AND answer LIKE '[Access操作题]%'", [QUESTION_ID, STU_ID]);
  const baselineSubIds = new Set(bSubs.map((r) => r.id));
  const baselineAnsIds = new Set(bAns.map((r) => r.id));

  const b = await launchHeadless({
    userDataDir: path.join(__dirname, '.tmp-chrome-accop'),
    port: 9481,
    windowSize: '1440,900',
  });

  try {
    // ================= 学生端 =================
    section('A. 学生登录并进入桌面');
    const stuLogin = await loginAs(b, 'a', '111111');
    ok('登录表单已提交', stuLogin === 'submitted', String(stuLogin));
    const onDesktop = await b.evalJs(`document.body.innerText.includes('操作题')`);
    ok('桌面上出现「操作题」图标', onDesktop === true, String(onDesktop));

    section('B. 打开「操作题」并切到 Access 分段');
    const opened = await openDesktopApp(b, '操作题');
    ok('双击图标已派发', opened === 'clicked', String(opened));
    await sleep(1600);
    const openedText = await b.evalJs(`document.body.innerText`);
    ok('★ 操作题窗口已打开（WPS 段）', /WPS 操作题/.test(openedText), openedText.slice(0, 100).replace(/\n/g, ' '));

    const accClick = await clickByText(b, 'Access 操作题');
    ok('★ 可切到「Access 操作题」分段', accClick === 'clicked', String(accClick));
    await sleep(1200);
    const accText = await b.evalJs(`document.body.innerText`);
    ok('★ Access 段已接线（不再是占位）', /Access 操作题/.test(accText) && !/还在准备中/.test(accText), accText.slice(0, 160).replace(/\n/g, ' '));

    section('C. ★ Access 题目列表');
    const cards = await b.evalJs(`document.querySelectorAll('button.group').length`);
    ok('★ 列表渲染出题目卡片', cards >= 1, 'count=' + cards);
    const listText = await b.evalJs(`document.body.innerText`);
    ok('★ 卡片显示「100 分 · 4 步」', /100 分 · 4 步/.test(listText), listText.slice(0, 200).replace(/\n/g, ' '));
    ok('★ 卡片标注模板数量（空白库 + 数据源）', /2 个模板/.test(listText));
    // 分类已按要求换成数字序号（列表里显示分类没效果 → 显示 1/2/3… 序号徽章）
    ok('★ 卡片显示数字序号（1 号卡片）', /(^|\n)\s*1\s*(\n|$)/.test(listText) || /1\s*2022北京冬奥会\.accdb/.test(listText.replace(/\n/g, ' ')), listText.slice(0, 200).replace(/\n/g, ' '));
    ok('★ 列表不再显示分类（cluster 文案消失）', !/信息系统的设计与开发|未分类/.test(listText));

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
    ok('★ 4 个步骤都列出', /步骤1 导入数据建表/.test(detailText));
    ok('★ 显示「下载模板文件」步骤', /第 1 步：下载模板文件/.test(detailText));
    ok('★ 上传区提示针对 .accdb', /点击选择要上传的 \.accdb 作答库/.test(detailText));
    ok('★ 提示用 Access 保存（不要加密）', /文件 → 保存/.test(detailText));
    ok('★ 显示「提交判分」按钮', /提交判分/.test(detailText));
    ok('★ Access 段提供「另交的附件」区（导出题预留）', /另交的附件/.test(detailText));
    ok('⛔ 页面不显示评分点检查器名（答案泄露兜底）', !/accdb_rows|accdb_sort/.test(detailText));

    section('E. 多模板文件可分别下载');
    const tplButtons = await b.evalJs(`(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('下载 '));
      return btns.map(x => x.textContent.trim());
    })()`);
    ok('★ 有两个模板下载按钮（accdb + xlsx）', Array.isArray(tplButtons) && tplButtons.length === 2, JSON.stringify(tplButtons));
    ok('★ 含空白库 .accdb 下载按钮', /2022北京冬奥会\.accdb/.test(String(tplButtons)), JSON.stringify(tplButtons));
    ok('★ 含数据源 .xlsx 下载按钮', /2022北京冬奥会奖牌榜\.xlsx/.test(String(tplButtons)), JSON.stringify(tplButtons));

    const dbResp = await b.evalJs(`fetch('/uploads/access-op/templates/tpl_access_winter_blank.accdb', { method: 'HEAD' }).then(r => r.status + ':' + r.headers.get('content-length'))`);
    ok('★ 空白库模板 HTTP 可达', /^200:/.test(String(dbResp)), String(dbResp));
    const xlsxResp = await b.evalJs(`fetch('/uploads/access-op/templates/tpl_access_winter_medals.xlsx', { method: 'HEAD' }).then(r => r.status + ':' + r.headers.get('content-length'))`);
    ok('★ xlsx 数据源 HTTP 可达', /^200:/.test(String(xlsxResp)), String(xlsxResp));

    section('E2. ★ 真浏览器上传 .accdb → 判分回执');
    // 只挑「收 .accdb」的那个 file input（页面还有一个收附件的）
    const pick = await b.evalJs(`(() => {
      const inputs = Array.from(document.querySelectorAll('input[type=file]'));
      return inputs.map((x, i) => i + ':' + (x.accept || '')).join(' | ');
    })()`);
    ok('存在收 .accdb 的文件选择框', /\.accdb/.test(String(pick)), String(pick));

    const nodeId = await b.ws.send('Runtime.evaluate', {
      expression: `(() => {
        const inputs = Array.from(document.querySelectorAll('input[type=file]'));
        const i = inputs.findIndex(x => (x.accept || '').includes('.accdb'));
        return i;
      })()`,
      returnByValue: true,
    });
    const idx = nodeId.result.value;
    ok('可定位到 .accdb 文件选择框', typeof idx === 'number' && idx >= 0, 'index=' + idx);

    const doc = await b.ws.send('DOM.getDocument', { depth: -1 });
    const q = await b.ws.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    ok('DOM 里能取到文件选择框', Array.isArray(q.nodeIds) && q.nodeIds.length >= 1, 'n=' + (q.nodeIds || []).length);
    const correctAccdb = path.join(__dirname, 'fixtures', 'access_winter_olympic_ok.accdb');
    await b.ws.send('DOM.setFileInputFiles', { files: [correctAccdb], nodeId: q.nodeIds[idx] });
    await sleep(700);
    const pickedName = await b.evalJs(`document.body.innerText`);
    ok('文件已选中并显示文件名', /access_winter_olympic_ok\.accdb/.test(pickedName), '');

    await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('提交判分'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    let graded = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      graded = await b.evalJs(`/判分结果/.test(document.body.innerText)`);
      if (graded === true) break;
    }
    ok('★ 上传后得到判分回执', graded === true);
    const rText = await b.evalJs(`document.body.innerText`);
    ok('★ 回执显示满分 100 / 100', /100\s*\/\s*100/.test(rText.replace(/\n/g, ' ')), rText.match(/\d+\s*\/\s*\d+/g)?.slice(0, 3).join(' , '));
    ok('★ 回执显示满分通过提示', /满分通过/.test(rText));

    // 提交记录提供「下载」入口：下载上次提交的文件 → 修改后可再次上传
    ok('★ 出现「我的提交记录」区', /我的提交记录/.test(rText));
    const dlBtn = await b.evalJs(`(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(x => (x.textContent || '').includes('下载'));
      return btns.some(x => x.textContent.includes('下载') && !x.textContent.includes('下载 ')) || btns.length > 2;
    })()`);
    ok('★ 提交记录带「下载」链接', dlBtn === true);

    // 展开第 1 步看逐评分点明细
    await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => /第 1 步/.test(x.textContent||''));
      if (btn) { btn.click(); return true; } return false;
    })()`);
    await sleep(600);
    const dText = await b.evalJs(`document.body.innerText`);
    ok('★ 可展开查看逐评分点明细', /要求：/.test(dText));
    ok('★ 明细含判分依据（表/字段名与顺序）', /存在表|字段名与顺序|奖牌榜/.test(dText));

    // ★ 提交记录可点击回看：Access 端同款（两端共用同一学生端组件）
    const accHisBtn = await b.evalJs(`document.querySelectorAll('button[title="查看这一次判分的详细情况"]').length`);
    ok('★ Access 提交记录名称可点（回看判分明细）', accHisBtn >= 1, 'count=' + accHisBtn);
    const accOpen = await b.evalJs(`(() => {
      const btn = document.querySelector('button[title="查看这一次判分的详细情况"]');
      if (!btn) return 'not-found';
      btn.click(); return 'clicked';
    })()`);
    await sleep(600);
    const accModal = await b.evalJs(`(() => { const el = document.querySelector('.fixed.inset-0.z-50'); return el ? el.innerText : ''; })()`);
    ok('★ Access 点记录名称弹出「这次判分详情」',
      accOpen === 'clicked' && /这次判分详情/.test(String(accModal)) && /第 1 步/.test(String(accModal)), String(accOpen));
    await b.evalJs(`(() => { const btn = document.querySelector('.fixed.inset-0.z-50 button[title="关闭"]'); if (btn) btn.click(); return true; })()`);
    await sleep(400);

    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const shot = await b.ws.send('Page.captureScreenshot', { format: 'png' });
      if (shot && shot.data) {
        fs.writeFileSync(path.join(SHOT_DIR, 'accop_student_result.png'), Buffer.from(shot.data, 'base64'));
        console.log('  （截图已保存：shots/accop_student_result.png）');
      }
    } catch (e) { console.log('  （截图失败，跳过：' + e.message + '）'); }

    section('E3. 切回 WPS 段不炸（同窗口共存）');
    await clickByText(b, '返回列表');
    await sleep(800);
    await clickByText(b, 'WPS 操作题');
    await sleep(1200);
    const backWps = await b.evalJs(`document.body.innerText`);
    ok('★ 切回 WPS 段仍正常渲染', /WPS 操作题/.test(backWps) && /另存为 \.xlsx/.test(backWps) && !/Access 操作题：/.test(backWps), backWps.slice(0, 120).replace(/\n/g, ' '));

    section('F. 学生端 JS 运行时无异常');
    ok('无 JS 运行时错误', b.jsErrors.length === 0, b.jsErrors.slice(0, 3).join(' | ') || '无');
    const badRes = b.netFails.filter((x) =>
      !x.includes('favicon') && !x.includes('ERR_ABORTED') && !(x.includes('401') && x.includes('/api/auth/session'))
    );
    ok('无资源加载失败', badRes.length === 0, badRes.slice(0, 3).join(' | ') || '无');

    // ================= 教师端 =================
    section('G. 教师登录并进入 WPS/ACCESS 管理');
    const tLogin = await loginAs(b, 'teacher', 'xgpy666');
    ok('教师登录表单已提交', tLogin === 'submitted', String(tLogin));
    const tText0 = await b.evalJs(`document.body.innerText`);
    ok('进入教师端', /题库管理/.test(tText0));

    const menuClicked = await clickByText(b, 'WPS/ACCESS');
    ok('★ 左侧菜单「WPS/ACCESS」点击成功', menuClicked === 'clicked', String(menuClicked));
    await sleep(1400);

    const tAccClick = await clickByText(b, 'Access 操作题');
    ok('★ 教师端可切到「Access 操作题」分段', tAccClick === 'clicked', String(tAccClick));
    await sleep(1200);
    const tAccText = await b.evalJs(`document.body.innerText`);
    ok('★ 教师端 Access 段已接线（不再是占位）', /新建操作题/.test(tAccText) && !/（占位）/.test(tAccText), tAccText.slice(0, 200).replace(/\n/g, ' '));
    ok('★ 列出 Access 样例题（100 分 · 4 步）', /100 分 · 4 步/.test(tAccText), '');
    ok('★ 显示模板数 / 视频数标注', /模板 2/.test(tAccText) && /视频 \d+ 条/.test(tAccText));
    // 列表分类已换成数字序号（序号徽章 1）
    ok('★ 题库行首显示数字序号徽章', /(^|\n)\s*1\s*(\n| )/.test(tAccText) && !/信息系统的设计与开发/.test(tAccText), '');

    section('G2. ★ Access 练习情况页签');
    const anaClick = await clickTab(b, '练习情况');
    ok('可切到「练习情况」', anaClick === 'clicked', String(anaClick));
    let anaText = '';
    for (let i = 0; i < 20; i++) {
      await sleep(600);
      anaText = await b.evalJs(`document.body.innerText`);
      if (/全卷满分/.test(anaText)) break;
    }
    ok('★ Access 练习情况页渲染', /全卷满分/.test(anaText), anaText.slice(0, 200).replace(/\n/g, ' '));
    ok('★ 说明口径「每题取该生最高分」', /每题取该生最高分/.test(anaText));
    ok('★ 表头含 账号 姓名 / 总分 / 已做', /账号 姓名/.test(anaText) && /总分/.test(anaText) && /已做/.test(anaText));
    const anaExportName = await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('导出 CSV'));
      return btn ? 'found' : 'missing';
    })()`);
    ok('★ 提供「导出 CSV」（文件名按 Access 区分）', anaExportName === 'found', anaExportName);

    const backBank = await clickTab(b, '题库管理');
    ok('可切回「题库管理」', backBank === 'clicked', String(backBank));
    await sleep(900);

    section('H. 新建 Access 编辑器');
    await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('新建操作题'));
      if (btn) { btn.click(); return true; } return false;
    })()`);
    await sleep(900);
    const eText = await b.evalJs(`document.body.innerText`);
    ok('★ 编辑器渲染：基本信息 / 模板文件与评分点', /基本信息/.test(eText) && /模板文件与评分点/.test(eText));
    ok('★ 编辑页标注当前类型为 Access', /Access 操作题/.test(eText));
    ok('★ 提供「上传标准答案库 → 自动生成评分点」', /上传标准答案库 → 自动生成评分点/.test(eText));
    ok('★ 提示 .accdb 空白库 + xlsx 数据源', /\.accdb\/\.mdb/.test(eText) && /数据源/.test(eText));
    ok('★ 编辑器渲染：评分点面板', /操作步骤与评分点/.test(eText));
    // ★ 题干分块（文字块/视频块/图片块）是 WPS 与 Access 共用的编辑器：Access 端也要能插图片
    const accAddImg = await b.evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').trim() === '图片块');
      if (!btn) return 'not-found';
      btn.click();
      return 'clicked';
    })()`);
    await sleep(500);
    const accImgText = await b.evalJs('document.body.innerText');
    ok('★ Access 题干可插入图片块（上传本地图片 / 抓取外链到本地 / 粘贴地址）',
      accAddImg === 'clicked'
      && /上传本地图片/.test(accImgText) && /抓取外链到本地/.test(accImgText) && /粘贴地址/.test(accImgText),
      String(accAddImg));
    ok('★ Access 图片块同样提示支持格式与「看图示」',
      /支持 png \/ jpg \/ gif \/ webp \/ bmp/.test(accImgText) && /看图示/.test(accImgText));

    // ★ 题干分块（文字块 + 视频块）：WPS / Access 共用同一套编辑器，这里确认 Access 也吃到了
    ok('★ Access 题干同样支持「分块」（文字块 + 视频块）', /题干分块/.test(eText) && /文字块/.test(eText) && /视频块/.test(eText));
    const accStemVideoBtns = await b.evalJs(`Array.from(document.querySelectorAll('button')).filter(x => (x.textContent||'').includes('上传本地视频')).length`);
    ok('★ Access 题干视频位可上传本地视频', accStemVideoBtns >= 1, 'count=' + accStemVideoBtns);

    const fullScoreVal = await b.evalJs(`(() => {
      const lab = Array.from(document.querySelectorAll('label')).find(l => (l.textContent||'').includes('满分（默认 100）'));
      if (!lab) return 'no-label';
      const box = lab.parentElement.querySelector('input[type=number]');
      return box ? String(box.value) : 'no-input';
    })()`);
    ok('★ 新建时默认满分 100', fullScoreVal === '100', String(fullScoreVal));

    const accKinds = await b.evalJs(`(() => {
      const sels = Array.from(document.querySelectorAll('select'));
      const sel = sels.find(s => Array.from(s.options).some(o => o.textContent.trim() === '表存在 / 不存在'));
      if (!sel) return { found: false, all: sels.map(s => Array.from(s.options).map(o => o.textContent.trim()).join('/')) };
      return { found: true, options: Array.from(sel.options).map(o => o.textContent.trim()) };
    })()`);
    const akText = JSON.stringify(accKinds.options || accKinds.all || []);
    ok('★ 找到 Access 评分点类型下拉', accKinds.found === true, JSON.stringify(accKinds).slice(0, 200));
    ok('★ 含「字段名与顺序」', /字段名与顺序/.test(akText));
    ok('★ 含「字段类型 / 字段大小」', /字段类型/.test(akText));
    ok('★ 含「主键」', /主键/.test(akText));
    ok('★ 含「记录（数量 / 包含 / 不含）」', /记录（数量/.test(akText));
    ok('★ 含「记录字段值（改记录）」', /记录字段值/.test(akText));
    ok('★ 含「排序」/「筛选」', /排序/.test(akText) && /筛选/.test(akText));
    ok('★ 含「对象存在（查询 / 窗体 / 报表…）」', /对象存在/.test(akText));
    ok('★ Access 评分点共 13 种（一期 9 + 二期 4）', (accKinds.options || []).length === 13, 'n=' + (accKinds.options || []).length);
    const kindLabels = (accKinds.options || []).map((o) => String(o.value ?? o.label ?? o));
    ok('★ 二期检查器已进下拉（查询/关系/格式/导出）', ['查询', '表间关系', '字段格式', '导出附件'].every((w) => kindLabels.some((l) => l.includes(w))), JSON.stringify(kindLabels).slice(0, 150));
    ok('⛔ Access 编辑器里不应出现 WPS 评分点类型', !/合并单元格/.test(akText));

    const tplAcceptAcc = await b.evalJs(`(() => { const i = Array.from(document.querySelectorAll('input[type=file]')).find(x => (x.accept||'').includes('.accdb') && x.multiple); return i ? (i.accept + '|multiple=' + i.multiple) : 'none'; })()`);
    ok('★ 模板选择框支持 .accdb 且可多选', /\.accdb/.test(String(tplAcceptAcc)) && /multiple=true/.test(String(tplAcceptAcc)), String(tplAcceptAcc));
    const inspectAccept = await b.evalJs(`(() => { const i = Array.from(document.querySelectorAll('input[type=file]')).find(x => !x.multiple && (x.accept||'') === '.accdb,.mdb'); return i ? i.accept : 'none'; })()`);
    ok('★ 标准答案库选择框只收 .accdb/.mdb', String(inspectAccept) === '.accdb,.mdb', String(inspectAccept));

    // 切换评分点类型 → 字段面板必须跟着换（accdb_filter 的 op/value）
    const kindSwitch = await b.evalJs(`(() => {
      const sels = Array.from(document.querySelectorAll('select'));
      const sel = sels.find(s => Array.from(s.options).some(o => o.textContent.trim() === '表存在 / 不存在'));
      if (!sel) return 'no-sel';
      const opt = Array.from(sel.options).find(o => o.textContent.trim() === '筛选');
      if (!opt) return 'no-opt';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    ok('可把评分点类型切到「筛选」', kindSwitch === 'ok', String(kindSwitch));
    await sleep(500);
    const panelText = await b.evalJs(`document.body.innerText`);
    ok('★ 选「筛选」后出现表名/字段名/运算符/条件值字段', /运算符/.test(panelText) && /条件值/.test(panelText) && /字段名/.test(panelText));

    section('I. 教师端无 JS 异常');
    ok('无 JS 运行时错误', b.jsErrors.length === 0, b.jsErrors.slice(0, 3).join(' | ') || '无');
  } catch (e) {
    fail++; failures.push('脚本异常：' + e.message);
    console.error('\n脚本异常：', e);
  } finally {
    await b.close();

    // ---------- 不留痕 ----------
    try {
      const [curSubs] = await conn.query("SELECT id, student_id, file_path FROM wps_op_submissions WHERE kind='access' AND question_id = ?", [QUESTION_ID]);
      const leakedSubs = curSubs.filter((r) => r.student_id === STU_ID && !baselineSubIds.has(r.id));
      if (leakedSubs.length) {
        await conn.query('DELETE FROM wps_op_submissions WHERE id IN (?)', [leakedSubs.map((r) => r.id)]);
        for (const r of leakedSubs) {
          const abs = path.join(__dirname, '../..', String(r.file_path || '').replace(/^\/uploads\//, 'uploads/'));
          try { if (abs && fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* ignore */ }
        }
      }
      const [curAns] = await conn.query("SELECT id, student_id FROM student_answers WHERE question_id = ? AND answer LIKE '[Access操作题]%'", [QUESTION_ID]);
      const leakedAns = curAns.filter((r) => r.student_id === STU_ID).map((r) => r.id).filter((id) => !baselineAnsIds.has(id));
      if (leakedAns.length) await conn.query('DELETE FROM student_answers WHERE id IN (?)', [leakedAns]);

      const [postSubs] = await conn.query("SELECT id FROM wps_op_submissions WHERE kind='access' AND question_id = ? AND student_id = ?", [QUESTION_ID, STU_ID]);
      const subLeak = postSubs.map((r) => r.id).filter((id) => !baselineSubIds.has(id));
      ok('⛔ 不留痕：本次提交记录已清理（差集）', subLeak.length === 0, `leak=${subLeak.length}`);
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
