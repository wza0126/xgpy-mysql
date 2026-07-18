-- 窗口皮肤系统
-- 1. prizes 表新增 skin_id 字段（类比 equipment_id 模式）
ALTER TABLE prizes ADD COLUMN IF NOT EXISTS skin_id VARCHAR(50) NULL COMMENT '关联的皮肤ID（皮肤类奖品必填）';

-- 2. 修改 type 枚举，增加 skin 类型
ALTER TABLE prizes MODIFY COLUMN type ENUM('normal', 'internet_code', 'equipment', 'skin') DEFAULT 'normal';

-- 3. exchange_records 表新增 skin_id 字段（记录兑换的皮肤）
ALTER TABLE exchange_records ADD COLUMN IF NOT EXISTS skin_id VARCHAR(50) NULL COMMENT '兑换的皮肤ID';

-- 4. 学生拥有的皮肤表
CREATE TABLE IF NOT EXISTS student_skins (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  skin_id VARCHAR(50) NOT NULL,
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_student_skin (student_id, skin_id),
  INDEX idx_student_id (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. profiles 表新增 active_skin_id 字段（当前激活的皮肤）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_skin_id VARCHAR(50) NULL COMMENT '当前激活的窗口皮肤ID';
