#!/usr/bin/env node
/**
 * 验证「测试 / 任务中心 窗口打开时 AI 答疑暂停」的提示是否**详细、可操作**。
 *
 * 断言链（真实无头浏览器 + 真实登录）：
 *   1. 打开 AI答疑，无阻挡窗口时应**没有**红色提示条；
 *   2. 打开「测试」窗口 → 提示条出现，且**点名「测试」**、含关闭指引；
 *   3. 此时发问 → 回复必须是详细说明（含「当前无法答疑」「怎么恢复答疑」「关闭」「积分」）；
 *   4. 关闭「测试」窗口 → 提示条消失（证明响应式，不是一次性）。
 *
 * 用法：node scripts/debug/verify_aiqa_exam_block.cjs
 * 前置：后端 3101、前端 3266 在跑。⛔ 只读（登录会产生一条 login_sessions 记录）。
 */
const { launchHeadless, sleep } = require('./lib/cdp.cjs');
const fs = require('fs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const STUDENT = { u: 'a', p: '111111' };

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)); };
const section = (t) => console.log(`\n=== ${t} ===`);

const SET_VAL = `
function __setVal(el, v){
  const proto = Object.getPrototypeOf(el);
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  d.set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}`;

const KILL_DIALOGS = '(() => { window.confirm = () => true; window.alert = () => {}; return true; })()';

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

