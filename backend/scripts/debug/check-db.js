const mysql = require('mysql2/promise');
(async () => {
  const p = await mysql.createPool({ host: 'localhost', user: 'root', password: 'meoo.local', database: 'xgpy_m' });
  const [t] = await p.query("SELECT id, username, role FROM profiles WHERE role='teacher' LIMIT 1");
  const [c] = await p.query('SELECT id, name, teacher_id FROM classes LIMIT 5');
  const [s] = await p.query("SELECT id, username, real_name, class_id FROM profiles WHERE role='student' LIMIT 5");
  console.log('teacher:', JSON.stringify(t));
  console.log('classes:', JSON.stringify(c));
  console.log('students:', JSON.stringify(s));
  p.end();
})();
