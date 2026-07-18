-- classes 表添加 AI答疑开关字段
ALTER TABLE classes ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否允许该班级使用AI答疑应用';
