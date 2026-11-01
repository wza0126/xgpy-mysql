/**
 * 知识点讲解器截图（人工核对视觉用，不是断言脚本）。
 * 用法：cd backend && node scripts/debug/shot_knowledge_explain.cjs
 */
const fs = require('fs');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const OUT = 'C:/wza/xgpydev';

const SET_VAL = `
function __setVal(el, v){
  const proto = Object.getPrototypeOf(el);
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  d.set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}`;

async function shot(b, name) {
  const r = await b.ws.send('Page.captureScreenshot', { format: 'png' });
  const data = (r.result && r.result.data) || r.data;
  fs.writeFileSync(`${OUT}/_kp_shot_${name}.png`, Buffer.from(data, 'base64'));
  console.log('  截图', name);
}

const clickBtn = (b, text) => b.evalJs(`(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const root = document.querySelector('[data-kp-player]') || document.body;
  const btn = Array.from(root.querySelectorAll('button')).find(n => norm(n.textContent).includes(${JSON.stringify(text.replace(/\s+/g, ''))}));
  if (!btn || btn.disabled) return 'no';
  btn.click(); return 'ok';
})()`);

(async () => {
  const b = await launchHeadless({
    port: 9473, windowSize: '1500,900',
    chromePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: 'C:/wza/xgpydev/.tmp-edge-profile-shot',
  });
  try {
    await b.evalJs('(() => { try { localStorage.clear(); } catch (e) {} return 1; })()');
    await b.ws.send('Page.navigate', { url: PAGE });
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      const ready = await b.evalJs(`!!Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.includes('用户名'))`);
      if (ready === true) break;
    }
    await b.evalJs(`(() => {
      ${SET_VAL}
      const inputs = Array.from(document.querySelectorAll('input'));
      const u = inputs.find(i => i.placeholder && i.placeholder.includes('用户名'));
      const p = inputs.find(i => i.type === 'password');
      __setVal(u, 'a'); __setVal(p, '111111');
      u.closest('form').requestSubmit(); return 1;
    })()`);
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const done = await b.evalJs(`(document.body.innerText||'').includes('退出登录')`);
      if (done === true) break;
    }
    await sleep(2500);

    // 打开学习
    await b.evalJs(`(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      const t = Array.from(document.querySelectorAll('div,button,span'))
        .filter(el => norm(el.textContent) === '学习' && el.getBoundingClientRect().width > 0).pop();
      const icon = t.closest('[class*="cursor-pointer"]') || t.parentElement || t;
      const ev = (type) => new MouseEvent(type, { bubbles: true, cancelable: true, view: window });
      icon.dispatchEvent(ev('mousedown')); icon.dispatchEvent(ev('mouseup'));
      icon.dispatchEvent(ev('click')); icon.dispatchEvent(ev('dblclick'));
      return 1;
    })()`);
    await sleep(3000);
    await shot(b, '0-learn');

    // 打开讲解
    await b.evalJs('(() => { document.querySelector(".kp-explain-btn").click(); return 1; })()');
    for (let i = 0; i < 120; i++) {
      await sleep(700);
      const ok = await b.evalJs(`(document.body.innerText||'').includes('本节板书')`);
      if (ok === true) break;
    }
    await sleep(800);
    // ⛔ 新课/复习模式记在 localStorage 里，上次跑完可能是「复习」。
    //    这里显式切回新课，保证截图与断言从同一状态开始。
    await clickBtn(b, '新课');
    await sleep(600);
    await clickBtn(b, '暂停');
    await shot(b, '1-intro');

    await clickBtn(b, '下一步'); await sleep(700); await shot(b, '2-point');
    await clickBtn(b, '下一步'); await sleep(700); await shot(b, '3-point2');

    // 跳到考点步（倒数第 3 个点：考点）
    await b.evalJs(`(() => {
      const root = document.querySelector('[data-kp-player]') || document.body;
      const dots = Array.from(root.querySelectorAll('button')).filter(n => (n.className||'').includes('rounded-full') && (n.className||'').includes('h-2'));
      dots[dots.length - 3] && dots[dots.length - 3].click();
      return 1;
    })()`);
    await sleep(900); await shot(b, '4-exam');

    // 末步随堂问（先确保在新课模式，复习模式没有随堂问）
    await clickBtn(b, '新课');
    await sleep(700);
    await b.evalJs(`(() => {
      const root = document.querySelector('[data-kp-player]') || document.body;
      const dots = Array.from(root.querySelectorAll('button')).filter(n => (n.className||'').includes('rounded-full') && (n.className||'').includes('h-2'));
      dots[dots.length - 1].click(); return 1;
    })()`);
    await sleep(900); await shot(b, '5-quiz');
    await b.evalJs(`(() => {
      const root = document.querySelector('[data-kp-player]') || document.body;
      const opts = Array.from(root.querySelectorAll('button')).filter(n => /^[A-D][^A-Za-z]/.test((n.textContent||'').trim()) && (n.className||'').includes('rounded-lg'));
      opts[0] && opts[0].click(); return 1;
    })()`);
    await sleep(900); await shot(b, '6-quiz-answered');

    // 复习模式
    await clickBtn(b, '复习'); await sleep(1200); await shot(b, '7-review');
    await clickBtn(b, '下一步'); await sleep(800); await shot(b, '8-review-point');
  } finally {
    if (b && b.close) { try { await b.close(); } catch (e) {} }
  }
  // ⛔ 必须显式退出：CDP 的 WebSocket 会一直占着事件循环，脚本跑完也退不出去
  process.exit(0);
})();
