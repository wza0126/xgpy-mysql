CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_config (
  id VARCHAR(50) PRIMARY KEY,
  config_key VARCHAR(100) UNIQUE NOT NULL,
  value JSON,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_config (
  id VARCHAR(50) PRIMARY KEY,
  tip_interval_seconds INT DEFAULT 60,
  tip_display_seconds INT DEFAULT 10,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pets (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  model_url VARCHAR(500),
  min_points_to_adopt INT DEFAULT 0,
  image_level_1 TEXT,
  image_level_2 TEXT,
  image_level_3 TEXT,
  image_level_4 TEXT,
  image_level_5 TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_foods (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  points_cost INT DEFAULT 10,
  growth_value INT DEFAULT 5,
  is_active BOOLEAN DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prizes (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  points_cost INT DEFAULT 0,
  type ENUM('normal', 'internet_code') DEFAULT 'normal',
  stock INT DEFAULT 0,
  daily_limit INT DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_points (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  code_example TEXT,
  order_index INT DEFAULT 0,
  parent_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profiles (
  id VARCHAR(50) PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  role ENUM('student', 'teacher') NOT NULL DEFAULT 'student',
  real_name VARCHAR(100),
  class_id VARCHAR(50),
  current_points INT DEFAULT 0,
  max_points INT DEFAULT 0,
  avatar_url VARCHAR(500),
  can_exchange_internet_code BOOLEAN DEFAULT TRUE,
  can_open_exchange_module BOOLEAN DEFAULT TRUE,
  can_use_app BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_class_id (class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS classes (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  teacher_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  allow_login BOOLEAN DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questions (
  id VARCHAR(50) PRIMARY KEY,
  type ENUM('choice', 'fill_blank', 'code') NOT NULL,
  content TEXT NOT NULL,
  options JSON,
  answers JSON NOT NULL,
  explanation TEXT,
  knowledge_point_id VARCHAR(50),
  practice_enabled BOOLEAN DEFAULT TRUE,
  exam_enabled BOOLEAN DEFAULT TRUE,
  tags JSON,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tests (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  question_ids JSON,
  difficulty ENUM('easy', 'medium', 'hard') DEFAULT 'medium',
  time_limit INT DEFAULT 60,
  passing_score INT DEFAULT 60,
  question_count INT DEFAULT 0,
  points_reward INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  type ENUM('test', 'exam') DEFAULT 'test',
  class_ids JSON,
  allow_view_paper BOOLEAN DEFAULT FALSE,
  allow_internet_code BOOLEAN DEFAULT FALSE,
  internet_code_reward INT DEFAULT 0,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_answers (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  question_id VARCHAR(50) NOT NULL,
  answer VARCHAR(5000),
  is_correct BOOLEAN,
  points_change INT DEFAULT 0,
  source VARCHAR(20) DEFAULT 'practice',
  test_id VARCHAR(50),
  test_record_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_student_id (student_id),
  INDEX idx_student_correct (student_id, is_correct)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wrong_questions (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  question_id VARCHAR(50) NOT NULL,
  wrong_count INT DEFAULT 1,
  last_wrong_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_wrong (student_id, question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS test_records (
  id VARCHAR(50) PRIMARY KEY,
  test_id VARCHAR(50) NOT NULL,
  student_id VARCHAR(50) NOT NULL,
  score INT,
  correct_count INT DEFAULT 0,
  total_count INT DEFAULT 0,
  points_earned INT DEFAULT 0,
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_records (
  id VARCHAR(50) PRIMARY KEY,
  test_id VARCHAR(50) NOT NULL,
  student_id VARCHAR(50) NOT NULL,
  selected_question_ids JSON,
  score INT,
  correct_count INT DEFAULT 0,
  total_count INT DEFAULT 0,
  points_earned INT DEFAULT 0,
  internet_codes_earned INT DEFAULT 0,
  is_passed BOOLEAN DEFAULT FALSE,
  started_at TIMESTAMP,
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_exam (test_id, student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notes (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_pets (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  pet_id VARCHAR(50) NOT NULL,
  growth_level INT DEFAULT 1,
  growth_value INT DEFAULT 0,
  adopted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  display_level INT DEFAULT 1,
  show_on_desktop BOOLEAN DEFAULT TRUE,
  INDEX idx_student_id (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pet_tips (
  id VARCHAR(50) PRIMARY KEY,
  content TEXT NOT NULL,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS internet_codes (
  id VARCHAR(50) PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  is_used BOOLEAN DEFAULT FALSE,
  used_by VARCHAR(50),
  used_at TIMESTAMP NULL,
  used_by_username VARCHAR(100),
  source VARCHAR(50),
  source_id VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exchange_records (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  prize_id VARCHAR(50),
  points_cost INT DEFAULT 0,
  exchanged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  code VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prize_class_visibility (
  id VARCHAR(50) PRIMARY KEY,
  prize_id VARCHAR(50) NOT NULL,
  class_id VARCHAR(50) NOT NULL,
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS code_snippets (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(200),
  code TEXT,
  output TEXT,
  student_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  role ENUM('student', 'teacher', 'admin') NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backup_records (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(200),
  description TEXT,
  file_url VARCHAR(500),
  file_size BIGINT,
  record_counts JSON,
  tables JSON,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  restored_by VARCHAR(50),
  restored_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS apps (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(500),
  type VARCHAR(50) NOT NULL DEFAULT 'learning_tool',
  price_type VARCHAR(20) NOT NULL DEFAULT 'free',
  points_price INT DEFAULT 0,
  category VARCHAR(50),
  url VARCHAR(500),
  iframe_enabled BOOLEAN DEFAULT FALSE,
  external_url VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  is_marketplace BOOLEAN DEFAULT TRUE,
  config JSON,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_visibility (
  id VARCHAR(50) PRIMARY KEY,
  app_id VARCHAR(50) NOT NULL,
  class_id VARCHAR(50) NOT NULL,
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_app_class (app_id, class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_app_usage (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  app_id VARCHAR(50) NOT NULL,
  points_spent INT DEFAULT 0,
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP,
  usage_count INT DEFAULT 1,
  UNIQUE KEY unique_student_app (student_id, app_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_usage_logs (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  app_id VARCHAR(50) NOT NULL,
  action ENUM('access', 'complete', 'purchase', 'use') NOT NULL,
  duration_seconds INT,
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_reviews (
  id VARCHAR(50) PRIMARY KEY,
  app_id VARCHAR(50) NOT NULL,
  student_id VARCHAR(50) NOT NULL,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS word_list (
  id VARCHAR(50) PRIMARY KEY,
  word VARCHAR(100) NOT NULL,
  phonetic VARCHAR(100),
  meaning TEXT NOT NULL,
  example TEXT,
  level ENUM('easy', 'medium', 'hard') DEFAULT 'medium',
  category VARCHAR(50),
  order_index INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_word_progress (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  word_id VARCHAR(50) NOT NULL,
  status ENUM('new', 'learning', 'review', 'mastered') DEFAULT 'new',
  correct_count INT DEFAULT 0,
  wrong_count INT DEFAULT 0,
  last_practiced_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_student_word (student_id, word_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  notification_type ENUM('all', 'class', 'student') DEFAULT 'all',
  target_class_id VARCHAR(50) NULL,
  target_student_ids JSON NULL,
  has_point_reward BOOLEAN DEFAULT FALSE,
  point_reward_amount INT DEFAULT 0,
  point_reward_reason VARCHAR(255) DEFAULT '',
  has_point_penalty BOOLEAN DEFAULT FALSE,
  point_penalty_amount INT DEFAULT 0,
  point_penalty_reason VARCHAR(255) DEFAULT '',
  can_open_exchange_module BOOLEAN DEFAULT TRUE,
  enable_app_access BOOLEAN DEFAULT TRUE,
  scheduled_at DATETIME NULL,
  published_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_teacher_id (teacher_id),
  INDEX idx_notification_type (notification_type),
  INDEX idx_target_class_id (target_class_id),
  INDEX idx_scheduled_at (scheduled_at),
  INDEX idx_published_at (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_recipients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  notification_id INT NOT NULL,
  student_id VARCHAR(50) NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  read_at DATETIME NULL,
  point_change INT DEFAULT 0,
  point_change_reason VARCHAR(255) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_notification_student (notification_id, student_id),
  INDEX idx_student_id (student_id),
  INDEX idx_notification_id (notification_id),
  INDEX idx_is_read (is_read),
  CONSTRAINT fk_notification_recipients_notification
    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS point_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  amount INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  source_type ENUM('notification', 'manual', 'system') DEFAULT 'notification',
  source_id VARCHAR(50) NULL,
  teacher_id VARCHAR(50) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_student_id (student_id),
  INDEX idx_source (source_type, source_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_sessions (
  id VARCHAR(64) PRIMARY KEY COMMENT '会话ID（UUID）',
  user_id VARCHAR(64) NOT NULL COMMENT '用户ID',
  token VARCHAR(256) NOT NULL COMMENT '登录Token（SHA256哈希）',
  device_info VARCHAR(256) COMMENT '设备信息',
  ip_address VARCHAR(45) COMMENT 'IP地址（支持IPv6）',
  user_agent TEXT COMMENT '浏览器User Agent',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '最后活跃时间',
  expires_at DATETIME NOT NULL COMMENT '过期时间',
  is_active BOOLEAN DEFAULT TRUE COMMENT '是否有效',
  INDEX idx_user_id (user_id),
  INDEX idx_token (token(64)),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL COMMENT '用户ID',
  login_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '登录时间',
  logout_time DATETIME COMMENT '登出时间',
  device_info VARCHAR(256) COMMENT '设备信息',
  ip_address VARCHAR(45) COMMENT 'IP地址',
  user_agent TEXT COMMENT '浏览器User Agent',
  login_status ENUM('success', 'failed', 'forced_logout') DEFAULT 'success' COMMENT '登录状态',
  failure_reason VARCHAR(128) COMMENT '失败原因',
  INDEX idx_user_time (user_id, login_time),
  INDEX idx_login_status (login_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS security_settings (
  id INT PRIMARY KEY DEFAULT 1,
  max_concurrent_sessions INT DEFAULT 3 COMMENT '最大并发会话数（0=不限制）',
  session_timeout_hours INT DEFAULT 24 COMMENT '会话超时时间（小时）',
  allow_multiple_devices BOOLEAN DEFAULT TRUE COMMENT '是否允许多设备登录',
  enable_ip_binding BOOLEAN DEFAULT FALSE COMMENT '是否启用IP绑定',
  require_password_change_days INT DEFAULT 90 COMMENT '密码强制更换天数（0=不强制）',
  enable_login_alert BOOLEAN DEFAULT FALSE COMMENT '是否启用登录提醒',
  max_concurrent_sessions_teacher INT NOT NULL DEFAULT 3,
  max_concurrent_sessions_student INT NOT NULL DEFAULT 3,
  allow_multiple_devices_teacher BOOLEAN NOT NULL DEFAULT TRUE,
  allow_multiple_devices_student BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
