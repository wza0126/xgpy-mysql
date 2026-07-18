const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });

const TEST_CLASS_ID = '79691958-faff-48ee-96d2-d2d288129e1b';

// 使用 class_id 字段的表
const TABLES_WITH_CLASS_ID = [
  'app_visibility',
  'prize_class_visibility',
];

// 使用 class_ids(JSON) 字段的表
const TABLES_WITH_CLASS_IDS = [
  'tests',
  'python_tasks',
];

async function deleteClasses() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });

  try {
    await connection.beginTransaction();

    // 获取要删除的班级列表
    const [classes] = await connection.execute(
      'SELECT id, name FROM classes WHERE id != ?',
      [TEST_CLASS_ID]
    );

    if (classes.length === 0) {
      console.log('没有需要删除的班级');
      await connection.rollback();
      await connection.end();
      return;
    }

    const classIds = classes.map(c => c.id);
    console.log(`将删除 ${classIds.length} 个班级:`);
    classes.forEach(c => console.log('  ', c.name));

    // 删除使用 class_id 字段的表记录
    const placeholders = classIds.map(() => '?').join(',');

    for (const table of TABLES_WITH_CLASS_ID) {
      try {
        const [result] = await connection.execute(
          `DELETE FROM ${table} WHERE class_id IN (${placeholders})`,
          classIds
        );
        if (result.affectedRows > 0) {
          console.log(`  删除 ${table} 中 ${result.affectedRows} 条记录`);
        }
      } catch (e) {
        console.log(`  ${table}: ${e.message}`);
      }
    }

    // 处理使用 class_ids(JSON) 字段的表 - 只从 JSON 中移除对应的 class_id
    for (const table of TABLES_WITH_CLASS_IDS) {
      try {
        // 先查询有多少行涉及到这些班级
        const [rows] = await connection.execute(`SELECT id, class_ids FROM ${table}`);
        let updatedCount = 0;
        let deletedCount = 0;

        for (const row of rows) {
          if (!row.class_ids) continue;
          let idsArray;
          try {
            idsArray = JSON.parse(row.class_ids);
          } catch (e) { continue; }
          if (!Array.isArray(idsArray)) continue;

          const filtered = idsArray.filter(id => !classIds.includes(id));
          if (filtered.length !== idsArray.length) {
            if (filtered.length === 0) {
              // 如果没有剩下的班级，设为 null 或删除整行
              const [r] = await connection.execute(`UPDATE ${table} SET class_ids = NULL WHERE id = ?`, [row.id]);
              updatedCount += r.affectedRows;
            } else {
              const [r] = await connection.execute(`UPDATE ${table} SET class_ids = ? WHERE id = ?`, [JSON.stringify(filtered), row.id]);
              updatedCount += r.affectedRows;
            }
          }
        }
        if (updatedCount > 0) {
          console.log(`  更新 ${table} 中 ${updatedCount} 条记录的 class_ids`);
        }
      } catch (e) {
        console.log(`  ${table}: ${e.message}`);
      }
    }

    // 更新 profiles 表中 class_id 引用为 NULL
    const [profileResult] = await connection.execute(
      `UPDATE profiles SET class_id = NULL WHERE class_id IN (${placeholders})`,
      classIds
    );
    console.log(`  profiles 表中 ${profileResult.affectedRows} 个 profile 的 class_id 置空`);

    // 删除班级
    const [classResult] = await connection.execute(
      `DELETE FROM classes WHERE id IN (${placeholders})`,
      classIds
    );
    console.log(`  删除 classes 中 ${classResult.affectedRows} 个班级`);

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

deleteClasses().catch(console.error);
