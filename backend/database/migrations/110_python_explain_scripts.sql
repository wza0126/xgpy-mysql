-- 编程填空题 · AI 讲解脚本缓存（2026-10-22）
--
-- 学生端「python 编程 → 编程填空」里点「AI 语音讲解」，逐个空讲填空技巧。
-- 一题一份脚本全校复用：同一道题不同班级讲的是同一套逻辑，没必要每人每次重新生成。
--
-- ⛔ 正确答案**不进模型输出**：脚本里只存「为什么这么填 / 易错点」，
--    答案由后端从 python_tasks.blank_answers 直接注入 —— 模型编错一个字符，
--    学生照着填就是错的，这是这种题最不能出的错。
-- ⛔ content_hash 存题目内容哈希（标题+说明+模板+答案）：老师改了题，缓存自动失效，
--    否则学生听到的是旧版的讲解。
CREATE TABLE IF NOT EXISTS `python_explain_scripts` (
  `task_id` VARCHAR(50) NOT NULL COMMENT '编程任务ID（python_tasks.id）',
  `content_hash` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '题目内容哈希，变了就重新生成',
  `script` LONGTEXT NOT NULL COMMENT '脚本 JSON：{intro, blanks:[{index,why,tip}], summary}',
  `model` VARCHAR(64) DEFAULT NULL COMMENT '生成模型',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='编程填空题 AI 讲解脚本缓存';
