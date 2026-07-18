ALTER TABLE task_class ADD COLUMN min_study_duration INT DEFAULT 0 COMMENT '最小学习时长（分钟），0表示不限制' AFTER force_video_watch;
