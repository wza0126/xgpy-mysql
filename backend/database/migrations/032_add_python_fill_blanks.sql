-- Python编程填空题功能
-- 为 python_tasks 表添加填空相关字段

ALTER TABLE python_tasks ADD COLUMN IF NOT EXISTS blank_template TEXT COMMENT '填空模板代码（含①②③等占位符）';
ALTER TABLE python_tasks ADD COLUMN IF NOT EXISTS blank_answers JSON COMMENT '各空白标准答案列表 [[答案1,答案2],[答案1],...]，每个空可多个正确答案';
ALTER TABLE python_tasks ADD COLUMN IF NOT EXISTS blank_weights JSON COMMENT '各空白分值占比 [40,30,30]';
