-- 100_farm_code_slots.sql
-- 代码农场：给学生 5 个「代码容器」，把写好的农活代码存进数据库，随时取回来接着改、直接运行。
--
-- 背景：以前学生写的代码只留在这个浏览器里（localStorage），
--   换个座位 / 换台机器 / 清一次浏览器缓存就没了，写好的自动化脚本只能当场用完。
--   现在改成存服务器：点一下容器标签就显示里面的代码，改完存回去，下次开机还在。
--
-- 设计要点：
--   1) 一人固定 5 格，slot = 1..5，(student_id, slot) 唯一键 ——
--      后端用 INSERT ... ON DUPLICATE KEY UPDATE 天然幂等，不会存出重复格子。
--   2) name 是学生自定义的容器名（NULL = 前端显示默认「容器 N」）——
--      用来区分「自动浇一茬」「手动收尾」这类不同用途的脚本。
--   3) code 长度与 farm_logs.code 同口径（5000 字符），存 TEXT 足够。
--   4) ⛔ 只有学生自己的读写入口（req.user.userId），没有任何跨学生查询接口，
--      同学之间互相看不到对方的代码。
--
-- 幂等：CREATE TABLE IF NOT EXISTS，重复执行安全。

CREATE TABLE IF NOT EXISTS `farm_code_slots` (
  `id` VARCHAR(50) PRIMARY KEY,
  `student_id` VARCHAR(50) NOT NULL COMMENT '学生ID（profiles.id）',
  `slot` TINYINT NOT NULL COMMENT '容器序号 1-5',
  `name` VARCHAR(40) DEFAULT NULL COMMENT '学生自定义的容器名（NULL=前端显示默认「容器N」）',
  `code` TEXT DEFAULT NULL COMMENT '容器内存的代码（最长 5000 字符，与 farm_logs.code 同口径）',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '首次保存时间',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_farm_slot` (`student_id`, `slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代码农场学生代码容器（每生 5 格）';
