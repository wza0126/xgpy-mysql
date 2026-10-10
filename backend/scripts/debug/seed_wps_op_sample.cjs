/**
 * 灌入「人口密度数据分析表」这道学测 WPS 操作题样例（幂等）。
 *
 * 做四件事：
 *   1) 把原始模板复制进 uploads/wps-op/templates/（学生下载用）
 *   2) 从模板里读出地区/人口/面积数据，生成一个「人口数据源.txt」作为第二个模板
 *      —— 演示"题目同时给表格模板 + txt 数据源"的多模板形态
 *   3) 把 fixtures/wps_popshen_spec.json 里的评分点写进 questions.wps_spec（100 分制）
 *   4) UPSERT 一行 type='wps_op' 的题目（固定 id，可重复执行）
 *
 * 用法：
 *   node backend/scripts/debug/seed_wps_op_sample.cjs          # 灌入/覆盖
 *   node backend/scripts/debug/seed_wps_op_sample.cjs --remove # 移除（含该题的提交记录）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('../../node_modules/mysql2/promise');

const QUESTION_ID = 'wps_op_demo_popshen';
const CLUSTER_ID = '数据获取与表达/数据计算';
// ⚠️ 优先用 fixtures 里固化的模板副本（随仓库走），找不到才回落到仓库根目录
const TEMPLATE_CANDIDATES = [
  path.join(__dirname, 'fixtures', 'source_popshen_template.xlsx'),
  path.join(__dirname, '../../..', '人口密度数据分析表.xlsx'),
];
const TEMPLATE_SRC = TEMPLATE_CANDIDATES.find((p) => fs.existsSync(p)) || TEMPLATE_CANDIDATES[0];
const SPEC_FILE = path.join(__dirname, 'fixtures/wps_popshen_spec.json');
const TEMPLATE_DEST_DIR = path.join(__dirname, '../../uploads/wps-op/templates');
const TEMPLATE_DEST = path.join(TEMPLATE_DEST_DIR, 'tpl_wps_popshen_template.xlsx');
const TXT_DEST = path.join(TEMPLATE_DEST_DIR, 'tpl_wps_popshen_data.txt');

const CONTENT = [
  '<p><strong>WPS 表格操作题：w 市人口密度数据分析表</strong></p>',
  '<p>下载「人口密度数据分析表.xlsx」，用 WPS 表格完成以下操作并保存，然后上传作答文件。</p>',
  '<p><em>提示：本题另附「人口数据源.txt」，可用 WPS 的「数据 → 导入数据」或复制粘贴把数据填进表格。</em></p>',
  '<p>1. 将单元格区域 A1:D1 合并及居中，并输入标题「w市人口密度数据分析表」，设置字体为隶书、加粗、字号 17；</p>',
  '<p>2. 在单元格区域 D3:D13 中，利用公式计算每个地区的常住人口密度（常住人口密度 = 常住人口 × 10000 ÷ 土地面积），结果设为数值型，不保留小数；</p>',
  '<p>3. 利用函数求出 w 市的总土地面积和总常住人口数，结果设为数值型、不保留小数，计算结果分别存放在单元格 B14 和 C14 中；</p>',
  '<p>4. 同时选中 A2:A13 和 D2:D13 生成簇状柱形图，图表标题设置为「w市各地区人口密度」，作为其中对象插入到 Sheet1 中。</p>',
  '<p><em>本题满分 100 分，按上述 4 步分步给分。</em></p>',
].join('');

/** 从模板里读出 A/B/C 列，生成 tab 分隔的 txt 数据源 */
async function buildDataSourceTxt(grader) {
  const { model } = await grader.loadModel(TEMPLATE_SRC);
  const sh = model.sheets[0];
  if (!sh) throw new Error('模板里没有工作表');
  const lines = ['地区\t常住人口\t土地面积'];
  let hit = 0;
  for (let r = 3; r <= 14; r++) {
    const a = sh.cells.get('A' + r);
    const b = sh.cells.get('B' + r);
    const c = sh.cells.get('C' + r);
    if (!a || a.value === null || a.value === undefined || String(a.value).trim() === '') continue;
    lines.push([String(a.value), b ? b.value : '', c ? c.value : ''].join('\t'));
    hit++;
  }
  if (!hit) throw new Error('模板里没读到 A3:C13 的数据');
  return lines.join('\r\n') + '\r\n';
}

