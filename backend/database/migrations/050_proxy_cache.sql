-- 代理上网-静态资源磁盘缓存
-- 学生重复访问相同静态资源（图片/CSS/JS/字体/视频）时直接由教师机磁盘返回，不再消耗外网带宽
-- 文件本体存 cache/web-proxy/ 目录（文件名即 url_hash），本表为索引：用于统计用量与 LRU 淘汰

CREATE TABLE IF NOT EXISTS proxy_cache_files (
  url_hash CHAR(64) NOT NULL COMMENT '完整上游URL的sha256',
  url TEXT NOT NULL COMMENT '完整上游URL（含query，签名URL原样做key，过期重新拉是自然行为）',
  file_name VARCHAR(255) NOT NULL COMMENT '缓存目录下的文件名',
  size_bytes BIGINT NOT NULL DEFAULT 0 COMMENT '文件大小（字节）',
  content_type VARCHAR(100) NOT NULL DEFAULT '' COMMENT '响应Content-Type',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次缓存时间',
  last_accessed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最近命中时间（淘汰依据）',
  PRIMARY KEY (url_hash),
  INDEX idx_last_accessed (last_accessed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理上网-静态资源缓存索引';

-- 缓存设置（沿用 system_config 机制：value 为 {"value":...} JSON）
INSERT INTO system_config (id, config_key, value, updated_at)
VALUES ('config_proxy_cache_enabled', 'proxy_cache_enabled', '{"value":1}', NOW())
ON DUPLICATE KEY UPDATE config_key = config_key;

INSERT INTO system_config (id, config_key, value, updated_at)
VALUES ('config_proxy_cache_limit_mb', 'proxy_cache_limit_mb', '{"value":2048}', NOW())
ON DUPLICATE KEY UPDATE config_key = config_key;
