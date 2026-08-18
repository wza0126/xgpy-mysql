-- 键盘星域：盲打练习应用
-- 创建时间: 2026-08-11
-- 说明: 盲打指法教学 + 打字射击游戏 + 局域网双人对战 + 班级排行榜
--       词表与代码秘境一致（36 项学测 Python 考点）

-- 1. 单人成绩表（班级排行榜数据源）
CREATE TABLE IF NOT EXISTS typing_scores (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT '学生ID',
  score INT NOT NULL DEFAULT 0 COMMENT '本局得分',
  wpm INT NOT NULL DEFAULT 0 COMMENT '打字速度(词/分)',
  accuracy DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '正确率(%)',
  words INT NOT NULL DEFAULT 0 COMMENT '击落单词数',
  chapter INT DEFAULT 0 COMMENT '达成最高关卡',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '成绩时间',
  INDEX idx_user_id (user_id),
  INDEX idx_score (score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='键盘星域单人成绩';

-- 2. 双人房间表（桌子状态，按桌号复用）
CREATE TABLE IF NOT EXISTS typing_rooms (
  id VARCHAR(50) PRIMARY KEY,
  table_no INT NOT NULL COMMENT '桌号',
  player1_id VARCHAR(36) COMMENT '左座玩家ID',
  player2_id VARCHAR(36) COMMENT '右座玩家ID',
  status VARCHAR(20) DEFAULT 'idle' COMMENT '状态: idle/waiting/ready/playing/finished',
  p1_ready BOOLEAN DEFAULT FALSE COMMENT '左座是否已同意',
  p2_ready BOOLEAN DEFAULT FALSE COMMENT '右座是否已同意',
  seed VARCHAR(64) COMMENT '词序随机种子',
  p1_score INT DEFAULT 0 COMMENT '左座得分',
  p2_score INT DEFAULT 0 COMMENT '右座得分',
  p1_hp INT DEFAULT 3 COMMENT '左座血量',
  p2_hp INT DEFAULT 3 COMMENT '右座血量',
  chapter INT DEFAULT 1 COMMENT '当前关卡',
  winner VARCHAR(20) DEFAULT '' COMMENT '胜者: p1/p2/draw/空',
  start_at DATETIME NULL COMMENT '开赛时间',
  ended_at DATETIME NULL COMMENT '结束时间',
  last_seen DATETIME NULL COMMENT '最近心跳时间(30s超时视为掉线)',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_table_no (table_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='键盘星域双人房间';

-- 3. 双人战绩表
CREATE TABLE IF NOT EXISTS typing_duel_records (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT '玩家ID',
  opponent_id VARCHAR(36) COMMENT '对手ID',
  result VARCHAR(10) NOT NULL COMMENT '结果: win/lose/draw',
  score INT NOT NULL DEFAULT 0 COMMENT '本场得分',
  opponent_score INT DEFAULT 0 COMMENT '对手得分',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '对局时间',
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='键盘星域双人战绩';

-- 4. 在 apps 表注册键盘星域应用
INSERT IGNORE INTO apps (id, name, description, icon, type, price_type, points_price, category, is_active, is_marketplace, config, created_by)
VALUES (
  'app_typing_trainer',
  '键盘星域',
  '盲打练习 + 打字射击 + 局域网双人对战！36 个学测 Python 考点词汇随玩随记，指法键位图 3D 辅助，班级排行榜比拼手速。',
  '⌨️',
  'typing_trainer',
  'free',
  0,
  '编程实训',
  TRUE,
  TRUE,
  JSON_OBJECT(
    'tables', 6,
    'difficulty', 'standard'
  ),
  'teacher1'
);

-- 5. 默认可见性（对 class1 可见，教师可自行调整）
INSERT IGNORE INTO app_visibility (id, app_id, class_id, is_visible)
VALUES ('av_typing_class1', 'app_typing_trainer', 'class1', TRUE);
