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

  const [classes] = await connection.execute('SELECT id, name FROM classes WHERE id != ?', ['79691958-faff-48ee-96d2-d2d288129e1b']);
  console.log(`将删除 ${classes.length} 个班级:`);
  classes.forEach(c => console.log('  ', c.name));

  await connection.end();
}

list();
