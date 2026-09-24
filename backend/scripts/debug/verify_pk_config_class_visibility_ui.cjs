/**
 * verify_pk_config_class_visibility_ui.cjs
 *
 * 浏览器端实测：PK 对战配置弹窗里的「投放班级」选择器真的能用
 *
 * 背景（迁移 089）：
 *   对战配置增加班级选择，选中的班级才能使用该活动 PK 对战 —— 用于一位教师带多个
 *   班级/多个年级时，把不同活动分别投放给对应班级。
 *   源码接线由 verify_pk_config_class_visibility.cjs 负责（56 项），本脚本补
 *   **真实浏览器**层：班级按钮点得到、点得动、保存后卡片上出现的班级名正确。
 *
 * 断言：
 *   ① 教师登录 → 进「测试与考试」→ 切到「PK 对战配置」页签；
 *   ② 打开「新建对战配置」弹窗，能看到「投放班级」区块与班级按钮（不是空态提示）；
 *   ③ 默认显示「全部班级可用」；
 *   ④ 点一个班级 → 徽章变「已选 1 个班」→ 再点一次取消 → 回到「全部班级可用」；
 *   ⑤ 建一个只投放给某班的配置 → 保存 → 卡片出现「投放 1 个班：<班级名>」；
 *   ⑥ 清理：删掉测试配置；
 *   ⑦ 全程无 JS 异常、无 >=400 响应。
 *
 * ⚠️ 需要前后端已在运行（后端 3101 / 前端 3266）。
 * 用法：
 *   node scripts/debug/verify_pk_config_class_visibility_ui.cjs [--site http://127.0.0.1:3266]
 */
const fs = require('fs');
const path = require('path');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const SITE = argOf('--site', process.env.XGPY_SITE || 'http://127.0.0.1:3266');
const USER = argOf('--user', 'teacher');
const PASS = argOf('--pass', 'xgpy666');
const CFG_NAME = argOf('--name', '__UI__投放班级测试');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

