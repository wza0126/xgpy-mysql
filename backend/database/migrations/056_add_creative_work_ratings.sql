-- AI创意工坊：应用星级评分
-- 创建时间: 2026-08-11
-- 说明: 已购买应用的学生可为应用评分（1-5 星），每人每应用限评一次；应用中心展示平均星级

CREATE TABLE IF NOT EXISTS ai_work_ratings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  work_id VARCHAR(50) NOT NULL COMMENT '作品ID',
  student_id VARCHAR(50) NOT NULL COMMENT '评分学生ID',
  rating TINYINT NOT NULL COMMENT '评分 1-5 星',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_work_student (work_id, student_id),
  INDEX idx_work_id (work_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='创意工坊应用星级评分';
