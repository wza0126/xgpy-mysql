-- AI 讲堂 · 微课程（2026-10-21）
--
-- 与「AI 语音讲解」的区别：讲解是「一道题 × 一种风格」的即时口播稿，
-- 用完即弃；微课程是老师长期维护的**课件资产**，要能反复投屏、能改、能发布给学生自学。
-- 因此不能复用 explain_scripts：
--   ① 没有 question_id，缓存键无从谈起；
--   ② 内容必须可编辑（老师在编辑器里改字），不能用「生成即定稿 + 按 hash 失效」;
--   ③ 有草稿/已发布两种状态，学生端只看得到 published。
--
-- ⛔ pages 用一列 JSON 而不是拆 pages 子表：微课程是整篇编辑（改字、调序、增删页都在一次保存里完成），
--    拆表会引入「半保存」的中间态，而且排序要靠 position 字段维护，得不偿失。
-- ⛔ 本表必须登记进 data-io.js 的 ai 域，否则教师备份会静默丢掉微课程。
CREATE TABLE IF NOT EXISTS `lectures` (
  `id` VARCHAR(50) NOT NULL COMMENT '微课程ID',
  `title` VARCHAR(120) NOT NULL COMMENT '课程标题（列表卡片与播放器顶栏）',
  `subject` VARCHAR(32) NOT NULL DEFAULT '必修1' COMMENT '教材模块：必修1 / 必修2',
  `chapter` VARCHAR(120) NOT NULL DEFAULT '' COMMENT '章节小节，如「1.2 数据的计算」',
  `outline` TEXT COMMENT '老师提供的知识点大纲（生成输入，保留下来便于「重新生成」）',
  `requirement` TEXT COMMENT '老师的额外要求（口吻、重点、忌讳等，生成输入）',
  `style_key` VARCHAR(32) NOT NULL DEFAULT 'lecture' COMMENT '讲解风格，对应 explain_styles.style_key',
  `pages` LONGTEXT NOT NULL COMMENT '页面 JSON 数组：[{kind,title,narration,bullets?,steps?,table?,chart?,code?,note?}]',
  `cover` JSON DEFAULT NULL COMMENT '首屏摘要 {kind,title,kicker}（冗余：列表卡片用，避免为了一张封面读整篇 pages）',
  `page_count` INT NOT NULL DEFAULT 0 COMMENT '页数（冗余，列表展示用）',
  `duration_sec` INT NOT NULL DEFAULT 0 COMMENT '预估时长秒（按讲解词字数估算，仅展示）',
  `status` VARCHAR(16) NOT NULL DEFAULT 'draft' COMMENT 'draft=草稿（仅教师可见） / published=已发布（学生端可见）',
  `class_ids` JSON DEFAULT NULL COMMENT '可见班级 id 数组；NULL 或 [] = 不限班级（全班可见）',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '升序；列表顺序',
  `play_count` INT NOT NULL DEFAULT 0 COMMENT '播放次数（学生端每打开一次 +1）',
  `created_by` VARCHAR(50) DEFAULT NULL COMMENT '创建教师 id',
  `published_at` DATETIME(3) DEFAULT NULL COMMENT '首次发布时间',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_status_order` (`status`, `sort_order`),
  KEY `idx_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 讲堂微课程（课件资产）';
