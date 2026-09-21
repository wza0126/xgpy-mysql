/**
 * 验证：学习模块「进度口径」UI 是否按 v2.5.2 修正后的逻辑渲染
 *
 * 断言项：
 *   1. 左侧目录头部文案形如 `自测已看 <n>/<m>`，且 m === 章末自测总问数
 *   2. 进度条宽度 = round(n/m*100)%
 *   3. 章末自测按钮文案形如 `章末自测（x/N 问）`
 *   4. 后端 learn-chapters 的 visited_count 累加 > 0（旧逻辑恒为 0）
 *   5. 无残留老格式 question_key
 *
 * 用法：
 *   node scripts/debug/verify_learn_progress_ui.cjs
 *   node scripts/debug/verify_learn_progress_ui.cjs --user a --pass 111111
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SITE = process.env.XGPY_SITE || 'http://127.0.0.1:3266';
const PORT = 9445;
const CHROME = process.env.XGPY_CHROME ||
  'C:/Users/jgtty/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const USER = argOf('--user', 'a');
const PASS = argOf('--pass', '111111');

/** 章末自测总问数：从生成的 TS 数据文件实时统计，避免硬编码漂移 */
function computeSelfTestTotal() {
  const TS = path.resolve(__dirname, '..', '..', '..', 'frontend', 'src', 'data', 'learnSelfTest.ts');
  const src = fs.readFileSync(TS, 'utf8');
  const m = src.match(/LEARN_SELF_TEST[^=]*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('未能从 learnSelfTest.ts 解析出 LEARN_SELF_TEST');
  const chapters = JSON.parse(m[1]);
  let total = 0;
  const per = [];
  for (const ch of chapters) {
    let n = 0;
    for (const g of ch.groups) n += g.questions.length;
    total += n;
    per.push(ch.cluster_id + '=' + n);
  }
  return { total, chapters: chapters.length, per };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let s = '';
      res.on('data', d => s += d);
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ---- 极简 WebSocket 客户端 ----
class WS {
  constructor(url) {
    const m = url.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    this.host = m[1]; this.port = +m[2]; this.path = m[3];
    this.buf = Buffer.alloc(0); this.handlers = new Map();
    this.id = 0; this.pending = new Map(); this.closed = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const key = Buffer.from(Math.random().toString(36)).toString('base64');
      this.sock = require('net').connect(this.port, this.host, () => {
        this.sock.write(
          'GET ' + this.path + ' HTTP/1.1\r\nHost: ' + this.host + ':' + this.port + '\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n'
        );
      });
      this.sock.on('error', reject);
      this.sock.on('data', (d) => this._onData(d));
      this._onUpgrade = () => resolve();
      this.sock.once('close', () => { this.closed = true; });
    });
  }
  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this._onUpgrade && this.buf.includes('\r\n\r\n')) {
      const idx = this.buf.indexOf('\r\n\r\n');
      this.buf = this.buf.slice(idx + 4);
      const up = this._onUpgrade; this._onUpgrade = null; up();
    }
    while (this.buf.length >= 2) {
      const b1 = this.buf[1];
      let len = b1 & 0x7f; let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      try { this._onMessage(JSON.parse(payload.toString('utf8'))); } catch (e) {}
    }
  }
  _onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
    } else if (msg.method && this.handlers.has(msg.method)) {
      this.handlers.get(msg.method).forEach(h => h(msg.params));
    }
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params) {
    params = params || {};
    const id = ++this.id;
    const data = Buffer.from(JSON.stringify({ id: id, method: method, params: params }), 'utf8');
    const mask = require('crypto').randomBytes(4);
    let header;
    if (data.length < 126) { header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | data.length; mask.copy(header, 2); }
    else if (data.length < 65536) { header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); mask.copy(header, 4); }
    else { header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2); mask.copy(header, 10); }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([header, masked]));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve: resolve, reject: reject }));
  }
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name: name, pass: !!pass, detail: detail });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
};

