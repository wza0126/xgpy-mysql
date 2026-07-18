-- 学习打卡表：确保每日只能触发一次勤学好问buff
CREATE TABLE IF NOT EXISTS studious_checkins (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL COMMENT '学生ID',
  check_date DATE NOT NULL COMMENT '打卡日期',
  question_count INT DEFAULT 0 COMMENT '当日看题数量',
  triggered TINYINT(1) DEFAULT 0 COMMENT '是否已触发buff',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_student_date (student_id, check_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学习勤学好问每日打卡记录';
