-- 为 pet_config 表添加双击打开AI答疑的配置字段
ALTER TABLE pet_config 
ADD COLUMN IF NOT EXISTS double_click_aiqa BOOLEAN DEFAULT TRUE;