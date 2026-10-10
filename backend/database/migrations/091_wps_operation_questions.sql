-- WPS 操作题（学测信息技术操作题）一期：题型 + 评分点规格 + 分步得分落库
--
-- 背景：学测操作题（如"人口密度数据分析表"）判的是 OOXML 文档结构——合并单元格、
--   字体/数字格式、公式、图表 XML，跟既有"题干选项文本比对"不是一套模型。
--   一期形态：教师上传模板 → 学生用真 WPS 做题 → 上传 xlsx → 服务端逐评分点判分 → 回执。
--
-- 设计要点：
--   1) 每题满分 10 分、分步得分；评分点定义（含每步分值、演示视频位）整体存 questions.wps_spec。
--      ⛔ wps_spec 里的 checks[] 就是答案，学生端接口必须剥离后下发（见 stripWpsSpecForStudent）。
--   2) 判分结果既要能被操作题自身查询（wps_op_submissions），也要能进入既有统计口径
--      （student_answers 加 score_obtained / score_detail），否则操作题不算"掌握"。
--   3) 演示视频属于「后期每步配一段」，故 video_url 放在每个 step 上而不是题目级。

-- ---------------------------------------------------------------------------
-- 1. questions：新增 wps_op 题型 + 评分点规格
-- ---------------------------------------------------------------------------
ALTER TABLE `questions`
  MODIFY COLUMN `type` ENUM('choice','fill_blank','code','composite','wps_op') NOT NULL;

ALTER TABLE `questions`
  ADD COLUMN IF NOT EXISTS `wps_spec` LONGTEXT NULL COMMENT 'WPS操作题评分点规格(JSON)：{full_score, grader, steps[{title,desc,score,video_url,checks[]}]}';

-- ---------------------------------------------------------------------------
-- 2. student_answers：分步得分（判分模型从布尔升级为"评分点"）
--    is_correct 语义保持不变（满分才算对），用于练习门禁 / 已掌握题数口径；
--    score_obtained / score_detail 记录部分分与逐评分点明细。
-- ---------------------------------------------------------------------------
ALTER TABLE `student_answers`
  ADD COLUMN IF NOT EXISTS `score_obtained` DECIMAL(6,2) NULL COMMENT '操作题得分，非操作题为 NULL',
  ADD COLUMN IF NOT EXISTS `score_detail` LONGTEXT NULL COMMENT '操作题逐评分点明细(JSON)';

-- ---------------------------------------------------------------------------
-- 3. wps_op_submissions：操作题提交与判分记录（每次提交一条，保历史可追溯）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wps_op_submissions` (
  `id` VARCHAR(50) NOT NULL COMMENT '提交记录ID',
  `student_id` VARCHAR(50) NOT NULL COMMENT '学生ID',
  `question_id` VARCHAR(50) NOT NULL COMMENT '题目ID',
  `source` VARCHAR(20) DEFAULT 'practice' COMMENT '来源：practice/test/exam/task',
  `ref_id` VARCHAR(50) DEFAULT NULL COMMENT '来源记录ID（test_record_id 等）',
  `file_path` VARCHAR(500) DEFAULT NULL COMMENT '上传文件在服务器上的相对路径',
  `original_filename` VARCHAR(255) DEFAULT NULL COMMENT '学生上传的原始文件名',
  `file_size` INT DEFAULT NULL COMMENT '文件字节数',
  `file_sha256` VARCHAR(64) DEFAULT NULL COMMENT '文件哈希，用于识别重复提交',
  `score_obtained` DECIMAL(6,2) NOT NULL DEFAULT 0 COMMENT '本次得分',
  `full_score` DECIMAL(6,2) NOT NULL DEFAULT 10 COMMENT '本题满分',
  `score_detail` LONGTEXT DEFAULT NULL COMMENT '逐步骤/逐评分点结果(JSON)',
  `graded_at` DATETIME DEFAULT NULL COMMENT '判分时间',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '提交时间',
  PRIMARY KEY (`id`),
  KEY `idx_wps_sub_student` (`student_id`),
  KEY `idx_wps_sub_question` (`question_id`),
  KEY `idx_wps_sub_student_question` (`student_id`, `question_id`),
  KEY `idx_wps_sub_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='WPS操作题提交与判分记录';
