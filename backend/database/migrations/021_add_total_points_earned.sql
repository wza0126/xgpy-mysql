-- 添加累计获得积分字段
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS total_points_earned INT DEFAULT 0 COMMENT '累计获得的所有积分总和';

-- 用 point_transactions 表初始化历史数据（只计算正值）
UPDATE profiles p
SET total_points_earned = (
  SELECT COALESCE(SUM(amount), 0)
  FROM point_transactions pt
  WHERE pt.student_id = p.id AND pt.amount > 0
)
WHERE total_points_earned = 0;
