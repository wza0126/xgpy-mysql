const mysql = require('mysql2/promise');

async function test() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'meoo.local',
    database: 'xgpy',
    waitForConnections: true,
    connectionLimit: 10,
  });
  
  // 1. 检查最近的通知
  const [notifs] = await pool.query('SELECT id, title, has_buff, buff_type, buff_modifier, buff_duration, created_at FROM notifications ORDER BY id DESC LIMIT 3');
  console.log('=== 最近通知 ===');
  console.log(JSON.stringify(notifs, null, 2));
  
  // 2. 检查学生a的ID
  const [students] = await pool.query("SELECT id, username, real_name FROM profiles WHERE username = 'a' AND role = 'student' LIMIT 1");
  console.log('\n=== 学生a信息 ===');
  console.log(JSON.stringify(students, null, 2));
  
  if (students.length > 0) {
    const studentId = students[0].id;
    // 3. 检查该学生的buff
    const [buffs] = await pool.query('SELECT * FROM student_buffs WHERE student_id = ? ORDER BY created_at DESC LIMIT 5', [studentId]);
    console.log('\n=== 学生当前buffs ===');
    console.log(JSON.stringify(buffs, null, 2));
  }
  
  await pool.end();
}

test().catch(e => console.error(e));
