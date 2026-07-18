-- AI答疑模块数据库表结构
-- 适配江苏省高中信息技术课标

CREATE TABLE IF NOT EXISTS ai_qa_history (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_student_id (student_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO system_config (id, config_key, value)
VALUES
  ('config_ai_qa_system_prompt', 'ai_qa_system_prompt', JSON_OBJECT('value', '你是江苏省高中信息技术、Python编程专属答疑老师。
1. 严格按照江苏高中信息技术教材、学业水平考试大纲回答问题。
2. 只讲解知识点、解题思路、代码原理，绝不直接提供作业/考试答案。
3. Python讲解使用高中教学标准语法，通俗易懂，分步骤说明。
4. 回答简洁、准确，不使用大学/专业术语。
5. 拒绝代写代码、拒绝作业代写、拒绝考试作弊相关请求。
6. 涉及学考内容，自动补充江苏高频考点和答题技巧。')),
  ('config_ai_qa_points_per_question', 'ai_qa_points_per_question', JSON_OBJECT('value', 5));

INSERT IGNORE INTO apps (id, name, description, icon, type, price_type, points_price, category, is_active, is_marketplace, config, created_by)
VALUES (
  'app_ai_qa',
  'AI答疑',
  '江苏省高中信息技术AI答疑助手，支持知识点讲解、代码纠错、学考真题解析。严格遵循教育规范，只辅导不代写。',
  '🤖',
  'ai_qa',
  'per_use',
  5,
  '学习工具',
  TRUE,
  TRUE,
  JSON_OBJECT(
    'subjectScope', 'information_tech,python',
    'difficulty', 'high_school_basic',
    'answerLength', 'concise',
    'complianceLevel', 'strict',
    'contextMemory', TRUE,
    'contextMemoryCount', 5,
    'codeCheckEnabled', TRUE,
    'codeRunEnabled', TRUE,
    'pythonVersion', '3.10',
    'autoMatchExam', TRUE,
    'textbookVersion', 'jiangsu_latest',
    'examPointPush', TRUE,
    'pointsPerQuestion', 5,
    'logRetention', TRUE
  ),
  'teacher1'
);

INSERT IGNORE INTO app_visibility (id, app_id, class_id, is_visible)
VALUES ('av_ai_qa_class1', 'app_ai_qa', 'class1', TRUE);
