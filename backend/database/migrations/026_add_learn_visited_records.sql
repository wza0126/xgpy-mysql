-- 学习模块已看问题记录表
CREATE TABLE IF NOT EXISTS learn_visited_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
  student_id VARCHAR(50) NOT NULL COMMENT '学生ID',
  question_key VARCHAR(50) NOT NULL COMMENT '问题唯一标识（sectionIndex-questionIndex）',
  question_text TEXT DEFAULT NULL COMMENT '问题文本（便于审计）',
  visited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '访问时间',
  UNIQUE INDEX uk_student_question (student_id, question_key),
  INDEX idx_student_id (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习模块已看问题记录';
