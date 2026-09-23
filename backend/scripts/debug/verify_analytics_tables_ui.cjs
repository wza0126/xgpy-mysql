/**
 * 浏览器端实测：教师「学情分析」两张表的排序 / 滚动 / 字段
 *
 * 覆盖的需求（2026-09-23）：
 *   ① 学生详细数据：新增「总掌握」列；各列表头点击可排序；固定约 15 行、超出滚动；
 *   ② 章节掌握进度：表头可排序；「按姓名排序」实为按前面账号排；**下拉选「按掌握率排序」不再报错**（原 TDZ bug）；
 *      表格真的补上了「掌握率」列（原来下拉有该选项但表里没这列、且排序函数忽略入参）。
 *
 * 与 verify_analytics_tables.cjs 的分工：
 *   那个是**纯函数 + 源码接线**验证；本脚本是**真浏览器**验证 —— 点表头 / 选下拉，看 DOM 真实次序与运行时报错。
 *
 * ⚠️ 需前后端在运行（backend 3101 / frontend 3266）；教师账号见 --user/--pass。
 * 用法：
 *   node scripts/debug/verify_analytics_tables_ui.cjs --user teacher --pass xgpy666
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
const OUT_PNG = argOf('--shot', path.join(process.cwd(), '.workbuddy', 'tmp-analytics-detail.png'));
const OUT_PNG2 = argOf('--shot2', path.join(process.cwd(), '.workbuddy', 'tmp-analytics-mastery.png'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

const LOGIN =
  "(async function(){" +
  "  var r = await fetch('/api/auth/secure-login', {method:'POST', headers:{'Content-Type':'application/json'}," +
  "    body: JSON.stringify({username: " + JSON.stringify(USER) + ", password: " + JSON.stringify(PASS) + "})});" +
  "  var j = await r.json();" +
  "  var t = j && j.data && j.data.session && j.data.session.access_token;" +
  "  if (t) { localStorage.setItem('xgpy_token', t); localStorage.setItem('xgpy_user', JSON.stringify(j.data.user)); }" +
  "  return { ok: !!t, role: j && j.data && j.data.user && j.data.user.role, err: (j && j.error) || null };" +
  "})()";

const INSTALL_ERR_COLLECTOR =
  "(function(){ if (window.__errs) { window.__errs.length = 0; return 'reset'; } window.__errs = [];" +
  " window.addEventListener('error', function(e){ window.__errs.push('error: ' + (e.message || '')); });" +
  " window.addEventListener('unhandledrejection', function(e){ window.__errs.push('reject: ' + (e.reason && (e.reason.message || e.reason))); });" +
  " return 'ok'; })()";

/** 页面内通用小工具（挂在 window 上，供后续 probe 复用） */
const HELPERS =
  "(function(){ if (window.__t) return 'ok';" +
  "  window.__t = function(e){ return (e.textContent||'').replace(/\\s+/g,' ').trim(); };" +
  "  window.__card = function(heading){ var hs = Array.prototype.slice.call(document.querySelectorAll('h2,h3'));" +
  "    var hd = null; for (var i=0;i<hs.length;i++){ if (window.__t(hs[i]).indexOf(heading) === 0) { hd = hs[i]; break; } }" +
  "    if (!hd) return null; return hd.closest('div.bg-white') || hd.parentElement.parentElement; };" +
  "  window.__setSelect = function(sel, val){ var d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');" +
  "    d.set.call(sel, val); sel.dispatchEvent(new Event('change', {bubbles:true})); };" +
  "  window.__clickEl = function(el){ el.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window})); };" +
  "  return 'ok'; })()";

