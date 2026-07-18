// 执行数据库迁移
const pool = require('./src/db');

async function migrate() {
  try {
    console.log('开始执行迁移: 添加notification buff字段...');
    
    // 检查字段是否已存在
    const [columns] = await pool.query("SHOW COLUMNS FROM notifications LIKE 'has_buff'");
    
    if (columns.length > 0) {
      console.log('字段已存在，跳过迁移。');
    } else {
      // 执行迁移SQL
      await pool.query(`
        ALTER TABLE notifications
          ADD COLUMN has_buff BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN buff_type VARCHAR(50) DEFAULT NULL,
          ADD COLUMN buff_modifier DECIMAL(5,2) DEFAULT NULL,
          ADD COLUMN buff_duration INT DEFAULT NULL
      `);
      console.log('迁移执行成功！');
    }
    
    // 验证
    const [cols] = await pool.query("SHOW COLUMNS FROM notifications LIKE '%buff%'");
    console.log('\n当前notifications表中的buff相关字段:');
    cols.forEach(c => console.log(`  - ${c.Field}: ${c.Type}`));
    
    await pool.end();
  } catch(e) {
    console.error('迁移失败:', e.message);
    process.exit(1);
  }
}

migrate();
