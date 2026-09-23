-- PK 对战：奖励配置 + 统计基础设施（P0）
--
-- 背景：
-- 1) 原先 PK 只发「做对题数 × points_correct_answer，赢方 ×1.5」的硬编码积分，
--    教师无法为活动设置奖励；且发积分时 source_type 写死 'system'，导致
--    「PK 到底发了多少积分」无法从流水里查出来（设计文档早就要求枚举加 'pk_battle'，
--    一直没落地）——本迁移一并补上。
-- 2) pk_room_players 原先没有 activity 归属列，按活动统计必须 JOIN pk_rooms.config_id，
--    且配置改动后会污染历史口径 —— 这里加「开局快照列」，结算时冗余写入，
--    历史统计不再受配置改动影响。
-- 3) 新增 pk_daily_rewards 表，用「唯一索引 + INSERT IGNORE」实现参与类奖励每日一次。

-- ============================================================
-- 1. point_transactions.source_type 补 'pk_battle'
-- ============================================================
-- 原枚举：('notification','manual','system','practice','pet_feed','test','python_submit','exam','task')
ALTER TABLE `point_transactions`
MODIFY COLUMN `source_type` ENUM('notification', 'manual', 'system', 'practice', 'pet_feed', 'test', 'python_submit', 'exam', 'task', 'pk_battle')
  NOT NULL DEFAULT 'notification' COMMENT '来源类型';

-- ============================================================
-- 2. pk_battle_configs：奖励相关配置列
-- ============================================================
-- points_multiplier：系统通用积分倍率（叠加在「做对题数 × 每题基础分」之上），
--                    用于主题 PK 周等，默认 1.0（保持与旧行为一致）。
-- win_bonus_rate   ：赢方额外加成比例，默认 0.5 即 ×1.5（与旧硬编码一致）。
--                    输方固定按 1.0 计，保证「输了做对题也有积分」。
-- draw_bonus_rate  ：平局加成比例，默认 0（与旧行为一致）。
-- consolation_points：惜败鼓励分（分差 <= consolation_gap 时额外发放），默认 0 不启用。
-- consolation_gap  ：惜败分差阈值（净得分差），默认 2。
-- first_battle_points：每日首战奖励积分，默认 0 不启用。
-- daily_battles_target / daily_battles_points：单日完成 N 场奖励，默认 0 不启用。
ALTER TABLE `pk_battle_configs`
ADD COLUMN IF NOT EXISTS `points_multiplier` DECIMAL(4,2) NOT NULL DEFAULT 1.00
  COMMENT '系统积分倍率（1.00=不加倍），叠加在做对题数×基础分之上',
ADD COLUMN IF NOT EXISTS `win_bonus_rate` DECIMAL(4,2) NOT NULL DEFAULT 0.50
  COMMENT '赢方额外加成比例（0.50=×1.5，与旧行为一致）',
ADD COLUMN IF NOT EXISTS `draw_bonus_rate` DECIMAL(4,2) NOT NULL DEFAULT 0.00
  COMMENT '平局加成比例（0=不加成）',
ADD COLUMN IF NOT EXISTS `consolation_points` INT NOT NULL DEFAULT 0
  COMMENT '惜败鼓励积分（分差<=consolation_gap时额外发放），0=不启用',
ADD COLUMN IF NOT EXISTS `consolation_gap` INT NOT NULL DEFAULT 2
  COMMENT '惜败分差阈值（双方净得分差，绝对值）',
ADD COLUMN IF NOT EXISTS `first_battle_points` INT NOT NULL DEFAULT 0
  COMMENT '每日首战奖励积分（每日一次），0=不启用',
ADD COLUMN IF NOT EXISTS `daily_battles_target` INT NOT NULL DEFAULT 0
  COMMENT '单日完成N场奖励所需的场次N，0=不启用',
ADD COLUMN IF NOT EXISTS `daily_battles_points` INT NOT NULL DEFAULT 0
  COMMENT '单日完成N场奖励的积分（每日一次），0=不启用';

-- ============================================================
-- 3. pk_room_players：开局快照列（历史统计不再依赖 JOIN、不受配置改动污染）
-- ============================================================
-- config_id     ：本局所属活动配置（快速匹配/无配置时为 NULL）
-- config_name   ：活动名称快照
-- question_count：本局题量快照（用于统计正确率时对齐分母）
-- duration_seconds：本局时长快照
ALTER TABLE `pk_room_players`
ADD COLUMN IF NOT EXISTS `config_id` VARCHAR(50) NULL
  COMMENT '本局所属活动配置ID（开局快照，NULL=快速匹配无配置）',
ADD COLUMN IF NOT EXISTS `config_name` VARCHAR(100) NULL
  COMMENT '活动名称快照（避免配置改名后历史统计错乱）',
ADD COLUMN IF NOT EXISTS `question_count` INT NULL
  COMMENT '本局题量快照',
ADD COLUMN IF NOT EXISTS `duration_seconds` INT NULL
  COMMENT '本局时长快照（秒）',
ADD COLUMN IF NOT EXISTS `consolation_points` INT NOT NULL DEFAULT 0
  COMMENT '本局获得的惜败鼓励积分',
ADD COLUMN IF NOT EXISTS `bonus_points` INT NOT NULL DEFAULT 0
  COMMENT '本局获得的额外奖励积分（首战/全勤等参与类奖励）';

ALTER TABLE `pk_room_players`
ADD INDEX IF NOT EXISTS `idx_config` (`config_id`);

-- ============================================================
-- 4. pk_daily_rewards：参与类奖励每日限一次
-- ============================================================
-- 复用 studious_checkins 的范式：唯一索引 (user_id, reward_date, reward_type) + INSERT IGNORE，
-- affectedRows=0 即代表今天已发过，天然幂等。
CREATE TABLE IF NOT EXISTS `pk_daily_rewards` (
  `id` VARCHAR(50) PRIMARY KEY,
  `user_id` VARCHAR(50) NOT NULL COMMENT '学生用户ID',
  `reward_date` DATE NOT NULL COMMENT '奖励归属日期',
  `reward_type` VARCHAR(30) NOT NULL COMMENT '奖励类型：first_battle(首战)/daily_battles(全勤)',
  `points` INT NOT NULL DEFAULT 0 COMMENT '发放积分',
  `room_id` VARCHAR(50) NULL COMMENT '触发本奖励的对局ID',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_user_date_type` (`user_id`, `reward_date`, `reward_type`),
  INDEX `idx_date` (`reward_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PK参与类奖励发放记录（每日限一次）';
