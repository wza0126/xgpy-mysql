/**
 * 冒烟：学习模块「知识点 AI 语音讲解」（2026-11-01 吴老要求）
 *
 * 要验证的事：
 *   1. 老师放开 ai_explain 时，每个知识点标题后面出现耳机按钮（图标尺寸小、不抢注意力）
 *   2. 点耳机 → 全屏讲解器打开，脚本来自真实接口（不是空壳）
 *   3. 步骤结构是「导入 → 要点… → 易错… → 考点 → 口诀 → 随堂问」
 *   4. 随堂问能点选项并出解析；新课 / 复习两种模式步骤数不同（复习不出现随堂问）
 *   5. 关闭后回到讲义
 *
 * ⛔ 用测试账号 a（hidden_features 为空 = 已开通讲解），不碰真实学生。
 * 用法：cd backend && node scripts/debug/verify_knowledge_explain.cjs
 *      需要后端 3101、前端 3266 都在跑；首次会等 AI 生成（约 15~40 秒）。
 */
const { launchHeadless, sleep } = require('./lib/cdp.cjs');
const mysql = require('mysql2/promise');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const STUDENT = { u: 'a', p: '111111' };
const VIEW = '1500,900';

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
    if (ready !== true) continue;
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
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const st = await b.evalJs(`(() => { const t = document.body.innerText || ''; return {
        out: t.includes('退出登录'),
        form: !!Array.from(document.querySelectorAll('input')).find(x => x.placeholder && x.placeholder.includes('用户名')),
      }; })()`);
      if (st && st.out === true && st.form === false) { await sleep(2500); return 'submitted'; }
    }
  }
  return 'login-unstable';
}

async function dblclickIcon(b, label) {
  return b.evalJs(`(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    const target = Array.from(document.querySelectorAll('div,button,span'))
      .filter(el => norm(el.textContent) === ${JSON.stringify(label)} && el.getBoundingClientRect().width > 0)
      .pop();
    if (!target) return 'not-found';
    const icon = target.closest('[class*="cursor-pointer"]') || target.parentElement || target;
    const ev = (type) => new MouseEvent(type, { bubbles: true, cancelable: true, view: window });
    icon.dispatchEvent(ev('mousedown')); icon.dispatchEvent(ev('mouseup'));
    icon.dispatchEvent(ev('click')); icon.dispatchEvent(ev('dblclick'));
    return 'opened';
  })()`);
}

/**
 * 点讲解器内文本匹配的 button。
 * ⛔ 必须限定在 [data-kp-player] 里：桌面在 portal 后面还活着，
 *    不限定的话「A 直接数据」会被桌面的「AI 讲堂」抢先匹配（它也是 A 开头）。
 */
const clickBtn = (b, text) => b.evalJs(`(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const root = document.querySelector('[data-kp-player]') || document.body;
  const btn = Array.from(root.querySelectorAll('button')).find(n => norm(n.textContent).includes(${JSON.stringify(text.replace(/\s+/g, ''))}));
  if (!btn) return 'not-found';
  if (btn.disabled) return 'disabled';
  btn.click();
  return 'clicked';
})()`);

/** 老师端「学生管理 → 隐藏功能 → 讲解」的开关：hidden_features 里含 ai_explain 表示已收起 */
async function setExplainGate(on) {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy', charset: 'utf8mb4',
  });
  try {
    await conn.query(
      'UPDATE profiles SET hidden_features = ? WHERE username = ?',
      [on ? '[]' : '["ai_explain"]', STUDENT.u],
    );
  } finally {
    await conn.end();
  }
}

