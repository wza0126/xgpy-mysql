const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

async function listClasses() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });
  
  const [rows] = await connection.execute('SELECT id, name FROM classes');
  console.log('班级列表:');
  rows.forEach((r, i) => console.log(`${i+1}. ${r.name} (ID: ${r.id})`));
  
  await connection.end();
}

listClasses();