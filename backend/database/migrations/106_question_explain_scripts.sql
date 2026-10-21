-- AI 语音讲解脚本缓存（教师端「错题排行 / 试卷按题目查看」的讲解器用）
--
-- 设计要点：
--  - 一题一份脚本，question_id 直接做主键（同一道题全校复用，讲第二次零成本零延迟）。
--  - script 存讲解脚本 JSON（scenes 数组），前端按 kind 渲染成不同图文样式并逐句朗读。
--  - 讲解内容以题库自带解析（questions.explanation）为底稿生成，模型只做口语化改写与拆镜，
--    降低编造风险；prompt_version 变更后可按需强制重生成（force=1）。
CREATE TABLE IF NOT EXISTS `question_explain_scripts` (
  `question_id` VARCHAR(50) NOT NULL COMMENT '题目ID',
  `script` LONGTEXT NOT NULL COMMENT '讲解脚本 JSON（topic + scenes[]）',
  `model` VARCHAR(64) DEFAULT NULL COMMENT '生成模型',
  `prompt_version` VARCHAR(16) DEFAULT NULL COMMENT '提示词版本，便于批量重生成',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`question_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 语音讲解脚本缓存';