/** 桌面上所有短文字（用来定位图标） */
const LIST_LABELS = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const set = new Set();
  document.querySelectorAll('div,button,span').forEach(n => {
    if (n.children.length) return;
    const t = norm(n.textContent);
    if (t && t.length <= 8) set.add(t);
  });
  return Array.from(set);
})()`;

async function dblclickIcon(b, label) {
  return b.evalJs(`(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    const nodes = Array.from(document.querySelectorAll('div,button')).filter(n => norm(n.textContent) === ${JSON.stringify(label)});
    if (!nodes.length) return 'not-found';
    nodes[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'opened';
  })()`);
}

/** AI答疑窗口状态：是否打开 / 提示条文案 / placeholder */
const QA_STATE = `(() => {
  const ta = document.querySelector('.aiqa-input');
  const banner = Array.from(document.querySelectorAll('div')).find(d =>
    (d.textContent || '').includes('答疑已暂停') && String(d.className || '').includes('border-red'));
  return {
    open: !!ta,
    placeholder: ta ? ta.placeholder : null,
    bannerText: banner ? (banner.textContent || '').replace(/\\s+/g, ' ').trim() : null,
  };
})()`;

/** 在 AI答疑 里发一个问题（走真实表单提交路径） */
async function ask(b, question) {
  return b.evalJs(`(() => {
    ${SET_VAL}
    const ta = document.querySelector('.aiqa-input');
    if (!ta) return 'no-input';
    __setVal(ta, ${JSON.stringify(question)});
    return new Promise(resolve => setTimeout(() => {
      const form = document.querySelector('.aiqa-form');
      if (!form) return resolve('no-form');
      form.requestSubmit();
      resolve('submitted');
    }, 400));
  })()`);
}

/** 读最后一条助手回复的纯文本 */
const LAST_ANSWER = `(() => {
  const ta = document.querySelector('.aiqa-input');
  if (!ta) return null;
  const root = ta.closest('div.h-full') || document.body;
  const md = root.querySelectorAll('.markdown-content');
  if (!md.length) return '';
  return (md[md.length - 1].innerText || '').trim();
})()`;

/**
 * 按标题关闭桌面窗口（WindowFrame 结构：标题栏内有 i.fa-xmark 的关闭按钮）。
 * ⚠️ 桌面上「测试」这个文字既出现在**图标标签**、也出现在**窗口标题栏**；
 *    从图标标签向上遍历会撞到整个桌面容器，其中第一个 i.fa-xmark 往往是别的窗口的关闭按钮。
 *    因此这里收集所有候选容器，取**面积最小**的那个（真正的标题栏）来点击。
 */
async function closeWindow(b, title) {
  return b.evalJs(`(() => {
    const spans = Array.from(document.querySelectorAll('span')).filter(s => (s.textContent || '').trim() === ${JSON.stringify(title)});
    if (!spans.length) return 'title-not-found';
    let best = null;
    for (const s of spans) {
      let node = s;
      for (let i = 0; i < 8 && node.parentElement; i++) {
        node = node.parentElement;
        const x = node.querySelector('i.fa-xmark');
        if (x) {
          const btn = x.closest('button');
          if (btn) {
            const r = node.getBoundingClientRect();
            const area = r.width * r.height;
            if (!best || area < best.area) best = { btn, area };
          }
          break; // 只取「最近的」含 xmark 的祖先
        }
      }
    }
    if (!best) return 'no-close-button';
    best.btn.click();
    return 'closed:' + Math.round(best.area);
  })()`);
}

(async () => {
  let b = null;
  try {
    b = await launchHeadless({ port: 9458 });
    await b.evalJs(KILL_DIALOGS);

    section('0. 登录');
    const login = await loginAs(b, STUDENT.u, STUDENT.p);
    ok('以学生身份登录成功', login === 'submitted', login);
    if (login !== 'submitted') throw new Error('登录失败，后续无法进行');
    await b.evalJs(KILL_DIALOGS);
    const labels = await b.evalJs(LIST_LABELS);

    section('1. 打开 AI答疑（此时不该有任何阻挡提示）');
    const openR = await b.evalJs(`(() => {
      if (typeof window.openAiQaWindow !== 'function') return 'no-fn';
      window.openAiQaWindow();
      return 'opened';
    })()`);
    ok('通过 openAiQaWindow() 打开 AI答疑', openR === 'opened', openR);
    await sleep(2500);
    let st = await b.evalJs(QA_STATE);
    ok('AI答疑窗口已打开（.aiqa-input 存在）', !!(st && st.open));
    ok('无阻挡窗口时**不显示**红色提示条', !!(st && st.bannerText === null), st ? `banner=${st.bannerText}` : '');
    console.log('    placeholder（常态）: ' + JSON.stringify(st && st.placeholder));

    section('2. 打开「测试」窗口');
    const testIcons = (labels || []).filter((t) => t.includes('测试'));
    console.log('    桌面含「测试」的图标: ' + JSON.stringify(testIcons));
    ok('找到桌面「测试」图标', testIcons.length > 0, testIcons[0] || '未找到');
    if (testIcons[0]) ok(`双击「${testIcons[0]}」`, (await dblclickIcon(b, testIcons[0])) === 'opened');
    await sleep(3000);

    st = await b.evalJs(QA_STATE);
    const bt = (st && st.bannerText) || '';
    ok('测试窗口打开后**出现**红色提示条', !!bt);
    ok('提示条点名了「测试」', bt.includes('「测试」'));
    ok('提示条讲清**为什么**不能答疑（考试与作业期间禁止）', bt.includes('禁止使用 AI 答疑'));
    ok('提示条讲清**怎么办**（关闭窗口后再提问）', bt.includes('关闭') && bt.includes('再提问'));
    ok('提示条说明只最小化不算关闭', bt.includes('最小化'));
    console.log('    ---- 提示条全文 ----');
    console.log('    ' + bt);
    console.log('    placeholder（拦截态）: ' + JSON.stringify(st && st.placeholder));

    // 截图留档：拦截态下 AI答疑窗口的样子（供老师直观查看文案效果）
    try {
      // 先把答疑窗口置顶，否则会被后打开的「测试」窗口盖住
      const act = await b.evalJs(`(() => {
        const span = Array.from(document.querySelectorAll('span')).find(s => (s.textContent || '').trim() === 'AI答疑');
        if (!span) return 'no-title';
        let bar = span;
        for (let i = 0; i < 4 && bar.parentElement; i++) {
          bar = bar.parentElement;
          if (bar.querySelector('i.fa-xmark')) break;
        }
        bar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        bar.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        return 'activated';
      })()`);
      await sleep(900);
      const rect = await b.evalJs(`(() => {
        const ta = document.querySelector('.aiqa-input');
        if (!ta) return null;
        const win = ta.closest('div.h-full') || ta.closest('div');
        const r = win.getBoundingClientRect();
        return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
      })()`);
      console.log('    置顶结果: ' + act + ' / 区域: ' + JSON.stringify(rect));
      if (rect && rect.width > 50 && rect.height > 50) {
        const shot = await b.ws.send('Page.captureScreenshot', {
          format: 'png',
          clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 },
        });
        const out = 'D:/wza/xgpy-mysql/.workbuddy/aiqa_exam_block_preview.png';
        fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
        console.log('    📷 截图已保存: ' + out);
      }
    } catch (e) { console.log('    (截图失败: ' + e.message + ')'); }

    section('3. 此时发问 → 应得到详细说明');
    const asked = await ask(b, '这道题怎么做？');
    ok('问题已提交', asked === 'submitted', asked);
    await sleep(2000);
    const ans = await b.evalJs(LAST_ANSWER);
    console.log('    ---- 学生看到的回复 ----');
    console.log(String(ans).split('\n').map((l) => '    ' + l).join('\n'));
    console.log('    ------------------------');
    ok('回复点明「现在不能答疑」', String(ans).includes('现在不能答疑'));
    ok('回复点名「测试」窗口', String(ans).includes('「测试」'));
    ok('回复要求先关闭窗口', String(ans).includes('关闭'));
    ok('回复说明最小化不算关闭', String(ans).includes('最小化'));
    ok('回复说明不扣积分', String(ans).includes('不扣积分'));

    section('4. 关闭「测试」窗口 → 提示条应消失');
    const closed = await closeWindow(b, '测试');
    ok('找到并点击了「测试」窗口关闭按钮', String(closed).startsWith('closed'), closed);
    await sleep(2500);
    st = await b.evalJs(QA_STATE);
    ok('AI答疑窗口仍在（无需重开）', !!(st && st.open), st ? `open=${st.open}` : '');
    ok('关闭后红色提示条消失', !!(st && st.open && st.bannerText === null), st ? `banner=${st.bannerText}` : '');
    console.log('    placeholder（恢复后）: ' + JSON.stringify(st && st.placeholder));

    section('5. 多窗口文案（直接调用真实模块的导出函数）');
    const fnRes = await b.evalJs(`(async () => {
      try {
        const m = await import('/src/components/student/AiQaApp.tsx');
        return {
          both: m.buildExamQaBlockedBanner('测试、任务中心'),
          tc: m.buildExamQaBlockedBanner('任务中心'),
          tcMsg: m.buildExamQaBlockedMessage('任务中心'),
          fallback: m.EXAM_QA_BLOCKED_MESSAGE,
        };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`);
    console.log('    两个窗口都开: ' + JSON.stringify(fnRes && fnRes.both));
    console.log('    仅任务中心  : ' + JSON.stringify(fnRes && fnRes.tc));
    console.log('    发问回复    : ' + JSON.stringify(fnRes && fnRes.tcMsg));
    ok('两个窗口都开时，文案点名「测试」和「任务中心」',
      !!(fnRes && fnRes.both) && fnRes.both.includes('「测试」和「任务中心」'), (fnRes && fnRes.err) || '');
    ok('仅「任务中心」时，文案只点名任务中心',
      !!(fnRes && fnRes.tc) && fnRes.tc.includes('「任务中心」') && !fnRes.tc.includes('「测试」'));
    ok('发问回复同样点名「任务中心」', !!(fnRes && fnRes.tcMsg) && fnRes.tcMsg.includes('「任务中心」'));
  } catch (e) {
    console.error('\n★ 脚本异常：' + e.message);
    fail++;
  } finally {
    if (b) { try { await b.close(); } catch (_) {} }
    console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
    if (fail) process.exitCode = 1;
  }
})();
