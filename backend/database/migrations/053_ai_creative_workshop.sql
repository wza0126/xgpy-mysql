-- AI创意工坊模块数据库表结构
-- 创建时间: 2026-07-30
-- 说明: 学生用AI生成单HTML网页作品，发布到工坊应用中心供其他学生积分购买，作者按比例提成

-- 1. 工坊配置表（单行，id=1）
CREATE TABLE IF NOT EXISTS ai_workshop_config (
  id INT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN DEFAULT TRUE COMMENT '工坊总开关',
  author_share_percent INT DEFAULT 60 COMMENT '作者提成比例(%)',
  min_price INT DEFAULT 1 COMMENT '学生定价最低积分',
  max_price INT DEFAULT 100 COMMENT '学生定价最高积分',
  daily_gen_limit INT DEFAULT 10 COMMENT '每日AI生成+修改总次数上限',
  gen_cost INT DEFAULT 2 COMMENT '每次AI生成扣除积分',
  modify_cost INT DEFAULT 1 COMMENT '每次AI修改扣除积分',
  min_requirement_chars INT DEFAULT 10 COMMENT '需求提示词最少字数',
  enabled_classes JSON DEFAULT NULL COMMENT '允许访问工坊的班级ID列表(NULL=全部班级)',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO ai_workshop_config (id) VALUES (1);

-- 2. 作品表
CREATE TABLE IF NOT EXISTS ai_works (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL COMMENT '作者学生ID',
  title VARCHAR(200) NOT NULL COMMENT '作品名称',
  description TEXT COMMENT '作品简介',
  icon VARCHAR(50) DEFAULT '🧩' COMMENT '表情图标',
  requirement TEXT COMMENT '创建时输入的需求提示词',
  code LONGTEXT COMMENT '当前HTML代码',
  price INT DEFAULT 0 COMMENT '积分价格',
  status ENUM('draft', 'pending', 'approved', 'rejected', 'removed') DEFAULT 'draft' COMMENT '状态:草稿/待审核/已上架/被驳回/已下架',
  reject_reason TEXT COMMENT '驳回原因',
  category VARCHAR(50) DEFAULT '创意应用' COMMENT '分类',
  view_count INT DEFAULT 0 COMMENT '浏览量',
  purchase_count INT DEFAULT 0 COMMENT '购买量',
  is_featured BOOLEAN DEFAULT FALSE COMMENT '老师推荐置顶',
  featured_at TIMESTAMP NULL COMMENT '推荐时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_student_id (student_id),
  INDEX idx_status (status),
  INDEX idx_featured (is_featured, featured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 作品版本快照表（每次AI生成/修改存一份）
CREATE TABLE IF NOT EXISTS ai_work_versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  work_id VARCHAR(50) NOT NULL COMMENT '作品ID',
  code LONGTEXT COMMENT '版本代码',
  note VARCHAR(500) COMMENT '版本说明(AI修改要求等)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_work_id (work_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 审核记录表
CREATE TABLE IF NOT EXISTS ai_work_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  work_id VARCHAR(50) NOT NULL COMMENT '作品ID',
  reviewer_id VARCHAR(50) COMMENT '审核教师ID',
  action ENUM('approved', 'rejected') NOT NULL COMMENT '审核结果',
  reason TEXT COMMENT '审核意见/驳回原因',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_work_id (work_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. 购买记录表
CREATE TABLE IF NOT EXISTS ai_work_purchases (
  id VARCHAR(50) PRIMARY KEY,
  work_id VARCHAR(50) NOT NULL COMMENT '作品ID',
  buyer_id VARCHAR(50) NOT NULL COMMENT '购买者学生ID',
  price INT DEFAULT 0 COMMENT '成交价格',
  author_share INT DEFAULT 0 COMMENT '作者提成积分',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_buyer_work (work_id, buyer_id),
  INDEX idx_buyer_id (buyer_id),
  INDEX idx_work_id (work_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. 桌面专注模式显示开关：AI创意工坊
ALTER TABLE pet_config
ADD COLUMN IF NOT EXISTS focus_mode_show_creative BOOLEAN DEFAULT TRUE COMMENT '专注模式是否显示AI创意工坊图标';

-- 7. 默认开启
UPDATE pet_config SET focus_mode_show_creative = TRUE WHERE focus_mode_show_creative IS NULL;
