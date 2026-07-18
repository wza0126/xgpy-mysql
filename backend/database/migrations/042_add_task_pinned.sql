-- 课堂任务置顶功能
-- 置顶任务在学生端「课堂任务」列表最上方显示
ALTER TABLE task_class
  ADD COLUMN IF NOT EXISTS is_pinned TINYINT NOT NULL DEFAULT 0
    COMMENT '是否置顶：0否 1是'
    AFTER status;
