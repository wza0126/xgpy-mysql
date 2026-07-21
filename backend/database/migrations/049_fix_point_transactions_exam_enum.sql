-- 修复 point_transactions.source_type 枚举缺少 'exam'
-- submit-exam 在考试通过发积分时会写入 source_type='exam'，严格模式下导致整个提交事务回滚
ALTER TABLE point_transactions
MODIFY COLUMN source_type ENUM('notification', 'manual', 'system', 'practice', 'pet_feed', 'test', 'python_submit', 'exam') NOT NULL DEFAULT 'notification' COMMENT '来源类型';
