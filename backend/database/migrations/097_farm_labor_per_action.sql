-- 097_farm_labor_per_action.sql
-- 代码农场：劳作口径由「提交次数」改为「动作次数」。
-- ⛔ 语义变更（无表结构变更）：farm_config.max_ops_per_day 现在表示「每天的劳作次数」，
--   播种 / 除草 / 收获 各 1 次；water(n) / fertilize(n) 各 n 次。
-- 旧值 3 在新口径下连一茬地都种不完（一茬约需 12 次：播种 1 + 水 5 + 肥 5 + 收获 1），故至少提到 15。
-- 教师可在教师后台「代码农场 → 农场设置」随时调整。

UPDATE `farm_config`
   SET `max_ops_per_day` = GREATEST(15, `max_ops_per_day`);
