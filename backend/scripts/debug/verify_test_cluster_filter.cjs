/**
 * 验证：普通测试「创建测试 → 选择题目范围 → AI 聚类筛选」在抽题时真正生效
 *
 * 被验证的 bug（2026-09-22 修复）：
 *   学生端 TestModule.startTest() 只按 test.tag_filters 过滤题目，**完全没读 test.cluster_filters**，
 *   于是教师选中类目后，抽出的题目并不落在所选类目中（标签筛选正常，聚类筛选形同虚设）。
 *
 * 本脚本分两层验证（都不需要数据库 / 服务器，秒级可跑）：
 *   A. 匹配口径 —— 用 tsc 编译 frontend/src/utils/clusterFilters.ts 后直接断言，
 *      必须与后端 submit-test 里的 hitClusterFilter() 同口径：
 *      一级按 primary 分组（组间 OR）；某组只填一级 = 该一级全收；组内指定二级则二级 OR。
 *   B. 源码接线 —— TestModule.startTest 必须在「标签过滤之后」调用 matchDbClusterFilters，
 *      防止将来重构把这一步又删掉（这正是本次 bug 的形态）。
 *
 * 用法：
 *   node scripts/debug/verify_test_cluster_filter.cjs
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');
const FRONTEND = path.join(BACKEND, '..', 'frontend');
const UTIL_REL = 'src/utils/clusterFilters.ts';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

// ── A. 编译真实代码并断言匹配口径 ───────────────────────────────────────────
/**
 * 用 TypeScript 编译器 API 在**进程内**把真实源码转成 CJS 再执行。
 * ⚠️ 不要用 spawnSync 去起 node 跑 tsc：本机沙箱里 spawn 自身可执行文件会 EBUSY
 *（Windows + 沙箱文件锁），实测直接失败。
 */
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

const { parseDbClusterFilters, matchDbClusterFilters } = loadUtil();

section('A1 解析 parseDbClusterFilters（兼容 JSON 字符串 / 数组 / 脏数据）');
{
  const fromString = parseDbClusterFilters('[{"primary":"信息系统","secondary":"分类与类型"},{"primary":"算法","secondary":""}]');
  check('JSON 字符串 → 解析出 2 条', fromString.length === 2, JSON.stringify(fromString));
  check('primary 保真', fromString[0].primary === '信息系统');
  check('secondary 保真', fromString[0].secondary === '分类与类型' && fromString[1].secondary === '');
  check('数组直接传入', parseDbClusterFilters([{ primary: 'A', secondary: '' }]).length === 1);
  check('null → []', parseDbClusterFilters(null).length === 0);
  check('缺 primary 的脏条目被丢弃', parseDbClusterFilters([{ secondary: 'x' }, { primary: 'B' }]).length === 1);
  check('secondary 非字符串 → 归一为空串（= 一级全收）',
    parseDbClusterFilters([{ primary: 'B', secondary: 123 }])[0].secondary === '');
}

section('A2 匹配：空筛选 = 不限制');
{
  check('空筛选 → 任意题命中', matchDbClusterFilters('A/x', []) === true);
  check('空筛选 + 题无 cluster_id → 命中', matchDbClusterFilters(null, []) === true);
}

section('A3 匹配：只选一级 → 该一级下全收（含只挂一级的题）');
{
  const f = [{ primary: 'A', secondary: '' }];
  check('A/任意二级 命中', matchDbClusterFilters('A/x', f) === true);
  check('A 只挂一级 命中', matchDbClusterFilters('A', f) === true);
  check('B/x 不命中', matchDbClusterFilters('B/x', f) === false);
  check('题无 cluster_id 不命中', matchDbClusterFilters(null, f) === false);
  check('cluster_id 为空串不命中', matchDbClusterFilters('   ', f) === false);
}

