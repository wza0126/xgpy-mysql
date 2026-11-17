-- 133: 记录学生考试用的电脑 IP（2026-11-17）
-- 目的：老师在「学生考试情况 → 按学生查看」里能按 IP 判断相邻机器的答案是否雷同。
-- 写入时机：每次取卷（GET /api/business/exam-paper/:testId），换电脑继续考会更新成最新的一台。
ALTER TABLE exam_records
  ADD COLUMN client_ip VARCHAR(45) NULL DEFAULT NULL
  COMMENT '取卷时的客户端 IP（用于识别同桌机器 / 查雷同答案）'
  COLLATE utf8mb4_unicode_ci;
