-- Access 操作题一期：题型 + 评分点规格（复用 WPS 操作题既有表结构）
--
-- 背景：学测操作题里 Access 与 WPS 是两套软件，判分口径完全不同：
--   WPS 判 OOXML 文档结构（wps-grader.js），Access 判 .accdb 里的
--   表/字段/字段类型/主键/记录/排序/筛选（access-grader.js）。
--   但"教师上传模板 → 学生用真软件做题 → 上传文件 → 服务端逐评分点判分 → 回执"
--   这套**产品形态完全一致**，所以这里最大化复用：
--     · 评分点模型复用 steps[].checks[]（只是 checks 的 kind 换成 accdb_*）；
--     · 落库复用 wps_op_submissions（加 kind 列区分），student_answers 也复用；
--     · 路由独立成 access-op.js（/api/*/access-op/*），互不干扰。
--
-- ⛔ access_spec 里的 checks[] 就是答案，已加入 QUESTION_ANSWER_FIELDS，
--    学生端接口必须剥离后下发（见 access-op.js 的 stripSpecForStudent）。

-- ---------------------------------------------------------------------------
-- 1. questions：新增 access_op 题型 + 评分点规格
-- ---------------------------------------------------------------------------
ALTER TABLE `questions`
  MODIFY COLUMN `type` ENUM('choice','fill_blank','code','composite','wps_op','access_op') NOT NULL;

ALTER TABLE `questions`
  ADD COLUMN IF NOT EXISTS `access_spec` LONGTEXT NULL COMMENT 'ACCESS操作题评分点规格(JSON)：{full_score, steps[{title,desc,score,video_urls[],checks[]}]}';

-- ---------------------------------------------------------------------------
-- 2. wps_op_submissions：区分操作题种类 + 导出题附件
--    kind：wps（历史默认）/ access
--    extra_files：二期"导出 txt/xlsx 另交"用，JSON 数组 [{name,path,size,kind}]
-- ---------------------------------------------------------------------------
ALTER TABLE `wps_op_submissions`
  ADD COLUMN IF NOT EXISTS `kind` VARCHAR(10) NOT NULL DEFAULT 'wps' COMMENT '操作题种类：wps/access';

ALTER TABLE `wps_op_submissions`
  ADD COLUMN IF NOT EXISTS `extra_files` LONGTEXT NULL COMMENT '导出题另交的附件(JSON)：[{name,path,size,kind}]';

ALTER TABLE `wps_op_submissions`
  ADD INDEX IF NOT EXISTS `idx_wps_sub_kind` (`kind`);

-- ---------------------------------------------------------------------------
-- 3. 提交时间提到毫秒精度
--    原因：一次判分流程里可能"连着交两份"（如先交 A 再交 B），秒精度下两行
--    created_at 完全相同 → "最近一次提交"（ORDER BY created_at DESC LIMIT 1）
--    会随机返回其一，回执与详情页就会显示错的那一份。
-- ---------------------------------------------------------------------------
ALTER TABLE `wps_op_submissions`
  MODIFY COLUMN `created_at` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '提交时间';

ALTER TABLE `wps_op_submissions`
  MODIFY COLUMN `graded_at` DATETIME(3) DEFAULT NULL COMMENT '判分时间';
