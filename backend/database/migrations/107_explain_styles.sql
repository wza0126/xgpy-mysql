-- AI 语音讲解 · 风格库 + 「一题 × 风格」脚本缓存（2026-10-21）
--
-- 背景：原 question_explain_scripts 是「一题一份」，且风格要求写死在后端常量里，
--       老师既不能调风格，也不能给不同层次的学生换讲法。本次改为：
--         ① explain_styles  —— 风格库（内置 5 组，教师端可改 / 可复制 / 可停用）
--         ② explain_scripts —— 缓存键改成 (question_id, style_key)
--
-- ⛔ 缓存必须按风格拆开：只按 question_id 存，切风格会读到上一种风格的脚本（讲解串台）。
-- ⛔ 内置风格不在这里插入：唯一真源是 backend/src/explain-styles.js 的 BUILTIN_STYLES，
--    启动时 INSERT IGNORE 补齐（既保证新库有默认值，也避免 SQL 与代码两处文本漂移）。
CREATE TABLE IF NOT EXISTS `explain_styles` (
  `style_key` VARCHAR(32) NOT NULL COMMENT '风格标识（英文小写/数字/下划线）',
  `name` VARCHAR(40) NOT NULL COMMENT '显示名（讲解器顶部 chip、设置页列表）',
  `summary` VARCHAR(80) NOT NULL DEFAULT '' COMMENT '一句话说明，chip 悬浮提示用',
  `snippet` TEXT NOT NULL COMMENT '风格要求片段，拼进系统提示词',
  `max_chars` INT NOT NULL DEFAULT 260 COMMENT '整段讲解旁白字数上限（120~600）',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0=停用（不出现在讲解器，历史缓存保留）',
  `builtin` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=内置（可改可停用，不可删除；支持恢复默认）',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '升序；数字小的排在前面，也是默认风格',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`style_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 讲解风格库';

CREATE TABLE IF NOT EXISTS `explain_scripts` (
  `question_id` VARCHAR(50) NOT NULL COMMENT '题目ID',
  `style_key` VARCHAR(32) NOT NULL DEFAULT 'chat' COMMENT '风格标识（对应 explain_styles.style_key）',
  `script` LONGTEXT NOT NULL COMMENT '讲解脚本 JSON（topic + scenes[]）',
  `model` VARCHAR(64) DEFAULT NULL COMMENT '生成模型',
  `prompt_version` VARCHAR(64) DEFAULT NULL COMMENT '提示词版本（含风格片段哈希，改风格/改提示词即失效）',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`question_id`, `style_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 讲解脚本缓存（一题 × 一风格）';

-- 旧表是纯缓存，且提示词结构已变（prompt_version 由 v1 → v2:<hash>），旧内容本来就会全部失效。
-- 直接删表，避免库里留一张永不写入的孤儿表（data-io 会把它归到「其他」域）。
DROP TABLE IF EXISTS `question_explain_scripts`;

-- 学生端「AI 语音讲解」默认关闭。
-- hidden_features 是「要隐藏的功能」列表，追加 ai_explain 即默认不可见；
-- 老师在「学生管理 → 讲解」里按账号放开（通常只给演示用的几个账号）。
-- ⚠️ 应用过的迁移不会重跑，这里是唯一一次批量补齐；之后新学生由代码里的默认列表兜底。
-- ⛔ 分两句写：NULL 的原语义是「按前端隐式默认：画笔+点名都隐藏」，
--    若直接 JSON_ARRAY_APPEND(COALESCE(...))，NULL 会变成 ["ai_explain"]，
--    等于顺手把画笔和点名放了出来（这是行为回退，不是新功能）。
UPDATE `profiles`
SET `hidden_features` = JSON_ARRAY('paint_board', 'roll_call', 'ai_explain')
WHERE `role` = 'student' AND `hidden_features` IS NULL;

UPDATE `profiles`
SET `hidden_features` = JSON_ARRAY_APPEND(`hidden_features`, '$', 'ai_explain')
WHERE `role` = 'student' AND JSON_CONTAINS(`hidden_features`, '"ai_explain"') = 0;
