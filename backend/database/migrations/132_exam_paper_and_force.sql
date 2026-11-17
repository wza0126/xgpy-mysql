-- 132_exam_paper_and_force.sql
-- 试卷多题型 + 卷面总分 + 强制开考 + 考试离屏统计（2026-11-17）
--
-- 背景（吴老 2026-11-17 需求）：
--   1. 试卷不再只有选择题：选择 2 分/题、综合 20 分/题、编程填空 10 分/题（按小题/空结分）。
--      → 卷面满分不再是 100，必须把「该场考试的满分」落库，否则「37 分」看不出好差。
--      ⛔ 老记录一律回填 100：历史 score 就是百分制，paper_total=100 才能让旧数据继续成立。
--   2. 老师要能「强制开始」「强制结束」某张试卷 → 学生端靠心跳取指令，需要一个指令表。
--   3. 考试期间切到别的窗口要计数 → 学生端心跳上报，落 exam_progress（考试中）与 exam_records（交卷后）。
--
-- ⛔ paper_total 的默认值必须是 100 而不是 0：0 会让「得分/满分」除零，端上显示 NaN。

ALTER TABLE `tests`
  ADD COLUMN IF NOT EXISTS `paper_total` int(11) NOT NULL DEFAULT 0
  COMMENT '卷面满分（选择2分+综合20分+编程10分按题累加，0=尚未按新口径计算）';

ALTER TABLE `exam_records`
  ADD COLUMN IF NOT EXISTS `paper_total` int(11) NOT NULL DEFAULT 100
  COMMENT '该场考试卷面满分；历史记录为百分制，回填 100',
  ADD COLUMN IF NOT EXISTS `inactive_count` int(11) NOT NULL DEFAULT 0
  COMMENT '考试期间切出平台（窗口失焦）次数',
  ADD COLUMN IF NOT EXISTS `inactive_seconds` int(11) NOT NULL DEFAULT 0
  COMMENT '考试期间累计离屏秒数';

ALTER TABLE `exam_progress`
  ADD COLUMN IF NOT EXISTS `inactive_count` int(11) NOT NULL DEFAULT 0
  COMMENT '本次考试中切出平台的累计次数（交卷时写入 exam_records）',
  ADD COLUMN IF NOT EXISTS `inactive_seconds` int(11) NOT NULL DEFAULT 0
  COMMENT '本次考试中离屏累计秒数',
  ADD COLUMN IF NOT EXISTS `last_heartbeat_at` datetime DEFAULT NULL
  COMMENT '学生端最近一次考试心跳时间，用于判断是否在线';

CREATE TABLE IF NOT EXISTS `exam_force_controls` (
  `test_id` varchar(50) NOT NULL COMMENT '试卷ID',
  `force_start` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1=强制该卷学生端弹出考试窗口',
  `force_start_at` datetime DEFAULT NULL COMMENT '最近一次强制开考时间',
  `force_end` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1=强制交卷（学生端 60 秒倒计时后自动交卷）',
  `force_end_at` datetime DEFAULT NULL COMMENT '最近一次强制结束时间',
  `updated_by` varchar(50) DEFAULT NULL COMMENT '操作老师ID',
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`test_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='考试强制开考/强制结束指令（学生端心跳拉取）';
