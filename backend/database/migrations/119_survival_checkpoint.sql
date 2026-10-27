-- 生存游戏「重生点」（2026-10-27 吴老定）
--
-- 背景：原来血尽一律回到第 1 关重来。学生熬到 3.x / 4.x 一死要重打 40~60 关，
-- 基本没人有耐心再来一遍，等于劝退。
--
-- 规则：
--   * 每个单元第一关（1.1.1 / 2.1.1 / 3.1.1 / 4.1.1）默认是重生点，老师可在后台改。
--   * 死亡后血照旧回满，关卡回到「<= 当前关卡的最大重生点」。
--   * 「到达即解锁」：学生打到某一关，这一关所在的重生点就算拿到，不需要先答对。
--   * round_no（第几轮）不再因为死亡 +1，只有真正打穿最后一关才 +1。
--
-- ⛔ 重生点必须是行属性（跟着关卡走），不能用「单元第一关」硬编码：
--    教师端点过「单元内顺序随机化」之后，单元第一关会变，硬编码会指错。

ALTER TABLE `survival_levels`
  ADD COLUMN IF NOT EXISTS `is_checkpoint` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1=重生点：血尽后回到这里';

ALTER TABLE `survival_levels`
  ADD COLUMN IF NOT EXISTS `checkpoint_story` VARCHAR(300) NULL
    COMMENT '首次抵达该重生点时展示的剧情文本';

-- 默认四个重生点 + 一段剧情（老师可在关卡管理里改）
UPDATE `survival_levels` SET `is_checkpoint` = 1,
  `checkpoint_story` = COALESCE(`checkpoint_story`, '深度 0m · 起点已锚定。信号从这里接入，断线后还能回到这里。')
  WHERE `code` = '1.1.1';

UPDATE `survival_levels` SET `is_checkpoint` = 1,
  `checkpoint_story` = COALESCE(`checkpoint_story`, '深度 200m · 中继站 ALPHA 已激活。从今往后，断线会回到这里重新接入。')
  WHERE `code` = '2.1.1';

UPDATE `survival_levels` SET `is_checkpoint` = 1,
  `checkpoint_story` = COALESCE(`checkpoint_story`, '深度 400m · 中继站 BETA 已激活。走过的路线被记住了，不必从头再走。')
  WHERE `code` = '3.1.1';

UPDATE `survival_levels` SET `is_checkpoint` = 1,
  `checkpoint_story` = COALESCE(`checkpoint_story`, '深度 600m · 中继站 GAMMA 已激活。最后一程，信号依然稳定。')
  WHERE `code` = '4.1.1';
