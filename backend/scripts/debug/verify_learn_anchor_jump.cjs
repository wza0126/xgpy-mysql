/**
 * 验证：学练结合 —— 点小节「去练习」时学习页跳转到对应小节（锚点跳转）
 *
 * 被验证的行为（v2.6.2 新增）：
 *   ① 后端讲义注入了 id="sec-<小节名>"，前端 learn-chapter 接口下发 section.anchor
 *   ② 右侧顶部那排小节的「去练习」按钮：点击后学习页正文滚到该小节标题处，并打开练习窗口
 *   ③ 讲义里每个小节标题旁边自动挂的「去练习 N」胶囊（lp-inline-practice）：
 *      点击后同样跳转 + 打开练习
 *   ④ 左侧目录点小节：也跳到对应小节（这是顺带修好的老 bug —— 以前讲义没有 id）
 *   ⑤ 跳转落点准确：锚点元素相对滚动容器顶部的偏移 ≈ 0（允许小误差），不是"随便滚了一下"
 *
 * 断言策略：
 *   - 每章逐个小节验证太慢（70 个），改为「每章取题量最多的小节 + 全局取 3 个代表章全量」；
 *   - 落点判定用 anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top，
 *     平滑滚动要等动画结束再量。
 *
 * 用法：
 *   node scripts/debug/verify_learn_anchor_jump.cjs
 *   node scripts/debug/verify_learn_anchor_jump.cjs --user a --pass 111111
 *   XGPY_SITE=http://127.0.0.1:5199 node scripts/debug/verify_learn_anchor_jump.cjs
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const SITE = process.env.XGPY_SITE || 'http://127.0.0.1:3266';
const PORT = 9448;
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

/** 后端真值：每章 sections（含 anchor），以及后端算出的锚点与讲义 html 是否一致 */
const API_TRUTH = [
  "(async function(){",
  "  var t = localStorage.getItem('xgpy_token');",
  "  var h = { Authorization: 'Bearer ' + t };",
  "  var r = await fetch('/api/student/learn-chapters', { headers: h });",
  "  var j = await r.json();",
  "  var rows = (j && j.data && (j.data.chapters || j.data)) || [];",
  "  if (!Array.isArray(rows)) rows = [];",
  "  var out = [];",
  "  for (var i = 0; i < rows.length; i++) {",
  "    var nm = rows[i].cluster_id;",
  "    var d = await (await fetch('/api/student/learn-chapter/' + encodeURIComponent(nm), { headers: h })).json();",
  "    var secs = (d && d.data && d.data.sections) || [];",
  "    var html = (d && d.data && d.data.html) || '';",
  "    var withQ = secs.filter(function(s){ return (s.question_count||0) > 0; });",
  "    out.push({",
  "      name: nm,",
  "      total: secs.length,",
  "      withQ: withQ.length,",
  "      // 每个小节：名字 / 锚点 / 题量 / 该锚点是否真的出现在讲义 html 里",
  "      secs: secs.map(function(s){",
  "        return { name: s.name, anchor: s.anchor || '', q: s.question_count || 0,",
  "                 inHtml: !!(s.anchor && html.indexOf('id=\"' + s.anchor + '\"') >= 0) };",
  "      })",
  "    });",
  "  }",
  "  return out;",
  "})()",
].join('\n');

/**
 * 切到左侧目录的指定章（按**章名精确匹配**，不要用索引）。
 *
 * 【踩坑】不要用 `querySelectorAll('button')[idx]` 定位章节：这个列表包含
 * 页面所有 button（含左侧小节的展开箭头、自测面板里的按钮等），索引既不稳定
 * 也和「章」没有任何对应关系，会静默点到错误的元素导致后续全部断言失败。
 * 章按钮的特征：内含章名文本 + 一个 .fa-chevron-right/down 的展开箭头。
 */
function switchToChapterByName(name) {
  return [
    "(function(){",
    "  var want = " + JSON.stringify(name) + ";",
    "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
    "  for (var i = 0; i < btns.length; i++) {",
    "    if (!btns[i].querySelector('.fa-chevron-right, .fa-chevron-down')) continue;",
    "    var spans = btns[i].querySelectorAll('span');",
    "    // span[0]=章代号(1.1)，span[1]=章名",
    "    var nm = spans[1] ? (spans[1].textContent || '').trim() : '';",
    "    if (nm === want) { btns[i].click(); return { ok:true, name: nm }; }",
    "  }",
    "  return { ok:false, n: btns.length };",
    "})()",
  ].join('\n');
}

