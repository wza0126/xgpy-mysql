-- 课堂任务支持多班级
ALTER TABLE task_class ADD COLUMN class_ids JSON DEFAULT NULL COMMENT '关联班级ID数组' AFTER class_id;
