const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '.env.development') });

(async () => {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: process.env.DB_PASSWORD || '', database: 'xgpy' });

  // 所有测试
  const [tests] = await conn.query("SELECT id, title, type, allow_equipment_drop, is_active, created_at, updated_at FROM tests ORDER BY COALESCE(updated_at, created_at) DESC");
  console.log('All tests (by updated_at):');
  tests.forEach(t => console.log(`  ${t.id} | ${t.title || '(no title)'} | type=${t.type} | active=${t.is_active} | allow_eq_drop=${t.allow_equipment_drop} | updated=${t.updated_at}`));

  // 学生a 最近的考试记录（包括exam_records和test_records）
  const [stu] = await conn.query("SELECT id FROM profiles WHERE username = 'a'");
  const sid = stu[0].id;
  console.log(`\nStudent a (${sid}) - exam_records:`);
  const [ers] = await conn.query("SELECT id, test_id, score, is_passed, completed_at FROM exam_records WHERE student_id = ? ORDER BY COALESCE(completed_at, started_at) DESC LIMIT 5", [sid]);
  ers.forEach(r => console.log(`  ${r.id.substring(0,25)} | test=${r.test_id.substring(0,20)} | score=${r.score} | passed=${r.is_passed} | ${r.completed_at}`));

  console.log(`\nStudent a - test_records:`);
  const [trs] = await conn.query("SELECT id, test_id, score, completed_at FROM test_records WHERE student_id = ? ORDER BY completed_at DESC LIMIT 5", [sid]);
  trs.forEach(r => console.log(`  ${r.id} | test=${r.test_id.substring(0,20)} | score=${r.score} | ${r.completed_at}`));

  await conn.end();
})().catch(e => console.error(e));
