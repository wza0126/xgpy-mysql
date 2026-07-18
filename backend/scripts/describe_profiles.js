const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

async function describeProfiles() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });
  
  const [rows] = await connection.execute('DESCRIBE profiles');
  console.log('profiles 表结构:');
  rows.forEach(r => console.log(`${r.Field} - ${r.Type}`));
  
  await connection.end();
}

describeProfiles();