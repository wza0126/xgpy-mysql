// 诊断脚本（只读）：查看残留事务/锁、生成列、以及各库关键表行数
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'root', password: '122201', timezone: '+08:00',
  });
  const q = async (sql, args = []) => { try { const [r] = await conn.query(sql, args); return r; } catch (e) { return [{ error: e.message }]; } };

  console.log('=== 1. 库列表 ===');
  console.table(await q('SHOW DATABASES'));

  console.log('=== 2. 未结束的事务 (innodb_trx) ===');
  console.table(await q(`SELECT trx_id, trx_state, trx_started, TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS age_sec,
      trx_mysql_thread_id AS thread_id, trx_rows_modified, LEFT(COALESCE(trx_query,''),80) AS q
    FROM information_schema.innodb_trx ORDER BY trx_started`));

  console.log('=== 3. 连接列表 (非 Sleep 与长 Sleep) ===');
  console.table(await q(`SELECT id, user, db, command, time, state, LEFT(COALESCE(info,''),80) AS info
    FROM information_schema.processlist WHERE user NOT IN ('system user') ORDER BY time DESC LIMIT 30`));

  console.log('=== 4. 所有生成列 ===');
  console.table(await q(`SELECT table_schema, table_name, column_name, generation_expression, extra
    FROM information_schema.columns WHERE extra LIKE '%GENERATED%' ORDER BY table_schema, table_name`));

  console.log('=== 5. 各库关键表行数 ===');
  const dbs = (await q('SHOW DATABASES')).map(r => Object.values(r)[0]).filter(n => /xgpy/i.test(n));
  for (const db of dbs) {
    const rows = [];
    for (const t of ['users', 'login_sessions', 'login_history', 'system_config', 'questions', 'student_profiles', 'exchange_records']) {
      const r = await q(`SELECT COUNT(*) AS n FROM \`${db}\`.\`${t}\``);
      rows.push({ table: t, rows: r[0]?.n ?? r[0]?.error });
    }
    console.log(`--- ${db} ---`);
    console.table(rows);
  }
  await conn.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
