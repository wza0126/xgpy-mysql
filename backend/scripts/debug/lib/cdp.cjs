/**
 * 极简 CDP（Chrome DevTools Protocol）客户端 —— 供 scripts/debug 下的**浏览器端**验证脚本复用。
 *
 * 为什么不用 puppeteer / playwright：
 *   仓库不装额外依赖，直接用 net 手撸 WebSocket 帧即可满足「连 headless Chrome → 执行 JS → 断言」。
 *
 * 【踩坑】不要用 spawnSync 起 node 自身（本机沙箱会 EBUSY）；spawn Chrome 是没问题的。
 *
 * 用法：
 *   const { launchHeadless } = require('./lib/cdp.cjs');
 *   const b = await launchHeadless({ userDataDir: '.tmp-chrome-xxx', port: 9452 });
 *   await b.evalJs('1+1');            // 在页面里跑表达式（支持 awaitPromise）
 *   b.jsErrors / b.netFails           // 期间收集的异常与 >=400 请求
 *   await b.close();                  // 关掉 Chrome
 */
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const DEFAULT_CHROME =
  process.env.XGPY_CHROME ||
  'C:/Users/jgtty/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

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
      this.sock = net.connect(this.port, this.host, () => {
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
      this.handlers.get(msg.method).forEach((h) => h(msg.params));
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

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let s = '';
      res.on('data', (d) => s += d);
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动 headless Chromium 并连上第一个 page target。
 * @returns {Promise<{ws:WS, chrome:import('child_process').ChildProcess, evalJs:Function, jsErrors:string[], netFails:string[], close:Function}>}
 */
async function launchHeadless(opts = {}) {
  const {
    chromePath = DEFAULT_CHROME,
    port = 9452,
    userDataDir,
    windowSize = '1600,1000',
    ignoreUrlRe = /favicon/i,
  } = opts;

  const args = [
    '--headless=new', '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDataDir, '--no-first-run', '--no-default-browser-check',
    '--window-size=' + windowSize, 'about:blank',
  ];
  const chrome = spawn(chromePath, args, { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await httpJson('http://127.0.0.1:' + port + '/json/list');
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(300);
  }
  if (!target) { chrome.kill(); throw new Error('无法连接 Chromium（' + chromePath + '）'); }

  const ws = new WS(target.webSocketDebuggerUrl);
  await ws.connect();

  const jsErrors = [];
  const netFails = [];
  ws.on('Network.loadingFailed', (p) => netFails.push(p.type + ' ' + p.errorText));
  ws.on('Network.responseReceived', (p) => {
    if (p.response.status >= 400 && !ignoreUrlRe.test(p.response.url)) {
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

  return {
    ws, chrome, evalJs, jsErrors, netFails, sleep,
    close: () => { try { chrome.kill(); } catch (e) {} },
  };
}

module.exports = { WS, httpJson, sleep, launchHeadless, DEFAULT_CHROME };
