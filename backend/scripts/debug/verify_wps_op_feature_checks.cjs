/**
 * WPS 操作题 · 排序 / 筛选 / 分类汇总 / 条件格式 四类检查器验证（纯离线，不碰数据库）
 *
 * 依据：fixtures/feature/*.xlsx —— 由 make_wps_feature_samples.ps1 调用本机 Excel 2016 COM
 * 真实生成（不是手搓 XML），所以断言的是"真文件里到底写了什么"。
 *
 * 用法：node backend/scripts/debug/verify_wps_op_feature_checks.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yauzl = require('../../node_modules/yauzl');
const grader = require('../../src/wps-grader');

const FIX = path.join(__dirname, 'fixtures', 'feature');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

function unzip(file) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(fs.readFileSync(file), { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const out = {};
      let pending = 0, ended = false;
      const done = () => { if (ended && pending === 0) resolve(out); };
      zip.on('entry', (e) => {
        if (/\/$/.test(e.fileName)) return zip.readEntry();
        pending++;
        zip.openReadStream(e, (er, rs) => {
          if (er) { pending--; done(); return zip.readEntry(); }
          const chunks = [];
          rs.on('data', (c) => chunks.push(c));
          rs.on('end', () => { out[e.fileName] = Buffer.concat(chunks); pending--; done(); zip.readEntry(); });
          rs.on('error', () => { pending--; done(); zip.readEntry(); });
        });
      });
      zip.on('end', () => { ended = true; done(); });
      zip.readEntry();
    });
  });
}

async function modelOf(name) {
  const files = await unzip(path.join(FIX, name));
  const model = grader.buildModel(files);
  model.__file = name;
  return model;
}

function run(model, kind, check) {
  const sheet = model.sheets.find((s) => !check.sheet || s.name === check.sheet) || model.sheets[0];
  return grader.CHECKERS[kind]({ model, sheet, check });
}

(async () => {
  // ---------- 前置：样本文件齐不齐 ----------
  section('0. 样本文件');
  const NEED = ['feat_sort.xlsx', 'feat_filter.xlsx', 'feat_filter_text.xlsx', 'feat_filter_all.xlsx',
    'feat_subtotal.xlsx', 'feat_condformat.xlsx', 'feat_combo.xlsx'];
  const missing = NEED.filter((n) => !fs.existsSync(path.join(FIX, n)));
  if (missing.length) {
    console.log('缺少样本：' + missing.join(', '));
    console.log('请先跑：powershell -File backend/scripts/debug/make_wps_feature_samples.ps1');
    process.exit(2);
  }
  ok('7 份真实样本齐全', true);

  // ---------- A. 排序 ----------
  section('A. 排序（feat_sort.xlsx：按 D 列降序）');
  const mSort = await modelOf('feat_sort.xlsx');
  const shSort = mSort.sheets[0];
  ok('sortState 已解析', !!shSort.sortState, JSON.stringify(shSort.sortState));
  ok('sortCondition 的 descending 为真',
    !!(shSort.sortState && shSort.sortState.conditions[0] && shSort.sortState.conditions[0].descending === true),
    JSON.stringify(shSort.sortState && shSort.sortState.conditions));
  ok('★ sorted_range 判 D 列降序 → 通过',
    run(mSort, 'sorted_range', { range: 'D2:D7', col: 4, order: 'desc' }).pass === true);
  ok('sorted_range 判 D 列升序 → 不通过',
    run(mSort, 'sorted_range', { range: 'D2:D7', col: 4, order: 'asc' }).pass === false);
  ok('★ 判据独立：按 D 排序的卷子，B 列并不有序（升/降都不通过）',
    run(mSort, 'sorted_range', { range: 'B2:B7', col: 2, order: 'desc' }).pass === false
    && run(mSort, 'sorted_range', { range: 'B2:B7', col: 2, order: 'asc' }).pass === false);
  ok('列与区域不匹配时判错（不假通过）',
    run(mSort, 'sorted_range', { range: 'A2:A7', col: 4, order: 'desc' }).pass === false);

  // ---------- B. 数值筛选 ----------
  section('B. 自动筛选（feat_filter.xlsx：第 4 列 > 45000）');
  const mFilter = await modelOf('feat_filter.xlsx');
  const shFilter = mFilter.sheets[0];
  ok('autoFilter 已解析', !!shFilter.autoFilter, JSON.stringify(shFilter.autoFilter));
  ok('filterMode 标志为真', shFilter.filterMode === true);
  ok('colId 是 0-based（D 列 → 3）',
    !!(shFilter.autoFilter && shFilter.autoFilter.columns[0] && shFilter.autoFilter.columns[0].colId === 3),
    'colId=' + (shFilter.autoFilter && shFilter.autoFilter.columns[0] && shFilter.autoFilter.columns[0].colId));
  ok('★ 第 4 列 greaterThan 45000 → 通过',
    run(mFilter, 'auto_filter', { range: 'A1:D7', columns: [{ col: 4, op: 'greaterThan', value: '45000' }] }).pass === true);
  ok('阈值不对 → 判错',
    run(mFilter, 'auto_filter', { columns: [{ col: 4, op: 'greaterThan', value: '40000' }] }).pass === false);
  ok('运算符不对 → 判错',
    run(mFilter, 'auto_filter', { columns: [{ col: 4, op: 'lessThan', value: '45000' }] }).pass === false);
  ok('运算符接受符号写法（">" 等价 greaterThan）',
    run(mFilter, 'auto_filter', { columns: [{ col: 4, op: '>', value: '45000' }] }).pass === true);
  ok('筛选区域不对 → 判错',
    run(mFilter, 'auto_filter', { range: 'A1:C7', columns: [{ col: 4, op: 'greaterThan', value: '45000' }] }).pass === false);
  ok('第 1 列本来没有条件 → 判错',
    run(mFilter, 'auto_filter', { columns: [{ col: 1, values: ['城东区'] }] }).pass === false);

  // ---------- C. 文本筛选 ----------
  section('C. 自动筛选（feat_filter_text.xlsx：第 1 列 = 城东区）');
  const mText = await modelOf('feat_filter_text.xlsx');
  ok('★ 文本值筛选 ∈{城东区} → 通过',
    run(mText, 'auto_filter', { columns: [{ col: 1, values: ['城东区'] }] }).pass === true);
  ok('文本值不符 → 判错',
    run(mText, 'auto_filter', { columns: [{ col: 1, values: ['城西区'] }] }).pass === false);

  // ---------- D. 仅开启筛选 ----------
  section('D. 自动筛选（feat_filter_all.xlsx：只开启筛选、不加条件）');
  const mAll = await modelOf('feat_filter_all.xlsx');
  const rAll = run(mAll, 'auto_filter', {});
  ok('★ 只要求"开启筛选"时 → 通过', rAll.pass === true, rAll.got);
  ok('提示文案说明未设条件', /未设条件/.test(rAll.got), rAll.got);
  ok('同一文件上按具体条件判 → 判错',
    run(mAll, 'auto_filter', { columns: [{ col: 4, op: 'greaterThan', value: '4000' }] }).pass === false);

  // ---------- E. 分类汇总 ----------
  section('E. 分类汇总（feat_subtotal.xlsx：按 A 列分组对 B/C 求和）');
  const mSub = await modelOf('feat_subtotal.xlsx');
  const shSub = mSub.sheets[0];
  ok('outlineLevelRow 已解析', shSub.outlineLevelRow > 0, 'outlineLevelRow=' + shSub.outlineLevelRow);
  ok('rowMeta 收集到分组行', shSub.rowMeta.size >= 6, 'rows=' + shSub.rowMeta.size);
  ok('★ 汇总（sum，≥3 个）→ 通过',
    run(mSub, 'subtotal', { range: 'A1:D11', fn: 'sum', minCount: 3 }).pass === true);
  ok('minCount 过高 → 判错',
    run(mSub, 'subtotal', { range: 'A1:D11', fn: 'sum', minCount: 99 }).pass === false);
  ok('函数类型不符（average）→ 判错',
    run(mSub, 'subtotal', { range: 'A1:D11', fn: 'average' }).pass === false);
  ok('明细：识别出 SUBTOTAL 公式个数',
    /\d+ 个 SUBTOTAL\(9\)/.test(run(mSub, 'subtotal', { fn: 'sum', minCount: 1 }).got),
    run(mSub, 'subtotal', { fn: 'sum', minCount: 1 }).got);

  // ---------- F. 条件格式 ----------
  section('F. 条件格式（feat_condformat.xlsx：D 列 > 4000 填充红色）');
  const mCf = await modelOf('feat_condformat.xlsx');
  const shCf = mCf.sheets[0];
  ok('conditionalFormatting 已解析', shCf.condFormats.length > 0, JSON.stringify(shCf.condFormats.map((x) => x.sqref)));
  ok('dxfs 填充色已解析（红色 FFFF0000）',
    ((mCf.styles.dxfs || [])[0] || {}).fillColor === 'FFFF0000',
    JSON.stringify(mCf.styles.dxfs));
  ok('★ cellIs greaterThan 4000 → 通过',
    run(mCf, 'cond_format', { range: 'D2:D7', type: 'cellIs', operator: 'greaterThan', value: 4000 }).pass === true);
  ok('★ 填充色 red（中文/英文别名都认）→ 通过',
    run(mCf, 'cond_format', { range: 'D2:D7', type: 'cellIs', operator: 'greaterThan', value: 4000, fillColor: 'red' }).pass === true
    && run(mCf, 'cond_format', { range: 'D2:D7', fillColor: '红色' }).pass === true);
  ok('填充色不符（blue）→ 判错',
    run(mCf, 'cond_format', { range: 'D2:D7', fillColor: 'blue' }).pass === false);
  ok('运算符不符（lessThan）→ 判错',
    run(mCf, 'cond_format', { range: 'D2:D7', type: 'cellIs', operator: 'lessThan', value: 4000 }).pass === false);
  ok('阈值不符（5000）→ 判错',
    run(mCf, 'cond_format', { range: 'D2:D7', type: 'cellIs', operator: 'greaterThan', value: 5000 }).pass === false);
  ok('区域未被覆盖（A2:A7）→ 判错',
    run(mCf, 'cond_format', { range: 'A2:A7' }).pass === false);

  // ---------- G. 组合卷 ----------
  section('G. 组合卷（feat_combo.xlsx：排序 + 条件格式 + 筛选）');
  const mCombo = await modelOf('feat_combo.xlsx');
  ok('★ 排序（B 列降序）→ 通过',
    run(mCombo, 'sorted_range', { range: 'B2:B7', col: 2, order: 'desc' }).pass === true);
  ok('★ 筛选（A 列 = 城东区）→ 通过',
    run(mCombo, 'auto_filter', { columns: [{ col: 1, values: ['城东区'] }] }).pass === true);
  ok('★ 条件格式（> 45000）→ 通过',
    run(mCombo, 'cond_format', { range: 'D2:D7', type: 'cellIs', operator: 'greaterThan', value: 45000 }).pass === true);

  // ---------- H. 跨样本反例（防"什么卷子都给分"） ----------
  section('H. 反例：没做该操作的卷子必须判错');
  ok('未筛选的卷子上判筛选 → 错', run(mSort, 'auto_filter', {}).pass === false);
  ok('无条件格式的卷子上判条件格式 → 错', run(mSort, 'cond_format', { range: 'D2:D7' }).pass === false);
  ok('无分类汇总的卷子上判汇总 → 错', run(mSort, 'subtotal', { range: 'A1:D7', fn: 'sum', minCount: 1 }).pass === false);

  // ---------- I. 检查器清单 ----------
  section('I. 检查器清单');
  const kinds = grader.CHECK_KINDS;
  ok('CHECK_KINDS 共 20 种', kinds.length === 20, 'count=' + kinds.length);
  for (const k of ['auto_filter', 'sorted_range', 'subtotal', 'cond_format']) {
    ok('包含新检查器 ' + k, kinds.includes(k));
  }
  ok('原有 16 种未丢', ['sheet_exists', 'merged', 'cell_text', 'cell_value', 'cell_has_formula',
    'cell_formula', 'formula_tokens', 'sum_range', 'range_formula', 'range_values',
    'range_integer_display', 'integer_display', 'font', 'align', 'number_format', 'chart']
    .every((k) => kinds.includes(k)));

  // ---------- J. validateSpec 接受新 kind ----------
  section('J. 规格校验放行新类型');
  const spec = {
    version: 1, full_score: 100, grader: { sheet: 'Sheet1' },
    steps: [
      { id: 's1', title: '排序', score: 50, checks: [{ kind: 'sorted_range', label: 'D 列降序', score: 50, range: 'D2:D7', col: 4, order: 'desc' }] },
      { id: 's2', title: '筛选', score: 50, checks: [{ kind: 'auto_filter', label: '筛选', score: 50, range: 'A1:D7' }] },
    ],
  };
  const v = grader.validateSpec(spec, 100);
  const errs = (v && v.errors) || [];
  ok('validateSpec 接受新增的 4 种 kind（无"不受支持"报错）',
    !errs.some((e) => /不受支持/.test(String(e))), JSON.stringify(errs));

  // ---------- K. 自动生成评分点骨架（教师上传标准答案表就用它） ----------
  section('K. 自动生成评分点骨架（suggestSpec，100 分制）');
  const kindsOf = (spec) => spec.steps.flatMap((s) => s.checks.map((c) => c.kind));
  const selfGrade = (spec, model) => {
    let got = 0, full = 0;
    const sh = model.sheets.find((s) => s.name === (spec.grader && spec.grader.sheet)) || model.sheets[0];
    for (const st of spec.steps) for (const c of st.checks) {
      full += c.score;
      if (grader.CHECKERS[c.kind]({ model, sheet: sh, check: c }).pass) got += c.score;
    }
    return { got: Math.round(got * 100) / 100, full: Math.round(full * 100) / 100 };
  };

  const specCombo = grader.suggestSpecFromModel(mCombo, {});
  ok('★ 骨架默认满分 = 100', specCombo.full_score === 100, 'full_score=' + specCombo.full_score);
  ok('★ 各步骤分值之和 = 100',
    Math.abs(specCombo.steps.reduce((a, s) => a + s.score, 0) - 100) < 0.01,
    'sum=' + specCombo.steps.reduce((a, s) => a + s.score, 0));
  const kCombo = kindsOf(specCombo);
  ok('★ 组合卷骨架识别出自动筛选', kCombo.includes('auto_filter'), kCombo.join(','));
  ok('★ 组合卷骨架识别出条件格式', kCombo.includes('cond_format'), kCombo.join(','));
  ok('★ 组合卷骨架识别出排序', kCombo.includes('sorted_range'), kCombo.join(','));
  ok('筛选评分点带上了具体列条件',
    (() => {
      const c = specCombo.steps.flatMap((s) => s.checks).find((x) => x.kind === 'auto_filter');
      return !!(c && c.columns && c.columns.length && c.columns[0].values);
    })());
  ok('条件格式评分点带上了阈值与运算符',
    (() => {
      const c = specCombo.steps.flatMap((s) => s.checks).find((x) => x.kind === 'cond_format');
      return !!(c && c.value !== undefined && c.operator);
    })());
  const sgCombo = selfGrade(specCombo, mCombo);
  ok('★ 组合卷骨架"自己判自己"满分（标准答案 → 满分）', sgCombo.got === sgCombo.full, `${sgCombo.got}/${sgCombo.full}`);

  const specSub = grader.suggestSpecFromModel(mSub, {});
  ok('★ 汇总卷骨架识别出分类汇总',
    kindsOf(specSub).includes('subtotal'), kindsOf(specSub).join(','));
  ok('汇总卷骨架也是 100 分制',
    specSub.full_score === 100
    && Math.abs(specSub.steps.reduce((a, s) => a + s.score, 0) - 100) < 0.01);
  const sgSub = selfGrade(specSub, mSub);
  ok('★ 汇总卷骨架自评满分', sgSub.got === sgSub.full, `${sgSub.got}/${sgSub.full}`);

  console.log('\n========================================');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('\n失败项：'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('全部通过 ✅');
})().catch((e) => { console.error('脚本异常：', e); process.exit(1); });
