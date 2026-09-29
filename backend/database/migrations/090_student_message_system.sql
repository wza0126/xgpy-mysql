-- 学生消息体系 v2.7.0：放开纯数字限制 + 黑名单 / 举报 / 禁言 / 关键词屏蔽 / 消息设置
--
-- 背景：
--   v2.6.x 的「数字消息」只允许发 1-8 位纯数字、每人每天 10 条，目的是课堂上互相
--   传答案之外的信息。实际使用中老师希望它能承担「课堂互动 + PK 约战」的沟通职责，
--   于是需要：放开为任意文字、改按积分收费、并能管住骚扰与违规内容。
--
-- 本迁移共涉及 6 张新表 + student_messages 扩列 + classes 开关重命名。

-- ---------------------------------------------------------------------------
-- 1. 学生消息表扩容：content 从 VARCHAR(8) 放宽到 TEXT（字数限制改由配置控制）
-- ---------------------------------------------------------------------------
-- VARCHAR(8) 是「纯数字 1-8 位」时代的产物；改为 TEXT 后用应用层配置
-- （student_message_settings.max_length）约束，改字数上限不必再动表结构。
ALTER TABLE `student_messages`
  MODIFY COLUMN `content` TEXT NOT NULL COMMENT '消息内容（字数上限由消息设置控制）';

-- 记录本条消息实际扣了多少积分，便于对账与「撤回退款」类需求
ALTER TABLE `student_messages`
  ADD COLUMN IF NOT EXISTS `points_cost` INT NOT NULL DEFAULT 0 COMMENT '发送本条消息扣除的积分';

-- 发送时是否命中了屏蔽词（命中即拒绝发送，此列用于异常留痕，正常恒为 0）
ALTER TABLE `student_messages`
  ADD COLUMN IF NOT EXISTS `blocked_reason` VARCHAR(255) DEFAULT NULL COMMENT '被拦截原因（屏蔽词/禁言等，正常为 NULL）';

-- 教师处置：教师可从举报列表一键删除某条消息
ALTER TABLE `student_messages`
  ADD COLUMN IF NOT EXISTS `is_deleted` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '教师已删除（软删，学生端不再展示）';

