-- 代码秘境：Python 关键字 RPG 游戏
-- 创建时间: 2026-08-11
-- 说明: 围绕江苏省信息技术学测 Python 考点（19 关键字 + 17 内置函数/方法）的 RPG 游戏
--       学生通过 7 大秘境通关掌握 36 项知识点，通关后由教师配置奖励积分与装备

-- 1. 玩家进度表（存档上报）
CREATE TABLE IF NOT EXISTS code_realm_progress (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT '用户ID',
  current_chapter INT DEFAULT 0 COMMENT '当前章节(0=序幕,1-7=秘境)',
  current_step VARCHAR(50) DEFAULT 'intro' COMMENT '当前步骤: intro/map/scene/boss/completed',
  completed_keywords JSON COMMENT '已收集图鉴项ID列表(36项)',
  completed_chapters JSON COMMENT '已通关章节ID列表',
  badges JSON COMMENT '已获得称号ID列表',
  total_xp INT DEFAULT 0 COMMENT '总经验值',
  reward_claimed BOOLEAN DEFAULT FALSE COMMENT '通关奖励是否已领取',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_id (user_id),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代码秘境游戏进度';

-- 2. 在 apps 表注册代码秘境应用
INSERT IGNORE INTO apps (id, name, description, icon, type, price_type, points_price, category, is_active, is_marketplace, config, created_by)
VALUES (
  'app_code_realm',
  '代码秘境',
  '在奇幻秘境中闯关学习 Python 关键字！7 大秘境、6 场 Boss 战，收集 36 个学测考点。通关后可获教师配置的积分与装备奖励。',
  '🔮',
  'code_realm',
  'free',
  0,
  '编程实训',
  TRUE,
  TRUE,
  JSON_OBJECT(
    'chapters', 7,
    'keywordCount', 36,
    'reward_enabled', TRUE,
    'points_reward', 100,
    'equipment_id', ''
  ),
  'teacher1'
);

-- 3. 默认可见性（对 class1 可见，教师可自行调整）
INSERT IGNORE INTO app_visibility (id, app_id, class_id, is_visible)
VALUES ('av_code_realm_class1', 'app_code_realm', 'class1', TRUE);