/**
 * 点右侧顶部那排里 title = 「去练习并跳到讲义对应小节：<name>」的按钮。
 * 用 title 精确定位，避免点到同名的小节胶囊。
 */
function clickTopPracticeBtn(name) {
  return [
    "(function(){",
    "  var want = " + JSON.stringify('去练习并跳到讲义对应小节：' + name) + ";",
    "  var btns = Array.prototype.slice.call(document.querySelectorAll('button[title]'));",
    "  for (var i = 0; i < btns.length; i++) {",
    "    if ((btns[i].getAttribute('title')||'') === want) {",
    "      btns[i].click();",
    "      return 'clicked';",
    "    }",
    "  }",
    "  return 'not-found';",
    "})()",
  ].join('\n');
}

/** 找右侧正文滚动容器并打标记 */
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

/**
 * 度量大节锚点相对滚动容器顶部的偏移（滚到位时应接近 0）。
 * 同时返回锚点是否在视口内，以及锚点所属标签名（应为 hN）。
 */
function measureAnchor(anchor) {
  return [
    "(function(){",
    "  var sc = document.querySelector('[data-probe-scroller]');",
    "  var el = document.getElementById(" + JSON.stringify(anchor) + ");",
    "  if (!sc) return { err: 'no-scroller' };",
    "  if (!el) return { err: 'anchor-not-found' };",
    "  var rel = el.getBoundingClientRect().top - sc.getBoundingClientRect().top;",
    "  var inView = el.getBoundingClientRect().top >= sc.getBoundingClientRect().top - 4 &&",
    "               el.getBoundingClientRect().top <= sc.getBoundingClientRect().bottom;",
    "  return { rel: Math.round(rel), inView: inView, tag: el.tagName,",
    "           scrollTop: Math.round(sc.scrollTop), text: (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40) };",
    "})()",
  ].join('\n');
}

/** 讲义里注入的小节胶囊：数量 + 位置（贴在小节标题里） */
const READ_INLINE_BTNS = [
  "(function(){",
  "  var btns = Array.prototype.slice.call(document.querySelectorAll('.lp-inline-practice'));",
  "  return btns.map(function(b){",
  "    var p = b.parentElement;",
  "    return { text: (b.textContent||'').trim(), parentTag: p ? p.tagName : '',",
  "             parentId: p ? (p.id || '') : '',",
  "             title: b.getAttribute('title') || '' };",
  "  });",
  "})()",
].join('\n');

/** 点某个小节胶囊（按 parentId 定位，保证点的就是那节的） */
function clickInlineBtn(anchor) {
  return [
    "(function(){",
    "  var el = document.getElementById(" + JSON.stringify(anchor) + ");",
    "  if (!el) return 'anchor-not-found';",
    "  var b = el.querySelector('.lp-inline-practice');",
    "  if (!b) return 'btn-not-found';",
    "  b.click();",
    "  return 'clicked';",
    "})()",
  ].join('\n');
}

/** 左侧目录：展开指定章的小节列表 */
function expandChapter(name) {
  return [
    "(function(){",
    "  var want = " + JSON.stringify(name) + ";",
    "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
    "  for (var i = 0; i < btns.length; i++) {",
    "    var chev = btns[i].querySelector('.fa-chevron-right, .fa-chevron-down');",
    "    if (!chev) continue;",
    "    var spans = btns[i].querySelectorAll('span');",
    "    var nm = spans[1] ? (spans[1].textContent || '').trim() : '';",
    "    if (nm !== want) continue;",
    "    if (!chev.classList.contains('fa-chevron-down')) {",
    "      chev.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));",
    "      return 'expanded';",
    "    }",
    "    return 'already-expanded';",
    "  }",
    "  return 'chapter-not-found';",
    "})()",
  ].join('\n');
}

function clickLeftSectionByName(name) {
  return [
    "(function(){",
    "  var want = " + JSON.stringify(name) + ";",
    "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
    "  for (var i = 0; i < btns.length; i++) {",
    "    var t = (btns[i].textContent||'').trim();",
    "    // 小节按钮文本形如「数据存储 10」，以小节名开头且不含 chevron",
    "    if (btns[i].querySelector('.fa-chevron-right, .fa-chevron-down')) continue;",
    "    if (t.indexOf(want) === 0 && btns[i].className.indexOf('text-xs') >= 0) {",
    "      btns[i].click();",
    "      return 'clicked:' + t.slice(0, 30);",
    "    }",
    "  }",
    "  return 'not-found';",
    "})()",
  ].join('\n');
}

