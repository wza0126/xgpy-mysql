-- 题目聚类：为同类题推荐功能提供依据
-- cluster_id 形如 "信息系统/分类与类型"，由 AI 自动聚类生成，不暴露给学生筛选页
-- 教师可在题库管理模块批量选取题目后点击「AI 聚类」按钮生成

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS cluster_id VARCHAR(100) DEFAULT NULL COMMENT 'AI 聚类ID（知识点路径，内部用）';

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS sub_topic VARCHAR(100) DEFAULT NULL COMMENT 'AI 子主题（更细的知识点描述）';

ALTER TABLE questions
  ADD INDEX IF NOT EXISTS idx_cluster (cluster_id);
