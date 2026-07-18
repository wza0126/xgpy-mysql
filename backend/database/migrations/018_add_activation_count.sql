-- 为 system_license 表添加激活计数器字段
-- 创建时间: 2026-06-24
-- 说明: 每次激活递增，使机器码带序号后缀，确保每次授权码不同

ALTER TABLE system_license 
ADD COLUMN IF NOT EXISTS activation_count INT NOT NULL DEFAULT 0 COMMENT '激活次数计数器' AFTER consumed_codes;

-- 对已有激活记录的系统，设置初始计数为1（表示已激活1次）
UPDATE system_license 
SET activation_count = 1 
WHERE is_activated = TRUE 
  AND activation_count = 0;
