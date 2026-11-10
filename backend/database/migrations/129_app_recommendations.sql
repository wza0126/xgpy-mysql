-- 129_app_recommendations.sql
-- 应用推荐 · 按班（2026-11-11 吴老需求）
--
-- 用途：老师在「应用管理」里把应用打星推荐给指定班级，这些应用图标会直接出现在
--   该班学生的虚拟桌面上，双击即可打开 —— 即使「应用中心」模块被关掉也能用。
--
-- 口径（吴老 2026-11-11 定）：
--   1. 按班推荐：同一个应用可以只推荐给某几个班；
--   2. 推荐优先：**不看 app_visibility**，老师对该班隐藏了应用也能被推荐出来；
--   3. 桌面最多显示 8 个，超出的只在应用中心里出现。
--
-- 为什么单独建表而不是给 app_visibility 加字段：
--   app_visibility 的语义是「可见/隐藏」，推荐是另一回事；
--   混在一张表里以后改可见性很容易把推荐一起改掉（2026-11-10 缓存那次的教训：语义别混）。
--
-- 删除推荐 = 删行；同一 (app_id, class_id) 只可能有一条，天然幂等。

CREATE TABLE IF NOT EXISTS `app_recommendations` (
  `app_id` varchar(50) NOT NULL COMMENT '应用 id（apps.id）',
  `class_id` varchar(50) NOT NULL COMMENT '班级 id（classes.id）',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp() COMMENT '推荐时间，桌面按此排序',
  PRIMARY KEY (`app_id`,`class_id`),
  KEY `idx_class` (`class_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='应用推荐（按班）：有记录 = 该班学生桌面显示该应用图标';
