require('./env');
const mysql = require('mysql2/promise');

// 读取环境变量配置，默认为开发环境
const config = {
  host: process.env.DB_HOST || '192.168.10.110',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'xgpy',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 100,
  queueLimit: 0,
  timezone: '+08:00',
  // 归还连接前重置会话（COM_RESET_CONNECTION）：防止"未结束的事务""SET FOREIGN_KEY_CHECKS=0"这类会话状态
  // 随连接泄漏给后续请求。默认 false —— 一旦漏写 rollback，半成品事务会被后续请求的 START TRANSACTION 隐式提交。
  resetOnRelease: true,
};

// 创建不带数据库的连接池（用于初始化）
const poolNoDB = mysql.createPool({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  waitForConnections: config.waitForConnections,
  connectionLimit: config.connectionLimit,
  queueLimit: config.queueLimit,
  timezone: config.timezone,
  resetOnRelease: config.resetOnRelease,
});

// 创建带数据库的连接池（正常使用）
const pool = mysql.createPool(config);

module.exports = pool;
module.exports.poolNoDB = poolNoDB;
