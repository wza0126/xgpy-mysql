-- 本地化外部资源：内网/无外网机房离线部署时，桌面背景不再引用外部图床（原默认指向 images.unsplash.com）
-- 创建时间: 2026-09-05

-- 1. 系统当前桌面背景配置：若值为外部 http(s) 链接，改为随前端打包的本地内置背景
--    （'/backgrounds/default-bg.svg' 由前端 public/ 目录提供，与页面同源加载）
UPDATE system_config
SET value = JSON_OBJECT('value', '/backgrounds/default-bg.svg'), updated_at = NOW()
WHERE config_key = 'desktop_background'
  AND value LIKE '%http%';

-- 2. 桌面背景库：外链背景统一替换为本地内置背景
--    （教师通过上传功能保存的本地背景为 /uploads/... 相对路径，不受影响）
UPDATE desktop_backgrounds
SET url = '/backgrounds/default-bg.svg'
WHERE url LIKE 'http://%' OR url LIKE 'https://%';
