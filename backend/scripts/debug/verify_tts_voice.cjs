#!/usr/bin/env node
/**
 * verify_tts_voice.cjs
 * ============================================================
 * 验证「讯飞发音人可配 / 可自定义」这套改动（2026-10-21 第二轮）：
 *   1. 发音人清单由后端下发（含 group 分组），前端不再各抄一份
 *   2. 系统设置里填的自定义 vcn 能真正拿到合成结果（这是老师最关心的：
 *      填了 x4_lingbosong_bad_talk 到底有没有生效）
 *   3. 非法 vcn 被后端拦掉（防手滑 / 防乱填）
 *   4. 清单外的 vcn 也允许（讯飞没有列出发音人的接口，后台有≠这里列得全）
 *
 * 用法：node scripts/debug/verify_tts_voice.cjs [vcn]
 * 前置：后端 3101 在跑；system_config 里已填讯飞密钥。
 * ⚠️ 只合成一句 6 字，几乎不耗额度；不写库、不改配置。
 */

const path = require('path');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('../../src/env');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const TEACHER = { u: 'teacher', p: 'xgpy666' };

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
}
function section(t) { console.log(`\n【${t}】`); }

async function login(u, p) {
  const r = await fetch(`${BASE}/api/auth/secure-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  const j = await r.json().catch(() => null);
  return j?.data?.session?.access_token || null;
}

async function tts(token, body) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/teacher/explain/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const ct = r.headers.get('content-type') || '';
  const ms = Date.now() - t0;
  if (ct.includes('audio')) {
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, bytes: buf.length, ms };
  }
  const j = await r.json().catch(() => null);
  return { status: r.status, error: j?.error || '', ms };
}

(async () => {
  const token = await login(TEACHER.u, TEACHER.p);
  ok('教师登录', !!token);
  if (!token) { console.log('\n后端没在跑？'); process.exit(1); }

  section('A. 发音人清单由后端下发');
  const cfgRes = await fetch(`${BASE}/api/teacher/explain/tts/config`, { headers: { Authorization: `Bearer ${token}` } });
  const cfg = (await cfgRes.json())?.data;
  ok('tts/config 可读', cfgRes.status === 200 && !!cfg);
  ok('已配置讯飞密钥', !!cfg?.configured);
  ok('voices 非空', Array.isArray(cfg?.voices) && cfg.voices.length > 0, `${cfg?.voices?.length} 个`);
  const grouped = (cfg?.voices || []).filter((v) => v.group);
  ok('每条都带 group 分组', grouped.length === (cfg?.voices || []).length);
  const groups = Array.from(new Set((cfg?.voices || []).map((v) => v.group)));
  ok('分组 ≥3 类', groups.length >= 3, groups.join(' / '));
  console.log(`    当前保存的默认发音人：${cfg?.voice}`);

  section('B. 自定义发音人真的能用（老师填的值）');
  const custom = process.argv[2] || cfg?.voice || '';
  ok('拿到待测 vcn', !!custom, custom);
  const r1 = await tts(token, { text: '这是一句试听，我们看这道题。', voice: custom, speed: 50 });
  ok('自定义 vcn 合成成功', r1.status === 200 && r1.bytes > 1000, `status=${r1.status} ${r1.bytes || 0}B ${r1.ms}ms ${r1.error || ''}`);
  if (r1.error) console.log(`    ⚠️ 后端错误：${r1.error}`);

  section('C. 清单内的发音人（回归，确认没被改坏）');
  const r2 = await tts(token, { text: '这是一句试听。', voice: 'xiaoyan', speed: 50 });
  ok('xiaoyan 合成成功', r2.status === 200 && r2.bytes > 1000, `status=${r2.status} ${r2.bytes || 0}B ${r2.ms}ms`);
  const r2b = await tts(token, { text: '这是一句试听。', voice: 'xiaoyan', speed: 50 });
  ok('同句命中音频缓存（不重复计费）', r2b.status === 200 && r2b.ms < r2.ms, `${r2.ms}ms → ${r2b.ms}ms`);

  section('D. 非法 / 空发音人被拦');
  const r3 = await tts(token, { text: '试听', voice: 'bad vcn!' });
  ok('含空格/感叹号 → 400', r3.status === 400, `status=${r3.status} ${r3.error}`);
  const r4 = await tts(token, { text: '试听', voice: '' , speed: 50 });
  // 空 voice 会回落到配置里的默认值，属于合法行为 → 断言不是 500
  ok('空 voice 回落默认（不报 500）', r4.status !== 500, `status=${r4.status} ${r4.bytes || 0}B`);

  section('E. 清单外的 vcn 也放行（后台有、这里没有很正常）');
  const r5 = await tts(token, { text: '试听', voice: 'x4_lingxiaoxuan_test_abc', speed: 50 });
  ok('未知 vcn 不报 400（交给讯飞判定）', r5.status !== 400, `status=${r5.status} ${r5.error}`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
