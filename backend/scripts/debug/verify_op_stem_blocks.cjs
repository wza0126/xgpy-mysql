/**
 * 操作题 · 题干分块（文字块 + 视频块 + 图片块）端到端验证
 * ============================================================
 * 背景：平台上"评分步骤"是按标准答案自动生成的，措辞常与教师原题不同，
 *       而教师的演示视频/图示是按自己原题《操作步骤》做的 → 必须也能挂在题干的每一步上。
 *
 * 前置：后端跑在 3101，且已 seed 样例题（seed_wps_op_sample / seed_access_op_sample）。
 * 用法：node backend/scripts/debug/verify_op_stem_blocks.cjs
 *
 * 覆盖：教师端保存（走 PUT /api/tables/questions/:id，与前端同一条链路）→ 落库 →
 *       学生端详情按序下发 stem_blocks；空文字块 / 空视频块 / 空图片块被丢弃；
 *       重复 url 去重；视频块与图片块各按自己的 type 下发；
 *       ⛔ 仍然不泄漏 checks / grader。
 *
 * ⛔ 不留痕铁律：只改样例题的 spec/content 两个字段，跑完按原值还原，
 *    末尾断言「DB 里的 spec 与跑之前逐字节一致」。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const mysql = require('../../node_modules/mysql2/promise');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';

const CASES = [
  { kind: 'wps', id: 'wps_op_demo_popshen', field: 'wps_spec' },
  { kind: 'access', id: 'access_op_demo_winter', field: 'access_spec' },
];

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

async function api(method, p, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* 无 body */ }
  return { status: res.status, body: json };
}

async function login(username, password) {
  const r = await api('POST', '/api/auth/secure-login', { body: { username, password } });
  return r.body?.data?.session?.access_token || r.body?.data?.token || null;
}

const parse = (v) => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

/** 造一组"故意带脏数据"的题干分块：空块 / 空文字块 / 重复 url / 外链带标题 / 单 url 字段
 *  过滤后应恰好是 text,image,video,text,video,text,image,video —— 顺序断言才有意义。 */
const buildDirtyBlocks = () => ([
  { type: 'image', title: '', urls: [] },                                    // 空图片块（含前导）→ 应被丢
  { type: 'text', html: '<p>下载模板，按下列要求操作并保存。</p>' },
  { type: 'image', title: '第 1 步图示', urls: ['/uploads/op-demo/shot1.png', '/uploads/op-demo/shot1.png'] }, // 重复 → 去重
  { type: 'video', title: '第 1 步演示', urls: ['/uploads/op-demo/step1.mp4', '/uploads/op-demo/step1.mp4'] }, // 重复 → 去重
  { type: 'text', html: '<p>1. 导入外部数据到 A3:D18。</p>' },
  { type: 'text', html: '   ' },                                             // 空文字块 → 应被丢
  { type: 'video', url: 'https://cdn.example.com/step2.mp4', title: '第 2 步演示' },  // 兼容单 url 字段
  { type: 'text', html: '<p>2. 用公式计算环比增幅。</p>' },
  { type: 'image', url: 'https://cdn.example.com/chart.png' },               // 兼容单 url 字段的图片块
  { type: 'video', urls: ['https://cdn.example.com/step3.mp4'] },
]);

const RAW_COUNT = 10;
const EXPECT_TYPES = 'text,image,video,text,video,text,image,video';

