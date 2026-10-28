/**
 * 修复导入时被截断的题干/模板/答案
 *
 * 背景：首次导入用的是 editor_sdk 的 text_preview（上限 200 字节，约 75 个汉字），
 *      把「预览」当成了全文，导致 22 道题的题干、2 道题的答案被截断。
 *      本脚本用 docx 原文（zipfile 直接解 XML）重建的内容覆盖回去。
 *
 * 数据源：C:\wza\xgpydev\_fix_payload.json
 * 只更新这 44 条的 description / blank_template / blank_answers 三个字段，
 * 不动权重、班级、分类、标题。
 */
const fs = require('fs');
const mysql = require('mysql2/promise');

(async () => {
  const list = JSON.parse(fs.readFileSync('C:/wza/xgpydev/_fix_payload.json', 'utf8'));
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy', charset: 'utf8mb4',
  });

  let updated = 0;
  const missing = [];
  for (const p of list) {
    const [rows] = await conn.query('SELECT id FROM python_tasks WHERE title = ? LIMIT 1', [p.title]);
    if (!rows.length) { missing.push(p.title); continue; }
    await conn.execute(
      'UPDATE python_tasks SET description = ?, blank_template = ?, blank_answers = ?, updated_at = NOW() WHERE id = ?',
      [p.description, p.blank_template, JSON.stringify(p.blank_answers), rows[0].id]
    );
    updated += 1;
  }
  console.log(`更新 ${updated} 条`);
  if (missing.length) console.log('未找到:', missing);
  await conn.end();
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
