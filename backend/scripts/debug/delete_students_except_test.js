const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

// 要排除的班级（保留test班级）
const EXCLUDED_CLASS_IDS = [
  '79691958-faff-48ee-96d2-d2d288129e1b', // test
];

// 按依赖顺序删除学生数据的表（先删子表数据，再删主表）
// 使用 student_id 字段的表
const TABLES_WITH_STUDENT_ID = [
  'app_usage_logs',
  'student_app_usage',
  'app_reviews',
  'student_word_progress',
  'notification_recipients',
  'point_transactions',
  'exchange_records',
  'code_snippets',
  'wrong_questions',
  'student_answers',
  'test_records',
  'exam_records',
  'notes',
  'student_pets',
];

// 使用 user_id 字段的表
const TABLES_WITH_USER_ID = [
  'login_sessions',
  'login_history',
];

async function deleteStudentData() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });

  try {
    await connection.beginTransaction();

    // 1. 获取要删除的学生ID列表（排除test班级）
    let students;
    if (EXCLUDED_CLASS_IDS.length > 0) {
      const placeholders = EXCLUDED_CLASS_IDS.map(() => '?').join(',');
      const [rows] = await connection.execute(
        `SELECT id, username, real_name, class_id FROM profiles 
         WHERE role = 'student' AND class_id NOT IN (${placeholders})`,
        EXCLUDED_CLASS_IDS
      );
      students = rows;
    } else {
      const [rows] = await connection.execute(
        `SELECT id, username, real_name, class_id FROM profiles WHERE role = 'student'`
      );
      students = rows;
    }

    if (students.length === 0) {
      console.log('没有找到需要删除的学生');
      await connection.rollback();
      return;
    }

    const studentIds = students.map(s => s.id);
    const classIds = [...new Set(students.map(s => s.class_id))];

    console.log(`找到 ${students.length} 个学生，分布在 ${classIds.length} 个班级`);

    // 2. 按顺序删除各表中的学生数据 (student_id)
    for (const table of TABLES_WITH_STUDENT_ID) {
      const placeholders = studentIds.map(() => '?').join(',');
      try {
        const [result] = await connection.execute(
          `DELETE FROM ${table} WHERE student_id IN (${placeholders})`,
          studentIds
        );
        if (result.affectedRows > 0) {
          console.log(`  删除 ${table} 中 ${result.affectedRows} 条记录`);
        }
      } catch (e) {
        console.log(`  ${table}: ${e.message}`);
      }
    }

    // 3. 删除使用 user_id 的表
    for (const table of TABLES_WITH_USER_ID) {
      const placeholders = studentIds.map(() => '?').join(',');
      try {
        const [result] = await connection.execute(
          `DELETE FROM ${table} WHERE user_id IN (${placeholders})`,
          studentIds
        );
        if (result.affectedRows > 0) {
          console.log(`  删除 ${table} 中 ${result.affectedRows} 条记录`);
        }
      } catch (e) {
        console.log(`  ${table}: ${e.message}`);
      }
    }

    // 4. 删除 profiles 表中的学生记录
    const profilePlaceholders = studentIds.map(() => '?').join(',');
    const [profileResult] = await connection.execute(
      `DELETE FROM profiles WHERE id IN (${profilePlaceholders})`,
      studentIds
    );
    console.log(`  删除 profiles 中 ${profileResult.affectedRows} 条学生记录`);

    await connection.commit();
    console.log('\n删除完成！');
    console.log(`共删除 ${students.length} 个学生的所有数据`);

  } catch (error) {
    await connection.rollback();
    console.error('删除失败:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

deleteStudentData().catch(console.error);
