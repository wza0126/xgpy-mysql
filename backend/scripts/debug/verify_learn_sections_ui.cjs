/**
 * 验证：学习模块两项 UI 改动
 *   ①（A 方案）右侧讲义区「去练习」按钮不再截断为前 4 个，而是显示本章全部有题小节
 *   ② 右下角「回到顶部」悬浮按钮：滚动后出现、点击后回到顶部
 *
 * 断言策略（不依赖硬编码文案）：
 *   - 逐章切换，比对「右侧可见小节按钮数」与后端 learn-chapters 返回的
 *     该章 sections.filter(q>0).length，必须相等（旧版恒 <= 4）
 *   - 至少存在一章的小节数 > 4，用来证明「截断确实被去掉了」而不是碰巧每章都 <= 4
 *   - 悬浮按钮：初始不可见 → 滚动到中间后可见 → 点击后 scrollTop 回到 0
 *
 * 用法：
 *   node scripts/debug/verify_learn_sections_ui.cjs
 *   node scripts/debug/verify_learn_sections_ui.cjs --user a --pass 111111
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const SITE = process.env.XGPY_SITE || 'http://127.0.0.1:3266';
const PORT = 9447;
const CHROME = process.env.XGPY_CHROME ||
  'C:/Users/jgtty/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const USER = argOf('--user', 'a');
const PASS = argOf('--pass', '111111');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const json = JSON.stringify({ id, method, params });
      const payload = Buffer.from(json, 'utf8');
      const len = payload.length;
      let header;
      if (len < 126) { header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | len; }
      else if (len < 65536) { header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
      else { header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
      const mask = Buffer.from([1, 2, 3, 4]);
      mask.copy(header, header.length - 4);
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
      this.sock.write(Buffer.concat([header, masked]));
    });
  }
}

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
  "  return { ok: !!t, err: (j && j.error) || null };",
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

// 后端真值：每章「有题小节」数量 + 章名顺序
const API_TRUTH = [
  "(async function(){",
  "  var t = localStorage.getItem('xgpy_token');",
  "  var r = await fetch('/api/student/learn-chapters', { headers: { Authorization: 'Bearer ' + t } });",
  "  var j = await r.json();",
  "  var rows = (j && j.data && (j.data.chapters || j.data)) || [];",
  "  if (!Array.isArray(rows)) rows = [];",
  "  var out = [];",
  "  for (var i = 0; i < rows.length; i++) {",
  "    var secs = rows[i].sections || [];",
  "    var withQ = secs.filter(function(s){ return (s.question_count||0) > 0; });",
  "    out.push({ name: rows[i].cluster_id, total: secs.length, withQ: withQ.length,",
  "               names: withQ.map(function(s){ return s.name; }),",
  "               paths: withQ.map(function(s){ return s.path; }) });",
  "  }",
  "  return out;",
  "})()",
].join('\n');

/** 切到左侧目录第 idx 个章节按钮 */
function switchToChapter(idx) {
  return [
    "(function(){",
    "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
    "  var picks = [];",
    "  for (var i = 0; i < btns.length; i++) {",
    "    var t = (btns[i].textContent||'').trim();",
    // 左侧章按钮特征：含数字题量角标，排除小节按钮/自测按钮
    "    if (t && t.length < 40 && btns[i].querySelector && btns[i].querySelector('span')) {",
    "      var hasToggle = !!btns[i].querySelector('.fa-chevron-right, .fa-chevron-down');",
    "      if (hasToggle) picks.push(btns[i]);",
    "    }",
    "  }",
    "  if (picks.length <= " + idx + ") return { ok:false, n: picks.length };",
    "  picks[" + idx + "].click();",
    "  return { ok:true, n: picks.length, clicked: (picks[" + idx + "].textContent||'').trim().slice(0,20) };",
    "})()",
  ].join('\n');
}

/** 读右侧讲义区「去练习」按钮（title 以 去练习： 开头） */
const READ_PRACTICE_BTNS = [
  "(function(){",
  "  var btns = Array.prototype.slice.call(document.querySelectorAll('button[title]'));",
  "  var out = [];",
  "  for (var i = 0; i < btns.length; i++) {",
  "    var ttl = btns[i].getAttribute('title') || '';",
  "    if (ttl.indexOf('去练习：') === 0) {",
  "      out.push({ title: ttl.slice(4), text: (btns[i].textContent||'').replace(/\\s+/g,' ').trim() });",
  "    }",
  "  }",
  "  return out;",
  "})()",
].join('\n');

