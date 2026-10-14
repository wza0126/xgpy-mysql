/**
 * 诊断：暴击后「画面卡顿 + 滚轮失控、最小化复原才恢复」的真凶（2026-10-14）
 *
 * 现象（用户报）：暴击后画面卡顿，鼠标滚轮控制不了滚动条，**把浏览器最小化再复原就恢复**。
 *   → 这是典型的「合成层爆炸 / 合成器卡死」特征（最小化会销毁并重建整个图层树）。
 *
 * 思路：**不写库**地在真实页面上复现暴击。
 *   把 `/api/business/submit-answer` 的 fetch 拦掉，返回「答对 + is_crit=true」的合成响应。
 *   PracticeModule 收到 is_crit=true 就会 `setShowCritEffect(true)` → **真实的 CritEffect 挂载**。
 *   服务端没被打到，且 is_correct 走 true 分支（不写 wrong_questions）→ 全程零写库、零积分变动。
 *
 * 测什么（都是 CDP 真数据，不靠推测）：
 *   1. `LayerTree`  —— 合成层数量 / 单个层最大面积 / 有没有视口级的大层（层爆炸在这里暴露）
 *   2. 页面内 rAF 帧间隔 —— 只作参考（headless 不锁 vsync，数值会失真，脚本会如实标注）
 *   3. CritEffect 的 DOM 几何 —— 几个视口级 `position:fixed` 层、缩放/模糊等昂贵属性
 *
 * 并做 A/B：**代码农场在 / 不在**（把农场根节点 `display:none`）→ 回答「是不是农场引起的」。
 *
 * 用法：cd backend && node scripts/debug/diag_crit_lag.cjs
 *   ⛔ 需要后端 3101 与前端 3266 都在跑。
 */
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const STUDENT = { u: 'a', p: '111111' };
const VIEW = '1500,900';
const SAMPLE_MS = 1200;

let pass = 0, fail = 0;
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

// ---------- 测量工具 ----------

function frameSample(b, ms = SAMPLE_MS) {
  return b.evalJs(`new Promise((resolve) => {
    const d = []; let last = performance.now(); const t0 = last;
    function tick(now) {
      d.push(now - last); last = now;
      if (now - t0 < ${ms}) requestAnimationFrame(tick);
      else {
        const s = d.slice(1).sort((a, b) => a - b);
        const sum = s.reduce((a, b) => a + b, 0);
        const avg = sum / Math.max(1, s.length);
        resolve({
          frames: s.length, avgMs: +avg.toFixed(2), fps: +(1000 / Math.max(0.01, avg)).toFixed(1),
          p95Ms: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(2),
          maxMs: +(s[s.length - 1] || 0).toFixed(2),
          long50: s.filter((x) => x > 50).length,
        });
      }
    }
    requestAnimationFrame(tick);
  })`);
}

async function perfCounters(b) {
  try {
    const r = await b.ws.send('Performance.getMetrics');
    const m = {};
    (r.metrics || []).forEach((x) => { m[x.name] = x.value; });
    return {
      LayoutCount: m.LayoutCount, RecalcStyleCount: m.RecalcStyleCount,
      LayoutSec: +(m.LayoutDuration || 0).toFixed(3), RecalcStyleSec: +(m.RecalcStyleDuration || 0).toFixed(3),
      ScriptSec: +(m.ScriptDuration || 0).toFixed(3), Nodes: m.Nodes, JSHeapMB: +((m.JSHeapUsedSize || 0) / 1048576).toFixed(1),
    };
  } catch (e) { return { err: String(e.message || e) }; }
}

function makeLayerProbe(b) {
  const state = { layers: [] };
  b.ws.on('LayerTree.layerTreeDidChange', (p) => {
    if (p && Array.isArray(p.layers)) state.layers = p.layers;
  });
  return {
    state,
    async enable() { try { await b.ws.send('LayerTree.enable'); } catch (e) { /* ignore */ } },
    async poke() {
      await b.evalJs(`(() => {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01';
        document.body.appendChild(d);
        requestAnimationFrame(() => d.remove());
        return true;
      })()`);
      await sleep(120);
    },
    summary() {
      const ls = state.layers || [];
      let maxArea = 0, viewportSized = 0;
      ls.forEach((l) => {
        const a = (l.width || 0) * (l.height || 0);
        if (a > maxArea) maxArea = a;
        if ((l.width || 0) >= 1200 && (l.height || 0) >= 700) viewportSized++;
      });
      return { count: ls.length, viewportSized, maxArea };
    },
  };
}

