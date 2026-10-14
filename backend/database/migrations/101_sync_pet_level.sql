-- 101_sync_pet_level.sql
-- 修复 profiles.pet_level 的陈旧值：把这一列按真源 student_pets.growth_level 重新对齐。
--
-- 背景（2026-10-14 实测）：
--   profiles.pet_level 是 019 / 020 迁移一次性回填出来的**历史缓存列**，
--   回填语句是 `SET p.pet_level = sp.growth_level WHERE p.pet_level = 1`，
--   而在这之后**没有任何代码写过它**（feed-pet / 前端换宠都只更新 student_pets）。
--   结果是它永久停在回填当时的等级上：
--     学生 a —— 真源 growth_level = 16，profiles.pet_level 却一直是 5，
--   而任务系统的「宠物等级」指标正好读的就是这一列 →
--   表现为「宠物等级 5 级就封顶了，怎么喂都不涨」。
--
-- 口径（与萌宠模块一致，务必别改）：
--   · **等级（growth_level）无上限**，可以一直涨；
--   · **阶段（形态）= LEAST(等级, max_stage)**，max_stage 默认为 5，
--     所以从 6 级开始都显示第 5 阶段「究极体」，但等级数字继续往上走；
--   · 没有宠物的学生一律记 1。
--
-- 说明：
--   1) 本次只做**一次性数据修复**。真正的读取方已经改成直接读 student_pets
--      （game-task-metrics.js 的 pet_level 指标），不再依赖这一列，
--      所以即使以后再漂移也不会影响任何展示；这一列现在只是「保持不撒谎」。
--   2) 迁移只在平台启动时跑一次，且只在真正有差异的行上写；
--      用 `<=>`（NULL 安全等号）是为了兼容 pet_level 为 NULL 的历史行。
--   3) 幂等：重复执行不会匹配到任何行（条件已消解）。

UPDATE `profiles` p
LEFT JOIN (
  SELECT `student_id`, MAX(`growth_level`) AS `lv`
    FROM `student_pets`
   GROUP BY `student_id`
) sp ON sp.`student_id` = p.`id`
   SET p.`pet_level` = COALESCE(sp.`lv`, 1)
 WHERE NOT (p.`pet_level` <=> COALESCE(sp.`lv`, 1));