-- ---------------------------------------------------------------------------
-- 2. 学生消息黑名单
-- ---------------------------------------------------------------------------
-- 语义：owner 不想收到 target 的消息。**单向**（A 拉黑 B 不表示 B 拉黑 A）。
-- 拉黑后 B 给 A 发消息时被拒，但为避免同学间报复/试探，前端提示为「对方已设置
-- 不接收消息」这类中性文案，不暴露拉黑方身份。
CREATE TABLE IF NOT EXISTS `student_message_blacklist` (
  `id` VARCHAR(50) PRIMARY KEY,
  `owner_id` VARCHAR(50) NOT NULL COMMENT '设置黑名单的学生（收不到消息的一方）',
  `target_id` VARCHAR(50) NOT NULL COMMENT '被拉黑的学生（发不出消息的一方）',
  `target_username` VARCHAR(100) DEFAULT NULL COMMENT '被拉黑者账号（快照，便于展示）',
  `target_real_name` VARCHAR(100) DEFAULT NULL COMMENT '被拉黑者姓名（快照）',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_owner_target` (`owner_id`, `target_id`),
  INDEX `idx_owner` (`owner_id`),
  INDEX `idx_target` (`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='学生消息黑名单（单向）';

-- ---------------------------------------------------------------------------
-- 3. 消息举报
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `student_message_reports` (
  `id` VARCHAR(50) PRIMARY KEY,
  `message_id` INT NOT NULL COMMENT '被举报的消息（student_messages.id）',
  `reporter_id` VARCHAR(50) NOT NULL COMMENT '举报人（收到该消息的学生）',
  `reporter_username` VARCHAR(100) DEFAULT NULL COMMENT '举报人账号（快照）',
  `reporter_real_name` VARCHAR(100) DEFAULT NULL COMMENT '举报人姓名（快照）',
  `reported_id` VARCHAR(50) NOT NULL COMMENT '被举报人（消息发送者）',
  `reported_username` VARCHAR(100) DEFAULT NULL COMMENT '被举报人账号（快照）',
  `reported_real_name` VARCHAR(100) DEFAULT NULL COMMENT '被举报人姓名（快照）',
  `message_content` TEXT COMMENT '被举报消息内容（快照，防消息被删后无从查证）',
  `reason` VARCHAR(500) NOT NULL COMMENT '举报理由（学生填写）',
  `status` ENUM('pending','handled','rejected') NOT NULL DEFAULT 'pending' COMMENT '处理状态',
  `handler_id` VARCHAR(50) DEFAULT NULL COMMENT '处理教师ID',
  `handle_note` VARCHAR(500) DEFAULT NULL COMMENT '处理备注',
  `handled_at` DATETIME DEFAULT NULL COMMENT '处理时间',
  `muted_days` INT NOT NULL DEFAULT 0 COMMENT '处理时对被举报人处以的禁言天数（0=未禁言）',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_message` (`message_id`),
  INDEX `idx_reporter` (`reporter_id`),
  INDEX `idx_reported` (`reported_id`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='学生消息举报记录';

-- ---------------------------------------------------------------------------
-- 4. 消息禁言
-- ---------------------------------------------------------------------------
-- 一人一行（最新一次禁言生效）。解除禁言 = DELETE 该行，历史在 point_transactions
-- 之外另记 teacher_operation 日志不必，教师端举报单里保留 muted_days 即可追溯。
CREATE TABLE IF NOT EXISTS `student_message_mutes` (
  `student_id` VARCHAR(50) PRIMARY KEY COMMENT '被禁言学生（profiles.id）',
  `student_username` VARCHAR(100) DEFAULT NULL COMMENT '学生账号（快照）',
  `student_real_name` VARCHAR(100) DEFAULT NULL COMMENT '学生姓名（快照）',
  `mute_until` DATETIME NOT NULL COMMENT '禁言截止时间',
  `reason` VARCHAR(500) DEFAULT NULL COMMENT '禁言原因',
  `operator_id` VARCHAR(50) DEFAULT NULL COMMENT '操作教师ID',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_mute_until` (`mute_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='学生消息禁言（一人一行，截至时间）';

-- ---------------------------------------------------------------------------
-- 5. 屏蔽关键词
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `student_message_keywords` (
  `id` VARCHAR(50) PRIMARY KEY,
  `word` VARCHAR(100) NOT NULL COMMENT '屏蔽词（命中即拒绝发送）',
  `category` VARCHAR(50) DEFAULT '自定义' COMMENT '分类：色情/暴力/辱骂/自定义 等',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_word` (`word`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='学生消息屏蔽关键词';

-- 预置一批基础屏蔽词（色情 / 暴力 / 辱骂的浅表词，教师可随时增删启用停用）。
-- 用 INSERT IGNORE + 固定 id，保证迁移重复执行不报错、也不覆盖教师改过的数据。
INSERT IGNORE INTO `student_message_keywords` (`id`, `word`, `category`, `enabled`) VALUES
  ('smk_default_01', '色情', '色情', 1),
  ('smk_default_02', '黄色网站', '色情', 1),
  ('smk_default_03', '裸照', '色情', 1),
  ('smk_default_04', '约炮', '色情', 1),
  ('smk_default_05', '成人网站', '色情', 1),
  ('smk_default_06', '赌博', '违法', 1),
  ('smk_default_07', '博彩', '违法', 1),
  ('smk_default_08', '毒品', '违法', 1),
  ('smk_default_09', '代考', '违法', 1),
  ('smk_default_10', '作弊答案', '违法', 1),
  ('smk_default_11', '打死你', '暴力', 1),
  ('smk_default_12', '弄死你', '暴力', 1),
  ('smk_default_13', '砍死', '暴力', 1),
  ('smk_default_14', '自杀', '暴力', 1),
  ('smk_default_15', '傻逼', '辱骂', 1),
  ('smk_default_16', 'sb', '辱骂', 1),
  ('smk_default_17', '滚蛋', '辱骂', 1),
  ('smk_default_18', '废物', '辱骂', 1);

-- ---------------------------------------------------------------------------
-- 6. 快捷发送内容（文字模板）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `student_message_quick_replies` (
  `id` VARCHAR(50) PRIMARY KEY,
  `content` VARCHAR(200) NOT NULL COMMENT '模板内容（学生点选后填入输入框，可再编辑）',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序（小在前）',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='学生消息快捷发送模板';

-- 预置课堂/PK 场景常用短语
INSERT IGNORE INTO `student_message_quick_replies` (`id`, `content`, `sort_order`, `enabled`) VALUES
  ('smq_default_01', '我这题不会，能教教我吗？', 10, 1),
  ('smq_default_02', '我懂了，谢谢你！', 20, 1),
  ('smq_default_03', '我们来PK一局吧', 30, 1),
  ('smq_default_04', '等我一下，马上就好', 40, 1),
  ('smq_default_05', '稍等，我先看下题目', 50, 1),
  ('smq_default_06', '老师刚才讲的知识点你记下来了吗？', 60, 1),
  ('smq_default_07', '这道题我的思路是……', 70, 1),
  ('smq_default_08', '一起复习第几章？', 80, 1),
  ('smq_default_09', '好的，没问题', 90, 1),
  ('smq_default_10', '不好意思，我现在有点忙', 100, 1);

-- ---------------------------------------------------------------------------
-- 7. 消息设置（单行配置表）
-- ---------------------------------------------------------------------------
-- 故意用「单行表 + 固定 id=1」而不是 key-value：设置项是一个整体的表单，
-- 单行表便于 SELECT * 一次取全、也便于教师端表单直接绑定。
CREATE TABLE IF NOT EXISTS `student_message_settings` (
  `id` INT PRIMARY KEY COMMENT '固定为 1（单行配置）',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '学生消息功能总开关',
  `points_per_message` INT NOT NULL DEFAULT 1 COMMENT '发送每条消息消耗的积分（0=不扣）',
  `max_length` INT NOT NULL DEFAULT 100 COMMENT '单条消息最大字数',
  `max_per_day` INT NOT NULL DEFAULT 0 COMMENT '每日最多发送条数（0=不限）',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` VARCHAR(50) DEFAULT NULL COMMENT '最后修改的教师ID'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='学生消息全局设置（单行）';

INSERT IGNORE INTO `student_message_settings`
  (`id`, `enabled`, `points_per_message`, `max_length`, `max_per_day`)
  VALUES (1, 1, 1, 100, 0);

-- ---------------------------------------------------------------------------
-- 8. 班级开关改名：dm_enabled → dm_enabled 保留，但语义扩展为「本班学生消息功能」
-- ---------------------------------------------------------------------------
-- 列名保持不变（有存量数据与前端引用），只更新注释，避免无谓的重命名风险。
ALTER TABLE `classes`
  MODIFY COLUMN `dm_enabled` BOOLEAN NOT NULL DEFAULT TRUE
  COMMENT '是否允许该班级学生使用消息功能（原数字消息）';
