/**
 * 一次性导入脚本：把 docx 整理好的 44 道编程填空题写入 python_tasks
 *
 * 数据来源：C:\wza\xgpydev\_import_payload.json（由 docx 解析 + 去重 + 排序生成）
 * 幂等：按 title 判重，已存在则跳过
 * ⛔ 只新增，不更新、不删除任何已有记录
 */
const fs = require('fs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const PAYLOAD = 'C:/wza/xgpydev/_import_payload.json';
const TEACHER = '46442074-6644-468e-b1dd-72bcc3d229ca';

(async () => {
  const list = JSON.parse(fs.readFileSync(PAYLOAD, 'utf8'));
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '122201',
    database: 'xgpy',
    charset: 'utf8mb4',
  });

  const titles = list.map((p) => p.title);
  const [exist] = await conn.query('SELECT title FROM python_tasks WHERE title IN (?)', [titles]);
  const existSet = new Set(exist.map((r) => r.title));
  console.log(`待处理 ${list.length} 条，其中已存在 ${existSet.size} 条`);

  let inserted = 0;
  for (const p of list) {
    if (existSet.has(p.title)) {
      console.log('  跳过（已存在）:', p.title);
      continue;
    }
    const id = crypto.randomUUID();
    await conn.execute(
      `INSERT INTO python_tasks
        (id, title, description, task_type, class_ids, total_score,
         allow_late_submission, allow_run_code, max_run_seconds, is_active,
         created_by, blank_template, blank_answers, blank_weights)
       VALUES (?, ?, ?, 'fill_blank', ?, 10, 0, 1, 3, 1, ?, ?, ?, ?)`,
      [
        id,
        p.title,
        p.description,
        JSON.stringify([]),          // 先建不布置班级
        TEACHER,
        p.blank_template,
        JSON.stringify(p.blank_answers),
        JSON.stringify(p.blank_weights),
      ]
    );
    inserted += 1;
  }

  const [[cnt]] = await conn.query(
    "SELECT COUNT(*) AS n FROM python_tasks WHERE task_type='fill_blank'"
  );
  console.log(`插入完成 ${inserted} 条；当前填空题总数 ${cnt.n}`);
  await conn.end();
})().catch((e) => {
  console.error('导入失败:', e.message);
  process.exit(1);
});
