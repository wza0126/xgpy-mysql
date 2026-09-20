#!/usr/bin/env node
/**
 * 用本机 Chromium（CDP）渲染学习模块，做端到端视觉/结构验证。
 *
 * 不依赖 playwright：直接跑 chrome --headless --remote-debugging-port，
 * 再用最小 WebSocket 客户端调 Page.navigate / Runtime.evaluate。
 *
 * 用法：
 *   node scripts/debug/render_learn_check.cjs
 * 前提：前端 dev server 已在 5199，后端在 3101。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME = 'C:/Users/jgtty/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const PORT = 9333;
const APP = 'http://127.0.0.1:5199';
const OUT_DIR = path.resolve(__dirname, '..', '..', '..', 'docs');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 200))); } });
    }).on('error', reject);
  });
}

/** 极简 WebSocket 客户端（RFC6455，够用即可） */
class WS {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }
  async connect() {
    const u = new URL(this.url);
    const key = Buffer.from(String(Math.random())).toString('base64').slice(0, 22) + '==';
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13',
      },
    });
    return new Promise((resolve, reject) => {
      req.on('upgrade', (res, socket) => {
        this.socket = socket;
        this.buf = Buffer.alloc(0);
        socket.on('data', (chunk) => this._onData(chunk));
        socket.on('error', reject);
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  }
  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len).toString('utf8');
      this.buf = this.buf.slice(off + len);
      try {
        const msg = JSON.parse(payload);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          resolve(msg);
        } else {
          this._onEvent?.(msg);
        }
      } catch {}
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    const data = Buffer.from(JSON.stringify({ id, method, params }), 'utf8');
    const len = data.length;
    let header;
    if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0xfe; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0xff; header.writeBigUInt64BE(BigInt(len), 2); }
    const mask = Buffer.from([0, 0, 0, 0]);
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
    return new Promise((resolve) => this.pending.set(id, { resolve }));
  }
  close() { try { this.socket?.destroy(); } catch {} }
}

(async () => {
  console.log('启动 Chromium…');
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--no-sandbox', '--disable-gpu', '--window-size=1600,1000',
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'xgpy-chrome-check'),
    'about:blank',
  ], { stdio: 'ignore' });

  let version = null;
  for (let i = 0; i < 30; i++) {
    try { version = await httpJson(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(400); }
  }
  if (!version) { console.error('Chromium 启动失败'); chrome.kill(); process.exit(1); }
  console.log('Chromium:', version.Browser);

  const list = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
  const target = list.find(t => t.type === 'page');
  const ws = new WS(target.webSocketDebuggerUrl);
  await ws.connect();

  await ws.send('Page.enable');
  await ws.send('Runtime.enable');
  const logs = [];
  ws._onEvent = (msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
    }
  };

  const evaluate = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };

  // 1. 打开应用并注入登录态
  await ws.send('Page.navigate', { url: APP });
  await sleep(6000);

  console.log('\n--- 页面标题 ---');
  console.log(await evaluate('document.title'));
  console.log('--- 页面根元素 ---');
  console.log(await evaluate('document.getElementById("root") ? document.getElementById("root").childElementCount + " 个子节点" : "无 #root"'));

  // 2. 通过 dev server 的 /api 代理走同源请求（避免跨域）
  console.log('\n--- 登录接口可达（同源代理） ---');
  const loginRes = await evaluate(`(async () => {
    try {
      const r = await fetch('/api/auth/secure-login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username:'c', password:'SmokeLearn!2026', deviceInfo:'cdp-check'})
      });
      const j = await r.json();
      return 'status=' + r.status + ' hasToken=' + !!(j?.data?.session?.access_token);
    } catch(e) { return 'ERR ' + e.message; }
  })()`);
  console.log(loginRes);

  // 3. 直接验证讲义渲染（把讲义 HTML + CSS 塞进一个临时容器，检查视觉结构）
  console.log('\n--- 讲义渲染检查 ---');
  const renderCheck = await evaluate(`(async () => {
    const lr = await fetch('/api/auth/secure-login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username:'c', password:'SmokeLearn!2026', deviceInfo:'cdp-check'})
    });
    const lj = await lr.json();
    const tk = lj.data.session.access_token;
    const H = { Authorization: 'Bearer ' + tk };

    const css = await (await fetch('/api/student/learn-lecture.css')).text();
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const box = document.createElement('div'); box.id='probe'; box.style.cssText='position:fixed;inset:0;background:#fff;z-index:99999;overflow:auto;padding:20px';
    document.body.appendChild(box);
    const r = await fetch('/api/student/learn-chapter/' + encodeURIComponent('数据与信息'), { headers: H });
    const j = await r.json();
    if (!j || !j.data) return 'chapter api returned: ' + JSON.stringify(j).slice(0,200);
    box.innerHTML = j.data.html;
    await new Promise(r=>setTimeout(r,300));
    const lec = box.querySelector('.xs-lecture');
    const cs = lec ? getComputedStyle(lec) : null;
    const def = box.querySelector('.def');
    const defBg = def ? getComputedStyle(def).backgroundImage : 'none';
    const h4 = box.querySelector('h4.h');
    return JSON.stringify({
      hasLecture: !!lec,
      lectureBlueVar: cs ? cs.getPropertyValue('--blue').trim() : null,
      docBodyBg: getComputedStyle(document.body).backgroundColor,
      defCount: box.querySelectorAll('.def').length,
      warnCount: box.querySelectorAll('.warn').length,
      tableCount: box.querySelectorAll('table').length,
      h4Color: h4 ? getComputedStyle(h4).color : null,
      defHasGradient: defBg.includes('gradient'),
      textLen: box.innerText.length
    });
  })()`);
  console.log(renderCheck);

  // 3b. 章节目录接口（学生视角，带 token）
  console.log('\n--- 章节目录检查 ---');
  const listCheck = await evaluate(`(async () => {
    const lr = await fetch('/api/auth/secure-login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username:'c', password:'SmokeLearn!2026', deviceInfo:'cdp-check'})
    });
    const tk = (await lr.json()).data.session.access_token;
    const r = await fetch('/api/student/learn-chapters', { headers: { Authorization: 'Bearer ' + tk } });
    const j = await r.json();
    const chs = j?.data?.chapters || [];
    return JSON.stringify({
      count: chs.length,
      first: chs[0] ? { id: chs[0].cluster_id, code: chs[0].code, cn: chs[0].cn, secs: chs[0].sections.length, q: chs[0].question_count } : null,
      parts: [...new Set(chs.map(c=>c.part))],
      allHaveLecture: chs.every(c=>c.has_lecture),
      totalQ: chs.reduce((s,c)=>s+c.question_count,0)
    });
  })()`);
  console.log(listCheck);

  // 4. 截图
  const shot = await ws.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const shotPath = path.join(OUT_DIR, 'learn-lecture-render.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
  console.log('\n截图已保存:', shotPath);

  const errLogs = logs.filter(l => /error|Error|Warning/i.test(l));
  console.log('\n--- 控制台可疑日志 ---');
  console.log(errLogs.length ? errLogs.slice(0, 10).join('\n') : '（无）');

  ws.close();
  chrome.kill();
  await sleep(500);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
