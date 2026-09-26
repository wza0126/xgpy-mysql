/**
 * 验证「已应用迁移 checksum 漂移」的处理策略
 *
 * 背景：启动时出现 3 条 `Migration checksum mismatch` 警告（080/087/088）。
 * 诊断结论：这 3 个迁移的 DDL 均已实际生效，漂移属「基线陈旧/无语义改动」：
 *   - 088 = 事后只改了注释（暴击率数字描述 3/7/8/9/10 → 1/3/6/8/10）；
 *   - 080/087 = 文件从未修改过，库里基线由历史版本写入，无法与当前算法对齐。
 * 处理：非严格模式下自动把基线对齐到当前内容（自愈，一次生效、幂等）；
 *      严格模式（MIGRATION_STRICT=1）仍必须抛错——安全网不能丢。
 *
 * 本脚本同时做静态口径断言与真库实测，防止将来有人把 UPDATE 挪到 throw 之前。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '../..');
const DB = { host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' };

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

(async () => {
  section('A. 源码策略：严格模式必须优先于自动对齐');
  const mig = fs.readFileSync(path.join(ROOT, 'src/migrate.js'), 'utf8');
  const strictIdx = mig.indexOf("process.env.MIGRATION_STRICT === '1'");
  const throwIdx = mig.indexOf('throw new Error(message)');
  const updIdx = mig.indexOf('UPDATE schema_migrations SET checksum');
  ok('存在 MIGRATION_STRICT 严格模式分支', strictIdx > 0);
  ok('严格模式会抛错（不静默）', throwIdx > strictIdx && throwIdx - strictIdx < 200);
  ok('自动对齐的 UPDATE 存在', updIdx > 0);
  ok('⛔ 顺序：throw 早于 UPDATE（严格模式下不会写库）', throwIdx < updIdx,
    `throw@${throwIdx} UPDATE@${updIdx}`);
  ok('对齐后仍 continue（不重跑已应用迁移）',
    /UPDATE schema_migrations SET checksum[\s\S]{0,300}continue;/.test(mig));
  ok('对齐有日志可追溯', /迁移基线已对齐/.test(mig));

  section('B. 已应用的迁移不会再被重跑');
  ok('仅对 existingChecksum 存在时进入对齐分支',
    /if \(existingChecksum\)[\s\S]{0,120}if \(existingChecksum !== checksum\)/.test(mig));

  section('C. 基线对齐不影响备份导入导出');
  const dio = fs.readFileSync(path.join(ROOT, 'src/data-io.js'), 'utf8');
  ok('schema_migrations 在 SKIP_TABLES', /SKIP_TABLES[\s\S]{0,200}schema_migrations/.test(dio));

  section('D. 真库实测：已应用迁移的 checksum 与当前内嵌内容一致');
  const embedded = require(path.join(ROOT, 'src/embedded-migrations.js'));
  const embMap = new Map(embedded.map(m => [m.version, m.sql]));
  const conn = await mysql.createConnection(DB);
  const [rows] = await conn.query('SELECT version, checksum FROM schema_migrations');
  const sha = s => crypto.createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex');

  let mismatch = [], missing = [];
  for (const row of rows) {
    const sql = embMap.get(row.version);
    if (sql === undefined) { missing.push(row.version); continue; }
    if (sha(sql) !== row.checksum) mismatch.push(row.version);
  }
  ok(`全部 ${rows.length} 条已应用迁移 checksum 一致`, mismatch.length === 0,
    mismatch.length ? '不一致: ' + mismatch.join(', ') : '0 条漂移');

  // 已知历史遗留：早期存在过「同号不同名」的迁移文件，后来被替换（旧文件已从磁盘移除），
  // 库里仍留着旧记录。migrate.js 只遍历内嵌清单，这些孤儿记录不会被检查，不影响启动。
  // 此处锁定该清单——将来若出现**新的**孤儿记录（= 迁移文件被误删/误改名）则报警。
  const KNOWN_ORPHANS = new Set([
    '071_add_pk_qualification.sql',
    '072_add_roll_call_marks.sql',
    '073_add_roll_call_class_memo.sql',
  ]);
  const unknownOrphans = missing.filter(v => !KNOWN_ORPHANS.has(v));
  ok('孤儿记录仅为已知历史遗留（同号被替换的旧文件）', unknownOrphans.length === 0,
    unknownOrphans.length ? '新增孤儿: ' + unknownOrphans.join(', ') : `已知 ${missing.length} 条，无新增`);

  section('E. 关键迁移的 DDL 确实已生效（对齐不应掩盖未执行）');
  const hasTable = async n => {
    const [r] = await conn.query(
      "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema='xgpy' AND table_name=?", [n]);
    return r[0].n > 0;
  };
  const hasCols = async (tb, cols) => {
    const [r] = await conn.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name IN (?)',
      ['xgpy', tb, cols]);
    return r.length;
  };
  ok('080 question_cluster_tasks', await hasTable('question_cluster_tasks'));
  ok('087 pk_rank_history', await hasTable('pk_rank_history'));
  ok('087 profiles 4 个 PK 列',
    (await hasCols('profiles', ['pk_streak_3_times', 'pk_flawless_times', 'pk_comeback_times', 'pk_win_streak'])) === 4);
  ok('087 pk_battle_configs 掉落 2 列',
    (await hasCols('pk_battle_configs', ['equipment_drop_enabled', 'equipment_drop_multiplier'])) === 2);
  ok('088 student_skins.unlock_source',
    (await hasCols('student_skins', ['unlock_source'])) === 1);
  await conn.end();

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('脚本异常:', e); process.exit(1); });
