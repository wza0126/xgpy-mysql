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
 *   H. 生成列（exchange_records.exchanged_date）：导出剔除 + 旧包导入不报 3105 且值由目标库算出
 *   I. 中途失败必须整体回滚、不留残锁（不泄漏未结束事务）
 *   J. 撞锁时快速失败并给出中文提示
 *   K. 导入前快照确实含 uploads 文件
 *   L. 临时目录清理（孤儿解压目录 + 超期上传包）
 *
 * 运行：先启动后端（node src/index.js），再 node scripts/debug/smoke_data_io.cjs
 * 提示：以 DB_IMPORT_LOCK_WAIT_TIMEOUT=3 启动后端可让 J 用例几秒内跑完（默认 30s）
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const archiver = require('archiver');
const yauzl = require('yauzl');
const dataIO = require('../../src/data-io');

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3101';
const DB = { host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' };
const TMP = path.join(__dirname, 'tmp-dio');
const failures = [];
let passed = 0;

// 与 data-io.js 一致的序列化：Date → 'YYYY-MM-DD HH:MM:SS'，Buffer → base64 标记
function ser(row) {
  const p = (n) => String(n).padStart(2, '0');
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) { out[k] = null; continue; }
    if (v instanceof Date) {
      out[k] = `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
      continue;
    }
    if (Buffer.isBuffer(v)) { out[k] = { __buffer_b64: v.toString('base64') }; continue; }
    out[k] = v;
  }
  return out;
}

function manifestOf(domains, extra = {}) {
  return JSON.stringify({
    format: 'xgpybak', version: 1,
    platform_version: require('../../package.json').version,
    exported_at: new Date().toISOString(),
    file_mode: 'none', exclude_dirs: [], domains, files: [],
    ...extra,
  });
}

// 手工打包（构造旧版本包 / 故障包用）
function makePackage(zipPath, entries) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const arc = archiver('zip', { zlib: { level: 1 } });
    out.on('close', () => resolve(zipPath));
    arc.on('error', reject);
    out.on('error', reject);
    arc.pipe(out);
    for (const [name, data] of Object.entries(entries)) arc.append(data, { name });
    arc.finalize();
  });
}

function readZipEntry(zipPath, entryName) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.readEntry();
      zip.on('entry', (e) => {
        if (e.fileName === entryName) {
          zip.openReadStream(e, (er, rs) => {
            if (er) return reject(er);
            const bufs = [];
            rs.on('data', (d) => bufs.push(d));
            rs.on('end', () => { zip.close(); resolve(Buffer.concat(bufs)); });
          });
        } else zip.readEntry();
      });
      zip.on('end', () => resolve(null));
      zip.on('error', reject);
    });
  });
}

// multipart 执行导入（直传文件，不走预览复用）；extra: 额外表单字段
function executeWithFile(zipPath, modes, auth, extra = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(zipPath)]), path.basename(zipPath));
  fd.append('modes', JSON.stringify(modes));
  fd.append('confirm', 'yes');
  for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
  return api('/api/admin/data-io/import/execute', { method: 'POST', headers: auth, body: fd });
}

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

  // ---- H. 生成列 ----
  console.log('\n--- H. 生成列（exchange_records.exchanged_date） ---');
  const expP = await api('/api/admin/data-io/export?domains=points', { headers: AUTH, raw: true });
  const zipP = path.join(TMP, 'points.xgpybak');
  fs.writeFileSync(zipP, Buffer.from(await expP.res.arrayBuffer()));
  const pkgEx = JSON.parse((await readZipEntry(zipP, 'data/exchange_records.json')).toString('utf8'));
  assert('导出包已剔除生成列 exchanged_date', pkgEx.length > 0 && !('exchanged_date' in pkgEx[0]),
    JSON.stringify(Object.keys(pkgEx[0] || {})));

  const [exRows] = await conn.query('SELECT * FROM exchange_records');
  assert('exchange_records 有测试数据', exRows.length > 0, `rows=${exRows.length}`);
  const legacyJson = JSON.stringify(exRows.map(ser));
  assert('构造的老包 JSON 里确实带生成列', legacyJson.includes('exchanged_date'));
  const legacyZip = await makePackage(path.join(TMP, 'legacy-points.xgpybak'), {
    'manifest.json': manifestOf([{ id: 'points', name: '积分与游戏化', tables: [{ table: 'exchange_records', rows: exRows.length }] }]),
    'data/exchange_records.json': legacyJson,
  });
  const exH = await executeWithFile(legacyZip, { points: 'overwrite' }, AUTH);
  assert('含生成列的旧包导入不再报 3105', exH.status === 200, JSON.stringify(exH.json?.error));
  assert('导入报告提示生成列已跳过', (exH.json?.data?.warnings || []).some((w) => w.includes('生成列')),
    JSON.stringify(exH.json?.data?.warnings));
  const [[genBad]] = await conn.query('SELECT COUNT(*) c FROM exchange_records WHERE exchanged_date IS NULL OR exchanged_date <> DATE(exchanged_at)');
  assert('生成列由目标库重新计算且全部正确', genBad.c === 0, `bad=${genBad.c}`);
  const [[cntEx]] = await conn.query('SELECT COUNT(*) n FROM exchange_records');
  assert('exchange_records 行数保真', cntEx.n === exRows.length, `${cntEx.n} vs ${exRows.length}`);

  // ---- I. 中途失败必须整体回滚 ----
  console.log('\n--- I. 中途失败 → 整体回滚、不留残锁 ---');
  const [profRows] = await conn.query('SELECT * FROM profiles');
  const [kpRows] = await conn.query('SELECT * FROM knowledge_points LIMIT 2');
  if (kpRows.length < 1) {
    console.log('  ! knowledge_points 无数据，跳过本用例');
  } else {
    const dup = kpRows.length >= 2 ? [ser(kpRows[0]), ser(kpRows[1]), ser(kpRows[0])] : [ser(kpRows[0]), ser(kpRows[0])];
    const badZip = await makePackage(path.join(TMP, 'bad-order.xgpybak'), {
      'manifest.json': manifestOf([{
        id: 'accounts', name: '学生账号',
        tables: [{ table: 'profiles', rows: profRows.length }, { table: 'knowledge_points', rows: dup.length }],
      }]),
      'data/profiles.json': JSON.stringify(profRows.map(ser)),
      'data/knowledge_points.json': JSON.stringify(dup),
    });
    const exI = await executeWithFile(badZip, { accounts: 'overwrite' }, AUTH);
    assert('第二张表重复主键 → 导入失败 500', exI.status === 500, `status=${exI.status} err=${exI.json?.error}`);
    const [[afterP]] = await conn.query('SELECT COUNT(*) n FROM profiles');
    assert('第一张表已做的删除/插入被回滚（行数不变）', afterP.n === profRows.length, `${afterP.n} vs ${profRows.length}`);
    const [[trxI]] = await conn.query('SELECT COUNT(*) n FROM information_schema.innodb_trx');
    assert('失败后没有残留事务（未泄漏未结束事务）', trxI.n === 0, `trx=${trxI.n}`);
  }

  // ---- J. 撞锁快速失败 ----
  console.log('\n--- J. 撞锁 → 快速失败 + 中文提示 ---');
  const locker = await mysql.createConnection(DB);
  await locker.query('START TRANSACTION');
  await locker.query('UPDATE exchange_records SET id = id');
  const lockZip = await makePackage(path.join(TMP, 'points-locked.xgpybak'), {
    'manifest.json': manifestOf([{ id: 'points', name: '积分与游戏化', tables: [{ table: 'exchange_records', rows: exRows.length }] }]),
    'data/exchange_records.json': JSON.stringify(exRows.map(ser)),
  });
  const t0 = Date.now();
  const exJ = await executeWithFile(lockZip, { points: 'overwrite' }, AUTH);
  const cost = (Date.now() - t0) / 1000;
  await locker.query('ROLLBACK');
  await locker.end();
  assert('撞锁导入失败 500', exJ.status === 500, `status=${exJ.status}`);
  assert('错误信息是可读中文提示', /未结束的事务|等待锁超时|死锁/.test(exJ.json?.error || ''), exJ.json?.error);
  console.log(`  · 撞锁失败耗时 ${cost.toFixed(1)}s（由后端 DB_IMPORT_LOCK_WAIT_TIMEOUT 决定上限）`);
  const [[cntJ]] = await conn.query('SELECT COUNT(*) n FROM exchange_records');
  assert('撞锁失败后数据完好（DELETE 已回滚）', cntJ.n === exRows.length, `${cntJ.n} vs ${exRows.length}`);
  const [[trxJ]] = await conn.query('SELECT COUNT(*) n FROM information_schema.innodb_trx');
  assert('撞锁失败后无残留事务', trxJ.n === 0, `trx=${trxJ.n}`);

  // ---- K. 快照含 uploads ----
  console.log('\n--- K. 导入前快照含文件 ---');
  const snapsK = await api('/api/admin/data-io/snapshots', { headers: AUTH });
  const newest = (snapsK.json?.data || [])[0];
  assert('快照列表非空', !!newest);
  if (newest) {
    const snapRaw = await readZipEntry(path.join(__dirname, '..', '..', 'backups', newest.name), 'manifest.json');
    const snapManifest = JSON.parse(snapRaw.toString('utf8'));
    assert('快照 file_mode = full（含 uploads 本体）', snapManifest.file_mode === 'full', `file_mode=${snapManifest.file_mode}`);
    assert('快照 manifest 含文件清单', (snapManifest.files || []).length > 0, `files=${(snapManifest.files || []).length}`);
  }

  // ---- L. 临时目录清理 ----
  console.log('\n--- L. 临时目录清理 ---');
  const gcDir = path.join(TMP, 'gc');
  fs.mkdirSync(path.join(gcDir, 'extract-smoke-old'), { recursive: true });
  fs.writeFileSync(path.join(gcDir, 'extract-smoke-old', 'dummy.txt'), 'x');
  fs.writeFileSync(path.join(gcDir, 'import-smoke-old.xgpybak'), 'x');
  fs.writeFileSync(path.join(gcDir, 'import-smoke-fresh.xgpybak'), 'x');
  const oldStamp = Date.now() / 1000 - 10 * 3600;
  fs.utimesSync(path.join(gcDir, 'extract-smoke-old'), oldStamp, oldStamp);
  fs.utimesSync(path.join(gcDir, 'import-smoke-old.xgpybak'), oldStamp, oldStamp);
  const gc = dataIO.cleanupTemp(gcDir);
  assert('清理孤儿解压目录', !fs.existsSync(path.join(gcDir, 'extract-smoke-old')) && gc.dirs >= 1, JSON.stringify(gc));
  assert('清理超期上传包', !fs.existsSync(path.join(gcDir, 'import-smoke-old.xgpybak')) && gc.files >= 1, JSON.stringify(gc));
  assert('未超期的上传包保留', fs.existsSync(path.join(gcDir, 'import-smoke-fresh.xgpybak')));

  // ---- M. 空包防呆 + 导入后账号自检 + 失败登录记录 ----
  console.log('\n--- M. 空包防呆 / 账号自检 / 未知用户名登录记录 ---');
  // M0 先用 SQL 记下 profiles 全量（validateToken JOIN profiles，清空后 API 会 401，只能用 SQL 恢复）
  const [profAllM] = await conn.query('SELECT * FROM profiles');
  const profAllSer = profAllM.map(ser);

  // M1 手工构造"包内 profiles 为 0 行"的包（正是事故场景）
  const emptyZip = await makePackage(path.join(TMP, 'empty-accounts.xgpybak'), {
    'manifest.json': manifestOf([{ id: 'accounts', name: '学生账号', tables: [{ table: 'profiles', rows: 0 }] }]),
    'data/profiles.json': '[]',
  });

  // M2 预览应标记 empty_overwrite
  const fdEmpty = new FormData();
  fdEmpty.append('file', new Blob([fs.readFileSync(emptyZip)]), 'empty-accounts.xgpybak');
  const prevEmpty = await api('/api/admin/data-io/import/preview', { method: 'POST', headers: AUTH, body: fdEmpty });
  assert('空表包预览 200', prevEmpty.status === 200, JSON.stringify(prevEmpty.json?.error));
  const m2t = prevEmpty.json?.data?.domains?.find(d => d.id === 'accounts')?.tables?.find(t => t.table === 'profiles');
  assert('预览标记 empty_overwrite（包内 0 行 & 目标库有数据）', m2t?.empty_overwrite === true, JSON.stringify(m2t));

  // M3 未显式确认 → 后端直接阻止，数据不动，也不产生快照
  const exM3 = await executeWithFile(emptyZip, { accounts: 'overwrite' }, AUTH);
  assert('包内 0 行 + 覆盖 → 被 400 阻止', exM3.status === 400, `status=${exM3.status} err=${exM3.json?.error}`);
  assert('阻止信息点名 profiles 并说明后果', /已阻止导入/.test(exM3.json?.error || '') && /profiles/.test(exM3.json?.error || ''), exM3.json?.error);
  const [[cntM3]] = await conn.query('SELECT COUNT(*) n FROM profiles');
  assert('被阻止后 profiles 行数不变', cntM3.n === profAllSer.length, `${cntM3.n} vs ${profAllSer.length}`);

  // M4 显式确认后放行 → 真清空，但报告必须给出"无可登录账号"的 error 级警告
  const exM4 = await executeWithFile(emptyZip, { accounts: 'overwrite' }, AUTH, { allow_empty_overwrite: 'true' });
  assert('显式确认 allow_empty_overwrite 后放行 200', exM4.status === 200, JSON.stringify(exM4.json?.error));
  const [[cntM4]] = await conn.query('SELECT COUNT(*) n FROM profiles');
  assert('profiles 被清空为 0 行（确认后的预期行为）', cntM4.n === 0, `${cntM4.n}`);
  assert('导入报告给出"无可登录账号"警告', /无法登录/.test(exM4.json?.data?.account_warning || ''), exM4.json?.data?.account_warning);
  assert('放行路径照常生成快照', (exM4.json?.data?.snapshot?.name || '').startsWith('snapshot-'));

  // M5 SQL 恢复 profiles（模拟"从快照/备份把账号救回来"）
  for (let i = 0; i < profAllSer.length; i += 100) {
    const batch = profAllSer.slice(i, i + 100);
    const cols = Object.keys(batch[0]);
    await conn.query(
      `INSERT INTO profiles (${cols.map(c => '`' + c + '`').join(',')}) VALUES ${batch.map(() => `(${cols.map(() => '?').join(',')})`).join(',')}`,
      batch.map(r => cols.map(c => r[c])).flat()
    );
  }
  const [[cntM5]] = await conn.query('SELECT COUNT(*) n FROM profiles');
  assert('profiles 已恢复到导入前行数', cntM5.n === profAllSer.length, `${cntM5.n} vs ${profAllSer.length}`);

  // M6 用户名不存在时登录：不再抛 1048，且 login_history 留下 user_id='unknown' 的痕迹
  const badLogin = await api('/api/auth/secure-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'smoke_nouser_xz', password: 'whatever-123' }),
  });
  assert('不存在用户名的登录返回 401', badLogin.status === 401, `status=${badLogin.status}`);
  assert('返回"用户名或密码错误"而非 500', /用户名或密码错误/.test(badLogin.json?.error || ''), badLogin.json?.error);
  const [[unknownRow]] = await conn.query(
    "SELECT id FROM login_history WHERE user_id = 'unknown' AND failure_reason LIKE '%smoke_nouser_xz%' ORDER BY id DESC LIMIT 1"
  );
  assert('失败登录写入 user_id=unknown 且记录尝试的用户名', !!unknownRow);

  // ---- 清理 ----
  console.log('\n--- 清理 ---');
  await conn.query('DELETE FROM profiles WHERE id LIKE "smoke_dio_%"');
  await conn.query("DELETE FROM login_sessions WHERE device_info = 'smoke'");
  await conn.query("DELETE FROM login_history WHERE user_id = 'unknown' AND failure_reason LIKE '%smoke_nouser_xz%'");
  fs.rmSync(TMP, { recursive: true, force: true });
  await conn.end();

  console.log(`\n========== 结果: ${passed} 通过 / ${failures.length} 失败 ==========`);
  if (failures.length > 0) {
    failures.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
}

main().catch(e => { console.error('SMOKE CRASH:', e); process.exit(1); });
