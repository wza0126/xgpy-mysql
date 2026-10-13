/**
 * restore-missing-migrations.cjs
 *
 * 用途：把 src/embedded-migrations.js 里存在、但 database/migrations/ 目录下
 *       缺失的迁移，反向落盘回源目录。
 *
 * 背景：embedded-migrations.js 是 scripts/embed-migrations.js 从
 *       backend/database/migrations/*.sql 生成的产物。如果某个 .sql 从未提交
 *       到 git（只在本地生成过 embedded），那么 CI 打包时重新执行
 *       embed-migrations.js 就会把它丢掉 —— exe 里随之缺失该迁移。
 *
 * 本脚本只「补文件、不删不改」，先 dry-run 打印差异。
 */
const fs = require('fs');
const path = require('path');

const embedded = require('../../src/embedded-migrations');
const migrationsDir = path.resolve(__dirname, '../../database/migrations');

function main() {
  const apply = process.argv.includes('--apply');
  let missing = 0;

  for (const m of embedded) {
    const target = path.join(migrationsDir, m.version);
    if (!fs.existsSync(target)) {
      missing++;
      console.log(`[缺失] ${m.version}  (${m.sql.length} chars)`);
      if (apply) {
        fs.writeFileSync(target, m.sql, 'utf8');
        console.log(`       -> 已写入 ${path.relative(process.cwd(), target)}`);
      }
    }
  }

  if (missing === 0) {
    console.log('OK：embedded 与 migrations 目录完全一致（无缺失文件）');
  } else if (!apply) {
    console.log(`\n共 ${missing} 个缺失文件。加 --apply 参数执行写入。`);
  } else {
    console.log(`\n共恢复 ${missing} 个文件。`);
  }
}

main();