/** 找滚动容器（右侧正文），返回 scrollTop / scrollHeight / clientHeight */
const FIND_SCROLLER = [
  "(function(){",
  "  var all = Array.prototype.slice.call(document.querySelectorAll('div'));",
  "  var best = null;",
  "  for (var i = 0; i < all.length; i++) {",
  "    var e = all[i];",
  "    var cs = getComputedStyle(e);",
  "    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 40) {",
  "      if (!best || e.scrollHeight > best.scrollHeight) best = e;",
  "    }",
  "  }",
  "  if (!best) return null;",
  "  best.setAttribute('data-probe-scroller','1');",
  "  return { scrollTop: best.scrollTop, scrollHeight: best.scrollHeight, clientHeight: best.clientHeight };",
  "})()",
].join('\n');

/** 滚动正文容器到指定位置 */
function scrollScrollerTo(top) {
  return [
    "(function(){",
    "  var e = document.querySelector('[data-probe-scroller]');",
    "  if (!e) return null;",
    "  e.scrollTop = " + top + ";",
    "  e.dispatchEvent(new Event('scroll', { bubbles: true }));",
    "  return e.scrollTop;",
    "})()",
  ].join('\n');
}

/** 找「回到顶部」按钮（aria-label / title） */
const FIND_BACKTOP = [
  "(function(){",
  "  var all = Array.prototype.slice.call(document.querySelectorAll('button'));",
  "  for (var i = 0; i < all.length; i++) {",
  "    var al = all[i].getAttribute('aria-label') || '';",
  "    var tt = all[i].getAttribute('title') || '';",
  "    if (al === '回到顶部' || tt === '回到顶部') {",
  "      var r = all[i].getBoundingClientRect();",
  "      var cs = getComputedStyle(all[i]);",
  "      all[i].setAttribute('data-probe-backtop','1');",
  "      return { found: true, w: Math.round(r.width), h: Math.round(r.height), opacity: cs.opacity, visible: r.width > 0 && r.height > 0 };",
  "    }",
  "  }",
  "  return { found: false };",
  "})()",
].join('\n');

const CLICK_BACKTOP = [
  "(function(){",
  "  var b = document.querySelector('[data-probe-backtop]');",
  "  if (!b) return 'not-found';",
  "  b.click();",
  "  return 'clicked';",
  "})()",
].join('\n');

