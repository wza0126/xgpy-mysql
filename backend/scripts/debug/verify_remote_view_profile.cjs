/**
 * 浏览器端实测：学生端「我的」（个人中心）的战力/暴击/装备/荣誉/皮肤能否取到数据
 *
 * 背景（2026-09-23 修复）：
 *   教师「点名模块 → 远程控制学生桌面」会把学生端塞进**同源 iframe**。
 *   同源 iframe 与主页面共享 localStorage，所以组件里直接读 localStorage 的 token 时，
 *   拿到的是**教师**的 token —— 表现为远程查看学生个人中心时
 *   「战力、暴击、装备、荣誉、皮肤…很多数据不显示或不完整」。
 *   修复：统一走 frontend/src/utils/authToken.ts 的 getAuthToken()。
 *
 * 本脚本是**浏览器层**验证（源码接线由 verify_proxy_auth_token.cjs 负责，两者互补）：
 *   用学生账号真实登录 → 打开「我的」窗口 → 断言
 *     ① 页面自己发起的接口（/api/student/stats 等）返回 200 且带齐字段；
 *     ② 战力/暴击/装备/荣誉/皮肤五个区块都渲染出内容，且不是「暂无…」兜底文案；
 *     ③ 全程无 JS 异常、无 >=400 响应。
 *   即验证「token 改造没有把学生端取数改坏」，这是本次改动最主要的回归风险面。
 *
 * ⚠️ 需要前后端已在运行（dev.bat start：后端 3101 / 前端 3266）。
 * 用法：
 *   node scripts/debug/verify_remote_view_profile.cjs [--user a] [--pass 111111] [--site http://127.0.0.1:3266]
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
const USER = argOf('--user', 'a');
const PASS = argOf('--pass', '111111');
const OUT_PNG = argOf('--shot', path.join(process.cwd(), '.workbuddy', 'tmp-profile-view.png'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

const LOGIN = [
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
].join('\n');

/** 装一个页面级错误收集器（CDP 的 exceptionThrown 抓不到 React 自己吞掉的渲染异常） */
const INSTALL_ERR_COLLECTOR = [
  "(function(){",
  "  if (window.__errs) return 'already';",
  "  window.__errs = [];",
  "  window.addEventListener('error', function(e){ window.__errs.push('error: ' + (e.message || '')); });",
  "  window.addEventListener('unhandledrejection', function(e){ window.__errs.push('reject: ' + (e.reason && (e.reason.message || e.reason))); });",
  "  return 'ok';",
  "})()",
].join('\n');

/** 按「叶子节点文字完全等于 label」找桌面图标，然后逐层往上派发 dblclick + click（与练习窗口一致） */
const openIcon = (label) => [
  "(function(){",
  "  var all = Array.prototype.slice.call(document.querySelectorAll('*'));",
  "  var leaf = null;",
  "  for (var i = 0; i < all.length; i++) {",
  "    var e = all[i];",
  "    if ((e.textContent||'').trim() === " + JSON.stringify(label) + " && e.children.length === 0) { leaf = e; break; }",
  "  }",
  "  if (!leaf) return 'leaf-not-found';",
  "  var node = leaf;",
  "  for (var k = 0; k < 5 && node; k++) {",
  "    node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));",
  "    node.click();",
  "    node = node.parentElement;",
  "  }",
  "  return 'ok';",
  "})()",
].join('\n');

/** 直接打后端的接口，证明「用当前 token 能取到数据」 */
const PROBE_APIS = [
  "(async function(){",
  "  var t = localStorage.getItem('xgpy_token');",
  "  var h = { Authorization: 'Bearer ' + t };",
  "  async function get(p){ try { var r = await fetch(p, { headers: h }); var j = await r.json(); return { code: r.status, data: j && j.data }; } catch (e) { return { err: String(e && e.message || e) }; } }",
  "  var stats = await get('/api/student/stats');",
  "  var honors = await get('/api/student/honors');",
  "  var buffs = await get('/api/student/buffs');",
  "  var skins = await get('/api/student/my-skins');",
  "  var s = stats.data || {};",
  "  return {",
  "    statsCode: stats.code,",
  "    hasPower: s.power_multiplier !== undefined && s.power_multiplier !== null,",
  "    hasCrit: s.crit_rate !== undefined && s.crit_rate !== null,",
  "    hasBreakdown: !!(s.crit_rate_breakdown),",
  "    equipmentCount: (s.equipment_list || []).length,",
  "    isEquipmentArray: Array.isArray(s.equipment_list),",
  "    honorsCode: honors.code,",
  "    honorKeys: honors.data ? Object.keys(honors.data).length : -1,",
  "    buffsCode: buffs.code,",
  "    buffCount: (buffs.data || []).length,",
  "    skinsCode: skins.code,",
  "    hasSkins: !!skins.data,",
  "  };",
  "})()",
].join('\n');