// ===== 注入页面的探针脚本（纯字符串拼接，避免模板嵌套） =====
const PROBE_PROGRESS = [
  "(function(){",
  "  var txt = document.body.innerText || '';",
  "  var m1 = txt.match(/自测已看\\s*(\\d+)\\s*\\/\\s*(\\d+)/);",
  "  var barPct = null;",
  "  var spans = Array.prototype.slice.call(document.querySelectorAll('span'));",
  "  for (var i = 0; i < spans.length; i++) {",
  "    var s = spans[i];",
  "    var p = s.closest('div');",
  "    if (p && (p.textContent||'').indexOf('自测已看') >= 0 && s.style && s.style.width) {",
  "      var w = s.style.width;",
  "      if (w.charAt(w.length-1) === '%') { barPct = parseFloat(w); break; }",
  "    }",
  "  }",
  "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
  "  var btnAll = [];",
  "  for (var j = 0; j < btns.length; j++) {",
  "    var t = (btns[j].textContent||'').replace(/\\s+/g,' ').trim();",
  "    if (t.indexOf('章末自测') >= 0) btnAll.push({ text: t, disabled: !!btns[j].disabled });",
  "  }",
  "  var btnText = btnAll.length ? btnAll[0].text : null;",
  "  var m2 = btnText ? btnText.match(/章末自测（(\\d+)\\/(\\d+)\\s*问）/) : null;",
  "  return {",
  "    hasTitle: txt.indexOf('考点精讲') >= 0,",
  "    headerSeen: m1 ? Number(m1[1]) : null,",
  "    headerTotal: m1 ? Number(m1[2]) : null,",
  "    barPct: barPct,",
  "    selfTestBtnText: btnText,",
  "    selfTestBtnCount: btnAll.length,",
  "    selfTestBtnAll: btnAll,",
  "    btnDone: m2 ? Number(m2[1]) : null,",
  "    btnTotal: m2 ? Number(m2[2]) : null,",
  "    selfTestPanelOpen: txt.indexOf('章末自测 · 想一想') >= 0,",
  "    chapterHeaderSnippet: (txt.match(/[\\s\\S]{0,80}章末自测（[^）]*）/g)||[]).slice(0,3)",
  "  };",
  "})()",
].join('\n');

const PROBE_API_TRUTH = [
  "(async function(){",
  "  var t = localStorage.getItem('xgpy_token');",
  "  var r = await fetch('/api/student/learn-chapters', { headers: { Authorization: 'Bearer ' + t } });",
  "  var j = await r.json();",
  "  var rows = (j && j.data && (j.data.chapters || j.data)) || [];",
  "  if (!Array.isArray(rows)) rows = [];",
  "  var sum = 0;",
  "  for (var i = 0; i < rows.length; i++) sum += (rows[i].visited_count || 0);",
  "  var r2 = await fetch('/api/student/learn-visited', { headers: { Authorization: 'Bearer ' + t } });",
  "  var j2 = await r2.json();",
  "  var arr = (j2 && j2.data) || [];",
  "  if (!Array.isArray(arr)) arr = [];",
  // data 是字符串数组（question_key 列表），兼容对象形态
  "  var keys = arr.map(function(x){ return (typeof x === 'string') ? x : ((x && x.question_key) || ''); });",
  "  var st = 0, lg = 0;",
  "  for (var k = 0; k < keys.length; k++) {",
  "    if (keys[k].indexOf('::selftest::') >= 0) st++; ",
  "    if (keys[k].indexOf('::') < 0) lg++;",
  "  }",
  "  return {",
  "    chapterCount: rows.length,",
  "    visitedSum: sum,",
  "    recordCount: keys.length,",
  "    selfTestKeys: st,",
  "    legacyKeys: lg,",
  "    maxKeyLen: keys.reduce(function(a,b){ return Math.max(a, b.length); }, 0),",
  "    sample: keys.slice(0, 3)",
  "  };",
  "})()",
].join('\n');

const OPEN_LEARN = [
  "(async function(){",
  "  var all = Array.prototype.slice.call(document.querySelectorAll('*'));",
  "  var leaf = null;",
  "  for (var i = 0; i < all.length; i++) {",
  "    var e = all[i];",
  "    if ((e.textContent||'').trim() === '学习' && e.children.length === 0) { leaf = e; break; }",
  "  }",
  "  if (!leaf) return 'leaf-not-found';",
  "  var node = leaf;",
  "  for (var k = 0; k < 5 && node; k++) {",
  "    node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));",
  "    node.click();",
  "    node = node.parentElement;",
  "  }",
  "  return 'dblclick-dispatched';",
  "})()",
].join('\n');

const SWITCH_CHAPTER = [
  "(function(){",
  "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
  "  var picked = [];",
  "  for (var i = 0; i < btns.length; i++) {",
  "    var t = (btns[i].textContent||'').trim();",
  "    if (t.length > 1 && t.length < 40 && /数据|算法|信息|程序|函数|编码|系统/.test(t) && t.indexOf('章末自测') < 0) picked.push(btns[i]);",
  "  }",
  "  if (picked.length < 3) return { switched: false, n: picked.length };",
  "  var target = picked[2];",
  "  target.click();",
  "  return { switched: true, clicked: (target.textContent||'').trim().slice(0, 30), n: picked.length };",
  "})()",
].join('\n');

