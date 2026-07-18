-- Python魔法学院 RPG游戏模块数据库表结构
-- 适配江苏省高中信息技术课标 Python部分

-- 1. 玩家游戏进度表
CREATE TABLE IF NOT EXISTS python_magic_progress (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT '用户ID',
  current_chapter INT DEFAULT 0 COMMENT '当前章节(0=序章,1-7=章节)',
  current_step VARCHAR(50) DEFAULT 'dialogue' COMMENT '当前步骤: dialogue/challenge/boss/completed',
  completed_challenges JSON COMMENT '已完成的挑战ID列表',
  badges JSON COMMENT '已获得的徽章ID列表',
  total_xp INT DEFAULT 0 COMMENT '总经验值',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_id (user_id),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 在apps表中注册Python魔法学院应用
INSERT IGNORE INTO apps (id, name, description, icon, type, price_type, points_price, category, is_active, is_marketplace, config, created_by)
VALUES (
  'app_python_magic_academy',
  'Python魔法学院',
  '化身魔法学徒，在RPG冒险中闯关学习Python编程！7大章节涵盖print、变量、分支、循环等全部知识点，AI魔法伙伴"小智"全程陪伴指导。',
  '🪄',
  'python_magic_academy',
  'free',
  0,
  '学习工具',
  TRUE,
  TRUE,
  JSON_OBJECT(
    'chapters', 7,
    'aiAssistant', TRUE,
    'xpSystem', TRUE,
    'badgeSystem', TRUE
  ),
  'teacher1'
);

-- 3. 设置默认可见性（对class1可见）
INSERT IGNORE INTO app_visibility (id, app_id, class_id, is_visible)
VALUES ('av_python_magic_class1', 'app_python_magic_academy', 'class1', TRUE);
