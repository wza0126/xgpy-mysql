/**
 * 专项验证：v2.5.2 改动后，数据管理「导入导出」对 learn_visited_records 的保真
 *
 * 背景：083 迁移把 learn_visited_records.question_key 从 varchar(50) 改为 varchar(80)。
 * 本脚本证明：
 *   1. 导出包内该表数据完整（含最长 key）；
 *   2. 覆盖导入后行数、内容逐一保真；
 *   3. learning 域在导出元信息里正常列出该表；
 *   4. 长 key（接近 80）不会被截断。
 *
 * 用法：先启动后端（node src/index.js），再
 *   node scripts/debug/verify_data_io_learn_visited.cjs
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const yauzl = require('yauzl');

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' };
const TMP = path.join(__dirname, 'tmp-dio-learn');
const TABLE = 'learn_visited_records';

const failures = [];
let passed = 0;
const assert = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${extra ? ' | ' + extra : ''}`); console.log(`  FAIL  ${name} ${extra}`); }
};

async function api(p, opts = {}) {
  const res = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.headers || {}) },
    body: opts.body,
  });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, json, res };
}

function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    try {
      if (ent.isDirectory()) { cleanDir(full); fs.rmdirSync(full); }
      else fs.unlinkSync(full);
    } catch (e) {}
  }
}

/** 从 zip 里读出某条目文本 */
function readZipEntry(zipPath, entryName) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('entry', (entry) => {
        if (entry.fileName === entryName) {
          zip.openReadStream(entry, (e, rs) => {
            if (e) return reject(e);
            let s = '';
            rs.on('data', d => s += d);
            rs.on('end', () => { zip.close(); resolve(s); });
          });
        } else zip.readEntry();
      });
      zip.on('end', () => resolve(null));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

