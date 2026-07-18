-- 添加宠物等级配置表
-- 支持无限等级，阶段固定5个，等级阈值可配置

-- 1. 为 pet_config 表添加等级基础阈值和增量配置
ALTER TABLE pet_config
ADD COLUMN IF NOT EXISTS level_base_threshold INT DEFAULT 50 COMMENT '1级到2级的基础成长值阈值',
ADD COLUMN IF NOT EXISTS level_threshold_increment INT DEFAULT 50 COMMENT '每升一级阈值增加量',
ADD COLUMN IF NOT EXISTS max_stage INT DEFAULT 5 COMMENT '最大阶段数（用于图片显示）';

-- 2. 插入默认配置
UPDATE pet_config
SET level_base_threshold = 50,
    level_threshold_increment = 50,
    max_stage = 5
WHERE level_base_threshold IS NULL;
