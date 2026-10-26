-- Python 编程作业：题目按班级分别启停（2026-10-26）
--
-- 背景：python_tasks.is_active 是全局开关，一道题要么对所有班开放、要么全关。
-- 实际上老师是按班排课的：同一道题这周给高二4 开、高二5 还没讲到得先关，
-- 过去只能靠「班级」字段整体挪，或者干脆不布置。
--
-- 取值规则（重要，改代码时别破坏）：
--   · 本表**没有**某班记录  → 该班继承 python_tasks.is_active（现有行为不变）
--   · 本表**有**某班记录    → 该班以本表的 is_active 为准（可绕过全局开关单独放开或关闭）
--   学生端可见性 = t.is_active = 1 AND 本题在其 class_ids 内 AND 该班未被本表置为 0
-- 只记「例外」，因此历史数据不需要回填，加表不影响任何已布置的作业。

CREATE TABLE IF NOT EXISTS `python_task_class_status` (
  `task_id`    VARCHAR(50) NOT NULL COMMENT '题目 ID，对应 python_tasks.id',
  `class_id`   VARCHAR(50) NOT NULL COMMENT '班级 ID，对应 classes.id',
  `is_active`  TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '该班是否启用（0=该班看不到这道题）',
  `updated_by` VARCHAR(50) DEFAULT NULL COMMENT '最后一次操作的教师 ID',
  `updated_at` TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`task_id`, `class_id`),
  KEY `idx_class_active` (`class_id`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Python 作业题目-班级级启停（无记录=继承全局 is_active）';
