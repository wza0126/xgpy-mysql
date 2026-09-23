-- 普通测试 / 试卷PK 支持「已掌握题数认证」
-- 在原有「做对题数」资格之外，新增第二项资格：在指定一级类目范围内（含该章全部小节）
-- 达到「已掌握题数」标准的题目数量。两项资格同时满足才可参加。
--
-- 掌握口径与练习模块 / 学情分析完全一致（不要另设阈值）：
--   source='practice' 且同一道题答对次数 >= system_config.master_question_threshold 记为已掌握。
--
-- qualification_mastered_count：要求的已掌握题数，NULL / 0 表示不启用该项资格。
-- qualification_mastered_clusters：一级类目名数组（JSON），如 ["数据与信息","算法与程序实现"]。
--                                   NULL / 空数组表示「全部范围」（不限类目，全库已掌握题数）。
ALTER TABLE `tests`
ADD COLUMN IF NOT EXISTS `qualification_mastered_count` INT DEFAULT NULL COMMENT '所需已掌握题数，NULL表示不限制',
ADD COLUMN IF NOT EXISTS `qualification_mastered_clusters` JSON NULL COMMENT '已掌握题数统计的一级类目范围（null/空=全部范围）';

ALTER TABLE `pk_battle_configs`
ADD COLUMN IF NOT EXISTS `qualification_mastered_count` INT DEFAULT NULL COMMENT '所需已掌握题数，NULL表示不限制',
ADD COLUMN IF NOT EXISTS `qualification_mastered_clusters` JSON NULL COMMENT '已掌握题数统计的一级类目范围（null/空=全部范围）';
