-- 学情分析 - 错题已讲解标记（按班级隔离）
CREATE TABLE IF NOT EXISTS question_explained_marks (
  id VARCHAR(50) PRIMARY KEY,
  class_id VARCHAR(50) NOT NULL COMMENT '班级ID',
  question_id VARCHAR(50) NOT NULL COMMENT '题目ID',
  marked_by VARCHAR(50) DEFAULT NULL COMMENT '标记的教师ID',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_class_question (class_id, question_id),
  INDEX idx_class (class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
