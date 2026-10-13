-- 095_desktop_farm_game.sql
-- 「代码农场」桌面游戏：把学生虚拟桌面变成可编程的农田
--
-- 产品形态：教师后台开关 -> 学生桌面 10 秒轮询自动进入农场态 -> 学生写 Python
--   （前端内置子集解释器执行）-> 前端只提交「操作序列」-> 后端权威结算 -> 作物生长/收获积分。
--
-- 设计要点：
--   1) 开关与参数集中在 farm_config 单行表（模仿 student_message_settings），
--      不改 pet_config，避免与宠物/专注模式字段混淆。
--   2) 生长 = 时间自然生长（挂着也长）+ 劳作加速（写代码，价值感）。
--      每天有劳作次数上限，且水分/养分各有上限 -> 「无脑循环猛浇」无效，
--      引导学生写出精准控制的代码（核心教学点，也是防作弊手段）。
--   3) farm_plots 一人一块地；farm_logs 留痕每次提交的代码与结算，教师可查。
--   4) 判分口径在服务端：前端不提交 is_correct/points 之类结果，只交操作序列。

CREATE TABLE IF NOT EXISTS `farm_config` (
  `id` INT PRIMARY KEY COMMENT '固定为 1（单行配置）',
  `enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '游戏总开关',
  `class_ids` TEXT DEFAULT NULL COMMENT '生效班级ID数组(JSON)；NULL 或空数组 = 全部班级',
  `day_minutes` INT NOT NULL DEFAULT 10 COMMENT '多少分钟算一天（生长节奏）',
  `base_yield` INT NOT NULL DEFAULT 10 COMMENT '成熟收获的基础积分',
  `max_ops_per_day` INT NOT NULL DEFAULT 3 COMMENT '每天最多劳作次数（防刷）',
  `weather` VARCHAR(20) NOT NULL DEFAULT 'sunny' COMMENT '天气 sunny/rainy/drought',
  `notice` VARCHAR(255) DEFAULT NULL COMMENT '教师给全班的公告',
  `start_at` DATETIME DEFAULT NULL COMMENT '世界开始时间（推算天数用）',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` VARCHAR(50) DEFAULT NULL COMMENT '最后修改的教师ID'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代码农场全局配置（单行）';

INSERT IGNORE INTO `farm_config` (`id`, `enabled`) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS `farm_plots` (
  `id` VARCHAR(50) PRIMARY KEY,
  `student_id` VARCHAR(50) NOT NULL COMMENT '学生ID（profiles.id）',
  `class_id` VARCHAR(50) DEFAULT NULL COMMENT '冗余班级ID，便于按班查询',
  `crop` VARCHAR(20) DEFAULT NULL COMMENT '当前作物 key；NULL = 空地',
  `growth` DECIMAL(6,2) NOT NULL DEFAULT 0 COMMENT '生长值 0-100',
  `moisture` DECIMAL(6,2) NOT NULL DEFAULT 50 COMMENT '水分 0-100',
  `nutrient` DECIMAL(6,2) NOT NULL DEFAULT 50 COMMENT '养分 0-100',
  `stage` TINYINT NOT NULL DEFAULT 0 COMMENT '0空地 1幼苗 2成长 3成熟',
  `day_index` INT NOT NULL DEFAULT 0 COMMENT '最后结算到的天序号',
  `ops_today` INT NOT NULL DEFAULT 0 COMMENT '当天已劳作次数',
  `ops_day` INT NOT NULL DEFAULT 0 COMMENT 'ops_today 对应的天序号',
  `total_harvest` INT NOT NULL DEFAULT 0 COMMENT '累计收获次数',
  `total_points` INT NOT NULL DEFAULT 0 COMMENT '累计靠农场获得积分',
  `last_tick_at` DATETIME DEFAULT NULL COMMENT '最后按时间懒结算的时刻',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_farm_student` (`student_id`),
  INDEX `idx_farm_class` (`class_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代码农场学生地块';

CREATE TABLE IF NOT EXISTS `farm_logs` (
  `id` VARCHAR(50) PRIMARY KEY,
  `student_id` VARCHAR(50) NOT NULL COMMENT '学生ID',
  `code` TEXT COMMENT '学生提交的代码（截断保存）',
  `ops` LONGTEXT DEFAULT NULL COMMENT '解析出的操作序列(JSON)',
  `summary` LONGTEXT DEFAULT NULL COMMENT '结算摘要(JSON)',
  `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_farm_log_student` (`student_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代码农场劳作日志';
