-- 学生桌面背景配置
-- 创建时间: 2026-05-28

-- 检查并插入默认桌面背景配置
-- 如果已经存在则不修改，确保数据一致性
INSERT IGNORE INTO system_config (id, config_key, value)
VALUES (
  'config_desktop_background', 
  'desktop_background', 
  JSON_OBJECT('value', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=80&w=2070&auto=format&fit=crop')
);
