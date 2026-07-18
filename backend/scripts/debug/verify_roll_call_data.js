const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.development') });

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'root', password: process.env.DB_PASSWORD || '', database: 'xgpy'
  });

  const classId = '79691958-faff-48ee-96d2-d2d288129e1b';

  console.log('=== roll_call_seating 数据 ===');
  const [seats] = await conn.query(
    "SELECT seat_number, student_id, position_x, position_y, is_locked FROM roll_call_seating WHERE class_id = ? ORDER BY seat_number LIMIT 10",
    [classId]
  );
  console.log(`共 ${seats.length} 个座位`);

  console.log('\n=== roll_call_layout 数据 ===');
  const [layout] = await conn.query(
    "SELECT class_id, layout_data, is_locked FROM roll_call_layout WHERE class_id = ?",
    [classId]
  );
  console.log(JSON.stringify(layout, null, 2));

  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
