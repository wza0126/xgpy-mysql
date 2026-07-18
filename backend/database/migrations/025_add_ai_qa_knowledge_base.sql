-- 答疑知识库表
CREATE TABLE IF NOT EXISTS ai_qa_knowledge_base (
  id VARCHAR(50) PRIMARY KEY COMMENT '主键ID',
  question_hash VARCHAR(64) NOT NULL COMMENT '问题MD5哈希，用于快速匹配',
  question TEXT NOT NULL COMMENT '问题原文',
  answer TEXT NOT NULL COMMENT 'AI回答',
  hit_count INT DEFAULT 0 COMMENT '被调用次数',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建者ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE INDEX idx_question_hash (question_hash),
  INDEX idx_hit_count (hit_count),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI答疑知识库';
