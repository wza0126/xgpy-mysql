#!/usr/bin/env node
/**
 * 验证「Python 编程 → 编程填空」提交后的**逐空对错可视化**：
 *   1) 答对的空 = 绿色（bg-green-900）+ ✓；答错的空 = 红色（bg-red-900）+ ✗；
 *   2) 鼠标悬停到某个空 → 弹出悬浮窗显示**正确答案**（答错的还会显示学生填的内容）；
 *   3) 作答前（未提交的题）仍是黄色，且接口**不再下发标准答案**（blank_answers / reference_code / expected_output）。
 *
 * 数据链路（全部走真实后端 + 真实页面）：
 *   python-gradings.blank_results（python-grader.gradeFillBlanks 生成）
 *     → GET /api/python/submissions/:taskId 的 grading.blank_results
 *     → PythonProgramming.tsx 按 index 着色 + 悬浮提示
 *
 * 用法：node scripts/debug/verify_python_fill_blank_marks.cjs
 * 前置：后端 3101、前端 3266 均在跑。
 *
 * ⛔ 本脚本**只读**，不写任何库（登录会产生一条 login_sessions 记录，属正常登录行为）。
 */
const { launchHeadless, sleep } = require('./lib/cdp.cjs');
const fs = require('fs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const STUDENT = { u: 'a', p: '111111' };

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
    console.log(`    (第 ${attempt} 次：登录态不稳定，重试)`);
  }
  return 'login-unstable';
}

async function dblclickIcon(b, label) {
  return b.evalJs(`(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    const nodes = Array.from(document.querySelectorAll('div,button')).filter(n => norm(n.textContent) === ${JSON.stringify(label)});
    if (!nodes.length) return 'not-found';
    nodes[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'opened';
  })()`);
}

const LIST_ICONS = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const set = new Set();
  document.querySelectorAll('div,button,span').forEach(n => {
    if (n.children.length) return;
    const t = norm(n.textContent);
    if (t && t.length <= 12) set.add(t);
  });
  return Array.from(set);
})()`;

/** 点击页面上第一个「文字以 prefix 开头」的可点击元素（左侧任务列表项） */
async function clickTaskByTitle(b, prefix) {
  return b.evalJs(`(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    const nodes = Array.from(document.querySelectorAll('div')).filter(n => norm(n.textContent).indexOf(${JSON.stringify(prefix)}) === 0 && norm(n.textContent).length < 60);
    if (!nodes.length) return 'not-found';
    // 取最内层（文本最短）的那个，避免点到外层容器
    nodes.sort((x, y) => norm(x.textContent).length - norm(y.textContent).length);
    nodes[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 'clicked';
  })()`);
}

async function clickTab(b, label) {
  return b.evalJs(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(x => (x.textContent || '').indexOf(${JSON.stringify(label)}) >= 0);
    if (!btn) return 'not-found';
    btn.click();
    return 'clicked';
  })()`);
}

/**
 * 读填空编辑器里每个空的状态：
 *   value / 颜色分类（green|red|yellow|other） / 标签（✓ ✗） / 悬浮窗文案 / 视口坐标
 */
const READ_BLANKS = `(() => {
  const box = Array.from(document.querySelectorAll('div')).find(d => {
    const c = String(d.className || '');
    return c.includes('bg-gray-900') && c.includes('font-mono') && c.includes('overflow-auto') && d.querySelector('input');
  });
  if (!box) return null;
  const inputs = Array.from(box.querySelectorAll('input'));
  return inputs.map((el, i) => {
    const cls = String(el.className || '');
    let color = 'other';
    if (cls.includes('bg-green-900')) color = 'green';
    else if (cls.includes('bg-red-900')) color = 'red';
    else if (cls.includes('bg-yellow-900')) color = 'yellow';
    const cs = getComputedStyle(el);
    const wrapper = el.parentElement;
    const marker = wrapper ? Array.from(wrapper.children).map(c => (c.textContent || '').trim()).filter(t => t === '✓' || t === '✗')[0] || null : null;
    const tip = wrapper ? Array.from(wrapper.children).find(c => (c.textContent || '').includes('正确答案：')) : null;
    const r = el.getBoundingClientRect();
    return {
      i, value: el.value, disabled: el.disabled, color,
      bg: cs.backgroundColor, borderColor: cs.borderTopColor,
      marker, tipText: tip ? (tip.textContent || '').replace(/\\s+/g, ' ').trim() : null,
      cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
      vw: window.innerWidth, vh: window.innerHeight,
    };
  });
})()`;

