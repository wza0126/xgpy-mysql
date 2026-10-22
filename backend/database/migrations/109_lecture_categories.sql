-- AI 讲堂 · 课程分类 + 班级观课标记（2026-10-22）
--
-- 背景：原来 lectures.subject 存的是「必修1 / 必修2」这种教材模块，共 2 个值，
--       微课程一多就分不开（真题讲评、易错点、专项策略混在一起）。改成业务分类。
--
-- 分类取值固定 5 个（后端 LECTURE_CATEGORIES 是唯一真源，前端只做展示）：
--   python精讲 / 真题讲评 / 易错点 / 程序填空题策略 / 其他
--
-- ⛔ 不复用 subject 列改名：老版本 exe（3.1.x）的 SQL 里 select subject，改列名会让旧版直接 500。
--    新增 category 列 + 保留 subject，旧版读到的还是必修1/必修2（只是它不显示而已）。
-- ⛔ viewed_classes 存的是**班级名**而不是 class_id：老师要标记「高二7」这类还没建进系统的班，
--    用 id 就标记不了；班级改名/重建也不影响历史标记。
ALTER TABLE `lectures`
  ADD COLUMN IF NOT EXISTS `category` VARCHAR(32) NOT NULL DEFAULT '其他'
    COMMENT '课程分类：python精讲/真题讲评/易错点/程序填空题策略/其他' AFTER `title`,
  ADD COLUMN IF NOT EXISTS `viewed_classes` JSON DEFAULT NULL
    COMMENT '老师手工标记「该班已看过」的班级名数组（如 ["高一1","高二3"]）';

ALTER TABLE `lectures` ADD INDEX IF NOT EXISTS `idx_category` (`category`);

-- 存量归类：先全归「其他」，再把 Python 知识点系列挑出来放进「python精讲」
UPDATE `lectures` SET `category` = '其他' WHERE `category` IS NULL OR `category` = '';
UPDATE `lectures` SET `category` = 'python精讲' WHERE `title` LIKE '知识点%';
