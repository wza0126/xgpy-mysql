-- 课堂点名 - 座位布局表
CREATE TABLE IF NOT EXISTS roll_call_seating (
  id VARCHAR(50) PRIMARY KEY,
  class_id VARCHAR(50) NOT NULL COMMENT '班级ID',
  seat_number INT NOT NULL COMMENT '座位号 1-64',
  student_id VARCHAR(50) DEFAULT NULL COMMENT '绑定的学生ID，NULL=空座',
  position_x INT NOT NULL DEFAULT 0 COMMENT '网格X坐标 (0-7)',
  position_y INT NOT NULL DEFAULT 0 COMMENT '网格Y坐标 (0-7)',
  is_locked BOOLEAN DEFAULT FALSE COMMENT '该座位是否锁定',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_class_seat (class_id, seat_number),
  UNIQUE KEY uk_class_student (class_id, student_id),
  INDEX idx_class (class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 课堂点名 - 整体布局配置表
CREATE TABLE IF NOT EXISTS roll_call_layout (
  id VARCHAR(50) PRIMARY KEY,
  class_id VARCHAR(50) NOT NULL COMMENT '班级ID',
  layout_data JSON NOT NULL COMMENT '布局元数据：座位样式、版本号等',
  is_locked BOOLEAN DEFAULT FALSE COMMENT '整张座位图是否锁定（防止误修改）',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_class (class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
