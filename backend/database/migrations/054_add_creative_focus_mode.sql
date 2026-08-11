-- 补全 AI创意工坊 桌面专注模式显示开关字段
-- 创建时间: 2026-07-30
-- 说明: 053 迁移首次应用时未包含该字段（checksum 已固化），这里单独补齐

ALTER TABLE pet_config
ADD COLUMN IF NOT EXISTS focus_mode_show_creative BOOLEAN DEFAULT TRUE COMMENT '专注模式是否显示AI创意工坊图标';

UPDATE pet_config SET focus_mode_show_creative = TRUE WHERE focus_mode_show_creative IS NULL;
