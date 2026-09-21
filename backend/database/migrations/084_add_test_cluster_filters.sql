-- 普通测试 / 考试 支持「AI 聚类筛选」
-- 教师端创建测试时可在「题目范围」里按 AI 聚类（一级/二级类目）收窄抽题范围。
-- 与已有的 tag_filters 叠加生效（两者都满足才进入抽题池）；为空表示不按聚类过滤。
-- 存储格式：[{"primary":"一级类目","secondary":"二级类目"}, {"primary":"一级类目","secondary":""}]
--   secondary 为空串 = 只按一级筛选（命中该一级下全部题目，含仅挂一级的题）。
-- 服务端在 submit-test 的抽题池计算中读取本字段，保证分母口径与前端抽题一致。
ALTER TABLE `tests`
ADD COLUMN IF NOT EXISTS `cluster_filters` JSON NULL COMMENT 'AI聚类筛选条件（一级/二级类目，与 tag_filters 叠加）';
