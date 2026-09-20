-- 080: 题目聚类工具化
--
-- 背景与问题：
--   1. 聚类任务状态原本存在后端内存 Map（index.js 的 clusterJobs），后端一重启任务记录就没了，
--      前端 2 秒轮询会拿到 404，无法断点续跑，只能整批重来（白烧 token）。
--   2. cluster_id 里混着 AI 自由发挥的类目名（79 个一级类目里 67 个是题干误判），
--      因为老提示词只给「参考类目」不强制枚举。
--   3. 缺少「哪些题还没聚类」「哪些题是人工改过的」的标记：
--      - 无法只跑增量（新增题目），每次都得全量重跑；
--      - 人工修正过的分类在下一次全量重跑时会被 AI 覆盖。
--   4. AI 调用失败的批次被静默跳过（job.skipped++），界面上看不出到底漏了哪些题。
--
-- 本次改动：
--   A. questions 增加三个聚类元数据字段（cluster_status / cluster_source / clustered_at）
--   B. 新增 question_cluster_tasks 任务表，聚类任务状态落库，支持后端重启后继续查询、
--      失败批次续跑、以及「增量 / 全量 / 重试失败 / 单选改挂」四种模式。
--
-- 约定：
--   cluster_status: pending（未聚类）/ running（处理中）/ done（成功）/ failed（AI 调用失败待重试）
--   cluster_source: ai（AI 自动）/ manual（教师在题库管理里手工指定，重跑时跳过）

-- ---------- A. questions 聚类元数据 ----------

ALTER TABLE `questions`
ADD COLUMN IF NOT EXISTS `cluster_status` ENUM('pending','running','done','failed')
  NOT NULL DEFAULT 'pending' COMMENT '聚类状态';

ALTER TABLE `questions`
ADD COLUMN IF NOT EXISTS `cluster_source` ENUM('ai','manual')
  NOT NULL DEFAULT 'ai' COMMENT '聚类来源：ai=自动，manual=人工指定（重跑跳过）';

ALTER TABLE `questions`
ADD COLUMN IF NOT EXISTS `clustered_at` DATETIME NULL COMMENT '最近一次成功聚类时间';

ALTER TABLE `questions`
ADD INDEX IF NOT EXISTS `idx_cluster_status` (`cluster_status`);

-- 历史数据回填：已有 cluster_id 的题视为已聚类（来源统一记 ai，teacher 后续可在界面手工改成 manual）
UPDATE `questions`
SET `cluster_status` = 'done', `clustered_at` = NOW()
WHERE `cluster_id` IS NOT NULL AND `cluster_id` <> '' AND `cluster_status` = 'pending';

-- ---------- B. 聚类任务表 ----------

CREATE TABLE IF NOT EXISTS `question_cluster_tasks` (
  `id` VARCHAR(64) PRIMARY KEY COMMENT '任务ID',
  `mode` ENUM('incremental','full','retry','manual','selected','resume') NOT NULL DEFAULT 'incremental'
    COMMENT 'incremental=只跑未聚类 / full=全量重跑(保留manual) / retry=只重试失败 / manual=单题改挂 / selected=聚类指定题 / resume=断点续跑',
  `status` ENUM('running','paused','completed','failed') NOT NULL DEFAULT 'running',
  `total` INT NOT NULL DEFAULT 0 COMMENT '本次任务题目总数',
  `total_batches` INT NOT NULL DEFAULT 0,
  `processed_batches` INT NOT NULL DEFAULT 0,
  `updated` INT NOT NULL DEFAULT 0 COMMENT '成功写入数',
  `skipped` INT NOT NULL DEFAULT 0 COMMENT '失败/无结果数',
  `question_ids` JSON NULL COMMENT '本次任务的题目ID清单（用于断点续跑与失败重试）',
  `failed_ids` JSON NULL COMMENT '失败待重试的题目ID清单',
  `details` JSON NULL COMMENT '逐题结果 [{question_id, cluster_id, sub_topic, status}]',
  `last_error` TEXT NULL COMMENT '最近一次错误信息',
  `created_by` VARCHAR(64) NULL COMMENT '发起教师ID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  INDEX `idx_status` (`status`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI 题目聚类任务（落库，替代原内存 Map）';
