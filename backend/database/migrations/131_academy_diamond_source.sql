-- 131_academy_diamond_source.sql
-- 星卡学院首通奖励来源（2026-11-16）
--
-- 为什么新增一个来源而不是复用 mission：
--   学院是独立玩法，老师查流水时要能一眼分清「任务奖励」和「学院首通」；
--   复用 mission 会让两类奖励混在一起，以后也统计不出学院的实际产出。
--
-- ⛔ 加进枚举后必须同步 playtime.js 的 EARN_CAPPED_SOURCES，
--    否则学院奖励会绕过每日钻石产出上限（吴老明确要求纳入上限）。

ALTER TABLE `diamond_transactions`
  MODIFY COLUMN `source_type`
    enum('test','exam','mission','manual','adjust','exchange','play_time','survival_depth','academy')
    NOT NULL DEFAULT 'manual'
    COMMENT '钻石来源：test 测试 / exam 考试 / mission 任务 / academy 学院首通 / manual 老师发放 / adjust 余额调整 / exchange 兑换消耗 / play_time 兑换游戏时长 / survival_depth 生存深度';
