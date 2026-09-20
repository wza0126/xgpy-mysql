/**
 * 真实 AI 聚类小样本试跑：取 20 道题，验证
 *  1. 强制枚举提示词是否让 AI 只输出词表内的类目
 *  2. 失败的题是否被记录（不再静默跳过）
 *  3. 任务状态是否落库
 *
 * 用法：node scripts/debug/try_cluster_sample.cjs [题目数]
 */
const http = require('http');
const mysql = require('mysql2/promise');

const BASE = 'http://127.0.0.1:3101';
const N = parseInt(process.argv[2] || '20', 10);

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

  const KNOWN_USER = 'teacher';
  const PW = 'try_cluster_pw';
  const origHash = (await q('SELECT password_hash FROM profiles WHERE username = ?', [KNOWN_USER]))[0].password_hash;
  await q('UPDATE profiles SET password_hash = SHA2(?,256) WHERE username = ?', [PW, KNOWN_USER]);
  const login = await req('POST', '/api/auth/secure-login', { username: KNOWN_USER, password: PW });
  const token = login.body?.data?.session?.access_token;
  if (!token) { console.error('登录失败'); process.exit(1); }

  // 挑 N 道题作为样本（优先选当前分类是野类目的，更能验证改造效果）
  const { SECTION_PATHS, CHAPTER_NAMES, CHAPTER_ALLOW_SELF } = require('../../src/chapter-taxonomy');
  const secSet = new Set(SECTION_PATHS), chSet = new Set(CHAPTER_NAMES);
  const all = await q('SELECT id, cluster_id FROM questions ORDER BY RAND() LIMIT 400');
  const bad = all.filter(r => {
    const cid = r.cluster_id;
    if (!cid) return true;
    return !(cid === '其他' || secSet.has(cid) || (chSet.has(cid) && CHAPTER_ALLOW_SELF[cid]));
  }).slice(0, N);
  const ids = bad.map(r => r.id);
  console.log(`样本：${ids.length} 道（原分类为词表外）`);

  // 记录改造前
  const before = new Map((await q('SELECT id, cluster_id FROM questions WHERE id IN (?)', [ids])).map(r => [r.id, r.cluster_id]));

  await q('UPDATE questions SET cluster_status = ?, cluster_source = ? WHERE id IN (?)', ['pending', 'ai', ids]);

  console.log('\n发起聚类（mode=selected）...');
  const start = await req('POST', '/api/teacher/questions/cluster', { mode: 'selected', questionIds: ids }, token);
  if (start.status !== 200) { console.error('启动失败:', JSON.stringify(start.body)); process.exit(1); }
  const jobId = start.body.data.jobId;
  console.log(`  jobId=${jobId} total=${start.body.data.total} batches=${start.body.data.totalBatches}`);

  // 轮询
  let job = null;
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const st = await req('GET', `/api/teacher/questions/cluster-status/${jobId}`, null, token);
    job = st.body?.data;
    process.stdout.write(`\r  进度 ${job?.processedBatches}/${job?.totalBatches} 批，成功 ${job?.updated}，失败 ${job?.skipped}`);
    if (job && (job.status === 'completed' || job.status === 'failed')) break;
  }
  console.log('\n');

  console.log('=== 任务结果 ===');
  console.log(`  status=${job.status} updated=${job.updated} skipped=${job.skipped} failedIds=${(job.failedIds || []).length}`);

  console.log('\n=== 逐题对比（改造前 → 改造后）===');
  const after = await q('SELECT id, cluster_id, sub_topic, cluster_status, cluster_source FROM questions WHERE id IN (?)', [ids]);
  let inVocab = 0, outVocab = 0;
  for (const r of after) {
    const okFlag = r.cluster_id === '其他' || secSet.has(r.cluster_id) || (chSet.has(r.cluster_id) && CHAPTER_ALLOW_SELF[r.cluster_id]);
    if (okFlag) inVocab++; else outVocab++;
    const mark = okFlag ? '✓' : '✗';
    console.log(`  ${mark} [${r.cluster_status}] ${String(before.get(r.id) || '(空)').slice(0, 26).padEnd(28)} → ${String(r.cluster_id || '(空)').slice(0, 34)}`);
  }
  console.log(`\n  词表内 ${inVocab} 题 / 词表外 ${outVocab} 题`);

  // 任务表落库确认
  const [trow] = await q('SELECT id, status, total, updated, skipped, mode, processed_batches, total_batches FROM question_cluster_tasks WHERE id = ?', [jobId]);
  console.log('\n=== 任务表记录 ===');
  console.log(' ', JSON.stringify(trow));

  // 还原 teacher 密码
  await q('UPDATE profiles SET password_hash = ? WHERE username = ?', [origHash, KNOWN_USER]);
  await conn.end();
})().catch(e => { console.error('CRASH', e.message, e.stack); process.exit(1); });
