-- 萌宠公告 · 定时发布（2026-11-02）
--
-- 背景：原来只能在「上课前那一刻」发，老师想提前发（比如早读就定好第四节课的公告）做不到。
--
-- 做法：加一列 scheduled_at = 计划开始时间。
--   · 立即发布：scheduled_at = NOW()，ends_at = NOW() + 时长（与历史行为一致）
--   · 定时发布：scheduled_at = 指定时间，ends_at = scheduled_at + 时长
--   · 生效判定统一成 scheduled_at <= NOW() AND ends_at > NOW()
--
-- ⛔ 历史行 scheduled_at 为 NULL，回填成 started_at，保证老数据继续按「已在生效」处理。
-- ⛔ 学生端读到「未到时间」的行必须过滤掉，否则学生会在公告还没开始时就看到公告。
ALTER TABLE `pet_announcements`
  ADD COLUMN IF NOT EXISTS `scheduled_at` DATETIME(3) NULL DEFAULT NULL
    COMMENT '计划开始时间；NULL 视为立即生效（历史数据）' AFTER `ends_at`;

UPDATE `pet_announcements` SET `scheduled_at` = `started_at` WHERE `scheduled_at` IS NULL;

ALTER TABLE `pet_announcements` ADD INDEX IF NOT EXISTS `idx_pa_scheduled` (`scheduled_at`);
