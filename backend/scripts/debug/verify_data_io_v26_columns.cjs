/**
 * verify_data_io_v26_columns.cjs
 *
 * 目的：验证 v2.6.0 引入的两个新列能被「系统配置 → 数据管理」的导入导出正确处理：
 *   - tests.cluster_filters            （迁移 084 新增，JSON 存聚类筛选条件）
 *   - learn_visited_records.question_key（迁移 083 加宽 50 -> 80）
 *
 * 为什么需要单独验证：
 *   导入导出走 getTableColumns() 动态列 introspection（SHOW COLUMNS + Extra 含 GENERATED 过滤），
 *   理论上是列透明的；但「理论透明」不等于「实测往返无损」。
 *   本脚本真跑 导出 -> 删除 -> 覆盖导入 全链路，逐字节比对关键字段。
 *
 * 重要前提：
 *   - 只操作当前连接的库，不建表不切库。
 *   - 会在结束时清理自己插入的测试数据（含覆盖导入后的还原）。
 *   - 覆盖导入是破坏性的，所以本脚本只在测试库/本机开发库上跑。
 *
 * 用法：node scripts/debug/verify_data_io_v26_columns.cjs
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const pool = require('../../src/db');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const TMP = path.join(__dirname, '..', '..', '.tmp-v26-verify');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ✅ ' + name + (detail ? '  ' + detail : ''));
  } else {
    fail++;
    failures.push(name);
    console.log('  ❌ ' + name + (detail ? '  ' + detail : ''));
  }
}

function section(title) {
  console.log('\n【' + title + '】');
}

/** 直连 DB 造会话，绕过登录接口（凭据不写在脚本里）
 *  注意：login_sessions.token 存的是 token 的 SHA-256 哈希，不是明文
 *  （见 secure-auth.js validateToken：tokenHash = sha256(token)）。 */
async function makeSession(userId) {
  const crypto = require('crypto');
  const token = 'v26io-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sid = 'v26iosess-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await pool.query(
    `INSERT INTO login_sessions (id, token, user_id, is_active, expires_at)
     VALUES (?, ?, ?, 1, DATE_ADD(NOW(), INTERVAL 1 DAY))`,
    [sid, tokenHash, userId]
  );
  return token;
}

function request(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const mod = u.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = mod.request(
      {
        method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: Object.assign(
          { Authorization: 'Bearer ' + token },
          payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
        ),
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* 可能是二进制 */ }
          resolve({ status: res.statusCode, json, raw: data, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 下载导出包到本地文件 */
function download(urlPath, token, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const mod = u.protocol === 'https:' ? https : http;
    mod
      .get(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Authorization: 'Bearer ' + token } },
        (res) => {
          if (res.statusCode !== 200) {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => reject(new Error('导出失败 HTTP ' + res.statusCode + ' ' + d.slice(0, 200))));
            return;
          }
          const ws = fs.createWriteStream(dest);
          res.pipe(ws);
          ws.on('finish', () => ws.close(() => resolve(dest)));
          ws.on('error', reject);
        }
      )
      .on('error', reject);
  });
}

