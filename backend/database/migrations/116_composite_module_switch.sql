-- 综合题模块开关（2026-10-26）
--
-- 与 111_class_module_switches.sql 同一套机制：
--   ① classes.composite_enabled  —— 老师在「班级管理」点一下；
--   ② profiles.composite_enabled —— 同一接口批量同步到该班学生，学生端只认 profiles；
--   ③ 学生端桌面轮询 /api/student/desktop-permissions，关闭时拦在入口并强制关掉已开窗口。
--
-- 与「练习」开关的区别：练习关的是单题练习（选择/填空），
-- 综合题是一个独立的桌面窗口，所以要自己一个开关，不能复用 practice_enabled。
--
-- 另外补 pet_config 的专注模式图标字段：专注模式按 focus_mode_show_<图标id> 逐项控制显隐，
-- 少了这一列，专注模式面板保存会报 Unknown column，且「综合题」图标无法隐藏。

ALTER TABLE `classes`
  ADD COLUMN IF NOT EXISTS `composite_enabled` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '综合题模块开关（1=允许学生打开综合题窗口）';

ALTER TABLE `profiles`
  ADD COLUMN IF NOT EXISTS `composite_enabled` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '综合题模块开关（与班级同步）';

ALTER TABLE `pet_config`
  ADD COLUMN IF NOT EXISTS `focus_mode_show_composite` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '专注模式下是否显示「综合题」桌面图标';
