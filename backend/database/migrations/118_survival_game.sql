-- 生存游戏（信号深潜，2026-10-27 吴老定）
--
-- 玩法：一关一题，答对 +10 信号，答错 -30 并要求订正；HP 归零断线，回到第 1 关重来。
-- 关卡以知识点为基础，三段编号（1.1.1 ~ 4.3.3，共 70 关，对应 982 道可练题）。
--
-- ⛔ 所有进度必须落库：HP、当前关卡、待订正状态都不能只存前端，
--    否则学生改一下就是无限血、跳关、跳过订正。
-- ⛔ 排行榜「深度榜」用 total_levels（累计，死亡不清零），
--    「信号榜」用 hp（当前血量，死亡归位）—— 两个榜必须来自不同字段，否则会完全重复。

-- 1) 关卡表：70 行，首次由后端从题库/讲义自动生成，老师可在后台改标题、顺序、停用、补题
CREATE TABLE IF NOT EXISTS `survival_levels` (
  `seq`             INT          NOT NULL COMMENT '关卡顺序 1..70，决定推进次序',
  `code`            VARCHAR(16)  NOT NULL COMMENT '三段编号，如 1.1.1（单元.章.节）',
  `title`           VARCHAR(120) NOT NULL COMMENT '关卡名（知识点名）',
  `unit_index`      TINYINT      NOT NULL DEFAULT 1 COMMENT '单元序号 1~4',
  `unit_name`       VARCHAR(60)  NOT NULL DEFAULT '' COMMENT '单元名，如「必修一 · 数据」',
  `chapter_name`    VARCHAR(60)  NOT NULL DEFAULT '' COMMENT '章名',
  `cluster_id`      VARCHAR(200) NOT NULL COMMENT '知识点 cluster_id，抽题用',
  `question_count`  INT          NOT NULL DEFAULT 0 COMMENT '该知识点题量（同步时刷新）',
  `extra_question_ids` TEXT      NULL COMMENT '手动补充的题目 ID 数组（单题关卡用，跨知识点）',
  `is_active`       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '停用的关卡会被跳过',
  `updated_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`seq`),
  KEY `idx_cluster` (`cluster_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生存游戏关卡表';

-- 2) 学生档案：每人一行，HP / 关卡 / 累计战绩
CREATE TABLE IF NOT EXISTS `survival_profiles` (
  `student_id`          VARCHAR(50) NOT NULL,
  `hp`                  INT         NOT NULL DEFAULT 100 COMMENT '当前信号强度，死亡归位到初始值',
  `seq`                 INT         NOT NULL DEFAULT 1   COMMENT '当前关卡顺序（1..70）',
  `round_no`            INT         NOT NULL DEFAULT 1   COMMENT '第几轮（走完 70 关自动 +1，编号回到 1.1.1）',
  `total_levels`        INT         NOT NULL DEFAULT 0   COMMENT '累计通关层数（死亡不清零）→ 深度榜',
  `round_levels`        INT         NOT NULL DEFAULT 0   COMMENT '本轮已通关数（死亡/换轮时清零）',
  `best_round_levels`   INT         NOT NULL DEFAULT 0   COMMENT '单轮抵达最深层（历史最深）',
  `total_correct`       INT         NOT NULL DEFAULT 0,
  `total_wrong`         INT         NOT NULL DEFAULT 0,
  `deaths`              INT         NOT NULL DEFAULT 0,
  `current_question_id` VARCHAR(50) NULL COMMENT '当前关卡的题目，防跳关',
  `current_started_at`  TIMESTAMP   NULL COMMENT '本关开始时间',
  `current_deadline`    TIMESTAMP   NULL COMMENT '本关截止时间（超时按答错处理）',
  `pending_correction`  TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '1=答错了还没订正，禁止进下一关',
  `alive`               TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '是否在局中（0=已断线待重生）',
  `last_played_at`      TIMESTAMP   NULL,
  `created_at`          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`student_id`),
  KEY `idx_total_levels` (`total_levels`),
  KEY `idx_hp` (`hp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生存游戏学生档案';

-- 3) 答题日志：一题一行，用于「同一题当天只计一次 +10」与教师端战况分析
CREATE TABLE IF NOT EXISTS `survival_answers` (
  `id`            VARCHAR(50) NOT NULL,
  `student_id`    VARCHAR(50) NOT NULL,
  `seq`           INT         NOT NULL COMMENT '第几关',
  `round_no`      INT         NOT NULL DEFAULT 1,
  `question_id`   VARCHAR(50) NOT NULL,
  `cluster_id`    VARCHAR(200) NULL,
  `is_correct`    TINYINT(1)  NOT NULL DEFAULT 0,
  `is_correction` TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '1=订正作答（不计血、不计关）',
  `hp_before`     INT         NULL,
  `hp_after`      INT         NULL,
  `hp_delta`      INT         NULL,
  `elapsed_ms`    INT         NULL,
  `created_at`    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_student_time` (`student_id`, `created_at`),
  KEY `idx_student_q` (`student_id`, `question_id`, `created_at`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生存游戏答题日志';

-- 4) 模块开关：与「练习 / 测试 / 综合题」同一套机制
--    classes 决定班级是否开放，profiles 是同步到学生个人的实际开关（学生端只认 profiles）
ALTER TABLE `classes`
  ADD COLUMN IF NOT EXISTS `survival_enabled` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '生存游戏模块开关（1=允许学生进入）';

ALTER TABLE `profiles`
  ADD COLUMN IF NOT EXISTS `survival_enabled` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '生存游戏模块开关（与班级同步）';

-- ⛔ 排序规则必须与 profiles / questions 一致（utf8mb4_unicode_ci）：
--    否则 JOIN 时 MariaDB 报 Illegal mix of collations，排行榜直接 500。
--    CREATE TABLE 里已声明 COLLATE，这里再兜一次，兼容已按旧写法建过表的库。
ALTER TABLE `survival_levels`   CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `survival_profiles` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `survival_answers`  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
