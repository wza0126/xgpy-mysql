const { poolNoDB } = require('../src/db');
const DATABASE_NAME = process.env.DB_NAME || 'xgpy';

async function main() {
  const connection = await poolNoDB.getConnection();
  try {
    await connection.query(`USE ${DATABASE_NAME}`);
    console.log('Cleaning failed migration record...');
    await connection.query(`DELETE FROM schema_migrations WHERE version = '003_add_concurrency_constraints.sql'`);
    console.log('Done');
  } finally {
    connection.release();
    process.exit(0);
  }
}

main().catch(console.error);