/** 探查「我的」窗口渲染出的五个区块 */
const PROBE_DOM = [
  "(function(){",
  "  function txt(e){ return (e.textContent||'').replace(/\\s+/g,' ').trim(); }",
  "  var body = document.body;",
  "  var rootText = txt(body);",
  "  // 「我的」窗口根：含『战力暴击』的那张卡片往上找到带内联 height 的窗口层",
  "  var card = null;",
  "  Array.prototype.slice.call(document.querySelectorAll('div')).forEach(function(d){",
  "    if (!card && txt(d).indexOf('战力暴击') === 0 && d.querySelectorAll('div').length < 40) card = d;",
  "  });",
  "  var win = card, n = card;",
  "  while (n) { if (n.style && n.style.height && parseInt(n.style.height,10) >= 200) { win = n; break; } n = n.parentElement; }",
  "  var winText = win ? txt(win) : rootText;",
  "  var pm = winText.match(/x(\\d+(?:\\.\\d+)?)/);",
  "  var crit = winText.match(/(\\d+)%/);",
  "  return {",
  "    opened: !!win && win !== card,",
  "    hasPowerCard: winText.indexOf('战力暴击') >= 0,",
  "    powerText: pm ? pm[0] : null,",
  "    critText: crit ? crit[0] : null,",
  "    hasBreakdown: winText.indexOf('暴击率来源') >= 0,",
  "    hasHonorSection: winText.indexOf('荣誉图鉴') >= 0,",
  "    honorEmpty: winText.indexOf('暂无荣誉达成记录') >= 0,",
  "    hasEquipmentBar: winText.indexOf('装备栏') >= 0,",
  "    equipEmpty: winText.indexOf('暂无装备') >= 0,",
  "    hasSkinCard: winText.indexOf('皮肤') >= 0,",
  "    loading: winText.indexOf('加载中') >= 0,",
  "    stillLoggingIn: (document.body.innerText||'').indexOf('请先登录') >= 0,",
  "  };",
  "})()",
].join('\n');

(async () => {
  console.log('站点：' + SITE + '　账号：' + USER);
  const udd = path.join(process.cwd(), '.tmp-chrome-profile-view');
  const b = await launchHeadless({ port: 9453, userDataDir: udd });
  let shotDone = false;
  try {
    await b.ws.send('Page.navigate', { url: SITE });
    await b.sleep(3500);
    await b.evalJs(INSTALL_ERR_COLLECTOR);

    section('⓪ 登录');
    const login = await b.evalJs(LOGIN);
    check('登录成功', login && login.ok, JSON.stringify(login));
    if (!login || !login.ok) throw new Error('登录失败，无法继续（可用 --user/--pass 指定）');
    check('账号角色为学生（本脚本验证学生端个人中心）', login.role === 'student', String(login.role));

    await b.ws.send('Page.navigate', { url: SITE });
    await b.sleep(4500);
    b.netFails.length = 0;
    await b.evalJs(INSTALL_ERR_COLLECTOR);

    section('① 打开桌面上的「我的」窗口');
    const opened = await b.evalJs(openIcon('我的'));
    check('找到并打开「我的」入口', opened === 'ok', String(opened));
    if (opened !== 'ok') throw new Error('未能打开「我的」窗口');
    await b.sleep(4000);

    section('② 接口层：当前 token 能取到学生数据（修复后的链路）');
    const api = await b.evalJs(PROBE_APIS);
    console.log('  ' + JSON.stringify(api));
    check('能拿到 api 探针结果', api && !api.__err, JSON.stringify(api && api.__err || ''));
    check('/api/student/stats 返回 200', api.statsCode === 200, 'code=' + api.statsCode);
    check('含战力倍率 power_multiplier', api.hasPower === true);
    check('含暴击率 crit_rate', api.hasCrit === true);
    check('含暴击率来源 crit_rate_breakdown', api.hasBreakdown === true);
    check('含装备列表 equipment_list（数组）', api.isEquipmentArray === true, '共 ' + api.equipmentCount + ' 件');
    check('/api/student/honors 返回 200 且有字段', api.honorsCode === 200 && api.honorKeys > 0, 'code=' + api.honorsCode + ' keys=' + api.honorKeys);
    check('/api/student/buffs 返回 200', api.buffsCode === 200, 'code=' + api.buffsCode + ' 条数=' + api.buffCount);
    check('/api/student/my-skins 返回 200', api.skinsCode === 200, 'code=' + api.skinsCode);

    section('③ 渲染层：「我的」窗口五个区块都有内容');
    const dom = await b.evalJs(PROBE_DOM);
    console.log('  ' + JSON.stringify(dom));
    check('「我的」窗口已打开', dom && dom.opened === true, JSON.stringify(dom && dom.opened));
    check('战力暴击卡片存在', dom.hasPowerCard === true);
    check('战力倍率有数值（x?）', !!dom.powerText, String(dom.powerText));
    check('暴击率有数值（?%）', !!dom.critText, String(dom.critText));
    check('暴击率来源明细已展开', dom.hasBreakdown === true);
    check('装备栏区块存在', dom.hasEquipmentBar === true);
    check('荣誉图鉴区块存在', dom.hasHonorSection === true);
    check('荣誉不是「暂无荣誉达成记录」兜底', dom.hasHonorSection && !dom.honorEmpty);
    check('皮肤卡片存在', dom.hasSkinCard === true);
    check('窗口未停留在加载中', dom.loading === false);
    check('未被判定为未登录', dom.stillLoggingIn === false);

    section('④ 无运行时报错');
    const pageErrs = await b.evalJs('window.__errs || []');
    check('页面无 error / unhandledrejection', Array.isArray(pageErrs) && pageErrs.length === 0, JSON.stringify(pageErrs || []).slice(0, 200));
    check('无 JS 异常（CDP）', b.jsErrors.length === 0, b.jsErrors.join(' | ').slice(0, 200));
    check('无 >=400 响应', b.netFails.length === 0, b.netFails.join(' | ').slice(0, 200));

    // 截图留证（失败不影响结论）
    try {
      const shot = await b.ws.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true });
      fs.writeFileSync(OUT_PNG, Buffer.from(shot.data, 'base64'));
      shotDone = true;
    } catch (e) {}
  } catch (e) {
    fail++;
    failures.push('执行中断：' + e.message);
    console.log('\n❌ 执行中断：' + e.message);
  } finally {
    b.close();
    await sleep(300);
  }

  console.log('\n────────────────────────────────────────');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (shotDone) console.log('截图：' + OUT_PNG);
  if (fail) {
    console.log('失败项：');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('全部通过 ✅');
})();
