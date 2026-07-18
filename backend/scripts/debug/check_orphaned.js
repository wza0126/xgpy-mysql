const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

async function checkOrphanedRecords() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });

  // 获取所有表
  const [tables] = await connection.execute('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);

  // 获取 profiles 表的所有 student id
  const [profiles] = await connection.execute('SELECT id FROM profiles');
  const validStudentIds = new Set(profiles.map(p => p.id));

  const orphanedResults = [];

  for (const table of tableNames) {
    try {
      // 检查是否有 student_id 字段
      const [columns] = await connection.execute(`DESCRIBE ${table}`);
      const studentIdCol = columns.find(c => c.Field === 'student_id');
      const userIdCol = columns.find(c => c.Field === 'user_id');

      if (studentIdCol) {
        const [rows] = await connection.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
        const total = rows[0].cnt;
        if (total > 0) {
          // 查找孤立记录（student_id 不在 profiles 中）
          const [orphanRows] = await connection.execute(
            `SELECT COUNT(*) as cnt FROM ${table} WHERE student_id NOT IN (SELECT id FROM profiles)`
          );
          const orphanCount = orphanRows[0].cnt;
          if (orphanCount > 0) {
            orphanedResults.push({ table, column: 'student_id', total, orphaned: orphanCount });
          }
        }
      } else if (userIdCol) {
        const [rows] = await connection.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
        const total = rows[0].cnt;
        if (total > 0) {
          const [orphanRows] = await connection.execute(
            `SELECT COUNT(*) as cnt FROM ${table} WHERE user_id NOT IN (SELECT id FROM profiles)`
          );
          const orphanCount = orphanRows[0].cnt;
          if (orphanCount > 0) {
            orphanedResults.push({ table, column: 'user_id', total, orphaned: orphanCount });
          }
        }
      }
    } catch (e) {
      // 忽略错误
    }
  }

  console.log('有孤立记录的表:');
  if (orphanedResults.length === 0) {
    console.log('  没有发现孤立记录');
  } else {
    orphanedResults.forEach(r => {
      console.log(`  ${r.table} (${r.column}): 总共 ${r.total} 条, 孤立 ${r.orphaned} 条`);
    });
  }

  await connection.end();
}

checkOrphanedRecords().catch(console.error);
