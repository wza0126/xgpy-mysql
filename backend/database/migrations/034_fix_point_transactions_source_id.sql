-- 修复 point_transactions.source_id 的类型
-- 原类型为 INT，无法存储字符串类型的 source_id（如 python_submit 的 submissionId）
-- 导致去重查询失效，学生可重复提交刷积分
ALTER TABLE point_transactions 
MODIFY COLUMN source_id VARCHAR(50) NULL COMMENT '来源ID（支持字符串类型的ID）';