(async () => {
  console.log('=== 学习模块小节按钮 + 回到顶部 验证 ===');
  console.log('SITE = ' + SITE + '\n');

  const userDir = path.join(process.cwd(), '.tmp-chrome-sections');
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
    if (!loginRes || !loginRes.ok) throw new Error('登录失败，无法继续');
    await sleep(500);

    const truth = await evalJs(API_TRUTH);
    if (!Array.isArray(truth)) throw new Error('未能取到 learn-chapters 真值');
    const over4 = truth.filter(t => t.withQ > 4);
    console.log('后端真值：' + truth.length + ' 章，其中有题小节 > 4 的有 ' + over4.length + ' 章');
    over4.forEach(t => console.log('   ' + t.name + ' -> ' + t.withQ + ' 个'));

    section('前提：存在小节数 > 4 的章（用于证明截断确实移除）');
    check('至少 1 章的有题小节数 > 4', over4.length > 0, '共 ' + over4.length + ' 章');

    await ws.send('Page.navigate', { url: SITE });
    await sleep(4500);
    netFails.length = 0;

    const openLearn = await evalJs(OPEN_LEARN);
    check('学习模块已打开', openLearn === 'dblclick-dispatched', String(openLearn));
    await sleep(4500);

    section('① A 方案：右侧「去练习」按钮 = 本章全部有题小节');

    // 逐章核对：优先核对小节数最多的几章 + 全部章
    let mismatches = [];
    let checkedChapters = 0;
    let maxSeen = 0;
    let sawOver4InUI = false;

    for (let i = 0; i < truth.length; i++) {
      const sw = await evalJs(switchToChapter(i));
      if (!sw || !sw.ok) continue;
      await sleep(1300);

      const btns = await evalJs(READ_PRACTICE_BTNS);
      if (!Array.isArray(btns)) continue;
      checkedChapters++;
      const expected = truth[i].withQ;
      const actual = btns.length;
      if (actual > maxSeen) maxSeen = actual;
      if (actual > 4) sawOver4InUI = true;

      if (actual !== expected) {
        mismatches.push(truth[i].name + ' 期望' + expected + ' 实际' + actual);
      }

      // 对超 4 章的「小节名集合」做精确比对（按钮 title = s.name，不是 path）
      if (expected > 4) {
        const uiTitles = btns.map(b => b.title).sort();
        const expNames = truth[i].names.slice().sort();
        const sameSet = uiTitles.length === expNames.length && uiTitles.every((t, k) => t === expNames[k]);
        if (!sameSet) {
          const missing = expNames.filter(p => uiTitles.indexOf(p) < 0);
          const extra = uiTitles.filter(p => expNames.indexOf(p) < 0);
          mismatches.push(truth[i].name + ' 缺=' + JSON.stringify(missing) + ' 多=' + JSON.stringify(extra));
        }
      }
    }

    check('逐章核对了 ' + checkedChapters + ' 章', checkedChapters >= 15, 'checked=' + checkedChapters);
    check('每章右侧按钮数 = 该章有题小节数（无截断）', mismatches.length === 0,
      mismatches.length ? mismatches.slice(0, 6).join(' ; ') : '全部一致');
    check('UI 中确实出现了 > 4 个按钮的章（证明去掉 slice(0,4)）', sawOver4InUI,
      'UI 单章最多 ' + maxSeen + ' 个按钮');
    check('UI 单章按钮数达到后端最大值', maxSeen === Math.max.apply(null, truth.map(t => t.withQ)),
      'UI=' + maxSeen + ' 后端=' + Math.max.apply(null, truth.map(t => t.withQ)));

    section('② 回到顶部悬浮按钮');

    // 先在有小节 > 4 的章上验证（内容够长）
    const bigIdx = truth.findIndex(t => t.withQ > 4);
    if (bigIdx >= 0) {
      await evalJs(switchToChapter(bigIdx));
      await sleep(1500);
    }

    const sc = await evalJs(FIND_SCROLLER);
    console.log('滚动容器: ' + JSON.stringify(sc));
    check('找到右侧正文滚动容器', !!sc && sc.scrollHeight > sc.clientHeight,
      sc ? sc.scrollHeight + '/' + sc.clientHeight : 'n/a');

    const canScroll = sc && (sc.scrollHeight - sc.clientHeight) > 300;
    check('正文内容足够长（可滚动 > 300px）', !!canScroll,
      sc ? '可滚 ' + (sc.scrollHeight - sc.clientHeight) + 'px' : 'n/a');

    if (canScroll) {
      // 顶部：按钮不应出现
      await evalJs(scrollScrollerTo(0));
      await sleep(500);
      const atTop = await evalJs(FIND_BACKTOP);
      check('滚动到顶部时按钮不显示', !atTop || !atTop.found, JSON.stringify(atTop));

      // 滚到中间：按钮应出现
      const mid = Math.round((sc.scrollHeight - sc.clientHeight) / 2);
      await evalJs(scrollScrollerTo(mid));
      await sleep(700);
      const atMid = await evalJs(FIND_BACKTOP);
      check('向下滚动后按钮出现', !!atMid && atMid.found === true, JSON.stringify(atMid));
      check('按钮尺寸合理（约 44x44）',
        atMid && atMid.found && atMid.w >= 36 && atMid.w <= 56 && atMid.h >= 36 && atMid.h <= 56,
        atMid ? atMid.w + 'x' + atMid.h : 'n/a');

      // 点按钮：应回到顶部
      const clicked = await evalJs(CLICK_BACKTOP);
      check('按钮可点击', clicked === 'clicked', String(clicked));
      await sleep(1200);
      const after = await evalJs(FIND_SCROLLER);
      check('点击后回到顶部（scrollTop 接近 0）',
        after && after.scrollTop <= 5, after ? 'scrollTop=' + after.scrollTop : 'n/a');

      // 回顶后按钮自身应隐藏
      await sleep(500);
      const afterBtn = await evalJs(FIND_BACKTOP);
      check('回到顶部后按钮自动隐藏', !afterBtn || !afterBtn.found, JSON.stringify(afterBtn));
    }

    section('③ 无前端错误');
    const badNet = netFails.filter(f => !/favicon/i.test(f));
    check('无 4xx/5xx 请求与加载失败', badNet.length === 0,
      badNet.length ? badNet.slice(0, 4).join(' ; ') : '干净');
  } catch (e) {
    fail++;
    failures.push('EXCEPTION: ' + e.message);
    console.log('\n!! 异常: ' + e.message);
  } finally {
    try { ws.sock.destroy(); } catch (e) {}
    chrome.kill();
    await sleep(300);
    try { require('fs').rmSync(path.join(process.cwd(), '.tmp-chrome-sections'), { recursive: true, force: true }); } catch (e) {}

    console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
    if (failures.length) {
      console.log('失败项:');
      failures.forEach(f => console.log('  - ' + f));
    }
    process.exit(fail === 0 ? 0 : 1);
  }
})();
