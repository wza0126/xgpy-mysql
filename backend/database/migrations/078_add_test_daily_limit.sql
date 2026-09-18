-- 普通测试支持「每日测试次数限制」
-- 教师端「考试管理 → 普通测试」中可设置学生每天最多参加该测试的次数。
-- 0 表示不限制（保持原有行为）；服务端在 submit-test 中按 (student_id, test_id, 当日) 计数后拦截。
ALTER TABLE `tests`
ADD COLUMN IF NOT EXISTS `daily_test_limit` INT NOT NULL DEFAULT 0 COMMENT '每日可参加该测试的次数上限，0=不限制';