(async () => {
  const remove = process.argv.includes('--remove');
  const conn = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy' });

  if (remove) {
    const [s1] = await conn.query('DELETE FROM wps_op_submissions WHERE question_id = ?', [QUESTION_ID]);
    const [s2] = await conn.query('DELETE FROM student_answers WHERE question_id = ? AND source = ?', [QUESTION_ID, 'practice']);
    const [s3] = await conn.query('DELETE FROM questions WHERE id = ?', [QUESTION_ID]);
    for (const f of [TEMPLATE_DEST, TXT_DEST]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }
    console.log(`已移除：题目 ${s3.affectedRows} 行、提交记录 ${s1.affectedRows} 行、答题记录 ${s2.affectedRows} 行`);
    await conn.end();
    return;
  }

  if (!fs.existsSync(TEMPLATE_SRC)) throw new Error('找不到模板源文件：' + TEMPLATE_SRC);
  if (!fs.existsSync(SPEC_FILE)) throw new Error('找不到评分点文件：' + SPEC_FILE);

  const grader = require('../../src/wps-grader.js');

  fs.mkdirSync(TEMPLATE_DEST_DIR, { recursive: true });
  fs.copyFileSync(TEMPLATE_SRC, TEMPLATE_DEST);
  fs.writeFileSync(TXT_DEST, await buildDataSourceTxt(grader), 'utf8');

  const spec = JSON.parse(fs.readFileSync(SPEC_FILE, 'utf8'));
  spec.templates = [
    {
      name: '人口密度数据分析表.xlsx',
      path: '/uploads/wps-op/templates/' + path.basename(TEMPLATE_DEST),
      size: fs.statSync(TEMPLATE_DEST).size,
      kind: 'xlsx',
    },
    {
      name: '人口数据源.txt',
      path: '/uploads/wps-op/templates/' + path.basename(TXT_DEST),
      size: fs.statSync(TXT_DEST).size,
      kind: 'text',
    },
  ];

  // 自检：评分点总分必须等于满分
  const v = grader.validateSpec(spec, spec.full_score || 100);
  if (!v.ok) throw new Error('评分点规格有错误：' + v.errors.join('；'));
  if (v.warnings.length) console.warn('评分点规格警告：\n  ' + v.warnings.join('\n  '));

  await conn.query(
    `INSERT INTO questions (id, type, content, options, answers, explanation, practice_enabled, exam_enabled,
                            cluster_id, cluster_status, cluster_source, tags, wps_spec, created_by, created_at)
     VALUES (?, 'wps_op', ?, NULL, ?, ?, 1, 0, ?, 'done', 'manual', ?, ?, 'seed', NOW())
     ON DUPLICATE KEY UPDATE
       content = VALUES(content), answers = VALUES(answers), explanation = VALUES(explanation),
       practice_enabled = VALUES(practice_enabled), exam_enabled = VALUES(exam_enabled),
       cluster_id = VALUES(cluster_id), tags = VALUES(tags), wps_spec = VALUES(wps_spec)`,
    [QUESTION_ID, CONTENT,
     JSON.stringify({ note: 'WPS 操作题由 wps_spec 判分，answers 列仅占位' }),
     '本题按 4 个步骤分步给分，满分 100 分。评分点为 OOXML 结构校验：合并单元格、字体与对齐、公式与数值、数字格式、图表 XML。',
     CLUSTER_ID, JSON.stringify(['WPS操作题', '学测', '表格', '数据处理']),
     JSON.stringify(spec)]);

  const [[row]] = await conn.query('SELECT id, type, cluster_id, practice_enabled, LENGTH(wps_spec) AS spec_len FROM questions WHERE id = ?', [QUESTION_ID]);
  console.log('已灌入样例题目：');
  console.log('  id           ', row.id);
  console.log('  type         ', row.type);
  console.log('  cluster_id   ', row.cluster_id);
  console.log('  practice     ', row.practice_enabled);
  console.log('  wps_spec 长度', row.spec_len);
  for (const t of spec.templates) console.log('  模板          ', t.path, '(' + t.size + ' bytes, ' + t.kind + ')');
  console.log('  步骤 / 总分   ', spec.steps.length + ' 步 / ' + spec.full_score + ' 分');
  await conn.end();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
