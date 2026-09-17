-- 为 point_transactions.source_type 增加 'task'（课堂任务合格奖励）
-- 备课工作台「随堂习题合格奖励」发放积分时会写入 source_type='task'，
-- 严格模式下若缺少该枚举值会导致发奖语句报错，进而使整个提交事务失败。
ALTER TABLE point_transactions
MODIFY COLUMN source_type ENUM('notification', 'manual', 'system', 'practice', 'pet_feed', 'test', 'python_submit', 'exam', 'task') NOT NULL DEFAULT 'notification' COMMENT '来源类型';
