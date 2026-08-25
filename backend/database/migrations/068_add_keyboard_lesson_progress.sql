-- 键盘星域：指法学堂练习进度迁移到数据库（按 user_id 关联，跨浏览器同步）
-- 背景：原进度仅存于浏览器 localStorage（key: keyboard_galaxy_lesson_<userId>），
--       导致同一账号在不同浏览器进度不一致。迁到数据库后实现账号级同步。
-- 存储结构（progress_json）：
--   { ch: number[]          // 已完成章节 ID 列表
--     sub: { [chapterId]: number[] } }  // 各章已完成小节 ID 列表
CREATE TABLE IF NOT EXISTS keyboard_lesson_progress (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT '用户ID',
  progress_json JSON COMMENT '进度数据 { ch: number[], sub: Record<number, number[]> }',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_id (user_id),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='键盘星域指法学堂练习进度';
