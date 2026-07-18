const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

async function checkOnlineFields() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });
  
  console.log('=== profiles 表结构 ===');
  const [profiles] = await connection.execute('DESCRIBE profiles');
  profiles.forEach(r => console.log(`${r.Field} - ${r.Type}`));
  
  console.log('\n=== login_sessions 表结构 ===');
  const [sessions] = await connection.execute('DESCRIBE login_sessions');
  sessions.forEach(r => console.log(`${r.Field} - ${r.Type}`));
  
  console.log('\n=== 检查示例数据 ===');
  const [sessionExamples] = await connection.execute('SELECT * FROM login_sessions LIMIT 3');
  console.log('login_sessions 示例:');
  sessionExamples.forEach(s => console.log(s));
  
  await connection.end();
}

checkOnlineFields();