async function main() {
  console.log('=== v2.6.0 导入导出新列验证 ===');
  console.log('BASE =', BASE);

  fs.mkdirSync(TMP, { recursive: true });

  // 找一个教师账号来鉴权（data-io 接口要求 requireTeachingRole；本库无 super_admin 角色）
  const [admins] = await pool.query(
    "SELECT id, username FROM profiles WHERE role IN ('super_admin','teacher') ORDER BY role LIMIT 1"
  );
  if (!admins.length) {
    console.log('!! 库中没有教师/管理员账号，无法鉴权，退出');
    process.exit(1);
  }
  const adminId = admins[0].id;
  console.log('使用管理员:', admins[0].username, '(' + adminId + ')');

  let token = null;
  let createdTestId = null;
  let createdVisitId = null;
  const LONG_KEY = 'A'.repeat(80); // 恰好等于列宽上限
  const CLUSTER_JSON = JSON.stringify([{ primary: '人工智能', secondary: '人工智能的基础概念' }]);

  try {
    token = await makeSession(adminId);

    // ---------- A. 前置：新列存在且可写 ----------
    section('A 前置检查：新列存在且非生成列');

    const [testCols] = await pool.query('SHOW COLUMNS FROM tests');
    const cfCol = testCols.find((c) => c.Field === 'cluster_filters');
    ok('A1 tests.cluster_filters 存在', !!cfCol, cfCol ? cfCol.Type : '');
    ok('A2 tests.cluster_filters 不是生成列（可写）', !!cfCol && !String(cfCol.Extra || '').toUpperCase().includes('GENERATED'));

    const [lvCols] = await pool.query('SHOW COLUMNS FROM learn_visited_records');
    const lvCol = lvCols.find((c) => c.Field === 'question_key');
    ok('A3 learn_visited_records.question_key 存在', !!lvCol, lvCol ? lvCol.Type : '');
    ok('A4 question_key 列宽已加宽到 >=80', !!lvCol && parseInt(String(lvCol.Type).replace(/\D/g, ''), 10) >= 80, lvCol ? lvCol.Type : '');

    // ---------- B. 造数据 ----------
    section('B 插入测试数据（新列写入非空值）');

    // tests 行：必须有 teacher_id / class_id 之类必填？用最小可用字段试探
    const [tColsAll] = await pool.query('SHOW COLUMNS FROM tests');
    const tFields = new Set(tColsAll.map((c) => c.Field));
    const tNullable = new Map(tColsAll.map((c) => [c.Field, c.Null === 'YES']));
    const tDefault = new Map(tColsAll.map((c) => [c.Field, c.Default]));

    // 找一个现成的 teacher_id 复用，避免外键问题
    const [teachers] = await pool.query(
      "SELECT id FROM profiles WHERE role IN ('teacher','super_admin') LIMIT 1"
    );
    const teacherId = teachers.length ? teachers[0].id : adminId;

    // tests.id 是 varchar(50) 且无默认值，必须显式给值
    const testRowId = 'v26io' + Date.now().toString(36);

    const [insRes] = await pool.query(
      'INSERT INTO tests (id, title, created_by, cluster_filters) VALUES (?, ?, ?, ?)',
      [testRowId, 'v26-io-verify', teacherId, CLUSTER_JSON]
    );
    createdTestId = testRowId;
    void insRes;
    ok('B1 插入 tests 测试行成功', !!createdTestId, 'id=' + createdTestId);

    // learn_visited_records 行：question_key 用 80 字符边界值
    // 实际列：id / student_id / question_key / question_text / visited_at
    const [students] = await pool.query("SELECT id FROM profiles WHERE role = 'student' LIMIT 1");
    const stuId = students.length ? students[0].id : adminId;

    const [lvRes] = await pool.query(
      'INSERT INTO learn_visited_records (student_id, question_key, question_text) VALUES (?, ?, ?)',
      [stuId, LONG_KEY, 'v26-io-verify']
    );
    createdVisitId = lvRes.insertId;
    ok('B2 插入 learn_visited_records 测试行成功', !!createdVisitId, 'id=' + createdVisitId);

    // 校验写进去的长度没被截断
    const [[lvBack]] = await pool.query('SELECT question_key, CHAR_LENGTH(question_key) AS n FROM learn_visited_records WHERE id = ?', [createdVisitId]);
    ok('B3 80 字符 question_key 未截断', lvBack && Number(lvBack.n) === 80, 'len=' + (lvBack ? lvBack.n : '?'));

    const [[tBack]] = await pool.query('SELECT cluster_filters FROM tests WHERE id = ?', [createdTestId]);
    ok('B4 tests.cluster_filters 写入成功', !!tBack && !!tBack.cluster_filters, String(tBack && tBack.cluster_filters).slice(0, 60));

    // ---------- C. 导出 ----------
    section('C 导出（含 tests + learning 两个域）');

    // 先确认接口存在
    const meta = await request('GET', '/api/admin/data-io/meta', token);
    ok('C1 /api/admin/data-io/meta 可用', meta.status === 200, 'HTTP ' + meta.status);
    if (meta.status !== 200) throw new Error('meta 不可用，终止');

    const exportPath = '/api/admin/data-io/export?domains=tests,learning&file_mode=manifest';
    const zipPath = path.join(TMP, 'export.xgpybak');
    await download(exportPath, token, zipPath);
    const zsize = fs.statSync(zipPath).size;
    ok('C2 导出包下载成功', zsize > 0, zsize + ' bytes');

    // 解包读 JSON
    const yauzl = require('yauzl');
    const entries = {};
    await new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
        if (err) return reject(err);
        zip.readEntry();
        zip.on('entry', (entry) => {
          const nm = entry.fileName;
          if (nm.endsWith('tests.json') || nm.endsWith('learn_visited_records.json')) {
            zip.openReadStream(entry, (e2, rs) => {
              if (e2) return reject(e2);
              let buf = '';
              rs.on('data', (c) => (buf += c));
              rs.on('end', () => { entries[nm] = buf; zip.readEntry(); });
            });
          } else {
            zip.readEntry();
          }
        });
        zip.on('end', resolve);
        zip.on('error', reject);
      });
    });

    const testsKey = Object.keys(entries).find((k) => k.endsWith('tests.json'));
    const lvKey = Object.keys(entries).find((k) => k.endsWith('learn_visited_records.json'));
    ok('C3 导出包内含 tests.json', !!testsKey, testsKey || '');
    ok('C4 导出包内含 learn_visited_records.json', !!lvKey, lvKey || '');

    let exportedTests = [];
    let exportedLv = [];
    if (testsKey) exportedTests = JSON.parse(entries[testsKey]);
    if (lvKey) exportedLv = JSON.parse(entries[lvKey]);

    // 用 getTableColumns 的真实返回值（{all, generated, writable, types}）验证新列被认定为可写列
    const { getTableColumns } = require('../../src/data-io');
    const tColsMeta = await getTableColumns(pool, 'tests');
    ok('C5a getTableColumns(tests).writable 含 cluster_filters',
      tColsMeta.writable.includes('cluster_filters'),
      'writable 共 ' + tColsMeta.writable.length + ' 列');
    const lvColsMeta = await getTableColumns(pool, 'learn_visited_records');
    ok('C5b getTableColumns(learn_visited_records).writable 含 question_key',
      lvColsMeta.writable.includes('question_key'));

    // 字符串比较（tests.id 是 varchar）
    const expTest = exportedTests.find((r) => String(r.id) === String(createdTestId));
    ok('C6 导出的 tests 行含 cluster_filters 字段', !!expTest && 'cluster_filters' in expTest,
      expTest ? '该行共 ' + Object.keys(expTest).length + ' 字段' : '未找到 id=' + createdTestId);
    ok('C7 导出的 cluster_filters 内容完整一致',
      !!expTest && JSON.stringify(expTest.cluster_filters).includes('人工智能的基础概念'),
      expTest ? String(expTest.cluster_filters).slice(0, 70) : '');

    const expLv = exportedLv.find((r) => Number(r.id) === Number(createdVisitId));
    ok('C8 导出的 learn_visited_records 行含 question_key', !!expLv && 'question_key' in expLv);
    ok('C9 导出的 question_key 长度 = 80（未截断）',
      !!expLv && String(expLv.question_key).length === 80,
      expLv ? 'len=' + String(expLv.question_key).length : '');

    // ---------- D. 删除后覆盖导入 ----------
    section('D 删除新列数据 → 覆盖导入 → 逐字节还原');

    await pool.query('DELETE FROM tests WHERE id = ?', [createdTestId]);
    await pool.query('DELETE FROM learn_visited_records WHERE id = ?', [createdVisitId]);
    const [[afterDel1]] = await pool.query('SELECT COUNT(*) AS n FROM tests WHERE id = ?', [createdTestId]);
    const [[afterDel2]] = await pool.query('SELECT COUNT(*) AS n FROM learn_visited_records WHERE id = ?', [createdVisitId]);
    ok('D1 测试数据已删除', Number(afterDel1.n) === 0 && Number(afterDel2.n) === 0);

    // 覆盖导入：先预览
    const fd = new FormData();
    const fileBuf = fs.readFileSync(zipPath);
    fd.append('file', new Blob([fileBuf]), 'export.xgpybak');
    fd.append('mode', 'overwrite');

    const previewRes = await new Promise((resolve, reject) => {
      const u = new URL(BASE + '/api/admin/data-io/import/preview');
      const data = (() => {
        // 手工构造 multipart，避免依赖 undici 的 FormData 行为差异
        const boundary = '----v26verify' + Date.now();
        const parts = [];
        parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="export.xgpybak"\r\nContent-Type: application/octet-stream\r\n\r\n'));
        parts.push(fileBuf);
        parts.push(Buffer.from('\r\n--' + boundary + '--\r\n'));
        return { boundary, body: Buffer.concat(parts) };
      })();
      const req = http.request(
        {
          method: 'POST',
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'multipart/form-data; boundary=' + data.boundary,
            'Content-Length': data.body.length,
          },
        },
        (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => resolve({ status: res.statusCode, raw: d }));
        }
      );
      req.on('error', reject);
      req.write(data.body);
      req.end();
    });
    ok('D2 导入预览可用', previewRes.status === 200, 'HTTP ' + previewRes.status + ' ' + previewRes.raw.slice(0, 120));

    // 真正执行导入
    const execRes = await (async () => {
      const u = new URL(BASE + '/api/admin/data-io/import/execute');
      const boundary = '----v26verifyx' + Date.now();
      const parts = [];
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="export.xgpybak"\r\nContent-Type: application/octet-stream\r\n\r\n'));
      parts.push(fileBuf);
      parts.push(Buffer.from('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="mode"\r\n\r\noverwrite\r\n'));
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="confirm"\r\n\r\nyes\r\n'));
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="modes"\r\n\r\n' + JSON.stringify({ tests: 'overwrite', learning: 'overwrite' }) + '\r\n'));
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="allow_empty_overwrite"\r\n\r\n1\r\n'));
      parts.push(Buffer.from('--' + boundary + '--\r\n'));
      const body = Buffer.concat(parts);
      return await new Promise((resolve, reject) => {
        const req = http.request(
          {
            method: 'POST',
            hostname: u.hostname,
            port: u.port,
            path: u.pathname,
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'multipart/form-data; boundary=' + boundary,
              'Content-Length': body.length,
            },
          },
          (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => resolve({ status: res.statusCode, raw: d }));
          }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    })();
    ok('D3 覆盖导入执行返回 200', execRes.status === 200, 'HTTP ' + execRes.status + ' ' + execRes.raw.slice(0, 160));

    // ---------- E. 导入后比对 ----------
    section('E 导入后数据还原校验');

    const [[restoredTest]] = await pool.query(
      'SELECT id, cluster_filters FROM tests WHERE id = ?',
      [createdTestId]
    );
    ok('E1 tests 行已还原', !!restoredTest, restoredTest ? 'id=' + restoredTest.id : '未找到');
    ok('E2 cluster_filters 还原后内容一致（逐字节）',
      !!restoredTest && !!expTest && String(restoredTest.cluster_filters) === String(expTest.cluster_filters),
      restoredTest ? String(restoredTest.cluster_filters).slice(0, 70) : '');

    const [[restoredLv]] = await pool.query(
      'SELECT id, question_key, CHAR_LENGTH(question_key) AS n FROM learn_visited_records WHERE id = ?',
      [createdVisitId]
    );
    ok('E3 learn_visited_records 行已还原', !!restoredLv, restoredLv ? 'id=' + restoredLv.id : '未找到');
    ok('E4 question_key 还原后长度仍 = 80',
      !!restoredLv && Number(restoredLv.n) === 80,
      restoredLv ? 'len=' + restoredLv.n : '');
    ok('E5 question_key 内容逐字节一致',
      !!restoredLv && String(restoredLv.question_key) === LONG_KEY);

    // 再跑一次追加导入，验证 INSERT IGNORE 不报错、不膨胀
    const [[beforeRow]] = await pool.query('SELECT COUNT(*) AS n FROM tests');
    const beforeTotal = Number(beforeRow.n);
    const appendRes = await (async () => {
      const u = new URL(BASE + '/api/admin/data-io/import/execute');
      const boundary = '----v26verifya' + Date.now();
      const parts = [];
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="export.xgpybak"\r\nContent-Type: application/octet-stream\r\n\r\n'));
      parts.push(fileBuf);
      parts.push(Buffer.from('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="mode"\r\n\r\nappend\r\n'));
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="confirm"\r\n\r\nyes\r\n'));
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="modes"\r\n\r\n' + JSON.stringify({ tests: 'append', learning: 'append' }) + '\r\n'));
      parts.push(Buffer.from('--' + boundary + '--\r\n'));
      const body = Buffer.concat(parts);
      return await new Promise((resolve, reject) => {
        const req = http.request(
          {
            method: 'POST',
            hostname: u.hostname,
            port: u.port,
            path: u.pathname,
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'multipart/form-data; boundary=' + boundary,
              'Content-Length': body.length,
            },
          },
          (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => resolve({ status: res.statusCode, raw: d }));
          }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    })();
    ok('E6 追加导入返回 200（不炸）', appendRes.status === 200, 'HTTP ' + appendRes.status);
    // 追加模式是 INSERT IGNORE：已存在的 id 不重复插入，所以总数应保持不变
    const [[afterTotal]] = await pool.query('SELECT COUNT(*) AS n FROM tests');
    ok('E7 追加导入后 tests 总行数不膨胀（INSERT IGNORE 生效）',
      Number(afterTotal.n) === Number(beforeTotal),
      beforeTotal + ' -> ' + afterTotal.n);
  } catch (e) {
    fail++;
    failures.push('EXCEPTION: ' + e.message);
    console.log('\n!! 异常:', e.message);
  } finally {
    // ---------- 清理 ----------
    section('清理');
    try {
      if (createdTestId) await pool.query('DELETE FROM tests WHERE id = ?', [createdTestId]);
      if (createdVisitId) await pool.query('DELETE FROM learn_visited_records WHERE id = ?', [createdVisitId]);
      if (token) {
        const th = require('crypto').createHash('sha256').update(token).digest('hex');
        await pool.query('DELETE FROM login_sessions WHERE token = ?', [th]);
      }
      const [[r1]] = await pool.query('SELECT COUNT(*) AS n FROM tests WHERE title = ?', ['v26-io-verify']);
      const [[r2]] = await pool.query('SELECT COUNT(*) AS n FROM learn_visited_records WHERE question_key = ?', [LONG_KEY]);
      console.log('  残留 tests =', r1.n, ' 残留 learn_visited_records =', r2.n);
    } catch (e) {
      console.log('  清理异常:', e.message);
    }
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
      console.log('  临时目录已清理');
    } catch { /* ignore */ }

    console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
    if (failures.length) {
      console.log('失败项:');
      failures.forEach((f) => console.log('  - ' + f));
    }
    process.exit(fail === 0 ? 0 : 1);
  }
}

main();
