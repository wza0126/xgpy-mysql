#!/usr/bin/env node
/**
 * verify_op_submission_download.cjs
 * ============================================================
 * 验证「学生下载自己提交的作答文件」端点（本轮新增）：
 *   GET /api/student/wps-op/submissions/:id/file     （kind='wps'）
 *   GET /api/student/access-op/submissions/:id/file  （kind='access'）
 *
 * ⛔ 铁律：临时数据统一 __tmp_ 前缀，finally 还原，末尾断言不留痕。
 * 测试行不入 student_answers、不通过 submit 接口，直接落
 * wps_op_submissions（仅端点逻辑依赖这张表），文件放 submissions 目录。
 */
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const FIX = path.join(__dirname, 'fixtures');
const ACCDB = path.join(FIX, 'accdb_pk_sample.accdb'); // 任意非空文件即可

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(a, b, name) { ok(name, a === b, `期望 ${JSON.stringify(b)}，实为 ${JSON.stringify(a)}`); }
function section(t) { console.log(`\n=== ${t} ===`); }

async function api(method, p, { token } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

async function login(username, password) {
  const res = await fetch(BASE + '/api/auth/secure-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await res.json().catch(() => null);
  return j?.data?.session?.access_token || j?.data?.token || null;
}

const TMP_ID = '__tmp_dl_test';
(async () => {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  const stuToken = await login('a', '111111');
  const stu2Token = await login('b', '111111'); // 隔离测试用；可能不存在
  const teacherToken = await login('teacher', 'xgpy666');

  // 两个测试文件放进各自 submissions 目录
  const wpsDir = path.join(__dirname, '../../uploads/wps-op/submissions');
  const accDir = path.join(__dirname, '../../uploads/access-op/submissions');
  fs.mkdirSync(wpsDir, { recursive: true });
  fs.mkdirSync(accDir, { recursive: true });
  const wpsFile = path.join(wpsDir, '__tmp_dl_wps.xlsx');
  const accFile = path.join(accDir, '__tmp_dl_acc.accdb');
  const payload = Buffer.from(ACCDB ? fs.readFileSync(ACCDB) : 'hello-xgpy-dl-test');
  fs.writeFileSync(wpsFile, payload);
  fs.writeFileSync(accFile, payload);
  const origSha = require('crypto').createHash('sha256').update(payload).digest('hex');

  // 找一个真实学生 id（学生 a）
  const [[stu]] = await conn.query("SELECT id FROM profiles WHERE username='a' LIMIT 1");

  const inserted = [];
  async function insertSub(kind, filePath, extra = {}) {
    const id = TMP_ID + '_' + kind + '_' + Math.random().toString(36).slice(2, 8);
    await conn.query(
      `INSERT INTO wps_op_submissions
         (id, student_id, question_id, source, ref_id, file_path, original_filename, file_size, kind, score_obtained, full_score)
       VALUES (?, ?, ?, 'practice', NULL, ?, ?, ?, ?, 0, 100)`,
      [id, stu.id, extra.question_id || ('__tmp_q_' + kind), filePath, extra.name || ('tmp.' + (kind === 'wps' ? 'xlsx' : 'accdb')), payload.length, kind]);
    inserted.push(id);
    return id;
  }

  try {
    section('A. Access · 下载自己的提交');
    {
      const id = await insertSub('access', '/uploads/access-op/submissions/__tmp_dl_acc.accdb', { name: '我的冬奥答案.accdb' });
      const r = await api('GET', `/api/student/access-op/submissions/${id}/file`, { token: stuToken });
      eq(r.status, 200, 'A1 HTTP 200');
      const sha = require('crypto').createHash('sha256').update(r.buf).digest('hex');
      eq(sha, origSha, 'A2 字节一致（sha256 相同）');
      const cd = String(r.headers.get('content-disposition') || '');
      // ⚠️ Node res.download 的兜底 filename= 是 latin1（中文变 ?），但浏览器优先读
      //    RFC 5987 的 filename*=UTF-8''（百分号编码「我」= %E6%88%91），实际下载不乱码。
      ok("A3 Content-Disposition 带 filename*=UTF-8''（浏览器以此为准）",
        /filename\*=UTF-8''/.test(cd) && cd.includes('%E6%88%91'), cd.slice(0, 100));
      const ct = String(r.headers.get('content-type') || '');
      ok('A4 Content-Type 合理', /octet-stream|access|msaccess/i.test(ct), ct);
    }

    section('B. WPS · 下载自己的提交');
    {
      const id = await insertSub('wps', '/uploads/wps-op/submissions/__tmp_dl_wps.xlsx', { name: '成绩表.xlsx' });
      const r = await api('GET', `/api/student/wps-op/submissions/${id}/file`, { token: stuToken });
      eq(r.status, 200, 'B1 HTTP 200');
      const sha = require('crypto').createHash('sha256').update(r.buf).digest('hex');
      eq(sha, origSha, 'B2 字节一致');
    }

    section('C. 归属与权限隔离');
    {
      const id = await insertSub('access', '/uploads/access-op/submissions/__tmp_dl_acc.accdb');
      const other = stu2Token ? await api('GET', `/api/student/access-op/submissions/${id}/file`, { token: stu2Token }) : null;
      if (other) eq(other.status, 404, 'C1 ⛔ 别的学生下载 → 404（不暴露存在性）');
      else ok('C1 学生 b 不存在，跳过（单学生环境）', true);
      const t = await api('GET', `/api/student/access-op/submissions/${id}/file`, { token: teacherToken });
      ok('C2 ⛔ 教师不能借学生端点下载', t.status !== 200, 'HTTP ' + t.status);
      const anon = await api('GET', `/api/student/access-op/submissions/${id}/file`);
      eq(anon.status, 401, 'C3 未登录 → 401');
    }

    section('D. 路径与边界');
    {
      const trav = await insertSub('access', '/uploads/access-op/submissions/../../../src/index.js');
      const r = await api('GET', `/api/student/access-op/submissions/${trav}/file`, { token: stuToken });
      ok('D1 ⛔ 目录穿越被拒', r.status === 400 || r.status === 404, 'HTTP ' + r.status);
      const gone = await insertSub('access', '/uploads/access-op/submissions/__tmp_dl_missing.accdb');
      const r2 = await api('GET', `/api/student/access-op/submissions/${gone}/file`, { token: stuToken });
      eq(r2.status, 404, 'D2 文件不存在 → 404');
      const r3 = await api('GET', `/api/student/access-op/submissions/no-such-id/file`, { token: stuToken });
      eq(r3.status, 404, 'D3 记录不存在 → 404');
    }
  } finally {
    // ---- 还原：删临时行 + 临时文件 ----
    if (inserted.length) await conn.query('DELETE FROM wps_op_submissions WHERE id LIKE ?', [TMP_ID + '%']);
    for (const f of [wpsFile, accFile]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    // 兜底：按前缀再扫一遍
    await conn.query("DELETE FROM wps_op_submissions WHERE question_id LIKE '\\_\\_tmp\\_q%' OR id LIKE '\\_\\_tmp%'");
    try { for (const d of [wpsDir, accDir]) for (const f of fs.readdirSync(d)) if (f.startsWith('__tmp_dl')) fs.unlinkSync(path.join(d, f)); } catch { /* ignore */ }
  }

  // ---- 不留痕断言 ----
  section('E. 不留痕');
  {
    const [[n]] = await conn.query("SELECT COUNT(*) n FROM wps_op_submissions WHERE id LIKE '\\_\\_tmp%' OR question_id LIKE '\\_\\_tmp%'");
    eq(Number(n.n), 0, 'E1 数据库无临时提交行');
    const left = [];
    for (const d of [wpsDir, accDir]) { try { for (const f of fs.readdirSync(d)) if (f.startsWith('__tmp_dl')) left.push(d + '/' + f); } catch { /* dir missing ok */ } }
    eq(left.length, 0, 'E2 submissions 目录无临时文件');
  }

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) { console.log('失败项：\n  - ' + failures.join('\n  - ')); process.exitCode = 1; }
  await conn.end();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
