/**
 * 截图：学生端「练习」窗口的筛选设置页（用于人工确认视觉效果）
 *
 * 用法：
 *   XGPY_SITE=http://127.0.0.1:5199 node scripts/debug/shot_practice_config.cjs
 *   node scripts/debug/shot_practice_config.cjs --out docs/practice-config.png
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SITE = process.env.XGPY_SITE || 'http://127.0.0.1:3266';
const PORT = 9453;
const CHROME = process.env.XGPY_CHROME ||
  'C:/Users/jgtty/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const USER = argOf('--user', 'a');
const PASS = argOf('--pass', '111111');
const OUT = argOf('--out', path.join('docs', 'practice-config-ui.png'));
const VW = +argOf('--vw', '1400');
const VH = +argOf('--vh', '950');

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
    this.id = 0; this.pending = new Map();
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
      const p = this.pending.get(msg.id); this.pending.delete(msg.id);
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
      const payload = Buffer.from(JSON.stringify({ id, method, params }), 'utf8');
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
  "  if (t) { localStorage.setItem('xgpy_token', t); localStorage.setItem('xgpy_user', JSON.stringify(j.data.user)); }",
  "  return { ok: !!t };",
  "})()",
].join('\n');

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
  "  return 'ok';",
  "})()",
].join('\n');

/** 练窗口矩形的左上角与尺寸（用于裁剪截图） */
const WIN_RECT = [
  "(function(){",
  "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
  "  var startBtn = null;",
  "  for (var i = 0; i < btns.length; i++) { if ((btns[i].textContent||'').trim() === '开始练习') { startBtn = btns[i]; break; } }",
  "  if (!startBtn) return null;",
  "  var root = null, n = startBtn;",
  "  while (n) { if (n.style && n.style.height && parseInt(n.style.height,10) >= 200) { root = n; break; } n = n.parentElement; }",
  "  if (!root) return null;",
  "  var r = root.getBoundingClientRect();",
  "  return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16 };",
  "})()",
].join('\n');

(async () => {
  const userDir = path.join(process.cwd(), '.tmp-chrome-shot');
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir, '--no-first-run', '--no-default-browser-check',
    '--window-size=' + VW + ',' + (VH + 120), 'about:blank',
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
  await ws.send('Runtime.enable');
  await ws.send('Page.enable');
  await ws.send('Emulation.setDeviceMetricsOverride', {
    width: VW, height: VH, deviceScaleFactor: 2, mobile: false,
  });

  const evalJs = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text };
    return r.result ? r.result.value : undefined;
  };

  try {
    await ws.send('Page.navigate', { url: SITE });
    await sleep(3500);
    await evalJs(LOGIN);
    await ws.send('Page.navigate', { url: SITE });
    await sleep(4500);
    console.log('打开练习窗口: ' + await evalJs(OPEN_PRACTICE));
    await sleep(5000);

    const rect = await evalJs(WIN_RECT);
    if (!rect) throw new Error('未找到练习窗口矩形');
    console.log('窗口矩形: ' + JSON.stringify(rect));

    const shot = await ws.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
      captureBeyondViewport: true,
    });
    const outPath = path.isAbsolute(OUT) ? OUT : path.join(process.cwd(), '..', OUT);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    console.log('已保存: ' + outPath + '  (' + fs.statSync(outPath).size + ' 字节)');
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    try { ws.sock.destroy(); } catch (e) {}
    chrome.kill();
  }
})();
