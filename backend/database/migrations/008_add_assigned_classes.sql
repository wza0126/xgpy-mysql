-- 添加教师负责班级字段
-- 创建时间: 2026-05-29

-- 为 profiles 表添加 assigned_classes 字段
ALTER TABLE profiles ADD COLUMN assigned_classes JSON DEFAULT NULL COMMENT '教师负责的班级ID列表' AFTER max_points;
