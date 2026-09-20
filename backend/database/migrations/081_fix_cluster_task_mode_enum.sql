-- 081: 修正 080 建表时 mode 枚举值不全的问题
--
-- 080 把 question_cluster_tasks.mode 定义成 ENUM('incremental','full','retry','manual')，
-- 但接口还支持 mode='selected'（聚类指定题目），写入时会报
--   Data truncated for column 'mode' at row 1
-- 本迁移补齐枚举值。
--
-- 说明：080 若已在生产库执行，这里改列定义即可；未执行过的库两者结果一致。

ALTER TABLE `question_cluster_tasks`
MODIFY COLUMN `mode` ENUM('incremental','full','retry','manual','selected','resume')
  NOT NULL DEFAULT 'incremental'
  COMMENT 'incremental=只跑未聚类 / full=全量重跑(保留manual) / retry=只重试失败 / manual=单题改挂 / selected=聚类指定题 / resume=断点续跑';
