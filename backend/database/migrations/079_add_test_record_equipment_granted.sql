-- 测试及格掉落装备「每次作答只发一次」的幂等标记
-- 背景：/api/business/test-equipment-drop 原为独立接口，student_id / is_passed 全由请求体传入，
--       学生可脱离测试反复调用刷装备，绕过「每日测试次数限制」与及格判定。
--       现改为：必须绑定一条真实且及格的 test_record，且该记录只能发放一次掉落。
ALTER TABLE `test_records`
ADD COLUMN IF NOT EXISTS `equipment_granted` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '本次作答的及格装备掉落是否已发放（防重复发放）';
