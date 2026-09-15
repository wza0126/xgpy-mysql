-- 随堂习题：临时题（快速录入 / AI 出题）支持解析
-- 此前临时题没有解析字段，题库题解析取自 questions.explanation
-- 创建时间: 2026-09-15

ALTER TABLE task_question
  ADD COLUMN IF NOT EXISTS temp_explanation TEXT
    COMMENT '临时题解析（快速录入/AI出题）'
    AFTER temp_answer;
