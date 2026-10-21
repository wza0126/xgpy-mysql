#!/usr/bin/env node
/**
 * verify_wrong_type_ui.cjs
 * ============================================================
 * 真机（headless Chrome）验证「学情分析 → 错题排行」的两处改动：
 *   1) 题型筛选下拉：默认全部题型；切「综合题」只留综合题；切「填空题」只留填空题；
 *   2) AI 语音讲解 · 连续讲解：队列里不含综合题，且顶部出现「已跳过 N 道综合题」提示。
 * 顺带截图存 .workbuddy/shots/。
 *
 * 用法：node scripts/debug/verify_wrong_type_ui.cjs
 * 前置：前端 dev 3266 + 后端 3101 都在跑。
 * 说明：连续讲解会真实触发一次生成（首题若已有缓存则不花 token）。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { launchHeadless } = require('./lib/cdp.cjs');

const BASE = process.env.XGPY_FE || 'http://127.0.0.1:3266';
const SHOT_DIR = path.join(__dirname, '..', '..', '..', '.workbuddy', 'shots');
const TEACHER = { user: 'teacher', pwd: 'xgpy666' };

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
}

/** 在页面里按纯文本找最小可点元素并点击 */
const CLICK_TEXT = (text) => `(() => {
  const want = ${JSON.stringify(text)};
  const all = [...document.querySelectorAll('button,a,div,li,span')].filter(e => e.offsetParent !== null);
  const hit = all.filter(e => (e.textContent || '').replace(/\\s+/g, ' ').trim() === want)
                 .sort((a, b) => a.textContent.length - b.textContent.length)[0];
  if (!hit) return 'notfound';
  (hit.closest('button,a,[role=button]') || hit).click();
  return 'ok';
})()`;

