-- 学习星域：低动效模式开关（2026-10-24）
--
-- 背景：第 5 档（累计练习 ≥1000）单层 SVG 里同时跑 130+ 个 CSS 动画，
-- 而 SVG 内部元素无法像 HTML 元素那样交给合成器独立成层，每个动效都会让整块
-- 1600×900 重新光栅化 —— 实测学生桌面因此吃掉 16%+ CPU（Edge 单标签）。
--
-- low_motion = 1 时，前端把 anim 参数置 false：星空、星座、行星全部保留（静态），
-- 只关掉「闪烁/呼吸/流星/流光」这类持续动画。视觉上从「活的星河」变成「静的星图」，
-- CPU 基本回到 0。给机房老机器或临时卡顿时一个一键开关。

ALTER TABLE `study_galaxy_config`
  ADD COLUMN IF NOT EXISTS `low_motion` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '低动效模式（1=关闭星域持续动画，只保留静态星空）';