/** 打印某次 evalJs 的返回（用于定位「点了但没反应」这类问题） */
function dbg(label, v) {
  console.log('  · ' + label + ' => ' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
}

const js = (s) => s.join('\n');

const LOGIN = js([
  "(async function(){",
  "  var r = await fetch('/api/auth/secure-login', {",
  "    method:'POST', headers:{'Content-Type':'application/json'},",
  "    body: JSON.stringify({username: " + JSON.stringify(USER) + ", password: " + JSON.stringify(PASS) + "})",
  "  });",
  "  var j = await r.json();",
  "  var t = j && j.data && j.data.session && j.data.session.access_token;",
  "  if (t) {",
  "    localStorage.setItem('xgpy_token', t);",
  "    localStorage.setItem('xgpy_user', JSON.stringify(j.data.user));",
  "  }",
  "  return { ok: !!t, role: j && j.data && j.data.user && j.data.user.role, err: (j && j.error) || null };",
  "})()",
]);

/** 页面级错误收集（React 自己吞掉的渲染异常 CDP 抓不到） */
const INSTALL_ERR_COLLECTOR = js([
  "(function(){",
  "  if (window.__errs) { window.__errs.length = 0; return 'reset'; }",
  "  window.__errs = [];",
  "  window.addEventListener('error', function(e){ window.__errs.push('error: ' + (e.message || '')); });",
  "  window.addEventListener('unhandledrejection', function(e){ window.__errs.push('reject: ' + (e.reason && (e.reason.message || e.reason))); });",
  "  return 'ok';",
  "})()",
]);

/**
 * 按「按钮文字完全等于 text」查找并点击。
 *
 * 只扫 <button>（不扫 '*'）：`document.querySelectorAll('*')` 会把 <script> 也捞进来，
 * 而 <script> 的 textContent 里含源码字符串，一旦命中就 e.click() → TypeError，
 * 表现为 evalJs 返回 {__err:'Uncaught'} 而页面毫无反应，极难排查（本次踩过）。
 * 按钮标签用 trim 后**完全相等**匹配，避免与包含关系误伤。
 */
const clickByText = (text) => js([
  "(function(){",
  "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
  "  for (var i = 0; i < btns.length; i++) {",
  "    var e = btns[i];",
  "    var tx = (e.textContent||'').replace(/\\s+/g,' ').trim();",
  "    if (tx === " + JSON.stringify(text) + ") { e.click(); return 'clicked'; }",
  "  }",
  "  return 'not-found';",
  "})()",
]);

/** 按「包含某段文字」点击按钮（用于文案带数字/图标的场景） */
const clickByContains = (text) => js([
  "(function(){",
  "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
  "  for (var i = 0; i < btns.length; i++) {",
  "    var tx = (btns[i].textContent||'').replace(/\\s+/g,' ').trim();",
  "    if (tx.indexOf(" + JSON.stringify(text) + ") >= 0) { btns[i].click(); return tx; }",
  "  }",
  "  return 'not-found';",
  "})()",
]);

/** 探查弹窗内「投放班级」区块状态 */
const PROBE = js([
  "(function(){",
  "  function txt(e){ return (e.textContent||'').replace(/\\s+/g,' ').trim(); }",
  "  var bodyText = txt(document.body);",
  "  // 班级按钮：pill 里带 fa-circle-plus（未选）/fa-check（已选）图标。",
  "  // 必须排除 textContent 为空的按钮 —— 配置卡片上的「启用/禁用」图标按钮也是",
  "  // 纯 fa-check 且无文字，会把计数污染成「已选 2 个班」的假象（本次踩过）。",
  "  var pills = Array.prototype.slice.call(document.querySelectorAll('button'))",  "    .filter(function(b){ return /fa-(check|circle-plus)\\b/.test(b.innerHTML); })",
  "    .map(function(b){ return { name: txt(b), on: /fa-check\\b/.test(b.innerHTML) }; })",
  "    .filter(function(p){ return p.name.length > 0; });",
  "  // 弹窗是否打开：出现「新建对战配置」标题（新建模式）或「编辑对战配置」",
  "  var modalOpen = /新建对战配置|编辑对战配置/.test(bodyText);",
  "  return {",
  "    modalOpen: modalOpen,",
  "    hasSectionTitle: bodyText.indexOf('投放班级') >= 0,",
  "    badgeAll: bodyText.indexOf('全部班级可用') >= 0,",
  "    badgeSelected: (bodyText.match(/已选 (\\d+) 个班/) || [])[1] || null,",
  "    hintText: bodyText.indexOf('一个都不选 = 不限班级') >= 0,",
  "    emptyHint: bodyText.indexOf('暂无可投放的班级') >= 0,",
  "    classPills: pills,",
  "    onCount: pills.filter(function(p){ return p.on; }).length,",
  "    errs: (window.__errs || []).slice(0, 5),",
  "  };",
  "})()",
]);

/** 卡片上「投放 N 个班：名字」摘要 */
const PROBE_CARD = (name) => js([
  "(function(){",
  "  function txt(e){ return (e.textContent||'').replace(/\\s+/g,' ').trim(); }",
  "  var found = null;",
  "  Array.prototype.slice.call(document.querySelectorAll('div')).forEach(function(d){",
  "    var t = txt(d);",
  "    if (!found && t.indexOf(" + JSON.stringify(name) + ") >= 0 && t.indexOf('投放') >= 0 && t.length < 600) found = t;",
  "  });",
  "  var allText = txt(document.body);",
  "  return {",
  "    hasName: allText.indexOf(" + JSON.stringify(name) + ") >= 0,",
  "    cardText: found,",
  "    hasDeployBadge: !!(found && /投放 \\d+ 个班/.test(found)),",
  "    hasAllBadge: allText.indexOf('全部班级可用') >= 0,",
  "  };",
  "})()",
]);

(async () => {
  console.log('站点：' + SITE + '　账号：' + USER);
  const udd = path.join(process.cwd(), '.tmp-chrome-pkvis-ui');
  const b = await launchHeadless({ port: 9457, userDataDir: udd });
  let createdName = null;
  try {
    // ⚠️ 必须从根路由加载，等应用自行跳转（直接开 /#/teacher 会因首帧 profile 为 null 被守卫踢回登录页）
    await b.ws.send('Page.navigate', { url: SITE });
    await b.sleep(3500);
    await b.evalJs(INSTALL_ERR_COLLECTOR);

    section('⓪ 登录');
    const login = await b.evalJs(LOGIN);
    check('登录成功', login && login.ok, JSON.stringify(login));
    if (!login || !login.ok) throw new Error('登录失败，无法继续');
    check('账号角色为教师', login.role === 'teacher', String(login.role));

    await b.ws.send('Page.navigate', { url: SITE });
    await b.sleep(5000);
    b.netFails.length = 0;
    await b.evalJs(INSTALL_ERR_COLLECTOR);

    section('① 进入 PK 对战配置页签');
    // 导航路径（三层）：左侧「考试管理」→ 子页签「试卷」（挂载 ExamManager）
    //                → ExamManager 顶层页签「对战配置」（挂载 PKBattleConfigTab）
    const nav1 = await b.evalJs(clickByText('考试管理'));
    await b.sleep(2500);
    dbg('click 考试管理', nav1);
    check('点击左侧「考试管理」导航', nav1 === 'clicked' || nav1 === 'clicked-raw', String(nav1));

    const nav2 = await b.evalJs(clickByText('试卷'));
    await b.sleep(2500);
    dbg('click 试卷', nav2);
    check('点击子页签「试卷」（挂载 ExamManager）', nav2 === 'clicked' || nav2 === 'clicked-raw', String(nav2));

    const tab = await b.evalJs(clickByText('对战配置'));
    await b.sleep(1800);
    dbg('click 对战配置', tab);
    check('点击页签「对战配置」', tab === 'clicked' || tab === 'clicked-raw', String(tab));

    const header = await b.evalJs("(document.body.innerText||'').replace(/\\s+/g,' ')");
    check('页面出现「PK 对战配置」标题', typeof header === 'string' && /PK 对战配置/.test(header));

    section('② 打开新建弹窗，检查「投放班级」区块');
    const btn = await b.evalJs(clickByText('新建配置'));
    await b.sleep(1800);
    dbg('click 新建配置', btn);
    check('点击「新建配置」', btn === 'clicked' || btn === 'clicked-raw', String(btn));

    const probe1 = await b.evalJs(PROBE);
    check('弹窗已打开', probe1 && probe1.modalOpen, JSON.stringify({ open: probe1 && probe1.modalOpen }));
    check('存在「投放班级」区块', probe1 && probe1.hasSectionTitle);
    check('显示说明「一个都不选 = 不限班级」', probe1 && probe1.hintText);
    check('默认徽章为「全部班级可用」（未做限制）', probe1 && probe1.badgeAll,
      'badgeSelected=' + (probe1 && probe1.badgeSelected));
    check('班级按钮已渲染（不是「暂无可投放的班级」空态）',
      probe1 && !probe1.emptyHint && probe1.classPills && probe1.classPills.length > 0,
      probe1 ? `pills=${probe1.classPills ? probe1.classPills.length : 0}` : '');
    check('初始无任何班级被选中', probe1 && probe1.onCount === 0, `onCount=${probe1 && probe1.onCount}`);

    const firstName = probe1 && probe1.classPills && probe1.classPills[0]
      ? probe1.classPills[0].name : null;
    check('能取到第一个班级名（用于后续断言）', !!firstName, String(firstName));

    section('③ 点选班级 → 徽章变「已选 1 个班」');
    if (firstName) {
      const clicked = await b.evalJs(clickByText(firstName));
      await b.sleep(600);
      check('点击班级按钮', clicked !== 'not-found', String(clicked));
      const probe2 = await b.evalJs(PROBE);
      check('徽章变为「已选 1 个班」', probe2 && probe2.badgeSelected === '1',
        `badgeSelected=${probe2 && probe2.badgeSelected}`);
      check('该班级按钮变为选中态（onCount=1）', probe2 && probe2.onCount === 1,
        `onCount=${probe2 && probe2.onCount}`);

      section('④ 再点一次 → 取消选中，回到「全部班级可用」');
      await b.evalJs(clickByText(firstName));
      await b.sleep(600);
      const probe3 = await b.evalJs(PROBE);
      check('再点一次回到「全部班级可用」', probe3 && probe3.badgeAll);
      check('已无选中班级', probe3 && probe3.onCount === 0, `onCount=${probe3 && probe3.onCount}`);

      section('⑤ 建一个只投放给该班的配置并保存');
      // 活动名称由脚本指定，便于事后定位/清理
      const nameSet = await b.evalJs(js([
        "(function(){",
        "  var inp = document.querySelector('input[placeholder=\"如：期中复习PK\"]');",
        "  if (!inp) return 'no-input';",
        "  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
        "  setter.call(inp, " + JSON.stringify(CFG_NAME) + ");",
        "  inp.dispatchEvent(new Event('input', { bubbles: true }));",
        "  return inp.value;",
        "})()",
      ]));
      check('填入活动名称', nameSet === CFG_NAME, String(nameSet));

      await b.evalJs(clickByText(firstName));
      await b.sleep(500);
      const probe4 = await b.evalJs(PROBE);
      check('重新选中该班级', probe4 && probe4.badgeSelected === '1');

      const saveRes = await b.evalJs(js([
        "(async function(){",
        "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
        "  var save = null;",
        "  for (var i = 0; i < btns.length; i++) {",
        "    var t = (btns[i].textContent||'').replace(/\\s+/g,' ').trim();",
        "    if (t === '创建配置') { save = btns[i]; break; }",
        "  }",
        "  if (!save) return 'no-save-btn';",
        "  save.click();",
        "  await new Promise(function(r){ setTimeout(r, 2500); });",
        "  return 'saved';",
        "})()",
      ]));
      check('点击「创建配置」', saveRes === 'saved', String(saveRes));
      await b.sleep(1500);

      const card = await b.evalJs(PROBE_CARD(CFG_NAME));
      check('卡片出现新配置', card && card.hasName, JSON.stringify({ hasName: card && card.hasName }));
      check('卡片显示「投放 N 个班」徽章', card && card.hasDeployBadge,
        card && card.cardText ? String(card.cardText).slice(0, 160) : '');
      check('卡片带出班级名（不是只有数字）',
        !!card && !!card.cardText && !!firstName && card.cardText.indexOf(firstName) >= 0,
        `expect=${firstName}`);
      createdName = CFG_NAME;
    } else {
      check('跳过选班流程', false, '未能取到班级名');
    }

    section('⑥ 无 JS 异常 / 无失败请求');
    const errs = await b.evalJs("(window.__errs||[]).slice(0,5)");
    check('页面无 JS 异常', !errs || errs.length === 0, errs && errs.length ? JSON.stringify(errs) : '');
    // cdp.cjs 的 netFails 是字符串数组（'HTTP 500 <url>' / '<type> <errorText>'）
    const badNet = (b.netFails || []).filter((s) => {
      const t = String(s || '');
      return /HTTP [45]\d\d/.test(t) && !/favicon|\.woff|\.ttf|\.png|\.jpg/.test(t);
    });
    check('无 >=400 接口响应', badNet.length === 0, badNet.slice(0, 3).join(' | '));
  } catch (e) {
    console.error('脚本异常：', e && e.message ? e.message : e);
    fail++;
    failures.push('脚本异常: ' + (e && e.message ? e.message : e));
  } finally {
    // 清理测试配置（走接口删，避免污染教师列表）
    if (createdName) {
      try {
        const tok = await b.evalJs("localStorage.getItem('xgpy_token')");
        if (tok) {
          const r = await fetch('http://127.0.0.1:3101/api/pk/battle-configs', {
            headers: { Authorization: 'Bearer ' + tok },
          });
          const j = await r.json();
          const target = (j && j.data || []).find((c) => c.name === createdName);
          if (target) {
            await fetch('http://127.0.0.1:3101/api/pk/battle-configs/' + target.id, {
              method: 'DELETE', headers: { Authorization: 'Bearer ' + tok },
            });
            console.log('已清理测试配置：' + createdName);
          }
        }
      } catch { /* ignore */ }
    }
    try { await b.close(); } catch { /* ignore */ }
  }

  console.log('\n' + '='.repeat(56));
  console.log(`结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 项）`);
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(56));
  process.exit(fail === 0 ? 0 : 1);
})();
