-- PK 对战 P1/P2：专属荣誉计数 + 装备掉落配置 + 段位变化历史
--
-- 背景（三块基础设施此前都缺）：
-- 1) 荣誉体系有 5 种（perfect_10/triple_crit/wrong_3/studious/typing_fast），
--    计数散落在 profiles 的 5 个 *_times 列，荣誉明细无独立表；
--    PK 对战**完全没有荣誉** —— 本迁移补 3 个 PK 专属荣誉计数列。
-- 2) 装备掉落逻辑在 index.js 里内联重复了 4 处（练习/测试/考试/同类题），
--    判据是 Math.random()*100 < equipments.drop_rate；测试/考试掉率 ×10。
--    PK 对战**完全没有掉落** —— 本迁移给 pk_battle_configs 补掉落开关与掉率系数，
--    让教师可以对「PK 周」单独调掉率（默认与练习一致，即不额外提高）。
-- 3) profiles 有 8 个 pk_* 字段（迁移 070），但**没有段位变化历史表**，
--    因此段位分布图只能做「当前快照」，无法看趋势 —— 本迁移新建 pk_rank_history。
--
-- ⚠️ 数据导入导出：本迁移新增的 pk_rank_history 必须登记进 data-io.js 的
--    DOMAIN_DEFS['pk']，否则导出包里没有它（静默丢数据）。

-- ============================================================
-- 1. profiles：PK 专属荣誉计数列（3 个）
-- ============================================================
-- 与既有 5 个 *_times 列同构：计数型、NOT NULL DEFAULT 0。
-- 命名带 pk_ 前缀，避免与练习侧荣誉混淆。
--
-- pk_streak_3_times        —— 「连胜达人」：PK 累计达成 3 连胜的次数
--                             判定靠状态跃迁（floor(new/3) > floor(old/3)），幂等
-- pk_flawless_times        —— 「零失误」：单局全对（final_wrong=0 且作答数>0）
-- pk_comeback_times        —— 「愈战愈勇」：落后翻盘（前半程落后、最终获胜）
ALTER TABLE `profiles`
ADD COLUMN IF NOT EXISTS `pk_streak_3_times` INT NOT NULL DEFAULT 0
  COMMENT 'PK荣誉「连胜达人」达成次数（累计3连胜，每满3场计1次）',
ADD COLUMN IF NOT EXISTS `pk_flawless_times` INT NOT NULL DEFAULT 0
  COMMENT 'PK荣誉「零失误」达成次数（单局全对且至少作答1题）',
ADD COLUMN IF NOT EXISTS `pk_comeback_times` INT NOT NULL DEFAULT 0
  COMMENT 'PK荣誉「愈战愈勇」达成次数（前半程落后但最终获胜）',
-- PK 当前连胜场次：用于「连胜达人」的状态跃迁判定
-- （不能靠 pk_total_wins 推算 —— 那是累计值，跨对局无法还原连续性）
ADD COLUMN IF NOT EXISTS `pk_win_streak` INT NOT NULL DEFAULT 0
  COMMENT 'PK当前连胜场次（输/平即清零；用于连胜达人荣誉判定）';

-- ============================================================
-- 2. pk_battle_configs：PK 装备掉落配置
-- ============================================================
-- 设计原则：**默认不比练习更慷慨**，避免「刷 PK 比刷练习更划算」
-- 破坏练习模块的教学价值。教师可为特定活动（如考前 PK 周）单独调高。
--
-- equipment_drop_enabled：总开关，默认 0（不启用）。PK 原先完全没有掉落，
--                         保持默认即维持旧行为，教师显式开启才生效。
-- equipment_drop_multiplier：掉率系数，实际掉率 = equipments.drop_rate × 系数。
--                         默认 1.00（与练习完全一致）。上限由后端钳制。
ALTER TABLE `pk_battle_configs`
ADD COLUMN IF NOT EXISTS `equipment_drop_enabled` TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'PK是否启用装备掉落（默认关闭，保持旧行为）',
ADD COLUMN IF NOT EXISTS `equipment_drop_multiplier` DECIMAL(4,2) NOT NULL DEFAULT 1.00
  COMMENT 'PK装备掉率系数（实际掉率=装备drop_rate×系数，1.00=与练习一致）';

-- ============================================================
-- 3. pk_rank_history：段位变化历史（趋势图的数据源）
-- ============================================================
-- 每次对局结算时，若段位或星数发生变化则写一行（平局不写、分数未变不写）。
-- 只记「变化点」而非每局一行，避免表体量随对局数线性膨胀。
--
-- 与 pk_room_players 的区别：
--   pk_room_players 记「这局发生了什么」（含积分类奖励）
--   pk_rank_history 记「段位怎么变的」（趋势图只关心这个，且渲染时无需 JOIN）
CREATE TABLE IF NOT EXISTS `pk_rank_history` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` VARCHAR(50) NOT NULL COMMENT '学生用户ID',
  `class_id` VARCHAR(50) NULL COMMENT '班级ID快照（转班后历史仍归属原班级口径）',
  `room_id` VARCHAR(50) NULL COMMENT '触发本次变化的对局ID',
  `from_tier` TINYINT NOT NULL COMMENT '变化前段位层级',
  `from_stars` INT NOT NULL COMMENT '变化前星数',
  `to_tier` TINYINT NOT NULL COMMENT '变化后段位层级',
  `to_stars` INT NOT NULL COMMENT '变化后星数',
  `result` ENUM('win','lose','draw') NOT NULL COMMENT '本局结果（趋势图按胜负分色）',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_user_time` (`user_id`, `created_at`),
  INDEX `idx_class_time` (`class_id`, `created_at`),
  INDEX `idx_room` (`room_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='PK段位变化历史（仅记录发生变化的时点，供趋势图与分布演化使用）';

-- ============================================================
-- 4. 存量数据对齐：PK 当前连胜场次回填
-- ============================================================
-- 迁移前 pk_win_streak 一律为 0。按 pk_room_players 的结算时间倒序
-- 逐人重算「从最近一场往前数」的连续 win 数，避免老玩家连胜被重置。
-- 用 MySQL 变量逐行扫描实现（MariaDB 兼容，不需要窗口函数）。
SET @prev_uid := '';
SET @cur_streak := 0;
UPDATE `profiles` p
JOIN (
  SELECT user_id, MAX(streak) AS streak FROM (
    SELECT
      t.user_id,
      t.result,
      CASE
        WHEN t.result = 'win' AND t.user_id = @prev_uid THEN @cur_streak := @cur_streak + 1
        WHEN t.result = 'win' THEN @cur_streak := 1
        ELSE @cur_streak := 0
      END AS streak,
      @prev_uid := t.user_id AS _u
    FROM (
      SELECT pl.user_id, pl.result, pl.joined_at
      FROM `pk_room_players` pl
      JOIN `pk_rooms` r ON r.id = pl.room_id
      WHERE r.status = 'finished' AND pl.result <> 'pending'
      ORDER BY pl.user_id ASC, pl.joined_at DESC, pl.id DESC
    ) t
  ) s
  GROUP BY user_id
) agg ON agg.user_id = p.id
SET p.pk_win_streak = agg.streak;
