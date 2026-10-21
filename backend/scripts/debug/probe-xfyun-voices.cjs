/**
 * 探针：用库里已配置的讯飞密钥，逐个试合成指定发音人（vcn），
 * 输出「能用 / 未开通（11200）/ 不存在」的真实结果。
 * 用法：cd backend && node scripts/debug/probe-xfyun-voices.cjs [vcn1 vcn2 ...]
 * 不传参则跑内置候选清单。每句只合成 6 个字，几乎不耗额度。
 */
const path = require('path');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const WebSocket = require('ws');

const CANDIDATES = [
  // 标准发音人（老牌，多数账号默认有）
  'xiaoyan', 'aisjiuxu', 'aisxping', 'aisjinger', 'aisbabyxu', 'aisxqings',
  'xiaoyu', 'xiaofeng', 'xiaoqi',
  // x4 系列（音质更好，需在控制台添加试用/购买）
  'x4_xiaoyan', 'x4_lingxiaoxuan', 'x4_yezi', 'x4_lingfeizhe',
  'x4_lingbosong', 'x4_pengfei', 'x4_qianxue', 'x4_lingyuzhao',
  'x4_lingxiaoshan', 'x4_lingxiaoyue', 'x4_lingxiaochuan',
  // 方言 / 粤语 / 小语种（需单独开通，未开通报 11200）
  'x4_lingxiaowan', 'vixm', 'vixy', 'catherine', 'mary',
];

const TEXT = '这是一句试听。';

function synth({ appId, apiKey, apiSecret }, vcn) {
  const host = 'tts-api.xfyun.cn';
  const date = new Date().toUTCString();
  const origin = `host: ${host}\ndate: ${date}\nGET /v2/tts HTTP/1.1`;
  const sig = crypto.createHmac('sha256', apiSecret).update(origin).digest('base64');
  const authOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sig}"`;
  const auth = Buffer.from(authOrigin).toString('base64');
  const url = `wss://${host}/v2/tts?authorization=${encodeURIComponent(auth)}&date=${encodeURIComponent(date)}&host=${host}`;

  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    let ws;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, code: 'TIMEOUT', msg: '超时' }), 40000);
    try { ws = new WebSocket(url); } catch (e) { return done({ ok: false, code: 'WS', msg: e.message }); }
    ws.on('open', () => {
      ws.send(JSON.stringify({
        common: { app_id: appId },
        business: { aue: 'lame', sfl: 1, vcn, speed: 50, volume: 50, pitch: 50, tte: 'UTF8' },
        data: { status: 2, text: Buffer.from(TEXT, 'utf8').toString('base64') },
      }));
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.code !== 0) return done({ ok: false, code: msg.code, msg: msg.message || '' });
      if (msg.data && msg.data.audio) chunks.push(Buffer.from(msg.data.audio, 'base64'));
      if (msg.data && msg.data.status === 2) {
        const buf = Buffer.concat(chunks);
        // md5 用来识别「返回了音频但其实是同一把嗓子」（未知 vcn 会被静默回落默认音色）
        done({ ok: true, bytes: buf.length, md5: crypto.createHash('md5').update(buf).digest('hex').slice(0, 10) });
      }
    });
    ws.on('error', (e) => done({ ok: false, code: 'WSERR', msg: e.message }));
    ws.on('close', () => done({ ok: false, code: 'CLOSED', msg: '连接提前关闭' }));
  });
}

(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: '122201', database: 'xgpy' });
  const [rows] = await c.query("SELECT config_key, value FROM system_config WHERE config_key IN ('xfyun_app_id','xfyun_api_key','xfyun_api_secret')");
  const map = {};
  for (const r of rows) {
    let v = r.value;
    if (typeof v === 'string') { try { const p = JSON.parse(v); v = p && typeof p === 'object' && 'value' in p ? p.value : p; } catch { /* 原样 */ } }
    map[r.config_key] = v;
  }
  await c.end();
  const cfg = { appId: map.xfyun_app_id, apiKey: map.xfyun_api_key, apiSecret: map.xfyun_api_secret };
  if (!cfg.appId || !cfg.apiKey || !cfg.apiSecret) {
    console.error('未配置讯飞密钥，无法探针');
    process.exit(1);
  }
  const list = process.argv.slice(2).length ? process.argv.slice(2) : CANDIDATES;
  console.log(`试听文本：「${TEXT}」，共 ${list.length} 个发音人\n`);
  const okList = [];
  for (const vcn of list) {
    const t0 = Date.now();
    const r = await synth(cfg, vcn);
    const ms = Date.now() - t0;
    if (r.ok) {
      okList.push(vcn);
      console.log(`✅ ${vcn.padEnd(20)} 可用（${r.bytes} 字节, md5 ${r.md5}, ${ms}ms）`);
    } else {
      console.log(`❌ ${vcn.padEnd(20)} code=${r.code} ${r.msg}（${ms}ms）`);
    }
  }
  console.log(`\n可用 ${okList.length}/${list.length}：${okList.join(', ')}`);
})();
