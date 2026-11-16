-- 130_academy.sql
-- 星卡学院（原「Python魔法学院」重构）2026-11-16 吴老确认方案
--
-- 定位：陪伴型养成。16 章 = 16 座建筑，70 个知识点 = 70 张星卡（每张 3 阶）。
-- 课堂节奏（吴老定的硬约束）：70 个知识点必须在 35 节课内走完 → 每课 2 个知识点。
--
-- 设计取舍：
--   1. 学院不自己造货币体系：积分/钻石沿用平台既有发放与每日上限；
--      学院只新增「魔力/星尘」两个纯游戏内数值，不与真实奖励挂钩。
--   2. 星卡按 cluster_id 记账，**必须与 questions.cluster_id 完全同口径**，
--      否则卡和题对不上（漏一节就会出现永远点不亮的卡）。
--   3. 课次按班设置（academy_class_lesson）：老师今天讲第几课，学生就练那一课的 2 张卡；
--      不给 classes 表加字段，避免动那张被大量手写 SELECT 的表。

-- ---------- 学院档案 ----------
CREATE TABLE IF NOT EXISTS `academy_profiles` (
  `student_id` varchar(50) NOT NULL COMMENT '学生 id（profiles.id）',
  `level` tinyint(3) unsigned NOT NULL DEFAULT 1 COMMENT '学院等级 1-10，由已点亮星数换算，冗余存储便于排行',
  `stars` smallint(5) unsigned NOT NULL DEFAULT 0 COMMENT '已点亮星数（0-210），卡阶之和',
  `mana` int(11) NOT NULL DEFAULT 0 COMMENT '魔力：答对产出，用于买提示',
  `stardust` int(11) NOT NULL DEFAULT 0 COMMENT '星尘：章节集齐/每日首通产出，用于换外观',
  `streak_days` smallint(5) unsigned NOT NULL DEFAULT 0 COMMENT '连续登录天数',
  `last_active_date` date DEFAULT NULL COMMENT '最后活动日，用于连续天数判定',
  `total_answered` int(11) NOT NULL DEFAULT 0 COMMENT '学院内累计答题数',
  `total_correct` int(11) NOT NULL DEFAULT 0 COMMENT '学院内累计答对数',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`student_id`),
  KEY `idx_stars` (`stars`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='星卡学院档案：一个学生一行，无记录时按默认值懒创建';

-- ---------- 星卡（70 知识点 × N 学生） ----------
CREATE TABLE IF NOT EXISTS `academy_cards` (
  `student_id` varchar(50) NOT NULL,
  `cluster_id` varchar(100) NOT NULL COMMENT '知识点，与 questions.cluster_id 同口径（形如「数据编码/文本数据的编码」）',
  `stage` tinyint(3) unsigned NOT NULL DEFAULT 0 COMMENT '阶：0 未点亮 / 1 见习 / 2 熟练 / 3 精通',
  `correct_cnt` int(11) NOT NULL DEFAULT 0 COMMENT '该知识点累计答对次数',
  `wrong_cnt` int(11) NOT NULL DEFAULT 0 COMMENT '该知识点累计答错次数',
  `last_at` datetime DEFAULT NULL COMMENT '最后一次答题时间',
  PRIMARY KEY (`student_id`,`cluster_id`),
  KEY `idx_cluster` (`cluster_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='星卡进度：70 张卡只记有进度的行，没做过就没有行';

-- ---------- 每日委托（每课/每天 2 张卡） ----------
CREATE TABLE IF NOT EXISTS `academy_daily` (
  `student_id` varchar(50) NOT NULL,
  `day` date NOT NULL COMMENT '委托日期',
  `cluster_id` varchar(100) NOT NULL,
  `question_id` varchar(50) DEFAULT NULL COMMENT '本次派发的题目；概念卡（该节无题）为空',
  `done` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否已作答',
  `correct` tinyint(1) NOT NULL DEFAULT 0 COMMENT '作答是否正确',
  `picked_at` datetime DEFAULT NULL COMMENT '派发时间，用于「同一张卡同一天只派一次」',
  PRIMARY KEY (`student_id`,`day`,`cluster_id`),
  KEY `idx_day` (`day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='每日委托：一人一天一课 2 张卡，做完当天不再派';

-- ---------- 班级课次（老师控制讲到第几课） ----------
CREATE TABLE IF NOT EXISTS `academy_class_lesson` (
  `class_id` varchar(50) NOT NULL,
  `lesson_idx` smallint(5) unsigned NOT NULL DEFAULT 1 COMMENT '当前课次 1-35，对应课程序列里的两节课',
  `updated_by` varchar(50) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`class_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='班级课次：无记录 = 第 1 课，不写在 classes 表里以免影响既有 SELECT';

-- ---------- 默认配置（已存在则不改，避免覆盖老师设置） ----------
INSERT INTO `system_config` (`id`, `config_key`, `value`, `updated_at`)
VALUES ('config_academy_enabled', 'academy_enabled', '{"value":1}', NOW())
ON DUPLICATE KEY UPDATE `config_key` = VALUES(`config_key`);

-- 每课首通发几颗钻石（0 = 不发）。走平台每日产出上限，不另开额度
INSERT INTO `system_config` (`id`, `config_key`, `value`, `updated_at`)
VALUES ('config_academy_diamond', 'academy_diamond_per_lesson', '{"value":1}', NOW())
ON DUPLICATE KEY UPDATE `config_key` = VALUES(`config_key`);

-- 每课几张卡（默认 2，70 节 / 35 课）
INSERT INTO `system_config` (`id`, `config_key`, `value`, `updated_at`)
VALUES ('config_academy_cards_per_lesson', 'academy_cards_per_lesson', '{"value":2}', NOW())
ON DUPLICATE KEY UPDATE `config_key` = VALUES(`config_key`);

-- ---------- 应用改造：Python魔法学院 → 星卡学院 ----------
-- 保留同一个 app id：应用可见性、使用记录、推荐位都挂在这个 id 上，换 id 会全部丢失
-- ⛔ 这里**不动 is_active**（当前为 0）：前端组件没上线前打开会白屏，
--    等前端发版时用一句 UPDATE 打开（见发版记录）。
UPDATE `apps`
   SET `name` = '星卡学院',
       `description` = '答对一题点亮一张星卡，70 个学测知识点养出一座学院。每天 5 分钟，建筑随你学会的东西一起长大。',
       `type` = 'academy',
       `icon` = '🪄',
       `category` = '学习工具',
       `config` = '{"cards_per_lesson":2,"diamond_per_lesson":1,"reward_enabled":true}'
 WHERE `id` = 'app_python_magic_academy';
