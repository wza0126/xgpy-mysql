/**
 * 灌入「2022 北京冬奥会奖牌榜」这道学测 Access 操作题样例（幂等）。
 *
 * 做两件事：
 *   1) 把模板文件复制进 uploads/access-op/templates/（学生下载用）：
 *      · 空白库「2022北京冬奥会.accdb」（学生往里导入数据）
 *      · 数据源「2022北京冬奥会奖牌榜.xlsx」
 *   2) UPSERT 一行 type='access_op' 的题目（固定 id，可重复执行），
 *      评分点 4 步 × 25 分，与题面一一对应。
 *
 * 用法：
 *   node backend/scripts/debug/seed_access_op_sample.cjs          # 灌入/覆盖
 *   node backend/scripts/debug/seed_access_op_sample.cjs --remove # 移除（含该题的提交记录）
 *
 * ⚠️ 模板源文件若不在本机（Downloads / fixtures）就跳过模板上传，只写题目、给出提示。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('../../node_modules/mysql2/promise');

const QUESTION_ID = 'access_op_demo_winter';
const CLUSTER_ID = '信息系统的设计与开发/信息系统的数据库构建';
const TPL_DIR = path.join(__dirname, '../../uploads/access-op/templates');
const TPL_DB = path.join(TPL_DIR, 'tpl_access_winter_blank.accdb');
const TPL_XLSX = path.join(TPL_DIR, 'tpl_access_winter_medals.xlsx');

const SRC_CANDIDATES = {
  db: [
    path.join(__dirname, 'fixtures', 'access_winter_blank.accdb'),
    path.join(process.env.USERPROFILE || '', 'Downloads', '2022北京冬奥会 (1).accdb'),
  ],
  xlsx: [
    path.join(__dirname, 'fixtures', 'access_winter_medals.xlsx'),
    path.join(process.env.USERPROFILE || '', 'Downloads', '2022北京冬奥会奖牌榜.xlsx'),
  ],
};

const CONTENT = [
  '<p><strong>Access 操作题：2022 北京冬奥会奖牌榜</strong></p>',
  '<p>下载「2022北京冬奥会.accdb」，按下列要求完成操作后保存并提交。</p>',
  '<p>1. 将「2022北京冬奥会奖牌榜.xlsx」文件中的数据导入到数据库中，形成一张名为「奖牌榜」的表（字段依次为：排名、国家、金牌、银牌、铜牌、奖牌总数）；</p>',
  '<p>2. 将「奖牌总数」字段的数据类型设置为「整型」；</p>',
  '<p>3. 将「奖牌榜」表中的记录按「金牌」降序排序；</p>',
  '<p>4. 删除不需要的记录，使表中只保留 9 条记录（最终以题面要求为准）。</p>',
  '<p><em>本题满分 100 分，按上述 4 步分步给分。</em></p>',
].join('');

/** 4 步 × 25 分 */
const SPEC = {
  version: 1,
  full_score: 100,
  steps: [
    {
      id: 's1',
      title: '步骤1 导入数据建表',
      desc: '把「2022北京冬奥会奖牌榜.xlsx」导入为名为「奖牌榜」的表，字段依次为 排名/国家/金牌/银牌/铜牌/奖牌总数。',
      video_urls: [],
      score: 25,
      checks: [
        { kind: 'accdb_table', table: '奖牌榜', label: '存在表「奖牌榜」', score: 10 },
        { kind: 'accdb_columns', table: '奖牌榜', columns: ['排名', '国家', '金牌', '银牌', '铜牌', '奖牌总数'], label: '字段名与顺序正确', score: 15 },
      ],
    },
    {
      id: 's2',
      title: '步骤2 设置字段大小（整型）',
      desc: '把「奖牌总数」字段的数据类型设置为「整型」。',
      video_urls: [],
      score: 25,
      checks: [
        { kind: 'accdb_column_type', table: '奖牌榜', column: '奖牌总数', type: 'integer', label: '「奖牌总数」为整型', score: 25 },
      ],
    },
    {
      id: 's3',
      title: '步骤3 按金牌降序排序',
      desc: '先关闭再打开「奖牌榜」表，将记录按「金牌」字段降序排序，然后保存。',
      video_urls: [],
      score: 25,
      checks: [
        { kind: 'accdb_sort', table: '奖牌榜', column: '金牌', order: 'DESC', label: '金牌降序', score: 25 },
      ],
    },
    {
      id: 's4',
      title: '步骤4 删除记录',
      desc: '删除表中不需要的记录（按题面要求保留相应条数）。',
      video_urls: [],
      score: 25,
      checks: [
        { kind: 'accdb_rows', table: '奖牌榜', count: 9, label: '表中记录数正确', score: 25 },
      ],
    },
  ],
};