/** 点侧边栏「学情分析」菜单（文字在 <span> 里，故需扫描全部元素） */
const GO_ANALYTICS =
  "(function(){" +
  "  var all = Array.prototype.slice.call(document.querySelectorAll('*'));" +
  "  var leaf = null;" +
  "  for (var i=0;i<all.length;i++){ var e = all[i];" +
  "    if (window.__t(e) === '学情分析' && e.children.length === 0) { leaf = e; break; } }" +
  "  if (!leaf) return 'leaf-not-found';" +
  "  var btn = leaf.closest('button') || leaf.closest('a') || leaf;" +
  "  window.__clickEl(btn);" +
  "  return 'ok';" +
  "})()";

/** 班级下拉所在位置（学情分析标题旁） */
const PROBE_CLASS =
  "(function(){ var hs = Array.prototype.slice.call(document.querySelectorAll('h2'));" +
  "  var h = null; for (var i=0;i<hs.length;i++){ if (window.__t(hs[i]) === '学情分析') { h = hs[i]; break; } }" +
  "  if (!h) return { err: 'no-title' };" +
  "  var sel = h.parentElement.querySelector('select');" +
  "  if (!sel) return { err: 'no-select' };" +
  "  return { value: sel.value, options: Array.prototype.slice.call(sel.options).map(function(o){ return { v: o.value, t: o.text }; })," +
  "    pageText: (document.body.innerText||'').slice(0, 400) };" +
  "})()";

const SET_CLASS = (v) =>
  "(function(){ var hs = Array.prototype.slice.call(document.querySelectorAll('h2'));" +
  "  var h = null; for (var i=0;i<hs.length;i++){ if (window.__t(hs[i]) === '学情分析') { h = hs[i]; break; } }" +
  "  if (!h) return 'no-title'; var sel = h.parentElement.querySelector('select'); if (!sel) return 'no-select';" +
  "  window.__setSelect(sel, " + JSON.stringify(v) + "); return 'ok'; })()";

/** 「学生详细数据」表：表头 / 行 / 滚动容器 / 吸顶 */
const PROBE_DETAIL =
  "(function(){ var card = window.__card('学生详细数据'); if (!card) return { err: 'no-card' };" +
  "  var table = card.querySelector('table'); var scroller = card.querySelector('div[style*=\"max-height\"]');" +
  "  if (!table || !scroller) return { err: 'no-table-or-scroller' };" +
  "  var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr')).filter(function(tr){ return tr.children.length > 1; });" +
  "  var thead = table.querySelector('thead');" +
  "  var tds = rows.map(function(tr){ return Array.prototype.slice.call(tr.children).map(window.__t); });" +
  "  var cs = getComputedStyle(scroller);" +
  "  return { headers: Array.prototype.slice.call(table.querySelectorAll('thead th')).map(window.__t)," +
  "    rowCount: rows.length," +
  "    labels: tds.map(function(r){ return r[0]; })," +
  "    cells: tds," +
  "    scroller: { maxH: scroller.style.maxHeight, clientH: scroller.clientHeight, scrollH: scroller.scrollHeight, overflowY: cs.overflowY }," +
  "    theadH: thead.getBoundingClientRect().height, theadPos: getComputedStyle(thead).position," +
  "    rowH: rows.length ? rows[0].getBoundingClientRect().height : 0" +
  "  }; })()";

/** 点「学生详细数据」的某个表头 */
const CLICK_DETAIL_HEADER = (label) =>
  "(function(){ var card = window.__card('学生详细数据'); if (!card) return 'no-card';" +
  "  var ths = Array.prototype.slice.call(card.querySelectorAll('thead th'));" +
  "  var th = null; for (var i=0;i<ths.length;i++){ if (window.__t(ths[i]).indexOf(" + JSON.stringify(label) + ") === 0) { th = ths[i]; break; } }" +
  "  if (!th) return 'th-not-found'; window.__clickEl(th); return 'ok'; })()";

