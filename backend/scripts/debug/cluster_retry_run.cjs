/**
 * 验证「重试失败题」链路：对最近一次全量任务的失败题发起 mode=retry
 * 用法：node scripts/debug/cluster_retry_run.cjs
 */
const http = require('http');
const mysql = require('mysql2/promise');
const BASE = 'http://127.0.0.1:3101';

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(path, BASE);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch { j = { raw: buf }; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  const q = async (sql, p = []) => (await conn.query(sql, p))[0];

  const U = 'teacher', PW = 'retry_pw';
  const origHash = (await q('SELECT password_hash FROM profiles WHERE username = ?', [U]))[0].password_hash;
  await q('UPDATE profiles SET password_hash = SHA2(?,256) WHERE username = ?', [PW, U]);
  const login = await req('POST', '/api/auth/secure-login', { username: U, password: PW });
  const token = login.body?.data?.session?.access_token;
  if (!token) { console.error('登录失败'); process.exit(1); }

  const prev = (await q("SELECT id, failed_ids FROM question_cluster_tasks WHERE mode='full' ORDER BY created_at DESC LIMIT 1"))[0];
  const failedIds = JSON.parse(prev.failed_ids);
  console.log(`上一任务 ${prev.id} 失败题 ${failedIds.length} 道`);
  const before = new Map((await q('SELECT id, cluster_id, cluster_status FROM questions WHERE id IN (?)', [failedIds])).map(r => [r.id, r]));

  console.log('\n发起 mode=retry ...');
  const start = await req('POST', '/api/teacher/questions/cluster', { mode: 'retry', jobId: prev.id }, token);
  console.log(`  响应 ${start.status}:`, JSON.stringify(start.body).slice(0, 200));
  if (start.status !== 200) { console.error('启动失败'); await conn.end(); process.exit(1); }
  const jobId = start.body.data.jobId;

  let job = null;
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    const st = await req('GET', `/api/teacher/questions/cluster-status/${jobId}`, null, token);
    job = st.body?.data;
    if (job && ['completed', 'failed'].includes(job.status)) break;
  }
  console.log(`\n重试任务结果: status=${job.status} updated=${job.updated} skipped=${job.skipped}`);

  const after = await q('SELECT id, cluster_id, sub_topic, cluster_status FROM questions WHERE id IN (?)', [failedIds]);
  const { SECTION_PATHS, CHAPTER_NAMES, CHAPTER_ALLOW_SELF } = require('../../src/chapter-taxonomy');
  const secSet = new Set(SECTION_PATHS), chSet = new Set(CHAPTER_NAMES);
  console.log('\n=== 重试结果 ===');
  for (const r of after) {
    const inV = r.cluster_id === '其他' || secSet.has(r.cluster_id) || (chSet.has(r.cluster_id) && CHAPTER_ALLOW_SELF[r.cluster_id]);
    const b = before.get(r.id);
    console.log(`  ${inV ? '✓' : '✗'} [${b.cluster_status}→${r.cluster_status}] ${String(b.cluster_id).padEnd(22)} → ${r.cluster_id}`);
  }

  await q('UPDATE profiles SET password_hash = ? WHERE username = ?', [origHash, U]);
  await conn.end();
})().catch(e => { console.error('CRASH', e.message, e.stack); process.exit(1); });
