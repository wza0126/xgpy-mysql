// 对比快照包与线上库的行数差异（只读）
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const mysql = require('mysql2/promise');

const BACKUPS = path.join(__dirname, '..', '..', 'backups');

function readEntry(zipPath, name) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.readEntry();
      zip.on('entry', e => {
        if (e.fileName === name) {
          zip.openReadStream(e, (er, rs) => {
            if (er) return reject(er);
            const bufs = [];
            rs.on('data', d => bufs.push(d));
            rs.on('end', () => { zip.close(); resolve(Buffer.concat(bufs)); });
          });
        } else zip.readEntry();
      });
      zip.on('end', () => resolve(null));
      zip.on('error', reject);
    });
  });
}

(async () => {
  const snaps = fs.readdirSync(BACKUPS).filter(f => f.endsWith('.xgpybak')).sort();
  const target = process.argv[2] || snaps[0];
  console.log('对比快照:', target);
  const raw = await readEntry(path.join(BACKUPS, target), 'manifest.json');
  const manifest = JSON.parse(raw.toString('utf8'));
  console.log('平台版本:', manifest.platform_version, '| 导出时间:', manifest.exported_at, '| 文件模式:', manifest.file_mode, '| 文件数:', (manifest.files || []).length);

  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  const cnt = async (t) => { try { const [r] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``); return r[0].n; } catch { return -1; } };

  const rows = [];
  let snapTotal = 0, liveTotal = 0, diffTables = 0;
  for (const d of manifest.domains || []) {
    for (const t of d.tables || []) {
      const live = await cnt(t.table);
      snapTotal += t.rows; liveTotal += live < 0 ? 0 : live;
      if (live !== t.rows) diffTables++;
      rows.push({ domain: d.id, table: t.table, 快照: t.rows, 当前: live, diff: live - t.rows });
    }
  }
  console.log(`\n快照总行数 ${snapTotal} | 当前总行数 ${liveTotal} | 行数不同的表 ${diffTables} 张`);
  const diff = rows.filter(r => r.diff !== 0);
  console.log(diff.length ? '=== 有差异的表 ===' : '=== 无差异 ===');
  if (diff.length) console.table(diff);
  await conn.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
