-- 知识点 · AI 讲解脚本缓存（2026-11-01）
--
-- 学习模块每个知识点（= chapter-taxonomy 的一个小节）标题后面挂一个耳机按钮，
-- 点开把这节讲义讲成一节「微型课」：导入 → 若干要点 → 易错点 → 考点 → 一句话记住 → 随堂一问。
--
-- 为什么一个知识点一份脚本全校共用：
--   · 同一节内容所有班级听到的应该是同一套口径，老师课前核对一次即可；
--   · 生成一次要几秒 + token，每人每次重新生成既不划算也不稳定。
--
-- ⛔ content_hash 存「该小节讲义正文」的哈希：老师在考点精讲里改了这节内容，
--    缓存自动失效重新生成，否则学生听到的是过时的讲解。
-- ⛔ 只存 AI 生成的讲稿（讲解词 / 板书 / 例子 / 易错 / 随堂问题目），
--    不存任何新的知识结论的「正确答案」性质的题库数据 —— 知识点讲解没有标准答案，
--    但讲义原文是权威口径，脚本必须忠实于它。
CREATE TABLE IF NOT EXISTS `knowledge_explain_scripts` (
  `section_path` VARCHAR(160) NOT NULL COMMENT '知识点路径：章名/小节名（与 questions.cluster_id 二级口径一致）',
  `content_hash` CHAR(64) NOT NULL DEFAULT '' COMMENT '讲义正文哈希，变了就重新生成',
  `script` LONGTEXT NOT NULL COMMENT '脚本 JSON：{intro,objectives,points,pitfalls,exam,mnemonic,quiz}',
  `model` VARCHAR(64) DEFAULT NULL COMMENT '生成模型',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`section_path`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识点 AI 讲解脚本缓存';
