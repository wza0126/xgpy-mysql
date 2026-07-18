-- 修复 student_answers 表缺少 lesson_id 列
ALTER TABLE student_answers ADD COLUMN IF NOT EXISTS lesson_id VARCHAR(50) NULL COMMENT '关联课程/课时ID' AFTER source;
