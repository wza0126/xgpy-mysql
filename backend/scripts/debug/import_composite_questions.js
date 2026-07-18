/**
 * 综合题批量导入脚本
 * 用法: node import_composite_questions.js <json文件路径>
 *
 * JSON文件格式:
 * [
 *   {
 *     "content": "大题干HTML",
 *     "sub_questions": [
 *       { "index": 1, "type": "choice", "content": "...", "options": [...], "answers": [...], "score": 3, "multiple": true },
 *       { "index": 2, "type": "fill_blank", "content": "...", "answers": [...], "score": 2 }
 *     ],
 *     "explanation": "解析",
 *     "knowledge_point_id": "",
 *     "tags": ["综合题"],
 *     "practice_enabled": true,
 *     "exam_enabled": true
 *   }
 * ]
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.development') });
const fs = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('用法: node import_composite_questions.js <json文件路径>');
    process.exit(1);
  }

  const jsonPath = path.resolve(args[0]);
  if (!fs.existsSync(jsonPath)) {
    console.error('文件不存在:', jsonPath);
    process.exit(1);
  }

  let questions;
  try {
    questions = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.error('JSON解析失败:', e.message);
    process.exit(1);
  }

  if (!Array.isArray(questions)) {
    console.error('JSON文件内容必须是数组');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    waitForConnections: true,
    connectionLimit: 5,
  });

  let successCount = 0;
  let failCount = 0;

  for (const q of questions) {
    try {
      const id = `comp_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const subQuestions = q.sub_questions || [];

      // 计算总分
      const totalScore = subQuestions.reduce((sum, sq) => sum + (sq.score || 0), 0);

      // 构造答案字段：存储子题目数组
      const answersJson = JSON.stringify(subQuestions);

      // 构造选项字段：存储附加信息（如总分、子题数量等）
      const optionsJson = JSON.stringify({
        total_score: totalScore,
        sub_question_count: subQuestions.length,
        sub_scores: subQuestions.map(sq => ({ index: sq.index, score: sq.score || 0 }))
      });

      await pool.query(
        `INSERT INTO questions
         (id, type, content, options, answers, explanation, knowledge_point_id, practice_enabled, exam_enabled, tags, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          id,
          'composite',
          q.content || '',
          optionsJson,
          answersJson,
          q.explanation || '',
          q.knowledge_point_id || null,
          q.practice_enabled !== false,
          q.exam_enabled !== false,
          JSON.stringify(q.tags || ['综合题']),
          q.created_by || 'teacher1'
        ]
      );

      console.log(`导入成功 [${id}]: ${q.content?.substring(0, 30)}... 共${subQuestions.length}道小题, 总分${totalScore}`);
      successCount++;
    } catch (error) {
      console.error('导入失败:', error.message);
      console.error('题目内容:', q.content?.substring(0, 50));
      failCount++;
    }
  }

  console.log(`\n导入完成: 成功${successCount}道, 失败${failCount}道`);
  await pool.end();
}

main().catch(console.error);
