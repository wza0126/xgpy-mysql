/**
 * 全量重跑题库聚类（1103 题）
 * 用法：node scripts/debug/cluster_full_run.cjs
 * 完成后打印分类分布报告。
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

  const U = 'teacher', PW = 'cluster_full_pw';
  const origHash = (await q('SELECT password_hash FROM profiles WHERE username = ?', [U]))[0].password_hash;
  await q('UPDATE profiles SET password_hash = SHA2(?,256) WHERE username = ?', [PW, U]);
  const login = await req('POST', '/api/auth/secure-login', { username: U, password: PW });
  const token = login.body?.data?.session?.access_token;
  if (!token) { console.error('登录失败', JSON.stringify(login.body)); process.exit(1); }

  const startedAt = Date.now();
  console.log('=== 发起全量重跑（mode=full）===');
  const start = await req('POST', '/api/teacher/questions/cluster', { mode: 'full' }, token);
  if (start.status !== 200) { console.error('启动失败:', JSON.stringify(start.body)); process.exit(1); }
  const jobId = start.body.data.jobId;
  console.log(`  jobId=${jobId}  total=${start.body.data.total}  batches=${start.body.data.totalBatches}`);

  let job = null, lastLine = '';
  for (let i = 0; i < 1200; i++) {
    await sleep(3000);
    const st = await req('GET', `/api/teacher/questions/cluster-status/${jobId}`, null, token);
    if (st.status !== 200) { console.warn('状态查询失败', st.status); continue; }
    job = st.body.data;
    const line = `  批次 ${job.processedBatches}/${job.totalBatches} | 成功 ${job.updated} | 失败 ${job.skipped}`;
    if (line !== lastLine) { console.log(line); lastLine = line; }
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'paused') break;
  }
  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\n=== 任务结束（用时 ${mins} 分钟）===`);
  console.log(`  status=${job.status} updated=${job.updated} skipped=${job.skipped}`);
  if (job.error) console.log(`  error=${job.error}`);

  // ---------- 分布报告 ----------
  const { SECTION_PATHS, CHAPTER_NAMES, CHAPTER_ALLOW_SELF } = require('../../src/chapter-taxonomy');
  const secSet = new Set(SECTION_PATHS), chSet = new Set(CHAPTER_NAMES);

  const rows = await q("SELECT cluster_id, COUNT(*) cnt FROM questions WHERE cluster_id IS NOT NULL AND cluster_id<>'' GROUP BY cluster_id ORDER BY cnt DESC");
  let invalid = [];
  const chapterAgg = new Map();
  for (const r of rows) {
    const cid = r.cluster_id, cnt = Number(r.cnt);
    const okFlag = cid === '其他' || secSet.has(cid) || (chSet.has(cid) && CHAPTER_ALLOW_SELF[cid]);
    if (!okFlag) invalid.push({ cid, cnt });
    const ch = cid.includes('/') ? cid.split('/')[0] : cid;
    chapterAgg.set(ch, (chapterAgg.get(ch) || 0) + cnt);
  }

  console.log('\n=== 按章分布（16 章）===');
  for (const ch of CHAPTER_NAMES) {
    const n = chapterAgg.get(ch) || 0;
    const bar = '█'.repeat(Math.round(n / 4));
    console.log(`  ${String(n).padStart(4)}  ${ch.padEnd(22)} ${bar}`);
  }
  const other = chapterAgg.get('其他') || 0;
  if (other > 0) console.log(`  ${String(other).padStart(4)}  其他`);

  console.log(`\n=== 词表合规性 ===`);
  console.log(`  词表外类目: ${invalid.length} 个，涉及 ${invalid.reduce((s, x) => s + x.cnt, 0)} 题`);
  if (invalid.length > 0) invalid.slice(0, 15).forEach(x => console.log(`    ${x.cnt} 题  ${x.cid}`));

  const covered = SECTION_PATHS.filter(sp => rows.some(r => r.cluster_id === sp));
  console.log(`  词表覆盖: ${covered.length}/${SECTION_PATHS.length} 个小节有题`);

  // 状态分布
  const stRows = await q("SELECT cluster_status, COUNT(*) n FROM questions GROUP BY cluster_status");
  console.log('\n=== cluster_status 分布 ===');
  stRows.forEach(r => console.log(`  ${r.n}  ${r.cluster_status}`));

  // 任务表落库确认
  const [trow] = await q('SELECT id, mode, status, total, updated, skipped, processed_batches, total_batches FROM question_cluster_tasks WHERE id = ?', [jobId]);
  console.log('\n=== 任务表记录 ===');
  console.log(' ', JSON.stringify(trow));

  await q('UPDATE profiles SET password_hash = ? WHERE username = ?', [origHash, U]);
  await conn.end();
  console.log('\n完成。');
})().catch(e => { console.error('CRASH', e.message, e.stack); process.exit(1); });
