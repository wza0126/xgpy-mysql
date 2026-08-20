-- classes 表添加数字消息开关字段
-- 该列此前仅存在于开发库中（手动添加），未纳入迁移，导致数据库恢复/重建后缺失
ALTER TABLE classes ADD COLUMN IF NOT EXISTS dm_enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否允许该班级学生使用数字消息功能';
