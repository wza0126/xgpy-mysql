-- 微课程「引用现成课程链接」（2026-10-26 吴老定）
--
-- 背景：AI 讲堂原来只有一种微课程 —— 由 AI 生成 pages 后逐页播放。
-- 但老师在 openMAIC 等平台已经做好的课程，希望能直接挂进讲堂给学生看，不必重做一遍。
--
-- ⛔ 这类课**不能内嵌播放**：open.maic.chat 返回
--      X-Frame-Options: SAMEORIGIN
--      Content-Security-Policy: frame-ancestors 'self'
--    浏览器会拒绝把对方页面装在 xgpy 里，所以外链课只能在学生端「点开后新标签页打开」。
--    因此这里只存地址，不存内容，也不参与 pages 相关的校验。
--
-- source：
--   'ai'   —— 现有类型，pages 由 AI 生成，走讲堂播放器，可内嵌、可统计进度
--   'link' —— 外链课，pages 恒为空、page_count = 0，学生端点开跳转新标签
--
-- 默认 'ai' 保证历史 20 门课行为完全不变，无需回填。

ALTER TABLE `lectures`
  ADD COLUMN IF NOT EXISTS `source` VARCHAR(16) NOT NULL DEFAULT 'ai'
    COMMENT '课程来源：ai=AI 生成，link=引用外链';

ALTER TABLE `lectures`
  ADD COLUMN IF NOT EXISTS `external_url` VARCHAR(600) NULL
    COMMENT '外链课程地址（仅 https，source=link 时有值）';
