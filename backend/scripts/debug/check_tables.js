const { poolNoDB } = require('../src/db');
const DATABASE_NAME = process.env.DB_NAME || 'xgpy';

async function main() {
  const connection = await poolNoDB.getConnection();
  try {
    await connection.query(`USE ${DATABASE_NAME}`);
    
    console.log('=== point_transactions 表结构 ===');
    const [ptColumns] = await connection.query(`DESCRIBE point_transactions`);
    console.table(ptColumns);
    
    console.log('=== student_answers 表结构 ===');
    const [saColumns] = await connection.query(`DESCRIBE student_answers`);
    console.table(saColumns);
    
    console.log('=== lesson_attendance_logs 表结构 ===');
    const [lalColumns] = await connection.query(`DESCRIBE lesson_attendance_logs`);
    console.table(lalColumns);
    
  } finally {
    connection.release();
    process.exit(0);
  }
}

main().catch(console.error);
