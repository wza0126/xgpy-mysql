-- 装备掉落系统
-- 1. 装备目录表（教师管理）
CREATE TABLE IF NOT EXISTS equipments (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '装备名称',
  drop_rate DECIMAL(5,2) NOT NULL DEFAULT 1.00 COMMENT '掉落概率(%)',
  crit_bonus DECIMAL(5,2) NOT NULL DEFAULT 1.00 COMMENT '暴击率永久加成(%)',
  icon VARCHAR(50) DEFAULT '⚔️' COMMENT '图标emoji',
  is_active BOOLEAN DEFAULT true COMMENT '是否启用',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 学生装备持有表
CREATE TABLE IF NOT EXISTS student_equipments (
  id VARCHAR(50) PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL COMMENT '学生ID',
  equipment_id VARCHAR(50) NOT NULL COMMENT '装备ID',
  quantity INT DEFAULT 1 COMMENT '拥有数量',
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '首次获取时间',
  UNIQUE KEY uk_student_equipment (student_id, equipment_id),
  INDEX idx_student_id (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. tests 表新增装备掉落开关
ALTER TABLE tests ADD COLUMN IF NOT EXISTS allow_equipment_drop BOOLEAN DEFAULT false COMMENT '是否开启及格掉落装备';
