-- Python魔法学院奖励机制

-- 1. 为python_magic_progress表添加奖励领取标记
ALTER TABLE python_magic_progress 
ADD COLUMN IF NOT EXISTS reward_claimed BOOLEAN DEFAULT false COMMENT '奖励是否已领取';

-- 2. 更新Python魔法学院应用配置，添加奖励设置字段
UPDATE apps 
SET config = JSON_MERGE_PATCH(config, JSON_OBJECT(
  'reward_enabled', true,
  'points_reward', 100,
  'equipment_id', ''
))
WHERE id = 'app_python_magic_academy';