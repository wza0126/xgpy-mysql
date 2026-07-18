const crypto = require('crypto');
const { poolNoDB } = require('./db');
const embeddedMigrations = require('./embedded-migrations');

const DATABASE_NAME = process.env.DB_NAME || 'xgpy';

function escapeIdentifier(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid database identifier: ${name}`);
  }
  return `\`${name}\``;
}

function normalizeIdentifier(identifier) {
  const trimmed = identifier.trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      current += char;
      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        i++;
        blockComment = false;
      }
      continue;
    }

    if (quote) {
      current += char;
      if (char === '\\') {
        if (next !== undefined) {
          current += next;
          i++;
        }
      } else if (char === '\'' && quote === '\'' && next === '\'') {
        current += next;
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      current += char + next;
      i++;
      lineComment = true;
      continue;
    }

    if (char === '#') {
      current += char;
      lineComment = true;
      continue;
    }

    if (char === '/' && next === '*') {
      current += char + next;
      i++;
      blockComment = true;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

async function ensureMigrationTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SHOW COLUMNS FROM ${escapeIdentifier(table)} LIKE ?`,
    [column],
  );
  return rows.length > 0;
}

async function indexExists(connection, table, indexName) {
  const [rows] = await connection.query(
    `SHOW INDEX FROM ${escapeIdentifier(table)} WHERE Key_name = ?`,
    [indexName],
  );
  return rows.length > 0;
}

async function executeStatement(connection, statement) {
  const normalized = statement.trim();
  const identifier = '`?[A-Za-z0-9_]+`?';

  let match = normalized.match(new RegExp(`^ALTER\\s+TABLE\\s+(${identifier})\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+(${identifier})\\s+([\\s\\S]+)$`, 'i'));
  if (match) {
    const table = normalizeIdentifier(match[1]);
    const column = normalizeIdentifier(match[2]);
    const definition = match[3].trim();
    if (await columnExists(connection, table, column)) return;
    await connection.query(`ALTER TABLE ${escapeIdentifier(table)} ADD COLUMN ${escapeIdentifier(column)} ${definition}`);
    return;
  }

  match = normalized.match(new RegExp(`^ALTER\\s+TABLE\\s+(${identifier})\\s+DROP\\s+COLUMN\\s+IF\\s+EXISTS\\s+(${identifier})\\s*$`, 'i'));
  if (match) {
    const table = normalizeIdentifier(match[1]);
    const column = normalizeIdentifier(match[2]);
    if (!(await columnExists(connection, table, column))) return;
    await connection.query(`ALTER TABLE ${escapeIdentifier(table)} DROP COLUMN ${escapeIdentifier(column)}`);
    return;
  }

  match = normalized.match(new RegExp(`^ALTER\\s+TABLE\\s+(${identifier})\\s+ADD\\s+(?:INDEX|KEY)\\s+IF\\s+NOT\\s+EXISTS\\s+(${identifier})\\s+([\\s\\S]+)$`, 'i'));
  if (match) {
    const table = normalizeIdentifier(match[1]);
    const indexName = normalizeIdentifier(match[2]);
    const indexExpression = match[3].trim();
    if (await indexExists(connection, table, indexName)) return;
    await connection.query(`ALTER TABLE ${escapeIdentifier(table)} ADD INDEX ${escapeIdentifier(indexName)} ${indexExpression}`);
    return;
  }

  match = normalized.match(new RegExp(`^ALTER\\s+TABLE\\s+(${identifier})\\s+ADD\\s+(?:UNIQUE\\s+)?(?:INDEX|KEY|CONSTRAINT)\\s+IF\\s+NOT\\s+EXISTS\\s+(${identifier})\\s+([\\s\\S]+)$`, 'i'));
  if (match) {
    const table = normalizeIdentifier(match[1]);
    const indexName = normalizeIdentifier(match[2]);
    const indexExpression = match[3].trim();
    if (await indexExists(connection, table, indexName)) return;
    if (normalized.toUpperCase().includes('UNIQUE')) {
      await connection.query(`ALTER TABLE ${escapeIdentifier(table)} ADD UNIQUE KEY ${escapeIdentifier(indexName)} ${indexExpression}`);
    } else {
      await connection.query(`ALTER TABLE ${escapeIdentifier(table)} ADD INDEX ${escapeIdentifier(indexName)} ${indexExpression}`);
    }
    return;
  }

  match = normalized.match(new RegExp(`^ALTER\\s+TABLE\\s+(${identifier})\\s+ADD\\s+UNIQUE\\s+IF\\s+NOT\\s+EXISTS\\s+(${identifier})\\s+([\\s\\S]+)$`, 'i'));
  if (match) {
    const table = normalizeIdentifier(match[1]);
    const indexName = normalizeIdentifier(match[2]);
    const indexExpression = match[3].trim();
    if (await indexExists(connection, table, indexName)) return;
    await connection.query(`ALTER TABLE ${escapeIdentifier(table)} ADD UNIQUE KEY ${escapeIdentifier(indexName)} ${indexExpression}`);
    return;
  }

  await connection.query(statement);
}

async function listMigrationFiles() {
  if (embeddedMigrations.length === 0) {
    throw new Error('No embedded migrations found. Run npm run prebuild to generate src/embedded-migrations.js.');
  }
  return embeddedMigrations.map((migration) => migration.version);
}

async function runMigrations() {
  const database = escapeIdentifier(DATABASE_NAME);
  const connection = await poolNoDB.getConnection();

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE ${database}`);
    await ensureMigrationTable(connection);

    const [appliedRows] = await connection.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(appliedRows.map((row) => [row.version, row.checksum]));
    const files = await listMigrationFiles();
    const embeddedByVersion = new Map(
      embeddedMigrations.map((migration) => [migration.version, migration.sql]),
    );

    for (const file of files) {
      const sql = embeddedByVersion.get(file);
      if (!sql) {
        throw new Error(`Embedded migration not found: ${file}`);
      }
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const existingChecksum = applied.get(file);

      if (existingChecksum) {
        if (existingChecksum !== checksum) {
          throw new Error(`Migration checksum mismatch: ${file}`);
        }
        continue;
      }

      const statements = splitSqlStatements(sql);
      console.log(`Applying migration ${file} (${statements.length} statements)`);
      await connection.beginTransaction();
      try {
        for (const statement of statements) {
          await executeStatement(connection, statement);
        }
        await connection.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)',
          [file, checksum],
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }

    console.log('Database migrations are up to date');
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Database migration failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigrations };
