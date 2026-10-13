-- 099_farm_guide.sql
-- 代码农场：把《学生使用手册》做成「教师可上传 / 学生桌面可点开」的入口。
--
-- 背景：手册是一份自包含的单文件 HTML（讲农活 API、生长规则，并带一个可交互试跑区），
--   学生写代码时能随手对照，不用老师投屏念。
--   · 教师上传后落在 uploads/farm/guides/，相对地址记在 guide_url（guide_name 存原始文件名，仅用于后台回显）；
--   · guide_url 为 NULL 时，前端回落到**随包内置**的默认手册（/code-farm-guide.html）；
--   · guide_enabled=0 可临时收起学生桌面上的「农场手册」图标（例如想当课堂任务再放出来）。
-- 幂等：ADD COLUMN IF NOT EXISTS，重复执行安全；已有数据不受影响（默认可见）。

ALTER TABLE `farm_config`
  ADD COLUMN IF NOT EXISTS `guide_url` VARCHAR(255) DEFAULT NULL COMMENT '学生手册 HTML 地址（教师上传，/uploads/...；NULL=用内置默认手册）',
  ADD COLUMN IF NOT EXISTS `guide_name` VARCHAR(255) DEFAULT NULL COMMENT '学生手册的原始文件名（教师后台上传时记录，仅用于回显）',
  ADD COLUMN IF NOT EXISTS `guide_enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否在学生桌面显示「农场手册」入口';
