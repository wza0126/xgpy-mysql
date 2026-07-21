-- 代理上网（学生上网冲浪）功能
-- 服务端作为唯一可上外网的中转代理，学生通过白名单站点上网

-- 站点白名单：教师维护的可访问站点
CREATE TABLE IF NOT EXISTS proxy_sites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '站点名称',
  url VARCHAR(500) NOT NULL COMMENT '站点入口URL',
  icon VARCHAR(500) DEFAULT NULL COMMENT '图标（emoji或图片URL）',
  enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  sort_order INT NOT NULL DEFAULT 0 COMMENT '排序（越小越靠前）',
  allowed_domains TEXT DEFAULT NULL COMMENT '允许访问的域名白名单，JSON数组字符串，支持前导点通配（如 .douyin.com 匹配其子域）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理上网-站点白名单';

-- 待审核域名：学生访问时命中未白名单的域名自动记录，教师审核后并入站点
CREATE TABLE IF NOT EXISTS proxy_pending_domains (
  id INT AUTO_INCREMENT PRIMARY KEY,
  domain VARCHAR(255) NOT NULL COMMENT '未白名单的域名',
  site_id INT NOT NULL DEFAULT 0 COMMENT '触发时访问的站点ID（0表示未知）',
  hit_count INT NOT NULL DEFAULT 1 COMMENT '命中次数',
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次出现时间',
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最近出现时间',
  UNIQUE KEY uniq_domain_site (domain, site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理上网-待审核域名';

-- 访问记录：仅记录页面级访问（主文档 text/html）
CREATE TABLE IF NOT EXISTS proxy_access_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL COMMENT '学生ID',
  site_id INT NOT NULL COMMENT '站点ID',
  url VARCHAR(1000) NOT NULL COMMENT '访问的上游URL',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_student_time (student_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理上网-访问记录';

-- 学生上网开关：默认关闭，由教师单人或按班级开通
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS can_use_browser TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否允许使用上网冲浪（代理浏览器）';
