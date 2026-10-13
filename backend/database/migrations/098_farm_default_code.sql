-- 098_farm_default_code.sql
-- 代码农场：编辑器「默认代码」改成教师可配。
-- 教学用途：教师可以放一段**低效率的代码**（比如写死份数、不带判断的暴力写法）作为学生的起点，
--   让学生先跑起来看结果、再动手改好，比凭空写一行更容易上手。
-- 语义：
--   · default_code 为 NULL 或空串 → 学生编辑器用前端内置示例兜底（行为与旧版一致）；
--   · 学生自己改过代码后，不会被悄悄覆盖（前端只在「没动过」时跟随教师新默认）。
-- 幂等：ADD COLUMN IF NOT EXISTS，重复执行安全。

ALTER TABLE `farm_config`
  ADD COLUMN IF NOT EXISTS `default_code` TEXT DEFAULT NULL COMMENT '编辑器默认代码（教师可改，学生练手的起始模板；NULL=用内置示例）';
