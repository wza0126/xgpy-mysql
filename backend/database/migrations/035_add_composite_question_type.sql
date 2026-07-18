-- 035_add_composite_question_type.sql
-- 扩展questions表type字段，支持综合题(composite)类型
-- 综合题：包含大题干和多个子题目（选择、填空等）

-- 1. 修改type字段，增加composite类型
ALTER TABLE questions 
  MODIFY COLUMN type ENUM('choice', 'fill_blank', 'code', 'composite') NOT NULL;

-- 2. 添加综合题说明注释
-- composite类型的题目：
--   content字段存储大题干（可含图片）
--   answers字段存储JSON数组，每个元素是一个子题目对象
--   子题目格式: {"index":1, "type":"choice", "content":"...", "options":["A...","B..."], "answers":["A"], "score":3}
