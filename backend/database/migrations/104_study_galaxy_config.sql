-- 桌面「学习星域」图层配置（单行，id=1）
--
-- 设计要点：
--  - 与 farm_config 同一套模式：单行表 + enabled 总开关 + class_ids 班级白名单（[] / NULL = 全校生效）。
--    教师可以只给新机房开、老机房关，避免低配机器掉帧。
--  - daily_goal：今日目标题数（教师可配），学生端进度环按这个算。
--  - tier_2..tier_5：五档阈值。tier_1 恒为 0，不落库。
--      星尘 0 ~ tier_2-1 ／ 初亮 tier_2 ~ tier_3-1 ／ 成图 tier_3 ~ tier_4-1
--      银河 tier_4 ~ tier_5-1 ／ 星海 >= tier_5
--    档位只看「累计作答次数」（student_answers 行数，允许重复练同一题），只升不降。
--  - lit_ratio：小节「点亮」门槛（该知识点达到掌握阈值的题目占比）。0.5 = 一半题目掌握即点亮。
--    章点亮 = 该章下所有小节都点亮。
CREATE TABLE IF NOT EXISTS `study_galaxy_config` (
  `id` INT NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `class_ids` TEXT DEFAULT NULL COMMENT '班级白名单 JSON，NULL/[] = 全校生效',
  `daily_goal` INT NOT NULL DEFAULT 30 COMMENT '今日目标题数',
  `tier_2` INT NOT NULL DEFAULT 50 COMMENT '初亮起点（累计作答次数）',
  `tier_3` INT NOT NULL DEFAULT 200 COMMENT '成图起点',
  `tier_4` INT NOT NULL DEFAULT 500 COMMENT '银河起点',
  `tier_5` INT NOT NULL DEFAULT 1000 COMMENT '星海起点',
  `lit_ratio` DECIMAL(3,2) NOT NULL DEFAULT 0.50 COMMENT '小节点亮所需掌握率',
  `updated_by` VARCHAR(50) DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='桌面学习星域图层配置（单行）';

INSERT IGNORE INTO `study_galaxy_config` (`id`) VALUES (1);
