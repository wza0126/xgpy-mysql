const pool = require('./db');

async function getSystemConfig() {
  const [rows] = await pool.query('SELECT config_key, value FROM system_config');
  return rows.map(row => ({
    key: row.config_key,
    value: row.value
  }));
}

module.exports = {
  getSystemConfig
};
