-- AI创意工坊：新增每次打开应用消耗积分设置
-- 创建时间: 2026-07-30
-- 说明: 学生购买应用后，每次打开仍需支付积分（按 open_cost 扣减），
--       支付的积分同样按提成比例奖励给作者（0=免费打开）

ALTER TABLE ai_workshop_config
ADD COLUMN IF NOT EXISTS open_cost INT DEFAULT 0 COMMENT '每次打开应用消耗积分（0=免费打开）' AFTER modify_cost;
