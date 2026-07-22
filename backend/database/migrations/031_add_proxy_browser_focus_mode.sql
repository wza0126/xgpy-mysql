-- 添加上网冲浪模块的专注模式配置字段

ALTER TABLE pet_config
ADD COLUMN IF NOT EXISTS focus_mode_show_proxyBrowser BOOLEAN DEFAULT true COMMENT '专注模式下是否显示上网冲浪图标';