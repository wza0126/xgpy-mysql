-- 为 tests 表添加测试资格验证字段
-- 创建时间: 2026-06-05
-- 说明: 设置学生参加此测试所需的最低做对题目数量，NULL表示不限制

ALTER TABLE tests 
ADD COLUMN IF NOT EXISTS qualification_correct_count INT DEFAULT NULL COMMENT '所需的做对题目数量，NULL表示不限制';
