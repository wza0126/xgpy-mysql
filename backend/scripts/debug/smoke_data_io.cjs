/**
 * 数据导入导出冒烟测试（smoke_data_io.cjs）
 *
 * 覆盖：
 *   A. 元信息接口（域注册、未覆盖表兜底、文件统计）
 *   B. 导出 → 覆盖导入 → 行数与数据保真（含已删行恢复）
 *   C. 追加模式冲突跳过
 *   D. 文件域全量导出 → 删文件 → 导入恢复（增改不删）
 *   E. 文件域仅清单模式
 *   F. 排除目录
 *   G. 导入前自动快照
 *
 * 运行：先启动后端（node src/index.js），再 node scripts/debug/smoke_data_io.cjs
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' };
const TMP = path.join(__dirname, 'tmp-dio');
const failures = [];
let passed = 0;

function assert(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${extra ? ' | ' + extra : ''}`); console.log(`  ✗ ${name} ${extra}`); }
}

async function api(p, opts = {}) {
  const res = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.headers || {}) },
    body: opts.body,
  });
  let json = null;
  if (!opts.raw) { try { json = await res.json(); } catch { /* 二进制 */ } }
  return { status: res.status, json, res };
}

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const conn = await mysql.createConnection(DB);
  const TS = 'smoke_dio_' + Date.now();

  // ---- 准备：冒烟教师 + 登录会话 ----
  const rawToken = 'smoke_dio_token_' + crypto.randomBytes(16).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const teacherId = 'smoke_dio_teacher';
  await conn.query(
    `INSERT INTO profiles (id, username, password_hash, role, real_name) VALUES (?, ?, '', 'teacher', '冒烟数据管理')
     ON DUPLICATE KEY UPDATE role = 'teacher'`,
    [teacherId, TS]
  );
  await conn.query(
    `INSERT INTO login_sessions (id, user_id, token, device_info, ip_address, created_at, last_active_at, expires_at, is_active)
     VALUES (?, ?, ?, 'smoke', '127.0.0.1', NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 1 HOUR), 1)`,
    ['smoke_dio_' + Date.now(), teacherId, tokenHash]
  );
  const AUTH = { Authorization: `Bearer ${rawToken}` };

  // 越权检查：学生 token 不可访问
  const rawStudent = 'smoke_dio_stoken_' + crypto.randomBytes(16).toString('hex');
  await conn.query(
    `INSERT INTO profiles (id, username, password_hash, role, real_name) VALUES (?, ?, '', 'student', '冒烟学生')
     ON DUPLICATE KEY UPDATE role = 'student'`,
    [teacherId.replace('teacher', 'student'), TS + '_s']
  );
  await conn.query(
    `INSERT INTO login_sessions (id, user_id, token, device_info, ip_address, created_at, last_active_at, expires_at, is_active)
     VALUES (?, ?, ?, 'smoke', '127.0.0.1', NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 1 HOUR), 1)`,
    ['smoke_dio_s' + Date.now(), teacherId.replace('teacher', 'student'), crypto.createHash('sha256').update(rawStudent).digest('hex')]
  );
  await conn.query('DELETE FROM profiles WHERE id = ?', ['smoke_dio_marker']); // 清掉上次运行可能残留的标记
  const denied = await api('/api/admin/data-io/meta', { headers: { Authorization: `Bearer ${rawStudent}` } });
  assert('学生角色访问数据管理接口被拒 403', denied.status === 403, `status=${denied.status}`);

  // ---- A. 元信息 ----
  console.log('\n--- A. 元信息 ---');
  const meta = await api('/api/admin/data-io/meta', { headers: AUTH });
  assert('meta 返回 200', meta.status === 200);
  const domainIds = (meta.json?.data?.domains || []).map(d => d.id);
  for (const must of ['accounts', 'questions', 'tests', 'answers', 'points', 'system', 'logs']) {
    assert(`元信息包含数据域 ${must}`, domainIds.includes(must));
  }
  const accountsDomain = meta.json.data.domains.find(d => d.id === 'accounts');
  assert('学生账号域包含 profiles 表', accountsDomain?.tables?.some(t => t.table === 'profiles'));
  const filesMeta = meta.json.data.files;
  assert('文件统计包含 uploads 子目录信息', Array.isArray(filesMeta?.subdirs) && filesMeta.file_count > 0, `file_count=${filesMeta?.file_count}`);
  const unclaimed = (meta.json.data.domains || []).find(d => d.id === 'other');
  if (unclaimed) {
    console.log(`  ! 注意：发现未分组表，已归入"其他"域: ${unclaimed.tables.map(t => t.table).join(', ')}`);
  }

  const accountsRows = accountsDomain.tables.find(t => t.table === 'profiles')?.rows || 0;

  // ---- B. 导出 accounts → 删行 → 覆盖导入恢复 ----
  console.log('\n--- B. 导出→覆盖导入→保真 ---');
  const exp1 = await api(`/api/admin/data-io/export?domains=accounts`, { headers: AUTH, raw: true });
  assert('导出 accounts 域返回 200 且为二进制', exp1.status === 200 && !!exp1.res.body, `status=${exp1.status}`);
  const zipPath = path.join(TMP, 'accounts.xgpybak');
  const buf = Buffer.from(await exp1.res.arrayBuffer());
  fs.writeFileSync(zipPath, buf);
  assert('备份包非空', buf.length > 1000, `bytes=${buf.length}`);

  // 记一个标记学生，导出后删掉，再导入恢复
  const markerId = 'smoke_dio_marker';
  await conn.query('DELETE FROM profiles WHERE id = ?', [markerId]);
  await conn.query(
    `INSERT INTO profiles (id, username, password_hash, role, real_name, current_points) VALUES (?, ?, '', 'student', '保真标记', 7)`,
    [markerId, TS + '_m']
  );
  const exp2 = await api(`/api/admin/data-io/export?domains=accounts`, { headers: AUTH, raw: true });
  const zipPath2 = path.join(TMP, 'accounts2.xgpybak');
  fs.writeFileSync(zipPath2, Buffer.from(await exp2.res.arrayBuffer()));

  await conn.query('DELETE FROM profiles WHERE id = ?', [markerId]);
  const [[afterDel]] = await conn.query('SELECT COUNT(*) n FROM profiles');
  assert('标记行已删除（回到导出前基数）', afterDel.n === accountsRows, `${afterDel.n} vs ${accountsRows}`);

  // 预览
  const fdP = new FormData();
  fdP.append('file', new Blob([fs.readFileSync(zipPath2)]), 'accounts2.xgpybak');
  const prev = await api('/api/admin/data-io/import/preview', { method: 'POST', headers: AUTH, body: fdP });
  assert('导入预览 200', prev.status === 200, JSON.stringify(prev.json?.error));
  const prevAccounts = prev.json?.data?.domains?.find(d => d.id === 'accounts');
  assert('预览显示包内 profiles 行数与当前库一致', prevAccounts?.tables?.find(t => t.table === 'profiles')?.package_rows === accountsRows + 1,
    JSON.stringify(prevAccounts?.tables?.find(t => t.table === 'profiles')));
  assert('预览返回临时文件名', !!prev.json?.data?.temp_file);

  // 执行覆盖导入（复用临时文件）
  const ex1 = await api('/api/admin/data-io/import/execute', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modes: { accounts: 'overwrite' }, confirm: 'yes', reuse_file: prev.json.data.temp_file }),
  });
  assert('覆盖导入 200', ex1.status === 200, JSON.stringify(ex1.json?.error));
  const markerRow = ex1.json?.data?.tables?.find(t => t.table === 'profiles');
  assert('覆盖导入报告：删除数=当前行数、插入数=包内行数', markerRow?.deleted === accountsRows && markerRow?.inserted === accountsRows + 1,
    JSON.stringify(markerRow));
  const [[markerBack]] = await conn.query('SELECT real_name, current_points FROM profiles WHERE id = ?', [markerId]);
  assert('删除的标记行被恢复（数据保真）', markerBack?.real_name === '保真标记' && markerBack?.current_points === 7,
    JSON.stringify(markerBack));
  const [[cntBack]] = await conn.query('SELECT COUNT(*) n FROM profiles');
  assert('导入后 profiles 行数与导出时一致', cntBack.n === accountsRows + 1, `${cntBack.n}`);
  assert('导入前自动快照存在', (ex1.json?.data?.snapshot?.name || '').startsWith('snapshot-'));

  // ---- C. 追加模式 ----
  console.log('\n--- C. 追加冲突跳过 ---');
  const fdC = new FormData();
  fdC.append('file', new Blob([fs.readFileSync(zipPath2)]), 'accounts2.xgpybak');
  const prevC = await api('/api/admin/data-io/import/preview', { method: 'POST', headers: AUTH, body: fdC });
  assert('追加前重新预览 200', prevC.status === 200, JSON.stringify(prevC.json?.error));
  const ex2 = await api('/api/admin/data-io/import/execute', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modes: { accounts: 'append' }, confirm: 'yes', reuse_file: prevC.json?.data?.temp_file }),
  });
  const appRow = ex2.json?.data?.tables?.find(t => t.table === 'profiles');
  assert('追加模式全部冲突跳过（插入 0）', ex2.status === 200 && appRow?.inserted === 0 && appRow?.skipped === accountsRows + 1,
    `status=${ex2.status} err=${JSON.stringify(ex2.json?.error)} row=${JSON.stringify(appRow)}`);
  const [[cntApp]] = await conn.query('SELECT COUNT(*) n FROM profiles');
  assert('追加后行数不变', cntApp.n === accountsRows + 1, `${cntApp.n}`);

  // ---- D. 文件域全量导出 → 删文件 → 导入恢复 ----
  console.log('\n--- D. 文件域恢复（增改不删） ---');
  const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
  const smokeFile = path.join(uploadsDir, `smoke-dio-${Date.now()}.txt`);
  fs.writeFileSync(smokeFile, 'dio-smoke-file');
  const expF = await api(`/api/admin/data-io/export?domains=files&file_mode=full`, { headers: AUTH, raw: true });
  assert('文件域全量导出 200', expF.status === 200, `status=${expF.status}`);
  const zipF = path.join(TMP, 'files.xgpybak');
  const bufF = Buffer.from(await expF.res.arrayBuffer());
  fs.writeFileSync(zipF, bufF);
  assert('文件域包体大于 30MB（含 uploads 本体）', bufF.length > 30 * 1024 * 1024, `${(bufF.length / 1024 / 1024).toFixed(1)}MB`);

  fs.unlinkSync(smokeFile);
  const fdF = new FormData();
  fdF.append('file', new Blob([bufF]), 'files.xgpybak');
  const prevF = await api('/api/admin/data-io/import/preview', { method: 'POST', headers: AUTH, body: fdF });
  assert('文件域预览 200 且 files 差异存在', prevF.status === 200 && !!prevF.json?.data?.files, JSON.stringify(prevF.json?.error));

  const exF = await api('/api/admin/data-io/import/execute', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modes: { files: 'overwrite' }, confirm: 'yes', reuse_file: prevF.json.data.temp_file }),
  });
  assert('文件域导入 200', exF.status === 200, JSON.stringify(exF.json?.error));
  assert('被删除的文件被恢复', fs.existsSync(smokeFile));
  const fReport = exF.json?.data?.files;
  assert('文件报告：新增 1、覆盖为其余', fReport?.added === 1 && fReport?.overwritten > 0, JSON.stringify(fReport));
  fs.unlinkSync(smokeFile); // 清理冒烟文件

  // ---- E. 仅清单模式 ----
  console.log('\n--- E. 仅清单模式 ---');
  const expM = await api(`/api/admin/data-io/export?domains=files&file_mode=manifest`, { headers: AUTH, raw: true });
  const bufM = Buffer.from(await expM.res.arrayBuffer());
  assert('仅清单包远小于全量包（<2MB）', bufM.length < 2 * 1024 * 1024, `${(bufM.length / 1024 / 1024).toFixed(2)}MB`);
  const zipM = path.join(TMP, 'files-manifest.xgpybak');
  fs.writeFileSync(zipM, bufM);
  const fdM = new FormData();
  fdM.append('file', new Blob([bufM]), 'files-manifest.xgpybak');
  const prevM = await api('/api/admin/data-io/import/preview', { method: 'POST', headers: AUTH, body: fdM });
  assert('仅清单预览给出警告', (prevM.json?.data?.warnings || []).some(w => w.includes('仅清单')), JSON.stringify(prevM.json?.data?.warnings));
  const exM = await api('/api/admin/data-io/import/execute', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modes: { files: 'overwrite' }, confirm: 'yes', reuse_file: prevM.json.data.temp_file }),
  });
  assert('仅清单导入只做报告不写文件', exM.status === 200 && exM.json?.data?.files?.mode === 'manifest-only', JSON.stringify(exM.json?.data?.files));

  // ---- F. 排除目录 ----
  console.log('\n--- F. 排除目录 ---');
  const expE = await api(`/api/admin/data-io/export?domains=files&file_mode=full&exclude=tasks`, { headers: AUTH, raw: true });
  const bufE = Buffer.from(await expE.res.arrayBuffer());
  const zipE = path.join(TMP, 'files-excl.xgpybak');
  fs.writeFileSync(zipE, bufE);
  const fdE = new FormData();
  fdE.append('file', new Blob([bufE]), 'files-excl.xgpybak');
  const prevE = await api('/api/admin/data-io/import/preview', { method: 'POST', headers: AUTH, body: fdE });
  const fullF = prevF.json.data.files.package_count;
  const exclF = prevE.json?.data?.files?.package_count;
  assert('排除 tasks 后包内文件数减少', exclF < fullF, `${exclF} vs ${fullF}`);
  assert('排除后包体明显变小', bufE.length < bufF.length * 0.9, `${(bufE.length / 1024 / 1024).toFixed(1)}MB vs ${(bufF.length / 1024 / 1024).toFixed(1)}MB`);

  // ---- G. 快照列表 ----
  console.log('\n--- G. 快照 ---');
  const snaps = await api('/api/admin/data-io/snapshots', { headers: AUTH });
  assert('快照列表 200 且非空', snaps.status === 200 && (snaps.json?.data || []).length > 0);

  // ---- 清理 ----
  console.log('\n--- 清理 ---');
  await conn.query('DELETE FROM profiles WHERE id LIKE "smoke_dio_%"');
  await conn.query("DELETE FROM login_sessions WHERE device_info = 'smoke'");
  fs.rmSync(TMP, { recursive: true, force: true });
  await conn.end();

  console.log(`\n========== 结果: ${passed} 通过 / ${failures.length} 失败 ==========`);
  if (failures.length > 0) {
    failures.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
}

main().catch(e => { console.error('SMOKE CRASH:', e); process.exit(1); });
