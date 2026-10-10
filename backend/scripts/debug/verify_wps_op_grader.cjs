/**
 * WPS 操作题判分引擎回归（真文件，不碰数据库）
 * 用法：node backend/scripts/debug/verify_wps_op_grader.cjs
 *
 * 断言原则：不仅要"做对的得满分"，还要"做错的只丢对应那一步的分"——
 * 只验证前者会漏掉"评分点串位"这类最危险的错误。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const g = require('../../src/wps-grader.js');

const FIX = path.join(__dirname, 'fixtures');
const SPEC = JSON.parse(fs.readFileSync(path.join(FIX, 'wps_popshen_spec.json'), 'utf8'));
// 未作答的原始模板（fixtures 里固化的副本，随仓库走）
const TEMPLATE = path.join(FIX, 'source_popshen_template.xlsx');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label + (extra ? '  → ' + extra : '')); console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, label) { ok(a === b, label, `期望 ${JSON.stringify(b)}，实为 ${JSON.stringify(a)}`); }

(async () => {
  console.log('\n=== A. 规格自检 validateSpec ===');
  const v = g.validateSpec(SPEC, 10);
  ok(v.ok, 'A1 规格无错误', v.errors.join('；'));
  eq(v.total, 10, 'A2 评分点总分 = 10');
  eq(v.warnings.length, 0, 'A3 无警告');

  const bad = g.validateSpec({ full_score: 10, steps: [{ title: 'x', score: 5, checks: [{ kind: 'nope', score: 5 }] }] }, 10);
  ok(!bad.ok, 'A4 未知检查类型被拦截');
  ok(bad.warnings.length >= 1, 'A5 总分不一致有警告');

  console.log('\n=== B. 全对卷：应得满分 10 ===');
  const rA = await g.gradeFile(path.join(FIX, 'wps_popshen_correct.xlsx'), SPEC);
  eq(rA.score, 10, 'B1 总分 = 10');
  eq(rA.full_score, 10, 'B2 满分 = 10');
  eq(rA.percent, 100, 'B3 得分率 100%');
  ok(rA.passed, 'B4 passed = true');
  rA.steps.forEach((s, i) => ok(s.pass, `B5.${i + 1} 步骤${i + 1}「${s.title}」满分`));
  ok(rA.steps.every((s) => s.checks.every((c) => c.pass)), 'B6 所有评分点均通过');
  ok(!!rA.sha256 && rA.sha256.length === 64, 'B7 产出 sha256');

  console.log('\n=== C. 缺图表卷：只应丢第 4 步 2 分 ===');
  const rB = await g.gradeFile(path.join(FIX, 'wps_popshen_nochart.xlsx'), SPEC);
  eq(rB.score, 8, 'C1 总分 = 8');
  eq(rB.steps[3].obtained, 0, 'C2 步骤4 得 0 分');
  eq(rB.steps[3].checks.length, 2, 'C3 步骤4 有 2 个评分点');
  ok(rB.steps[3].checks.every((c) => !c.pass), 'C4 图表评分点全部未通过');
  ok(rB.steps[3].checks[0].got.includes('未在'), 'C5 给出"未发现图表"的提示', rB.steps[3].checks[0].got);
  [0, 1, 2].forEach((i) => eq(rB.steps[i].obtained, rB.steps[i].score, `C6.${i + 1} 步骤${i + 1} 仍满分`));

  console.log('\n=== D. 手填数字卷（没用公式）：丢步骤2的公式分 + 步骤3的求和分 ===');
  const rC = await g.gradeFile(path.join(FIX, 'wps_popshen_hardcode.xlsx'), SPEC);
  eq(rC.score, 7, 'D1 总分 = 7');
  ok(!rC.steps[1].checks[0].pass, 'D2 "全部使用公式"未通过');
  ok(rC.steps[1].checks[0].got.includes('纯值'), 'D3 指出是纯值而非公式', rC.steps[1].checks[0].got);
  ok(rC.steps[1].checks[1].pass, 'D4 数值本身仍判对（容差生效）');
  ok(!rC.steps[2].checks[0].pass, 'D5 B14 求和公式未通过');
  eq(rC.steps[2].obtained, 0, 'D6 步骤3 得 0 分');

  console.log('\n=== E. 只写公式不设小数位：应丢"不保留小数"那 1 分 ===');
  const rD = await g.gradeFile(path.join(FIX, 'wps_popshen_rawdecimal.xlsx'), SPEC);
  eq(rD.score, 9, 'E1 总分 = 9');
  eq(rD.steps[1].obtained, 2, 'E2 步骤2 得 2 分');
  ok(rD.steps[1].checks[0].pass, 'E3 公式检查通过');
  ok(rD.steps[1].checks[1].pass, 'E4 数值检查通过（容差 0.5 兜住 7129.6 vs 7130）');
  ok(!rD.steps[1].checks[2].pass, 'E5 "不保留小数"未通过');
  ok(rD.steps[1].checks[2].got.includes('未设 0 位格式'), 'E6 提示具体原因', rD.steps[1].checks[2].got);

  console.log('\n=== F. 未作答的原始模板：应得 0 分 ===');
  const rE = await g.gradeFile(TEMPLATE, SPEC);
  eq(rE.score, 0, 'F1 总分 = 0');
  eq(rE.full_score, 10, 'F2 满分仍为 10');
  ok(rE.steps.every((s) => s.obtained === 0), 'F3 每一步均为 0 分');
  ok(rE.sheets.join(',') === 'Sheet1,Sheet2,Sheet3', 'F4 识别出 3 个工作表');

  console.log('\n=== G. 容错：非 xlsx / 空 spec 不应崩 ===');
  let threw = false;
  try { await g.gradeFile(Buffer.from('this is not a zip at all'), SPEC); } catch (e) { threw = true; }
  ok(threw, 'G1 非 zip 内容抛出可读错误');

  const rF = await g.gradeFile(path.join(FIX, 'wps_popshen_correct.xlsx'), { full_score: 0, steps: [] });
  eq(rF.score, 0, 'G2 空规格得 0 分不崩');
  eq(rF.full_score, 0, 'G3 空规格满分 0');

  console.log('\n=== H. 结构摘要 inspectFile ===');
  const ins = await g.inspectFile(path.join(FIX, 'wps_popshen_correct.xlsx'));
  eq(ins.sheets.length, 3, 'H1 摘要含 3 个工作表');
  ok(ins.sheets[0].merges.includes('A1:D1'), 'H2 摘要识别出合并区 A1:D1');
  eq(ins.sheets[0].charts.length, 1, 'H3 摘要识别出 1 个图表');
  eq(ins.sheets[0].charts[0].chartType, 'bar', 'H4 图表类型 = bar');
  eq(ins.sheets[0].charts[0].barDir, 'col', 'H5 柱形方向 = col');
  eq(ins.sheets[0].charts[0].title, 'w市各地区人口密度', 'H6 图表标题正确');
  eq(ins.sheets[0].charts[0].series[0].cat, 'A2:A13', 'H7 分类轴区间正确');
  eq(ins.sheets[0].charts[0].series[0].val, 'D2:D13', 'H8 数值轴区间正确');
  const d3 = ins.sheets[0].cells.find((c) => c.ref === 'D3');
  ok(!!d3 && d3.formula === '=C3*10000/B3', 'H9 D3 公式解析正确', d3 && d3.formula);
  eq(d3.decimals, 0, 'H10 D3 小数位 = 0');
  const a1 = ins.sheets[0].cells.find((c) => c.ref === 'A1');
  ok(!!a1 && a1.font.name === '隶书' && a1.font.bold === true && a1.font.size === 17, 'H11 A1 字体 = 隶书 加粗 17', JSON.stringify(a1 && a1.font));
  eq(a1.align, 'center', 'H12 A1 水平居中');

  console.log('\n=== I. 从标准答案自动生成评分点骨架 ===');
  const sug = await g.suggestSpec(path.join(FIX, 'wps_popshen_correct.xlsx'), { sheet: 'Sheet1' });
  ok(sug.steps.length >= 3, 'I1 至少生成 3 个步骤', 'steps=' + sug.steps.length);
  const kinds = sug.steps.flatMap((s) => s.checks.map((c) => c.kind));
  ok(kinds.includes('merged'), 'I2 生成合并检查');
  ok(kinds.includes('chart'), 'I3 生成图表检查');
  const sugV = g.validateSpec(sug, 10);
  ok(sugV.ok, 'I4 生成的骨架无错误', sugV.errors.join('；'));
  const sugChart = sug.steps.flatMap((s) => s.checks).find((c) => c.kind === 'chart');
  eq(sugChart.chartType, 'bar', 'I5 骨架里的图表类型自动填好');
  eq(sugChart.catRange, 'A2:A13', 'I6 骨架里的分类轴自动填好');
  eq(sugChart.valRange, 'D2:D13', 'I7 骨架里的数值轴自动填好');

  console.log('\n=== J. 单位换行/脏 XML 容错 ===');
  const rG = await g.gradeFile(path.join(FIX, 'wps_popshen_correct.xlsx'), {
    full_score: 1,
    steps: [{ id: 's', title: 't', score: 1, checks: [{ kind: 'sheet_exists', sheet: 'Sheet1', score: 1 }] }],
  });
  eq(rG.score, 1, 'J1 带 WPS 专有命名空间与坏条件格式的文件仍可判分');

  console.log('\n========================================');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('\n失败项：'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('全部通过 ✅');
})().catch((e) => { console.error('脚本异常：', e); process.exit(1); });
