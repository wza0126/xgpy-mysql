const mysql = require('mysql2/promise');

async function run() {
  const pool = await mysql.createConnection({
    host: '192.168.10.110',
    port: 3306,
    user: 'root',
    password: '',
    database: 'xgpy'
  });
  const [settings] = await pool.query("SELECT * FROM security_settings WHERE id = 1");
  console.log('安全设置:', JSON.stringify(settings[0], null, 2));
  
  const [sessions] = await pool.query(`
    SELECT id, user_id, is_active, expires_at, device_info, created_at, last_active_at
    FROM login_sessions 
    WHERE is_active = TRUE AND expires_at > NOW()
    ORDER BY created_at DESC
  `);
  console.log('当前活跃会话:', JSON.stringify(sessions, null, 2));
  
  const [teacherSessions] = await pool.query(`
    SELECT ls.id, ls.user_id, ls.is_active, ls.expires_at, ls.device_info, p.username
    FROM login_sessions ls
    JOIN profiles p ON ls.user_id = p.id
    WHERE p.role = 'teacher' AND ls.is_active = TRUE AND ls.expires_at > NOW()
    ORDER BY ls.created_at DESC
  `);
  console.log('教师活跃会话:', JSON.stringify(teacherSessions, null, 2));
  
  await pool.end();
}

run();