// 对比最早快照与当前库的账号/会话明细
const path = require('path');
const yauzl = require('yauzl');
const mysql = require('mysql2/promise');

const readEntry = (zipPath, name) => new Promise((resolve, reject) => {
  yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
    if (err) return reject(err);
    zip.readEntry();
    zip.on('entry', e => {
      if (e.fileName === name) {
        zip.openReadStream(e, (er, rs) => {
          if (er) return reject(er);
          const b = []; rs.on('data', d => b.push(d)); rs.on('end', () => { zip.close(); resolve(Buffer.concat(b)); });
        });
      } else zip.readEntry();
    });
    zip.on('end', () => resolve(null));
    zip.on('error', reject);
  });
});

(async () => {
  const zip = path.join(__dirname, '..', '..', 'backups', 'snapshot-20260918180402.xgpybak');
  const prof = JSON.parse((await readEntry(zip, 'data/profiles.json')).toString('utf8'));
  const sess = JSON.parse((await readEntry(zip, 'data/login_sessions.json')).toString('utf8'));
  const hist = JSON.parse((await readEntry(zip, 'data/login_history.json')).toString('utf8'));

  const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  const [liveProf] = await c.query('SELECT id, username, role, created_at FROM profiles');
  const snapIds = new Set(prof.map(p => p.id));
  const liveIds = new Set(liveProf.map(p => p.id));

  console.log('快照 accounts:', prof.length, '| 当前:', liveProf.length);
  console.log('快照有、当前没有的账号:');
  console.table(prof.filter(p => !liveIds.has(p.id)).map(p => ({ id: p.id, username: p.username, real_name: p.real_name, role: p.role, created_at: p.created_at })));
  console.log('当前有、快照没有的账号:');
  console.table(liveProf.filter(p => !snapIds.has(p.id)).map(p => ({ id: p.id, username: p.username, role: p.role, created_at: p.created_at })));

  const now = Date.now();
  console.log('快照里的会话数:', sess.length, '| 其中已过期:', sess.filter(s => new Date(s.expires_at).getTime() < now).length);
  console.log('会话有效期分布(expires_at):');
  console.table(sess.slice(0, 20).map(s => ({ id: String(s.id).slice(0, 8), is_active: s.is_active, expires_at: s.expires_at, 已过期: new Date(s.expires_at).getTime() < now ? '是' : '否' })));
  console.log('login_history 条数:', hist.length, '| 最后一条:', hist.length ? JSON.stringify(hist[hist.length - 1]).slice(0, 200) : '-');

  console.log('=== 当前 login_history 最后 5 条 ===');
  const [lhb] = await c.query('SELECT * FROM login_history ORDER BY login_time DESC LIMIT 5');
  console.table(lhb.map(r => ({ user_id: r.user_id, username: r.username, login_time: r.login_time, status: r.status || r.login_status, ip: r.ip_address })));
  await c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
