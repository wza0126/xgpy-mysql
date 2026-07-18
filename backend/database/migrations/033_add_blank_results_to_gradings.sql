-- 为 python_gradings 表添加填空题评分结果字段
ALTER TABLE python_gradings ADD COLUMN IF NOT EXISTS blank_results JSON COMMENT '填空题每空评分详情';
