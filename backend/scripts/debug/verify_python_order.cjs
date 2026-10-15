#!/usr/bin/env node
/**
 * 验证「Python 编程」任务在学生端的显示顺序 = 按标题里的题号（「第NN题」）升序。
 *
 * 背景：
 *   python_tasks.title 形如「第07题 for循环简单入门」；编程填空(fill_blank, 01–39) 与
 *   编程作业(code, 01–11) 是**两个独立标签页**（各自独立编号）。
 *   后端三处查询已由 `ORDER BY created_at DESC` 改为 `pyTaskOrderSql()`（见 backend/src/index.js）：
 *     · GET /api/python/tasks           （学生端列表）
 *     · GET /api/python/teacher/tasks   （教师端列表）
 *     · GET /api/python/teacher/export  （导出表格的列顺序）
 *
 * 两层验证：
 *   A. 接口层：页面内带**真实登录 token** 调 /api/python/tasks，断言两组返回顺序均按题号升序；
 *   B. 渲染层：打开桌面「Python 编程」图标，读「作业任务」标签页 DOM 里的题目顺序。
 *
 * 用法：node scripts/debug/verify_python_order.cjs [--no-ui]
 * 前置：后端 3101、前端 3266 均在跑。
 *
 * ⛔ 本脚本**只读**，不写任何库（登录会产生一条 login_sessions 记录，属正常登录行为）。
 */
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const STUDENT = { u: 'a', p: '111111' };
const SKIP_UI = process.argv.includes('--no-ui');

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

/**
 * ⚠️ 服务端是「会话替换」策略：同账号再登会让旧 token 失效，dev 下切号偶发被踢回登录页。
 *    所以要求「登录后桌面稳定 3 秒」才算成功，最多重试 3 次（与 verify_pet_level 同策略）。
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
    console.log(`    (第 ${attempt} 次：登录态不稳定，重试)`);
  }
  return 'login-unstable';
}

/** 桌面双击某个图标（按可见文字精确匹配，忽略空白） */
async function dblclickIcon(b, label) {
  return b.evalJs(`(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    const nodes = Array.from(document.querySelectorAll('div,button')).filter(n => norm(n.textContent) === ${JSON.stringify(label)});
    if (!nodes.length) return 'not-found';
    nodes[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'opened';
  })()`);
}

/** 列出桌面上的图标候选文字（用于自动定位 Python 图标） */
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

/** 从标题数组提取题号 */
function numsOf(titles) {
  return titles.map((t) => {
    const m = String(t).match(/第(\d+)题/);
    return m ? Number(m[1]) : null;
  });
}

/** 断言：全部标题含题号，且题号非递减（编号唯一时应为严格递增；两标签页混排时允许相等） */
function assertAsc(titles, label) {
  const nums = numsOf(titles);
  const bad = nums.filter((n) => n === null);
  ok(`${label}：标题均带「第NN题」题号`, bad.length === 0, bad.length ? `异常 ${bad.length} 条` : '');
  const asc = nums.every((n, i) => i === 0 || (n !== null && nums[i - 1] !== null && n >= nums[i - 1]));
  ok(`${label}：题号升序（${titles.length} 条）`, asc, asc ? '' : '实际题号序列 ' + nums.join(','));
  return nums;
}

(async () => {
  let b = null;
  try {
    // ==================== A. 接口层 ====================
    section('A. 接口层：/api/python/tasks 返回顺序（真实登录 token）');
    b = await launchHeadless({ port: 9457 });
    const login = await loginAs(b, STUDENT.u, STUDENT.p);
    ok('以学生身份登录成功', login === 'submitted', login);

    const res = await b.evalJs(`(async () => {
      const tk = localStorage.getItem('xgpy_token');
      if (!tk) return { err: 'no-token' };
      const r = await fetch('/api/python/tasks', { headers: { 'Authorization': 'Bearer ' + tk } });
      const j = await r.json();
      return { status: r.status, err: j && j.error, rows: ((j && j.data) || []).map(x => ({ title: x.title, k: x.task_type })) };
    })()`);

    ok('接口返回 200 且无 error（说明新排序 SQL 没报错）',
      !!res && res.status === 200 && !res.err,
      res ? `status=${res.status} err=${res.err || 'null'}` : 'no-result');

    const rows = (res && res.rows) || [];
    ok('返回题目数 > 0', rows.length > 0, `${rows.length} 条`);

    const code = rows.filter((r) => r.k === 'code').map((r) => r.title);
    const fb = rows.filter((r) => r.k === 'fill_blank').map((r) => r.title);

    console.log(`\n  [编程作业 code] ${code.length} 条：`);
    code.forEach((t) => console.log('    ' + t));
    console.log(`\n  [编程填空 fill_blank] ${fb.length} 条`);

    if (code.length) assertAsc(code, '编程作业(code)');
    if (fb.length) {
      assertAsc(fb, '编程填空(fill_blank)');
      ok('编程填空返回 39 条（本班全量）', fb.length === 39, `${fb.length} 条`);
    }
    if (code.length < 11) {
      console.log(`\n  ⚠️ 提示：code 只返回 ${code.length} 条（全库 11 条）。差额通常是 class_ids 脏数据` +
        `（被存成「逐字符数组」）导致班级过滤命中失败，与本轮排序改动无关；可单独核查。`);
    }

    // ==================== B. 渲染层 ====================
    if (SKIP_UI) {
      section('B. 渲染层 —— 已跳过（--no-ui）');
    } else {
      section('B. 渲染层：打开 Python 模块，读「作业任务」标签页题目顺序');
      const icons = await b.evalJs(LIST_ICONS);
      const pyIcons = (icons || []).filter((t) => t.includes('Python'));
      console.log('    桌面上含「Python」的图标: ' + JSON.stringify(pyIcons));
      const label = pyIcons.find((t) => !t.includes('魔法')) || pyIcons[0];
      ok('找到桌面「Python 编程」图标', !!label, label || '未找到');

      if (label) {
        const opened = await dblclickIcon(b, label);
        ok(`双击桌面「${label}」图标`, opened === 'opened', opened);
        await sleep(4000); // 等窗口打开并拉数据

        const dom = await b.evalJs(`(() => {
          const out = [];
          document.querySelectorAll('span,div,p,h3').forEach(n => {
            if (n.children.length) return;               // 只取叶子节点
            const t = (n.textContent || '').trim();
            if (/第\\d+题/.test(t) && t.length <= 60) out.push(t);
          });
          return Array.from(new Set(out));
        })()`);
        const list = Array.isArray(dom) ? dom : [];
        console.log('    DOM 抓到的标题: ' + JSON.stringify(list));
        ok('「作业任务」页渲染出题目标题', list.length > 0, `${list.length} 条`);
        if (list.length) {
          const nums = numsOf(list);
          const asc = nums.every((n, i) => i === 0 || (n !== null && nums[i - 1] !== null && n >= nums[i - 1]));
          ok('★ 界面渲染顺序 = 题号升序（用户可见）', asc,
            asc ? `题号 ${nums.filter(Boolean).join(',')}` : '实际题号序列 ' + nums.join(','));
        }
      }
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