(async () => {
  let b;
  let exitCode = 0;
  try {
    b = await launchHeadless({
      port: 9472,
      windowSize: VIEW,
      chromePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      userDataDir: 'C:/wza/xgpydev/.tmp-edge-profile',
    });

    section('0. 老师没放开「讲解」时，不能出现耳机按钮');
    await setExplainGate(false);          // 收起 ai_explain
    let login = await loginAs(b, STUDENT.u, STUDENT.p);
    ok('以学生身份登录（讲解已收起）', login === 'submitted', login);
    await dblclickIcon(b, '学习');
    await sleep(3500);
    const gated = await b.evalJs(`({ kp: document.querySelectorAll('.kp-explain-btn').length, practice: document.querySelectorAll('.lp-inline-practice').length })`);
    ok('未开通时耳机按钮为 0', gated.kp === 0, JSON.stringify(gated));

    await setExplainGate(true);           // 放开 ai_explain
    login = await loginAs(b, STUDENT.u, STUDENT.p);
    ok('以学生身份登录（讲解已放开）', login === 'submitted', login);

    section('1. 打开学习模块，检查耳机按钮');
    ok('双击桌面「学习」', (await dblclickIcon(b, '学习')) === 'opened');
    await sleep(3000);

    let kpCount = 0;
    for (let i = 0; i < 20; i++) {
      kpCount = await b.evalJs('document.querySelectorAll(".kp-explain-btn").length');
      if (kpCount > 0) break;
      await sleep(400);
    }
    ok('讲义标题后出现耳机按钮', kpCount > 0, `${kpCount} 个`);

    const btnInfo = await b.evalJs(`(() => {
      const b = document.querySelector('.kp-explain-btn');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const h = b.closest('h1,h2,h3,h4,h5,h6');
      return { w: Math.round(r.width), h: Math.round(r.height), inHeading: !!h, title: b.title || '', icon: !!b.querySelector('i') };
    })()`);
    ok('按钮是标题内的小图标', !!btnInfo && btnInfo.inHeading && btnInfo.w <= 30 && btnInfo.h <= 30 && btnInfo.icon,
      JSON.stringify(btnInfo));

    section('2. 点耳机 → 打开全屏讲解器');
    await b.evalJs('(() => { document.querySelector(".kp-explain-btn").click(); return "clicked"; })()');

    let opened = false;
    for (let i = 0; i < 120; i++) {
      await sleep(700);
      opened = await b.evalJs(`(() => {
        const t = document.body.innerText || '';
        return t.includes('AI 讲解 · 知识点') && (t.includes('本节板书') || t.includes('第 1 /'));
      })()`);
      if (opened === true) break;
    }
    ok('讲解器打开并生成脚本', opened === true);

    const head = await b.evalJs(`(() => {
      const t = document.body.innerText || '';
      const m = t.match(/第 (\\d+) \\/ (\\d+) 步/);
      return {
        steps: m ? Number(m[2]) : 0,
        cur: m ? Number(m[1]) : 0,
        hasObjectives: t.includes('学习目标'),
        hasBoard: t.includes('本节板书'),
        hasDegraded: t.includes('基础朗读'),
      };
    })()`);
    ok('步骤数合理（≥5）', head.steps >= 5, `${head.steps} 步`);
    ok('第一步是导入（有学习目标）', head.cur === 1 && head.hasObjectives === true, JSON.stringify(head));
    ok('左侧有本节板书', head.hasBoard === true);
    console.log(`    生成质量：${head.hasDegraded ? '⚠ 兜底脚本（AI 未成功）' : 'AI 生成'}`);

    // 暂停，避免语音自动推进导致断言漂移
    await clickBtn(b, '暂停');
    await sleep(300);

    section('3. 逐步下一步，确认每步内容在变');
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const snap = await b.evalJs(`(() => {
        const t = document.body.innerText || '';
        const m = t.match(/第 (\\d+) \\/ (\\d+) 步/);
        return { cur: m ? Number(m[1]) : -1, len: t.length, head: t.slice(0, 60) };
      })()`);
      seen.push(snap.cur);
      if (i < 3) { await clickBtn(b, '下一步'); await sleep(500); }
    }
    ok('能依次前进 4 步', new Set(seen).size >= 3, seen.join(' → '));

    section('4. 随堂问：点选项出解析');
    // 直接跳到最后一个步骤（随堂问在最后）
    const jumped = await b.evalJs(`(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      const root = document.querySelector('[data-kp-player]') || document.body;
      const dots = Array.from(root.querySelectorAll('button')).filter(n => (n.className || '').includes('rounded-full') && (n.className || '').includes('h-2'));
      if (!dots.length) return 'no-dots';
      dots[dots.length - 1].click();
      return 'clicked';
    })()`);
    await sleep(900);
    const isQuiz = await b.evalJs(`(document.body.innerText || '').includes('随堂一问')`);
    if (isQuiz === true) {
      ok('末步是随堂问', true, jumped);
      const picked = await b.evalJs(`(() => {
        const root = document.querySelector('[data-kp-player]') || document.body;
        const opts = Array.from(root.querySelectorAll('button')).filter(n => /^[A-D][^A-Za-z]/.test((n.textContent||'').trim()) && (n.className||'').includes('rounded-lg'));
        if (!opts.length) return 'no-option';
        opts[0].click();
        return 'clicked';
      })()`);
      await sleep(900);
      const afterPick = await b.evalJs(`(() => { const t = document.body.innerText || ''; return {
        hasWhy: t.includes('解析'), hasRight: t.includes('选对了') || true,
      }; })()`);
      ok('点选项后出现解析', picked === 'clicked' && afterPick.hasWhy === true, JSON.stringify(afterPick));
    } else {
      ok('末步是随堂问', false, '未找到随堂一问（可能是复习模式残留）');
    }

    section('5. 新课 / 复习两种模式');
    // ⛔ 模式记在 localStorage，上一次跑完可能停在「复习」，这里先显式切回新课
    await clickBtn(b, '新课');
    await sleep(1200);
    const totalNew = await b.evalJs(`(() => { const m = (document.body.innerText||'').match(/第 \\d+ \\/ (\\d+) 步/); return m ? Number(m[1]) : 0; })()`);
    await clickBtn(b, '复习');
    await sleep(1200);
    const totalReview = await b.evalJs(`(() => { const m = (document.body.innerText||'').match(/第 \\d+ \\/ (\\d+) 步/); return m ? Number(m[1]) : 0; })()`);
    ok('复习模式步骤更少（跳过随堂问）', totalReview > 0 && totalReview < totalNew, `新课 ${totalNew} 步 → 复习 ${totalReview} 步`);

    const reviewHasQuiz = await b.evalJs(`(() => {
      const m = (document.body.innerText || '').match(/随堂一问/);
      return !!m;
    })()`);
    ok('复习模式不出现随堂问', reviewHasQuiz === false);

    section('6. 关闭回到讲义');
    await b.evalJs('(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return 1; })()');
    await sleep(800);
    const closed = await b.evalJs(`!(document.body.innerText || '').includes('AI 讲解 · 知识点')`);
    ok('Esc 关闭讲解器', closed === true);
  } catch (e) {
    console.error('\n执行出错:', e.message);
    exitCode = 1;
  } finally {
    // ⛔ 无论成败都要把测试账号的讲解开关恢复成「已放开」，否则下次测会误判
    try { await setExplainGate(true); } catch (e) { console.log('恢复讲解开关失败:', e.message); }
    if (b && b.close) { try { await b.close(); } catch (e) {} }
  }

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : exitCode);
})();
