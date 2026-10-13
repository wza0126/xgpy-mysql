/**
 * verify_exe_migrations.cjs
 *
 * 端到端验证：用一个全新临时库跑 runMigrations()，确认
 *   1) 迁移总数 = embedded-migrations.js 的条数（当前 101），最新一条 = embedded 的最后一条
 *   2) 代码农场四表 farm_config / farm_plots / farm_logs / farm_code_slots 真正建出来
 *   3) farm_config 有单行配置记录，且含天气 / 劳作上限 / 默认代码列
 * 结束后 DROP 临时库，不留痕。
 */
process.env.DB_NAME = 'tmp_xgpy_exemig';
process.env.NODE_ENV = 'production';
require('../../src/env');

const { runMigrations } = require('../../src/migrate');
const { poolNoDB } = require('../../src/db');
const embedded = require('../../src/embedded-migrations');

const DB = process.env.DB_NAME;
let pass = 0;
let fail = 0;

function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

async function main() {
  console.log(`临时库: ${DB}`);
  console.log(`embedded 迁移条数: ${embedded.length}\n`);

  await runMigrations();

  const conn = await poolNoDB.getConnection();
  try {
    await conn.query(`USE \`${DB}\``);

    const [tables] = await conn.query('SHOW TABLES');
    const names = tables.map((r) => Object.values(r)[0]);
    check('farm_config 表已建', names.includes('farm_config'));
    check('farm_plots 表已建', names.includes('farm_plots'));
    check('farm_logs 表已建', names.includes('farm_logs'));
    check('farm_code_slots 表已建（100：学生 5 个代码容器）', names.includes('farm_code_slots'));

    const [rows] = await conn.query('SELECT COUNT(*) AS c FROM farm_config');
    check('farm_config 有单行配置', rows[0].c === 1, `count=${rows[0].c}`);

    const [cfgCols] = await conn.query('SHOW COLUMNS FROM farm_config');
    const cfgNames = cfgCols.map((c) => c.Field);
    check('farm_config.weather 列存在（天气设置）', cfgNames.includes('weather'));
    check('farm_config.max_ops_per_day 列存在', cfgNames.includes('max_ops_per_day'));
    check('farm_config.default_code 列存在（098：编辑器默认代码）', cfgNames.includes('default_code'));
    check('farm_config.guide_url 列存在（099：学生手册地址）', cfgNames.includes('guide_url'));
    check('farm_config.guide_name 列存在（099：手册原始文件名）', cfgNames.includes('guide_name'));
    check('farm_config.guide_enabled 列存在（099：桌面手册入口开关）', cfgNames.includes('guide_enabled'));

    const [plotCols] = await conn.query('SHOW COLUMNS FROM farm_plots');
    const plotNames = plotCols.map((c) => c.Field);
    check('farm_plots.ops_today 列存在', plotNames.includes('ops_today'));

    const [slotCols] = await conn.query('SHOW COLUMNS FROM farm_code_slots');
    const slotNames = slotCols.map((c) => c.Field);
    check('farm_code_slots 有 slot / name / code 列（100：学生代码容器）',
      ['slot', 'name', 'code'].every((x) => slotNames.includes(x)), slotNames.join(','));
    const [slotIdx] = await conn.query('SHOW INDEX FROM farm_code_slots WHERE Key_name = ?', ['uk_farm_slot']);
    check('farm_code_slots 有 (student_id, slot) 唯一键（一人 5 格不重复）', slotIdx.length >= 2,
      `index parts=${slotIdx.length}`);

    const [mig] = await conn.query('SELECT COUNT(*) AS c, MAX(version) AS v FROM schema_migrations');
    check('schema_migrations 条数 = embedded 条数', mig[0].c === embedded.length, `${mig[0].c} / ${embedded.length}`);
    const lastVersion = embedded.length ? embedded[embedded.length - 1].version : '';
    check('最新迁移 = embedded 的最后一条（不写死编号）', String(mig[0].v) === String(lastVersion),
      `${mig[0].v} vs ${lastVersion}`);

    // 096 改的是 point_transactions.source_type 枚举，确认 'farm' 已进入枚举
    const [pt] = await conn.query(
      "SHOW COLUMNS FROM point_transactions LIKE 'source_type'",
    );
    const colType = pt.length ? String(pt[0].Type) : '';
    check("point_transactions.source_type 枚举含 'farm'", colType.includes("'farm'"), colType.slice(0, 120));

    // 097 的落脚点：max_ops_per_day 已提到 >= 15
    const [cfg] = await conn.query('SELECT max_ops_per_day FROM farm_config WHERE id = 1');
    check('max_ops_per_day >= 15（劳作按动作计）', Number(cfg[0].max_ops_per_day) >= 15, `=${cfg[0].max_ops_per_day}`);
  } finally {
    conn.release();
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  return fail;
}

main()
  .then(async (failCount) => {
    try {
      await poolNoDB.query(`DROP DATABASE IF EXISTS \`${DB}\``);
      console.log(`已清理临时库 ${DB}`);
    } catch (e) {
      console.error('清理临时库失败:', e.message);
    }
    await poolNoDB.end().catch(() => {});
    process.exit(failCount === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('验证异常:', err);
    try {
      await poolNoDB.query(`DROP DATABASE IF EXISTS \`${DB}\``);
      console.log(`已清理临时库 ${DB}`);
    } catch (e) { /* ignore */ }
    await poolNoDB.end().catch(() => {});
    process.exit(1);
  });
