-- 段位专属皮肤：记录学生皮肤的获取来源
--
-- 背景：
--   原有 7 套皮肤只能通过「积分兑换」获得（兑换成功即写 student_skins）。
--   本次新增 5 套段位专属皮肤（小学生 → 研究生，暴击率 3/7/8/9/10%），
--   获取途径是「达到对应 PK 段位自动永久解锁」，与积分无关，且掉段不回收。
--
-- 为什么需要这一列：
--   光看 student_skins 无法区分「花了积分买的」与「打段位拿的」。
--   教师端学生管理、以及将来做「皮肤获取途径」统计时都需要这个区分；
--   另外，学生端展示「我的皮肤」时也应按来源分组。
--
-- 取值：
--   points —— 积分兑换 / 教师作为奖品发放（默认值，兼容存量数据）
--   rank   —— PK 段位解锁
--
-- 说明：不改变唯一键 (student_id, skin_id)，同一皮肤只可能存在一条记录。

ALTER TABLE `student_skins`
ADD COLUMN IF NOT EXISTS `unlock_source` VARCHAR(20) NOT NULL DEFAULT 'points'
  COMMENT '获取来源：points=积分兑换/奖品发放，rank=PK段位解锁（段位皮肤掉段不回收）';

-- 便于按来源筛选（如「该生拥有几套段位皮肤」）
ALTER TABLE `student_skins`
ADD INDEX IF NOT EXISTS `idx_unlock_source` (`unlock_source`);

-- ============================================================
-- 存量数据回填：已是段位皮肤的按来源修正
-- ============================================================
-- 段位皮肤 ID（与前端 windowSkins.ts、后端 WINDOW_SKINS_META 保持一致）
-- 这些皮肤在本次迁移前不可能通过积分兑换获得（此前未定义），
-- 但保险起见仍按 ID 精确回填，避免将来重复执行时语义漂移。
UPDATE `student_skins`
SET `unlock_source` = 'rank'
WHERE `skin_id` IN (
  'skin_rank_primary',
  'skin_rank_junior',
  'skin_rank_senior',
  'skin_rank_undergrad',
  'skin_rank_researcher'
);
