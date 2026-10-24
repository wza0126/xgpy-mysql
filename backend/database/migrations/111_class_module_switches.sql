-- 班级模块开关：练习 / 测试 / 操作题 / 萌宠（2026-10-24）
--
-- 与已有的 python_enabled 完全同一套机制，不另造轮子：
--   ① classes 存班级级开关（老师在「班级管理」里点一下）；
--   ② profiles 存学生级开关（同一接口里批量同步，学生端只认 profiles）；
--   ③ 学生端桌面轮询 /api/student/desktop-permissions 统一判断，
--      关掉就拦在入口（提示「该功能已被老师关闭」）并强制关闭已打开的窗口。
--
-- 默认全部 1（启用）：老班级和老学生升级后行为不变，老师要关谁再关。
-- 用 IF NOT EXISTS 保证重复执行安全（迁移器按 schema_migrations 记版本，这里再兜一层）。

ALTER TABLE `classes`
  ADD COLUMN IF NOT EXISTS `practice_enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '练习模块开关（1=允许打开练习窗口）',
  ADD COLUMN IF NOT EXISTS `test_enabled`     TINYINT(1) NOT NULL DEFAULT 1 COMMENT '测试模块开关',
  ADD COLUMN IF NOT EXISTS `op_enabled`       TINYINT(1) NOT NULL DEFAULT 1 COMMENT '操作题模块开关（WPS/Access）',
  ADD COLUMN IF NOT EXISTS `pet_enabled`      TINYINT(1) NOT NULL DEFAULT 1 COMMENT '萌宠模块开关';

ALTER TABLE `profiles`
  ADD COLUMN IF NOT EXISTS `practice_enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '练习模块开关（与班级同步）',
  ADD COLUMN IF NOT EXISTS `test_enabled`     TINYINT(1) NOT NULL DEFAULT 1 COMMENT '测试模块开关（与班级同步）',
  ADD COLUMN IF NOT EXISTS `op_enabled`       TINYINT(1) NOT NULL DEFAULT 1 COMMENT '操作题模块开关（与班级同步）',
  ADD COLUMN IF NOT EXISTS `pet_enabled`      TINYINT(1) NOT NULL DEFAULT 1 COMMENT '萌宠模块开关（与班级同步）';
