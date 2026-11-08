-- 127_play_time_pool.sql
-- 游戏时长池（2026-11-08）
--
-- 模型：钻石 → 时长池（分钟）→ 娱乐应用按秒消耗。见 126 的钻石钱包。
--   1 颗钻石 = 5 分钟（可配）；每日产出上限 3 颗、每日消费上限 30 分钟（均可配）。
--   ⛔ 时长池是**全局共用**的，不按应用分池；否则学生换着应用玩就绕过了上限。
--
-- 与积分/钻石的关系：
--   · 时长不能用积分买，只能用钻石买（钻石来源受限，积分可刷）
--   · 兑换时长会扣钻石，记在 diamond_transactions（source_type='play_time'）
--   · 玩的时间记在 play_time_logs（负数），二者是两套账，不要混
--
-- 应用侧：apps.price_type 新增 'time' 值 —— 该应用不扣积分，改消耗时长池。
--   每个应用由老师逐个设置，不做「学习/娱乐」分类。

-- ============================================================
-- 1. 时长余额（秒）
-- ============================================================
-- 用秒存、用分钟显示：兑换是 5 分钟粒度，但心跳每 30 秒扣一次，存秒才能不丢精度。
ALTER TABLE `profiles`
ADD COLUMN IF NOT EXISTS `play_seconds_balance` INT NOT NULL DEFAULT 0
  COMMENT '游戏时长余额（秒）。全局共用，不按应用分';

-- ============================================================
-- 2. 时长流水
-- ============================================================
CREATE TABLE IF NOT EXISTS `play_time_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `student_id` VARCHAR(50) NOT NULL COMMENT '学生ID',
  `seconds` INT NOT NULL COMMENT '变动量：正=兑换充值，负=游玩消耗',
  `reason` VARCHAR(255) NOT NULL COMMENT '展示原因',
  `source_type` ENUM('exchange','consume','adjust') NOT NULL DEFAULT 'consume'
    COMMENT 'exchange=钻石兑换 consume=游玩消耗 adjust=老师调整',
  `source_id` VARCHAR(50) NULL COMMENT '幂等来源：兑换用兑换流水id',
  `app_id` VARCHAR(50) NULL COMMENT '消耗时记录是哪个应用（统计用）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_source` (`source_type`, `source_id`, `student_id`),
  INDEX `idx_student_time` (`student_id`, `created_at`),
  INDEX `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='游戏时长流水';

-- ============================================================
-- 3. 应用：新增「按时长」计费模式
-- ============================================================
-- 只加注释说明新取值，不改类型（varchar(20) 本来就能存 'time'）。
-- 现有 9 个应用全部保持 free，老师改哪个哪个才生效。
ALTER TABLE `apps`
MODIFY COLUMN `price_type` VARCHAR(20) NOT NULL DEFAULT 'free'
  COMMENT 'free=免费 points=积分买断 per_use=按次积分 time=按时长（消耗时长池）';

-- ============================================================
-- 4. 钻石流水：新增 play_time 来源
-- ============================================================
-- 兑换时长属于「花钻石」，必须记在钻石账本里，否则钻石余额与流水对不上。
ALTER TABLE `diamond_transactions`
MODIFY COLUMN `source_type`
  ENUM('test', 'exam', 'mission', 'manual', 'adjust', 'exchange', 'play_time')
  NOT NULL DEFAULT 'manual'
  COMMENT 'test=测试 exam=考试 mission=任务 manual=老师发放 adjust=后台调整 exchange=商品兑换 play_time=兑换游戏时长';

-- ============================================================
-- 5. 规则参数（老师端可改，改完立即生效，不用发版）
-- ============================================================
-- 沿用 system_config 的 {"value": X} 格式，与 ai_model 等现有配置一致。
-- ⛔ 这里只是默认值，INSERT IGNORE 保证重复执行不会覆盖老师改过的数。
INSERT IGNORE INTO `system_config` (`id`, `config_key`, `value`) VALUES
  ('config_play_diamond_to_minutes', 'play_diamond_to_minutes', JSON_OBJECT('value', 5)),
  ('config_play_daily_earn_cap',     'play_daily_earn_cap',     JSON_OBJECT('value', 3)),
  ('config_play_daily_minutes_cap',  'play_daily_minutes_cap',  JSON_OBJECT('value', 30)),
  ('config_play_max_exchange_minutes','play_max_exchange_minutes', JSON_OBJECT('value', 30));
