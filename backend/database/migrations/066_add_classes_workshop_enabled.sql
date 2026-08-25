-- classes 表添加工坊开关字段（与 classes.ai_enabled / dm_enabled 保持一致）
-- 说明：教师在班级管理切换该开关时，后端同步写入 ai_workshop_config.enabled_classes JSON 数组
-- classAllowed() 判定仍走 ai_workshop_config.enabled_classes，无需改逻辑
ALTER TABLE classes ADD COLUMN IF NOT EXISTS workshop_enabled TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '是否允许该班级使用 AI 创意工坊（1允许 0禁止），默认允许；切换时后端同步更新 ai_workshop_config.enabled_classes';
