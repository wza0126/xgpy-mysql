/**
 * cleanup-exe-test-db.cjs
 * 检查 exe 实测临时库（tmp_xgpy_exe_test）建表结果，随后 DROP，不留痕。
 */
require('../../src/env');
const { poolNoDB } = require('../../src/db');

const DB = 'tmp_xgpy_exe_test';

async function main() {
  const [tables] = await poolNoDB.query(`SHOW TABLES FROM \`${DB}\` LIKE 'farm%'`);
  const names = tables.map((r) => Object.values(r)[0]);
  console.log('农场相关表:', names.join(', ') || '(无)');

  const [cols] = await poolNoDB.query(`SHOW COLUMNS FROM \`${DB}\`.farm_config`);
  const colNames = cols.map((c) => c.Field);
  console.log('farm_config 列:', colNames.join(', '));

  const [mig] = await poolNoDB.query(
    `SELECT COUNT(*) AS c, MAX(version) AS v FROM \`${DB}\`.schema_migrations`,
  );
  console.log('schema_migrations:', mig[0].c, '条，最新', mig[0].v);

  await poolNoDB.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  console.log(`已清理临时库 ${DB}`);
}

main()
  .catch((e) => { console.error('异常:', e.message); })
  .finally(async () => { await poolNoDB.end().catch(() => {}); process.exit(0); });