(async () => {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  const origin = new Map(); // id → { content, spec 原文 }
  let teacherToken = null, stuToken = null;

  // ---------- D 段（题干图片接口）用到的临时资产 ----------
  const IMG_DIRS = {
    wps: path.join(__dirname, '../../uploads/wps-op/images'),
    access: path.join(__dirname, '../../uploads/access-op/images'),
  };
  const before = {};
  for (const k of Object.keys(IMG_DIRS)) before[k] = fs.existsSync(IMG_DIRS[k]) ? fs.readdirSync(IMG_DIRS[k]) : [];
  // 1×1 透明 PNG（临时探针用，不是业务数据）
  const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAB/AL+2w7nAAAAAElFTkSuQmCC', 'base64');

  try {
    section('A. 登录');
    teacherToken = await login('teacher', 'xgpy666');
    stuToken = await login('a', '111111');
    ok('教师登录成功', !!teacherToken);
    ok('学生 a 登录成功', !!stuToken);
    if (!teacherToken || !stuToken) throw new Error('登录失败');

    for (const c of CASES) {
      section(`B.${c.kind} 题干分块：教师保存 → 学生端下发（题目 ${c.id}）`);
      const [[row]] = await conn.query(`SELECT content, ${c.field} AS spec FROM questions WHERE id = ?`, [c.id]);
      if (!row) { ok(`样例${c.kind}题存在`, false, '找不到 ' + c.id); continue; }
      origin.set(c.id, { content: row.content, spec: row.spec });

      const origSpec = parse(row.spec) || {};
      const origStemCount = Array.isArray(origSpec.stem_blocks) ? origSpec.stem_blocks.length : 0;

      // ---- 用与前端完全相同的链路保存（PUT /api/tables/questions/:id）----
      const saved = { ...origSpec, stem_blocks: buildDirtyBlocks() };
      const putRes = await api('PUT', `/api/tables/questions/${c.id}`, { token: teacherToken, body: { [c.field]: saved } });
      ok('教师端保存 200（与前端同一条链路）', putRes.status === 200, 'status=' + putRes.status);

      const [[after]] = await conn.query(`SELECT ${c.field} AS spec FROM questions WHERE id = ?`, [c.id]);
      const dbSpec = parse(after.spec);
      ok('★ stem_blocks 已落库（JSON 可解析）', Array.isArray(dbSpec?.stem_blocks), 'n=' + (dbSpec?.stem_blocks || []).length);
      ok(`落库为原始 ${RAW_COUNT} 块（过滤发生在下发/保存时，不在这里）`,
        (dbSpec?.stem_blocks || []).length === RAW_COUNT, 'n=' + (dbSpec?.stem_blocks || []).length);

      // ---- 学生端详情 ----
      const detail = await api('GET', `/api/student/${c.kind}-op/${c.id}`, { token: stuToken });
      ok('学生端详情 200', detail.status === 200, 'status=' + detail.status);
      const spec = detail.body?.data?.spec || {};
      const blocks = spec.stem_blocks || [];
      ok('★ 学生端下发 stem_blocks', Array.isArray(spec.stem_blocks), 'n=' + blocks.length);
      ok('★ 空文字块 / 空视频块 / 空图片块已被丢弃（10 → 8）', blocks.length === 8, 'n=' + blocks.length);
      ok('★ 顺序保持：文字 → 图 → 视频 → 文字 → 视频 → 文字 → 图 → 视频',
        blocks.map((b) => b.type).join(',') === EXPECT_TYPES,
        blocks.map((b) => b.type).join(','));
      const v1 = blocks
        .filter((b) => b.type === 'video')
        .find((b) => (b.urls || []).some((u) => String(u).includes('step1.mp4')));
      ok('★ 同一块内重复 url 已去重', !!v1 && v1.urls.length === 1 && v1.url === v1.urls[0],
        JSON.stringify(v1?.urls));
      ok('★ 视频块标题保留（学生端显示"这一步演示"）', v1?.title === '第 1 步演示', String(v1?.title));
      const v3 = blocks.filter((b) => b.type === 'video').find((b) => (b.urls || []).some((u) => String(u).includes('step3.mp4')));
      ok('★ 兼容只有单 url 字段的视频块（url → urls）', !!v3 && Array.isArray(v3.urls) && v3.urls.length === 1,
        JSON.stringify(v3?.urls));

      // ---- 图片块（本次新增） ----
      const images = blocks.filter((b) => b.type === 'image');
      ok('★ 图片块按 type=image 下发（不会与视频块串台）', images.length === 2, 'n=' + images.length);
      const i1 = images.find((b) => (b.urls || []).some((u) => String(u).includes('shot1.png')));
      ok('★ 图片块 title 保留（学生端显示"第 1 步图示"）', i1?.title === '第 1 步图示', String(i1?.title));
      ok('★ 图片块重复 url 已去重', !!i1 && i1.urls.length === 1 && i1.url === i1.urls[0], JSON.stringify(i1?.urls));
      const i2 = images.find((b) => (b.urls || []).some((u) => String(u).includes('chart.png')));
      ok('★ 兼容只有单 url 字段的图片块（url → urls）', !!i2 && i2.urls.length === 1, JSON.stringify(i2?.urls));
      ok('★ 图片块不携带 url 以外的杂键（只留 type/title/url/urls）',
        images.every((b) => Object.keys(b).sort().join(',') === 'title,type,url,urls'),
        JSON.stringify(Object.keys(images[0] || {})));

      const textFirst = blocks.find((b) => b.type === 'text');
      ok('★ 文字块 HTML 原样下发', String(textFirst?.html || '').includes('下载模板'));
      ok('学生端仍拿得到原题干 content（老题兜底路径不受影响）', !!detail.body?.data?.content);

      const rawResp = JSON.stringify(detail.body);
      ok('⛔ 仍然不下发 checks（答案）', !rawResp.includes('"checks"'));
      ok('⛔ 仍然不下发 grader 口径', !rawResp.includes('"grader"'));
      ok('回归：老题在该字段下原本就没有分块（本次新增能力不影响存量）', origStemCount === 0, 'orig=' + origStemCount);
    }
    // ---------------------------------------------------------------
    section('D. 题干图片接口：本地上传 / 外链抓取 / 拒绝非图片（本次新增端点）');
    const uploadImage = async (kind, token, { name = 'tmp_probe.png', type = 'image/png', data = pngBuf } = {}) => {
      const fd = new FormData();
      fd.append('file', new Blob([data], { type }), name);
      const res = await fetch(`${BASE}/api/teacher/${kind}-op/image`, {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: fd,
      });
      let json = null;
      try { json = await res.json(); } catch { /* ignore */ }
      return { status: res.status, body: json };
    };

    for (const kind of ['wps', 'access']) {
      const r = await uploadImage(kind, teacherToken);
      ok(`[${kind}] 上传本地图片 200`, r.status === 200, 'status=' + r.status);
      const u = r.body?.data?.url || '';
      ok(`[${kind}] 图片落到本地目录且带 source=local`,
        /^\/uploads\/[a-z]+-op\/images\/img-\d+-\d+\.png$/.test(u) && r.body?.data?.source === 'local', u);
      const abs = path.join(IMG_DIRS[kind], path.basename(u));
      ok(`[${kind}] 文件真的写到了磁盘（大小一致）`,
        fs.existsSync(abs) && fs.statSync(abs).size === pngBuf.length,
        fs.existsSync(abs) ? String(fs.statSync(abs).size) : 'missing');
      const got = await fetch(BASE + u);
      ok(`[${kind}] 上传后的图片可直接访问（学生端/教师端预览走同一地址）`,
        got.status === 200 && String(got.headers.get('content-type') || '').startsWith('image/'),
        got.status + ' ' + got.headers.get('content-type'));

      // 非图片文件必须被拒（否则会把坏文件存进去，学生端显示裂图）
      const bad = await uploadImage(kind, teacherToken, { name: 'tmp_probe.txt', type: 'text/plain', data: Buffer.from('not an image') });
      ok(`[${kind}] 非图片文件被拒（400 + 明确提示）`, bad.status === 400 && /图片/.test(bad.body?.error || ''), bad.status + ' ' + (bad.body?.error || ''));
      // 未登录必须 401（新端点不能漏鉴权）
      const anon = await uploadImage(kind, null);
      ok(`[${kind}] 未登录上传图片被拒（401）`, anon.status === 401, 'status=' + anon.status);

      // 抓取：把刚落盘的图片当成"外链"抓回来（服务端 → 自己，验证整条抓取链路与落盘）
      const fr = await api('POST', `/api/teacher/${kind}-op/image/fetch`, { token: teacherToken, body: { url: BASE + u } });
      ok(`[${kind}] 抓取外链图片到本地 200`, fr.status === 200, 'status=' + fr.status + ' ' + (fr.body?.error || ''));
      ok(`[${kind}] 抓取结果带 source=fetched 与原链接`,
        fr.body?.data?.source === 'fetched' && String(fr.body?.data?.source_url || '').endsWith(u),
        String(fr.body?.data?.url || ''));
      ok(`[${kind}] 抓取的文件也真落盘`, fs.existsSync(path.join(IMG_DIRS[kind], path.basename(fr.body?.data?.url || 'x'))));
      // 抓到网页/JSON（不是图片）必须被拒
      const fr2 = await api('POST', `/api/teacher/${kind}-op/image/fetch`, { token: teacherToken, body: { url: BASE + '/api/health' } });
      ok(`[${kind}] 抓到"不是图片"的内容被拒（400 + 提示）`, fr2.status === 400 && /不是图片/.test(fr2.body?.error || ''), fr2.status + ' ' + (fr2.body?.error || ''));
      // 非法协议
      const fr3 = await api('POST', `/api/teacher/${kind}-op/image/fetch`, { token: teacherToken, body: { url: 'ftp://x/y.png' } });
      ok(`[${kind}] 非 http(s) 地址被拒（400）`, fr3.status === 400, 'status=' + fr3.status);
      // 未登录抓取必须 401
      const fr4 = await api('POST', `/api/teacher/${kind}-op/image/fetch`, { body: { url: BASE + u } });
      ok(`[${kind}] 未登录抓取图片被拒（401）`, fr4.status === 401, 'status=' + fr4.status);
    }
  } catch (e) {
    fail++;
    failures.push('脚本异常：' + e.message);
    console.error('✗ 脚本异常：', e.message);
  } finally {
    section('C. 还原与不留痕断言');
    let leak = 0;
    for (const c of CASES) {
      const o = origin.get(c.id);
      if (!o) continue;
      try {
        await conn.query(`UPDATE questions SET content = ?, ${c.field} = ? WHERE id = ?`, [o.content, o.spec, c.id]);
        const [[back]] = await conn.query(`SELECT content, ${c.field} AS spec FROM questions WHERE id = ?`, [c.id]);
        if (back.content !== o.content || back.spec !== o.spec) leak++;
      } catch (e) {
        leak++;
        console.error('还原失败', c.id, e.message);
      }
    }
    ok('⛔ 不留痕：样例题 content / spec 已逐字节还原', leak === 0, 'leak=' + leak);

    // 图片接口的临时文件：用"跑之前已有的文件清单"做差集删除
    // ⚠️ 不按运行时拿到的文件名删（异常时可能没拿到），差集才能兜住所有情况
    let imgLeak = 0;
    for (const k of Object.keys(IMG_DIRS)) {
      if (!fs.existsSync(IMG_DIRS[k])) continue;
      const known = new Set(before[k] || []);
      for (const f of fs.readdirSync(IMG_DIRS[k])) {
        if (known.has(f)) continue;
        try { fs.unlinkSync(path.join(IMG_DIRS[k], f)); } catch { /* ignore */ }
      }
      const rest = fs.readdirSync(IMG_DIRS[k]).filter((f) => !known.has(f));
      if (rest.length) { imgLeak += rest.length; console.error('残留图片：', rest); }
    }
    ok('⛔ 不留痕：题干图片接口产生的临时文件已全部删除', imgLeak === 0, 'leak=' + imgLeak);
    await conn.end();
  }

  console.log('\n========================================');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('失败项：\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('全部通过 ✅');
})();
