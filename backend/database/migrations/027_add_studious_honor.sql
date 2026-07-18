-- 添加勤学好问荣誉统计字段
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS studious_times INT DEFAULT 0 COMMENT '勤学好问荣誉获得次数';
