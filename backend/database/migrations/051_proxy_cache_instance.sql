-- 代理上网-缓存索引多机房隔离
-- 背景：多个机房各有一台教师机跑各自后端实例、连同一个 MariaDB。
-- 缓存文件在各机本地磁盘，索引表在共享库，需按 instance_id 区分归属，
-- 否则跨机房互删索引（缓存失效）且对方磁盘留下孤儿文件。
--
-- 说明：缓存索引是可丢弃的自愈数据，迁移时直接 TRUNCATE。
-- 各机磁盘上迁移前的旧缓存文件（文件名不含实例前缀）成为一次性孤儿，
-- 由教师端"清空缓存"或手工删除 cache/web-proxy 目录自然消化，不影响功能。

TRUNCATE TABLE proxy_cache_files;

ALTER TABLE proxy_cache_files
  ADD COLUMN IF NOT EXISTS instance_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '缓存所属后端实例ID（各教师机本地持久化的UUID，可用PROXY_INSTANCE_ID覆盖）';

-- 主键改为 (url_hash, instance_id)：同一URL允许各机房各存一份
-- DROP PRIMARY KEY 不需要列名，重复执行本迁移也能正常重放
ALTER TABLE proxy_cache_files
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (url_hash, instance_id);