/** 读错题排行表格每行的题型列（第 4 列） */
const READ_ROWS = `(() => {
  const table = [...document.querySelectorAll('table')].find(t => (t.textContent || '').includes('错误次数'));
  if (!table) return { found: false };
  const rows = [...table.querySelectorAll('tbody tr')];
  return {
    found: true,
    count: rows.length,
    types: rows.map(tr => (tr.children[3]?.textContent || '').trim()),
    firstText: (rows[0]?.children[2]?.textContent || '').trim().slice(0, 40),
  };
})()`;

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const cdp = await launchHeadless({ port: 9472, userDataDir: path.join(os.tmpdir(), 'xgpy-chrome-wrongtype') });
  const shot = async (name) => {
    const r = await cdp.ws.send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(SHOT_DIR, name);
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log('  📸 ' + p);
    return p;
  };
  const waitFor = async (jsExpr, timeout = 30000, step = 600) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await cdp.evalJs(jsExpr).catch(() => null);
      if (v) return v;
      await cdp.sleep(step);
    }
    return null;
  };

  try {
    await cdp.ws.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    const go = async () => { await cdp.evalJs(`location.href = ${JSON.stringify(BASE + '/')}; 'go'`); await cdp.sleep(2600); };
    await go();
    const logged = await cdp.evalJs(`(async () => {
      const r = await fetch('/api/auth/secure-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ${JSON.stringify(TEACHER.user)}, password: ${JSON.stringify(TEACHER.pwd)}, deviceInfo: 'verify-wrongtype' })
      });
      const j = await r.json();
      const t = j && j.data && j.data.session && j.data.session.access_token;
      if (t) { localStorage.setItem('xgpy_token', t); localStorage.setItem('xgpy_user', JSON.stringify(j.data.user)); }
      return t ? 'ok' : 'fail';
    })()`);
    ok('教师登录并写入 localStorage', logged === 'ok');
    await go();

    await cdp.evalJs(CLICK_TEXT('学情分析'));
    const sectionReady = await waitFor(`(() => {
      const h = [...document.querySelectorAll('h3')].find(e => (e.textContent || '').trim() === '错题排行');
      return !!h;
    })()`, 30000);
    ok('进入「学情分析」并出现「错题排行」区块', !!sectionReady);

    // 等表格出数据
    let rows = await waitFor(`(() => { const r = ${READ_ROWS}; return r.found && r.count > 0 ? r : null; })()`, 30000);
    ok('错题排行加载出数据', !!rows, rows ? `本页 ${rows.count} 行` : '');

    // ---------- 1. 题型下拉 ----------
    const selInfo = await cdp.evalJs(`(() => {
      const sels = [...document.querySelectorAll('select')];
      const sel = sels.find(s => [...s.options].some(o => (o.textContent || '').includes('全部题型')));
      if (!sel) return { found: false };
      return { found: true, value: sel.value, options: [...sel.options].map(o => o.textContent.trim()) };
    })()`);
    ok('题型筛选下拉存在', !!selInfo.found);
    ok('下拉共 5 项（全部/选择/填空/综合/操作）', selInfo.options && selInfo.options.length === 5, JSON.stringify(selInfo.options));
    ok('默认值是「全部题型」', selInfo.value === 'all', `value=${selInfo.value}`);
    await cdp.evalJs(`(() => {
      const h = [...document.querySelectorAll('h3')].find(e => (e.textContent || '').trim() === '错题排行');
      (h.closest('.rounded-xl') || h.parentElement).scrollIntoView({ block: 'start' });
      return 'ok';
    })()`);
    await cdp.sleep(500);
    await shot('wrong_type_all.png');

    const setType = async (val) => {
      await cdp.evalJs(`(() => {
        const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => (o.textContent || '').includes('全部题型')));
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, ${JSON.stringify(val)});
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
      })()`);
      await cdp.sleep(1400);
      return waitFor(`(() => { const r = ${READ_ROWS}; return r.found ? r : null; })()`, 15000);
    };

    const comp = await setType('composite');
    ok('切「综合题」后表格有数据', !!comp && comp.count > 0, comp ? `${comp.count} 行` : '');
    ok('切「综合题」后每行题型都是综合题',
      !!comp && comp.types.every(t => t === '综合题'),
      comp ? JSON.stringify([...new Set(comp.types)]) : '');
    await cdp.evalJs(`(() => {
      const h = [...document.querySelectorAll('h3')].find(e => (e.textContent || '').trim() === '错题排行');
      (h.closest('.rounded-xl') || h.parentElement).scrollIntoView({ block: 'start' });
      return 'ok';
    })()`);
    await cdp.sleep(400);
    await shot('wrong_type_composite.png');

    const fill = await setType('fill_blank');
    ok('切「填空题」后每行题型都是填空题',
      !!fill && fill.count > 0 && fill.types.every(t => t === '填空题'),
      fill ? `${fill.count} 行 ${JSON.stringify([...new Set(fill.types)])}` : '');

    const allBack = await setType('all');
    ok('切回「全部题型」后恢复混合题型',
      !!allBack && new Set(allBack.types).size > 1,
      allBack ? JSON.stringify([...new Set(allBack.types)]) : '');

    // ---------- 2. 连续讲解跳过综合题 ----------
    // ⚠️ 用「按 button 文本精确匹配」而不是通用 CLICK_TEXT：
    //    错题排行在页面很下方，下拉菜单里的 button 虽然 offsetParent 正常，
    //    但页面未滚动到该区域时用 offsetParent 过滤容易被误判成不可见。
    const clickBtn = async (text) => cdp.evalJs(`(() => {
      const want = ${JSON.stringify(text)};
      const b = [...document.querySelectorAll('button')]
        .find((x) => (x.textContent || '').replace(/\\s+/g, ' ').trim() === want);
      if (!b) return 'notfound';
      b.click();
      return 'ok';
    })()`);

    const batchBtns = `(() => [...document.querySelectorAll('button')]
      .filter((b) => (b.textContent || '').includes('讲未讲解'))
      .map((b) => ({ t: (b.textContent || '').replace(/\\s+/g, ' ').trim(), disabled: b.disabled })))()`;

    // 2a. 筛到「综合题」时，批讲入口必须禁用（否则点了也是空队列）
    await setType('composite');
    await clickBtn('AI 语音讲解');
    await cdp.sleep(700);
    const compBtns = await cdp.evalJs(batchBtns);
    ok('筛到「综合题」时批讲按钮禁用',
      compBtns.length === 2 && compBtns.every((b) => b.disabled),
      JSON.stringify(compBtns));
    ok('筛到「综合题」时菜单标注当前题型',
      compBtns.length > 0 && compBtns[0].t.includes('综合题'), compBtns[0] ? compBtns[0].t : '');
    await clickBtn('AI 语音讲解'); // 收起菜单
    await cdp.sleep(300);

    // 2b. 回到全部题型，正常连播
    await setType('all');
    const openHit = await clickBtn('AI 语音讲解');
    ok('找到并点击「AI 语音讲解」按钮', openHit === 'ok', `click=${openHit}`);
    await cdp.sleep(600);
    const menuHit = await clickBtn('讲未讲解 · 错次前 20');
    ok('菜单里点击「讲未讲解 · 错次前 20」', menuHit === 'ok', `click=${menuHit}`);

    const playerState = await waitFor(`(() => {
      const t = document.body.innerText || '';
      const m = t.match(/第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*题/);
      if (!m) return null;
      const hits = t.match(/已跳过\\s*\\d+\\s*道综合题/g) || [];
      return { idx: Number(m[1]), total: Number(m[2]), hint: hits[0] || '', hits: hits.length };
    })()`, 45000);
    ok('讲解播放器打开且显示题号进度', !!playerState, playerState ? `第 ${playerState.idx}/${playerState.total} 题` : '');
    ok('连续讲解队列不超过 20 题', !!playerState && playerState.total <= 20, playerState ? `total=${playerState.total}` : '');

    const hintText = playerState ? playerState.hint : '';
    ok('提示「已跳过 N 道综合题」', /已跳过\s*\d+\s*道综合题/.test(hintText), hintText || '（无提示文案）');
    // 页面横幅在播放器（全屏）下面看不见，所以播放器顶栏也要有一份
    ok('播放器顶栏也显示跳过提示（页面横幅被全屏挡住）', !!playerState && playerState.hits >= 2, `出现 ${playerState ? playerState.hits : 0} 次`);

    await cdp.sleep(600);
    await shot('wrong_type_explain_queue.png');

    // 前端异常
    const errs = (cdp.jsErrors || []).filter((e) => !/favicon|ResizeObserver/i.test(String(e)));
    ok('页面无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    fail++;
    failures.push('脚本异常');
    console.error('脚本异常：', e);
  } finally {
    try { await cdp.close(); } catch { /* ignore */ }
    // Chrome 退出瞬间会锁住 Default 目录（EBUSY），清理失败不算回归失败；
    // 残留目录落在系统临时目录，不影响仓库
    try { fs.rmSync(path.join(os.tmpdir(), 'xgpy-chrome-wrongtype'), { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('失败项：\n  - ' + failures.join('\n  - ')); process.exitCode = 1; }
}

main();
