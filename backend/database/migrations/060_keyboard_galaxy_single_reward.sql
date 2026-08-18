-- 键盘星域：单人游戏奖励（运指如飞荣誉）与排行榜排序增强
-- 1. profiles 增加「运指如飞」荣誉计数（单人游戏速度达标）
ALTER TABLE profiles
  ADD COLUMN typing_fast_times INT NOT NULL DEFAULT 0 COMMENT '运指如飞荣誉次数';

-- 2. 打怪系统新增「运指如飞Buff」暴击加成与时长配置（教师可调整）
INSERT INTO system_config (id, config_key, value, updated_at) VALUES
('config_honor_typingfast_crit', 'honor_typingfast_buff_crit', '{"value":"10"}', NOW()),
('config_honor_typingfast_minutes', 'honor_typingfast_buff_minutes', '{"value":"30"}', NOW())
ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW();

-- 3. 键盘星域应用配置增加「单人游戏奖励」档位（WPM 门槛 + 积分），保留既有配置
UPDATE apps SET config = JSON_SET(
  IFNULL(config, JSON_OBJECT()),
  '$.single_reward', JSON_OBJECT('wpm', 60, 'points', 30)
) WHERE id = 'app_typing_trainer';
