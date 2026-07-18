-- 修复 point_transactions.source_type 的 ENUM
-- 添加 practice、pet_feed、test、python_submit 作为合法值
ALTER TABLE point_transactions 
MODIFY COLUMN source_type ENUM('notification', 'manual', 'system', 'practice', 'pet_feed', 'test', 'python_submit') NOT NULL DEFAULT 'notification' COMMENT '来源类型';
