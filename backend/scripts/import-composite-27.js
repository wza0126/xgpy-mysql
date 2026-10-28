/**
 * 导入 27-综合题.docx 里的 16 道综合题（剔除 4 道与题库重复的）
 *
 * 数据源：C:\wza\xgpydev\_comp_import.json
 *         （由 docx 原文解析 → 去重 → 格式转换生成，编号 15–30）
 * ⛔ 只新增，按 content 里的「N、标题」判重，不更新不删除已有记录
 */
const fs = require('fs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const PAYLOAD = 'C:/wza/xgpydev/_comp_import.json';
const TEACHER = '46442074-6644-468e-b1dd-72bcc3d229ca';

(async () => {
  const list = JSON.parse(fs.readFileSync(PAYLOAD, 'utf8'));
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy', charset: 'utf8mb4',
  });

  // 判重：取现有综合题的标题集合
  const [exist] = await conn.query(
    "SELECT content FROM questions WHERE type = 'composite'"
  );
  const existTitles = new Set();
  for (const r of exist) {
    const m = /<strong>\d+、([^<]+)<\/strong>/.exec(r.content || '');
    if (m) existTitles.add(m[1].trim());
  }
  console.log(`现有综合题 ${exist.length} 道`);

  let inserted = 0;
  for (const p of list) {
    if (existTitles.has(p.title)) {
      console.log('  跳过（已存在）:', p.title);
      continue;
    }
    const id = `comp_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
    await conn.execute(
      `INSERT INTO questions
        (id, type, content, options, answers, explanation, tags,
         created_by, cluster_id, practice_enabled, exam_enabled,
         cluster_status, cluster_source)
       VALUES (?, 'composite', ?, NULL, ?, ?, ?, ?, NULL, 1, 1, 'pending', 'manual')`,
      [
        id,
        p.content,
        JSON.stringify(p.answers),
        p.explanation,
        JSON.stringify(['综合题']),
        TEACHER,
      ]
    );
    inserted += 1;
    await new Promise((r) => setTimeout(r, 2));
  }

  const [[cnt]] = await conn.query("SELECT COUNT(*) AS n FROM questions WHERE type='composite'");
  console.log(`插入 ${inserted} 道；现有综合题总数 ${cnt.n}`);
  await conn.end();
})().catch((e) => { console.error('导入失败:', e.message); process.exit(1); });
