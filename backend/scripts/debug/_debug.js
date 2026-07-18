const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '.env.development') });

(async () => {
  const c = await mysql.createConnection({host:'127.0.0.1',port:3306,user:'root',password:process.env.DB_PASSWORD || '',database:'xgpy'});
  
  // 找"掉落测试"
  const [t] = await c.query("SELECT id, title, allow_equipment_drop, type, is_active FROM tests WHERE title LIKE '%掉落%'");
  console.log('测试:', JSON.stringify(t));
  
  // 学生a最近考试记录
  const [stu] = await c.query("SELECT id FROM profiles WHERE username='a'");
  const sid = stu[0].id;
  const [recs] = await c.query("SELECT id, test_id, score, is_passed, completed_at FROM exam_records WHERE student_id=? ORDER BY completed_at DESC LIMIT 3", [sid]);
  console.log('最近考试记录:', JSON.stringify(recs));
  
  // 查看 test_records
  const [trs] = await c.query("SELECT id, test_id, score, completed_at FROM test_records WHERE student_id=? ORDER BY completed_at DESC LIMIT 3", [sid]);
  console.log('test_records:', JSON.stringify(trs));
  
  // 查看学生a的装备
  const [eqs] = await c.query("SELECT se.*, e.name, e.icon, e.crit_bonus FROM student_equipments se JOIN equipments e ON se.equipment_id = e.id WHERE se.student_id=?", [sid]);
  console.log('学生a的装备:', JSON.stringify(eqs));
  
  await c.end();
})();
