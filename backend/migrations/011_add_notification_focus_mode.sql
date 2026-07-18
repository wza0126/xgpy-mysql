-- 为 notifications 表添加专注模式字段（用于通知下发控制pet_config.focus_mode_enabled）
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS enable_focus_mode BOOLEAN DEFAULT TRUE;

-- 移除 profiles 表中之前添加的专注模式字段（专注模式统一由 pet_config.focus_mode_enabled 控制）
ALTER TABLE profiles 
DROP COLUMN IF EXISTS enable_focus_mode;
