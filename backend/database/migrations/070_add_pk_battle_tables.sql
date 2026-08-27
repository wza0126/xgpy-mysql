-- PK 对战功能：数据库表结构
-- 包含：班级对战开关、profiles 段位字段、对战配置、房间、玩家、作答流水、积分枚举

-- 1. classes 表加 PK 对战开关（默认关闭）
ALTER TABLE classes ADD COLUMN IF NOT EXISTS pk_battle_enabled TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '是否允许该班级学生参与PK对战（默认关闭，需教师手动开启）';

-- 2. profiles 表加 8 个段位与战绩字段
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pk_rank_tier TINYINT NOT NULL DEFAULT 0
    COMMENT 'PK段位层级：0小学生 1初中生 2高中生 3本科生 4研究生',
  ADD COLUMN IF NOT EXISTS pk_rank_stars INT NOT NULL DEFAULT 0
    COMMENT '当前段位星数（研究生无上限，其他0-5）',
  ADD COLUMN IF NOT EXISTS pk_points INT NOT NULL DEFAULT 0
    COMMENT 'PK积分（累计，用于总榜，0保底不允许负数）',
  ADD COLUMN IF NOT EXISTS pk_battles_today INT NOT NULL DEFAULT 0
    COMMENT '今日对战次数（每日0点重置）',
  ADD COLUMN IF NOT EXISTS pk_battles_date DATE NULL
    COMMENT '今日对战计数所属日期（用于判断是否需重置）',
  ADD COLUMN IF NOT EXISTS pk_total_wins INT NOT NULL DEFAULT 0
    COMMENT 'PK总胜场',
  ADD COLUMN IF NOT EXISTS pk_total_losses INT NOT NULL DEFAULT 0
    COMMENT 'PK总负场',
  ADD COLUMN IF NOT EXISTS pk_total_draws INT NOT NULL DEFAULT 0
    COMMENT 'PK总平局';

-- 3. 对战活动配置表（教师配置）
CREATE TABLE IF NOT EXISTS pk_battle_configs (
  id VARCHAR(50) PRIMARY KEY,
  teacher_id VARCHAR(50) NOT NULL COMMENT '教师ID',
  name VARCHAR(100) NOT NULL COMMENT '活动名称，如"期中复习PK"',
  mode ENUM('timed','rush') NOT NULL DEFAULT 'timed' COMMENT '限时答题/抢答(占位)',
  duration_seconds INT NOT NULL DEFAULT 180 COMMENT '总时长秒数',
  question_count INT NOT NULL DEFAULT 20 COMMENT '题量',
  tag_filters JSON NULL COMMENT '标签筛选条件',
  cluster_filters JSON NULL COMMENT 'AI聚类筛选条件',
  difficulty_min TINYINT NULL COMMENT '难度下限',
  difficulty_max TINYINT NULL COMMENT '难度上限',
  is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  daily_limit INT NULL COMMENT '每生每日对战上限（NULL=全局默认20）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_teacher (teacher_id),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PK对战活动配置';

-- 4. 房间表（支持断线恢复）
CREATE TABLE IF NOT EXISTS pk_rooms (
  id VARCHAR(50) PRIMARY KEY COMMENT '房间ID=socket room名',
  config_id VARCHAR(50) NULL COMMENT '关联的对战活动配置（NULL=快速匹配用默认）',
  room_code CHAR(4) NULL COMMENT '4位房间码（创建房间时才有）',
  host_user_id VARCHAR(50) NOT NULL COMMENT '房主用户ID',
  status ENUM('waiting','preparing','battling','finished','abandoned')
    NOT NULL DEFAULT 'waiting' COMMENT '等待中/准备中/对战中/已结束/已放弃',
  question_ids JSON NULL COMMENT '本局题目ID有序列表（开局时确定，全员相同）',
  started_at TIMESTAMP NULL COMMENT '对战开始时间',
  ends_at TIMESTAMP NULL COMMENT '对战结束时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_room_code (room_code),
  INDEX idx_status (status),
  INDEX idx_host (host_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PK对战房间';

-- 5. 房间玩家表（每局2行）
CREATE TABLE IF NOT EXISTS pk_room_players (
  id VARCHAR(50) PRIMARY KEY,
  room_id VARCHAR(50) NOT NULL COMMENT '房间ID',
  user_id VARCHAR(50) NOT NULL COMMENT '学生用户ID',
  is_host TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否房主',
  is_ready TINYINT(1) NOT NULL DEFAULT 0 COMMENT '房间等待页是否点准备',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  disconnected_at TIMESTAMP NULL COMMENT '断线时间（用于判定输）',
  final_score INT NOT NULL DEFAULT 0 COMMENT '最终净得分',
  final_correct INT NOT NULL DEFAULT 0 COMMENT '做对题数',
  final_wrong INT NOT NULL DEFAULT 0 COMMENT '做错题数',
  final_duration_ms BIGINT NOT NULL DEFAULT 0 COMMENT '总耗时毫秒（同分时看耗时）',
  result ENUM('win','lose','draw','pending') NOT NULL DEFAULT 'pending',
  rank_points_change INT NOT NULL DEFAULT 0 COMMENT 'PK积分变化',
  system_points_earned INT NOT NULL DEFAULT 0 COMMENT '获得系统通用积分',
  UNIQUE KEY uk_room_user (room_id, user_id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PK对战房间玩家';

-- 6. 作答流水表（每题作答记录，用于复盘）
CREATE TABLE IF NOT EXISTS pk_match_answers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  room_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  question_id VARCHAR(50) NOT NULL,
  answer TEXT NULL COMMENT '学生提交的答案',
  is_correct TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否正确',
  answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '作答时间',
  cost_ms INT NOT NULL DEFAULT 0 COMMENT '本题耗时毫秒',
  UNIQUE KEY uk_room_user_question (room_id, user_id, question_id),
  INDEX idx_room_user (room_id, user_id),
  INDEX idx_user_question (user_id, question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PK对战作答流水';
