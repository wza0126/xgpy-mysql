const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

const TABLES_WITH_STUDENT_ID = [
  'ai_qa_history',
  'python_drafts',
  'python_gradings',
  'python_run_logs',
  'python_submissions',
];

const TABLES_WITH_USER_ID = [
  'login_history',
  'mental_health_alerts',
  'mental_health_chat_history',
  'python_magic_progress',
];

async function cleanup() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });

  try {
    await connection.beginTransaction();

    console.log('清理孤立记录...\n');

    for (const table of TABLES_WITH_STUDENT_ID) {
      try {
        const [result] = await connection.execute(
          `DELETE FROM ${table} WHERE student_id NOT IN (SELECT id FROM profiles)`
        );
        if (result.affectedRows > 0) {
          console.log(`  ${table}: 删除 ${result.affectedRows} 条`);
        }
      } catch (e) {
        console.log(`  ${table}: 错误 - ${e.message}`);
      }
    }

    for (const table of TABLES_WITH_USER_ID) {
      try {
        const [result] = await connection.execute(
          `DELETE FROM ${table} WHERE user_id NOT IN (SELECT id FROM profiles)`
        );
        if (result.affectedRows > 0) {
          console.log(`  ${table}: 删除 ${result.affectedRows} 条`);
        }
      } catch (e) {
        console.log(`  ${table}: 错误 - ${e.message}`);
      }
    }

    await connection.commit();
    console.log('\n清理完成！');
  } catch (error) {
    await connection.rollback();
    console.error('清理失败:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

cleanup().catch(console.error);