/** 下载导出包到本地（导出是 GET + query 参数） */
async function downloadExport(auth, { domains, file_mode = 'full', exclude = '' }) {
  const qs = new URLSearchParams();
  qs.set('domains', domains.join(','));
  qs.set('file_mode', file_mode);
  if (exclude) qs.set('exclude', exclude);
  const res = await fetch(BASE + '/api/admin/data-io/export?' + qs.toString(), {
    method: 'GET',
    headers: { ...auth },
  });
  if (res.status !== 200) throw new Error('导出失败 HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const p = path.join(TMP, 'export-' + Date.now() + '.xgpybak');
  fs.writeFileSync(p, buf);
  return p;
}

(async () => {
  cleanDir(TMP);
  fs.mkdirSync(TMP, { recursive: true });

  const conn = await mysql.createConnection(DB);
  const rawToken = 'vdio_' + crypto.randomBytes(16).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const teacherId = 'vdio_teacher';
  const AUTH = { Authorization: 'Bearer ' + rawToken };
  const markerStudent = 'vdio_marker_student_' + Date.now();

  try {
    // ---- 准备：冒烟教师 + 会话 ----
    await conn.query(
      `INSERT INTO profiles (id, username, password_hash, role, real_name) VALUES (?, ?, '', 'teacher', '导入导出专项')
       ON DUPLICATE KEY UPDATE role='teacher'`,
      [teacherId, 'vdio_teacher']
    );
    await conn.query(
      `INSERT INTO login_sessions (id, user_id, token, device_info, ip_address, created_at, last_active_at, expires_at, is_active)
       VALUES (?, ?, ?, 'vdio', '127.0.0.1', NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), 1)`,
      ['vdio_sess_' + Date.now(), teacherId, tokenHash]
    );

    console.log('\n=== 1. 导出元信息：learning 域必须含 learn_visited_records ===');
    const meta = await api('/api/admin/data-io/meta', { headers: AUTH });
    assert('meta 接口 200', meta.status === 200, 'status=' + meta.status);
    const domains = meta.json?.data?.domains || [];
    const learning = domains.find(d => d.id === 'learning');
    assert('存在 learning 域', !!learning);
    const tbl = learning?.tables?.find(t => t.table === TABLE);
    assert('learning 域列出 ' + TABLE, !!tbl, JSON.stringify(learning?.tables?.map(t => t.table)));
    const liveCount = tbl?.rows;
    console.log(`      live rows = ${liveCount}`);
    assert('元信息行数与库内一致', liveCount === (await countRows(conn)), 'meta=' + liveCount);

    console.log('\n=== 2. 插入含长 key 的测试行（接近 varchar(80) 上限） ===');
    // 构造一个 length 尽量接近 80 的合法 key
    const longChapter = '信息社会伦理道德与法律法规';
    const longKey = `${longChapter}::selftest::${'9'.repeat(1)}`;
    const nearKey = `${longChapter}::selftest::` + 'x'.repeat(80 - longChapter.length - '::selftest::'.length - 3) + '999';
    await conn.query(
      `INSERT INTO ${TABLE} (student_id, question_key, question_text, visited_at) VALUES (?, ?, ?, NOW())`,
      [markerStudent, longKey, '专项验证·长key']
    );
    await conn.query(
      `INSERT INTO ${TABLE} (student_id, question_key, question_text, visited_at) VALUES (?, ?, ?, NOW())`,
      [markerStudent, nearKey, '专项验证·接近上限key']
    );
    console.log(`      longKey len=${longKey.length}, nearKey len=${nearKey.length}`);
    assert('nearKey 长度 <= 80', nearKey.length <= 80, 'len=' + nearKey.length);

    const before = await snapshotRows(conn, markerStudent);
    assert('测试行写入成功（2 行）', before.length === 2, JSON.stringify(before.map(r => r.question_key.length)));

    console.log('\n=== 3. 导出 learning 域 ===');
    const zipPath = await downloadExport(AUTH, {
      domains: ['learning'],
      file_mode: 'manifest',
    });
    console.log('      包大小:', fs.statSync(zipPath).size, 'bytes');

    const dataJson = await readZipEntry(zipPath, `data/${TABLE}.json`);
    assert('包内含 data/' + TABLE + '.json', !!dataJson);
    const rows = JSON.parse(dataJson);
    const markerRows = rows.filter(r => r.student_id === markerStudent);
    assert('导出包含 2 行测试数据', markerRows.length === 2, 'got ' + markerRows.length);
    const nearRow = markerRows.find(r => r.question_key === nearKey);
    assert('接近上限的长 key 完整导出未被截断',
      !!nearRow && nearRow.question_key.length === nearKey.length,
      'exported len=' + (nearRow ? nearRow.question_key.length : 'null') + ' expected=' + nearKey.length);
    assert('导出条目不含生成列（该表无生成列，字段应含 id/student_id/question_key/question_text/visited_at）',
      markerRows[0] && 'id' in markerRows[0] && 'question_key' in markerRows[0],
      JSON.stringify(Object.keys(markerRows[0] || {})));

    console.log('\n=== 4. 删除测试行 → 覆盖导入 → 恢复保真 ===');
    await conn.query(`DELETE FROM ${TABLE} WHERE student_id = ?`, [markerStudent]);
    assert('删除后为 0 行', (await snapshotRows(conn, markerStudent)).length === 0);

    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(zipPath)]), path.basename(zipPath));
    fd.append('modes', JSON.stringify({ learning: 'overwrite' }));
    fd.append('confirm', 'yes');
    const imp = await api('/api/admin/data-io/import/execute', { method: 'POST', headers: AUTH, body: fd });
    assert('覆盖导入 HTTP 200', imp.status === 200, 'status=' + imp.status + ' ' + JSON.stringify(imp.json || {}).slice(0, 200));
    assert('导入返回无 error', !imp.json?.error, JSON.stringify(imp.json?.error || ''));

    const after = await snapshotRows(conn, markerStudent);
    assert('恢复 2 行', after.length === 2, 'got ' + after.length);
    const afterNear = after.find(r => r.question_key === nearKey);
    assert('长 key 导入后逐字节一致（未截断）',
      !!afterNear && afterNear.question_key === nearKey,
      'after len=' + (afterNear ? afterNear.question_key.length : 'null'));
    assert('question_text 保真',
      after.every(r => before.some(b => b.question_key === r.question_key && b.question_text === r.question_text)));

    console.log('\n=== 5. 全表行数与整体保真 ===');
    const totalAfter = await countRows(conn);
    console.log(`      导入后总行数 = ${totalAfter}（导入前 meta = ${liveCount}）`);
    assert('总行数 >= 导入前（未丢数据）', totalAfter >= liveCount, `after=${totalAfter} before=${liveCount}`);

    console.log('\n=== 6. 追加模式（INSERT IGNORE）不报错且不重复 ===');
    const fd2 = new FormData();
    fd2.append('file', new Blob([fs.readFileSync(zipPath)]), path.basename(zipPath));
    fd2.append('modes', JSON.stringify({ learning: 'append' }));
    fd2.append('confirm', 'yes');
    const imp2 = await api('/api/admin/data-io/import/execute', { method: 'POST', headers: AUTH, body: fd2 });
    assert('追加导入 HTTP 200', imp2.status === 200, 'status=' + imp2.status);
    const afterAppend = await countRows(conn);
    assert('追加后总行数不增长（唯一约束生效）', afterAppend === totalAfter, `after=${afterAppend} prev=${totalAfter}`);
  } catch (e) {
    assert('脚本执行无异常', false, e.message);
  } finally {
    try { await conn.query(`DELETE FROM ${TABLE} WHERE student_id = ?`, [markerStudent]); } catch (e) {}
    try { await conn.query(`DELETE FROM login_sessions WHERE device_info = 'vdio'`); } catch (e) {}
    try { await conn.query(`DELETE FROM profiles WHERE id = ?`, [teacherId]); } catch (e) {}
    await conn.end();
    cleanDir(TMP);
    try { fs.rmdirSync(TMP); } catch (e) {}
  }

  console.log(`\n===== 结果：${passed} 通过 / ${failures.length} 失败 =====`);
  failures.forEach(f => console.log('   x ' + f));
  process.exit(failures.length ? 1 : 0);
})();

function countRows(conn) {
  return conn.query(`SELECT COUNT(*) n FROM ${TABLE}`).then(([r]) => r[0].n);
}

function snapshotRows(conn, studentId) {
  return conn
    .query(`SELECT student_id, question_key, question_text FROM ${TABLE} WHERE student_id = ? ORDER BY question_key`, [studentId])
    .then(([r]) => r);
}
