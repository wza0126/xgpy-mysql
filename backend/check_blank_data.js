const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '.env.development') });

async function main() {
  const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: process.env.DB_PASSWORD || '',
    database: 'xgpy',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  const [rows] = await pool.query(
    "SELECT id, title, blank_template, blank_answers, blank_weights FROM python_tasks WHERE task_type='fill_blank' LIMIT 5"
  );

  rows.forEach(r => {
    console.log(`\n【${r.title}】`);
    console.log('blank_template占位符数:', (r.blank_template || '').match(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g)?.length || 0);
    console.log('blank_answers类型:', typeof r.blank_answers);
    console.log('blank_answers值:', r.blank_answers?.substring?.(0, 200) || r.blank_answers);
    console.log('blank_weights:', r.blank_weights?.substring?.(0, 100) || r.blank_weights);
  });

  await pool.end();
}

main().catch(console.error);