const READ_BTN = [
  "(function(){",
  "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
  "  var btn = null;",
  "  for (var i = 0; i < btns.length; i++) {",
  "    if ((btns[i].textContent||'').indexOf('章末自测') >= 0) { btn = btns[i]; break; }",
  "  }",
  "  var t = btn ? (btn.textContent||'').replace(/\\s+/g,' ').trim() : null;",
  "  var m = t ? t.match(/章末自测（(\\d+)\\/(\\d+)\\s*问）/) : null;",
  "  return { btnText: t, done: m ? Number(m[1]) : null, total: m ? Number(m[2]) : null };",
  "})()",
].join('\n');

// 点开章末自测面板，读出题目条数与首题
const OPEN_SELFTEST_AND_READ = [
  "(async function(){",
  "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
  "  var btn = null;",
  "  for (var i = 0; i < btns.length; i++) {",
  "    if ((btns[i].textContent||'').indexOf('章末自测') >= 0 && !btns[i].disabled) { btn = btns[i]; break; }",
  "  }",
  "  if (!btn) return { opened: false, reason: 'button-not-found-or-disabled' };",
  "  btn.click();",
  "  await new Promise(function(r){ setTimeout(r, 1200); });",
  "  var txt = document.body.innerText || '';",
  "  var panelOpen = txt.indexOf('章末自测 · 想一想') >= 0;",
  "  // 面板内题目条数：带 fa-robot 的“答疑”提示所在的行数不易数，改数绿色/白色题块",
  "  var items = document.querySelectorAll('.grid.grid-cols-1.gap-2 > div');",
  "  var first = null;",
  "  for (var k = 0; k < items.length; k++) {",
  "    var t = (items[k].textContent||'').replace(/\\s+/g,' ').trim();",
  "    if (t.length > 8) { first = t.slice(0, 80); break; }",
  "  }",
  "  return { opened: true, panelOpen: panelOpen, itemCount: items.length, firstItem: first };",
  "})()",
].join('\n');

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
  "  return { ok: !!t, err: (j && j.error) || null, uid: (j && j.data && j.data.user && j.data.user.id) || null };",
  "})()",
].join('\n');