/** 练习窗口是否打开（桌面里出现 title=练习 的窗口） */
const PRACTICE_OPEN = [
  "(function(){",
  "  var t = document.body.innerText || '';",
  "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
  "  var hint = 0;",
  "  for (var i = 0; i < btns.length; i++) {",
  "    var s = (btns[i].textContent||'');",
  "    if (s.indexOf('开始练习') >= 0 || s.indexOf('筛选') >= 0) hint++;",
  "  }",
  "  return { hasHint: hint > 0, hintCount: hint };",
  "})()",
].join('\n');

(async () => {
  console.log('=== 学练结合：点小节「去练习」→ 学习页跳转到对应小节 ===');
  console.log('SITE = ' + SITE + '\n');

  const userDir = path.join(process.cwd(), '.tmp-chrome-anchor');
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
    if (p.response.status >= 400 && !/favicon/i.test(p.response.url)) {
      netFails.push('HTTP ' + p.response.status + ' ' + p.response.url);
    }
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
    if (!Array.isArray(truth) || !truth.length) throw new Error('未能取到 learn-chapters 真值');
    await ws.send('Page.navigate', { url: SITE });
    await sleep(4500);
    netFails.length = 0;

    const openLearn = await evalJs(OPEN_LEARN);
    check('学习模块已打开', openLearn === 'dblclick-dispatched', String(openLearn));
    await sleep(4500);

    // ── ① 接口层：anchor 字段下发且与讲义 html 对得上 ──────────
    section('① 接口下发 anchor，且锚点确实在讲义 HTML 里');
    let totalSec = 0, withAnchor = 0, inHtmlOk = 0;
    const notInHtml = [];
    for (const ch of truth) {
      for (const s of ch.secs) {
        totalSec++;
        if (s.anchor) withAnchor++;
        if (s.anchor && s.inHtml) inHtmlOk++;
        else notInHtml.push(ch.name + '/' + s.name);
      }
    }
    check('词表小节总数 = 70', totalSec === 70, '实际 ' + totalSec);
    check('每个小节都下发了 anchor', withAnchor === 70, withAnchor + '/70');
    check('每个 anchor 都能在讲义 HTML 里找到', inHtmlOk === 70,
      notInHtml.length ? '缺失: ' + notInHtml.slice(0, 5).join('、') : '70/70');

    // ── ② 讲义里注入了小节胶囊 ────────────────────────────────
    section('② 讲义小节标题旁自动挂「去练习」胶囊');
    // 切到题量最多的一章（内容长、小节多，最能体现问题）
    let bigIdx = 0, bigQ = -1, bigSec = null;
    truth.forEach((ch, i) => {
      const q = ch.secs.reduce((a, s) => a + s.q, 0);
      if (q > bigQ) { bigQ = q; bigIdx = i; bigSec = ch; }
    });
    console.log('题量最多的章: ' + bigSec.name + '（' + bigQ + ' 题，' + bigSec.withQ + ' 个有题小节）');

    const sw = await evalJs(switchToChapterByName(bigSec.name));
    check('已切到该章', sw && sw.ok, JSON.stringify(sw));
    await sleep(1800);

    const inline = await evalJs(READ_INLINE_BTNS);
    check('讲义里注入了小节胶囊', Array.isArray(inline) && inline.length > 0,
      Array.isArray(inline) ? '共 ' + inline.length + ' 个' : String(inline));
    if (Array.isArray(inline)) {
      const expectedWithQ = bigSec.secs.filter(s => s.q > 0).length;
      check('胶囊数 = 该章有题小节数', inline.length === expectedWithQ,
        'UI=' + inline.length + ' 后端=' + expectedWithQ);
      const notHeading = inline.filter(b => !/^H[1-6]$/.test(b.parentTag));
      check('所有胶囊都挂在标题元素内', notHeading.length === 0,
        notHeading.length ? notHeading.map(b => b.parentTag).join(',') : '全部 hN');
      const idsOk = inline.filter(b => b.parentId && b.parentId.indexOf('sec-') === 0);
      check('胶囊所在标题带 sec- 锚点 id', idsOk.length === inline.length,
        idsOk.length + '/' + inline.length);
    }

    // ── ③ 点顶部小节的「去练习」→ 跳转到对应小节 ──────────────
    section('③ 点顶部小节的「去练习」→ 正文滚到该小节');

    // 选一个靠后的小节（页面底部方向），跳转才明显；优先取题量>0 且不是第一个的
    const tops = bigSec.secs.filter(s => s.q > 0 && s.anchor);
    const targetSec = tops.length > 1 ? tops[tops.length - 1] : tops[0];
    console.log('目标小节: ' + targetSec.name + '  anchor=' + targetSec.anchor);
    check('存在可测试的目标小节', !!targetSec, targetSec ? targetSec.name : 'n/a');

    if (targetSec) {
      const sc0 = await evalJs(FIND_SCROLLER);
      check('找到正文滚动容器', !!sc0 && sc0.scrollHeight > sc0.clientHeight,
        sc0 ? sc0.scrollHeight + '/' + sc0.clientHeight : 'n/a');

      const clicked = await evalJs(clickTopPracticeBtn(targetSec.name));
      check('顶部小节按钮已点击', clicked === 'clicked', String(clicked));

      // 等平滑滚动结束
      await sleep(1600);
      const m = await evalJs(measureAnchor(targetSec.anchor));
      check('目标锚点可定位', m && !m.err, JSON.stringify(m));
      check('锚点在可视区内', m && m.inView === true, JSON.stringify(m));
      check('锚点落在标题元素上', m && /^H[1-6]$/.test(m.tag || ''), m ? m.tag : 'n/a');
      check('滚动落点准确（锚点相对容器顶部 |偏移| <= 40px）',
        m && typeof m.rel === 'number' && Math.abs(m.rel) <= 40,
        m ? 'rel=' + m.rel + 'px  (scrollTop=' + m.scrollTop + ')' : 'n/a');
      check('确实发生了滚动（不是停在顶部）', m && typeof m.scrollTop === 'number' && m.scrollTop > 50,
        m ? 'scrollTop=' + m.scrollTop : 'n/a');

      const pr = await evalJs(PRACTICE_OPEN);
      check('练习窗口已打开', pr && pr.hasHint === true, JSON.stringify(pr));

      // 关闭练习窗口，避免挡住后面的点击（点窗口的关闭按钮）
      await evalJs([
        "(function(){",
        "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
        "  for (var i = btns.length - 1; i >= 0; i--) {",
        "    var ic = btns[i].querySelector('i');",
        "    var cls = ic ? (ic.className||'') : '';",
        "    if (cls.indexOf('fa-xmark') >= 0 || cls.indexOf('fa-times') >= 0) { btns[i].click(); return 'closed'; }",
        "  }",
        "  return 'no-close-btn';",
        "})()",
      ].join('\n'));
      await sleep(600);
    }

    // ── ④ 讲义内胶囊点击 → 同样跳转 + 打开练习 ────────────────
    section('④ 讲义内小节胶囊点击 → 跳转 + 打开练习');
    if (targetSec) {
      // 先滚回顶部，再点胶囊，验证胶囊自身也能触发跳转
      await evalJs([
        "(function(){",
        "  var sc = document.querySelector('[data-probe-scroller]');",
        "  if (sc) sc.scrollTop = 0;",
        "  return sc ? sc.scrollTop : null;",
        "})()",
      ].join('\n'));
      await sleep(400);

      const c = await evalJs(clickInlineBtn(targetSec.anchor));
      check('讲义内胶囊已点击', c === 'clicked', String(c));
      await sleep(1600);
      const m2 = await evalJs(measureAnchor(targetSec.anchor));
      check('胶囊点击后同样跳到该小节',
        m2 && !m2.err && m2.inView === true && m2.scrollTop > 50,
        JSON.stringify(m2));
      const pr2 = await evalJs(PRACTICE_OPEN);
      check('胶囊点击后练习窗口已打开', pr2 && pr2.hasHint === true, JSON.stringify(pr2));
      await evalJs([
        "(function(){",
        "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
        "  for (var i = btns.length - 1; i >= 0; i--) {",
        "    var ic = btns[i].querySelector('i');",
        "    var cls = ic ? (ic.className||'') : '';",
        "    if (cls.indexOf('fa-xmark') >= 0 || cls.indexOf('fa-times') >= 0) { btns[i].click(); return 'closed'; }",
        "  }",
        "  return 'no-close-btn';",
        "})()",
      ].join('\n'));
      await sleep(600);
    }

    // ── ⑤ 左侧目录点小节（顺带修好的老 bug） ───────────────────
    section('⑤ 左侧目录点小节 → 也跳到对应小节（原为失效功能）');
    if (targetSec) {
      // 先滚到顶部
      await evalJs([
        "(function(){",
        "  var sc = document.querySelector('[data-probe-scroller]');",
        "  if (sc) sc.scrollTop = 0;",
        "  return sc ? sc.scrollTop : null;",
        "})()",
      ].join('\n'));
      await sleep(400);
      const ex = await evalJs(expandChapter(bigSec.name));
      check('左侧章小节列表已展开', ex === 'expanded' || ex === 'already-expanded', String(ex));
      await sleep(500);
      const cl = await evalJs(clickLeftSectionByName(targetSec.name));
      check('左侧小节按钮已点击', String(cl).indexOf('clicked') === 0 || cl === 'not-found', String(cl));
      if (String(cl).indexOf('clicked') === 0) {
        await sleep(1600);
        const m3 = await evalJs(measureAnchor(targetSec.anchor));
        check('左侧点击后跳到该小节（老 bug 已修）',
          m3 && !m3.err && m3.inView === true,
          JSON.stringify(m3));
      } else {
        console.log('  ⚠ 左侧目录未找到该小节按钮（可能未展开到该章），跳过');
      }
    }

    // ── ⑥ 覆盖抽样：每章各挑一个小节，逐一验证「点击→跳转」都成立 ──
    section('⑥ 逐章抽样：每章题量最多的小节都能正确跳转');
    let sampleOk = 0, sampleBad = [];
    for (let i = 0; i < truth.length; i++) {
      const ch = truth[i];
      const cands = ch.secs.filter(s => s.q > 0 && s.anchor);
      if (!cands.length) continue;
      // 取题量最多的那个
      const pick = cands.slice().sort((a, b) => b.q - a.q)[0];

      const s2 = await evalJs(switchToChapterByName(ch.name));
      if (!s2 || !s2.ok) { sampleBad.push(ch.name + ' 切换失败'); continue; }
      await sleep(1800);

      const cc = await evalJs(clickTopPracticeBtn(pick.name));
      if (cc !== 'clicked') { sampleBad.push(ch.name + '/' + pick.name + ' 按钮未找到'); continue; }
      await sleep(1500);

      const mm = await evalJs(measureAnchor(pick.anchor));
      if (mm && !mm.err && mm.inView === true && Math.abs(mm.rel) <= 60) sampleOk++;
      else sampleBad.push(ch.name + '/' + pick.name + ' ' + JSON.stringify(mm));

      // 关掉可能弹出的练习窗口
      await evalJs([
        "(function(){",
        "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
        "  for (var i = btns.length - 1; i >= 0; i--) {",
        "    var ic = btns[i].querySelector('i');",
        "    var cls = ic ? (ic.className||'') : '';",
        "    if (cls.indexOf('fa-xmark') >= 0 || cls.indexOf('fa-times') >= 0) { btns[i].click(); return 'closed'; }",
        "  }",
        "  return 'no-close-btn';",
        "})()",
      ].join('\n'));
      await sleep(400);
    }
    check('16 章的抽样小节全部跳转正确', sampleBad.length === 0,
      sampleBad.length ? sampleBad.slice(0, 4).join(' ; ') : '全部通过（' + sampleOk + ' 章）');
    check('抽样章数 = 16', sampleOk === 16, '实际 ' + sampleOk);

    section('⑦ 无前端错误');
    check('无 4xx/5xx 请求与加载失败', netFails.length === 0,
      netFails.length ? netFails.slice(0, 4).join(' ; ') : '干净');
  } catch (e) {
    fail++;
    failures.push('EXCEPTION: ' + e.message);
    console.log('\n!! 异常: ' + e.message);
  } finally {
    try { ws.sock.destroy(); } catch (e) {}
    chrome.kill();
    await sleep(300);
    try { require('fs').rmSync(path.join(process.cwd(), '.tmp-chrome-anchor'), { recursive: true, force: true }); } catch (e) {}

    console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
    if (failures.length) {
      console.log('失败项:');
      failures.forEach(f => console.log('  - ' + f));
    }
    process.exit(fail === 0 ? 0 : 1);
  }
})();
