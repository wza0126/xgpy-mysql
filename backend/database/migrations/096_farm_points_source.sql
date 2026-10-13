-- 096_farm_points_source.sql
-- 代码农场收获发积分：point_transactions.source_type 增加 'farm'
-- 说明：收获积分走既有原子写口径（见 farm.js），只是来源类型要能区分出「农场」。

ALTER TABLE `point_transactions`
  MODIFY COLUMN `source_type`
  ENUM('notification', 'manual', 'system', 'practice', 'pet_feed', 'test', 'python_submit', 'exam', 'task', 'pk_battle', 'mission', 'farm')
  NOT NULL DEFAULT 'notification' COMMENT '来源类型';