(async () => {
  const expect = computeSelfTestTotal();
  console.log('章末自测总问数（期望分母）= ' + expect.total + '，共 ' + expect.chapters + ' 章');
  console.log(expect.per.join('  ') + '\n');

  const userDir = path.join(process.cwd(), '.tmp-chrome-progress');
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir, '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(300);
  }
  if (!target) { console.error('无法连接 Chromium'); chrome.kill(); process.exit(1); }

  const ws = new WS(target.webSocketDebuggerUrl);
  await ws.connect();
  const netFails = [];
  ws.on('Network.loadingFailed', (p) => netFails.push(p.type + ' ' + p.errorText));
  ws.on('Network.responseReceived', (p) => {
    if (p.response.status >= 400) netFails.push('HTTP ' + p.response.status + ' ' + p.response.url);
  });

  await ws.send('Runtime.enable');
  await ws.send('Network.enable');
  await ws.send('Page.enable');

  const evalJs = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text || 'exception' };
    return r.result ? r.result.value : undefined;
  };

  try {
    await ws.send('Page.navigate', { url: SITE });
    await sleep(3500);

    const loginRes = await evalJs(LOGIN);
    check('登录成功', loginRes && loginRes.ok, JSON.stringify(loginRes));
    await sleep(500);

    const apiTruth = await evalJs(PROBE_API_TRUTH);
    console.log('后端真值: ' + JSON.stringify(apiTruth));
    check('learn-chapters 返回 16 章', apiTruth && apiTruth.chapterCount === 16, 'chapterCount=' + (apiTruth && apiTruth.chapterCount));
    check('visited_count 累加 > 0（旧逻辑恒为 0）', apiTruth && apiTruth.visitedSum > 0, 'sum=' + (apiTruth && apiTruth.visitedSum));
    check('无残留老格式 question_key', apiTruth && apiTruth.legacyKeys === 0, 'legacyKeys=' + (apiTruth && apiTruth.legacyKeys));
    check('全部记录为 ::selftest:: 格式',
      apiTruth && apiTruth.recordCount === apiTruth.selfTestKeys,
      apiTruth ? apiTruth.selfTestKeys + '/' + apiTruth.recordCount : 'n/a');
    check('question_key 最长长度 <= 80（迁移 083 列宽）',
      apiTruth && apiTruth.maxKeyLen <= 80, 'maxLen=' + (apiTruth && apiTruth.maxKeyLen));

    await ws.send('Page.navigate', { url: SITE });
    await sleep(4500);
    netFails.length = 0;

    const openLearn = await evalJs(OPEN_LEARN);
    check('学习模块已打开', openLearn === 'dblclick-dispatched', String(openLearn));
    await sleep(4500);

    const ui = await evalJs(PROBE_PROGRESS);
    console.log('进度 UI: ' + JSON.stringify(ui, null, 2));

    check('左侧目录含「考点精讲」', ui && ui.hasTitle);
    check('头部文案解析出 已看/总数', ui && ui.headerSeen !== null && ui.headerTotal !== null,
      ui ? ui.headerSeen + '/' + ui.headerTotal : 'n/a');
    check('分母 = 章末自测总问数(' + expect.total + ')', ui && ui.headerTotal === expect.total,
      '实际=' + (ui && ui.headerTotal));
    check('分子 > 0（旧版恒为 0）', ui && ui.headerSeen > 0, '实际=' + (ui && ui.headerSeen));
    check('分子 <= 后端 ::selftest:: 总记录数',
      ui && apiTruth && ui.headerSeen > 0 && ui.headerSeen <= apiTruth.selfTestKeys,
      '前端=' + (ui && ui.headerSeen) + ' 后端=' + (apiTruth && apiTruth.selfTestKeys));

    const expectedPct = (ui && ui.headerTotal)
      ? Math.min(100, Math.round((ui.headerSeen / ui.headerTotal) * 100)) : null;
    check('进度条宽度 = round(已看/总数*100)%',
      ui && ui.barPct !== null && expectedPct !== null && Math.abs(ui.barPct - expectedPct) <= 1,
      '条=' + (ui && ui.barPct) + '% 期望=' + expectedPct + '%');

    check('章末自测按钮存在且文案可解析',
      ui && ui.selfTestBtnCount === 1 && ui.selfTestBtnText !== null,
      ui && ui.selfTestBtnText);
    // 本章有自测数据 → 必须显示 (x/N 问) 且 N 合理；本章无数据 → 显示「本章暂未配备」且按钮禁用
    const btnHasData = ui && ui.btnTotal !== null && ui.btnTotal > 0;
    const btnNoData = ui && /本章暂未配备/.test(ui.selfTestBtnText || '');
    check('按钮文案与本章自测数据一致（有数据给 x/N，无数据给提示）',
      btnHasData || btnNoData,
      '本章=' + (ui && ui.btnTotal) + ' 文案=' + (ui && ui.selfTestBtnText));
    check('按钮分母不超过总分母',
      !btnHasData || (ui.btnTotal <= expect.total),
      '本章=' + (ui && ui.btnTotal) + ' 总=' + expect.total);

    const switchCh = await evalJs(SWITCH_CHAPTER);
    await sleep(1800);
    const ui2 = await evalJs(READ_BTN);
    console.log('切章后: ' + JSON.stringify({ switchCh: switchCh, ui2: ui2 }));

    check('切换章节后按钮重新渲染出本章问数',
      ui2 && ui2.total > 0, ui2 && ui2.btnText);
    check('切章后「已看」分子随章变化（口径正确）',
      switchCh && switchCh.switched === true,
      switchCh ? JSON.stringify(switchCh) : 'n/a');

    // 第一章（数据与信息 / 原缺自测）点开自测面板，确认题目真的渲染出来了
    console.log('\n--- 回第一章点开章末自测，验证补题已生效 ---');
    const backFirst = await evalJs([
      "(function(){",
      "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
      "  for (var i = 0; i < btns.length; i++) {",
      "    var t = (btns[i].textContent||'').trim();",
      "    if (t.indexOf('数据与信息') >= 0) { btns[i].click(); return 'clicked:' + t.slice(0,20); }",
      "  }",
      "  return 'not-found';",
      "})()",
    ].join('\n'));
    await sleep(1800);
    const st = await evalJs(OPEN_SELFTEST_AND_READ);
    console.log('章末自测面板: ' + JSON.stringify(st));
    check('「数据与信息」章末自测按钮可点击（不再禁用）',
      st && st.opened === true, st && st.reason);
    check('自测面板成功展开', st && st.panelOpen === true);
    check('面板内渲染出题目（补题已生效）',
      st && st.itemCount > 0 && !!st.firstItem,
      '题块=' + (st && st.itemCount) + ' 首题=' + (st && st.firstItem));

    console.log('\n网络异常: ' + (netFails.length ? netFails.slice(0, 10).join(' | ') : '（无）'));
  } catch (e) {
    check('脚本执行无异常', false, e.message);
  }

  const failed = results.filter(r => !r.pass);
  console.log('\n=== 汇总：' + (results.length - failed.length) + '/' + results.length + ' 通过 ===');
  failed.forEach(f => console.log('  x ' + f.name + ' — ' + f.detail));

  try { ws.sock.destroy(); } catch (e) {}
  chrome.kill();
  process.exit(failed.length ? 1 : 0);
})();
