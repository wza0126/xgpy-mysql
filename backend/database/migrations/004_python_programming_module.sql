-- Python编程学习模块数据库表结构
-- 适配江苏省高中信息技术课标

-- 1. Python编程任务表（教师发布作业）
CREATE TABLE IF NOT EXISTS python_tasks (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(200) NOT NULL COMMENT '任务标题',
  description TEXT COMMENT '任务描述/题目要求',
  task_type ENUM('code', 'fill_blank') DEFAULT 'code' COMMENT '题型：完整编程/填空',
  class_ids JSON COMMENT '目标班级ID列表',
  total_score INT DEFAULT 100 COMMENT '总分',
  deadline DATETIME COMMENT '截止时间',
  allow_late_submission BOOLEAN DEFAULT FALSE COMMENT '是否允许补交',
  allow_run_code BOOLEAN DEFAULT TRUE COMMENT '是否允许运行代码',
  max_run_seconds INT DEFAULT 3 COMMENT '单次运行最大秒数',
  reference_code TEXT COMMENT '参考代码/标准答案',
  expected_output TEXT COMMENT '预期输出（用于比对）',
  hint TEXT COMMENT '解题提示',
  required_keywords JSON COMMENT '要求使用的关键字',
  is_active BOOLEAN DEFAULT TRUE,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_created_by (created_by),
  INDEX idx_is_active (is_active),
  INDEX idx_deadline (deadline)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 学生草稿代码表
CREATE TABLE IF NOT EXISTS python_drafts (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  title VARCHAR(100) DEFAULT '未命名草稿',
  code TEXT,
  task_id VARCHAR(50) COMMENT '关联的作业任务（可选）',
  last_run_output TEXT COMMENT '最后一次运行的输出',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_student_id (student_id),
  INDEX idx_task_id (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 学生作业提交表
CREATE TABLE IF NOT EXISTS python_submissions (
  id VARCHAR(50) PRIMARY KEY,
  task_id VARCHAR(50) NOT NULL,
  student_id VARCHAR(50) NOT NULL,
  code TEXT NOT NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_late BOOLEAN DEFAULT FALSE COMMENT '是否迟交',
  status ENUM('unsubmitted', 'submitted', 'graded', 'resubmitted') DEFAULT 'unsubmitted',
  UNIQUE KEY unique_submission (task_id, student_id),
  INDEX idx_task_id (task_id),
  INDEX idx_student_id (student_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 作业批改记录表
CREATE TABLE IF NOT EXISTS python_gradings (
  id VARCHAR(50) PRIMARY KEY,
  submission_id VARCHAR(50) NOT NULL,
  task_id VARCHAR(50) NOT NULL,
  student_id VARCHAR(50) NOT NULL,
  total_score INT DEFAULT 0,
  syntax_score INT DEFAULT 0 COMMENT '语法检测得分',
  output_score INT DEFAULT 0 COMMENT '运行结果得分',
  logic_score INT DEFAULT 0 COMMENT '逻辑结构得分',
  comment TEXT COMMENT '综合评语',
  syntax_errors JSON COMMENT '语法错误详情',
  output_diff TEXT COMMENT '输出差异分析',
  missing_keywords JSON COMMENT '缺少的关键字',
  is_ai_graded BOOLEAN DEFAULT TRUE,
  manually_adjusted BOOLEAN DEFAULT FALSE,
  adjusted_score INT,
  adjusted_by VARCHAR(50),
  adjusted_comment TEXT,
  show_reference_code BOOLEAN DEFAULT FALSE,
  graded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_grading (submission_id),
  INDEX idx_task_student (task_id, student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. 代码运行日志表（安全审计）
CREATE TABLE IF NOT EXISTS python_run_logs (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  code TEXT,
  code_hash VARCHAR(64) COMMENT '代码内容哈希（用于去重）',
  input_data TEXT COMMENT '用户输入',
  actual_output TEXT,
  error_output TEXT,
  execution_time_ms INT,
  memory_used_kb INT,
  status ENUM('success', 'syntax_error', 'runtime_error', 'timeout', 'blocked') NOT NULL,
  blocked_reason TEXT COMMENT '被拦截的原因',
  run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_student_id (student_id),
  INDEX idx_status (status),
  INDEX idx_run_at (run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. 编程错题本
CREATE TABLE IF NOT EXISTS python_wrong_problems (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  task_id VARCHAR(50) NOT NULL,
  submission_id VARCHAR(50),
  error_type VARCHAR(100),
  error_detail TEXT,
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP NULL,
  wrong_count INT DEFAULT 1,
  last_wrong_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_student_task (student_id, task_id),
  INDEX idx_student_id (student_id),
  INDEX idx_is_resolved (is_resolved)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
