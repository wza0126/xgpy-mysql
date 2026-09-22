/**
 * 验证：学情分析表格里的学生姓名字段 = 「账号 + 姓名」合成一个字段
 *
 * 需求（2026-09-22）：学情分析表格中的学生姓名字段，在姓名前加上账号，账号与姓名同处一个字段。
 *   例：账号 20230101 + 姓名 张三 → 显示「20230101 张三」（同名同姓靠账号区分）。
 *
 * 本脚本分两层验证（无需数据库 / 服务器）：
 *   A. 显示规则 —— 用 TypeScript 编译器 API 在进程内跑真实实现 frontend/src/utils/studentLabel.ts
 *   B. 接线 —— 学情分析三张表 + 趋势下拉都必须调用 studentLabel，且不再有裸 real_name 渲染
 *
 * 用法：
 *   node scripts/debug/verify_student_label.cjs
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');
const FRONTEND = path.join(BACKEND, '..', 'frontend');
const UTIL_REL = 'src/utils/studentLabel.ts';
const ANALYTICS = 'src/components/teacher/Analytics.tsx';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

/** 用 TS 编译器 API 在进程内转译真实源码（沙箱内 spawn node 会 EBUSY，见 verify_test_cluster_filter.cjs） */
function loadUtil() {
  const tsPath = path.join(FRONTEND, 'node_modules', 'typescript');
  if (!fs.existsSync(tsPath)) {
    console.error('找不到 typescript：' + tsPath + '\n请先在 frontend 下 npm install');
    process.exit(2);
  }
  const ts = require(tsPath);
  const src = fs.readFileSync(path.join(FRONTEND, UTIL_REL), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
  return mod.exports;
}

const { studentLabel } = loadUtil();

section('A1 正常情况：账号在前、姓名在后，同处一个字段');
{
  check('账号 20230101 + 张三 → 「20230101 张三」',
    studentLabel({ username: '20230101', real_name: '张三' }) === '20230101 张三',
    studentLabel({ username: '20230101', real_name: '张三' }));
  check('账号含字母（如 stu01）同样成立',
    studentLabel({ username: 'stu01', real_name: '李四' }) === 'stu01 李四');
  check('结果里账号在姓名之前（索引更小）',
    studentLabel({ username: 'A1', real_name: '王五' }).indexOf('A1') <
    studentLabel({ username: 'A1', real_name: '王五' }).indexOf('王五'));
  check('账号与姓名之间是一个空格（不缺不重）',
    studentLabel({ username: 'A1', real_name: '王五' }) === 'A1 王五');
}

section('A2 退化：缺一半时不留脏字符');
{
  check('只有姓名 → 只显示姓名', studentLabel({ username: '', real_name: '张三' }) === '张三');
  check('只有账号 → 只显示账号', studentLabel({ username: '20230101', real_name: '' }) === '20230101');
  check('字段为 null → 只显示另一半', studentLabel({ username: null, real_name: '张三' }) === '张三');
  check('两边都空 → 占位 -', studentLabel({ username: '', real_name: '' }) === '-');
  check('传 null → 占位 -', studentLabel(null) === '-');
  check('传 undefined → 占位 -', studentLabel(undefined) === '-');
  check('空白串被 trim 不当成账号', studentLabel({ username: '   ', real_name: '张三' }) === '张三');
  check('账号/姓名各自 trim', studentLabel({ username: ' A1 ', real_name: ' 王五 ' }) === 'A1 王五');
}

section('B 源码接线：学情分析各处都走 studentLabel');
{
  const src = fs.readFileSync(path.join(FRONTEND, ANALYTICS), 'utf8');
  const callCount = (src.match(/studentLabel\(/g) || []).length;
  check('已从 utils/studentLabel 导入', src.includes("from '../../utils/studentLabel'"));
  check('调用点共 4 处（学生详细数据 / 学困预警 / 章节掌握进度 / 趋势下拉）',
    callCount === 4, '实得 ' + callCount);
  check('学生详细数据表头已改「账号 姓名」', src.includes('>账号 姓名</th>'));
  check('章节掌握进度左侧固定列表头已改「账号 姓名」', src.includes('\n                    账号 姓名\n'));
  const bareRealName = (src.match(/\{s\.real_name \|\| s\.username\}/g) || []).length;
  check('表格/下拉里不再有裸 real_name || username 渲染', bareRealName === 0,
    '残留 ' + bareRealName + ' 处（图表标签不算）');
}

console.log('\n' + '─'.repeat(52));
console.log(`通过 ${pass} / 失败 ${fail}`);
if (fail > 0) {
  console.log('失败项：\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('学情分析「账号 姓名」显示规则与接线均符合预期 ✅');
