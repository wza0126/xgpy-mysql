/**
 * 诊断：学习模块「去练习这一章」打开练习窗口空白 + 学习模块无内容
 *
 * 用 CDP 直连真实 Chromium：
 *   1. 打开 dev 站点 → 登录 → 进学习模块
 *   2. 收集控制台错误 / 失败的网络请求
 *   3. 检查学习模块目录与讲义是否渲染
 *   4. 点「去练习这一章」→ 检查练习窗口是否空白
 *
 * 用法：node scripts/debug/diag_learn_practice.cjs
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SITE = process.env.XGPY_SITE || 'http://127.0.0.1:3266';
const PORT = 9444;
const CHROME = process.env.XGPY_CHROME ||
  'C:/Users/jgtty/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

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

// ---- 极简 WebSocket 客户端（只支持客户端发文本帧 + 收文本帧） ----
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
          `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        );
      });
      this.sock.on('error', reject);
      this.sock.on('data', (d) => this._onData(d));
      const onUp = () => resolve();
      this._onUpgrade = onUp;
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
    // 解析帧
    while (this.buf.length >= 2) {
      const b1 = this.buf[1];
      let len = b1 & 0x7f; let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      try { this._onMessage(JSON.parse(payload.toString('utf8'))); } catch {}
    }
  }
  _onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method && this.handlers.has(msg.method)) {
      this.handlers.get(msg.method).forEach(h => h(msg.params));
    }
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    const data = Buffer.from(JSON.stringify({ id, method, params }), 'utf8');
    const mask = require('crypto').randomBytes(4);
    let header;
    if (data.length < 126) { header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | data.length; mask.copy(header, 2); }
    else if (data.length < 65536) { header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); mask.copy(header, 4); }
    else { header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2); mask.copy(header, 10); }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([header, masked]));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

(async () => {
  const userDir = path.join(process.cwd(), '.tmp-chrome-diag');
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40; i++) {
    try { const list = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
      target = list.find(t => t.type === 'page'); if (target) break; } catch {}
    await sleep(300);
  }
  if (!target) { console.error('无法连接 Chromium'); chrome.kill(); process.exit(1); }

  const ws = new WS(target.webSocketDebuggerUrl);
  await ws.connect();
  const consoleLogs = [];
  const netFails = [];
  ws.on('Runtime.consoleAPICalled', (p) => {
    consoleLogs.push(`[${p.type}] ${(p.args || []).map(a => a.value ?? a.description ?? a.type).join(' ')}`);
  });
  ws.on('Runtime.exceptionThrown', (p) => {
    consoleLogs.push(`[EXCEPTION] ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`);
  });
  ws.on('Network.loadingFailed', (p) => netFails.push(`${p.type} ${p.errorText} ${p.requestId}`));
  ws.on('Network.responseReceived', (p) => {
    if (p.response.status >= 400) netFails.push(`HTTP ${p.response.status} ${p.response.url}`);
  });

  await ws.send('Runtime.enable');
  await ws.send('Network.enable');
  await ws.send('Page.enable');

  const evalJs = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  // 1) 打开站点
  await ws.send('Page.navigate', { url: SITE });
  await sleep(3500);

  // 2) 登录
  const loginRes = await evalJs(`(async () => {
    const r = await fetch('/api/auth/secure-login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username:'a', password:'111111'})
    });
    const j = await r.json();
    const t = j?.data?.session?.access_token;
    if (t) { localStorage.setItem('xgpy_token', t);
             localStorage.setItem('xgpy_user', JSON.stringify(j.data.user)); }
    return { ok: !!t, err: j?.error || null };
  })()`);
  console.log('登录结果:', JSON.stringify(loginRes));
  await sleep(500);

  // 3) 重载进桌面
  await ws.send('Page.navigate', { url: SITE });
  await sleep(4500);

  consoleLogs.length = 0; netFails.length = 0;

  // 4) 打开学习模块（桌面图标是双击）
  const openLearn = await evalJs(`(async () => {
    const all = [...document.querySelectorAll('*')];
    // 找到文案恰为「学习」的最深层元素，再冒泡到可点击的图标容器
    let leaf = null;
    for (const e of all) {
      if ((e.textContent||'').trim() === '学习' && e.children.length === 0) { leaf = e; break; }
    }
    if (!leaf) return 'leaf-not-found';
    let node = leaf;
    for (let i = 0; i < 5 && node; i++) {
      node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
      node.click();
      node = node.parentElement;
    }
    return 'dblclick-dispatched';
  })()`);
  console.log('打开学习模块:', openLearn);
  await sleep(4000);

  // 5) 探查学习模块 DOM
  const learnState = await evalJs(`(() => {
    const flush = [...document.querySelectorAll('*')].filter(e => (e.textContent||'').includes('考点精讲'));
    const leftItems = [...document.querySelectorAll('button')].filter(b => /必修|数据与信息|数据编码/.test(b.textContent||''));
    return {
      hasLectureCss: !!document.getElementById('xs-lecture-css'),
      lectureCssLen: (document.getElementById('xs-lecture-css')||{}).textContent?.length || 0,
      hasTitle: flush.length > 0,
      chapterBtns: leftItems.length,
      sampleTexts: leftItems.slice(0,5).map(b => (b.textContent||'').trim().slice(0,30)),
      bodyTextLen: document.body.innerText.length,
      bodySnippet: document.body.innerText.slice(0, 300),
    };
  })()`);
  console.log('学习模块状态:', JSON.stringify(learnState, null, 2));

  // 6) 点「去练习这一章」
  const clickPractice = await evalJs(`(async () => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('去练习这一章'));
    if (b) { b.click(); return 'clicked'; }
    return 'not-found';
  })()`);
  console.log('点击去练习:', clickPractice);
  await sleep(3000);

  const practiceState = await evalJs(`(() => {
    const txt = document.body.innerText;
    return {
      practiceWindowExists: txt.includes('练习'),
      hasConfigPanel: txt.includes('章节') || txt.includes('聚类') || txt.includes('设置'),
      bodyTextLen: txt.length,
      tailSnippet: txt.slice(-600),
    };
  })()`);
  console.log('练习窗口状态:', JSON.stringify(practiceState, null, 2));

  console.log('\n=== 控制台输出 ===');
  consoleLogs.slice(-40).forEach(l => console.log(l));
  console.log('\n=== 失败请求 ===');
  [...new Set(netFails)].slice(0, 30).forEach(l => console.log(l));

  ws.sock.destroy();
  chrome.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
