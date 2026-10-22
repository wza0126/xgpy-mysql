#!/usr/bin/env node
/**
 * verify_explain_ui.cjs
 * ============================================================
 * 真浏览器（headless Chromium + CDP）验证「AI 讲解风格」的界面部分：
 *   教师端 —— 系统配置 → AI设置 底部出现「AI 讲解风格」面板，5 组内置风格齐全，
 *             口诀/闯关显示已停用，点「启用」真的写库、点「停用」能还原；
 *   学生端 —— 开关关闭时桌面**没有**「AI讲解」图标；放开后出现，点进去能列错题，
 *             点「听讲解」进播放器，顶部出现风格 chip，且学生看不到「标记已讲」。
 *
 * 前置：前后端都在跑（3101 / 3266）。
 * 副作用：临时放开/关闭 a 账号的 ai_explain（结束时还原），并会真实生成 1~2 段讲解缓存。
 *
 * 用法：node scripts/debug/verify_explain_ui.cjs
 */
const fs = require('fs');
const path = require('path');
const pool = require('../../src/db');
const { launchHeadless } = require('./lib/cdp.cjs');

const BASE = process.env.XGPY_FE || 'http://127.0.0.1:3266';
const TEACHER = { user: 'teacher', pwd: 'xgpy666' };
const STUDENT = { user: 'a', pwd: '111111' };
const SHOT_DIR = path.resolve(__dirname, '../../../.workbuddy/shots');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

async function shot(cdp, name) {
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const r = await cdp.ws.send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(SHOT_DIR, name);
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log('  📸 ' + p);
    return p;
  } catch (e) {
    console.log('  ⚠️ 截图失败：' + e.message);
    return null;
  }
}

async function feLogin(cdp, user, pwd) {
  return await cdp.evalJs(`(async () => {
    const r = await fetch('/api/auth/secure-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ${JSON.stringify(user)}, password: ${JSON.stringify(pwd)}, deviceInfo: 'e2e-explain' })
    });
    const j = await r.json();
    const t = j && j.data && j.data.session && j.data.session.access_token;
    if (t) {
      localStorage.setItem('xgpy_token', t);
      localStorage.setItem('xgpy_user', JSON.stringify(j.data.user));
      localStorage.removeItem('xgpy_explain_style');
    }
    return t ? 'ok' : ('fail:' + JSON.stringify(j).slice(0, 200));
  })()`);
}

async function gotoRoot(cdp) {
  await cdp.evalJs(`location.href = ${JSON.stringify(BASE + '/')}; 'go'`);
  await cdp.sleep(2600);
}

/** 按可见文字点元素（登录后的页面收不到 CDP 真实鼠标事件，只能走 DOM click） */
async function clickText(cdp, text, exact = true) {
  return await cdp.evalJs(`(() => {
    const all = [...document.querySelectorAll('button,a,div,li,span')].filter(e => e.offsetParent !== null);
    const norm = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
    const hit = all.filter(e => ${exact ? `norm(e) === ${JSON.stringify(text)}` : `norm(e).includes(${JSON.stringify(text)})`})
                    .sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!hit) return 'notfound';
    (hit.closest('button,a,[role=button]') || hit).click();
    return 'ok';
  })()`);
}

/** 轮询等待页面条件成立（AI 现场生成耗时不定，固定 sleep 必然偶发误报） */
async function waitFor(cdp, expr, timeoutMs = 30000, interval = 800) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await cdp.evalJs(expr);
    if (v) return v;
    await cdp.sleep(interval);
  }
  return null;
}

async function enableExplain(enabled) {
  const [[stu]] = await pool.query('SELECT id, hidden_features FROM profiles WHERE username = ? LIMIT 1', [STUDENT.user]);
  if (enabled) {
    await pool.query(
      "UPDATE profiles SET hidden_features = JSON_REMOVE(hidden_features, JSON_UNQUOTE(JSON_SEARCH(hidden_features, 'one', 'ai_explain'))) WHERE id = ?",
      [stu.id],
    );
  } else {
    await pool.query(
      "UPDATE profiles SET hidden_features = JSON_ARRAY_APPEND(COALESCE(hidden_features, JSON_ARRAY()), '$', 'ai_explain') WHERE id = ? AND (hidden_features IS NULL OR JSON_CONTAINS(hidden_features, '\"ai_explain\"') = 0)",
      [stu.id],
    );
  }
  return stu;
}

