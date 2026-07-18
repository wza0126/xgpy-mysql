-- 课堂任务主表
CREATE TABLE IF NOT EXISTS task_class (
  id VARCHAR(50) PRIMARY KEY,
  class_id VARCHAR(50) NOT NULL,
  teacher_id VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  learning_objectives TEXT,
  start_time DATETIME,
  deadline DATETIME,
  status TINYINT DEFAULT 0 COMMENT '0草稿/1已发布/2已归档',
  access_key VARCHAR(64) UNIQUE,
  force_video_watch TINYINT DEFAULT 0,
  access_type TINYINT DEFAULT 0 COMMENT '0仅本班/1公开',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_class_id (class_id),
  INDEX idx_teacher_id (teacher_id),
  INDEX idx_access_key (access_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 教学资源表
CREATE TABLE IF NOT EXISTS task_resource (
  id VARCHAR(50) PRIMARY KEY,
  task_id VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL COMMENT 'pdf/ppt/word/video/image/python/zip/html/link',
  file_path VARCHAR(500),
  url VARCHAR(500) COMMENT '外网视频链接',
  html_content LONGTEXT COMMENT 'HTML代码内容',
  original_filename VARCHAR(200),
  title VARCHAR(200),
  sort_order INT DEFAULT 0,
  duration INT DEFAULT 0 COMMENT '视频时长（秒）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_task_id (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 随堂习题关联表
CREATE TABLE IF NOT EXISTS task_question (
  id VARCHAR(50) PRIMARY KEY,
  task_id VARCHAR(50) NOT NULL,
  question_id VARCHAR(50) COMMENT '关联题库题目ID',
  score INT DEFAULT 5,
  sort_order INT DEFAULT 0,
  temp_content TEXT COMMENT '临时题内容',
  temp_type VARCHAR(20) COMMENT '临时题类型 choice/fill_blank',
  temp_options JSON COMMENT '临时题选项',
  temp_answer TEXT COMMENT '临时题答案',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_task_id (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 学生学习记录表
CREATE TABLE IF NOT EXISTS task_study_log (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  task_id VARCHAR(50) NOT NULL,
  video_progress JSON COMMENT '{resource_id: 进度百分比}',
  resources_viewed JSON COMMENT '{resource_id: true}',
  answers JSON COMMENT '[{question_id, answer, is_correct}]',
  total_score INT DEFAULT 0,
  submit_time DATETIME,
  status TINYINT DEFAULT 0 COMMENT '0未开始/1进行中/2已完成/3已逾期',
  watch_duration INT DEFAULT 0 COMMENT '观看时长（秒）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uk_student_task (student_id, task_id),
  INDEX idx_task_id (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