section('A4 匹配：指定二级 → 必须精确命中，且只挂一级的题不命中');
{
  const f = [{ primary: 'A', secondary: 'x' }];
  check('A/x 命中', matchDbClusterFilters('A/x', f) === true);
  check('A/y 不命中', matchDbClusterFilters('A/y', f) === false);
  check('A 只挂一级 不命中（筛选指定了二级）', matchDbClusterFilters('A', f) === false);
}

section('A5 混合：「某一级全收」不受「另一级的二级限定」影响（易错点）');
{
  // 与后端 hitClusterFilter 同口径：按 primary 分组判定
  const f = [{ primary: 'A', secondary: '' }, { primary: 'B', secondary: 'x' }];
  check('A/y → 命中（A 是整章收）', matchDbClusterFilters('A/y', f) === true);
  check('A 只挂一级 → 命中', matchDbClusterFilters('A', f) === true);
  check('B/x → 命中', matchDbClusterFilters('B/x', f) === true);
  check('B/y → 不命中', matchDbClusterFilters('B/y', f) === false);
  check('C/z → 不命中', matchDbClusterFilters('C/z', f) === false);
  check('同一级填了 2 个二级 → 二级 OR', 
    matchDbClusterFilters('B/y', [{ primary: 'B', secondary: 'x' }, { primary: 'B', secondary: 'y' }]) === true);
}

section('A6 抽题管线：标签 AND 聚类（两类都选时需同时满足）');
{
  const pool = [
    { id: 'q1', tags: '["基础"]', cluster_id: 'A/x' },
    { id: 'q2', tags: '["基础"]', cluster_id: 'B/y' },
    { id: 'q3', tags: '["进阶"]', cluster_id: 'A/y' },
    { id: 'q4', tags: '["基础","进阶"]', cluster_id: 'A/x' },
  ];
  const tagFilters = ['基础'];
  const clusterFilters = parseDbClusterFilters('[{"primary":"A","secondary":""}]');
  const drawn = pool
    .filter((q) => JSON.parse(q.tags).some((t) => tagFilters.includes(t)))
    .filter((q) => matchDbClusterFilters(q.cluster_id, clusterFilters))
    .map((q) => q.id);
  check('标签=基础 且 聚类=A（整章）→ 只留下 A 类且带基础的题',
    drawn.join(',') === 'q1,q4', '实得: ' + drawn.join(','));
  check('抽出的题全部落在所选类目内',
    drawn.every((id) => (pool.find((q) => q.id === id) || {}).cluster_id.startsWith('A/')) === true);
}

// ── B. 源码接线 ────────────────────────────────────────────────────────────
section('B 源码接线：TestModule.startTest 必须真的用上聚类筛选');
{
  const src = fs.readFileSync(path.join(FRONTEND, 'src/components/student/TestModule.tsx'), 'utf8');
  check('已导入 utils/clusterFilters', src.includes("from '../../utils/clusterFilters'"));
  check('导入的是解析 + 匹配两个函数',
    src.includes('parseDbClusterFilters') && src.includes('matchDbClusterFilters'));
  const startIdx = src.indexOf('const startTest = async');
  check('找到 startTest', startIdx > 0);
  const body = src.slice(startIdx, src.indexOf('const handleAnswer =', startIdx));
  const tagIdx = body.indexOf('testData.tag_filters');
  const parseIdx = body.indexOf('parseDbClusterFilters(testData.cluster_filters)');
  const matchIdx = body.indexOf('matchDbClusterFilters(');
  check('读取了 testData.cluster_filters', parseIdx > 0);
  check('调用了 matchDbClusterFilters 做过滤', matchIdx > 0);
  check('顺序正确：先标签过滤 → 再聚类过滤', tagIdx >= 0 && parseIdx > tagIdx);
  check('过滤后仍按 question_count 截断', /filtered\.sort|filtered\.slice/.test(body));
  check('抽题池为 0 时给出提示（含聚类口径）', /筛选后0道|筛选' : '抽题/.test(body));
}

// ── 汇总 ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(52));
console.log(`通过 ${pass} / 失败 ${fail}`);
if (fail > 0) {
  console.log('失败项：\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('聚类筛选抽题口径与接线均符合预期 ✅');
