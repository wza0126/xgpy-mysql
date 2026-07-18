-- 刷题打怪积分战力荣誉系统
-- 1. profiles 表新增字段
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS curr_streak INT NOT NULL DEFAULT 0 COMMENT '当前连续答对题数',
  ADD COLUMN IF NOT EXISTS curr_crit_streak INT NOT NULL DEFAULT 0 COMMENT '当前连续暴击次数',
  ADD COLUMN IF NOT EXISTS curr_wrong INT NOT NULL DEFAULT 0 COMMENT '当前连续答错次数',
  ADD COLUMN IF NOT EXISTS perfect_10_times INT NOT NULL DEFAULT 0 COMMENT '累计达成十连对次数',
  ADD COLUMN IF NOT EXISTS triple_crit_times INT NOT NULL DEFAULT 0 COMMENT '累计达成三连爆次数',
  ADD COLUMN IF NOT EXISTS wrong_3_times INT NOT NULL DEFAULT 0 COMMENT '累计三连错次数',
  ADD COLUMN IF NOT EXISTS extra_crit DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '副本通关赠送暴击值(%)',
  ADD COLUMN IF NOT EXISTS total_correct INT NOT NULL DEFAULT 0 COMMENT '历史答对总题数',
  ADD COLUMN IF NOT EXISTS pet_level INT NOT NULL DEFAULT 1 COMMENT '宠物等级';

-- 2. 临时Buff表
CREATE TABLE IF NOT EXISTS student_buffs (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  buff_type VARCHAR(50) NOT NULL COMMENT 'Buff类型: perfect_crit / critstreak_crit / wrong_debuff',
  crit_modifier DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '暴击率修正值(%)',
  expires_at DATETIME NOT NULL COMMENT '过期时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_student_id (student_id),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. system_config 新增配置项
INSERT IGNORE INTO system_config (id, config_key, value) VALUES
('config_honor_perfect_points', 'honor_perfect_points', '{"value": 50}'),
('config_honor_perfect_buff_crit', 'honor_perfect_buff_crit', '{"value": 5}'),
('config_honor_perfect_buff_minutes', 'honor_perfect_buff_minutes', '{"value": 10}'),
('config_honor_critstreak_buff_crit', 'honor_critstreak_buff_crit', '{"value": 10}'),
('config_honor_critstreak_buff_minutes', 'honor_critstreak_buff_minutes', '{"value": 10}'),
('config_honor_wrong_debuff_crit', 'honor_wrong_debuff_crit', '{"value": 10}'),
('config_honor_wrong_debuff_minutes', 'honor_wrong_debuff_minutes', '{"value": 1}'),
('config_honor_crit_streak_threshold', 'honor_crit_streak_threshold', '{"value": 3}'),
('config_honor_wrong_streak_threshold', 'honor_wrong_streak_threshold', '{"value": 3}'),
('config_crit_base_rate', 'crit_base_rate', '{"value": 5}'),
('config_crit_max_rate', 'crit_max_rate', '{"value": 30}');

-- 4. 迁移已有数据：将 student_pets 的 growth_level 同步到 profiles.pet_level
UPDATE profiles p
JOIN student_pets sp ON sp.student_id = p.id
SET p.pet_level = sp.growth_level
WHERE p.pet_level = 1;

-- 5. 计算已有总答对题数（基于 student_answers）
UPDATE profiles p
SET p.total_correct = (
  SELECT COUNT(*) FROM student_answers sa 
  WHERE sa.student_id = p.id AND sa.is_correct = 1
)
WHERE p.role = 'student';

-- 6. 迁移 profiles.role 枚举支持 super_admin（如果不是已有的）
ALTER TABLE profiles 
  MODIFY COLUMN role ENUM('student', 'teacher', 'super_admin') NOT NULL DEFAULT 'student';
