-- AI 学情分析结果存档（2026-10-26）
--
-- 背景：原来 AI 分析的答案只活在当次页面状态里，刷新、切班、切主题就没了，
-- 老师想再看一遍只能重新烧一次 token（还占每天 60 次的额度）。
--
-- 设计取舍：
--   · 存**答案原文**，不存指标包 —— 指标包每次都能用固定 SQL 重算，存了反而会与现库脱节；
--     老师回看时看到的是「当时那份数据的结论」，时间戳会一并展示，不会被误当成最新数据。
--   · 一份回答一行（一个问题一行），不合并成会话 —— 老师找的是「上周那次的结论」，
--     按问题/时间列出来比按会话翻更快。
--   · 不存限频计数：那是内存里的运行时状态，与存档无关。

CREATE TABLE IF NOT EXISTS `ai_analysis_reports` (
  `id`         VARCHAR(50)  NOT NULL COMMENT '主键（uuid）',
  `teacher_id` VARCHAR(50)  NOT NULL COMMENT '生成者，教师账号ID',
  `class_id`   VARCHAR(50)  NOT NULL COMMENT '分析对象班级',
  `class_name` VARCHAR(100) DEFAULT NULL COMMENT '班级名快照（班级改名后仍能认出当时分析的是谁）',
  `topic`      VARCHAR(50)  NOT NULL COMMENT '分析主题：overview/mastery/wrong/students/exam',
  `question`   TEXT         NOT NULL COMMENT '老师提的问题',
  `answer`     MEDIUMTEXT   NOT NULL COMMENT 'AI 回答原文（Markdown）',
  `model`      VARCHAR(64)  DEFAULT NULL COMMENT '生成所用模型',
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_class_time` (`class_id`, `created_at`),
  KEY `idx_teacher_time` (`teacher_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI 学情分析结果存档';