/** 「章节掌握进度」表 */
const PROBE_MASTERY =
  "(function(){ var card = window.__card('章节掌握进度'); if (!card) return { err: 'no-card' };" +
  "  var table = card.querySelector('table'); var sel = card.querySelector('select');" +
  "  if (!table) return { err: 'no-table', hasSelect: !!sel };" +
  "  var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr')).filter(function(tr){ return tr.children.length > 1; });" +
  "  var tds = rows.map(function(tr){ return Array.prototype.slice.call(tr.children).map(window.__t); });" +
  "  return { headers: Array.prototype.slice.call(table.querySelectorAll('thead th')).map(window.__t)," +
  "    rowCount: rows.length," +
  "    labels: tds.map(function(r){ return r[0]; })," +
  "    mastered: tds.map(function(r){ return r[1]; })," +
  "    rates: tds.map(function(r){ return r[2]; })," +
  "    selectValue: sel ? sel.value : null," +
  "    options: sel ? Array.prototype.slice.call(sel.options).map(function(o){ return o.text; }) : []" +
  "  }; })()";

const CLICK_MASTERY_HEADER = (label) =>
  "(function(){ var card = window.__card('章节掌握进度'); if (!card) return 'no-card';" +
  "  var ths = Array.prototype.slice.call(card.querySelectorAll('thead th'));" +
  "  var th = null; for (var i=0;i<ths.length;i++){ if (window.__t(ths[i]).indexOf(" + JSON.stringify(label) + ") === 0) { th = ths[i]; break; } }" +
  "  if (!th) return 'th-not-found'; window.__clickEl(th); return 'ok'; })()";

const SET_MASTERY_SORT = (v) =>
  "(function(){ var card = window.__card('章节掌握进度'); if (!card) return 'no-card';" +
  "  var sel = card.querySelector('select'); if (!sel) return 'no-select';" +
  "  window.__setSelect(sel, " + JSON.stringify(v) + "); return 'ok'; })()";

/** 用教师 token 复核「总掌握」与章节掌握接口同源 */
const PROBE_MASTERY_API = (classId) =>
  "(async function(){ var t = localStorage.getItem('xgpy_token');" +
  "  var r = await fetch('/api/teacher/analytics/chapter-mastery/' + " + JSON.stringify(classId) + ", { headers: { Authorization: 'Bearer ' + t } });" +
  "  var j = await r.json(); var d = j && j.data;" +
  "  var m = {}; ((d && d.students) || []).forEach(function(s){ m[s.id] = s.total_mastered || 0; });" +
  "  return { code: r.status, students: (d && d.students) || [], map: m, chapters: (d && d.chapters) || [], threshold: d && d.master_threshold };" +
  "})()";

/** 从「账号 姓名」里取账号（第一个空格前的部分） */
const accountOf = (label) => String(label || '').trim().split(/\s+/)[0];
const isAscending = (arr, keyFn) => {
  for (let i = 1; i < arr.length; i++) {
    if (keyFn(arr[i - 1]) > keyFn(arr[i])) return false;
  }
  return true;
};
const isNonIncreasing = (arr, keyFn) => {
  for (let i = 1; i < arr.length; i++) {
    if (keyFn(arr[i - 1]) < keyFn(arr[i])) return false;
  }
  return true;
};

