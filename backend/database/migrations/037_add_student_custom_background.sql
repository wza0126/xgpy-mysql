-- 学生自定义桌面背景功能
-- 创建时间: 2026-07-13

-- 1. 创建桌面背景图片表
CREATE TABLE IF NOT EXISTS desktop_backgrounds (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '背景名称',
  url VARCHAR(500) NOT NULL COMMENT '背景图片URL',
  is_active TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用: 0禁用 1启用',
  sort_order INT NOT NULL DEFAULT 0 COMMENT '排序顺序',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_is_active (is_active),
  INDEX idx_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='桌面背景图片库';

-- 2. profiles 表新增字段：学生自定义背景URL
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS custom_background VARCHAR(500) DEFAULT NULL COMMENT '学生自定义桌面背景URL';

-- 3. profiles 表新增字段：今日免费设置次数
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS free_bg_changes_today INT NOT NULL DEFAULT 0 COMMENT '今日免费换背景次数';

-- 4. profiles 表新增字段：最后重置免费次数的日期
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_free_bg_reset DATE DEFAULT NULL COMMENT '最后重置免费换背景次数的日期';

-- 5. system_config 新增配置项：学生自定义背景开关
INSERT IGNORE INTO system_config (id, config_key, value) VALUES
('config_student_custom_bg_enabled', 'student_custom_bg_enabled', '{"value": false}');

-- 6. system_config 新增配置项：每次设置需要的积分
INSERT IGNORE INTO system_config (id, config_key, value) VALUES
('config_student_custom_bg_points', 'student_custom_bg_points', '{"value": 10}');

-- 7. system_config 新增配置项：允许自定义背景的班级ID列表
INSERT IGNORE INTO system_config (id, config_key, value) VALUES
('config_student_custom_bg_class_ids', 'student_custom_bg_class_ids', '{"value": []}');

-- 8. system_config 新增配置项：每日免费换背景次数
INSERT IGNORE INTO system_config (id, config_key, value) VALUES
('config_student_free_bg_per_day', 'student_free_bg_per_day', '{"value": 1}');

-- 9. 迁移原有的单个背景配置到 desktop_backgrounds 表
-- 将 system_config 中的 desktop_background 插入到 desktop_backgrounds 表
INSERT IGNORE INTO desktop_backgrounds (id, name, url, is_active, sort_order)
SELECT
  CONCAT('bg_', UNIX_TIMESTAMP()) as id,
  '默认背景' as name,
  JSON_UNQUOTE(JSON_EXTRACT(value, '$.value')) as url,
  1 as is_active,
  0 as sort_order
FROM system_config
WHERE config_key = 'desktop_background'
  AND JSON_UNQUOTE(JSON_EXTRACT(value, '$.value')) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM desktop_backgrounds LIMIT 1);