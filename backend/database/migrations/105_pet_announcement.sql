-- 萌宠公告（学生端萌宠气泡优先显示，倒计时结束自动关闭）
--
-- 设计要点：
--  - **多条并存**：几位老师可能同时各发一条，所以用独立表（不用 pet_config 单行）。
--  - 生效判定：ends_at > NOW()。过期不清行，读的时候过滤掉即可（无定时清理任务）。
--  - class_ids：目标班级 ID 的 JSON 数组，与 farm_config / study_galaxy_config 约定一致 ——
--    NULL / 空数组 = 全部班级。学生端按自己的 class_id + assigned_classes 判断是否命中。
--  - created_by_name 存发布时的姓名快照，教师端和学生端都能显示「谁发的」，避免后续改名丢信息。
--  - 学生端公告期间「提示语」不再弹（前端抑制），公告全部结束后恢复提示语轮播。
CREATE TABLE IF NOT EXISTS `pet_announcements` (
  `id` VARCHAR(50) NOT NULL COMMENT '公告ID',
  `content` TEXT NOT NULL COMMENT '公告内容',
  `class_ids` TEXT DEFAULT NULL COMMENT '目标班级ID的JSON数组，NULL/空数组 = 全部班级',
  `created_by` VARCHAR(50) DEFAULT NULL COMMENT '发布者 profiles.id',
  `created_by_name` VARCHAR(64) DEFAULT NULL COMMENT '发布者姓名快照',
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '启动时间',
  `ends_at` DATETIME(3) NOT NULL COMMENT '自动关闭时间，过期即失效',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_pa_ends_at` (`ends_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='萌宠公告（学生端气泡优先显示）';
