const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

async function check() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });

  const [rows] = await connection.execute(
    'SELECT class_id, COUNT(*) as cnt FROM profiles WHERE role="student" GROUP BY class_id'
  );
  console.log('各班学生数:');
  if (rows.length === 0) {
    console.log('  所有班级都没有学生了');
  } else {
    rows.forEach(r => console.log(`  class_id: ${r.class_id}, 学生数: ${r.cnt}`));
  }

  const [total] = await connection.execute('SELECT COUNT(*) as total FROM profiles WHERE role="student"');
  console.log(`\n学生总数: ${total[0].total}`);

  await connection.end();
}

check();