async function main() {
  const [[stuRow]] = await pool.query('SELECT id, hidden_features FROM profiles WHERE username = ? LIMIT 1', [STUDENT.user]);
  const originalHidden = stuRow.hidden_features;

  const cdp = await launchHeadless({ port: 9462, userDataDir: path.join(__dirname, '..', '..', '.tmp-e2e-explain') });
  try {
    await cdp.ws.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // ══════════ 教师端：系统配置 → 讲解风格 ══════════
    section('教师端 · 系统配置 → AI讲解风格');
    await gotoRoot(cdp);
    ok('教师登录', (await feLogin(cdp, TEACHER.user, TEACHER.pwd)) === 'ok');
    await gotoRoot(cdp);
    ok('进入系统配置', (await clickText(cdp, '系统配置')) === 'ok');
    await cdp.sleep(1600);

    const panel = await cdp.evalJs(`(() => {
      const body = document.body.innerText || '';
      return JSON.stringify({
        hasPanel: body.includes('AI 讲解风格'),
        hasNames: ['接地气唠嗑','极简先给答案','共情不评判','口诀记忆','闯关游戏','课堂讲授'].filter(n => body.includes(n)),
        resetBtns: [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '恢复默认').length,
        disabledBadges: (body.match(/已停用/g) || []).length,
        hint: body.includes('公共规则不可改'),
      });
    })()`);
    let p = {};
    try { p = JSON.parse(String(panel)); } catch { /* ignore */ }
    ok('AI 讲解风格面板出现', p.hasPanel === true);
    // 迁移 108 加了第 6 组「课堂讲授」（AI 讲堂专用），风格库一共 6 组
    ok('6 组内置风格全部列出', (p.hasNames || []).length === 6, (p.hasNames || []).join('/'));
    ok('内置风格带「恢复默认」按钮', p.resetBtns >= 6, `count=${p.resetBtns}`);
    // ⛔ 不锁「哪几组默认停用」——老师随时会在界面上启用口诀/闯关去试听，
    // 锁死具体值会让回归在老师正常操作后误报。改为「UI 与库里停用条数一致」。
    const [[disabledCnt]] = await pool.query('SELECT SUM(enabled = 0) AS c FROM explain_styles');
    ok('「已停用」标记数与库一致',
      Number(p.disabledBadges) === Number(disabledCnt.c || 0),
      `UI=${p.disabledBadges} 库=${disabledCnt.c}`);
    ok('面板有公共规则说明', p.hint === true);
    // 面板在 AI 设置页底部，先滚到可见再截图（否则截到的是上面的 API 配置）
    await cdp.evalJs(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '恢复默认');
      const panel = btn && btn.closest('.rounded-xl');
      if (panel) panel.scrollIntoView({ block: 'center' });
      return true;
    })()`);
    await cdp.sleep(500);
    await shot(cdp, 'explain_styles_teacher.png');

    // ── 发音人下拉：清单由后端下发（分组），已保存的自定义值必须回显 ──
    // ⛔ 曾经的坑：自定义 vcn 不在预设列表里 → 下拉只显示「自定义发音人…」，
    //    老师以为系统设置里填的不算、讲解时还得再填一遍。
    const [[savedVoice]] = await pool.query("SELECT value FROM system_config WHERE config_key = 'xfyun_voice' LIMIT 1");
    let savedVcn = savedVoice?.value;
    if (typeof savedVcn === 'string') { try { savedVcn = JSON.parse(savedVcn)?.value ?? savedVcn; } catch { /* 原样 */ } }
    const voiceUi = await cdp.evalJs(`(() => {
      const sel = [...document.querySelectorAll('select')]
        .find(s => [...s.querySelectorAll('optgroup')].some(g => /标准|超拟人/.test(g.label)));
      if (!sel) return JSON.stringify({ found: false });
      return JSON.stringify({
        found: true,
        groups: [...sel.querySelectorAll('optgroup')].map(g => g.label),
        optionCount: sel.options.length,
        selectedText: (sel.options[sel.selectedIndex] || {}).textContent || '',
        hasPreviewBtn: [...document.querySelectorAll('button')].some(b => /试听/.test(b.textContent || '')),
        hasCustomHint: (document.body.innerText || '').includes('控制台'),
      });
    })()`);
    let vu = {};
    try { vu = JSON.parse(String(voiceUi)); } catch { /* ignore */ }
    ok('发音人下拉存在且按组分类', vu.found === true && (vu.groups || []).length >= 3, (vu.groups || []).join('/'));
    ok('下拉项覆盖清单（≥10 项）', Number(vu.optionCount) >= 10, `count=${vu.optionCount}`);
    ok('已保存的发音人回显正确（列表外显示「自定义：值」）',
      !!String(vu.selectedText || '').trim()
      && (!String(vu.selectedText).includes('自定义') || String(vu.selectedText).includes(String(savedVcn || ''))),
      `选中=${vu.selectedText} / 库里=${savedVcn}`);
    ok('有「试听这句话」按钮', vu.hasPreviewBtn === true);
    ok('有填错发音人的提示文案', vu.hasCustomHint === true);

    // 点「启用」口诀记忆 → 库里应为 1；再点「停用」还原
    const toggleRhyme = await cdp.evalJs(`(() => {
      const rows = [...document.querySelectorAll('div')].filter(d => (d.textContent || '').includes('口诀记忆') && d.querySelector && d.querySelectorAll('button').length <= 4);
      const row = rows.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (!row) return 'row-notfound';
      const btn = [...row.querySelectorAll('button')].find(b => ['启用','停用'].includes(b.textContent.trim()));
      if (!btn) return 'btn-notfound';
      const label = btn.textContent.trim();
      btn.click();
      return label;
    })()`);
    await cdp.sleep(1200);
    const [[rhymeAfter]] = await pool.query("SELECT enabled FROM explain_styles WHERE style_key = 'rhyme'");
    ok(`点「${toggleRhyme}」写库生效`, Number(rhymeAfter.enabled) === (toggleRhyme === '启用' ? 1 : 0), `enabled=${rhymeAfter.enabled}`);

    // 还原成默认停用
    if (Number(rhymeAfter.enabled) === 1) {
      await cdp.evalJs(`(() => {
        const rows = [...document.querySelectorAll('div')].filter(d => (d.textContent || '').includes('口诀记忆') && d.querySelector && d.querySelectorAll('button').length <= 4);
        const row = rows.sort((a, b) => a.textContent.length - b.textContent.length)[0];
        const btn = row && [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '停用');
        if (btn) { btn.click(); return 'ok'; }
        return 'notfound';
      })()`);
      await cdp.sleep(1200);
    }
    const [[rhymeRestored]] = await pool.query("SELECT enabled FROM explain_styles WHERE style_key = 'rhyme'");
    ok('口诀记忆已停用还原', Number(rhymeRestored.enabled) === 0);

    // 编辑 → 保存 → 恢复默认：验证「编辑区能改值并落库」这条最容易写错的链路
    await cdp.evalJs('window.confirm = () => true; window.alert = () => {}; "ok"');
    const editOpen = await cdp.evalJs(`(() => {
      const rows = [...document.querySelectorAll('div')].filter(d => (d.textContent || '').includes('共情不评判') && d.querySelector && d.querySelectorAll('button').length <= 4);
      const row = rows.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (!row) return 'row-notfound';
      const btn = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑');
      if (!btn) return 'btn-notfound';
      btn.click();
      return 'ok';
    })()`);
    ok('点「编辑」展开编辑区', editOpen === 'ok', String(editOpen));
    await cdp.sleep(600);

    const typed = await cdp.evalJs(`(() => {
      const inputs = [...document.querySelectorAll('input[type=number]')].filter(i => i.offsetParent !== null);
      const target = inputs.find(i => Number(i.value) === 240);
      if (!target) return 'input-notfound';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(target, '245');
      target.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    ok('改写「字数上限」输入框', typed === 'ok', String(typed));
    const saved = await cdp.evalJs(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存' && b.offsetParent !== null);
      if (!btn) return 'notfound';
      btn.click();
      return 'ok';
    })()`);
    await cdp.sleep(1400);
    const [[warmRow]] = await pool.query("SELECT max_chars FROM explain_styles WHERE style_key = 'warm'");
    ok('保存后 max_chars 落库为 245', Number(warmRow.max_chars) === 245, `max_chars=${warmRow.max_chars}`);
    ok('保存按钮可点', saved === 'ok');

    // 恢复默认（warm 的内置默认 240）
    const resetWarm = await cdp.evalJs(`(() => {
      const rows = [...document.querySelectorAll('div')].filter(d => (d.textContent || '').includes('共情不评判') && d.querySelector && d.querySelectorAll('button').length <= 4);
      const row = rows.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      const btn = row && [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '恢复默认');
      if (!btn) return 'notfound';
      btn.click();
      return 'ok';
    })()`);
    await cdp.sleep(1400);
    const [[warmReset]] = await pool.query("SELECT max_chars FROM explain_styles WHERE style_key = 'warm'");
    ok('「恢复默认」把 max_chars 还原为 240', Number(warmReset.max_chars) === 240, `max_chars=${warmReset.max_chars} reset=${resetWarm}`);

    // ══════════ 学生端：开关关闭 → 无图标 ══════════
    section('学生端 · 开关关闭时无入口');
    await enableExplain(false);
    await gotoRoot(cdp);
    ok('学生登录', (await feLogin(cdp, STUDENT.user, STUDENT.pwd)) === 'ok');
    await gotoRoot(cdp);
    await cdp.sleep(1800);
    const iconsOff = await cdp.evalJs(`(() => {
      const body = document.body.innerText || '';
      return JSON.stringify({ hasExplain: body.includes('AI讲解'), hasWrong: body.includes('错题集') });
    })()`);
    let io = {};
    try { io = JSON.parse(String(iconsOff)); } catch { /* ignore */ }
    ok('关闭时桌面没有「AI讲解」图标', io.hasExplain === false);
    ok('对照：其他图标仍在（错题集）', io.hasWrong === true);

    // ══════════ 学生端：放开 → 能听讲解 ══════════
    section('学生端 · 放开后听讲解');
    await enableExplain(true);
    await gotoRoot(cdp);
    await cdp.sleep(1800);
    const iconOn = await cdp.evalJs(`(() => {
      const els = [...document.querySelectorAll('*')].filter(e => (e.textContent || '').trim() === 'AI讲解' && e.offsetParent !== null);
      const el = els.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (!el) return 'notfound';
      const card = el.closest('[data-icon]') || el.parentElement;
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      if (card) card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return 'ok';
    })()`);
    ok('放开后出现「AI讲解」图标', iconOn === 'ok', String(iconOn));
    await cdp.sleep(2200);

    const listInfo = await cdp.evalJs(`(() => {
      const body = document.body.innerText || '';
      const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '听讲解');
      return JSON.stringify({ btns: btns.length, hasTitle: body.includes('听老师讲你的错题'), hasPlayAll: body.includes('连播全部') });
    })()`);
    let li = {};
    try { li = JSON.parse(String(listInfo)); } catch { /* ignore */ }
    ok('打开窗口并列出错题', li.btns > 0, `听讲解按钮=${li.btns}`);
    ok('窗口标题正确', li.hasTitle === true);
    ok('有「连播全部」入口', li.hasPlayAll === true);
    await shot(cdp, 'explain_student_list.png');

    // 点第一道「听讲解」
    const firstPlay = await cdp.evalJs(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '听讲解');
      if (!btn) return 'notfound';
      btn.click();
      return 'ok';
    })()`);
    ok('点击「听讲解」进入播放器', firstPlay === 'ok');
    // 首次进播放器可能要现场生成（几秒到十几秒），轮询到场景标题出现为止
    const sceneReady = await waitFor(
      cdp,
      `(/考点定位|逐项辨析|记住这一点|数据对比/.test(document.body.innerText) ? 'ready' : '')`,
      40000,
    );
    ok('讲解已生成（出现场景标题）', !!sceneReady, String(sceneReady || 'timeout'));

    const player = await cdp.evalJs(`(() => {
      const body = document.body.innerText || '';
      const chips = [...document.querySelectorAll('button')].filter(b => ['接地气唠嗑','极简先给答案','共情不评判'].includes((b.textContent||'').trim()));
      const active = chips.filter(b => /bg-indigo-600/.test(b.className));
      return JSON.stringify({
        hasStyleRow: body.includes('讲解风格'),
        chips: chips.length,
        active: active.length,
        hasMark: body.includes('标记已讲'),
        hasError: /生成讲解失败|还没有为你开通/.test(body),
        scene: (body.match(/考点定位|逐项辨析|记住这一点|数据对比/) || [''])[0],
      });
    })()`);
    let pl = {};
    try { pl = JSON.parse(String(player)); } catch { /* ignore */ }
    ok('播放器顶部有「讲解风格」chip 行', pl.hasStyleRow === true);
    ok('学生在播放器里看不到「标记已讲」', pl.hasMark === false);
    ok('无报错文案', pl.hasError === false);
    // 播放器音色下拉：已保存的自定义 vcn 必须显示成「自定义：xxx」，
    // 否则老师会以为系统设置里填的白填了、还得在这儿再填一遍。
    const voiceSel = await cdp.evalJs(`(() => {
      // 分组名现在是「Edge 在线（免费）/ 讯飞云端（按量计费）/ 本机（兜底）」，
      // 不再是讯飞自己的「标准 / 超拟人」分组 —— 这里按三家引擎名找。
      const sel = [...document.querySelectorAll('select')]
        .find(s => [...s.querySelectorAll('optgroup')].some(g => /Edge 在线|讯飞云端|本机/.test(g.label)));
      if (!sel) return JSON.stringify({ found: false });
      return JSON.stringify({
        found: true,
        selected: (sel.options[sel.selectedIndex] || {}).textContent || '',
        last: (sel.options[sel.options.length - 1] || {}).textContent || '',
        groups: [...sel.querySelectorAll('optgroup')].map(g => g.label),
      });
    })()`);
    let vs = {};
    try { vs = JSON.parse(String(voiceSel)); } catch { /* ignore */ }
    ok('播放器音色下拉存在（云端已配）', vs.found === true);
    // 判定口径：列表内的音色显示中文名；列表外的自定义音色显示「自定义：参数值」。
    // 两者都算「回显正确」，只有显示成空 / 「请填写」才算失败。
    ok('播放器回显当前音色（列表内显示名称，列表外显示自定义：值）',
      !!String(vs.selected || '').trim()
      && (!String(vs.selected).includes('自定义') || String(vs.selected).includes(String(savedVcn || ''))),
      `选中=${vs.selected}`);
    ok('末项是「换一个自定义发音人…」', String(vs.last || '').includes('换一个'), String(vs.last));
    await shot(cdp, 'explain_student_player.png');

    // 切风格 → chip 高亮 + 重新生成
    const beforeTopic = await cdp.evalJs(`(document.body.innerText.match(/第 \\d+ \\/ \\d+ 题/) || [''])[0]`);
    const switched = await cdp.evalJs(`(() => {
      const chip = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '极简先给答案');
      if (!chip) return 'notfound';
      chip.click();
      return 'ok';
    })()`);
    ok('能点击切换风格', switched === 'ok');
    // 新风格第一次要现场生成，轮询到「高亮 + 场景已渲染」为止
    const switchReady = await waitFor(
      cdp,
      `(() => {
         const chips = [...document.querySelectorAll('button')].filter(b => ['接地气唠嗑','极简先给答案','共情不评判'].includes((b.textContent||'').trim()));
         const on = chips.find(b => /bg-indigo-600/.test(b.className));
         const scene = /考点定位|逐项辨析|记住这一点|数据对比/.test(document.body.innerText);
         return (on && on.textContent.trim() === '极简先给答案' && scene) ? 'ready' : '';
       })()`,
      40000,
    );
    ok('切换后重新生成完成', !!switchReady, String(switchReady || 'timeout'));
    const afterSwitch = await cdp.evalJs(`(() => {
      const chips = [...document.querySelectorAll('button')].filter(b => ['接地气唠嗑','极简先给答案','共情不评判'].includes((b.textContent||'').trim()));
      const active = chips.filter(b => /bg-indigo-600/.test(b.className)).map(b => b.textContent.trim());
      const body = document.body.innerText || '';
      return JSON.stringify({ active, err: /生成讲解失败/.test(body), text: body.slice(0, 0) });
    })()`);
    let as = {};
    try { as = JSON.parse(String(afterSwitch)); } catch { /* ignore */ }
    ok('切换后高亮到「极简先给答案」', (as.active || []).includes('极简先给答案'), (as.active || []).join(','));
    ok('切换后没有报错', as.err === false);
    ok('题目位置没变（仍在同一题）', String(beforeTopic) === (await cdp.evalJs(`(document.body.innerText.match(/第 \\d+ \\/ \\d+ 题/) || [''])[0]`)));
    await shot(cdp, 'explain_student_style_switched.png');

    // ══════════ 清理 ══════════
    section('清理');
    await pool.query('UPDATE profiles SET hidden_features = ? WHERE id = ?', [originalHidden, stuRow.id]);
    const [[restored]] = await pool.query('SELECT hidden_features FROM profiles WHERE id = ?', [stuRow.id]);
    ok('学生 hidden_features 已还原', JSON.stringify(restored.hidden_features) === JSON.stringify(originalHidden), `${restored.hidden_features}`);

    const realErrors = (cdp.jsErrors || []).filter((e) => !/ResizeObserver|favicon|Failed to load resource/i.test(e));
    ok('无未预期前端异常', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

    console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
    if (fail) { console.log('失败项：'); failures.forEach((f) => console.log('  - ' + f)); }
  } finally {
    cdp.close();
    await pool.end();
  }
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error('脚本异常：', e);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
