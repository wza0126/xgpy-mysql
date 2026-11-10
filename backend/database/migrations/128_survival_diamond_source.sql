-- 128_survival_diamond_source.sql
-- 生存游戏深度奖励（2026-11-10，吴老定）
--
-- 规则：累计通关层数（survival_profiles.total_levels，死亡不清零）每跨过一个
--   「深度步长」（默认 30 层，老师端难度参数可改）就发 1 颗钻石，步长 0 = 关闭。
--
-- 幂等：source_type='survival_depth'，source_id = 里程碑层数（'30' / '60' / '90' …），
--   靠 uk_source(source_type, source_id, student_id) 保证同一档位一生只发一次 ——
--   死亡回退、重打同一段、网络重试都不会重复入账。
--
-- 为什么必须改 enum：diamond_transactions.source_type 是枚举列，
--   不把 survival_depth 加进去，发钻时 INSERT 会被截断成 ''（严格模式直接报错）。
--
-- 计入每日产出上限：playtime.js 的 EARN_CAPPED_SOURCES 同步加入 'survival_depth'，
--   与测试 / 考试 / 任务共用「每日最多 3 颗」，防止靠刷生存游戏无限换游戏时间。

ALTER TABLE `diamond_transactions`
MODIFY COLUMN `source_type`
  enum('test','exam','mission','manual','adjust','exchange','play_time','survival_depth')
  NOT NULL DEFAULT 'manual'
  COMMENT 'test=测试 exam=考试 mission=任务 manual=老师发放 adjust=后台调整 exchange=商品兑换 play_time=兑换游戏时长 survival_depth=生存游戏深度';
