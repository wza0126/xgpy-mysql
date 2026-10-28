-- 编程填空按结构分类（2026-10-28 吴老要求）
--
-- 目的：学生端练习、教师端作业列表都能按「顺序结构 / 分支结构 / for循环 / while循环 / 自定义函数」
--      筛选。分类存库而不是写死在前端，老师以后新增题目也能补分类。
--
-- 口径：一道题只归一类，优先级 def > while > for > if > 无
--      （即"主体结构"，循环里套分支算循环）。
-- ⛔ 注意：不少题把 while / def 整个挖成了 ① 占位符，按关键字自动判会被判成「顺序结构」。
--    首次分类时人工核过 83 道题，把 4 道修正了（第12、31、66、68题）。

ALTER TABLE `python_tasks`
  ADD COLUMN IF NOT EXISTS `category` VARCHAR(20) NULL
    COMMENT '顺序结构/分支结构/for循环/while循环/自定义函数；编程题(code)为 NULL' AFTER `task_type`;

ALTER TABLE `python_tasks`
  ADD INDEX IF NOT EXISTS `idx_python_tasks_category` (`category`);