(async () => {
  console.log('站点：' + SITE + '　账号：' + USER);
  const udd = path.join(process.cwd(), '.tmp-chrome-analytics');
  const b = await launchHeadless({ port: 9454, userDataDir: udd, windowSize: '1600,1200' });
  let shotDone = false;
  try {
    await b.ws.send('Page.navigate', { url: SITE });
    await b.sleep(3500);
    await b.evalJs(INSTALL_ERR_COLLECTOR);

    section('⓪ 教师登录');
    const login = await b.evalJs(LOGIN);
    check('登录成功', login && login.ok, JSON.stringify(login));
    if (!login || !login.ok) throw new Error('登录失败（可用 --user/--pass 指定）');
    check('角色为教师', login.role === 'teacher' || login.role === 'super_admin', String(login.role));

    // ⚠️ 必须从**根路由**加载（不带 hash）让应用自行跳转到 /#/teacher。
    //    直接加载 /#/teacher 时，首帧 profile 尚为 null → 路由守卫把地址重置为 #/，
    //    之后就停在登录页不再跳转（应用既有行为，与本次改动无关）。
    await b.ws.send('Page.navigate', { url: SITE });
    b.netFails.length = 0;
    let dashboard = false;
    for (let i = 0; i < 12; i++) {
      await b.sleep(1500);
      await b.evalJs(HELPERS);
      dashboard = await b.evalJs(
        "(function(){ var found = false;" +
        "  Array.prototype.forEach.call(document.querySelectorAll('*'), function(e){ if (!found && (e.textContent||'').trim() === '学情分析' && e.children.length === 0) found = true; });" +
        "  return found; })()"
      );
      if (dashboard) break;
    }
    check('已进入教师后台（侧边栏出现「学情分析」）', dashboard === true, 'hash=' + (await b.evalJs('location.hash')));
    await b.evalJs(INSTALL_ERR_COLLECTOR);
    await b.evalJs(HELPERS);

    section('① 进入「学情分析」');
    const go = await b.evalJs(GO_ANALYTICS);
    check('点中侧边栏「学情分析」', go === 'ok', String(go));
    await b.sleep(4500);
    const cls = await b.evalJs(PROBE_CLASS);
    console.log('  ' + JSON.stringify(cls && cls.options));
    check('学情分析页已打开（存在标题与班级下拉）', !!cls && !cls.err, JSON.stringify(cls && cls.err || ''));
    if (cls && cls.err === 'no-title') {
      // 未授权时点菜单会弹「需授权」弹窗而不是切页，这里给出明确原因
      const modal = await b.evalJs(
        "(function(){ var m = null;" +
        "  Array.prototype.forEach.call(document.querySelectorAll('div'), function(d){" +
        "    if (!m && (d.className || '').indexOf('bg-black/50') >= 0) m = d; });" +
        "  return m ? (m.innerText||'').replace(/\\s+/g,' ').slice(0, 160) : null; })()"
      );
      check('不是被「需授权」弹窗拦住', false, '弹窗内容：' + (modal || '（未识别到弹窗）'));
    }
    check('班级下拉有可选项', !!cls && cls.options && cls.options.length > 0, '共 ' + ((cls && cls.options && cls.options.length) || 0) + ' 个');

    // 逐个班级试，选「学生数最多」的那个 —— 才能把「约 15 行 + 滚动条」的分支验到真数据
    let detail = await b.evalJs(PROBE_DETAIL);
    if (!detail || detail.err) console.log('  [调试] detail=' + JSON.stringify(detail));
    let bestRows = detail && !detail.err ? detail.rowCount : 0;
    let bestClass = cls && cls.options && cls.options.length ? cls.options[0] : null;
    if (cls && cls.options) {
      for (const opt of cls.options) {
        await b.evalJs(SET_CLASS(opt.v));
        await b.sleep(2200);
        const d2 = await b.evalJs(PROBE_DETAIL);
        const n = d2 && !d2.err ? d2.rowCount : 0;
        console.log('  [信息] 班级「' + opt.t + '」学生 ' + n + ' 人');
        if (n > bestRows) { bestRows = n; bestClass = opt; }
      }
      if (bestClass) {
        await b.evalJs(SET_CLASS(bestClass.v));
        await b.sleep(2200);
        detail = await b.evalJs(PROBE_DETAIL);
        console.log('  [信息] 使用班级「' + bestClass.t + '」（' + bestRows + ' 人）');
      }
    }
    check('学生详细数据有数据行', !!detail && !detail.err && detail.rowCount > 0,
      detail && !detail.err ? '共 ' + detail.rowCount + ' 行' : JSON.stringify(detail && detail.err));

    const classId = await b.evalJs(
      "(function(){ var hs = Array.prototype.slice.call(document.querySelectorAll('h2'));" +
      "  for (var i=0;i<hs.length;i++){ if (window.__t(hs[i]) === '学情分析') { var s = hs[i].parentElement.querySelector('select'); return s ? s.value : null; } } return null; })()"
    );

    section('② 学生详细数据：表头字段 + 排序');
    check('表头共 7 列', detail.headers.length === 7, JSON.stringify(detail.headers));
    check('新增「总掌握」列', detail.headers.some((h) => h.indexOf('总掌握') === 0), JSON.stringify(detail.headers));
    check('首列为「账号 姓名」', detail.headers[0].indexOf('账号 姓名') === 0, detail.headers[0]);
    check('账号 姓名单元格含账号与姓名（形如 20230101 张三）',
      detail.labels.every((l) => /\s/.test(l)), JSON.stringify(detail.labels.slice(0, 3)));
    check('默认按账号升序', isAscending(detail.labels, accountOf), JSON.stringify(detail.labels.slice(0, 4).map(accountOf)));

    const before = detail.labels.slice();
    const c1 = await b.evalJs(CLICK_DETAIL_HEADER('总掌握'));
    check('点击「总掌握」表头', c1 === 'ok', String(c1));
    await b.sleep(600);
    const dM = await b.evalJs(PROBE_DETAIL);
    check('点击后行顺序发生变化（排序真的生效）',
      JSON.stringify(dM.labels) !== JSON.stringify(before),
      JSON.stringify(dM.labels.slice(0, 4).map(accountOf)) + ' vs ' + JSON.stringify(before.slice(0, 4).map(accountOf)));
    check('首次点击为降序（总掌握由多到少）',
      isNonIncreasing(dM.cells.map((r) => Number(r[5]) || 0), (n) => n),
      JSON.stringify(dM.cells.map((r) => Number(r[5]) || 0)));
    check('表头出现排序指示箭头', dM.headers.join(' ').indexOf('总掌握') >= 0);

    const c2 = await b.evalJs(CLICK_DETAIL_HEADER('总掌握'));
    check('再点一次切换为升序', c2 === 'ok');
    await b.sleep(600);
    const dA = await b.evalJs(PROBE_DETAIL);
    check('第二次点击为升序（总掌握由少到多）',
      isAscending(dA.cells.map((r) => Number(r[5]) || 0), (n) => n),
      JSON.stringify(dA.cells.map((r) => Number(r[5]) || 0)));

    const c3 = await b.evalJs(CLICK_DETAIL_HEADER('当前积分'));
    await b.sleep(600);
    const dP = await b.evalJs(PROBE_DETAIL);
    check('切换字段「当前积分」为降序', c3 === 'ok' &&
      isNonIncreasing(dP.cells.map((r) => Number(r[1]) || 0), (n) => n),
      JSON.stringify(dP.cells.map((r) => Number(r[1]) || 0)));

    section('③ 学生详细数据：固定约 15 行 + 滚动条');
    check('滚动容器限高 768px', dP.scroller.maxH === '768px', dP.scroller.maxH);
    check('溢出时容器内滚动（overflow-y: auto）', dP.scroller.overflowY === 'auto', dP.scroller.overflowY);
    check('表头吸顶（sticky）', dP.theadPos === 'sticky', dP.theadPos);
    // 用实测的表头高 / 行高推算：768px 高度里正好放得下 15 行（44 + 15×48 = 764 ≤ 768）
    const visible15 = Math.floor((768 - dP.theadH) / dP.rowH);
    check('768px 恰好容纳 15 行（按实测表头高/行高推算）', visible15 === 15,
      '表头 ' + dP.theadH + 'px + 行高 ' + dP.rowH + 'px → ' + visible15 + ' 行');
    if (dP.rowCount > 15) {
      check('内容高于容器（出现滚动条）', dP.scroller.scrollH > dP.scroller.clientH,
        'scrollH=' + dP.scroller.scrollH + ' clientH=' + dP.scroller.clientH);
      check('容器高度被钳到 768（未撑开）', dP.scroller.clientH === 768, 'clientH=' + dP.scroller.clientH);
      const visible = Math.floor((dP.scroller.clientH - dP.theadH) / dP.rowH);
      check('可见整行约 15 行', visible === 15, '可见 ' + visible + ' 行（表头 ' + dP.theadH + 'px、行高 ' + dP.rowH + 'px）');
    } else {
      check('学生数不足 15，无需滚动（未出现无谓滚动条）', dP.scroller.scrollH <= dP.scroller.clientH,
        'rowCount=' + dP.rowCount + ' scrollH=' + dP.scroller.scrollH + ' clientH=' + dP.scroller.clientH);
    }

    section('④ 「总掌握」与章节掌握接口同源（口径只有一处）');
    const api = await b.evalJs(PROBE_MASTERY_API(classId));
    check('章节掌握接口返回 200', api && api.code === 200, 'code=' + (api && api.code));
    const tableMastered = {};
    dP.cells.forEach((r) => { tableMastered[accountOf(r[0])] = Number(r[5]) || 0; });
    const apiMastered = {};
    (api && api.students || []).forEach((s) => { apiMastered[String(s.username || s.real_name || '')] = s.total_mastered || 0; });
    const keys = Object.keys(apiMastered).filter((k) => tableMastered[k] !== undefined);
    const mismatch = keys.filter((k) => apiMastered[k] !== tableMastered[k]);
    check('表格「总掌握」与接口逐生一致', keys.length > 0 && mismatch.length === 0,
      keys.length === 0 ? '无可比对学生' : ('比对 ' + keys.length + ' 人，不一致 ' + mismatch.length + ' 人' + (mismatch.length ? ' → ' + JSON.stringify(mismatch.slice(0, 3)) : '')));

    section('⑤ 章节掌握进度：字段 / 下拉排序（含原来的报错点）');
    // 班级已在前面选定（学生数最多的那个），章节表与其同一个 classId，无需再切
    const mst = await b.evalJs(PROBE_MASTERY);
    check('章节掌握进度表有数据行', !!mst && !mst.err && mst.rowCount > 0,
      mst && !mst.err ? '共 ' + mst.rowCount + ' 行' : JSON.stringify(mst && mst.err));
    check('表头含「账号 姓名」', mst.headers[0].indexOf('账号 姓名') === 0, mst.headers[0]);
    check('表头含「掌握总数」', mst.headers.some((h) => h.indexOf('掌握总数') === 0), JSON.stringify(mst.headers.slice(0, 3)));
    check('表头含新增的「掌握率」列', mst.headers.some((h) => h.indexOf('掌握率') === 0), JSON.stringify(mst.headers.slice(0, 3)));
    check('掌握率单元格为百分比', mst.rates.every((r) => /^\d+%$/.test(r)), JSON.stringify(mst.rates.slice(0, 4)));
    check('下拉含「按掌握率排序」选项', mst.options.some((t) => t.indexOf('按掌握率') >= 0), JSON.stringify(mst.options));
    check('下拉「按姓名排序」项已写明按账号',
      mst.options.some((t) => t.indexOf('账号') >= 0), JSON.stringify(mst.options));

    // ↓ 关键：选「按掌握率排序」曾因 TDZ 直接抛错，这里必须既不报错又真的按掌握率排
    await b.evalJs("window.__errs.length = 0");
    const sRate = await b.evalJs(SET_MASTERY_SORT('rate'));
    check('下拉切到「按掌握率排序」', sRate === 'ok', String(sRate));
    await b.sleep(800);
    const mRate = await b.evalJs(PROBE_MASTERY);
    const errsAfterRate = await b.evalJs('window.__errs || []');
    check('切到掌握率排序后页面无报错（原 TDZ 崩溃点）',
      Array.isArray(errsAfterRate) && errsAfterRate.length === 0, JSON.stringify(errsAfterRate || []).slice(0, 200));
    check('排序后表格仍在（未白屏/未崩溃）', !!mRate && !mRate.err && mRate.rowCount > 0, JSON.stringify(mRate && mRate.err || ('rows=' + (mRate && mRate.rowCount))));
    check('排序后下拉选中态为 rate', mRate.selectValue === 'rate', String(mRate.selectValue));
    check('按掌握率降序（%由高到低）',
      isNonIncreasing(mRate.rates.map((r) => parseInt(r, 10) || 0), (n) => n),
      JSON.stringify(mRate.rates.slice(0, 5)));

    const sName = await b.evalJs(SET_MASTERY_SORT('name'));
    check('下拉切回「按账号 姓名排序」', sName === 'ok');
    await b.sleep(700);
    const mName = await b.evalJs(PROBE_MASTERY);
    check('按账号升序（排序依据是前面的账号）',
      isAscending(mName.labels, accountOf), JSON.stringify(mName.labels.slice(0, 4).map(accountOf)));
    check('账号升序时与姓名顺序无关（证明按账号而非姓名）',
      JSON.stringify(mName.labels.map(accountOf)) === JSON.stringify(mRate.labels.map(accountOf).slice().sort()),
      JSON.stringify(mName.labels.slice(0, 3).map(accountOf)));

    const sMastered = await b.evalJs(SET_MASTERY_SORT('mastered'));
    await b.sleep(700);
    const mMastered = await b.evalJs(PROBE_MASTERY);
    check('切到「按掌握总数排序」为降序', sMastered === 'ok' &&
      isNonIncreasing(mMastered.mastered.map((n) => Number(n) || 0), (n) => n),
      JSON.stringify(mMastered.mastered.slice(0, 5)));

    section('⑥ 表头点击排序（章节表）');
    const hRate = await b.evalJs(CLICK_MASTERY_HEADER('掌握率'));
    await b.sleep(700);
    const mHRate = await b.evalJs(PROBE_MASTERY);
    check('点「掌握率」表头即按掌握率排（复用同一状态）', hRate === 'ok' && mHRate.selectValue === 'rate',
      'click=' + hRate + ' select=' + mHRate.selectValue);
    const hName = await b.evalJs(CLICK_MASTERY_HEADER('账号 姓名'));
    await b.sleep(700);
    const mHName = await b.evalJs(PROBE_MASTERY);
    check('点「账号 姓名」表头按账号排', hName === 'ok' && mHName.selectValue === 'name',
      'click=' + hName + ' select=' + mHName.selectValue);

    section('⑦ 全程无运行时报错');
    const pageErrs = await b.evalJs('window.__errs || []');
    check('页面无 error / unhandledrejection', Array.isArray(pageErrs) && pageErrs.length === 0, JSON.stringify(pageErrs || []).slice(0, 300));
    check('无 JS 异常（CDP）', b.jsErrors.length === 0, b.jsErrors.join(' | ').slice(0, 300));
    const badNet = b.netFails.filter((f) => !/favicon/i.test(f));
    check('无 >=400 响应', badNet.length === 0, badNet.join(' | ').slice(0, 300));

    // 截图留证：分别滚动到两张表（失败不影响结论）
    const shots = [];
    for (const [heading, out] of [['学生详细数据', OUT_PNG], ['章节掌握进度', OUT_PNG2]]) {
      try {
        await b.evalJs(
          "(function(){ var c = window.__card(" + JSON.stringify(heading) + ");" +
          "  if (!c) return 'no-card'; c.scrollIntoView({ block: 'start' }); return 'ok'; })()"
        );
        await b.sleep(900);
        const shot = await b.ws.send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
        shots.push(out);
      } catch (e) {}
    }
    if (shots.length) shotDone = true;
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
  if (shotDone) console.log('截图：' + OUT_PNG + '\n      ' + OUT_PNG2);
  if (fail) {
    console.log('失败项：');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('全部通过 ✅');
})();
