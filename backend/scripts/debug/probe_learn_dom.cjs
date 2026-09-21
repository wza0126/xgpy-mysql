/**
 * 诊断探针：学习模块锚点跳转的元素级实况
 *
 * 用途：当 verify_learn_anchor_jump.cjs 失败时，先用本脚本看清真实 DOM 结构 ——
 *   ① 页面上所有可滚动容器（学习模块里左侧目录和右侧正文都是 overflow-y-auto！）
 *   ② 讲义 .xs-lecture 的祖先链，找出真正的滚动父级
 *   ③ 锚点 / 胶囊是否存在于 DOM
 *   ④ 左侧「章」按钮的实际清单（用于修正测试脚本的章节定位逻辑）
 *
 * 用法：cd backend && node scripts/debug/probe_learn_dom.cjs
 *      XGPY_SITE=http://127.0.0.1:5199 node scripts/debug/probe_learn_dom.cjs
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const SITE = process.env.XGPY_SITE || 'http://127.0.0.1:5199';
const PORT = 9449;
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
      const i = this.buf.indexOf('\r\n\r\n');
      this.buf = this.buf.slice(i + 4);
      const u = this._onUpgrade; this._onUpgrade = null; u();
    }
    while (this.buf.length >= 2) {
      const b1 = this.buf[1];
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const p = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      try { this._onMessage(JSON.parse(p.toString('utf8'))); } catch (e) {}
    }
  }
  _onMessage(m) {
    if (m.id && this.pending.has(m.id)) {
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
    } else if (m.method && this.handlers.has(m.method)) {
      this.handlers.get(m.method).forEach(h => h(m.params));
    }
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

(async () => {
  const userDir = path.join(process.cwd(), '.tmp-chrome-probe');
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir, '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const l = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
      target = l.find(t => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(300);
  }
  if (!target) { console.error('无法连接 Chromium'); chrome.kill(); process.exit(1); }

  const ws = new WS(target.webSocketDebuggerUrl);
  await ws.connect();
  await ws.send('Runtime.enable');
  await ws.send('Page.enable');
  const ev = async (e) => {
    const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text };
    return r.result ? r.result.value : undefined;
  };

  try {
    await ws.send('Page.navigate', { url: SITE });
    await sleep(3500);
    await ev(`(async function(){
      var r = await fetch('/api/auth/secure-login', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username:'a', password:'111111'}) });
      var j = await r.json();
      var t = j.data.session.access_token;
      localStorage.setItem('xgpy_token', t);
      localStorage.setItem('xgpy_user', JSON.stringify(j.data.user));
      return !!t;
    })()`);
    await ws.send('Page.navigate', { url: SITE });
    await sleep(4500);
    await ev(`(function(){
      var all = document.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if ((all[i].textContent||'').trim() === '学习' && all[i].children.length === 0) {
          var n = all[i];
          for (var k = 0; k < 5 && n; k++) {
            n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            n.click(); n = n.parentElement;
          }
          return 'ok';
        }
      }
      return 'nf';
    })()`);
    await sleep(5000);

    console.log('--- ① 所有可滚动 div ---');
    console.log(JSON.stringify(await ev(`(function(){
      var out = [];
      var all = document.querySelectorAll('div');
      for (var i = 0; i < all.length; i++) {
        var e = all[i], cs = getComputedStyle(e);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 20) {
          var r = e.getBoundingClientRect();
          out.push({ cls: (e.className||'').toString().slice(0,80), sh: e.scrollHeight, ch: e.clientHeight,
                     top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) });
        }
      }
      return out;
    })()`), null, 1));

    console.log('\n--- ② .xs-lecture 祖先链 ---');
    console.log(JSON.stringify(await ev(`(function(){
      var x = document.querySelector('.xs-lecture');
      if (!x) return 'NO .xs-lecture';
      var r = x.getBoundingClientRect();
      var par = [], n = x.parentElement;
      for (var i = 0; i < 8 && n; i++) {
        par.push({ tag: n.tagName, cls: (n.className||'').toString().slice(0,60),
                   oy: getComputedStyle(n).overflowY, sh: n.scrollHeight, ch: n.clientHeight });
        n = n.parentElement;
      }
      return { rect: { top: Math.round(r.top), h: Math.round(r.height) }, parents: par };
    })()`), null, 1));

    console.log('\n--- ③ 锚点与胶囊 ---');
    console.log(JSON.stringify(await ev(`(function(){
      var b = document.querySelectorAll('.lp-inline-practice');
      var s = document.getElementById('sec-物联网');
      return { capsuleCount: b.length,
               first3: Array.prototype.slice.call(b, 0, 3).map(function(x){
                 return { t: (x.textContent||'').trim(), pt: x.parentElement.tagName, pid: x.parentElement.id };
               }),
               anchorFound: !!s,
               anchorTag: s ? s.tagName : '',
               anchorHTML: s ? s.outerHTML.slice(0,160) : '' };
    })()`), null, 1));

    console.log('\n--- ④ 左侧章按钮（带 chevron 的） ---');
    console.log(JSON.stringify(await ev(`(function(){
      var out = [], btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var has = btns[i].querySelector('.fa-chevron-right, .fa-chevron-down');
        if (has) out.push({ i: i, text: (btns[i].textContent||'').trim().slice(0,40),
                            chev: has.className.replace('fas ','') });
      }
      return out;
    })()`), null, 1));

    console.log('\n--- ⑤ 左侧小节按钮样本 ---');
    console.log(JSON.stringify(await ev(`(function(){
      var out = [], btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent||'').trim();
        if (btns[i].className.indexOf('text-xs') >= 0 && !btns[i].querySelector('.fa-chevron-right, .fa-chevron-down')) {
          out.push({ i: i, text: t.slice(0,40), hasTitle: !!btns[i].getAttribute('title') });
        }
      }
      return out.slice(0, 12);
    })()`), null, 1));

    console.log('\n--- ⑥ 顶部「去练习」按钮样本 ---');
    console.log(JSON.stringify(await ev(`(function(){
      var out = [], btns = document.querySelectorAll('button[title]');
      for (var i = 0; i < btns.length; i++) {
        var tt = btns[i].getAttribute('title') || '';
        if (tt.indexOf('去练习') === 0) out.push({ title: tt.slice(0,45), text: (btns[i].textContent||'').trim() });
      }
      return out.slice(0, 14);
    })()`), null, 1));
  } catch (e) {
    console.log('ERR ' + e.message);
  } finally {
    try { ws.sock.destroy(); } catch (e) {}
    chrome.kill();
    await sleep(300);
    try { require('fs').rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  }
  process.exit(0);
})();
