/**
 * 冒烟：练习模块「答错必须订正才能下一题」（2026-11-01 吴老要求）
 *
 * 要验证的四件事：
 *   1. 答错后出现订正提示，「下一题」按钮被禁用
 *   2. 订正**答错**仍锁着（不能靠乱点蒙过去）
 *   3. 订正**答对**后解锁，出现「订正正确」
 *   4. ⛔ 订正全程**不写库**：student_answers 只多出「第一次提交」那一条，
 *      订正多少次都不增加（不计答题次数、不积分、不算掌握）
 *
 * ⛔ 用测试账号 a，不碰真实学生。
 * 用法：cd backend && node scripts/debug/verify_practice_correction.cjs
 *      需要后端 3101、前端 3266 都在跑。
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

/** 练习窗口作用域：优先在「练习」窗口里找元素，找不到退回整页 */
const SCOPE = `(function(){
  const wins = Array.from(document.querySelectorAll('div')).filter(d => {
    const t = d.querySelector('h3, .font-bold');
    return false;
  });
  return document.body;
})()`;

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

function db() {
  return mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy', charset: 'utf8mb4',
  });
}

(async () => {
  let conn = await db();

  // 测试账号 a 的 id
  const [[stu]] = await conn.query("SELECT id FROM profiles WHERE username = 'a' LIMIT 1");
  if (!stu) { console.log('找不到测试账号 a'); process.exit(1); }
  const stuId = stu.id;
  const countAnswers = async () => {
    const [[r]] = await conn.query('SELECT COUNT(*) AS n FROM student_answers WHERE student_id = ?', [stuId]);
    return r.n;
  };

  const before = await countAnswers();
  console.log(`测试账号 a = ${stuId}`);
  console.log(`开始前 student_answers = ${before} 条`);

  let b;
  let exitCode = 0;
  try {
    // 沙箱里没有 playwright 自带的 chromium，用系统 Edge
    b = await launchHeadless({
      port: 9471,
      windowSize: VIEW,
      chromePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      userDataDir: 'C:/wza/xgpydev/.tmp-edge-profile',
    });
    const login = await loginAs(b, STUDENT.u, STUDENT.p);
    ok('以学生身份登录', login === 'submitted', login);

    section('1. 打开练习并开始答题');
    ok('双击桌面「练习」', (await dblclickIcon(b, '练习')) === 'opened');
    await sleep(1600);
    let started = 'not-found';
    for (let i = 0; i < 12; i++) {
      started = await b.evalJs(`(() => {
        const norm = (s) => (s || '').replace(/\\s+/g, '');
        const btns = Array.from(document.querySelectorAll('button')).filter(n => norm(n.textContent) === '开始练习');
        if (!btns.length) return 'not-found';
        if (btns[0].disabled) return 'disabled';
        btns[0].click();
        return 'started';
      })()`);
      if (started !== 'not-found') break;
      await sleep(700);
    }
    ok('进入答题页', started === 'started', started);

    section('2. 记录正确答案（只监听，不改响应）');
    const hooked = await b.evalJs(`(() => {
      if (window.__revealHook) return 'already';
      const orig = window.fetch.bind(window);
      window.__lastReveal = null;
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const p = orig(input, init);
        if (url.includes('/api/business/submit-answer')) {
          p.then((res) => {
            try { res.clone().json().then((j) => { window.__lastReveal = (j && j.data) || null; }).catch(() => {}); } catch (e) {}
          }).catch(() => {});
        }
        return p;
      };
      window.__revealHook = true;
      return 'installed';
    })()`);
    ok('监听器已装', hooked === 'installed' || hooked === 'already', String(hooked));

    // 等读题闸结束（按钮不再 disabled）
    let gateOpen = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      gateOpen = await b.evalJs(`(() => {
        const opts = Array.from(document.querySelectorAll('button')).filter(n => /^[A-D][.．]/.test((n.textContent||'').trim()));
        return opts.length > 0 && !opts[0].disabled;
      })()`);
      if (gateOpen === true) break;
    }
    ok('读题闸已放行', gateOpen === true);

    const qInfo = await b.evalJs(`(() => {
      const opts = Array.from(document.querySelectorAll('button')).filter(n => /^[A-D][.．]/.test((n.textContent||'').trim()));
      return { n: opts.length, first: opts.length ? opts[0].textContent.trim().slice(0, 12) : '' };
    })()`);
    console.log(`    当前题目选项数 = ${qInfo.n}（${qInfo.first}…）`);

    section('3. 故意答错 → 检查订正锁');
    // 点一个非正确的选项（先随便点 A；若 A 恰好是对的，第 4 步再兜）
    await b.evalJs(`(() => {
      const opts = Array.from(document.querySelectorAll('button')).filter(n => /^[A-D][.．]/.test((n.textContent||'').trim()));
      opts[opts.length - 1].click();   // 点最后一个选项，命中率低
      return 'clicked';
    })()`);
    await sleep(2600);   // 等接口返回 + 结果页渲染

    const reveal = await b.evalJs('window.__lastReveal && window.__lastReveal.correct_answers ? JSON.stringify(window.__lastReveal.correct_answers) : null');
    const isCorrect1 = await b.evalJs('window.__lastReveal ? !!window.__lastReveal.is_correct : null');
    console.log(`    第一次提交：is_correct=${isCorrect1}，正确答案=${reveal}`);

    const afterFirst = await countAnswers();
    ok('第一次提交写入 1 条答题记录', afterFirst === before + 1, `${before} → ${afterFirst}`);

    if (isCorrect1 === true) {
      console.log('    （这题碰巧答对了，换一题再测）—— 直接检查第 4 步');
    }

    const st1 = await b.evalJs(`(() => {
      const t = document.body.innerText || '';
      const nextBtn = Array.from(document.querySelectorAll('button')).find(n => /下一题/.test(n.textContent || ''));
      const locked = !!nextBtn && nextBtn.disabled;
      return {
        hasCorrectionTips: t.includes('需要订正') || t.includes('订正后才能下一题'),
        nextDisabled: locked,
        hasConfirmBtn: Array.from(document.querySelectorAll('button')).some(n => /确认订正/.test(n.textContent || '')),
      };
    })()`);
    if (isCorrect1 !== true) {
      ok('答错后出现订正提示', st1.hasCorrectionTips === true, JSON.stringify(st1));
      ok('答错后「下一题」被禁用', st1.nextDisabled === true, `disabled=${st1.nextDisabled}`);
    }

    section('4. 订正时再答错 → 仍然锁着（不能靠乱点蒙过去）');

    const wrongIdx = await b.evalJs(`(() => {
      let cp = window.__lastReveal && window.__lastReveal.correct_answers;
      if (typeof cp === 'string') { try { cp = JSON.parse(cp); } catch (e) {} }
      if (cp && !Array.isArray(cp)) cp = cp.answers || cp;
      const list = (Array.isArray(cp) ? cp : [cp]).map(x => String(x));
      const letter = list.find(x => /^[A-Da-d]$/.test(String(x).trim()));
      const correctIdx = letter ? String(letter).trim().toUpperCase().charCodeAt(0) - 65 : -1;
      const opts = Array.from(document.querySelectorAll('button')).filter(n => /^[A-D][.．]/.test((n.textContent||'').trim()));
      for (let i = 0; i < opts.length; i++) if (i !== correctIdx) return i;
      return -1;
    })()`);

    if (wrongIdx >= 0) {
      await b.evalJs(`(() => {
        const opts = Array.from(document.querySelectorAll('button')).filter(n => /^[A-D][.．]/.test((n.textContent||'').trim()));
        if (opts[${wrongIdx}]) opts[${wrongIdx}].click();
        return 'clicked';
      })()`);
      await sleep(700);
      const stWrong = await b.evalJs(`(() => {
        const t = document.body.innerText || '';
        const nextBtn = Array.from(document.querySelectorAll('button')).find(n => /下一题/.test(n.textContent || ''));
        return {
          stillLocked: !!nextBtn && nextBtn.disabled,
          hint: t.includes('还不对'),
          notPassed: !t.includes('订正正确'),
        };
      })()`);
      ok('订正又答错：下一题仍锁定', stWrong.stillLocked === true, JSON.stringify(stWrong));
      ok('订正又答错：提示「还不对」', stWrong.hint === true, JSON.stringify(stWrong));
      ok('订正又答错：不算通过', stWrong.notPassed === true);
    } else {
      ok('能找到错误选项', false, String(wrongIdx));
    }

    section('5. 订正答对 → 解锁');
    // 从 correct_answers 推出应该点第几个选项
    const pick = await b.evalJs(`(() => {
      let cp = window.__lastReveal && window.__lastReveal.correct_answers;
      if (!cp) return { err: 'no-answer' };
      // ⛔ 回执里的 correct_answers 是 '{"answers":["A"]}' 这种字符串，必须先解一层
      if (typeof cp === 'string') { try { cp = JSON.parse(cp); } catch (e) {} }
      if (cp && !Array.isArray(cp)) cp = cp.answers || cp.answer || cp;
      const list = (Array.isArray(cp) ? cp : [cp]).map(x => String(x));
      const norm = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\\s+/g, '').toLowerCase();
      const opts = Array.from(document.querySelectorAll('button')).filter(n => /^[A-D][.．]/.test((n.textContent||'').trim()));
      const texts = opts.map(o => norm((o.textContent||'').replace(/^[A-D][.．]/, '')));
      // ① 答案是字母
      const letter = list.find(x => /^[A-Da-d]$/.test(x.trim()));
      if (letter) return { idx: letter.trim().toUpperCase().charCodeAt(0) - 65, how: 'letter' };
      // ② 答案是选项文本
      for (const a of list) {
        const i = texts.findIndex(t => t && (t === norm(a) || t.includes(norm(a)) || norm(a).includes(t)));
        if (i >= 0) return { idx: i, how: 'text' };
      }
      return { err: 'no-match', list, texts };
    })()`);
    console.log(`    应点选项：${JSON.stringify(pick)}`);

    if (pick && typeof pick.idx === 'number') {
      await b.evalJs(`(() => {
        const opts = Array.from(document.querySelectorAll('button')).filter(n => /^[A-D][.．]/.test((n.textContent||'').trim()));
        opts[${pick.idx}].click();
        return 'clicked';
      })()`);
      await sleep(900);

      const st2 = await b.evalJs(`(() => {
        const t = document.body.innerText || '';
        const nextBtn = Array.from(document.querySelectorAll('button')).find(n => /下一题/.test(n.textContent || ''));
        return {
          corrected: t.includes('订正正确'),
          nextDisabled: !!nextBtn && nextBtn.disabled,
          stillNeed: t.includes('需要订正'),
        };
      })()`);
      ok('订正答对后显示「订正正确」', st2.corrected === true, JSON.stringify(st2));
      ok('订正答对后「下一题」解锁', st2.nextDisabled === false, `disabled=${st2.nextDisabled}`);

      const afterCorrect = await countAnswers();
      ok('订正**不写库**（答题记录数不变）', afterCorrect === afterFirst, `${afterFirst} → ${afterCorrect}`);

      section('6. 再点几次正确选项，确认仍然不写库');
      for (let i = 0; i < 2; i++) {
        await b.evalJs(`(() => {
          const opts = Array.from(document.querySelectorAll('button')).filter(n => /^[A-D][.．]/.test((n.textContent||'').trim()));
          if (opts[${pick.idx}] && !opts[${pick.idx}].disabled) opts[${pick.idx}].click();
          return 'clicked';
        })()`);
        await sleep(400);
      }
      const afterExtra = await countAnswers();
      ok('反复点击不产生额外记录', afterExtra === afterFirst, `${afterFirst} → ${afterExtra}`);
    } else {
      ok('能定位到正确选项', false, JSON.stringify(pick));
    }

    section('7. 点「下一题」应能翻页');
    const moved = await b.evalJs(`(() => {
      const nextBtn = Array.from(document.querySelectorAll('button')).find(n => /下一题/.test(n.textContent || ''));
      if (!nextBtn || nextBtn.disabled) return 'locked';
      nextBtn.click();
      return 'clicked';
    })()`);
    await sleep(1500);
    const gone = await b.evalJs(`!(document.body.innerText || '').includes('需要订正')`);
    ok('点下一题后离开结果页', moved === 'clicked' && gone === true, `${moved}, tips-gone=${gone}`);
  } catch (e) {
    console.error('\n执行出错:', e.message);
    exitCode = 1;
  } finally {
    if (b && b.close) { try { await b.close(); } catch (e) {} }
    await conn.end();
  }

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : exitCode);
})();
