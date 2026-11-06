-- 普通测试 / 考试 / 试卷 PK 资格验证新增两项：累计编程填空得分、累计综合题得分（2026-11-06）
--
-- 口径与「刷题打怪系统 → 任务系统」的两个指标完全一致（src/game-task-metrics.js）：
--   · 累计编程填空得分 total_python_fill_score：83 道题各自历史最好得分之和，满分 830（每题 10 分）
--     ⛔ 编程作业（task_type='code'）不计入
--   · 累计综合题得分   total_composite_score  ：30 道题各自历史最好得分之和，满分 600
--     ⛔ 判分必须走 composite-score.getCompositeCredit（按小题分值累计），与练习页同源
--
-- 与原有的「做对题数」「已掌握题数」「WPS/Access 操作题得分」是 AND 关系：
-- 全部条件同时满足才能参加。任一阈值为 NULL / 0 即视为该条件不启用。
--
-- 与迁移 085 / 116 的写法保持一致：tests 与 pk_battle_configs 两张表各自加同名列。
ALTER TABLE `tests`
ADD COLUMN IF NOT EXISTS `qualification_python_fill_score` INT DEFAULT NULL COMMENT '所需累计编程填空得分，NULL表示不限制',
ADD COLUMN IF NOT EXISTS `qualification_composite_score` INT DEFAULT NULL COMMENT '所需累计综合题得分，NULL表示不限制';

ALTER TABLE `pk_battle_configs`
ADD COLUMN IF NOT EXISTS `qualification_python_fill_score` INT DEFAULT NULL COMMENT '所需累计编程填空得分，NULL表示不限制',
ADD COLUMN IF NOT EXISTS `qualification_composite_score` INT DEFAULT NULL COMMENT '所需累计综合题得分，NULL表示不限制';
