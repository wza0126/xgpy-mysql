-- 装备奖品功能
-- 1. prizes 表新增 equipment 类型支持
ALTER TABLE prizes ADD COLUMN IF NOT EXISTS equipment_id VARCHAR(50) NULL COMMENT '关联的装备ID（装备类奖品必填）';

-- 修改 type 枚举，增加 equipment 类型
ALTER TABLE prizes MODIFY COLUMN type ENUM('normal', 'internet_code', 'equipment') DEFAULT 'normal';

-- 2. exchange_records 表新增 equipment_id 字段（记录兑换的装备）
ALTER TABLE exchange_records ADD COLUMN IF NOT EXISTS equipment_id VARCHAR(50) NULL COMMENT '兑换的装备ID';
