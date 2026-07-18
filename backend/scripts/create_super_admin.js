const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.development' });
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

async function createSuperAdmin() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    port: parseInt(process.env.DB_PORT || '3306')
  });

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('请先设置环境变量 ADMIN_PASSWORD（管理员初始密码），例如:');
    console.error('  set ADMIN_PASSWORD=你的密码 && node scripts/create_super_admin.js');
    process.exit(1);
  }
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  const id = uuidv4();

  try {
    // 先检查是否已有该用户
    const [existing] = await connection.execute(
      'SELECT id, role FROM profiles WHERE username = ?',
      [username]
    );

    if (existing.length > 0) {
      // 已存在，更新角色为 super_admin
      await connection.execute(
        'UPDATE profiles SET role = ? WHERE username = ?',
        ['super_admin', username]
      );
      console.log(`用户 ${username} 已存在，角色已更新为 super_admin (当前ID: ${existing[0].id})`);
    } else {
      // 创建新的 super_admin 用户
      await connection.execute(
        'INSERT INTO profiles (id, username, password_hash, real_name, role, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [id, username, passwordHash, '开发者', 'super_admin']
      );
      console.log(`超级管理员账号创建成功！`);
      console.log(`  用户名: ${username}`);
      console.log(`  密码: ${password}`);
      console.log(`  角色: super_admin`);
    }

    // 验证
    const [verify] = await connection.execute(
      'SELECT id, username, role FROM profiles WHERE username = ?',
      [username]
    );
    console.log(`\n验证结果:`, verify[0]);
  } catch (error) {
    console.error('创建超级管理员失败:', error);
  }

  await connection.end();
}

createSuperAdmin();
