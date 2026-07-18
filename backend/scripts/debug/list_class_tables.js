const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

async function list() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });

  const [tables] = await connection.execute('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);

  console.log('查找有 class_id 或 class_ids 字段的表:');
  for (const table of tableNames) {
    try {
      const [cols] = await connection.execute(`DESCRIBE ${table}`);
      const hasClassId = cols.find(c => c.Field === 'class_id');
      const hasClassIds = cols.find(c => c.Field === 'class_ids');
      if (hasClassId || hasClassIds) {
        console.log(`  ${table}: ${hasClassId ? 'class_id' : ''}${hasClassId && hasClassIds ? ' + ' : ''}${hasClassIds ? 'class_ids(JSON)' : ''}`);
      }
    } catch (e) {}
  }

  await connection.end();
}

list();
