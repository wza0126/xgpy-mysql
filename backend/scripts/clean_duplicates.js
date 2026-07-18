const { poolNoDB } = require('../src/db');
const DATABASE_NAME = process.env.DB_NAME || 'xgpy';

async function main() {
  const connection = await poolNoDB.getConnection();
  try {
    await connection.query(`USE ${DATABASE_NAME}`);
    
    console.log('=== 清理 exchange_records 重复数据 ===');
    
    // 查找重复记录
    const [duplicates] = await connection.query(`
      SELECT student_id, prize_id, exchanged_date, MIN(id) as keep_id, COUNT(*) as cnt
      FROM (
        SELECT id, student_id, prize_id, DATE(exchanged_at) as exchanged_date
        FROM exchange_records
      ) t
      GROUP BY student_id, prize_id, exchanged_date
      HAVING cnt > 1
    `);
    
    console.log(`发现 ${duplicates.length} 组重复兑换记录`);
    
    if (duplicates.length > 0) {
      // 删除重复记录，保留每组中ID最小的那条
      for (const dup of duplicates) {
        await connection.query(`
          DELETE FROM exchange_records 
          WHERE student_id = ? AND prize_id = ? 
          AND DATE(exchanged_at) = ? 
          AND id != ?
        `, [dup.student_id, dup.prize_id, dup.exchanged_date, dup.keep_id]);
        console.log(`删除了 ${dup.cnt - 1} 条重复记录: student=${dup.student_id}, prize=${dup.prize_id}, date=${dup.exchanged_date}`);
      }
    }
    
    console.log('=== 清理完成 ===');
    
  } finally {
    connection.release();
    process.exit(0);
  }
}

main().catch(console.error);
