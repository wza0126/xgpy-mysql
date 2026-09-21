/**
 * 诊断：切章后讲义胶囊与锚点是否出现（含等待重试）
 * 用法：cd backend && XGPY_SITE=http://127.0.0.1:5199 node scripts/debug/probe_switch_chapter.cjs
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const SITE = process.env.XGPY_SITE || 'http://127.0.0.1:5199';
const PORT = 9450;
const CHROME = process.env.XGPY_CHROME ||
  'C:/Users/jgtty/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
class WS {
  constructor(url) {
    const m = url.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    this.host = m[1]; this.port = +m[2]; this.path = m[3];
    this.buf = Buffer.alloc(0); this.handlers = new Map(); this.id = 0; this.pending = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      const key = Buffer.from(Math.random().toString(36)).toString('base64');
      this.sock = require('net').connect(this.port, this.host, () => {
        this.sock.write('GET ' + this.path + ' HTTP/1.1\r\nHost: ' + this.host + ':' + this.port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      this.sock.on('error', reject); this.sock.on('data', d => this._onData(d)); this._onUpgrade = () => resolve();
    });
  }
  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this._onUpgrade && this.buf.includes('\r\n\r\n')) { const i = this.buf.indexOf('\r\n\r\n'); this.buf = this.buf.slice(i + 4); const u = this._onUpgrade; this._onUpgrade = null; u(); }
    while (this.buf.length >= 2) {
      const b1 = this.buf[1]; let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const p = this.buf.slice(off, off + len); this.buf = this.buf.slice(off + len);
      try { this._onMessage(JSON.parse(p.toString('utf8'))); } catch (e) {}
    }
  }
  _onMessage(m) {
    if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); }
    else if (m.method && this.handlers.has(m.method)) this.handlers.get(m.method).forEach(h => h(m.params));
  }
  send(method, params) {
    params = params || {}; const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const json = JSON.stringify({ id, method, params }); const payload = Buffer.from(json, 'utf8'); const len = payload.length;
      let header;
      if (len < 126) { header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | len; }
      else if (len < 65536) { header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
      else { header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
      const mask = Buffer.from([1, 2, 3, 4]); mask.copy(header, header.length - 4);
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
      this.sock.write(Buffer.concat([header, masked]));
    });
  }
}

/** 按章名精确点击左侧章按钮 */
function clickChapterByName(name) {
  return [
    "(function(){",
    "  var want = " + JSON.stringify(name) + ";",
    "  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));",
    "  for (var i = 0; i < btns.length; i++) {",
    "    if (!btns[i].querySelector('.fa-chevron-right, .fa-chevron-down')) continue;",
    "    var code = btns[i].querySelector('span');",
    "    var span = btns[i].querySelectorAll('span');",
    "    var nm = span[1] ? (span[1].textContent||'').trim() : '';",
    "    if (nm === want) { btns[i].click(); return 'clicked:' + nm; }",
    "  }",
    "  return 'not-found';",
    "})()",
  ].join('\n');
}

const SNAPSHOT = [
  "(function(){",
  "  var caps = document.querySelectorAll('.lp-inline-practice');",
  "  var anchors = document.querySelectorAll('[id^=\"sec-\"]');",
  "  var cur = '';",
  "  var h1 = document.querySelector('h1');",
  "  if (h1) cur = (h1.textContent||'').trim();",
  "  return { chapter: cur, capsules: caps.length, anchors: anchors.length,",
  "           firstAnchorId: anchors.length ? anchors[0].id : '',",
  "           firstAnchorTag: anchors.length ? anchors[0].tagName : '' };",
  "})()",
].join('\n');

(async () => {
  const userDir = path.join(process.cwd(), '.tmp-chrome-switch');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, '--no-first-run', '--no-default-browser-check', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 40; i++) { try { const l = await httpJson('http://127.0.0.1:' + PORT + '/json/list'); target = l.find(t => t.type === 'page'); if (target) break; } catch (e) {} await sleep(300); }
  if (!target) { console.error('无法连接 Chromium'); chrome.kill(); process.exit(1); }
  const ws = new WS(target.webSocketDebuggerUrl);
  await ws.connect();
  await ws.send('Runtime.enable'); await ws.send('Page.enable');
  const ev = async (e) => { const r = await ws.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.text }; return r.result ? r.result.value : undefined; };

  try {
    await ws.send('Page.navigate', { url: SITE }); await sleep(3500);
    await ev(`(async function(){var r=await fetch('/api/auth/secure-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'a',password:'111111'})});var j=await r.json();localStorage.setItem('xgpy_token',j.data.session.access_token);localStorage.setItem('xgpy_user',JSON.stringify(j.data.user));return true})()`);
    await ws.send('Page.navigate', { url: SITE }); await sleep(4500);
    await ev(`(function(){var all=document.querySelectorAll('*');for(var i=0;i<all.length;i++){if((all[i].textContent||'').trim()==='学习'&&all[i].children.length===0){var n=all[i];for(var k=0;k<5&&n;k++){n.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));n.click();n=n.parentElement}return 'ok'}}return 'nf'})()`);
    await sleep(5000);

    console.log('初始:', JSON.stringify(await ev(SNAPSHOT)));

    for (const ch of ['信息系统的支撑技术', '数据编码', '函数及其应用']) {
      const c = await ev(clickChapterByName(ch));
      console.log(`\n切到「${ch}」-> ${c}`);
      for (let t = 0; t < 6; t++) {
        await sleep(700);
        const s = await ev(SNAPSHOT);
        if (s && s.capsules > 0) { console.log(`  t=${(t + 1) * 700}ms  ` + JSON.stringify(s)); break; }
        if (t === 5) console.log('  超时仍未出现胶囊:', JSON.stringify(s));
      }
    }

    console.log('\n--- 目标章（信息系统的支撑技术）详情 ---');
    await ev(clickChapterByName('信息系统的支撑技术'));
    await sleep(2500);
    console.log(JSON.stringify(await ev(`(function(){
      var caps = Array.prototype.slice.call(document.querySelectorAll('.lp-inline-practice'));
      var el = document.getElementById('sec-物联网');
      return {
        capsules: caps.length,
        list: caps.map(function(b){ return { t:(b.textContent||'').trim(), pid:(b.parentElement||{}).id || '' }; }),
        wulianwangFound: !!el,
        wulianwangTag: el ? el.tagName : '',
        wulianwangHTML: el ? el.outerHTML.slice(0,150) : ''
      };
    })()`), null, 1));
  } catch (e) { console.log('ERR ' + e.message); }
  finally { try { ws.sock.destroy(); } catch (e) {} chrome.kill(); await sleep(300); try { require('fs').rmSync(userDir, { recursive: true, force: true }); } catch (e) {} }
  process.exit(0);
})();
