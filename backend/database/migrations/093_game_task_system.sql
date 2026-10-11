-- 093_game_task_system.sql
-- 游戏化任务系统（每日重复任务 / 一次性成就任务）
--   game_tasks            任务定义（教师端「刷题打怪系统 → 任务系统」可编辑/启停/设适用班级）
--   student_task_claims   学生领取记录（唯一键保证「每日一次 / 永久一次」幂等）
-- 指标统计见 backend/src/game-task-metrics.js，路由见 backend/src/game-task.js

CREATE TABLE IF NOT EXISTS `game_tasks` (
  `id` VARCHAR(50) PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL COMMENT '任务名称',
  `description` VARCHAR(255) NULL COMMENT '任务说明（学生端展示）',
  `icon` VARCHAR(30) NOT NULL DEFAULT 'star' COMMENT '展示图标标识',
  `task_type` ENUM('daily','once') NOT NULL DEFAULT 'daily' COMMENT 'daily=每日重复 / once=一次性成就',
  `metric` VARCHAR(50) NOT NULL COMMENT '统计指标 key（METRIC_DEFS）',
  `metric_params` JSON NULL COMMENT '复合指标参数，如 {"rate":90,"min_count":10}',
  `target_value` DECIMAL(10,2) NOT NULL DEFAULT 1 COMMENT '达成目标值',
  `unit` VARCHAR(10) NOT NULL DEFAULT '' COMMENT '单位展示（题/分/次/局）',
  `rewards` JSON NOT NULL COMMENT '奖励数组 [{type,value,target_id}]，type∈points/internet_code/app/equipment',
  `class_ids` JSON NULL COMMENT '适用班级ID数组；NULL 或空数组 = 全部班级',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序（小的靠前）',
  `created_by` VARCHAR(50) NULL COMMENT '创建教师ID',
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `idx_active_type` (`is_active`, `task_type`),
  INDEX `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='游戏化任务定义';

CREATE TABLE IF NOT EXISTS `student_task_claims` (
  `id` VARCHAR(50) PRIMARY KEY,
  `student_id` VARCHAR(50) NOT NULL COMMENT '学生ID',
  `task_id` VARCHAR(50) NOT NULL COMMENT '任务ID（game_tasks.id）',
  `cycle_key` VARCHAR(20) NOT NULL COMMENT '周期键：daily=YYYY-MM-DD，once=once',
  `progress_snapshot` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '领取时的进度值（留痕）',
  `reward_snapshot` JSON NULL COMMENT '实际发放的奖励明细',
  `claimed_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_student_task_cycle` (`student_id`, `task_id`, `cycle_key`),
  INDEX `idx_task_time` (`task_id`, `claimed_at`),
  INDEX `idx_student` (`student_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学生任务领取记录（唯一键幂等）';

-- 预置 8 个每日任务（教师端可编辑/启停/改适用班级；INSERT IGNORE 保证重复执行不覆盖教师改动）
INSERT IGNORE INTO `game_tasks`
  (`id`,`name`,`description`,`icon`,`task_type`,`metric`,`metric_params`,`target_value`,`unit`,`rewards`,`class_ids`,`is_active`,`sort_order`)
VALUES
  ('gtask_daily_correct_100','每日百题达人','今日做对 100 道题','star','daily','answer_correct',NULL,100,'题','[{"type":"points","value":50},{"type":"internet_code","value":1}]',NULL,1,10),
  ('gtask_daily_correct_20','每日小试','今日做对 20 道题','bolt','daily','answer_correct',NULL,20,'题','[{"type":"points","value":10}]',NULL,1,20),
  ('gtask_daily_mastered_5','每日掌握','今日新掌握 5 道题','book','daily','practice_mastered',NULL,5,'题','[{"type":"points","value":30}]',NULL,1,30),
  ('gtask_daily_op_score_500','WPS 操作题挑战','今日 WPS / Access 操作题得分满 500','trophy','daily','op_score',NULL,500,'分','[{"type":"points","value":80}]',NULL,1,40),
  ('gtask_daily_checkin','勤学好问','完成今日勤学好问打卡','check','daily','checkin',NULL,1,'次','[{"type":"points","value":5}]',NULL,1,50),
  ('gtask_daily_accuracy','稳扎稳打','今日作答正确率不低于 90%（至少 10 题）','target','daily','accuracy','{"rate":90,"min_count":10}',1,'','[{"type":"points","value":20}]',NULL,1,60),
  ('gtask_daily_pk_win_2','对战时刻','今日 PK 对战胜利 2 局','sword','daily','pk_win',NULL,2,'局','[{"type":"points","value":20}]',NULL,1,70),
  ('gtask_daily_answer_30','每日勤练','今日累计作答 30 题','clock','daily','answer_count',NULL,30,'题','[{"type":"points","value":15}]',NULL,1,80);

-- point_transactions.source_type 增加 'mission'（游戏化任务奖励来源）
ALTER TABLE `point_transactions`
  MODIFY COLUMN `source_type`
  ENUM('notification', 'manual', 'system', 'practice', 'pet_feed', 'test', 'python_submit', 'exam', 'task', 'pk_battle', 'mission')
  NOT NULL DEFAULT 'notification' COMMENT '来源类型';
