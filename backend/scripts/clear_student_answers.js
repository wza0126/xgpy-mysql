const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

async function clearClassStudentAnswers(className) {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'xgpy',
      port: parseInt(process.env.DB_PORT || '3306')
    });
    
    // 查找班级ID
    const [classes] = await connection.execute(
      'SELECT id FROM classes WHERE name = ?',
      [className]
    );
    
    if (classes.length === 0) {
      console.log(`❌ 未找到班级: ${className}`);
      return;
    }
    
    const classId = classes[0].id;
    console.log(`✅ 找到班级: ${className} (ID: ${classId})`);
    
    // 查找该班级所有学生
    const [students] = await connection.execute(
      'SELECT id, real_name FROM profiles WHERE class_id = ?',
      [classId]
    );
    
    if (students.length === 0) {
      console.log(`❌ 该班级没有学生`);
      return;
    }
    
    console.log(`✅ 找到 ${students.length} 名学生`);
    students.forEach(s => console.log(`   - ${s.real_name} (ID: ${s.id})`));
    
    const studentIds = students.map(s => s.id);
    
    // 开始事务
    await connection.beginTransaction();
    
    // 删除学生答题记录
    const [deleteAnswers] = await connection.execute(
      'DELETE FROM student_answers WHERE student_id IN (?)',
      [studentIds.join(',')]
    );
    console.log(`✅ 删除了 ${deleteAnswers.affectedRows} 条答题记录`);
    
    // 删除错题记录
    const [deleteWrong] = await connection.execute(
      'DELETE FROM wrong_questions WHERE student_id IN (?)',
      [studentIds.join(',')]
    );
    console.log(`✅ 删除了 ${deleteWrong.affectedRows} 条错题记录`);
    
    // 删除测试记录
    const [deleteTestRecords] = await connection.execute(
      'DELETE FROM test_records WHERE student_id IN (?)',
      [studentIds.join(',')]
    );
    console.log(`✅ 删除了 ${deleteTestRecords.affectedRows} 条测试记录`);
    
    // 删除考试记录
    const [deleteExamRecords] = await connection.execute(
      'DELETE FROM exam_records WHERE student_id IN (?)',
      [studentIds.join(',')]
    );
    console.log(`✅ 删除了 ${deleteExamRecords.affectedRows} 条考试记录`);
    
    await connection.commit();
    console.log('\n🎉 清理完成！');
    
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('❌ 清理失败:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
    process.exit(0);
  }
}

const className = process.argv[2] || '高一4';
console.log(`准备清空班级 "${className}" 的做题数据...\n`);
clearClassStudentAnswers(className);