// ---------- 练习窗口作用域 ----------
// ⛔ 桌面上的「代码农场」也有很多 button（编写农活代码 / 开始劳作 …），
//    直接扫 document 会误点它们（上一版就是这么翻车的）。
//    练习窗口的内容区是 WindowFrame 里 class 含 `overflow-auto` 的那层，用「提交答案」按钮反查。
const SCOPE = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const sub = Array.from(document.querySelectorAll('button')).find(n => norm(n.textContent) === '提交答案');
  if (!sub) return null;
  return sub.closest('.overflow-auto') || sub.parentElement;
})()`;

const ACTIONS = ['开始练习', '提交答案', '下一题', '返回设置', '练习同类题', '提交中...'];

/**
 * 在练习窗口里作答一题 —— **必须同时支持选择题与填空题**：
 *   练习池的第一题很可能是填空题（没有选项按钮，只有一个 input），
 *   上一版只点选项按钮，结果「提交答案」一直是 disabled，暴击根本没触发。
 */
const ANSWER_ONE = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const scope = ${SCOPE};
  if (!scope) return 'no-scope';
  // 1) 选择题（含复合题）选项按钮的**结构特征**：class 里有 text-left
  //    （「重新设置 / 下一题 / 提交答案 / 返回设置」这些动作按钮都没有 text-left，
  //     所以不要再按文本来排除 —— 上一版就是误点了「重新设置」，把页面重置回设置页了）
  const opts = Array.from(scope.querySelectorAll('button.text-left'))
    .filter(n => !n.disabled && norm(n.textContent).length > 0);
  if (opts.length) {
    opts[0].click();
    return 'option:' + norm(opts[0].textContent).slice(0, 18);
  }
  // 2) 填空题 / 复合题：给所有可见输入框填点东西（React 受控输入要用原生 setter + input 事件）
  const setVal = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputs = Array.from(scope.querySelectorAll('input, textarea'))
    .filter(el => !el.disabled && !el.readOnly && el.type !== 'hidden');
  if (!inputs.length) return 'no-input';
  inputs.forEach(el => setVal(el, 'x'));
  return 'filled:' + inputs.length;
})()`;

