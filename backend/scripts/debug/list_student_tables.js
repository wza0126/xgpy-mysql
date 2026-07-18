const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

async function listStudentTables() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });
  
  const [rows] = await connection.execute('SHOW TABLES');
  console.log('数据库表列表:');
  const tables = rows.map(r => Object.values(r)[0]);
  tables.forEach(t => console.log(`  - ${t}`));
  
  console.log('\n\n查找与学生ID关联的表...');
  
  for (const table of tables) {
    try {
      const [columns] = await connection.execute(`DESCRIBE ${table}`);
      const hasStudentId = columns.some(c => c.Field.includes('student_id'));
      if (hasStudentId) {
        console.log(`✅ ${table} 包含 student_id 字段`);
      }
    } catch (e) {
      // 忽略错误
    }
  }
  
  await connection.end();
}

listStudentTables();