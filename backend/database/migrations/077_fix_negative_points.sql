-- 077: 修复历史负积分数据
--
-- 背景：学生积分出现负值（例如 -4900 分）。排查发现在若干扣分链路上缺少下限保护，
-- 且存在「客户端读-改-写绝对赋值」的写法，并发/降级时会写出负数。
-- 本次除了在业务代码与数据库层补齐下限（见 index.js 的积分下限触发器），
-- 还需要把已经写坏的历史数据纠正为 0，避免学生端一直显示负分。
--
-- 说明：只做「负数归零」，不动正常分值，可重复执行。

UPDATE profiles SET current_points = 0 WHERE current_points < 0;

UPDATE profiles SET max_points = 0 WHERE max_points < 0;

UPDATE profiles SET total_points_earned = 0 WHERE total_points_earned < 0;
