-- 126_diamond_wallet.sql
-- 钻石钱包（2026-11-08）
--
-- 背景：积分来自练习刷题（50 万笔流水、544 万分），本质是「劳动量计量」，不适合
--   作为上网码、游戏时间这类高价值权益的凭证。新增「钻石」作为成绩/任务凭证货币：
--   · 积分：原样保留，继续兑换低价值物品（皮肤、草稿纸、宠物粮）
--   · 钻石：来源受限（测试、考试、任务、老师手动），兑换高价值物品
--   ⛔ 两种货币永不互通，任何汇率都会让钻石被刷出来。
--
-- 发放口径（吴老 2026-11-08 定）：
--   · 考试 exam：**同一次考试只发首次及格那一次**，重考不再发 → 幂等键用 test_id
--   · 测试 test：随机组卷、每次卷子不同、有每日次数限制，**每次及格都发** → 幂等键用本次提交记录 id
--   · 任务 mission / 老师手动 manual / 后台调整 adjust：均记流水
--   · 余额不清零（学生最多用两学期，后续另做数据清理功能）

-- ============================================================
-- 1. 钱包余额
-- ============================================================
ALTER TABLE `profiles`
ADD COLUMN IF NOT EXISTS `diamond_balance` INT NOT NULL DEFAULT 0 COMMENT '钻石余额（不清零）';

-- ============================================================
-- 2. 钻石流水（账本，余额以本表为准）
-- ============================================================
-- uk_source 是幂等的关键：同一 (来源类型, 来源ID, 学生) 只允许入账一次。
-- source_id 为 NULL 时不参与唯一约束（老师手动发放、后台调整可以有多条）。
CREATE TABLE IF NOT EXISTS `diamond_transactions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `student_id` VARCHAR(50) NOT NULL COMMENT '学生ID',
  `amount` INT NOT NULL COMMENT '变动量，正数入账、负数扣减',
  `reason` VARCHAR(255) NOT NULL COMMENT '展示给学生的说明',
  `source_type` ENUM('test','exam','mission','manual','adjust','exchange') NOT NULL DEFAULT 'manual'
    COMMENT 'test=测试 exam=考试 mission=任务 manual=老师发放 adjust=后台调整 exchange=兑换消耗',
  `source_id` VARCHAR(50) NULL
    COMMENT '幂等来源：考试用 test_id，测试用 test_records.id，兑换用 exchange_records.id',
  `teacher_id` VARCHAR(50) NULL COMMENT '操作教师（manual/adjust 时有值）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_source` (`source_type`, `source_id`, `student_id`),
  INDEX `idx_student_time` (`student_id`, `created_at`),
  INDEX `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='钻石流水（账本）';

-- ============================================================
-- 3. 测试 / 考试：钻石奖励配置
-- ============================================================
-- 与 points_reward 并列：及格线（passing_score）以上发放**整颗**钻石，不及格发 0。
-- 0 = 该场不发钻石（默认，现有 20 余场全部不受影响）。
ALTER TABLE `tests`
ADD COLUMN IF NOT EXISTS `diamond_reward` INT NOT NULL DEFAULT 0
  COMMENT '及格奖励钻石数，0=不发放';

-- ============================================================
-- 4. 商品：支持用积分或钻石兑换
-- ============================================================
-- 价格仍复用 points_cost 这一列（老师界面上就是「价格」一个框），
-- 由 currency 决定扣哪种钱，避免两列价格导致口径混乱。
ALTER TABLE `prizes`
ADD COLUMN IF NOT EXISTS `currency` ENUM('points','diamond') NOT NULL DEFAULT 'points'
  COMMENT '支付货币：points=积分（默认） diamond=钻石';

-- ============================================================
-- 5. 兑换记录：留下币种与实际花费
-- ============================================================
ALTER TABLE `exchange_records`
ADD COLUMN IF NOT EXISTS `currency` VARCHAR(10) NOT NULL DEFAULT 'points' COMMENT '支付货币',
ADD COLUMN IF NOT EXISTS `diamond_cost` INT NOT NULL DEFAULT 0 COMMENT '钻石花费（currency=diamond 时有值）';