const CLICK_SUBMIT = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const btn = Array.from(document.querySelectorAll('button')).find(n => norm(n.textContent) === '提交答案');
  if (!btn) return 'no-submit-btn';
  if (btn.disabled) return 'submit-disabled';
  btn.click();
  return 'submitted';
})()`;

/** 触发一次暴击并采样「特效在屏期间」的层数；返回 { layers, dom, frames } */
async function critBurst(b, layer, label) {
  const answered = await b.evalJs(ANSWER_ONE);
  await sleep(350);
  const sub = await b.evalJs(CLICK_SUBMIT);
  if (sub !== 'submitted') return { answered, sub, layers: null, dom: null, frames: null };
  // 特效只有 1200ms，这里每 120ms 采一次，取最大值
  let best = { count: 0, viewportSized: 0, maxArea: 0 };
  let dom = null;
  for (let i = 0; i < 10; i++) {
    await sleep(110);
    await layer.poke();
    const s = layer.summary();
    if (s.count > best.count) best = s;
    const d = await b.evalJs(`(() => {
      const t = document.body.innerText || '';
      const fixedFull = Array.from(document.querySelectorAll('div')).filter(n => {
        const cs = getComputedStyle(n);
        return cs.position === 'fixed' && n.offsetWidth >= innerWidth - 2 && n.offsetHeight >= innerHeight - 2;
      });
      const withTransform = fixedFull.filter(n => (getComputedStyle(n).transform || 'none') !== 'none').length;
      const shadow = Array.from(document.querySelectorAll('div')).filter(n => {
        const s = getComputedStyle(n).textShadow || 'none';
        return s !== 'none' && /rgba?\\(/.test(s);
      }).length;
      return { hasText: t.includes('暴击！'), fixedFull: fixedFull.length, withTransform, shadow };
    })()`);
    if (d && d.hasText && (!dom || !dom.hasText)) dom = d;
    else if (d && d.hasText) dom = d;
  }
  const frames = await frameSample(b, 800);
  return { sub, layers: best, dom, frames };
}

const FARM_ROOT = `(() => {
  const el = Array.from(document.querySelectorAll('div')).find(n =>
    typeof n.className === 'string' && n.className.includes('inset-0') && n.className.includes('z-[5]'));
  return el || null;
})()`;

(async () => {
  let b = null;
  try {
    section('0. 启动浏览器并登录');
    b = await launchHeadless({ port: 9467, windowSize: VIEW });
    await b.ws.send('Performance.enable');
    const login = await loginAs(b, STUDENT.u, STUDENT.p);
    ok('以学生身份登录', login === 'submitted', login);
    console.log('    视口 = ' + (await b.evalJs('innerWidth + "x" + innerHeight')));

    section('1. 打开「练习」窗口并进入答题页');
    ok('双击桌面「练习」', (await dblclickIcon(b, '练习')) === 'opened');
    await sleep(1500);
    let started = 'not-found';
    for (let i = 0; i < 10; i++) {
      started = await b.evalJs(`(() => {
        const norm = (s) => (s || '').replace(/\\s+/g, '');
        const btns = Array.from(document.querySelectorAll('button')).filter(n => norm(n.textContent) === '开始练习');
        if (!btns.length) return 'not-found';
        if (btns[0].disabled) return 'disabled';
        btns[0].click();
        return 'started';
      })()`);
      if (started !== 'not-found') break;
      await sleep(600);
    }
    ok('进入答题页', started === 'started', started);
    await sleep(2000);
    ok('练习窗口内容区可定位（能按作用域找选项）',
      (await b.evalJs(`!!${SCOPE}`)) === true);

    section('2. 装 fetch 拦截器（合成 is_crit=true，不写库）');
    const hooked = await b.evalJs(`(() => {
      if (window.__critHookInstalled) return 'already';
      const orig = window.fetch.bind(window);
      window.__critHookHits = 0;
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.includes('/api/business/submit-answer')) {
          window.__critHookHits++;
          const body = { data: {
            is_correct: true, correct_answers: [], question_explanation: null,
            final_score: 20, power_multiplier: 2.6, is_crit: true, crit_rate: 80,
            current_streak: 1, current_crit_streak: 1, current_wrong: 0,
            new_honor: null, dropped_equipments: [],
          } };
          return Promise.resolve(new Response(JSON.stringify(body), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          }));
        }
        return orig(input, init);
      };
      window.__critHookInstalled = true;
      return 'installed';
    })()`);
    ok('拦截器已装', hooked === 'installed' || hooked === 'already', String(hooked));

    const layer = makeLayerProbe(b);
    await layer.enable();

    section('3. 基线：答题页静置（农场在，无特效）');
    await sleep(1200);
    await layer.poke();
    const baseLayers = layer.summary();
    const basePerf = await perfCounters(b);
    const baseFrames = await frameSample(b);
    console.log(`    层数=${baseLayers.count} 视口级层=${baseLayers.viewportSized} 最大层面积=${baseLayers.maxArea}`);
    console.log('    ' + JSON.stringify(basePerf));
    console.log(`    帧(仅供参考,headless不锁vsync): fps=${baseFrames.fps} p95=${baseFrames.p95Ms}ms max=${baseFrames.maxMs}ms`);
    ok('基线拿到合成层数据', baseLayers.count > 0, '层数=' + baseLayers.count);

    section('4. ★ 触发真实暴击（作用域内点选项 → 提交）并采样');
    const burst = await critBurst(b, layer, '农场在');
    const hits = await b.evalJs('window.__critHookHits');
    console.log(`    作答=${burst.answered} / 提交=${burst.sub}`);
    ok('★ 拦截器被命中（确实走了真实提交链路）', Number(hits) > 0, '命中 ' + hits + ' 次');
    ok('★ CritEffect 真实挂载（页面出现「暴击！」）', !!(burst.dom && burst.dom.hasText),
      JSON.stringify(burst.dom));
    if (burst.layers) {
      console.log(`    暴击期间: 层数=${burst.layers.count} 视口级层=${burst.layers.viewportSized} 最大层面积=${burst.layers.maxArea}`);
    }
    console.log(`    暴击期间全屏 fixed 层: ${burst.dom ? burst.dom.fixedFull : 'n/a'}（其中带动画 transform 的 ${burst.dom ? burst.dom.withTransform : 'n/a'}）`);
    console.log(`    带 text-shadow 的层: ${burst.dom ? burst.dom.shadow : 'n/a'}`);
    const critPerf = await perfCounters(b);
    console.log('    ' + JSON.stringify(critPerf));
    if (burst.frames) console.log(`    帧: fps=${burst.frames.fps} p95=${burst.frames.p95Ms}ms max=${burst.frames.maxMs}ms`);

    section('5. 滚动区体检（「滚轮控制不了滚动条」通常是滚动区被撑爆或合成器卡死）');
    // ⚠️ 合成 WheelEvent 在 Chrome 里**不会真的滚动**（非受信事件不执行默认动作），
    //    所以这里不去"模拟滚轮"，而是量滚动区本身：正常应为「内容区高度」，不应被撑成天文数字。
    const scrollInfo = await b.evalJs(`(() => {
      const scope = ${SCOPE};
      const out = {
        docScrollH: document.documentElement.scrollHeight,
        docClientH: document.documentElement.clientHeight,
        bodyScrollH: document.body.scrollHeight,
      };
      if (scope) { out.winScrollH = scope.scrollHeight; out.winClientH = scope.clientHeight; }
      return out;
    })()`);
    console.log('    滚动区: ' + JSON.stringify(scrollInfo));
    ok('练习窗口滚动区正常（未被特效撑爆）',
      !scrollInfo.winScrollH || scrollInfo.winScrollH < 20000, JSON.stringify(scrollInfo));

    section('6. A/B：把代码农场 display:none 后再测');
    const farmHidden = await b.evalJs(`(() => {
      const el = ${FARM_ROOT};
      if (!el) return 'no-farm';
      el.dataset.wbPrevDisplay = el.style.display || '';
      el.style.display = 'none';
      window.__farmEl = el;
      return 'hidden';
    })()`);
    if (farmHidden === 'hidden') {
      // 回到未答题状态（点「下一题」）再打一次
      await b.evalJs(`(() => {
        const norm = (s) => (s || '').replace(/\\s+/g, '');
        const btn = Array.from(document.querySelectorAll('button')).find(n => norm(n.textContent) === '下一题');
        if (btn) btn.click();
        return true;
      })()`);
      await sleep(900);
      await layer.poke();
      const noFarmBase = layer.summary();
      console.log(`    无农场基线: 层数=${noFarmBase.count} 视口级层=${noFarmBase.viewportSized} 最大层面积=${noFarmBase.maxArea}`);
      const burst2 = await critBurst(b, layer, '农场关');
      console.log(`    无农场+暴击: 层数=${burst2.layers ? burst2.layers.count : 'n/a'} 视口级层=${burst2.layers ? burst2.layers.viewportSized : 'n/a'} 最大层面积=${burst2.layers ? burst2.layers.maxArea : 'n/a'}`);
      console.log(`    无农场+暴击 全屏 fixed 层: ${burst2.dom ? burst2.dom.fixedFull : 'n/a'}（动画 transform ${burst2.dom ? burst2.dom.withTransform : 'n/a'}）`);
      const restored = await b.evalJs(`(() => {
        const el = window.__farmEl; if (!el) return 'gone';
        el.style.display = el.dataset.wbPrevDisplay || ''; return 'restored';
      })()`);
      ok('农场已还原（不留痕）', restored === 'restored' || restored === 'gone', String(restored));
    } else {
      ok('找到代码农场根节点', false, String(farmHidden));
    }

    section('汇总结论');
    console.log(`    农场在  : 静置层数=${baseLayers.count} / 暴击峰值层数=${burst.layers ? burst.layers.count : 'n/a'}`);
    console.log(`    暴击额外创建的合成层: ${burst.layers && baseLayers ? burst.layers.count - baseLayers.count : 'n/a'}`);
    console.log(`    暴击期间视口级 fixed 层: ${burst.dom ? burst.dom.fixedFull : 'n/a'}`);
    console.log(`    脚本内 JS 异常: ${b.jsErrors.length ? JSON.stringify(b.jsErrors.slice(0, 3)) : '无'}`);
  } catch (err) {
    fail++;
    console.log('  ✗ 脚本异常：' + (err && err.message ? err.message : err));
    console.error(err);
  } finally {
    try { if (b && b.close) b.close(); } catch (e) { /* ignore */ }
    console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
    process.exit(0);
  }
})();
