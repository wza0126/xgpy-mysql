/**
 * 验证：学生端「练习」窗口筛选区的可视性优化
 *
 * 被验证的行为：
 *   ① 练习窗口默认更高（880，而不是全局默认 720），底部「开始练习」按钮无需滚动即可见
 *   ② 标签筛选：限高两行（max-h 72px = pill 32px × 2 + gap 8px），超出时容器内滚动
 *   ③ AI 聚类「一级类目」：限高四行（max-h 152px = 32 × 4 + 8 × 3），超出时容器内滚动
 *   ④ 小屏（视口高 700）下窗口高度按视口收敛，不会伸出屏幕外
 *   ⑤ 尺寸预设只登记了 practice，其他窗口仍是 850×720（回归保护）
 *
 * 行数判定：pill 都是 flex-wrap 的子项，同一行的 offsetTop 相同 → 用 offsetTop 去重计行。
 *
 * 用法：
 *   XGPY_SITE=http://127.0.0.1:5199 node scripts/debug/verify_practice_filter_ui.cjs
 *   node scripts/debug/verify_practice_filter_ui.cjs --user a --pass 111111
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SITE = process.env.XGPY_SITE || 'http://127.0.0.1:3266';
const PORT = 9451;
const CHROME = process.env.XGPY_CHROME ||
  'C:/Users/jgtty/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const USER = argOf('--user', 'a');
const PASS = argOf('--pass', '111111');

// 期望值（与源码保持一致）
const ROW_H = 32;      // px-3 py-1.5 + text-sm 的 pill 高度
const ROW_GAP = 8;     // gap-2
const EXPECT_TAG_MAXH = ROW_H * 2 + ROW_GAP;      // 72
const EXPECT_PRIMARY_MAXH = ROW_H * 4 + ROW_GAP * 3; // 152
const PRACTICE_HEIGHT = 880;
const DEFAULT_HEIGHT = 720;
const VIEWPORT_SAFE_MARGIN = 96;  // 与 WindowFrame 的 vh-96 保持一致
const MIN_H = 200;                // 与 WindowFrame 的 MIN_HEIGHT 保持一致

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

/** 双击桌面上的「练习」图标 */
const OPEN_PRACTICE = [
  "(function(){",
  "  var all = Array.prototype.slice.call(document.querySelectorAll('*'));",
  "  var leaf = null;",
  "  for (var i = 0; i < all.length; i++) {",
  "    var e = all[i];",
  "    if ((e.textContent||'').trim() === '练习' && e.children.length === 0) { leaf = e; break; }",
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

/**
 * 测量练习窗口：窗口尺寸 + 标签区/一级类目区/二级类目区的行数与滚动状态 + 开始按钮可见性。
 * 「可见」= 按钮底边不超过窗口底边（内容区滚动条在顶部时，越界即被裁切）。
 */
const PROBE = [
  "(function(){",
  "  function q(sel, ctx){ return Array.prototype.slice.call((ctx||document).querySelectorAll(sel)); }",
  "  var startBtn = null;",
  "  q('button').forEach(function(b){ if (!startBtn && (b.textContent||'').trim() === '开始练习') startBtn = b; });",
  "  if (!startBtn) return { err:'no-start-btn' };",
  // 窗口根：带内联 height 的绝对定位层（WindowFrame 的最外层）
  "  var root = null, n = startBtn;",
  "  while (n) {",
  "    if (n.style && n.style.height && parseInt(n.style.height,10) >= 200) { root = n; break; }",
  "    n = n.parentElement;",
  "  }",
  "  if (!root) return { err:'no-window-root' };",
  "  var rr = root.getBoundingClientRect();",
  // 【踩坑】标题元素要取「最后一个」匹配，不能取第一个：
  // 外层卡片 div 的 textContent 同样以「标签筛选（可选）」开头，且文档顺序更靠前，
  // 取第一个会拿到外层卡片 div 的 nextElementSibling（也就是隔壁「AI 聚类筛选」整块），量出来全错。
  // 文档顺序里越靠内层越后 → 最后一个才是标题本身。
  "  var tagBox=null, primBox=null, secBox=null;",
  "  q('label, div', root).forEach(function(e){",
  "    var t = (e.textContent||'').trim();",
  "    if (t.indexOf('标签筛选（可选）') === 0) { var s = e.nextElementSibling; if (s) tagBox = s; }",
  "    if (t === '一级类目') { var s2 = e.nextElementSibling; if (s2) primBox = s2; }",
  "    if (t.indexOf('二级类目') === 0) { var s3 = e.nextElementSibling; if (s3) secBox = s3; }",
  "  });",
  "  function info(el){",
  "    if (!el) return null;",
  "    var kids = Array.prototype.slice.call(el.children);",
  "    var tops = {};",
  "    kids.forEach(function(c){ tops[c.offsetTop] = 1; });",
  "    var cs = getComputedStyle(el);",
  "    var ph = kids.length ? Math.round(kids[0].getBoundingClientRect().height) : 0;",
  "    var rp = parseFloat(cs.rowGap) || 0;",
  "    return {",
  "      count: kids.length,",
  "      rows: Object.keys(tops).length,",
  // 【关键】rows 是「内容一共排了几行」，visibleRows 才是「限高后能看见几行」。
  // 用户要的是「显示两行/四行 + 滚动条」→ 断言该看 visibleRows，rows 必然大于它。
  "      visibleRows: (ph + rp) > 0 ? Math.floor((el.clientHeight + rp) / (ph + rp)) : 0,",
  "      pillH: ph,",
  "      rowGap: rp,",
  "      clientH: el.clientHeight,",
  "      scrollH: el.scrollHeight,",
  "      scrollable: el.scrollHeight > el.clientHeight + 1,",
  "      maxH: cs.maxHeight,",
  "      overflowY: cs.overflowY,",
  "    };",
  "  }",
  "  var br = startBtn.getBoundingClientRect();",
  "  return {",
  "    win: { h: Math.round(rr.height), w: Math.round(rr.width), top: Math.round(rr.top), bottom: Math.round(rr.bottom) },",
  "    vh: window.innerHeight,",
  "    tags: info(tagBox),",
  "    primary: info(primBox),",
  "    secondary: info(secBox),",
  "    startBtn: { top: Math.round(br.top), bottom: Math.round(br.bottom),",
  "                visible: (br.bottom <= rr.bottom + 1) && (br.top >= rr.top) },",
  "  };",
  "})()",
].join('\n');

/** 双击任意桌面图标（按图标文字） */
function openDesktopApp(label) {
  return [
    "(function(){",
    "  var want = " + JSON.stringify(label) + ";",
    "  var all = Array.prototype.slice.call(document.querySelectorAll('*'));",
    "  var leaf = null;",
    "  for (var i = 0; i < all.length; i++) {",
    "    var e = all[i];",
    "    if ((e.textContent||'').trim() === want && e.children.length === 0) { leaf = e; break; }",
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
}

/**
 * 量指定标题的窗口尺寸。
 * 定位方式：窗口标题栏里的 <span>文本 === title</span>，再向上找带内联 height 的绝对定位层。
 * （桌面图标文字同样叫「记事本」，但它的祖先链里没有带内联 height 的 absolute 层，所以不会误命中。）
 */
function probeWindowSize(title) {
  return [
    "(function(){",
    "  var want = " + JSON.stringify(title) + ";",
    "  var spans = Array.prototype.slice.call(document.querySelectorAll('span'));",
    "  var root = null;",
    "  for (var i = 0; i < spans.length; i++) {",
    "    if ((spans[i].textContent||'').trim() !== want) continue;",
    "    var n = spans[i];",
    "    while (n) {",
    "      if (n.style && n.style.height && parseInt(n.style.height,10) >= 200) { root = n; break; }",
    "      n = n.parentElement;",
    "    }",
    "    if (root) break;",
    "  }",
    "  if (!root) return null;",
    "  var r = root.getBoundingClientRect();",
    "  return { h: Math.round(r.height), w: Math.round(r.width),",
    "           bottom: Math.round(r.bottom), vh: window.innerHeight };",
    "})()",
  ].join('\n');
}

(async () => {
  console.log('=== 练习窗口筛选区可视性优化验证 ===');
  console.log('SITE = ' + SITE + '\n');

  // ── ⓪ 静态：尺寸预设只登记 practice ──────────────────────────
  section('⓪ 尺寸预设只影响 practice 窗口');
  const wfPath = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'components', 'common', 'WindowFrame.tsx');
  let wfSrc = '';
  try { wfSrc = fs.readFileSync(wfPath, 'utf8'); } catch (e) { }
  check('能读到 WindowFrame.tsx', !!wfSrc, wfSrc ? String(wfSrc.length) + ' 字节' : 'n/a');
  if (wfSrc) {
    // 注意：必须锚定 `const WINDOW_SIZE_PRESET`。
    // 只写 WINDOW_SIZE_PRESET 会先在**注释**里命中（DEFAULT_WINDOW_SIZE 上方那句注释含该词），
    // 导致把 DEFAULT_WINDOW_SIZE 的对象体当成 preset 体。
    const m = wfSrc.match(/const WINDOW_SIZE_PRESET[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
    const body = m ? m[1] : '';
    check('WINDOW_SIZE_PRESET 里登记了 practice', /practice\s*:/.test(body), body.replace(/\s+/g, ' ').trim().slice(0, 80));
    const keys = (body.match(/^\s*([A-Za-z_$][\w$]*)\s*:/gm) || []).map(s => s.trim().replace(':', ''));
    check('除 practice 外没有其他窗口被定制', keys.length === 1 && keys[0] === 'practice', 'keys=' + JSON.stringify(keys));
    check('默认尺寸仍是 850×720', /DEFAULT_WINDOW_SIZE\s*=\s*\{\s*width:\s*850,\s*height:\s*720\s*\}/.test(wfSrc));
  }

  const userDir = path.join(process.cwd(), '.tmp-chrome-practice-ui');
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
  const jsErrors = [];
  ws.on('Network.loadingFailed', (p) => netFails.push(p.type + ' ' + p.errorText));
  ws.on('Network.responseReceived', (p) => {
    if (p.response.status >= 400 && !/favicon/i.test(p.response.url)) {
      netFails.push('HTTP ' + p.response.status + ' ' + p.response.url);
    }
  });
  ws.on('Runtime.exceptionThrown', (p) => {
    jsErrors.push((p.exceptionDetails && p.exceptionDetails.text) || 'exception');
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

    await ws.send('Page.navigate', { url: SITE });
    await sleep(4500);
    netFails.length = 0;

    const opened = await evalJs(OPEN_PRACTICE);
    check('练习窗口已打开', opened === 'dblclick-dispatched', String(opened));
    await sleep(4500);

    // ── ① 窗口高度 ────────────────────────────────────────────
    section('① 练习窗口按预设加高');
    let m = await evalJs(PROBE);
    check('能测量到练习窗口', m && !m.err, JSON.stringify(m && m.err ? m : '').slice(0, 60));
    if (!m || m.err) throw new Error('测量失败: ' + JSON.stringify(m));
    console.log('  视口高 = ' + m.vh + '，窗口 = ' + m.win.w + '×' + m.win.h + '  (top=' + m.win.top + ', bottom=' + m.win.bottom + ')');

    const expected = Math.min(PRACTICE_HEIGHT, Math.max(200, m.vh - VIEWPORT_SAFE_MARGIN));
    check('窗口高度 = min(880, 视口高-96)', Math.abs(m.win.h - expected) <= 2,
      '实际 ' + m.win.h + '，期望 ' + expected);
    check('窗口确实比全局默认 720 更高', m.win.h > DEFAULT_HEIGHT || m.vh - VIEWPORT_SAFE_MARGIN < DEFAULT_HEIGHT,
      '实际 ' + m.win.h + ' vs 默认 ' + DEFAULT_HEIGHT);
    check('窗口底边不超出视口', m.win.bottom <= m.vh, 'bottom=' + m.win.bottom + ', vh=' + m.vh);

    // ── ② 标签筛选：两行 + 滚动条 ──────────────────────────────
    section('② 标签筛选限高两行并可滚动');
    const tags = m.tags;
    check('找到标签筛选容器', !!tags, tags ? tags.count + ' 个标签' : 'n/a');
    if (tags) {
      console.log('  标签: 共 ' + tags.count + ' 个，内容排 ' + tags.rows + ' 行（可见 ' + tags.visibleRows +
        ' 行），pill=' + tags.pillH + 'px，gap=' + tags.rowGap + 'px，clientH=' + tags.clientH + '，scrollH=' + tags.scrollH);
      check('能测到标签 pill', tags.count > 0 && tags.pillH > 0, tags.count + ' 个，pill=' + tags.pillH + 'px');
      check('可见行数 ≤ 2', tags.visibleRows <= 2,
        '可见 ' + tags.visibleRows + ' 行（内容共 ' + tags.rows + ' 行）');
      check('容器可见高度 ≤ 两行（72px）', tags.clientH <= EXPECT_TAG_MAXH + 1,
        'clientH=' + tags.clientH + '（上限 ' + EXPECT_TAG_MAXH + '）');
      check('内容超两行时，可见高度正好卡在两行', tags.rows <= 2 || tags.clientH === EXPECT_TAG_MAXH,
        'rows=' + tags.rows + ', clientH=' + tags.clientH);
      check('max-height 已生效（72px）', tags.maxH === EXPECT_TAG_MAXH + 'px', 'maxH=' + tags.maxH);
      check('容器允许纵向滚动', tags.overflowY === 'auto', 'overflowY=' + tags.overflowY);
      check('内容溢出时确实出现滚动条', tags.rows <= 2 || tags.scrollH > tags.clientH,
        'scrollH=' + tags.scrollH + ' / clientH=' + tags.clientH);
    }

    // ── ③ 一级类目：四行 + 滚动条 ──────────────────────────────
    section('③ 一级类目限高四行并可滚动');
    const prim = m.primary;
    check('找到一级类目容器', !!prim, prim ? prim.count + ' 个一级类目' : 'n/a');
    if (prim) {
      console.log('  一级类目: 共 ' + prim.count + ' 个，内容排 ' + prim.rows + ' 行（可见 ' + prim.visibleRows +
        ' 行），clientH=' + prim.clientH + '，scrollH=' + prim.scrollH + '，maxH=' + prim.maxH);
      check('可见行数 ≤ 4', prim.visibleRows <= 4,
        '可见 ' + prim.visibleRows + ' 行（内容共 ' + prim.rows + ' 行）');
      check('容器可见高度 ≤ 四行（152px）', prim.clientH <= EXPECT_PRIMARY_MAXH + 1,
        'clientH=' + prim.clientH + '（上限 ' + EXPECT_PRIMARY_MAXH + '）');
      check('内容超四行时，可见高度正好卡在四行', prim.rows <= 4 || prim.clientH === EXPECT_PRIMARY_MAXH,
        'rows=' + prim.rows + ', clientH=' + prim.clientH);
      check('max-height 已生效（152px）', prim.maxH === EXPECT_PRIMARY_MAXH + 'px', 'maxH=' + prim.maxH);
      check('容器允许纵向滚动', prim.overflowY === 'auto', 'overflowY=' + prim.overflowY);
      check('一级类目数量不少于 4 个（确有滚动意义）', prim.count >= 4, '共 ' + prim.count + ' 个');
      check('超出四行时出现滚动条', prim.rows <= 4 || prim.scrollH > prim.clientH,
        'scrollH=' + prim.scrollH + ' / clientH=' + prim.clientH);
    }

    // ── ④ 开始按钮无需滚动即可见 ───────────────────────────────
    section('④ 底部「开始练习」按钮无需滚动即可见');
    check('开始按钮在窗口可视区内', m.startBtn && m.startBtn.visible === true,
      'btn bottom=' + (m.startBtn && m.startBtn.bottom) + ', 窗口 bottom=' + m.win.bottom);
    check('按钮在窗口下半部（确实是被"挤出去"的那个元素）',
      m.startBtn && m.startBtn.top > m.win.top + m.win.h * 0.4,
      m.startBtn ? 'btn top=' + m.startBtn.top + ' 窗口 top=' + m.win.top : 'n/a');

    // ── ④b 其他窗口仍是默认尺寸（回归保护）────────────────────
    // 尺寸预设挂在 WindowFrame（所有窗口共用），必须确认只有 practice 变了。
    section('④b 其他窗口仍用全局默认 850×720');
    const otherOpened = await evalJs(openDesktopApp('记事本'));
    check('已打开「记事本」窗口', otherOpened === 'dblclick-dispatched', String(otherOpened));
    await sleep(2500);
    const other = await evalJs(probeWindowSize('记事本'));
    check('能测到记事本窗口', !!other, JSON.stringify(other));
    if (other) {
      const expOther = Math.min(DEFAULT_HEIGHT, Math.max(MIN_H, other.vh - VIEWPORT_SAFE_MARGIN));
      console.log('  记事本窗口 = ' + other.w + '×' + other.h + '（期望 ' + expOther + '）');
      check('记事本窗口仍是默认宽 850', other.w === 850, '实际 ' + other.w);
      check('记事本窗口仍是默认高 720（未被 practice 的高度带偏）',
        other.h === expOther && other.h !== m.win.h,
        '实际 ' + other.h + ' vs 练习窗口 ' + m.win.h);
    }

    // ── ⑤ 小屏视口下高度收敛 ────────────────────────────────────
    section('⑤ 小屏（视口高 700）下窗口不伸出屏幕');
    await ws.send('Emulation.setDeviceMetricsOverride', {
      width: 1366, height: 700, deviceScaleFactor: 1, mobile: false,
    });
    await ws.send('Page.navigate', { url: SITE });
    await sleep(4500);
    const opened2 = await evalJs(OPEN_PRACTICE);
    check('小屏下练习窗口已打开', opened2 === 'dblclick-dispatched', String(opened2));
    await sleep(4500);
    m = await evalJs(PROBE);
    check('小屏下仍能测量', m && !m.err, JSON.stringify(m && m.err ? m : '').slice(0, 60));
    if (m && !m.err) {
      const exp2 = Math.min(PRACTICE_HEIGHT, Math.max(200, m.vh - VIEWPORT_SAFE_MARGIN));
      console.log('  视口高 = ' + m.vh + '，窗口高 = ' + m.win.h + '（期望 ' + exp2 + '）');
      check('窗口高度被视口钳制', Math.abs(m.win.h - exp2) <= 2, '实际 ' + m.win.h + ' vs ' + exp2);
      check('窗口底边不超出视口', m.win.bottom <= m.vh, 'bottom=' + m.win.bottom + ' vs vh=' + m.vh);
    }
    await ws.send('Emulation.clearDeviceMetricsOverride');

    // ── ⑥ 无前端错误 ───────────────────────────────────────────
    section('⑥ 无前端错误');
    check('无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | ') || 'clean');
    const realFails = netFails.filter(f => !/favicon/i.test(f));
    check('无致命网络失败', realFails.length === 0, realFails.slice(0, 3).join(' | ') || 'clean');

  } catch (e) {
    console.error('\n运行异常: ' + (e && e.message ? e.message : e));
    fail++;
    failures.push('运行异常: ' + (e && e.message ? e.message : e));
  } finally {
    try { ws.sock.destroy(); } catch (e) {}
    chrome.kill();
  }

  console.log('\n=== 汇总：' + pass + '/' + (pass + fail) + ' 通过 ===');
  if (failures.length) console.log('失败项：\n  - ' + failures.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
