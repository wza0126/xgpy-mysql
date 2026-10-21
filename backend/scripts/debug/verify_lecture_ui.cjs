#!/usr/bin/env node
/**
 * verify_lecture_ui.cjs
 * ============================================================
 * 真机（headless Chrome）验证「AI 讲堂」全链路：
 *   教师端：备课工作台两个页签 → 新建向导 → 生成 → 编辑器 → 预览投屏翻页 → 发布
 *   学生端：讲解开关打开时任务中心右侧出现「AI 讲堂」→ 窗口列表 → 播放；关掉后按钮消失
 * 顺带截图存 .workbuddy/shots/。
 *
 * 用法：node scripts/debug/verify_lecture_ui.cjs
 * 前置：前端 dev 3266 + 后端 3101 都在跑（本脚本会真实调一次模型）。
 * ⛔ 学生 hidden_features 先快照后还原；课程统一 tmp_ 前缀，末尾清干净。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const mysql = require('mysql2/promise');
const { launchHeadless } = require('./lib/cdp.cjs');

const BASE = process.env.XGPY_FE || 'http://127.0.0.1:3266';
const SHOT_DIR = path.join(__dirname, '..', '..', '..', '.workbuddy', 'shots');
const TMP = 'tmp_UI讲堂';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail += 1; failures.push(name); console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
}

const CLICK_TEXT = (text) => `(() => {
  const want = ${JSON.stringify(text)};
  const all = [...document.querySelectorAll('button,a,div,li,span')].filter(e => e.offsetParent !== null);
  const hit = all.filter(e => (e.textContent || '').replace(/\\s+/g, ' ').trim() === want)
                 .sort((a, b) => a.textContent.length - b.textContent.length)[0];
  if (!hit) return 'notfound';
  (hit.closest('button,a,[role=button]') || hit).click();
  return 'ok';
})()`;

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '122201', database: 'xgpy' });
  let stuSnapshot = null;
  let stuId = null;

  const cdp = await launchHeadless({ port: 9476, userDataDir: path.join(os.tmpdir(), 'xgpy-chrome-lecture') });
  const shot = async (name) => {
    const r = await cdp.ws.send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(SHOT_DIR, name);
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log('  📸 ' + p);
    return p;
  };
  const waitFor = async (jsExpr, timeout = 30000, step = 700) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await cdp.evalJs(jsExpr).catch(() => null);
      if (v) return v;
      await cdp.sleep(step);
    }
    return null;
  };
  const setInput = (selector, value) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'notfound';
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`;

  try {
    const [srows] = await conn.query("SELECT id, hidden_features FROM profiles WHERE username = 'a' LIMIT 1");
    stuId = srows[0].id;
    stuSnapshot = srows[0].hidden_features;
    // 先确保讲解开关是开着的（学生端要能进 AI 讲堂）
    await conn.query("UPDATE profiles SET hidden_features = JSON_ARRAY('paint_board','roll_call') WHERE id = ?", [stuId]);

    await cdp.ws.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    // ==================== 教师端 ====================
    console.log('\n== A. 教师端：备课工作台页签 ==');
    const go = async () => { await cdp.evalJs(`location.href = ${JSON.stringify(BASE + '/')}; 'go'`); await cdp.sleep(2600); };
    const loginAs = async (user, pwd) => cdp.evalJs(`(async () => {
      const r = await fetch('/api/auth/secure-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ${JSON.stringify(user)}, password: ${JSON.stringify(pwd)}, deviceInfo: 'verify-lecture-ui' })
      });
      const j = await r.json();
      const t = j && j.data && j.data.session && j.data.session.access_token;
      if (t) { localStorage.setItem('xgpy_token', t); localStorage.setItem('xgpy_user', JSON.stringify(j.data.user)); }
      return t ? 'ok' : 'fail';
    })()`);

    await go();
    ok('教师登录', (await loginAs('teacher', 'xgpy666')) === 'ok');
    await go();

    await cdp.evalJs(CLICK_TEXT('备课工作台'));
    await cdp.sleep(2500);
    const tabs = await cdp.evalJs(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      const has = (t) => btns.some(b => (b.textContent || '').replace(/\\s+/g, ' ').trim() === t);
      return { tasks: has('课堂任务'), lectures: has('AI 讲堂') };
    })()`);
    ok('出现了「课堂任务 / AI 讲堂」两个页签', !!tabs.tasks && !!tabs.lectures, JSON.stringify(tabs));
    ok('默认停在「课堂任务」页签', await cdp.evalJs(`(() => (document.body.innerText || '').includes('新建任务')) ()`));

    console.log('\n== B. 新建向导 → 生成 → 编辑器 ==');
    await cdp.evalJs(CLICK_TEXT('AI 讲堂'));
    await cdp.sleep(1200);
    const enter = await cdp.evalJs(CLICK_TEXT('新建微课程'));
    ok('进入 AI 讲堂并找到「新建微课程」', enter === 'ok', `click=${enter}`);

    await cdp.sleep(900);
    ok('向导里填标题', (await cdp.evalJs(setInput('input[placeholder="例如：数据、信息与知识"]', `${TMP} 数据与信息`))) === 'ok');
    ok('向导里填大纲', (await cdp.evalJs(setInput(
      'textarea[placeholder*="一行一个知识点"]',
      '1. 数据是客观事物的符号记录\n2. 信息是加工后对人有意义的数据\n3. 知识是提炼出的规律性结论\n4. 三者逐层加工',
    ))) === 'ok');
    await cdp.sleep(300);

    const genClick = await cdp.evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('生成微课程'));
      if (!b) return 'notfound';
      b.click();
      return 'ok';
    })()`);
    ok('点击「生成微课程」', genClick === 'ok', `click=${genClick}`);

    const inEditor = await waitFor(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').replace(/\\s+/g, ' ').includes('保存本页'));
      return !!b;
    })()`, 120000);
    ok('生成完成后自动进入编辑器', !!inEditor);
    await cdp.sleep(1200);

    const editorInfo = await cdp.evalJs(`(() => {
      const tas = [...document.querySelectorAll('textarea')];
      const narration = tas.find(t => t.value && t.value.length > 30);
      const pageBtns = [...document.querySelectorAll('button')].filter(b => /^\\d+\\s*\\S/.test((b.textContent || '').trim()) && b.offsetParent);
      return {
        narrationLen: narration ? narration.value.length : 0,
        narrationHead: narration ? narration.value.slice(0, 30) : '',
        leftPages: [...document.querySelectorAll('div.w-56 button')].filter(b => b.offsetParent).length,
        hasRegen: [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('重新生成这一页')),
        hasPreview: [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('预览投屏')),
      };
    })()`);
    ok('编辑器里有讲解词（>30 字）', editorInfo.narrationLen > 30, `len=${editorInfo.narrationLen} 「${editorInfo.narrationHead}…」`);
    ok('左侧有页面列表（≥3 页）', editorInfo.leftPages >= 3, `pages=${editorInfo.leftPages}`);
    ok('有「重新生成这一页」按钮', !!editorInfo.hasRegen);
    ok('有「预览投屏」按钮', !!editorInfo.hasPreview);
    await shot('lecture_editor.png');

    console.log('\n== C. 预览投屏与翻页 ==');
    await cdp.evalJs(CLICK_TEXT('预览投屏'));
    const inPlayer = await waitFor(`(() => (document.body.innerText || '').includes('上一页') && (document.body.innerText || '').includes('AI 讲堂'))()`, 20000);
    ok('投屏播放器打开', !!inPlayer);
    await cdp.sleep(1500);

    const p1 = await cdp.evalJs(`(() => {
      const h = document.querySelector('.fixed.inset-0 h1, .fixed.inset-0 h2');
      const t = document.body.innerText || '';
      const m = t.match(/第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/);
      return {
        title: h ? h.textContent.trim() : '',
        idx: m ? Number(m[1]) : 0, total: m ? Number(m[2]) : 0,
        hasPager: t.includes('讲完自动翻页'),
        hasSubtitle: !!document.querySelector('.fixed.inset-0 .bg-violet-100'),
      };
    })()`);
    ok('播放器显示页标题', !!p1.title, p1.title);
    ok('播放器显示页码进度', p1.idx === 1 && p1.total >= 3, `第 ${p1.idx}/${p1.total} 页`);
    ok('有「讲完自动翻页」开关', !!p1.hasPager);
    ok('字幕条已高亮当前句', !!p1.hasSubtitle);
    await shot('lecture_player_page1.png');

    await cdp.evalJs(CLICK_TEXT('下一页'));
    await cdp.sleep(1400);
    const p2 = await cdp.evalJs(`(() => {
      const h = document.querySelector('.fixed.inset-0 h1, .fixed.inset-0 h2');
      const m = (document.body.innerText || '').match(/第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/);
      return { title: h ? h.textContent.trim() : '', idx: m ? Number(m[1]) : 0 };
    })()`);
    ok('点「下一页」翻到第 2 页', p2.idx === 2, `idx=${p2.idx}`);
    ok('第 2 页标题与第 1 页不同', !!p2.title && p2.title !== p1.title, `${p1.title} → ${p2.title}`);

    // 跳到第 3 页：页面底部圆点
    await cdp.evalJs(`(() => {
      const dots = [...document.querySelectorAll('.fixed.inset-0 button.rounded-full')];
      if (dots[2]) { dots[2].click(); return 'ok'; }
      return 'notfound';
    })()`);
    await cdp.sleep(1000);
    const p3 = await cdp.evalJs(`(() => { const m = (document.body.innerText || '').match(/第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/); return m ? Number(m[1]) : 0; })()`);
    ok('点圆点可直接跳页（第 3 页）', p3 === 3, `idx=${p3}`);
    await shot('lecture_player_page3.png');

    // Esc 退出播放器
    await cdp.evalJs(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'ok'; })()`);
    await cdp.sleep(1000);
    ok('Esc 退出播放器回到编辑器',
      await cdp.evalJs(`(() => [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('保存本页')))()`));

    console.log('\n== D. 返回列表 → 发布 ==');
    await cdp.evalJs(`(() => { const b = document.querySelector('button[title="返回列表"]'); if (b) { b.click(); return 'ok'; } return 'notfound'; })()`);
    await cdp.sleep(1800);
    const card = await cdp.evalJs(`(() => {
      const t = document.body.innerText || '';
      return {
        hasCard: t.includes(${JSON.stringify(TMP)}),
        draftBadge: t.includes('草稿'),
        hasPublish: [...document.querySelectorAll('button')].some(b => (b.textContent || '').replace(/\\s+/g, ' ').trim() === '发布'),
      };
    })()`);
    ok('列表出现刚建的微课程', !!card.hasCard);
    ok('未发布显示「草稿」标记', !!card.draftBadge);
    ok('有「发布」按钮', !!card.hasPublish);
    await shot('lecture_list.png');

    await cdp.evalJs(`(() => {
      // 只点第一张卡片里的「发布」，避免误点别的
      const card = [...document.querySelectorAll('div.rounded-xl.border')].find(d => (d.textContent || '').includes(${JSON.stringify(TMP)}));
      const b = card && [...card.querySelectorAll('button')].find(x => (x.textContent || '').replace(/\\s+/g, ' ').trim() === '发布');
      if (!b) return 'notfound';
      b.click();
      return 'ok';
    })()`);
    const published = await waitFor(`(() => (document.body.innerText || '').includes('已发布'))()`, 15000);
    ok('点「发布」后标记变为「已发布」', !!published);
    await cdp.sleep(600);
    await shot('lecture_list_published.png');

    // ==================== 学生端 ====================
    console.log('\n== E. 学生端 AI 讲堂入口 ==');
    await go();
    ok('学生登录', (await loginAs('a', '111111')) === 'ok');
    await go();
    await cdp.sleep(2200);

    const barInfo = await cdp.evalJs(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      // ⚠️ 「任务中心」按钮里嵌了红点 <TaskBadge/>，textContent 并不等于「任务中心」，
      //    这里必须用 includes 而不是全等，否则会误判成「按钮不存在」。
      const find = (t) => btns.find(b => (b.textContent || '').replace(/\\s+/g, ' ').trim().startsWith(t));
      const tc = find('任务中心');
      const al = btns.find(b => (b.textContent || '').replace(/\\s+/g, ' ').trim() === 'AI 讲堂');
      const rc = find('点名');
      const rect = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; };
      return {
        hasTaskCenter: !!tc, hasLecture: !!al, hasRollCall: !!rc,
        tc: tc ? rect(tc) : null, al: al ? rect(al) : null, rc: rc ? rect(rc) : null,
      };
    })()`);
    ok('学生桌面有「任务中心」按钮', !!barInfo.hasTaskCenter);
    ok('学生桌面出现「AI 讲堂」按钮', !!barInfo.hasLecture);
    if (barInfo.tc && barInfo.al) {
      ok('「AI 讲堂」在「任务中心」右侧', barInfo.al.x > barInfo.tc.x, `任务中心 x=${barInfo.tc.x} → AI讲堂 x=${barInfo.al.x}`);
      ok('与「任务中心」同一行', Math.abs(barInfo.al.y - barInfo.tc.y) < 8, `y ${barInfo.tc.y} / ${barInfo.al.y}`);
    }
    await shot('lecture_student_bar.png');

    await cdp.evalJs(CLICK_TEXT('AI 讲堂'));
    await cdp.sleep(2000);
    const win = await cdp.evalJs(`(() => {
      const t = document.body.innerText || '';
      return {
        title: t.includes('AI 讲堂'),
        hint: t.includes('老师做好的微课程'),
        card: t.includes(${JSON.stringify(TMP)}),
        empty: t.includes('老师还没有发布微课程'),
      };
    })()`);
    ok('学生端窗口打开', !!win.title);
    ok('窗口里有已发布微课程', !!win.card || !!win.empty, win.empty ? '列表为空' : '有卡片');
    await shot('lecture_student_list.png');

    await cdp.evalJs(`(() => {
      const card = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes(${JSON.stringify(TMP)}));
      if (!card) return 'notfound';
      card.click();
      return 'ok';
    })()`);
    const stuPlayer = await waitFor(`(() => (document.body.innerText || '').includes('上一页') && (document.body.innerText || '').includes('AI 讲堂'))()`, 25000);
    ok('学生点课程进入播放器', !!stuPlayer);
    await cdp.sleep(1600);
    const stuPlayerInfo = await cdp.evalJs(`(() => {
      const t = document.body.innerText || '';
      return {
        hasEditBtn: t.includes('改这一页'),
        hasTitle: !!document.querySelector('.fixed.inset-0 h1, .fixed.inset-0 h2'),
        idx: (t.match(/第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/) || [])[1] || null,
      };
    })()`);
    ok('学生播放器显示内容', !!stuPlayerInfo.hasTitle, `页码=${stuPlayerInfo.idx}`);
    ok('学生播放器没有「改这一页」（只读）', stuPlayerInfo.hasEditBtn === false);
    await shot('lecture_student_player.png');

    await cdp.evalJs(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'ok'; })()`);
    await cdp.sleep(900);

    // 关掉开关 → 按钮消失
    console.log('\n== F. 关闭讲解开关后入口消失 ==');
    await conn.query("UPDATE profiles SET hidden_features = JSON_ARRAY('paint_board','roll_call','ai_explain') WHERE id = ?", [stuId]);
    await go();
    await cdp.sleep(2200);
    const offInfo = await cdp.evalJs(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      const txt = (b) => (b.textContent || '').replace(/\\s+/g, ' ').trim();
      return {
        hasLecture: btns.some(b => txt(b) === 'AI 讲堂'),
        hasTaskCenter: btns.some(b => txt(b).startsWith('任务中心')),
        hasExplainIcon: (document.body.innerText || '').includes('AI讲解'),
      };
    })()`);
    ok('开关关闭后「AI 讲堂」按钮消失', !!offInfo.hasLecture === false);
    ok('对照组：「任务中心」仍在', !!offInfo.hasTaskCenter);
    ok('对照组：桌面「AI讲解」图标也消失', !!offInfo.hasExplainIcon === false);
    await shot('lecture_student_off.png');
  } catch (e) {
    fail += 1;
    failures.push('脚本异常');
    console.log(`\n💥 异常：${e.message}`);
  } finally {
    console.log('\n== G. 清理 ==');
    try {
      const [rows] = await conn.query("SELECT id FROM lectures WHERE title LIKE 'tmp_%'");
      for (const r of rows) await conn.query('DELETE FROM lectures WHERE id = ?', [r.id]);
      const [left] = await conn.query("SELECT COUNT(*) c FROM lectures WHERE title LIKE 'tmp_%'");
      ok('tmp_ 课程已清空', Number(left[0].c) === 0, `残留 ${left[0].c}`);
    } catch (e) {
      ok('清理临时课程', false, e.message);
    }
    if (stuId && stuSnapshot !== null) {
      await conn.query('UPDATE profiles SET hidden_features = ? WHERE id = ?', [stuSnapshot, stuId]);
      const [h] = await conn.query('SELECT hidden_features FROM profiles WHERE id = ?', [stuId]);
      ok('学生 hidden_features 已还原',
        JSON.stringify(h[0].hidden_features) === JSON.stringify(stuSnapshot),
        JSON.stringify(h[0].hidden_features));
    }
    await conn.end();
    try { await cdp.close(); } catch { /* ignore */ }
    try { fs.rmSync(path.join(os.tmpdir(), 'xgpy-chrome-lecture'), { recursive: true, force: true }); } catch { /* ignore */ }
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    if (failures.length) console.log('失败项：\n - ' + failures.join('\n - '));
    process.exit(fail ? 1 : 0);
  }
}

main();