/**
 * 把第 idx 个空滚入视野中并返回**当前**视口坐标（滚动后旧坐标会失效）。
 * 视口外坐标是发不出 hover 的 —— 必须先滚到视野里再取 rect。
 */
const posOfBlank = (idx) => `(() => {
  const box = Array.from(document.querySelectorAll('div')).find(d => {
    const c = String(d.className || '');
    return c.includes('bg-gray-900') && c.includes('font-mono') && c.includes('overflow-auto') && d.querySelector('input');
  });
  if (!box) return null;
  const el = box.querySelectorAll('input')[${idx}];
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
    vw: window.innerWidth, vh: window.innerHeight,
    inView: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
  };
})()`;

/** 判断颜色是否为「绿色系」/「红色系」（看 rgb 分量，避免依赖具体色值） */
function colorKind(rgb) {
  const m = String(rgb || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return 'unknown';
  const [r, g, bl] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (g > r && g > bl) return 'green';
  if (r > g && r > bl) return 'red';
  return 'other';
}

(async () => {
  let b = null;
  try {
    b = await launchHeadless({ port: 9458 });

    section('0. 登录学生账号（a / 111111）');
    const login = await loginAs(b, STUDENT.u, STUDENT.p);
    ok('登录成功且桌面稳定', login === 'submitted', login);

    // ==================== A. 作答前不得下发答案 ====================
    section('A. 接口层：作答前学生端不能拿到标准答案');
    const api = await b.evalJs(`(async () => {
      const tk = localStorage.getItem('xgpy_token');
      if (!tk) return { err: 'no-token' };
      const r = await fetch('/api/python/tasks', { headers: { 'Authorization': 'Bearer ' + tk } });
      const j = await r.json();
      const rows = (j && j.data) || [];
      const leak = { blank_answers: 0, reference_code: 0, expected_output: 0 };
      let firstId = null;
      for (const x of rows) {
        if (!firstId) firstId = x.id;
        for (const k of Object.keys(leak)) if (x[k] !== undefined && x[k] !== null && x[k] !== '' && !(Array.isArray(x[k]) && x[k].length === 0)) leak[k]++;
      }
      let single = null;
      if (firstId) {
        const r2 = await fetch('/api/python/tasks/' + firstId, { headers: { 'Authorization': 'Bearer ' + tk } });
        const j2 = await r2.json();
        single = { keys: Object.keys((j2 && j2.data) || {}).filter(k => ['blank_answers','reference_code','expected_output'].includes(k)) };
      }
      return { status: r.status, count: rows.length, leak, singleKeys: single ? single.keys : null };
    })()`);

    ok('GET /api/python/tasks 200 且返回题目', !!api && api.status === 200 && api.count > 0,
      api ? `status=${api.status} count=${api.count}` : 'no-result');
    ok('列表接口未下发 blank_answers（标准答案）', api && api.leak.blank_answers === 0, `泄露 ${api ? api.leak.blank_answers : '?'} 条`);
    ok('列表接口未下发 reference_code（参考代码）', api && api.leak.reference_code === 0, `泄露 ${api ? api.leak.reference_code : '?'} 条`);
    ok('列表接口未下发 expected_output（预期输出）', api && api.leak.expected_output === 0, `泄露 ${api ? api.leak.expected_output : '?'} 条`);
    ok('单题接口同样已脱敏', api && Array.isArray(api.singleKeys) && api.singleKeys.length === 0,
      api && api.singleKeys ? JSON.stringify(api.singleKeys) : 'n/a');

    // ==================== B. 打开模块，找一道「对错混合」的填空题 ====================
    section('B. 渲染层：打开「Python 编程」→ 编程填空');
    const icons = await b.evalJs(LIST_ICONS);
    const pyIcons = (icons || []).filter((t) => t.includes('Python'));
    const label = pyIcons.find((t) => !t.includes('魔法')) || pyIcons[0];
    console.log('    含「Python」的桌面图标: ' + JSON.stringify(pyIcons));
    ok('找到桌面「Python 编程」图标', !!label, label || '未找到');
    const opened = await dblclickIcon(b, label);
    ok(`双击「${label}」`, opened === 'opened', opened);
    await sleep(4000);

    const tabClicked = await clickTab(b, '编程填空');
    ok('切到「编程填空」标签页', tabClicked === 'clicked', tabClicked);
    await sleep(1500);

    // 用接口数据挑一道「既有对也有错」的已评分填空题
    const target = await b.evalJs(`(async () => {
      const tk = localStorage.getItem('xgpy_token');
      const r = await fetch('/api/python/tasks', { headers: { 'Authorization': 'Bearer ' + tk } });
      const rows = ((await r.json()).data) || [];
      const fb = rows.filter(x => x.task_type === 'fill_blank');
      for (const t of fb) {
        const r2 = await fetch('/api/python/submissions/' + t.id, { headers: { 'Authorization': 'Bearer ' + tk } });
        const sub = (await r2.json()).data;
        const br = sub && sub.grading && sub.grading.blank_results;
        const arr = Array.isArray(br) ? br : [];
        if (arr.length && arr.some(x => x.is_correct) && arr.some(x => !x.is_correct)) {
          return { id: t.id, title: t.title, results: arr };
        }
      }
      return null;
    })()`);

    ok('找到一道「有对有错」的已评分填空题（来自真实接口）', !!target,
      target ? `${target.title}（${target.results.length} 空）` : '未找到 —— 说明没有混合对错的提交记录');
    if (!target) throw new Error('缺少可用于验证的填空提交');

    console.log('\n  ---- 后端 blank_results（判分基准）----');
    target.results.forEach(r => console.log(
      `    第${r.index}空: ${r.is_correct ? '✓对' : '✗错'} | 学生填「${r.student_answer || ''}」 | 正确答案 ${JSON.stringify(r.correct_answers)}`
    ));

    const shortTitle = target.title.split(' ')[0];   // 形如「第32题」
    const clicked = await clickTaskByTitle(b, shortTitle);
    ok(`点击左侧列表里的「${shortTitle}」`, clicked === 'clicked', clicked);
    await sleep(3500);

    // ==================== C. 逐空着色 ====================
    section('C. 提交后：每空按对错着色 + ✓/✗ 标记');
    let blanks = await b.evalJs(READ_BLANKS);
    ok('填空编辑器内渲染出输入框', Array.isArray(blanks) && blanks.length > 0, blanks ? `${blanks.length} 个空` : '未找到编辑器');
    if (!Array.isArray(blanks) || !blanks.length) throw new Error('未渲染填空编辑器');

    ok(`空数与判分记录一致（${target.results.length}）`, blanks.length === target.results.length,
      `界面 ${blanks.length} / 记录 ${target.results.length}`);

    let colorOk = true, markerOk = true, disabledOk = true;
    for (const r of target.results) {
      const el = blanks.find(x => x.i === r.index - 1);
      if (!el) { colorOk = false; continue; }
      const expect = r.is_correct ? 'green' : 'red';
      const actual = el.color;
      if (actual !== expect) {
        colorOk = false;
        console.log(`    ✗ 第${r.index}空 期望 ${expect}，实际 ${actual}`);
      }
      const kind = colorKind(el.bg);
      if (kind !== expect) {
        colorOk = false;
        console.log(`    ✗ 第${r.index}空 计算样式不是${expect}系（${el.bg}）`);
      }
      if (el.marker !== (r.is_correct ? '✓' : '✗')) {
        markerOk = false;
        console.log(`    ✗ 第${r.index}空 标记期望 ${r.is_correct ? '✓' : '✗'}，实际 ${el.marker}`);
      }
      if (el.disabled !== true) disabledOk = false;
    }
    ok('★ 答对的空显示绿色、答错的空显示红色（class + 计算样式双验）', colorOk);
    ok('★ 每空带 ✓ / ✗ 标记', markerOk);
    ok('提交后各空不可再编辑', disabledOk);

    console.log('\n  ---- 界面实测（就绪态）----');
    blanks.forEach(el => console.log(
      `    空${el.i + 1}: 「${el.value}」 色=${el.color} 底=${el.bg} 标=${el.marker || '-'} tooltip=${el.tipText ? '有' : '无'} @(${el.cx},${el.cy}) 视口=${el.vw}x${el.vh}`
    ));

    // ==================== D. 悬停显示正确答案 ====================
    section('D. 鼠标悬停每个空 → 悬浮窗显示正确答案');
    const wrongFirst = target.results.find(r => !r.is_correct) || target.results[0];
    const correctFirst = target.results.find(r => r.is_correct) || target.results[0];
    const probes = [
      { r: correctFirst, label: '答对的空' },
      { r: wrongFirst, label: '答错的空' },
    ].filter((p, idx, arr) => arr.findIndex(q => q.r.index === p.r.index) === idx);

    for (const p of probes) {
      const el = blanks.find(x => x.i === p.r.index - 1);
      if (!el) { ok(`${p.label}（第${p.r.index}空）可定位`, false); continue; }
      // 真实的鼠标移动事件（触发 CSS hover / React onMouseEnter）
      // ⚠️ 先滚入视野再取坐标：视口外的点发不出 hover
      const pos = await b.evalJs(posOfBlank(p.r.index - 1));
      console.log(`    [hover] 第${p.r.index}空 -> (${pos && pos.x},${pos && pos.y}) 视口=${pos && pos.vw}x${pos && pos.vh} inView=${pos && pos.inView}`);
      await b.ws.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, button: 'none' });
      await sleep(500);
      const after = await b.evalJs(READ_BLANKS);
      const hov = Array.isArray(after) ? after.find(x => x.i === p.r.index - 1) : null;
      const txt = (hov && hov.tipText) || '';
      ok(`${p.label}（第${p.r.index}空）悬停后弹出悬浮窗`, !!txt, txt || '未出现');
      const expectAns = (p.r.correct_answers || []).join('  或  ');
      ok(`  悬浮窗含正确答案「${expectAns}」`, txt.includes(expectAns));
      ok(`  悬浮窗标明「第 ${p.r.index} 空」与对错`, txt.includes(`第 ${p.r.index} 空`) && (p.r.is_correct ? txt.includes('正确') : txt.includes('错误')), txt);
      if (!p.r.is_correct) {
        ok('  答错的空还显示学生自己填的内容', txt.includes(p.r.student_answer || '（空）'), txt);
        // 截图留档：截「悬浮窗可见」这一刻（老师直观看效果）
        try {
          const shot = await b.ws.send('Page.captureScreenshot', { format: 'png' });
          const out = 'D:/wza/xgpy-mysql/.workbuddy/fill_blank_marks_preview.png';
          fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
          console.log('    📷 截图已保存: ' + out);
        } catch (e) { console.log('    (截图失败: ' + e.message + ')'); }
      }
      // 移开鼠标 → 悬浮窗应消失
      await b.ws.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, button: 'none' });
      await sleep(500);
      const away = await b.evalJs(READ_BLANKS);
      const awayEl = Array.isArray(away) ? away.find(x => x.i === p.r.index - 1) : null;
      ok('  移开鼠标后悬浮窗消失', !(awayEl && awayEl.tipText));
    }

    // ==================== E. 未提交的题保持原样 ====================
    section('E. 未提交的填空题仍是黄色（不提前泄漏对错）');
    const unsubmitted = await b.evalJs(`(async () => {
      const tk = localStorage.getItem('xgpy_token');
      const r = await fetch('/api/python/tasks', { headers: { 'Authorization': 'Bearer ' + tk } });
      const rows = ((await r.json()).data) || [];
      for (const t of rows.filter(x => x.task_type === 'fill_blank')) {
        const r2 = await fetch('/api/python/submissions/' + t.id, { headers: { 'Authorization': 'Bearer ' + tk } });
        const sub = (await r2.json()).data;
        if (!sub) return { title: t.title };
      }
      return null;
    })()`);
    if (!unsubmitted) {
      console.log('    （该学生所有填空题都已提交，本步跳过）');
    } else {
      const c2 = await clickTaskByTitle(b, String(unsubmitted.title).split(' ')[0]);
      await sleep(3000);
      const b2 = await b.evalJs(READ_BLANKS);
      const allYellow = Array.isArray(b2) && b2.length > 0 && b2.every(x => x.color === 'yellow' && !x.marker && !x.tipText);
      ok(`未提交的「${unsubmitted.title}」各空均为黄色、无标记、无悬浮窗`, allYellow,
        Array.isArray(b2) ? b2.map(x => `${x.color}${x.marker || ''}`).join(',') : '未渲染');
    }
  } catch (e) {
    console.error('\n★ 脚本异常：' + e.message);
    fail++;
  } finally {
    if (b) { try { await b.close(); } catch (_) {} }
    console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
    if (fail) process.exitCode = 1;
  }
})();
