/**
 * Access 操作题判分引擎回归（真 .accdb 文件，不碰数据库）
 * 用法：node backend/scripts/debug/verify_access_op_grader.cjs
 *
 * 断言原则（与 WPS 一致）：不仅"做对的得满分"，还要"做错的只丢对应那一步的分"——
 * 只验证前者会漏掉"评分点串位"这类最危险的错误。
 *
 * 夹具（随仓库走，见 fixtures/）：
 *   accdb_pk_sample.accdb    —— Asset Items 表：13 字段、PrimaryKey on "Asset No"、65 条记录
 *   accdb_multi_sample.accdb —— 畸形/半成品库：必须"不抛错、优雅降级"
 */

'use strict';

const fs = require('fs');
const path = require('path');
const g = require('../../src/access-grader.js');

const FIX = path.join(__dirname, 'fixtures');
const PK_DB = path.join(FIX, 'accdb_pk_sample.accdb');
const BAD_DB = path.join(FIX, 'accdb_multi_sample.accdb');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label + (extra ? '  → ' + extra : '')); console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, label) { ok(a === b, label, `期望 ${JSON.stringify(b)}，实为 ${JSON.stringify(a)}`); }

(async () => {
  console.log('\n=== A. 检查器注册表 ===');
  eq(g.CHECK_KINDS.length, 13, 'A1 共 13 种检查器（一期 9 + 二期 4）');
  ['accdb_table', 'accdb_columns', 'accdb_column_type', 'accdb_primary_key', 'accdb_rows', 'accdb_row_update', 'accdb_sort', 'accdb_filter', 'accdb_object',
   'accdb_query', 'accdb_relation', 'accdb_field_format', 'accdb_export'].forEach((k) => ok(g.CHECK_KINDS.includes(k), 'A2 含检查器 ' + k));

  console.log('\n=== B. 类型归一化 ===');
  eq(g.normType('短文本'), 'text', 'B1 短文本 → text');
  eq(g.normType('整型'), 'integer', 'B2 整型 → integer');
  eq(g.normType('长整型'), 'long', 'B3 长整型 → long');
  eq(g.normType('自动编号'), 'autonumber', 'B4 自动编号 → autonumber');
  eq(g.normType('货币'), 'currency', 'B5 货币 → currency');
  eq(g.normType('日期/时间'), 'date', 'B6 日期/时间 → date');
  eq(g.normType('是/否'), 'boolean', 'B7 是/否 → boolean');

  console.log('\n=== C. 结构摘要 inspectFile（标准答案库） ===');
  const info = await g.inspectFile(PK_DB);
  eq(info.tables.length, 1, 'C1 只有 1 张用户表');
  const t = info.tables[0];
  eq(t.name, 'Asset Items', 'C2 表名 = Asset Items');
  eq(t.columns.length, 13, 'C3 共 13 个字段');
  eq(t.columns[0].name, 'Asset No', 'C4 首字段 = Asset No（顺序敏感）');
  eq(t.row_count, 65, 'C5 65 条记录');
  ok(!!t.primary_key, 'C6 检测到主键');
  eq(t.primary_key.name, 'PrimaryKey', 'C7 主键索引名 = PrimaryKey');
  eq(t.primary_key.columns.length, 1, 'C8 单列主键');
  eq(t.primary_key.columns[0].name, 'Asset No', 'C9 主键列 = Asset No');
  eq(t.primary_key.columns[0].order, 'ASC', 'C10 主键升序');
  const cost = t.columns.find((c) => c.name === 'Cost');
  eq(cost.type_label, '货币', 'C11 Cost 是货币型');
  const no = t.columns.find((c) => c.name === 'Asset No');
  eq(no.type_label, '短文本', 'C12 Asset No 是短文本');
  eq(no.field_size, 5, 'C13 Asset No 字段大小 = 5 字符（库里 10 字节）');

  console.log('\n=== D. 全对卷：应得满分 100 ===');
  const SPEC = {
    full_score: 100,
    steps: [
      { id: 's1', title: '建表与字段', score: 40, checks: [
        { kind: 'accdb_table', table: 'Asset Items', score: 10, label: '表存在' },
        { kind: 'accdb_columns', table: 'Asset Items', columns: t.columns.map((c) => c.name), score: 30, label: '字段名与顺序' },
      ] },
      { id: 's2', title: '主键', score: 20, checks: [
        { kind: 'accdb_primary_key', table: 'Asset Items', columns: ['Asset No'], score: 20, label: '主键' },
      ] },
      { id: 's3', title: '类型', score: 20, checks: [
        { kind: 'accdb_column_type', table: 'Asset Items', column: 'Cost', type: 'currency', score: 20, label: 'Cost 货币' },
      ] },
      { id: 's4', title: '记录', score: 20, checks: [
        { kind: 'accdb_rows', table: 'Asset Items', count: 65, score: 20, label: '记录数 65' },
      ] },
    ],
  };
  const v = g.validateSpec(SPEC, 100);
  ok(v.ok, 'D0 规格无错误', v.errors.join('；'));
  eq(v.total, 100, 'D1 评分点总分 = 100');

  const rA = await g.gradeFile(PK_DB, SPEC);
  eq(rA.score, 100, 'D2 总分 = 100');
  eq(rA.full_score, 100, 'D3 满分 = 100');
  eq(rA.percent, 100, 'D4 得分率 100%');
  ok(rA.passed, 'D5 passed = true');
  ok(rA.steps.every((s) => s.pass), 'D6 每一步都满分');
  ok(rA.steps.every((s) => s.checks.every((c) => c.pass)), 'D7 所有评分点均通过');
  ok(!!rA.sha256 && rA.sha256.length === 64, 'D8 产出 sha256');
  ok(Array.isArray(rA.tables) && rA.tables.includes('Asset Items'), 'D9 回执带表清单');

  console.log('\n=== E. 错卷：只应丢对应步骤的分 ===');
  const SPEC_BAD = JSON.parse(JSON.stringify(SPEC));
  SPEC_BAD.steps[1].checks[0].columns = ['Serial No'];          // 主键写错列
  SPEC_BAD.steps[2].checks[0].type = 'integer';                  // Cost 类型写错
  SPEC_BAD.steps[3].checks[0].count = 66;                        // 记录数写错
  const rB = await g.gradeFile(PK_DB, SPEC_BAD);
  eq(rB.score, 40, 'E1 总分 = 40（只留建表那步）');
  eq(rB.steps[0].obtained, 40, 'E2 步骤1 仍满分');
  eq(rB.steps[1].obtained, 0, 'E3 步骤2 主键 0 分');
  eq(rB.steps[2].obtained, 0, 'E4 步骤3 类型 0 分');
  eq(rB.steps[3].obtained, 0, 'E5 步骤4 记录 0 分');
  ok(rB.steps[1].checks[0].got.includes('Asset No'), 'E6 主键判分回执给出实得列', rB.steps[1].checks[0].got);
  ok(rB.steps[1].checks[0].want.includes('Serial No'), 'E6b 主键判分回执给出期望列', rB.steps[1].checks[0].want);
  ok(!rB.steps[1].checks[0].pass, 'E7 主键评分点不通过');

  console.log('\n=== F. 字段名大写小写 / 顺序敏感 ===');
  const SPEC_ORDER = JSON.parse(JSON.stringify(SPEC));
  SPEC_ORDER.steps[0].checks[1].columns = t.columns.map((c) => c.name).slice().reverse();
  const rC = await g.gradeFile(PK_DB, SPEC_ORDER);
  ok(!rC.steps[0].checks[1].pass, 'F1 字段顺序被颠倒 → 不通过');
  const SPEC_UNORDER = JSON.parse(JSON.stringify(SPEC));
  SPEC_UNORDER.steps[0].checks[1].columns = t.columns.map((c) => c.name).slice().reverse();
  SPEC_UNORDER.steps[0].checks[1].unordered = true;
  SPEC_UNORDER.steps[0].checks.splice(0, 1);                      // 顺带去掉表存在，保持分数结构正确
  const rD = await g.gradeFile(PK_DB, SPEC_UNORDER);
  ok(rD.steps[0].checks[0].pass, 'F2 unordered=true → 忽略顺序通过');

  console.log('\n=== G. 主键"不要主键"（absent）与排序/筛选缺省 ===');
  const SPEC_NO_PK = { full_score: 20, steps: [{ title: '不要主键', score: 20, checks: [
    { kind: 'accdb_primary_key', table: 'Asset Items', absent: true, score: 20 },
  ] }] };
  const rE = await g.gradeFile(PK_DB, SPEC_NO_PK);
  eq(rE.score, 0, 'G1 题目要求"无主键"但表有主键 → 0 分');

  const SPEC_SORT = { full_score: 20, steps: [{ title: '排序', score: 20, checks: [
    { kind: 'accdb_sort', table: 'Asset Items', column: 'Cost', order: 'DESC', score: 20 },
  ] }] };
  const rF = await g.gradeFile(PK_DB, SPEC_SORT);
  eq(rF.score, 0, 'G2 标准库里没排序（属性与行序都不满足）→ 0 分');
  ok(rF.steps[0].checks[0].got.includes('未设置'), 'G3 回执说明 OrderBy 未设置', rF.steps[0].checks[0].got);

  // 默认 auto：属性 或 行序 任一满足即可（学生导入已排序数据时只有行序）
  const WINTER_DB = path.join(FIX, 'access_winter_olympic_ok.accdb');
  const SPEC_SORT_ROW = { full_score: 20, steps: [{ title: '排序', score: 20, checks: [
    { kind: 'accdb_sort', table: '奖牌榜', column: '金牌', order: 'DESC', score: 20 },
  ] }] };
  const rS = await g.gradeFile(WINTER_DB, SPEC_SORT_ROW);
  eq(rS.score, 20, 'G5 冬奥会样卷：金牌降序（只有行序、无 OrderBy 属性）→ 通过');
  ok(rS.steps[0].checks[0].got.includes('行序正确'), 'G6 回执说明按行序判定通过', rS.steps[0].checks[0].got);
  const SPEC_SORT_STRICT = JSON.parse(JSON.stringify(SPEC_SORT_ROW));
  SPEC_SORT_STRICT.steps[0].checks[0].mode = 'property';
  const rS2 = await g.gradeFile(WINTER_DB, SPEC_SORT_STRICT);
  eq(rS2.score, 0, 'G7 mode=property 严格模式下同一样卷 → 0 分');

  const SPEC_FILTER = { full_score: 20, steps: [{ title: '筛选', score: 20, checks: [
    { kind: 'accdb_filter', table: 'Asset Items', column: 'Make', op: '=', value: 'x', score: 20 },
  ] }] };
  const rG = await g.gradeFile(PK_DB, SPEC_FILTER);
  eq(rG.score, 0, 'G4 标准库里没设筛选 → 0 分');

  console.log('\n=== H. 对象存在 / 记录字段值 ===');
  const SPEC_OBJ = { full_score: 20, steps: [{ title: '对象', score: 20, checks: [
    { kind: 'accdb_object', name: 'Asset Items', object_type: 'table', score: 10 },
    { kind: 'accdb_object', name: '不存在的表xyz', absent: true, score: 10 },
  ] }] };
  const rH = await g.gradeFile(PK_DB, SPEC_OBJ);
  eq(rH.score, 20, 'H1 对象检查通过');
  const SPEC_ROWUPD = { full_score: 20, steps: [{ title: '改记录', score: 20, checks: [
    { kind: 'accdb_row_update', table: 'Asset Items', match: { 'Asset No': '30050' }, expect: { Owner: 'Sales' }, score: 20 },
  ] }] };
  const rI = await g.gradeFile(PK_DB, SPEC_ROWUPD);
  eq(rI.score, 20, 'H2 定位记录 + 字段值正确');

  console.log('\n=== I. 畸形库容错（不得抛错） ===');
  let threw = false;
  let rBad = null;
  try { rBad = await g.gradeFile(BAD_DB, SPEC); } catch (e) { threw = true; }
  ok(!threw, 'I1 畸形库不抛错');
  ok(rBad && rBad.score === 0, 'I2 畸形库得 0 分且正常回执');

  console.log('\n=== J. 规格校验 ===');
  const bad = g.validateSpec({ full_score: 10, steps: [{ title: 'x', score: 5, checks: [{ kind: 'nope', score: 5 }] }] }, 10);
  ok(!bad.ok, 'J1 未知检查类型被拦截');
  ok(bad.warnings.length >= 1, 'J2 总分不一致有警告');
  const exp = g.validateSpec({ full_score: 10, steps: [{ title: 'y', score: 10, checks: [{ kind: 'accdb_field_format', table: 'T', format: 'currency', score: 10 }] }] }, 10);
  ok(exp.ok && exp.warnings.some((w) => w.includes('实验性')), 'J3 accdb_field_format 触发实验性警告');

  console.log('\n=== K. 二期 · 查询检查器（pk_sample 内置 3 个真实查询） ===');
  const mQ = g.buildModel(fs.readFileSync(PK_DB));
  eq(mQ.queries.length, 3, 'K1 解析出 3 个用户查询（~sq_ 隐藏查询被排除）');
  const q1 = mQ.queryByName.get('qrycomputerhardwareinownerorder');
  ok(!!q1, 'K2 大小写不敏感取查询');
  eq(q1.tables.join(','), 'Asset Items', 'K3 数据源 = Asset Items');
  eq(q1.select.length, 6, 'K4 输出 6 列');
  ok(q1.where.length === 1 && q1.where[0].includes('Computer Hardware'), 'K5 WHERE 条件解析');
  ok(q1.orderBy.length === 1 && q1.orderBy[0].includes('Owner'), 'K6 ORDER BY 解析');
  const specQ = { steps: [
    { title: '存在', score: 2, checks: [{ kind: 'accdb_query', name: 'qryComputerHardwareInOwnerOrder', score: 2 }] },
    { title: '数据源+列', score: 3, checks: [{ kind: 'accdb_query', name: 'qryComputerHardwareInOwnerOrder', from: 'Asset Items', select: ['Asset No', 'Owner'], score: 3 }] },
    { title: '条件', score: 2, checks: [{ kind: 'accdb_query', name: 'qryComputerHardwareInOwnerOrder', where_contains: ['"Computer Hardware"'], score: 2 }] },
    { title: '排序', score: 2, checks: [{ kind: 'accdb_query', name: 'qryComputerHardwareInOwnerOrder', order_by_contains: ['Owner'], score: 2 }] },
    { title: '汇总', score: 3, checks: [{ kind: 'accdb_query', name: 'qryCostsSummedByOwner', select: ['SumOfCost'], group_by_contains: ['Owner'], score: 3 }] },
    { title: '隐藏不算', score: 2, checks: [{ kind: 'accdb_query', name: '~sq_rrptAssetsGroupedByOwners', score: 2 }] },
    { title: '应不存在', score: 2, checks: [{ kind: 'accdb_query', name: '查询xyz', absent: true, score: 2 }] },
    { title: '错列', score: 3, checks: [{ kind: 'accdb_query', name: 'qryCostsSummedByOwner', select: ['不存在列'], score: 3 }] },
  ] };
  const rQ = await g.gradeFile(PK_DB, specQ);
  eq(rQ.score, 14, 'K7 得 14/19（隐藏查询步 + 错列步共丢 5 分）');
  eq(rQ.steps[7].checks[0].pass, false, 'K8 错误输出列只丢该步');
  ok(rQ.steps[7].checks[0].note.includes('不存在列'), 'K9 丢分原因可读');
  ok(rQ.steps[5].checks[0].pass === false, 'K9b 隐藏 ~sq_ 查询判"不存在"（无法被学生命中）');
  const rQn = await g.gradeFile(PK_DB, { steps: specQ.steps.filter((_, i) => i !== 5 && i !== 7) });
  ok(rQn.score === rQn.full_score, 'K10 正确卷满分（含 absent / 隐藏查询排除）');

  console.log('\n=== L. 二期 · 关系检查器（夹具无用户关系：验证系统关系过滤 + 判负路径） ===');
  eq(mQ.relations.length, 0, 'L1 系统关系被过滤（库里原有 MSysAccessStorage/NavPane 关系）');
  const specR = { steps: [
    { title: '应无关系', score: 2, checks: [{ kind: 'accdb_relation', table: 'A', ref_table: 'B', absent: true, score: 2 }] },
    { title: '有关系', score: 2, checks: [{ kind: 'accdb_relation', table: 'A', ref_table: 'B', column: 'x', ref_column: 'y', score: 2 }] },
  ] };
  const rR = await g.gradeFile(PK_DB, specR);
  ok(rR.steps[0].checks[0].pass === true, 'L2 absent:true → 无关系时通过');
  ok(rR.steps[1].checks[0].pass === false, 'L3 无用户关系 → 要求有关系时判负');
  ok((rR.steps[1].checks[0].got || '').includes('没有用户关系') || rR.steps[1].checks[0].got === '无', 'L4 got 文案可读');
  const specR2 = { steps: [{ title: '参数缺失', score: 2, checks: [{ kind: 'accdb_relation', score: 2 }] }] };
  const rR2 = await g.gradeFile(PK_DB, specR2);
  ok(rR2.steps[0].checks[0].pass === false && rR2.steps[0].checks[0].got.includes('参数缺失'), 'L5 缺参数不抛错、判负');

  console.log('\n=== M. 二期 · 字段格式（实验性） ===');
  const specFmt = { steps: [
    { title: '未知格式不误报', score: 2, checks: [{ kind: 'accdb_field_format', table: 'Asset Items', format: 'currency', score: 2 }] },
    { title: '表不存在', score: 2, checks: [{ kind: 'accdb_field_format', table: '没有的表', format: 'fixed', score: 2 }] },
  ] };
  const rFmt = await g.gradeFile(PK_DB, specFmt);
  ok(rFmt.steps[0].checks[0].pass === false, 'M1 夹具无 currency 格式 → 判负（不得误报）');
  ok(rFmt.steps[0].checks[0].note.includes('人工复核'), 'M2 判负注明实验性/人工复核');
  ok(rFmt.steps[1].checks[0].got.includes('表不存在'), 'M3 表不存在正常报');

  console.log('\n=== N. 二期 · 导出附件 ===');
  const xlsxBuf = fs.readFileSync(path.join(FIX, 'access_winter_medals.xlsx'));
  const txtBuf = Buffer.from('国家,金牌,银牌,铜牌\n挪威,16,8,13\n德国,12,10,5\n中国,9,4,2\r\n', 'utf8');
  const gbkBuf = Buffer.from([0xB9, 0xFA, 0xBC, 0xD2, 0x2C, 0xBD, 0xF0, 0xC5, 0xC6, 0x0D, 0x0A]); // '国家,金牌' GBK
  const extras = [
    { name: '奖牌榜导出.txt', kind: 'text', buffer: txtBuf },
    { name: '奖牌榜.xlsx', kind: 'xlsx', buffer: xlsxBuf },
    { name: 'gbk.txt', kind: 'text', buffer: gbkBuf },
  ];
  const specE = { steps: [
    { title: 'txt行数', score: 2, checks: [{ kind: 'accdb_export', type: 'txt', line_count: 4, score: 2 }] },
    { title: 'txt内容含/不含', score: 3, checks: [{ kind: 'accdb_export', type: 'txt', contains: ['挪威', '中国,9'], absent: ['美国'], score: 3 }] },
    { title: 'xlsx单元格', score: 2, checks: [{ kind: 'accdb_export', type: 'xlsx', contains: ['奖牌'], score: 2 }] },
    { title: 'GBK解码', score: 2, checks: [{ kind: 'accdb_export', type: 'txt', match: 'gbk', contains: ['金牌'], score: 2 }] },
    { title: 'match未命中', score: 2, checks: [{ kind: 'accdb_export', type: 'txt', match: '成绩单', score: 2 }] },
    { title: '类型过滤后无附件', score: 2, checks: [{ kind: 'accdb_export', type: 'xlsx', match: '导出', score: 2 }] },
    { title: '完全没附件', score: 2, checks: [{ kind: 'accdb_export', type: 'txt', score: 2 }] },
  ] };
  const rExp = await g.gradeFile(PK_DB, specE, extras);
  eq(rExp.score, 9, 'N1 前四步全对 9 分（match未命中/类型过滤/空条件 三步判负）');
  ok(rExp.extras.length === 3 && rExp.extras.every((x) => !x.error), 'N2 三个附件全部解析成功');
  eq(rExp.extras.find((x) => x.name === '奖牌榜.xlsx').lines, 66, 'N3 xlsx 拆出 66 个非空单元格');
  ok(rExp.steps[4].checks[0].note.includes('文件名'), 'N4 match 未命中提示文件名');
  const rExp2 = await g.gradeFile(PK_DB, specE);
  ok(rExp.steps[6].checks[0].pass === false && rExp.steps[6].checks[0].note.includes('未配置判定条件'), 'N5 空条件不得"交了就给分"');
  eq(rExp2.score, 0, 'N6 不传 extras 时全判负（0 分）');

  console.log('\n=== O. suggestSpec 覆盖查询与关系 ===');
  const sug = await g.suggestSpec(PK_DB, { full_score: 30 });
  ok(sug.steps.some((s) => s.id.startsWith('query_')), 'O1 自动生成查询步骤');
  ok(sug.steps.some((s) => s.id.startsWith('query_') && s.checks.some((c) => c.kind === 'accdb_query' && c.select)), 'O2 查询步骤含输出列检查');
  eq(sug.steps.filter((s) => s.id.startsWith('rel_')).length, 0, 'O3 无用户关系 → 不生成关系步骤');
  const vs = g.validateSpec(sug, 30);
  ok(vs.ok, 'O4 生成的规格通过校验');

  console.log('\n========================================');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('失败项：'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('全部通过 ✅');
})().catch((e) => { console.error('脚本异常：', e); process.exit(1); });