function firstExisting(list) {
  return list.find((p) => p && fs.existsSync(p)) || null;
}

(async () => {
  const remove = process.argv.includes('--remove');
  const conn = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy' });

  if (remove) {
    const [s1] = await conn.query('DELETE FROM wps_op_submissions WHERE question_id = ?', [QUESTION_ID]);
    const [s2] = await conn.query('DELETE FROM student_answers WHERE question_id = ? AND source = ?', [QUESTION_ID, 'practice']);
    const [s3] = await conn.query('DELETE FROM questions WHERE id = ?', [QUESTION_ID]);
    for (const f of [TPL_DB, TPL_XLSX]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }
    console.log(`已移除：题目 ${s3.affectedRows} 行、提交记录 ${s1.affectedRows} 行、答题记录 ${s2.affectedRows} 行`);
    await conn.end();
    return;
  }

  fs.mkdirSync(TPL_DIR, { recursive: true });
  const templates = [];
  const dbSrc = firstExisting(SRC_CANDIDATES.db);
  const xlsxSrc = firstExisting(SRC_CANDIDATES.xlsx);
  if (dbSrc) {
    fs.copyFileSync(dbSrc, TPL_DB);
    templates.push({ name: '2022北京冬奥会.accdb', path: '/uploads/access-op/templates/' + path.basename(TPL_DB), size: fs.statSync(TPL_DB).size, kind: 'accdb' });
  } else {
    console.warn('⚠️ 未找到空白库模板（access_winter_blank.accdb / Downloads 里的 2022北京冬奥会 (1).accdb），跳过');
  }
  if (xlsxSrc) {
    fs.copyFileSync(xlsxSrc, TPL_XLSX);
    templates.push({ name: '2022北京冬奥会奖牌榜.xlsx', path: '/uploads/access-op/templates/' + path.basename(TPL_XLSX), size: fs.statSync(TPL_XLSX).size, kind: 'xlsx' });
  } else {
    console.warn('⚠️ 未找到数据源模板（2022北京冬奥会奖牌榜.xlsx），跳过');
  }

  const spec = { ...SPEC, templates };
  await conn.query(
    `INSERT INTO questions (id, type, content, options, answers, explanation, practice_enabled, exam_enabled,
                            cluster_id, cluster_status, cluster_source, tags, access_spec, created_by, created_at)
     VALUES (?, 'access_op', ?, NULL, ?, ?, 1, 0, ?, 'done', 'manual', ?, ?, 'seed', NOW())
     ON DUPLICATE KEY UPDATE
       type = 'access_op', content = VALUES(content), answers = VALUES(answers), explanation = VALUES(explanation),
       practice_enabled = VALUES(practice_enabled), exam_enabled = VALUES(exam_enabled),
       cluster_id = VALUES(cluster_id), tags = VALUES(tags), access_spec = VALUES(access_spec)`,
    [QUESTION_ID, CONTENT,
     JSON.stringify({ note: 'Access 操作题由 access_spec 判分，answers 列仅占位' }),
     '本题按 4 个步骤分步给分，满分 100 分。评分点校验库结构：表与字段、字段类型/大小、主键、记录、排序、筛选。',
     CLUSTER_ID, JSON.stringify(['Access操作题', '学测', '数据库', '数据管理']),
     JSON.stringify(spec)]);

  const [[row]] = await conn.query('SELECT id, type, cluster_id, practice_enabled, LENGTH(access_spec) AS spec_len FROM questions WHERE id = ?', [QUESTION_ID]);
  console.log('已灌入样例题目：');
  console.log('  id             ', row.id);
  console.log('  type           ', row.type);
  console.log('  cluster_id     ', row.cluster_id);
  console.log('  practice       ', row.practice_enabled);
  console.log('  access_spec 长度', row.spec_len);
  for (const t of templates) console.log('  模板            ', t.path, '(' + t.size + ' bytes, ' + t.kind + ')');
  console.log('  步骤 / 总分     ', spec.steps.length + ' 步 / ' + spec.full_score + ' 分');
  await conn.end();
})().catch((e) => { console.error('seed 失败：', e); process.exit(1); });
