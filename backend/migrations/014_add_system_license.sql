-- 为系统添加授权功能表
CREATE TABLE IF NOT EXISTS system_license (
  id INT PRIMARY KEY DEFAULT 1 COMMENT '单行记录，固定id=1',
  machine_code VARCHAR(128) NOT NULL COMMENT '设备机器码（SHA256）',
  license_code VARCHAR(256) DEFAULT NULL COMMENT '授权码',
  is_activated BOOLEAN DEFAULT FALSE COMMENT '是否已激活',
  activated_at TIMESTAMP NULL COMMENT '激活时间',
  expires_at TIMESTAMP NULL COMMENT '授权到期时间（NULL表示永久）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 插入默认记录
INSERT IGNORE INTO system_license (id, machine_code, is_activated)
VALUES (1, 'PENDING', FALSE);
