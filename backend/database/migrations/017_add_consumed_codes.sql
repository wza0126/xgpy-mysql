-- 为 system_license 表添加已消耗授权码记录字段
-- 创建时间: 2026-06-24
-- 说明: 防止同一授权码被重复使用

ALTER TABLE system_license 
ADD COLUMN IF NOT EXISTS consumed_codes JSON DEFAULT NULL COMMENT '已消耗的授权码列表（JSON数组）' AFTER license_code;
