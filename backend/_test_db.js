const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '.env.development') });

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'root', password: process.env.DB_PASSWORD || '', database: 'xgpy'
  });

  // 1. 看下 test 表的 allow_equipment_drop 字段
  const [cols] = await conn.query("SHOW COLUMNS FROM tests LIKE 'allow_equipment_drop'");
  console.log('Column info:', cols);

  // 2. 看下最近创建的测试
  const [tests] = await conn.query("SELECT id, title, passing_score, points_reward, allow_internet_code, allow_equipment_drop, is_active, type FROM tests ORDER BY created_at DESC LIMIT 10");
  console.log('\nRecent tests:');
  tests.forEach(t => console.log(`  ${t.id} | ${t.title} | active=${t.is_active} | type=${t.type} | allow_eq_drop=${t.allow_equipment_drop}`));

  // 3. 看下测试记录
  const [records] = await conn.query("SELECT id, test_id, student_id, score, is_passed, completed_at FROM exam_records ORDER BY completed_at DESC LIMIT 5");
  console.log('\nRecent exam records:');
  records.forEach(r => console.log(`  ${r.id} | test=${r.test_id.substring(0,20)} | score=${r.score} | passed=${r.is_passed} | ${r.completed_at}`));

  // 4. 看下装备
  const [eqs] = await conn.query("SELECT id, name, drop_rate, is_active FROM equipments");
  console.log('\nEquipments:', eqs);

  await conn.end();
})().catch(e => console.error(e));
