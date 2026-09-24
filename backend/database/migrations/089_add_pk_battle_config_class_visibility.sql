-- PK 对战配置的班级可见性：只有被选中的班级学生才能看到并使用该活动
--
-- 背景：
--   一位教师可能同时带多个班级（甚至跨年级）。原先把活动配置给「教师名下所有班级」
--   一刀切，导致给高一班级布置的复习 PK 出现在初一学生的活动列表里 —— 题目范围、
--   难度都不合适。需要「同一个活动只投放到指定班级」。
--
-- 语义（与 prize_class_visibility 一致的「按行记录」模式）：
--   * 表内**无该活动的任何行**  → 视为「未做班级限制」，全部班级可见（兼容存量配置）。
--   * 表内**存在该活动的行**    → 只有 is_visible=1 的班级可见；
--     勾了但取消勾选的班级存 is_visible=0 而非删行，避免「全不选」与「未配置」混淆。
--   * 普通教师只能在**自己的班级**里勾选；超管不受限。
--
-- 说明：不对齐 app_visibility 的 UNIQUE KEY，因为 prize_class_visibility 同样没有，
--       且本表写入路径全部走「先查后写」的幂等逻辑（见 PUT /api/pk/battle-configs/:id）。

CREATE TABLE IF NOT EXISTS `pk_battle_config_class_visibility` (
  `id` VARCHAR(50) PRIMARY KEY,
  `config_id` VARCHAR(50) NOT NULL COMMENT 'PK对战配置ID（pk_battle_configs.id）',
  `class_id` VARCHAR(50) NOT NULL COMMENT '班级ID（classes.id）',
  `is_visible` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '该班是否可用此活动',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_config` (`config_id`),
  INDEX `idx_class` (`class_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='PK对战活动的班级可见性（无行=不限班级）';

-- 清理：配置删除时其可见性行应一并删除（历史遗留可能已有悬空行）
DELETE v FROM `pk_battle_config_class_visibility` v
  LEFT JOIN `pk_battle_configs` c ON v.config_id = c.id
  WHERE c.id IS NULL;
