-- 专注模式相关字段（2026-10-24）
--
-- ① profiles.focus_force_enabled：学生个人的「强制专注」开关（默认 0 停用）。
--    用于对练习不认真的学生单独开专注模式 —— 即使班级没开、或不在班级名单里，
--    只要这个学生个人开着，他登录后就进入专注模式（惩罚性质，由「学生管理」控制）。
--    判定在 Desktop 里做：个人强制优先于班级开关，是「并集」不是「交集」。
--
-- ② pet_config.focus_mode_show_wpsOp / focus_mode_show_aiExplain：
--    专注模式的「桌面图标显示设置」原先只覆盖 14 个图标，漏了「操作题」和「AI讲解」，
--    这两项在专注模式下无法被隐藏（图标列表里根本没得选）。补上后与 desktopIcons 对齐。

ALTER TABLE `profiles`
  ADD COLUMN IF NOT EXISTS `focus_force_enabled` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '个人强制专注模式（1=该学生单独进入专注，与班级开关取并集）';

ALTER TABLE `pet_config`
  ADD COLUMN IF NOT EXISTS `focus_mode_show_wpsOp`     TINYINT(1) NOT NULL DEFAULT 1 COMMENT '专注模式是否显示「操作题」图标',
  ADD COLUMN IF NOT EXISTS `focus_mode_show_aiExplain` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '专注模式是否显示「AI讲解」图标';
