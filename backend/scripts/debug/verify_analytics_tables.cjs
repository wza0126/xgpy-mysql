/**
 * 验证：学情分析两张表的改造（2026-09-23）
 *
 * 需求：
 *   1) 「学生详细数据」新增「总掌握」列；各列可点表头排序；表格固定显示约 15 行、超出滚动。
 *   2) 「章节掌握进度」加字段排序；「按姓名排序」改为按前面的**账号**排；
 *      修复「按掌握率排序」点击报错；并真正显示掌握率字段。
 *
 * 被修复的 bug：
 *   ChapterMasterySection 里 `totalQuestions` 定义在 React.useMemo **之后**，而 useMemo 的
 *   rate 分支里调用了 `totalQuestions(s)` —— 渲染期即命中 const 的 TDZ（ReferenceError），
 *   所以下拉选「按掌握率排序」必报错。且 totalQuestions(s) 忽略了形参、对每名学生返回同一个
 *   值，掌握率排序与掌握总数排序等价；表里也根本没有掌握率列（用户反馈「实际字段也没掌握率」）。
 *
 * 本脚本分两层（不需要数据库 / 服务器，秒级可跑）：
 *   A. 排序口径 —— tsc 进程内编译 frontend/src/utils/tableSort.ts 后直接断言真实函数。
 *   B. 源码接线 —— Analytics.tsx 必须真的用上这些函数与列，且不得再出现 TDZ 写法（回归防护）。
 *
 * 用法：
 *   node scripts/debug/verify_analytics_tables.cjs
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');
const FRONTEND = path.join(BACKEND, '..', 'frontend');
const UTIL_REL = 'src/utils/tableSort.ts';
const ANALYTICS_REL = 'src/components/teacher/Analytics.tsx';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

function loadTs(rel) {
  const tsPath = path.join(FRONTEND, 'node_modules', 'typescript');
  if (!fs.existsSync(tsPath)) {
    console.error('找不到 typescript：' + tsPath + '\n请先在 frontend 下 npm install');
    process.exit(2);
  }
  const ts = require(tsPath);
  const src = fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
  return mod.exports;
}

const { sortStudentRows, detailSortValue, masteryRate, sortMasteryRows } = loadTs(UTIL_REL);

// ─────────────────────────────────────────────────────────────────────────────
// 测试数据：账号顺序刻意与姓名（拼音）顺序**不一致**，用于区分「按账号」还是「按姓名」
//   账号序 01(王五) < 05(李四) < 09(张三)
//   姓名序 李四(li) < 王五(wang) < 张三(zhang)  → 05, 01, 09
// ─────────────────────────────────────────────────────────────────────────────
const rows = () => ([
  { id: 'a', username: '20230105', real_name: '李四', current_points: 100, max_points: 200, total_answers: 10, accuracy: 50, total_mastered: 5, has_pet: true, pet_level: 1 },
  { id: 'b', username: '20230101', real_name: '王五', current_points: 300, max_points: 300, total_answers: 20, accuracy: 80, total_mastered: 9, has_pet: false, pet_level: 0 },
  { id: 'c', username: '20230109', real_name: '张三', current_points: 200, max_points: 250, total_answers: 15, accuracy: 70, total_mastered: 7, has_pet: true, pet_level: 2 },
]);
const acct = (list) => list.map((s) => s.username).join(',');

section('A1 学生详细数据：按「账号 姓名」排序（账号在前）');
{
  const asc = sortStudentRows(rows(), { key: 'label', asc: true });
  check('账号升序 = 01,05,09', acct(asc) === '20230101,20230105,20230109', acct(asc));
  check('是账号序而非姓名拼音序（首位应为「王五」）', asc[0].real_name === '王五', asc[0].real_name);
  const desc = sortStudentRows(rows(), { key: 'label', asc: false });
  check('账号降序 = 09,05,01', acct(desc) === '20230109,20230105,20230101', acct(desc));
}

section('A2 学生详细数据：数值字段升降序');
{
  const desc = sortStudentRows(rows(), { key: 'current_points', asc: false });
  check('当前积分降序 = 01(300),09(200),05(100)', acct(desc) === '20230101,20230109,20230105', acct(desc));
  const asc = sortStudentRows(rows(), { key: 'current_points', asc: true });
  check('当前积分升序 = 05,09,01', acct(asc) === '20230105,20230109,20230101', acct(asc));
  check('正确率升序 = 05(50),09(70),01(80)',
    acct(sortStudentRows(rows(), { key: 'accuracy', asc: true })) === '20230105,20230109,20230101');
  check('总掌握降序 = 01(9),09(7),05(5)',
    acct(sortStudentRows(rows(), { key: 'total_mastered', asc: false })) === '20230101,20230109,20230105');
  check('最高积分升序 = 05(200),09(250),01(300)',
    acct(sortStudentRows(rows(), { key: 'max_points', asc: true })) === '20230105,20230109,20230101');
  check('做题量降序 = 01(20),09(15),05(10)',
    acct(sortStudentRows(rows(), { key: 'total_answers', asc: false })) === '20230101,20230109,20230105');
}

section('A3 学生详细数据：萌宠（未领养视为最低，降序时排最后）');
{
  const desc = sortStudentRows(rows(), { key: 'pet_level', asc: false });
  check('降序：Lv.2, Lv.1, 未领养', acct(desc) === '20230109,20230105,20230101', acct(desc));
  check('降序时未领养排最后', desc[desc.length - 1].has_pet === false);
  const asc = sortStudentRows(rows(), { key: 'pet_level', asc: true });
  check('升序：未领养（视为最低）排最前', acct(asc) === '20230101,20230105,20230109', acct(asc));
}

section('A4 学生详细数据：边界与不副作用');
{
  const input = rows();
  const before = acct(input);
  sortStudentRows(input, { key: 'current_points', asc: false });
  check('不修改传入数组（返回副本）', acct(input) === before, acct(input));

  const tie = [
    { id: 'x', username: '20230108', real_name: '甲', current_points: 50 },
    { id: 'y', username: '20230102', real_name: '乙', current_points: 50 },
  ];
  check('同值按账号稳定排序', acct(sortStudentRows(tie, { key: 'current_points', asc: false })) === '20230102,20230108');

  check('缺字段不炸且取 0', detailSortValue({}, 'current_points') === 0 && detailSortValue({}, 'total_mastered') === 0);
  check('缺账号时 label 退化为姓名', detailSortValue({ real_name: '张三' }, 'label') === '张三');
  check('空数组安全', sortStudentRows([], { key: 'label', asc: true }).length === 0);
}

section('A5 章节掌握进度：掌握率计算');
{
  check('5/20 → 25%', masteryRate({ total_mastered: 5 }, 20) === 25);
  check('1/3 → 33%（四舍五入）', masteryRate({ total_mastered: 1 }, 3) === 33);
  check('分母为 0 → 0%（不产生 NaN/Infinity）', masteryRate({ total_mastered: 5 }, 0) === 0);
  check('缺字段 → 0%', masteryRate({}, 20) === 0);
}

section('A6 章节掌握进度：三种排序 + 只看有进度');
{
  const m = () => ([
    { id: 'a', username: '20230105', real_name: '李四', total_mastered: 2 },
    { id: 'b', username: '20230101', real_name: '王五', total_mastered: 0 },
    { id: 'c', username: '20230109', real_name: '张三', total_mastered: 5 },
  ]);
  check('按账号 姓名排序 = 01,05,09', acct(sortMasteryRows(m(), 'name', 10)) === '20230101,20230105,20230109', acct(sortMasteryRows(m(), 'name', 10)));
  check('按掌握总数降序 = 09(5),05(2),01(0)', acct(sortMasteryRows(m(), 'mastered', 10)) === '20230109,20230105,20230101');
  check('按掌握率降序不报错且 = 09(50%),05(20%),01(0%)', acct(sortMasteryRows(m(), 'rate', 10)) === '20230109,20230105,20230101');
  check('只看有进度 → 过滤掉 0 掌握', sortMasteryRows(m(), 'name', 10, true).length === 2);
  const input = m();
  sortMasteryRows(input, 'mastered', 10);
  check('不修改传入数组', acct(input) === '20230105,20230101,20230109', acct(input));
}

// ─────────────────────────────────────────────────────────────────────────────
section('B1 接线：学生详细数据表');
{
  const src = fs.readFileSync(path.join(FRONTEND, ANALYTICS_REL), 'utf8');
  const iDetail = src.indexOf('学生详细数据');
  check('存在「学生详细数据」区块', iDetail > 0);
  check('从 utils/tableSort 引入排序函数', src.includes("from '../../utils/tableSort'"));
  check('表体按排序状态渲染', src.includes('sortStudentRows(students, detailSort)'));
  check('新增「总掌握」列', /key:\s*'total_mastered',\s*label:\s*'总掌握'/.test(src));
  check('7 列（含总掌握）', (src.match(/key:\s*'(label|current_points|max_points|total_answers|accuracy|total_mastered|pet_level)',\s*label:/g) || []).length === 7);
  check('表头可点击切换排序', src.includes('setDetailSort((s) =>'));
  check('排序指示箭头', src.includes("fa-caret-${detailSort.asc ? 'up' : 'down'}") && src.includes('fa-sort'));
  check('表格限高约 15 行', /maxHeight:\s*'768px'/.test(src), "768px");
  check('表头吸顶（滚动时不跑）', src.indexOf('sticky top-0 z-10', iDetail) > iDetail);
  check('空班级有占位行', src.includes('colSpan={7}'));
  check('总掌握复用章节掌握接口（同口径）',
    (src.match(/\/api\/teacher\/analytics\/chapter-mastery\//g) || []).length >= 2,
    '出现 ' + (src.match(/\/api\/teacher\/analytics\/chapter-mastery\//g) || []).length + ' 次');
  check('总掌握由该接口结果回填', src.includes('masteryMap.get(s.id)'));
}

section('B2 接线：章节掌握进度表');
{
  const src = fs.readFileSync(path.join(FRONTEND, ANALYTICS_REL), 'utf8');
  check('排序交给 utils/tableSort.sortMasteryRows', src.includes('sortMasteryRows(allStudents, sortBy, totalQuestions, onlyStarted)'));
  check('新增「掌握率」列', src.includes('掌握率'));
  check('掌握率单元格带分母调用', src.includes('masteryRate(s, totalQuestions)'));
  check('表头可点击排序（name/mastered/rate）',
    src.includes("setSortBy('name')") && src.includes("setSortBy('mastered')") && src.includes("setSortBy('rate')"));
  check('下拉文案改为「按账号 姓名排序」', src.includes('按账号 姓名排序'));
  check('表头与下拉状态一致', src.includes("sortBy === 'rate' &&") && src.includes("sortBy === 'mastered' &&"));
}

section('B3 回归防护：不得再出现 TDZ 写法');
{
  const src = fs.readFileSync(path.join(FRONTEND, ANALYTICS_REL), 'utf8');
  check('totalQuestions 不再是函数（不得出现 totalQuestions( 调用）', !/totalQuestions\s*\(/.test(src));
  check('totalQuestions 仍以 useMemo 求值', src.includes('const totalQuestions = React.useMemo('));
  const iDefine = src.indexOf('const totalQuestions = React.useMemo(');
  const iUse = src.indexOf('sortMasteryRows(allStudents, sortBy, totalQuestions');
  check('先定义后使用（定义位置在使用之前）', iDefine > 0 && iUse > iDefine, `define@${iDefine} use@${iUse}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('失败项：');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('全部通过 ✅');
