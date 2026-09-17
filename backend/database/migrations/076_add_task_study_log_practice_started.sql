-- 076: 记录学生随堂练习的首次作答时间
--
-- 背景：task_study_log.status 的 1（进行中）原本由「学习进度上报」置位，
-- 等价于「打开过任务详情页」，无法表达「开始做题」。
-- 新增独立字段，专门标记学生是否动过随堂练习的第一题。
--
-- 教师端「学生列表」状态判定改为：已完成(2) > practice_started_at 非空 → 练习中 > 未开始
-- 该字段只在首次作答时写入，后续进度上报不覆盖（IFNULL 保护）。
-- 老师「重置练习」时置回 NULL。

ALTER TABLE task_study_log
  ADD COLUMN IF NOT EXISTS practice_started_at DATETIME NULL
  COMMENT '随堂练习首次作答时间，NULL 表示尚未开始练习' AFTER status;
