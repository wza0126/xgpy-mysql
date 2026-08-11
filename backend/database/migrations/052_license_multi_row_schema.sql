-- 授权系统多行支持：修正 system_license 表结构，使多服务器独立激活能正常工作
-- 创建时间: 2026-07-30
-- 说明:
--   1. 将 id 从 DEFAULT 1 改为 AUTO_INCREMENT，否则 INSERT 新机器码行始终拿到 id=1 与旧行主键冲突，INSERT IGNORE 静默跳过导致多行无法插入
--   2. 为 machine_code 添加唯一索引 uk_machine_code，保证 INSERT IGNORE 语义正确（同一机器码不重复插入），防止刷新多次产生重复行导致 SELECT 取 rows[0] 顺序不确定

-- 1. id 列改为自增主键（去掉 DEFAULT 1），重复执行幂等（MODIFY 为相同定义无害）
ALTER TABLE system_license MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT;

-- 2. 为 machine_code 添加唯一索引（MySQL ALTER TABLE 不支持 ADD INDEX IF NOT EXISTS，用 INFORMATION_SCHEMA 判断后动态执行）
SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_license' AND INDEX_NAME = 'uk_machine_code');
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE system_license ADD UNIQUE KEY uk_machine_code (machine_code)',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
