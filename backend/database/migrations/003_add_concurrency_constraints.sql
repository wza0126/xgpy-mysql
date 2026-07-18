-- 003_add_concurrency_constraints.sql
-- 添加并发控制约束：防止数据错乱

-- 1. 给兑换记录表添加日期字段（便于建立唯一约束）
ALTER TABLE exchange_records ADD COLUMN IF NOT EXISTS exchanged_date DATE 
  GENERATED ALWAYS AS (DATE(exchanged_at)) STORED;

-- 2. 给兑换记录表添加唯一约束，防止同一天同一用户兑换同一奖品多次
ALTER TABLE exchange_records ADD UNIQUE KEY IF NOT EXISTS uk_student_prize_date (student_id, prize_id, exchanged_date);

-- 3. 给积分流水记录表添加索引，提升查询性能
ALTER TABLE point_transactions ADD INDEX IF NOT EXISTS idx_student_transaction_time (student_id, created_at);

-- 4. 给学生答题记录表添加索引，提升查询性能
ALTER TABLE student_answers ADD INDEX IF NOT EXISTS idx_student_question (student_id, question_id);
